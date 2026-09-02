/**
 * FAZ 2E-1 — Kardiyo gelişim analitik çekirdeği.
 *
 * GERÇEK saf çekirdek (`utils/activity-analytics.ts`, bağımlılıklarıyla) tsc ile
 * derlenip ÇAĞRILIR; yalnız kaynak metni aranmaz. Zaman `completedAt` ile
 * enjekte edilir.
 *
 * Çalıştırma:  node scripts/verify-activity-analytics.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} (beklenen ${expected}, gelen ${actual})`);
}

// ---------------------------------------------------------------------------
// GERÇEK modülleri derle ve içe aktar
// ---------------------------------------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), 'rosea-activity-analytics-'));
let analytics;
try {
  const shim = join(outDir, 'types-workout-shim.ts');
  writeFileSync(
    shim,
    ['ProgramExercise', 'WorkoutActivityRecord', 'WorkoutSetRecord', 'WorkoutTrackingMode']
      .map((name) => `export type ${name} = any;\n`)
      .join(''),
  );

  for (const [relative, outName] of [
    ['utils/workout-sets.ts', 'workout-sets'],
    ['utils/workout-tracking.ts', 'workout-tracking'],
    ['utils/activity-analytics.ts', 'activity-analytics'],
  ]) {
    const patched = source(relative)
      .replace(/from '@\/types\/workout'/g, "from './types-workout-shim'")
      .replace(/from '@\/utils\/workout-sets'/g, "from './workout-sets.js'")
      .replace(/from '@\/utils\/workout-tracking'/g, "from './workout-tracking.js'");
    const copy = join(outDir, `${outName}.ts`);
    writeFileSync(copy, patched);
    execFileSync(
      'npx',
      ['tsc', copy, shim, '--outDir', outDir, '--target', 'es2020', '--module', 'esnext',
       '--moduleResolution', 'bundler', '--strict', '--skipLibCheck'],
      { cwd: ROOT, stdio: 'pipe' },
    );
  }
  analytics = await import(pathToFileURL(join(outDir, 'activity-analytics.js')).href);
} catch (error) {
  console.error('Saf çekirdek derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}

const {
  buildActivityAnalytics,
  toActivityChartBars,
  isMetricImprovement,
  ACTIVITY_CHART_RECENT_LIMIT,
} = analytics;

let seq = 0;
/** Kısa kayıt kurucusu. `at` = ISO completedAt sırasını belirler. */
function rec(over = {}) {
  seq += 1;
  return {
    id: over.id ?? `r${seq}`,
    sessionId: over.sessionId ?? 's1',
    programExerciseId: 'programExerciseId' in over ? over.programExerciseId : 'run',
    exerciseName: over.exerciseName ?? 'Koşu',
    trackingMode: over.trackingMode ?? 'distance',
    targetDurationSeconds: over.targetDurationSeconds,
    targetDistanceMeters: over.targetDistanceMeters,
    durationSeconds: over.durationSeconds ?? 600,
    distanceMeters: 'distanceMeters' in over ? over.distanceMeters : 2000,
    rpe: over.rpe,
    completedAt: over.at ?? '2026-09-01T10:00:00.000Z',
    dateKey: over.dateKey ?? '2026-09-01',
  };
}

// ===========================================================================
console.log('=== Kardiyo analitik çekirdeği ===');
// ===========================================================================

check('Boş kayıt → boş analitik (sahte veri yok)', () => {
  assertEqual(buildActivityAnalytics([]).length, 0, 'boş girdi boş dönmüyor');
});

check('Duration serisi: ortalama ve en uzun süre', () => {
  const [a] = buildActivityAnalytics([
    rec({ programExerciseId: 'plank', trackingMode: 'duration', distanceMeters: undefined, durationSeconds: 100, at: '2026-09-01T10:00:00Z' }),
    rec({ programExerciseId: 'plank', trackingMode: 'duration', distanceMeters: undefined, durationSeconds: 200, at: '2026-09-02T10:00:00Z' }),
    rec({ programExerciseId: 'plank', trackingMode: 'duration', distanceMeters: undefined, durationSeconds: 300, at: '2026-09-03T10:00:00Z' }),
  ]);
  assertEqual(a.trackingMode, 'duration', 'tür duration değil');
  assertEqual(a.recordCount, 3, 'kayıt sayısı yanlış');
  assertEqual(a.duration.average, 200, 'ortalama süre yanlış');
  assertEqual(a.duration.best, 300, 'en uzun süre yanlış');
  assertEqual(a.distance, undefined, 'mesafesiz seride mesafe metriği üretildi');
  assertEqual(a.pace, undefined, 'mesafesiz seride tempo üretildi');
  assert(a.availableMetrics.length === 1 && a.availableMetrics[0] === 'duration', 'yalnız süre metriği olmalı');
});

check('Distance serisi: ortalama/en uzun mesafe + tempo türetme', () => {
  const [a] = buildActivityAnalytics([
    // 1000 m / 300 s → 300 sn/km; 2000 m / 400 s → 200 sn/km (daha hızlı)
    rec({ id: 'd1', durationSeconds: 300, distanceMeters: 1000, at: '2026-09-01T10:00:00Z' }),
    rec({ id: 'd2', durationSeconds: 400, distanceMeters: 2000, at: '2026-09-02T10:00:00Z' }),
  ]);
  assertEqual(a.distance.average, 1500, 'ortalama mesafe yanlış');
  assertEqual(a.distance.best, 2000, 'en uzun mesafe yanlış');
  assert(a.pace !== undefined, 'tempo türetilmedi');
  assertEqual(a.pace.best, 200, 'en iyi tempo (en düşük) yanlış');
  assertEqual(a.pace.average, 250, 'ortalama tempo yanlış');
  assert(a.availableMetrics.join(',') === 'duration,distance,pace', 'metrik listesi yanlış');
});

check('Tempo: düşük saniye/km DAHA İYİ (best = min)', () => {
  const [a] = buildActivityAnalytics([
    rec({ id: 'p1', durationSeconds: 600, distanceMeters: 1000, at: '2026-09-01T10:00:00Z' }), // 600
    rec({ id: 'p2', durationSeconds: 300, distanceMeters: 1000, at: '2026-09-02T10:00:00Z' }), // 300 daha hızlı
  ]);
  assertEqual(a.pace.best, 300, 'en iyi tempo en düşük değer olmalı');
});

check('Tempo grafiği: hızlı kayıt DAHA YÜKSEK çubuk (ham pace değil)', () => {
  const [a] = buildActivityAnalytics([
    rec({ id: 'p1', durationSeconds: 600, distanceMeters: 1000, at: '2026-09-01T10:00:00Z' }), // 600 yavaş
    rec({ id: 'p2', durationSeconds: 300, distanceMeters: 1000, at: '2026-09-02T10:00:00Z' }), // 300 hızlı
  ]);
  const bars = toActivityChartBars(a.recentRecords, 'pace');
  const slow = bars.find((b) => b.id === 'p1');
  const fast = bars.find((b) => b.id === 'p2');
  assert(fast.height > slow.height, 'hızlı tempo daha yüksek çubuk değil');
  assertEqual(fast.height, 1, 'en hızlı tam çubuk olmalı');
  assertEqual(slow.height, 0.5, 'yavaş çubuk min/value oranında olmalı');
  // Ham pace doğrudan yüksekliğe bağlanmamalı: yavaş (yüksek pace) kısa çubuk.
  assert(slow.value > fast.value && slow.height < fast.height, 'yükseklik ham pace ile aynı yönde artıyor');
});

check('Süre grafiği: uzun süre daha yüksek çubuk (value/max)', () => {
  const [a] = buildActivityAnalytics([
    rec({ id: 't1', trackingMode: 'duration', distanceMeters: undefined, durationSeconds: 200, at: '2026-09-01T10:00:00Z' }),
    rec({ id: 't2', trackingMode: 'duration', distanceMeters: undefined, durationSeconds: 400, at: '2026-09-02T10:00:00Z' }),
  ]);
  const bars = toActivityChartBars(a.recentRecords, 'duration');
  assertEqual(bars.find((b) => b.id === 't2').height, 1, 'en uzun süre tam çubuk olmalı');
  assertEqual(bars.find((b) => b.id === 't1').height, 0.5, 'kısa süre value/max oranında olmalı');
});

check('Son 8 kayıt: recentRecords en fazla 8, en yeni sonda (kronolojik)', () => {
  const records = [];
  for (let i = 1; i <= 12; i += 1) {
    records.push(rec({ id: `n${i}`, durationSeconds: 100 + i, distanceMeters: 1000 + i, at: `2026-09-${String(i).padStart(2, '0')}T10:00:00Z` }));
  }
  const [a] = buildActivityAnalytics(records);
  assertEqual(a.recordCount, 12, 'tüm kayıtlar sayılmalı');
  assertEqual(a.recentRecords.length, ACTIVITY_CHART_RECENT_LIMIT, 'son 8 sınırı uygulanmadı');
  assertEqual(a.recentRecords[0].id, 'n5', 'grafik penceresi son 8 değil');
  assertEqual(a.recentRecords[a.recentRecords.length - 1].id, 'n12', 'en yeni kayıt sonda (sağda) değil');
  assertEqual(a.lastRecord.id, 'n12', 'lastRecord en yeni değil');
});

check('Kronolojik sıralama: karışık girdi artan sıraya dizilir', () => {
  const [a] = buildActivityAnalytics([
    rec({ id: 'b', at: '2026-09-03T10:00:00Z' }),
    rec({ id: 'a', at: '2026-09-01T10:00:00Z' }),
    rec({ id: 'c', at: '2026-09-05T10:00:00Z' }),
  ]);
  assertEqual(a.recentRecords.map((r) => r.id).join(','), 'a,b,c', 'seri kronolojik sıralı değil');
});

check('Aynı ad / farklı tracking mode AYRI seri', () => {
  const list = buildActivityAnalytics([
    rec({ programExerciseId: undefined, exerciseName: 'Tempo', trackingMode: 'duration', distanceMeters: undefined, durationSeconds: 300, at: '2026-09-01T10:00:00Z' }),
    rec({ programExerciseId: undefined, exerciseName: 'Tempo', trackingMode: 'distance', distanceMeters: 2000, durationSeconds: 600, at: '2026-09-02T10:00:00Z' }),
  ]);
  assertEqual(list.length, 2, 'farklı tür aynı seride karıştı');
});

check('Silinmiş egzersiz: programExerciseId yoksa snapshot adına düşer', () => {
  const list = buildActivityAnalytics([
    rec({ programExerciseId: undefined, exerciseName: 'Koşu Bandı', at: '2026-09-01T10:00:00Z' }),
    rec({ programExerciseId: undefined, exerciseName: '  koşu bandı ', at: '2026-09-02T10:00:00Z' }),
  ]);
  assertEqual(list.length, 1, 'normalize ad fallback tek seri üretmedi');
  assertEqual(list[0].recordCount, 2, 'ad fallback kayıtları birleştirmedi');
});

check('Geçersiz/0/NaN eleme: 0 mesafe tempoya/mesafeye girmez', () => {
  const [a] = buildActivityAnalytics([
    rec({ id: 'z1', durationSeconds: 300, distanceMeters: 0, at: '2026-09-01T10:00:00Z' }),
    rec({ id: 'z2', durationSeconds: 300, distanceMeters: 1500, at: '2026-09-02T10:00:00Z' }),
  ]);
  // Mesafe türünde ana mesafesi geçersiz kayıt seriye hiç giremez.
  assertEqual(a.recordCount, 1, '0 mesafeli kayıt analitik sayacına girdi');
  assertEqual(a.lastRecord.id, 'z2', 'geçersiz kayıt son kayıt oldu');
  assertEqual(a.distance.sampleCount, 1, '0 mesafe metriğe girdi');
  assertEqual(a.distance.average, 1500, 'geçersiz mesafe ortalamayı bozdu');
  assertEqual(a.pace.sampleCount, 1, '0 mesafeli kayıt tempoya girdi');
});

check('Geçersiz süre/Infinity seriye ve son kayda girmez; tümü bozuksa grup yok', () => {
  const [a] = buildActivityAnalytics([
    rec({ id: 'valid', trackingMode: 'duration', distanceMeters: undefined, durationSeconds: 240, at: '2026-09-01T10:00:00Z' }),
    rec({ id: 'nan', trackingMode: 'duration', distanceMeters: undefined, durationSeconds: Number.NaN, at: '2026-09-02T10:00:00Z' }),
    rec({ id: 'infinity', trackingMode: 'duration', distanceMeters: undefined, durationSeconds: Number.POSITIVE_INFINITY, at: '2026-09-03T10:00:00Z' }),
  ]);
  assertEqual(a.recordCount, 1, 'geçersiz süreli kayıtlar analitiğe girdi');
  assertEqual(a.lastRecord.id, 'valid', 'geçersiz süreli kayıt son kayıt oldu');
  assertEqual(a.duration.best, 240, 'geçersiz süre sahte best üretti');

  const allInvalid = buildActivityAnalytics([
    rec({ trackingMode: 'duration', distanceMeters: undefined, durationSeconds: 0 }),
  ]);
  assertEqual(allInvalid.length, 0, 'tümü geçersiz seri gizlenmedi');
});

check('Tek kayıt: karşılaştırma nötr (lastDelta boş)', () => {
  const [a] = buildActivityAnalytics([rec({ id: 'only', durationSeconds: 500, distanceMeters: 1000, at: '2026-09-01T10:00:00Z' })]);
  assertEqual(Object.keys(a.lastDelta).length, 0, 'tek kayıtta delta üretildi');
  assertEqual(a.duration.average, 500, 'tek kayıt ortalaması yanlış');
  assertEqual(a.duration.best, 500, 'tek kayıt best yanlış');
});

check('Önceki kayda göre değişim: işaretli delta + gelişme yönü', () => {
  const [a] = buildActivityAnalytics([
    rec({ id: 'x1', durationSeconds: 600, distanceMeters: 1000, at: '2026-09-01T10:00:00Z' }), // pace 600
    rec({ id: 'x2', durationSeconds: 500, distanceMeters: 1000, at: '2026-09-02T10:00:00Z' }), // pace 500
  ]);
  assertEqual(a.lastDelta.duration, -100, 'süre deltası yanlış');
  assertEqual(a.lastDelta.pace, -100, 'tempo deltası yanlış');
  assertEqual(isMetricImprovement('pace', a.lastDelta.pace), true, 'düşen tempo gelişme sayılmadı');
  assertEqual(isMetricImprovement('duration', a.lastDelta.duration), false, 'azalan süre gelişme sayıldı');
  assertEqual(isMetricImprovement('distance', 50), true, 'artan mesafe gelişme değil');
});

check('Opsiyonel RPE: yalnız RPE varsa averageRpe', () => {
  const withRpe = buildActivityAnalytics([
    rec({ id: 'r1', rpe: 6, at: '2026-09-01T10:00:00Z' }),
    rec({ id: 'r2', rpe: 8, at: '2026-09-02T10:00:00Z' }),
  ])[0];
  assertEqual(withRpe.averageRpe, 7, 'RPE ortalaması yanlış');
  const withoutRpe = buildActivityAnalytics([rec({ id: 'r3', at: '2026-09-01T10:00:00Z' })])[0];
  assertEqual(withoutRpe.averageRpe, undefined, 'RPE yokken ortalama üretildi');
});

check('En yeni kayıt yapılan egzersiz özet listesinde önce', () => {
  const list = buildActivityAnalytics([
    rec({ programExerciseId: 'run', exerciseName: 'Koşu', at: '2026-09-01T10:00:00Z' }),
    rec({ programExerciseId: 'bike', exerciseName: 'Bisiklet', at: '2026-09-05T10:00:00Z' }),
  ]);
  assertEqual(list[0].exerciseName, 'Bisiklet', 'en yeni egzersiz başta değil');
});

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n✗ Analitik harness başarısız — ${pass} geçti, ${failures.length} kaldı:`);
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log(`\n✓ Kardiyo analitik çekirdeği: ${pass} kontrol geçti (gerçek saf çekirdek çalıştırıldı).`);
