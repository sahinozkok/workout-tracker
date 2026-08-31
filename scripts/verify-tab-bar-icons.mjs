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

/**
 * Coach dalını focused/unfocused parçalarına ayırır. Sözleşme taramaları GERÇEK
 * JSX'i ölçer: dış ölçü, katman sayısı, ofsetler ve "madalyon yok" iddiası
 * yorum metnine değil koda bakar.
 */
const coachBlock = layout.slice(
  layout.indexOf('name="coach"'),
  layout.indexOf('name="profile"'),
);
const coachElseIdx = coachBlock.indexOf(') : (');
const coachFocused = coachBlock.slice(coachBlock.indexOf('focused ? ('), coachElseIdx);
const coachUnfocused = coachBlock.slice(coachElseIdx);
/** Mevcut Rosea dış kutusu: 30 × 42 (size tabanı 24). */
const OUTER_BOX = /height: \(size \?\? 24\) \+ 6, width: \(size \?\? 24\) \+ 18/;

check('C2. Coach dış kutusu focused ve unfocused BİREBİR aynı', () => {
  assert(coachElseIdx > 0, 'coach focused/unfocused dalları bulunamadı');
  assert(OUTER_BOX.test(coachFocused), 'seçili Rosea dış kutusu (30×42) değişmiş');
  assert(OUTER_BOX.test(coachUnfocused), 'seçilmemiş Rosea dış kutusu (30×42) değişmiş');
  // İki daldaki dış ölçü ifadesi birebir aynı string olmalı.
  assert(
    coachFocused.match(OUTER_BOX)[0] === coachUnfocused.match(OUTER_BOX)[0],
    'focused ve unfocused dış ölçüleri aynı değil',
  );
});

check('C3. SEÇİLMEMİŞ Rosea mevcut hâliyle korunuyor (cover + colors.icon)', () => {
  assert(/const coachMascotSource = require\('\.\.\/\.\.\/assets\/images\/ai-coach-mascot\.png'\)/.test(layout),
    'mascot asset yolu değişmiş');
  assert(/contentFit="cover"/.test(coachUnfocused), 'seçilmemiş mascot cover değil');
  assert(/source=\{coachMascotSource\}/.test(coachUnfocused), 'seçilmemiş mascot source bağlanmamış');
  assert(/tintColor=\{colors\.icon\}/.test(coachUnfocused), 'seçilmemiş mascot tinti colors.icon değil');
});

check('C4. SEÇİLİ Rosea: merkez tam renk, çevre düşük alfa; arka plansız faux-bold', () => {
  // BİRDEN ÇOK aynı asset katmanı: ofset dizisi üzerinde map.
  assert(/COACH_LAYER_OFFSETS\.map\(/.test(coachFocused), 'seçili Rosea katmanları ofset dizisi üzerinden çizilmiyor');
  assert(/source=\{coachMascotSource\}/.test(coachFocused), 'seçili katman aynı mascot asset’ini kullanmıyor');
  assert(/contentFit="cover"/.test(coachFocused), 'seçili katman kırpılma biçimini (cover) korumuyor');
  assert(/StyleSheet\.absoluteFill/.test(coachFocused), 'katmanlar aynı kutuda absolute yerleşmiyor');
  assert(
    /transform: \[\{ translateX: offset\.x \}, \{ translateY: offset\.y \}\]/.test(coachFocused),
    'katman ofsetleri transform ile uygulanmıyor',
  );

  // TINT AYRIMI: yalnız MERKEZ katman tam `color`; dört ÇEVRE katmanı düşük alfa.
  assert(/const isCenter = offset\.x === 0 && offset\.y === 0/.test(coachFocused), 'merkez/çevre katman ayrımı yok');
  assert(
    /tintColor=\{isCenter \? color : withAlpha\(color, COACH_EDGE_ALPHA\)\}/.test(coachFocused),
    'merkez tam color / çevre withAlpha(color, düşük) ayrımı yok',
  );
  // Eski "tüm katmanlar tintColor={color}" sözleşmesi KALMAMALI (floresan riski).
  assert(!/tintColor=\{color\}/.test(coachFocused), 'katmanların tümü hâlâ tam color kullanıyor');
  // withAlpha MEVCUT yardımcıdan alınmalı.
  assert(/import \{ withAlpha \} from '@\/constants\/color-presets'/.test(layout), 'withAlpha color-presets’ten import edilmemiş');

  // Çevre alfası düşük ve yumuşak: ~0.20–0.25 aralığı (öneri 0.22).
  const alphaMatch = /const COACH_EDGE_ALPHA = (0\.\d+);/.exec(layout);
  assert(alphaMatch, 'COACH_EDGE_ALPHA tanımlı değil');
  const alpha = Number(alphaMatch[1]);
  assert(alpha >= 0.2 && alpha <= 0.25, `çevre alfası ~0.20–0.25 değil: ${alpha}`);

  // Ofset çok küçük: ~0.35 pt (0.3–0.4). Daha fazlası bulanıklaştırır/parlatır.
  const offsetMatch = /const COACH_THICKEN_OFFSET = (0\.\d+);/.exec(layout);
  assert(offsetMatch, 'COACH_THICKEN_OFFSET tanımlı değil');
  const magnitude = Number(offsetMatch[1]);
  assert(magnitude >= 0.3 && magnitude <= 0.4, `ofset ~0.35 (0.3–0.4) değil: ${magnitude}`);

  // Katmanlar: merkez + dört yön (beş) ve SİMETRİK.
  const arrayStart = layout.indexOf('const COACH_LAYER_OFFSETS = [');
  assert(arrayStart >= 0, 'COACH_LAYER_OFFSETS tanımlı değil');
  const offsetsArray = layout.slice(arrayStart, layout.indexOf('];', arrayStart));
  const entries = offsetsArray.match(/\{ x: [^}]+, y: [^}]+\}/g) ?? [];
  assert(entries.length === 5, `beş katman (merkez + dört yön) beklenir: ${entries.length}`);
  for (const needle of [
    '{ x: 0, y: 0 }',
    '{ x: -COACH_THICKEN_OFFSET, y: 0 }',
    '{ x: COACH_THICKEN_OFFSET, y: 0 }',
    '{ x: 0, y: -COACH_THICKEN_OFFSET }',
    '{ x: 0, y: COACH_THICKEN_OFFSET }',
  ]) {
    assert(offsetsArray.includes(needle), `simetrik ofset eksik: ${needle}`);
  }

  // Arka plan / daire / pill / madalyon / border / kaldırılan yardımcı YOK.
  assert(!/backgroundColor/.test(coachBlock), 'seçili Rosea’ya arka plan eklenmiş');
  assert(!/opacity:/.test(coachBlock), 'seçili Rosea’ya opacity zemini eklenmiş');
  assert(!/coachMedallion/.test(layout), 'madalyon stili hâlâ duruyor');
  assert(!/getOnAccentColor/.test(layout), 'kaldırılması gereken getOnAccentColor hâlâ kullanılıyor');
  assert(!/borderRadius|radiusPill/.test(layout), 'daire/pill/madalyon köşe yarıçapı hâlâ var');
  assert(!/\bborder(?!Top)/.test(coachBlock), 'seçili Rosea’ya border eklenmiş');
  // Yeni renk sabiti (hex), gradient, gölge veya glow yok.
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
