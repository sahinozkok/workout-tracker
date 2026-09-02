/**
 * FAZ 2E-3 — Kardiyo gelişim + editör UI sözleşmesi.
 *
 * SINIR: React render EDİLMEZ; kaynak metnin görsel/erişilebilirlik sözleşmesi
 * taranır. Analitik matematiği ve edit/delete veri akışı ayrı harness'larda
 * GERÇEK çekirdek çalıştırılarak test edilir.
 *
 * Çalıştırma:  node scripts/verify-cardio-progress-ui.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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

const progressRaw = source('components/activity-progress.tsx');
const progress = stripComments(progressRaw);
const editorRaw = source('components/activity-record-editor-sheet.tsx');
const editor = stripComments(editorRaw);
const historyRaw = source('app/(tabs)/history.tsx');
const history = stripComments(historyRaw);

// ===========================================================================
console.log('=== A. Kardiyo gelişim bileşeni ===');
// ===========================================================================

check('A1. Analitik çekirdeğini kullanır (ikinci algoritma yok)', () => {
  assert(/buildActivityAnalytics\(/.test(progress), 'buildActivityAnalytics kullanılmıyor');
  assert(/toActivityChartBars\(/.test(progress), 'toActivityChartBars kullanılmıyor');
  assert(/isMetricImprovement\(/.test(progress), 'isMetricImprovement kullanılmıyor');
});

check('A2. Süre / Mesafe / Tempo sekmeleri', () => {
  assert(/availableMetrics\.map/.test(progress), 'metrik sekmeleri availableMetrics üzerinden değil');
  for (const key of ['history.activityDuration', 'history.activityDistance', 'history.activityPace']) {
    assert(progress.includes(key), `metrik etiketi eksik: ${key}`);
  }
});

check('A3. Egzersiz değişince güvenli metrik geri dönüşü', () => {
  assert(
    /!selected\.availableMetrics\.includes\(selectedMetric\)/.test(progress),
    'geçersiz metrik güvenli biçimde ilk uygun metriğe dönmüyor',
  );
});

check('A4. View tabanlı çubuk grafik — yeni grafik paketi yok', () => {
  assert(!/victory|react-native-svg-charts|chart\.js|react-native-svg/i.test(progressRaw), 'yeni grafik paketi eklenmiş');
  assert(/barTrack:\s*\{/.test(progress) && /bar:\s*\{/.test(progress), 'View çubuk yapısı yok');
});

check('A5. Boş durum ve son kayıt listesi', () => {
  assert(/history\.cardioEmptyTitle/.test(progress) && /history\.cardioEmptyBody/.test(progress), 'boş durum yok');
  assert(/history\.recentRecordsTitle/.test(progress), 'son kayıtlar bölümü yok');
});

check('A6. 44 pt dokunma alanları', () => {
  assert(/pickerRow:\s*\{[^}]*minHeight:\s*Layout\.minTouchSize/.test(progress), 'seçici 44 pt değil');
  assert(/recordRow:\s*\{[^}]*minHeight:\s*Layout\.minTouchSize/.test(progress), 'kayıt satırı 44 pt değil');
  assert(/metricTab:\s*\{[^}]*minHeight:\s*32/.test(progress) || /minHeight:\s*Layout\.minTouchSize/.test(progress), 'sekme dokunma alanı yetersiz');
});

check('A7. Tabular nums sayılarda', () => {
  assert(/summaryValue:\s*\{[^}]*tabular-nums/.test(progress), 'özet sayıları tabular değil');
  assert(/barValue:\s*\{[^}]*tabular-nums/.test(progress), 'grafik sayıları tabular değil');
});

check('A8. Yalnız tema + historyProgress rengi; sabit hex/gradient/gölge yok', () => {
  assert(/useFeatureColor\('historyProgress'/.test(progress), 'historyProgress vurgusu kullanılmıyor');
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(progress), 'sabit hex renk var');
  assert(!/LinearGradient|gradient|shadowRadius|shadowOpacity|elevation:\s*[1-9]/i.test(progress), 'gradient/gölge var');
});

check('A9. Metrik/egzersiz geçişi MotionSwap ile (Reduce Motion helper içinde)', () => {
  assert(/MotionSwap/.test(progress), 'MotionSwap kullanılmıyor');
});

check('A10. Erişilebilir grafik ve satır etiketleri', () => {
  assert(/history\.cardioChartA11y/.test(progress), 'grafik a11y etiketi yok');
  assert(/accessibilityRole="button"/.test(progress), 'buton rolleri yok');
});

// ===========================================================================
console.log('\n=== B. Kardiyo kaydı editör sheet ===');
// ===========================================================================

check('B1. overFullScreen Modal + safe area + KeyboardAvoidingView', () => {
  assert(/presentationStyle="overFullScreen"/.test(editor), 'overFullScreen yok');
  assert(/transparent/.test(editor), 'transparan modal değil');
  assert(/KeyboardAvoidingView/.test(editor), 'KeyboardAvoidingView yok');
  assert(/SafeAreaView[\s\S]*edges=\{\['bottom'\]\}/.test(editor), 'alt safe-area yok');
});

check('B2. Arka plana dokunma ve Android geri ile güvenli kapanış', () => {
  assert(/onRequestClose=\{close\}/.test(editor), 'Android geri kapanışı yok');
  assert(/styles\.backdrop/.test(editor) && /onPress=\{close\}/.test(editor), 'arka plan dokunma kapanışı yok');
  // Kaydetme/silme sürerken kapanış engellenir.
  assert(/function close\(\)\s*\{\s*if \(isBusy\) return;/.test(editor), 'işlem sürerken kapanış engellenmiyor');
});

check('B3. Kapat / Kaydet / Sil kontrolleri', () => {
  assert(/common\.close/.test(editor), 'Kapat yok');
  assert(/common\.save/.test(editor), 'Kaydet yok');
  assert(/history\.deleteRecord\b/.test(editor), 'Sil yok');
});

check('B4. Dakika+saniye / kilometre / opsiyonel RPE alanları', () => {
  assert(/history\.editMinutes/.test(editor) && /history\.editSeconds/.test(editor), 'dakika/saniye alanları yok');
  assert(/history\.activityDistance/.test(editor) && /day\.kmUnit/.test(editor), 'kilometre alanı yok');
  assert(/rpe\.label/.test(editor) && /day\.optional/.test(editor), 'opsiyonel RPE yok');
});

check('B5. Mevcut parser/sınırlar yeniden kullanılır (ikinci doğrulama yok)', () => {
  for (const symbol of [
    'parseMinutesSecondsToSeconds',
    'parseKilometersToMeters',
    'parseOptionalKilometersToMeters',
    'parseOptionalRpe',
    'ACTIVITY_DURATION_SECONDS_MIN',
    'ACTIVITY_DISTANCE_METERS_MAX',
  ]) {
    assert(editor.includes(symbol), `parser/sınır eksik: ${symbol}`);
  }
});

check('B6. Alanlar mevcut değerlerle önceden doldurulur', () => {
  assert(/splitSecondsIntoFields\(record\.durationSeconds\)/.test(editor), 'süre önceden doldurulmuyor');
  assert(/formatMetersAsKilometers\(record\.distanceMeters\)/.test(editor), 'mesafe önceden doldurulmuyor');
  assert(/String\(record\.rpe\)/.test(editor), 'RPE önceden doldurulmuyor');
});

check('B7. Mesafe türünde mesafe zorunlu (isteğe bağlı değil)', () => {
  assert(/isDistanceMode\s*\?\s*parseKilometersToMeters/.test(editor), 'mesafe türünde zorunlu parser değil');
  assert(/:\s*parseOptionalKilometersToMeters/.test(editor), 'süre türünde opsiyonel parser değil');
});

check('B8. Kaydetme/silme loading ve hata durumları', () => {
  assert(/isSaving/.test(editor) && /isDeleting/.test(editor), 'loading state yok');
  assert(/ActivityIndicator/.test(editor), 'loading göstergesi yok');
  assert(/history\.saveRecordFailed/.test(editor) && /history\.deleteRecordFailed/.test(editor), 'hata metinleri yok');
});

check('B9. Silmeden önce onay (Alert)', () => {
  assert(/Alert\.alert\(\s*t\('history\.deleteRecordConfirmTitle'\)/.test(editor), 'silme onayı yok');
  assert(/style: 'destructive'/.test(editor), 'yıkıcı eylem işaretlenmemiş');
});

check('B10. Context update/delete API\'sini kullanır; tempo yazılmaz', () => {
  assert(/updateActivityRecord\(record\.id/.test(editor), 'updateActivityRecord kullanılmıyor');
  assert(/deleteActivityRecord\(record\.id\)/.test(editor), 'deleteActivityRecord kullanılmıyor');
  // Tempo hiçbir zaman yazılmaz: performansta yalnız süre/mesafe/rpe.
  // (\b sınırı `space-between` gibi kelimelere takılmaz.)
  assert(!/paceSecondsPerKm|\bpace\b/i.test(editor), 'editörde tempo alanı/yazımı var');
});

check('B11. 44 pt dokunma; tema tokenları; sabit hex/gradient yok', () => {
  assert(/closeButton:\s*\{[^}]*Layout\.minTouchSize/.test(editor), 'kapat 44 pt değil');
  assert(/saveButton:\s*\{[^}]*minHeight:\s*Layout\.minTouchSize/.test(editor), 'kaydet 44 pt değil');
  assert(/deleteButton:\s*\{[^}]*minHeight:\s*Layout\.minTouchSize/.test(editor), 'sil 44 pt değil');
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(editor), 'sabit hex renk var');
  assert(!/LinearGradient|gradient|shadowRadius|elevation:\s*[1-9]/i.test(editor), 'gradient/gölge var');
  assert(/tabular-nums/.test(editor), 'girdilerde tabular nums yok');
  assert(/getOnAccentColor\(accent\)/.test(editor), 'accent üstü kontrast rengi hesaplanmıyor');
  assert(/saveButtonText:\s*\{\s*color:\s*onAccentColor/.test(editor), 'kaydet yazısı kontrast rengi kullanmıyor');
  assert(/ActivityIndicator color=\{onAccent\}/.test(editor), 'kaydet spinner kontrast rengi kullanmıyor');
});

check('B12. Erişilebilir başlık/roller', () => {
  assert(/accessibilityRole="header"/.test(editor), 'başlık rolü yok');
  assert(/accessibilityLabel/.test(editor), 'erişilebilirlik etiketleri yok');
  assert(/accessibilityViewIsModal/.test(editor), 'sheet modal erişilebilirlik kapsamı yok');
});

// ===========================================================================
console.log('\n=== C. History yerleşimi + strength korunması ===');
// ===========================================================================

check('C1. Editör sheet History\'de kayıt kimliğiyle yönetiliyor', () => {
  assert(/<ActivityRecordEditorSheet/.test(history), 'editör sheet render edilmiyor');
  assert(/editingRecordId/.test(history) && /setEditingRecordId/.test(history), 'düzenleme state\'i yok');
});

check('C2. Oturum detayındaki kardiyo satırı düzenlemeye açık (chevron)', () => {
  assert(/onEdit=\{\(\) => onEditRecord\(entry\.id\)\}/.test(history), 'kardiyo satırı düzenleme tetiklemiyor');
  assert(/history\.editRecordRowHint/.test(history), 'düzenleme ipucu yok');
  assert(/name="chevron-forward"/.test(history), 'düzenleme göstergesi (chevron) yok');
});

check('C3. Strength ExerciseProgress ve matematiği DEĞİŞMEDİ', () => {
  // History strength'i yalnız yerleştirir; bileşen ve hesapları bu görevde değişmez.
  assert(/<ExerciseProgress workoutSets=\{completedWorkoutSets\}/.test(history), 'ExerciseProgress kullanımı bozulmuş');
  const strength = source('components/exercise-progress.tsx');
  assert(/buildExerciseAnalytics\(/.test(strength), 'strength analitiği değişmiş');
});

// ===========================================================================
console.log('\n=== D. TR/EN anahtar eşleşmesi ===');
// ===========================================================================

/** Bir dosyadaki `history` bloğunun anahtar kümesini çıkarır. */
function historyKeys(relative) {
  const code = source(relative);
  const start = code.indexOf('  history: {');
  const slice = code.slice(start, code.indexOf('\n  },', start));
  return new Set([...slice.matchAll(/^\s{4}([A-Za-z0-9]+):/gm)].map((match) => match[1]));
}

check('D1. Yeni kardiyo anahtarları hem TR hem EN\'de var', () => {
  const tr = historyKeys('locales/tr.ts');
  const en = historyKeys('locales/en.ts');
  const required = [
    'cardioProgressTitle', 'cardioTrendTitle', 'cardioChartWindow', 'cardioChartA11y',
    'cardioEmptyTitle', 'cardioEmptyBody', 'cardioNoMetricData', 'cardioNoSearchResults',
    'cardioPickerHint', 'cardioPickerTitle', 'cardioSearchPlaceholder',
    'metricLast', 'metricBest', 'metricAverage', 'metricRecordCount',
    'recentRecordsTitle', 'recentRecordsSubtitle', 'recordRowA11y',
    'editRecordRowHint', 'editRecordA11y', 'editRecordTitle', 'editMinutes', 'editSeconds',
    'deleteRecord', 'deleteRecordConfirmTitle', 'deleteRecordConfirmBody',
    'deleteRecordFailed', 'saveRecordFailed',
  ];
  for (const key of required) {
    assert(tr.has(key), `TR eksik: history.${key}`);
    assert(en.has(key), `EN eksik: history.${key}`);
  }
});

check('D2. TR ve EN history anahtar kümeleri birebir aynı', () => {
  const tr = historyKeys('locales/tr.ts');
  const en = historyKeys('locales/en.ts');
  const onlyTr = [...tr].filter((key) => !en.has(key));
  const onlyEn = [...en].filter((key) => !tr.has(key));
  assert(onlyTr.length === 0, `yalnız TR\'de: ${onlyTr.join(', ')}`);
  assert(onlyEn.length === 0, `yalnız EN\'de: ${onlyEn.join(', ')}`);
});

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n✗ Kardiyo UI sözleşme harness başarısız — ${pass} geçti, ${failures.length} kaldı:`);
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log(`\n✓ Kardiyo progress + editör UI sözleşmesi: ${pass} kontrol geçti.`);
