#!/usr/bin/env node
/**
 * RANK DENEYİMİ (FAZ 2) — DOĞRULAMA HARNESS'I
 *
 * Kapsam: (1) RP hareket geçmişi ve (2) rank yükselme kutlaması. Sezon
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
const screenSource = source('app/rank.tsx');
const migrationSource = source('supabase/migrations/20260827120000_add_seasonal_ranks.sql');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

const ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'rosea'];

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
function createSession(device) {
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

  function signIn(nextUserId) {
    owner += 1;
    userId = nextUserId;
    baseline = undefined;
    pending = undefined;
    visible = undefined;
    acknowledgedId = 0;
    currentSeasonIndex = undefined;
  }

  function applySeason(snapshot, capturedOwner = owner) {
    if (capturedOwner !== owner) return;
    const ownerId = userId;
    currentSeasonIndex = snapshot.seasonIndex;
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

  return {
    acknowledgeShown,
    applySeason,
    dismiss,
    get owner() {
      return owner;
    },
    mascotReactions,
    get pending() {
      return pending;
    },
    render,
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
