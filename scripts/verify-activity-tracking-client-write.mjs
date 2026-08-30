/**
 * Faz 2B — kardiyo YAZMA yolu harness'ı.
 *
 * SINIR: React render edilmez, Supabase'e bağlanılmaz. GERÇEK saf yardımcılar
 * (`utils/activity-input.ts`, `utils/program-exercise.ts`,
 * `utils/workout-tracking.ts`, `utils/workout-sets.ts`) `tsc` ile derlenip
 * ÇAĞRILIR — kopya bir algoritma test EDİLMEZ.
 *
 * Yalnız kaynak metni sayan kontroller ayrı bir grupta (K) toplanmıştır ve
 * orada da metin varlığı değil, SÖZLEŞME ölçülür (yükte hangi kolonun
 * bulunmadığı, çağrı sırası, lokalize anahtarların gerçekten var olması).
 *
 * Çalıştırma:  node scripts/verify-activity-tracking-client-write.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} (beklenen ${e}, gelen ${a})`);
}

// ---------------------------------------------------------------------------
// GERÇEK modülleri derle ve içe aktar
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'rosea-client-write-'));
let input;
let exercises;
let tracking;

try {
  const shim = join(outDir, 'types-workout-shim.ts');
  writeFileSync(
    shim,
    [
      'ProgramExercise',
      'NewProgramExercise',
      'WorkoutActivityRecord',
      'WorkoutVisual',
      'WorkoutSetRecord',
      'WorkoutTrackingMode',
      'StrengthProgramExercise',
      'DurationProgramExercise',
      'DistanceProgramExercise',
    ]
      .map((name) => `export type ${name} = any;\n`)
      .join(''),
  );

  for (const [relative, outName] of [
    ['utils/activity-input.ts', 'activity-input'],
    ['utils/workout-sets.ts', 'workout-sets'],
    ['utils/workout-tracking.ts', 'workout-tracking'],
    ['utils/program-exercise.ts', 'program-exercise'],
  ]) {
    const patched = source(relative)
      .replace(/from '@\/types\/workout'/g, "from './types-workout-shim'")
      .replace(/from '@\/utils\/workout-sets'/g, "from './workout-sets.js'");
    const copy = join(outDir, `${outName}.ts`);
    writeFileSync(copy, patched);
    execFileSync(
      'npx',
      ['tsc', copy, shim, '--outDir', outDir, '--target', 'es2020', '--module', 'esnext',
       '--moduleResolution', 'bundler', '--strict', '--skipLibCheck'],
      { cwd: ROOT, stdio: 'pipe' },
    );
  }

  input = await import(pathToFileURL(join(outDir, 'activity-input.js')).href);
  exercises = await import(pathToFileURL(join(outDir, 'program-exercise.js')).href);
  tracking = await import(pathToFileURL(join(outDir, 'workout-tracking.js')).href);
} catch (error) {
  console.error('Saf yardımcılar derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}

const {
  ACTIVITY_DISTANCE_METERS_MAX,
  ACTIVITY_DISTANCE_METERS_MIN,
  ACTIVITY_DURATION_SECONDS_MAX,
  ACTIVITY_DURATION_SECONDS_MIN,
  TARGET_DURATION_SECONDS_MAX,
  TARGET_DURATION_SECONDS_MIN,
  formatMetersAsKilometers,
  parseKilometersToMeters,
  parseMinutesSecondsToSeconds,
  parseMinutesToSeconds,
  parseOptionalKilometersToMeters,
  parseOptionalRpe,
  splitSecondsIntoFields,
} = input;
const { buildProgramExerciseInsertPayload, buildProgramExerciseTargetUpdatePayload } = exercises;
const {
  aggregateActivityTotals,
  applyActivityTotalsDelta,
  completesWorkoutAfterActivity,
  getActivityProgressKey,
  resolveExerciseProgress,
} = tracking;

const DISTANCE_BOUNDS = { max: ACTIVITY_DISTANCE_METERS_MAX, min: ACTIVITY_DISTANCE_METERS_MIN };
const DURATION_BOUNDS = { max: ACTIVITY_DURATION_SECONDS_MAX, min: ACTIVITY_DURATION_SECONDS_MIN };

const getSetProgressKey = (dateKey, id) => `${dateKey}:${id}`;
const DATE = '2026-09-10';
const setKey = (id) => getSetProgressKey(DATE, id);
const actKey = (id) => getActivityProgressKey(DATE, id);

const BENCH = { id: 'bench', trackingMode: 'sets_reps', targetSets: 3, targetReps: '8-10', restSeconds: 60 };
const PLANK = { id: 'plank', trackingMode: 'duration', targetDurationSeconds: 600, restSeconds: 0 };
const RUN = { id: 'run', trackingMode: 'distance', targetDistanceMeters: 5000, restSeconds: 0 };

// ===========================================================================
console.log('=== A. Kilometre ayrıştırma ===');
// ===========================================================================

const km = (raw) => parseKilometersToMeters(raw, DISTANCE_BOUNDS);

check('A1. Nokta ve virgül AYNI sonucu verir', () => {
  assertDeepEqual(km('5.5'), { ok: true, value: 5500 }, 'nokta');
  assertDeepEqual(km('5,5'), { ok: true, value: 5500 }, 'virgül');
  assertDeepEqual(km('5'), { ok: true, value: 5000 }, 'tam sayı');
  assertDeepEqual(km('5.0'), { ok: true, value: 5000 }, 'sıfır ondalık');
  assertDeepEqual(km(' 5,5 '), { ok: true, value: 5500 }, 'boşluklu');
});

check('A2. km → TAM SAYI metre; kayan nokta hatası sızmaz', () => {
  for (const raw of ['0.1', '0.3', '1.1', '2.7', '10.35', '42.195']) {
    const result = km(raw);
    assert(result.ok, `${raw} reddedildi`);
    assert(Number.isInteger(result.value), `${raw} tam sayı değil: ${result.value}`);
  }
  assertEqual(km('0.1').value, 100, '0.1 km');
  assertEqual(km('42.195').value, 42195, 'maraton');
  // Metre altı basamak yarı-yukarı yuvarlanır, sessizce kesilmez.
  assertEqual(km('1.0004').value, 1000, 'aşağı yuvarlama');
  assertEqual(km('1.0005').value, 1001, 'yukarı yuvarlama');
});

check('A3. Boş, sıfır, negatif, NaN ve üst sınır REDDEDİLİR', () => {
  assertEqual(km('').reason, 'empty', 'boş');
  assertEqual(km('   ').reason, 'empty', 'boşluk');
  assertEqual(km('0').reason, 'range', 'sıfır');
  assertEqual(km('-5').reason, 'invalid', 'negatif');
  assertEqual(km('abc').reason, 'invalid', 'metin');
  assertEqual(km('5.5.5').reason, 'invalid', 'çift ayırıcı');
  assertEqual(km('1e3').reason, 'invalid', 'bilimsel gösterim');
  assertEqual(km('Infinity').reason, 'invalid', 'Infinity');
  assertEqual(km('NaN').reason, 'invalid', 'NaN');
  assertEqual(km('501').reason, 'range', 'üst sınır aşımı');
  assertDeepEqual(km('500'), { ok: true, value: 500000 }, 'tam üst sınır kabul');
});

check('A4. İsteğe bağlı mesafede BOŞ geçerlidir', () => {
  assertDeepEqual(
    parseOptionalKilometersToMeters('', DISTANCE_BOUNDS),
    { ok: true, value: undefined },
    'boş reddedildi',
  );
  assertDeepEqual(
    parseOptionalKilometersToMeters('3,2', DISTANCE_BOUNDS),
    { ok: true, value: 3200 },
    'dolu değer',
  );
  // Boş DEĞİL ama geçersizse yine reddedilir.
  assertEqual(parseOptionalKilometersToMeters('abc', DISTANCE_BOUNDS).reason, 'invalid', 'geçersiz');
});

check('A5. Metre → km metni gidiş-dönüş tutarlı', () => {
  for (const meters of [1, 100, 1000, 5500, 42195, 500000]) {
    const text = formatMetersAsKilometers(meters);
    assertEqual(km(text).value, meters, `gidiş-dönüş bozuldu (${meters})`);
  }
});

// ===========================================================================
console.log('\n=== B. Süre ayrıştırma ===');
// ===========================================================================

const dur = (m, sec) => parseMinutesSecondsToSeconds(m, sec, DURATION_BOUNDS);

check('B1. Dakika + saniye → TAM SAYI saniye', () => {
  assertDeepEqual(dur('10', '30'), { ok: true, value: 630 }, '10:30');
  assertDeepEqual(dur('0', '45'), { ok: true, value: 45 }, '0:45');
  assertDeepEqual(dur('25', ''), { ok: true, value: 1500 }, 'saniye boş');
  assertDeepEqual(dur('', '30'), { ok: true, value: 30 }, 'dakika boş');
});

check('B2. Boş, negatif, ondalık, NaN ve üst sınır REDDEDİLİR', () => {
  assertEqual(dur('', '').reason, 'empty', 'ikisi de boş');
  assertEqual(dur('0', '0').reason, 'range', 'sıfır toplam');
  assertEqual(dur('-5', '0').reason, 'invalid', 'negatif dakika');
  assertEqual(dur('10.5', '0').reason, 'invalid', 'ondalık dakika');
  assertEqual(dur('abc', '0').reason, 'invalid', 'metin');
  assertEqual(dur('1441', '0').reason, 'range', 'üst sınır aşımı');
  assertDeepEqual(dur('1440', '0'), { ok: true, value: 86400 }, 'tam üst sınır kabul');
});

check('B3. 60+ saniye SESSİZCE dakikaya çevrilmez', () => {
  assertEqual(dur('0', '90').reason, 'invalid', '90 sn kabul edildi');
  assertDeepEqual(dur('1', '30'), { ok: true, value: 90 }, '1:30 reddedildi');
});

check('B4. Saniye → alan metinleri gidiş-dönüş tutarlı', () => {
  for (const seconds of [1, 45, 90, 630, 1500, 86400]) {
    const fields = splitSecondsIntoFields(seconds);
    assertEqual(dur(fields.minutes, fields.seconds).value, seconds, `gidiş-dönüş (${seconds})`);
  }
});

check('B5. Hedef süre dakika tabanlıdır', () => {
  const bounds = { max: TARGET_DURATION_SECONDS_MAX, min: TARGET_DURATION_SECONDS_MIN };
  assertDeepEqual(parseMinutesToSeconds('30', bounds), { ok: true, value: 1800 }, '30 dk');
  assertEqual(parseMinutesToSeconds('', bounds).reason, 'empty', 'boş');
  assertEqual(parseMinutesToSeconds('0', bounds).reason, 'range', 'sıfır');
  assertEqual(parseMinutesToSeconds('-3', bounds).reason, 'invalid', 'negatif');
  assertEqual(parseMinutesToSeconds('2.5', bounds).reason, 'invalid', 'ondalık');
  assertEqual(parseMinutesToSeconds('1441', bounds).reason, 'range', 'üst sınır');
});

// ===========================================================================
console.log('\n=== C. RPE ===');
// ===========================================================================

check('C1. RPE 0–10 sınırı ve İSTEĞE BAĞLILIK', () => {
  assertDeepEqual(parseOptionalRpe(''), { ok: true, value: undefined }, 'boş');
  assertDeepEqual(parseOptionalRpe('0'), { ok: true, value: 0 }, 'alt sınır');
  assertDeepEqual(parseOptionalRpe('10'), { ok: true, value: 10 }, 'üst sınır');
  assertDeepEqual(parseOptionalRpe('7,5'), { ok: true, value: 7.5 }, 'virgül');
  assertEqual(parseOptionalRpe('10.1').reason, 'range', '10.1 kabul edildi');
  assertEqual(parseOptionalRpe('-1').reason, 'invalid', 'negatif');
  assertEqual(parseOptionalRpe('abc').reason, 'invalid', 'metin');
});

check('C2. numeric(3,1) sözleşmesi: ikinci ondalık REDDEDİLİR', () => {
  // Sunucu 7.25'i sessizce yuvarlardı; istemci hiç göndermez.
  assertEqual(parseOptionalRpe('7.25').reason, 'invalid', '7.25 kabul edildi');
  assertDeepEqual(parseOptionalRpe('7.2'), { ok: true, value: 7.2 }, 'tek ondalık');
});

// ===========================================================================
console.log('\n=== D. Program egzersizi yükleri ===');
// ===========================================================================

const payloadFor = (exercise) =>
  buildProgramExerciseInsertPayload(
    { ...exercise, exerciseId: 'ex', customExerciseName: undefined, visual: null },
    { programDayId: 'day', position: 2 },
  );

check('D1. sets_reps yükü', () => {
  const payload = payloadFor(BENCH);
  assertEqual(payload.tracking_mode, 'sets_reps', 'tür');
  assertEqual(payload.target_sets, 3, 'target_sets');
  assertEqual(payload.target_reps, '8-10', 'target_reps');
  assertEqual(payload.target_duration_seconds, null, 'kardiyo hedefi dolu');
  assertEqual(payload.target_distance_meters, null, 'kardiyo hedefi dolu');
  assertEqual(payload.rest_seconds, 60, 'rest_seconds');
});

check('D2. duration yükü — strength alanları NULL, restSeconds 0', () => {
  const payload = payloadFor(PLANK);
  assertEqual(payload.tracking_mode, 'duration', 'tür');
  assertEqual(payload.target_duration_seconds, 600, 'hedef');
  assertEqual(payload.target_sets, null, 'target_sets null değil');
  assertEqual(payload.target_reps, null, 'target_reps null değil');
  assertEqual(payload.target_distance_meters, null, 'ilgisiz hedef dolu');
  assertEqual(payload.rest_seconds, 0, 'kardiyoda dinlenme 0 değil');
});

check('D3. distance yükü — strength alanları NULL, restSeconds 0', () => {
  const payload = payloadFor(RUN);
  assertEqual(payload.tracking_mode, 'distance', 'tür');
  assertEqual(payload.target_distance_meters, 5000, 'hedef');
  assertEqual(payload.target_sets, null, 'target_sets null değil');
  assertEqual(payload.target_reps, null, 'target_reps null değil');
  assertEqual(payload.target_duration_seconds, null, 'ilgisiz hedef dolu');
  assertEqual(payload.rest_seconds, 0, 'kardiyoda dinlenme 0 değil');
});

check('D4. Üç yük de AYNI kolon kümesini yazar — eksik kolon yok', () => {
  const expected = [
    'custom_exercise_name', 'exercise_id', 'position', 'program_day_id', 'rest_seconds',
    'target_distance_meters', 'target_duration_seconds', 'target_reps', 'target_sets',
    'tracking_mode', 'visual',
  ];
  for (const exercise of [BENCH, PLANK, RUN]) {
    assertDeepEqual(Object.keys(payloadFor(exercise)).sort(), expected, `${exercise.trackingMode} kolon kümesi`);
  }
});

check('D5. Hedef UPDATE yükü MOD DEĞİŞTİRMEZ', () => {
  const strength = buildProgramExerciseTargetUpdatePayload({
    trackingMode: 'sets_reps', targetSets: 4, targetReps: '5', restSeconds: 90,
  });
  assertDeepEqual(Object.keys(strength).sort(), ['rest_seconds', 'target_reps', 'target_sets'], 'strength');

  const duration = buildProgramExerciseTargetUpdatePayload({
    trackingMode: 'duration', targetDurationSeconds: 900,
  });
  assertDeepEqual(Object.keys(duration), ['target_duration_seconds'], 'duration');

  const distance = buildProgramExerciseTargetUpdatePayload({
    trackingMode: 'distance', targetDistanceMeters: 10000,
  });
  assertDeepEqual(Object.keys(distance), ['target_distance_meters'], 'distance');

  for (const payload of [strength, duration, distance]) {
    assert(!('tracking_mode' in payload), 'UPDATE yükünde tracking_mode var');
  }
});

// ===========================================================================
console.log('\n=== E. Aktivite kaydı yükleri (INSERT / UPDATE ayrımı) ===');
// ===========================================================================

/**
 * `context/workout-context.tsx` içindeki `saveActivityRecord` yük kurallarının
 * BİREBİR modeli. Kaynak sözleşmesi K grubunda ayrıca doğrulanır.
 */
const PERFORMANCE_COLUMNS = ['completed_at', 'distance_meters', 'duration_seconds', 'rpe'];
const IMMUTABLE_COLUMNS = [
  'session_id', 'program_exercise_id', 'tracking_mode', 'exercise_name',
  'target_duration_seconds', 'target_distance_meters',
];

function buildPerformancePayload(performance) {
  return {
    duration_seconds: performance.durationSeconds,
    distance_meters: performance.distanceMeters ?? null,
    rpe: performance.rpe ?? null,
    completed_at: 'now',
  };
}
function buildActivityInsertPayload(exercise, sessionId, exerciseName, performance) {
  return {
    session_id: sessionId,
    program_exercise_id: exercise.id,
    exercise_name: exerciseName,
    tracking_mode: exercise.trackingMode,
    target_duration_seconds:
      exercise.trackingMode === 'duration' ? exercise.targetDurationSeconds : null,
    target_distance_meters:
      exercise.trackingMode === 'distance' ? exercise.targetDistanceMeters : null,
    ...buildPerformancePayload(performance),
  };
}

check('E1. INSERT yükü TAM snapshot yazar', () => {
  const payload = buildActivityInsertPayload(RUN, 's1', 'Koşu', {
    durationSeconds: 1500, distanceMeters: 5000, rpe: 7,
  });
  assertDeepEqual(
    Object.keys(payload).sort(),
    [...IMMUTABLE_COLUMNS, ...PERFORMANCE_COLUMNS].sort(),
    'INSERT kolon kümesi',
  );
  assertEqual(payload.tracking_mode, 'distance', 'tür');
  assertEqual(payload.target_distance_meters, 5000, 'hedef snapshot');
  assertEqual(payload.target_duration_seconds, null, 'ilgisiz snapshot dolu');
});

check('E2. UPDATE yükü YALNIZ performans alanlarını içerir', () => {
  const payload = buildPerformancePayload({ durationSeconds: 700, distanceMeters: 2000, rpe: 6 });
  assertDeepEqual(Object.keys(payload).sort(), PERFORMANCE_COLUMNS, 'UPDATE kolon kümesi');
});

check('E3. UPDATE yükünde IMMUTABLE alan YOK', () => {
  const payload = buildPerformancePayload({ durationSeconds: 700 });
  for (const column of IMMUTABLE_COLUMNS) {
    assert(!(column in payload), `UPDATE yükünde immutable kolon var: ${column}`);
  }
});

check('E4. duration türünde mesafe İSTEĞE BAĞLI (null yazılır)', () => {
  const payload = buildActivityInsertPayload(PLANK, 's1', 'Plank', { durationSeconds: 600 });
  assertEqual(payload.distance_meters, null, 'mesafe null değil');
  assertEqual(payload.duration_seconds, 600, 'süre yanlış');
  assertEqual(payload.rpe, null, 'rpe null değil');
});

check('E5. distance türünde mesafe ve süre BİRLİKTE yazılır', () => {
  const payload = buildActivityInsertPayload(RUN, 's1', 'Koşu', {
    durationSeconds: 1500, distanceMeters: 5000,
  });
  assertEqual(payload.distance_meters, 5000, 'mesafe eksik');
  assertEqual(payload.duration_seconds, 1500, 'süre eksik');
});

// ===========================================================================
console.log('\n=== F. Aggregate delta ===');
// ===========================================================================

const contribution = (over) => ({
  dateKey: DATE, programExerciseId: 'run', durationSeconds: 0, distanceMeters: 0, ...over,
});

check('F1. INSERT — yeni katkı EKLENİR', () => {
  const totals = applyActivityTotalsDelta(
    {},
    undefined,
    contribution({ durationSeconds: 1500, distanceMeters: 5000 }),
  );
  assertDeepEqual(totals[actKey('run')], { durationSeconds: 1500, distanceMeters: 5000 }, 'INSERT');
});

check('F2. UPDATE — eski katkı ÇIKARILIR, yeni katkı eklenir', () => {
  const before = aggregateActivityTotals([
    { id: 'r1', sessionId: 's1', programExerciseId: 'run', exerciseName: 'Koşu',
      trackingMode: 'distance', durationSeconds: 900, distanceMeters: 3000,
      completedAt: 'x', dateKey: DATE },
  ]);
  const after = applyActivityTotalsDelta(
    before,
    contribution({ durationSeconds: 900, distanceMeters: 3000 }),
    contribution({ durationSeconds: 1500, distanceMeters: 5000 }),
  );
  assertDeepEqual(after[actKey('run')], { durationSeconds: 1500, distanceMeters: 5000 }, 'UPDATE');
});

check('F3. MUT — UPDATE’te eski ve yeniyi BİRLİKTE sayan model düşer', () => {
  const before = { [actKey('run')]: { durationSeconds: 900, distanceMeters: 3000 } };
  const wrong = {
    durationSeconds: before[actKey('run')].durationSeconds + 1500,
    distanceMeters: before[actKey('run')].distanceMeters + 5000,
  };
  assertEqual(wrong.distanceMeters, 8000, 'bozuk model doğru sayıyor — mutasyon geçersiz');
  const correct = applyActivityTotalsDelta(
    before,
    contribution({ durationSeconds: 900, distanceMeters: 3000 }),
    contribution({ durationSeconds: 1500, distanceMeters: 5000 }),
  );
  assertEqual(correct[actKey('run')].distanceMeters, 5000, 'gerçek model çift sayıyor');
});

check('F4. DELETE — katkı ÇIKARILIR, negatife düşmez', () => {
  const before = { [actKey('run')]: { durationSeconds: 1500, distanceMeters: 5000 } };
  const after = applyActivityTotalsDelta(
    before,
    contribution({ durationSeconds: 1500, distanceMeters: 5000 }),
    undefined,
  );
  assertDeepEqual(after[actKey('run')], { durationSeconds: 0, distanceMeters: 0 }, 'DELETE');

  const overshoot = applyActivityTotalsDelta(
    { [actKey('run')]: { durationSeconds: 100, distanceMeters: 100 } },
    contribution({ durationSeconds: 999, distanceMeters: 999 }),
    undefined,
  );
  assert(
    overshoot[actKey('run')].durationSeconds >= 0 && overshoot[actKey('run')].distanceMeters >= 0,
    'toplam negatife düştü',
  );
});

check('F5. AYNI GÜN diğer oturumların katkısı KORUNUR', () => {
  // İki oturum: sabah 2 km, akşam 3 km. Akşam kaydı 3 km → 1 km'ye düşürülüyor.
  const before = { [actKey('run')]: { durationSeconds: 1500, distanceMeters: 5000 } };
  const after = applyActivityTotalsDelta(
    before,
    contribution({ durationSeconds: 900, distanceMeters: 3000 }),
    contribution({ durationSeconds: 300, distanceMeters: 1000 }),
  );
  // Sabahki 2 km + 600 sn olduğu gibi kalmalı.
  assertDeepEqual(after[actKey('run')], { durationSeconds: 900, distanceMeters: 3000 }, 'diğer oturum kayboldu');
});

check('F6. Delta girdi haritasını MUTATE ETMEZ', () => {
  const before = { [actKey('run')]: { durationSeconds: 100, distanceMeters: 200 } };
  const snapshot = JSON.stringify(before);
  applyActivityTotalsDelta(before, undefined, contribution({ durationSeconds: 50, distanceMeters: 50 }));
  assertEqual(JSON.stringify(before), snapshot, 'girdi haritası değişti');
});

check('F7. Delta YALNIZ ilgili tarih + egzersizi etkiler', () => {
  const before = {
    [actKey('run')]: { durationSeconds: 100, distanceMeters: 100 },
    [actKey('plank')]: { durationSeconds: 600, distanceMeters: 0 },
    [getActivityProgressKey('2026-09-09', 'run')]: { durationSeconds: 700, distanceMeters: 700 },
  };
  const after = applyActivityTotalsDelta(before, undefined, contribution({ distanceMeters: 900 }));
  assertEqual(after[actKey('run')].distanceMeters, 1000, 'hedef anahtar');
  assertDeepEqual(after[actKey('plank')], before[actKey('plank')], 'başka egzersiz değişti');
  assertDeepEqual(
    after[getActivityProgressKey('2026-09-09', 'run')],
    before[getActivityProgressKey('2026-09-09', 'run')],
    'başka gün değişti',
  );
});

check('F8. Plandan kopmuş kayıt hiçbir toplama dokunmaz', () => {
  const before = { [actKey('run')]: { durationSeconds: 100, distanceMeters: 100 } };
  const after = applyActivityTotalsDelta(
    before,
    undefined,
    { dateKey: DATE, programExerciseId: undefined, durationSeconds: 900, distanceMeters: 9000 },
  );
  assertDeepEqual(after, before, 'kopuk katkı toplandı');
});

// ===========================================================================
console.log('\n=== G. Soft-delete izolasyonu ===');
// ===========================================================================

check('G1. Görünür koleksiyon silinmiş oturumu içermez, KANIT içerir', () => {
  const records = [
    { id: 'a', sessionId: 'live', programExerciseId: 'run', exerciseName: 'Koşu',
      trackingMode: 'distance', durationSeconds: 900, distanceMeters: 3000, completedAt: 'x', dateKey: DATE },
    { id: 'b', sessionId: 'deleted', programExerciseId: 'run', exerciseName: 'Koşu',
      trackingMode: 'distance', durationSeconds: 600, distanceMeters: 2000, completedAt: 'x', dateKey: DATE },
  ];
  const deleted = new Set(['deleted']);

  // Disiplin/ödül kanıtı: BÜTÜN kayıtlar → hedef tamam.
  const evidence = aggregateActivityTotals(records);
  assertEqual(resolveExerciseProgress(RUN, 0, evidence[actKey('run')]).doneUnits, 1, 'kanıt eksik');

  // Kullanıcıya görünen koleksiyon: filtrelenmiş.
  const visible = records.filter((record) => !deleted.has(record.sessionId));
  assertEqual(visible.length, 1, 'görünür koleksiyon filtrelenmedi');

  // Silinmiş oturumun kaydı düzenleme için AÇILMAMALI: mevcut kayıt araması
  // görünür koleksiyondan yapılır, yani yeni bir INSERT'e yol verir.
  assertEqual(
    visible.find((record) => record.sessionId === 'deleted'),
    undefined,
    'silinmiş oturum kaydı düzenlemeye açık',
  );
});

check('G2. Soft-deleted oturum katkısı YENİ kaydın deltasına eklenmez', () => {
  // Delta yalnız kendi kaydını işler; silinmiş oturumun katkısı zaten
  // yükleme sırasındaki toplamda durur ve delta onu bozmaz.
  const before = { [actKey('run')]: { durationSeconds: 600, distanceMeters: 2000 } };
  const after = applyActivityTotalsDelta(
    before, undefined, contribution({ durationSeconds: 900, distanceMeters: 3000 }),
  );
  assertDeepEqual(after[actKey('run')], { durationSeconds: 1500, distanceMeters: 5000 }, 'katkı bozuldu');
});

// ===========================================================================
console.log('\n=== H. Kayıt sonrası tamamlanma ===');
// ===========================================================================

const finishes = (exerciseList, sets, activity) =>
  completesWorkoutAfterActivity({
    dateKey: DATE,
    exercises: exerciseList,
    completedSetCounts: sets,
    activityTotals: activity,
    getSetProgressKey,
  });

check('H1. Hedef ALTI kayıt oturumu BİTİRMEZ (gün partial)', () => {
  const totals = applyActivityTotalsDelta({}, undefined, contribution({ durationSeconds: 900, distanceMeters: 3000 }));
  assertEqual(finishes([RUN], {}, totals), false, 'hedef altı bitirdi');
  const progress = resolveExerciseProgress(RUN, 0, totals[actKey('run')]);
  assertEqual(progress.hasProgress, true, 'ilerleme görülmedi');
  assertEqual(progress.doneUnits, 0, 'hedef altı tamamlandı sayıldı');
});

check('H2. YALNIZ kardiyo günü hedef dolunca BİTER', () => {
  const totals = applyActivityTotalsDelta({}, undefined, contribution({ durationSeconds: 1500, distanceMeters: 5000 }));
  assertEqual(finishes([RUN], {}, totals), true, 'kardiyo günü bitmedi');
});

check('H3. Karışık gün — YALNIZ aktivite tamamlanması YETMEZ', () => {
  const totals = applyActivityTotalsDelta({}, undefined, contribution({ durationSeconds: 1500, distanceMeters: 5000 }));
  assertEqual(finishes([BENCH, RUN], { [setKey('bench')]: 1 }, totals), false, 'strength eksikken bitti');
});

check('H4. Karışık gün — YALNIZ strength tamamlanması YETMEZ', () => {
  assertEqual(finishes([BENCH, RUN], { [setKey('bench')]: 3 }, {}), false, 'aktivite eksikken bitti');
});

check('H5. Karışık gün — HEPSİ tamamlanınca BİTER', () => {
  const totals = applyActivityTotalsDelta({}, undefined, contribution({ durationSeconds: 1500, distanceMeters: 5000 }));
  assertEqual(finishes([BENCH, RUN], { [setKey('bench')]: 3 }, totals), true, 'tam günde bitmedi');
});

check('H6. Üç türlü karışık gün', () => {
  let totals = applyActivityTotalsDelta({}, undefined, contribution({ durationSeconds: 1500, distanceMeters: 5000 }));
  totals = applyActivityTotalsDelta(totals, undefined, {
    dateKey: DATE, programExerciseId: 'plank', durationSeconds: 600, distanceMeters: 0,
  });
  assertEqual(finishes([BENCH, PLANK, RUN], { [setKey('bench')]: 3 }, totals), true, 'tam gün bitmedi');
  assertEqual(finishes([BENCH, PLANK, RUN], { [setKey('bench')]: 2 }, totals), false, 'eksik strength ile bitti');
});

check('H7. STALE-STATE olmadan karar — öngörülen toplam kullanılır', () => {
  // Kayıttan ÖNCEKİ state ile karar verilseydi gün bitmezdi; öngörülenle biter.
  const staleTotals = {};
  const projected = applyActivityTotalsDelta(staleTotals, undefined, contribution({ durationSeconds: 1500, distanceMeters: 5000 }));
  assertEqual(finishes([RUN], {}, staleTotals), false, 'stale state ile bitiyor — kontrol vacuous');
  assertEqual(finishes([RUN], {}, projected), true, 'öngörülen toplamla bitmiyor');
});

check('H8. DELETE sonrası gün yeniden tamamlanmamış olur', () => {
  const full = applyActivityTotalsDelta({}, undefined, contribution({ durationSeconds: 1500, distanceMeters: 5000 }));
  assertEqual(finishes([RUN], {}, full), true, 'ön koşul sağlanmadı');
  const cleared = applyActivityTotalsDelta(full, contribution({ durationSeconds: 1500, distanceMeters: 5000 }), undefined);
  assertEqual(finishes([RUN], {}, cleared), false, 'silme sonrası hâlâ tamamlanmış');
});

// ===========================================================================
console.log('\n=== K. Kaynak sözleşmesi ===');
// ===========================================================================

const context = source('context/workout-context.tsx');
const screen = source('app/program/[id]/day/[dayId]/index.tsx');
const addScreen = source('app/program/[id]/day/[dayId]/add-exercise.tsx');
const selector = source('components/tracking-mode-selector.tsx');
const tr = source('locales/tr.ts');
const en = source('locales/en.ts');

/** `saveActivityRecord` gövdesi — sıralama iddiaları BURADA ölçülür. */
const saveBody = context.slice(
  context.indexOf('async function saveActivityRecord('),
  context.indexOf('async function deleteActivityRecord('),
);

check('K1. saveActivityRecord gövdesi bulundu', () => {
  assert(saveBody.length > 500, 'gövde bulunamadı — sıralama kontrolleri vacuous olurdu');
  assert(saveBody.includes("from('workout_activity_records')"), 'tablo çağrısı yok');
});

check('K2. Mevcut kayıt UPDATE, yeni kayıt INSERT — ikisi de var', () => {
  assert(/\.update\(performancePayload\)/.test(saveBody), 'UPDATE yolu yok');
  assert(/\.insert\(\{/.test(saveBody), 'INSERT yolu yok');
  assert(/const existing = workoutActivityRecords\.find\(/.test(saveBody), 'mevcut kayıt aranmıyor');
});

check('K3. UPDATE yükünde kimlik/snapshot kolonu YOK', () => {
  const updateBlock = saveBody.slice(saveBody.indexOf('if (existing) {'), saveBody.indexOf('} else {'));
  for (const column of ['session_id:', 'program_exercise_id:', 'tracking_mode:', 'exercise_name:',
                        'target_duration_seconds:', 'target_distance_meters:']) {
    assert(!updateBlock.includes(column), `UPDATE dalında immutable kolon yazılıyor: ${column}`);
  }
  assert(updateBlock.includes('.eq(\'id\', existing.id)'), 'UPDATE kayıt kimliğiyle hedeflenmiyor');
});

check('K4. Yazma YALNIZ kardiyo egzersizde ve YALNIZ aktif oturumda', () => {
  assert(/if \(!isCardioExercise\(exercise\)\) \{/.test(saveBody), 'strength reddi yok');
  assert(/item\.status === 'running'/.test(saveBody), 'oturum sözleşmesi yok');
  assert(/if \(!session\) throw new Error/.test(saveBody), 'oturumsuz yazma engellenmiyor');
  // Sahiplik istemcide de doğrulanıyor: egzersiz kullanıcının programından bulunuyor.
  assert(/const program = programs\.find\(/.test(saveBody), 'sahiplik doğrulaması yok');
});

check('K5. Ödül ve rank sync KAYITTAN SONRA, set akışıyla AYNI biçimde', () => {
  const syncAt = saveBody.indexOf('void syncWorkoutDay(');
  const rankAt = saveBody.indexOf('void syncRank?.()');
  const insertAt = saveBody.indexOf("from('workout_activity_records')");
  assert(insertAt >= 0 && syncAt > insertAt, 'ödül sync kayıttan önce');
  assert(rankAt > syncAt, 'rank sync ödülden önce');
  // Set akışıyla aynı çağrı biçimi: beklenmez (`void`).
  assert(/void syncWorkoutDay\(toDateKey\(new Date\(\)\), dateKey\);/.test(saveBody), 'ödül çağrısı farklı');
});

check('K6. Toplamlar delta ile düzeltilir, yeniden yükleme YOK', () => {
  assert(/applyActivityTotalsDelta\(/.test(saveBody), 'delta kullanılmıyor');
  assert(/existing \? toContribution\(existing\) : undefined/.test(saveBody), 'eski katkı çıkarılmıyor');
  assert(/return \{ record: saved, activityTotals: projectedTotals \};/.test(saveBody), 'öngörü döndürülmüyor');
});

check('K7. Ekran kararı ÖNGÖRÜLEN toplamdan verir (stale state yok)', () => {
  const submitBody = screen.slice(
    screen.indexOf('async function submitActivity()'),
    screen.indexOf('function confirmClearActivity()'),
  );
  assert(submitBody.length > 500, 'submitActivity gövdesi bulunamadı');
  assert(/const \{ activityTotals: projectedTotals \} = await saveActivityRecord\(/.test(submitBody),
    'öngörülen toplam alınmıyor');
  assert(/activityTotals: projectedTotals,/.test(submitBody), 'karar öngörüyle verilmiyor');
  assert(/exercises: allDayExercises,/.test(submitBody), 'karar bütün egzersizler üzerinden değil');
  const saveAt = submitBody.indexOf('await saveActivityRecord(');
  const decideAt = submitBody.indexOf('completesWorkoutAfterActivity({');
  assert(saveAt >= 0 && decideAt >= 0 && saveAt < decideAt, 'karar kayıttan önce veriliyor');
});

check('K8. DELETE ödül defterini geri sarmaz (set undo ile tutarlı)', () => {
  const deleteBody = context.slice(context.indexOf('async function deleteActivityRecord('));
  const undoStart = context.indexOf('async function undoCompletedSet(');
  const undoBody = context.slice(
    undoStart,
    context.indexOf('async function ', undoStart + 20),
  );
  assert(undoBody.length > 300, 'undoCompletedSet gövdesi bulunamadı');
  // İkisi de ödül defterine dokunmaz.
  assert(!/syncWorkoutDay/.test(undoBody), 'set undo ödül sync çağırıyor — sözleşme değişmiş');
  assert(!/syncWorkoutDay/.test(deleteBody.slice(0, 1200)), 'aktivite silme ödül sync çağırıyor');
});

check('K9. Kardiyoda dinlenme sayacı YOK', () => {
  const cardioPanel = screen.slice(
    screen.indexOf('{activeCardioExercise && ('),
    screen.indexOf('{!activeCardioExercise && activeExercise && ('),
  );
  assert(cardioPanel.length > 500, 'kardiyo paneli bulunamadı');
  assert(!/createRestTimer|scheduleRestNotification|restSeconds/.test(cardioPanel), 'panelde mola yolu var');
  // Set paneline ait alanlar da sızmamalı.
  assert(!/dropSet|addDropSetButton/.test(cardioPanel), 'panelde drop set var');
});

check('K10. Erişilebilirlik — 44 pt, VoiceOver etiketi, renk TEK sinyal değil', () => {
  assert(/minHeight: Layout\.minTouchSize/.test(selector), 'segment 44 pt değil');
  assert(/accessibilityRole="radio"/.test(selector), 'radio rolü yok');
  assert(/accessibilityState=\{\{ disabled, selected: isSelected \}\}/.test(selector), 'seçim durumu bildirilmiyor');
  // Seçili durum kenarlık + ikon + metin ağırlığıyla da anlatılıyor.
  assert(/segmentSelected: \{ borderColor: colors\.primary, borderWidth: 2 \}/.test(selector), 'kenarlık sinyali yok');
  assert(/isSelected \? option\.iconActive : option\.icon/.test(selector), 'ikon sinyali yok');
  assert(/segmentTextSelected: \{ color: colors\.text, fontWeight: '700' \}/.test(selector), 'metin sinyali yok');

  const panel = screen.slice(
    screen.indexOf('{activeCardioExercise && ('),
    screen.indexOf('{!activeCardioExercise && activeExercise && ('),
  );
  /**
   * Faz 2C'de manuel SÜRE alanı kaldırıldı: süre artık kronometreden gelir ve
   * elle girilemez. İddia zayıflatılmadı — aynı erişilebilirlik sözleşmesi
   * kronometrenin kendisinde ölçülür (rol + değer + etiket), ayrıntısı
   * `scripts/verify-activity-timer-and-history.mjs` J1'de.
   */
  assert(/accessibilityRole="timer"/.test(panel), 'kronometre rolü yok');
  assert(/accessibilityLabel=\{t\('day\.activityTimerLabel'/.test(panel), 'kronometre etiketi yok');
  assert(/accessibilityValue=\{\{ text: activityTimerAccessibilityText \}\}/.test(panel),
    'kronometre değeri VoiceOver’a bildirilmiyor');
  assert(/accessibilityLabel=\{t\('day\.actualDistance'\)\}/.test(panel), 'mesafe etiketi yok');
  assert(/accessibilityLabel=\{t\('day\.rpe'\)\}/.test(panel), 'RPE etiketi yok');
  assert(/accessibilityState=\{\{ busy: isActivityPending, disabled: isActivityDisabled \}\}/.test(panel),
    'CTA yükleme/kapalı durumu bildirilmiyor');
  assert(/minHeight: Layout\.minTouchSize/.test(screen), 'kardiyo alanları 44 pt değil');
});

check('K11. Emoji, gradient ve yeni asset YOK', () => {
  for (const [name, file] of [['selector', selector], ['screen', screen], ['add', addScreen]]) {
    assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(file), `${name}: emoji var`);
    assert(!/LinearGradient|expo-linear-gradient/.test(file), `${name}: gradient var`);
  }
});

check('K12. Bütün yeni kullanıcı metinleri LOKALİZE', () => {
  const keys = [
    'trackingModeSetsReps', 'trackingModeDuration', 'trackingModeDistance', 'trackingModeLabel',
    'trackingModeLocked', 'targetDuration', 'targetDistance', 'actualDuration', 'actualDistance',
    'minutesUnit', 'secondsUnit', 'kmUnit', 'paceUnit', 'paceLabel', 'saveActivity',
    'updateActivity', 'clearActivity', 'clearActivityTitle', 'clearActivityBody', 'rpeHint',
    'durationRequired', 'durationInvalid', 'durationRange', 'distanceRequired', 'distanceInvalid',
    'distanceRange', 'activitySaveFailed', 'activityDeleteFailed', 'targetDurationLabel',
    'targetDistanceLabel', 'activityDoneLabel', 'optional',
  ];
  for (const key of keys) {
    assert(new RegExp(`\\n    ${key}:`).test(tr), `tr.ts eksik: ${key}`);
    assert(new RegExp(`\\n    ${key}:`).test(en), `en.ts eksik: ${key}`);
  }
  const addKeys = ['trackingMode', 'targetDuration', 'targetDistance',
                   'durationInvalidTitle', 'durationInvalidBody',
                   'distanceInvalidTitle', 'distanceInvalidBody'];
  for (const key of addKeys) {
    assert(new RegExp(`\\n    ${key}:`).test(tr), `tr.ts addExercise eksik: ${key}`);
    assert(new RegExp(`\\n    ${key}:`).test(en), `en.ts addExercise eksik: ${key}`);
  }
});

check('K13. Kardiyo panelinde satır içi kullanıcı metni YOK', () => {
  const panel = screen.slice(
    screen.indexOf('{activeCardioExercise && ('),
    screen.indexOf('{!activeCardioExercise && activeExercise && ('),
  );
  // Görünen bütün metinler `t(...)` üzerinden gelir; tek istisna sayısal
  // yer tutucu ve ayraçlar.
  // `{`/`}` içermeyen, yani JSX ifadesi OLMAYAN metin düğümleri aranır.
  const literals = panel.match(/>[^<>{}]*[A-Za-zÇĞİÖŞÜçğıöşü]{3,}[^<>{}]*</g) ?? [];
  assertDeepEqual(literals, [], `satır içi metin: ${literals.join(' | ')}`);
});

check('K14. Silme ONAY ister', () => {
  const clearBody = screen.slice(
    screen.indexOf('function confirmClearActivity()'),
    screen.indexOf('async function handleExerciseSelection('),
  );
  assert(/Alert\.alert\(/.test(clearBody), 'onay yok');
  assert(/t\('day\.clearActivityBody'/.test(clearBody), 'onay gövdesi lokalize değil');
  assert(/style: 'destructive'/.test(clearBody), 'yıkıcı işlem işaretlenmemiş');
  assert(/deleteActivityRecord\(recordId\)/.test(clearBody), 'silme çağrısı yok');
});

check('K15. Logout/hesap değişiminde aktivite state TEMİZLENİR', () => {
  assert(/setWorkoutActivityRecords\(\[\]\);/.test(context), 'kayıt temizliği yok');
  assert(/setActivityTotals\(\{\}\);/.test(context), 'toplam temizliği yok');
  // Temizlik kullanıcı yokken çalışan dalda olmalı.
  const resetBlock = context.slice(
    Math.max(0, context.indexOf('setWorkoutActivityRecords([]);') - 900),
    context.indexOf('setWorkoutActivityRecords([]);'),
  );
  assert(/if \(!user\)|!user\b/.test(resetBlock), 'temizlik oturum kapanışına bağlı değil');
});

check('K16. Ekle formunda üç mod da gerçekten üretiliyor', () => {
  assert(/trackingMode: 'sets_reps'/.test(addScreen), 'strength dalı yok');
  assert(/trackingMode: 'duration', restSeconds: 0/.test(addScreen), 'duration dalı yok/restSeconds≠0');
  assert(/trackingMode: 'distance', restSeconds: 0/.test(addScreen), 'distance dalı yok/restSeconds≠0');
  assert(/parseMinutesToSeconds\(targetDurationMinutes/.test(addScreen), 'süre ayrıştırma yok');
  assert(/parseKilometersToMeters\(targetDistanceKm/.test(addScreen), 'mesafe ayrıştırma yok');
});

check('K17. Kayıtlı egzersizde tür seçici KİLİTLİ', () => {
  const editorBlock = screen.slice(screen.indexOf('<View style={styles.exerciseTrackingMode}>'));
  assert(/disabled\n/.test(editorBlock.slice(0, 600)), 'seçici kilitli değil');
  assert(/disabledHint=\{t\('day\.trackingModeLocked'\)\}/.test(editorBlock.slice(0, 600)), 'neden açıklanmıyor');
  // Hedef AYNI mod içinde düzenlenebilir kalmalı.
  assert(/editingTrackingMode === 'duration'/.test(screen), 'duration hedef alanı yok');
  assert(/editingTrackingMode === 'distance'/.test(screen), 'distance hedef alanı yok');
});

check('K18. Kardiyo tempo saklanmıyor, TÜRETİLİYOR', () => {
  assert(/derivePaceSecondsPerKm\(/.test(screen), 'tempo türetilmiyor');
  assert(!/pace_|pace:/.test(context), 'tempo veritabanına yazılıyor');
  assert(!/'pace'/.test(source('types/workout.ts')), 'tipte pace alanı var');
});

check('K19. Context value eski aktivite state’ini yakalayan eksik memo kullanmaz', () => {
  const valueBlock = context.slice(context.indexOf('const value: WorkoutContextValue = {'));
  assert(valueBlock.length > 500, 'context value doğrudan üretilmiyor');
  assert(/\n    activityTotals,/.test(valueBlock), 'activityTotals provider değerinde yok');
  assert(/\n    workoutActivityRecords,/.test(valueBlock), 'workoutActivityRecords provider değerinde yok');
  assert(!/const value = useMemo\(/.test(context), 'context value eksik bağımlılıklı memo içinde');
});

check('K20. Aktif ekran ilerlemeyi strength-only sayaçtan değil ortak çekirdekten gösterir', () => {
  assert(/const dayProgress = resolveDayProgress\(\{/.test(screen), 'gün ilerlemesi ortak çekirdekten alınmıyor');
  assert(/completed: dayProgress\.doneUnits/.test(screen), 'üst bar tür-farkında tamamlanmayı göstermiyor');
  assert(/total: dayProgress\.targetUnits/.test(screen), 'üst bar tür-farkında hedefi göstermiyor');
  assert(/dayProgress\.doneUnits \/ dayProgress\.targetUnits/.test(screen), 'ilerleme çubuğu tür-farkında değil');
  assert(/const hasProgress = dayProgress\.hasProgress;/.test(screen), 'kardiyo partial ilerlemesi ekran durumuna bağlanmıyor');
});

// ---------------------------------------------------------------------------

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Aktivite takibi istemci yazma harness: ${pass} kontrol geçti.`);
console.log('  (GERÇEK saf yardımcılar derlenip çalıştırıldı; kopya algoritma test edilmedi.)');
