/**
 * Faz 2C — kardiyo kronometresi, hedef bildirimi ve activity-aware history.
 *
 * SINIR: React render edilmez, AsyncStorage/Supabase'e bağlanılmaz. GERÇEK saf
 * yardımcılar (`utils/activity-timer.ts`, `utils/activity-history.ts`,
 * `utils/workout-tracking.ts`, `utils/workout-sets.ts`) `tsc` ile derlenip
 * ÇAĞRILIR — kopya algoritma test EDİLMEZ.
 *
 * Zaman `now` parametresiyle enjekte edilir; hiçbir kontrol gerçek saatin
 * ilerlemesini beklemez, dolayısıyla `setInterval` drift'i doğrudan ölçülebilir.
 *
 * Çalıştırma:  node scripts/verify-activity-timer-and-history.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');
/**
 * Sözleşme taramaları GERÇEK KODU ölçer, açıklama metnini değil. Yorumlar
 * çıkarılmazsa "molaya dokunmuyor" gibi bir iddia, o dosyanın açıklamasında
 * geçen kelimeye takılıp yanlış yere düşerdi.
 */
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const codeOf = (relative) => stripComments(source(relative));

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

const outDir = mkdtempSync(join(tmpdir(), 'rosea-timer-history-'));
let timer;
let history;

try {
  const shim = join(outDir, 'types-workout-shim.ts');
  writeFileSync(
    shim,
    [
      'ProgramExercise', 'NewProgramExercise', 'WorkoutActivityRecord', 'WorkoutVisual',
      'WorkoutSetRecord', 'WorkoutTrackingMode', 'StrengthProgramExercise',
      'DurationProgramExercise', 'DistanceProgramExercise',
    ]
      .map((name) => `export type ${name} = any;\n`)
      .join(''),
  );

  for (const [relative, outName] of [
    ['utils/workout-sets.ts', 'workout-sets'],
    ['utils/workout-tracking.ts', 'workout-tracking'],
    ['utils/activity-timer.ts', 'activity-timer'],
    ['utils/activity-history.ts', 'activity-history'],
  ]) {
    const patched = source(relative)
      .replace(/from '@\/types\/workout'/g, "from './types-workout-shim'")
      .replace(/from '@\/utils\/workout-sets'/g, "from './workout-sets.js'")
      .replace(/from '@\/utils\/workout-tracking'/g, "from './workout-tracking.js'")
      .replace(/from '@\/utils\/activity-timer'/g, "from './activity-timer.js'");
    const copy = join(outDir, `${outName}.ts`);
    writeFileSync(copy, patched);
    execFileSync(
      'npx',
      ['tsc', copy, shim, '--outDir', outDir, '--target', 'es2020', '--module', 'esnext',
       '--moduleResolution', 'bundler', '--strict', '--skipLibCheck'],
      { cwd: ROOT, stdio: 'pipe' },
    );
  }

  timer = await import(pathToFileURL(join(outDir, 'activity-timer.js')).href);
  history = await import(pathToFileURL(join(outDir, 'activity-history.js')).href);
} catch (error) {
  console.error('Saf yardımcılar derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}

const {
  ACTIVITY_TIMER_KEY_PREFIX,
  ACTIVITY_TIMER_MAX_SECONDS,
  createActivityTimer,
  formatActivityOvertime,
  formatActivityTimerValue,
  getActivityNotificationDelaySeconds,
  getActivityTimerElapsedSeconds,
  getActivityTimerProgress,
  getActivityTimerStorageKey,
  parseStoredActivityTimer,
  pauseActivityTimer,
  resumeActivityTimer,
} = timer;
const {
  buildActivityHistoryEntries,
  buildActivityProgressEntries,
  countUniqueExercises,
  summarizeSessionActivity,
} = history;

const T0 = 1_760_000_000_000; // sabit başlangıç anı (ms)
const startDuration = (target = 600) =>
  createActivityTimer({
    sessionId: 's1', programExerciseId: 'plank', exerciseName: 'Plank',
    trackingMode: 'duration', targetDurationSeconds: target, now: T0,
  });
const startDistance = () =>
  createActivityTimer({
    sessionId: 's1', programExerciseId: 'run', exerciseName: 'Koşu',
    trackingMode: 'distance', now: T0,
  });

// ===========================================================================
console.log('=== A. Kronometre temeli ===');
// ===========================================================================

check('A1. Başlangıçta 0, çalışıyor', () => {
  const t = startDuration();
  assertEqual(t.status, 'running', 'durum');
  assertEqual(t.accumulatedSeconds, 0, 'birikmiş süre');
  assertEqual(getActivityTimerElapsedSeconds(t, T0), 0, 'ilk elapsed');
});

check('A2. Geçen süre GERÇEK SAAT farkından gelir', () => {
  const t = startDuration();
  assertEqual(getActivityTimerElapsedSeconds(t, T0 + 1_000), 1, '1 sn');
  assertEqual(getActivityTimerElapsedSeconds(t, T0 + 90_000), 90, '90 sn');
  assertEqual(getActivityTimerElapsedSeconds(t, T0 + 3_600_000), 3600, '1 saat');
});

check('A3. MUT — `setInterval` sayan model DRIFT eder, gerçek model etmez', () => {
  // Arka planda 300 sn geçti ama timer yalnız 120 kez tick alabildi.
  const ticks = 120;
  const realSeconds = 300;
  assert(ticks !== realSeconds, 'senaryo drift içermiyor — mutasyon geçersiz');
  const t = startDuration();
  assertEqual(
    getActivityTimerElapsedSeconds(t, T0 + realSeconds * 1000),
    realSeconds,
    'gerçek model tick sayısına kaymış',
  );
});

check('A4. Geçmişe giden saat NEGATİF süre üretmez', () => {
  const t = startDuration();
  assertEqual(getActivityTimerElapsedSeconds(t, T0 - 60_000), 0, 'negatif elapsed');
});

check('A5. 24 saatlik DB üst sınırında KIRPILIR', () => {
  const t = startDuration();
  assertEqual(ACTIVITY_TIMER_MAX_SECONDS, 86400, 'üst sınır sabiti');
  assertEqual(
    getActivityTimerElapsedSeconds(t, T0 + 90_000_000),
    86400,
    'üst sınır aşıldı — DB reddederdi',
  );
});

// ===========================================================================
console.log('\n=== B. Duraklat / devam et ===');
// ===========================================================================

check('B1. Duraklatma süreyi DONDURUR', () => {
  const running = startDuration();
  const paused = pauseActivityTimer(running, T0 + 120_000);
  assertEqual(paused.status, 'paused', 'durum');
  assertEqual(paused.accumulatedSeconds, 120, 'birikmiş süre');
  assertEqual(paused.startedAt, undefined, 'startedAt bırakılmadı');
  // Duraklamada bir saat geçse bile ölçüm 120 sn kalır.
  assertEqual(getActivityTimerElapsedSeconds(paused, T0 + 3_720_000), 120, 'duraklamada sayıyor');
});

check('B2. Devam etme YALNIZ kalan süreyi ekler', () => {
  const paused = pauseActivityTimer(startDuration(), T0 + 120_000);
  // 10 dakika duraklamada beklendi, sonra devam edildi ve 60 sn daha koşuldu.
  const resumed = resumeActivityTimer(paused, T0 + 720_000);
  assertEqual(resumed.status, 'running', 'durum');
  assertEqual(resumed.accumulatedSeconds, 120, 'birikmiş süre değişti');
  assertEqual(getActivityTimerElapsedSeconds(resumed, T0 + 780_000), 180, 'toplam 120+60 değil');
});

check('B3. MUT — duraklamayı ölçüme ekleyen model düşer', () => {
  const paused = pauseActivityTimer(startDuration(), T0 + 120_000);
  const resumed = resumeActivityTimer(paused, T0 + 720_000);
  // Bozuk model: baştan sona geçen duvar saati.
  const wallClock = Math.floor((T0 + 780_000 - T0) / 1000);
  assertEqual(wallClock, 780, 'bozuk model doğru sayıyor — mutasyon geçersiz');
  assertEqual(getActivityTimerElapsedSeconds(resumed, T0 + 780_000), 180, 'gerçek model duraklamayı ekliyor');
});

check('B4. Tekrarlı duraklat/devam birikimlidir', () => {
  let t = startDuration();
  t = pauseActivityTimer(t, T0 + 60_000);          // 60
  t = resumeActivityTimer(t, T0 + 600_000);
  t = pauseActivityTimer(t, T0 + 660_000);         // +60 = 120
  t = resumeActivityTimer(t, T0 + 1_200_000);
  assertEqual(getActivityTimerElapsedSeconds(t, T0 + 1_230_000), 150, '60+60+30 değil');
});

check('B5. Aynı duruma ikinci çağrı ETKİSİZ', () => {
  const running = startDuration();
  assertEqual(resumeActivityTimer(running, T0 + 5_000), running, 'çalışan resume ile değişti');
  const paused = pauseActivityTimer(running, T0 + 60_000);
  assertEqual(pauseActivityTimer(paused, T0 + 120_000), paused, 'duraklamış pause ile değişti');
});

// ===========================================================================
console.log('\n=== C. Hedef, fazla süre, gösterim ===');
// ===========================================================================

check('C1. Hedefe kalan süre', () => {
  const p = getActivityTimerProgress(startDuration(600), T0 + 200_000);
  assertEqual(p.remainingSeconds, 400, 'kalan');
  assertEqual(p.overtimeSeconds, 0, 'fazla süre');
  assertEqual(p.isTargetReached, false, 'hedef doldu sayıldı');
});

check('C2. Hedef TAM dolduğunda bir kez ulaşılır', () => {
  const t = startDuration(600);
  assertEqual(getActivityTimerProgress(t, T0 + 599_000).isTargetReached, false, '599 sn');
  assertEqual(getActivityTimerProgress(t, T0 + 600_000).isTargetReached, true, '600 sn');
  assertEqual(getActivityTimerProgress(t, T0 + 601_000).isTargetReached, true, '601 sn');
});

check('C3. Fazla süre ve `+MM:SS` biçimi', () => {
  const p = getActivityTimerProgress(startDuration(600), T0 + 632_000);
  assertEqual(p.overtimeSeconds, 32, 'fazla süre');
  assertEqual(p.remainingSeconds, 0, 'kalan sıfırlanmadı');
  assertEqual(formatActivityOvertime(p.overtimeSeconds), '+00:32', 'biçim');
});

check('C4. Kronometre biçimi', () => {
  assertEqual(formatActivityTimerValue(0), '00:00', 'sıfır');
  assertEqual(formatActivityTimerValue(65), '01:05', 'dakika');
  assertEqual(formatActivityTimerValue(3661), '1:01:01', 'saat');
  assertEqual(formatActivityTimerValue(-5), '00:00', 'negatif');
});

check('C5. Mesafe türünde SÜRE HEDEFİ yoktur', () => {
  const p = getActivityTimerProgress(startDistance(), T0 + 3_600_000);
  assertEqual(p.elapsedSeconds, 3600, 'süre sayılmıyor');
  assertEqual(p.isTargetReached, false, 'mesafe türünde hedef doldu sayıldı');
  assertEqual(p.remainingSeconds, 0, 'kalan üretildi');
  assertEqual(p.overtimeSeconds, 0, 'fazla süre üretildi');
});

// ===========================================================================
console.log('\n=== D. Bildirim planlama ===');
// ===========================================================================

check('D1. Duration timer KALAN süre için bildirim ister', () => {
  assertEqual(getActivityNotificationDelaySeconds(startDuration(600), T0), 600, 'başlangıç');
});

check('D2. Devam etmede YALNIZ kalan süre planlanır', () => {
  const paused = pauseActivityTimer(startDuration(600), T0 + 200_000);
  const resumed = resumeActivityTimer(paused, T0 + 900_000);
  assertEqual(
    getActivityNotificationDelaySeconds(resumed, T0 + 900_000),
    400,
    'kalan süre yerine tam hedef planlandı',
  );
});

check('D3. Hedef DOLDUYSA yeni bildirim planlanmaz', () => {
  assertEqual(
    getActivityNotificationDelaySeconds(startDuration(600), T0 + 700_000),
    undefined,
    'hedef dolmuşken planlandı',
  );
});

check('D4. DISTANCE türü bildirim ÜRETMEZ', () => {
  assertEqual(
    getActivityNotificationDelaySeconds(startDistance(), T0),
    undefined,
    'mesafe türünde bildirim planlandı — GPS olmadan hedef bilinemez',
  );
  // Süre hedefi verilmiş olsa bile tür kapısı önce gelir.
  const distanceWithTarget = { ...startDistance(), targetDurationSeconds: 600 };
  assertEqual(
    getActivityNotificationDelaySeconds(distanceWithTarget, T0),
    undefined,
    'mesafe türünde süre hedefi bildirim üretti',
  );
});

check('D5. Duraklatma bildirim kimliğini BIRAKIR', () => {
  const running = { ...startDuration(600), notificationId: 'n1' };
  const paused = pauseActivityTimer(running, T0 + 60_000);
  assertEqual(paused.notificationId, undefined, 'duraklamada kimlik korunuyor — iptal izlenemez');
});

// ===========================================================================
console.log('\n=== E. Kalıcılık ve geri yükleme ===');
// ===========================================================================

check('E1. Depo anahtarı session + exercise ile İZOLE', () => {
  assertEqual(
    getActivityTimerStorageKey('s1', 'plank'),
    `${ACTIVITY_TIMER_KEY_PREFIX}:s1:plank`,
    'anahtar biçimi',
  );
  assert(
    getActivityTimerStorageKey('s1', 'plank') !== getActivityTimerStorageKey('s1', 'run'),
    'aynı oturumda egzersizler çakışıyor',
  );
  assert(
    getActivityTimerStorageKey('s1', 'plank') !== getActivityTimerStorageKey('s2', 'plank'),
    'oturumlar çakışıyor',
  );
  // Mola sayacının ön ekiyle çakışmamalı.
  assert(!ACTIVITY_TIMER_KEY_PREFIX.startsWith('workout-rest-timer'), 'mola ön ekiyle çakışıyor');
});

check('E2. APP RESTART — çalışan kayıt geri yüklenir, arka plan süresi korunur', () => {
  const t = startDuration(600);
  const restored = parseStoredActivityTimer(JSON.stringify(t));
  assert(restored !== undefined, 'geri yüklenemedi');
  assertEqual(restored.status, 'running', 'durum');
  // Uygulama 5 dakika kapalıydı; süre yine de doğru.
  assertEqual(getActivityTimerElapsedSeconds(restored, T0 + 300_000), 300, 'arka plan süresi kayboldu');
});

check('E3. APP RESTART — duraklatılmış kayıt sayarak dönmez', () => {
  const paused = pauseActivityTimer(startDuration(600), T0 + 120_000);
  const restored = parseStoredActivityTimer(JSON.stringify(paused));
  assertEqual(restored.status, 'paused', 'durum');
  assertEqual(getActivityTimerElapsedSeconds(restored, T0 + 9_999_000), 120, 'duraklamışken saydı');
});

check('E4. BOZUK kayıt sessizce varsayılana çevrilmez', () => {
  const valid = startDuration(600);
  const bad = [
    ['null', null],
    ['boş', ''],
    ['JSON değil', '{oops'],
    ['timerId yok', JSON.stringify({ ...valid, timerId: undefined })],
    ['sessionId yok', JSON.stringify({ ...valid, sessionId: undefined })],
    ['egzersiz yok', JSON.stringify({ ...valid, programExerciseId: undefined })],
    ['bilinmeyen tür', JSON.stringify({ ...valid, trackingMode: 'sets_reps' })],
    ['negatif birikim', JSON.stringify({ ...valid, accumulatedSeconds: -5 })],
    ['NaN birikim', JSON.stringify({ ...valid, accumulatedSeconds: 'x' })],
    ['bilinmeyen durum', JSON.stringify({ ...valid, status: 'stopped' })],
    ['running ama startedAt yok', JSON.stringify({ ...valid, startedAt: undefined })],
  ];
  for (const [label, raw] of bad) {
    assertEqual(parseStoredActivityTimer(raw), undefined, `sessizce kabul edildi: ${label}`);
  }
});

check('E5. Geçersiz hedef sessizce sıfıra düşmez, ATILIR', () => {
  const restored = parseStoredActivityTimer(
    JSON.stringify({ ...startDuration(600), targetDurationSeconds: -1 }),
  );
  assert(restored !== undefined, 'kayıt tamamen reddedildi');
  assertEqual(restored.targetDurationSeconds, undefined, 'geçersiz hedef korunmuş');
  assertEqual(getActivityNotificationDelaySeconds(restored, T0), undefined, 'hedefsizde bildirim');
});

check('E6. Depo modülü kendi ÖN EKİNİ temizler, molaya dokunmaz', () => {
  const storage = codeOf('utils/activity-timer-storage.ts');
  assert(/key\.startsWith\(`\$\{ACTIVITY_TIMER_KEY_PREFIX\}:`\)/.test(storage), 'toplu temizlik filtresiz');
  assert(!/workout-rest-timer/.test(storage), 'mola ön ekine dokunuyor');
  assert(/export async function clearAllActivityTimers/.test(storage), 'logout temizliği yok');
  const restStorage = codeOf('utils/rest-timer-storage.ts');
  assert(!/activity-timer/.test(restStorage), 'mola modülü aktivite kaydına dokunuyor');
});

// ===========================================================================
console.log('\n=== F. Kaynak sözleşmesi — timer ve kayıt ===');
// ===========================================================================

const screen = source('app/program/[id]/day/[dayId]/index.tsx');
const context = source('context/workout-context.tsx');
const notifications = codeOf('utils/activity-notifications.ts');
const historyScreen = source('app/(tabs)/history.tsx');
const tr = source('locales/tr.ts');
const en = source('locales/en.ts');

check('F1. Manuel süre girişi HİÇBİR normal kullanıcı yolunda yok', () => {
  assert(!/activityMinutesInput|activitySecondsInput/.test(screen), 'manuel dakika/saniye alanı kalmış');
  assert(!/parseMinutesSecondsToSeconds/.test(screen), 'manuel süre ayrıştırma kalmış');
  assert(/getActivityTimerProgress\(activityTimer, Date\.now\(\)\)\.elapsedSeconds/.test(screen),
    'süre kronometreden alınmıyor');
});

check('F2. Timer YALNIZ başarılı yazmadan sonra temizlenir', () => {
  const submitBody = screen.slice(
    screen.indexOf('async function submitActivity()'),
    screen.indexOf('function confirmClearActivity()'),
  );
  assert(submitBody.length > 500, 'submitActivity gövdesi bulunamadı');
  const saveAt = submitBody.indexOf('await saveActivityRecord(');
  const clearAt = submitBody.indexOf('await removeActivityTimer(');
  assert(saveAt >= 0 && clearAt >= 0 && saveAt < clearAt, 'timer kayıttan önce temizleniyor');
  // Temizlik `try` içinde ve `catch` sonrası DEĞİL: hata olursa çalışmaz.
  const catchAt = submitBody.indexOf('} catch (error) {');
  assert(catchAt > clearAt, 'temizlik hata dalından sonra çalışıyor — DB hatasında timer kaybolur');
});

check('F3. Hedef dolması aktiviteyi OTOMATİK bitirmez', () => {
  // Bitirme yalnız kullanıcı eylemiyle: `finishActivityMeasurement` tek çağıran.
  const autoFinish = screen.match(/finishActivityMeasurement\(\)/g) ?? [];
  assert(autoFinish.length > 0, 'bitirme fonksiyonu hiç çağrılmıyor');
  assert(!/isTargetReached[\s\S]{0,200}finishActivityMeasurement/.test(screen),
    'hedef dolunca otomatik bitiriliyor');
  assert(!/isTargetReached[\s\S]{0,200}saveActivityRecord/.test(screen),
    'hedef dolunca otomatik kaydediliyor');
});

check('F4. Duraklat bildirim iptal eder, devam KALAN için yeniden planlar', () => {
  const pauseBody = screen.slice(
    screen.indexOf('async function pauseActivityMeasurement()'),
    screen.indexOf('async function resumeActivityMeasurement()'),
  );
  const resumeBody = screen.slice(
    screen.indexOf('async function resumeActivityMeasurement()'),
    screen.indexOf('function confirmCancelMeasurement()'),
  );
  assert(/cancelActivityTargetNotification\(activityTimer\.notificationId\)/.test(pauseBody),
    'duraklamada bildirim iptal edilmiyor');
  assert(!/scheduleActivityTarget\(/.test(pauseBody), 'duraklamada bildirim planlanıyor');
  assert(/scheduleActivityTarget\(resumed\)/.test(resumeBody), 'devam etmede yeniden planlanmıyor');
});

check('F5. Bildirim izni reddi kronometreyi ENGELLEMEZ', () => {
  assert(/if \(!Notifications\) return undefined;/.test(notifications), 'izinsizde undefined dönmüyor');
  const scheduleBody = screen.slice(
    screen.indexOf('async function scheduleActivityTarget('),
    screen.indexOf('async function startActivityMeasurement()'),
  );
  assert(/\.catch\(\(\) => undefined\)/.test(scheduleBody), 'planlama hatası yutulmuyor');
  assert(/if \(!notificationId\) return;/.test(scheduleBody), 'kimliksizde akış durmuyor');
  // Başlatma bildirimden ÖNCE kalıcı yazar ve bildirimi beklemez.
  const startBody = screen.slice(
    screen.indexOf('async function startActivityMeasurement()'),
    screen.indexOf('async function pauseActivityMeasurement()'),
  );
  const persistAt = startBody.indexOf('await persistActivityTimer(timer)');
  const notifyAt = startBody.indexOf('void scheduleActivityTarget(timer)');
  assert(persistAt >= 0 && notifyAt >= 0 && persistAt < notifyAt, 'bildirim ölçümün önkoşulu olmuş');
});

check('F6. Aktivite bildirimi mola kanalından AYRI', () => {
  assert(/activity-timer/.test(notifications), 'ayrı kanal yok');
  assert(/workout-tracker\/activity-target/.test(notifications), 'ayrı type yok');
  assert(/kind: ACTIVITY_NOTIFICATION_KIND/.test(notifications), 'kind alanı yok');
  assert(/sessionId: target\.sessionId/.test(notifications), 'session kimliği yok');
  assert(/programExerciseId: target\.programExerciseId/.test(notifications), 'egzersiz kimliği yok');
  // Toplu iptal yalnız kendi türünü filtreler.
  assert(
    /data\?\.type === ACTIVITY_NOTIFICATION_TYPE/.test(notifications),
    'toplu iptal filtresiz — mola bildirimlerini de silerdi',
  );
  const restNotifications = codeOf('utils/rest-notifications.ts');
  assert(!/activity-target/.test(restNotifications), 'mola modülü aktivite bildirimine dokunuyor');
  // İşleyici tek yerde kurulur; burada tekrar kurulmaz.
  assert(!/setNotificationHandler/.test(notifications), 'işleyici ikinci kez kuruluyor');
});

check('F7. WORKOUT PAUSE → activity pause; resume otomatik başlatmaz', () => {
  const screenCode = stripComments(screen);
  const toggleBody = screenCode.slice(
    screenCode.indexOf('async function handleWorkoutToggle()'),
    screenCode.indexOf('async function finishCurrentWorkout('),
  );
  assert(/await pauseWorkout\([\s\S]{0,200}await pauseActivityMeasurement\(\)/.test(toggleBody),
    'antrenman duraklarken ölçüm durmuyor');
  assert(!/await resumeWorkout\([\s\S]{0,200}resumeActivityMeasurement\(\)/.test(toggleBody),
    'antrenman devam edince ölçüm kendiliğinden başlıyor');
});

check('F8. WORKOUT FINISH kaydedilmemiş ölçümü sessizce ATMAZ', () => {
  const finishBody = screen.slice(
    screen.indexOf('async function finishCurrentWorkout('),
    screen.indexOf('async function handleCompleteSet('),
  );
  assert(/if \(activityTimer\) \{/.test(finishBody), 'çalışan ölçüm kontrol edilmiyor');
  assert(/t\('day\.returnToActivity'\)/.test(finishBody), 'aktiviteye dön seçeneği yok');
  assert(/t\('day\.saveActivity'\)/.test(finishBody), 'kaydet seçeneği yok');
  assert(/t\('day\.cancelMeasurement'\)/.test(finishBody), 'iptal seçeneği yok');
  const guardAt = finishBody.indexOf('if (activityTimer) {');
  const finishAt = finishBody.indexOf('await finishWorkout(sessionId)');
  assert(guardAt >= 0 && finishAt >= 0 && guardAt < finishAt, 'uyarı bitişten sonra geliyor');
});

check('F9. Ölçüm iptali KAYITLI DB satırına dokunmaz', () => {
  const cancelBody = screen.slice(
    screen.indexOf('function confirmCancelMeasurement()'),
    screen.indexOf('async function finishActivityMeasurement()'),
  );
  assert(/removeActivityTimer\(/.test(cancelBody), 'timer silinmiyor');
  assert(!/deleteActivityRecord\(/.test(cancelBody), 'iptal DB kaydını siliyor');
  assert(!/saveActivityRecord\(/.test(cancelBody), 'iptal DB yazıyor');
});

check('F10. Logout/hesap değişimi kronometreleri TEMİZLER', () => {
  assert(/void clearAllActivityTimers\(\);/.test(context), 'logout temizliği yok');
  assert(/void cancelAllActivityTargetNotifications\(\);/.test(context), 'bildirim temizliği yok');
  const resetBlock = context.slice(
    Math.max(0, context.indexOf('void clearAllActivityTimers();') - 1200),
    context.indexOf('void clearAllActivityTimers();'),
  );
  assert(/if \(!user\)/.test(resetBlock), 'temizlik oturum kapanışına bağlı değil');
});

check('F11. Ayarlardaki MOLA tercihi kronometreyi kapatmaz', () => {
  const settings = source('app/settings.tsx');
  assert(!/activity-timer|ActivityTimer|clearAllActivityTimers/.test(settings),
    'mola tercihi aktivite kronometresine bağlanmış');
  // Kronometre kontrolleri `restTimerEnabled` ile koşullanmamalı.
  const panel = screen.slice(
    screen.indexOf('{activeCardioExercise && ('),
    screen.indexOf('{!activeCardioExercise && activeExercise && ('),
  );
  assert(!/restTimerEnabled/.test(panel), 'kronometre paneli mola tercihine bağlı');
});

check('F12. Soft-delete yerel aktivite kayıtlarını da AYIRIR', () => {
  const deleteBody = context.slice(
    context.indexOf('async function deleteWorkoutSession('),
    context.indexOf('async function deleteProgram('),
  );
  assert(/setWorkoutActivityRecords\(\(current\) => current\.filter\(/.test(deleteBody),
    'silinen oturumun kayıtları yerel state\'te kalıyor');
  assert(/setWorkoutActivityRecords\(previousActivityRecords\);/.test(deleteBody),
    'hata durumunda geri alınmıyor');
  // `activityTotals` KANIT olduğu için bilinçli olarak dokunulmaz.
  assert(!/setActivityTotals\(/.test(deleteBody), 'disiplin kanıtı silmede değiştiriliyor');
});

// ===========================================================================
console.log('\n=== G. History — özet ve benzersiz egzersiz ===');
// ===========================================================================

const setRecord = (over) => ({
  id: 'set1', sessionId: 's1', programExerciseId: 'bench', exerciseName: 'Bench',
  dateKey: '2026-09-10', setNumber: 1, dropSets: [], completedAt: '2026-09-10T10:00:00Z', ...over,
});
const activityRecord = (over) => ({
  id: 'act1', sessionId: 's1', programExerciseId: 'run', exerciseName: 'Koşu',
  trackingMode: 'distance', durationSeconds: 1500, distanceMeters: 5000,
  targetDistanceMeters: 5000, completedAt: '2026-09-10T10:30:00Z', dateKey: '2026-09-10', ...over,
});

check('G1. CARDIO-ONLY oturum geçmişte görünür', () => {
  const summary = summarizeSessionActivity({
    sets: [], activityRecords: [activityRecord({})], durationSeconds: 2880,
  });
  assertEqual(summary.setCount, 0, 'set sayısı');
  assertEqual(summary.activityCount, 1, 'aktivite sayısı');
  assertEqual(summary.uniqueExerciseCount, 1, 'benzersiz egzersiz');
  // Eski model set sayısına bakardı ve bu oturumu boş sayardı.
  assert(summary.activityCount > 0, 'aktivite görünmüyor');
});

check('G2. MIXED oturum set + aktivite birlikte', () => {
  const summary = summarizeSessionActivity({
    sets: [setRecord({ id: 's1' }), setRecord({ id: 's2', setNumber: 2 })],
    activityRecords: [activityRecord({})],
    durationSeconds: 2880,
  });
  assertEqual(summary.setCount, 2, 'set sayısı');
  assertEqual(summary.activityCount, 1, 'aktivite sayısı');
  assertEqual(summary.uniqueExerciseCount, 2, 'benzersiz egzersiz');
});

check('G3. AYNI egzersiz iki kez SAYILMAZ', () => {
  const summary = summarizeSessionActivity({
    sets: [setRecord({ programExerciseId: 'x', exerciseName: 'Kürek' })],
    activityRecords: [activityRecord({ programExerciseId: 'x', exerciseName: 'Kürek' })],
    durationSeconds: 600,
  });
  assertEqual(summary.uniqueExerciseCount, 1, 'aynı egzersiz iki kez sayıldı');
});

check('G4. Genel benzersiz egzersiz metriği strength + aktivite', () => {
  const sets = [
    setRecord({ programExerciseId: 'bench', exerciseName: 'Bench' }),
    setRecord({ id: 's2', programExerciseId: 'squat', exerciseName: 'Squat' }),
  ];
  const activities = [
    activityRecord({ programExerciseId: 'run', exerciseName: 'Koşu' }),
    activityRecord({ id: 'a2', programExerciseId: 'run', exerciseName: 'Koşu' }),
  ];
  assertEqual(countUniqueExercises(sets, activities), 3, 'benzersiz sayı');
  // MUT: yalnız setleri sayan eski model 2 üretirdi.
  assertEqual(countUniqueExercises(sets, []), 2, 'eski model 2 üretmiyor — mutasyon geçersiz');
});

check('G5. Program silinmişse SNAPSHOT adı kullanılır', () => {
  const orphan = activityRecord({ programExerciseId: undefined, exerciseName: 'Silinmiş Koşu' });
  const entries = buildActivityHistoryEntries([orphan]);
  assertEqual(entries[0].exerciseName, 'Silinmiş Koşu', 'snapshot adı kaybolmuş');
  // Kimliksiz iki farklı ad ayrı egzersiz sayılır.
  assertEqual(
    countUniqueExercises([], [orphan, activityRecord({ id: 'a2', programExerciseId: undefined, exerciseName: 'Başka' })]),
    2, 'kimliksiz kayıtlar birleşti',
  );
});

// ===========================================================================
console.log('\n=== H. History — kayıt detayları ===');
// ===========================================================================

check('H1. DURATION alanları', () => {
  const [entry] = buildActivityHistoryEntries([
    activityRecord({
      trackingMode: 'duration', durationSeconds: 700, targetDurationSeconds: 600,
      targetDistanceMeters: undefined, distanceMeters: undefined, rpe: 7,
    }),
  ]);
  assertEqual(entry.trackingMode, 'duration', 'tür');
  assertEqual(entry.durationSeconds, 700, 'süre');
  assertEqual(entry.targetDurationSeconds, 600, 'hedef snapshot');
  assertEqual(entry.rpe, 7, 'RPE');
  assertEqual(entry.isTargetReached, true, 'hedef durumu');
  assertEqual(entry.paceSecondsPerKm, undefined, 'mesafesiz tempo üretildi');
});

check('H2. DURATION hedefin altında', () => {
  const [entry] = buildActivityHistoryEntries([
    activityRecord({
      trackingMode: 'duration', durationSeconds: 500, targetDurationSeconds: 600,
      targetDistanceMeters: undefined, distanceMeters: undefined,
    }),
  ]);
  assertEqual(entry.isTargetReached, false, 'hedefin altı tamamlandı sayıldı');
});

check('H3. DISTANCE alanları ve TEMPO türetimi', () => {
  const [entry] = buildActivityHistoryEntries([activityRecord({})]);
  assertEqual(entry.distanceMeters, 5000, 'mesafe');
  assertEqual(entry.durationSeconds, 1500, 'süre');
  assertEqual(entry.targetDistanceMeters, 5000, 'hedef snapshot');
  assertEqual(entry.isTargetReached, true, 'hedef durumu');
  // 5 km / 1500 sn = 300 sn/km
  assertEqual(entry.paceSecondsPerKm, 300, 'tempo yanlış');
});

check('H4. DISTANCE hedefin altında; süre hedefi ÖLÇÜT DEĞİL', () => {
  const [entry] = buildActivityHistoryEntries([
    activityRecord({ distanceMeters: 4000, durationSeconds: 99999 }),
  ]);
  assertEqual(entry.isTargetReached, false, 'uzun süre hedefi tamamladı');
});

check('H5. Kayıtlar `completedAt` sırasına göre', () => {
  const entries = buildActivityHistoryEntries([
    activityRecord({ id: 'c', completedAt: '2026-09-10T12:00:00Z' }),
    activityRecord({ id: 'a', completedAt: '2026-09-10T10:00:00Z' }),
    activityRecord({ id: 'b', completedAt: '2026-09-10T11:00:00Z' }),
  ]);
  assertDeepEqual(entries.map((entry) => entry.id), ['a', 'b', 'c'], 'sıralama');
});

check('H6. Değerler DB birimlerinde kalır (metre / saniye)', () => {
  const [entry] = buildActivityHistoryEntries([activityRecord({})]);
  assert(Number.isInteger(entry.distanceMeters), 'mesafe tam sayı metre değil');
  assert(Number.isInteger(entry.durationSeconds), 'süre tam sayı saniye değil');
  assertEqual(entry.distanceMeters, 5000, 'mesafe km\'ye çevrilmiş');
});

// ===========================================================================
console.log('\n=== I. Progress — sade aktivite bölümü ===');
// ===========================================================================

check('I1. Egzersiz başına son kayıt ve toplam sayı', () => {
  const entries = buildActivityProgressEntries([
    activityRecord({ id: 'a1', completedAt: '2026-09-01T10:00:00Z', distanceMeters: 3000, durationSeconds: 1200 }),
    activityRecord({ id: 'a2', completedAt: '2026-09-08T10:00:00Z', distanceMeters: 5000, durationSeconds: 1500 }),
    activityRecord({
      id: 'p1', programExerciseId: 'plank', exerciseName: 'Plank', trackingMode: 'duration',
      distanceMeters: undefined, durationSeconds: 600, completedAt: '2026-09-05T10:00:00Z',
    }),
  ]);
  assertEqual(entries.length, 2, 'egzersiz sayısı');
  // En yeni kayıttan eskiye sıralı.
  assertEqual(entries[0].exerciseName, 'Koşu', 'sıralama');
  assertEqual(entries[0].recordCount, 2, 'kayıt sayısı');
  assertEqual(entries[0].lastDistanceMeters, 5000, 'son mesafe');
  assertEqual(entries[0].lastPaceSecondsPerKm, 300, 'son tempo');
  assertEqual(entries[1].exerciseName, 'Plank', 'ikinci egzersiz');
  assertEqual(entries[1].lastDurationSeconds, 600, 'son süre');
  assertEqual(entries[1].lastPaceSecondsPerKm, undefined, 'mesafesiz tempo üretildi');
});

check('I2. Kayıt yoksa bölüm BOŞ döner', () => {
  assertDeepEqual(buildActivityProgressEntries([]), [], 'boş girdide satır üretildi');
});

check('I3. CARDIO-ONLY kullanıcı "veri yok" görmez', () => {
  assert(/activityProgressEntries\.length > 0/.test(historyScreen), 'aktivite bölümü koşulu yok');
  assert(
    /\(completedWorkoutSets\.length > 0 \|\| activityProgressEntries\.length === 0\)/.test(historyScreen),
    'kardiyo-only kullanıcıya boş strength kartı gösteriliyor',
  );
  // Yeni grafik paketi eklenmedi.
  assert(!/victory|react-native-svg-charts|chart\.js/i.test(historyScreen), 'yeni grafik paketi');
});

check('I4. History aktivite kayıtlarını CONTEXT\'ten alıyor', () => {
  assert(/workoutActivityRecords,/.test(historyScreen), 'context alımı yok');
  assert(/completedSessionIds\.has\(record\.sessionId\)/.test(historyScreen), 'tamamlanmış oturum filtresi yok');
  assert(/countUniqueExercises\(completedWorkoutSets, completedActivityRecords\)/.test(historyScreen),
    'benzersiz metrik aktiviteyi saymıyor');
  assert(/buildActivityHistoryEntries/.test(historyScreen), 'detay satırları ortak yardımcıdan değil');
});

check('I5. Boş durum artık SET yokluğuna bağlı değil', () => {
  assert(/completedSessions\.length === 0/.test(historyScreen), 'boş durum koşulu değişmiş');
  assert(
    /exerciseGroups\.length === 0 && activityEntries\.length === 0/.test(historyScreen),
    'detay boş durumu aktiviteyi hesaba katmıyor',
  );
});

// ===========================================================================
console.log('\n=== J. UI ve lokalizasyon ===');
// ===========================================================================

check('J1. Kronometre erişilebilir', () => {
  assert(/accessibilityRole="timer"/.test(screen), 'timer rolü yok');
  assert(/accessibilityValue=\{\{ text: activityTimerAccessibilityText \}\}/.test(screen),
    'VoiceOver değeri okumuyor');
  assert(/t\('day\.activityTimerLabel'/.test(screen), 'kronometre etiketi yok');
  assert(/minHeight: Layout\.minTouchSize/.test(screen), '44 pt kontrol yok');
});

check('J2. Emoji, gradient ve yeni asset YOK', () => {
  for (const [name, file] of [['screen', screen], ['history', historyScreen],
                              ['timer', source('utils/activity-timer.ts')]]) {
    assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(file), `${name}: emoji var`);
    assert(!/LinearGradient|expo-linear-gradient/.test(file), `${name}: gradient var`);
  }
});

check('J3. GPS / HealthKit / Strava / pedometre YOK', () => {
  for (const file of [stripComments(screen), stripComments(historyScreen), notifications,
                      codeOf('utils/activity-timer.ts')]) {
    assert(!/expo-location|Geolocation|HealthKit|Strava|Pedometer|expo-sensors/i.test(file),
      'yasak konum/sağlık kaynağı');
  }
});

check('J4. Bütün yeni metinler LOKALİZE', () => {
  const dayKeys = [
    'startActivity', 'pauseActivity', 'resumeActivity', 'finishActivity',
    'saveAndFinishActivity', 'backToWorkout', 'remeasureActivity', 'cancelMeasurement',
    'cancelMeasurementBody', 'targetRemaining', 'targetReached', 'overtimeLabel',
    'activityTargetNotificationBody', 'runningActivityTitle', 'runningActivityBody',
    'returnToActivity', 'activityTimerLabel', 'activityRunningState', 'activityPausedState',
    'savedActivitySummary', 'activityStartFailed',
  ];
  const historyKeys = [
    'activityCount', 'activityHistory', 'activityRecordCount', 'activityTarget',
    'activityPace', 'activityDistance', 'activityDuration', 'activityCompleted',
    'activityBelowTarget',
  ];
  for (const key of [...dayKeys, ...historyKeys]) {
    assert(new RegExp(`\\n    ${key}:`).test(tr), `tr.ts eksik: ${key}`);
    assert(new RegExp(`\\n    ${key}:`).test(en), `en.ts eksik: ${key}`);
  }
});

check('J5. Kardiyo panelinde satır içi kullanıcı metni YOK', () => {
  const panel = screen.slice(
    screen.indexOf('{activeCardioExercise && ('),
    screen.indexOf('{!activeCardioExercise && activeExercise && ('),
  );
  const literals = panel.match(/>[^<>{}]*[A-Za-zÇĞİÖŞÜçğıöşü]{3,}[^<>{}]*</g) ?? [];
  assertDeepEqual(literals, [], `satır içi metin: ${literals.join(' | ')}`);
});

check('J6. Bitirme adımı YENİ MODAL yığını açmıyor', () => {
  const panel = screen.slice(
    screen.indexOf('{activeCardioExercise && ('),
    screen.indexOf('{!activeCardioExercise && activeExercise && ('),
  );
  assert(!/<Modal/.test(panel), 'panelde yeni Modal var');
  assert(/isFinishingActivity && \(/.test(panel), 'bitirme adımı panel içinde değil');
});

check('J7. Yan yana kronometre düğmeleri hizalı', () => {
  /**
   * `Bitir` = [completeSetPill, activityPrimaryButton]. `completeSetPill`
   * tekil kullanım için `alignSelf: 'center'`, `marginTop: 8`, `minWidth: 200`,
   * `paddingHorizontal: 32` taşır; yan yana kullanımda bunlar `Bitir`'i stretch
   * dışına çıkarıp aşağı kaydırır ve genişliği bozar. `activityPrimaryButton`
   * bu değerleri AÇIKÇA ezmelidir; yoksa `flex: 1` tek başına yetmez.
   */
  const primary = screen.slice(
    screen.indexOf('activityPrimaryButton: {'),
    screen.indexOf('activityButtonText:'),
  );
  assert(/alignSelf: 'stretch'/.test(primary), 'primary stretch değil');
  assert(/marginTop: 0/.test(primary), 'primary marginTop sıfırlanmadı');
  assert(/minWidth: 0/.test(primary), 'primary minWidth sıfırlanmadı');
  assert(/flex: 1/.test(primary), 'primary flex yok');
  assert(/paddingHorizontal: 16/.test(primary), 'primary dar padding yok');

  // İkincil düğme de sabit bir minWidth'e sıkışmamalı.
  const secondary = screen.slice(
    screen.indexOf('activitySecondaryButton: {'),
    screen.indexOf('activitySecondaryText:'),
  );
  assert(/minWidth: 0/.test(secondary), 'secondary minWidth sıfırlanmadı');

  // 52 pt yükseklik (>=44 pt dokunma) `completeSetPill` üzerinden korunur ve
  // ikincil düğme satır içinde ona stretch olur.
  assert(/minHeight: 52/.test(screen), 'primary 52 pt yükseklik yok');
  assert(/activityControls: \{[^}]*alignSelf: 'stretch'[^}]*flexDirection: 'row'/.test(screen),
    'satır stretch/row değil');

  // Yan yana bloktaki iki metin de tek satıra sabitlenmiş ve ortalı olmalı.
  const controlsOpen = screen.indexOf('<View style={styles.activityControls}>');
  const row = screen.slice(controlsOpen, screen.indexOf('</View>', controlsOpen));
  assert((row.match(/numberOfLines=\{1\}/g) ?? []).length >= 2,
    'yan yana metinler tek satıra sabitlenmedi');
  assert((row.match(/styles\.activityButtonText/g) ?? []).length >= 2,
    'yan yana metinlerde ortalı stil yok');
});

check('J8. Geç dönen hedef bildirimi duraklatılmış veya yeniden başlamış ölçüme bağlanmaz', () => {
  const storage = codeOf('utils/activity-timer-storage.ts');
  const activityScreen = codeOf('app/program/[id]/day/[dayId]/index.tsx');
  assert(/current\.status !== 'running'/.test(storage), 'duraklatılmış ölçüm kapısı yok');
  assert(/current\.startedAt !== expectedStartedAt/.test(storage), 'ölçüm sürümü başlangıç damgasıyla doğrulanmıyor');
  assert(/timer\.startedAt,\s*notificationId/.test(activityScreen), 'planlanan ölçümün başlangıç damgası attach çağrısına verilmiyor');
});

// ---------------------------------------------------------------------------

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Aktivite kronometresi ve geçmişi harness: ${pass} kontrol geçti.`);
console.log('  (GERÇEK saf yardımcılar derlenip çalıştırıldı; kopya algoritma test edilmedi.)');
