/**
 * History → Gelişim görünümünün yeniden tasarımı için DAR KAPSAMLI UI sözleşme
 * harness'ı.
 *
 * SINIR: React render EDİLMEZ; bu tarama kaynak metnin görsel sözleşmesini
 * ölçer. Analitik matematiği ve son-8 davranışı `verify-activity-timer-and-
 * history.mjs` içinde GERÇEK yardımcılar derlenerek zaten test edilir; burada
 * yalnızca sunum katmanının şu güvenceleri korunur:
 *
 *   * Dört büyük kart kaldırıldı; tek dikey akış + `hairlineWidth` ayırıcı.
 *   * Emoji, gradient, gölge ve büyük dekoratif ikon yok.
 *   * Rastgele renk yok — yalnız tema tokenları ve `historyProgress` rengi.
 *   * Grafik hesabı, metrik sekmeleri, karşılaştırma ve rekor listesi korunur.
 *   * Kardiyo "Aktivite geçmişi" bölümü de kart yerine sade satırlara döner.
 *
 * Çalıştırma:  node scripts/verify-progress-ui.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const progressRaw = source('components/exercise-progress.tsx');
const progress = stripComments(progressRaw);
const historyRaw = source('app/(tabs)/history.tsx');
const history = stripComments(historyRaw);

// ===========================================================================
console.log('=== A. Tek dikey akış, kart yığını yok ===');
// ===========================================================================

check('A1. Dört büyük kart kaldırıldı', () => {
  // Eski tasarım her bölümü `styles.card` (kendi zemini + 22 köşe) sarıyordu.
  assert(!/styles\.card\b/.test(progress), 'hâlâ styles.card kullanılıyor');
  assert(!/card:\s*\{/.test(progress), 'card stili hâlâ tanımlı');
  assert(!/borderRadius:\s*22/.test(progress), 'büyük kart köşesi kalmış');
});

check('A2. Bölümler hairline ayırıcıyla ayrılıyor', () => {
  assert(/StyleSheet\.hairlineWidth/.test(progress), 'hairline ayırıcı yok');
  assert(/divider:\s*\{[^}]*hairlineWidth/.test(progress), 'divider hairline değil');
  // Akışta en az iki bölüm ayırıcısı (karşılaştırma / grafik / rekor arası).
  assert((progress.match(/styles\.divider/g) ?? []).length >= 3, 'yeterli bölüm ayırıcı yok');
});

check('A3. Özet tek satır — üç ayrı mini kart değil', () => {
  assert(/summaryRow:\s*\{[^}]*flexDirection:\s*'row'/.test(progress), 'özet satırı yatay değil');
  // Dikey ayırıcı ile ayrılmış tek satır.
  assert(/summaryDivider:\s*\{/.test(progress), 'özet dikey ayırıcı yok');
  assert(/width:\s*StyleSheet\.hairlineWidth/.test(progress), 'özet ayırıcı hairline değil');
  // Özet hücrelerinin kendi kart zemini olmamalı.
  assert(!/summaryItem:\s*\{[^}]*backgroundColor/.test(progress), 'özet hücresinde kart zemini var');
});

// ===========================================================================
console.log('\n=== B. Dekorasyon yok ===');
// ===========================================================================

check('B1. Emoji yok', () => {
  assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(progressRaw), 'emoji var');
});

check('B2. Gradient, gölge ve elevation yok', () => {
  assert(!/LinearGradient|expo-linear-gradient/.test(progressRaw), 'gradient var');
  assert(!/shadowColor|shadowOpacity|shadowRadius|elevation:/.test(progress), 'gölge/elevation var');
});

check('B3. Büyük dekoratif ikonlar kaldırıldı', () => {
  // Eski büyük/şablon ikonlar: boş durum grafiği, rekor ve özet kupası.
  assert(!/trending-up-outline/.test(progress), 'büyük boş-durum ikonu kalmış');
  assert(!/analytics-outline/.test(progress), 'grafik boş-durum ikonu kalmış');
  assert(!/name="trophy"/.test(progress), 'dekoratif kupa ikonu kalmış');
  // Kalan Ionicons yalnız işlevsel olmalı (seçici oku, yön oku, değişim oku).
  const icons = progressRaw.match(/name="([a-z-]+)"/g) ?? [];
  const allowed = new Set([
    'name="chevron-down"', 'name="arrow-forward"', 'name="arrow-up"', 'name="arrow-down"',
    'name="search"', 'name="close"', 'name="close-circle"', 'name="checkmark"',
  ]);
  for (const icon of icons) assert(allowed.has(icon), `beklenmeyen ikon: ${icon}`);
});

check('B4. Rastgele renk yok — yalnız tema tokenları', () => {
  // Kaynakta ham hex renk bulunmamalı; renkler `colors.*` ve `accentColor`dan.
  assert(!/#[0-9A-Fa-f]{3,8}\b/.test(progress), 'ham hex renk var');
  assert(/useFeatureColor\('historyProgress'/.test(progress), 'historyProgress feature rengi kullanılmıyor');
});

// ===========================================================================
console.log('\n=== C. Korunan analitik davranışlar ===');
// ===========================================================================

check('C1. Analitik matematiği aynı yardımcıdan', () => {
  assert(/buildExerciseAnalytics/.test(progress), 'buildExerciseAnalytics çağrılmıyor');
});

check('C2. Grafik hesabı ve son 8 kayıt korunuyor', () => {
  assert(/\.slice\(-8\)/.test(progress), 'son 8 kayıt davranışı kaybolmuş');
  assert(/getMetricValue\(point, selectedMetric\)/.test(progress), 'metrik değeri hesabı değişmiş');
  assert(/value !== undefined && item\.value > 0/.test(progress), 'sıfır/tanımsız filtresi kaybolmuş');
  assert(/chartPoints\.length >= 2/.test(progress), 'iki kayıt eşiği değişmiş');
  // Çubuk yüksekliği yine orana bağlı (oran hesabı sabit kalır).
  assert(/\(value \/ maxValue\) \* CHART_BAR_HEIGHT/.test(progress), 'çubuk oranı hesabı değişmiş');
});

check('C3. Metrik sekmeleri weight / strength / volume', () => {
  for (const key of ['weight', 'strength', 'volume']) {
    assert(new RegExp(`key: '${key}'`).test(progress), `metrik eksik: ${key}`);
  }
  // Alt çizgi sekme; kutu/kart değil.
  assert(/metricTabSelected:\s*\{[^}]*borderBottomColor/.test(progress), 'seçili sekme alt çizgi değil');
});

check('C4. Son–önceki karşılaştırma ve değişim korunuyor', () => {
  assert(/getPerformanceChange\(/.test(progress), 'değişim hesabı yok');
  assert(/previousPerformance/.test(progress) && /latestPerformance/.test(progress), 'karşılaştırma değerleri yok');
});

check('C5. Rekor geçmişi sade liste', () => {
  assert(/recordHistory\.slice\(0, 6\)/.test(progress), 'rekor geçmişi limiti değişmiş');
  assert(/recordList:\s*\{/.test(progress), 'rekor listesi yok');
  // Satırlar hairline ile bölünür, kart değil.
  assert(/divided && styles\.rowDivided/.test(progress), 'rekor satırları hairline ile bölünmüyor');
});

check('C6. Egzersiz seçici modalı ve arama korunuyor', () => {
  assert(/ExercisePickerModal/.test(progress), 'seçici modalı yok');
  assert(/t\('progress\.searchExercises'\)/.test(progress), 'arama alanı yok');
  // Seçici en az 44 pt dokunma alanı.
  assert(/pickerRow:\s*\{[^}]*minHeight:\s*Layout\.minTouchSize/.test(progress), 'seçici 44 pt değil');
});

// ===========================================================================
console.log('\n=== D. History kardiyo aktivite bölümü ===');
// ===========================================================================

check('D1. Aktivite bölümü kart zemininden çıktı', () => {
  assert(!/activitySection:\s*\{[^}]*backgroundColor:\s*colors\.card/.test(history), 'aktivite bölümü hâlâ kart');
  assert(!/activitySection:\s*\{[^}]*borderRadius/.test(history), 'aktivite bölümü hâlâ yuvarlak kart');
});

check('D2. Başlık + sade satır + hairline ayırıcı', () => {
  assert(/activitySectionTitle/.test(history), 'aktivite başlığı yok');
  assert(/activityProgressRowDivided:\s*\{[^}]*hairlineWidth/.test(history), 'satırlar hairline ile bölünmüyor');
});

check('D3. Kardiyo-only verisi görünmeye devam ediyor', () => {
  // Redesign koşulu bozmadı: kardiyo-only kullanıcı hâlâ bu bölümü görür.
  assert(/activityProgressEntries\.length > 0/.test(history), 'aktivite bölümü koşulu kaybolmuş');
  assert(/t\('history\.activityHistory'\)/.test(history), 'aktivite başlığı çevirisi yok');
  assert(/t\('history\.activityRecordCount'/.test(history), 'kayıt sayısı çevirisi yok');
});

check('D4. Mesafe / süre / tempo hesapları değişmedi', () => {
  assert(/formatMetersAsKilometers\(entry\.lastDistanceMeters\)/.test(history), 'mesafe biçimi değişmiş');
  assert(/formatDuration\(Math\.round\(entry\.lastPaceSecondsPerKm\)\)/.test(history), 'tempo hesabı değişmiş');
  assert(/formatDuration\(entry\.lastDurationSeconds\)/.test(history), 'süre biçimi değişmiş');
});

check('D5. Aktivite bölümünde emoji ve gradient yok', () => {
  const section = historyRaw.slice(
    historyRaw.indexOf('activityProgressEntries.length > 0'),
    historyRaw.indexOf('</MotionSection>'),
  );
  assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(section), 'emoji var');
  assert(!/LinearGradient/.test(section), 'gradient var');
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Progress UI sözleşme harness'ı: ${pass} kontrol geçti.`);
console.log('  (Analitik matematiği ve son-8 davranışı ayrı harness\'ta GERÇEK yardımcılarla test edilir.)');
