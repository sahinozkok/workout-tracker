/**
 * Alt navigasyon ikonlarının DAR KAPSAMLI sözleşme harness'ı.
 *
 * SINIR: React render EDİLMEZ; bu tarama `app/(tabs)/_layout.tsx` kaynak
 * metninin ikon sözleşmesini ölçer. Amaç, ikonları Ionicons outline→filled
 * sistemine taşırken korunması gereken davranışların (Rosea görseli, seçilme
 * animasyonu, Reduce Motion, fade, safe-area, sekme sırası) bozulmadığını
 * doğrulamaktır.
 *
 * Çalıştırma:  node scripts/verify-tab-bar-icons.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');

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

/**
 * Sözleşme taramaları GERÇEK KODU ölçer, açıklama metnini değil. Yorumlar
 * çıkarılmazsa "Feather kalmadı" gibi bir iddia, dosyanın açıklamasında geçen
 * kelimeye takılıp yanlış düşerdi.
 */
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const layout = stripComments(source('app/(tabs)/_layout.tsx'));

// ===========================================================================
console.log('=== A. İkon ailesi ===');
// ===========================================================================

check('A1. Feather artık alt bar dosyasında kullanılmıyor', () => {
  assert(!/\bFeather\b/.test(layout), 'Feather referansı kalmış');
  assert(!/@expo\/vector-icons['"][\s\S]*Feather/.test(layout), 'Feather importu kalmış');
});

check('A2. Dört standart sekme Ionicons kullanıyor', () => {
  assert(/import \{ Ionicons \} from '@expo\/vector-icons'/.test(layout), 'Ionicons importu yok');
  assert((layout.match(/<Ionicons\b/g) ?? []).length === 4, 'tam olarak dört Ionicons beklenir');
});

check('A3. Başka ikon paketi eklenmemiş', () => {
  const vectorImports = layout.match(/from '@expo\/vector-icons'/g) ?? [];
  assert(vectorImports.length === 1, 'birden çok vector-icons importu');
  assert(!/react-native-vector-icons|lucide|@expo\/vector-icons\/(?!$)/.test(layout), 'yabancı ikon paketi');
});

// ===========================================================================
console.log('\n=== B. Outline → filled eşleşmeleri ===');
// ===========================================================================

const mappings = [
  ['Home', 'home'],
  ['Programs', 'barbell'],
  ['History', 'time'],
  ['Profile', 'person'],
];

for (const [label, base] of mappings) {
  check(`B. ${label}: ${base}-outline → ${base}`, () => {
    const pattern = new RegExp(
      `name=\\{focused \\? '${base}' : '${base}-outline'\\} size=\\{size \\?\\? TAB_ICON_SIZE\\}`,
    );
    assert(pattern.test(layout), `${base} outline/filled eşleşmesi veya tutarlı boyut yok`);
  });
}

check('B5. Optik boyut tutarlı (~23–24 pt)', () => {
  assert(/const TAB_ICON_SIZE = 2[34];/.test(layout), 'TAB_ICON_SIZE 23–24 aralığında değil');
  // Dört ikon da aynı boyut ifadesini kullanır (eski -1/-2 düzeltmeleri gitmiş).
  assert((layout.match(/size=\{size \?\? TAB_ICON_SIZE\}/g) ?? []).length === 4, 'dört ikon aynı boyutu kullanmıyor');
  assert(!/size=\{\(size \?\? 24\) - [12]\}/.test(layout), 'eski Feather boyut düzeltmesi kalmış');
});

// ===========================================================================
console.log('\n=== C. Coach / Rosea görseli korunuyor ===');
// ===========================================================================

check('C1. Coach standart ikon değil, özel görsel', () => {
  const coachBlock = layout.slice(
    layout.indexOf('name="coach"'),
    layout.indexOf('name="profile"'),
  );
  assert(coachBlock.length > 0, 'coach bloğu bulunamadı');
  assert(!/<Ionicons\b/.test(coachBlock), 'coach sekmesine standart ikon konmuş');
  assert(/<Image\b/.test(coachBlock), 'coach görseli yok');
});

check('C2. Mascot asset ve SEÇİLMEMİŞ görünüm birebir korunuyor', () => {
  assert(/const coachMascotSource = require\('\.\.\/\.\.\/assets\/images\/ai-coach-mascot\.png'\)/.test(layout),
    'mascot asset yolu değişmiş');
  assert(/source=\{coachMascotSource\}/.test(layout), 'mascot source bağlanmamış');
  // Seçilmemiş dal: cover + mevcut ölçüler + colors.icon tinti (mevcut hâl).
  assert(
    /contentFit="cover"[\s\S]*?source=\{coachMascotSource\}[\s\S]*?height: \(size \?\? 24\) \+ 6, width: \(size \?\? 24\) \+ 18[\s\S]*?tintColor=\{colors\.icon\}/.test(layout),
    'seçilmemiş mascot cover/ölçü/tint korunmamış',
  );
});

check('C3. SEÇİLİ Rosea, aktif sekme rengiyle TAMAMEN DOLU kompakt madalyona oturur', () => {
  // Zemin, aktif sekme rengiyle (color) inline ve tam opak dolu — yeni sabit yok.
  assert(/backgroundColor: color/.test(layout), 'seçili madalyon aktif sekme rengini kullanmıyor');
  assert(/styles\.coachMedallion/.test(layout), 'seçili madalyon stili bağlanmamış');
  const medallion = layout.slice(
    layout.indexOf('coachMedallion: {'),
    layout.indexOf('coachMascotSelected: {'),
  );
  assert(medallion.length > 0, 'coachMedallion stili bulunamadı');
  assert(/borderRadius: Layout\.radiusPill/.test(medallion), 'madalyon tam daire (radiusPill) değil');
  assert(/overflow: 'hidden'/.test(medallion), 'madalyon taşmayı kırpmıyor');
  // Kompakt: madalyon çapı 24 pt ikon optik ağırlığına yakın ve mevcut mascot
  // kutusundan (size+18 = 42) DAHA GENİŞ DEĞİL → "ayrı büyük buton" değil.
  const width = /width: TAB_ICON_SIZE \+ (\d+)/.exec(medallion);
  assert(width, 'madalyon genişliği TAB_ICON_SIZE türevinden gelmiyor');
  assert(24 + Number(width[1]) <= 42, `madalyon mevcut mascot kutusundan geniş (büyük buton riski): ${24 + Number(width[1])}pt`);
  assert(/height: TAB_ICON_SIZE \+ /.test(medallion), 'madalyon yüksekliği TAB_ICON_SIZE türevinden gelmiyor');
});

check('C4. Maskot dolu zeminde on-accent kontrastıyla çizilir; yeni renk sabiti yok', () => {
  // Accent zemin üstünde accent tint kaybolurdu; on-accent ile net kontrast.
  assert(/tintColor=\{getOnAccentColor\(color\)\}/.test(layout), 'seçili maskot on-accent tint kullanmıyor');
  assert(/getOnAccentColor/.test(layout) && /from '@\/constants\/color-presets'/.test(layout),
    'getOnAccentColor mevcut yardımcıdan import edilmemiş');
  // Seçiliyken de aynı asset ve oranı korunur (contain — maskot tam görünür).
  assert(/contentFit="contain"[\s\S]*?source=\{coachMascotSource\}/.test(layout), 'seçili maskot contain ile tam görünmüyor');
  // Alt bar dosyasına YENİ renk sabiti (hex) / gradient / gölge / glow eklenmemiş.
  assert(!/#[0-9A-Fa-f]{3,8}/.test(layout), 'alt bar dosyasına sabit renk (hex) eklenmiş');
  assert(!/gradient|shadow|elevation:\s*[1-9]|shadowColor|shadowOpacity/i.test(layout), 'gradient/gölge/glow eklenmiş');
});

// ===========================================================================
console.log('\n=== D. Sekme sırası ve route adları ===');
// ===========================================================================

check('D1. Sekme sırası Home → Programs → History → Coach → Profile', () => {
  const order = (layout.match(/name="(index|programs|history|coach|profile)"/g) ?? [])
    .map((m) => m.replace(/name="|"/g, ''));
  assert(
    JSON.stringify(order) === JSON.stringify(['index', 'programs', 'history', 'coach', 'profile']),
    `sıra bozulmuş: ${order.join(' → ')}`,
  );
});

check('D2. Başlık çevirileri korunmuş', () => {
  for (const key of ['home', 'programs', 'history', 'coach', 'profile']) {
    assert(new RegExp(`title: t\\('tabs\\.${key}'\\)`).test(layout), `başlık çevirisi eksik: tabs.${key}`);
  }
});

// ===========================================================================
console.log('\n=== E. Korunan davranışlar ===');
// ===========================================================================

check('E1. TabIconFeedback seçilme animasyonu korunuyor', () => {
  assert(/function TabIconFeedback\(/.test(layout), 'TabIconFeedback tanımı yok');
  assert((layout.match(/<TabIconFeedback focused=\{focused\}>/g) ?? []).length === 5,
    'beş sekmenin tamamı TabIconFeedback ile sarılmamış');
  assert(/MotionScale\.tabIconSelect/.test(layout), 'seçilme ölçek geri bildirimi yok');
});

check('E2. Reduce Motion davranışı korunuyor', () => {
  assert(/useReducedMotion/.test(layout), 'useReducedMotion yok');
  assert(/if \(!focused \|\| reduceMotion\)/.test(layout), 'reduce motion kapısı değişmiş');
});

check('E3. Sekmeler arası fade geçişi korunuyor', () => {
  assert(/animation: 'fade'/.test(layout), 'fade geçişi yok');
  assert(/transitionSpec: TAB_TRANSITION_SPEC/.test(layout), 'geçiş speci değişmiş');
});

check('E4. Safe-area, yükseklik ve alt boşluk korunuyor', () => {
  assert(/useSafeAreaInsets/.test(layout), 'safe-area insets yok');
  assert(/Layout\.tabBarHeight \+ insets\.bottom/.test(layout), 'tab bar yükseklik hesabı değişmiş');
  assert(/paddingBottom: insets\.bottom/.test(layout), 'alt boşluk hesabı değişmiş');
});

check('E5. Seçili/seçilmemiş renk ve gizli etiket korunuyor', () => {
  assert(/tabBarActiveTintColor: todayColor/.test(layout), 'todayHighlight seçili renk davranışı değişmiş');
  assert(/useFeatureColor\('todayHighlight'/.test(layout), 'todayHighlight feature rengi yok');
  assert(/tabBarInactiveTintColor: colors\.tabIconDefault/.test(layout), 'seçilmemiş ikon rengi değişmiş');
  assert(/tabBarShowLabel: false/.test(layout), 'tabBarShowLabel false değil');
});

check('E6. Yeni asset yok — yalnız mevcut mascot require ediliyor', () => {
  const requires = layout.match(/require\('[^']+'\)/g) ?? [];
  assert(requires.length === 1, `beklenmeyen require sayısı: ${requires.length}`);
  assert(/ai-coach-mascot\.png/.test(requires[0]), 'tek require mascot değil');
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Alt navigasyon ikon harness'ı: ${pass} kontrol geçti.`);
