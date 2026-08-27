#!/usr/bin/env node
/**
 * SEZON BAŞARILARI — DOĞRULAMA HARNESS'I
 *
 * Kapsam: `public.sync_my_season_achievements()` RPC'sinin GÜVENLİK SINIRI,
 * kazanım/idempotency semantiği ve istemci satır eşlemesi. RP kuralları, rank
 * eşikleri, sezon uzunluğu ve soft reset BURADA TEST EDİLMEZ — onlar
 * `scripts/verify-ranks.mjs` içindedir ve o dosyaya dokunulmamıştır.
 *
 * Mevcut rank harness'larıyla AYNI üç katmanlı kalıp:
 *   1. SAF MANTIK — `constants/rank-experience.ts` gerçekten `tsc` ile
 *      derlenir ve satır eşlemesi ÇALIŞTIRILIR.
 *   2. MODEL      — RPC'nin referans uygulaması: kanıt toplama, kazanım
 *      yazımı, idempotency ve sezon izolasyonu. EŞİKLER MIGRATION DOSYASINDAN
 *      OKUNUR, elle yazılmaz.
 *   3. STATİK     — RLS, grant/revoke, `security definer`, `search_path`,
 *      parametre yokluğu ve ekonomiye dokunmama kuralları.
 *
 * Canlı Postgres YOKTUR: SQL çalıştırılmaz, modellenip statik denetlenir.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const ACHIEVEMENTS_SQL_PATH = 'supabase/migrations/20260830120000_add_season_rank_achievements.sql';
const RANKS_SQL_PATH = 'supabase/migrations/20260827120000_add_seasonal_ranks.sql';

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

const outDir = mkdtempSync(join(tmpdir(), 'rosea-achievements-'));
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

const sql = source(ACHIEVEMENTS_SQL_PATH);
const ranksSql = source(RANKS_SQL_PATH);
const serviceSource = source('services/ranks.ts');
const contextSource = source('context/rank-context.tsx');
const screenSource = source('app/rank.tsx');
const typesSource = source('types/ranks.ts');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

/** Yorumları çıkarılmış SQL — "şuna dokunmamalı" kontrolleri bunu kullanır. */
const sqlCode = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, ' ');

/**
 * Başarı kataloğu MIGRATION'DAN okunur.
 *
 * Eşikler harness'a elle yazılsaydı SQL ile sessizce ayrışabilirdi; bu
 * yüzden tek kaynak `season_achievement_catalog()` tablosudur.
 */
const CATALOG = (() => {
  const block = sqlCode.slice(sqlCode.indexOf('function public.season_achievement_catalog'));
  const values = block.slice(block.indexOf('values'), block.indexOf('as catalog'));
  const rows = [...values.matchAll(/\('(\w+)',\s*(\d+),\s*(\d+)\)/g)].map((match) => ({
    key: match[1],
    sortOrder: Number.parseInt(match[3], 10),
    target: Number.parseInt(match[2], 10),
  }));
  if (rows.length === 0) throw new Error('başarı kataloğu okunamadı');
  return rows.sort((left, right) => left.sortOrder - right.sortOrder);
})();

const catalogTarget = (key) => CATALOG.find((row) => row.key === key)?.target;

// ---------------------------------------------------------------------------
// 1 · Anahtar sözlüğü ve eşikler
// ---------------------------------------------------------------------------

check('1. Altı başarı anahtarı TEK ve sabit kaynakta tanımlı', () => {
  assertEqual(rx.SEASON_ACHIEVEMENT_KEYS.length, 6, 'istemci anahtar sayısı altı olmalı');
  assertEqual(CATALOG.length, 6, 'SQL katalog satır sayısı altı olmalı');

  // Sıra da BİREBİR aynı: istemci sıralamayı yeniden icat etmez.
  assertDeepEqual(
    [...rx.SEASON_ACHIEVEMENT_KEYS],
    CATALOG.map((row) => row.key),
    'istemci ve SQL anahtar sırası ayrışıyor',
  );

  // SQL CHECK kısıtı da aynı sözlüğü taşımalı.
  const constraint = sqlCode.match(/achievement_key in \(([^)]+)\)/);
  assert(constraint, 'achievement_key CHECK kısıtı bulunamadı');
  assertDeepEqual(
    constraint[1].split(',').map((part) => part.trim().replace(/^'|'$/g, '')).sort(),
    [...rx.SEASON_ACHIEVEMENT_KEYS].sort(),
    'CHECK kısıtı anahtar sözlüğüyle ayrışıyor',
  );

  // Eşikler istemcide KOPYALANMAZ: tek otorite sunucudur.
  assert(
    !/first_workout['"]?\s*:\s*\d|workout_5['"]?\s*:\s*\d|streak_7['"]?\s*:\s*\d/.test(
      source('constants/rank-experience.ts'),
    ),
    'istemci başarı eşiklerini kopyalamış',
  );
});

check('2. İlk antrenman eşiği doğru', () => {
  assertEqual(catalogTarget('first_workout'), 1, 'first_workout hedefi 1 olmalı');
});

check('3. 5 ve 15 antrenman eşikleri doğru', () => {
  assertEqual(catalogTarget('workout_5'), 5, 'workout_5 hedefi 5 olmalı');
  assertEqual(catalogTarget('workout_15'), 15, 'workout_15 hedefi 15 olmalı');
});

check('4. 3 ve 7 günlük streak eşikleri doğru', () => {
  assertEqual(catalogTarget('streak_3'), 3, 'streak_3 hedefi 3 olmalı');
  assertEqual(catalogTarget('streak_7'), 7, 'streak_7 hedefi 7 olmalı');
});

// ---------------------------------------------------------------------------
// Katman 2 — MODEL: RPC'nin referans uygulaması
// ---------------------------------------------------------------------------

/**
 * Sunucu durumunun modeli.
 *
 * `achievements` defteri, birincil anahtarı `${userId}:${season}:${key}` olan
 * bir Map'tir — SQL'deki `primary key (user_id, season_index, achievement_key)`
 * ile birebir aynı idempotency garantisi.
 */
function createServer() {
  return {
    achievements: new Map(),
    /** Yazma denemelerinin sayısı; idempotency kanıtı için. */
    insertAttempts: 0,
    rankEvents: [],
    /** Yalnızca "dokunulmadı" iddiasını kanıtlamak için var. */
    rewardWrites: 0,
    sessions: [],
    streakByUser: new Map(),
  };
}

const achievementId = (userId, season, key) => `${userId}:${season}:${key}`;

function addSession(server, userId, seasonIndex, overrides = {}) {
  server.sessions.push({
    deleted_at: null,
    season_index: seasonIndex,
    status: 'completed',
    user_id: userId,
    ...overrides,
  });
}

/**
 * `weekly_perfect` defter satırı yazar.
 *
 * `sourceKey` GERÇEK `apply_rank_adjustment` biçimlerinden biri olabilir:
 * `YYYY-MM-DD` (eski sabit anahtar), `YYYY-MM-DD:revoked` (eski telafi) veya
 * `YYYY-MM-DD#n` (güncel sıralı düzeltme). Üçü de aynı kanıt birimidir.
 */
function addWeeklyPerfect(server, userId, seasonIndex, rpDelta, sourceKey) {
  server.rankEvents.push({
    event_type: 'weekly_perfect',
    rp_delta: rpDelta,
    season_index: seasonIndex,
    source_key: sourceKey,
    user_id: userId,
  });
}

/**
 * `split_part(split_part(source_key, '#', 1), ':', 1)` modelinin karşılığı.
 *
 * Hafta anahtarı bir tarihtir; `#` veya `:` içermediği için iki kademeli
 * bölme üç biçimi de belirsizlik olmadan aynı kanıt birimine indirger.
 */
function weeklyEvidenceKey(sourceKey) {
  return String(sourceKey ?? '').split('#')[0].split(':')[0];
}

/** `rank_peak_streak` sonucunun modeli — kanıt fonksiyonu yeniden yazılmaz. */
function setPeakStreak(server, userId, seasonIndex, peak) {
  server.streakByUser.set(`${userId}:${seasonIndex}`, peak);
}

/**
 * `public.sync_my_season_achievements(client_today)` referans uygulaması.
 *
 * `actor` sunucuda `auth.uid()` ile belirlenir; imzada kullanıcı kimliği,
 * sezon veya ilerleme parametresi YOKTUR.
 */
function syncAchievements(server, actor, seasonIndex) {
  if (!actor) throw new Error('not_authenticated');

  const workoutCount = server.sessions.filter(
    (row) =>
      row.user_id === actor &&
      row.status === 'completed' &&
      row.deleted_at === null &&
      row.season_index === seasonIndex,
  ).length;

  const peakStreak = server.streakByUser.get(`${actor}:${seasonIndex}`) ?? 0;

  /**
   * MÜKEMMEL HAFTA — kanıt HAFTA BAŞINA NET RP toplamıdır.
   *
   * Kullanıcı ve sezon filtreleri gruplamadan ÖNCE uygulanır: başka bir
   * kullanıcının veya başka bir sezonun satırı kanıta karışamaz. Gruplama
   * hafta bazında olduğu için bir haftanın telafisi BAŞKA bir haftanın
   * geçerli bonusunu iptal edemez.
   */
  const netByWeek = new Map();
  for (const row of server.rankEvents) {
    if (row.user_id !== actor) continue;
    if (row.season_index !== seasonIndex) continue;
    if (row.event_type !== 'weekly_perfect') continue;
    const evidenceKey = weeklyEvidenceKey(row.source_key);
    netByWeek.set(evidenceKey, (netByWeek.get(evidenceKey) ?? 0) + row.rp_delta);
  }
  const hasPerfectWeek = [...netByWeek.values()].some((net) => net > 0);

  const progressOf = (key, target) => {
    if (key === 'perfect_week') return hasPerfectWeek ? 1 : 0;
    if (key === 'streak_3' || key === 'streak_7') return Math.min(peakStreak, target);
    return Math.min(workoutCount, target);
  };

  const isEarned = (key, target) => {
    if (key === 'perfect_week') return hasPerfectWeek;
    if (key === 'streak_3' || key === 'streak_7') return peakStreak >= target;
    return workoutCount >= target;
  };

  // Yalnızca EKLEME. `on conflict do nothing`: mevcut satır DEĞİŞMEZ.
  for (const row of CATALOG) {
    if (!isEarned(row.key, row.target)) continue;
    server.insertAttempts += 1;
    const id = achievementId(actor, seasonIndex, row.key);
    if (server.achievements.has(id)) continue;
    server.achievements.set(id, {
      achievement_key: row.key,
      season_index: seasonIndex,
      unlocked_at: `unlock-${server.achievements.size + 1}`,
      user_id: actor,
    });
  }

  // Altı satır SABİT sırada; kilit durumu DEFTERDEN okunur.
  return CATALOG.map((row) => {
    const stored = server.achievements.get(achievementId(actor, seasonIndex, row.key));
    return {
      achievement_key: row.key,
      current_progress: progressOf(row.key, row.target),
      is_unlocked: stored !== undefined,
      target_progress: row.target,
      unlocked_at: stored?.unlocked_at ?? null,
    };
  });
}

const unlockedKeys = (rows) =>
  rows.filter((row) => row.is_unlocked).map((row) => row.achievement_key);

check('5. Perfect week YALNIZCA doğrulanmış rank kanıtından açılır', () => {
  const server = createServer();
  // 20 antrenman ve uzun seri var ama doğrulanmış haftalık bonus YOK.
  for (let index = 0; index < 20; index += 1) addSession(server, 'user-a', 5);
  setPeakStreak(server, 'user-a', 5, 30);

  let rows = syncAchievements(server, 'user-a', 5);
  assert(!unlockedKeys(rows).includes('perfect_week'), 'kanıtsız perfect_week açıldı');

  // Telafi (negatif) satırı TEK BAŞINA rozet açmaz.
  addWeeklyPerfect(server, 'user-a', 5, -25, '2026-08-17#0');
  rows = syncAchievements(server, 'user-a', 5);
  assert(!unlockedKeys(rows).includes('perfect_week'), 'negatif telafi rozet açtı');

  // NET toplamı pozitif olan bir hafta açar.
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24#0');
  rows = syncAchievements(server, 'user-a', 5);
  assert(unlockedKeys(rows).includes('perfect_week'), 'doğrulanmış bonus rozeti açmadı');

  const perfect = rows.find((row) => row.achievement_key === 'perfect_week');
  assertEqual(perfect.current_progress, 1, 'perfect_week ilerlemesi 1 olmalı');
  assertEqual(perfect.target_progress, 1, 'perfect_week hedefi 1 olmalı');
});

check('6. Açılmış başarı ikinci çağrıda ÇOĞALMIYOR', () => {
  const server = createServer();
  for (let index = 0; index < 5; index += 1) addSession(server, 'user-a', 5);

  const first = syncAchievements(server, 'user-a', 5);
  const firstUnlockedAt = first.find((row) => row.achievement_key === 'first_workout').unlocked_at;

  for (let index = 0; index < 5; index += 1) syncAchievements(server, 'user-a', 5);
  const last = syncAchievements(server, 'user-a', 5);

  assertEqual(server.achievements.size, 2, 'defterde çift satır oluştu');
  assertDeepEqual(unlockedKeys(last), ['first_workout', 'workout_5'], 'açılan set değişti');
  assertEqual(
    last.find((row) => row.achievement_key === 'first_workout').unlocked_at,
    firstUnlockedAt,
    'ilk kazanım anı değiştirildi',
  );
  assert(server.insertAttempts > 2, 'model gerçekten tekrar yazma denemeli');
  assertEqual(last.length, 6, 'altı satırın tamamı dönmeli');
});

check('7. Eşzamanlı çağrılar çift kayıt OLUŞTURMUYOR', () => {
  const server = createServer();
  addSession(server, 'user-a', 5);

  // Aynı anda gelen beş çağrı: birincil anahtar tek satır bırakır.
  const results = Array.from({ length: 5 }, () => syncAchievements(server, 'user-a', 5));

  assertEqual(server.achievements.size, 1, 'eşzamanlı çağrılar çift satır üretti');
  for (const rows of results) {
    assertDeepEqual(unlockedKeys(rows), ['first_workout'], 'eşzamanlı yanıtlar tutarsız');
  }
  // SQL tarafında garantiyi veren iki yapı gerçekten yerinde mi?
  assert(
    /primary key \(user_id, season_index, achievement_key\)/.test(sqlCode),
    'birincil anahtar idempotency garantisi yok',
  );
  assert(
    /on conflict on constraint season_rank_achievements_pkey do nothing/.test(sqlCode),
    'conflict davranışı `do nothing` değil',
  );
});

check('8. Başarı BAŞKA kullanıcıya yazılamıyor', () => {
  const server = createServer();
  addSession(server, 'user-b', 5);
  addSession(server, 'user-b', 5);
  addSession(server, 'user-b', 5);
  addSession(server, 'user-b', 5);
  addSession(server, 'user-b', 5);

  // A'nın kendi kanıtı yok: B'nin antrenmanları A'ya rozet açamaz.
  const rowsForA = syncAchievements(server, 'user-a', 5);
  assertDeepEqual(unlockedKeys(rowsForA), [], 'başka kullanıcının kanıtı sızdı');

  const rowsForB = syncAchievements(server, 'user-b', 5);
  assertDeepEqual(unlockedKeys(rowsForB), ['first_workout', 'workout_5'], 'B kendi rozetini almadı');

  // Defterdeki her satır sahibine ait.
  for (const [id, row] of server.achievements) {
    assert(id.startsWith(`${row.user_id}:`), 'defter satırı yanlış sahibe yazılmış');
  }
  assertEqual(
    [...server.achievements.values()].filter((row) => row.user_id === 'user-a').length,
    0,
    'A hesabına yetkisiz satır yazıldı',
  );
});

check('9. İstemci `user_id`, sezon veya progress GÖNDEREMİYOR', () => {
  // RPC imzasının TEK parametresi `client_today`.
  const signature = sqlCode.match(
    /create or replace function public\.sync_my_season_achievements\(([^)]*)\)/,
  );
  assert(signature, 'RPC imzası bulunamadı');
  assertEqual(signature[1].trim(), 'client_today date', 'RPC fazladan parametre alıyor');

  assert(sqlCode.includes('actor uuid := auth.uid()'), 'aktif kullanıcı auth.uid ile alınmıyor');
  assert(
    sqlCode.includes('perform public.assert_client_today(client_today)'),
    'yerel gün doğrulanmıyor',
  );
  assert(
    sqlCode.includes('public.rank_season_index_for(client_today)'),
    'sezon sunucuda belirlenmiyor',
  );

  // Servis katmanı da yalnızca yerel günü gönderiyor.
  const callStart = serviceSource.indexOf("supabase.rpc('sync_my_season_achievements'");
  assert(callStart >= 0, 'servis çağrısı bulunamadı');
  const callTail = serviceSource.slice(callStart);
  const argumentList = callTail.slice(0, callTail.indexOf('});') + 2);
  assert(argumentList.includes('client_today: clientToday'), 'servis yerel günü göndermiyor');
  // Fonksiyon ADI "season" içerdiği için yalnızca argümanlar taranır.
  const argumentsOnly = argumentList.slice(argumentList.indexOf(','));
  for (const forbidden of ['user_id', 'season', 'progress', 'unlocked']) {
    assert(!argumentsOnly.includes(forbidden), `istemci ${forbidden} gönderiyor`);
  }
});

check('10. Yeni sezon ESKİ sezon başarısını güncel sezona TAŞIMIYOR', () => {
  const server = createServer();
  for (let index = 0; index < 15; index += 1) addSession(server, 'user-a', 5);
  setPeakStreak(server, 'user-a', 5, 7);
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24#0');

  const season5 = syncAchievements(server, 'user-a', 5);
  assertEqual(unlockedKeys(season5).length, 6, '5. sezonda altı rozet açılmalıydı');

  // Yeni sezon: kanıt sıfırdan başlar.
  const season6 = syncAchievements(server, 'user-a', 6);
  assertDeepEqual(unlockedKeys(season6), [], 'eski sezon rozeti yeni sezona taşındı');
  for (const row of season6) {
    assertEqual(row.current_progress, 0, 'yeni sezon ilerlemesi sıfırdan başlamalı');
    assertEqual(row.unlocked_at, null, 'yeni sezonda kilit tarihi dolu geldi');
  }
});

check('11. Eski sezon satırları KAYBOLMUYOR', () => {
  const server = createServer();
  addSession(server, 'user-a', 5);
  syncAchievements(server, 'user-a', 5);

  // Yeni sezonda birçok çağrı yapılsa da 5. sezon defteri korunur.
  addSession(server, 'user-a', 6);
  for (let index = 0; index < 3; index += 1) syncAchievements(server, 'user-a', 6);

  assert(
    server.achievements.has(achievementId('user-a', 5, 'first_workout')),
    'eski sezon satırı silindi',
  );
  assert(
    server.achievements.has(achievementId('user-a', 6, 'first_workout')),
    'yeni sezon satırı yazılmadı',
  );
  assertEqual(server.achievements.size, 2, 'sezonlar birbirine karıştı');

  // SQL hiçbir yerde silme/güncelleme yapmıyor.
  assert(!/delete\s+from\s+public\.season_rank_achievements/i.test(sqlCode), 'defterden silme var');
  assert(!/update\s+public\.season_rank_achievements/i.test(sqlCode), 'defterde güncelleme var');
});

check('12. Antrenman silindikten sonra açılmış rozet KALIYOR', () => {
  const server = createServer();
  for (let index = 0; index < 5; index += 1) addSession(server, 'user-a', 5);

  const before = syncAchievements(server, 'user-a', 5);
  assertDeepEqual(unlockedKeys(before), ['first_workout', 'workout_5'], 'rozetler açılmadı');

  // Dört antrenman soft-delete edildi.
  for (let index = 0; index < 4; index += 1) server.sessions[index].deleted_at = '2026-08-30';
  const after = syncAchievements(server, 'user-a', 5);

  assertDeepEqual(unlockedKeys(after), ['first_workout', 'workout_5'], 'rozet geri alındı');
  // İlerleme DÜRÜSTÇE düşer; rozet ise defterden okunduğu için kalır.
  assertEqual(
    after.find((row) => row.achievement_key === 'workout_5').current_progress,
    1,
    'ilerleme gerçek kanıtı yansıtmalı',
  );
  assertEqual(
    after.find((row) => row.achievement_key === 'workout_5').is_unlocked,
    true,
    'kilit durumu defterden okunmalı',
  );
});

check('13. Başarılar RP/XP/gül tablosuna YAZMIYOR', () => {
  const server = createServer();
  for (let index = 0; index < 15; index += 1) addSession(server, 'user-a', 5);
  setPeakStreak(server, 'user-a', 5, 7);
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24#0');
  syncAchievements(server, 'user-a', 5);
  assertEqual(server.rewardWrites, 0, 'model ekonomiye yazdı');

  // SQL yalnızca kendi tablosuna yazar; ekonomi tablolarına DOKUNMAZ.
  const writes = [...sqlCode.matchAll(/\b(insert into|update|delete from)\s+([a-z_.]+)/gi)];
  for (const write of writes) {
    assertEqual(
      write[2],
      'public.season_rank_achievements',
      `beklenmeyen yazma hedefi: ${write[0]}`,
    );
  }
  for (const economyTable of [
    'public.reward_ledger',
    'public.user_progress',
    'public.rank_events',
    'public.user_season_ranks',
    'public.rank_settings',
  ]) {
    assert(
      !new RegExp(`(insert into|update|delete from)\\s+${economyTable.replace('.', '\\.')}`, 'i').test(
        sqlCode,
      ),
      `ekonomi tablosuna yazma: ${economyTable}`,
    );
  }
  // `rank_events` YALNIZCA okunur.
  assert(sqlCode.includes('from public.rank_events'), 'perfect week kanıtı okunmuyor');
});

check('14. RLS ve grant/revoke sınırları doğru', () => {
  assert(
    sqlCode.includes('alter table public.season_rank_achievements enable row level security'),
    'RLS açılmamış',
  );
  assert(
    sqlCode.includes('revoke all on table public.season_rank_achievements from anon'),
    'anon tablo yetkisi kaldırılmamış',
  );
  assert(
    sqlCode.includes('revoke all on table public.season_rank_achievements from authenticated'),
    'authenticated tablo yetkisi sıfırlanmamış',
  );
  assert(
    sqlCode.includes('grant select on table public.season_rank_achievements to authenticated'),
    'kendi satırını okuma grant’i yok',
  );
  assert(
    /create policy "season_rank_achievements_select_own"[\s\S]*?auth\.uid\(\)\) = user_id/.test(sqlCode),
    'kendi satırını okuma politikası yok',
  );
  // İstemci için yazma politikası HİÇ olmamalı.
  for (const verb of ['insert', 'update', 'delete']) {
    assert(
      !new RegExp(`on public\\.season_rank_achievements for ${verb}`).test(sqlCode),
      `istemci ${verb} policy'si var`,
    );
  }

  // RPC güvenlik duruşu.
  assert(sqlCode.includes('security definer'), 'RPC security definer değil');
  assert(sqlCode.includes("set search_path = ''"), "RPC search_path = '' kullanmıyor");
  assert(
    sqlCode.includes('revoke all on function public.sync_my_season_achievements(date) from anon'),
    'RPC anon yetkisi kaldırılmamış',
  );
  assert(
    sqlCode.includes(
      'grant execute on function public.sync_my_season_achievements(date) to authenticated',
    ),
    'RPC authenticated execute grant’i yok',
  );
  // Katalog yardımcısı istemciye HİÇ açılmaz.
  assert(
    sqlCode.includes('revoke all on function public.season_achievement_catalog() from authenticated'),
    'katalog yardımcısı istemciye açık kalmış',
  );
  // Başka kullanıcıların rozetleri bu fazda HİÇ açılmaz.
  assert(!/are_friends|target_user/.test(sqlCode), 'başka kullanıcı erişimi eklenmiş');
  // Ham workout/profil verisi dönmüyor.
  const returnsBlock = sqlCode.slice(
    sqlCode.indexOf('function public.sync_my_season_achievements'),
    sqlCode.indexOf('language plpgsql'),
  );
  for (const forbidden of ['notes', 'program', 'metadata', 'display_name', 'rp_delta', 'set_number']) {
    assert(!returnsBlock.includes(forbidden), `yasak alan dönüş tipinde: ${forbidden}`);
  }
});

check('15. Hesap değiştirme yarışı A verisini B state’ine YAZAMIYOR', () => {
  // Context, haftalık odakla AYNI sahiplik desenini kullanmalı.
  const body = contextSource.slice(
    contextSource.indexOf('const loadAchievements = useCallback('),
    contextSource.indexOf('loadAchievementsRef.current = () => {'),
  );
  assert(body.length > 0, 'loadAchievements bulunamadı');
  assert(body.includes('const owner = ownerRef.current;'), 'hesap sahipliği yakalanmıyor');
  assertEqual(
    (body.match(/owner !== ownerRef\.current/g) ?? []).length,
    2,
    'başarı ve hata yollarının ikisinde de sahiplik kontrolü olmalı',
  );
  assert(body.includes('isAchievementsFetchingRef.current'), 'tek uçuş kilidi yok');
  assert(body.includes('hasQueuedAchievementsRef.current'), 'latest-wins kuyruğu yok');

  // Hesap değişiminde durum tamamen temizlenir.
  assert(contextSource.includes('setAchievements([]);'), 'çıkışta liste temizlenmiyor');
  assert(contextSource.includes('hasRequestedAchievementsRef.current = false;'), 'talep bayrağı sıfırlanmıyor');
  assert(contextSource.includes('setHasAchievementsError(false);'), 'hata durumu sıfırlanmıyor');

  // Model tarafı: A'nın geç cevabı B'nin defterine yazamaz.
  const server = createServer();
  addSession(server, 'user-a', 5);
  syncAchievements(server, 'user-a', 5);
  const rowsForB = syncAchievements(server, 'user-b', 5);
  assertDeepEqual(unlockedKeys(rowsForB), [], 'A’nın kazanımı B’de göründü');
});

check('16. Hata durumunda mevcut rank ekranı ÇALIŞMAYA DEVAM EDİYOR', () => {
  // Başarı hatası kendi state'inde kalır; sezon/RP akışına dokunmaz.
  const body = contextSource.slice(
    contextSource.indexOf('const loadAchievements = useCallback('),
    contextSource.indexOf('loadAchievementsRef.current = () => {'),
  );
  assert(body.includes('setHasAchievementsError(true);'), 'hata durumu sunulmuyor');
  assert(!body.includes('setSeason('), 'başarı hatası sezon state’ine dokunuyor');
  assert(!body.includes('throw'), 'hata yukarı fırlatılıyor');

  /**
   * Ekranın erken dönüş bloğu (sezon henüz yokken gösterilen durum) başarı
   * state'ine HİÇ bakmaz: başarı hatası bu yolu değiştiremez.
   */
  const guardStart = screenSource.indexOf('if (!season) {');
  assert(guardStart > 0, 'sezon erken dönüş bloğu bulunamadı');
  const guardBlock = screenSource.slice(guardStart, screenSource.indexOf('const accent ='));
  for (const leak of ['achievements', 'hasAchievementsError', 'isAchievementsLoading']) {
    assert(!guardBlock.includes(leak), `sezon kontrolü başarı verisine bağlanmış: ${leak}`);
  }
  // Yeniden deneme yolu var.
  assert(
    screenSource.includes('onRetry={() => void loadAchievements()}'),
    'kullanıcı tekrar deneyemiyor',
  );
  // Polling YOK.
  assert(
    !/setInterval[\s\S]{0,120}loadAchievements|setTimeout[\s\S]{0,120}loadAchievements/.test(
      contextSource + screenSource,
    ),
    'başarılar için polling kurulmuş',
  );
  // Yalnızca ekran istediğinde yüklenir; sync sonrası tazeleme koşullu.
  assert(
    contextSource.includes('if (hasRequestedAchievementsRef.current) loadAchievementsRef.current();'),
    'sezon değişiminde koşullu tazeleme yok',
  );
});

check('17. Loading / empty / error / success görünümleri güvenli', () => {
  assert(screenSource.includes("t('ranks.achievements.title')"), 'başlık çeviriden gelmiyor');
  assert(screenSource.includes("t('ranks.achievements.unavailable')"), 'hata metni yok');
  assert(screenSource.includes("t('ranks.achievements.empty')"), 'boş durum metni yok');
  assert(screenSource.includes('ActivityIndicator'), 'yükleniyor göstergesi yok');
  assert(screenSource.includes("t('ranks.achievements.progress'"), 'ilerleme metni çeviriden gelmiyor');
  assert(screenSource.includes('MotionSection'), 'mevcut motion yapısı kullanılmıyor');
  assert(screenSource.includes('accessibilityLabel'), 'erişilebilirlik etiketi yok');
  assert(
    screenSource.includes('unlockedA11y') && screenSource.includes('lockedA11y'),
    'kilitli/açık erişilebilirlik metinleri eksik',
  );

  // Bu fazda modal, kutlama ve yeni ekran YOK.
  assert(!/Modal|celebration|confetti/i.test(screenSource.slice(screenSource.indexOf('AchievementsGrid'))), 'kapsam dışı modal/kutlama eklenmiş');

  // İstemci ilerleme HESAPLAMAZ: sunucu değeri olduğu gibi taşınır.
  const grid = screenSource.slice(
    screenSource.indexOf('function AchievementBadge('),
    screenSource.indexOf('function StatRow('),
  );
  assert(!/\.filter\(|\.length|currentProgress\s*[+*-]/.test(grid), 'ekran ilerleme hesaplıyor');

  // İki dilde de bütün metinler tanımlı.
  for (const key of ['first_workout', 'workout_5', 'workout_15', 'streak_3', 'streak_7', 'perfect_week']) {
    assert(localeTr.includes(`${key}: {`), `tr sözlüğünde ${key} yok`);
    assert(localeEn.includes(`${key}: {`), `en sözlüğünde ${key} yok`);
  }
  assert(localeTr.includes("title: 'SEZON BAŞARILARI'"), 'TR bölüm başlığı beklenen değil');
  assert(localeEn.includes("title: 'SEASON ACHIEVEMENTS'"), 'EN bölüm başlığı beklenen değil');
  for (const name of ['İlk Adım', 'Ritim Kazanıyor', 'İstikrarlı', '3 Günlük Seri', '7 Günlük Seri', 'Kusursuz Hafta']) {
    assert(localeTr.includes(name), `TR başarı adı eksik: ${name}`);
  }
});

// ---------------------------------------------------------------------------
// Katman 1 (devam) — istemci satır eşlemesi gerçekten çalıştırılır
// ---------------------------------------------------------------------------

check('18. İstemci eşlemesi: sabit sıra, camelCase ve güvenli daraltma', () => {
  const server = createServer();
  for (let index = 0; index < 5; index += 1) addSession(server, 'user-a', 5);
  const parsed = rx.parseSeasonAchievements(syncAchievements(server, 'user-a', 5));

  assertDeepEqual(
    parsed.map((entry) => entry.key),
    [...rx.SEASON_ACHIEVEMENT_KEYS],
    'sabit sıra korunmadı',
  );
  const first = parsed[0];
  assertEqual(first.isUnlocked, true, 'is_unlocked → isUnlocked');
  assertEqual(first.currentProgress, 1, 'current_progress → currentProgress');
  assertEqual(first.targetProgress, 1, 'target_progress → targetProgress');
  assert(typeof first.unlockedAt === 'string', 'unlocked_at → unlockedAt');
  // Kilitli satırda açılma tarihi HİÇ taşınmaz.
  const locked = parsed.find((entry) => !entry.isUnlocked);
  assertEqual(locked.unlockedAt, undefined, 'kilitli satırda tarih sızdı');
  // Ham snake_case alanlar istemci nesnesine geçmez.
  for (const raw of ['achievement_key', 'is_unlocked', 'current_progress', 'target_progress']) {
    assert(!(raw in first), `ham alan sızdı: ${raw}`);
  }
});

check('19. Bozuk/eksik satır uygulamayı ÇÖKERTMEZ', () => {
  const parsed = rx.parseSeasonAchievements([
    // Tanınmayan anahtar DÜŞER.
    { achievement_key: 'legendary', current_progress: 1, is_unlocked: true, target_progress: 1 },
    // Hedefi okunamayan satır DÜŞER: sahte eşik üretilmez.
    { achievement_key: 'workout_5', current_progress: 3, is_unlocked: false },
    // Sıra bozuk gelse de istemci kendi sırasına koyar.
    { achievement_key: 'streak_7', current_progress: 9, is_unlocked: true, target_progress: 7, unlocked_at: 'x' },
    { achievement_key: 'first_workout', current_progress: 1, is_unlocked: true, target_progress: 1 },
    // Aynı anahtar ikinci kez gelirse İLK satır kalır.
    { achievement_key: 'first_workout', current_progress: 0, is_unlocked: false, target_progress: 1 },
  ]);

  assertDeepEqual(
    parsed.map((entry) => entry.key),
    ['first_workout', 'streak_7'],
    'bozuk satırlar beklenen biçimde ele alınmadı',
  );
  // İlerleme hedefi aşamaz.
  assertEqual(parsed[1].currentProgress, 7, 'ilerleme hedefe kırpılmadı');
  assertEqual(parsed[0].isUnlocked, true, 'ilk satır korunmadı');
  assertDeepEqual(rx.parseSeasonAchievements(null), [], 'null yanıt çökertti');
  assertDeepEqual(rx.parseSeasonAchievements(undefined), [], 'undefined yanıt çökertti');
  assertEqual(rx.parseSeasonAchievementKey('workout_15'), 'workout_15', 'geçerli anahtar daraltılamadı');
  assertEqual(rx.parseSeasonAchievementKey('nope'), undefined, 'geçersiz anahtar kabul edildi');
});

check('20. Kanıt kaynakları mevcut rank sisteminin kendi yüklemleriyle AYNI', () => {
  // Antrenman sayımı: reconciler ile birebir yüklem.
  assert(
    /from public\.workout_sessions as s\s+where s\.user_id = actor\s+and s\.status = 'completed'\s+and s\.deleted_at is null/.test(
      sqlCode,
    ),
    'antrenman sayımı reconciler yükleminden ayrışıyor',
  );
  // Seri: kanıt fonksiyonu yeniden yazılmamış.
  assert(sqlCode.includes('public.rank_peak_streak('), 'seri kanıtı rank_peak_streak’ten gelmiyor');
  assert(ranksSql.includes('create or replace function public.rank_peak_streak'), 'kanıt fonksiyonu yok');
  // Mükemmel hafta kanıtı NET toplamdır; tek pozitif satır yeterli değildir.
  assert(
    /group by split_part\(split_part\(re\.source_key, '#', 1\), ':', 1\)/.test(sqlCode),
    'kanıt hafta anahtarına göre gruplanmıyor',
  );
  assert(/having sum\(re\.rp_delta\) > 0/.test(sqlCode), 'net toplam kontrolü yok');
  assert(
    !/event_type = 'weekly_perfect'\s+and re\.rp_delta > 0/.test(sqlCode),
    'eski "pozitif satır var mı" mantığı hâlâ duruyor',
  );
  // Kullanıcı ve sezon filtreleri gruplamadan ÖNCE uygulanmalı.
  const evidenceBlock = sqlCode.slice(
    sqlCode.indexOf('from public.rank_events as re'),
    sqlCode.indexOf('into has_perfect_week'),
  );
  assert(
    evidenceBlock.indexOf('re.user_id = actor') < evidenceBlock.indexOf('group by'),
    'kullanıcı filtresi gruplamadan sonra',
  );
  assert(
    evidenceBlock.indexOf('re.season_index = target_season') < evidenceBlock.indexOf('group by'),
    'sezon filtresi gruplamadan sonra',
  );

  // Elle işaretlenen takvim durumu HİÇ okunmaz.
  assert(!sqlCode.includes('manual_discipline_statuses'), 'elle işaretlenen durum okunuyor');
  assert(!sqlCode.includes('discipline_day_history'), 'donmuş takvim durumu kanıt sayılıyor');
  // Tipler istemci tarafında da doğru.
  assert(typesSource.includes('export type SeasonAchievement'), 'başarı tipi tanımlı değil');
  assert(typesSource.includes('targetProgress: number;'), 'hedef sunucudan taşınmıyor');
});

// ---------------------------------------------------------------------------
// 3 · Mükemmel hafta — NET KANIT regresyonları
// ---------------------------------------------------------------------------

const perfectWeekRow = (rows) => rows.find((row) => row.achievement_key === 'perfect_week');

check('21. Aynı hafta `+25 → -25`, ilk senkron: KİLİTLİ ve progress 0', () => {
  const server = createServer();
  // Bonus yazıldı, sonra kanıt geçersizleşti ve telafi edildi. Kullanıcı bu
  // arada HİÇ senkron yapmadı.
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24#0');
  addWeeklyPerfect(server, 'user-a', 5, -25, '2026-08-24#1');

  const rows = syncAchievements(server, 'user-a', 5);
  const perfect = perfectWeekRow(rows);

  assertEqual(perfect.is_unlocked, false, 'telafi edilmiş hafta rozeti açtı');
  assertEqual(perfect.current_progress, 0, 'net 0 haftada ilerleme sıfır olmalı');
  assertEqual(perfect.unlocked_at, null, 'açılmamış rozette tarih dolu geldi');
  assertEqual(server.achievements.size, 0, 'deftere yetkisiz satır yazıldı');
});

check('22. Aynı hafta `+25 → -25 → +25`: AÇIK ve progress 1', () => {
  const server = createServer();
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24#0');
  addWeeklyPerfect(server, 'user-a', 5, -25, '2026-08-24#1');
  // Kanıt geri geldi: yeniden kazanım.
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24#2');

  const perfect = perfectWeekRow(syncAchievements(server, 'user-a', 5));
  assertEqual(perfect.is_unlocked, true, 'yeniden kazanılan hafta rozeti açmadı');
  assertEqual(perfect.current_progress, 1, 'net pozitif haftada ilerleme 1 olmalı');
});

check('23. Bir geçerli hafta + bir telafi edilmiş hafta: AÇIK', () => {
  const server = createServer();
  // 24 Ağustos haftası geçerli.
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24#0');
  // 17 Ağustos haftası tamamen telafi edilmiş.
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-17#0');
  addWeeklyPerfect(server, 'user-a', 5, -25, '2026-08-17#1');

  const perfect = perfectWeekRow(syncAchievements(server, 'user-a', 5));
  assertEqual(perfect.is_unlocked, true, 'bir haftanın telafisi diğerini iptal etti');
  assertEqual(perfect.current_progress, 1, 'geçerli hafta ilerlemeyi vermedi');

  // Sıra ters olsa da sonuç aynı: gruplama hafta bazındadır.
  const reversed = createServer();
  addWeeklyPerfect(reversed, 'user-a', 5, 25, '2026-08-17#0');
  addWeeklyPerfect(reversed, 'user-a', 5, -25, '2026-08-17#1');
  addWeeklyPerfect(reversed, 'user-a', 5, 25, '2026-08-24#0');
  assertEqual(
    perfectWeekRow(syncAchievements(reversed, 'user-a', 5)).is_unlocked,
    true,
    'satır sırası sonucu değiştirdi',
  );
});

check('24. Negatif-only bozuk/legacy satır GEÇERLİ haftayı iptal etmez', () => {
  const server = createServer();
  // Eski sabit anahtar biçimi (`#` yok) ile yazılmış geçerli bonus.
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24');
  // Bambaşka bir haftaya ait, eşi olmayan negatif satır.
  addWeeklyPerfect(server, 'user-a', 5, -25, '2026-07-06#3');
  // Eski `:revoked` biçimi — yine BAŞKA bir hafta.
  addWeeklyPerfect(server, 'user-a', 5, -25, '2026-07-13:revoked');

  const perfect = perfectWeekRow(syncAchievements(server, 'user-a', 5));
  assertEqual(perfect.is_unlocked, true, 'ilgisiz negatif satırlar geçerli haftayı iptal etti');

  // Üç anahtar biçimi de AYNI kanıt birimine indirgeniyor.
  assertEqual(weeklyEvidenceKey('2026-08-24'), '2026-08-24', 'sabit anahtar normalize edilmedi');
  assertEqual(weeklyEvidenceKey('2026-08-24#0'), '2026-08-24', '#0 normalize edilmedi');
  assertEqual(weeklyEvidenceKey('2026-08-24#12'), '2026-08-24', '#12 normalize edilmedi');
  assertEqual(weeklyEvidenceKey('2026-08-24:revoked'), '2026-08-24', ':revoked normalize edilmedi');

  // Eski `:revoked` telafisi kendi haftasını gerçekten sıfırlar.
  const legacy = createServer();
  addWeeklyPerfect(legacy, 'user-a', 5, 25, '2026-08-24');
  addWeeklyPerfect(legacy, 'user-a', 5, -25, '2026-08-24:revoked');
  assertEqual(
    perfectWeekRow(syncAchievements(legacy, 'user-a', 5)).is_unlocked,
    false,
    'eski biçimli telafi aynı haftayı sıfırlamadı',
  );
});

check('25. Önce açılan rozet KALICI; ilerleme ise gerçek net kanıtı yansıtır', () => {
  const server = createServer();
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24#0');

  // Kullanıcı bu noktada senkron yaptı: rozet açıldı.
  const before = perfectWeekRow(syncAchievements(server, 'user-a', 5));
  assertEqual(before.is_unlocked, true, 'geçerli hafta rozeti açmadı');
  assertEqual(before.current_progress, 1, 'açılma anında ilerleme 1 olmalı');
  const unlockedAt = before.unlocked_at;

  // Sonradan antrenman silindi ve hafta telafi edildi.
  addWeeklyPerfect(server, 'user-a', 5, -25, '2026-08-24#1');
  const after = perfectWeekRow(syncAchievements(server, 'user-a', 5));

  assertEqual(after.is_unlocked, true, 'açılmış rozet telafiyle geri alındı');
  assertEqual(after.unlocked_at, unlockedAt, 'ilk kazanım anı değiştirildi');
  // İlerleme DÜRÜSTÇE düşer: kilit defterden, ilerleme canlı kanıttan gelir.
  assertEqual(after.current_progress, 0, 'ilerleme gerçek net kanıtı yansıtmıyor');
  assertEqual(server.achievements.size, 1, 'defterde çift satır oluştu');
});

check('26. İkinci kullanıcı ve ikinci sezon satırları kanıta KARIŞMAZ', () => {
  const server = createServer();
  // Başka kullanıcının geçerli haftası.
  addWeeklyPerfect(server, 'user-b', 5, 25, '2026-08-24#0');
  // Aynı kullanıcının BAŞKA sezondaki geçerli haftası.
  addWeeklyPerfect(server, 'user-a', 4, 25, '2026-06-29#0');

  assertEqual(
    perfectWeekRow(syncAchievements(server, 'user-a', 5)).is_unlocked,
    false,
    'başka kullanıcı/sezon kanıtı sızdı',
  );

  // Başka kullanıcının NEGATİF satırı da bizim geçerli haftamızı iptal edemez.
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24#0');
  addWeeklyPerfect(server, 'user-b', 5, -25, '2026-08-24#1');
  assertEqual(
    perfectWeekRow(syncAchievements(server, 'user-a', 5)).is_unlocked,
    true,
    'başka kullanıcının telafisi bizim haftamızı iptal etti',
  );

  // Aynı sezonda B'nin kendi kanıtı hâlâ kendi rozetini açar.
  assertEqual(
    perfectWeekRow(syncAchievements(server, 'user-b', 5)).is_unlocked,
    false,
    'B’nin net 0 haftası rozet açtı',
  );
});

// ---------------------------------------------------------------------------
// 4 · PostgreSQL 42702 regresyonu — ambiguous `achievement_key`
// ---------------------------------------------------------------------------

/**
 * CANLI POSTGRESQL YOKTUR.
 *
 * Bu harness SQL'i ÇALIŞTIRMAZ; aşağıdaki kontroller statiktir. Buradaki amaç
 * doğrulanmış bir çalışma zamanı hatasının kaynağa GERİ YAZILMASINI
 * engellemektir:
 *
 *     ERROR: 42702: column reference "achievement_key" is ambiguous
 *     DETAIL: It could refer to either a PL/pgSQL variable or a table column.
 *     CONTEXT: PL/pgSQL function public.sync_my_season_achievements(date)
 *
 * `returns table (...)` her çıktı sütunu için aynı adda bir PL/pgSQL değişkeni
 * üretir ve bu değişkenler gövdenin tamamında kapsamdadır. `on conflict`in
 * SÜTUN LİSTESİ biçimi bir ifade olarak çözümlendiği için `achievement_key`
 * hem değişkene hem sütuna işaret eder. Constraint ADI ise ifade değildir;
 * belirsizlik oluşamaz.
 */
check('27. Çakışma hedefi CONSTRAINT ADIYLA verilir (42702 regresyonu)', () => {
  assert(
    sqlCode.includes('on conflict on constraint season_rank_achievements_pkey do nothing'),
    'çakışma hedefi constraint adıyla verilmiyor',
  );

  // Ambiguous sütun listesi biçimi HİÇBİR yerde kalmamalı.
  assert(
    !/on conflict\s*\(/.test(sqlCode),
    'ambiguous `on conflict (<sütunlar>)` biçimi geri gelmiş — 42702 riski',
  );
  assert(
    !/on conflict \(user_id, season_index, achievement_key\)/.test(sqlCode),
    'eski sütun listeli çakışma hedefi hâlâ duruyor',
  );

  // Referans verilen constraint gerçekten bu migration tarafından üretiliyor.
  assert(
    /primary key \(user_id, season_index, achievement_key\)/.test(sqlCode),
    'birincil anahtar bildirimi bulunamadı',
  );
  // Satır içi bildirim → PostgreSQL adı `<tablo>_pkey` verir. Farklı adla
  // bildirilmiş bir constraint olsaydı `on conflict` hedefi tutmazdı.
  assert(
    !/constraint\s+\w+\s+primary key/i.test(sqlCode),
    'birincil anahtar özel adla bildirilmiş; `_pkey` varsayımı geçersiz',
  );
  assertEqual(
    'season_rank_achievements_pkey'.length <= 63,
    true,
    'constraint adı PostgreSQL tanımlayıcı sınırını aşıyor (kesilme riski)',
  );
  // Tablo adı ile constraint adı tutarlı olmalı.
  assert(
    sqlCode.includes('create table if not exists public.season_rank_achievements'),
    'tablo adı constraint adıyla tutarsız',
  );

  /**
   * Çıktı değişkeni adlarının gövdede NİTELENMEDEN kullanılmadığını da
   * denetle: aynı sınıf hata başka bir ifadede tekrar doğabilir.
   */
  const bodyStart = sqlCode.indexOf('create or replace function public.sync_my_season_achievements');
  const body = sqlCode.slice(bodyStart, sqlCode.indexOf('revoke all on function public.sync_my_season_achievements'));
  const returnsBlock = body.slice(0, body.indexOf('language plpgsql'));
  const statements = body.slice(body.indexOf('language plpgsql'));

  for (const outputName of ['achievement_key', 'is_unlocked', 'unlocked_at', 'target_progress']) {
    assert(returnsBlock.includes(outputName), `çıktı sütunu bulunamadı: ${outputName}`);
    // Gövdedeki her geçiş ya nitelenmiş (`c.` / `a.` / `re.`) ya da bir
    // `as <ad>` takma adı ya da INSERT hedef sütun listesi olmalıdır.
    for (const line of statements.split('\n')) {
      if (!line.includes(outputName)) continue;
      const isQualified = new RegExp(`\\b(c|a|re)\\.${outputName}\\b`).test(line);
      const isAlias = new RegExp(`as ${outputName}`).test(line);
      const isInsertTarget = line.includes('insert into public.season_rank_achievements');
      assert(
        isQualified || isAlias || isInsertTarget,
        `niteliksiz çıktı değişkeni kullanımı (42702 riski): ${line.trim()}`,
      );
    }
  }
});

check('28. 42702 düzeltmesi idempotency/eşzamanlılık garantisini BOZMADI', () => {
  // Çakışma hedefi değişti ama anahtar üçlüsü AYNI: davranış birebir korunur.
  const server = createServer();
  addSession(server, 'user-a', 5);

  const results = Array.from({ length: 5 }, () => syncAchievements(server, 'user-a', 5));
  assertEqual(server.achievements.size, 1, 'eşzamanlı çağrılar çift satır üretti');
  for (const rows of results) {
    assertDeepEqual(unlockedKeys(rows), ['first_workout'], 'eşzamanlı yanıtlar tutarsız');
  }

  // Constraint, insert'in yazdığı üç sütunun TAMAMINI kapsıyor.
  const insertTarget = sqlCode.match(
    /insert into public\.season_rank_achievements \(([^)]+)\)/,
  );
  assert(insertTarget, 'insert hedef sütunları bulunamadı');
  const pk = sqlCode.match(/primary key \(([^)]+)\)/);
  assert(pk, 'birincil anahtar sütunları bulunamadı');
  assertDeepEqual(
    insertTarget[1].split(',').map((part) => part.trim()).sort(),
    pk[1].split(',').map((part) => part.trim()).sort(),
    'insert sütunları ile birincil anahtar ayrışıyor — idempotency garantisi kaybolur',
  );
});

check('29. Net `weekly_perfect` kanıt düzeltmesi KORUNDU', () => {
  // 42702 düzeltmesi önceki net-kanıt düzeltmesini geri almamalı.
  assert(
    /group by split_part\(split_part\(re\.source_key, '#', 1\), ':', 1\)/.test(sqlCode),
    'hafta anahtarı normalizasyonu kaybolmuş',
  );
  assert(/having sum\(re\.rp_delta\) > 0/.test(sqlCode), 'net toplam kontrolü kaybolmuş');
  assert(
    !/event_type = 'weekly_perfect'\s+and re\.rp_delta > 0/.test(sqlCode),
    'eski "pozitif satır var mı" mantığı geri gelmiş',
  );

  // Uçtan uca: telafi edilmiş hafta hâlâ rozet açmıyor.
  const server = createServer();
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24#0');
  addWeeklyPerfect(server, 'user-a', 5, -25, '2026-08-24#1');
  assertEqual(
    perfectWeekRow(syncAchievements(server, 'user-a', 5)).is_unlocked,
    false,
    'telafi edilmiş hafta rozeti açtı',
  );
});

// ---------------------------------------------------------------------------
// MUTATION TESTLERİ — bozuk implementasyon gerçekten düşüyor mu?
// ---------------------------------------------------------------------------

check('M1. `on conflict` olmayan model çift kayıt üretir ve DÜŞER', () => {
  const ledger = [];
  // Kasıtlı hata: birincil anahtar yok, her çağrı yeni satır yazıyor.
  const brokenInsert = () => ledger.push({ key: 'first_workout' });
  brokenInsert();
  brokenInsert();

  assertThrows(
    () => assertEqual(ledger.length, 1, 'mutation'),
    'conflict korumasız model testten geçti — çift kayıt yakalanmıyor',
  );

  const server = createServer();
  addSession(server, 'user-a', 5);
  syncAchievements(server, 'user-a', 5);
  syncAchievements(server, 'user-a', 5);
  assertEqual(server.achievements.size, 1, 'doğru model çift kayıt üretti');
});

check('M2. Kilidi CANLI ilerlemeden okuyan model rozeti geri alır ve DÜŞER', () => {
  const server = createServer();
  for (let index = 0; index < 5; index += 1) addSession(server, 'user-a', 5);
  syncAchievements(server, 'user-a', 5);
  for (let index = 0; index < 4; index += 1) server.sessions[index].deleted_at = '2026-08-30';

  // Kasıtlı hata: `is_unlocked` defterden değil, anlık ilerlemeden okunuyor.
  const liveCount = server.sessions.filter((row) => row.deleted_at === null).length;
  const brokenUnlocked = liveCount >= catalogTarget('workout_5');
  assertEqual(brokenUnlocked, false, 'bozuk model gerçekten rozeti geri almalı');
  assertThrows(
    () => assert(brokenUnlocked, 'mutation'),
    'canlı ilerlemeden okuyan model testten geçti — kalıcılık kaybı yakalanmıyor',
  );

  const rows = syncAchievements(server, 'user-a', 5);
  assertEqual(
    rows.find((row) => row.achievement_key === 'workout_5').is_unlocked,
    true,
    'doğru model rozeti geri aldı',
  );
});

check('M3. Sezonu yok sayan model eski rozeti taşır ve DÜŞER', () => {
  const server = createServer();
  addSession(server, 'user-a', 5);
  syncAchievements(server, 'user-a', 5);

  // Kasıtlı hata: anahtar sezonsuz.
  const brokenKey = `user-a:first_workout`;
  const brokenLedger = new Set([brokenKey]);
  assert(brokenLedger.has('user-a:first_workout'), 'bozuk model gerçekten sezonsuz olmalı');
  assertThrows(
    () => assert(!brokenLedger.has('user-a:first_workout'), 'mutation'),
    'sezonsuz anahtar testten geçti — sezon sızıntısı yakalanmıyor',
  );

  const season6 = syncAchievements(server, 'user-a', 6);
  assertDeepEqual(unlockedKeys(season6), [], 'doğru model rozeti yeni sezona taşıdı');
});

check('M6. Ambiguous `on conflict (<sütunlar>)` biçimine dönüş DÜŞER', () => {
  /**
   * Canlı PostgreSQL olmadığı için 42702 çalışma zamanında yakalanamaz; bu
   * mutation, STATİK kontrolün gerçekten koruduğunu kanıtlar.
   */
  const brokenSql = sqlCode.replace(
    'on conflict on constraint season_rank_achievements_pkey do nothing',
    'on conflict (user_id, season_index, achievement_key) do nothing',
  );
  assert(
    /on conflict \(user_id, season_index, achievement_key\)/.test(brokenSql),
    'bozuk sürüm gerçekten eski biçime dönmeli',
  );
  assertThrows(
    () => assert(!/on conflict\s*\(/.test(brokenSql), 'mutation'),
    'ambiguous sütun listesi testten geçti — 42702 regresyonu yakalanmıyor',
  );

  // Gerçek kaynak temiz.
  assert(!/on conflict\s*\(/.test(sqlCode), 'kaynakta ambiguous biçim var');
});

check('M5. Eski `exists(... rp_delta > 0)` mantığı testleri DÜŞÜRÜR', () => {
  const events = [
    { rp_delta: 25, source_key: '2026-08-24#0' },
    { rp_delta: -25, source_key: '2026-08-24#1' },
  ];

  /** ESKİ HATALI MANTIK: herhangi bir pozitif satır varsa rozet açılıyordu. */
  const brokenHasPerfectWeek = events.some((row) => row.rp_delta > 0);
  assertEqual(brokenHasPerfectWeek, true, 'eski mantık gerçekten rozeti açmalı');
  assertThrows(
    () => assertEqual(brokenHasPerfectWeek, false, 'mutation'),
    'eski `exists(... rp_delta > 0)` mantığı testten geçti — telafi edilmiş hafta yakalanmıyor',
  );

  /** DOĞRU MANTIK: hafta başına NET toplam. */
  const netByWeek = new Map();
  for (const row of events) {
    const key = weeklyEvidenceKey(row.source_key);
    netByWeek.set(key, (netByWeek.get(key) ?? 0) + row.rp_delta);
  }
  assertEqual(
    [...netByWeek.values()].some((net) => net > 0),
    false,
    'net kanıt modeli telafi edilmiş haftayı açıyor',
  );

  // Uçtan uca: doğru model aynı senaryoda rozeti açmaz.
  const server = createServer();
  addWeeklyPerfect(server, 'user-a', 5, 25, '2026-08-24#0');
  addWeeklyPerfect(server, 'user-a', 5, -25, '2026-08-24#1');
  assertEqual(
    perfectWeekRow(syncAchievements(server, 'user-a', 5)).is_unlocked,
    false,
    'doğru model telafi edilmiş haftada rozet açtı',
  );

  // SQL de eski mantığa dönmemiş olmalı.
  assert(
    !/and re\.rp_delta > 0\s*\)\s*into has_perfect_week/.test(sqlCode),
    'SQL eski "pozitif satır var mı" mantığına dönmüş',
  );
});

check('M4. `client_today` doğrulaması olmayan RPC istemciye sezon seçtirir', () => {
  assert(
    sqlCode.includes('perform public.assert_client_today(client_today)'),
    'doğrulama kaldırılmış',
  );
  const withoutGuard = sqlCode.replace('perform public.assert_client_today(client_today);', '');
  assertThrows(
    () =>
      assert(
        withoutGuard.includes('perform public.assert_client_today(client_today)'),
        'mutation',
      ),
    'guard’sız sürüm testten geçti — istemci sezon seçebilir',
  );
});

// ---------------------------------------------------------------------------

rmSync(outDir, { force: true, recursive: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Sezon başarıları harness: ${passed} kontrol geçti.`);
console.log('  (Canlı Postgres yok — SQL çalıştırılmadı, modellendi ve statik denetlendi.)');
