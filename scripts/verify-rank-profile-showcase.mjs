#!/usr/bin/env node
/**
 * PROFİL SEZON ROZETİ VİTRİNİ — DOĞRULAMA HARNESS'I
 *
 * Kapsam: `get_friend_season_achievement_showcase` RPC'sinin GÜVENLİK SINIRI,
 * seçim/sıralama semantiği ve iki profildeki istemci davranışı. RP kuralları,
 * rank eşikleri, başarı eşikleri ve kutlama yaşam döngüsü BURADA TEST EDİLMEZ
 * — onlar `verify-ranks.mjs`, `verify-rank-achievements.mjs` ve
 * `verify-rank-achievement-celebration.mjs` içindedir; o dosyalara
 * dokunulmamıştır.
 *
 * Mevcut rank harness'larıyla aynı üç katmanlı kalıp:
 *   1. SAF MANTIK — `constants/rank-experience.ts` gerçekten `tsc` ile
 *      derlenir ve anahtar doğrulaması ÇALIŞTIRILIR.
 *   2. MODEL      — RPC'nin ve iki profil ekranının referans uygulaması:
 *      arkadaşlık kapısı, sezon filtresi, sıralama, sınır ve yarış koruması.
 *   3. STATİK     — `security definer`, `search_path`, grant/revoke, yasak
 *      alanlar ve "ikinci sorgu yok" kuralı kaynak üzerinden denetlenir.
 *
 * Canlı Postgres YOKTUR: SQL çalıştırılmaz, modellenip statik denetlenir.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const SHOWCASE_SQL_PATH = 'supabase/migrations/20260831120000_add_friend_achievement_showcase.sql';
const ACHIEVEMENTS_SQL_PATH = 'supabase/migrations/20260830120000_add_season_rank_achievements.sql';

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
// Katman 1 — `constants/rank-experience.ts` gerçekten derlenir
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'rosea-profile-showcase-'));
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

const sql = source(SHOWCASE_SQL_PATH);
const achievementsSql = source(ACHIEVEMENTS_SQL_PATH);
const serviceSource = source('services/ranks.ts');
const componentSource = source('components/ranks/profile-achievement-showcase.tsx');
/**
 * Yorumları çıkarılmış bileşen kaynağı.
 *
 * "Şu YOK" kontrolleri bunu kullanır: dosya zaten "rank rozeti çizilmez",
 * "retry yok" gibi ifadeleri BELGELEDİĞİ için yorumlu metin üzerinden arama
 * yanlış alarm üretirdi.
 */
const componentCode = componentSource
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');
const ownProfileSource = source('app/(tabs)/profile.tsx');
const friendProfileSource = source('app/profile/[userId].tsx');
const typesSource = source('types/ranks.ts');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

/** Yorumları çıkarılmış SQL — "şuna dokunmamalı" kontrolleri bunu kullanır. */
const sqlCode = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, ' ');

const KEYS = [...rx.SEASON_ACHIEVEMENT_KEYS];
/** SQL'deki gerçek sınır; model ve bileşen buna karşı doğrulanır. */
const SQL_LIMIT = (() => {
  const match = sqlCode.match(/limit (\d+)/);
  if (!match) throw new Error('SQL sınırı bulunamadı');
  return Number.parseInt(match[1], 10);
})();

/** Katalog sırası MIGRATION'dan okunur; harness'a elle yazılmaz. */
const CATALOG_ORDER = (() => {
  const block = achievementsSql.slice(achievementsSql.indexOf('season_achievement_catalog'));
  const values = block.slice(block.indexOf('values'), block.indexOf('as catalog'));
  return [...values.matchAll(/\('(\w+)',\s*\d+,\s*(\d+)\)/g)]
    .sort((left, right) => Number(left[2]) - Number(right[2]))
    .map((match) => match[1]);
})();

// ---------------------------------------------------------------------------
// Katman 2 — MODEL: RPC ve iki profil ekranı
// ---------------------------------------------------------------------------

function createServer(currentSeasonIndex = 5) {
  return {
    achievements: [],
    currentSeasonIndex,
    friendships: [],
    /** "Dokunulmadı" iddiasını kanıtlamak için sayaçlar. */
    writes: 0,
  };
}

function addFriendship(server, requesterId, receiverId, status) {
  server.friendships.push({ receiver_id: receiverId, requester_id: requesterId, status });
}

function addUnlocked(server, userId, key, unlockedAt, seasonIndex) {
  server.achievements.push({
    achievement_key: key,
    season_index: seasonIndex ?? server.currentSeasonIndex,
    unlocked_at: unlockedAt,
    user_id: userId,
  });
}

/** `public.are_friends(user_a, user_b)` referans uygulaması. */
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

/**
 * `public.get_friend_season_achievement_showcase(target_user_id)` referansı.
 *
 * SQL ile aynı adımlar: oturum → arkadaşlık kapısı → güncel sezon filtresi →
 * `unlocked_at desc` + katalog sırası → `limit 3`.
 */
function runShowcase(server, actor, targetUserId, options = {}) {
  const requireFriendship = options.requireFriendship !== false;
  const filterSeason = options.filterSeason !== false;
  // `null` = sınır YOK (mutation testi). Alan hiç verilmezse SQL sınırı geçerli.
  const limit = 'limit' in options ? options.limit : SQL_LIMIT;

  if (!actor) return [];
  if (requireFriendship && !areFriends(server, actor, targetUserId)) return [];

  const catalogIndex = (key) => {
    const index = CATALOG_ORDER.indexOf(key);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };

  return server.achievements
    .filter((row) => row.user_id === targetUserId)
    .filter((row) => !filterSeason || row.season_index === server.currentSeasonIndex)
    .sort((left, right) => {
      const diff = new Date(right.unlocked_at).getTime() - new Date(left.unlocked_at).getTime();
      if (diff !== 0) return diff;
      const byCatalog = catalogIndex(left.achievement_key) - catalogIndex(right.achievement_key);
      if (byCatalog !== 0) return byCatalog;
      return left.achievement_key < right.achievement_key ? -1 : 1;
    })
    .slice(0, limit === null ? undefined : limit)
    .map((row) => ({
      achievement_key: row.achievement_key,
      season_index: row.season_index,
      unlocked_at: row.unlocked_at,
    }));
}

/** `services/ranks.ts` içindeki daraltmanın referansı. */
function parseShowcaseRows(rows, options = {}) {
  const validateKey = options.validateKey !== false;
  const entries = [];

  for (const row of rows ?? []) {
    const key = validateKey ? rx.parseSeasonAchievementKey(row.achievement_key) : row.achievement_key;
    if (!key) continue;

    const unlockedAt =
      typeof row.unlocked_at === 'string' && row.unlocked_at.trim().length > 0
        ? row.unlocked_at
        : undefined;
    const seasonIndex =
      typeof row.season_index === 'number' && Number.isFinite(row.season_index)
        ? row.season_index
        : undefined;

    entries.push({ key, seasonIndex, unlockedAt });
  }

  return entries;
}

/** Bileşendeki `selectShowcaseEntries` referansı (kendi profili yolu). */
function selectShowcase(entries, limit = SQL_LIMIT) {
  const catalogIndex = (key) => KEYS.indexOf(key);
  const time = (value) => {
    if (!value) return Number.NEGATIVE_INFINITY;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };

  return [...entries]
    .sort((left, right) => {
      const diff = time(right.unlockedAt) - time(left.unlockedAt);
      if (diff !== 0) return diff;
      return catalogIndex(left.key) - catalogIndex(right.key);
    })
    .slice(0, limit);
}

const keysOf = (rows) => rows.map((row) => row.achievement_key ?? row.key);

// ---------------------------------------------------------------------------
// 1 · Kendi profili — seçim ve sıralama
// ---------------------------------------------------------------------------

check('1. Kendi profilinde YALNIZCA açılmış rozetler görünür', () => {
  // `RankContext`ten gelen tam liste: kilitliler de var.
  const contextAchievements = [
    { currentProgress: 1, isUnlocked: true, key: 'first_workout', targetProgress: 1, unlockedAt: '2026-08-20T10:00:00Z' },
    { currentProgress: 2, isUnlocked: false, key: 'workout_5', targetProgress: 5 },
    { currentProgress: 3, isUnlocked: true, key: 'streak_3', targetProgress: 3, unlockedAt: '2026-08-22T10:00:00Z' },
    { currentProgress: 0, isUnlocked: false, key: 'perfect_week', targetProgress: 1 },
  ];

  const entries = contextAchievements
    .filter((achievement) => achievement.isUnlocked)
    .map((achievement) => ({ key: achievement.key, unlockedAt: achievement.unlockedAt }));

  assertDeepEqual(keysOf(selectShowcase(entries)), ['streak_3', 'first_workout'], 'kilitli rozet sızdı');

  // Ekran gerçekten yalnızca `isUnlocked` filtresi uyguluyor; ilerleme HESAPLAMIYOR.
  assert(
    ownProfileSource.includes('.filter((achievement) => achievement.isUnlocked)'),
    'kendi profili açılmış filtresini uygulamıyor',
  );
  assert(
    !/currentProgress|targetProgress/.test(componentSource),
    'vitrin bileşeni ilerleme okuyor/hesaplıyor',
  );
});

check('2. EN YENİ üç rozet seçilir', () => {
  const entries = [
    { key: 'first_workout', unlockedAt: '2026-08-01T10:00:00Z' },
    { key: 'workout_5', unlockedAt: '2026-08-05T10:00:00Z' },
    { key: 'streak_3', unlockedAt: '2026-08-09T10:00:00Z' },
    { key: 'streak_7', unlockedAt: '2026-08-11T10:00:00Z' },
    { key: 'perfect_week', unlockedAt: '2026-08-13T10:00:00Z' },
  ];

  assertDeepEqual(
    keysOf(selectShowcase(entries)),
    ['perfect_week', 'streak_7', 'streak_3'],
    'en yeni üç rozet seçilmedi',
  );
  assertEqual(selectShowcase(entries).length, SQL_LIMIT, 'sınır uygulanmadı');
});

check('3. Eşit tarihte KATALOG sırası deterministiktir', () => {
  const sameMoment = '2026-08-24T09:00:00Z';
  // Ekleme sırası bilinçli olarak katalog sırasının TERSİ.
  const entries = [
    { key: 'perfect_week', unlockedAt: sameMoment },
    { key: 'streak_7', unlockedAt: sameMoment },
    { key: 'streak_3', unlockedAt: sameMoment },
    { key: 'first_workout', unlockedAt: sameMoment },
  ];

  const first = keysOf(selectShowcase(entries));
  const second = keysOf(selectShowcase([...entries].reverse()));
  assertDeepEqual(first, second, 'sonuç ekleme sırasına bağlı');
  assertDeepEqual(
    first,
    ['first_workout', 'streak_3', 'streak_7'],
    'eşitlikte katalog sırası uygulanmadı',
  );

  // Tarihi okunamayan satırlar sona düşer ama çökme üretmez.
  const broken = selectShowcase([
    { key: 'streak_7', unlockedAt: 'not-a-date' },
    { key: 'first_workout', unlockedAt: '2026-08-24T09:00:00Z' },
  ]);
  assertDeepEqual(keysOf(broken), ['first_workout', 'streak_7'], 'bozuk tarih sıralamayı bozdu');
});

check('4. Bilinmeyen achievement key İSTEMCİDE düşürülür', () => {
  const rows = [
    { achievement_key: 'first_workout', season_index: 5, unlocked_at: '2026-08-20T10:00:00Z' },
    { achievement_key: 'legendary', season_index: 5, unlocked_at: '2026-08-21T10:00:00Z' },
    { achievement_key: null, season_index: 5, unlocked_at: '2026-08-22T10:00:00Z' },
    { achievement_key: 'streak_3', season_index: 5, unlocked_at: '' },
  ];

  const parsed = parseShowcaseRows(rows);
  assertDeepEqual(keysOf(parsed), ['first_workout', 'streak_3'], 'bilinmeyen anahtar düşmedi');
  assertEqual(parsed[1].unlockedAt, undefined, 'boş tarih güvenle ele alınmadı');
  assertEqual(parsed[0].seasonIndex, 5, 'sezon numarası taşınmadı');
  // Ham snake_case alanlar sızmaz.
  for (const raw of ['achievement_key', 'unlocked_at', 'season_index']) {
    assert(!(raw in parsed[0]), `ham alan sızdı: ${raw}`);
  }
  assertDeepEqual(parseShowcaseRows(null), [], 'null yanıt çökertti');
});

// ---------------------------------------------------------------------------
// 2 · RPC güvenlik kapısı — model
// ---------------------------------------------------------------------------

function seedFriendData(server) {
  addUnlocked(server, 'friend', 'first_workout', '2026-08-20T10:00:00Z');
  addUnlocked(server, 'friend', 'workout_5', '2026-08-22T10:00:00Z');
  addUnlocked(server, 'friend', 'streak_3', '2026-08-24T10:00:00Z');
  addUnlocked(server, 'friend', 'streak_7', '2026-08-26T10:00:00Z');
}

check('5. Arkadaş OLMAYAN kullanıcı sıfır satır alır', () => {
  const server = createServer();
  seedFriendData(server);
  assertDeepEqual(runShowcase(server, 'me', 'friend'), [], 'yabancı kullanıcı veri aldı');

  // Başka iki kişinin arkadaşlığı da yetmez: aktif kullanıcı taraf olmalı.
  addFriendship(server, 'other-a', 'friend', 'accepted');
  assertDeepEqual(runShowcase(server, 'me', 'friend'), [], 'taraf olunmayan ilişki veri açtı');

  // Oturumsuz çağrı da boş döner.
  assertDeepEqual(runShowcase(server, null, 'friend'), [], 'oturumsuz çağrı veri döndürdü');
  assertDeepEqual(runShowcase(server, undefined, 'friend'), [], 'auth.uid() yokken veri döndü');
});

check('6. PENDING ilişki sıfır satır alır', () => {
  const server = createServer();
  seedFriendData(server);

  addFriendship(server, 'me', 'friend', 'pending');
  assertDeepEqual(runShowcase(server, 'me', 'friend'), [], 'gönderilen bekleyen istek veri açtı');

  const incoming = createServer();
  seedFriendData(incoming);
  addFriendship(incoming, 'friend', 'me', 'pending');
  assertDeepEqual(runShowcase(incoming, 'me', 'friend'), [], 'gelen bekleyen istek veri açtı');
});

check('7. ACCEPTED arkadaşlık veri alabilir', () => {
  const server = createServer();
  seedFriendData(server);
  addFriendship(server, 'me', 'friend', 'accepted');

  const rows = runShowcase(server, 'me', 'friend');
  assertDeepEqual(keysOf(rows), ['streak_7', 'streak_3', 'workout_5'], 'en yeni üç rozet dönmedi');

  // Ters yön de aynı sonucu verir.
  const reverse = createServer();
  seedFriendData(reverse);
  addFriendship(reverse, 'friend', 'me', 'accepted');
  assertEqual(runShowcase(reverse, 'me', 'friend').length, 3, 'ters yön kapsanmadı');
});

check('8. RPC yalnızca GÜNCEL sunucu sezonunu kullanır; istemci sezon veremez', () => {
  const server = createServer(5);
  addFriendship(server, 'me', 'friend', 'accepted');
  addUnlocked(server, 'friend', 'first_workout', '2026-06-01T10:00:00Z', 4);
  addUnlocked(server, 'friend', 'workout_5', '2026-08-20T10:00:00Z', 5);

  const rows = runShowcase(server, 'me', 'friend');
  assertDeepEqual(keysOf(rows), ['workout_5'], 'eski sezon rozeti sızdı');
  assertEqual(rows[0].season_index, 5, 'güncel sezon dönmedi');

  // İmzada sezon parametresi YOK; sezon `current_date`ten türetiliyor.
  const signature = sqlCode.match(
    /create or replace function public\.get_friend_season_achievement_showcase\(([^)]*)\)/,
  );
  assert(signature, 'RPC imzası bulunamadı');
  assertEqual(signature[1].trim(), 'target_user_id uuid', 'RPC fazladan parametre alıyor');
  assert(
    sqlCode.includes('public.rank_season_index_for(current_date)'),
    'sezon sunucu tarihinden belirlenmiyor',
  );
  // Servis de yalnızca hedef kullanıcıyı gönderiyor.
  const callStart = serviceSource.indexOf("supabase.rpc('get_friend_season_achievement_showcase'");
  assert(callStart >= 0, 'servis çağrısı bulunamadı');
  const call = serviceSource.slice(callStart, serviceSource.indexOf('});', callStart) + 2);
  assert(call.includes('target_user_id: targetUserId'), 'servis hedef kullanıcıyı göndermiyor');
  // Fonksiyon ADI "season" içerdiği için yalnızca argümanlar taranır.
  const argumentsOnly = call.slice(call.indexOf(','));
  for (const forbidden of ['season', 'progress', 'unlocked', 'limit']) {
    assert(!argumentsOnly.includes(forbidden), `istemci ${forbidden} gönderiyor`);
  }
});

check('9. Sonuç EN FAZLA üç satırdır', () => {
  const server = createServer();
  addFriendship(server, 'me', 'friend', 'accepted');
  for (const key of KEYS) {
    addUnlocked(server, 'friend', key, `2026-08-${10 + KEYS.indexOf(key)}T10:00:00Z`);
  }
  assertEqual(KEYS.length, 6, 'katalog altı rozet olmalı');
  assertEqual(runShowcase(server, 'me', 'friend').length, 3, 'sınır uygulanmadı');
  assertEqual(SQL_LIMIT, 3, 'SQL sınırı 3 değil');
  assert(/limit 3;/.test(sqlCode), 'SQL sınırı kaynakta yok');
});

check('10. Sonuçta YALNIZCA izin verilen üç alan bulunur', () => {
  const returnsBlock = sqlCode.slice(
    sqlCode.indexOf('returns table'),
    sqlCode.indexOf('language sql'),
  );
  const columns = [...returnsBlock.matchAll(/(\w+)\s+(integer|text|timestamptz|uuid|boolean)/g)].map(
    (match) => match[1],
  );
  assertDeepEqual(
    columns.sort(),
    ['achievement_key', 'season_index', 'unlocked_at'],
    'dönüş alanları beklenen üçlü değil',
  );

  for (const forbidden of [
    'email',
    'rose',
    'xp',
    'level',
    'bio',
    'training_goal',
    'display_name',
    'avatar_url',
    'current_progress',
    'target_progress',
    'metadata',
    'rp_delta',
    'workout',
  ]) {
    assert(!returnsBlock.includes(forbidden), `yasak alan dönüş tipinde: ${forbidden}`);
  }

  // Model çıktısı da yalnızca üç alan taşır.
  const server = createServer();
  addFriendship(server, 'me', 'friend', 'accepted');
  seedFriendData(server);
  for (const row of runShowcase(server, 'me', 'friend')) {
    assertDeepEqual(
      Object.keys(row).sort(),
      ['achievement_key', 'season_index', 'unlocked_at'],
      'yanıt fazladan alan taşıyor',
    );
  }
});

check('11. anon/public execute YOK; authenticated VAR', () => {
  assert(sqlCode.includes('security definer'), 'RPC security definer değil');
  assert(sqlCode.includes("set search_path = ''"), "RPC search_path = '' kullanmıyor");
  assert(sqlCode.includes('stable'), 'RPC stable değil');
  assert(
    sqlCode.includes(
      'revoke all on function public.get_friend_season_achievement_showcase(uuid) from public',
    ),
    'public execute kaldırılmamış',
  );
  assert(
    sqlCode.includes(
      'revoke all on function public.get_friend_season_achievement_showcase(uuid) from anon',
    ),
    'anon execute kaldırılmamış',
  );
  assert(
    sqlCode.includes(
      'grant execute on function public.get_friend_season_achievement_showcase(uuid) to authenticated',
    ),
    'authenticated execute grant’i yok',
  );
  // Arkadaşlık kapısı YALNIZCA are_friends üzerinden.
  assert(
    sqlCode.includes('public.are_friends((select auth.uid()), target_user_id)'),
    'arkadaşlık kapısı are_friends ile kurulmamış',
  );
  assert(!/friendships/.test(sqlCode), 'RPC friendships tablosuna doğrudan dokunuyor');
  assert(sqlCode.includes('(select auth.uid()) is not null'), 'oturum kontrolü yok');
  // Tek transaction ve tekrar çalıştırılabilir.
  assert(/^begin;/m.test(sqlCode) && /commit;/.test(sqlCode), 'migration tek transaction değil');
  assert(
    sqlCode.includes('create or replace function'),
    'migration tekrar çalıştırılabilir değil',
  );
});

check('12. Tabloya arkadaş SELECT policy/grant’i EKLENMEMİŞ', () => {
  // Yeni migration tablonun güvenlik yapısına HİÇ dokunmaz.
  assert(!/create policy/i.test(sqlCode), 'yeni migration policy ekliyor');
  assert(!/drop policy/i.test(sqlCode), 'yeni migration policy düşürüyor');
  assert(
    !/grant\s+select\s+on\s+table/i.test(sqlCode),
    'yeni migration tabloya select grant’i veriyor',
  );
  assert(!/alter table/i.test(sqlCode), 'yeni migration tablo değiştiriyor');
  assert(
    !/enable row level security|disable row level security/i.test(sqlCode),
    'yeni migration RLS yapısını değiştiriyor',
  );

  // Mevcut migration hâlâ yalnızca "kendi satırını oku" politikasını taşıyor.
  assert(
    /create policy "season_rank_achievements_select_own"[\s\S]*?auth\.uid\(\)\) = user_id/.test(
      achievementsSql,
    ),
    'mevcut kendi-satırını-oku politikası bozulmuş',
  );
  assert(
    !/on public\.season_rank_achievements for select[\s\S]{0,200}are_friends/.test(achievementsSql),
    'tabloya arkadaş select policy’si eklenmiş',
  );
  // Uygulanmış migration dosyaları DEĞİŞMEMİŞ olmalı.
  const changed = execFileSync('git', ['status', '--porcelain', ACHIEVEMENTS_SQL_PATH], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assertEqual(changed.trim(), '', 'uygulanmış achievements migration’ı değiştirilmiş');
});

check('13. RPC hiçbir tabloya YAZMAZ', () => {
  for (const verb of ['insert into', 'update ', 'delete from', 'truncate', 'merge into']) {
    assert(!new RegExp(verb, 'i').test(sqlCode), `RPC yazma ifadesi içeriyor: ${verb}`);
  }
  assert(sqlCode.includes('language sql'), 'RPC saf okuma (language sql) değil');

  // Model tarafı: çağrı sunucu durumunu değiştirmez.
  const server = createServer();
  addFriendship(server, 'me', 'friend', 'accepted');
  seedFriendData(server);
  const before = JSON.stringify(server.achievements);
  runShowcase(server, 'me', 'friend');
  runShowcase(server, 'me', 'friend');
  assertEqual(JSON.stringify(server.achievements), before, 'model çağrısı veriyi değiştirdi');
  assertEqual(server.writes, 0, 'model yazma yaptı');
});

check('14. RP/XP/level/gül/reward tablolarına DOKUNMAZ', () => {
  for (const table of [
    'reward_ledger',
    'user_progress',
    'rank_events',
    'user_season_ranks',
    'rank_settings',
    'workout_sessions',
    'workout_sets',
    'shared_discipline_days',
    'auth.users',
    'profiles',
  ]) {
    assert(!sqlCode.includes(table), `yasak tabloya erişim: ${table}`);
  }
  // Yalnızca iki nesne okunur.
  assert(sqlCode.includes('public.season_rank_achievements'), 'başarı defteri okunmuyor');
  assert(sqlCode.includes('public.season_achievement_catalog()'), 'katalog sırası kullanılmıyor');
});

// ---------------------------------------------------------------------------
// 3 · İstemci yaşam döngüsü
// ---------------------------------------------------------------------------

/**
 * Arkadaş profili ekranının vitrin yükleme yaşam döngüsü.
 *
 * Mevcut profil/disiplin/rank akışından AYRIDIR: burada hata yalnızca vitrini
 * gizler, profil verisini düşürmez.
 */
function createFriendProfileScreen(server) {
  let requestId = 0;
  let isActive = true;
  let profile;
  let showcase = [];
  let hasShowcaseError = false;
  let hasProfileError = false;

  function open(actor, userId, options = {}) {
    // Nesil, istekten ÖNCE artar: eski cevap yeni profile yazamaz.
    requestId += 1;
    const generation = requestId;
    isActive = true;
    showcase = [];
    hasShowcaseError = false;

    profile = { userId };

    return {
      /** Vitrin cevabı geldi. */
      resolve() {
        if (!isActive || requestId !== generation) return;
        showcase = parseShowcaseRows(runShowcase(server, actor, userId, options));
      },
      /** Vitrin RPC'si hata verdi. */
      reject() {
        if (!isActive || requestId !== generation) return;
        hasShowcaseError = true;
      },
    };
  }

  return {
    get hasProfileError() {
      return hasProfileError;
    },
    get hasShowcaseError() {
      return hasShowcaseError;
    },
    open,
    get profile() {
      return profile;
    },
    get showcase() {
      return showcase;
    },
    unmount() {
      isActive = false;
    },
  };
}

check('15. Vitrin hatası profil verisini DÜŞÜRMEZ', () => {
  const server = createServer();
  addFriendship(server, 'me', 'friend', 'accepted');
  seedFriendData(server);

  const screen = createFriendProfileScreen(server);
  const request = screen.open('me', 'friend');
  request.reject();

  assertEqual(screen.hasShowcaseError, true, 'vitrin hatası kaydedilmedi');
  assertEqual(screen.hasProfileError, false, 'vitrin hatası profili düşürdü');
  assert(screen.profile, 'profil verisi kayboldu');
  assertDeepEqual(screen.showcase, [], 'hata sonrası vitrin veri gösteriyor');

  // Bileşen hata durumunda hiçbir şey çizmez (kart/retry YOK).
  assert(componentSource.includes('if (hasError) return null;'), 'hata sessizce gizlenmiyor');
  assert(!/retry|Tekrar dene|Try again/i.test(componentCode), 'vitrin retry butonu içeriyor');

  // Ekran, vitrin hatasını genel hata bayrağına BAĞLAMAZ.
  assert(
    friendProfileSource.includes('setHasShowcaseError(true)'),
    'vitrin hatası ayrı state’te tutulmuyor',
  );
  /**
   * Bitiş işaretçisi effect'in BAŞLANGICINDAN İTİBAREN aranır: aynı deps
   * dizisi dosyada daha önce de geçiyor (`load` useCallback'i) ve baştan
   * arama boş dilim üretirdi.
   */
  const showcaseStart = friendProfileSource.indexOf('fetchFriendAchievementShowcase(userId)');
  assert(showcaseStart > 0, 'vitrin çağrısı bulunamadı');
  const showcaseEffect = friendProfileSource.slice(
    showcaseStart,
    friendProfileSource.indexOf('}, [isOwnProfile, userId]);', showcaseStart),
  );
  assert(showcaseEffect.length > 0, 'vitrin effect’i bulunamadı');
  assert(!showcaseEffect.includes('setHasError('), 'vitrin hatası profili hata ekranına düşürüyor');
  assert(!showcaseEffect.includes('setProfile('), 'vitrin effect’i profil state’ine yazıyor');
});

check('16. Hesap/route değişiminde ESKİ cevap yeni profile yazamaz', () => {
  const server = createServer();
  addFriendship(server, 'me', 'friend-a', 'accepted');
  addFriendship(server, 'me', 'friend-b', 'accepted');
  addUnlocked(server, 'friend-a', 'first_workout', '2026-08-20T10:00:00Z');
  addUnlocked(server, 'friend-b', 'perfect_week', '2026-08-25T10:00:00Z');

  const screen = createFriendProfileScreen(server);
  const staleRequest = screen.open('me', 'friend-a');
  // Kullanıcı başka bir profile geçti.
  const freshRequest = screen.open('me', 'friend-b');

  // A'nın geç gelen cevabı DÜŞER.
  staleRequest.resolve();
  assertDeepEqual(screen.showcase, [], 'eski route cevabı yeni profile yazdı');

  freshRequest.resolve();
  assertDeepEqual(keysOf(screen.showcase), ['perfect_week'], 'yeni profilin verisi gelmedi');

  // Unmount sonrası da yazılmaz.
  const late = screen.open('me', 'friend-a');
  screen.unmount();
  late.resolve();
  assertDeepEqual(screen.showcase, [], 'unmount sonrası state yazıldı');

  // Kaynakta nesil ve aktiflik korumaları var.
  assert(friendProfileSource.includes('showcaseRequestIdRef'), 'istek nesli koruması yok');
  assert(
    friendProfileSource.includes('showcaseRequestIdRef.current !== requestId'),
    'nesil karşılaştırması yok',
  );
  assert(friendProfileSource.includes('if (!isActive'), 'unmount koruması yok');
});

check('17. Kendi profilinde İKİNCİ bir Supabase achievement sorgusu YOK', () => {
  // Ekran doğrudan Supabase'e veya servise gitmez; context'i kullanır.
  assert(!ownProfileSource.includes('supabase'), 'kendi profili doğrudan Supabase kullanıyor');
  for (const forbidden of [
    'syncMySeasonAchievements',
    'fetchFriendAchievementShowcase',
    'loadAchievements(',
    "from '@/services/ranks'",
  ]) {
    assert(!ownProfileSource.includes(forbidden), `kendi profilinde ikinci sorgu yolu: ${forbidden}`);
  }
  assert(
    ownProfileSource.includes('hasAchievementsError') &&
      ownProfileSource.includes('isAchievementsLoading') &&
      ownProfileSource.includes('achievements,'),
    'mevcut context değerleri kullanılmıyor',
  );
  // Bileşen de kendi başına veri çekmez.
  assert(!componentSource.includes('supabase'), 'vitrin bileşeni veri çekiyor');
  assert(!/useEffect|fetch/.test(componentSource), 'vitrin bileşeni yan etki içeriyor');
});

check('18. Mevcut rank rozeti her iki profilde de YALNIZCA BİR KEZ kalır', () => {
  assertEqual(
    (ownProfileSource.match(/<RankBadge/g) ?? []).length,
    1,
    'kendi profilinde rank rozeti çoğaltılmış',
  );
  assertEqual(
    (friendProfileSource.match(/<RankBadge/g) ?? []).length,
    1,
    'arkadaş profilinde rank rozeti çoğaltılmış',
  );
  // Vitrin rank rozeti çizmez ve rank/RP göstermez.
  assert(!componentCode.includes('RankBadge'), 'vitrin rank rozetini yeniden çiziyor');
  assert(!/currentRp|rpValue|rankId/.test(componentCode), 'vitrin rank/RP gösteriyor');
  // Her iki ekranda da vitrin TEK kez mount edilir.
  assertEqual(
    (ownProfileSource.match(/<ProfileAchievementShowcase/g) ?? []).length,
    1,
    'kendi profilinde vitrin çoğaltılmış',
  );
  assertEqual(
    (friendProfileSource.match(/<ProfileAchievementShowcase/g) ?? []).length,
    1,
    'arkadaş profilinde vitrin çoğaltılmış',
  );
  // Aynı bileşen iki yerde de kullanılıyor (kopyalanmamış).
  assert(
    ownProfileSource.includes("from '@/components/ranks/profile-achievement-showcase'") &&
      friendProfileSource.includes("from '@/components/ranks/profile-achievement-showcase'"),
    'ortak vitrin bileşeni kullanılmıyor',
  );
});

check('19. Vitrin EN FAZLA üç öğe render eder ve tasarım sınırlarına uyar', () => {
  const many = KEYS.map((key, index) => ({
    key,
    unlockedAt: `2026-08-${10 + index}T10:00:00Z`,
  }));
  assertEqual(selectShowcase(many).length, 3, 'istemci üçten fazla rozet gösteriyor');
  assert(
    componentSource.includes('export const PROFILE_SHOWCASE_LIMIT = 3;'),
    'vitrin sınırı sabiti yok',
  );
  assertEqual(SQL_LIMIT, 3, 'SQL ve istemci sınırı ayrışıyor');

  // Ortak ikon kaynağı; yeni görsel/emoji/gradient yok.
  assert(
    componentSource.includes("from '@/components/ranks/achievement-icons'"),
    'ortak ikon kaynağı kullanılmıyor',
  );
  const code = componentSource
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  assert(!/gradient|require\(|shadowRadius|emoji/i.test(code), 'gradient/görsel/gölge eklenmiş');
  // Dokunma hedefi ve vurgu tonu.
  assert(code.includes('minHeight: Layout.minTouchSize'), '44 pt dokunma hedefi yok');
  assert(code.includes('withAlpha(accentColor'), 'ikon zemini vurgu tonundan gelmiyor');
  assert(code.includes('color={accentColor}'), 'ikon vurgu renginde değil');
  // Ad en fazla iki satır.
  // `{2}` regex'te niceleyicidir; süslü parantezler kaçırılmalı.
  assert(/numberOfLines=\{2\}/.test(code), 'rozet adı iki satırla sınırlanmamış');
  // Arkadaş vitrini salt okunur (onPress verilmez), kendi profili /rank açar.
  assert(
    !/<ProfileAchievementShowcase[\s\S]{0,400}onPress/.test(friendProfileSource),
    'arkadaş vitrini salt okunur değil',
  );
  assert(
    /<ProfileAchievementShowcase[\s\S]{0,400}router\.push\('\/rank'\)/.test(ownProfileSource),
    'kendi vitrini /rank ekranına gitmiyor',
  );
  // Metinler locale’den; bileşende sabit kullanıcı metni yok.
  for (const key of ['showcase', 'title', 'empty']) {
    assert(localeTr.includes(`${key}:`), `tr sözlüğünde ${key} yok`);
    assert(localeEn.includes(`${key}:`), `en sözlüğünde ${key} yok`);
  }
  assert(localeTr.includes("title: 'SEZON ROZETLERİ'"), 'TR başlık beklenen değil');
  assert(localeEn.includes("title: 'SEASON BADGES'"), 'EN başlık beklenen değil');
  assert(localeTr.includes('Bu sezon henüz rozet kazanmadın.'), 'TR boş durum metni yok');
  assert(localeEn.includes('No badges earned this season yet.'), 'EN boş durum metni yok');
  assert(
    !/<Text[^>]*>\s*[A-ZĞÜŞİÖÇ][a-zğüşıöç]/.test(componentSource),
    'vitrinde çeviriden geçmeyen sabit metin var',
  );
  // Tip yalnızca gösterim alanlarını taşır.
  assert(typesSource.includes('SeasonAchievementShowcaseEntry'), 'vitrin tipi yok');
});

// ---------------------------------------------------------------------------
// MUTATION TESTLERİ — bozuk implementasyon gerçekten düşüyor mu?
// ---------------------------------------------------------------------------

check('M1. `are_friends` guard’ı kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  seedFriendData(server);
  // Arkadaşlık YOK.

  const broken = runShowcase(server, 'me', 'friend', { requireFriendship: false });
  assertEqual(broken.length, 3, 'guard’sız model gerçekten veri döndürmeli');
  assertThrows(
    () => assertDeepEqual(broken, [], 'mutation'),
    'arkadaşlık guard’ı olmadan da geçti — sızıntı yakalanmıyor',
  );

  assertDeepEqual(runShowcase(server, 'me', 'friend'), [], 'doğru model sızdırıyor');
  const withoutGuard = sqlCode.replace(
    'and public.are_friends((select auth.uid()), target_user_id)',
    '',
  );
  assertThrows(
    () => assert(withoutGuard.includes('public.are_friends('), 'mutation'),
    'guard’sız SQL sürümü testten geçti',
  );
});

check('M2. `limit 3` kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  addFriendship(server, 'me', 'friend', 'accepted');
  for (const key of KEYS) {
    addUnlocked(server, 'friend', key, `2026-08-${10 + KEYS.indexOf(key)}T10:00:00Z`);
  }

  const broken = runShowcase(server, 'me', 'friend', { limit: null });
  assertEqual(broken.length, 6, 'sınırsız model gerçekten fazla satır döndürmeli');
  assertThrows(
    () => assertEqual(broken.length, 3, 'mutation'),
    'sınırsız model testten geçti — üçlü sınır yakalanmıyor',
  );

  assertEqual(runShowcase(server, 'me', 'friend').length, 3, 'doğru model sınırı aşıyor');
  assertThrows(
    () => assert(/limit \d+/.test(sqlCode.replace(/limit \d+/, '')), 'mutation'),
    'limit’siz SQL sürümü testten geçti',
  );
});

check('M3. Güncel sezon filtresi kaldırılırsa test DÜŞER', () => {
  const server = createServer(5);
  addFriendship(server, 'me', 'friend', 'accepted');
  addUnlocked(server, 'friend', 'perfect_week', '2026-06-01T10:00:00Z', 4);

  const broken = runShowcase(server, 'me', 'friend', { filterSeason: false });
  assertEqual(broken.length, 1, 'filtresiz model gerçekten eski sezonu döndürmeli');
  assertThrows(
    () => assertDeepEqual(broken, [], 'mutation'),
    'sezon filtresiz model testten geçti — eski sezon sızıntısı yakalanmıyor',
  );

  assertDeepEqual(runShowcase(server, 'me', 'friend'), [], 'doğru model eski sezonu gösteriyor');
  const withoutSeason = sqlCode.replace(
    'and a.season_index = public.rank_season_index_for(current_date)',
    '',
  );
  assertThrows(
    () => assert(withoutSeason.includes('rank_season_index_for'), 'mutation'),
    'sezon filtresiz SQL sürümü testten geçti',
  );
});

check('M4. İstemci key doğrulaması kaldırılırsa test DÜŞER', () => {
  const rows = [
    { achievement_key: 'legendary', season_index: 5, unlocked_at: '2026-08-20T10:00:00Z' },
    { achievement_key: 'first_workout', season_index: 5, unlocked_at: '2026-08-21T10:00:00Z' },
  ];

  const broken = parseShowcaseRows(rows, { validateKey: false });
  assertDeepEqual(
    keysOf(broken),
    ['legendary', 'first_workout'],
    'doğrulamasız model gerçekten bilinmeyen anahtarı geçirmeli',
  );
  assertThrows(
    () => assertDeepEqual(keysOf(broken), ['first_workout'], 'mutation'),
    'key doğrulaması olmadan da geçti — bilinmeyen anahtar yakalanmıyor',
  );

  assertDeepEqual(keysOf(parseShowcaseRows(rows)), ['first_workout'], 'doğru model sızdırıyor');
  assert(
    serviceSource.includes('parseSeasonAchievementKey(row.achievement_key)'),
    'servis anahtarı doğrulamıyor',
  );
  // Bilinmeyen anahtar ikon eşlemesinde de bulunmaz → doğrulama şart.
  assertEqual(rx.parseSeasonAchievementKey('legendary'), undefined, 'daraltma çalışmıyor');
});

// ---------------------------------------------------------------------------

rmSync(outDir, { force: true, recursive: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Profil vitrini harness: ${passed} kontrol geçti.`);
console.log('  (Canlı Postgres yok — SQL çalıştırılmadı, modellendi ve statik denetlendi.)');
