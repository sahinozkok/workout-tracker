#!/usr/bin/env node
/**
 * RANK DENEYİMİ (FAZ 2) — DOĞRULAMA HARNESS'I
 *
 * Kapsam: (1) RP hareket geçmişi, (2) rank yükselme kutlaması ve (3) sezon
 * sonu özeti. Sezon
 * sistemi, RP tutarları, eşikler ve soft reset BURADA TEST EDİLMEZ — onlar
 * `scripts/verify-ranks.mjs` içindedir ve o dosyaya dokunulmamıştır.
 *
 * Projede jest/testing-library kurulu DEĞİL ve yeni bağımlılık eklenemiyor;
 * bu yüzden `verify-ranks.mjs` ile AYNI üç katmanlı kalıp izlenir:
 *
 *   1. SAF MANTIK — `constants/rank-experience.ts` gerçekten `tsc` ile
 *      derlenir ve çalıştırılır.
 *   2. MODEL      — `RankProvider` + kutlama katmanının davranışının referans
 *      uygulaması: AsyncStorage, hesap sahipliği, bekleyen kutlama ve
 *      "uygulama yeniden açıldı" senaryoları burada simüle edilir.
 *   3. STATİK     — React/Reanimated gerektiren davranışlar (Reduce Motion,
 *      tek seferlik Rosea tepkisi, sorgu sınırı/sıralaması, RLS'e güven)
 *      kaynak dosyalar üzerinden denetlenir.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

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

function assertDeepEqual(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message} — beklenen ${right}, gelen ${left}`);
}

// ---------------------------------------------------------------------------
// Katman 1 — `constants/rank-experience.ts` gerçekten derlenir
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'rosea-rank-experience-'));
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

const source = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

const serviceSource = source('services/ranks.ts');
const contextSource = source('context/rank-context.tsx');
const overlaySource = source('components/ranks/rank-up-celebration.tsx');
const recapSource = source('components/ranks/season-recap.tsx');
const screenSource = source('app/rank.tsx');
const migrationSource = source('supabase/migrations/20260827120000_add_seasonal_ranks.sql');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

const ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'rosea'];

/** `RECAP_HISTORY_MAX_ATTEMPTS` — `context/rank-context.tsx` ile aynı sınır. */
const RECAP_HISTORY_MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// 1 · Event satırı eşlemesi
// ---------------------------------------------------------------------------

check('1. Etkinlik türleri SQL CHECK kısıtıyla birebir aynı', () => {
  const match = migrationSource.match(/event_type in \(([^)]+)\)/);
  assert(match, 'SQL içinde event_type CHECK listesi bulunamadı');
  const sqlKinds = match[1]
    .split(',')
    .map((part) => part.trim().replace(/^'|'$/g, ''))
    .sort();
  assertDeepEqual([...rx.RANK_EVENT_KINDS].sort(), sqlKinds, 'event türleri SQL ile ayrışıyor');
});

check('2. Satır eşlemesi — dört tür de doğru kullanıcı metnine düşüyor', () => {
  assertEqual(
    rx.resolveRankEventLabel('scheduled_day', 'completed'),
    'scheduledComplete',
    'tam tamamlanan planlı gün',
  );
  assertEqual(
    rx.resolveRankEventLabel('scheduled_day', 'partial'),
    'scheduledPartial',
    'kısmi planlı gün',
  );
  assertEqual(
    rx.resolveRankEventLabel('unscheduled_workout', null),
    'unscheduledWorkout',
    'plan dışı antrenman',
  );
  assertEqual(rx.resolveRankEventLabel('weekly_perfect', null), 'weeklyPerfect', 'mükemmel hafta');
  assertEqual(
    rx.resolveRankEventLabel('streak_milestone', null),
    'streakMilestone',
    'seri kilometre taşı',
  );
});

check('3. Güvenilmez/eksik metadata genel etikete düşer', () => {
  for (const state of [undefined, null, '', 'skipped', 'off', '{}', 'COMPLETED']) {
    assertEqual(
      rx.resolveRankEventLabel('scheduled_day', state),
      'scheduledDay',
      `beklenmeyen state (${String(state)}) genel etikete düşmeli`,
    );
  }
});

check('4. Bilinmeyen event türü listeden düşer (ham anahtar GÖSTERİLMEZ)', () => {
  assertEqual(rx.parseRankEventKind('scheduled_day'), 'scheduled_day', 'geçerli tür');
  for (const value of ['rose_love', 'daily_login', '', null, undefined, 42, {}]) {
    assertEqual(
      rx.parseRankEventKind(value),
      undefined,
      `tanınmayan tür (${String(value)}) daraltılmalı`,
    );
  }
});

check('5. Kullanıcı metinleri iki dilde de locale dosyasından geliyor', () => {
  const keys = [
    'recentActivity',
    'noRecentActivity',
    'scheduledComplete',
    'scheduledPartial',
    'scheduledDay',
    'unscheduledWorkout',
    'weeklyPerfect',
    'streakMilestone',
    'rpGain',
    'rpLoss',
    'correctionNote',
  ];
  for (const key of keys) {
    assert(localeTr.includes(`${key}:`), `tr sözlüğünde ${key} yok`);
    assert(localeEn.includes(`${key}:`), `en sözlüğünde ${key} yok`);
  }
  for (const key of ['title', 'continue']) {
    assert(localeTr.includes(`${key}:`), `tr sözlüğünde rankUp.${key} yok`);
    assert(localeEn.includes(`${key}:`), `en sözlüğünde rankUp.${key} yok`);
  }
  // Ekranda sabit kullanıcı metni olmamalı: her etiket `t(...)` üzerinden gelir.
  assert(
    !/<Text[^>]*>\s*[A-ZĞÜŞİÖÇ][a-zğüşıöç]/.test(screenSource),
    'rank ekranında çeviriden geçmeyen sabit metin var',
  );
});

// ---------------------------------------------------------------------------
// 2 · Pozitif ve negatif RP gösterimi
// ---------------------------------------------------------------------------

check('6. Pozitif RP `+25 RP`, negatif düzeltme `-25 RP` biçiminde', () => {
  const gain = rx.toRankRpDisplay(25);
  assertEqual(gain.isPositive, true, '+25 pozitif olmalı');
  assertEqual(gain.amount, 25, '+25 mutlak değer');

  const loss = rx.toRankRpDisplay(-25);
  assertEqual(loss.isPositive, false, '-25 negatif olmalı');
  assertEqual(loss.amount, 25, '-25 mutlak değeri işaretsiz olmalı');

  // Şablonlar işareti metnin kendisinde taşır; ekran ikinci bir işaret eklemez.
  assert(localeTr.includes("rpGain: '+{rp} RP'"), 'tr rpGain şablonu `+` taşımalı');
  assert(localeTr.includes("rpLoss: '-{rp} RP'"), 'tr rpLoss şablonu `-` taşımalı');
  assert(localeEn.includes("rpGain: '+{rp} RP'"), 'en rpGain şablonu `+` taşımalı');
  assert(localeEn.includes("rpLoss: '-{rp} RP'"), 'en rpLoss şablonu `-` taşımalı');
});

check('7. Bozuk RP değeri ekranı düşürmez', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) {
    const display = rx.toRankRpDisplay(value);
    assertEqual(display.amount, 0, `bozuk değer (${String(value)}) 0'a inmeli`);
    assertEqual(display.isPositive, true, 'bozuk değer negatif gösterilmemeli');
  }
  assertEqual(rx.toRankRpDisplay(-24.7).amount, 24, 'kesirli değer taban alınmalı');
});

check('8. Negatif satır kullanıcıya anlaşılır bir düzeltme notu gösterir', () => {
  assert(
    overlaySource.length > 0 && screenSource.includes('ranks.events.correctionNote'),
    'negatif satırda düzeltme notu kullanılmıyor',
  );
  assert(
    screenSource.includes('isPositive ?') && screenSource.includes('dangerColor'),
    'negatif RP mevcut danger rengiyle çizilmiyor',
  );
  // Uydurma sebep yok: not yalnızca kaydın değiştiğini söyler.
  assert(
    !/silindi(ği)? için/.test(localeTr.slice(localeTr.indexOf('correctionNote'))),
    'düzeltme notu kodda bulunmayan kesin bir sebep iddia ediyor',
  );
});

// ---------------------------------------------------------------------------
// 3 · Sorgu sınırı, sıralaması ve güvenlik duruşu
// ---------------------------------------------------------------------------

check('9. Sorgu: son 30 kayıt, en yeni önce, yalnızca gerekli kolonlar', () => {
  assertEqual(rx.RANK_EVENT_LIMIT, 30, 'event limiti 30 olmalı');
  assert(
    serviceSource.includes('.limit(RANK_EVENT_LIMIT)'),
    'servis sorgusu limiti sabit üzerinden kurmuyor',
  );
  assert(
    serviceSource.includes("order('created_at', { ascending: false })"),
    'sıralama `created_at DESC` değil',
  );
  assert(serviceSource.includes("from('rank_events')"), 'sorgu mevcut rank_events tablosuna gitmiyor');

  const select = serviceSource.match(/\.select\('([^']*rank_events[^']*|[^']*event_type[^']*)'\)/);
  assert(select, 'rank_events select ifadesi bulunamadı');
  for (const column of ['season_index', 'source_key']) {
    assert(!select[1].includes(column), `gereksiz kolon çekiliyor: ${column}`);
  }
  assert(select[1].includes('metadata->>state'), 'metadata JSON’unun tamamı çekilmemeli');
});

check('10. RLS tek güvenlik otoritesi — istemci kullanıcı kimliği göndermiyor', () => {
  assert(
    !/\.eq\(\s*'user_id'/.test(serviceSource),
    'istemci sorguya user_id filtresi ekliyor',
  );
  assert(
    /create policy "rank_events_select_own"[\s\S]*?auth\.uid\(\)\) = user_id/.test(migrationSource),
    'rank_events üzerinde kendi satırını okuma politikası bulunamadı',
  );
  assert(
    migrationSource.includes('grant select on table public.rank_events to authenticated'),
    'authenticated rolüne SELECT grant’i bulunamadı',
  );
  for (const verb of ['insert', 'update', 'delete']) {
    assert(
      !new RegExp(`on public\\.rank_events for ${verb}`).test(migrationSource),
      `rank_events üzerinde istemci ${verb} policy'si var`,
    );
  }
});

check('11. Faz 2 yeni migration/tablo ÜRETMEDİ', () => {
  const migrations = execFileSync('git', ['status', '--porcelain', 'supabase/migrations'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assertEqual(migrations.trim(), '', 'supabase/migrations altında değişiklik var');
});

check('12. RP geçmişi polling YAPMAZ ve yalnızca istendiğinde yüklenir', () => {
  assert(
    !/setInterval|setTimeout\(\s*\(\)\s*=>\s*\{?\s*void loadEvents/.test(contextSource),
    'RP geçmişi için zamanlayıcı/polling kurulmuş',
  );
  assert(
    contextSource.includes('if (hasRequestedEventsRef.current) loadEventsRef.current();'),
    'sync sonrası tazeleme "daha önce yüklendiyse" koşuluna bağlı değil',
  );
  assert(
    screenSource.includes('void loadEvents();'),
    'rank ekranı RP geçmişini istemiyor',
  );
});

// ---------------------------------------------------------------------------
// Katman 2 — MODEL: `RankProvider` + kutlama katmanı referans uygulaması
// ---------------------------------------------------------------------------

/**
 * Cihaz deposu. `RankProvider` gibi YALNIZCA "hangi rank kutlandı" bilgisini
 * tutar; RP veya rank burada HESAPLANMAZ.
 *
 * Yazmalar ayrıca kaydedilir: "aynı kutlama için tek yazma" gibi kontroller
 * son değere değil, yazma SAYISINA bakmak zorundadır.
 */
function createDevice() {
  const values = new Map();
  const writes = [];

  return {
    delete: (key) => values.delete(key),
    get: (key) => values.get(key),
    has: (key) => values.has(key),
    set: (key, value) => {
      writes.push({ key, value });
      values.set(key, value);
    },
    get size() {
      return values.size;
    },
    writes,
    writesFor: (key) => writes.filter((entry) => entry.key === key),
  };
}

/**
 * Tek bir uygulama oturumu (`RankProvider` + `RankUpCelebrationLayer`).
 *
 * `applySeason` sunucudan gelen sezon özetini işler; `capturedOwner` verilirse
 * cevap o sahiplik altında yola çıkmış demektir (hesap A/B yarışı).
 */
function createSession(device, historyLoader) {
  let owner = 0;
  let userId;
  let baseline;
  let pending;
  let visible;
  let nextId = 0;
  let acknowledgedId = 0;
  let currentSeasonIndex;
  const shown = [];
  const mascotReactions = [];

  // --- Sezon sonu özeti (rank yükselmeden TAMAMEN ayrı durum) ---
  /** Sunucudan okunmuş arşiv; `undefined` = henüz hiç okunmadı. */
  let archives;
  /** `hasLoadedHistoryRef` — arşiv en az bir kez BAŞARIYLA okundu mu? */
  let hasLoadedHistory = false;
  /** Layout onayı verilmiş özet; aynı overlay ikinci kez yazma istemez. */
  let layoutAcknowledgedRecap;
  /** Aynı istek için harcanan deneme hakkı; istek fırtınasını önler. */
  let recapHistoryAttempts;
  let recap;
  let recapVisible;
  let resolvedRecapKey;
  let requestedRecapHistoryKey;
  let acknowledgedRecapKey;
  let startingRpOfCurrentSeason = 0;
  const recapsShown = [];
  const historyRequests = [];

  function signIn(nextUserId) {
    owner += 1;
    userId = nextUserId;
    baseline = undefined;
    pending = undefined;
    visible = undefined;
    acknowledgedId = 0;
    currentSeasonIndex = undefined;
    archives = undefined;
    hasLoadedHistory = false;
    layoutAcknowledgedRecap = undefined;
    recap = undefined;
    recapVisible = undefined;
    resolvedRecapKey = undefined;
    requestedRecapHistoryKey = undefined;
    recapHistoryAttempts = undefined;
    acknowledgedRecapKey = undefined;
    startingRpOfCurrentSeason = 0;
  }

  function applySeason(snapshot, capturedOwner = owner) {
    if (capturedOwner !== owner) return;
    const ownerId = userId;
    currentSeasonIndex = snapshot.seasonIndex;
    startingRpOfCurrentSeason = snapshot.startingRp ?? 0;
    // Sezon özeti kararı her sezon cevabında yeniden değerlendirilir.
    resolveRecap(capturedOwner);
    const storageKey = rx.rankCelebrationStorageKey(ownerId, snapshot.seasonIndex);

    let base = baseline;
    if (!base || base.userId !== ownerId || base.seasonIndex !== snapshot.seasonIndex) {
      const stored = device.get(storageKey);
      base = stored ? { rank: stored, seasonIndex: snapshot.seasonIndex, userId: ownerId } : undefined;
    }

    const decision = rx.decideRankCelebration({
      baseline: base ? { rank: base.rank, seasonIndex: base.seasonIndex } : undefined,
      order: ORDER,
      pendingFromRank:
        pending?.seasonIndex === snapshot.seasonIndex ? pending.fromRank : undefined,
      season: { currentRank: snapshot.currentRank, seasonIndex: snapshot.seasonIndex },
    });

    if (decision.type === 'idle') return;

    /**
     * `seed` ve `settle` kutlama üretmez → kayıt HEMEN yazılır. `celebrate`
     * kararında kalıcı kayıt İLERLEMEZ: onay yalnızca kutlama ekranda
     * gerçekten gösterilmeye başladığında verilir (`acknowledgeShown`).
     *
     * Depo yazması hesap kontrolünden ÖNCE: anahtar zaten o hesaba aittir.
     */
    if (decision.type !== 'celebrate') {
      device.set(storageKey, decision.baseline.rank);
      if (decision.type === 'seed' && snapshot.seasonIndex > 1) {
        device.delete(rx.rankCelebrationStorageKey(ownerId, snapshot.seasonIndex - 1));
      }
    }

    if (capturedOwner !== owner) return;
    // Bellek içi referans `celebrate`te de ilerler: aynı oturumda ikinci bir
    // bekleyen kutlama üretilmez.
    baseline = { ...decision.baseline, userId: ownerId };
    if (decision.type !== 'celebrate') return;

    nextId += 1;
    pending = {
      fromRank: decision.fromRank,
      id: nextId,
      rp: snapshot.currentRp,
      seasonIndex: snapshot.seasonIndex,
      toRank: decision.toRank,
    };
  }

  /**
   * `acknowledgeRankUpShown` — kalıcı kaydı ilerleten TEK yol.
   *
   * Kimlik, hesap ve sezon sahipliği doğrulanır; aynı kutlama için ikinci kez
   * yazılmaz. State'i kapatmaz.
   */
  function acknowledgeShown(celebrationId) {
    if (!userId) return;
    const celebration = pending;
    if (!celebration || celebration.id !== celebrationId) return;
    if (acknowledgedId === celebrationId) return;
    if (currentSeasonIndex !== celebration.seasonIndex) return;

    acknowledgedId = celebrationId;
    device.set(
      rx.rankCelebrationStorageKey(userId, celebration.seasonIndex),
      celebration.toRank,
    );
  }

  /** Kutlama katmanının render'ı. Aynı ekranda defalarca çağrılabilir. */
  function render(pathname) {
    if (visible || !pending) return;
    if (!rx.canShowRankCelebration(pathname)) return;
    visible = pending;
    shown.push({ from: visible.fromRank, rp: visible.rp, to: visible.toRank });
    // Gösterim başladığı anda: önce onay, sonra Rosea tepkisi.
    acknowledgeShown(visible.id);
    mascotReactions.push('rank-up');
  }

  function dismiss() {
    if (!visible) return;
    const dismissedId = visible.id;
    visible = undefined;
    if (pending?.id === dismissedId) pending = undefined;
  }

  // -------------------------------------------------------------------------
  // Sezon sonu özeti — `resolveSeasonRecap` / `acknowledgeSeasonRecapShown`
  // -------------------------------------------------------------------------

  /** Sunucu arşiv cevabı (`loadHistory` BAŞARIYLA döndü). */
  function loadHistory(rows, capturedOwner = owner) {
    if (capturedOwner !== owner) return;
    archives = rows;
    hasLoadedHistory = true;
    resolveRecap();
  }

  function resolveRecap(capturedOwner = owner) {
    if (capturedOwner !== owner) return;
    if (!userId || currentSeasonIndex === undefined) return;
    if (currentSeasonIndex < 2) return;

    const closedSeasonIndex = currentSeasonIndex - 1;
    const recapKey = `${userId}:${closedSeasonIndex}`;

    if (resolvedRecapKey === recapKey) return;
    // Aynı özet zaten bekliyor: ikinci overlay üretilmez.
    if (recap?.archive.seasonIndex === closedSeasonIndex) return;

    if (device.get(rx.seasonRecapStorageKey(userId, closedSeasonIndex)) !== undefined) {
      resolvedRecapKey = recapKey;
      return;
    }

    const plan = hasLoadedHistory
      ? rx.decideSeasonRecap({
          archives,
          currentSeasonIndex,
          startingRp: startingRpOfCurrentSeason,
        })
      : undefined;

    if (!plan) {
      const requestKey = `${userId}:${currentSeasonIndex}`;
      const attempts =
        recapHistoryAttempts?.key === requestKey ? recapHistoryAttempts.count : 0;

      if (requestedRecapHistoryKey !== requestKey && attempts < RECAP_HISTORY_MAX_ATTEMPTS) {
        requestedRecapHistoryKey = requestKey;
        recapHistoryAttempts = { count: attempts + 1, key: requestKey };
        historyRequests.push(requestKey);

        // Enjekte edilmiş yükleyici varsa istek burada "tamamlanır".
        const result = historyLoader ? historyLoader() : undefined;
        if (result?.ok) {
          archives = result.rows;
          hasLoadedHistory = true;
          // Arşiv değişti → akış kendiliğinden yeniden çalışır.
          resolveRecap(capturedOwner);
          return;
        }

        /**
         * İstek BAŞARISIZSA guard geri açılır: karar "özet yok" diye
         * kapatılmaz ve sonraki doğal tetikleyici yeniden deneyebilir.
         */
        if (result && !result.ok && requestedRecapHistoryKey === requestKey) {
          requestedRecapHistoryKey = undefined;
        }
        return;
      }

      // Karar ANCAK arşiv gerçekten okunduysa kapatılır.
      if (hasLoadedHistory) resolvedRecapKey = recapKey;
      return;
    }

    const archive = archives.find((row) => row.seasonIndex === plan.closedSeasonIndex);
    if (!archive) {
      resolvedRecapKey = recapKey;
      return;
    }

    if (capturedOwner !== owner) return;
    recap = {
      archive,
      nextSeasonIndex: plan.nextSeasonIndex,
      planCompletionPercent: plan.planCompletionPercent,
      startingRp: startingRpOfCurrentSeason,
    };
  }

  function acknowledgeRecapShown(closedSeasonIndex) {
    if (!userId) return;
    if (!recap || recap.archive.seasonIndex !== closedSeasonIndex) return;
    if (currentSeasonIndex !== recap.nextSeasonIndex) return;

    const recapKey = `${userId}:${closedSeasonIndex}`;
    if (acknowledgedRecapKey === recapKey) return;
    acknowledgedRecapKey = recapKey;
    resolvedRecapKey = recapKey;

    device.set(rx.seasonRecapStorageKey(userId, closedSeasonIndex), String(closedSeasonIndex));
  }

  /**
   * `SeasonRecapLayer` render'ı.
   *
   * ÖNCELİK: bekleyen bir rank yükselmesi varken özet HİÇ açılmaz.
   */
  function renderRecap(pathname) {
    if (recapVisible || !recap) return;
    if (!rx.canShowRankCelebration(pathname)) return;
    if (pending) return;

    recapVisible = recap;
    recapsShown.push({
      closedSeasonIndex: recapVisible.archive.seasonIndex,
      finalRp: recapVisible.archive.finalRp,
      nextSeasonIndex: recapVisible.nextSeasonIndex,
      startingRp: recapVisible.startingRp,
    });
    // Kalıcı kayıt BURADA YAZILMAZ: `setShown` yalnızca render planlar.
  }

  /**
   * `onLayout` — overlay GERÇEKTEN mount/layout oldu.
   *
   * Gösterim onayının tek tetikleyicisi budur. Tekrarlanan layout olayları
   * (döndürme, yazı tipi ölçeği) ikinci bir yazma üretmez.
   */
  function layoutRecap() {
    if (!recapVisible) return;
    const closedSeasonIndex = recapVisible.archive.seasonIndex;
    if (layoutAcknowledgedRecap === closedSeasonIndex) return;
    layoutAcknowledgedRecap = closedSeasonIndex;
    acknowledgeRecapShown(closedSeasonIndex);
  }

  function dismissRecap() {
    if (!recapVisible) return;
    const closedSeasonIndex = recapVisible.archive.seasonIndex;
    recapVisible = undefined;
    layoutAcknowledgedRecap = undefined;
    if (recap?.archive.seasonIndex === closedSeasonIndex) recap = undefined;
  }

  return {
    acknowledgeRecapShown,
    acknowledgeShown,
    applySeason,
    dismiss,
    dismissRecap,
    historyRequests,
    get isHistoryLoaded() {
      return hasLoadedHistory;
    },
    layoutRecap,
    loadHistory,
    get owner() {
      return owner;
    },
    mascotReactions,
    get pending() {
      return pending;
    },
    get pendingRecap() {
      return recap;
    },
    recapsShown,
    render,
    renderRecap,
    get resolvedRecap() {
      return resolvedRecapKey;
    },
    shown,
    signIn,
  };
}

const HOME = '/';
const WORKOUT = '/program/p-1/day/d-1';

check('13. İlk yüklemede kutlama YOK — mevcut rank başlangıç değeri olur', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'gold', currentRp: 500, seasonIndex: 3 });
  app.render(HOME);

  assertEqual(app.shown.length, 0, 'ilk yüklemede kutlama gösterildi');
  assertEqual(
    device.get(rx.rankCelebrationStorageKey('user-a', 3)),
    'gold',
    'başlangıç değeri kaydedilmedi',
  );
});

check('14. Aynı sezon içindeki gerçek yükseliş bir kez kutlanır', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  app.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });

  // Aynı render defalarca çalışsa da (React yeniden render, ekran değişimi)
  // kutlama tek kez açılır.
  app.render(HOME);
  app.render(HOME);
  app.render('/profile');

  assertDeepEqual(app.shown, [{ from: 'silver', rp: 460, to: 'gold' }], 'yükseliş tek kez');
  assertEqual(app.mascotReactions.length, 1, 'Rosea tepkisi birden çok kez tetiklendi');
});

check('15. Tekrar sync / AppState dönüşü aynı yükselişi TEKRAR oynatmaz', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  app.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });
  app.render(HOME);
  app.dismiss();

  // Ön plana dönüş + set sonrası sync + gece yarısı sync: aynı değer tekrar.
  for (let index = 0; index < 5; index += 1) {
    app.applySeason({ currentRank: 'gold', currentRp: 460 + index, seasonIndex: 3 });
    app.render(HOME);
  }

  assertEqual(app.shown.length, 1, 'aynı yükseliş tekrar oynatıldı');
});

check('16. Çoklu rank atlamada yalnızca başlangıç ve ulaşılan son rank', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'bronze', currentRp: 120, seasonIndex: 1 });
  // Tek bir uzlaştırmada üç tier birden geçildi.
  app.applySeason({ currentRank: 'platinum', currentRp: 800, seasonIndex: 1 });
  app.render(HOME);

  assertDeepEqual(
    app.shown,
    [{ from: 'bronze', rp: 800, to: 'platinum' }],
    'ara ranklar da gösterilmiş',
  );
});

check('17. Bekleyen kutlama sürerken gelen yeni yükseliş başlangıcı korur', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'bronze', currentRp: 100, seasonIndex: 1 });
  // Kullanıcı aktif antrenmandayken iki ayrı sync'te iki tier yükseldi.
  app.applySeason({ currentRank: 'silver', currentRp: 220, seasonIndex: 1 });
  app.render(WORKOUT);
  app.applySeason({ currentRank: 'gold', currentRp: 470, seasonIndex: 1 });
  app.render(HOME);

  assertDeepEqual(
    app.shown,
    [{ from: 'bronze', rp: 470, to: 'gold' }],
    'bekleyen kutlamanın başlangıcı kaybolmuş',
  );
});

check('18. Rank DÜŞÜŞÜNDE kutlama yok; referans sessizce iner', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'gold', currentRp: 500, seasonIndex: 2 });
  // Antrenman silindi → telafi → rank düştü.
  app.applySeason({ currentRank: 'silver', currentRp: 300, seasonIndex: 2 });
  app.render(HOME);

  assertEqual(app.shown.length, 0, 'düşüşte kutlama gösterildi');
  assertEqual(
    device.get(rx.rankCelebrationStorageKey('user-a', 2)),
    'silver',
    'referans düşüşe göre güncellenmedi',
  );

  // Kaybedilen rank yeniden kazanılırsa kutlama BİR KEZ görünür.
  app.applySeason({ currentRank: 'gold', currentRp: 470, seasonIndex: 2 });
  app.render(HOME);
  assertDeepEqual(app.shown, [{ from: 'silver', rp: 470, to: 'gold' }], 'yeniden kazanım kutlanmadı');
});

check('19. Sezon değişimi ve soft reset yükselme SAYILMAZ', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'bronze', currentRp: 100, seasonIndex: 4 });
  app.applySeason({ currentRank: 'gold', currentRp: 500, seasonIndex: 4 });
  app.render(HOME);
  app.dismiss();
  assertEqual(app.shown.length, 1, 'sezon içi yükseliş gösterilmeliydi');

  // Yeni sezon: soft reset ile Silver'a inildi, sonra tekrar Gold'a çıkıldı.
  app.applySeason({ currentRank: 'silver', currentRp: 300, seasonIndex: 5 });
  app.render(HOME);
  assertEqual(app.shown.length, 1, 'yeni sezona giriş kutlama üretti');

  // Yeni sezonun İÇİNDEKİ yükseliş normal biçimde kutlanır.
  app.applySeason({ currentRank: 'gold', currentRp: 470, seasonIndex: 5 });
  app.render(HOME);
  assertDeepEqual(
    app.shown[1],
    { from: 'silver', rp: 470, to: 'gold' },
    'yeni sezon içindeki yükseliş kutlanmadı',
  );
  assertEqual(
    device.has(rx.rankCelebrationStorageKey('user-a', 4)),
    false,
    'önceki sezonun onay kaydı temizlenmedi',
  );
});

check('20. Sezon numarası GERİ giderse de kutlama üretilmez', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'gold', currentRp: 500, seasonIndex: 6 });
  // Geç gelen bir cevap eski sezonu taşıyor.
  app.applySeason({ currentRank: 'rosea', currentRp: 1700, seasonIndex: 5 });
  app.render(HOME);

  assertEqual(app.shown.length, 0, 'farklı sezon numarası kutlama üretti');
});

check('21. Gösterilmeden kapanan kutlama sonraki açılışta YENİDEN oluşur', () => {
  const device = createDevice();
  const storageKey = rx.rankCelebrationStorageKey('user-a', 3);

  const first = createSession(device);
  first.signIn('user-a');
  first.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  first.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });
  // Kullanıcı aktif antrenmanda: kutlama bekliyor, hiç gösterilmedi.
  first.render(WORKOUT);
  first.render(WORKOUT);
  assertEqual(first.shown.length, 0, 'antrenman ekranında gösterildi');
  assertEqual(
    device.get(storageKey),
    'silver',
    'gösterilmeyen kutlama kalıcı kaydı ilerletti — yükseliş kaybolur',
  );

  // Uygulama TAMAMEN kapandı. Soğuk açılış: aynı cihaz deposu, yeni oturum.
  const second = createSession(device);
  second.signIn('user-a');
  second.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });
  second.render(HOME);

  assertDeepEqual(
    second.shown,
    [{ from: 'silver', rp: 460, to: 'gold' }],
    'görülmemiş kutlama yeniden açılışta kaybolmuş',
  );
  assertEqual(device.get(storageKey), 'gold', 'gösterim onayı yazılmadı');
});

check('21b. Gösterilmeye BAŞLAYAN kutlama yeniden açılışta tekrar oynamaz', () => {
  const device = createDevice();
  const storageKey = rx.rankCelebrationStorageKey('user-a', 3);

  const first = createSession(device);
  first.signIn('user-a');
  first.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  first.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });
  // Güvenli ekranda gösterim BAŞLADI. "Devam" düğmesine BASILMADI.
  first.render(HOME);
  assertEqual(first.shown.length, 1, 'güvenli ekranda gösterilmeliydi');
  assertEqual(device.get(storageKey), 'gold', 'gösterim onayı anında yazılmadı');

  // Kullanıcı düğmeye basmadan uygulamayı kapattı; soğuk açılış.
  const second = createSession(device);
  second.signIn('user-a');
  second.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });
  second.render(HOME);

  assertEqual(second.shown.length, 0, 'gösterilmiş kutlama yeniden oynatıldı');
});

check('22. Aktif antrenmanda kutlama BEKLETİLİR, güvenli ekranda bir kez açılır', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  app.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });

  // Set kaydı, kronometre ve mola boyunca ekran hiç açılmaz.
  app.render(WORKOUT);
  app.render(WORKOUT);
  assertEqual(app.shown.length, 0, 'aktif antrenman ekranı bölündü');
  assert(app.pending, 'kutlama düşürüldü, bekletilmedi');

  app.render(HOME);
  app.render(HOME);
  assertEqual(app.shown.length, 1, 'güvenli ekranda tam olarak bir kez gösterilmeli');
});

check('23. Kutlama oturum akışı ekranlarında görünmez', () => {
  for (const pathname of [
    '/reset-password',
    '/confirm',
    '/login',
    '/register',
    '/forgot-password',
    '/program/abc/day/xyz',
    '/program/abc/day/xyz/',
  ]) {
    assertEqual(rx.canShowRankCelebration(pathname), false, `${pathname} güvenli sayıldı`);
  }
  for (const pathname of ['/', '/profile', '/history', '/programs', '/rank', '/program/abc']) {
    assertEqual(rx.canShowRankCelebration(pathname), true, `${pathname} gereksiz yere engellendi`);
  }
  assertEqual(rx.canShowRankCelebration(undefined), false, 'pathname yokken gösterilmemeli');
  assertEqual(rx.canShowRankCelebration(null), false, 'pathname null iken gösterilmemeli');
});

check('24. Hesap A/B yarışı — A’nın geç gelen cevabı B’ye yazılmaz', () => {
  const device = createDevice();
  const app = createSession(device);

  app.signIn('user-a');
  app.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  const ownerOfA = app.owner;

  // B giriş yaptı; A'nın uçuştaki cevabı ancak şimdi döndü.
  app.signIn('user-b');
  app.applySeason({ currentRank: 'rosea', currentRp: 1700, seasonIndex: 3 }, ownerOfA);
  app.render(HOME);

  assertEqual(app.shown.length, 0, 'A’nın cevabı B’de kutlama üretti');
  assertEqual(
    device.get(rx.rankCelebrationStorageKey('user-b', 3)),
    undefined,
    'A’nın cevabı B’nin onay kaydına yazıldı',
  );

  // B'nin kendi verisi normal akışta çalışır.
  app.applySeason({ currentRank: 'bronze', currentRp: 50, seasonIndex: 3 });
  app.applySeason({ currentRank: 'silver', currentRp: 220, seasonIndex: 3 });
  app.render(HOME);
  assertDeepEqual(app.shown, [{ from: 'bronze', rp: 220, to: 'silver' }], 'B kendi yükselişini görmedi');

  // A'nın kaydı hâlâ kendi anahtarında ve bozulmamış.
  assertEqual(
    device.get(rx.rankCelebrationStorageKey('user-a', 3)),
    'silver',
    'A’nın onay kaydı bozulmuş',
  );
});

check('25. Hesap A’dan B’ye geçip geri dönmek durumları karıştırmaz', () => {
  const device = createDevice();
  const app = createSession(device);

  app.signIn('user-a');
  app.applySeason({ currentRank: 'gold', currentRp: 500, seasonIndex: 2 });

  app.signIn('user-b');
  app.applySeason({ currentRank: 'bronze', currentRp: 30, seasonIndex: 2 });
  app.render(HOME);
  assertEqual(app.shown.length, 0, 'B’de ilk yükleme kutlandı');

  app.signIn('user-a');
  app.applySeason({ currentRank: 'gold', currentRp: 505, seasonIndex: 2 });
  app.render(HOME);
  assertEqual(app.shown.length, 0, 'A’ya dönüşte kutlama tekrar oynatıldı');
});

check('26. Bilinmeyen rank kimliği ne kutlama ne yazma üretir', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  app.applySeason({ currentRank: 'mythic', currentRp: 9000, seasonIndex: 3 });
  app.render(HOME);

  assertEqual(app.shown.length, 0, 'bilinmeyen rank kutlandı');
  assertEqual(
    device.get(rx.rankCelebrationStorageKey('user-a', 3)),
    'silver',
    'bilinmeyen rank referansa yazıldı',
  );
});

// ---------------------------------------------------------------------------
// Katman 3 — STATİK: React/Reanimated davranışları
// ---------------------------------------------------------------------------

check('27. Reduce Motion: ölçek kaldırılır, süre kısa fade’e iner', () => {
  assert(overlaySource.includes('useReducedMotion'), 'kutlama Reduce Motion’ı okumuyor');
  assert(
    /transform: reduceMotion\s*\?\s*\[\]/.test(overlaySource),
    'Reduce Motion açıkken ölçek hareketi kaldırılmıyor',
  );
  assert(
    overlaySource.includes('reduceMotion ? MotionDuration.instant : MotionDuration.standard'),
    'Reduce Motion açıkken giriş süresi kısaltılmıyor',
  );
  assert(
    overlaySource.includes('reduceMotion ? MotionDuration.instant : MotionDuration.fast'),
    'Reduce Motion açıkken çıkış süresi kısaltılmıyor',
  );
  // Yeni süre/ölçek sabiti icat edilmez; ortak motion tokenları kullanılır.
  assert(
    !/duration:\s*\d+/.test(overlaySource),
    'kutlamada ham (token’sız) süre değeri var',
  );
});

check('28. Kutlama: opacity 0→1 ve scale 0.96→1', () => {
  assert(overlaySource.includes('const ENTER_SCALE = 0.96;'), 'giriş ölçeği 0.96 değil');
  assert(
    overlaySource.includes('opacity: progress.value'),
    'opaklık 0→1 ilerlemesine bağlanmamış',
  );
  assert(
    overlaySource.includes('ENTER_SCALE + (1 - ENTER_SCALE) * progress.value'),
    'ölçek 0.96 → 1 aralığına bağlanmamış',
  );
  // Yorum satırları hariç tutulur: dosya zaten "confetti YOKTUR" diye belgeleniyor.
  const overlayCode = overlaySource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert(!/confetti|Particles/i.test(overlayCode), 'kutlamaya confetti/partikül katmanı eklenmiş');
});

check('29. Temizlik: süren animasyon iptal edilir, tek çıkış noktası vardır', () => {
  assert(overlaySource.includes('cancelAnimation(progress)'), 'animasyon iptali yok');
  assert(overlaySource.includes('return () => cancelAnimation(progress);'), 'cleanup dönmüyor');
  assert(overlaySource.includes('isClosingRef'), 'çift kapatma koruması yok');
  assert(!/setInterval|setTimeout/.test(overlaySource), 'kutlamada elle zamanlayıcı var');
});

check('30. Rosea tepkisi: mevcut context API’si, kutlama başına tek olay', () => {
  assert(
    overlaySource.includes("triggerReaction('rank-up')"),
    'mevcut mascot context olayı kullanılmıyor',
  );
  assertEqual(
    (overlaySource.match(/triggerReaction\('/g) ?? []).length,
    1,
    'Rosea tepkisi birden fazla yerden tetikleniyor',
  );
  const mascotTypes = source('types/mascot.ts');
  assert(mascotTypes.includes("'rank-up'"), 'rank-up olayı type-safe biçimde tanımlanmamış');
  assert(
    /'rank-up':\s*2/.test(mascotTypes),
    'rank-up önceliği workout kutlamasıyla eşit değil (kutlamalar birbirini bölebilir)',
  );
  // Rosea zorla geri getirilmez: olay maskot kapalıyken sağlayıcıda düşürülür.
  assert(
    source('context/mascot-context.tsx').includes('if (!enabledRef.current) return;'),
    'maskot kapalıyken olay düşürülmüyor',
  );
});

check('31. Kutlama aktif antrenmanı ve oturum ekranlarını bloke etmez', () => {
  assert(
    overlaySource.includes('canShowRankCelebration(pathname)'),
    'kutlama route güvenliğini okumuyor',
  );
  assert(
    source('app/_layout.tsx').includes(
      '{Boolean(session) && !isPasswordRecovery && <RankUpCelebrationLayer />}',
    ),
    'kutlama katmanı oturum guard’ının dışında mount edilmiş',
  );
  // Antrenman akışı kutlamadan haberdar bile değildir.
  const workoutSource = source('context/workout-context.tsx');
  assert(
    !workoutSource.includes('rankUp') && !workoutSource.includes('dismissRankUp'),
    'antrenman akışı kutlamaya bağlanmış',
  );
});

check('32. AsyncStorage yalnızca onay kaydı tutar — RP/rank HESAPLAMAZ', () => {
  const storageWrites = contextSource.match(/AsyncStorage\.(setItem|removeItem)\(([\s\S]*?)\)/g) ?? [];
  assert(storageWrites.length > 0, 'onay kaydı yazılmıyor');
  for (const write of storageWrites) {
    assert(
      !/currentRp|rpDelta|\+|Math\./.test(write.replace('rankCelebrationStorageKey', '')),
      `depoya hesaplanmış değer yazılıyor: ${write}`,
    );
  }
  assert(
    contextSource.includes('rp: snapshot.currentRp'),
    'kutlamadaki RP sunucu cevabından alınmıyor',
  );
  assert(
    rx.rankCelebrationStorageKey('user-a', 7) === 'rank:celebrated:user-a:7',
    'onay anahtarı kullanıcı ve sezonla isimlendirilmemiş',
  );
});

// ---------------------------------------------------------------------------
// 4 · Kalıcılık zamanlaması — kayıt YALNIZCA gösterim başlayınca ilerler
// ---------------------------------------------------------------------------

check('33. `seed` kaydı HEMEN yazılır ve kutlama üretmez (ilk yükleme)', () => {
  const device = createDevice();
  const storageKey = rx.rankCelebrationStorageKey('user-a', 3);
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'gold', currentRp: 500, seasonIndex: 3 });

  // Henüz hiçbir ekran render edilmeden kayıt yerinde olmalı.
  assertEqual(device.get(storageKey), 'gold', 'ilk yükleme kaydı ertelendi');
  assertEqual(device.writesFor(storageKey).length, 1, 'ilk yükleme tek yazma olmalı');
  app.render(HOME);
  assertEqual(app.shown.length, 0, 'ilk yüklemede kutlama gösterildi');
});

check('34. Yeni sezon `seed` kaydı HEMEN yazılır ve kutlama üretmez', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'gold', currentRp: 500, seasonIndex: 4 });
  // Soft reset ile 5. sezona Silver olarak girildi.
  app.applySeason({ currentRank: 'silver', currentRp: 300, seasonIndex: 5 });

  assertEqual(
    device.get(rx.rankCelebrationStorageKey('user-a', 5)),
    'silver',
    'yeni sezon kaydı ertelendi',
  );
  app.render(HOME);
  assertEqual(app.shown.length, 0, 'sezon değişimi kutlama üretti');
});

check('35. Rank DÜŞÜŞÜ kaydı HEMEN yazılır ve kutlama üretmez', () => {
  const device = createDevice();
  const storageKey = rx.rankCelebrationStorageKey('user-a', 2);
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'gold', currentRp: 500, seasonIndex: 2 });
  app.applySeason({ currentRank: 'silver', currentRp: 300, seasonIndex: 2 });

  assertEqual(device.get(storageKey), 'silver', 'düşüş kaydı ertelendi');
  app.render(HOME);
  assertEqual(app.shown.length, 0, 'düşüşte kutlama gösterildi');
});

check('36. `celebrate` kararı TEK BAŞINA kalıcı kaydı ilerletmez', () => {
  const device = createDevice();
  const storageKey = rx.rankCelebrationStorageKey('user-a', 3);
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  assertEqual(device.writesFor(storageKey).length, 1, 'seed yazması bekleniyordu');

  // Yükseliş + arka arkaya birçok sync. Hiçbiri kaydı ilerletmemeli.
  app.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });
  app.applySeason({ currentRank: 'gold', currentRp: 470, seasonIndex: 3 });
  app.applySeason({ currentRank: 'gold', currentRp: 480, seasonIndex: 3 });

  assertEqual(device.get(storageKey), 'silver', 'kayıt gösterim olmadan ilerledi');
  assertEqual(device.writesFor(storageKey).length, 1, 'gösterim olmadan yeni yazma yapıldı');
  assert(app.pending, 'kutlama oluşturulmadı');
});

check('37. Aynı kutlamanın ikinci gösterim onayı TEKRAR yazma yapmaz', () => {
  const device = createDevice();
  const storageKey = rx.rankCelebrationStorageKey('user-a', 3);
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  app.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });

  const celebrationId = app.pending.id;
  app.render(HOME);
  // React yeniden render, ekran değişimi ve elle tekrar çağrı.
  app.render(HOME);
  app.render('/profile');
  app.acknowledgeShown(celebrationId);
  app.acknowledgeShown(celebrationId);

  const writes = device.writesFor(storageKey);
  assertEqual(writes.length, 2, 'onay yazması tekrarlandı (seed + tek onay beklenir)');
  assertEqual(writes[1].value, 'gold', 'onay yanlış rankı yazdı');
  assertEqual(app.mascotReactions.length, 1, 'Rosea tepkisi tekrarlandı');
});

check('38. Bilinmeyen kimlikle gelen onay hiçbir şey yazmaz', () => {
  const device = createDevice();
  const storageKey = rx.rankCelebrationStorageKey('user-a', 3);
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  app.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });

  app.acknowledgeShown(app.pending.id + 99);
  app.acknowledgeShown(0);

  assertEqual(device.get(storageKey), 'silver', 'eşleşmeyen kimlik kayıt yazdı');
});

check('39. Hesap A’nın gösterim onayı B’nin anahtarına YAZILMAZ', () => {
  const device = createDevice();
  const keyOfA = rx.rankCelebrationStorageKey('user-a', 3);
  const keyOfB = rx.rankCelebrationStorageKey('user-b', 3);
  const app = createSession(device);

  app.signIn('user-a');
  app.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  app.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });
  const celebrationOfA = app.pending.id;
  // A kutlamayı GÖRMEDİ (aktif antrenmandaydı).
  app.render(WORKOUT);

  // B giriş yaptı; A'nın kutlama katmanından geç gelen onay şimdi düştü.
  app.signIn('user-b');
  app.acknowledgeShown(celebrationOfA);
  app.render(HOME);

  assertEqual(device.get(keyOfB), undefined, 'A’nın onayı B’nin anahtarına yazıldı');
  assertEqual(device.get(keyOfA), 'silver', 'A’nın kaydı görülmemiş kutlamaya rağmen ilerledi');

  // A geri döndüğünde görmediği kutlama hâlâ duruyor.
  app.signIn('user-a');
  app.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });
  app.render(HOME);
  assertDeepEqual(
    app.shown,
    [{ from: 'silver', rp: 460, to: 'gold' }],
    'A’nın görülmemiş kutlaması kaybolmuş',
  );
});

check('40. Çoklu atlayış: bekleyen kutlama korunur, onay son rankı yazar', () => {
  const device = createDevice();
  const storageKey = rx.rankCelebrationStorageKey('user-a', 1);
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'bronze', currentRp: 100, seasonIndex: 1 });
  // Aktif antrenmanda iki ayrı sync'te iki tier yükseldi.
  app.applySeason({ currentRank: 'silver', currentRp: 220, seasonIndex: 1 });
  app.render(WORKOUT);
  app.applySeason({ currentRank: 'gold', currentRp: 470, seasonIndex: 1 });
  app.render(WORKOUT);
  assertEqual(device.get(storageKey), 'bronze', 'bekleme sırasında kayıt ilerledi');

  app.render(HOME);
  assertDeepEqual(
    app.shown,
    [{ from: 'bronze', rp: 470, to: 'gold' }],
    'başlangıç rankı korunmadı',
  );
  assertEqual(device.get(storageKey), 'gold', 'onay ulaşılan son rankı yazmadı');

  // Soğuk açılış: gösterilen kutlama tekrar oynamaz.
  const restarted = createSession(device);
  restarted.signIn('user-a');
  restarted.applySeason({ currentRank: 'gold', currentRp: 470, seasonIndex: 1 });
  restarted.render(HOME);
  assertEqual(restarted.shown.length, 0, 'gösterilen çoklu atlayış tekrar oynatıldı');
});

check('41. Kaynak: kalıcı kayıt yalnızca onay yolundan ilerliyor', () => {
  // `celebrate` dalı reconcile içinde depoya YAZMAMALI.
  assert(
    /if \(decision\.type !== 'celebrate'\) \{\s*await AsyncStorage\.setItem\(storageKey/.test(
      contextSource,
    ),
    'reconcile hâlâ celebrate kararında da depoya yazıyor',
  );
  assert(
    contextSource.includes('const acknowledgeRankUpShown = useCallback('),
    'gösterim onayı metodu yok',
  );
  assert(
    contextSource.includes('if (acknowledgedCelebrationIdRef.current === celebrationId) return;'),
    'aynı kutlama için tekrar yazma koruması yok',
  );
  // Onay state'i KAPATMAZ; kapatma dismissRankUp'ta kalır.
  const acknowledgeBody = contextSource.slice(
    contextSource.indexOf('const acknowledgeRankUpShown = useCallback('),
    contextSource.indexOf('const dismissRankUp = useCallback('),
  );
  assert(!acknowledgeBody.includes('setRankUp'), 'gösterim onayı state’i kapatıyor');
  assert(
    acknowledgeBody.includes('celebration.id !== celebrationId') &&
      acknowledgeBody.includes('seasonRef.current?.seasonIndex !== celebration.seasonIndex'),
    'onay kimlik/sezon sahipliğini doğrulamıyor',
  );
  // Kutlama katmanı onayı gösterim başlangıcında bir kez çağırır.
  assertEqual(
    (overlaySource.match(/acknowledgeRankUpShown\(/g) ?? []).length,
    1,
    'gösterim onayı katmandan birden fazla kez çağrılıyor',
  );
  assert(
    overlaySource.indexOf('void acknowledgeRankUpShown(rankUp.id);') <
      overlaySource.indexOf("triggerReaction('rank-up')"),
    'onay, Rosea tepkisiyle aynı gösterim başlangıcında verilmiyor',
  );
});

// ---------------------------------------------------------------------------
// 5 · Sezon sonu özeti — tek seferlik gösterim
// ---------------------------------------------------------------------------

/** Sunucu arşiv satırı üreticisi. Bütün değerler "sunucudan" gelmiş sayılır. */
function archiveRow(seasonIndex, overrides = {}) {
  return {
    endsOn: '2026-08-23',
    finalRank: 'gold',
    finalRp: 520,
    longestStreak: 12,
    peakRank: 'gold',
    scheduledDaysCompleted: 30,
    scheduledDaysTotal: 40,
    seasonIndex,
    startsOn: '2026-06-29',
    workoutsCompleted: 34,
    ...overrides,
  };
}

check('42. İlk sezonda ve arşiv yokken özet ÜRETİLMEZ', () => {
  // İlk sezon: kapanmış sezon yok, arşiv hiç istenmez.
  const firstSeason = createSession(createDevice());
  firstSeason.signIn('user-a');
  firstSeason.applySeason({ currentRank: 'bronze', currentRp: 40, seasonIndex: 1, startingRp: 0 });
  firstSeason.renderRecap(HOME);
  assertEqual(firstSeason.recapsShown.length, 0, 'ilk sezonda özet gösterildi');
  assertEqual(firstSeason.historyRequests.length, 0, 'ilk sezonda gereksiz arşiv isteği atıldı');

  // Sezon 3 ama arşiv boş (kullanıcı hiç sezon kapatmamış).
  const noArchive = createSession(createDevice());
  noArchive.signIn('user-a');
  noArchive.applySeason({ currentRank: 'silver', currentRp: 260, seasonIndex: 3, startingRp: 100 });
  noArchive.loadHistory([]);
  noArchive.renderRecap(HOME);
  assertEqual(noArchive.recapsShown.length, 0, 'arşiv boşken özet gösterildi');

  // Saf karar da aynı sonucu verir.
  assertEqual(
    rx.decideSeasonRecap({ archives: [], currentSeasonIndex: 3, startingRp: 100 }),
    undefined,
    'boş arşiv özet üretti',
  );
  assertEqual(
    rx.decideSeasonRecap({
      archives: [{ finalRp: 500, scheduledDaysCompleted: 1, scheduledDaysTotal: 2, seasonIndex: 1 }],
      currentSeasonIndex: 1,
      startingRp: 0,
    }),
    undefined,
    'ilk sezon özet üretti',
  );
});

check('43. Hemen önceki sezon arşivi bekleyen özet üretir', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  // Arşiv otomatik olarak BİR KEZ istenir.
  assertEqual(app.historyRequests.length, 1, 'arşiv tam olarak bir kez istenmeli');
  assertEqual(app.pendingRecap, undefined, 'arşiv gelmeden özet üretildi');

  app.loadHistory([archiveRow(4, { finalRp: 1850 }), archiveRow(3), archiveRow(2)]);
  assert(app.pendingRecap, 'özet oluşmadı');
  assertEqual(app.pendingRecap.archive.seasonIndex, 4, 'yanlış sezon özetlendi');
  assertEqual(app.pendingRecap.nextSeasonIndex, 5, 'yeni sezon numarası yanlış');
  assertEqual(app.pendingRecap.startingRp, 300, 'başlangıç RP sunucu değerinden alınmadı');

  app.renderRecap(HOME);
  assertDeepEqual(
    app.recapsShown,
    [{ closedSeasonIndex: 4, finalRp: 1850, nextSeasonIndex: 5, startingRp: 300 }],
    'özet doğru sunucu değerleriyle gösterilmedi',
  );
});

check('44. Görünmeden kapanan özet sonraki açılışta YENİDEN oluşur', () => {
  const device = createDevice();
  const storageKey = rx.seasonRecapStorageKey('user-a', 4);

  const first = createSession(device);
  first.signIn('user-a');
  first.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  first.loadHistory([archiveRow(4)]);
  // Kullanıcı aktif antrenmanda: özet bekliyor, hiç gösterilmedi.
  first.renderRecap(WORKOUT);
  first.renderRecap(WORKOUT);
  assertEqual(first.recapsShown.length, 0, 'antrenman ekranında özet açıldı');
  assertEqual(device.get(storageKey), undefined, 'gösterilmeyen özet kalıcı kayıt yazdı');

  // Uygulama tamamen kapandı; soğuk açılış.
  const second = createSession(device);
  second.signIn('user-a');
  second.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  second.loadHistory([archiveRow(4)]);
  second.renderRecap(HOME);
  second.layoutRecap();

  assertEqual(second.recapsShown.length, 1, 'görülmemiş özet yeniden açılışta kayboldu');
  assertEqual(device.get(storageKey), '4', 'gösterim kaydı yazılmadı');
});

check('45. Görünmeye BAŞLAYAN özet düğmeye basılmasa da tekrar açılmaz', () => {
  const device = createDevice();
  const storageKey = rx.seasonRecapStorageKey('user-a', 4);

  const first = createSession(device);
  first.signIn('user-a');
  first.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  first.loadHistory([archiveRow(4)]);
  first.renderRecap(HOME);
  first.layoutRecap();
  assertEqual(first.recapsShown.length, 1, 'güvenli ekranda gösterilmeliydi');
  assertEqual(device.get(storageKey), '4', 'layout sonrası kayıt yazılmadı');

  // Düğmeye BASILMADAN uygulama kapandı; soğuk açılış.
  const second = createSession(device);
  second.signIn('user-a');
  second.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  second.loadHistory([archiveRow(4)]);
  second.renderRecap(HOME);
  assertEqual(second.recapsShown.length, 0, 'gösterilmiş özet tekrar açıldı');
  assertEqual(second.historyRequests.length, 0, 'kayıt varken gereksiz arşiv isteği atıldı');
});

check('46. Aynı oturumdaki tekrar sync/render ikinci özet üretmez', () => {
  const device = createDevice();
  const storageKey = rx.seasonRecapStorageKey('user-a', 4);
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  app.loadHistory([archiveRow(4)]);

  // Set sonrası sync, AppState dönüşü, gece yarısı sync…
  for (let index = 0; index < 5; index += 1) {
    app.applySeason({ currentRank: 'silver', currentRp: 320 + index, seasonIndex: 5, startingRp: 300 });
  }
  app.renderRecap(HOME);
  app.layoutRecap();
  app.renderRecap(HOME);
  app.layoutRecap();
  app.renderRecap('/profile');
  app.layoutRecap();
  app.acknowledgeRecapShown(4);
  app.acknowledgeRecapShown(4);

  assertEqual(app.recapsShown.length, 1, 'ikinci özet overlay’i üretildi');
  assertEqual(device.writesFor(storageKey).length, 1, 'gösterim kaydı tekrarlandı');

  // Kapandıktan sonra tekrar sync gelse de yeniden açılmaz.
  app.dismissRecap();
  app.applySeason({ currentRank: 'silver', currentRp: 340, seasonIndex: 5, startingRp: 300 });
  app.renderRecap(HOME);
  assertEqual(app.recapsShown.length, 1, 'kapatılan özet yeniden açıldı');
});

check('47. Eski veya alakasız sezon arşivi özet ÜRETMEZ', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  // Güncel sezon 6 ama en yeni kapanmış sezon 4 (kullanıcı 5'i tamamen kaçırdı).
  app.applySeason({ currentRank: 'bronze', currentRp: 80, seasonIndex: 6, startingRp: 60 });
  app.loadHistory([archiveRow(4), archiveRow(3)]);
  app.renderRecap(HOME);
  assertEqual(app.recapsShown.length, 0, 'hemen önceki olmayan sezon özetlendi');

  // Saf karar: yalnızca `currentSeasonIndex - 1` kabul edilir.
  assertEqual(
    rx.decideSeasonRecap({
      archives: [{ finalRp: 500, scheduledDaysCompleted: 1, scheduledDaysTotal: 2, seasonIndex: 4 }],
      currentSeasonIndex: 6,
      startingRp: 60,
    }),
    undefined,
    'iki sezon önceki arşiv özet üretti',
  );
  const valid = rx.decideSeasonRecap({
    archives: [
      { finalRp: 500, scheduledDaysCompleted: 1, scheduledDaysTotal: 2, seasonIndex: 4 },
      { finalRp: 700, scheduledDaysCompleted: 30, scheduledDaysTotal: 40, seasonIndex: 5 },
    ],
    currentSeasonIndex: 6,
    startingRp: 60,
  });
  assertEqual(valid?.closedSeasonIndex, 5, 'en yeni kapanmış sezon seçilmedi');
  assertEqual(valid?.planCompletionPercent, 75, 'plan uyumu yüzdesi yanlış');
});

check('48. Tutarsız/eksik sunucu verisi özet ÜRETMEZ', () => {
  const base = { finalRp: 500, scheduledDaysCompleted: 10, scheduledDaysTotal: 20, seasonIndex: 4 };
  const call = (archive, startingRp = 300) =>
    rx.decideSeasonRecap({ archives: [archive], currentSeasonIndex: 5, startingRp });

  assert(call(base), 'geçerli veri özet üretmeliydi');
  assertEqual(call({ ...base, finalRp: Number.NaN }), undefined, 'NaN finalRp kabul edildi');
  assertEqual(call({ ...base, finalRp: -10 }), undefined, 'negatif finalRp kabul edildi');
  assertEqual(
    call({ ...base, scheduledDaysCompleted: 30 }),
    undefined,
    'tamamlanan > planlanan kabul edildi',
  );
  assertEqual(
    call({ ...base, scheduledDaysTotal: -1 }),
    undefined,
    'negatif planlanan gün kabul edildi',
  );
  assertEqual(call(base, Number.POSITIVE_INFINITY), undefined, 'sonsuz startingRp kabul edildi');
  assertEqual(call(base, -1), undefined, 'negatif startingRp kabul edildi');
  // Planlı gün yoksa yüzde 0'dır ve özet yine gösterilebilir.
  assertEqual(
    call({ ...base, scheduledDaysCompleted: 0, scheduledDaysTotal: 0 })?.planCompletionPercent,
    0,
    'planlı gün yokken yüzde 0 olmalı',
  );
});

check('49. Hesap A’nın geç arşiv cevabı B’ye state YAZMAZ', () => {
  const device = createDevice();
  const app = createSession(device);

  app.signIn('user-a');
  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  const ownerOfA = app.owner;

  // B giriş yaptı; A'nın uçuştaki arşiv cevabı ancak şimdi döndü.
  app.signIn('user-b');
  app.loadHistory([archiveRow(4)], ownerOfA);
  app.renderRecap(HOME);

  assertEqual(app.pendingRecap, undefined, 'A’nın arşivi B’de özet üretti');
  assertEqual(app.recapsShown.length, 0, 'A’nın cevabı B’de overlay açtı');
  assertEqual(
    device.get(rx.seasonRecapStorageKey('user-b', 4)),
    undefined,
    'A’nın cevabı B’nin anahtarına yazdı',
  );
});

check('50. A’nın gösterildi anahtarı B’yi ETKİLEMEZ', () => {
  const device = createDevice();
  const app = createSession(device);

  // A özetini gördü.
  app.signIn('user-a');
  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  app.loadHistory([archiveRow(4)]);
  app.renderRecap(HOME);
  app.layoutRecap();
  assertEqual(app.recapsShown.length, 1, 'A’nın özeti gösterilmeliydi');
  assertEqual(device.get(rx.seasonRecapStorageKey('user-a', 4)), '4', 'A’nın kaydı yazılmadı');

  // B aynı cihazda, aynı sezonda: kendi özetini GÖRMELİ.
  app.signIn('user-b');
  app.applySeason({ currentRank: 'gold', currentRp: 480, seasonIndex: 5, startingRp: 300 });
  app.loadHistory([archiveRow(4, { finalRp: 900 })]);
  app.renderRecap(HOME);
  app.layoutRecap();

  assertEqual(app.recapsShown.length, 2, 'A’nın kaydı B’nin özetini bastırdı');
  assertEqual(app.recapsShown[1].finalRp, 900, 'B kendi sunucu verisini görmedi');
  assertEqual(device.get(rx.seasonRecapStorageKey('user-b', 4)), '4', 'B’nin kaydı yazılmadı');
  // Anahtarlar gerçekten ayrı.
  assert(
    rx.seasonRecapStorageKey('user-a', 4) !== rx.seasonRecapStorageKey('user-b', 4),
    'özet anahtarı kullanıcıya göre ayrışmıyor',
  );
  assertEqual(
    rx.seasonRecapStorageKey('user-a', 4),
    'rank:season-recap-shown:user-a:4',
    'özet anahtarı beklenen biçimde değil',
  );
  // Rank yükselme anahtarıyla da çakışmaz.
  assert(
    rx.seasonRecapStorageKey('user-a', 4) !== rx.rankCelebrationStorageKey('user-a', 4),
    'özet ve kutlama aynı anahtarı paylaşıyor',
  );
});

check('51. Bekleyen rank yükselmesi varken iki overlay ÜST ÜSTE açılmaz', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  // Yeni sezon + aynı sezon içinde yükseliş: ikisi de bekliyor.
  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  app.loadHistory([archiveRow(4)]);
  app.applySeason({ currentRank: 'gold', currentRp: 470, seasonIndex: 5, startingRp: 300 });
  assert(app.pending, 'rank yükselmesi oluşmadı');
  assert(app.pendingRecap, 'sezon özeti oluşmadı');

  // Önce kutlama; özet sırasını bekler.
  app.render(HOME);
  app.renderRecap(HOME);
  assertEqual(app.shown.length, 1, 'kutlama gösterilmedi');
  assertEqual(app.recapsShown.length, 0, 'özet kutlamayla üst üste açıldı');
  assertEqual(
    device.get(rx.seasonRecapStorageKey('user-a', 4)),
    undefined,
    'gösterilmeyen özet kayıt yazdı',
  );

  // Kutlama kapandı → özet gösterilebilir.
  app.dismiss();
  app.renderRecap(HOME);
  app.layoutRecap();
  assertEqual(app.recapsShown.length, 1, 'kutlama kapandıktan sonra özet açılmadı');
  assertEqual(device.get(rx.seasonRecapStorageKey('user-a', 4)), '4', 'özet kaydı yazılmadı');
});

check('52. Özet güvenli olmayan ekranda BEKLER, güvenli ekranda açılır', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  app.loadHistory([archiveRow(4)]);

  for (const pathname of [WORKOUT, '/reset-password', '/login', '/confirm']) {
    app.renderRecap(pathname);
  }
  assertEqual(app.recapsShown.length, 0, 'güvenli olmayan ekranda özet açıldı');
  assert(app.pendingRecap, 'özet düşürüldü, bekletilmedi');

  app.renderRecap(HOME);
  app.layoutRecap();
  app.renderRecap(HOME);
  assertEqual(app.recapsShown.length, 1, 'güvenli ekranda tam olarak bir kez açılmalı');
});

check('53. Kaynak: kalıcı kayıt yalnızca gösterim onayından ilerliyor', () => {
  assert(
    contextSource.includes('const acknowledgeSeasonRecapShown = useCallback('),
    'sezon özeti gösterim onayı metodu yok',
  );
  // Tespit yolunda (`resolveSeasonRecap`) HİÇBİR yazma olmamalı.
  const resolveBody = contextSource.slice(
    contextSource.indexOf('const resolveSeasonRecap = useCallback('),
    contextSource.indexOf('const acknowledgeSeasonRecapShown = useCallback('),
  );
  assert(resolveBody.length > 0, 'resolveSeasonRecap bulunamadı');
  assert(
    !resolveBody.includes('AsyncStorage.setItem'),
    'özet tespit edilirken kalıcı kayıt yazılıyor',
  );
  assert(
    resolveBody.includes('AsyncStorage.getItem(') && resolveBody.includes('seasonRecapStorageKey'),
    'tespit yolu gösterildi kaydını okumuyor',
  );
  // Onay state'i KAPATMAZ.
  const acknowledgeBody = contextSource.slice(
    contextSource.indexOf('const acknowledgeSeasonRecapShown = useCallback('),
    contextSource.indexOf('const dismissSeasonRecap = useCallback('),
  );
  assert(!acknowledgeBody.includes('setSeasonRecap'), 'gösterim onayı state’i kapatıyor');
  assert(
    acknowledgeBody.includes('acknowledgedRecapRef.current === recapKey'),
    'aynı özet için tekrar yazma koruması yok',
  );
  assert(
    acknowledgeBody.includes('recap.archive.seasonIndex !== closedSeasonIndex') &&
      acknowledgeBody.includes('seasonRef.current?.seasonIndex !== recap.nextSeasonIndex'),
    'onay kimlik/sezon sahipliğini doğrulamıyor',
  );
  /**
   * Depo hataları yutulur: HER AsyncStorage çağrısının hemen ardından bir
   * `catch` gelmeli. Aksi hâlde tek bir depo hatası sağlayıcıyı düşürür ve
   * antrenman/navigasyon akışını bozardı.
   */
  const storageCalls = [...contextSource.matchAll(/AsyncStorage\.(getItem|setItem|removeItem)\(/g)];
  assert(storageCalls.length >= 6, 'beklenen AsyncStorage çağrıları bulunamadı');
  for (const call of storageCalls) {
    const tail = contextSource.slice(call.index, call.index + 260);
    assert(
      /\)\s*\.catch\(\(\) => (null|undefined)\)/.test(tail),
      `korumasız AsyncStorage çağrısı: ${tail.split('\n')[0]}`,
    );
  }
});

check('54. Kutlama katmanı: öncelik, onay ve Reduce Motion', () => {
  assert(recapSource.includes('if (rankUp) return;'), 'özet rank yükselmesine öncelik vermiyor');
  assert(
    recapSource.includes('canShowRankCelebration(pathname)'),
    'özet route güvenliğini okumuyor',
  );
  assertEqual(
    (recapSource.match(/acknowledgeSeasonRecapShown\(/g) ?? []).length,
    1,
    'gösterim onayı katmandan birden fazla kez çağrılıyor',
  );
  // Reduce Motion: ölçek kaldırılır, süre kısa fade'e iner — kutlamayla aynı.
  assert(recapSource.includes('useReducedMotion'), 'özet Reduce Motion’ı okumuyor');
  assert(
    /transform: reduceMotion \? \[\]/.test(recapSource),
    'Reduce Motion açıkken ölçek hareketi kaldırılmıyor',
  );
  assert(
    recapSource.includes('reduceMotion ? MotionDuration.instant : MotionDuration.standard'),
    'Reduce Motion açıkken giriş süresi kısaltılmıyor',
  );
  // İstatistikler mevcut MotionSection ile hafifçe sıralanır (kendi içinde
  // Reduce Motion'ı da kapatır); yeni animasyon altyapısı kurulmaz.
  assert(recapSource.includes('MotionStagger.step'), 'istatistikler sırayla görünmüyor');
  assert(!/duration:\s*\d+/.test(recapSource), 'özet katmanında ham (token’sız) süre değeri var');
  // İçerik kırpılmaz, safe area’ya uyar.
  assert(recapSource.includes('ScrollView'), 'küçük ekranda içerik kaydırılamıyor');
  assert(recapSource.includes('useSafeAreaInsets'), 'safe area dikkate alınmıyor');
  assert(recapSource.includes('accessibilityViewIsModal'), 'overlay modal olarak işaretlenmemiş');
  assert(
    recapSource.includes('accessibilityRole="header"') &&
      recapSource.includes('accessibilityRole="button"'),
    'accessibility role değerleri eksik',
  );
  // İstemci hiçbir RP/rank/soft reset değeri hesaplamaz.
  assert(
    !/softResetRp|resolveRank\(|clampRp/.test(recapSource),
    'özet katmanı istemcide rank/RP hesaplıyor',
  );
  // Sabit kullanıcı metni yok.
  assert(
    !/<Text[^>]*>\s*[A-ZĞÜŞİÖÇ][a-zğüşıöç]/.test(recapSource),
    'özet katmanında çeviriden geçmeyen sabit metin var',
  );
});

check('55. Özet metinleri iki dilde de locale dosyasından geliyor', () => {
  for (const key of [
    'seasonRecap',
    'finalRank',
    'softReset',
    'softResetValue',
    'nextSeason',
    'start',
  ]) {
    assert(localeTr.includes(`${key}:`), `tr sözlüğünde ${key} yok`);
    assert(localeEn.includes(`${key}:`), `en sözlüğünde ${key} yok`);
  }
  assert(localeTr.includes("softResetValue: '{from} RP → {to} RP'"), 'tr soft reset şablonu yanlış');
  assert(localeEn.includes("softResetValue: '{from} RP → {to} RP'"), 'en soft reset şablonu yanlış');
});

check('56. Faz 3 yeni migration/tablo ÜRETMEDİ', () => {
  const migrations = execFileSync('git', ['status', '--porcelain', 'supabase'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  // Yalnızca takip edilmeyen `supabase/.temp/` kalabilir; migration değişmemeli.
  for (const line of migrations.split('\n').filter(Boolean)) {
    assert(line.includes('supabase/.temp'), `supabase altında beklenmeyen değişiklik: ${line}`);
  }
});

// ---------------------------------------------------------------------------
// 6 · Yaşam döngüsü regresyonları — layout onayı ve arşiv hatası
// ---------------------------------------------------------------------------

check('57. (A) Başarısız arşiv isteği özeti KALICI olarak atlatmaz', () => {
  const device = createDevice();
  let shouldFail = true;
  const attempts = [];

  const app = createSession(device, () => {
    attempts.push(shouldFail ? 'fail' : 'ok');
    return shouldFail ? { ok: false } : { ok: true, rows: [archiveRow(4)] };
  });

  app.signIn('user-a');
  // İlk sync: arşiv isteği BAŞARISIZ.
  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  assertDeepEqual(attempts, ['fail'], 'ilk istek atılmadı');
  assertEqual(app.isHistoryLoaded, false, 'başarısız istek yüklendi sayıldı');
  assertEqual(app.pendingRecap, undefined, 'arşiv yokken özet üretildi');
  assertEqual(
    app.resolvedRecap,
    undefined,
    'başarısız istekten sonra karar "özet yok" diye kapatıldı',
  );

  // Sonraki doğal tetikleyici (rank sync / AppState active): bu kez başarılı.
  shouldFail = false;
  app.applySeason({ currentRank: 'silver', currentRp: 330, seasonIndex: 5, startingRp: 300 });
  assertDeepEqual(attempts, ['fail', 'ok'], 'başarısızlıktan sonra yeniden denenmedi');
  assert(app.pendingRecap, 'başarılı yüklemeden sonra özet oluşmadı');

  app.renderRecap(HOME);
  app.layoutRecap();
  assertEqual(app.recapsShown.length, 1, 'özet gösterilmedi');
  assertEqual(device.get(rx.seasonRecapStorageKey('user-a', 4)), '4', 'gösterim kaydı yazılmadı');
});

check('58. (A2) Rank ekranından gelen başarılı yükleme de kararı açar', () => {
  const device = createDevice();
  const app = createSession(device, () => ({ ok: false }));

  app.signIn('user-a');
  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  assertEqual(app.resolvedRecap, undefined, 'başarısız istek kararı kapattı');

  // Kullanıcı rank ekranını açtı ve orada yükleme başarılı oldu.
  app.loadHistory([archiveRow(4)]);
  assert(app.pendingRecap, 'başarılı yüklemeden sonra özet oluşmadı');
});

check('59. (B) Arşiv sürekli hata verse de çökme ve sonsuz istek YOK', () => {
  const device = createDevice();
  const attempts = [];
  const app = createSession(device, () => {
    attempts.push('fail');
    return { ok: false };
  });

  app.signIn('user-a');
  // 20 doğal tetikleyici (ör. antrenman boyunca her set sonrası sync).
  for (let index = 0; index < 20; index += 1) {
    app.applySeason({
      currentRank: 'silver',
      currentRp: 320 + index,
      seasonIndex: 5,
      startingRp: 300,
    });
    app.renderRecap(HOME);
    app.layoutRecap();
  }

  // Yeniden deneme DOĞAL tetikleyicilere bağlıdır ve oturum başına sınırlıdır:
  // istek fırtınası oluşmaz.
  assertEqual(attempts.length, RECAP_HISTORY_MAX_ATTEMPTS, 'istek fırtınası oluştu');
  assertEqual(app.historyRequests.length, RECAP_HISTORY_MAX_ATTEMPTS, 'istek sayısı sınırı aştı');
  // Deneme hakkı bitse bile karar KAPATILMAZ.
  assertEqual(app.resolvedRecap, undefined, 'deneme hakkı bitince karar kalıcı kapatıldı');
  // Rank ekranından gelen başarılı yükleme özeti hâlâ açabilir.
  app.loadHistory([archiveRow(4)]);
  assert(app.pendingRecap, 'deneme hakkı bitince özet kalıcı olarak yutuldu');
  assertEqual(app.recapsShown.length, 0, 'arşiv yokken özet gösterildi');
  assertEqual(
    device.writesFor(rx.seasonRecapStorageKey('user-a', 4)).length,
    0,
    'arşiv okunamazken kalıcı kayıt yazıldı',
  );
  // Rank yükselme akışı bundan hiç etkilenmez.
  app.applySeason({ currentRank: 'gold', currentRp: 470, seasonIndex: 5, startingRp: 300 });
  app.render(HOME);
  assertEqual(app.shown.length, 1, 'arşiv hatası rank yükselme akışını bozdu');
});

check('60. (C) `setShown` anında AsyncStorage YAZILMAZ', () => {
  const device = createDevice();
  const storageKey = rx.seasonRecapStorageKey('user-a', 4);
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  app.loadHistory([archiveRow(4)]);

  // Overlay `shown` state'ine alındı ama henüz mount/layout OLMADI.
  app.renderRecap(HOME);
  assertEqual(app.recapsShown.length, 1, 'overlay gösterime alınmadı');
  assertEqual(
    device.writesFor(storageKey).length,
    0,
    'gösterim onayı layout beklemeden yazıldı',
  );
});

check('61. (D) Layout callback’i geldiğinde TAM BİR KEZ yazılır', () => {
  const device = createDevice();
  const storageKey = rx.seasonRecapStorageKey('user-a', 4);
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  app.loadHistory([archiveRow(4)]);
  app.renderRecap(HOME);
  app.layoutRecap();

  const writes = device.writesFor(storageKey);
  assertEqual(writes.length, 1, 'layout sonrası tam bir yazma beklenir');
  assertEqual(writes[0].value, '4', 'yanlış sezon kaydedildi');
});

check('62. (G) Tekrarlanan layout callback’i ikinci yazma ÜRETMEZ', () => {
  const device = createDevice();
  const storageKey = rx.seasonRecapStorageKey('user-a', 4);
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  app.loadHistory([archiveRow(4)]);
  app.renderRecap(HOME);

  // Döndürme, yazı tipi ölçeği, içerik boyu değişimi…
  for (let index = 0; index < 6; index += 1) app.layoutRecap();
  // Doğrudan onay çağrısı da tekrar yazmaz (context tarafı ikinci katman).
  app.acknowledgeRecapShown(4);

  assertEqual(device.writesFor(storageKey).length, 1, 'layout tekrarı yeni yazma üretti');
});

check('63. (E) Layout GELMEDEN kapanış → soğuk açılışta özet yeniden oluşur', () => {
  const device = createDevice();
  const storageKey = rx.seasonRecapStorageKey('user-a', 4);

  const first = createSession(device);
  first.signIn('user-a');
  first.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  first.loadHistory([archiveRow(4)]);
  // `shown` ayarlandı ama kart hiç layout olmadan uygulama kapandı.
  first.renderRecap(HOME);
  assertEqual(device.get(storageKey), undefined, 'layout olmadan kayıt yazıldı');

  const second = createSession(device);
  second.signIn('user-a');
  second.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  second.loadHistory([archiveRow(4)]);
  second.renderRecap(HOME);
  second.layoutRecap();

  assertEqual(second.recapsShown.length, 1, 'layout olmadan kapanan özet kayboldu');
  assertEqual(device.get(storageKey), '4', 'ikinci oturumda kayıt yazılmadı');
});

check('64. (F) Layout GELDİKTEN sonra kapanış → soğuk açılışta çıkmaz', () => {
  const device = createDevice();

  const first = createSession(device);
  first.signIn('user-a');
  first.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  first.loadHistory([archiveRow(4)]);
  first.renderRecap(HOME);
  first.layoutRecap();
  // "Başla" düğmesine BASILMADI.

  const second = createSession(device);
  second.signIn('user-a');
  second.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  second.renderRecap(HOME);
  second.layoutRecap();

  assertEqual(second.recapsShown.length, 0, 'layout edilmiş özet tekrar açıldı');
  assertEqual(second.historyRequests.length, 0, 'kayıt varken arşiv isteği atıldı');
});

check('65. (H) A’nın geç arşiv/onay cevabı B’ye YAZAMAZ', () => {
  const device = createDevice();
  const app = createSession(device);

  app.signIn('user-a');
  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  const ownerOfA = app.owner;
  app.loadHistory([archiveRow(4)]);
  app.renderRecap(HOME);
  // A layout olmadan hesap değiştirdi.

  app.signIn('user-b');
  // A'nın uçuştaki arşiv cevabı ve geç gelen layout onayı şimdi düştü.
  app.loadHistory([archiveRow(4)], ownerOfA);
  app.layoutRecap();
  app.acknowledgeRecapShown(4);
  app.renderRecap(HOME);

  assertEqual(app.pendingRecap, undefined, 'A’nın arşivi B’de özet üretti');
  assertEqual(app.recapsShown.length, 1, 'A’nın geç cevabı B’de yeni overlay açtı');
  assertEqual(
    device.get(rx.seasonRecapStorageKey('user-b', 4)),
    undefined,
    'A’nın onayı B’nin anahtarına yazdı',
  );
  assertEqual(
    device.get(rx.seasonRecapStorageKey('user-a', 4)),
    undefined,
    'A layout etmeden kaydı yazıldı',
  );
});

check('66. (I) Rank-up önceliği ve unsafe route bekletmesi KORUNUR', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a');

  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  app.loadHistory([archiveRow(4)]);
  app.applySeason({ currentRank: 'gold', currentRp: 470, seasonIndex: 5, startingRp: 300 });

  // Unsafe route: ikisi de bekler, hiçbir kayıt yazılmaz.
  app.render(WORKOUT);
  app.renderRecap(WORKOUT);
  app.layoutRecap();
  assertEqual(app.shown.length, 0, 'antrenman ekranında kutlama açıldı');
  assertEqual(app.recapsShown.length, 0, 'antrenman ekranında özet açıldı');
  assertEqual(device.writes.length, 1, 'bekleme sırasında beklenmeyen yazma oldu (seed hariç)');

  // Güvenli ekran: önce kutlama, özet sırasını bekler.
  app.render(HOME);
  app.renderRecap(HOME);
  app.layoutRecap();
  assertEqual(app.shown.length, 1, 'kutlama gösterilmedi');
  assertEqual(app.recapsShown.length, 0, 'özet kutlamayla üst üste açıldı');

  app.dismiss();
  app.renderRecap(HOME);
  app.layoutRecap();
  assertEqual(app.recapsShown.length, 1, 'kutlama kapandıktan sonra özet açılmadı');
});

check('67. Kaynak: onay YALNIZCA layout yolundan çağrılıyor', () => {
  // Gösterim kapısını geçen effect artık onay ÇAĞIRMAZ.
  const gateStart = recapSource.indexOf('if (shown || !seasonRecap || !isSafeScreen) return;');
  const gateEnd = recapSource.indexOf('}, [isSafeScreen, rankUp, seasonRecap, shown]);');
  assert(gateStart > 0 && gateEnd > gateStart, 'gösterim effect’i beklenen biçimde değil');
  assert(
    !recapSource.slice(gateStart, gateEnd).includes('acknowledgeSeasonRecapShown'),
    'onay hâlâ setShown ile aynı effect’te çağrılıyor',
  );

  // Onay tek noktadan, layout callback’inden çağrılır.
  assertEqual(
    (recapSource.match(/void acknowledgeSeasonRecapShown\(/g) ?? []).length,
    1,
    'gösterim onayı birden fazla yerden çağrılıyor',
  );
  const layoutStart = recapSource.indexOf('const handleCardLayout = useCallback(');
  const layoutEnd = recapSource.indexOf('const handleClosed = useCallback(');
  assert(layoutStart > 0 && layoutEnd > layoutStart, 'handleCardLayout bulunamadı');
  const layoutBody = recapSource.slice(layoutStart, layoutEnd);
  assert(layoutBody.includes('acknowledgeSeasonRecapShown('), 'onay layout yolundan çağrılmıyor');
  assert(
    layoutBody.includes('layoutAcknowledgedRef.current === closedSeasonIndex'),
    'tekrarlanan layout için koruma yok',
  );
  assert(
    recapSource.includes('onLayout={handleCardLayout}'),
    'layout callback’i karta bağlanmamış',
  );

  // Context guard’ları yerinde.
  assert(
    contextSource.includes('recap.archive.seasonIndex !== closedSeasonIndex') &&
      contextSource.includes('seasonRef.current?.seasonIndex !== recap.nextSeasonIndex'),
    'context kimlik/sezon guard’ları kaybolmuş',
  );
});

check('68. Kaynak: arşiv okunmadan "özet yok" kararı KAPATILMIYOR', () => {
  const resolveBody = contextSource.slice(
    contextSource.indexOf('const resolveSeasonRecap = useCallback('),
    contextSource.indexOf('const acknowledgeSeasonRecapShown = useCallback('),
  );
  assert(
    resolveBody.includes('if (hasLoadedHistoryRef.current) resolvedRecapRef.current = recapKey;'),
    'karar arşiv okunmadan da kapatılabiliyor',
  );
  assert(resolveBody.includes('await loadHistory();'), 'arşiv isteğinin sonucu beklenmiyor');
  assert(
    resolveBody.includes('requestedRecapHistoryRef.current = undefined;'),
    'başarısız istekten sonra guard geri açılmıyor',
  );
  assert(
    resolveBody.includes('owner === ownerRef.current') &&
      resolveBody.includes('requestedRecapHistoryRef.current === requestKey'),
    'guard geri açılırken hesap/istek sahipliği doğrulanmıyor',
  );
  // Polling veya otomatik yeniden deneme yok; yeniden deneme sınırlı.
  assert(
    !/setInterval|setTimeout/.test(resolveBody),
    'arşiv isteği için zamanlayıcı/polling kurulmuş',
  );
  assert(
    resolveBody.includes('attempts < RECAP_HISTORY_MAX_ATTEMPTS'),
    'yeniden deneme sayısı sınırlanmamış (istek fırtınası riski)',
  );
  assert(
    contextSource.includes(`const RECAP_HISTORY_MAX_ATTEMPTS = ${RECAP_HISTORY_MAX_ATTEMPTS};`),
    'harness ve kaynak deneme sınırı ayrışıyor',
  );
});

// ---------------------------------------------------------------------------
// MUTATION TESTİ — bozuk implementasyon gerçekten düşüyor mu?
// ---------------------------------------------------------------------------

function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

check('M1. Referans hiç yazılmasaydı yükseliş her sync’te tekrar oynardı', () => {
  const device = createDevice();
  const broken = { baseline: undefined };
  const replay = [];

  for (const rank of ['silver', 'gold', 'gold', 'gold']) {
    const decision = rx.decideRankCelebration({
      baseline: broken.baseline,
      order: ORDER,
      season: { currentRank: rank, seasonIndex: 1 },
    });
    // Kasıtlı hata: karar yazılmıyor, referans ilk değerde donuyor.
    if (broken.baseline === undefined) broken.baseline = { rank: 'silver', seasonIndex: 1 };
    if (decision.type === 'celebrate') replay.push(decision.toRank);
  }

  assertThrows(
    () => assertEqual(replay.length, 1, 'mutation'),
    'referans yazmayan model testten geçti — tekrar oynatma yakalanmıyor',
  );
  assertEqual(replay.length, 3, 'bozuk model gerçekten tekrar oynatmalı');
  assertEqual(device.size, 0, 'bozuk model depoya hiç yazmamalıydı');
});

check('M2. Sezon numarası yok sayılsaydı soft reset "yükselme" sanılırdı', () => {
  const brokenDecide = (baselineRank, currentRank) =>
    ORDER.indexOf(currentRank) > ORDER.indexOf(baselineRank);

  // Sezon 4 Gold ile bitti, sezon 5'e Silver ile girildi, tekrar Gold'a çıkıldı.
  assert(brokenDecide('silver', 'gold'), 'bozuk model gerçekten yükselme görmeli');
  const correct = rx.decideRankCelebration({
    baseline: { rank: 'gold', seasonIndex: 4 },
    order: ORDER,
    season: { currentRank: 'silver', seasonIndex: 5 },
  });
  assertEqual(correct.type, 'seed', 'yeni sezon sessiz başlangıç üretmeli');
});

check('M4. Eski "gösterilmeden önce kaydet" davranışı yeni testleri DÜŞÜRÜR', () => {
  const device = createDevice();
  const storageKey = rx.rankCelebrationStorageKey('user-a', 3);

  /** Kasıtlı hata: `celebrate` kararı da kaydı HEMEN ilerletiyor. */
  let baseline;
  const brokenApply = (currentRank) => {
    const decision = rx.decideRankCelebration({
      baseline,
      order: ORDER,
      season: { currentRank, seasonIndex: 3 },
    });
    if (decision.type === 'idle') return;
    device.set(storageKey, decision.baseline.rank);
    baseline = decision.baseline;
  };

  brokenApply('silver');
  brokenApply('gold');
  // Kutlama HİÇ gösterilmedi, ama kayıt zaten Gold'a ilerledi.
  assertEqual(device.get(storageKey), 'gold', 'bozuk model gerçekten erken yazmalı');

  // Soğuk açılış: kaybolan kutlama artık yeniden oluşturulamaz.
  const afterRestart = rx.decideRankCelebration({
    baseline: { rank: device.get(storageKey), seasonIndex: 3 },
    order: ORDER,
    season: { currentRank: 'gold', seasonIndex: 3 },
  });
  assertThrows(
    () => assertEqual(afterRestart.type, 'celebrate', 'mutation'),
    'erken yazan model testten geçti — kaybolan kutlama yakalanmıyor',
  );
  assertEqual(afterRestart.type, 'idle', 'bozuk model gerçekten kutlamayı kaybetmeli');

  // Doğru model aynı senaryoda kutlamayı KORUR.
  const correctDevice = createDevice();
  const first = createSession(correctDevice);
  first.signIn('user-a');
  first.applySeason({ currentRank: 'silver', currentRp: 240, seasonIndex: 3 });
  first.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });
  first.render(WORKOUT);

  const second = createSession(correctDevice);
  second.signIn('user-a');
  second.applySeason({ currentRank: 'gold', currentRp: 460, seasonIndex: 3 });
  second.render(HOME);
  assertEqual(second.shown.length, 1, 'doğru model kutlamayı yeniden oluşturmalı');
});

check('M5. Özet "tespit edilince kaydet" davranışı yeni testleri DÜŞÜRÜR', () => {
  const device = createDevice();
  const storageKey = rx.seasonRecapStorageKey('user-a', 4);

  /** Kasıtlı hata: özet TESPİT EDİLDİĞİ anda gösterildi sayılıyor. */
  const brokenResolve = () => {
    if (device.get(storageKey) !== undefined) return undefined;
    const plan = rx.decideSeasonRecap({
      archives: [
        { finalRp: 520, scheduledDaysCompleted: 30, scheduledDaysTotal: 40, seasonIndex: 4 },
      ],
      currentSeasonIndex: 5,
      startingRp: 300,
    });
    if (!plan) return undefined;
    device.set(storageKey, String(plan.closedSeasonIndex));
    return plan;
  };

  // Özet tespit edildi ama kullanıcı aktif antrenmandaydı, HİÇ göremedi.
  assert(brokenResolve(), 'bozuk model gerçekten özet üretmeli');
  assertEqual(device.get(storageKey), '4', 'bozuk model gerçekten erken yazmalı');

  // Soğuk açılış: kaybolan özet artık yeniden oluşturulamaz.
  assertThrows(
    () => assert(brokenResolve(), 'mutation'),
    'erken yazan model testten geçti — kaybolan özet yakalanmıyor',
  );

  // Doğru model aynı senaryoda özeti KORUR.
  const correctDevice = createDevice();
  const first = createSession(correctDevice);
  first.signIn('user-a');
  first.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  first.loadHistory([archiveRow(4)]);
  first.renderRecap(WORKOUT);
  assertEqual(first.recapsShown.length, 0, 'antrenman ekranında gösterilmemeliydi');

  const second = createSession(correctDevice);
  second.signIn('user-a');
  second.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  second.loadHistory([archiveRow(4)]);
  second.renderRecap(HOME);
  second.layoutRecap();
  assertEqual(second.recapsShown.length, 1, 'doğru model özeti yeniden oluşturmalı');
});

check('M6. "setShown ile birlikte kaydet" davranışı yeni testleri DÜŞÜRÜR', () => {
  const device = createDevice();
  const storageKey = rx.seasonRecapStorageKey('user-a', 4);

  // Kasıtlı hata: gösterim kapısı geçilir geçilmez kayıt yazılıyor.
  const brokenShow = () => device.set(storageKey, '4');

  brokenShow();
  assertThrows(
    () => assertEqual(device.writesFor(storageKey).length, 0, 'mutation'),
    'setShown anında yazan model testten geçti — erken yazma yakalanmıyor',
  );

  // Doğru model: `renderRecap` yazmaz, yalnızca `layoutRecap` yazar.
  const correctDevice = createDevice();
  const app = createSession(correctDevice);
  app.signIn('user-a');
  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  app.loadHistory([archiveRow(4)]);
  app.renderRecap(HOME);
  assertEqual(
    correctDevice.writesFor(rx.seasonRecapStorageKey('user-a', 4)).length,
    0,
    'doğru model layout beklemeden yazdı',
  );
  app.layoutRecap();
  assertEqual(
    correctDevice.writesFor(rx.seasonRecapStorageKey('user-a', 4)).length,
    1,
    'doğru model layout sonrası yazmadı',
  );
});

check('M7. "arşiv okunmadan resolved yaz" davranışı özeti kalıcı olarak yutar', () => {
  /**
   * Kasıtlı hata: `hasLoadedHistory` kontrolü olmadan karar kapatılıyor.
   * Tek bir ağ hatası özeti bütün oturum boyunca yutar.
   */
  const brokenResolved = new Set();
  const brokenResolve = (hasLoadedHistory, requestAlreadySent) => {
    if (!requestAlreadySent) return 'request';
    brokenResolved.add('user-a:4');
    return 'resolved';
  };

  assertEqual(brokenResolve(false, false), 'request', 'ilk turda istek atılmalı');
  assertEqual(brokenResolve(false, true), 'resolved', 'bozuk model gerçekten kapatmalı');
  assertThrows(
    () => assert(!brokenResolved.has('user-a:4'), 'mutation'),
    'arşiv okunmadan kapatan model testten geçti',
  );

  // Doğru model aynı senaryoda kararı AÇIK bırakır ve sonra özeti üretir.
  const device = createDevice();
  let shouldFail = true;
  const app = createSession(device, () =>
    shouldFail ? { ok: false } : { ok: true, rows: [archiveRow(4)] },
  );
  app.signIn('user-a');
  app.applySeason({ currentRank: 'silver', currentRp: 320, seasonIndex: 5, startingRp: 300 });
  assertEqual(app.resolvedRecap, undefined, 'doğru model kararı erken kapattı');

  shouldFail = false;
  app.applySeason({ currentRank: 'silver', currentRp: 330, seasonIndex: 5, startingRp: 300 });
  assert(app.pendingRecap, 'doğru model başarılı yüklemeden sonra özet üretmedi');
});

check('M3. Bekleyen kutlama güvenli ekran kontrolü olmasa antrenmanı bölerdi', () => {
  assert(
    rx.canShowRankCelebration(WORKOUT) === false,
    'aktif antrenman ekranı güvenli sayılıyor',
  );
  assertThrows(
    () => assertEqual(rx.canShowRankCelebration(WORKOUT), true, 'mutation'),
    'route kontrolü etkisiz — kutlama antrenmanı bölebilir',
  );
});

// ---------------------------------------------------------------------------

rmSync(outDir, { force: true, recursive: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Rank deneyimi harness: ${passed} kontrol geçti.`);
console.log('  (RP kuralları, eşikler ve sezon sistemi ayrı harness’tadır: npm run verify:ranks)');
