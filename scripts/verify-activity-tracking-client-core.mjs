/**
 * Faz 2A — istemci tarafı tür-farkında tamamlama çekirdeği harness'ı.
 *
 * SINIR: React render edilmez, Supabase'e bağlanılmaz. GERÇEK saf yardımcılar
 * `tsc` ile derlenip çalıştırılır — kopya bir algoritma test EDİLMEZ.
 *
 * Üç katman:
 *   A. GERÇEK MODÜL — `utils/workout-tracking.ts` ve `utils/program-exercise.ts`
 *      derlenir ve dışa verdikleri fonksiyonlar doğrudan çağrılır.
 *   B. SENARYO — strength / duration / distance / karma gün, gün içi toplama,
 *      soft-delete sınırı ve eski davranışla eşdeğerlik.
 *   C. MUTASYON — yanlış modeller aynı iddialara sokulur ve GERÇEKTEN
 *      düştükleri kanıtlanır.
 *
 * Çalıştırma:  node scripts/verify-activity-tracking-client-core.mjs
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
// A · GERÇEK modülleri derle ve içe aktar
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'rosea-client-core-'));
let tracking;
let parser;

try {
  /**
   * `@/types/workout` yol takma adı Node tarafından çözülemez ve o modül
   * yalnızca TİP dışa verir (`isStrengthExercise` hariç). Derlemede tip
   * importları silineceği için takma ad küçük bir gölge dosyayla karşılanır;
   * TEST EDİLEN MANTIK gerçek kaynaktan gelir.
   */
  const shim = join(outDir, 'types-workout-shim.ts');
  writeFileSync(
    shim,
    'export type ProgramExercise = any;\n' +
      'export type WorkoutActivityRecord = any;\n' +
      'export type WorkoutVisual = any;\n' +
      'export type StrengthProgramExercise = any;\n' +
      'export type DurationProgramExercise = any;\n' +
      'export type DistanceProgramExercise = any;\n' +
      'export type WorkoutTrackingMode = any;\n' +
      'export type WorkoutSetRecord = any;\n' +
      'export type NewProgramExercise = any;\n',
  );

  for (const [relative, outName] of [
    // `workout-tracking` katkı kuralını `workout-sets`ten alır; ikisi de GERÇEK
    // kaynaktan derlenir, kopyalanmaz.
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

  tracking = await import(pathToFileURL(join(outDir, 'workout-tracking.js')).href);
  parser = await import(pathToFileURL(join(outDir, 'program-exercise.js')).href);
} catch (error) {
  console.error('Saf yardımcılar derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}

const {
  aggregateActivityTotals,
  completesWorkoutAfterSet,
  resolveProjectedSetProgress,
  exerciseTargetUnits,
  getActivityProgressKey,
  resolveDayProgress,
  resolveExerciseProgress,
  derivePaceSecondsPerKm,
} = tracking;
const { parseProgramExerciseRow, ProgramExerciseContractError } = parser;

const getSetProgressKey = (dateKey, id) => `${dateKey}:${id}`;
const passVisual = () => undefined;

const BENCH = { id: 'bench', trackingMode: 'sets_reps', targetSets: 3, targetReps: '8-10', restSeconds: 60 };
const PLANK = { id: 'plank', trackingMode: 'duration', targetDurationSeconds: 600, restSeconds: 0 };
const RUN = { id: 'run', trackingMode: 'distance', targetDistanceMeters: 5000, restSeconds: 0 };

const record = (over) => ({
  id: 'r', sessionId: 's', programExerciseId: 'run', exerciseName: 'Run',
  trackingMode: 'distance', durationSeconds: 0, dateKey: '2026-09-10', completedAt: 'x', ...over,
});

// ===========================================================================
console.log('=== A. Hedef birimi ===');
// ===========================================================================

check('A1. Strength hedef birimi targetSets', () => {
  assertEqual(exerciseTargetUnits(BENCH), 3, 'strength hedef birimi yanlış');
});
check('A2. Kardiyo hedef birimi 1 — sahte targetSets YOK', () => {
  assertEqual(exerciseTargetUnits(PLANK), 1, 'duration hedef birimi 1 değil');
  assertEqual(exerciseTargetUnits(RUN), 1, 'distance hedef birimi 1 değil');
  assert(PLANK.targetSets === undefined && RUN.targetSets === undefined, 'kardiyoda targetSets var');
});

// ===========================================================================
console.log('\n=== B. Strength ilerlemesi ===');
// ===========================================================================

const strengthAt = (sets) => resolveExerciseProgress(BENCH, sets, undefined);

check('B1. 0/3 — ilerleme yok', () => {
  assertDeepEqual(strengthAt(0), { targetUnits: 3, doneUnits: 0, hasProgress: false }, '0/3');
});
check('B2. 1/3 — kısmi ilerleme', () => {
  assertDeepEqual(strengthAt(1), { targetUnits: 3, doneUnits: 1, hasProgress: true }, '1/3');
});
check('B3. 3/3 — tam', () => {
  assertDeepEqual(strengthAt(3), { targetUnits: 3, doneUnits: 3, hasProgress: true }, '3/3');
});
check('B4. 4/3 — ekstra set hedefe CLAMP edilir', () => {
  assertDeepEqual(strengthAt(4), { targetUnits: 3, doneUnits: 3, hasProgress: true }, '4/3');
});
check('B5. Negatif sayaç güvenli', () => {
  assertDeepEqual(strengthAt(-2), { targetUnits: 3, doneUnits: 0, hasProgress: false }, 'negatif');
});

// ===========================================================================
console.log('\n=== C. Duration ilerlemesi ===');
// ===========================================================================

const durationAt = (durationSeconds, distanceMeters = 0) =>
  resolveExerciseProgress(PLANK, 0, { durationSeconds, distanceMeters });

check('C1. Kayıt yok — ilerleme yok', () => {
  assertDeepEqual(durationAt(0), { targetUnits: 1, doneUnits: 0, hasProgress: false }, 'sıfır');
});
check('C2. Hedef altı — ilerleme VAR, tamamlanma YOK', () => {
  assertDeepEqual(durationAt(300), { targetUnits: 1, doneUnits: 0, hasProgress: true }, 'hedef altı');
});
check('C3. Hedefe eşit — tamam', () => {
  assertDeepEqual(durationAt(600), { targetUnits: 1, doneUnits: 1, hasProgress: true }, 'eşit');
});
check('C4. Hedef üstü — yalnız BİR birim', () => {
  assertDeepEqual(durationAt(5000), { targetUnits: 1, doneUnits: 1, hasProgress: true }, 'üstü');
});
check('C5. Duration’da mesafe tamamlanmayı ETKİLEMEZ', () => {
  assertEqual(durationAt(300, 999999).doneUnits, 0, 'mesafe duration’ı tamamladı');
  assertEqual(durationAt(600, 0).doneUnits, 1, 'mesafesiz duration tamamlanmıyor');
  // Ama mesafe de gerçek bir ilerleme kanıtıdır.
  assertEqual(durationAt(0, 1200).hasProgress, true, 'yalnız mesafe ilerleme sayılmıyor');
});

// ===========================================================================
console.log('\n=== D. Distance ilerlemesi ===');
// ===========================================================================

const distanceAt = (distanceMeters, durationSeconds = 0) =>
  resolveExerciseProgress(RUN, 0, { durationSeconds, distanceMeters });

check('D1. Kayıt yok — ilerleme yok', () => {
  assertDeepEqual(distanceAt(0), { targetUnits: 1, doneUnits: 0, hasProgress: false }, 'sıfır');
});
check('D2. Hedef altı — ilerleme VAR', () => {
  assertDeepEqual(distanceAt(3000), { targetUnits: 1, doneUnits: 0, hasProgress: true }, 'hedef altı');
});
check('D3. Hedefe eşit — tamam', () => {
  assertEqual(distanceAt(5000).doneUnits, 1, 'eşit tamamlamıyor');
});
check('D4. Hedef üstü — yalnız BİR birim', () => {
  assertEqual(distanceAt(12000).doneUnits, 1, 'üstü birden fazla birim verdi');
});
check('D5. Distance’ta süre tamamlanma ÖLÇÜTÜ değildir', () => {
  assertEqual(distanceAt(0, 99999).doneUnits, 0, 'süre distance’ı tamamladı');
  assertEqual(distanceAt(5000, 0).doneUnits, 1, 'süresiz distance tamamlanmıyor');
});

// ===========================================================================
console.log('\n=== E. Gün içi toplama ve izolasyon ===');
// ===========================================================================

check('E1. Aynı gün İKİ oturumun aktivitesi TOPLANIR', () => {
  const totals = aggregateActivityTotals([
    record({ id: 'a', sessionId: 's1', distanceMeters: 2000, durationSeconds: 600 }),
    record({ id: 'b', sessionId: 's2', distanceMeters: 3000, durationSeconds: 900 }),
  ]);
  const key = getActivityProgressKey('2026-09-10', 'run');
  assertDeepEqual(totals[key], { durationSeconds: 1500, distanceMeters: 5000 }, 'toplama yanlış');
  assertEqual(resolveExerciseProgress(RUN, 0, totals[key]).doneUnits, 1, '2000+3000 tamamlamadı');
});

check('E2. Başka TARİH karışmaz', () => {
  const totals = aggregateActivityTotals([
    record({ id: 'a', distanceMeters: 4000, dateKey: '2026-09-10' }),
    record({ id: 'b', distanceMeters: 4000, dateKey: '2026-09-11' }),
  ]);
  assertEqual(totals[getActivityProgressKey('2026-09-10', 'run')].distanceMeters, 4000, 'tarih karıştı');
  assertEqual(resolveExerciseProgress(RUN, 0, totals[getActivityProgressKey('2026-09-10', 'run')]).doneUnits, 0, 'tarih toplandı');
});

check('E3. Başka EGZERSİZ karışmaz', () => {
  const totals = aggregateActivityTotals([
    record({ id: 'a', programExerciseId: 'run', distanceMeters: 3000 }),
    record({ id: 'b', programExerciseId: 'bike', distanceMeters: 3000 }),
  ]);
  assertEqual(totals[getActivityProgressKey('2026-09-10', 'run')].distanceMeters, 3000, 'egzersiz karıştı');
});

check('E4. Plandan kopmuş (programExerciseId yok) kayıt hiçbir hedefe katkı vermez', () => {
  const totals = aggregateActivityTotals([record({ id: 'a', programExerciseId: undefined, distanceMeters: 9000 })]);
  assertDeepEqual(totals, {}, 'kopuk kayıt toplandı');
});

// ===========================================================================
console.log('\n=== F. Gün durumu (disiplin) ===');
// ===========================================================================

/** `getScheduledDisciplineStatus`'un karar ağacının birebir modeli. */
function dayStatus({ exercises, sets = {}, activity = {}, isToday }) {
  const progress = resolveDayProgress({
    dateKey: '2026-09-10',
    exercises,
    completedSetCounts: sets,
    activityTotals: activity,
    getSetProgressKey,
  });
  if (progress.targetUnits === 0) return isToday ? undefined : 'skipped';
  if (progress.doneUnits >= progress.targetUnits) return 'completed';
  if (progress.hasProgress) return 'partial';
  return isToday ? undefined : 'skipped';
}

const setKey = (id) => getSetProgressKey('2026-09-10', id);
const actKey = (id) => getActivityProgressKey('2026-09-10', id);

check('F1. Bugün sıfır ilerleme — NÖTR', () => {
  assertEqual(dayStatus({ exercises: [BENCH, RUN], isToday: true }), undefined, 'bugün skipped');
});
check('F2. Geçmiş gün sıfır ilerleme — SKIPPED', () => {
  assertEqual(dayStatus({ exercises: [BENCH, RUN], isToday: false }), 'skipped', 'geçmiş nötr');
});
check('F3. Karma gün: strength tam, activity eksik → partial', () => {
  assertEqual(
    dayStatus({ exercises: [BENCH, RUN], sets: { [setKey('bench')]: 3 }, isToday: true }),
    'partial', 'karma gün yanlış',
  );
});
check('F4. Karma gün: activity tam, strength eksik → partial', () => {
  assertEqual(
    dayStatus({
      exercises: [BENCH, RUN],
      activity: { [actKey('run')]: { durationSeconds: 1500, distanceMeters: 5000 } },
      isToday: true,
    }),
    'partial', 'karma gün yanlış',
  );
});
check('F5. Hedef ALTI pozitif activity tek başına partial üretir', () => {
  assertEqual(
    dayStatus({
      exercises: [RUN],
      activity: { [actKey('run')]: { durationSeconds: 900, distanceMeters: 3000 } },
      isToday: true,
    }),
    'partial', 'hedef altı partial değil',
  );
});
check('F6. Üç türlü karma gün: hepsi tam → completed', () => {
  assertEqual(
    dayStatus({
      exercises: [BENCH, PLANK, RUN],
      sets: { [setKey('bench')]: 3 },
      activity: {
        [actKey('plank')]: { durationSeconds: 600, distanceMeters: 0 },
        [actKey('run')]: { durationSeconds: 1500, distanceMeters: 5000 },
      },
      isToday: true,
    }),
    'completed', 'karma gün tamamlanmadı',
  );
});
check('F7. Üç türlü karma gün: biri eksikse partial', () => {
  assertEqual(
    dayStatus({
      exercises: [BENCH, PLANK, RUN],
      sets: { [setKey('bench')]: 3 },
      activity: { [actKey('plank')]: { durationSeconds: 600, distanceMeters: 0 } },
      isToday: true,
    }),
    'partial', 'eksik hedefle completed oldu',
  );
});
check('F8. Hedef birimi olmayan gün: bugün nötr, geçmiş skipped', () => {
  assertEqual(dayStatus({ exercises: [], isToday: true }), undefined, 'boş gün bugün');
  assertEqual(dayStatus({ exercises: [], isToday: false }), 'skipped', 'boş gün geçmiş');
});

// ===========================================================================
console.log('\n=== G. Strength-only ESKİ davranışla eşdeğerlik ===');
// ===========================================================================

/** Faz 2A ÖNCESİ algoritma — yalnızca set sayar. */
function legacyStrengthStatus(exercises, sets, isToday) {
  const totalTarget = exercises.reduce((t, e) => t + e.targetSets, 0);
  if (totalTarget === 0) return isToday ? undefined : 'skipped';
  const totalDone = exercises.reduce((t, e) => t + Math.min(sets[setKey(e.id)] ?? 0, e.targetSets), 0);
  if (totalDone === totalTarget) return 'completed';
  if (totalDone > 0) return 'partial';
  return isToday ? undefined : 'skipped';
}

check('G1. Strength-only: yeni ve eski algoritma BİREBİR aynı', () => {
  const squat = { id: 'squat', trackingMode: 'sets_reps', targetSets: 4, targetReps: '5', restSeconds: 90 };
  const exercises = [BENCH, squat];
  for (const b of [0, 1, 2, 3, 5]) {
    for (const s of [0, 1, 4, 7]) {
      for (const isToday of [true, false]) {
        const sets = { [setKey('bench')]: b, [setKey('squat')]: s };
        assertEqual(
          dayStatus({ exercises, sets, isToday }),
          legacyStrengthStatus(exercises, sets, isToday),
          `eşdeğerlik bozuldu (bench=${b}, squat=${s}, bugün=${isToday})`,
        );
      }
    }
  }
});

check('G2. Strength’te hasProgress ile doneUnits>0 EŞDEĞER', () => {
  for (const sets of [0, 1, 2, 3, 9]) {
    const p = strengthAt(sets);
    assertEqual(p.hasProgress, p.doneUnits > 0, `set=${sets} eşdeğerlik bozuldu`);
  }
});

// ===========================================================================
console.log('\n=== H. Soft-delete sınırı ===');
// ===========================================================================

check('H1. Disiplin kanıtı silinmiş oturumu İÇERİR, görünür koleksiyon İÇERMEZ', () => {
  const all = [
    record({ id: 'a', sessionId: 'live', distanceMeters: 3000, durationSeconds: 900 }),
    record({ id: 'b', sessionId: 'deleted', distanceMeters: 2000, durationSeconds: 600 }),
  ];
  const deleted = new Set(['deleted']);

  // Disiplin kanıtı: BÜTÜN kayıtlar
  const evidenceTotals = aggregateActivityTotals(all);
  assertEqual(evidenceTotals[actKey('run')].distanceMeters, 5000, 'kanıt silinmiş oturumu atladı');
  assertEqual(resolveExerciseProgress(RUN, 0, evidenceTotals[actKey('run')]).doneUnits, 1, 'takvim değişti');

  // Görünür koleksiyon: filtrelenmiş
  const visible = all.filter((r) => !deleted.has(r.sessionId));
  assertEqual(visible.length, 1, 'görünür koleksiyon filtrelenmedi');
  assertEqual(visible[0].sessionId, 'live', 'yanlış kayıt kaldı');
});

// ===========================================================================
console.log('\n=== I. Parser sözleşmesi ===');
// ===========================================================================

const row = (over) => ({
  id: 'e1', program_day_id: 'd1', exercise_id: null, custom_exercise_name: 'X', visual: null,
  tracking_mode: 'sets_reps', target_sets: 3, target_reps: '8-10',
  target_duration_seconds: null, target_distance_meters: null, rest_seconds: 60, position: 0, ...over,
});

check('I1. Geçerli strength satırı', () => {
  const parsed = parseProgramExerciseRow(row({}), passVisual);
  assertEqual(parsed.trackingMode, 'sets_reps', 'tür yanlış');
  assertEqual(parsed.targetSets, 3, 'targetSets yanlış');
  assertEqual(parsed.targetReps, '8-10', 'targetReps yanlış');
  assertEqual(parsed.targetDurationSeconds, undefined, 'kardiyo hedefi sızdı');
});
check('I2. Geçerli duration satırı', () => {
  const parsed = parseProgramExerciseRow(
    row({ tracking_mode: 'duration', target_sets: null, target_reps: null, target_duration_seconds: 600, rest_seconds: 0 }),
    passVisual,
  );
  assertEqual(parsed.trackingMode, 'duration', 'tür yanlış');
  assertEqual(parsed.targetDurationSeconds, 600, 'hedef yanlış');
  assertEqual(parsed.targetSets, undefined, 'targetSets sızdı');
});
check('I3. Geçerli distance satırı', () => {
  const parsed = parseProgramExerciseRow(
    row({ tracking_mode: 'distance', target_sets: null, target_reps: null, target_distance_meters: 5000, rest_seconds: 0 }),
    passVisual,
  );
  assertEqual(parsed.trackingMode, 'distance', 'tür yanlış');
  assertEqual(parsed.targetDistanceMeters, 5000, 'hedef yanlış');
});

check('I4. Bozuk satırlar SESSİZCE sahte değere çevrilmez', () => {
  const bad = [
    ['bilinmeyen mode', { tracking_mode: 'cycling' }],
    ['strength targetSets null', { target_sets: null }],
    ['strength targetSets 0', { target_sets: 0 }],
    ['strength targetSets NaN', { target_sets: Number.NaN }],
    ['strength targetReps null', { target_reps: null }],
    ['strength targetReps boş', { target_reps: '   ' }],
    ['strength + kardiyo hedefi', { target_distance_meters: 5000 }],
    ['duration hedefi null', { tracking_mode: 'duration', target_sets: null, target_reps: null }],
    ['duration + set hedefi', { tracking_mode: 'duration', target_duration_seconds: 600 }],
    ['distance hedefi null', { tracking_mode: 'distance', target_sets: null, target_reps: null }],
    ['distance + süre hedefi', {
      tracking_mode: 'distance', target_sets: null, target_reps: null,
      target_distance_meters: 5000, target_duration_seconds: 600,
    }],
  ];
  for (const [label, over] of bad) {
    let caught;
    try {
      parseProgramExerciseRow(row(over), passVisual);
    } catch (error) {
      caught = error;
    }
    assert(caught instanceof ProgramExerciseContractError, `sessizce kabul edildi: ${label}`);
    assert(!/NaN|undefined/.test(String(caught.message)), `hata mesajında NaN/undefined: ${label}`);
  }
});

/** Yorum satırları çıkarılır — bu kontroller GERÇEK kodu tarar, açıklamayı değil. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

check('I5. Parser hiçbir yolda varsayılan üretmez', () => {
  const code = stripComments(source('utils/program-exercise.ts'));
  assert(!/\?\?\s*1\b/.test(code), 'sessiz `?? 1` varsayılanı var');
  assert(!/as number/.test(code), '`as number` cast var');
  assert(!/!\./.test(code.replace(/!==/g, '')), 'non-null assertion var');
});

// ===========================================================================
console.log('\n=== J. Tempo türetimi (saklanmaz) ===');
// ===========================================================================

check('J1. Tempo mesafe ve süreden türetilir', () => {
  assertEqual(derivePaceSecondsPerKm(5000, 1500), 300, 'tempo yanlış');
  assertEqual(derivePaceSecondsPerKm(0, 1500), undefined, 'mesafesiz tempo üretildi');
  assertEqual(derivePaceSecondsPerKm(undefined, 1500), undefined, 'tanımsız mesafe');
  assertEqual(derivePaceSecondsPerKm(5000, 0), undefined, 'süresiz tempo üretildi');
});
check('J2. Tempo HİÇBİR tipte saklanmıyor', () => {
  const types = source('types/workout.ts');
  assert(!/\bpace\b/i.test(types), 'tip sözleşmesinde pace alanı var');
  assert(!/\btempo\s*[:?]/i.test(types), 'tip sözleşmesinde tempo alanı var');
});

// ===========================================================================
console.log('\n=== K. Mutasyon / ayırt edicilik ===');
// ===========================================================================

check('K1. MUT — kardiyoyu sahte targetSets = 1 yapan model düşer', () => {
  const fake = { id: 'run', trackingMode: 'sets_reps', targetSets: 1, targetReps: '1', restSeconds: 0 };
  // Sahte model mesafe kanıtını HİÇ okumaz: 5 km koşu 0 birim üretir.
  assertEqual(
    resolveExerciseProgress(fake, 0, { durationSeconds: 1500, distanceMeters: 5000 }).doneUnits,
    0, 'sahte model mesafeyi görüyor — mutasyon geçersiz',
  );
  assertEqual(resolveExerciseProgress(RUN, 0, { durationSeconds: 1500, distanceMeters: 5000 }).doneUnits, 1,
    'gerçek model mesafeyi görmüyor');
});

check('K2. MUT — duration tamamlanmasını MESAFEYE bağlayan model düşer', () => {
  const broken = (t) => (t.distanceMeters >= 600 ? 1 : 0);
  assertEqual(broken({ durationSeconds: 0, distanceMeters: 5000 }), 1, 'bozuk model tamamlamıyor — mutasyon geçersiz');
  assertEqual(durationAt(0, 5000).doneUnits, 0, 'gerçek model mesafeyle tamamlıyor');
});

check('K3. MUT — distance tamamlanmasını SÜREYE bağlayan model düşer', () => {
  const broken = (t) => (t.durationSeconds >= 5000 ? 1 : 0);
  assertEqual(broken({ durationSeconds: 9000, distanceMeters: 0 }), 1, 'bozuk model tamamlamıyor — mutasyon geçersiz');
  assertEqual(distanceAt(0, 9000).doneUnits, 0, 'gerçek model süreyle tamamlıyor');
});

check('K4. MUT — oturum toplamasını kaldıran model düşer', () => {
  const records = [
    record({ id: 'a', sessionId: 's1', distanceMeters: 2000 }),
    record({ id: 'b', sessionId: 's2', distanceMeters: 3000 }),
  ];
  const noAggregate = Math.max(...records.map((r) => r.distanceMeters));
  assertEqual(noAggregate, 3000, 'bozuk model topluyor — mutasyon geçersiz');
  assert(noAggregate < 5000, 'toplamasız model hedefe ulaşıyor');
  assertEqual(aggregateActivityTotals(records)[actKey('run')].distanceMeters, 5000, 'gerçek model toplamıyor');
});

check('K5. MUT — hasProgress’i doneUnits’e indirgeyen model düşer', () => {
  const reduced = (p) => p.doneUnits > 0;
  const belowTarget = distanceAt(3000);
  assertEqual(reduced(belowTarget), false, 'indirgenmiş model ilerlemeyi görüyor — mutasyon geçersiz');
  assertEqual(belowTarget.hasProgress, true, 'gerçek model hedef altı ilerlemeyi kaçırıyor');
  // Bu fark tam olarak karar-1'i (hedef altı → partial) mümkün kılan şeydir.
  assertEqual(
    dayStatus({ exercises: [RUN], activity: { [actKey('run')]: { durationSeconds: 900, distanceMeters: 3000 } }, isToday: true }),
    'partial', 'hedef altı partial üretmiyor',
  );
});

check('K6. MUT — soft-delete aktivitesini TAKVİMDEN çıkaran model düşer', () => {
  const all = [
    record({ id: 'a', sessionId: 'live', distanceMeters: 3000 }),
    record({ id: 'b', sessionId: 'deleted', distanceMeters: 2000 }),
  ];
  const wronglyFiltered = aggregateActivityTotals(all.filter((r) => r.sessionId !== 'deleted'));
  assertEqual(resolveExerciseProgress(RUN, 0, wronglyFiltered[actKey('run')]).doneUnits, 0,
    'filtrelenmiş model hâlâ tamamlıyor — mutasyon geçersiz');
  const correct = aggregateActivityTotals(all);
  assertEqual(resolveExerciseProgress(RUN, 0, correct[actKey('run')]).doneUnits, 1,
    'gerçek model silinmiş oturumu takvimden çıkarıyor');
});

check('K7. MUT — hedef üstünü çoklu birim sayan model düşer', () => {
  const broken = (t) => Math.floor(t.distanceMeters / 5000);
  assertEqual(broken({ distanceMeters: 12000 }), 2, 'bozuk model tek birim veriyor — mutasyon geçersiz');
  assertEqual(distanceAt(12000).doneUnits, 1, 'gerçek model fazladan birim veriyor');
});

// ===========================================================================
console.log('\n=== M. Tür-farkında otomatik bitiş ===');
// ===========================================================================

/** Son strength seti kaydedildikten sonra oturum biter mi? */
const finishesAfterSet = ({ exercises, sets = {}, activity = {}, completedExerciseId }) =>
  completesWorkoutAfterSet({
    dateKey: '2026-09-10',
    exercises,
    completedSetCounts: sets,
    activityTotals: activity,
    getSetProgressKey,
    completedExerciseId,
  });

/** Faz 2A ÖNCESİ otomatik bitiş — YALNIZ strength toplamlarına bakar. */
function legacyFinishes(exercises, sets, completedExerciseId) {
  const strength = exercises.filter((e) => e.trackingMode === 'sets_reps');
  const target = strength.reduce((t, e) => t + e.targetSets, 0);
  const done = strength.reduce((t, e) => t + Math.min(sets[setKey(e.id)] ?? 0, e.targetSets), 0);
  const self = strength.find((e) => e.id === completedExerciseId);
  if (!self) return false;
  if ((Math.min(sets[setKey(self.id)] ?? 0, self.targetSets)) >= self.targetSets) return false;
  return target > 0 && done + 1 >= target;
}

check('M1. Strength-only: yeni karar ESKİ davranışla birebir aynı', () => {
  const squat = { id: 'squat', trackingMode: 'sets_reps', targetSets: 4, targetReps: '5', restSeconds: 90 };
  const exercises = [BENCH, squat];
  let sawFinish = false;
  let sawNoFinish = false;
  for (const b of [0, 1, 2, 3, 5]) {
    for (const q of [0, 1, 3, 4, 6]) {
      for (const id of ['bench', 'squat']) {
        const sets = { [setKey('bench')]: b, [setKey('squat')]: q };
        const actual = finishesAfterSet({ exercises, sets, completedExerciseId: id });
        assertEqual(actual, legacyFinishes(exercises, sets, id),
          `eşdeğerlik bozuldu (bench=${b}, squat=${q}, kaydedilen=${id})`);
        if (actual) sawFinish = true;
        else sawNoFinish = true;
      }
    }
  }
  // Karşılaştırma vacuous olmasın: her iki sonuç da gerçekten görüldü.
  assert(sawFinish && sawNoFinish, 'eşdeğerlik taraması tek sonuç üretti — kontrol vacuous');
});

check('M2. Karma gün + EKSİK duration → son strength seti BİTİRMEZ', () => {
  assertEqual(
    finishesAfterSet({
      exercises: [BENCH, PLANK],
      sets: { [setKey('bench')]: 2 },
      completedExerciseId: 'bench',
    }),
    false, 'eksik duration hedefiyle oturum kapandı',
  );
  // Aynı gün strength-only olsaydı BİTERDİ — fark tam olarak kardiyodan geliyor.
  assertEqual(
    finishesAfterSet({ exercises: [BENCH], sets: { [setKey('bench')]: 2 }, completedExerciseId: 'bench' }),
    true, 'strength-only referans senaryosu bitmiyor — kontrol vacuous',
  );
});

check('M3. Karma gün + TAMAMLANMIŞ duration + son strength seti → BİTER', () => {
  assertEqual(
    finishesAfterSet({
      exercises: [BENCH, PLANK],
      sets: { [setKey('bench')]: 2 },
      activity: { [actKey('plank')]: { durationSeconds: 600, distanceMeters: 0 } },
      completedExerciseId: 'bench',
    }),
    true, 'kardiyo tamamken oturum kapanmadı',
  );
});

check('M4. Karma gün + HEDEF-ALTI duration → partial kalır, BİTMEZ', () => {
  const activity = { [actKey('plank')]: { durationSeconds: 599, distanceMeters: 0 } };
  assertEqual(
    finishesAfterSet({ exercises: [BENCH, PLANK], sets: { [setKey('bench')]: 2 }, activity, completedExerciseId: 'bench' }),
    false, 'hedef-altı kardiyoyla oturum kapandı',
  );
  assertEqual(
    dayStatus({ exercises: [BENCH, PLANK], sets: { [setKey('bench')]: 3 }, activity, isToday: true }),
    'partial', 'hedef-altı kardiyolu gün partial değil',
  );
});

check('M5. Karma gün + EKSİK distance → BİTMEZ', () => {
  assertEqual(
    finishesAfterSet({ exercises: [BENCH, RUN], sets: { [setKey('bench')]: 2 }, completedExerciseId: 'bench' }),
    false, 'eksik distance hedefiyle oturum kapandı',
  );
});

check('M6. Karma gün + TAMAMLANMIŞ distance → BİTER', () => {
  assertEqual(
    finishesAfterSet({
      exercises: [BENCH, RUN],
      sets: { [setKey('bench')]: 2 },
      activity: { [actKey('run')]: { durationSeconds: 1500, distanceMeters: 5000 } },
      completedExerciseId: 'bench',
    }),
    true, 'distance tamamken oturum kapanmadı',
  );
  // Hedef-altı distance ise hâlâ bitirmemeli.
  assertEqual(
    finishesAfterSet({
      exercises: [BENCH, RUN],
      sets: { [setKey('bench')]: 2 },
      activity: { [actKey('run')]: { durationSeconds: 1500, distanceMeters: 4999 } },
      completedExerciseId: 'bench',
    }),
    false, 'hedef-altı distance oturumu kapattı',
  );
});

check('M7. EKSTRA strength seti otomatik bitiş TETİKLEMEZ', () => {
  // Hedefi dolmuş egzersize 4. set: gün zaten tamam olsa bile bitirmez.
  assertEqual(
    finishesAfterSet({ exercises: [BENCH], sets: { [setKey('bench')]: 3 }, completedExerciseId: 'bench' }),
    false, 'ekstra set oturumu kapattı',
  );
  assertEqual(
    finishesAfterSet({
      exercises: [BENCH, RUN],
      sets: { [setKey('bench')]: 3 },
      activity: { [actKey('run')]: { durationSeconds: 1500, distanceMeters: 5000 } },
      completedExerciseId: 'bench',
    }),
    false, 'karma günde ekstra set oturumu kapattı',
  );
  assertEqual(
    resolveProjectedSetProgress({
      dateKey: '2026-09-10', exercises: [BENCH], completedSetCounts: { [setKey('bench')]: 3 },
      activityTotals: {}, getSetProgressKey, completedExerciseId: 'bench',
    }).contributes,
    false, 'ekstra set katkı veriyor sayıldı',
  );
});

check('M8. YALNIZ kardiyo günü bir strength olayıyla BİTİRİLEMEZ', () => {
  const activity = { [actKey('run')]: { durationSeconds: 1500, distanceMeters: 5000 } };
  // Kardiyo hedefi dolu olsa bile: strength kimliği o günde yok → katkı yok.
  assertEqual(
    finishesAfterSet({ exercises: [RUN], activity, completedExerciseId: 'bench' }),
    false, 'kardiyo günü strength olayıyla kapandı',
  );
  // Kardiyo kimliğinin kendisi verilse de aynı.
  assertEqual(
    finishesAfterSet({ exercises: [RUN], activity, completedExerciseId: 'run' }),
    false, 'kardiyo kimliği oturumu kapattı',
  );
});

check('M9. Öngörülen sayaç YALNIZ ilgili tarih + egzersizi etkiliyor', () => {
  const otherDayKey = getSetProgressKey('2026-09-09', 'bench');
  const input = {
    dateKey: '2026-09-10',
    exercises: [BENCH],
    completedSetCounts: { [setKey('bench')]: 1, [setKey('squat')]: 2, [otherDayKey]: 2 },
    activityTotals: {},
    getSetProgressKey,
    completedExerciseId: 'bench',
  };
  const before = JSON.stringify(input.completedSetCounts);
  const outcome = resolveProjectedSetProgress(input);

  assertEqual(outcome.contributes, true, 'katkı görülmedi');
  assertEqual(outcome.progress.doneUnits, 2, 'öngörülen sayaç 1+1 değil');
  // Girdi haritası MUTATE EDİLMEDİ.
  assertEqual(JSON.stringify(input.completedSetCounts), before, 'girdi haritası değiştirildi');
  // Aynı egzersizin BAŞKA GÜNÜ etkilenmedi.
  assertEqual(
    resolveProjectedSetProgress({ ...input, dateKey: '2026-09-09' }).progress.doneUnits,
    3, 'başka günün öngörüsü ilgisiz tarihten etkilendi',
  );
});

check('M10. MUT — bitişi yalnız strength toplamına indirgeyen model düşer', () => {
  const exercises = [BENCH, PLANK];
  const sets = { [setKey('bench')]: 2 };
  // Faz 2A öncesi model: kardiyoyu hiç görmez, son strength setinde BİTİRİR.
  assertEqual(legacyFinishes(exercises, sets, 'bench'), true,
    'eski model bitirmiyor — mutasyon geçersiz');
  assertEqual(finishesAfterSet({ exercises, sets, completedExerciseId: 'bench' }), false,
    'gerçek model kardiyo hedefini görmüyor');
});

check('M11. MUT — katkı kapısını kaldıran model düşer', () => {
  const exercises = [BENCH];
  const sets = { [setKey('bench')]: 3 };
  // Kapısız model: gün zaten tamam olduğu için ekstra sette de "biter" der.
  const noGuard = resolveProjectedSetProgress({
    dateKey: '2026-09-10', exercises, completedSetCounts: sets,
    activityTotals: {}, getSetProgressKey, completedExerciseId: 'bench',
  }).progress;
  assertEqual(noGuard.doneUnits >= noGuard.targetUnits, true,
    'kapısız model bitirmiyor — mutasyon geçersiz');
  assertEqual(finishesAfterSet({ exercises, sets, completedExerciseId: 'bench' }), false,
    'gerçek model ekstra sette bitiriyor');
});

// ===========================================================================
console.log('\n=== L. Tek doğruluk kaynağı ===');
// ===========================================================================

check('L1. Takvim ve zamanlama ortak çekirdeği kullanıyor', () => {
  for (const file of ['utils/workout-schedule.ts', 'components/discipline-calendar.tsx']) {
    const code = source(file);
    assert(/resolveDayProgress/.test(code), `${file}: ortak çekirdek kullanılmıyor`);
    assert(
      !/reduce\([^)]*exercise\.targetSets/.test(code.replace(/\s+/g, ' ')),
      `${file}: ikinci bağımsız set formülü kalmış`,
    );
  }
});

check('L2. Aktif set akışı strength’e daraltılmış', () => {
  const screen = source('app/program/[id]/day/[dayId]/index.tsx');
  assert(/\.filter\(isStrengthExercise\)/.test(screen), 'dayExercises daraltılmamış');
  const context = source('context/workout-context.tsx');
  assert(/if \(!isStrengthExercise\(exercise\)\)/.test(context), 'completeSet guard yok');
});

/**
 * BU İDDİA FAZ 2A'YA ÖZGÜYDÜ: o turda aktivite yazma yolu BİLİNÇLİ olarak
 * yoktu. Faz 2B yazma yolunu kasıtlı olarak ekler, dolayısıyla "yazma yolu
 * yok" iddiası doğal olarak geçersizleşir — ve geçersizliği OKUMA
 * sözleşmesiyle ilgili DEĞİLDİR.
 *
 * İddia zayıflatılmadı, KALICI anlamına daraltıldı: bu harness'ın koruduğu şey
 * OKUMA yolunun ve soft-delete sınırının bozulmamasıdır. Yazma sözleşmesi
 * (INSERT/UPDATE ayrımı, immutable kolonlar, delta) `scripts/
 * verify-activity-tracking-client-write.mjs` içinde ayrıca ve daha ayrıntılı
 * doğrulanır.
 */
check('L3. Aktivite OKUMA yolu ve soft-delete sınırı korunuyor', () => {
  const context = source('context/workout-context.tsx');
  assert(/from\('workout_activity_records'\)[\s\S]{0,60}\.select\(/.test(context), 'aktivite SELECT yok');
  assert(/const loadedActivityTotals = aggregateActivityTotals\(disciplineActivityRecords\)/.test(context),
    'disiplin kanıtı BÜTÜN kayıtlardan üretilmiyor');
  assert(/loadedActivityRecords = disciplineActivityRecords\.filter\(/.test(context),
    'görünür koleksiyon filtrelenmiyor');
});

check('L4. Yeni egzersiz yükü türü AÇIKÇA yazıyor', () => {
  const helper = source('utils/program-exercise.ts');
  assert(/tracking_mode: 'sets_reps' as const/.test(helper), 'tür açıkça yazılmıyor');
  assert(/target_duration_seconds: null/.test(helper), 'kardiyo hedefi açıkça null değil');
  assert(/target_distance_meters: null/.test(helper), 'kardiyo hedefi açıkça null değil');
});

check('L5. Oturum kapanınca aktivite state hesaplar arasında SIZMAZ', () => {
  const context = source('context/workout-context.tsx');
  const noUserStart = context.indexOf('if (!user) {');
  const noUserEnd = context.indexOf('\n      return;', noUserStart);
  assert(noUserStart >= 0 && noUserEnd > noUserStart, 'kullanıcısız temizleme dalı bulunamadı');

  const cleanup = context.slice(noUserStart, noUserEnd);
  assert(/setWorkoutActivityRecords\(\[\]\)/.test(cleanup), 'görünen aktivite kayıtları temizlenmiyor');
  assert(/setActivityTotals\(\{\}\)/.test(cleanup), 'disiplin aktivite toplamları temizlenmiyor');
});

// ---------------------------------------------------------------------------

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Aktivite takibi istemci çekirdeği harness: ${pass} kontrol geçti.`);
console.log('  (GERÇEK saf yardımcılar derlenip çalıştırıldı; kopya algoritma test edilmedi.)');
