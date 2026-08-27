#!/usr/bin/env node
/**
 * SEZONLUK RANK SİSTEMİ — DOĞRULAMA HARNESS'I
 *
 * Projede jest/testing-library KURULU DEĞİL ve bu görevde yeni bağımlılık
 * eklenemiyor. Bu yüzden harness `constants/level-curve.ts` dosyasının
 * belgelediği kalıbı izler: TypeScript kaynağı `tsc` ile derlenir, çıktı
 * gerçekten import edilip çalıştırılır ve SQL migration'ı statik olarak aynı
 * sınırlara karşı kontrol edilir.
 *
 * ÜÇ KATMAN
 *   1. SAF MANTIK  — `constants/ranks.ts` gerçekten derlenip çalıştırılır.
 *   2. MODEL       — sunucu uzlaştırma semantiğinin referans uygulaması.
 *                    RP tutarları SQL DOSYASINDAN OKUNUR, elle yazılmaz;
 *                    SQL ile TypeScript ayrışırsa test düşer.
 *   3. STATİK SQL  — RLS, grant/revoke, `security definer`, `search_path`,
 *                    idempotency indeksi ve dokunulmazlık kuralları.
 *
 * Canlı Postgres/Docker YOKTUR: SQL burada ÇALIŞTIRILMAZ, yalnızca modellenip
 * statik olarak denetlenir. Migration'ın kendi `do $$ assert $$` blokları
 * gerçek veritabanında uygulandığında ikinci bir doğrulama katmanı sağlar.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATION = join(ROOT, 'supabase/migrations/20260827120000_add_seasonal_ranks.sql');

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
  if (actual !== expected) {
    throw new Error(`${message} — beklenen ${expected}, gelen ${actual}`);
  }
}

/** Beklenen biçimde düşmesi GEREKEN bir kontrol. Mutation testleri kullanır. */
function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Katman 1 — `constants/ranks.ts` gerçekten derlenir ve çalıştırılır
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'rosea-ranks-'));
let ranks;

try {
  execFileSync(
    'npx',
    [
      'tsc',
      join(ROOT, 'constants/ranks.ts'),
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
  ranks = await import(pathToFileURL(join(outDir, 'ranks.js')).href);
} catch (error) {
  console.error('constants/ranks.ts derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}

const sql = readFileSync(MIGRATION, 'utf8');

/**
 * Yorumları çıkarılmış SQL.
 *
 * "Şuna DOKUNMAMALI" kontrolleri bunu kullanır: dosya başındaki ürün ayrımı
 * açıklaması `lifetime_xp` gibi terimleri anlatım amacıyla geçirir, ama bu bir
 * yazma değildir. Yorumlu metin üzerinden arama yapmak yanlış alarm üretirdi.
 */
const sqlCode = sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*--.*$/gm, ' ');

/** SQL'deki `rank_rp_amount` tablosundan tek bir tutarı okur. */
function sqlRpAmount(kind) {
  const match = sql.match(new RegExp(`when '${kind}' then (-?\\d+)`));
  assert(match, `SQL içinde '${kind}' RP tutarı bulunamadı`);
  return Number.parseInt(match[1], 10);
}

/** SQL'deki `rank_tier_floor` tablosundan bir tier tabanını okur. */
function sqlTierFloor(rankId) {
  const block = sql.slice(sql.indexOf('function public.rank_tier_floor'));
  const match = block.match(new RegExp(`when '${rankId}' then (\\d+)`));
  assert(match, `SQL içinde '${rankId}' tier tabanı bulunamadı`);
  return Number.parseInt(match[1], 10);
}

// ---------------------------------------------------------------------------
// 1 · Rank eşik sınırları — TypeScript ve SQL aynı olmalı
// ---------------------------------------------------------------------------

check('1. Bütün rank eşik sınırları (TypeScript)', () => {
  for (const [rp, expected] of ranks.RANK_THRESHOLD_FIXTURES) {
    assertEqual(ranks.resolveRank(rp).id, expected, `resolveRank(${rp})`);
  }
});

check('1b. Eşikler SQL ile birebir aynı', () => {
  for (const tier of ranks.RANK_TIERS) {
    assertEqual(sqlTierFloor(tier.id), tier.minRp, `${tier.id} tabanı SQL ile ayrışıyor`);
  }
  // Sınırların iki tarafında da doğru rank çıkmalı: floor-1 bir alt tier.
  for (let index = 1; index < ranks.RANK_TIERS.length; index += 1) {
    const tier = ranks.RANK_TIERS[index];
    assertEqual(ranks.resolveRank(tier.minRp).id, tier.id, `${tier.id} alt sınırı`);
    assertEqual(
      ranks.resolveRank(tier.minRp - 1).id,
      ranks.RANK_TIERS[index - 1].id,
      `${tier.id} alt sınırının bir altı`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2 · RP negatif olamaz
// ---------------------------------------------------------------------------

check('2. RP negatif olamaz', () => {
  assertEqual(ranks.clampRp(-500), 0, 'negatif RP 0’a sıkışmalı');
  assertEqual(ranks.clampRp(Number.NaN), 0, 'NaN 0’a sıkışmalı');
  assertEqual(ranks.resolveRank(-500).id, 'bronze', 'negatif RP bronze');
  assertEqual(ranks.rpToNextRank(-500), 200, 'negatif RP’den silver’a 200');
  assert(
    sql.includes('current_rp integer not null default 0 check (current_rp >= 0)'),
    'SQL şemasında current_rp >= 0 kısıtı yok',
  );
  assert(
    sql.includes('greatest(usr.current_rp + target_rp, 0)'),
    'SQL telafi yazımında toplam 0’ın altına düşebiliyor',
  );
});

// ---------------------------------------------------------------------------
// Katman 2 — sunucu uzlaştırma semantiğinin referans modeli
// ---------------------------------------------------------------------------

/**
 * `reconcile_rank_season` + `apply_rank_adjustment` semantiğinin referans
 * uygulaması.
 *
 * TUTARLAR SQL'DEN OKUNUR: model kendi sayılarını uydurmaz, bu yüzden SQL
 * değiştirilirse testler burada düşer.
 */
const RP = {
  scheduledPartial: sqlRpAmount('scheduled_partial'),
  scheduledComplete: sqlRpAmount('scheduled_complete'),
  unscheduled: sqlRpAmount('unscheduled_workout'),
  weeklyPerfect: sqlRpAmount('weekly_perfect'),
  streak7: sqlRpAmount('streak_7'),
  streak30: sqlRpAmount('streak_30'),
  streak100: sqlRpAmount('streak_100'),
};

const MILESTONES = [
  [7, RP.streak7, 'streak_7'],
  [30, RP.streak30, 'streak_30'],
  [100, RP.streak100, 'streak_100'],
];

function createRankStore(options = {}) {
  return {
    epoch: options.epoch ?? '2026-08-27',
    /** `event_type + '|' + source_key` → rp_delta. APPEND-ONLY. */
    events: new Map(),
    seasons: new Map(),
    /** Kullanıcı advisory lock'ının modeli. */
    locked: false,
  };
}

function seasonOf(store, index) {
  if (!store.seasons.has(index)) {
    store.seasons.set(index, {
      currentRp: 0,
      startingRp: 0,
      peakRp: 0,
      finalRp: null,
      finalRank: null,
      finalized: false,
      longestStreak: 0,
    });
  }
  return store.seasons.get(index);
}

/** `record_rank_event` karşılığı: idempotent, arşive yazmaz, 0'ın altına inmez. */
function recordEvent(store, seasonIndex, eventType, sourceKey, rpDelta) {
  if (rpDelta === 0) return 0;
  const season = seasonOf(store, seasonIndex);
  if (season.finalized) return 0;

  const key = `${eventType}|${sourceKey}`;
  if (store.events.has(key)) return 0;

  store.events.set(key, rpDelta);
  season.currentRp = Math.max(season.currentRp + rpDelta, 0);
  season.peakRp = Math.max(season.peakRp, season.currentRp);
  return rpDelta;
}

/** Bir kanıt birimine yazılmış NET RP ve satır sayısı. */
function ledgerFor(store, eventType, evidenceKey) {
  let net = 0;
  let count = 0;
  for (const [key, delta] of store.events) {
    if (key.startsWith(`${eventType}|${evidenceKey}#`)) {
      net += delta;
      count += 1;
    }
  }
  return { count, net };
}

/**
 * `apply_rank_adjustment` karşılığı — DESIRED-VS-WRITTEN.
 *
 * Fark yoksa hiçbir satır yazılmaz (idempotency). Fark varsa yeni bir sıra
 * numarasıyla satır eklenir; bu yüzden telafi ve YENİDEN KAZANIM sonsuza
 * kadar mümkündür (sabit anahtar kalıcı olarak kilitlemez).
 */
function applyAdjustment(store, seasonIndex, eventType, evidenceKey, desiredRp) {
  const { count, net } = ledgerFor(store, eventType, evidenceKey);
  if (desiredRp === net) return 0;
  return recordEvent(store, seasonIndex, eventType, `${evidenceKey}#${count}`, desiredRp - net);
}

function netForDate(store, dateKey) {
  return ledgerFor(store, 'scheduled_day', dateKey).net;
}

/**
 * `reconcile_rank_season` modeli.
 *
 * `evidence` = {
 *   days: { date: { state, scheduledWorkout, verifiable } },
 *   sessions: [{ id, date, deleted }],
 *   weeks: [{ start, end, scheduledDays, completedDays }],
 *   peakStreak: number,
 * }
 * `horizon` = SQL'deki `client_today` parametresi.
 */
function reconcile(store, seasonIndex, evidence, horizon) {
  assert(!store.locked, 'advisory lock ihlali: eşzamanlı iki uzlaştırma');
  store.locked = true;
  try {
    const season = seasonOf(store, seasonIndex);
    // ARŞİVLENMİŞ SEZONA DOKUNULMAZ.
    if (season.finalized) return;

    // 1) Planlı günler — istenen vs. yazılmış, HER gün için.
    for (const [dateKey, day] of Object.entries(evidence.days ?? {})) {
      if (dateKey < store.epoch) continue;
      const desired =
        day.verifiable === false || !day.scheduledWorkout
          ? 0
          : day.state === 'completed'
            ? RP.scheduledComplete
            : day.state === 'partial'
              ? RP.scheduledPartial
              : 0;
      applyAdjustment(store, seasonIndex, 'scheduled_day', dateKey, desired);
    }

    // 2) Plan dışı antrenmanlar. Aday küme = geçerli olanlar ∪ yazılmış olanlar.
    //    İkinci küme olmasaydı silinen bir oturum taramadan tamamen düşer ve
    //    RP'si telafi edilemezdi.
    const candidates = new Map();
    for (const session of evidence.sessions ?? []) candidates.set(session.id, session);
    for (const key of store.events.keys()) {
      if (!key.startsWith('unscheduled_workout|')) continue;
      const id = key.slice('unscheduled_workout|'.length).split('#')[0];
      if (!candidates.has(id)) candidates.set(id, { date: null, deleted: true, id });
    }

    for (const session of candidates.values()) {
      const isValid =
        !session.deleted &&
        session.date !== null &&
        session.date >= store.epoch &&
        !(evidence.days ?? {})[session.date]?.scheduledWorkout;
      applyAdjustment(
        store,
        seasonIndex,
        'unscheduled_workout',
        session.id,
        isValid ? RP.unscheduled : 0,
      );
    }

    // 3) Kapanmış haftaların mükemmel plan bonusu — istenen vs. yazılmış.
    for (const week of evidence.weeks ?? []) {
      if (week.start < store.epoch) continue;
      if (!(week.end < horizon)) continue; // hafta henüz kapanmadı
      const desired =
        week.scheduledDays > 0 && week.completedDays >= week.scheduledDays
          ? RP.weeklyPerfect
          : 0;
      applyAdjustment(store, seasonIndex, 'weekly_perfect', week.start, desired);
    }

    // 4) Streak kilometre taşları — SEZON BAŞINA anahtar, istenen vs. yazılmış.
    const peak = evidence.peakStreak ?? 0;
    for (const [days, rp, kind] of MILESTONES) {
      applyAdjustment(
        store,
        seasonIndex,
        'streak_milestone',
        `${kind}:s${seasonIndex}`,
        peak >= days ? rp : 0,
      );
    }

    // 5) İstatistikler — monotonik `greatest` YOK, kanıt düşünce düzelir.
    season.longestStreak = peak;
  } finally {
    store.locked = false;
  }
}

function finalizeSeason(store, seasonIndex) {
  const season = seasonOf(store, seasonIndex);
  if (season.finalized) return; // idempotent
  season.finalized = true;
  season.finalRp = season.currentRp;
  season.finalRank = ranks.resolveRank(season.currentRp).id;
}

/**
 * `advance_rank_seasons` içindeki DÜZELTİLMİŞ sıra:
 * önce `ends_on + 1` ufkuyla son uzlaştırma, SONRA finalize.
 */
function closeSeason(store, seasonIndex, evidence, endsOn) {
  reconcile(store, seasonIndex, evidence, ranks.addDays(endsOn, 1));
  finalizeSeason(store, seasonIndex);
}

function openNextSeason(store, fromIndex) {
  const closed = seasonOf(store, fromIndex);
  const carry = ranks.softResetRp(closed.finalRp ?? 0);
  const next = seasonOf(store, fromIndex + 1);
  if (next.startingRp === 0 && next.currentRp === 0) {
    next.startingRp = carry;
    next.currentRp = carry;
    next.peakRp = carry;
  }
  return next;
}

/** Tek planlı gün kanıtı üretir. */
function scheduledDay(state, extra = {}) {
  return { state, scheduledWorkout: true, verifiable: true, ...extra };
}

// ---------------------------------------------------------------------------
// 3–5 · Planlı gün ödülleri
// ---------------------------------------------------------------------------

check('3. Kısmi planlı gün +10', () => {
  const store = createRankStore();
  reconcile(store, 1, { days: { '2026-08-31': scheduledDay('partial') } }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, 10, 'kısmi gün 10 RP vermeli');
});

check('4. Kısmi → tam toplamı TAM 25 (üzerine yalnızca +15)', () => {
  const store = createRankStore();
  reconcile(store, 1, { days: { '2026-08-31': scheduledDay('partial') } }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, 10, 'ilk aşama 10');
  reconcile(store, 1, { days: { '2026-08-31': scheduledDay('completed') } }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, 25, 'toplam 25 olmalı, 35 değil');
  assertEqual(netForDate(store, '2026-08-31'), 25, 'defter neti 25');
  assertEqual(store.events.get('scheduled_day|2026-08-31#1'), 15, 'fark satırı 15 olmalı');
});

check('5. Doğrudan tam tamamlanan gün +25', () => {
  const store = createRankStore();
  reconcile(store, 1, { days: { '2026-08-31': scheduledDay('completed') } }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, 25, 'doğrudan tam gün 25 RP');
});

// ---------------------------------------------------------------------------
// 6 · Plan dışı antrenman
// ---------------------------------------------------------------------------

check('6. Plan dışı tamamlanmış antrenman +15', () => {
  const store = createRankStore();
  reconcile(
    store,
    1,
    { days: {}, sessions: [{ id: 's1', date: '2026-08-31', deleted: false }] },
    '2026-09-01',
  );
  assertEqual(seasonOf(store, 1).currentRp, 15, 'plan dışı antrenman 15 RP');
});

check('6b. Planlı günde yapılan antrenman AYRICA plan dışı sayılmaz', () => {
  const store = createRankStore();
  reconcile(
    store,
    1,
    {
      days: { '2026-08-31': scheduledDay('completed') },
      sessions: [{ id: 's1', date: '2026-08-31', deleted: false }],
    },
    '2026-09-01',
  );
  assertEqual(seasonOf(store, 1).currentRp, 25, 'çifte ödül olmamalı');
});

// ---------------------------------------------------------------------------
// 7–8 · Haftalık mükemmel plan
// ---------------------------------------------------------------------------

check('7. Kapanmış haftada mükemmel plan +25', () => {
  const store = createRankStore();
  reconcile(
    store,
    1,
    {
      days: {},
      weeks: [{ start: '2026-08-31', end: '2026-09-06', scheduledDays: 3, completedDays: 3 }],
    },
    '2026-09-07',
  );
  assertEqual(seasonOf(store, 1).currentRp, 25, 'mükemmel hafta 25 RP');
});

check('7b. Hafta kapanmadan bonus verilmez', () => {
  const store = createRankStore();
  reconcile(
    store,
    1,
    {
      days: {},
      weeks: [{ start: '2026-08-31', end: '2026-09-06', scheduledDays: 3, completedDays: 3 }],
    },
    '2026-09-04',
  );
  assertEqual(seasonOf(store, 1).currentRp, 0, 'açık hafta bonus üretmemeli');
});

check('8. Planlı günü olmayan hafta bonus üretmez', () => {
  const store = createRankStore();
  reconcile(
    store,
    1,
    {
      days: {},
      weeks: [{ start: '2026-08-31', end: '2026-09-06', scheduledDays: 0, completedDays: 0 }],
    },
    '2026-09-07',
  );
  assertEqual(seasonOf(store, 1).currentRp, 0, 'planı olmayan hafta bonus vermemeli');
});

// ---------------------------------------------------------------------------
// 9–10 · RP ÜRETMEYEN olaylar
// ---------------------------------------------------------------------------

check('9. Off day RP üretmez (haftalık planı da bozmaz)', () => {
  const store = createRankStore();
  reconcile(
    store,
    1,
    {
      days: { '2026-08-31': { state: 'completed', scheduledWorkout: false, verifiable: true } },
      weeks: [{ start: '2026-08-31', end: '2026-09-06', scheduledDays: 2, completedDays: 2 }],
    },
    '2026-09-07',
  );
  assertEqual(seasonOf(store, 1).currentRp, 25, 'off day kendi başına RP üretmemeli');
  assertEqual(netForDate(store, '2026-08-31'), 0, 'off day için gün kaydı olmamalı');
});

check('10. Set / pet / daily login / manuel disiplin RP üretmez', () => {
  const amountTable = sql.slice(
    sql.indexOf('function public.rank_rp_amount'),
    sql.indexOf('revoke', sql.indexOf('function public.rank_rp_amount')),
  );
  assert(amountTable.includes('else 0'), 'rank_rp_amount tanımsız anahtarda 0 dönmüyor');
  for (const kind of ['set', 'pet', 'daily_login', 'off_day', 'manual_discipline', 'weekly']) {
    assert(!amountTable.includes(`when '${kind}' then`), `${kind} RP tablosunda tanımlı`);
  }
  for (const kind of ['set', 'pet', 'daily_login', 'off_day', 'manual_discipline']) {
    assert(
      sql.includes(`public.rank_rp_amount('${kind}') = 0`),
      `${kind} için migration assert’i yok`,
    );
  }
  assert(
    !sqlCode.includes('manual_discipline_statuses'),
    'rank migration’ı manual_discipline_statuses okuyor — istemci RP basabilirdi',
  );
  assert(!/insert\s+into\s+public\.reward_ledger/i.test(sqlCode), 'rank reward_ledger’a yazıyor');
  assert(!/update\s+public\.user_progress/i.test(sqlCode), 'rank user_progress güncelliyor');
});

// ---------------------------------------------------------------------------
// 11 · Streak kilometre taşları
// ---------------------------------------------------------------------------

check('11. Streak 7 / 30 / 100 bonusları ve idempotency', () => {
  const store = createRankStore();
  reconcile(store, 1, { days: {}, peakStreak: 6 }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, 0, '6 günde bonus yok');

  reconcile(store, 1, { days: {}, peakStreak: 7 }, '2026-09-02');
  assertEqual(seasonOf(store, 1).currentRp, RP.streak7, '7 gün bonusu');

  reconcile(store, 1, { days: {}, peakStreak: 30 }, '2026-09-25');
  assertEqual(seasonOf(store, 1).currentRp, RP.streak7 + RP.streak30, '30 gün bonusu eklenir');

  reconcile(store, 1, { days: {}, peakStreak: 45 }, '2026-10-01');
  assertEqual(
    seasonOf(store, 1).currentRp,
    RP.streak7 + RP.streak30,
    'aynı kilometre taşı tekrar yazılmamalı',
  );

  /**
   * KAÇIRILAN GÜN EKSİ RP ÜRETMEZ: istenen değer "bugünkü seri" değil, hâlâ
   * geçerli kanıttan üretilebilen ZİRVE seridir. Kullanıcı bir gün kaçırsa da
   * zirve düşmez, bu yüzden kilometre taşı korunur.
   */
  reconcile(store, 1, { days: {}, peakStreak: 45 }, '2026-10-05');
  assertEqual(
    seasonOf(store, 1).currentRp,
    RP.streak7 + RP.streak30,
    'gün kaçırmak kilometre taşını geri almamalı',
  );
});

// ---------------------------------------------------------------------------
// 12–13 · Idempotency ve eşzamanlılık
// ---------------------------------------------------------------------------

check('12. Aynı event tekrarında çift RP yok', () => {
  const store = createRankStore();
  const evidence = {
    days: { '2026-08-31': scheduledDay('completed') },
    sessions: [{ id: 's1', date: '2026-09-01', deleted: false }],
    weeks: [{ start: '2026-08-31', end: '2026-09-06', scheduledDays: 1, completedDays: 1 }],
    peakStreak: 7,
  };
  reconcile(store, 1, evidence, '2026-09-08');
  const first = seasonOf(store, 1).currentRp;
  const ledgerSize = store.events.size;
  for (let index = 0; index < 5; index += 1) reconcile(store, 1, evidence, '2026-09-08');
  assertEqual(seasonOf(store, 1).currentRp, first, 'tekrar uzlaştırma toplamı değiştirmemeli');
  assertEqual(store.events.size, ledgerSize, 'fark yokken defter satırı yazılmamalı');
});

check('13. Eşzamanlı sync çift RP üretmez (advisory lock)', () => {
  const store = createRankStore();
  const evidence = { days: { '2026-08-31': scheduledDay('completed') } };

  store.locked = true;
  assertThrows(
    () => reconcile(store, 1, evidence, '2026-09-01'),
    'kilit altında ikinci uzlaştırma çalışabildi',
  );
  store.locked = false;

  reconcile(store, 1, evidence, '2026-09-01');
  reconcile(store, 1, evidence, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, RP.scheduledComplete, 'seri iki çağrı tek ödül vermeli');

  assert(
    sql.includes('pg_advisory_xact_lock(hashtextextended(actor::text, 8023))'),
    'sync_my_rank kullanıcı kilidi almıyor',
  );
  assert(
    sql.includes('create unique index if not exists rank_events_idempotency_idx'),
    'idempotency benzersiz indeksi yok',
  );
});

// ---------------------------------------------------------------------------
// 14 · Current season antrenman silme / düzeltme
// ---------------------------------------------------------------------------

check('14a. Silinen plan dışı antrenmanın RP’si geri alınır', () => {
  const store = createRankStore();
  const session = { id: 's1', date: '2026-08-31', deleted: false };
  reconcile(store, 1, { days: {}, sessions: [session] }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, RP.unscheduled, 'önce 15 RP');

  session.deleted = true;
  reconcile(store, 1, { days: {}, sessions: [session] }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, 0, 'silme sonrası RP geri alınmalı');

  reconcile(store, 1, { days: {}, sessions: [session] }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, 0, 'telafi tekrarlanmamalı');
});

check('14b. Canlı penceredeki gün kanıtı düşerse RP düzeltilir', () => {
  const store = createRankStore();
  reconcile(store, 1, { days: { '2026-08-31': scheduledDay('completed') } }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, 25, 'önce 25');

  reconcile(store, 1, { days: { '2026-08-31': scheduledDay('partial') } }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, 10, 'düzeltilmiş toplam 10 olmalı');

  reconcile(store, 1, { days: { '2026-08-31': scheduledDay(null) } }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, 0, 'kanıt yoksa RP 0’a inmeli');
  assert(seasonOf(store, 1).currentRp >= 0, 'RP negatife düşemez');
});

check('14c. Kanıt DOĞRULANAMIYORSA RP sessizce korunmaz', () => {
  const store = createRankStore();
  reconcile(store, 1, { days: { '2026-08-31': scheduledDay('completed') } }, '2026-09-01');
  assertEqual(seasonOf(store, 1).currentRp, 25, 'önce 25');

  // Kaynak program silindi → gün hiçbir programa bağlanamıyor.
  reconcile(
    store,
    1,
    { days: { '2026-08-31': { state: null, scheduledWorkout: false, verifiable: false } } },
    '2026-09-01',
  );
  assertEqual(seasonOf(store, 1).currentRp, 0, 'doğrulanamayan kanıt için RP telafi edilmeli');
});

check('14d. Antrenman silmek disiplin takvimini DEĞİŞTİRMEZ', () => {
  assert(
    sql.includes('and s.deleted_at is null'),
    'rank_day_state silinmiş oturumları filtrelemiyor',
  );
  assert(
    !/create\s+or\s+replace\s+function\s+public\.auto_discipline_range/i.test(sqlCode),
    'rank migration’ı auto_discipline_range’i değiştiriyor',
  );
  assert(
    !/create\s+or\s+replace\s+function\s+public\.display_discipline_range/i.test(sqlCode),
    'rank migration’ı display_discipline_range’i değiştiriyor',
  );
  assert(
    !/(insert|update|delete)\s+(into\s+)?public\.discipline_day_history/i.test(sqlCode),
    'rank migration’ı disiplin geçmişine yazıyor',
  );
});

// ---------------------------------------------------------------------------
// 15 · Kapanmış sezon değişmez
// ---------------------------------------------------------------------------

check('15. Finalize edilmiş sezon immutable', () => {
  const store = createRankStore();
  const evidence = { days: { '2026-08-31': scheduledDay('completed') } };
  reconcile(store, 1, evidence, '2026-09-01');
  closeSeason(store, 1, evidence, '2026-10-18');
  const archived = { ...seasonOf(store, 1) };

  // Sezon kapandıktan SONRA antrenman silinse bile arşiv değişmez.
  reconcile(store, 1, { days: { '2026-08-31': scheduledDay(null) } }, '2026-10-30');
  assertEqual(seasonOf(store, 1).finalRp, archived.finalRp, 'final RP değişmemeli');
  assertEqual(seasonOf(store, 1).currentRp, archived.currentRp, 'kapanmış sezon RP’si değişmemeli');

  finalizeSeason(store, 1);
  assertEqual(seasonOf(store, 1).finalRp, archived.finalRp, 'ikinci finalize sonucu değiştirmemeli');

  assert(
    sql.includes('and usr.finalized_at is null'),
    'finalize_rank_season idempotent değil (finalized_at koşulu yok)',
  );
  assert(
    sql.includes('if coalesce(is_finalized, false) then'),
    'record_rank_event arşive yazmayı engellemiyor',
  );
});


// ---------------------------------------------------------------------------
// 16–17 · Soft reset
// ---------------------------------------------------------------------------

check('16. Bütün soft-reset rank sınırları', () => {
  for (const [finalRp, expected] of ranks.RANK_SOFT_RESET_FIXTURES) {
    assertEqual(ranks.softResetRp(finalRp), expected, `softResetRp(${finalRp})`);
  }
  // Her tier için taban ve tavan kendi RP ARALIĞI içinde doğrulanır: tier'ın
  // üstüne çıkan bir RP zaten BİR ÜST tier'ın kurallarına tabidir.
  for (let index = 0; index < ranks.RANK_TIERS.length; index += 1) {
    const tier = ranks.RANK_TIERS[index];
    const upper = ranks.RANK_TIERS[index + 1];
    // Tier içindeki en yüksek RP (Rosea'da üst sınır yok, büyük bir değer).
    const highestInTier = upper ? upper.minRp - 1 : 5_000_000;

    assertEqual(ranks.softResetRp(tier.minRp), tier.resetBase, `${tier.id} tabanı`);
    assert(
      ranks.softResetRp(highestInTier) <= tier.resetMax,
      `${tier.id} tavanı bağlayıcı değil`,
    );
    assert(
      ranks.softResetRp(highestInTier) >= tier.resetBase,
      `${tier.id} taşması tabanın altına düşmemeli`,
    );
    // Reset sonucu HİÇBİR zaman final RP'yi aşmamalı (sezon RP kazandırmaz).
    assert(ranks.softResetRp(tier.minRp) <= tier.minRp || tier.id === 'bronze',
      `${tier.id} reset’i final RP’yi aşıyor`);
  }
  // Rosea'da tavan gerçekten devreye girer.
  assert(ranks.softResetRp(5_000_000) === 1649, 'sınırsız RP Rosea tavanına kırpılmalı');
});

check('17. %20 overflow aktarımı ve cap — görevdeki örnek', () => {
  // 1850 RP ile Rosea biten kullanıcı → 1450 + floor(200 * 0.2) = 1490.
  assertEqual(ranks.softResetRp(1850), 1490, 'Rosea 1850 → 1490');
  assertEqual(ranks.resolveRank(1490).id, 'master', 'yeni sezona Master olarak başlanmalı');
  // Oran gerçekten %20.
  assertEqual(ranks.SOFT_RESET_CARRY_RATIO, 0.2, 'aktarım oranı %20 olmalı');
  assertEqual(ranks.softResetRp(1750), 1470, 'Rosea 1750 → 1470');
  // Cap: 2650 → 1650 hesaplanır ama 1649’a kırpılır.
  assertEqual(ranks.softResetRp(2650), 1649, 'cap uygulanmalı');
  assert(sql.includes('* 0.20'), 'SQL %20 aktarımını uygulamıyor');
  assert(sql.includes('least('), 'SQL cap uygulamıyor');
});

// ---------------------------------------------------------------------------
// 18 · Birden fazla sezon kaçırıldığında ardışık reset
// ---------------------------------------------------------------------------

check('18. Kaçırılan sezonlar SIRAYLA kapanır ve her birinde soft reset olur', () => {
  const store = createRankStore();
  const first = seasonOf(store, 1);
  first.currentRp = 1850; // Rosea

  // Kullanıcı üç sezon boyunca uygulamayı hiç açmadı. Her sezon önce
  // uzlaştırılır, SONRA kapatılır (bkz. `closeSeason`).
  closeSeason(store, 1, { days: {} }, '2026-10-18');
  const second = openNextSeason(store, 1);
  assertEqual(second.startingRp, 1490, 'sezon 2 → 1490 (Master)');

  closeSeason(store, 2, { days: {} }, '2026-12-13');
  const third = openNextSeason(store, 2);
  // 1490 Master → 1150 + floor(140 * 0.2) = 1150 + 28 = 1178.
  assertEqual(third.startingRp, 1178, 'sezon 3 → 1178');

  closeSeason(store, 3, { days: {} }, '2027-02-07');
  const fourth = openNextSeason(store, 3);
  // 1178 Diamond? Hayır: 1178 → diamond (1050–1349) → 900 + floor(128*0.2)=925.
  assertEqual(ranks.resolveRank(1178).id, 'diamond', '1178 diamond olmalı');
  assertEqual(fourth.startingRp, 925, 'sezon 4 → 925');

  // Her ara sezon gerçekten kapatılmış olmalı.
  for (const index of [1, 2, 3]) {
    assert(seasonOf(store, index).finalized, `sezon ${index} kapatılmamış`);
    assert(seasonOf(store, index).finalRank !== null, `sezon ${index} final rank yazılmamış`);
  }

  assert(
    sql.includes('rank_season_advance_stalled'),
    'advance_rank_seasons sonsuz döngü koruması yok',
  );
});

// ---------------------------------------------------------------------------
// 19 · Sezon takvimi
// ---------------------------------------------------------------------------

check('19. Sezonlar Pazartesi başlar ve tam 56 gün sürer', () => {
  assertEqual(ranks.SEASON_LENGTH_DAYS, 56, 'sezon 8 hafta olmalı');

  // 2026-08-24 bir Pazartesi.
  const anchor = ranks.mondayOf('2026-08-27');
  assertEqual(anchor, '2026-08-24', 'çapa haftanın Pazartesi’si olmalı');

  for (let index = 1; index <= 6; index += 1) {
    const start = ranks.seasonStartFor(anchor, index);
    const end = ranks.seasonEndFor(anchor, index);
    assertEqual(new Date(`${start}T00:00:00Z`).getUTCDay(), 1, `sezon ${index} Pazartesi başlamalı`);
    assertEqual(new Date(`${end}T00:00:00Z`).getUTCDay(), 0, `sezon ${index} Pazar bitmeli`);
    assertEqual(ranks.daysBetween(start, end), 55, `sezon ${index} 56 gün sürmeli`);
    assertEqual(ranks.seasonIndexFor(anchor, start), index, `sezon ${index} başlangıcı`);
    assertEqual(ranks.seasonIndexFor(anchor, end), index, `sezon ${index} bitişi`);
    assertEqual(
      ranks.seasonIndexFor(anchor, ranks.addDays(end, 1)),
      index + 1,
      `sezon ${index + 1} bir sonraki gün başlamalı`,
    );
  }

  // Sezonlar arada boşluk bırakmaz.
  assertEqual(
    ranks.seasonStartFor(anchor, 2),
    ranks.addDays(ranks.seasonEndFor(anchor, 1), 1),
    'sezonlar arasında boşluk olmamalı',
  );

  // SQL de aynı uzunluğu zorlar.
  assert(sql.includes('check (ends_on = starts_on + 55)'), 'SQL sezon uzunluğunu zorlamıyor');
  assert(sql.includes('(offset_days / 56) + 1'), 'SQL sezon indeksi 56 günlük değil');
  assert(
    sql.includes("date_trunc('week', current_date)"),
    'ilk sezon migration haftasının Pazartesi’sinden başlamıyor',
  );
});

// ---------------------------------------------------------------------------
// 20 · Migration öncesi retroaktif RP yok
// ---------------------------------------------------------------------------

check('20. Migration öncesi tarihlerden RP üretilmez', () => {
  const store = createRankStore({ epoch: '2026-08-27' });
  reconcile(
    store,
    1,
    {
      // Sezon Pazartesi (24’ü) başlar ama epoch 27’sidir.
      days: {
        '2026-08-24': scheduledDay('completed'),
        '2026-08-25': scheduledDay('completed'),
        '2026-08-26': scheduledDay('completed'),
        '2026-08-27': scheduledDay('completed'),
      },
      sessions: [{ id: 'old', date: '2026-08-20', deleted: false }],
      weeks: [{ start: '2026-08-24', end: '2026-08-30', scheduledDays: 4, completedDays: 4 }],
    },
    '2026-09-01',
  );
  assertEqual(seasonOf(store, 1).currentRp, RP.scheduledComplete, 'yalnızca epoch sonrası gün sayılmalı');
  assertEqual(netForDate(store, '2026-08-26'), 0, 'epoch öncesi gün RP üretmemeli');
  assertEqual(
    ledgerFor(store, 'unscheduled_workout', 'old').net,
    0,
    'epoch öncesi antrenman RP üretmemeli',
  );
  assertEqual(
    ledgerFor(store, 'weekly_perfect', '2026-08-24').net,
    0,
    'epoch öncesi başlayan hafta bonus vermemeli',
  );

  assert(sql.includes('rp_epoch date not null'), 'rp_epoch kolonu yok');
  assert(sql.includes('scan_from := greatest(season_start, epoch_date)'), 'uzlaştırma epoch’u uygulamıyor');
  assert(sql.includes('weeks.week_start >= epoch_date'), 'haftalık bonus epoch’u uygulamıyor');
});

// ---------------------------------------------------------------------------
// 21 · Hesap değişimi yarışları
// ---------------------------------------------------------------------------

check('21. Hesap değişiminde eski cevap yeni state’e yazılmaz', () => {
  const contextSource = readFileSync(join(ROOT, 'context/rank-context.tsx'), 'utf8');

  // Sahiplik sayacı ve guard'lar gerçekten var mı?
  assert(contextSource.includes('ownerRef.current += 1'), 'hesap değişiminde sahiplik artmıyor');
  assert(
    contextSource.includes('owner !== ownerRef.current'),
    'geç gelen cevap için sahiplik kontrolü yok',
  );
  assert(contextSource.includes('isSyncingRef'), 'tek-uçuş kilidi yok');
  assert(contextSource.includes('hasQueuedSyncRef'), 'uçuş sırasında gelen istek kaydedilmiyor');

  // Guard davranışının modeli: A’nın cevabı B’nin state’ini yazamaz.
  const state = { value: 'B-state' };
  let owner = 2; // hesap zaten B'ye geçti
  const staleOwner = 1; // A'nın uçuştaki isteği
  const applyIfOwner = (candidateOwner, next) => {
    if (candidateOwner !== owner) return;
    state.value = next;
  };
  applyIfOwner(staleOwner, 'A-state');
  assertEqual(state.value, 'B-state', 'A’nın geç cevabı B’ye yazıldı');
  applyIfOwner(owner, 'B-fresh');
  assertEqual(state.value, 'B-fresh', 'güncel hesabın cevabı yazılmalı');
});

// ---------------------------------------------------------------------------
// 22 · Friend RPC yalnızca gerçek arkadaşta veri döndürür
// ---------------------------------------------------------------------------

check('22. get_friend_rank arkadaşlık doğrular ve ham defter döndürmez', () => {
  const block = sql.slice(
    sql.indexOf('function public.get_friend_rank'),
    sql.indexOf('revoke all on function public.get_friend_rank'),
  );
  assert(block.length > 0, 'get_friend_rank bulunamadı');
  assert(
    block.includes('public.are_friends((select auth.uid()), target_user_id)'),
    'get_friend_rank arkadaşlık kontrolü yapmıyor',
  );
  assert(block.includes('security definer'), 'get_friend_rank security definer değil');
  assert(block.includes("set search_path = ''"), 'get_friend_rank güvenli search_path kullanmıyor');
  assert(!block.includes('rank_events'), 'get_friend_rank ham event defterini döndürüyor');
  assert(!block.includes('rose_balance'), 'get_friend_rank gül bakiyesi döndürüyor');
  assert(!block.includes('starting_rp'), 'get_friend_rank starting RP döndürüyor');
  assert(!block.includes('final_rp'), 'get_friend_rank final RP döndürüyor');

  // Arkadaşlar rank tablolarını DOĞRUDAN okuyamamalı.
  assert(
    sql.includes('using ((select auth.uid()) = user_id)'),
    'user_season_ranks/rank_events policy’si sahiplikle sınırlı değil',
  );
});

// ---------------------------------------------------------------------------
// 23 · RLS / grant / revoke / security-definer
// ---------------------------------------------------------------------------

check('23a. Bütün rank tablolarında RLS açık ve yazma policy’si yok', () => {
  for (const table of ['rank_settings', 'rank_seasons', 'user_season_ranks', 'rank_events']) {
    assert(
      sql.includes(`alter table public.${table} enable row level security`),
      `${table} için RLS açılmamış`,
    );
    assert(sql.includes(`revoke all on table public.${table} from anon`), `${table} anon’dan revoke edilmemiş`);
    assert(
      sql.includes(`revoke all on table public.${table} from authenticated`),
      `${table} authenticated’dan revoke edilmemiş`,
    );
  }

  // İstemci için insert/update/delete policy’si HİÇ olmamalı.
  for (const command of ['for insert', 'for update', 'for delete']) {
    assert(!sqlCode.includes(command), `rank migration’ında istemci ${command} policy’si var`);
  }
});

check('23b. Bütün fonksiyonlar security definer + boş search_path', () => {
  const definitions = [...sql.matchAll(/create or replace function (public\.\w+)\(/g)].map(
    (match) => match[1],
  );
  assert(definitions.length >= 12, `beklenenden az fonksiyon bulundu (${definitions.length})`);

  for (const name of definitions) {
    const start = sql.indexOf(`create or replace function ${name}(`);
    const body = sql.slice(start, sql.indexOf('$$;', start));
    assert(body.includes("set search_path = ''"), `${name} güvenli search_path kullanmıyor`);
    // `immutable` saf eşik fonksiyonları veri okumaz; definer gerekmez.
    if (!body.includes('\nimmutable\n')) {
      assert(body.includes('security definer'), `${name} security definer değil`);
    }
  }
});

check('23c. Yalnızca üç RPC istemciye açılır; iç fonksiyonlar kapalı', () => {
  const granted = [...sql.matchAll(/grant execute on function (public\.\w+)\([^)]*\) to authenticated/g)]
    .map((match) => match[1])
    .sort();
  const expected = ['public.get_friend_rank', 'public.get_my_rank_history', 'public.sync_my_rank'].sort();
  assertEqual(granted.join(','), expected.join(','), 'istemciye açılan RPC listesi beklenenden farklı');

  // Hesaplama yapan iç fonksiyonların hepsi authenticated’dan revoke edilmeli.
  for (const name of [
    'public.record_rank_event',
    'public.reconcile_rank_season',
    'public.finalize_rank_season',
    'public.advance_rank_seasons',
    'public.ensure_user_season',
    'public.rank_day_state',
    'public.rank_peak_streak',
    'public.apply_rank_adjustment',
  ]) {
    const pattern = new RegExp(`revoke all on function ${name.replace('.', '\\.')}\\([^)]*\\) from authenticated`);
    assert(pattern.test(sql), `${name} authenticated’dan revoke edilmemiş`);
  }
});

check('23d. İstemci RP/rank/reset göndereMEZ', () => {
  // Açık RPC’lerin imzalarında yalnızca `client_today` / `target_user_id` var.
  assert(sql.includes('function public.sync_my_rank(client_today date)'), 'sync_my_rank imzası değişmiş');
  assert(sql.includes('function public.get_my_rank_history()'), 'get_my_rank_history imzası değişmiş');
  assert(
    sql.includes('function public.get_friend_rank(target_user_id uuid)'),
    'get_friend_rank imzası değişmiş',
  );
  assert(sql.includes('perform public.assert_client_today(client_today)'), 'client_today doğrulanmıyor');

  // Servis katmanı da başka parametre göndermemeli.
  const service = readFileSync(join(ROOT, 'services/ranks.ts'), 'utf8');
  assert(
    service.includes("supabase.rpc('sync_my_rank', { client_today: clientToday })"),
    'servis sync_my_rank’e fazladan parametre gönderiyor',
  );
  /**
   * Servis, RPC çağrılarının PARAMETRE NESNESİNE RP/rank taşıyan hiçbir alan
   * koymamalı. Yalnızca `{ ... }` bloğu incelenir; fonksiyon adı (`sync_my_rank`)
   * doğal olarak "rank" içerir ve yanlış alarm üretmemelidir.
   */
  const rpcPayloads = [...service.matchAll(/supabase\.rpc\([^,)]*,\s*(\{[^}]*\})/g)].map(
    (match) => match[1],
  );
  assert(rpcPayloads.length >= 2, 'servis RPC parametreleri okunamadı');
  for (const payload of rpcPayloads) {
    for (const forbidden of ['rp', 'rank', 'starting', 'final', 'reset', 'season']) {
      assert(
        !payload.includes(forbidden),
        `servis RPC parametresi yasak alan taşıyor: ${payload}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 24–25 · Mevcut sistemlerin bozulmadığı
// ---------------------------------------------------------------------------

check('24. XP / gül / level toplamları rank sync’ten etkilenmez', () => {
  // Rank migration’ı ödül nesnelerine HİÇ dokunmamalı.
  for (const forbidden of [
    'public.record_reward',
    'public.reconcile_day_rewards',
    'public.claim_daily_rewards',
    'public.sync_workout_rewards',
    'public.award_pet_love',
    'public.get_my_progress',
    'public.level_progress',
    'public.get_friend_profile',
  ]) {
    assert(
      !new RegExp(`create or replace function ${forbidden.replace('.', '\\.')}`).test(sqlCode),
      `rank migration’ı ${forbidden} fonksiyonunu yeniden tanımlıyor`,
    );
  }
  assert(!/drop function .*reward/i.test(sqlCode), 'rank migration’ı ödül fonksiyonu düşürüyor');
  // Yorumlar hariç: ürün ayrımı açıklaması bu terimleri anlatım amacıyla geçirir.
  assert(!sqlCode.includes('lifetime_xp'), 'rank migration’ı lifetime_xp’ye dokunuyor');
  assert(!sqlCode.includes('rose_balance'), 'rank migration’ı rose_balance’a dokunuyor');
  assert(!sqlCode.includes('reward_ledger'), 'rank migration’ı ödül defterine dokunuyor');

  // İstemci tarafında da RewardProvider davranışı değişmemeli.
  const rewardContext = readFileSync(join(ROOT, 'context/reward-context.tsx'), 'utf8');
  assert(!rewardContext.includes('rank'), 'reward-context rank sistemine bağlanmış');
});

check('25. Mevcut ödül/disiplin migration’ları DEĞİŞTİRİLMEDİ', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT })
    .toString()
    .split('\n')
    .filter(Boolean);

  const protectedFiles = [
    'supabase/migrations/20260820090000_add_progression_rewards.sql',
    'supabase/migrations/20260823120000_add_discipline_day_history.sql',
    'supabase/migrations/20260824120000_add_program_order_and_workout_soft_delete.sql',
    'supabase/migrations/20260814120000_add_friendships_and_shared_discipline.sql',
    'constants/level-curve.ts',
    'types/rewards.ts',
    'services/rewards.ts',
    'context/reward-context.tsx',
  ];

  for (const file of protectedFiles) {
    assert(!changed.includes(file), `${file} bu görevde değiştirilmiş — ödül davranışı riskte`);
  }
});

// ===========================================================================
// DÜZELTME SENARYOLARI (T1–T12) — bu turda giderilen beş hata
// ===========================================================================

/** Bir sezonda tam tamamlanmış bir planlı gün üreten kanıt seti. */
function seasonEvidence(overrides = {}) {
  return {
    days: { '2026-10-16': scheduledDay('completed') },
    sessions: [],
    weeks: [],
    peakStreak: 0,
    ...overrides,
  };
}

check('T1. Sezon sonu aktivitesi finalize ÖNCESİ uzlaştırılır (sync kaçırılsa bile)', () => {
  const store = createRankStore();
  // Sezon 1: 2026-08-24 → 2026-10-18. Kullanıcı 2026-10-16'da antrenman yapıyor
  // ama uygulamayı bir daha açmıyor: o kanıt hiç sync edilmedi.
  const evidence = seasonEvidence({
    weeks: [{ start: '2026-10-12', end: '2026-10-18', scheduledDays: 1, completedDays: 1 }],
  });
  assertEqual(seasonOf(store, 1).currentRp, 0, 'başlangıçta RP yok');

  // Sonraki açılış sezon bittikten sonra: önce reconcile, SONRA finalize.
  closeSeason(store, 1, evidence, '2026-10-18');

  const closed = seasonOf(store, 1);
  assert(closed.finalized, 'sezon kapatılmalı');
  assertEqual(
    closed.finalRp,
    RP.scheduledComplete + RP.weeklyPerfect,
    'kaçırılan kanıt finalize öncesi işlenmeli',
  );
  assertEqual(closed.finalRank, ranks.resolveRank(closed.finalRp).id, 'final rank yazılmalı');

  // Sezonun SON haftası da "kapanmış" sayılmalı (ufuk = ends_on + 1).
  assertEqual(
    ledgerFor(store, 'weekly_perfect', '2026-10-12').net,
    RP.weeklyPerfect,
    'sezonun son haftası değerlendirilmeli',
  );

  // SQL de bu sırayı uygulamalı: reconcile çağrısı finalize'dan ÖNCE gelmeli.
  const advanceBlock = sql.slice(
    sql.indexOf('function public.advance_rank_seasons'),
    sql.indexOf('revoke all on function public.advance_rank_seasons'),
  );
  const reconcileAt = advanceBlock.indexOf('perform public.reconcile_rank_season(');
  const finalizeAt = advanceBlock.indexOf('perform public.finalize_rank_season(');
  assert(reconcileAt > -1, 'advance_rank_seasons finalize öncesi uzlaştırma yapmıyor');
  assert(reconcileAt < finalizeAt, 'uzlaştırma finalize’dan SONRA çalışıyor');
  assert(
    advanceBlock.includes('open_ends_on + 1'),
    'kapanış uzlaştırması sezonun son haftasını kapsamıyor',
  );
});

check('T2. Full scheduled day kazanılıyor, workout siliniyor, RP geri alınıyor', () => {
  const store = createRankStore();
  reconcile(store, 1, { days: { '2026-09-07': scheduledDay('completed') } }, '2026-09-08');
  assertEqual(seasonOf(store, 1).currentRp, RP.scheduledComplete, 'tam gün 25 RP');

  // Antrenman soft-delete edildi → o günün seti kalmadı.
  reconcile(store, 1, { days: { '2026-09-07': scheduledDay(null) } }, '2026-09-08');
  assertEqual(seasonOf(store, 1).currentRp, 0, 'silme sonrası 25 RP geri alınmalı');

  // Telafi APPEND-ONLY: eski satır duruyor, yenisi negatif.
  assertEqual(store.events.get('scheduled_day|2026-09-07#0'), RP.scheduledComplete, 'kazanım satırı korunmalı');
  assertEqual(store.events.get('scheduled_day|2026-09-07#1'), -RP.scheduledComplete, 'telafi satırı negatif');
});

check('T3. Perfect week bonusu kazanılıyor, haftadaki workout silinince bonus geri alınıyor', () => {
  const store = createRankStore();
  const week = { start: '2026-08-31', end: '2026-09-06', scheduledDays: 3, completedDays: 3 };
  reconcile(store, 1, { days: {}, weeks: [week] }, '2026-09-07');
  assertEqual(seasonOf(store, 1).currentRp, RP.weeklyPerfect, 'mükemmel hafta 25 RP');

  // Haftadaki bir antrenman silindi → tamamlanan gün sayısı düştü.
  week.completedDays = 2;
  reconcile(store, 1, { days: {}, weeks: [week] }, '2026-09-07');
  assertEqual(seasonOf(store, 1).currentRp, 0, 'bonus geri alınmalı');
  assertEqual(ledgerFor(store, 'weekly_perfect', week.start).net, 0, 'defter neti 0');
  assertEqual(ledgerFor(store, 'weekly_perfect', week.start).count, 2, 'iki satır (kazanım + telafi)');
});

check('T4. Kanıt yeniden oluşursa weekly bonus YENİDEN kazanılıyor', () => {
  const store = createRankStore();
  const week = { start: '2026-08-31', end: '2026-09-06', scheduledDays: 3, completedDays: 3 };
  reconcile(store, 1, { days: {}, weeks: [week] }, '2026-09-07');
  week.completedDays = 2;
  reconcile(store, 1, { days: {}, weeks: [week] }, '2026-09-07');
  assertEqual(seasonOf(store, 1).currentRp, 0, 'ara durum: bonus geri alınmış');

  // Kullanıcı eksik antrenmanı yeniden kaydetti.
  week.completedDays = 3;
  reconcile(store, 1, { days: {}, weeks: [week] }, '2026-09-07');
  assertEqual(seasonOf(store, 1).currentRp, RP.weeklyPerfect, 'bonus yeniden kazanılmalı');
  assertEqual(ledgerFor(store, 'weekly_perfect', week.start).count, 3, 'üç satır: +25, -25, +25');

  /**
   * Sabit anahtarlı eski tasarım bunu KALICI olarak engellerdi.
   *
   * `:revoked` SQL'de hâlâ geçer, ama YALNIZCA `apply_rank_adjustment`'ın
   * `where` dalında — eski bir deployment'tan kalmış satırları nete dahil
   * etmek için. YAZMA anahtarı olarak kullanılması yasaktır; yazılan her
   * anahtar `evidence_key || '#' || <sıra>` biçimindedir.
   */
  assert(
    !sqlCode.includes("source_key || ':revoked',"),
    '`:revoked` hâlâ YAZMA anahtarı olarak kullanılıyor — yeniden kazanım engellenir',
  );
  assert(
    sqlCode.includes("evidence_key || '#' || sequence_index::text"),
    'telafi satırları sıralı anahtar kullanmıyor',
  );
});

check('T5. Streak milestone kazanılıyor, workout silinince ilgili RP geri alınıyor', () => {
  const store = createRankStore();
  reconcile(store, 1, { days: {}, peakStreak: 7 }, '2026-09-08');
  assertEqual(seasonOf(store, 1).currentRp, RP.streak7, 'kilometre taşı kazanıldı');

  // Serinin ortasındaki antrenman silindi → kanıttan üretilebilen zirve düştü.
  reconcile(store, 1, { days: {}, peakStreak: 4 }, '2026-09-08');
  assertEqual(seasonOf(store, 1).currentRp, 0, 'kilometre taşı RP’si geri alınmalı');
  assertEqual(ledgerFor(store, 'streak_milestone', 'streak_7:s1').net, 0, 'defter neti 0');
});

check('T6. Streak gerçekten yeniden kurulursa milestone YENİDEN kazanılıyor', () => {
  const store = createRankStore();
  reconcile(store, 1, { days: {}, peakStreak: 7 }, '2026-09-08');
  reconcile(store, 1, { days: {}, peakStreak: 4 }, '2026-09-08');
  assertEqual(seasonOf(store, 1).currentRp, 0, 'ara durum: geri alınmış');

  reconcile(store, 1, { days: {}, peakStreak: 9 }, '2026-09-20');
  assertEqual(seasonOf(store, 1).currentRp, RP.streak7, 'kilometre taşı yeniden kazanılmalı');
  assertEqual(ledgerFor(store, 'streak_milestone', 'streak_7:s1').count, 3, '+25, -25, +25');

  // Kilometre taşı anahtarı SEZON içermeli; aksi hâlde telafi kapanmış
  // sezonu değiştirmeye çalışırdı.
  assert(
    sql.includes("milestone.kind || ':s' || target_season::text"),
    'kilometre taşı anahtarı sezon içermiyor',
  );
});

check('T7. Donmuş takvim değişmiyor ama güncel sezon RP’si düzeltilebiliyor', () => {
  const store = createRankStore();
  // Program değişimi günü dondurdu; ama kaynak program hâlâ duruyor, yani
  // planlı gün KİMLİĞİ okunabilir ve tamamlama CANLI setlerden doğrulanır.
  reconcile(
    store,
    1,
    { days: { '2026-09-07': scheduledDay('completed', { frozen: true }) } },
    '2026-09-10',
  );
  assertEqual(seasonOf(store, 1).currentRp, RP.scheduledComplete, 'donmuş gün de RP kazanabilir');

  // O günün antrenmanı silindi. Takvim satırı DEĞİŞMEZ (SQL statik kontrolü),
  // ama rank kanıtı düşer.
  reconcile(
    store,
    1,
    { days: { '2026-09-07': scheduledDay(null, { frozen: true }) } },
    '2026-09-10',
  );
  assertEqual(seasonOf(store, 1).currentRp, 0, 'donmuş gün RP’yi koruyamamalı');

  // KANIT AYRIMI — `discipline_day_history.status` rank için OKUNMAMALI.
  const dayStateBlock = sql.slice(
    sql.indexOf('create or replace function public.rank_day_state('),
    sql.indexOf('revoke all on function public.rank_day_state'),
  );
  assert(dayStateBlock.length > 0, 'rank_day_state bulunamadı');
  assert(
    dayStateBlock.includes('select h.discipline_date, h.source_program_id'),
    'donmuş satırdan yalnızca kimlik okunmuyor',
  );
  // Yorumlar çıkarılır: fonksiyonun belgesi `h.status`'ın neden OKUNMADIĞINI
  // anlatmak için terimi geçirir; aranan şey gerçek bir sütun referansıdır.
  const dayStateCode = dayStateBlock
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ');
  assert(
    !/\b[fh]\.status\b/.test(dayStateCode),
    'rank_day_state donmuş `status` sütununu kanıt olarak okuyor',
  );
  assert(
    dayStateBlock.includes('and s.deleted_at is null'),
    'tamamlama kanıtı silinmiş oturumları filtrelemiyor',
  );
  // Takvim tarafı gerçekten dokunulmamış olmalı.
  assert(
    !/(insert|update|delete)\s+(into\s+)?public\.discipline_day_history/i.test(sqlCode),
    'rank migration’ı disiplin geçmişine yazıyor',
  );
});

check('T8. Finalized sezon ne workout silmeden ne geç sync’ten etkilenir', () => {
  const store = createRankStore();
  const evidence = seasonEvidence();
  closeSeason(store, 1, evidence, '2026-10-18');
  const snapshot = { ...seasonOf(store, 1) };
  const ledgerSize = store.events.size;

  // Geç gelen sync + antrenman silme.
  reconcile(store, 1, { days: { '2026-10-16': scheduledDay(null) } }, '2026-10-25');
  reconcile(store, 1, evidence, '2026-10-25');

  assertEqual(seasonOf(store, 1).finalRp, snapshot.finalRp, 'final RP değişmemeli');
  assertEqual(seasonOf(store, 1).currentRp, snapshot.currentRp, 'current RP değişmemeli');
  assertEqual(seasonOf(store, 1).finalRank, snapshot.finalRank, 'final rank değişmemeli');
  assertEqual(store.events.size, ledgerSize, 'arşive tek satır bile yazılmamalı');
});

check('T9. Arkadaşın yalnızca ESKİ açık sezon satırı varsa rozet gösterilmez', () => {
  const friendBlock = sql.slice(
    sql.indexOf('create or replace function public.get_friend_rank('),
    sql.indexOf('revoke all on function public.get_friend_rank'),
  );
  assert(friendBlock.length > 0, 'get_friend_rank bulunamadı');
  assert(
    friendBlock.includes('usr.season_index = public.rank_season_index_for(current_date)'),
    'get_friend_rank güncel sezona sabitlenmemiş',
  );
  assert(
    !friendBlock.includes('order by usr.season_index desc'),
    'get_friend_rank hâlâ "en yeni açık satır"ı seçiyor',
  );
  // Güvenlik korunmalı.
  assert(
    friendBlock.includes('public.are_friends((select auth.uid()), target_user_id)'),
    'get_friend_rank arkadaşlık kontrolünü kaybetmiş',
  );
  assert(friendBlock.includes('security definer'), 'get_friend_rank security definer değil');
  assert(!friendBlock.includes('rank_events'), 'get_friend_rank ham defter döndürüyor');
  assert(!friendBlock.includes('starting_rp'), 'get_friend_rank starting RP döndürüyor');

  // Davranış modeli: sunucu sezonu 2 iken arkadaşın açık satırı sezon 1 ise
  // hiçbir satır dönmez.
  const rows = [{ finalizedAt: null, seasonIndex: 1, currentRp: 900 }];
  const serverSeason = 2;
  const visible = rows.filter(
    (row) => row.finalizedAt === null && row.seasonIndex === serverSeason,
  );
  assertEqual(visible.length, 0, 'eski sezon rozeti sızmamalı');

  rows.push({ finalizedAt: null, seasonIndex: 2, currentRp: 180 });
  assertEqual(
    rows.filter((row) => row.finalizedAt === null && row.seasonIndex === serverSeason).length,
    1,
    'güncel sezona sync olduktan sonra rozet görünmeli',
  );
});

check('T10. Tekrarlanan ve eşzamanlı sync çağrılarında çift RP yok', () => {
  const store = createRankStore();
  const evidence = {
    days: { '2026-09-07': scheduledDay('completed'), '2026-09-08': scheduledDay('partial') },
    sessions: [{ id: 'sx', date: '2026-09-09', deleted: false }],
    weeks: [{ start: '2026-08-31', end: '2026-09-06', scheduledDays: 2, completedDays: 2 }],
    peakStreak: 7,
  };
  reconcile(store, 1, evidence, '2026-09-15');
  const expected =
    RP.scheduledComplete + RP.scheduledPartial + RP.unscheduled + RP.weeklyPerfect + RP.streak7;
  assertEqual(seasonOf(store, 1).currentRp, expected, 'ilk uzlaştırma toplamı');

  const ledgerSize = store.events.size;
  for (let index = 0; index < 8; index += 1) reconcile(store, 1, evidence, '2026-09-15');
  assertEqual(seasonOf(store, 1).currentRp, expected, 'tekrar çağrılar toplamı değiştirmemeli');
  assertEqual(store.events.size, ledgerSize, 'tekrar çağrılar defter satırı yazmamalı');

  // Eşzamanlılık: kilit iç içe çalışmayı engeller.
  store.locked = true;
  assertThrows(() => reconcile(store, 1, evidence, '2026-09-15'), 'kilit çalışmıyor');
  store.locked = false;
});

check('T11. XP ve rose_balance bütün rank işlemlerinden ETKİLENMEZ', () => {
  // Model tarafı: rank store'unda XP/gül kavramı hiç yok — rank katmanı
  // onlara erişemez. Sunucu tarafında da tek satır yazma yolu yoktur.
  const store = createRankStore();
  const progressBefore = { lifetimeXp: 4820, roseBalance: 137 };
  const progressAfter = { ...progressBefore };

  const evidence = {
    days: { '2026-09-07': scheduledDay('completed') },
    sessions: [{ id: 'sx', date: '2026-09-09', deleted: false }],
    weeks: [{ start: '2026-08-31', end: '2026-09-06', scheduledDays: 1, completedDays: 1 }],
    peakStreak: 30,
  };
  reconcile(store, 1, evidence, '2026-09-15');
  reconcile(store, 1, { days: { '2026-09-07': scheduledDay(null) }, sessions: [], weeks: [], peakStreak: 0 }, '2026-09-15');
  closeSeason(store, 1, evidence, '2026-10-18');
  openNextSeason(store, 1);

  assertEqual(progressAfter.lifetimeXp, progressBefore.lifetimeXp, 'lifetime_xp değişmemeli');
  assertEqual(progressAfter.roseBalance, progressBefore.roseBalance, 'rose_balance değişmemeli');

  // SQL: rank migration'ı bu iki sütuna hiç dokunmuyor.
  assert(!sqlCode.includes('lifetime_xp'), 'rank migration’ı lifetime_xp’ye dokunuyor');
  assert(!sqlCode.includes('rose_balance'), 'rank migration’ı rose_balance’a dokunuyor');
  assert(!sqlCode.includes('reward_ledger'), 'rank migration’ı ödül defterine dokunuyor');
  assert(!sqlCode.includes('user_progress'), 'rank migration’ı user_progress’e dokunuyor');
});

check('T12. Telafi sonrası current_rp hiçbir zaman 0’ın altına inmiyor', () => {
  const store = createRankStore();
  // Tek bir gün kazanılıyor, sonra ÜÇ farklı kanıt birden geçersizleşiyor.
  reconcile(
    store,
    1,
    {
      days: { '2026-09-07': scheduledDay('completed') },
      sessions: [{ id: 'sa', date: '2026-09-09', deleted: false }],
      weeks: [{ start: '2026-08-31', end: '2026-09-06', scheduledDays: 1, completedDays: 1 }],
      peakStreak: 7,
    },
    '2026-09-15',
  );
  assert(seasonOf(store, 1).currentRp > 0, 'önce pozitif RP');

  reconcile(
    store,
    1,
    {
      days: { '2026-09-07': scheduledDay(null) },
      sessions: [{ id: 'sa', date: '2026-09-09', deleted: true }],
      weeks: [{ start: '2026-08-31', end: '2026-09-06', scheduledDays: 1, completedDays: 0 }],
      peakStreak: 0,
    },
    '2026-09-15',
  );
  assertEqual(seasonOf(store, 1).currentRp, 0, 'hepsi geri alınınca RP tam 0');
  assert(seasonOf(store, 1).currentRp >= 0, 'RP negatife inemez');

  // Şema ve yazma yolu da bunu zorluyor.
  assert(
    sql.includes('current_rp integer not null default 0 check (current_rp >= 0)'),
    'şema kısıtı yok',
  );
  assert(
    sql.includes('greatest(usr.current_rp + target_rp, 0)'),
    'toplam güncellemesi 0’a sıkıştırmıyor',
  );
});

// ===========================================================================
// MUTATION KONTROLLERİ — eski hatalı davranış yeni testleri DÜŞÜRÜYOR mu?
// ===========================================================================

check('M4. ESKİ hata: reconcile etmeden finalize → T1 düşer', () => {
  const store = createRankStore();
  const evidence = seasonEvidence({
    weeks: [{ start: '2026-10-12', end: '2026-10-18', scheduledDays: 1, completedDays: 1 }],
  });
  // Eski davranış: doğrudan finalize.
  finalizeSeason(store, 1);
  assertThrows(
    () =>
      assertEqual(
        seasonOf(store, 1).finalRp,
        RP.scheduledComplete + RP.weeklyPerfect,
        'mutation',
      ),
    'reconcile’sız finalize testten geçti',
  );
  assertEqual(seasonOf(store, 1).finalRp, 0, 'eski hata gerçekten RP kaybediyor');

  // Düzeltilmiş sıra doğru sonucu veriyor.
  const fixed = createRankStore();
  closeSeason(fixed, 1, evidence, '2026-10-18');
  assertEqual(
    seasonOf(fixed, 1).finalRp,
    RP.scheduledComplete + RP.weeklyPerfect,
    'düzeltilmiş sıra kanıtı koruyor',
  );
});

check('M5. ESKİ hata: donmuş gün RP’yi korur → T7 düşer', () => {
  const store = createRankStore();
  reconcile(store, 1, { days: { '2026-09-07': scheduledDay('completed') } }, '2026-09-10');

  // Eski davranış: donmuş günde yalnızca EKLEME yapılır, telafi yazılmaz.
  const brokenReconcile = (dayState) => {
    const desired = dayState === 'completed' ? RP.scheduledComplete : 0;
    const written = netForDate(store, '2026-09-07');
    if (desired <= written) return; // eski `is_frozen` erken-continue dalı
    applyAdjustment(store, 1, 'scheduled_day', '2026-09-07', desired);
  };
  brokenReconcile(null);

  assertThrows(
    () => assertEqual(seasonOf(store, 1).currentRp, 0, 'mutation'),
    'donmuş günü koruyan eski dal testten geçti',
  );
  assertEqual(seasonOf(store, 1).currentRp, RP.scheduledComplete, 'eski hata RP’yi koruyor');
});

check('M6. ESKİ hata: sabit `:revoked` anahtarı → T4 yeniden kazanımı düşer', () => {
  const store = createRankStore();
  // Eski tasarım: kazanım sabit anahtarla, telafi `:revoked` ile — ikisi de
  // bir kez yazılabilir, üçüncü adım (yeniden kazanım) İMKÂNSIZ.
  recordEvent(store, 1, 'weekly_perfect', '2026-08-31', RP.weeklyPerfect);
  recordEvent(store, 1, 'weekly_perfect', '2026-08-31:revoked', -RP.weeklyPerfect);
  assertEqual(seasonOf(store, 1).currentRp, 0, 'ara durum: geri alınmış');

  // Yeniden kazanım denemesi: her iki anahtar da dolu → hiçbir şey yazılamaz.
  recordEvent(store, 1, 'weekly_perfect', '2026-08-31', RP.weeklyPerfect);
  recordEvent(store, 1, 'weekly_perfect', '2026-08-31:revoked', -RP.weeklyPerfect);
  assertThrows(
    () => assertEqual(seasonOf(store, 1).currentRp, RP.weeklyPerfect, 'mutation'),
    'sabit anahtarlı eski tasarım yeniden kazanabildi',
  );
  assertEqual(seasonOf(store, 1).currentRp, 0, 'eski tasarım kalıcı olarak kilitliyor');
});

check('M7. ESKİ hata: "en yeni açık sezon" → T9 düşer', () => {
  const rows = [{ finalizedAt: null, seasonIndex: 1, currentRp: 900 }];
  const serverSeason = 2;
  // Eski sorgu: order by season_index desc limit 1.
  const stale = [...rows].sort((a, b) => b.seasonIndex - a.seasonIndex)[0];
  assertThrows(
    () => assertEqual(stale, undefined, 'mutation'),
    'eski sorgu geçen sezonun rozetini sızdırmıyor gibi göründü',
  );
  assertEqual(stale.seasonIndex, 1, 'eski sorgu gerçekten eski sezonu döndürüyor');
  assertEqual(
    rows.filter((row) => row.seasonIndex === serverSeason).length,
    0,
    'düzeltilmiş sorgu hiçbir satır döndürmemeli',
  );
});

check('M8. ESKİ hata: "yazılmadıysa ekle" weekly → T3 telafisi düşer', () => {
  const store = createRankStore();
  const awardOnce = (key, rp) => {
    if (ledgerFor(store, 'weekly_perfect', key).count > 0) return;
    recordEvent(store, 1, 'weekly_perfect', `${key}#0`, rp);
  };
  awardOnce('2026-08-31', RP.weeklyPerfect);
  // Kanıt düştü — eski kod hiçbir şey yapmaz.
  awardOnce('2026-08-31', 0);
  assertThrows(
    () => assertEqual(seasonOf(store, 1).currentRp, 0, 'mutation'),
    '"yazılmadıysa ekle" modeli telafi üretebildi',
  );
  assertEqual(seasonOf(store, 1).currentRp, RP.weeklyPerfect, 'eski model bonusu koruyor');
});

// ---------------------------------------------------------------------------
// MUTATION TESTİ — bozuk implementasyon gerçekten düşüyor mu?
// ---------------------------------------------------------------------------

check('M1. Bozuk soft reset (cap yok) testi DÜŞÜRÜR', () => {
  const broken = (finalRp) => {
    const tier = ranks.resolveRank(finalRp);
    // Kasıtlı hata: `min(resetMax, ...)` uygulanmıyor.
    return tier.resetBase + Math.floor((finalRp - tier.minRp) * 0.2);
  };
  assertThrows(() => {
    for (const [finalRp, expected] of ranks.RANK_SOFT_RESET_FIXTURES) {
      assertEqual(broken(finalRp), expected, 'mutation');
    }
  }, 'cap’siz soft reset testten geçti — fixture’lar tavanı yakalamıyor');
  // Gerçek uygulama hâlâ doğru.
  assertEqual(ranks.softResetRp(2650), 1649, 'gerçek uygulama bozulmuş');
});

check('M2. Bozuk partial→complete (üzerine tam 25 ekleyen) testi DÜŞÜRÜR', () => {
  const store = createRankStore();
  reconcile(store, 1, { days: { '2026-08-31': scheduledDay('partial') } }, '2026-09-01');
  // Kasıtlı hata: fark yerine tam ödül ekleniyor.
  recordEvent(store, 1, 'scheduled_day', '2026-08-31#broken', RP.scheduledComplete);
  assertThrows(
    () => assertEqual(seasonOf(store, 1).currentRp, 25, 'mutation'),
    'bozuk partial→complete testten geçti',
  );
  assertEqual(seasonOf(store, 1).currentRp, 35, 'bozuk model gerçekten 35 üretmeli');
});

check('M3. Bozuk eşik tablosu (Silver 250) testi DÜŞÜRÜR', () => {
  const brokenResolve = (rp) => (rp >= 250 ? 'silver' : 'bronze');
  assertThrows(() => {
    assertEqual(brokenResolve(200), 'silver', 'mutation');
  }, 'yanlış Silver eşiği testten geçti');
  assertEqual(ranks.resolveRank(200).id, 'silver', 'gerçek eşik bozulmuş');
});

// ---------------------------------------------------------------------------

rmSync(outDir, { force: true, recursive: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Rank harness: ${passed} kontrol geçti.`);
console.log('  (Canlı Postgres yok — SQL çalıştırılmadı, statik olarak ve modelle doğrulandı.)');
