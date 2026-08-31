/**
 * Haftalık performans özeti — SAF çekirdek doğrulaması.
 *
 * GERÇEK `utils/weekly-workout-metrics.ts` (ve bağımlı olduğu
 * `utils/discipline.ts` + `utils/workout-session.ts`) `tsc` ile derlenip
 * ÇAĞRILIR; kopya algoritma test EDİLMEZ. `now` daima dışarıdan enjekte edilir.
 * Ayrıca çekirdeğin saflığı ve `app/(tabs)/coach.tsx` + locale sözleşmesi
 * KAYNAK düzeyinde taranır.
 *
 * Çalıştırma:  node scripts/verify-weekly-summary-metrics.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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
// GERÇEK çekirdeği derle
// ---------------------------------------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), 'rosea-weekly-'));
let mod;
try {
  writeFileSync(
    join(outDir, 'types-workout-shim.ts'),
    'export type DisciplineStatus = any;\nexport type WorkoutSession = any;\n' +
      'export type WorkoutSetRecord = any;\nexport type WorkoutActivityRecord = any;\n',
  );
  writeFileSync(join(outDir, 'types-profile-shim.ts'), 'export type TrainingGoal = any;\n');
  writeFileSync(
    join(outDir, 'types-ai-shim.ts'),
    'export type WeeklyDisciplineBreakdown = any;\nexport type WeeklyMetricChange = any;\n' +
      'export type WeeklyWorkoutMetrics = any;\n',
  );
  for (const [relative, outName] of [
    ['utils/discipline.ts', 'discipline'],
    ['utils/workout-session.ts', 'workout-session'],
    ['utils/weekly-workout-metrics.ts', 'weekly-workout-metrics'],
  ]) {
    const patched = source(relative)
      .replace(/from '@\/types\/workout'/g, "from './types-workout-shim'")
      .replace(/from '@\/types\/profile'/g, "from './types-profile-shim'")
      .replace(/from '@\/types\/ai'/g, "from './types-ai-shim'")
      .replace(/from '@\/utils\/discipline'/g, "from './discipline.js'")
      .replace(/from '@\/utils\/workout-session'/g, "from './workout-session.js'");
    writeFileSync(join(outDir, `${outName}.ts`), patched);
  }
  execFileSync(
    'npx',
    [
      'tsc',
      join(outDir, 'discipline.ts'),
      join(outDir, 'workout-session.ts'),
      join(outDir, 'weekly-workout-metrics.ts'),
      join(outDir, 'types-workout-shim.ts'),
      join(outDir, 'types-profile-shim.ts'),
      join(outDir, 'types-ai-shim.ts'),
      '--outDir', outDir, '--target', 'es2020', '--module', 'esnext',
      '--moduleResolution', 'bundler', '--strict', '--skipLibCheck',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
  mod = await import(pathToFileURL(join(outDir, 'weekly-workout-metrics.js')).href);
} catch (error) {
  console.error('Saf çekirdek derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}
process.on('exit', () => rmSync(outDir, { force: true, recursive: true }));

const { buildWeeklyWorkoutMetrics, buildMetricChange } = mod;

// ---------------------------------------------------------------------------
// Yerel tarih yardımcıları — çekirdeğin PAZARTESİ–PAZAR sınırını AYNEN yansıtır.
// ---------------------------------------------------------------------------
function toKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function weekStart(now) {
  const result = new Date(now);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}
function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

// Çarşamba öğlen: haftanın ortası — Perşembe–Pazar bu haftada GELECEKtedir.
const NOW = new Date(2026, 7, 26, 12, 0, 0, 0); // 2026-08-26
const monday = weekStart(NOW);
const sunday = addDays(monday, 6);
const MON = toKey(monday);
const SUN = toKey(sunday);
const PREV_MON = toKey(addDays(monday, -7));
const PREV_SUN = toKey(addDays(monday, -1)); // önceki haftanın Pazar'ı
const NEXT_MON = toKey(addDays(sunday, 1)); // gelecek haftanın Pazartesi'si

let seq = 0;
function session(over = {}) {
  seq += 1;
  return {
    id: `S${seq}`,
    programId: 'P',
    dayId: 'D',
    dateKey: MON,
    status: 'completed',
    startedAt: '2026-08-26T10:00:00.000Z',
    accumulatedDurationSeconds: 1800,
    ...over,
  };
}
function set(sessionId, over = {}) {
  seq += 1;
  return {
    id: `X${seq}`,
    sessionId,
    programExerciseId: 'E',
    exerciseName: 'Bench',
    dateKey: MON,
    setNumber: 1,
    dropSets: [],
    completedAt: '2026-08-26T10:05:00.000Z',
    ...over,
  };
}
function activity(sessionId, over = {}) {
  seq += 1;
  return {
    id: `A${seq}`,
    sessionId,
    programExerciseId: 'C',
    exerciseName: 'Run',
    trackingMode: 'distance',
    durationSeconds: 600,
    distanceMeters: 5000,
    completedAt: '2026-08-26T10:20:00.000Z',
    dateKey: MON,
    ...over,
  };
}

const BASE = {
  activeProgramName: 'Push Pull',
  disciplineStatuses: {},
  now: NOW,
  trainingGoal: 'muscle',
  workoutSessions: [],
  workoutSets: [],
  workoutActivityRecords: [],
};
const build = (over) => buildWeeklyWorkoutMetrics({ ...BASE, ...over });

// ===========================================================================
console.log('=== A. Pazartesi–Pazar sınırı ===');
// ===========================================================================

check('A1. Dönem PAZARTESİ başlar, PAZAR biter (yerel)', () => {
  const m = build({});
  assertEqual(m.periodStart, MON, 'periodStart Pazartesi');
  assertEqual(m.periodEnd, SUN, 'periodEnd Pazar');
});

check('A2. Pazartesi ve Pazar oturumları DAHİL; komşu haftalar HARİÇ', () => {
  const m = build({
    workoutSessions: [
      session({ id: 'IN_MON', dateKey: MON }),
      session({ id: 'IN_SUN', dateKey: SUN }),
      session({ id: 'PREV', dateKey: PREV_SUN }),
      session({ id: 'NEXT', dateKey: NEXT_MON }),
    ],
  });
  assertEqual(m.completedWorkouts, 2, 'yalnız bu haftanın iki günü');
  assertEqual(m.previousWeekCompletedWorkouts, 1, 'önceki Pazar önceki haftaya girer');
});

// ===========================================================================
console.log('\n=== B. Önceki hafta karşılaştırması ===');
// ===========================================================================

check('B1. Antrenman/set/süre değişimi geçen haftaya göre hesaplanır', () => {
  const sCur1 = session({ id: 'C1', dateKey: MON, accumulatedDurationSeconds: 1800 });
  const sCur2 = session({ id: 'C2', dateKey: SUN, accumulatedDurationSeconds: 1200 });
  const sPrev = session({ id: 'PV', dateKey: PREV_MON, accumulatedDurationSeconds: 600 });
  const m = build({
    workoutSessions: [sCur1, sCur2, sPrev],
    // Setin dateKey'i her zaman oturumunun gününe eşittir (context sözleşmesi).
    workoutSets: [
      set('C1', { dateKey: MON }),
      set('C1', { dateKey: MON, setNumber: 2 }),
      set('C2', { dateKey: SUN }),
      set('PV', { dateKey: PREV_MON }),
    ],
  });
  assertEqual(m.completedWorkouts, 2, 'bu hafta 2 antrenman');
  assertEqual(m.previousWeekCompletedWorkouts, 1, 'geçen hafta 1');
  assertEqual(m.workoutChange.delta, 1, 'antrenman farkı');
  assertEqual(m.workoutChange.direction, 'up', 'yön');
  assertEqual(m.workoutChange.percent, 100, '(2-1)/1');
  assertEqual(m.completedSets, 3, 'bu hafta 3 set');
  assertEqual(m.previousWeekCompletedSets, 1, 'geçen hafta 1 set');
  assertEqual(m.setChange.delta, 2, 'set farkı');
  assertEqual(m.totalWorkoutDurationSeconds, 3000, 'bu hafta toplam süre');
  assertEqual(m.previousWeekTotalWorkoutDurationSeconds, 600, 'geçen hafta süre');
  assertEqual(m.durationChange.delta, 2400, 'süre farkı');
  assertEqual(m.averageWorkoutDurationSeconds, 1500, '3000/2');
});

check('B2. Set ve aktivite kendi tarihinden değil bağlı oturumun haftasından sayılır', () => {
  const currentSession = session({ id: 'DATE_CURRENT', dateKey: MON });
  const previousSession = session({ id: 'DATE_PREVIOUS', dateKey: PREV_MON });
  const m = build({
    workoutSessions: [currentSession, previousSession],
    workoutSets: [
      // Kayıt tarihleri kasıtlı olarak ters. Güvenilir sınır session.dateKey.
      set('DATE_CURRENT', { dateKey: PREV_MON }),
      set('DATE_PREVIOUS', { dateKey: MON }),
    ],
    workoutActivityRecords: [
      activity('DATE_CURRENT', { dateKey: PREV_MON }),
      activity('DATE_PREVIOUS', { dateKey: MON }),
    ],
  });
  assertEqual(m.completedSets, 1, 'bu haftanın oturumuna bağlı set');
  assertEqual(m.previousWeekCompletedSets, 1, 'önceki haftanın oturumuna bağlı set');
  assertEqual(m.completedActivities, 1, 'bu haftanın oturumuna bağlı aktivite');
});

// ===========================================================================
console.log('\n=== C. Gelecek planlı günler cezalandırılmaz ===');
// ===========================================================================

check('C1. Durumu OLMAYAN gelecek günler skipped saymaz', () => {
  // Bugün Çarşamba: Pzt/Sal geçmişte, Perş–Paz gelecekte ve durum haritasında YOK.
  const m = build({
    disciplineStatuses: {
      [MON]: 'completed',
      [toKey(addDays(monday, 1))]: 'partial',
      // Perşembe–Pazar (gelecek) BİLİNÇLİ olarak yok — çekirdek onları uydurmaz.
    },
  });
  assertEqual(m.discipline.completed, 1, 'tamamlanan');
  assertEqual(m.discipline.partial, 1, 'kısmi');
  assertEqual(m.discipline.skipped, 0, 'gelecek günler skipped değil');
});

check('C2. Dönem dışındaki durumlar sayılmaz', () => {
  const m = build({
    disciplineStatuses: {
      [PREV_SUN]: 'skipped',
      [NEXT_MON]: 'skipped',
      [MON]: 'completed',
    },
  });
  assertEqual(m.discipline.completed, 1, 'yalnız bu haftanın günü');
  assertEqual(m.discipline.skipped, 0, 'komşu hafta durumları hariç');
});

// ===========================================================================
console.log('\n=== D. Yalnız set / yalnız kardiyo / karma hafta ===');
// ===========================================================================

check('D1. Yalnız SETLİ hafta — kardiyo alanları 0', () => {
  const m = build({
    workoutSessions: [session({ id: 'ST', dateKey: MON })],
    workoutSets: [set('ST'), set('ST', { setNumber: 2 }), set('ST', { setNumber: 3 })],
  });
  assertEqual(m.completedWorkouts, 1, 'tek oturum');
  assertEqual(m.completedSets, 3, '3 set');
  assertEqual(m.completedActivities, 0, 'kardiyo yok');
  assertEqual(m.totalActivityDurationSeconds, 0, 'kardiyo süresi 0');
  assertEqual(m.totalActivityDistanceMeters, 0, 'mesafe 0');
});

check('D2. Yalnız KARDİYO hafta — set 0 ama antrenman ve ilerleme var', () => {
  const m = build({
    workoutSessions: [session({ id: 'CA', dateKey: MON })],
    workoutActivityRecords: [
      activity('CA', { durationSeconds: 600, distanceMeters: 5000 }),
      activity('CA', { durationSeconds: 900, distanceMeters: 3000 }),
    ],
  });
  assertEqual(m.completedSets, 0, 'set yok');
  assertEqual(m.completedWorkouts, 1, 'oturum yine de tamamlanmış antrenman');
  assertEqual(m.completedActivities, 2, '2 kardiyo kaydı');
  assertEqual(m.totalActivityDurationSeconds, 1500, 'kardiyo süre toplamı');
  assertEqual(m.totalActivityDistanceMeters, 8000, 'mesafe toplamı (metre)');
  // "0 ilerleme" görünmemesinin çekirdek dayanağı: antrenman + kardiyo pozitif.
  assert(m.completedWorkouts > 0 && m.completedActivities > 0, 'kardiyo-only ilerleme pozitif');
});

check('D3. KARMA gün — oturum ikiye bölünmez, set ve kardiyo ayrı sayılır', () => {
  const m = build({
    workoutSessions: [session({ id: 'MX', dateKey: MON })],
    workoutSets: [set('MX'), set('MX', { setNumber: 2 })],
    workoutActivityRecords: [activity('MX')],
  });
  assertEqual(m.completedWorkouts, 1, 'karma oturum tek antrenman (item 7)');
  assertEqual(m.completedSets, 2, 'setler sayıldı');
  assertEqual(m.completedActivities, 1, 'kardiyo sayıldı');
});

// ===========================================================================
console.log('\n=== E. Tamamlanmamış / silinmiş oturum dışlama ===');
// ===========================================================================

check('E1. paused/running oturum ve kayıtları istatistiğe girmez', () => {
  const m = build({
    workoutSessions: [
      session({ id: 'DONE', dateKey: MON, status: 'completed' }),
      session({ id: 'PAUSE', dateKey: MON, status: 'paused' }),
      session({ id: 'RUN', dateKey: MON, status: 'running' }),
    ],
    workoutSets: [set('DONE'), set('PAUSE'), set('RUN')],
    workoutActivityRecords: [activity('DONE'), activity('PAUSE'), activity('RUN')],
  });
  assertEqual(m.completedWorkouts, 1, 'yalnız completed oturum');
  assertEqual(m.completedSets, 1, 'yalnız completed oturumun seti');
  assertEqual(m.completedActivities, 1, 'yalnız completed oturumun kardiyosu');
});

check('E2. Listede OLMAYAN (silinmiş) oturumun kaydı sayılmaz', () => {
  const m = build({
    workoutSessions: [session({ id: 'DONE', dateKey: MON })],
    // GHOST oturumu workoutSessions listesinde yok (context silinmişi çıkardı).
    workoutSets: [set('DONE'), set('GHOST')],
    workoutActivityRecords: [activity('GHOST')],
  });
  assertEqual(m.completedSets, 1, 'hayalet setin dışlanması');
  assertEqual(m.completedActivities, 0, 'hayalet kardiyonun dışlanması');
});

// ===========================================================================
console.log('\n=== F. Mesafe birimleri yanlış toplanmaz ===');
// ===========================================================================

check('F1. Mesafe METRE cinsinde toplanır; mesafesiz kayıt eklenmez', () => {
  const m = build({
    workoutSessions: [session({ id: 'CA', dateKey: MON })],
    workoutActivityRecords: [
      activity('CA', { trackingMode: 'distance', durationSeconds: 600, distanceMeters: 5000 }),
      // Süre türünde İSTEĞE BAĞLI mesafe — yine metre, güvenle eklenir.
      activity('CA', { trackingMode: 'duration', durationSeconds: 1200, distanceMeters: 3000 }),
      // Mesafesiz süre kaydı — mesafe toplamına ve sayısına GİRMEZ.
      activity('CA', { trackingMode: 'duration', durationSeconds: 300, distanceMeters: undefined }),
    ],
  });
  assertEqual(m.completedActivities, 3, 'üç kardiyo kaydı');
  assertEqual(m.totalActivityDurationSeconds, 2100, 'süreler toplandı');
  // 5000 + 3000 = 8000 METRE (asla 5 + 3 = 8 "km" gibi karışık birim değil).
  assertEqual(m.totalActivityDistanceMeters, 8000, 'mesafe metre olarak toplandı');
  assertEqual(m.activityDistanceCount, 2, 'yalnız mesafeli iki kayıt');
});

// ===========================================================================
console.log('\n=== G. 0 tabanlı karşılaştırmada NaN/Infinity yok ===');
// ===========================================================================

check('G1. buildMetricChange önceki 0 iken yüzde üretmez', () => {
  const up = buildMetricChange(3, 0);
  assertEqual(up.direction, 'up', 'yön');
  assertEqual(up.delta, 3, 'fark');
  assertEqual(up.percent, undefined, 'önceki 0 → yüzde yok');
  const flat = buildMetricChange(0, 0);
  assertEqual(flat.direction, 'same', 'ikisi 0 → same');
  assertEqual(flat.percent, undefined, 'yüzde yok');
});

check('G2. Metriklerdeki değişim alanları hiçbir zaman NaN/Infinity değil', () => {
  const m = build({ workoutSessions: [session({ id: 'C1', dateKey: MON })], workoutSets: [set('C1')] });
  for (const change of [m.workoutChange, m.setChange, m.durationChange]) {
    assert(Number.isFinite(change.delta), 'delta sonlu');
    assert(change.percent === undefined || Number.isFinite(change.percent), 'yüzde sonlu ya da yok');
    assert(!Number.isNaN(change.delta), 'delta NaN değil');
  }
  assertEqual(m.workoutChange.percent, undefined, 'önceki hafta 0 → yüzde yok');
});

// ===========================================================================
console.log('\n=== H. Veri yok durumu ===');
// ===========================================================================

check('H1. Boş girdi güvenli sıfır durumları üretir', () => {
  const m = build({});
  assertEqual(m.completedWorkouts, 0, 'antrenman 0');
  assertEqual(m.completedSets, 0, 'set 0');
  assertEqual(m.completedActivities, 0, 'kardiyo 0');
  assertEqual(m.totalWorkoutDurationSeconds, 0, 'süre 0');
  assertEqual(m.averageWorkoutDurationSeconds, 0, 'ortalama 0 (bölme yok)');
  assertEqual(m.totalActivityDistanceMeters, 0, 'mesafe 0');
  assertEqual(m.discipline.completed + m.discipline.partial + m.discipline.skipped, 0, 'disiplin boş');
  assertEqual(m.workoutChange.direction, 'same', 'değişim same');
});

// ===========================================================================
console.log('\n=== I. Çekirdek saflığı ve kaynak sözleşmesi ===');
// ===========================================================================

const core = stripComments(source('utils/weekly-workout-metrics.ts'));
const coach = source('app/(tabs)/coach.tsx');
const coachCode = stripComments(coach);

check('I1. Süre ORTAK kaynaktan gelir; formül kopyalanmaz', () => {
  assert(/getWorkoutDurationSeconds/.test(core), 'ortak süre yardımcısı kullanılmıyor');
  assert(!/lastResumedAt/.test(core), 'süre formülü kopyalanmış');
});

check('I2. Çekirdek kalıcı kaynağa erişmez (saf)', () => {
  assert(!/supabase|fetch\(|AsyncStorage/.test(core), 'çekirdek kalıcı kaynağa erişiyor');
});

check('I3. Panel context aktivite verisini TEK kaynaktan alır', () => {
  assert(/workoutActivityRecords/.test(coachCode), 'aktivite kaydı panele verilmiyor');
  assert(/workoutSets,/.test(coachCode), 'set verisi panele verilmiyor');
  // İkinci bir sorgu/veri kaynağı açılmaz.
  assert(!/supabase\.from\(/.test(coachCode), 'panel yeni sorgu açıyor');
});

check('I4. Ham YYYY-MM-DD gösterilmez; tarih locale ile okunur yazılır', () => {
  assert(/dateFromKey\(/.test(coachCode), 'dateFromKey kullanılmıyor');
  assert(/toLocaleDateString\(locale/.test(coachCode), 'locale-aware tarih yok');
  assert(!/periodStart\}.*–.*\{.*periodEnd/.test(coach), 'ham dönem anahtarları gösteriliyor');
});

check('I5. Emoji yok; renkler tema sisteminden', () => {
  const region = coach.slice(coach.indexOf('WeeklyMetricsPanel'), coach.indexOf('function AnalysisSheet'));
  assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(region), 'emoji var');
  assert(/colors\.disciplineCompleted/.test(coach), 'tema disiplin rengi kullanılmıyor');
  assert(/colors\.card/.test(coach), 'tema yüzey rengi kullanılmıyor');
});

check('I6. Yeni metrik ve birim çevirileri TR ve EN\'de', () => {
  const tr = source('locales/tr.ts');
  const en = source('locales/en.ts');
  for (const key of [
    'metricWorkouts:', 'metricTotalDuration:', 'metricAvgDuration:', 'metricSets:',
    'metricCardio:', 'metricCardioDuration:', 'metricDistance:', 'metricDiscipline:',
    'disciplineCompleted:', 'disciplinePartial:', 'disciplineSkipped:',
    'durationHoursMinutes:', 'durationHours:', 'durationMinutes:', 'distanceKilometers:',
    'weeklyEmptyTitle:', 'weeklyEmptyBody:', 'weeklyEmptyBodyProgram:',
  ]) {
    assert(tr.includes(key) && en.includes(key), `çeviri eksik: ${key}`);
  }
  // Eski tek satırlık meta artık kullanılmıyor.
  assert(!/weeklyMeta/.test(coach), 'eski weeklyMeta hâlâ kullanılıyor');
});

check('I7. Remote haftalık özet de kardiyo kayıtlarını doğrulanmış oturumlardan okur', () => {
  const edge = stripComments(source('supabase/functions/workout-coach/index.ts'));
  assert(/from\('workout_activity_records'\)/.test(edge), 'Edge Function aktivite tablosunu okumuyor');
  assert(/\.in\('session_id', sessionIds\)/.test(edge), 'aktivite sorgusu tamamlanmış oturumlarla sınırlı değil');
  assert(/completedActivities/.test(edge), 'remote özet kardiyo sayısını taşımıyor');
  assert(/kardiyo\/aktivite kaydını tamamladın/.test(edge), 'TR remote kardiyo özeti yok');
  assert(/cardio\/activity record/.test(edge), 'EN remote kardiyo özeti yok');
  assert(/resolveWeeklyPeriod/.test(edge), 'remote yerel hafta aralığını doğrulamıyor');
  assert(/addUtcDays\(start, 6\)/.test(edge), 'remote yedi günlük dönem sözleşmesi yok');
  assert(/body\.periodStart, body\.periodEnd/.test(edge), 'istemci dönemi remote hesaplamaya bağlanmamış');
  const service = stripComments(source('services/ai/workout-insights.ts'));
  assert(/periodStart:\s*metrics\.periodStart/.test(service), 'yerel hafta başlangıcı gönderilmiyor');
  assert(/periodEnd:\s*metrics\.periodEnd/.test(service), 'yerel hafta bitişi gönderilmiyor');
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Haftalık özet metrik harness: ${pass} kontrol geçti.`);
console.log('  (GERÇEK saf çekirdek derlenip çalıştırıldı; kopya algoritma test edilmedi.)');
