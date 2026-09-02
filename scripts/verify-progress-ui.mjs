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
const activityProgressRaw = source('components/activity-progress.tsx');
const activityProgress = stripComments(activityProgressRaw);

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
console.log('\n=== D. History kardiyo gelişim bölümü (ActivityProgress) ===');
// ===========================================================================
//
// Basit "Aktivite geçmişi" listesi gerçek bir kardiyo gelişim bileşeniyle
// (`components/activity-progress.tsx`) DEĞİŞTİRİLDİ. Bu bölüm o bileşenin
// sunum sözleşmesini ve History'nin doğru koşullarla onu yerleştirdiğini
// denetler. Analitik matematiği `verify-activity-analytics.mjs` içinde GERÇEK
// çekirdek çalıştırılarak test edilir.

check('D1. Kardiyo gelişimi kart yığını değil, tek dikey akış', () => {
  assert(!/styles\.card\b/.test(activityProgress), 'kardiyo gelişimi hâlâ styles.card kullanıyor');
  assert(!/borderRadius:\s*2[24]\b/.test(activityProgress), 'büyük kart köşesi kalmış');
  assert(/divider:\s*\{[^}]*hairlineWidth/.test(activityProgress), 'hairline ayırıcı yok');
});

check('D2. Seçici + özet + metrik sekmeleri + grafik + son kayıtlar', () => {
  assert(/pickerRow:\s*\{[^}]*minHeight:\s*Layout\.minTouchSize/.test(activityProgress), 'seçici 44 pt değil');
  assert(/metricTabs:\s*\{/.test(activityProgress) && /metricTabSelected/.test(activityProgress), 'metrik sekmeleri yok');
  assert(/toActivityChartBars\(/.test(activityProgress), 'çubuk grafik çekirdeği kullanılmıyor');
  assert(/recentRecordsTitle/.test(activityProgress), 'son kayıtlar bölümü yok');
});

check('D3. Kardiyo-only verisi görünmeye devam ediyor', () => {
  // Redesign koşulu bozmadı: kardiyo-only kullanıcı ActivityProgress'i görür;
  // strength YALNIZCA set kaydı varken çizilir (boş strength görünmez).
  assert(/<ActivityProgress\b/.test(history), 'History ActivityProgress bileşenini kullanmıyor');
  assert(/completedActivityRecords\.length > 0 && \(\s*<ActivityProgress/.test(history),
    'ActivityProgress kardiyo kaydı koşuluna bağlı değil');
  assert(/completedWorkoutSets\.length > 0 && \(\s*<ExerciseProgress/.test(history),
    'strength yalnız set varken çizilmiyor (kardiyo-only boş strength riski)');
});

check('D4. Mesafe / süre / tempo hesapları analitik çekirdekten', () => {
  // Türetme ve biçimlendirme mevcut saf yardımcılardan gelir; ikinci algoritma yok.
  assert(/buildActivityAnalytics\(/.test(activityProgress), 'analitik çekirdek kullanılmıyor');
  assert(/formatMetersAsKilometers\(/.test(activityProgress), 'mesafe biçimi kaybolmuş');
  assert(/day\.paceUnit/.test(activityProgress), 'tempo birimi kaybolmuş');
  assert(/formatDuration\(/.test(activityProgress), 'süre biçimi kaybolmuş');
});

check('D5. Kardiyo gelişiminde emoji ve gradient yok', () => {
  assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(activityProgressRaw), 'emoji var');
  assert(!/LinearGradient|gradient/i.test(activityProgress), 'gradient var');
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Progress UI sözleşme harness'ı: ${pass} kontrol geçti.`);
console.log('  (Analitik matematiği ve son-8 davranışı ayrı harness\'ta GERÇEK yardımcılarla test edilir.)');
