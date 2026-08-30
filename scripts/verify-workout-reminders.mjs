/**
 * Haftalık antrenman hatırlatıcıları — SAF çekirdek + sözleşme doğrulaması.
 *
 * A. DAVRANIŞSAL — GERÇEK `utils/workout-reminder-core.ts` Node'un yerleşik
 *    TypeScript type-stripping desteğiyle ÇAĞRILIR; kopya algoritma test EDİLMEZ.
 * B. YAPISAL — bildirim/context/ekran/ayar/layout/picker kaynaklarında güvenlik
 *    ve akış kurallarının GERÇEKTEN yazılı olduğu iddia edilir.
 *
 * Expo/AsyncStorage'a bağlanılmaz.
 *
 * Çalıştırma:  node scripts/verify-workout-reminders.mjs
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
function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} (beklenen ${e}, gelen ${a})`);
}

// ---------------------------------------------------------------------------
// GERÇEK çekirdeği yükle
// ---------------------------------------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), 'rosea-reminders-'));
let core;
try {
  const patched = source('utils/workout-reminder-core.ts')
    .replace(/from '@\/types\/reminders'/g, "from './types-reminders-shim'")
    .replace(/from '@\/types\/workout'/g, "from './types-workout-shim'");
  writeFileSync(join(outDir, 'workout-reminder-core.ts'), patched);
  if (process.features?.typescript) {
    core = await import(pathToFileURL(join(outDir, 'workout-reminder-core.ts')).href);
  } else {
    writeFileSync(join(outDir, 'types-workout-shim.ts'), 'export type Weekday = any;\n');
    writeFileSync(
      join(outDir, 'types-reminders-shim.ts'),
      'export type WorkoutReminder = any;\nexport type WorkoutReminderDraft = any;\n',
    );
    execFileSync(
      join(ROOT, 'node_modules', '.bin', 'tsc'),
      [join(outDir, 'workout-reminder-core.ts'), join(outDir, 'types-workout-shim.ts'),
       join(outDir, 'types-reminders-shim.ts'), '--outDir', outDir, '--target', 'es2020',
       '--module', 'esnext', '--moduleResolution', 'bundler', '--strict', '--skipLibCheck'],
      { cwd: ROOT, stdio: 'pipe' },
    );
    core = await import(pathToFileURL(join(outDir, 'workout-reminder-core.js')).href);
  }
} catch (error) {
  console.error('Saf çekirdek yüklenemedi:\n' + error.message);
  process.exit(1);
}
process.on('exit', () => rmSync(outDir, { force: true, recursive: true }));

const {
  MAX_REMINDERS,
  countEnabledReminders,
  findReminderConflict,
  normalizeWeekdays,
  parseStoredReminders,
  sortReminders,
  toExpoWeekday,
  validateReminderDraft,
  validateReminderSave,
} = core;

const reminder = (over = {}) => ({
  id: 'r1',
  weekdays: [1],
  hour: 18,
  minute: 30,
  enabled: true,
  notificationIds: ['n1'],
  ...over,
});

// ===========================================================================
console.log('=== A. Gün normalizasyonu ve Expo dönüşümü ===');
// ===========================================================================

check('A1. Günler BENZERSİZ ve Pazartesi→Pazar sıralı', () => {
  assertDeepEqual(normalizeWeekdays([0, 6, 1, 1, 3]), [1, 3, 6, 0], 'sıra/benzersizlik');
  assertDeepEqual(normalizeWeekdays([0]), [0], 'yalnız pazar');
  assertDeepEqual(normalizeWeekdays([]), [], 'boş');
});

check('A2. Geçersiz gün değerleri atılır', () => {
  assertDeepEqual(normalizeWeekdays([1, 7, -1, 2, 3.5]), [1, 2], 'yalnız 0–6 tam sayı');
});

check('A3. Expo weekday = Weekday + 1 (Pazar 0 → 1)', () => {
  assertEqual(toExpoWeekday(0), 1, 'pazar');
  assertEqual(toExpoWeekday(1), 2, 'pazartesi');
  assertEqual(toExpoWeekday(6), 7, 'cumartesi');
});

// ===========================================================================
console.log('\n=== B. Doğrulama (saat/dakika/gün/max) ===');
// ===========================================================================

check('B1. Saat 0–23, dakika 0–59 sınırları', () => {
  assertEqual(validateReminderDraft({ weekdays: [1], hour: 0, minute: 0, enabled: true }).ok, true, '00:00');
  assertEqual(validateReminderDraft({ weekdays: [1], hour: 23, minute: 59, enabled: true }).ok, true, '23:59');
  assertEqual(validateReminderDraft({ weekdays: [1], hour: 24, minute: 0, enabled: true }).reason, 'invalid_time', 'saat 24');
  assertEqual(validateReminderDraft({ weekdays: [1], hour: -1, minute: 0, enabled: true }).reason, 'invalid_time', 'saat -1');
  assertEqual(validateReminderDraft({ weekdays: [1], hour: 10, minute: 60, enabled: true }).reason, 'invalid_time', 'dakika 60');
});

check('B2. En az bir gün gerekir', () => {
  assertEqual(validateReminderDraft({ weekdays: [], hour: 10, minute: 0, enabled: true }).reason, 'no_days', 'boş gün');
  assertEqual(validateReminderDraft({ weekdays: [9], hour: 10, minute: 0, enabled: true }).reason, 'no_days', 'yalnız geçersiz gün');
});

check('B3. En fazla 5 reminder (yalnız YENİ eklemede)', () => {
  assertEqual(MAX_REMINDERS, 5, 'sabit 5');
  const five = [0, 1, 2, 3, 4].map((i) => reminder({ id: `r${i}`, hour: i }));
  const result = validateReminderSave(five, { weekdays: [1], hour: 20, minute: 0, enabled: true });
  assertEqual(result.reason, 'max_reached', 'altıncı reddedilir');
  // Düzenlemede (ignoreId) üst sınır uygulanmaz.
  assertEqual(
    validateReminderSave(five, { weekdays: [1], hour: 20, minute: 0, enabled: true }, 'r0').ok,
    true,
    'düzenleme üst sınıra takılmaz',
  );
});

// ===========================================================================
console.log('\n=== C. Çakışma ===');
// ===========================================================================

check('C1. İki AÇIK reminder aynı weekday/hour/minute paylaşamaz', () => {
  const existing = [reminder({ id: 'a', weekdays: [1, 3], hour: 18, minute: 30 })];
  const conflict = findReminderConflict(existing, { weekdays: [3, 5], hour: 18, minute: 30, enabled: true });
  assertEqual(conflict, 3, 'çakışan gün');
});

check('C2. Farklı dakika çakışmaz', () => {
  const existing = [reminder({ weekdays: [1], hour: 18, minute: 30 })];
  assertEqual(findReminderConflict(existing, { weekdays: [1], hour: 18, minute: 31, enabled: true }), undefined, 'dakika farkı');
});

check('C3. KAPALI taraf çakışmaz', () => {
  const existingDisabled = [reminder({ weekdays: [1], hour: 18, minute: 30, enabled: false })];
  assertEqual(findReminderConflict(existingDisabled, { weekdays: [1], hour: 18, minute: 30, enabled: true }), undefined, 'kapalı mevcut');
  const enabledExisting = [reminder({ weekdays: [1], hour: 18, minute: 30, enabled: true })];
  assertEqual(findReminderConflict(enabledExisting, { weekdays: [1], hour: 18, minute: 30, enabled: false }), undefined, 'kapalı aday');
});

check('C4. Düzenlemede kendisi hariç tutulur', () => {
  const existing = [reminder({ id: 'self', weekdays: [1], hour: 18, minute: 30 })];
  assertEqual(findReminderConflict(existing, { weekdays: [1], hour: 18, minute: 30, enabled: true }, 'self'), undefined, 'kendisi');
  assertEqual(validateReminderSave(existing, { weekdays: [1], hour: 18, minute: 30, enabled: true }, 'self').ok, true, 'kendi kaydı geçer');
  assertEqual(validateReminderSave(existing, { weekdays: [1], hour: 18, minute: 30, enabled: true }).reason, 'conflict', 'başka kayıt çakışır');
});

// ===========================================================================
console.log('\n=== D. Sıralama, sayım, parser fail-safe ===');
// ===========================================================================

check('D1. Saat sırasına göre sıralanır', () => {
  const list = [reminder({ id: 'a', hour: 20, minute: 0 }), reminder({ id: 'b', hour: 6, minute: 45 }), reminder({ id: 'c', hour: 6, minute: 5 })];
  assertDeepEqual(sortReminders(list).map((r) => r.id), ['c', 'b', 'a'], 'saat sonra dakika');
});

check('D2. countEnabledReminders yalnız açıkları sayar', () => {
  assertEqual(countEnabledReminders([reminder({ enabled: true }), reminder({ enabled: false }), reminder({ enabled: true })]), 2, 'sayım');
});

check('D3. Bozuk JSON fail-safe → boş dizi (çökme yok)', () => {
  assertDeepEqual(parseStoredReminders('{bozuk'), [], 'geçersiz json');
  assertDeepEqual(parseStoredReminders('null'), [], 'null');
  assertDeepEqual(parseStoredReminders('{"a":1}'), [], 'dizi değil');
  assertDeepEqual(parseStoredReminders(null), [], 'null girdi');
});

check('D4. Yalnız geçerli kayıtlar alınır; notificationIds KORUNUR ve sıralanır', () => {
  const raw = JSON.stringify([
    { id: 'ok2', weekdays: [3, 1], hour: 20, minute: 0, enabled: true, notificationIds: ['x', 'y'] },
    { id: 'bad-hour', weekdays: [1], hour: 99, minute: 0, enabled: true, notificationIds: [] },
    { id: 'bad-days', weekdays: [], hour: 8, minute: 0, enabled: true, notificationIds: [] },
    { weekdays: [1], hour: 8, minute: 0, enabled: true },
    { id: 'ok1', weekdays: [2], hour: 7, minute: 15, enabled: false, notificationIds: ['z'] },
  ]);
  const parsed = parseStoredReminders(raw);
  assertEqual(parsed.length, 2, 'yalnız iki geçerli');
  assertDeepEqual(parsed.map((r) => r.id), ['ok1', 'ok2'], 'saat sırası');
  assertDeepEqual(parsed[1].weekdays, [1, 3], 'günler normalize');
  assertDeepEqual(parsed[1].notificationIds, ['x', 'y'], 'ID korundu');
});

check('D5. Parser tekrar eden kayıt ve bildirim kimliklerini güvenli temizler', () => {
  const raw = JSON.stringify([
    reminder({ id: 'same', hour: 1, notificationIds: ['n1', 'n1', ''] }),
    reminder({ id: 'same', hour: 2, notificationIds: ['n2'] }),
    ...[3, 4, 5, 6, 7, 8].map((hour) => reminder({ id: `r${hour}`, hour })),
  ]);
  const parsed = parseStoredReminders(raw);
  assertEqual(parsed.filter((item) => item.id === 'same').length, 1, 'ID benzersiz');
  assertDeepEqual(parsed[0].notificationIds, ['n1'], 'bildirim ID temizliği');
});

// ===========================================================================
console.log('\n=== E. Bildirim güvenliği (kaynak) ===');
// ===========================================================================

const notif = source('utils/workout-reminders.ts');
const notifCode = stripComments(notif);

check('E1. Ayrı kanal ve ayrı type', () => {
  assert(/WORKOUT_REMINDER_TYPE = 'workout-tracker\/workout-reminder'/.test(notif), 'type yanlış');
  assert(/WORKOUT_REMINDER_CHANNEL = 'workout-reminders'/.test(notif), 'kanal yanlış');
});

check('E2. Haftalık trigger ve Weekday+1 dönüşümü', () => {
  assert(/SchedulableTriggerInputTypes\.WEEKLY/.test(notifCode), 'WEEKLY trigger yok');
  assert(/weekday: toExpoWeekday\(weekday\)/.test(notifCode), 'Expo dönüşümü kullanılmıyor');
});

check('E3. data yalnız type/ownerId/reminderId/weekday/url:"/"', () => {
  assert(/type: WORKOUT_REMINDER_TYPE/.test(notifCode), 'type yok');
  assert(/ownerId,/.test(notifCode) && /reminderId: reminder\.id/.test(notifCode), 'owner/reminder yok');
  assert(/url: WORKOUT_REMINDER_URL/.test(notifCode), 'url yok');
  assert(/WORKOUT_REMINDER_URL = '\/'/.test(notif), 'url / değil');
});

check('E4. Kısmi başarısızlıkta YENİ ID temizliği', () => {
  const scheduleBody = notifCode.slice(
    notifCode.indexOf('export async function scheduleReminderNotifications'),
    notifCode.indexOf('export async function cancelReminderNotificationIds'),
  );
  assert(/catch \(error\)/.test(scheduleBody), 'catch yok');
  assert(/cancelReminderNotificationIds\(Notifications, createdIds\)/.test(scheduleBody), 'yeni ID temizliği yok');
  assert(/throw error/.test(scheduleBody), 'hata yükseltilmiyor');
});

check('E5. Toplu iptal YALNIZ reminder type (rest/activity dokunulmaz)', () => {
  const cancelBody = notifCode.slice(
    notifCode.indexOf('export async function cancelAllReminderNotifications'),
    notifCode.length,
  );
  assert(/data\?\.type !== WORKOUT_REMINDER_TYPE/.test(cancelBody), 'type filtresi yok');
  assert(/data\?\.ownerId === ownerId/.test(cancelBody), 'ownerId filtresi yok');
  assert(!/REST_NOTIFICATION_TYPE|ACTIVITY_NOTIFICATION_TYPE/.test(notif), 'rest/activity type referansı var');
});

check('E6. Global notification handler YENİDEN KURULMAZ', () => {
  assert(!/setNotificationHandler/.test(notif), 'handler yeniden kuruluyor');
});

check('E7. Response gözlemcisi yalnız reminder type + tam "/" kabul eder', () => {
  const listenerBody = notifCode.slice(notifCode.indexOf('addReminderResponseListener'), notifCode.length);
  assert(/data\?\.type === WORKOUT_REMINDER_TYPE && data\?\.url === WORKOUT_REMINDER_URL/.test(listenerBody), 'type+url kontrolü yok');
  assert(/getLastNotificationResponseAsync/.test(listenerBody), 'soğuk açılış yanıtı işlenmiyor');
  assert(/clearLastNotificationResponseAsync/.test(listenerBody), 'işlenen eski yanıt temizlenmiyor');
});

check('E8. Owner-scoped storage anahtarı', () => {
  assert(/return `\$\{STORAGE_PREFIX\}:\$\{userId\}`/.test(notifCode), 'kullanıcıya özel anahtar yok');
});

// ===========================================================================
console.log('\n=== F. Context — izin/atomiklik/hesap guard (kaynak) ===');
// ===========================================================================

const ctx = source('context/workout-reminder-context.tsx');
const ctxCode = stripComments(ctx);

check('F1. İzin YALNIZ save/enable yolunda istenir (mount değil)', () => {
  const persistBody = ctxCode.slice(ctxCode.indexOf('const persistReminder'), ctxCode.indexOf('const saveReminder'));
  assert(/if \(normalizedDraft\.enabled\) \{[\s\S]*ensureReminderPermission\(\)/.test(persistBody), 'izin yalnız açıkken istenmiyor');
  // Reconcile yükte İZİN İSTEMEZ; yalnız zaten verilmişse planlar.
  assert(/if \(!\(await hasReminderPermission\(\)\)\) return loaded;/.test(ctxCode), 'yükte izin istenmiyor guard yok');
});

check('F2. İzin reddi: AÇIK kaydetmez, permission_denied döner', () => {
  assert(/if \(!Notifications\) return \{ ok: false, reason: 'permission_denied' \}/.test(ctxCode), 'izin reddi işlenmiyor');
});

check('F3. Atomik güncelleme: planla → sakla → eski ID iptal', () => {
  const persistBody = ctxCode.slice(ctxCode.indexOf('const persistReminder'), ctxCode.indexOf('const saveReminder'));
  const scheduleIdx = persistBody.indexOf('scheduleReminderNotifications');
  const saveIdx = persistBody.indexOf('saveReminders(ownerId, nextList)');
  const cancelIdx = persistBody.indexOf('cancelReminderIds(previousIds)');
  assert(
    scheduleIdx !== -1 && saveIdx !== -1 && cancelIdx !== -1 && scheduleIdx < saveIdx && saveIdx < cancelIdx,
    'sıra yanlış (eski plan veya kalıcı kayıt kaybı riski)',
  );
  assert(/catch \{[\s\S]*cancelReminderIds\(notificationIds\)/.test(persistBody), 'kayıt hatasında yeni plan geri alınmıyor');
  assert(/reason: 'schedule_failed'/.test(persistBody), 'kısmi başarısızlıkta eski plan korunmuyor');
});

check('F6. Yükleme uzlaştırması eski planı ancak yeni kayıt saklandıktan sonra siler', () => {
  const reconcileBody = ctxCode.slice(ctxCode.indexOf('const reconcileOnLoad'), ctxCode.indexOf('useEffect(() => {', ctxCode.indexOf('const reconcileOnLoad')));
  const scheduleIdx = reconcileBody.indexOf('scheduleReminderNotifications');
  const saveIdx = reconcileBody.indexOf('saveReminders(ownerId, reconciled)');
  const cancelOldIdx = reconcileBody.indexOf('loaded.flatMap');
  assert(scheduleIdx !== -1 && saveIdx !== -1 && cancelOldIdx !== -1, 'uzlaştırma adımları eksik');
  assert(scheduleIdx < saveIdx && saveIdx < cancelOldIdx, 'uzlaştırma atomik sırası yanlış');
  assert(/catch \{[\s\S]*cancelReminderIds\(createdIds\)/.test(reconcileBody), 'uzlaştırma hatasında yeni planlar temizlenmiyor');
});

check('F4. Hesap değişimi guard\'ı (eski cevap yeni hesabı ezmez)', () => {
  assert(/ownerRef\.current !== ownerId/.test(ctxCode), 'ownership guard yok');
  assert(/ownerRef\.current !== userId/.test(ctxCode), 'yükleme guard yok');
});

check('F5. Çıkışta owner-scoped iptal; tanımlar KALIR', () => {
  assert(/return \(\) => \{[\s\S]*cancelAllReminderNotifications\(userId\)/.test(ctxCode), 'çıkışta owner iptali yok');
  // Çıkış temizliği AsyncStorage tanımlarını silmez.
  assert(!/AsyncStorage[\s\S]*removeItem/.test(ctxCode), 'tanımlar siliniyor');
});

// ===========================================================================
console.log('\n=== G. Ekran / Ayarlar / Layout / Picker (kaynak) ===');
// ===========================================================================

const screen = source('app/reminders.tsx');
const settings = source('app/settings.tsx');
const layout = source('app/_layout.tsx');

check('G1. Ekran açılışında izin İSTENMEZ', () => {
  assert(!/ensureReminderPermission|requestPermissionsAsync/.test(screen), 'ekran izin istiyor');
});

check('G2. İzin reddinde "Ayarları Aç" sunulur; seçimler korunur', () => {
  assert(/Linking\.openSettings\(\)/.test(screen), 'Ayarları Aç yok');
  assert(/reminders\.openSettings/.test(screen), 'openSettings metni yok');
  // permission_denied dalında editör kapatılmaz (seçimler kaybolmaz).
  const saveBody = stripComments(screen).slice(stripComments(screen).indexOf('async function handleSave'), stripComments(screen).indexOf('function confirmDelete'));
  assert(/permission_denied[\s\S]*showPermissionAlert\(\);\s*return;/.test(saveBody), 'izin reddinde editör kapanıyor');
});

check('G3. Ayarlar satırı: notifications-outline + /reminders + sayı alt metni', () => {
  assert(/name="notifications-outline"/.test(settings), 'ikon yok');
  assert(/router\.push\('\/reminders'\)/.test(settings), 'yönlendirme yok');
  assert(/settingsSubtitleEmpty|settingsSubtitleCount/.test(settings), 'alt metin sayısı yok');
});

check('G4. Layout: provider keyli ağaçta + reminder rotası + yalnız "/" gezinme', () => {
  assert(/<WorkoutReminderProvider>/.test(layout), 'provider mount edilmemiş');
  assert(/name="reminders"/.test(layout), 'stack rotası yok');
  assert(/addReminderResponseListener\(\(\) => router\.push\('\/'\)\)/.test(layout), 'yalnız / gezinme yok');
});

check('G5. Native/web picker ayrımı', () => {
  const native = source('components/time-picker.native.tsx');
  const web = source('components/time-picker.web.tsx');
  assert(/@react-native-community\/datetimepicker/.test(native), 'native picker importu yok');
  assert(!/@react-native-community\/datetimepicker/.test(web), 'web fallback native importu içeriyor');
  // is24Hour zorlanmaz (cihaz tercihi korunur). Yorumlar sıyrılır: açıklama
  // metnindeki referans "zorlama" sayılmaz.
  assert(!/is24Hour/.test(stripComments(native)), 'is24Hour zorlanmış');
});

check('G6. Bildirim metni kişisel veri/program/egzersiz adı içermez', () => {
  assert(/reminders\.notificationTitle/.test(ctx) && /reminders\.notificationBody/.test(ctx), 'sabit metin kullanılmıyor');
  const tr = source('locales/tr.ts');
  const en = source('locales/en.ts');
  for (const key of ['notificationTitle:', 'notificationBody:', 'permissionBody:', 'errorConflict:']) {
    assert(tr.includes(key) && en.includes(key), `çeviri eksik: ${key}`);
  }
  // Bildirim gövdesinde program/egzersiz interpolasyonu YOK. Kontrol YALNIZ
  // reminders bölümüne daraltılır (mola bildiriminin ayrı `notificationBody`si
  // parametre içerir ve buraya karışmamalıdır).
  const reminderBlock = (src) => src.slice(src.indexOf('  reminders: {'), src.indexOf('  exerciseLibrary: {'));
  assert(!/notificationBody:[^\n]*\{/.test(reminderBlock(tr)), 'TR reminder gövdesinde parametre var');
  assert(!/notificationBody:[^\n]*\{/.test(reminderBlock(en)), 'EN reminder gövdesinde parametre var');
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Antrenman hatırlatıcıları harness: ${pass} kontrol geçti.`);
console.log('  (GERÇEK saf çekirdek yüklenip çalıştırıldı; kopya algoritma test edilmedi.)');
