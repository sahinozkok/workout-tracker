#!/usr/bin/env node
/**
 * ARKADAŞ SEZON SIRALAMASI — DOĞRULAMA HARNESS'I
 *
 * Kapsam: `public.get_friends_rank_leaderboard()` RPC'sinin GÜVENLİK SINIRI ve
 * sıralama semantiği + istemci satır eşlemesi. RP kuralları, rank eşikleri,
 * sezon uzunluğu ve soft reset BURADA TEST EDİLMEZ — onlar
 * `scripts/verify-ranks.mjs` içindedir ve o dosyaya dokunulmamıştır.
 *
 * Projede jest kurulu DEĞİL ve yeni bağımlılık eklenemiyor; bu yüzden mevcut
 * rank harness'larıyla AYNI üç katmanlı kalıp izlenir:
 *
 *   1. SAF MANTIK — `constants/rank-experience.ts` gerçekten `tsc` ile
 *      derlenir ve satır eşlemesi ÇALIŞTIRILIR (yüzeysel metin testi değil).
 *   2. MODEL      — RPC'nin referans uygulaması: katılımcı kümesi, güncel
 *      sezon filtresi, `dense_rank()`, görüntü sırası ve yanıt sınırı.
 *      RP eşikleri MIGRATION DOSYASINDAN okunur, elle yazılmaz.
 *   3. STATİK     — `security definer`, `search_path`, grant/revoke, parametre
 *      yokluğu, yasak alanlar ve regresyon sınırları kaynak üzerinden denetlenir.
 *
 * Canlı Postgres YOKTUR: SQL çalıştırılmaz, modellenip statik denetlenir.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const LEADERBOARD_SQL_PATH = 'supabase/migrations/20260828120000_add_friends_rank_leaderboard.sql';
const RANKS_SQL_PATH = 'supabase/migrations/20260827120000_add_seasonal_ranks.sql';
const FRIENDS_SQL_PATH =
  'supabase/migrations/20260814120000_add_friendships_and_shared_discipline.sql';

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

const outDir = mkdtempSync(join(tmpdir(), 'rosea-leaderboard-'));
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

const leaderboardSql = source(LEADERBOARD_SQL_PATH);
const ranksSql = source(RANKS_SQL_PATH);
const friendsSql = source(FRIENDS_SQL_PATH);
const serviceSource = source('services/ranks.ts');
const screenSource = source('app/friends/leaderboard.tsx');
const friendsScreenSource = source('components/friends/friends-screen.tsx');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

/** Yorumları çıkarılmış SQL — "şu alan dönmemeli" kontrolleri bunu kullanır. */
const leaderboardCode = leaderboardSql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*--.*$/gm, ' ');

const RANK_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'rosea'];

/** RP → rank; eşikler MEVCUT migration'daki `rank_for_rp` tablosundan okunur. */
const RANK_THRESHOLDS = (() => {
  const block = ranksSql.slice(ranksSql.indexOf('function public.rank_for_rp'));
  const body = block.slice(0, block.indexOf('$$;'));
  const matches = [...body.matchAll(/when coalesce\(rp, 0\) >= (\d+) then '(\w+)'/g)];
  if (matches.length === 0) throw new Error('rank_for_rp eşikleri okunamadı');
  return matches.map((match) => ({ floor: Number.parseInt(match[1], 10), rank: match[2] }));
})();

function rankForRp(rp) {
  for (const tier of RANK_THRESHOLDS) {
    if ((rp ?? 0) >= tier.floor) return tier.rank;
  }
  return 'bronze';
}

/** SQL'deki gerçek yanıt sınırı. Model ve istemci sabiti buna karşı doğrulanır. */
/**
 * SQL'deki gerçek yanıt sınırı — SEÇİM penceresinden okunur.
 *
 * Sınır bilinçli olarak `display_position` üzerinde DEĞİL: gerçek görüntü
 * sırası hiç değiştirilmeden, ayrı bir `selection_position` penceresiyle
 * kesilir. Model ve istemci sabiti bu değere karşı doğrulanır.
 */
const SQL_LIMIT = (() => {
  const match = leaderboardCode.match(/selection_position <= (\d+)/);
  if (!match) throw new Error('SQL yanıt sınırı bulunamadı');
  return Number.parseInt(match[1], 10);
})();

// ---------------------------------------------------------------------------
// Katman 2 — MODEL: RPC'nin referans uygulaması
// ---------------------------------------------------------------------------

function createDatabase(currentSeasonIndex = 5) {
  return {
    currentSeasonIndex,
    friendships: [],
    profiles: [],
    userSeasonRanks: [],
  };
}

function addUser(db, id, overrides = {}) {
  db.profiles.push({
    avatar_url: null,
    display_name: id,
    id,
    username: id,
    ...overrides,
  });
  return id;
}

function addFriendship(db, requesterId, receiverId, status) {
  db.friendships.push({ receiver_id: receiverId, requester_id: requesterId, status });
}

function addSeasonRank(db, userId, currentRp, overrides = {}) {
  db.userSeasonRanks.push({
    current_rp: currentRp,
    finalized_at: null,
    season_index: db.currentSeasonIndex,
    user_id: userId,
    ...overrides,
  });
}

/**
 * `public.get_friends_rank_leaderboard()` referans uygulaması.
 *
 * SQL ile BİREBİR aynı adımları izler: katılımcı kümesi → güncel sezon
 * (`finalized_at is null`) left join → yalnızca sıralananlar üzerinde
 * `dense_rank()` → deterministik görüntü sırası → `is_self` muafiyetli sınır.
 */
function runLeaderboard(db, actorId) {
  // `auth.uid()` null ise katılımcı kümesi boş kalır.
  if (!actorId) return [];

  const participants = new Set([actorId]);
  for (const friendship of db.friendships) {
    if (friendship.status !== 'accepted') continue;
    // Aktif kullanıcı ilişkinin TARAFI olmak zorunda.
    if (friendship.requester_id !== actorId && friendship.receiver_id !== actorId) continue;
    participants.add(
      friendship.requester_id === actorId ? friendship.receiver_id : friendship.requester_id,
    );
  }

  const scored = [];
  for (const participantId of participants) {
    // `join public.profiles` — profili olmayan katılımcı hiç dönmez.
    const profile = db.profiles.find((row) => row.id === participantId);
    if (!profile) continue;

    const seasonRow = db.userSeasonRanks.find(
      (row) =>
        row.user_id === participantId &&
        row.season_index === db.currentSeasonIndex &&
        row.finalized_at === null,
    );

    scored.push({
      avatar_url: profile.avatar_url,
      current_rp: seasonRow ? seasonRow.current_rp : null,
      display_name: profile.display_name,
      is_ranked: Boolean(seasonRow),
      is_self: participantId === actorId,
      participant_id: participantId,
      username: profile.username,
    });
  }

  // dense_rank() over (order by current_rp desc) — SADECE sıralananlar.
  const rankedRps = [
    ...new Set(scored.filter((row) => row.is_ranked).map((row) => row.current_rp)),
  ].sort((left, right) => right - left);

  const sortName = (row) =>
    String(row.display_name ?? '').trim().toLowerCase() ||
    String(row.username ?? '').toLowerCase() ||
    '';

  const ordered = [...scored].sort((left, right) => {
    if (left.is_ranked !== right.is_ranked) return left.is_ranked ? -1 : 1;
    if (left.is_ranked && left.current_rp !== right.current_rp) {
      return right.current_rp - left.current_rp;
    }
    const nameLeft = sortName(left);
    const nameRight = sortName(right);
    if (nameLeft !== nameRight) return nameLeft < nameRight ? -1 : 1;
    return left.participant_id < right.participant_id ? -1 : 1;
  });

  const participantCount = ordered.length;

  const positioned = ordered.map((row, index) => ({ ...row, display_position: index + 1 }));

  /**
   * SEÇİM PENCERESİ — SQL ile birebir.
   *
   * Aktif kullanıcı seçimde önce gelir, geri kalanlar gerçek görüntü sırasına
   * göre dizilir; ilk `SQL_LIMIT` seçim alınır. Yanıt hiçbir durumda sınırı
   * AŞMAZ ve kullanıcının satırı her zaman içindedir. Gerçek `display_position`
   * ve `rank_position` değerleri DEĞİŞTİRİLMEZ; nihai sıralama yine gerçek
   * görüntü sırasıdır.
   */
  const selected = [...positioned]
    .sort((left, right) => {
      if (left.is_self !== right.is_self) return left.is_self ? -1 : 1;
      return left.display_position - right.display_position;
    })
    .slice(0, SQL_LIMIT)
    .sort((left, right) => left.display_position - right.display_position);

  return selected
    .map((row) => ({
      avatar_url: row.avatar_url,
      current_rank: row.is_ranked ? rankForRp(row.current_rp) : null,
      current_rp: row.is_ranked ? row.current_rp : null,
      display_name: row.display_name,
      is_ranked: row.is_ranked,
      is_self: row.is_self,
      participant_count: participantCount,
      participant_id: row.participant_id,
      rank_position: row.is_ranked ? rankedRps.indexOf(row.current_rp) + 1 : null,
      season_index: db.currentSeasonIndex,
      username: row.username,
    }));
}

const ids = (rows) => rows.map((row) => row.participant_id);

// ---------------------------------------------------------------------------
// 1 · Kapsam — kim görünür, kim görünmez
// ---------------------------------------------------------------------------

check('1. Kullanıcı kendisini görür', () => {
  const db = createDatabase();
  addUser(db, 'me');
  addSeasonRank(db, 'me', 480);

  const rows = runLeaderboard(db, 'me');
  assertDeepEqual(ids(rows), ['me'], 'kendi satırı dönmedi');
  assertEqual(rows[0].is_self, true, 'is_self yanlış');
  assertEqual(rows[0].participant_count, 1, 'katılımcı sayısı yanlış');
});

check('2. Kabul edilmiş arkadaş görünür', () => {
  const db = createDatabase();
  addUser(db, 'me');
  addUser(db, 'friend');
  addFriendship(db, 'me', 'friend', 'accepted');
  addSeasonRank(db, 'me', 300);
  addSeasonRank(db, 'friend', 900);

  const rows = runLeaderboard(db, 'me');
  assertDeepEqual(ids(rows), ['friend', 'me'], 'kabul edilmiş arkadaş listede değil');
  // Ters yön de aynı sonucu verir: ilişki yönü kapsamı değiştirmez.
  const reverse = createDatabase();
  addUser(reverse, 'me');
  addUser(reverse, 'friend');
  addFriendship(reverse, 'friend', 'me', 'accepted');
  addSeasonRank(reverse, 'me', 300);
  addSeasonRank(reverse, 'friend', 900);
  assertDeepEqual(ids(runLeaderboard(reverse, 'me')), ['friend', 'me'], 'ters yön kapsanmadı');
});

check('3. Bekleyen GELEN istek görünmez', () => {
  const db = createDatabase();
  addUser(db, 'me');
  addUser(db, 'incoming');
  addFriendship(db, 'incoming', 'me', 'pending');
  addSeasonRank(db, 'me', 300);
  addSeasonRank(db, 'incoming', 1200);

  assertDeepEqual(ids(runLeaderboard(db, 'me')), ['me'], 'bekleyen gelen istek sızdı');
});

check('4. Bekleyen GÖNDERİLEN istek görünmez', () => {
  const db = createDatabase();
  addUser(db, 'me');
  addUser(db, 'outgoing');
  addFriendship(db, 'me', 'outgoing', 'pending');
  addSeasonRank(db, 'me', 300);
  addSeasonRank(db, 'outgoing', 1200);

  assertDeepEqual(ids(runLeaderboard(db, 'me')), ['me'], 'bekleyen gönderilen istek sızdı');
});

check('5. Arkadaş olmayan kullanıcı görünmez', () => {
  const db = createDatabase();
  addUser(db, 'me');
  addUser(db, 'stranger');
  addSeasonRank(db, 'me', 300);
  addSeasonRank(db, 'stranger', 9000);

  assertDeepEqual(ids(runLeaderboard(db, 'me')), ['me'], 'yabancı kullanıcı sızdı');
});

check('6. Başka iki kişinin sosyal ilişkisi SIZMAZ', () => {
  const db = createDatabase();
  addUser(db, 'me');
  addUser(db, 'b');
  addUser(db, 'c');
  // Aktif kullanıcı bu ilişkinin tarafı DEĞİL.
  addFriendship(db, 'b', 'c', 'accepted');
  addSeasonRank(db, 'me', 300);
  addSeasonRank(db, 'b', 800);
  addSeasonRank(db, 'c', 700);

  assertDeepEqual(ids(runLeaderboard(db, 'me')), ['me'], 'taraf olunmayan ilişki sızdı');

  // Aynı veriyle B kendi listesinde C'yi görür — kapsam kişiye özeldir.
  assertDeepEqual(ids(runLeaderboard(db, 'b')).sort(), ['b', 'c'], 'B kendi arkadaşını görmedi');
});

check('7. Güncel sezon DIŞINDAKİ rank satırı görünmez', () => {
  const db = createDatabase(5);
  addUser(db, 'me');
  addUser(db, 'oldSeason');
  addUser(db, 'finalized');
  addFriendship(db, 'me', 'oldSeason', 'accepted');
  addFriendship(db, 'me', 'finalized', 'accepted');
  addSeasonRank(db, 'me', 300);
  // Geçen sezonun satırı.
  addSeasonRank(db, 'oldSeason', 1700, { season_index: 4 });
  // Güncel sezon ama KAPANMIŞ satır.
  addSeasonRank(db, 'finalized', 1700, { finalized_at: '2026-08-24T00:00:00Z' });

  const rows = runLeaderboard(db, 'me');
  const oldSeasonRow = rows.find((row) => row.participant_id === 'oldSeason');
  const finalizedRow = rows.find((row) => row.participant_id === 'finalized');

  assertEqual(oldSeasonRow.is_ranked, false, 'eski sezon satırı sıralamaya girdi');
  assertEqual(finalizedRow.is_ranked, false, 'kapanmış sezon satırı sıralamaya girdi');
});

check('8. Rank satırı olmayan arkadaş ESKİ rankla gösterilmez', () => {
  const db = createDatabase(5);
  addUser(db, 'me');
  addUser(db, 'stale');
  addFriendship(db, 'me', 'stale', 'accepted');
  addSeasonRank(db, 'me', 300);
  addSeasonRank(db, 'stale', 1700, { season_index: 4 });

  const row = runLeaderboard(db, 'me').find((entry) => entry.participant_id === 'stale');
  assertEqual(row.is_ranked, false, 'is_ranked yanlış');
  assertEqual(row.current_rp, null, 'RP uydurulmuş');
  assertEqual(row.current_rank, null, 'rank uydurulmuş');
  assertEqual(row.rank_position, null, 'sıra uydurulmuş');
  // En altta yer alır.
  assertEqual(
    ids(runLeaderboard(db, 'me')).indexOf('stale'),
    1,
    'sıralanmamış katılımcı en altta değil',
  );
});

// ---------------------------------------------------------------------------
// 2 · Sıralama semantiği
// ---------------------------------------------------------------------------

check('9. Eşit RP AYNI sıra numarasını alır', () => {
  const db = createDatabase();
  addUser(db, 'me');
  addUser(db, 'a');
  addUser(db, 'b');
  addFriendship(db, 'me', 'a', 'accepted');
  addFriendship(db, 'me', 'b', 'accepted');
  addSeasonRank(db, 'me', 500);
  addSeasonRank(db, 'a', 500);
  addSeasonRank(db, 'b', 200);

  const rows = runLeaderboard(db, 'me');
  const position = (id) => rows.find((row) => row.participant_id === id).rank_position;

  assertEqual(position('me'), position('a'), 'eşit RP farklı sıra aldı');
  assertEqual(position('me'), 1, 'en yüksek RP 1. sırada değil');
  // `dense_rank()`: boşluk bırakmaz — 1, 1, 2.
  assertEqual(position('b'), 2, 'dense_rank boşluk bıraktı');
});

check('10. Farklı RP doğru sıralanır', () => {
  const db = createDatabase();
  addUser(db, 'me');
  addUser(db, 'high');
  addUser(db, 'mid');
  addFriendship(db, 'me', 'high', 'accepted');
  addFriendship(db, 'me', 'mid', 'accepted');
  addSeasonRank(db, 'me', 100);
  addSeasonRank(db, 'high', 1700);
  addSeasonRank(db, 'mid', 600);

  const rows = runLeaderboard(db, 'me');
  assertDeepEqual(ids(rows), ['high', 'mid', 'me'], 'RP azalan sıralama yanlış');
  assertDeepEqual(
    rows.map((row) => row.rank_position),
    [1, 2, 3],
    'sıra numaraları yanlış',
  );
  // Rank kimliği eşiklerden türetilir; istemci hesaplamaz.
  assertEqual(rows[0].current_rank, rankForRp(1700), 'rank kimliği yanlış');
});

check('11. Eşit RP satırlarının GÖRÜNTÜ sırası deterministiktir', () => {
  const build = (order) => {
    const db = createDatabase();
    addUser(db, 'me', { display_name: 'Zeynep' });
    addSeasonRank(db, 'me', 500);
    for (const id of order) {
      addUser(db, id, { display_name: { a1: 'Ada', a2: 'Ada', b1: 'Barış' }[id] });
      addFriendship(db, 'me', id, 'accepted');
      addSeasonRank(db, id, 500);
    }
    return ids(runLeaderboard(db, 'me'));
  };

  // Ekleme sırası değişse de sonuç aynı: ad → kimlik eşitlik bozucuları.
  const first = build(['a1', 'a2', 'b1']);
  const second = build(['b1', 'a2', 'a1']);
  assertDeepEqual(first, second, 'görüntü sırası ekleme sırasına bağlı');
  assertDeepEqual(first, ['a1', 'a2', 'b1', 'me'], 'ad/kimlik eşitlik bozucuları uygulanmadı');

  // Görüntü sırası değişse de sıra NUMARALARI aynı kalır.
  const db = createDatabase();
  addUser(db, 'me', { display_name: 'Zeynep' });
  addUser(db, 'a1', { display_name: 'Ada' });
  addFriendship(db, 'me', 'a1', 'accepted');
  addSeasonRank(db, 'me', 500);
  addSeasonRank(db, 'a1', 500);
  const rows = runLeaderboard(db, 'me');
  assertEqual(rows[0].rank_position, rows[1].rank_position, 'eşit RP sıra numarası ayrıştı');
});

/** Sınır senaryoları için ortak kurulum: `friendCount` arkadaş + kullanıcı. */
function buildLimitDatabase({ friendCount, selfRp }) {
  const db = createDatabase();
  addUser(db, 'me', { display_name: 'zzz-me' });
  addSeasonRank(db, 'me', selfRp);

  for (let index = 0; index < friendCount; index += 1) {
    const id = `friend-${String(index).padStart(4, '0')}`;
    addUser(db, id);
    addFriendship(db, 'me', id, 'accepted');
    // Küçük index = yüksek RP → doğal sıra index ile aynı.
    addSeasonRank(db, id, 5000 - index);
  }

  return db;
}

check('12. Kullanıcı ilk 100 DIŞINDAYKEN: tam 100 satır = kullanıcı + ilk 99', () => {
  const friendCount = SQL_LIMIT + 50;
  // Kullanıcının RP'si en düşük → doğal görüntü sırası en sonda.
  const db = buildLimitDatabase({ friendCount, selfRp: 0 });

  const rows = runLeaderboard(db, 'me');
  const selfRow = rows.find((row) => row.is_self);

  assert(selfRow, 'kendi satırı sınır yüzünden kayboldu');
  assertEqual(rows.length, SQL_LIMIT, 'yanıt sınırı aşıldı');
  assertEqual(rows.filter((row) => row.is_self).length, 1, 'kendi satırı birden fazla kez döndü');

  // Kullanıcı dışındaki satırlar gerçek ilk 99 katılımcı olmalı.
  const others = rows.filter((row) => !row.is_self);
  assertEqual(others.length, SQL_LIMIT - 1, 'kullanıcı + ilk 99 beklenir');
  assertDeepEqual(
    ids(others),
    Array.from({ length: SQL_LIMIT - 1 }, (_, index) => `friend-${String(index).padStart(4, '0')}`),
    'ilk 99 katılımcı seçilmedi',
  );

  // Kendi gerçek sırası ve RP'si DEĞİŞTİRİLMEDİ.
  assertEqual(selfRow.rank_position, friendCount + 1, 'kendi gerçek sırası değiştirildi');
  assertEqual(selfRow.current_rp, 0, 'kendi RP değeri değiştirildi');
  // Toplam katılımcı sayısı sınırdan ETKİLENMEZ.
  assertEqual(selfRow.participant_count, friendCount + 1, 'toplam katılımcı sayısı yanlış');
  assert(
    selfRow.participant_count > rows.length,
    'sınır uygulandığında toplam sayı listeden büyük olmalı',
  );

  // Nihai görünüm gerçek `display_position` sırasında: kullanıcı en sonda.
  assertEqual(rows[rows.length - 1].participant_id, 'me', 'nihai sıralama bozuldu');
});

check('13a. Kullanıcı ilk 100 İÇİNDEYKEN: gerçek ilk 100 satır döner', () => {
  const friendCount = SQL_LIMIT + 50;
  // Kullanıcının RP'si en yüksek → doğal görüntü sırası 1.
  const db = buildLimitDatabase({ friendCount, selfRp: 9999 });

  const rows = runLeaderboard(db, 'me');
  assertEqual(rows.length, SQL_LIMIT, 'yanıt sınırı aşıldı');
  assertEqual(rows.filter((row) => row.is_self).length, 1, 'kendi satırı birden fazla kez döndü');
  assertEqual(rows[0].participant_id, 'me', 'en yüksek RP ilk sırada değil');
  assertEqual(rows[0].rank_position, 1, 'kendi gerçek sırası değiştirildi');

  // Küme GERÇEK ilk 100'dür: kullanıcı + ilk 99 arkadaş.
  assertDeepEqual(
    ids(rows).slice(1),
    Array.from({ length: SQL_LIMIT - 1 }, (_, index) => `friend-${String(index).padStart(4, '0')}`),
    'gerçek ilk 100 satır dönmedi',
  );
  assertEqual(rows[0].participant_count, friendCount + 1, 'toplam katılımcı sayısı yanlış');
});

check('13b. Sınır senaryosunda bekleyen/arkadaş olmayan kullanıcılar DIŞARIDA kalır', () => {
  const db = buildLimitDatabase({ friendCount: SQL_LIMIT + 20, selfRp: 0 });
  // Yüksek RP'li bir bekleyen istek ve bir yabancı: ikisi de sınıra giremez.
  addUser(db, 'pendingUser');
  addFriendship(db, 'me', 'pendingUser', 'pending');
  addSeasonRank(db, 'pendingUser', 99999);
  addUser(db, 'stranger');
  addSeasonRank(db, 'stranger', 99999);

  const rows = runLeaderboard(db, 'me');
  assertEqual(rows.length, SQL_LIMIT, 'yanıt sınırı aşıldı');
  assert(!ids(rows).includes('pendingUser'), 'bekleyen istek sınır listesine sızdı');
  assert(!ids(rows).includes('stranger'), 'yabancı kullanıcı sınır listesine sızdı');
  // Toplam sayı da yalnızca kullanıcı + kabul edilmiş arkadaşları kapsar.
  assertEqual(rows[0].participant_count, SQL_LIMIT + 21, 'toplam katılımcı sayısı kirlenmiş');
});

check('13c. Toplam katılımcı sınırın ALTINDAYKEN herkes döner', () => {
  const db = buildLimitDatabase({ friendCount: 4, selfRp: 100 });
  const rows = runLeaderboard(db, 'me');
  assertEqual(rows.length, 5, 'sınır altındayken satır kaybı var');
  assertEqual(rows.filter((row) => row.is_self).length, 1, 'kendi satırı tekrarlandı');
});

check('13. Oturumsuz (anon) çağrı HİÇ veri döndürmez', () => {
  const db = createDatabase();
  addUser(db, 'me');
  addUser(db, 'friend');
  addFriendship(db, 'me', 'friend', 'accepted');
  addSeasonRank(db, 'me', 300);
  addSeasonRank(db, 'friend', 900);

  assertDeepEqual(runLeaderboard(db, null), [], 'anon çağrı veri döndürdü');
  assertDeepEqual(runLeaderboard(db, undefined), [], 'oturumsuz çağrı veri döndürdü');
});

// ---------------------------------------------------------------------------
// 3 · İstemci satır eşlemesi (gerçekten çalıştırılır)
// ---------------------------------------------------------------------------

check('16. Servis eşlemesi snake_case → camelCase dönüşümünü doğru yapar', () => {
  const db = createDatabase(7);
  addUser(db, 'me', { avatar_url: 'https://example.test/a.png', display_name: 'Ben', username: 'ben' });
  addUser(db, 'friend', { display_name: 'Arkadaş', username: 'arkadas' });
  addFriendship(db, 'me', 'friend', 'accepted');
  addSeasonRank(db, 'me', 500);
  addSeasonRank(db, 'friend', 1700);

  const parsed = rx.parseFriendRankLeaderboard(runLeaderboard(db, 'me'), {
    fallbackRank: 'bronze',
    order: RANK_ORDER,
  });

  assertEqual(parsed.seasonIndex, 7, 'sezon numarası taşınmadı');
  assertEqual(parsed.participantCount, 2, 'katılımcı sayısı taşınmadı');
  assertEqual(parsed.isTruncated, false, 'sınır yokken kesildi sanıldı');
  assertDeepEqual(
    parsed.entries.map((entry) => entry.userId),
    ['friend', 'me'],
    'sunucu sırası korunmadı',
  );

  const self = parsed.entries.find((entry) => entry.isSelf);
  assertEqual(self.displayName, 'Ben', 'display_name → displayName');
  assertEqual(self.username, 'ben', 'username taşınmadı');
  assertEqual(self.avatarUrl, 'https://example.test/a.png', 'avatar_url → avatarUrl');
  assertEqual(self.currentRp, 500, 'current_rp → currentRp');
  assertEqual(self.currentRank, rankForRp(500), 'current_rank → currentRank');
  assertEqual(self.position, 2, 'rank_position → position');
  assertEqual(self.isRanked, true, 'is_ranked → isRanked');

  // Ham snake_case alanlar istemci nesnesine SIZMAZ.
  for (const key of ['participant_id', 'current_rp', 'is_self', 'rank_position']) {
    assert(!(key in self), `ham alan sızdı: ${key}`);
  }
});

check('17. Sıralanmamış satır Bronze veya 0 RP’ye ZORLANMAZ', () => {
  const db = createDatabase(5);
  addUser(db, 'me');
  addUser(db, 'stale');
  addFriendship(db, 'me', 'stale', 'accepted');
  addSeasonRank(db, 'me', 300);
  addSeasonRank(db, 'stale', 1700, { season_index: 4 });

  const parsed = rx.parseFriendRankLeaderboard(runLeaderboard(db, 'me'), {
    fallbackRank: 'bronze',
    order: RANK_ORDER,
  });
  const stale = parsed.entries.find((entry) => entry.userId === 'stale');

  assertEqual(stale.isRanked, false, 'isRanked yanlış');
  assertEqual(stale.currentRank, undefined, 'rank Bronze’a zorlandı');
  assertEqual(stale.currentRp, undefined, 'RP 0’a zorlandı');
  assertEqual(stale.position, undefined, 'sıra uydurulmuş');
});

check('18. Bilinmeyen rank kimliği ve bozuk satır uygulamayı ÇÖKERTMEZ', () => {
  const parsed = rx.parseFriendRankLeaderboard(
    [
      // Sunucu ileride yeni bir tier eklerse eski istemci güvenli tier'a düşer.
      {
        current_rank: 'mythic',
        current_rp: 5000,
        is_ranked: true,
        is_self: true,
        participant_count: 4,
        participant_id: 'me',
        rank_position: 1,
        season_index: 5,
      },
      // Kimliksiz satır DÜŞER.
      { current_rp: 10, is_ranked: true, participant_id: null, rank_position: 2 },
      // `is_ranked` doğru ama RP tutarsız → güvenli biçimde sıralanmamış sayılır.
      {
        current_rp: -5,
        is_ranked: true,
        participant_id: 'broken',
        rank_position: 0,
      },
      // Aynı katılımcı iki kez gelirse ilk satır kalır.
      { is_ranked: false, is_self: true, participant_id: 'me' },
    ],
    { fallbackRank: 'bronze', order: RANK_ORDER },
  );

  assertDeepEqual(
    parsed.entries.map((entry) => entry.userId),
    ['me', 'broken'],
    'bozuk satırlar beklenen biçimde ele alınmadı',
  );
  assertEqual(parsed.entries[0].currentRank, 'bronze', 'bilinmeyen tier güvenli tier’a düşmedi');
  assertEqual(parsed.entries[0].currentRp, 5000, 'geçerli RP kaybedildi');
  assertEqual(parsed.entries[1].isRanked, false, 'tutarsız satır sıralanmış sayıldı');
  assertEqual(parsed.entries[1].currentRp, undefined, 'tutarsız satırda RP üretildi');

  // Boş/eksik yanıt da güvenli.
  assertDeepEqual(
    rx.parseFriendRankLeaderboard(null, { fallbackRank: 'bronze', order: RANK_ORDER }).entries,
    [],
    'null yanıt çökertti',
  );
});

check('19. Sınır uygulandığında istemci "herkes gösteriliyor" DEMEZ', () => {
  const db = createDatabase();
  addUser(db, 'me', { display_name: 'zzz-me' });
  addSeasonRank(db, 'me', 0);
  for (let index = 0; index < SQL_LIMIT + 10; index += 1) {
    const id = `friend-${String(index).padStart(4, '0')}`;
    addUser(db, id);
    addFriendship(db, 'me', id, 'accepted');
    addSeasonRank(db, id, 1000 + index);
  }

  const parsed = rx.parseFriendRankLeaderboard(runLeaderboard(db, 'me'), {
    fallbackRank: 'bronze',
    order: RANK_ORDER,
  });

  assertEqual(parsed.isTruncated, true, 'kesilmiş yanıt tam sanıldı');
  assert(
    parsed.participantCount > parsed.entries.length,
    'toplam katılımcı sayısı gösterilenden büyük olmalı',
  );
  assertEqual(rx.FRIEND_RANK_LEADERBOARD_LIMIT, SQL_LIMIT, 'istemci sabiti SQL sınırıyla ayrışıyor');
  assert(screenSource.includes('limitNote'), 'ekran sınır açıklamasını göstermiyor');
});

// ---------------------------------------------------------------------------
// Katman 3 — STATİK: RPC güvenlik sınırı ve regresyon
// ---------------------------------------------------------------------------

check('20. RPC güvenlik duruşu: definer, search_path, grant/revoke', () => {
  assert(
    /create or replace function public\.get_friends_rank_leaderboard\(\)/.test(leaderboardCode),
    'RPC beklenen adla tanımlanmamış',
  );
  // PARAMETRE YOK: aktif kullanıcı yalnızca auth.uid() ile belirlenir.
  assert(
    !/function public\.get_friends_rank_leaderboard\(\s*\w/.test(leaderboardCode),
    'RPC kullanıcı kimliği parametresi alıyor',
  );
  assert(leaderboardCode.includes('security definer'), 'security definer yok');
  assert(leaderboardCode.includes("set search_path = ''"), "search_path = '' yok");
  assert(leaderboardCode.includes('stable'), 'fonksiyon stable değil');

  assert(
    leaderboardCode.includes(
      'revoke all on function public.get_friends_rank_leaderboard() from public',
    ),
    'public execute yetkisi kaldırılmamış',
  );
  assert(
    leaderboardCode.includes(
      'revoke all on function public.get_friends_rank_leaderboard() from anon',
    ),
    'anon execute yetkisi kaldırılmamış',
  );
  assert(
    leaderboardCode.includes(
      'grant execute on function public.get_friends_rank_leaderboard() to authenticated',
    ),
    'authenticated execute yetkisi verilmemiş',
  );

  // Her nesne şema-nitelikli olmalı.
  for (const object of ['public.friendships', 'public.profiles', 'public.user_season_ranks']) {
    assert(leaderboardCode.includes(object), `şema-nitelikli erişim yok: ${object}`);
  }
});

check('21. RPC kapsamı SQL düzeyinde arkadaşlıkla sınırlı', () => {
  assert(leaderboardCode.includes("f.status = 'accepted'"), 'kabul edilmiş filtresi yok');
  assert(
    leaderboardCode.includes('a.id in (f.requester_id, f.receiver_id)'),
    'aktif kullanıcı ilişkinin tarafı olmak zorunda değil',
  );
  assert(
    (leaderboardCode.match(/a\.id is not null/g) ?? []).length >= 2,
    'auth.uid() null kontrolü eksik',
  );
  assert(
    leaderboardCode.includes('usr.finalized_at is null'),
    'kapanmış sezon satırı dışlanmıyor',
  );
  assert(
    leaderboardCode.includes('public.rank_season_index_for(current_date)'),
    'sezon sunucu tarihinden belirlenmiyor',
  );
  assert(leaderboardCode.includes('dense_rank()'), 'dense_rank kullanılmıyor');
  // İstemci sezon/RP/rank gönderemez: sorguda hiçbir parametre yok.
  assert(!/\$\d/.test(leaderboardCode), 'SQL istemci parametresi kullanıyor');

  /**
   * Modelin `status` sözlüğü GERÇEK şemaya sabitlenir: `friendships.status`
   * yalnızca `pending` ve `accepted` alabiliyorsa "yalnızca kabul edilmişler"
   * iddiası tam olarak "pending hariç" demektir. Şemaya üçüncü bir durum
   * eklenirse bu kontrol düşer ve kapsam yeniden gözden geçirilir.
   */
  const statusCheck = friendsSql.match(
    /status text not null default 'pending' check \(status in \(([^)]+)\)\)/,
  );
  assert(statusCheck, 'friendships.status kısıtı okunamadı');
  assertDeepEqual(
    statusCheck[1].split(',').map((part) => part.trim().replace(/^'|'$/g, '')).sort(),
    ['accepted', 'pending'],
    'friendships.status sözlüğü değişmiş — leaderboard kapsamı gözden geçirilmeli',
  );
});

check('21b. Yanıt sınırı: seçim penceresi, `or is_self` muafiyeti YOK', () => {
  // Sınır SEÇİM penceresinde uygulanır; gerçek görüntü sırası kesilmez.
  assert(
    leaderboardCode.includes('selection_position <= 100'),
    'sınır seçim penceresinde uygulanmıyor',
  );
  assert(
    /row_number\(\) over \(order by o\.is_self desc, o\.display_position asc\)/.test(
      leaderboardCode,
    ),
    'seçim penceresi kullanıcıyı garanti etmiyor',
  );
  // ESKİ HATALI kalıp geri gelmemeli: 101 satır üretiyordu.
  assert(
    !/display_position <= \d+\s+or\s+\w+\.is_self/.test(leaderboardCode),
    'eski `<= 100 OR is_self` sınırı hâlâ duruyor (101 satır riski)',
  );
  // Nihai sıralama yine GERÇEK görüntü sırası.
  assert(
    /order by o\.display_position;/.test(leaderboardCode),
    'nihai sıralama gerçek display_position değil',
  );
  // Toplam sayı sınırdan ÖNCE hesaplanır.
  assert(
    /count\(\*\) over \(\) as participant_count/.test(leaderboardCode),
    'toplam katılımcı sayısı sınırdan önce hesaplanmıyor',
  );
  // Gerçek sıra/görüntü değerleri kullanıcıyı listeye sokmak için değişmez.
  assert(
    !/is_self[\s\S]{0,80}(rank_position|display_position)\s*=/.test(leaderboardCode),
    'kendi satırı için gerçek sıra değeri değiştiriliyor',
  );
});

check('22. RPC yasak alanları DÖNDÜRMEZ', () => {
  const returnsBlock = leaderboardCode.slice(
    leaderboardCode.indexOf('returns table'),
    leaderboardCode.indexOf('language sql'),
  );
  for (const forbidden of [
    'email',
    'rose',
    'xp',
    'level',
    'bio',
    'training_goal',
    'friendship_id',
    'requester_id',
    'receiver_id',
    'metadata',
    'workout',
    'discipline',
    'peak_rp',
    'starting_rp',
  ]) {
    assert(!returnsBlock.includes(forbidden), `yasak alan dönüş tipinde: ${forbidden}`);
  }
  // Gövde de yasak tablolara hiç dokunmamalı.
  for (const table of [
    'public.rank_events',
    'public.reward_ledger',
    'public.user_progress',
    'public.workout_sessions',
    'public.shared_discipline_days',
    'auth.users',
  ]) {
    assert(!leaderboardCode.includes(table), `yasak tabloya erişim: ${table}`);
  }
});

check('23. Eski `get_friend_rank` davranışı KORUNUR', () => {
  // Yeni migration eski RPC'ye hiç dokunmaz.
  // Yorum metni eski RPC'yi ANLATABİLİR; kontrol yalnızca gerçek SQL üzerinde.
  assert(
    !leaderboardCode.includes('get_friend_rank('),
    'yeni migration eski RPC’yi değiştiriyor',
  );
  // Eski migration dosyaları çalışma ağacında DEĞİŞMEMİŞ olmalı.
  const changed = execFileSync(
    'git',
    ['status', '--porcelain', RANKS_SQL_PATH, FRIENDS_SQL_PATH],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assertEqual(changed.trim(), '', 'uygulanmış migration dosyaları değiştirilmiş');
  // Eski RPC hâlâ are_friends ile korunuyor.
  assert(
    /get_friend_rank[\s\S]{0,900}public\.are_friends/.test(ranksSql),
    'get_friend_rank arkadaşlık korumasını kaybetmiş',
  );
});

check('24. İstemci sunucuya kimlik/sezon/RP GÖNDERMEZ', () => {
  assert(
    serviceSource.includes("supabase.rpc('get_friends_rank_leaderboard')"),
    'servis RPC’yi parametresiz çağırmıyor',
  );
  // Çağrının argüman listesi YALNIZCA fonksiyon adını içermeli.
  const callStart = serviceSource.indexOf("supabase.rpc('get_friends_rank_leaderboard'");
  assert(callStart >= 0, 'RPC çağrısı bulunamadı');
  const callTail = serviceSource.slice(callStart);
  assertEqual(
    callTail.slice(0, callTail.indexOf(')') + 1),
    "supabase.rpc('get_friends_rank_leaderboard')",
    'RPC çağrısına parametre geçiliyor',
  );
  // Ekran doğrudan Supabase istemcisine dokunmaz.
  assert(!screenSource.includes('supabase'), 'ekran doğrudan Supabase kullanıyor');
  assert(
    screenSource.includes("from '@/services/ranks'"),
    'ekran servis katmanını kullanmıyor',
  );
});

check('25. Ekran: polling/Realtime yok, odak + pull-to-refresh var', () => {
  // Yorumlar hariç tutulur: dosya zaten "polling YOKTUR" diye belgeleniyor.
  const screenCode = screenSource
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  assert(!/setInterval|setTimeout/.test(screenCode), 'ekranda zamanlayıcı/polling var');
  assert(!/channel\(|subscribe\(|realtime/i.test(screenCode), 'Realtime aboneliği var');
  assert(screenSource.includes('useFocusEffect'), 'odaklanınca yükleme yok');
  assert(screenSource.includes('RefreshControl'), 'pull-to-refresh yok');
  // Mevcut güvenli rank yenileme metodu kullanılır; ikinci sync sistemi yok.
  assert(screenSource.includes('syncRank'), 'mevcut rank yenileme metodu kullanılmıyor');
  assert(
    !/sync_my_rank|fetchMyRankEvents|fetchMyRankHistory/.test(screenSource),
    'ekran ikinci bir rank hesaplama/senkronizasyon yolu kuruyor',
  );
  // Yarış koruması.
  assert(screenSource.includes('loadIdRef'), 'eski cevabı engelleyen yarış koruması yok');
});

check('26. Ekran: kendi satırı TEK KEZ görünür ve tasarım ailesi korunur', () => {
  assert(
    screenSource.includes('entries.filter((entry) => !entry.isSelf)'),
    'kendi satırı listeden çıkarılmıyor (iki kez görünebilir)',
  );
  assert(screenSource.includes('useFriendsPalette'), 'arkadaşlık paleti kullanılmıyor');
  assert(screenSource.includes('FriendsMetrics'), 'arkadaşlık ölçüleri kullanılmıyor');
  assert(screenSource.includes('RankBadge'), 'mevcut rank rozeti yeniden kullanılmıyor');
  assert(screenSource.includes('MotionListItem'), 'mevcut motion bileşenleri kullanılmıyor');
  // Neon/gradient yok.
  assert(!/gradient|shadowRadius|glow/i.test(screenSource), 'ağır gölge/gradient eklenmiş');
  // Ekranda sabit kullanıcı metni yok.
  assert(
    !/<Text[^>]*>\s*[A-ZĞÜŞİÖÇ][a-zğüşıöç]/.test(screenSource),
    'ekranda çeviriden geçmeyen sabit metin var',
  );
  // Navigasyon hedefleri mevcut ekranlar.
  assert(screenSource.includes("router.push('/rank')"), 'kendi satırı rank ekranını açmıyor');
  assert(
    screenSource.includes("pathname: '/profile/[userId]'"),
    'arkadaş satırı mevcut profil ekranını açmıyor',
  );
});

check('27. Erişim noktası: üç nokta menüsü, yeni sekme YOK', () => {
  assert(
    friendsScreenSource.includes("router.push('/friends/leaderboard')"),
    'menüden sıralama ekranı açılmıyor',
  );
  assert(
    friendsScreenSource.includes("t('friends.leaderboard.menuAction')"),
    'menü metni çeviriden gelmiyor',
  );
  // Mevcut üç eylem korunmuş.
  for (const key of ["t('friends.refresh')", "t('friends.findFriend')", "t('common.cancel')"]) {
    assert(friendsScreenSource.includes(key), `mevcut menü eylemi kaybolmuş: ${key}`);
  }
  // Sekme listesi hâlâ ÜÇ öğe.
  const tabsBlock = friendsScreenSource.slice(
    friendsScreenSource.indexOf('<FriendsTabs'),
    friendsScreenSource.indexOf('onSelect={setSelectedTab}'),
  );
  assertEqual((tabsBlock.match(/key: '/g) ?? []).length, 3, 'arkadaşlık sekmesi sayısı değişmiş');
  // Alt sekme çubuğuna yeni sekme eklenmemiş.
  const tabsLayout = source('app/(tabs)/_layout.tsx');
  assert(!tabsLayout.includes('leaderboard'), 'alt sekme çubuğuna yeni sekme eklenmiş');
  // Kök Stack’e kayıtlı.
  assert(
    source('app/_layout.tsx').includes('name="friends/leaderboard"'),
    'ekran kök Stack’e eklenmemiş',
  );
});

check('28. Çeviriler iki dilde de tam', () => {
  for (const key of [
    'leaderboard',
    'menuAction',
    'unranked',
    'emptyTitle',
    'emptyBody',
    'limitNote',
    'unknownUser',
    'rankedA11y',
    'unrankedA11y',
  ]) {
    assert(localeTr.includes(`${key}:`), `tr sözlüğünde ${key} yok`);
    assert(localeEn.includes(`${key}:`), `en sözlüğünde ${key} yok`);
  }
  assert(localeTr.includes("menuAction: 'Sezon sıralaması'"), 'TR menü metni beklenen değil');
  assert(localeEn.includes("menuAction: 'Season ranking'"), 'EN menü metni beklenen değil');
  // Erişilebilirlik etiketleri ekranda gerçekten kullanılıyor.
  assert(screenSource.includes('accessibilityLabel'), 'erişilebilirlik etiketi kullanılmıyor');
  assert(screenSource.includes('accessibilityRole'), 'erişilebilirlik rolü kullanılmıyor');
});

check('29. Sıralama özelliği KENDİ sınırlarının içinde kalıyor', () => {
  /**
   * BU KONTROL GIT'E HİÇ BAKMAZ.
   *
   * Önceki sürümleri "şu dosyalar HEAD'e göre değişmemiş olmalı" diye
   * denetliyordu. Bu kalıcı bir regresyon testi değildir:
   *   * commit sonrası diff boşalır ve kontrol sessizce anlamsızlaşır,
   *   * commit öncesi ise gelecekteki MEŞRU değişiklikleri gereksiz yere
   *     engeller.
   *
   * Kalıcı olan güvence "hangi dosya değişti" değil, SEMANTİK sınırdır:
   * arkadaş sıralaması kendi ekranında ve kendi servisinde yaşar; rank ekranı
   * ve rank rehberi ona hiç dokunmaz. Aşağıdaki kontroller yalnızca dosya
   * İÇERİĞİNE bakar, çalışma ağacına veya commit durumuna DEĞİL.
   */

  /** Sıralama özelliğinin yalnızca kendisine ait olan yüzeyleri. */
  const LEADERBOARD_SURFACE = [
    'fetchFriendsRankLeaderboard',
    'FriendRankLeaderboard',
    '/friends/leaderboard',
    'get_friends_rank_leaderboard',
  ];

  // 1) Özelliğin kendi dosyaları yerinde.
  for (const path of [LEADERBOARD_SQL_PATH, 'app/friends/leaderboard.tsx', 'services/ranks.ts']) {
    assert(source(path).length > 0, `özelliğin kendi dosyası bulunamadı: ${path}`);
  }

  // 2) Rank ekranı sıralamaya HİÇ dokunmaz.
  const rankScreen = source('app/rank.tsx');
  for (const leak of LEADERBOARD_SURFACE) {
    assert(!rankScreen.includes(leak), `sıralama özelliği rank ekranına sızmış: ${leak}`);
  }

  // 3) Rank rehberi de sıralama servisini/RPC'sini kullanmaz.
  const rankGuide = source('app/rank-guide.tsx');
  for (const leak of LEADERBOARD_SURFACE) {
    assert(!rankGuide.includes(leak), `sıralama özelliği rank rehberine sızmış: ${leak}`);
  }
  // Rehber salt okunur bir açıklama ekranıdır: hiç ağ isteği yapmaz.
  assert(!rankGuide.includes('supabase'), 'rank rehberi doğrudan Supabase kullanıyor');

  // 4) Sıralama ekranı hâlâ KENDİ servisini kullanıyor.
  const leaderboardScreen = source('app/friends/leaderboard.tsx');
  assert(
    leaderboardScreen.includes('fetchFriendsRankLeaderboard'),
    'sıralama ekranı kendi servisini kullanmıyor',
  );
  assert(
    leaderboardScreen.includes("from '@/services/ranks'"),
    'sıralama ekranı servis katmanını atlıyor',
  );
  assert(
    serviceSource.includes("supabase.rpc('get_friends_rank_leaderboard')"),
    'servis katmanı sıralama RPC’sini çağırmıyor',
  );
});

// ---------------------------------------------------------------------------
// MUTATION TESTLERİ — bozuk implementasyon gerçekten düşüyor mu?
// ---------------------------------------------------------------------------

check('M1. `pending` ilişkiyi kapsayan model testten DÜŞER', () => {
  const db = createDatabase();
  addUser(db, 'me');
  addUser(db, 'pendingUser');
  addFriendship(db, 'me', 'pendingUser', 'pending');
  addSeasonRank(db, 'me', 300);
  addSeasonRank(db, 'pendingUser', 900);

  // Kasıtlı hata: status filtresi yok.
  const broken = new Set(['me']);
  for (const friendship of db.friendships) {
    if (friendship.requester_id === 'me') broken.add(friendship.receiver_id);
  }

  assertThrows(
    () => assertEqual(broken.size, 1, 'mutation'),
    'status filtresiz model testten geçti — bekleyen istek sızıntısı yakalanmıyor',
  );
  assertDeepEqual(ids(runLeaderboard(db, 'me')), ['me'], 'doğru model sızdırıyor');
});

check('M2. `row_number()` kullanan sıra numarası testten DÜŞER', () => {
  const rps = [500, 500, 200];
  // Kasıtlı hata: dense_rank yerine sıra numarası.
  const brokenPositions = rps.map((_, index) => index + 1);
  assertThrows(
    () => assertEqual(brokenPositions[0], brokenPositions[1], 'mutation'),
    'row_number kullanan model testten geçti — eşit RP kontrolü etkisiz',
  );

  const unique = [...new Set(rps)].sort((left, right) => right - left);
  const correct = rps.map((rp) => unique.indexOf(rp) + 1);
  assertDeepEqual(correct, [1, 1, 2], 'doğru dense_rank sonucu değişmiş');
});

check('M3. Eski sezon satırını güncelmiş sayan model testten DÜŞER', () => {
  const db = createDatabase(5);
  addUser(db, 'stale');
  addSeasonRank(db, 'stale', 1700, { season_index: 4 });

  // Kasıtlı hata: sezon filtresi yok, en son satır alınıyor.
  const brokenRow = db.userSeasonRanks.find((row) => row.user_id === 'stale');
  assertThrows(
    () => assertEqual(brokenRow, undefined, 'mutation'),
    'sezon filtresiz model testten geçti — eski rank sızıntısı yakalanmıyor',
  );

  const correctRow = db.userSeasonRanks.find(
    (row) =>
      row.user_id === 'stale' && row.season_index === db.currentSeasonIndex && row.finalized_at === null,
  );
  assertEqual(correctRow, undefined, 'doğru model eski sezon satırını alıyor');
});

check('M4. Eski `<= 100 OR is_self` modeli 101 satır ürettiği için DÜŞER', () => {
  const rows = Array.from({ length: SQL_LIMIT + 5 }, (_, index) => ({
    display_position: index + 1,
    is_self: index === SQL_LIMIT + 4,
  }));

  /**
   * ESKİ HATALI DAVRANIŞ: kendi satırı sınırdan muaf tutuluyordu; kullanıcı
   * ilk 100 dışındaysa yanıt 101 satıra çıkıyor ve belirtilen sınırı ihlal
   * ediyordu.
   */
  const brokenKept = rows.filter((row) => row.display_position <= SQL_LIMIT || row.is_self);
  assertEqual(brokenKept.length, SQL_LIMIT + 1, 'eski model gerçekten 101 satır üretmeli');
  assertThrows(
    () => assertEqual(brokenKept.length, SQL_LIMIT, 'mutation'),
    'eski `<= 100 OR is_self` modeli testten geçti — sınır ihlali yakalanmıyor',
  );

  /** Kasıtlı ikinci hata: muafiyetsiz düz kesme kullanıcıyı DÜŞÜRÜR. */
  const naiveKept = rows.filter((row) => row.display_position <= SQL_LIMIT);
  assertEqual(naiveKept.length, SQL_LIMIT, 'düz kesme sınırı tutmalı');
  assertThrows(
    () => assert(naiveKept.some((row) => row.is_self), 'mutation'),
    'muafiyetsiz sınır testten geçti — kendi satırının kaybı yakalanmıyor',
  );

  // DOĞRU model: seçim penceresi hem sınırı hem kullanıcıyı garanti eder.
  const selected = [...rows]
    .sort((left, right) => {
      if (left.is_self !== right.is_self) return left.is_self ? -1 : 1;
      return left.display_position - right.display_position;
    })
    .slice(0, SQL_LIMIT);
  assertEqual(selected.length, SQL_LIMIT, 'doğru model sınırı aşıyor');
  assert(selected.some((row) => row.is_self), 'doğru model kendi satırını kaybediyor');
});

// ---------------------------------------------------------------------------

rmSync(outDir, { force: true, recursive: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Arkadaş sıralaması harness: ${passed} kontrol geçti.`);
console.log('  (Canlı Postgres yok — SQL çalıştırılmadı, modellendi ve statik denetlendi.)');
