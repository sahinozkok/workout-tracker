#!/usr/bin/env node
/**
 * KALICI KARİYER BAŞARIMI SEMBOLLERİ — ASSET + GÖRSEL SÖZLEŞME HARNESS'I
 *
 * 30 organik PNG asset'inin kurulumunu, katalogla BİREBİR eşleşmesini ve
 * paylaşılan `AchievementSymbol` görsel sözleşmesini görüntü çözme bağımlılığı
 * OLMADAN doğrular (PNG başlığı ham bayttan okunur). Her kontrol yanlış
 * uygulamada GÜRÜLTÜLÜ düşecek biçimde yazılmıştır.
 *
 * Canlı render YOKTUR: dosyalar ve kaynaklar statik denetlenir.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (p) => readFileSync(join(ROOT, p), 'utf8');
const ASSET_DIR = 'assets/achievements/career';

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const catalog = source('constants/achievements.ts');

/** ACHIEVEMENT_CATALOG'daki 30 anahtar (tek kaynak). */
const catalogKeys = [...catalog.matchAll(/\{ key: '([a-z0-9_]+)',/g)].map((m) => m[1]);

/** ACHIEVEMENT_VISUALS kaynak haritası: anahtar → require edilen dosya adı (stem). */
const visualsBlock = /export const ACHIEVEMENT_VISUALS[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(catalog)?.[1] ?? '';
const visualMap = new Map(
  [...visualsBlock.matchAll(/([a-z0-9_]+):\s*require\('@\/assets\/achievements\/career\/([a-z0-9_]+)\.png'\)/g)].map(
    (m) => [m[1], m[2]],
  ),
);

/** Kurulu PNG dosya adları (stem). */
const pngStems = readdirSync(join(ROOT, ASSET_DIR))
  .filter((f) => f.toLowerCase().endsWith('.png'))
  .map((f) => f.replace(/\.png$/i, ''));

// ---------------------------------------------------------------------------
check('1. Tam 30 PNG dosyası kurulu', () => {
  assert(pngStems.length === 30, `kurulu PNG sayısı 30 değil (${pngStems.length})`);
  assert(new Set(pngStems).size === 30, 'kurulu PNG adları benzersiz değil');
});

check('2. Dosya adları ↔ görsel harita ↔ katalog anahtarları BİREBİR (30/30)', () => {
  assert(catalogKeys.length === 30, `katalog anahtarı 30 değil (${catalogKeys.length})`);
  assert(visualMap.size === 30, `görsel harita 30 değil (${visualMap.size})`);
  const keySet = new Set(catalogKeys);
  const stemSet = new Set(pngStems);
  for (const key of catalogKeys) {
    assert(visualMap.has(key), `görsel haritada eksik anahtar: ${key}`);
    assert(visualMap.get(key) === key, `${key} → yanlış dosya (${visualMap.get(key)})`);
    assert(stemSet.has(key), `PNG dosyası eksik: ${key}.png`);
  }
  for (const stem of pngStems) assert(keySet.has(stem), `katalogda olmayan PNG: ${stem}.png`);
  for (const key of visualMap.keys()) assert(keySet.has(key), `katalogda olmayan görsel anahtarı: ${key}`);
});

// Mobil kullanım için optimize hedefi: 384×384 (maks. görünür ölçü 52 pt → 3x
// retina 156 px'in çok üzerinde, ince monoline ayrıntı korunur). Boyut bütçesi
// 1254×1254 orijinallere geri dönüşü (dosya ~9,6 MB) da yakalar.
const TARGET_PX = 384;
const MAX_FILE_BYTES = 160 * 1024; // dosya başına makul üst sınır (~gerçek maks 78 KB)
const MAX_TOTAL_BYTES = 2400 * 1024; // toplam makul sınır (~gerçek 1,4 MB; 9,6 MB'a dönüş düşer)

check(`3. Her PNG: imza + IHDR ${TARGET_PX}×${TARGET_PX} (optimize) + alfa-uyumlu renk tipi`, () => {
  const SIG = '89504e470d0a1a0a';
  for (const stem of pngStems) {
    const b = readFileSync(join(ROOT, ASSET_DIR, `${stem}.png`));
    assert(b.length > 33, `${stem}.png fazla küçük (bozuk)`);
    assert(b.toString('hex', 0, 8) === SIG, `${stem}.png PNG imzası taşımıyor`);
    // IHDR chunk verisi 16. bayttan başlar: width(4) height(4) bitdepth(1) colortype(1)
    assert(b.toString('ascii', 12, 16) === 'IHDR', `${stem}.png IHDR chunk'ı ilk değil`);
    const width = b.readUInt32BE(16);
    const height = b.readUInt32BE(20);
    const colorType = b[25];
    assert(width === TARGET_PX, `${stem}.png genişlik ${TARGET_PX} değil (${width})`);
    assert(height === TARGET_PX, `${stem}.png yükseklik ${TARGET_PX} değil (${height})`);
    // Kare (oran korunur), optimize sonrası tek çözünürlük.
    assert(width === height, `${stem}.png kare değil (${width}×${height})`);
    // 6 = RGBA (truecolor+alpha), 4 = grayscale+alpha → alfa-uyumlu.
    assert(colorType === 6 || colorType === 4, `${stem}.png alfa-uyumlu renk tipi değil (colorType=${colorType})`);
  }
});

check('3b. Optimize boyut bütçesi: dosya başına + toplam makul sınır', () => {
  let total = 0;
  for (const stem of pngStems) {
    const bytes = readFileSync(join(ROOT, ASSET_DIR, `${stem}.png`)).length;
    total += bytes;
    assert(bytes <= MAX_FILE_BYTES, `${stem}.png fazla büyük (${(bytes / 1024).toFixed(0)} KB > ${MAX_FILE_BYTES / 1024} KB)`);
  }
  assert(
    total <= MAX_TOTAL_BYTES,
    `kariyer asset toplamı fazla büyük (${(total / 1024).toFixed(0)} KB > ${MAX_TOTAL_BYTES / 1024} KB) — optimize edilmemiş olabilir`,
  );
});

check('4. Katalog geçici Ionicons tip/import\'unu KALDIRMIŞ', () => {
  assert(!/from '@expo\/vector-icons'/.test(catalog), 'katalog hâlâ Ionicons import ediyor');
  assert(!/keyof typeof Ionicons\.glyphMap/.test(catalog), 'katalog hâlâ Ionicons glyph tipini kullanıyor');
  assert(/export const ACHIEVEMENT_VISUALS: Record<AchievementKey, number>/.test(catalog),
    'ACHIEVEMENT_VISUALS artık statik görsel (number) kaynak haritası değil');
});

check('5. Kalıcı-kariyer renderer\'ları paylaşılan AchievementSymbol\'ü kullanır', () => {
  const sites = [
    'components/achievements/career-achievements-view.tsx',
    'components/ranks/profile-career-showcase.tsx',
    'components/ranks/achievement-celebration-overlay.tsx',
    'app/achievements-showcase.tsx',
  ];
  for (const p of sites) {
    const s = source(p);
    assert(s.includes("from '@/components/achievements/achievement-symbol'"), `${p} AchievementSymbol import etmiyor`);
    assert(/<AchievementSymbol/.test(s), `${p} AchievementSymbol render etmiyor`);
    // Kalıcı-kariyer subject glyph'i artık ACHIEVEMENT_VISUALS'ı doğrudan Ionicons'a vermez.
    assert(!/name=\{ACHIEVEMENT_VISUALS\[/.test(s), `${p} hâlâ ACHIEVEMENT_VISUALS'ı Ionicons ismi olarak veriyor`);
  }
});

check('6. Paylaşılan bileşen: Image + contain + statik kaynak + tema tint + kilitli işlem', () => {
  const sym = source('components/achievements/achievement-symbol.tsx');
  assert(/from 'react-native'/.test(sym) && /\bImage\b/.test(sym), 'react-native Image kullanmıyor');
  assert(/resizeMode="contain"/.test(sym), 'resizeMode contain değil');
  assert(/source=\{ACHIEVEMENT_VISUALS\[achievementKey\]\}/.test(sym), 'statik kaynak haritası (ACHIEVEMENT_VISUALS[key]) kullanılmıyor');
  assert(/width: size/.test(sym) && /height: size/.test(sym), 'eşit en/boy (size) kullanılmıyor');
  assert(/useAppTheme/.test(sym), 'tema kullanılmıyor');
  // Açık → accent tint; kilitli → tersiyer tint + ölçülü opaklık.
  assert(/tintColor: isUnlocked \? accent : colors\.textTertiary/.test(sym), 'tint açık=accent / kilitli=tersiyer değil');
  assert(/opacity: isUnlocked \? 1 : lockedOpacity/.test(sym), 'kilitli opaklık işlemi yok');
  const lo = /const lockedOpacity = isDark \? (0\.\d+) : (0\.\d+);/.exec(sym);
  assert(lo, 'lockedOpacity tema grubuna göre ölçülmüyor');
  const dark = Number(lo[1]);
  const light = Number(lo[2]);
  assert(dark >= 0.38 && dark <= 0.45, `koyu/soft kilitli opaklık aralık dışı (${dark})`);
  assert(light >= 0.55 && light <= 0.6, `açık/warm kilitli opaklık aralık dışı (${light})`);
  // Dekoratif + erişilebilirlikten gizli.
  assert(/accessibilityElementsHidden/.test(sym), 'sembol erişilebilirlikten gizlenmemiş');
  assert(/importantForAccessibility="no-hide-descendants"/.test(sym), 'sembol a11y ağacından çıkarılmamış');
});

check('7. Paylaşılan sembolde zemin/çerçeve/daire/gradient/glow/gölge/animasyon YOK', () => {
  // Yorumsuz kaynak — "şu YOK" kontrolleri bileşenin kendi belgeleme yorumuna takılmasın.
  const sym = source('components/achievements/achievement-symbol.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  assert(!/backgroundColor/.test(sym), 'sembolde arka plan var');
  assert(!/border(Width|Color|Radius)/.test(sym), 'sembolde çerçeve/daire var');
  assert(!/gradient|LinearGradient/i.test(sym), 'sembolde gradient var');
  assert(!/shadow(Color|Opacity|Radius|Offset)|elevation:|glow/i.test(sym), 'sembolde gölge/glow var');
  assert(!/Animated|withTiming|useSharedValue/.test(sym), 'sembolde animasyon var');
  assert(!/'#[0-9A-Fa-f]{3,8}'/.test(sym), 'sembolde sabit hex renk var (tema dışı)');
});

check('8. İşlevsel lock/check/edit ikonları ve erişilebilirlik sözleşmeleri korunuyor', () => {
  const view = source('components/achievements/career-achievements-view.tsx');
  assert(/name="checkmark-circle"/.test(view), 'liste satırı açık işareti (checkmark) kayboldu');
  assert(/name="lock-closed"/.test(view), 'liste satırı kilit işareti kayboldu');
  assert(/accessibilityRole="button"/.test(view) && /accessibilityLabel=/.test(view), 'liste satırı a11y sözleşmesi kayboldu');
  const showcaseEdit = source('components/ranks/profile-career-showcase.tsx');
  assert(/name="pencil-outline"/.test(showcaseEdit), 'Success düzenleme kalemi kayboldu');
  const grid = source('app/achievements-showcase.tsx');
  assert(/accessibilityState=\{\{ selected: isSelected \}\}/.test(grid), 'seçim grid a11y selected durumu kayboldu');
  assert(/HeaderBackButton/.test(grid), 'geri düğmesi kayboldu');
});

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Kariyer başarımı sembolleri harness: ${passed} kontrol geçti.`);
console.log('  (Görüntü çözme yok — PNG başlıkları ham bayttan, kaynaklar statik denetlendi.)');
