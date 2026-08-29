#!/usr/bin/env node
/**
 * PROFİL VİTRİN SEÇİMİ — DOĞRULAMA HARNESS'I
 *
 * Kapsam: `season_achievement_showcase_selections` tablosunun ve seçim
 * RPC'lerinin GÜVENLİK SINIRI + otomatik/özel mod davranışı + istemci yaşam
 * döngüsü. RP kuralları, rank eşikleri, başarı koşulları ve kutlama/baseline
 * mantığı BURADA TEST EDİLMEZ — onlar ayrı harness'lardadır ve o dosyalara
 * dokunulmamıştır.
 *
 * Üç katman: (1) saf mantık gerçekten derlenip çalıştırılır, (2) RPC'ler ve
 * iki ekran deterministik bir modelle simüle edilir, (3) SQL/kaynak statik
 * denetlenir.
 *
 * Canlı Postgres YOKTUR: SQL çalıştırılmaz, modellenip statik denetlenir.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const SELECTION_SQL_PATH =
  'supabase/migrations/20260901120000_add_achievement_showcase_selection.sql';
const ACHIEVEMENTS_SQL_PATH = 'supabase/migrations/20260830120000_add_season_rank_achievements.sql';
const FRIEND_SQL_PATH = 'supabase/migrations/20260831120000_add_friend_achievement_showcase.sql';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} — beklenen ${expected}, gelen ${actual}`);
}

function assertDeepEqual(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message} — beklenen ${right}, gelen ${left}`);
}

function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

const source = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

// ---------------------------------------------------------------------------
// Katman 1 — saf mantık gerçekten derlenir
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'rosea-showcase-selection-'));
let rx;

try {
  execFileSync(
    'npx',
    [
      'tsc',
      join(ROOT, 'constants/rank-experience.ts'),
      '--outDir',
      outDir,
      '--target',
      'es2020',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--strict',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
  rx = await import(pathToFileURL(join(outDir, 'rank-experience.js')).href);
} catch (error) {
  console.error(
    'constants/rank-experience.ts derlenemedi:\n' + (error.stdout?.toString() ?? error.message),
  );
  process.exit(1);
}

const sql = source(SELECTION_SQL_PATH);
const achievementsSql = source(ACHIEVEMENTS_SQL_PATH);
const serviceSource = source('services/ranks.ts');
const contextSource = source('context/rank-context.tsx');
const screenSource = source('app/rank-showcase.tsx');
const componentSource = source('components/ranks/profile-achievement-showcase.tsx');
const ownProfileSource = source('app/(tabs)/profile.tsx');
const friendProfileSource = source('app/profile/[userId].tsx');
const layoutSource = source('app/_layout.tsx');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

const sqlCode = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, ' ');
const screenCode = screenSource
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

const KEYS = [...rx.SEASON_ACHIEVEMENT_KEYS];
const LIMIT = 3;

// ---------------------------------------------------------------------------
// Katman 2 — MODEL: tablo + RPC'ler + iki ekran
// ---------------------------------------------------------------------------

function createServer(currentSeasonIndex = 5) {
  return {
    /** `season_rank_achievements` — kazanılmış rozetler. */
    achievements: [],
    currentSeasonIndex,
    friendships: [],
    /** `season_achievement_showcase_selections`. */
    selections: [],
    /** Ekonomi tablolarına dokunulmadığını kanıtlayan sayaç. */
    economyWrites: 0,
  };
}

function addUnlocked(server, userId, key, unlockedAt, seasonIndex) {
  server.achievements.push({
    achievement_key: key,
    season_index: seasonIndex ?? server.currentSeasonIndex,
    unlocked_at: unlockedAt,
    user_id: userId,
  });
}

function addFriendship(server, requesterId, receiverId, status) {
  server.friendships.push({ receiver_id: receiverId, requester_id: requesterId, status });
}

function areFriends(server, actor, target) {
  if (!actor) return false;
  return server.friendships.some(
    (row) =>
      row.status === 'accepted' &&
      [row.requester_id, row.receiver_id].includes(actor) &&
      ((row.requester_id === actor && row.receiver_id === target) ||
        (row.requester_id === target && row.receiver_id === actor)),
  );
}

/** `public.get_my_season_showcase_selection()` referansı. */
function getMySelection(server, actor) {
  if (!actor) return [];
  return server.selections
    .filter((row) => row.user_id === actor && row.season_index === server.currentSeasonIndex)
    // Başarı satırı yoksa slot sessizce düşer.
    .filter((row) =>
      server.achievements.some(
        (a) =>
          a.user_id === row.user_id &&
          a.season_index === row.season_index &&
          a.achievement_key === row.achievement_key,
      ),
    )
    .sort((left, right) => left.slot_position - right.slot_position)
    .map((row) => ({
      achievement_key: row.achievement_key,
      season_index: row.season_index,
      slot_position: row.slot_position,
    }));
}

/**
 * `public.set_my_season_showcase_selection(achievement_keys)` referansı.
 *
 * Bütün doğrulamalar SUNUCUDA. Hata durumunda hiçbir satır değişmez
 * (transaction geri alınır) → ÖNCEKİ geçerli seçim korunur.
 */
function setMySelection(server, actor, keys, options = {}) {
  const requireUnlocked = options.requireUnlocked !== false;
  const enforceLimit = options.enforceLimit !== false;

  if (!actor) throw new Error('not_authenticated');

  const list = keys ?? [];
  if (enforceLimit && list.length > LIMIT) throw new Error('too_many_showcase_selections');
  if (new Set(list).size !== list.length) throw new Error('duplicate_showcase_selection');

  for (const key of list) {
    if (!rx.parseSeasonAchievementKey(key)) throw new Error('unknown_showcase_achievement');
    if (
      requireUnlocked &&
      !server.achievements.some(
        (a) =>
          a.user_id === actor &&
          a.season_index === server.currentSeasonIndex &&
          a.achievement_key === key,
      )
    ) {
      throw new Error('locked_showcase_achievement');
    }
  }

  // Atomik: yalnızca GÜNCEL sezon silinir, geçmiş sezonlar korunur.
  server.selections = server.selections.filter(
    (row) => !(row.user_id === actor && row.season_index === server.currentSeasonIndex),
  );
  list.forEach((key, index) => {
    server.selections.push({
      achievement_key: key,
      season_index: server.currentSeasonIndex,
      slot_position: index + 1,
      user_id: actor,
    });
  });

  return getMySelection(server, actor);
}

/** `public.get_friend_season_achievement_showcase(target)` referansı. */
function getFriendShowcase(server, actor, targetUserId, options = {}) {
  const requireFriendship = options.requireFriendship !== false;

  if (!actor) return [];
  if (requireFriendship && !areFriends(server, actor, targetUserId)) return [];

  const selected = server.selections
    .filter((row) => row.user_id === targetUserId && row.season_index === server.currentSeasonIndex)
    .map((row) => {
      const achievement = server.achievements.find(
        (a) =>
          a.user_id === row.user_id &&
          a.season_index === row.season_index &&
          a.achievement_key === row.achievement_key,
      );
      return achievement ? { ...achievement, slot_position: row.slot_position } : undefined;
    })
    .filter(Boolean);

  const rows =
    selected.length > 0
      ? selected
      : server.achievements
          .filter(
            (a) => a.user_id === targetUserId && a.season_index === server.currentSeasonIndex,
          )
          .sort(
            (left, right) =>
              new Date(right.unlocked_at).getTime() - new Date(left.unlocked_at).getTime() ||
              KEYS.indexOf(left.achievement_key) - KEYS.indexOf(right.achievement_key),
          )
          .map((a, index) => ({ ...a, slot_position: index + 1 }));

  return rows
    .sort((left, right) => left.slot_position - right.slot_position)
    .slice(0, LIMIT)
    .map((row) => ({
      achievement_key: row.achievement_key,
      season_index: row.season_index,
      unlocked_at: row.unlocked_at,
    }));
}

/**
 * `RankContext.profileShowcaseEntries` referansı.
 *
 * Özel seçim varsa SIRA korunur; yoksa mevcut "en yeni önce" fallback'i.
 */
function deriveProfileEntries(unlockedAchievements, selection) {
  if (selection.length === 0) {
    return [...unlockedAchievements]
      .sort(
        (left, right) =>
          new Date(right.unlockedAt).getTime() - new Date(left.unlockedAt).getTime() ||
          KEYS.indexOf(left.key) - KEYS.indexOf(right.key),
      )
      .slice(0, LIMIT)
      .map((entry) => entry.key);
  }

  return selection
    .map((key) => unlockedAchievements.find((entry) => entry.key === key))
    .filter(Boolean)
    .slice(0, LIMIT)
    .map((entry) => entry.key);
}

/** Context'in seçim yaşam döngüsü (hesap sahipliği + latest-wins). */
function createContext(server) {
  let owner = 0;
  let userId;
  let selection = [];
  let hasError = false;

  return {
    get hasError() {
      return hasError;
    },
    async load(capturedOwner = owner) {
      const next = getMySelection(server, userId).map((row) => row.achievement_key);
      // Hesap arada değiştiyse eski cevap YENİ hesabın state'ine yazamaz.
      if (capturedOwner !== owner) return;
      selection = next;
    },
    get owner() {
      return owner;
    },
    async save(keys, capturedOwner = owner) {
      let next;
      try {
        next = setMySelection(server, userId, keys).map((row) => row.achievement_key);
      } catch (error) {
        if (capturedOwner === owner) hasError = true;
        throw error;
      }
      if (capturedOwner !== owner) return;
      selection = next;
      hasError = false;
    },
    get selection() {
      return [...selection];
    },
    signIn(nextUserId) {
      owner += 1;
      userId = nextUserId;
      selection = [];
      hasError = false;
    },
  };
}

const unlockedOf = (server, userId) =>
  server.achievements
    .filter((a) => a.user_id === userId && a.season_index === server.currentSeasonIndex)
    .map((a) => ({ key: a.achievement_key, unlockedAt: a.unlocked_at }));

function seedOwn(server, userId = 'me') {
  addUnlocked(server, userId, 'first_workout', '2026-08-20T10:00:00Z');
  addUnlocked(server, userId, 'workout_5', '2026-08-22T10:00:00Z');
  addUnlocked(server, userId, 'streak_3', '2026-08-24T10:00:00Z');
  addUnlocked(server, userId, 'streak_7', '2026-08-26T10:00:00Z');
}

// ---------------------------------------------------------------------------
// 1 · Otomatik ve özel mod
// ---------------------------------------------------------------------------

check('1. Seçim satırı YOK → son kazanılan en fazla üç rozet', () => {
  const server = createServer();
  seedOwn(server);

  assertDeepEqual(getMySelection(server, 'me'), [], 'seçimsiz kullanıcıda satır var');
  assertDeepEqual(
    deriveProfileEntries(unlockedOf(server, 'me'), []),
    ['streak_7', 'streak_3', 'workout_5'],
    'otomatik mod fallback sırası bozuldu',
  );
});

check('2. Bir, iki ve üç özel seçim → TAM seçilen sıra', () => {
  for (const keys of [
    ['workout_5'],
    ['streak_7', 'first_workout'],
    ['streak_3', 'first_workout', 'streak_7'],
  ]) {
    const server = createServer();
    seedOwn(server);
    setMySelection(server, 'me', keys);

    assertDeepEqual(
      getMySelection(server, 'me').map((row) => row.achievement_key),
      keys,
      `seçim sırası korunmadı: ${keys.join(',')}`,
    );
    assertDeepEqual(
      getMySelection(server, 'me').map((row) => row.slot_position),
      keys.map((_, index) => index + 1),
      'slot numaraları 1..n değil',
    );
    assertDeepEqual(
      deriveProfileEntries(unlockedOf(server, 'me'), keys),
      keys,
      'profil vitrini seçim sırasını korumadı',
    );
  }
});

check('3. DÖRDÜNCÜ seçim reddedilir', () => {
  const server = createServer();
  seedOwn(server);
  setMySelection(server, 'me', ['first_workout']);

  assertThrows(
    () => setMySelection(server, 'me', ['first_workout', 'workout_5', 'streak_3', 'streak_7']),
    'dört rozetlik seçim kabul edildi',
  );
  // Önceki geçerli seçim KORUNUR.
  assertDeepEqual(
    getMySelection(server, 'me').map((row) => row.achievement_key),
    ['first_workout'],
    'başarısız yazma önceki seçimi bozdu',
  );
  assert(/slot_position between 1 and 3/.test(sqlCode), 'slot CHECK kısıtı yok');
  assert(/key_count > 3/.test(sqlCode), 'sunucu üçlü sınırı uygulamıyor');
});

check('4. YİNELENEN anahtar reddedilir', () => {
  const server = createServer();
  seedOwn(server);
  assertThrows(
    () => setMySelection(server, 'me', ['workout_5', 'workout_5']),
    'aynı rozet iki kez seçilebildi',
  );
  assertDeepEqual(getMySelection(server, 'me'), [], 'başarısız yazma satır bıraktı');
  assert(
    /create unique index[\s\S]{0,200}user_id, season_index, achievement_key/.test(sqlCode),
    'benzersiz rozet indeksi yok',
  );
  assert(/count\(distinct value\)/.test(sqlCode), 'sunucu benzersizliği doğrulamıyor');
});

check('5. BİLİNMEYEN veya KİLİTLİ rozet reddedilir', () => {
  const server = createServer();
  seedOwn(server);

  assertThrows(() => setMySelection(server, 'me', ['legendary']), 'bilinmeyen rozet kabul edildi');
  // `workout_15` bu kullanıcıda açık DEĞİL.
  assertThrows(() => setMySelection(server, 'me', ['workout_15']), 'kilitli rozet kabul edildi');
  assertDeepEqual(getMySelection(server, 'me'), [], 'reddedilen yazma satır bıraktı');

  assert(/unknown_showcase_achievement/.test(sqlCode), 'katalog doğrulaması yok');
  assert(/locked_showcase_achievement/.test(sqlCode), 'açılmış rozet doğrulaması yok');
});

check('6. BAŞKA SEZON rozeti reddedilir', () => {
  const server = createServer(5);
  addUnlocked(server, 'me', 'perfect_week', '2026-06-01T10:00:00Z', 4);
  assertThrows(
    () => setMySelection(server, 'me', ['perfect_week']),
    'başka sezonun rozeti seçilebildi',
  );
  assert(
    /a\.season_index = target_season/.test(sqlCode),
    'açılmış rozet kontrolü sezona kilitli değil',
  );
});

check('7. BAŞKA KULLANICI adına yazmak mümkün değildir', () => {
  const server = createServer();
  seedOwn(server, 'other');

  // Aktif kullanıcı `me`; `other`ın rozetleri kilitli sayılır.
  assertThrows(
    () => setMySelection(server, 'me', ['first_workout']),
    'başka kullanıcının rozeti seçilebildi',
  );
  assertDeepEqual(server.selections, [], 'başka kullanıcı adına satır yazıldı');

  // Yazma RPC'sinin imzasında kullanıcı/sezon parametresi YOK.
  const signature = sqlCode.match(
    /create or replace function public\.set_my_season_showcase_selection\(([^)]*)\)/,
  );
  assert(signature, 'yazma RPC imzası bulunamadı');
  assertEqual(signature[1].trim(), 'achievement_keys text[]', 'yazma RPC fazladan parametre alıyor');
  assert(sqlCode.includes('actor uuid := auth.uid()'), 'aktif kullanıcı auth.uid ile alınmıyor');
  assert(
    sqlCode.includes('public.rank_season_index_for(current_date)'),
    'sezon sunucu tarihinden belirlenmiyor',
  );
  const readSignature = sqlCode.match(
    /create or replace function public\.get_my_season_showcase_selection\(([^)]*)\)/,
  );
  assert(readSignature, 'okuma RPC imzası bulunamadı');
  assertEqual(readSignature[1].trim(), '', 'okuma RPC parametre alıyor');
});

check('8. BOŞ liste → otomatik moda dönüş', () => {
  const server = createServer();
  seedOwn(server);
  setMySelection(server, 'me', ['first_workout', 'workout_5']);
  assertEqual(getMySelection(server, 'me').length, 2, 'seçim yazılmadı');

  setMySelection(server, 'me', []);
  assertDeepEqual(getMySelection(server, 'me'), [], 'boş liste seçimi silmedi');
  assertDeepEqual(
    deriveProfileEntries(unlockedOf(server, 'me'), []),
    ['streak_7', 'streak_3', 'workout_5'],
    'otomatik moda dönülmedi',
  );
});

check('9. Aynı seçim tekrar gönderilince sonuç IDEMPOTENT', () => {
  const server = createServer();
  seedOwn(server);
  const keys = ['streak_3', 'first_workout'];

  const first = setMySelection(server, 'me', keys);
  for (let index = 0; index < 4; index += 1) setMySelection(server, 'me', keys);
  const last = setMySelection(server, 'me', keys);

  assertDeepEqual(last, first, 'tekrar gönderim sonucu değiştirdi');
  assertEqual(server.selections.length, 2, 'tekrar gönderim satır çoğalttı');
});

check('10. Yazma HATASI → önceki seçim korunur', () => {
  const server = createServer();
  seedOwn(server);
  setMySelection(server, 'me', ['workout_5', 'streak_3']);

  for (const bad of [
    ['workout_5', 'workout_5'],
    ['legendary'],
    ['workout_15'],
    ['first_workout', 'workout_5', 'streak_3', 'streak_7'],
  ]) {
    assertThrows(() => setMySelection(server, 'me', bad), `geçersiz seçim kabul edildi: ${bad}`);
  }

  assertDeepEqual(
    getMySelection(server, 'me').map((row) => row.achievement_key),
    ['workout_5', 'streak_3'],
    'başarısız yazma önceki seçimi bozdu',
  );
});

check('11. EŞZAMANLI yazma kısmi slot bırakmaz', () => {
  const server = createServer();
  seedOwn(server);

  // Advisory lock altında seri çalışır: son yazan kazanır, karışım OLMAZ.
  setMySelection(server, 'me', ['first_workout', 'workout_5']);
  setMySelection(server, 'me', ['streak_7']);

  const rows = getMySelection(server, 'me');
  assertDeepEqual(
    rows.map((row) => row.achievement_key),
    ['streak_7'],
    'eşzamanlı yazma karışık slot bıraktı',
  );
  assertDeepEqual(rows.map((row) => row.slot_position), [1], 'slot numaraları bozuldu');
  assert(
    /pg_advisory_xact_lock\(hashtextextended\(actor::text, 8024\)\)/.test(sqlCode),
    'kullanıcı başına advisory lock yok',
  );
  // Lock anahtarı mevcut sistemlerle ÇAKIŞMAZ.
  assert(!/8021|8022|8023/.test(sqlCode), 'advisory lock anahtarı mevcut sistemlerle çakışıyor');
});

check('12. YENİ SEZON → eski sezon seçimi kullanılmaz, veri silinmez', () => {
  const server = createServer(5);
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7', 'first_workout']);

  // Sezon ilerledi.
  server.currentSeasonIndex = 6;
  addUnlocked(server, 'me', 'first_workout', '2026-10-05T10:00:00Z', 6);

  assertDeepEqual(getMySelection(server, 'me'), [], 'eski sezon seçimi yeni sezona taşındı');
  assertEqual(
    server.selections.filter((row) => row.season_index === 5).length,
    2,
    'eski sezon satırları silindi',
  );

  // Yeni sezonun kendi seçimi normal çalışır ve 5. sezonu bozmaz.
  setMySelection(server, 'me', ['first_workout']);
  assertEqual(
    server.selections.filter((row) => row.season_index === 5).length,
    2,
    'yeni sezon yazması eski sezonu sildi',
  );
  assert(
    /delete from public\.season_achievement_showcase_selections[\s\S]{0,160}s\.season_index = target_season/.test(
      sqlCode,
    ),
    'silme güncel sezona kilitli değil',
  );
});

// ---------------------------------------------------------------------------
// 2 · Arkadaş profili
// ---------------------------------------------------------------------------

check('13. Arkadaş ÖZEL seçimi SLOT sırasıyla görür', () => {
  const server = createServer();
  seedOwn(server, 'friend');
  addFriendship(server, 'me', 'friend', 'accepted');
  // En yeni sırası: streak_7, streak_3, workout_5 — seçim bilinçle FARKLI.
  setMySelection(server, 'friend', ['first_workout', 'streak_7', 'workout_5']);

  assertDeepEqual(
    getFriendShowcase(server, 'me', 'friend').map((row) => row.achievement_key),
    ['first_workout', 'streak_7', 'workout_5'],
    'arkadaş seçimi slot sırasıyla dönmedi',
  );
  // İstemci bu sırayı YENİDEN SIRALAMAZ.
  assert(componentSource.includes('preserveOrder'), 'bileşende sıra koruma modu yok');
  assert(
    /<ProfileAchievementShowcase[\s\S]{0,300}preserveOrder/.test(friendProfileSource),
    'arkadaş profili sunucu sırasını koruyacak biçimde kullanmıyor',
  );
});

check('14. Özel seçim YOKSA arkadaş FALLBACK sırasını görür', () => {
  const server = createServer();
  seedOwn(server, 'friend');
  addFriendship(server, 'me', 'friend', 'accepted');

  assertDeepEqual(
    getFriendShowcase(server, 'me', 'friend').map((row) => row.achievement_key),
    ['streak_7', 'streak_3', 'workout_5'],
    'fallback sırası bozuldu',
  );
  assertEqual(getFriendShowcase(server, 'me', 'friend').length, LIMIT, 'üçlü sınır uygulanmadı');
  assert(/where not exists \(select 1 from selected\)/.test(sqlCode), 'fallback dalı koşullu değil');
});

check('15. Arkadaş OLMAYAN kişi hiçbir satır göremez', () => {
  const server = createServer();
  seedOwn(server, 'friend');
  setMySelection(server, 'friend', ['first_workout']);

  assertDeepEqual(getFriendShowcase(server, 'me', 'friend'), [], 'yabancı kullanıcı veri gördü');
  assertDeepEqual(getFriendShowcase(server, null, 'friend'), [], 'oturumsuz çağrı veri döndürdü');
});

check('16. BEKLEYEN arkadaşlık veri açmaz', () => {
  for (const [requester, receiver] of [
    ['me', 'friend'],
    ['friend', 'me'],
  ]) {
    const server = createServer();
    seedOwn(server, 'friend');
    setMySelection(server, 'friend', ['first_workout']);
    addFriendship(server, requester, receiver, 'pending');
    assertDeepEqual(
      getFriendShowcase(server, 'me', 'friend'),
      [],
      `bekleyen istek veri açtı: ${requester}→${receiver}`,
    );
  }
  assert(
    sqlCode.includes('public.are_friends(v.id, target_user_id)'),
    'arkadaşlık kapısı are_friends ile kurulmamış',
  );
});

check('17. Tabloya doğrudan istemci yazma/OKUMA yetkisi YOKTUR', () => {
  assert(
    sqlCode.includes('alter table public.season_achievement_showcase_selections enable row level security'),
    'RLS açılmamış',
  );
  for (const role of ['anon', 'authenticated']) {
    assert(
      sqlCode.includes(
        `revoke all on table public.season_achievement_showcase_selections from ${role}`,
      ),
      `${role} tablo yetkisi kaldırılmamış`,
    );
  }
  // Tabloya HİÇBİR grant verilmez: okuma da yazma da RPC'den geçer.
  assert(
    !/grant\s+\w+[\s\S]{0,60}on table public\.season_achievement_showcase_selections/i.test(sqlCode),
    'tabloya doğrudan grant verilmiş',
  );
  for (const verb of ['insert', 'update', 'delete']) {
    assert(
      !new RegExp(`on public\\.season_achievement_showcase_selections for ${verb}`).test(sqlCode),
      `istemci ${verb} policy'si var`,
    );
  }
  // RPC güvenlik duruşu.
  for (const fn of [
    'get_my_season_showcase_selection()',
    'set_my_season_showcase_selection(text[])',
    'get_friend_season_achievement_showcase(uuid)',
  ]) {
    assert(
      sqlCode.includes(`revoke all on function public.${fn} from public`),
      `public execute kaldırılmamış: ${fn}`,
    );
    assert(
      sqlCode.includes(`revoke all on function public.${fn} from anon`),
      `anon execute kaldırılmamış: ${fn}`,
    );
    assert(
      sqlCode.includes(`grant execute on function public.${fn} to authenticated`),
      `authenticated execute grant’i yok: ${fn}`,
    );
  }
  assertEqual(
    (sqlCode.match(/security definer/g) ?? []).length,
    3,
    'üç RPC de security definer değil',
  );
  assertEqual(
    (sqlCode.match(/set search_path = ''/g) ?? []).length,
    3,
    "üç RPC de search_path = '' kullanmıyor",
  );
  // Uygulanmış migration dosyaları DEĞİŞMEMİŞ olmalı.
  for (const path of [ACHIEVEMENTS_SQL_PATH, FRIEND_SQL_PATH]) {
    const changed = execFileSync('git', ['status', '--porcelain', path], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assertEqual(changed.trim(), '', `uygulanmış migration değiştirilmiş: ${path}`);
  }
});

check('18. Arkadaş profili SEÇİM arayüzü açamaz', () => {
  // Arkadaş vitrinine `onPress` verilmez → salt okunur.
  assert(
    !/<ProfileAchievementShowcase[\s\S]{0,300}onPress/.test(friendProfileSource),
    'arkadaş vitrini dokunulabilir',
  );
  assert(!friendProfileSource.includes('rank-showcase'), 'arkadaş profili seçim ekranına gidiyor');
  assert(
    !friendProfileSource.includes('saveShowcaseSelection'),
    'arkadaş profili seçim kaydedebiliyor',
  );
  // Seçim ekranı YALNIZCA kendi profilinden açılır.
  assert(
    ownProfileSource.includes("router.push('/rank-showcase')"),
    'kendi profili seçim ekranını açmıyor',
  );
  /**
   * Ekran yalnızca KENDİ verisini kullanır.
   *
   * `userId` değişkeninin varlığı tek başına sorun değildir — ekran taslak
   * seed anahtarı için KENDİ auth kimliğini okur. Kalıcı güvence, HEDEF bir
   * kullanıcının adreslenmemesidir: route parametresi, arkadaş RPC'si veya
   * `target_user_id` yoktur.
   */
  for (const leak of [
    'useLocalSearchParams',
    'target_user_id',
    'targetUserId',
    'fetchFriendAchievementShowcase',
    'get_friend_season_achievement_showcase',
  ]) {
    assert(!screenCode.includes(leak), `seçim ekranı başka kullanıcıyı hedefliyor: ${leak}`);
  }
  assert(screenCode.includes('useAuth()'), 'seçim ekranı kendi kimliğini auth’tan almıyor');
  assert(!screenCode.includes('supabase'), 'seçim ekranı doğrudan Supabase kullanıyor');
});

check('19. Hesap A’nın GEÇ isteği hesap B state’ine yazamaz', () => {
  const server = createServer();
  seedOwn(server, 'user-a');
  seedOwn(server, 'user-b');
  setMySelection(server, 'user-a', ['streak_7']);

  const context = createContext(server);
  context.signIn('user-a');
  const ownerOfA = context.owner;

  // B giriş yaptı; A'nın uçuştaki cevabı ancak şimdi döndü.
  context.signIn('user-b');
  void context.load(ownerOfA);
  assertDeepEqual(context.selection, [], 'A’nın okuması B’nin state’ine yazdı');

  // Geç gelen KAYDETME de yazamaz.
  const ownerOfB = context.owner;
  context.signIn('user-a');
  void context.save(['first_workout'], ownerOfB);
  assertDeepEqual(context.selection, [], 'B’nin geç kaydı A’nın state’ine yazdı');

  // Kaynakta sahiplik ve tek-uçuş korumaları var.
  const loadBody = contextSource.slice(
    contextSource.indexOf('const loadShowcaseSelection = useCallback('),
    contextSource.indexOf('const saveShowcaseSelection = useCallback('),
  );
  assert(loadBody.length > 0, 'loadShowcaseSelection bulunamadı');
  assert(loadBody.includes('const owner = ownerRef.current;'), 'sahiplik yakalanmıyor');
  assertEqual(
    (loadBody.match(/owner !== ownerRef\.current/g) ?? []).length,
    2,
    'başarı ve hata yollarının ikisinde de sahiplik kontrolü olmalı',
  );
  assert(loadBody.includes('isShowcaseSelectionFetchingRef'), 'tek uçuş kilidi yok');
  assert(loadBody.includes('hasQueuedShowcaseSelectionRef'), 'latest-wins kuyruğu yok');
  const saveBody = contextSource.slice(
    contextSource.indexOf('const saveShowcaseSelection = useCallback('),
    contextSource.indexOf('const loadAchievements = useCallback('),
  );
  assert(saveBody.includes('owner !== ownerRef.current'), 'kaydetmede sahiplik kontrolü yok');
  // Hesap değişiminde seçim temizlenir.
  assert(
    contextSource.includes('setShowcaseSelectionResult(undefined);'),
    'çıkışta seçim temizlenmiyor',
  );
  assert(
    contextSource.includes('loadedShowcaseSelectionRef.current = undefined;'),
    'yükleme sahipliği sıfırlanmıyor',
  );
});

check('20. Seçim RP, XP, level veya GÜL üretmez', () => {
  const server = createServer();
  seedOwn(server);
  setMySelection(server, 'me', ['first_workout', 'workout_5']);
  setMySelection(server, 'me', []);
  assertEqual(server.economyWrites, 0, 'model ekonomiye yazdı');

  // SQL yalnızca kendi tablosuna yazar.
  const writes = [...sqlCode.matchAll(/\b(insert into|update|delete from)\s+([a-z_.]+)/gi)];
  for (const write of writes) {
    assertEqual(
      write[2],
      'public.season_achievement_showcase_selections',
      `beklenmeyen yazma hedefi: ${write[0]}`,
    );
  }
  for (const table of [
    'reward_ledger',
    'user_progress',
    'rank_events',
    'user_season_ranks',
    'workout_sessions',
    'workout_sets',
  ]) {
    assert(!sqlCode.includes(table), `yasak tabloya erişim: ${table}`);
  }
});

check('21. Mevcut kutlama/baseline davranışları DEĞİŞMEZ', () => {
  // Seçim yolu kutlama kuyruğuna, baseline'a veya onaya dokunmaz.
  const loadBody = contextSource.slice(
    contextSource.indexOf('const loadShowcaseSelection = useCallback('),
    contextSource.indexOf('const loadAchievements = useCallback('),
  );
  for (const forbidden of [
    'setAchievementQueue',
    'celebratedAchievementsRef',
    'acknowledgeAchievementCelebrationShown',
    'claimRankOverlay',
  ]) {
    assert(!loadBody.includes(forbidden), `seçim yolu kutlama mantığına dokunuyor: ${forbidden}`);
  }
  // Seçim ekranı da kutlamaya dokunmaz.
  for (const forbidden of ['achievementCelebration', 'claimRankOverlay', 'dismissAchievement']) {
    assert(!screenCode.includes(forbidden), `seçim ekranı kutlamaya dokunuyor: ${forbidden}`);
  }
  /**
   * Kutlama katmanının DEĞİŞMEZLERİ.
   *
   * Burada eskiden `git status` ile dosyanın hiç değişmediği aranıyordu. Bu,
   * vitrin-seçimi fazına ait bir "bu dosyaya dokunma" dondurmasıydı ve o faz
   * kapandı; sonraki fazların katmanı meşru biçimde düzenlemesi (ör. Rosea
   * tepki tipinin ayrıştırılması) testi haksız yere düşürüyordu.
   *
   * Yerine, vitrin fazının GERÇEKTEN önemsediği sözleşme doğrulanır: kutlama
   * başına tek onay, tek Rosea tepkisi, ve overlay claim/release ikilisinin
   * korunması. Bu, dosya dondurmasından daha anlamlıdır — meşru düzenlemeye
   * izin verir, gerçek regresyonu yakalar.
   */
  const celebrationSource = readFileSync(
    join(ROOT, 'components/ranks/achievement-unlock-celebration.tsx'),
    'utf8',
  );
  assertEqual(
    (celebrationSource.match(/acknowledgeAchievementCelebrationShown\(/g) ?? []).length,
    1,
    'kutlama onayı birden fazla yerden çağrılıyor',
  );
  assertEqual(
    (celebrationSource.match(/triggerReaction\('/g) ?? []).length,
    1,
    'kutlama başına birden fazla Rosea tepkisi tetikleniyor',
  );
  assert(
    /const OVERLAY_OWNER[^\n]*=\s*'achievement'/.test(celebrationSource),
    'kutlama katmanının overlay sahibi `achievement` değil',
  );
  assert(
    celebrationSource.includes('claimRankOverlay(OVERLAY_OWNER)'),
    'kutlama katmanı overlay sahipliğini almıyor',
  );
  assert(
    celebrationSource.includes('releaseRankOverlay(OVERLAY_OWNER)'),
    'kutlama katmanı overlay sahipliğini bırakmıyor',
  );
  assert(
    celebrationSource.includes('layoutAcknowledgedRef.current === current'),
    'tekrarlanan layout koruması kaldırılmış',
  );
});

check('22. TR/EN bütün yeni anahtarlar EŞLEŞİR', () => {
  const keys = [
    'editTitle',
    'editLead',
    'save',
    'useAutomatic',
    'saveFailed',
    'loadFailed',
    'retry',
    'toggleHint',
    'selectedA11y',
    'unselectedA11y',
  ];
  for (const key of keys) {
    assert(localeTr.includes(`${key}:`), `tr sözlüğünde ${key} yok`);
    assert(localeEn.includes(`${key}:`), `en sözlüğünde ${key} yok`);
  }
  assert(localeTr.includes("editTitle: 'Rozet vitrini'"), 'TR ekran başlığı beklenen değil');
  assert(localeEn.includes("editTitle: 'Badge showcase'"), 'EN ekran başlığı beklenen değil');
  // Ekranda sabit kullanıcı metni yok.
  assert(
    !/<Text[^>]*>\s*[A-ZĞÜŞİÖÇ][a-zğüşıöç]/.test(screenSource),
    'seçim ekranında çeviriden geçmeyen sabit metin var',
  );
  // Rota kayıtlı; yeni sekme YOK.
  assert(layoutSource.includes('name="rank-showcase"'), 'ekran kök Stack’e eklenmemiş');
  assert(
    !source('app/(tabs)/_layout.tsx').includes('rank-showcase'),
    'alt sekme çubuğuna sekme eklenmiş',
  );
  // Tasarım sınırları: yeni paket/görsel/gradient yok, 44 pt hedef var.
  assert(
    screenSource.includes("from '@/components/ranks/achievement-icons'"),
    'ortak ikon kaynağı kullanılmıyor',
  );
  assert(!/gradient|require\(|emoji/i.test(screenCode), 'gradient/görsel/emoji eklenmiş');
  assert(screenCode.includes('minHeight: Layout.minTouchSize'), '44 pt dokunma hedefi yok');
  assert(screenCode.includes('MotionPressable'), 'mevcut motion bileşeni kullanılmıyor');
  // Loading / hata / kaydetme durumları.
  assert(screenCode.includes('ActivityIndicator'), 'yükleniyor göstergesi yok');
  assert(screenCode.includes('setHasSaveError(true)'), 'kaydetme hatası durumu yok');
  assert(screenCode.includes('disabled={isSaving}'), 'kaydederken disabled durumu yok');
  assert(screenCode.includes('accessibilityState'), 'erişilebilirlik durumu yok');
});

// ---------------------------------------------------------------------------
// 3 · YAŞAM DÖNGÜSÜ — taslak hazırlığı ve sezon sahipliği
// ---------------------------------------------------------------------------

/**
 * `get_my_season_showcase_selection` / `set_my_season_showcase_selection`
 * DÖNÜŞ SÖZLEŞMESİNİN referansı.
 *
 * Her başarılı çağrı sunucunun sezonunu taşır; otomatik modda TEK satır
 * (`is_custom = false`, anahtar/slot `null`) döner. Sıfır satır YALNIZCA
 * oturum yokken oluşur.
 */
function rpcSelectionRows(server, actor) {
  if (!actor) return [];
  const rows = getMySelection(server, actor);
  if (rows.length === 0) {
    return [
      {
        achievement_key: null,
        is_custom: false,
        season_index: server.currentSeasonIndex,
        slot_position: null,
      },
    ];
  }
  return rows.map((row) => ({
    achievement_key: row.achievement_key,
    is_custom: true,
    season_index: row.season_index,
    slot_position: row.slot_position,
  }));
}

/** `services/ranks.ts` içindeki `parseShowcaseSelection` referansı. */
function parseSelectionResponse(rows) {
  const list = rows ?? [];
  if (list.length === 0) return undefined;

  const seasonRow = list.find(
    (row) => typeof row.season_index === 'number' && Number.isFinite(row.season_index),
  );
  if (!seasonRow) return undefined;

  const parsed = [];
  for (const row of list) {
    const key = rx.parseSeasonAchievementKey(row.achievement_key);
    if (!key || parsed.some((entry) => entry.key === key)) continue;
    parsed.push({ key, slot: row.slot_position ?? Number.MAX_SAFE_INTEGER });
  }
  const keys = parsed.sort((left, right) => left.slot - right.slot).map((entry) => entry.key);

  return {
    isCustom: keys.length > 0 && list.some((row) => row.is_custom === true),
    keys,
    seasonIndex: seasonRow.season_index,
  };
}

/**
 * EKRANIN GÖVDE KARARI — `app/rank-showcase.tsx` içindeki dal sıralamasının
 * referansı.
 *
 * `isLoading` içinde `!isShowcaseSelectionReady` de vardır; seçim isteği hata
 * verdiğinde bu bayrak KALICI OLARAK `true` kalır. Bu yüzden HATA dalı
 * YÜKLENİYOR dalından ÖNCE ve kazanılmış rozet sayısından BAĞIMSIZ olarak
 * değerlendirilir. `loadingFirst` seçeneği DÜZELTME ÖNCESİ sıralamayı
 * (mutasyon) modeller.
 */
function resolveBodyState(state, options = {}) {
  const { hasLoadError, isAchievementsLoading, isSelectionPending, unlockedCount } = state;
  /** Düzeltme öncesi TEK birleşik bayrak (`isLoading`). */
  const legacyLoadingBranch = (isSelectionPending || isAchievementsLoading) && unlockedCount === 0;

  if (options.loadingFirst === true) {
    // Düzeltme öncesi: loading önce ve hata `unlockedCount === 0`e bağlı.
    if (legacyLoadingBranch) return 'loading';
    if (hasLoadError && unlockedCount === 0) return 'error';
    return unlockedCount === 0 ? 'empty' : 'grid';
  }

  if (hasLoadError) return 'error';

  /**
   * `combinedLoading` → DÜZELTME ÖNCESİ yükleniyor koşulu: önceden yüklü
   * rozetler (`unlockedCount > 0`) seçim HÂLÂ pending'ken ızgarayı açardı.
   */
  const isLoadingBranch =
    options.combinedLoading === true
      ? legacyLoadingBranch
      : isSelectionPending || (isAchievementsLoading && unlockedCount === 0);
  if (isLoadingBranch) return 'loading';
  return unlockedCount === 0 ? 'empty' : 'grid';
}

/**
 * Context + seçim ekranının yaşam döngüsü modeli.
 *
 * Gerçek akışı taklit eder: istek başlatılır, cevap AYRI bir adımda gelir ve
 * bu arada hesap/sezon değişebilir. Taslak seed'i `isReady` ve
 * `${userId}:${seasonIndex}` anahtarına bağlıdır.
 */
function createLifecycle(server, options = {}) {
  const enforceSeasonGuard = options.enforceSeasonGuard !== false;
  /**
   * `true` → DÜZELTME ÖNCESİ seed davranışı: ömürlük bir boolean, ilk effect
   * turunda (cevap gelmemişken) taslağı mühürler.
   */
  const useBooleanSeed = options.useBooleanSeed === true;
  /**
   * `false` → DÜZELTME ÖNCESİ save davranışı: sezon uyuşmazlığı çağırana
   * BİLDİRİLMEZ, state yazılmasa bile ekran bunu başarı sanar.
   */
  const reportSeasonMismatch = options.reportSeasonMismatch !== false;
  /** `true` → DÜZELTME ÖNCESİ render sıralaması (loading, hatadan önce). */
  const loadingFirst = options.loadingFirst === true;
  /** `true` → DÜZELTME ÖNCESİ yükleniyor koşulu (birleşik `isLoading`). */
  const combinedLoading = options.combinedLoading === true;
  let seededOnce = false;

  let owner = 0;
  let userId;
  /** İstemcinin ŞU ANKİ sezonu (`seasonRef.current?.seasonIndex`). */
  let clientSeason;
  let result;
  let hasError = false;
  let draft = [];
  let seededKey;
  /** `loadedShowcaseSelectionRef` — `${userId}:${seasonIndex}` damgası. */
  let loadedKey;
  /** Sezon uyuşmazlığından sonra tetiklenen yeniden yükleme sayısı. */
  let reloadRequests = 0;

  /** Başarılar (ekranın `achievements.filter(isUnlocked)` karşılığı). */
  let unlocked = [];
  let achievementsLoading = false;
  let achievementsError = false;
  let selectionLoading = false;

  /** Ekranın kaydetme durumu. */
  let saving = false;
  let saveError = false;
  let didGoBack = false;

  /**
   * Sezon sahipliği KAPALIYKEN (mutation) hazır/seçim kararı sezona hiç
   * bakmaz — düzeltme öncesi durum buydu: state yalnızca anahtar dizisiydi.
   */
  const isReady = () =>
    result !== undefined &&
    (!enforceSeasonGuard || (clientSeason !== undefined && result.seasonIndex === clientSeason));
  const selectionKeys = () => (isReady() && result.isCustom ? result.keys : []);

  /** Ekranın türetilmiş bayrakları — kaynaktaki ifadelerin birebir karşılığı. */
  const hasLoadErrorNow = () => achievementsError || hasError;
  /** Seçim cevabı henüz elde değil: istek uçuşta VEYA güncel cevap yok. */
  const isSelectionPendingNow = () => selectionLoading || !isReady();
  const canSaveNow = () => isReady() && !hasLoadErrorNow() && !saving;

  /**
   * `saveShowcaseSelection` SONUÇ SÖZLEŞMESİ.
   *
   * Yalnızca cevap güncel kullanıcıya VE güncel sezona aitse, üstelik state'e
   * gerçekten uygulandıysa `applied` döner. Diğer bütün durumlar
   * BAŞARISIZLIKTIR.
   */
  function applySaveResponse(parsed, capturedOwner, capturedUser) {
    if (!capturedUser) return { status: 'unavailable' };
    // Hesap arada değiştiyse eski cevap YENİ hesabın state'ine yazamaz.
    if (capturedOwner !== owner) return { status: 'account-changed' };
    if (!parsed) return { status: 'unavailable' };

    if (parsed.seasonIndex !== clientSeason) {
      /**
       * Eski sezon cevabı: state'e YAZILMAZ ve `loadedKey` YALNIZCA
       * temizlenir — eski sezon kimliğiyle DAMGALANMAZ. Yeni sezonun seçimi
       * baştan yüklenir.
       */
      loadedKey = undefined;
      reloadRequests += 1;
      if (!reportSeasonMismatch) {
        // MUTASYON: başarısızlık bildirilmez → ekran kapanır.
        return { keys: [], seasonIndex: parsed.seasonIndex, status: 'applied' };
      }
      return { status: 'season-changed' };
    }

    result = parsed;
    hasError = false;
    loadedKey = `${capturedUser}:${parsed.seasonIndex}`;
    return {
      keys: parsed.isCustom ? parsed.keys : [],
      seasonIndex: parsed.seasonIndex,
      status: 'applied',
    };
  }

  /** Ekranın sonucu yorumlaması: yalnızca `applied` geri dönüşe izin verir. */
  function applyScreenSaveOutcome(outcome) {
    saving = false;
    if (outcome.status !== 'applied') {
      // Taslak KORUNUR; kullanıcı mevcut kaydetme hatası davranışını görür.
      saveError = true;
      return;
    }
    didGoBack = true;
  }

  /** Ekranın seed effect'i — her "render" sonrası çalışır. */
  function runSeedEffect() {
    if (useBooleanSeed) {
      // Ömürlük boolean: cevap gelmemiş olsa bile ilk turda mühürler.
      if (seededOnce) return;
      seededOnce = true;
      draft = [...selectionKeys()];
      return;
    }

    if (!isReady()) return;
    if (!userId || result?.seasonIndex === undefined) return;
    const key = `${userId}:${result.seasonIndex}`;
    if (seededKey === key) return;
    seededKey = key;
    draft = [...selectionKeys()];
  }

  return {
    /** İstek başlat: cevabın ait olacağı sahiplik ve sezon dondurulur. */
    beginLoad() {
      const capturedOwner = owner;
      const capturedUser = userId;
      selectionLoading = true;
      hasError = false;
      /**
       * Uçuştaki istek, İSTEK ANINDAKİ sunucu durumunu taşır. Cevap geldiğinde
       * sezon değişmiş olabilir — hatanın tam senaryosu budur.
       */
      const capturedRows = rpcSelectionRows(server, capturedUser);
      return {
        /** Cevap geldi. */
        resolve() {
          const parsed = parseSelectionResponse(capturedRows);
          if (capturedOwner !== owner) return;
          selectionLoading = false;
          if (!parsed) return;
          // SEZON SAHİPLİĞİ: cevabın sezonu şu ankiyle eşleşmeli.
          if (enforceSeasonGuard && parsed.seasonIndex !== clientSeason) return;
          result = parsed;
          hasError = false;
          loadedKey = `${capturedUser}:${parsed.seasonIndex}`;
          runSeedEffect();
        },
        /** İstek hata verdi. */
        reject() {
          if (capturedOwner !== owner) return;
          selectionLoading = false;
          hasError = true;
          runSeedEffect();
        },
      };
    },
    /** Başarıların yüklenmesi — hata YALNIZCA bu bölümü etkiler. */
    beginAchievementsLoad() {
      const capturedOwner = owner;
      const capturedUser = userId;
      achievementsLoading = true;
      achievementsError = false;
      return {
        resolve() {
          const rows = unlockedOf(server, capturedUser);
          if (capturedOwner !== owner) return;
          achievementsLoading = false;
          achievementsError = false;
          unlocked = rows.map((entry) => entry.key);
        },
        reject() {
          if (capturedOwner !== owner) return;
          achievementsLoading = false;
          achievementsError = true;
        },
      };
    },
    /**
     * KAYDETME.
     *
     * Yazma İSTEK ANINDA sunucuda gerçekleşir; cevap AYRI bir adımda döner ve
     * bu arada sezon/hesap değişebilir — hatanın tam senaryosu budur.
     */
    beginSave(keys) {
      const capturedOwner = owner;
      const capturedUser = userId;
      saving = true;
      saveError = false;

      let capturedRows;
      let rejected = false;
      try {
        setMySelection(server, capturedUser, keys);
        capturedRows = rpcSelectionRows(server, capturedUser);
      } catch {
        rejected = true;
      }

      return {
        resolve() {
          if (rejected) {
            // Ağ/sunucu hatası: ekranın `catch` dalı (`rejected` model içidir).
            saving = false;
            saveError = true;
            return { status: 'rejected' };
          }
          const outcome = applySaveResponse(
            parseSelectionResponse(capturedRows),
            capturedOwner,
            capturedUser,
          );
          applyScreenSaveOutcome(outcome);
          return outcome;
        },
      };
    },
    get bodyState() {
      return resolveBodyState(
        {
          hasLoadError: hasLoadErrorNow(),
          isAchievementsLoading: achievementsLoading,
          isSelectionPending: isSelectionPendingNow(),
          unlockedCount: unlocked.length,
        },
        { combinedLoading, loadingFirst },
      );
    },
    get didGoBack() {
      return didGoBack;
    },
    get hasLoadError() {
      return hasLoadErrorNow();
    },
    get hasSaveError() {
      return saveError;
    },
    get isSelectionPending() {
      return isSelectionPendingNow();
    },
    get loadedKey() {
      return loadedKey;
    },
    get reloadRequests() {
      return reloadRequests;
    },
    /** Hata ekranındaki "Tekrar dene": HER İKİ yüklemeyi de başlatır. */
    retry() {
      return { achievements: this.beginAchievementsLoad(), selection: this.beginLoad() };
    },
    get unlockedCount() {
      return unlocked.length;
    },
    get canSave() {
      return canSaveNow();
    },
    get draft() {
      return [...draft];
    },
    get hasError() {
      return hasError;
    },
    get isReady() {
      return isReady();
    },
    /**
     * KART DOKUNUŞU — gerçek kullanıcı yolu.
     *
     * Kartlar YALNIZCA ızgara render edilirken vardır. Seçim cevabı gelmeden
     * ızgara açılırsa kullanıcı taslağı değiştirebilir ve gelen cevabın seed'i
     * onun üzerine yazar; bu model o yolu gerçekten kapalı tutar.
     * `false` = ekranda dokunulacak kart YOK.
     */
    tapCard(key) {
      if (this.bodyState !== 'grid') return false;
      draft = draft.includes(key) ? draft.filter((entry) => entry !== key) : [...draft, key];
      return true;
    },
    /** Taslağın doğrudan değiştirilmesi (ızgara durumu test edilmediğinde). */
    pick(key) {
      draft = draft.includes(key) ? draft.filter((entry) => entry !== key) : [...draft, key];
    },
    /** İlk render / her render sonrası effect turu. */
    render() {
      runSeedEffect();
    },
    get selection() {
      return selectionKeys();
    },
    setSeason(nextSeason) {
      clientSeason = nextSeason;
      server.currentSeasonIndex = nextSeason;
      runSeedEffect();
    },
    signIn(nextUserId, seasonIndex) {
      owner += 1;
      userId = nextUserId;
      clientSeason = seasonIndex;
      result = undefined;
      hasError = false;
      draft = [];
      seededKey = undefined;
      seededOnce = false;
      loadedKey = undefined;
      reloadRequests = 0;
      unlocked = [];
      achievementsLoading = false;
      achievementsError = false;
      selectionLoading = false;
      saving = false;
      saveError = false;
      didGoBack = false;
    },
  };
}

check('L1. İLK RENDER: istek başlamadı → taslak SEED EDİLMEZ', () => {
  const server = createServer();
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7', 'workout_5']);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  // Cevap gelmeden effect turu çalışır (gerçek ilk render).
  app.render();
  app.render();

  assertEqual(app.isReady, false, 'cevap gelmeden hazır sayıldı');
  assertDeepEqual(app.draft, [], 'cevap gelmeden taslak seed edildi');
  assertEqual(app.canSave, false, 'hazır olmadan kaydet aktif');
});

check('L2. ÖZEL SEÇİM cevabı → taslak DOĞRU SIRAYLA seed edilir', () => {
  const server = createServer();
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7', 'first_workout', 'workout_5']);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.render();
  app.beginLoad().resolve();

  assertEqual(app.isReady, true, 'başarılı cevap hazır saymadı');
  assertDeepEqual(
    app.draft,
    ['streak_7', 'first_workout', 'workout_5'],
    'taslak seçim sırasıyla seed edilmedi',
  );
  assertEqual(app.canSave, true, 'hazır olmasına rağmen kaydet kapalı');
});

check('L3. OTOMATİK MOD cevabı → hazır olur, boş taslak BİLİNÇLİ seed edilir', () => {
  const server = createServer();
  seedOwn(server);
  // Özel seçim YOK.

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.render();
  const rows = rpcSelectionRows(server, 'me');

  // Otomatik mod cevabı SIFIR satır DEĞİL: sezon kimliği taşıyan tek satır.
  assertEqual(rows.length, 1, 'otomatik mod cevabı tek satır olmalı');
  assertEqual(rows[0].is_custom, false, 'otomatik mod `is_custom = false` olmalı');
  assertEqual(rows[0].season_index, 5, 'otomatik mod cevabı sezon taşımıyor');
  assertEqual(rows[0].achievement_key, null, 'otomatik modda anahtar dolu geldi');

  app.beginLoad().resolve();
  assertEqual(app.isReady, true, 'otomatik mod cevabı hazır saymadı');
  assertDeepEqual(app.selection, [], 'otomatik modda özel seçim üretildi');
  assertDeepEqual(app.draft, [], 'otomatik modda taslak boş seed edilmeliydi');
  assertEqual(app.canSave, true, 'otomatik modda kaydet kapalı');
});

check('L4. YÜKLEME HATASI → taslak kaydedilebilir duruma GELMEZ', () => {
  const server = createServer();
  seedOwn(server);
  setMySelection(server, 'me', ['workout_5']);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.render();
  app.beginLoad().reject();

  assertEqual(app.hasError, true, 'hata kaydedilmedi');
  assertEqual(app.isReady, false, 'hata sonrası hazır sayıldı');
  assertEqual(app.canSave, false, 'hata sonrası kaydet aktif');
  assertDeepEqual(app.draft, [], 'hata sonrası taslak seed edildi');
});

check('L5. RETRY başarılı → taslak DOĞRU seçimle seed edilir', () => {
  const server = createServer();
  seedOwn(server);
  setMySelection(server, 'me', ['first_workout', 'streak_3']);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginLoad().reject();
  assertEqual(app.canSave, false, 'hata sonrası kaydet aktif');

  app.beginLoad().resolve();
  assertEqual(app.isReady, true, 'retry sonrası hazır olmadı');
  assertDeepEqual(app.draft, ['first_workout', 'streak_3'], 'retry taslağı yanlış seed etti');
});

check('L6. ESKİ SEZON cevabı YENİ sezon state’ine yazamaz', () => {
  const server = createServer(5);
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7']);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  // 5. sezon isteği uçuşa çıktı.
  const staleRequest = app.beginLoad();

  // Sezon ilerledi; yeni sezonda henüz rozet yok.
  app.setSeason(6);
  // Eski sezon cevabı ANCAK ŞİMDİ döndü.
  staleRequest.resolve();

  assertEqual(app.isReady, false, 'eski sezon cevabı yeni sezonu hazır saydı');
  assertDeepEqual(app.selection, [], 'eski sezon seçimi yeni sezonda kullanıldı');
  assertDeepEqual(app.draft, [], 'eski sezon cevabı taslağı seed etti');
});

check('L7. Eski sezon seçimi YENİ sezon başarılarına uygulanamaz', () => {
  const server = createServer(5);
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7', 'workout_5']);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginLoad().resolve();
  assertDeepEqual(app.selection, ['streak_7', 'workout_5'], '5. sezon seçimi yüklenmedi');

  // Sezon ilerledi: yeni sezon cevabı GELMEDEN seçim kullanılamaz.
  app.setSeason(6);
  assertEqual(app.isReady, false, 'sezon değişince hazır durumu sıfırlanmadı');
  assertDeepEqual(app.selection, [], 'eski sezon seçimi yeni sezonda render edildi');

  /**
   * Eski sezonun rozetleriyle bile eski SEÇİM uygulanmaz: seçim boş olduğu
   * için türetme otomatik fallback'e düşer, özel sıra sızmaz.
   */
  const previousSeasonUnlocked = [
    { key: 'first_workout', unlockedAt: '2026-08-20T10:00:00Z' },
    { key: 'workout_5', unlockedAt: '2026-08-22T10:00:00Z' },
    { key: 'streak_3', unlockedAt: '2026-08-24T10:00:00Z' },
    { key: 'streak_7', unlockedAt: '2026-08-26T10:00:00Z' },
  ];
  assertDeepEqual(
    deriveProfileEntries(previousSeasonUnlocked, app.selection),
    ['streak_7', 'streak_3', 'workout_5'],
    'eski seçim yeni sezon türetmesine sızdı',
  );
  assert(
    ownProfileSource.includes('!isShowcaseSelectionReady'),
    'profil hazır değilken yükleniyor durumuna geçmiyor',
  );
});

check('L8. YENİ SEZON otomatik cevabı eski özel seçimi TEMİZLER', () => {
  const server = createServer(5);
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7']);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginLoad().resolve();
  assertDeepEqual(app.selection, ['streak_7'], '5. sezon seçimi yüklenmedi');

  // 6. sezon: seçim satırı yok → otomatik mod cevabı.
  app.setSeason(6);
  addUnlocked(server, 'me', 'first_workout', '2026-10-05T10:00:00Z', 6);
  app.beginLoad().resolve();

  assertEqual(app.isReady, true, 'yeni sezon cevabı hazır saymadı');
  assertDeepEqual(app.selection, [], 'yeni sezonda eski özel seçim kaldı');
  assertDeepEqual(app.draft, [], 'yeni sezon taslağı eski seçimle seed edildi');
  // 5. sezon satırları KORUNUR.
  assertEqual(
    server.selections.filter((row) => row.season_index === 5).length,
    1,
    'eski sezon satırı silindi',
  );
});

check('L9. SAVE uçuşundayken sezon değişirse eski cevap yazamaz', () => {
  const server = createServer(5);
  seedOwn(server);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginLoad().resolve();

  // Kaydetme uçuşa çıktı.
  const saveRequest = app.beginSave(['workout_5']);
  // Bu arada sezon değişti.
  app.setSeason(6);
  saveRequest.resolve();

  assertEqual(app.isReady, false, 'eski sezon save cevabı yeni sezonu hazır saydı');
  assertDeepEqual(app.selection, [], 'eski sezon save cevabı yeni sezona yazdı');
  // Kaynakta yeniden yükleme tetikleniyor.
  const saveBody = contextSource.slice(
    contextSource.indexOf('const saveShowcaseSelection = useCallback('),
    contextSource.indexOf('const loadAchievements = useCallback('),
  );
  assert(
    saveBody.includes('next.seasonIndex !== seasonRef.current?.seasonIndex'),
    'save cevabı sezon kimliğiyle doğrulanmıyor',
  );
  assert(
    saveBody.includes('void loadShowcaseSelection();'),
    'sezon değişince yeni sezon seçimi yeniden yüklenmiyor',
  );
});

check('L10. HESAP değişimi korumaları geçmeye devam eder', () => {
  const server = createServer(5);
  seedOwn(server, 'user-a');
  seedOwn(server, 'user-b');
  setMySelection(server, 'user-a', ['streak_7']);

  const app = createLifecycle(server);
  app.signIn('user-a', 5);
  const staleRequest = app.beginLoad();

  app.signIn('user-b', 5);
  staleRequest.resolve();

  assertEqual(app.isReady, false, 'A’nın cevabı B’yi hazır saydı');
  assertDeepEqual(app.selection, [], 'A’nın seçimi B’de göründü');
  assertDeepEqual(app.draft, [], 'A’nın cevabı B’nin taslağını seed etti');

  // B kendi cevabını normal alır.
  app.beginLoad().resolve();
  assertEqual(app.isReady, true, 'B kendi cevabıyla hazır olmadı');
  assertDeepEqual(app.selection, [], 'B otomatik modda olmalıydı');
});

check('L11. Kullanıcı seçim yaptıktan sonra ARKA PLAN cevabı taslağı EZMEZ', () => {
  const server = createServer(5);
  seedOwn(server);
  setMySelection(server, 'me', ['first_workout']);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginLoad().resolve();
  assertDeepEqual(app.draft, ['first_workout'], 'ilk seed yanlış');

  // Kullanıcı seçim değiştirdi; sonra arka planda bir cevap daha geldi.
  app.pick('streak_7');
  app.beginLoad().resolve();

  assertDeepEqual(app.draft, ['first_workout', 'streak_7'], 'arka plan cevabı taslağı ezdi');
});

check('L12. Migration otomatik mod sonucu SEZON kimliğini gerçekten taşır', () => {
  // Okuma RPC'si: `left join ... on true` boş seçimde tek satır üretir.
  const readBody = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.get_my_season_showcase_selection'),
    sqlCode.indexOf('revoke all on function public.get_my_season_showcase_selection'),
  );
  assert(readBody.length > 0, 'okuma RPC gövdesi bulunamadı');
  assert(/is_custom boolean/.test(readBody), 'okuma RPC `is_custom` döndürmüyor');
  assert(/season_index integer/.test(readBody), 'okuma RPC sezon döndürmüyor');
  assert(/left join selected as sel on true/.test(readBody), 'otomatik mod satırı üretilmiyor');
  assert(
    /\(sel\.achievement_key is not null\) as is_custom/.test(readBody),
    '`is_custom` seçim varlığından türetilmiyor',
  );
  // Oturum yoksa hiç satır dönmez.
  assert(
    /where \(select auth\.uid\(\)\) is not null/.test(readBody),
    'oturumsuz çağrı için sıfır satır garantisi yok',
  );

  // Yazma RPC'si aynı sözleşmeyi taşır.
  const writeBody = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.set_my_season_showcase_selection'),
    sqlCode.indexOf('revoke all on function public.set_my_season_showcase_selection'),
  );
  assert(/is_custom boolean/.test(writeBody), 'yazma RPC `is_custom` döndürmüyor');
  assert(/left join selected as sel on true/.test(writeBody), 'yazma RPC otomatik satır üretmiyor');
  assert(/select\s+target_season,/.test(writeBody), 'yazma RPC sezon kimliği döndürmüyor');

  // İstemci hâlâ kullanıcı/sezon GÖNDERMİYOR.
  assert(
    serviceSource.includes("supabase.rpc('get_my_season_showcase_selection')"),
    'okuma çağrısı parametresiz değil',
  );
  const saveCall = serviceSource.slice(
    serviceSource.indexOf("supabase.rpc('set_my_season_showcase_selection'"),
  );
  const saveArgs = saveCall.slice(0, saveCall.indexOf('});') + 2);
  assert(saveArgs.includes('achievement_keys:'), 'yazma çağrısı anahtar dizisi göndermiyor');
  // Fonksiyon ADI "season" içerdiği için yalnızca argümanlar taranır.
  const saveArgumentsOnly = saveArgs.slice(saveArgs.indexOf(','));
  assert(!saveArgumentsOnly.includes('season'), 'istemci sezon gönderiyor');
  assert(!saveArgumentsOnly.includes('user_id'), 'istemci kullanıcı kimliği gönderiyor');

  // Servis sezon kimliğini taşıyor ve sezonsuz yanıtı kullanılamaz sayıyor.
  assert(
    serviceSource.includes('if (seasonIndex === undefined) return undefined;'),
    'servis sezonsuz yanıtı kullanılamaz saymıyor',
  );
});

check('L13. Arkadaş vitrini SLOT sırasını korur (regresyon)', () => {
  const server = createServer();
  seedOwn(server, 'friend');
  addFriendship(server, 'me', 'friend', 'accepted');
  setMySelection(server, 'friend', ['workout_5', 'streak_7', 'first_workout']);

  assertDeepEqual(
    getFriendShowcase(server, 'me', 'friend').map((row) => row.achievement_key),
    ['workout_5', 'streak_7', 'first_workout'],
    'arkadaş slot sırası bozuldu',
  );
  // Arkadaş RPC'sinin dönüş imzası DEĞİŞMEDİ.
  const friendBody = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.get_friend_season_achievement_showcase'),
    sqlCode.indexOf('revoke all on function public.get_friend_season_achievement_showcase'),
  );
  assert(!friendBody.includes('is_custom'), 'arkadaş RPC imzası gereksiz yere değişmiş');
  assert(friendBody.includes('public.are_friends(v.id, target_user_id)'), 'arkadaşlık kapısı yok');
  assert(
    /<ProfileAchievementShowcase[\s\S]{0,400}preserveOrder/.test(friendProfileSource),
    'arkadaş profili sunucu sırasını koruyacak biçimde kullanmıyor',
  );
});

// ---------------------------------------------------------------------------
// 5 · Hata/yükleme render sırası ve kaydetme sonucu sözleşmesi
// ---------------------------------------------------------------------------

check('R1. SEÇİM HATASI + kazanılmış rozet VAR → hata ve tekrar dene görünür', () => {
  const server = createServer(5);
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7']);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  // Rozetler geldi, seçim isteği düştü.
  app.beginAchievementsLoad().resolve();
  app.beginLoad().reject();

  assert(app.unlockedCount > 0, 'senaryo kurulumu: kazanılmış rozet olmalı');
  assertEqual(app.hasLoadError, true, 'yükleme hatası kaydedilmedi');
  assertEqual(
    app.bodyState,
    'error',
    'rozetler yüklüyken seçim hatası gizlendi — tekrar dene ulaşılamaz',
  );
});

check('R2. SEÇİM HATASI + kazanılmış rozet YOK → sonsuz spinner OLMAZ', () => {
  const server = createServer(5);
  // Hiç rozet kazanılmadı.

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginAchievementsLoad().resolve();
  app.beginLoad().reject();

  assertEqual(app.unlockedCount, 0, 'senaryo kurulumu: rozet olmamalı');
  /**
   * `isSelectionPending` içindeki `!isReady` hata sonrası KALICI olarak `true`
   * kalır; bu yüzden gövde kararı hataya bakmak ZORUNDADIR.
   */
  assertEqual(
    app.isSelectionPending,
    true,
    'senaryo kurulumu: seçim pending kalıcı olarak true olmalı',
  );
  assertEqual(app.bodyState, 'error', 'hata yerine sonsuz spinner gösterildi');
});

check('R3. HATA sırasında Kaydet AKTİF OLMAZ ve eylemler görünmez', () => {
  const server = createServer(5);
  seedOwn(server);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginAchievementsLoad().resolve();
  app.beginLoad().reject();

  assertEqual(app.canSave, false, 'hata sırasında kaydet aktif');
  assertEqual(app.isReady, false, 'hata sırasında hazır sayıldı');
  // Eylem çubuğu YALNIZCA ızgara render edilirken görünür.
  assert(app.bodyState !== 'grid', 'hata sırasında kaydetme eylemleri görünür kaldı');
  assertDeepEqual(app.draft, [], 'hata sırasında taslak seed edildi');
});

check('R4. Başarılı RETRY → kayıtlı seçim DOĞRU SIRAYLA seed edilir', () => {
  const server = createServer(5);
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7', 'first_workout', 'workout_5']);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  const firstAchievements = app.beginAchievementsLoad();
  firstAchievements.reject();
  app.beginLoad().reject();
  assertEqual(app.bodyState, 'error', 'hata ekranına ulaşılamadı');
  assertEqual(app.canSave, false, 'hata sırasında kaydet aktif');

  // "Tekrar dene" HER İKİ yüklemeyi de başlatır.
  const retry = app.retry();
  retry.achievements.resolve();
  retry.selection.resolve();

  assertEqual(app.hasLoadError, false, 'retry sonrası hata temizlenmedi');
  assertEqual(app.isReady, true, 'retry sonrası hazır olmadı');
  assertEqual(app.bodyState, 'grid', 'retry sonrası ızgara render edilmedi');
  assertDeepEqual(
    app.draft,
    ['streak_7', 'first_workout', 'workout_5'],
    'retry sonrası taslak kayıtlı sırayla seed edilmedi',
  );
  assertEqual(app.canSave, true, 'retry sonrası kaydet kapalı kaldı');
});

check('R5. OTOMATİK MOD sentinel cevabı ekranı HAZIR hâle getirir', () => {
  const server = createServer(5);
  seedOwn(server);
  // Özel seçim YOK → sentinel satır.

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginAchievementsLoad().resolve();

  const rows = rpcSelectionRows(server, 'me');
  assertEqual(rows.length, 1, 'otomatik mod cevabı tek sentinel satır olmalı');
  assertEqual(rows[0].achievement_key, null, 'sentinel satır anahtar taşımamalı');

  app.beginLoad().resolve();

  assertEqual(app.isReady, true, 'sentinel cevap hazır saymadı');
  assertEqual(app.hasLoadError, false, 'sentinel cevap hata sayıldı');
  assertEqual(app.bodyState, 'grid', 'sentinel cevaptan sonra ızgara render edilmedi');
  assertEqual(app.canSave, true, 'sentinel cevaptan sonra kaydet kapalı');
  assertDeepEqual(app.draft, [], 'otomatik modda taslak boş seed edilmeliydi');
});

check('R6. SAVE sırasında sezon değişirse ekranın GERİ DÖNMESİNE izin verilmez', () => {
  const server = createServer(5);
  seedOwn(server);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginAchievementsLoad().resolve();
  app.beginLoad().resolve();

  const saveRequest = app.beginSave(['streak_7', 'workout_5']);
  // Yazma sunucuda 5. sezona yapıldı; cevap dönmeden sezon ilerledi.
  app.setSeason(6);
  const outcome = saveRequest.resolve();

  assertEqual(outcome.status, 'season-changed', 'sezon uyuşmazlığı başarısızlık bildirmedi');
  assertEqual(app.didGoBack, false, 'sezon değişmesine rağmen ekran kapandı');
  assertEqual(app.hasSaveError, true, 'kullanıcıya kaydetme hatası gösterilmedi');
});

check('R7. SAVE sırasında sezon değişirse TASLAK KORUNUR', () => {
  const server = createServer(5);
  seedOwn(server);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginAchievementsLoad().resolve();
  app.beginLoad().resolve();
  app.pick('streak_7');
  app.pick('workout_5');

  const saveRequest = app.beginSave(['streak_7', 'workout_5']);
  app.setSeason(6);
  saveRequest.resolve();

  assertDeepEqual(
    app.draft,
    ['streak_7', 'workout_5'],
    'başarısız kaydetmede kullanıcının taslağı kayboldu',
  );
});

check('R8. ESKİ SEZON save cevabı YENİ sezon state’ine YAZILMAZ', () => {
  const server = createServer(5);
  seedOwn(server);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginAchievementsLoad().resolve();
  app.beginLoad().resolve();
  assertEqual(app.loadedKey, 'me:5', '5. sezon okuması damgalanmadı');

  const saveRequest = app.beginSave(['streak_7']);
  app.setSeason(6);
  saveRequest.resolve();

  assertEqual(app.isReady, false, 'eski sezon save cevabı yeni sezonu hazır saydı');
  assertDeepEqual(app.selection, [], 'eski sezon save cevabı yeni sezona yazdı');
  // Damga YANLIŞ sezonla bırakılmaz; yalnızca temizlenir.
  assertEqual(app.loadedKey, undefined, 'loaded-ref eski sezon kimliğiyle damgalandı');
});

check('R9. Sezon uyuşmazlığından sonra YENİ sezon seçimi yeniden yüklenir', () => {
  const server = createServer(5);
  seedOwn(server);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginAchievementsLoad().resolve();
  app.beginLoad().resolve();

  const saveRequest = app.beginSave(['streak_7']);
  app.setSeason(6);
  saveRequest.resolve();

  assertEqual(app.reloadRequests, 1, 'yeni sezon seçimi yeniden yüklenmedi');

  // Yeniden yükleme tamamlanınca ekran 6. sezon için normal çalışır.
  app.beginAchievementsLoad().resolve();
  app.beginLoad().resolve();
  assertEqual(app.isReady, true, '6. sezon cevabından sonra hazır olunmadı');
  assertEqual(app.loadedKey, 'me:6', 'yeni sezon damgası yazılmadı');
  assertDeepEqual(app.selection, [], '6. sezon eski sezonun seçimini kullandı');

  // Kaynak: sezon uyuşmazlığında gerçekten yeniden yükleme tetikleniyor.
  const saveBody = contextSource.slice(
    contextSource.indexOf('const saveShowcaseSelection = useCallback('),
    contextSource.indexOf('const loadAchievements = useCallback('),
  );
  assert(
    saveBody.includes('loadedShowcaseSelectionRef.current = undefined;') &&
      saveBody.includes('void loadShowcaseSelection();'),
    'sezon uyuşmazlığında yeniden yükleme tetiklenmiyor',
  );
});

check('R10. NORMAL güncel sezon save → başarı ve ekranın kapanmasına izin verilir', () => {
  const server = createServer(5);
  seedOwn(server);

  const app = createLifecycle(server);
  app.signIn('me', 5);
  app.beginAchievementsLoad().resolve();
  app.beginLoad().resolve();
  app.pick('streak_7');
  app.pick('first_workout');

  const outcome = app.beginSave(['streak_7', 'first_workout']).resolve();

  assertEqual(outcome.status, 'applied', 'normal kaydetme başarılı sayılmadı');
  assertEqual(outcome.seasonIndex, 5, 'sonuç uygulandığı sezonu taşımıyor');
  assertDeepEqual(outcome.keys, ['streak_7', 'first_workout'], 'sonuç uygulanan sırayı taşımıyor');
  assertEqual(app.didGoBack, true, 'başarılı kaydetmede ekran kapanmadı');
  assertEqual(app.hasSaveError, false, 'başarılı kaydetmede hata gösterildi');
  assertDeepEqual(app.selection, ['streak_7', 'first_workout'], 'seçim state’e yazılmadı');
  assertEqual(app.loadedKey, 'me:5', 'başarılı kaydetme damgası yazılmadı');
});

check('R11. HESAP değişiminde eski hesabın SAVE cevabı yeni hesaba yazılmaz', () => {
  const server = createServer(5);
  seedOwn(server, 'user-a');
  seedOwn(server, 'user-b');

  const app = createLifecycle(server);
  app.signIn('user-a', 5);
  app.beginAchievementsLoad().resolve();
  app.beginLoad().resolve();

  const saveRequest = app.beginSave(['streak_7']);
  // Cevap dönmeden hesap değişti.
  app.signIn('user-b', 5);
  const outcome = saveRequest.resolve();

  assertEqual(outcome.status, 'account-changed', 'hesap değişimi başarısızlık bildirmedi');
  assertEqual(app.didGoBack, false, 'A’nın cevabı B’nin ekranını kapattı');
  assertDeepEqual(app.selection, [], 'A’nın save cevabı B’nin state’ine yazıldı');
  assertEqual(app.isReady, false, 'A’nın cevabı B’yi hazır saydı');
  assertEqual(app.loadedKey, undefined, 'A’nın cevabı B’nin damgasını yazdı');
});

check('R12. Kaynak: hata dalı loading’den ÖNCE, eylemler ızgaraya bağlı', () => {
  const bodyIndex = screenCode.indexOf('const bodyState');
  assert(bodyIndex > 0, 'gövde durumu tek bir karar noktasında hesaplanmıyor');

  const decision = screenCode.slice(bodyIndex, screenCode.indexOf('function renderBody'));
  const errorAt = decision.indexOf('hasLoadError');
  const loadingAt = decision.indexOf('isSelectionPending');
  assert(errorAt >= 0 && loadingAt >= 0, 'gövde kararı hata/loading bayraklarını kullanmıyor');
  assert(errorAt < loadingAt, 'loading dalı hata dalından önce değerlendiriliyor');

  // Seçim pending'ken ızgara AÇILAMAZ: koşul rozet sayısına bağlanmamış.
  assert(
    screenCode.includes(
      'const isSelectionPending = isShowcaseSelectionLoading || !isShowcaseSelectionReady;',
    ),
    'seçim pending bayrağı tek bir yerde türetilmiyor',
  );
  assert(
    /isSelectionPending \|\| \(isAchievementsLoading && unlocked\.length === 0\)/.test(decision),
    'yükleniyor dalı seçim pending durumunu koşulsuz kapsamıyor',
  );
  assert(
    !/[^t]isLoading && unlocked\.length === 0/.test(screenCode),
    'gövde kararı hâlâ birleşik `isLoading` koşuluna bağlı',
  );

  // Hata dalı kazanılmış rozet sayısına BAĞLI DEĞİL.
  assert(
    !/hasLoadError\s*&&\s*unlocked\.length === 0/.test(screenCode),
    'hata dalı hâlâ `unlocked.length === 0` koşuluna bağlı',
  );

  const renderBody = screenCode.slice(screenCode.indexOf('function renderBody'));
  assert(
    renderBody.indexOf("bodyState === 'error'") < renderBody.indexOf("bodyState === 'loading'"),
    'render sırasında hata dalı loading dalından sonra geliyor',
  );
  // Kaydet / otomatik moda dön YALNIZCA ızgara render edilirken görünür.
  assert(
    screenCode.includes("{bodyState === 'grid' && ("),
    'kaydetme eylemleri gövde durumuna bağlanmamış',
  );
  assert(screenCode.includes('!hasLoadError'), 'kaydetme hata durumunda açıkça kapatılmıyor');
  // Retry her iki yüklemeyi de başlatır.
  const retryBody = screenCode.slice(
    screenCode.indexOf('const retry = useCallback('),
    screenCode.indexOf('const toggle = useCallback('),
  );
  assert(
    retryBody.includes('loadAchievements()') && retryBody.includes('loadShowcaseSelection()'),
    'tekrar dene her iki yüklemeyi de başlatmıyor',
  );
});

check('R13. Kaynak: save sonucu TYPE-SAFE biçimde raporlanıyor', () => {
  const saveBody = contextSource.slice(
    contextSource.indexOf('const saveShowcaseSelection = useCallback('),
    contextSource.indexOf('const loadAchievements = useCallback('),
  );
  for (const status of ["'season-changed'", "'account-changed'", "'unavailable'", "'applied'"]) {
    assert(saveBody.includes(status), `save sonucu ${status} durumunu bildirmiyor`);
  }
  assert(
    contextSource.includes('SeasonShowcaseSelectionSaveResult'),
    'save sonucu kontrollü bir tiple taşınmıyor',
  );
  assert(
    source('types/ranks.ts').includes('export type SeasonShowcaseSelectionSaveResult'),
    'save sonuç tipi tanımlı değil',
  );

  // Ekran YALNIZCA `applied` sonucunda geri döner.
  const screenSave = screenCode.slice(
    screenCode.indexOf('const save = useCallback('),
    screenCode.indexOf('function renderBody'),
  );
  assert(
    screenSave.indexOf("outcome.status !== 'applied'") < screenSave.indexOf('router.back()'),
    'ekran sonucu doğrulamadan geri dönüyor',
  );
  assert(screenSave.includes('setHasSaveError(true)'), 'başarısız sonuçta hata gösterilmiyor');

  // Kullanılmayan tip importu kaldırıldı.
  const serviceImports = serviceSource.slice(
    serviceSource.indexOf("} from '@/constants/rank-experience';"),
    serviceSource.indexOf("} from '@/types/ranks';"),
  );
  assert(
    !/\bSeasonShowcaseSelection,/.test(serviceImports),
    'services/ranks.ts kullanılmayan tipi hâlâ import ediyor',
  );
});

check('R14. Rozetler ÖNCEDEN yüklüyken seçim PENDING → ızgara render EDİLMEZ', () => {
  const server = createServer(5);
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7', 'first_workout']);

  const app = createLifecycle(server);
  app.signIn('me', 5);

  // 1) Başarılar zaten yüklü: context'te kazanılmış rozetler VAR.
  app.beginAchievementsLoad().resolve();
  assert(app.unlockedCount > 0, 'kurulum: kazanılmış rozet olmalı');

  // 2) Vitrin seçimi isteği HÂLÂ uçuşta.
  const pending = app.beginLoad();
  assertEqual(app.isSelectionPending, true, 'kurulum: seçim pending olmalı');
  assertEqual(app.hasLoadError, false, 'kurulum: yükleme hatası olmamalı');

  // 3 + 4) Gövde yükleniyor; ızgara ve eylem çubuğu render EDİLMEZ.
  assertEqual(app.bodyState, 'loading', 'seçim gelmeden ızgara render edildi');
  assertEqual(app.canSave, false, 'seçim gelmeden kaydet aktif');

  // 5) Kullanıcı taslağı DEĞİŞTİREMEZ: dokunulacak kart yok.
  assertEqual(app.tapCard('workout_5'), false, 'seçim gelmeden karta dokunulabildi');
  assertDeepEqual(app.draft, [], 'seçim gelmeden taslak değişti');

  // 6) Cevap gelince kayıtlı sıra seed edilir ve ızgara açılır.
  pending.resolve();
  assertEqual(app.bodyState, 'grid', 'cevaptan sonra ızgara render edilmedi');
  assertEqual(app.canSave, true, 'cevaptan sonra kaydet kapalı kaldı');
  assertDeepEqual(
    app.draft,
    ['streak_7', 'first_workout'],
    'kayıtlı seçim doğru sırayla seed edilmedi',
  );

  // Artık dokunuş gerçek: taslak kullanıcıya ait.
  assertEqual(app.tapCard('workout_5'), true, 'hazır olduktan sonra karta dokunulamadı');
  assertDeepEqual(
    app.draft,
    ['streak_7', 'first_workout', 'workout_5'],
    'kart dokunuşu taslağa uygulanmadı',
  );

  /**
   * Seed YALNIZCA BİR KEZ: aynı (kullanıcı, sezon) için gelen ARKA PLAN
   * cevabı kullanıcının taslağını ezmez. Bu tur boyunca gövde yükleniyor
   * durumuna düşer — ızgara ve kartlar yine erişilemez.
   */
  const background = app.beginLoad();
  assertEqual(app.bodyState, 'loading', 'arka plan yenilemesinde ızgara açık kaldı');
  assertEqual(app.tapCard('streak_3'), false, 'arka plan yenilemesinde karta dokunulabildi');
  background.resolve();
  assertDeepEqual(
    app.draft,
    ['streak_7', 'first_workout', 'workout_5'],
    'arka plan cevabı kullanıcının taslağını ezdi',
  );

  // Başarılar YALNIZCA arka planda tazeleniyorsa ızgara KORUNUR.
  const refresh = app.beginAchievementsLoad();
  assertEqual(app.bodyState, 'grid', 'arka plan başarı tazelemesi ızgarayı düşürdü');
  refresh.resolve();
  assertEqual(app.bodyState, 'grid', 'tazeleme sonrası ızgara kaybedildi');
});

// ---------------------------------------------------------------------------
// MUTATION TESTLERİ
// ---------------------------------------------------------------------------

check('M5. HAZIR OLMADAN taslak seed edilirse test DÜŞER', () => {
  const server = createServer();
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7', 'workout_5']);

  /** Kasıtlı hata: ömürlük boolean ref ile seed (düzeltme öncesi). */
  const broken = createLifecycle(server, { useBooleanSeed: true });
  broken.signIn('me', 5);
  broken.render();
  // Kullanıcının gerçek seçimi VAR ama taslak boş mühürlendi.
  assertDeepEqual(broken.draft, [], 'bozuk model gerçekten boş seed etmeli');
  broken.beginLoad().resolve();
  assertDeepEqual(broken.draft, [], 'bozuk model gerçekten seçimi kaçırmalı');
  assertThrows(
    () => assertDeepEqual(broken.draft, ['streak_7', 'workout_5'], 'mutation'),
    'hazır beklemeyen model testten geçti — kayıp seçim yakalanmıyor',
  );

  // Doğru model: cevap gelene kadar seed etmez, sonra doğru seed eder.
  const fixed = createLifecycle(server);
  fixed.signIn('me', 5);
  fixed.render();
  assertDeepEqual(fixed.draft, [], 'doğru model erken seed etti');
  fixed.beginLoad().resolve();
  assertDeepEqual(fixed.draft, ['streak_7', 'workout_5'], 'doğru model seçimi seed etmedi');
});

check('M6. SEZON eşleşme guard’ı kaldırılırsa test DÜŞER', () => {
  const server = createServer(5);
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7']);

  /** Kasıtlı hata: cevabın sezonu kontrol edilmiyor (düzeltme öncesi). */
  const broken = createLifecycle(server, { enforceSeasonGuard: false });
  broken.signIn('me', 5);
  const staleRequest = broken.beginLoad();
  broken.setSeason(6);
  staleRequest.resolve();

  // Guard'sız model 5. sezon cevabını 6. sezona YAZDI.
  assertEqual(broken.isReady, true, 'guard’sız model gerçekten hazır saymalı');
  assertDeepEqual(broken.selection, ['streak_7'], 'guard’sız model eski seçimi sızdırmalı');
  assertDeepEqual(broken.draft, ['streak_7'], 'guard’sız model eski seçimi seed etmeli');
  assertThrows(
    () => assertDeepEqual(broken.selection, [], 'mutation'),
    'sezon guard’ı olmadan da geçti — eski sezon sızıntısı yakalanmıyor',
  );

  /**
   * Doğru model: eski sezon cevabı hiçbir şey yazmaz.
   *
   * TEMİZ bir sunucu kullanılır: yukarıdaki bozuk senaryo `setSeason(6)` ile
   * paylaşılan sunucunun sezonunu ilerletti ve aynı nesne yeniden kullanılsa
   * istek zaten 6. sezon cevabı üretirdi.
   */
  const cleanServer = createServer(5);
  seedOwn(cleanServer);
  setMySelection(cleanServer, 'me', ['streak_7']);
  const fixed = createLifecycle(cleanServer);
  fixed.signIn('me', 5);
  const stale = fixed.beginLoad();
  fixed.setSeason(6);
  stale.resolve();
  assertDeepEqual(fixed.draft, [], 'doğru model eski sezon cevabıyla seed etti');
  assertEqual(fixed.isReady, false, 'doğru model eski sezon cevabını hazır saydı');
});

check('M7. LOADING dalı HATA dalından önce çalıştırılırsa test DÜŞER', () => {
  // Hata var, kazanılmış rozet yok: `isLoading` kalıcı olarak `true`.
  const state = {
    hasLoadError: true,
    isAchievementsLoading: false,
    isSelectionPending: true,
    unlockedCount: 0,
  };

  const broken = resolveBodyState(state, { loadingFirst: true });
  assertEqual(broken, 'loading', 'bozuk sıralama gerçekten spinner göstermeli');
  assertThrows(
    () => assertEqual(broken, 'error', 'mutation'),
    'loading önce çalışsa da geçti — sonsuz spinner yakalanmıyor',
  );

  // Rozetler yüklüyken de bozuk sıralama hatayı GİZLER.
  const withBadges = {
    hasLoadError: true,
    isAchievementsLoading: false,
    isSelectionPending: true,
    unlockedCount: 4,
  };
  assertEqual(
    resolveBodyState(withBadges, { loadingFirst: true }),
    'grid',
    'bozuk sıralama gerçekten hatayı gizlemeli',
  );
  assertThrows(
    () => assertEqual(resolveBodyState(withBadges, { loadingFirst: true }), 'error', 'mutation'),
    'hata gizlense de geçti — ulaşılamayan tekrar dene yakalanmıyor',
  );

  // Doğru sıralama her iki durumda da hatayı gösterir.
  assertEqual(resolveBodyState(state), 'error', 'doğru sıralama spinner’da kaldı');
  assertEqual(resolveBodyState(withBadges), 'error', 'doğru sıralama hatayı gizledi');

  // Uçtan uca: bozuk sıralamalı ekran gerçekten sonsuz spinner’da kalır.
  const server = createServer(5);
  const brokenApp = createLifecycle(server, { loadingFirst: true });
  brokenApp.signIn('me', 5);
  brokenApp.beginAchievementsLoad().resolve();
  brokenApp.beginLoad().reject();
  assertEqual(brokenApp.bodyState, 'loading', 'bozuk ekran gerçekten spinner’da kalmalı');

  const fixedApp = createLifecycle(server);
  fixedApp.signIn('me', 5);
  fixedApp.beginAchievementsLoad().resolve();
  fixedApp.beginLoad().reject();
  assertEqual(fixedApp.bodyState, 'error', 'doğru ekran hata göstermedi');
});

check('M8. SEZON uyuşmazlığı BAŞARI sayılırsa test DÜŞER', () => {
  const server = createServer(5);
  seedOwn(server);

  /** Kasıtlı hata: sezon uyuşmazlığı çağırana bildirilmiyor. */
  const broken = createLifecycle(server, { reportSeasonMismatch: false });
  broken.signIn('me', 5);
  broken.beginAchievementsLoad().resolve();
  broken.beginLoad().resolve();
  broken.pick('streak_7');
  const brokenSave = broken.beginSave(['streak_7']);
  broken.setSeason(6);
  const brokenOutcome = brokenSave.resolve();

  assertEqual(brokenOutcome.status, 'applied', 'bozuk model gerçekten başarı bildirmeli');
  assertEqual(broken.didGoBack, true, 'bozuk model gerçekten ekranı kapatmalı');
  // Seçim GÜNCEL sezona uygulanmadığı hâlde kullanıcı kaydı başarılı sandı.
  assertDeepEqual(broken.selection, [], 'bozuk modelde seçim zaten uygulanmamış olmalı');
  assertThrows(
    () => assertEqual(broken.didGoBack, false, 'mutation'),
    'sezon uyuşmazlığı başarı sayılsa da geçti — sahte başarı yakalanmıyor',
  );

  // Doğru model: başarısızlık bildirilir, ekran açık kalır, taslak korunur.
  const cleanServer = createServer(5);
  seedOwn(cleanServer);
  const fixed = createLifecycle(cleanServer);
  fixed.signIn('me', 5);
  fixed.beginAchievementsLoad().resolve();
  fixed.beginLoad().resolve();
  fixed.pick('streak_7');
  const fixedSave = fixed.beginSave(['streak_7']);
  fixed.setSeason(6);
  const fixedOutcome = fixedSave.resolve();

  assertEqual(fixedOutcome.status, 'season-changed', 'doğru model başarısızlık bildirmedi');
  assertEqual(fixed.didGoBack, false, 'doğru model ekranı kapattı');
  assertEqual(fixed.hasSaveError, true, 'doğru model kaydetme hatasını göstermedi');
  assertDeepEqual(fixed.draft, ['streak_7'], 'doğru model taslağı kaybetti');
  assertEqual(fixed.reloadRequests, 1, 'doğru model yeniden yükleme tetiklemedi');
});

check('M9. Yükleniyor koşulu ESKİ birleşik hâline döndürülürse test DÜŞER', () => {
  /** Seçim pending, ama kazanılmış rozetler ÖNCEDEN yüklü. */
  const state = {
    hasLoadError: false,
    isAchievementsLoading: false,
    isSelectionPending: true,
    unlockedCount: 4,
  };

  const broken = resolveBodyState(state, { combinedLoading: true });
  assertEqual(broken, 'grid', 'bozuk koşul gerçekten ızgarayı render etmeli');
  assertThrows(
    () => assertEqual(broken, 'loading', 'mutation'),
    'seçim pending’ken ızgara render edilse de geçti — taslak yarışı yakalanmıyor',
  );
  assertEqual(resolveBodyState(state), 'loading', 'doğru koşul ızgarayı gösterdi');

  // Uçtan uca: bozuk ekranda kullanıcı dokunur, gelen cevap taslağını EZER.
  const server = createServer(5);
  seedOwn(server);
  setMySelection(server, 'me', ['streak_7', 'first_workout']);

  const brokenApp = createLifecycle(server, { combinedLoading: true });
  brokenApp.signIn('me', 5);
  brokenApp.beginAchievementsLoad().resolve();
  const brokenPending = brokenApp.beginLoad();

  assertEqual(brokenApp.bodyState, 'grid', 'bozuk model gerçekten ızgara göstermeli');
  assertEqual(brokenApp.tapCard('workout_5'), true, 'bozuk modelde karta dokunulabilmeli');
  assertDeepEqual(brokenApp.draft, ['workout_5'], 'bozuk modelde taslak gerçekten değişmeli');

  brokenPending.resolve();
  assertDeepEqual(
    brokenApp.draft,
    ['streak_7', 'first_workout'],
    'bozuk modelde seed gerçekten kullanıcının taslağını ezmeli',
  );
  assertThrows(
    () => assertDeepEqual(brokenApp.draft, ['workout_5'], 'mutation'),
    'kullanıcının taslağı ezilse de geçti — seed yarışı yakalanmıyor',
  );

  // Doğru model: dokunuş hiç mümkün olmaz, seed temiz gelir.
  const cleanServer = createServer(5);
  seedOwn(cleanServer);
  setMySelection(cleanServer, 'me', ['streak_7', 'first_workout']);
  const fixed = createLifecycle(cleanServer);
  fixed.signIn('me', 5);
  fixed.beginAchievementsLoad().resolve();
  const pending = fixed.beginLoad();
  assertEqual(fixed.bodyState, 'loading', 'doğru model ızgarayı erken açtı');
  assertEqual(fixed.tapCard('workout_5'), false, 'doğru modelde karta dokunulabildi');
  pending.resolve();
  assertDeepEqual(
    fixed.draft,
    ['streak_7', 'first_workout'],
    'doğru model kayıtlı sırayı seed etmedi',
  );
});

check('M1. Arkadaşlık kontrolü kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  seedOwn(server, 'friend');
  setMySelection(server, 'friend', ['first_workout']);
  // Arkadaşlık YOK.

  const broken = getFriendShowcase(server, 'me', 'friend', { requireFriendship: false });
  assertEqual(broken.length, 1, 'guard’sız model gerçekten veri döndürmeli');
  assertThrows(
    () => assertDeepEqual(broken, [], 'mutation'),
    'arkadaşlık guard’ı olmadan da geçti — sızıntı yakalanmıyor',
  );
  assertDeepEqual(getFriendShowcase(server, 'me', 'friend'), [], 'doğru model sızdırıyor');
});

check('M2. Açılmış rozet doğrulaması kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  seedOwn(server);

  /**
   * `workout_15` açık DEĞİL. Doğrulamasız model satırı DEFTERE YAZAR — okuma
   * yolundaki join onu gizlese bile yazma gerçekleşmiştir. Bu yüzden mutation
   * saklanan satırlar üzerinden ölçülür.
   */
  setMySelection(server, 'me', ['workout_15'], { requireUnlocked: false });
  assertEqual(server.selections.length, 1, 'doğrulamasız model gerçekten kilitli rozeti yazmalı');
  assertThrows(
    () => assertEqual(server.selections.length, 0, 'mutation'),
    'açılmış rozet doğrulaması olmadan da geçti — kilitli rozet yakalanmıyor',
  );

  // Doğru model reddeder.
  const clean = createServer();
  seedOwn(clean);
  assertThrows(() => setMySelection(clean, 'me', ['workout_15']), 'doğru model kilitliyi kabul etti');
  assertEqual(clean.selections.length, 0, 'doğru model kilitli rozeti deftere yazdı');
});

check('M3. Üçlü sınır kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  seedOwn(server);
  addUnlocked(server, 'me', 'perfect_week', '2026-08-27T10:00:00Z');

  const broken = setMySelection(
    server,
    'me',
    ['first_workout', 'workout_5', 'streak_3', 'streak_7', 'perfect_week'],
    { enforceLimit: false },
  );
  assertEqual(broken.length, 5, 'sınırsız model gerçekten fazla slot yazmalı');
  assertThrows(
    () => assert(broken.length <= 3, 'mutation'),
    'sınırsız model testten geçti — üçlü sınır yakalanmıyor',
  );

  const clean = createServer();
  seedOwn(clean);
  assertThrows(
    () => setMySelection(clean, 'me', ['first_workout', 'workout_5', 'streak_3', 'streak_7']),
    'doğru model dört rozeti kabul etti',
  );
});

check('M4. Hesap sahipliği guard’ı kaldırılırsa test DÜŞER', () => {
  // Kasıtlı hata: capturedOwner kontrolü yok.
  const brokenState = { selection: [] };
  const brokenApply = (keys) => {
    brokenState.selection = keys;
  };
  brokenApply(['streak_7']);
  assertThrows(
    () => assertDeepEqual(brokenState.selection, [], 'mutation'),
    'sahiplik guard’sız model testten geçti — hesap sızıntısı yakalanmıyor',
  );

  // Doğru model: geç cevap düşer.
  const server = createServer();
  seedOwn(server, 'user-a');
  setMySelection(server, 'user-a', ['streak_7']);
  const context = createContext(server);
  context.signIn('user-a');
  const ownerOfA = context.owner;
  context.signIn('user-b');
  void context.load(ownerOfA);
  assertDeepEqual(context.selection, [], 'doğru model A’nın cevabını B’ye yazdı');
});

// ---------------------------------------------------------------------------

rmSync(outDir, { force: true, recursive: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Vitrin seçimi harness: ${passed} kontrol geçti.`);
console.log('  (Canlı Postgres yok — SQL çalıştırılmadı, modellendi ve statik denetlendi.)');
