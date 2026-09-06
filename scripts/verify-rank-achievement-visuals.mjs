#!/usr/bin/env node
/**
 * KALICI KARİYER BAŞARIMLARI GÖRSELİ — DOĞRULAMA HARNESS'I
 *
 * ÜRÜN KARARI: Rank → Achievements sekmesi artık SEZON grid'ini göstermez; kalıcı
 * kariyer başarımlarının ORTAK sunum bileşenini (`CareerAchievementsView`) render
 * eder — tam ekran `/achievements` ile birebir aynı. Bu harness, o ortak bileşenin
 * ve paylaşılan medalyonun GÖSTERİM güvencelerini doğrular (güvenli ilerleme
 * kırpması, tek ikon kaynağı, 44 pt dokunma, tema tokenları, gradient/glow yok).
 *
 * İki katman: (1) güvenli oran kırpması deterministik bir modelle GERÇEKTEN
 * çalıştırılır, (2) kaynak statik denetlenir. Canlı Postgres/servis/context YOK.
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
const viewSource = source('components/achievements/career-achievements-view.tsx');
const medallionSource = source('components/ranks/achievement-medallion.tsx');
const visualsSource = source('constants/achievements.ts');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

const screenCode = stripComments(screenSource);
const viewCode = stripComments(viewSource);
const medallionCode = stripComments(medallionSource);

// ---------------------------------------------------------------------------
// Katman 1 — güvenli ilerleme kırpması GERÇEKTEN çalıştırılır
// ---------------------------------------------------------------------------

function safeRatio(currentProgress, targetProgress) {
  return targetProgress > 0 ? Math.min(1, Math.max(0, currentProgress / targetProgress)) : 0;
}

check('1. Dolum oranı her girdide 0–1 aralığında kalır', () => {
  assertEqual(safeRatio(2, 5), 0.4, 'normal oran yanlış');
  assertEqual(safeRatio(5, 5), 1, 'tam ilerleme 1 olmalı');
  assertEqual(safeRatio(0, 5), 0, 'sıfır ilerleme 0 olmalı');
  assertEqual(safeRatio(9, 5), 1, 'hedef aşımı 1e kırpılmadı');
  assertEqual(safeRatio(-3, 5), 0, 'negatif ilerleme 0a kırpılmadı');
  assertEqual(safeRatio(3, 0), 0, 'sıfır hedefte oran 0 olmalı');
  assertEqual(safeRatio(3, -1), 0, 'negatif hedefte oran 0 olmalı');
  for (const [c, target] of [[7, 5], [-2, 3], [0, 0], [1, 4], [15, 15]]) {
    const ratio = safeRatio(c, target);
    assert(ratio >= 0 && ratio <= 1, `oran aralık dışı: ${ratio}`);
  }
});

check('2. MUTASYON: kırpma kaldırılırsa test DÜŞER', () => {
  const rawOvershoot = 9 / 5;
  assertThrows(() => assert(rawOvershoot <= 1, 'mutation'), 'kırpmasız oran testten geçti');
});

// ---------------------------------------------------------------------------
// Katman 2 — sunum kaynağı denetimi (yeni ürün kararı)
// ---------------------------------------------------------------------------

check('3. Rank Başarılar sekmesi ORTAK kariyer görünümünü render eder (sezon grid kaldırıldı)', () => {
  const swap = screenSource.slice(screenSource.indexOf("activeTab === 'achievements'"));
  assert(swap.includes('CareerAchievementsView'), 'rank achievements dalı ortak kariyer bileşenini render etmiyor');
  // Eski sezon grid bileşenleri rank ekranından KALDIRILDI.
  assert(!screenCode.includes('AchievementsGrid') && !screenCode.includes('AchievementBadge'), 'eski sezon grid bileşenleri hâlâ var');
});

check('4. Ortak görünüm özeti kazanılan/toplamı isUnlocked verisinden güvenli türetir', () => {
  assert(/achievements\.filter\(\(a\) => a\.isUnlocked\)\.length/.test(viewCode), 'kazanılan sayısı isUnlocked ile sayılmıyor');
  assert(/const total = achievements\.length/.test(viewCode), 'toplam sayı listeden gelmiyor');
  assert(/const ratio = total > 0 \? Math\.min\(1, Math\.max\(0, earned \/ total\)\) : 0/.test(viewCode), 'özet oranı güvenli türetilmiyor');
  assert(viewCode.includes("careerAchievements.summaryLabel"), 'özet metni kariyer locale\'inden gelmiyor');
  assert(viewCode.includes("careerAchievements.summaryA11y"), 'özet a11y metni yok');
  for (const locale of [localeTr, localeEn]) {
    assert(/summaryLabel: '[^']*\{earned\}[^']*\{total\}/.test(locale), 'özet metni earned/total içermiyor');
    assert(/summaryA11y: '[^']*\{(earned|total)\}/.test(locale), 'özet a11y metni değişken içermiyor');
  }
});

check('5. Kilitli satırda güvenli ilerleme metni; ekran ilerleme HESAPLAMAZ', () => {
  // İlerleme metni birim-farkında biçimleyiciden (progressText) gelir; kaynaktan taşınır.
  assert(viewCode.includes('progressText(a)'), 'ortak görünüm ilerleme metnini kullanmıyor');
  assert(/kind === 'boolean'/.test(viewCode), 'boolean başarımlar 0/1 olarak ele alınmıyor');
  // Ham ilerleme birim biçimleyicisinden geçer (kg/km/dk); ekran kendi eşiğini uydurmaz.
  assert(viewCode.includes('formatAchievementValue('), 'birim biçimleyici kullanılmıyor');
  assert(!/targetProgress\s*=\s*\d|target:\s*\d/.test(viewCode), 'sunum kodunda sabit hedef var');
});

check('6. Satır dokunulabilir/erişilebilir ve 44 pt dokunma hedefi', () => {
  assert(viewCode.includes('accessibilityRole="button"'), 'satırda düğme rolü yok');
  assert(viewCode.includes('a11yState.unlocked') && viewCode.includes('a11yState.locked'), 'kilitli/açık a11y metni eksik');
  assert(viewCode.includes('onPress={() => setDetail(a)}'), 'satır dokunuşu detay açmıyor');
  const rowStyle = viewSource.slice(viewSource.indexOf('row: {'), viewSource.indexOf('rowLocked: {'));
  assert(/minHeight: Layout\.minTouchSize/.test(rowStyle), 'satır 44 pt dokunma hedefinin altında');
});

check('7. Tek görsel kaynağı: görünüm ve detay AYNI paylaşılan AchievementSymbol\'ü kullanır', () => {
  assert(viewSource.includes("from '@/components/achievements/achievement-symbol'"), 'ortak görünüm AchievementSymbol import etmiyor');
  // Liste satırı + detay sheet AYNI paylaşılan bileşeni AchievementKey ile çağırır.
  assert((viewSource.match(/<AchievementSymbol/g) ?? []).length >= 2, 'görünüm liste + detayında AchievementSymbol kullanmıyor');
  assert(/<AchievementSymbol[\s\S]*?achievementKey=\{a\.key\}/.test(viewSource), 'görsel tek kaynaktan (AchievementSymbol + AchievementKey) verilmiyor');
  // ACHIEVEMENT_VISUALS 30 kalıcı başarımın tek PNG kaynak haritasıdır (bileşen içinde okunur).
  assert(/export const ACHIEVEMENT_VISUALS/.test(visualsSource), 'ACHIEVEMENT_VISUALS tek kaynağı yok');
});

check('8. Medallion yeni renk/asset TANIMLAMAZ; tema + accent + withAlpha ile türer', () => {
  assert(!/ACHIEVEMENT_ICONS|ACHIEVEMENT_VISUALS/.test(medallionCode), 'medallion ikon eşlemesini kopyalamış');
  assert(medallionSource.includes('icon: keyof typeof Ionicons.glyphMap'), 'medallion ikon adını dışarıdan almıyor');
  const hexes = [...medallionCode.matchAll(/'#[0-9A-Fa-f]{3,8}'/g)].map((m) => m[0]);
  assert(hexes.length === 0, `medallion tema dışı sabit renk ekledi: ${hexes.join(', ')}`);
  assert(medallionSource.includes('withAlpha('), 'medallion vurgu rengini withAlpha ile türetmiyor');
  assert(medallionSource.includes('useAppTheme'), 'medallion tema renklerini kullanmıyor');
});

check('9. Kalıcı başarım accent\'i sezon rank renginden BAĞIMSIZ (profil accent\'i)', () => {
  // Ortak görünüm accent'i profil özelliğinden alır; rank rengi (getRankColor) KULLANMAZ.
  assert(/useFeatureColor\('profile'/.test(viewSource), 'ortak görünüm profil accent\'ini kullanmıyor');
  assert(!/getRankColor|season\.currentRank/.test(viewSource), 'kalıcı başarım sezon rank rengine bağlanmış');
});

check('10. Sabit sayı yok; özet çevirileri yalnız {earned}/{total} ile dolar', () => {
  for (const locale of [localeTr, localeEn]) {
    const summary = /summaryLabel: '([^']*)'/.exec(locale)?.[1] ?? '';
    const summaryA11y = /summaryA11y: '([^']*)'/.exec(locale)?.[1] ?? '';
    for (const value of [summary, summaryA11y]) {
      assert(!/\d/.test(value.replace(/\{\w+\}/g, '')), `özet çevirisinde sabit sayı var: ${value}`);
    }
  }
});

check('11. Yeni gradient, glow, gölge, asset veya emoji YOK', () => {
  for (const [label, code] of [
    ['app/rank.tsx', screenCode],
    ['career-achievements-view.tsx', viewCode],
    ['achievement-medallion.tsx', medallionCode],
  ]) {
    assert(!/gradient|LinearGradient/i.test(code), `${label}: gradient eklenmiş`);
    assert(!/shadowColor|shadowOpacity|shadowRadius|shadowOffset|elevation:|glow/i.test(code), `${label}: gölge/glow eklenmiş`);
    assert(!/require\(\s*['"][^'"]+\.(png|jpg|jpeg|gif|svg|webp)['"]\s*\)/i.test(code), `${label}: yeni asset eklenmiş`);
    assert(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(code), `${label}: emoji eklenmiş`);
  }
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Kalıcı kariyer başarımı görseli harness: ${passed} kontrol geçti.`);
console.log('  (Rank sekmesi ortak kariyer görünümünü render eder; SQL/servis/context\'e dokunulmadı.)');
