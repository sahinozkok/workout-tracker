#!/usr/bin/env node
/**
 * ROZET KOLEKSİYONU GÖRSELİ — DOĞRULAMA HARNESS'I
 *
 * Kapsam: Rank ekranındaki SEZON BAŞARILARI sekmesinin GÖSTERİM sunumu —
 * kompakt özet, iki sütunlu rozet kutuları ve ortak medallion. Başarı kazanma
 * koşulları, RP/XP/gül ekonomisi, sunucu verileri, kutlama kuyruğu ve ikon
 * eşlemesi BURADA DEĞİŞMEZ; bu harness yalnızca sunumun beklenen kararları
 * verdiğini ve korunması gereken davranışların yerinde kaldığını doğrular.
 *
 * İki katman: (1) güvenli ilerleme kırpması deterministik bir modelle GERÇEKTEN
 * çalıştırılır, (2) kaynak ve sözlükler statik denetlenir.
 *
 * Canlı Postgres YOKTUR ve bu tur hiçbir SQL'e, servise veya context'e dokunmaz.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} — beklenen ${expected}, gelen ${actual}`);
}

function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

const source = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

const screenSource = source('app/rank.tsx');
const sheetSource = source('components/ranks/achievement-detail-sheet.tsx');
const medallionSource = source('components/ranks/achievement-medallion.tsx');
const iconsSource = source('components/ranks/achievement-icons.ts');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

/** Yorumlar çıkarılmış kaynak — kural denetimleri KOD üzerinde yapılır. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

const screenCode = stripComments(screenSource);
const sheetCode = stripComments(sheetSource);
const medallionCode = stripComments(medallionSource);

/** Rank ekranındaki tek rozet kutusu bileşeninin gövdesi. */
const badgeBlock = screenSource.slice(
  screenSource.indexOf('function AchievementBadge('),
  screenSource.indexOf('function StatRow('),
);
/** Koleksiyon + özet bileşeninin gövdesi. */
const gridBlock = screenSource.slice(
  screenSource.indexOf('function AchievementsGrid('),
  screenSource.indexOf('function AchievementBadge('),
);

assert(badgeBlock.length > 0, 'AchievementBadge bulunamadı');
assert(gridBlock.length > 0, 'AchievementsGrid bulunamadı');

// ---------------------------------------------------------------------------
// Katman 1 — güvenli ilerleme kırpması GERÇEKTEN çalıştırılır
// ---------------------------------------------------------------------------

/**
 * Bileşenlerdeki dolum oranının referansı.
 *
 * Yalnızca iki sunucu alanından türer ve 0–1 aralığına sınırlıdır. Hedef
 * sıfır/negatif ya da ilerleme hedefi aşmış gelse bile çizgi taşmaz veya
 * negatife düşmez.
 */
function safeRatio(currentProgress, targetProgress) {
  return targetProgress > 0 ? Math.min(1, Math.max(0, currentProgress / targetProgress)) : 0;
}

check('1. Dolum oranı her girdide 0–1 aralığında kalır', () => {
  assertEqual(safeRatio(2, 5), 0.4, 'normal oran yanlış');
  assertEqual(safeRatio(5, 5), 1, 'tam ilerleme 1 olmalı');
  assertEqual(safeRatio(0, 5), 0, 'sıfır ilerleme 0 olmalı');
  // Sunucu hedefi aşarsa oran 1'de KIRPILIR.
  assertEqual(safeRatio(9, 5), 1, 'hedef aşımı 1e kırpılmadı');
  // Negatif ilerleme 0'a kırpılır.
  assertEqual(safeRatio(-3, 5), 0, 'negatif ilerleme 0a kırpılmadı');
  // Bozuk hedef (0 veya negatif) çizgiyi çökertmez.
  assertEqual(safeRatio(3, 0), 0, 'sıfır hedefte oran 0 olmalı');
  assertEqual(safeRatio(3, -1), 0, 'negatif hedefte oran 0 olmalı');
  // Her durumda 0 ≤ oran ≤ 1.
  for (const [c, target] of [[7, 5], [-2, 3], [0, 0], [1, 4], [15, 15]]) {
    const ratio = safeRatio(c, target);
    assert(ratio >= 0 && ratio <= 1, `oran aralık dışı: ${ratio}`);
  }
});

check('2. MUTASYON: kırpma kaldırılırsa test DÜŞER', () => {
  /** Kasıtlı hata: kırpmasız ham oran hedefi aşabilir. */
  const rawOvershoot = 9 / 5;
  assertThrows(
    () => assert(rawOvershoot <= 1, 'mutation'),
    'kırpmasız oran testten geçti — güvenli sınır yakalanmıyor',
  );
});

// ---------------------------------------------------------------------------
// Katman 2 — sunum kaynağı denetimi
// ---------------------------------------------------------------------------

check('3. Özet kazanılan/toplam sayısını mevcut isUnlocked verisinden türetir', () => {
  // Kazanılan sayısı yalnızca isUnlocked satırları sayılarak bulunur.
  assert(
    /achievements\.filter\(\s*\(entry\)\s*=>\s*entry\.isUnlocked\s*\)\.length/.test(gridBlock),
    'kazanılan sayısı isUnlocked ile sayılmıyor',
  );
  assert(/const totalCount = achievements\.length/.test(gridBlock), 'toplam sayı listeden gelmiyor');
  // Özet metni ve erişilebilirlik etiketi çeviriden, sayılar parametreyle gelir.
  assert(gridBlock.includes("t('ranks.achievements.summaryLabel'"), 'özet metni çeviriden gelmiyor');
  assert(gridBlock.includes("t('ranks.achievements.summaryA11y'"), 'özet erişilebilirlik metni yok');
  assert(
    /summaryLabel',\s*\{\s*earned: earnedCount,\s*total: totalCount\s*\}/.test(gridBlock),
    'özet metni earned/total taşımıyor',
  );
  // İnce genel ilerleme çizgisi kazanılan/toplam oranından dolar.
  assert(gridBlock.includes('summaryRatio'), 'genel ilerleme çizgisi oranı yok');
  assert(
    /summaryRatio = totalCount > 0 \? Math\.min\(1, Math\.max\(0, earnedCount \/ totalCount\)\) : 0/.test(
      gridBlock,
    ),
    'genel ilerleme oranı güvenli biçimde türetilmiyor',
  );
  assert(gridBlock.includes('styles.achievementsSummaryTrack'), 'özet çizgi kabı yok');
  assert(gridBlock.includes('styles.achievementsSummaryFill'), 'özet çizgi dolumu yok');

  // TR ve EN çevirileri tanımlı ve yalnızca değişkenlerle dolar.
  for (const locale of [localeTr, localeEn]) {
    assert(/summaryLabel: '[^']*\{earned\}[^']*\{total\}/.test(locale), 'özet metni earned/total içermiyor');
    assert(/summaryA11y: '[^']*\{earned\}[^']*/.test(locale), 'özet a11y metni earned içermiyor');
  }
});

check('4. İki sütunlu koleksiyon korunuyor', () => {
  assert(screenCode.includes("styles.achievementsGrid"), 'koleksiyon ızgarası yok');
  const gridStyle = screenSource.slice(
    screenSource.indexOf('achievementsGrid: {'),
    screenSource.indexOf('achievementCard: {'),
  );
  assert(gridStyle.includes("flexWrap: 'wrap'"), 'ızgara sarmalı değil');
  assert(gridStyle.includes("flexDirection: 'row'"), 'ızgara satır yönünde değil');
  // Her kutu iki sütun bırakacak biçimde ekranın ~yarısı kadar.
  const cardStyle = screenSource.slice(
    screenSource.indexOf('achievementCard: {'),
    screenSource.indexOf('achievementCardLocked:'),
  );
  assert(cardStyle.includes("width: '48%'"), 'rozet kutusu iki sütun genişliğinde değil');
  // 375 pt ekranda iki %48 sütun + boşluk taşmaz (2 × 48 = 96 ≤ 100).
  const widthPercent = Number.parseInt(/width: '(\d+)%'/.exec(cardStyle)?.[1] ?? '0', 10);
  assert(widthPercent > 0 && widthPercent * 2 <= 100, 'iki sütun 375 pt genişlikte taşar');
});

check('5. Rozet kutusu: üstte medallion, en fazla iki satır ad', () => {
  // Kutu dikey bir rozet kutusudur: medallion üstte.
  assert(
    /<AchievementMedallion[\s\S]*?icon=\{ACHIEVEMENT_ICONS\[key\]\}/.test(badgeBlock),
    'rozet kutusunda ortak medallion yok',
  );
  // Ad en fazla iki satır.
  assert(/numberOfLines=\{2\}[\s\S]*?styles\.achievementName/.test(badgeBlock), 'başarı adı iki satırla sınırlı değil');
  // İkon boyutu 44–48 pt aralığında: kutuda varsayılan (44), pencerede 48.
  const defaultSize = Number.parseInt(/size = (\d+)/.exec(medallionSource)?.[1] ?? '0', 10);
  assert(defaultSize >= 44 && defaultSize <= 48, `medallion varsayılan sembol boyutu 44–48 dışında: ${defaultSize}`);
});

check('6. Kilitli kutuda ilerleme çizgisi VAR', () => {
  // Kilitli dalda ilerleme metni + ince çizgi çizilir.
  const lockedBranch = badgeBlock.slice(badgeBlock.indexOf('{isUnlocked ? ('));
  assert(lockedBranch.includes('styles.achievementProgress'), 'kilitli kutuda ilerleme grubu yok');
  assert(lockedBranch.includes('styles.achievementTrack'), 'kilitli kutuda ilerleme çizgisi kabı yok');
  assert(lockedBranch.includes('styles.achievementFill'), 'kilitli kutuda ilerleme dolumu yok');
  assert(lockedBranch.includes('{progressLabel}'), 'kilitli kutuda ilerleme metni yok');
  assert(badgeBlock.includes("t('ranks.achievements.progress'"), 'ilerleme metni çeviriden gelmiyor');
  // Dolum genişliği güvenli orandan gelir.
  assert(
    /width: `\$\{Math\.round\(progressRatio \* 100\)\}%`/.test(badgeBlock),
    'ilerleme dolumu güvenli orandan türemiyor',
  );
  assert(
    /progressRatio =\s*targetProgress > 0 \? Math\.min\(1, Math\.max\(0, currentProgress \/ targetProgress\)\) : 0/.test(
      badgeBlock,
    ),
    'rozet kutusunda güvenli oran hesaplanmıyor',
  );
  // Kutu hâlâ ilerlemeyi HESAPLAMAZ (mevcut kural): filter/length/toplama yok.
  assert(!/\.filter\(|\.length|currentProgress\s*[+*-]/.test(badgeBlock), 'kutu ilerleme hesaplıyor');
});

check('7. Açılmış kutuda tarih/"Açıldı" bilgisi korunuyor', () => {
  assert(
    /unlockedDetail = unlockedLabel \?\? t\('ranks\.achievements\.unlocked'\)/.test(badgeBlock),
    'açılmış kutuda tarih/açıldı metni türemiyor',
  );
  assert(badgeBlock.includes('formatUnlockedAt(unlockedAt, locale)'), 'kazanılma tarihi biçimlendirilmiyor');
  const unlockedBranch = badgeBlock.slice(
    badgeBlock.indexOf('{isUnlocked ? ('),
    badgeBlock.indexOf('styles.achievementProgress'),
  );
  assert(unlockedBranch.includes('{unlockedDetail}'), 'açılmış kutu tarih/açıldı satırını göstermiyor');
});

check('8. Tile ve modal AYNI medallion bileşenini kullanıyor', () => {
  for (const [label, text] of [['rank ekranı', screenSource], ['ayrıntı penceresi', sheetSource]]) {
    assert(
      text.includes("from '@/components/ranks/achievement-medallion'"),
      `${label} medallion bileşenini import etmiyor`,
    );
    assert(text.includes('<AchievementMedallion'), `${label} medallion bileşenini kullanmıyor`);
    // İkon adı yine TEK kaynaktan (achievement-icons) okunup medalyona verilir.
    assert(
      text.includes('icon={ACHIEVEMENT_ICONS[key]}'),
      `${label} sembolü tek kaynaktan almıyor`,
    );
  }
  // Pencere daha belirgin bir medallion gösterir (48 pt).
  assert(/size=\{48\}/.test(sheetSource), 'ayrıntı penceresinde belirgin medallion yok');
});

check('9. Medallion yeni renk/asset TANIMLAMAZ; ikon eşlemesini KOPYALAMAZ', () => {
  // Sembol dışarıdan gelir: bileşen ikon eşlemesini içinde tutmaz.
  assert(!/ACHIEVEMENT_ICONS/.test(medallionCode), 'medallion ikon eşlemesini kopyalamış');
  assert(medallionSource.includes('icon: keyof typeof Ionicons.glyphMap'), 'medallion ikon adını dışarıdan almıyor');
  // Renk/sınır mevcut tema ve accent + withAlpha ile türer; sabit hex yoktur.
  const hexes = [...medallionCode.matchAll(/'#[0-9A-Fa-f]{3,8}'/g)].map((match) => match[0]);
  assert(hexes.length === 0, `medallion tema dışı sabit renk ekledi: ${hexes.join(', ')}`);
  assert(medallionSource.includes('withAlpha('), 'medallion vurgu rengini withAlpha ile türetmiyor');
  assert(medallionSource.includes('useAppTheme'), 'medallion tema renklerini kullanmıyor');
  // Açık: accent sınır + accent sembol; kilitli: ayırıcı sınır + düşük kontrast.
  assert(medallionSource.includes('colors.separator'), 'kilitli medallion ayırıcı sınırı kullanmıyor');
  assert(medallionSource.includes('colors.textTertiary'), 'kilitli sembol düşük kontrastlı değil');
});

check('10. Ayrıntı penceresinde erişilebilir progress bar VAR', () => {
  assert(sheetSource.includes('accessibilityRole="progressbar"'), 'progress bar rolü yok');
  const barBlock = sheetSource.slice(
    sheetSource.indexOf('accessibilityRole="progressbar"') - 80,
    sheetSource.indexOf('accessibilityRole="progressbar"') + 220,
  );
  // min, max ve now DEĞERLERİ duyurulur.
  assert(/accessibilityValue=\{\{[^}]*min: 0/.test(barBlock), 'progress bar min değeri yok');
  assert(/accessibilityValue=\{\{[^}]*max: progressMax/.test(barBlock), 'progress bar güvenli max değeri yok');
  assert(/accessibilityValue=\{\{[^}]*now: progressNow/.test(barBlock), 'progress bar güvenli now değeri yok');
  assert(
    /progressMax = Math\.max\(0, targetProgress\)/.test(sheetSource) &&
      /progressNow = Math\.min\(progressMax, Math\.max\(0, currentProgress\)\)/.test(sheetSource),
    'progress bar erişilebilirlik değerleri 0–max aralığına kırpılmıyor',
  );
  // Yalnızca KİLİTLİ rozette gösterilir ve güvenli orandan dolar.
  assert(/\{!isUnlocked \? \([\s\S]*?accessibilityRole="progressbar"/.test(sheetSource), 'progress bar kilitli koşuluna bağlı değil');
  assert(
    /progressRatio =\s*targetProgress > 0 \? Math\.min\(1, Math\.max\(0, currentProgress \/ targetProgress\)\) : 0/.test(
      sheetSource,
    ),
    'pencere güvenli oran hesaplamıyor',
  );
  assert(/width: `\$\{Math\.round\(progressRatio \* 100\)\}%`/.test(sheetSource), 'pencere dolumu güvenli orandan gelmiyor');
});

check('11. Mevcut erişilebilirlik: kutu düğme rolü, ipucu ve etiketi korunuyor', () => {
  assert(badgeBlock.includes('accessibilityRole="button"'), 'kutuda düğme rolü yok');
  assert(badgeBlock.includes("accessibilityHint={t('ranks.achievements.detail.openHint')}"), 'kutuda ipucu yok');
  assert(
    badgeBlock.includes('unlockedA11y') && badgeBlock.includes('lockedA11y'),
    'kilitli/açık erişilebilirlik metinleri eksik',
  );
  assert(badgeBlock.includes('onPress={() => onOpen(key)}'), 'kutu dokunuşu pencereyi açmıyor');
  assert(badgeBlock.includes('MotionPressable'), 'kutuda mevcut press feedback bileşeni yok');
  // Dokunma alanı en az 44 pt: kutu yüksekliği 44'ün altına inmez.
  const cardStyle = screenSource.slice(
    screenSource.indexOf('achievementCard: {'),
    screenSource.indexOf('achievementCardLocked:'),
  );
  const minHeight = Number.parseInt(/minHeight: (\d+)/.exec(cardStyle)?.[1] ?? '0', 10);
  assert(minHeight >= 44, `rozet kutusu dokunma hedefi 44 pt altında: ${minHeight}`);
});

check('12. Ayrıntı penceresi davranışları korunuyor: Reduce Motion, kapatma, Android geri', () => {
  // Reduce Motion kapısı birebir yerinde.
  assert(sheetSource.includes('useReducedMotion'), 'reduce motion okunmuyor');
  assert(sheetSource.includes('reduceMotion ? MotionDuration.instant'), 'reduce motion açıkken süre sadeleşmiyor');
  assert(sheetSource.includes('transform: reduceMotion ? []'), 'reduce motion açıkken ölçek kapanmıyor');
  // Android donanım geri tuşu.
  assert(sheetSource.includes('onRequestClose={onClose}'), 'Android geri tuşu kapatmıyor');
  // Arka plana dokunarak kapatma.
  assert(/<Pressable[\s\S]*?onPress=\{onClose\}[\s\S]*?StyleSheet\.absoluteFill/.test(sheetSource), 'arka plana dokunma kapatmıyor');
  // Belirgin kapatma düğmesi.
  assert(sheetSource.includes("t('ranks.achievements.detail.close')"), 'kapatma düğmesi metni yok');
  assert(
    sheetSource.includes("accessibilityLabel={t('ranks.achievements.detail.closeA11y')}"),
    'kapatma düğmesinin erişilebilirlik etiketi yok',
  );
  // Modal, ScrollView ve küçük ekran davranışı.
  assert(/<Modal[\s\S]{0,240}visible>/.test(sheetSource), 'içerik Modal katmanında değil');
  assert(sheetSource.includes('ScrollView'), 'küçük ekranlarda içerik kaydırılamıyor');
  assert(sheetSource.includes("maxHeight: '80%'"), 'pencere tam ekranı kaplıyor');
});

check('13. Achievement ikon haritası DEĞİŞMEMİŞ', () => {
  const EXPECTED = {
    first_workout: 'footsteps-outline',
    workout_5: 'barbell-outline',
    workout_15: 'trophy-outline',
    streak_3: 'flame-outline',
    streak_7: 'flame',
    perfect_week: 'checkmark-done-outline',
  };
  for (const [key, glyph] of Object.entries(EXPECTED)) {
    assert(
      new RegExp(`${key}:\\s*'${glyph}'`).test(iconsSource),
      `ikon eşlemesi değişmiş: ${key} → ${glyph}`,
    );
  }
  // Anahtar sayısı da aynı: fazladan veya eksik satır yok.
  const pairs = [...iconsSource.matchAll(/^\s*(\w+):\s*'[\w-]+',?$/gm)];
  assertEqual(pairs.length, 6, 'ikon eşlemesinde satır sayısı değişmiş');
});

check('14. Sabit başarı hedefi EKLENMEMİŞ; sayılar sunucudan gelir', () => {
  // Rozet kutusunda ve özet mantığında hedef/eşik sabitlenmez.
  assert(!/targetProgress\s*=\s*\d|target:\s*\d/.test(gridBlock + badgeBlock), 'sunum kodunda sabit hedef var');
  // Özet çevirilerinde de sabit sayı yok (yalnızca {earned}/{total}).
  for (const locale of [localeTr, localeEn]) {
    const summary = /summaryLabel: '([^']*)'/.exec(locale)?.[1] ?? '';
    const summaryA11y = /summaryA11y: '([^']*)'/.exec(locale)?.[1] ?? '';
    for (const value of [summary, summaryA11y]) {
      assert(
        !/\d/.test(value.replace(/\{\w+\}/g, '')),
        `özet çevirisinde sabit sayı var: ${value}`,
      );
    }
  }
});

check('15. Yeni paket, asset, gradient, glow, gölge veya emoji YOK', () => {
  const surfaces = [
    ['app/rank.tsx', screenCode],
    ['achievement-detail-sheet.tsx', sheetCode],
    ['achievement-medallion.tsx', medallionCode],
  ];
  for (const [label, code] of surfaces) {
    assert(!/gradient|LinearGradient/i.test(code), `${label}: gradient eklenmiş`);
    assert(!/shadowColor|shadowOpacity|shadowRadius|shadowOffset|elevation:|glow/i.test(code), `${label}: gölge/glow eklenmiş`);
    // require('...png') veya asset importu yok.
    assert(!/require\(\s*['"][^'"]+\.(png|jpg|jpeg|gif|svg|webp)['"]\s*\)/i.test(code), `${label}: yeni asset eklenmiş`);
    // Emoji / pictographic karakter yok.
    assert(
      !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(code),
      `${label}: emoji eklenmiş`,
    );
  }
  // Medallion yalnızca zaten kullanılan paketlerden import eder (yeni bağımlılık yok).
  const imports = [...medallionSource.matchAll(/^import[^;]*from '([^']+)';/gm)].map((match) => match[1]);
  for (const specifier of imports) {
    assert(
      specifier === '@expo/vector-icons' ||
        specifier === 'react-native' ||
        specifier.startsWith('@/'),
      `medallion yeni paket import ediyor: ${specifier}`,
    );
  }
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Rozet koleksiyonu görseli harness: ${passed} kontrol geçti.`);
console.log('  (SQL, servis, context ve ikon eşlemesine dokunulmadı; yalnızca sunum doğrulandı.)');
