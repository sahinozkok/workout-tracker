/**
 * Bugünkü antrenman süre tahmini — SAF çekirdek doğrulaması.
 *
 * GERÇEK `utils/workout-estimate.ts` (ve bağımlı olduğu `utils/workout-session.ts`)
 * `tsc` ile derlenip ÇAĞRILIR; kopya algoritma test EDİLMEZ. `now` daima
 * dışarıdan enjekte edilir. Ayrıca ana sayfa KAYNAK SÖZLEŞMESİ taranır.
 *
 * Çalıştırma:  node scripts/verify-workout-estimate.mjs
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
const outDir = mkdtempSync(join(tmpdir(), 'rosea-estimate-'));
let mod;
try {
  writeFileSync(join(outDir, 'types-workout-shim.ts'), 'export type WorkoutSession = any;\n');
  for (const [relative, outName] of [
    ['utils/workout-session.ts', 'workout-session'],
    ['utils/workout-estimate.ts', 'workout-estimate'],
  ]) {
    const patched = source(relative)
      .replace(/from '@\/types\/workout'/g, "from './types-workout-shim'")
      .replace(/from '@\/utils\/workout-session'/g, "from './workout-session.js'");
    writeFileSync(join(outDir, `${outName}.ts`), patched);
  }
  execFileSync(
    'npx',
    ['tsc', join(outDir, 'workout-session.ts'), join(outDir, 'workout-estimate.ts'),
     join(outDir, 'types-workout-shim.ts'),
     '--outDir', outDir, '--target', 'es2020', '--module', 'esnext',
     '--moduleResolution', 'bundler', '--strict', '--skipLibCheck'],
    { cwd: ROOT, stdio: 'pipe' },
  );
  mod = await import(pathToFileURL(join(outDir, 'workout-estimate.js')).href);
} catch (error) {
  console.error('Saf çekirdek derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}
process.on('exit', () => rmSync(outDir, { force: true, recursive: true }));

const { buildWorkoutEstimate, resolveHistoricalAverage, MAX_HISTORY_SAMPLES } = mod;

const T = Date.parse('2026-06-01T12:00:00.000Z'); // sabit "şimdi"
let seq = 0;
/** Tamamlanmış oturum kısayolu; completedAt artan sırada üretilir. */
function completed(over = {}) {
  seq += 1;
  return {
    id: `c${seq}`,
    programId: 'P',
    dayId: 'D',
    dateKey: '2026-01-01',
    status: 'completed',
    startedAt: '2026-01-01T10:00:00.000Z',
    lastResumedAt: undefined,
    accumulatedDurationSeconds: 3000,
    completedAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + seq * 86_400_000).toISOString(),
    ...over,
  };
}

// ===========================================================================
console.log('=== A. Geçmiş ortalama ===');
// ===========================================================================

check('A1. YALNIZ aynı program + gün', () => {
  const sessions = [
    completed({ accumulatedDurationSeconds: 3000 }),
    completed({ programId: 'OTHER', accumulatedDurationSeconds: 9999 }),
    completed({ dayId: 'OTHER', accumulatedDurationSeconds: 9999 }),
  ];
  const avg = resolveHistoricalAverage(sessions, 'P', 'D');
  assertEqual(avg.averageSeconds, 3000, 'ortalama');
  assertEqual(avg.sampleCount, 1, 'örnek sayısı');
});

check('A2. YALNIZ completed (running/paused hariç)', () => {
  const sessions = [
    completed({ accumulatedDurationSeconds: 3000 }),
    completed({ status: 'running', lastResumedAt: '2026-01-01T10:00:00.000Z', accumulatedDurationSeconds: 9999 }),
    completed({ status: 'paused', accumulatedDurationSeconds: 8888 }),
  ];
  const avg = resolveHistoricalAverage(sessions, 'P', 'D');
  assertEqual(avg.averageSeconds, 3000, 'yalnız completed sayıldı');
  assertEqual(avg.sampleCount, 1, 'örnek sayısı');
});

check('A3. En son EN FAZLA 5 örnek (recency, süreye göre değil)', () => {
  assertEqual(MAX_HISTORY_SAMPLES, 5, 'sabit 5');
  // En eski örnek çok büyük süreli ama DIŞLANMALI (6 örnekten en yeni 5'i).
  const sessions = [
    completed({ accumulatedDurationSeconds: 100000 }), // en eski → dışlanır
    completed({ accumulatedDurationSeconds: 100 }),
    completed({ accumulatedDurationSeconds: 200 }),
    completed({ accumulatedDurationSeconds: 300 }),
    completed({ accumulatedDurationSeconds: 400 }),
    completed({ accumulatedDurationSeconds: 500 }), // en yeni
  ];
  const avg = resolveHistoricalAverage(sessions, 'P', 'D');
  assertEqual(avg.sampleCount, 5, 'en fazla 5');
  assertEqual(avg.averageSeconds, 300, '(100+200+300+400+500)/5 — en eski dışlandı');
});

check('A4. 0 / geçersiz süre DIŞLANIR', () => {
  const sessions = [
    completed({ accumulatedDurationSeconds: 100 }),
    completed({ accumulatedDurationSeconds: 0 }),
    completed({ accumulatedDurationSeconds: -5 }),
    completed({ accumulatedDurationSeconds: Number.NaN }),
    completed({ accumulatedDurationSeconds: 300 }),
  ];
  const avg = resolveHistoricalAverage(sessions, 'P', 'D');
  assertEqual(avg.sampleCount, 2, 'yalnız geçerli iki örnek');
  assertEqual(avg.averageSeconds, 200, '(100+300)/2');
});

check('A5. ARİTMETİK ortalama', () => {
  const avg = resolveHistoricalAverage(
    [completed({ accumulatedDurationSeconds: 100 }), completed({ accumulatedDurationSeconds: 200 })],
    'P', 'D',
  );
  assertEqual(avg.averageSeconds, 150, '(100+200)/2');
});

check('A6. Geçmiş yoksa undefined', () => {
  assertEqual(resolveHistoricalAverage([], 'P', 'D'), undefined, 'boş');
  assertEqual(resolveHistoricalAverage([completed({ programId: 'X' })], 'P', 'D'), undefined, 'eşleşme yok');
});

check('A7. excludeSessionId örnekten çıkarır (bugünkü oturum dahil edilmez)', () => {
  const avg = resolveHistoricalAverage(
    [completed({ id: 'CUR', accumulatedDurationSeconds: 9999 }), completed({ accumulatedDurationSeconds: 100 })],
    'P', 'D', 'CUR',
  );
  assertEqual(avg.averageSeconds, 100, 'CUR dışlandı');
  assertEqual(avg.sampleCount, 1, 'tek örnek');
});

// ===========================================================================
console.log('\n=== B. Tahmin durumları ===');
// ===========================================================================

const history = () => [
  completed({ accumulatedDurationSeconds: 3000 }),
  completed({ accumulatedDurationSeconds: 3000 }),
]; // ortalama 3000 sn (50 dk)

check('B1. BAŞLAMAMIŞ: yaklaşık süre + kesin bitiş', () => {
  const est = buildWorkoutEstimate({ sessions: history(), programId: 'P', dayId: 'D', currentSession: undefined, now: T });
  assertEqual(est.status, 'not_started', 'durum');
  assertEqual(est.averageSeconds, 3000, 'ortalama');
  assertEqual(est.elapsedSeconds, 0, 'geçen süre 0');
  assertEqual(est.remainingSeconds, 3000, 'kalan = ortalama');
  assertEqual(est.exceeded, false, 'aşılmadı');
  assertEqual(est.finishAt, T + 3000 * 1000, 'bitiş = şimdi + ortalama');
});

check('B2. RUNNING: kalan süre ve kesin bitiş', () => {
  const current = {
    id: 'CUR', programId: 'P', dayId: 'D', dateKey: '2026-06-01', status: 'running',
    startedAt: new Date(T - 600_000).toISOString(),
    lastResumedAt: new Date(T - 600_000).toISOString(), // 600 sn önce
    accumulatedDurationSeconds: 0,
  };
  const est = buildWorkoutEstimate({ sessions: history(), programId: 'P', dayId: 'D', currentSession: current, now: T });
  assertEqual(est.status, 'running', 'durum');
  assertEqual(est.elapsedSeconds, 600, 'geçen 600 sn');
  assertEqual(est.remainingSeconds, 2400, '3000 - 600');
  assertEqual(est.exceeded, false, 'aşılmadı');
  assertEqual(est.finishAt, T + 2400 * 1000, 'bitiş = şimdi + kalan');
});

check('B3. PAUSED: kesin bitiş saati YOK', () => {
  const current = {
    id: 'CUR', programId: 'P', dayId: 'D', dateKey: '2026-06-01', status: 'paused',
    startedAt: '2026-06-01T11:00:00.000Z', accumulatedDurationSeconds: 600,
  };
  const est = buildWorkoutEstimate({ sessions: history(), programId: 'P', dayId: 'D', currentSession: current, now: T });
  assertEqual(est.status, 'paused', 'durum');
  assertEqual(est.elapsedSeconds, 600, 'geçen (birikmiş)');
  assertEqual(est.remainingSeconds, 2400, 'kalan');
  assertEqual(est.finishAt, undefined, 'paused bitiş saati yok');
  assertEqual(est.exceeded, false, 'aşılmadı');
});

check('B4. AŞILDI: negatif kalan yok, bitiş yok (running)', () => {
  const current = {
    id: 'CUR', programId: 'P', dayId: 'D', dateKey: '2026-06-01', status: 'running',
    startedAt: new Date(T - 3_600_000).toISOString(),
    lastResumedAt: new Date(T - 3_600_000).toISOString(), // 3600 sn > 3000
    accumulatedDurationSeconds: 0,
  };
  const est = buildWorkoutEstimate({ sessions: history(), programId: 'P', dayId: 'D', currentSession: current, now: T });
  assertEqual(est.exceeded, true, 'aşıldı');
  assertEqual(est.remainingSeconds, 0, 'kalan negatif değil, 0');
  assertEqual(est.finishAt, undefined, 'aşınca bitiş yok');
});

check('B5. AŞILDI: paused da bitiş göstermez', () => {
  const current = {
    id: 'CUR', programId: 'P', dayId: 'D', dateKey: '2026-06-01', status: 'paused',
    startedAt: '2026-06-01T10:00:00.000Z', accumulatedDurationSeconds: 4000,
  };
  const est = buildWorkoutEstimate({ sessions: history(), programId: 'P', dayId: 'D', currentSession: current, now: T });
  assertEqual(est.exceeded, true, 'aşıldı');
  assertEqual(est.remainingSeconds, 0, 'kalan 0');
  assertEqual(est.finishAt, undefined, 'bitiş yok');
});

check('B6. Geçmiş örnek yoksa tahmin undefined', () => {
  assertEqual(
    buildWorkoutEstimate({ sessions: [], programId: 'P', dayId: 'D', currentSession: undefined, now: T }),
    undefined,
    'boş geçmiş',
  );
});

check('B7. Bugünkü oturum COMPLETED ise tahmin GİZLENİR', () => {
  const current = {
    id: 'CUR', programId: 'P', dayId: 'D', dateKey: '2026-06-01', status: 'completed',
    startedAt: '2026-06-01T10:00:00.000Z', accumulatedDurationSeconds: 2000,
    completedAt: '2026-06-01T11:00:00.000Z',
  };
  assertEqual(
    buildWorkoutEstimate({ sessions: history(), programId: 'P', dayId: 'D', currentSession: current, now: T }),
    undefined,
    'tamamlanmış bugünkü oturumda tahmin yok',
  );
});

check('B8. Veritabanına yazma yok — saf türetme', () => {
  // Çekirdek yalnız girdi oturumlarını okur; supabase/fetch import etmez.
  const code = stripComments(source('utils/workout-estimate.ts'));
  assert(!/supabase|fetch\(|AsyncStorage/.test(code), 'çekirdek kalıcı kaynağa erişiyor');
});

// ===========================================================================
console.log('\n=== C. Ana sayfa kaynak sözleşmesi ===');
// ===========================================================================

const home = source('app/(tabs)/index.tsx');
const homeCode = stripComments(home);
const estimateUtil = stripComments(source('utils/workout-estimate.ts'));

check('C1. Çekirdek `getWorkoutDurationSeconds`i YENİDEN KULLANIR (kopya yok)', () => {
  assert(/getWorkoutDurationSeconds/.test(estimateUtil), 'yardımcı kullanılmıyor');
  // Kopya süre formülü (lastResumedAt aritmetiği) çekirdekte TEKRARLANMAZ.
  assert(!/lastResumedAt/.test(estimateUtil), 'süre formülü kopyalanmış');
});

check('C2. Home çekirdeği doğru argümanlarla çağırır', () => {
  assert(/buildWorkoutEstimate\(\{/.test(homeCode), 'çağrı yok');
  assert(/sessions: workoutSessions/.test(homeCode), 'workoutSessions verilmiyor');
  assert(/currentSession: todaySession/.test(homeCode), 'bugünkü oturum verilmiyor');
  assert(/now: Date\.now\(\)/.test(homeCode), 'now enjekte edilmiyor');
});

check('C3. Tahmin YALNIZ planlı (dinlenme olmayan) günde türetilir', () => {
  assert(/activeProgram && todayDay && !todayDay\.isOffDay/.test(homeCode), 'off-day/plansız guard yok');
  assert(/workoutEstimate &&/.test(homeCode), 'render guard yok');
});

check('C4. 30 sn yenileyici başlamamış/running tahmini tazeler; paused/tahminsizde kurulmaz', () => {
  assert(/const estimateStatus = workoutEstimate\?\.status/.test(homeCode), 'tahmin durumu türetilmiyor');
  assert(/!estimateStatus \|\| estimateStatus === 'paused'/.test(homeCode), 'tahminsiz/paused guard yok');
  assert(/setInterval\([^,]+,\s*30_?000\)/.test(homeCode), '30 sn aralık yok');
  assert(/\[estimateStatus\]/.test(homeCode), 'tahmin durumu effect bağımlılığında yok');
});

check('C5. İnce/sakin bilgi satırı — time-outline, textSecondary, tabular-nums', () => {
  assert(/name="time-outline"/.test(home), 'time-outline ikonu yok');
  assert(/color=\{colors\.textSecondary\}/.test(home), 'nötr renk yok');
  assert(/estimateText:.*fontVariant: \['tabular-nums'\]/.test(home), 'tabular-nums yok');
  assert(/\.\.\.Type\.footnote/.test(home.slice(home.indexOf('estimateText:'), home.indexOf('estimateText:') + 120)), 'mevcut tipografi ölçeği kullanılmıyor');
});

check('C6. Yeni büyük kart / gradient / emoji EKLENMEDİ', () => {
  assert(!/LinearGradient|expo-linear-gradient/.test(home), 'gradient var');
  assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(home), 'emoji var');
});

check('C7. Bitiş saati LOCALE-AWARE, 12/24 zorlanmıyor', () => {
  assert(/toLocaleTimeString\(locale/.test(home), 'locale-aware saat yok');
  assert(!/hour12:/.test(home), 'hour12 zorlanmış (cihaz tercihi bozulur)');
  assert(/DateTimeFormat\(undefined/.test(home), 'cihaz saat tercihi okunmuyor');
  assert(/resolvedOptions\(\)\.hourCycle/.test(home), 'cihaz hourCycle değeri çözümlenmiyor');
  assert(/hourCycle: systemHourCycle/.test(home), 'cihaz hourCycle uygulama dilindeki formattera aktarılmıyor');
});

check('C8. Yeni metinler TR ve EN\'de', () => {
  const tr = source('locales/tr.ts');
  const en = source('locales/en.ts');
  for (const key of [
    'estimateApproxDuration:', 'estimateStartFinish:', 'estimateRunningFinish:',
    'estimatePausedRemaining:', 'estimateExceeded:',
  ]) {
    assert(tr.includes(key) && en.includes(key), `çeviri eksik: ${key}`);
  }
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Antrenman süre tahmini harness: ${pass} kontrol geçti.`);
console.log('  (GERÇEK saf çekirdek derlenip çalıştırıldı; kopya algoritma test edilmedi.)');
