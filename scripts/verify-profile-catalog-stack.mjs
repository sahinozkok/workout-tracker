#!/usr/bin/env node
/**
 * PROFİL KATALOG YIĞINI — DAR KAPSAMLI KAYNAK SÖZLEŞMESİ
 *
 * Kapsam: `app/(tabs)/profile.tsx` ekranının EN ALTINDAKİ üç bölümünün (Aktif
 * Program, Disiplin, Arkadaşlar) tek bir katalog grubunda üst üste binen kartlar
 * hâline getirilmesini kilitler. Amaç kaynak metnini dondurmak değil, katalog
 * yerleşiminin anlamlı sözleşmelerini doğrulamaktır:
 *
 *   · üç bölüm TEK katalog grubunun (`catalogStack`) içindedir,
 *   · bindirme NEGATİF margin ile yapılır (mutlak konumlandırma YOKTUR),
 *   · katman zemini yalnız tema tokenlarından (`colors.surface` /
 *     `colors.surfaceMuted`) gelir,
 *   · Aktif Program görünmezken düzen çalışabilecek yapıdadır (konum koşullu),
 *   · bölümlerin İÇİ (bileşenler, ikonlar, tipografi, route'lar) korunur.
 *
 * Canlı render YOKTUR: tek kaynak dosya statik olarak denetlenir.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

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

const raw = source('app/(tabs)/profile.tsx');
/** Yorumsuz kaynak — "şu YOK" ve SIRA kontrolleri yorum metnine takılmasın. */
const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/** Yalnız render gövdesi (createStyles öncesi) — grup/sıra kontrolleri için. */
const renderBody = code.slice(0, code.indexOf('function createStyles('));

/** `catalogStack` View'inin AÇILIŞ etiketinden kapanışına kadarki JSX bloğu. */
function catalogGroupBlock() {
  const open = renderBody.indexOf('<View style={styles.catalogStack}>');
  assert(open !== -1, 'katalog grubu (styles.catalogStack) bulunamadı');
  // Grubun kapanışı: bu View'den sonraki ilk </View> derinlik takibiyle bulunur.
  let depth = 0;
  let i = open;
  while (i < renderBody.length) {
    const nextOpen = renderBody.indexOf('<View', i + 1);
    const nextClose = renderBody.indexOf('</View>', i + 1);
    assert(nextClose !== -1, 'katalog grubu kapanışı bulunamadı');
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen;
    } else if (depth > 0) {
      depth -= 1;
      i = nextClose;
    } else {
      return renderBody.slice(open, nextClose + '</View>'.length);
    }
  }
  throw new Error('katalog grubu bloğu ayrıştırılamadı');
}

const group = catalogGroupBlock();

// ---------------------------------------------------------------------------
// A. Üç bölüm TEK katalog grubu içindedir.
// ---------------------------------------------------------------------------
check('A1. Aktif Program, Disiplin ve Arkadaşlar tek katalog grubundadır', () => {
  assert(/<View style=\{styles\.catalogStack\}>/.test(renderBody), 'katalog grubu wrapper yok');
  assert(group.includes('<ProfileSharedProgram'), 'Aktif Program katalog grubunda değil');
  assert(group.includes('<ProfileDisciplineCard'), 'Disiplin katalog grubunda değil');
  assert(/router\.push\('\/friends'\)/.test(group), 'Arkadaşlar satırı katalog grubunda değil');
  // Grup DIŞINDA bu üç bölümün ikinci bir kopyası olmamalı.
  assert((renderBody.match(/<ProfileDisciplineCard/g) ?? []).length === 1, 'Disiplin birden çok kez render ediliyor');
  assert((renderBody.match(/<ProfileSharedProgram/g) ?? []).length === 1, 'Aktif Program birden çok kez render ediliyor');
});

check('A2. Üç bölüm arasında düz ayırıcı (sectionDivider) YOKTUR', () => {
  assert(!group.includes('styles.sectionDivider'), 'katalog kartları arasında hâlâ sectionDivider var');
  // Grup üç kartı da MotionSection ile taşır (bölüm girişleri korunur).
  assert((group.match(/<MotionSection/g) ?? []).length === 3, 'katalog grubu üç MotionSection taşımıyor');
});

// ---------------------------------------------------------------------------
// B. Bindirme NEGATİF margin ile — mutlak konumlandırma YOK.
// ---------------------------------------------------------------------------
check('B1. Alt kartlar negatif üst margin ile üsttekine biner', () => {
  const pos1 = styleBlock('catalogCardPos1');
  const pos2 = styleBlock('catalogCardPos2');
  const m1 = Number(pos1.match(/marginTop:\s*(-\d+)/)?.[1]);
  const m2 = Number(pos2.match(/marginTop:\s*(-\d+)/)?.[1]);
  assert(Number.isFinite(m1) && m1 < 0, 'ikinci kartta negatif üst margin yok');
  assert(Number.isFinite(m2) && m2 < 0, 'üçüncü kartta negatif üst margin yok');
  // Bindirme referanstaki ~16–20 pt aralığında.
  assert(-m1 >= 16 && -m1 <= 20, `ikinci kart bindirmesi 16–20 pt dışında (${-m1})`);
  assert(-m2 >= 16 && -m2 <= 20, `üçüncü kart bindirmesi 16–20 pt dışında (${-m2})`);
});

check('B2. İlk kart binmez; alt kartlar artan zIndex ile öne çıkar', () => {
  const pos0 = styleBlock('catalogCardPos0');
  const pos1 = styleBlock('catalogCardPos1');
  const pos2 = styleBlock('catalogCardPos2');
  assert(!/marginTop/.test(pos0), 'ilk kartta bindirme (marginTop) var');
  const z0 = Number(pos0.match(/zIndex:\s*(\d+)/)?.[1]);
  const z1 = Number(pos1.match(/zIndex:\s*(\d+)/)?.[1]);
  const z2 = Number(pos2.match(/zIndex:\s*(\d+)/)?.[1]);
  assert(z0 < z1 && z1 < z2, `zIndex artarak yükselmeli (pos0=${z0}, pos1=${z1}, pos2=${z2})`);
});

check('B3. Katalog kartlarının bindirmesi mutlak konumlandırma KULLANMAZ', () => {
  // Bindirme yalnız negatif margin ile yapılır; katalog stillerinin hiçbiri
  // konumlandırma sızdırmaz. (Ekranın avatar/medya bindirmesi gibi mevcut,
  // konuyla ilgisiz `position` kullanımları bu kontrolün dışındadır.)
  const catalogStyles = [
    styleBlock('catalogStack'),
    styleBlock('catalogCard'),
    styleBlock('catalogCardPos0'),
    styleBlock('catalogCardPos1'),
    styleBlock('catalogCardPos2'),
  ].join('\n');
  // Kartlar akışta durur: yalnız alt esneme sırasında Friends zeminini
  // sürdüren dekoratif dolgu mutlak konumlu olabilir; kartların kendisi olamaz.
  assert(!/position:/.test(catalogStyles), 'katalog kartlarında position kullanılmış');
});

// ---------------------------------------------------------------------------
// C. Üst köşeler belirgin yuvarlatılır; kartlar tam genişlik + aynı hiza.
// ---------------------------------------------------------------------------
check('C1. Her kartın ÜST köşeleri belirgin yuvarlatılır', () => {
  const card = styleBlock('catalogCard');
  const topLeft = Number(card.match(/borderTopLeftRadius:\s*(\d+)/)?.[1]);
  const topRight = Number(card.match(/borderTopRightRadius:\s*(\d+)/)?.[1]);
  assert(Number.isFinite(topLeft) && topLeft >= 16, `üst-sol köşe yeterince yuvarlak değil (${topLeft})`);
  assert(topLeft === topRight, 'üst köşeler simetrik değil');
  // Alt köşeler bir sonraki kartın altında kaldığı için yuvarlatılmaz.
  assert(!/borderBottomLeftRadius|borderBottomRadius\b/.test(card), 'alt köşeler beklenmedik biçimde yuvarlatılmış');
});

check('C2. Kartlar tam genişlikte ve aynı yatay hizadadır', () => {
  const card = styleBlock('catalogCard');
  assert(/width:\s*'100%'/.test(card), 'kart tam genişlikte değil');
  // İç yatay pay ortak screenPadding: içerik ekranın diğer bölümleriyle hizalı.
  assert(/paddingHorizontal:\s*Layout\.screenPadding/.test(card), 'kart iç yatay payı screenPadding değil');
  assert(/width:\s*'100%'/.test(styleBlock('catalogStack')), 'katalog grubu tam genişlikte değil');
});

// ---------------------------------------------------------------------------
// D. Katman ayrımı YALNIZ tema tokenlarından gelir; yeni renk/gölge yok.
// ---------------------------------------------------------------------------
check('D1. Kart zeminleri colors.surface / colors.surfaceMuted tokenlarını kullanır', () => {
  const pos0 = styleBlock('catalogCardPos0');
  const pos1 = styleBlock('catalogCardPos1');
  const pos2 = styleBlock('catalogCardPos2');
  for (const [name, block] of [['pos0', pos0], ['pos1', pos1], ['pos2', pos2]]) {
    assert(
      /backgroundColor:\s*colors\.(surface|surfaceMuted)\b/.test(block),
      `${name} zemini tema tokenı (surface/surfaceMuted) kullanmıyor`,
    );
  }
  // Komşu kartlar farklı tokenlarla ayrışır (katman seçilebilsin).
  const t0 = pos0.match(/backgroundColor:\s*colors\.(surface\w*)/)?.[1];
  const t1 = pos1.match(/backgroundColor:\s*colors\.(surface\w*)/)?.[1];
  const t2 = pos2.match(/backgroundColor:\s*colors\.(surface\w*)/)?.[1];
  assert(t0 !== t1, 'birinci ve ikinci kart aynı zemin tokenını kullanıyor (katman ayrımı yok)');
  assert(t1 !== t2, 'ikinci ve üçüncü kart aynı zemin tokenını kullanıyor (katman ayrımı yok)');
});

check('D2. Yeni renk / gradyan / glow / gölge EKLENMEZ', () => {
  const catalogStyles = [
    styleBlock('catalogStack'),
    styleBlock('catalogCard'),
    styleBlock('catalogCardPos0'),
    styleBlock('catalogCardPos1'),
    styleBlock('catalogCardPos2'),
  ].join('\n');
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(catalogStyles), 'katalog stillerinde serbest hex renk var');
  assert(!/gradient|LinearGradient/i.test(catalogStyles), 'katalog stillerinde gradyan var');
  assert(
    !/shadowRadius|shadowOpacity|shadowOffset|shadowColor|elevation:\s*[1-9]/.test(catalogStyles),
    'katalog stillerinde gölge/elevation var',
  );
});

// ---------------------------------------------------------------------------
// E. Aktif Program görünmezken düzen çalışabilecek yapıdadır.
// ---------------------------------------------------------------------------
check('E1. Aktif Program koşullu; yoksa Disiplin pos0, Arkadaşlar pos1 olur', () => {
  // Aktif Program yalnız görünürlük koşulu (ownSharedProgram) sağlanınca çizilir.
  assert(/\{ownSharedProgram && \(/.test(group), 'Aktif Program görünürlük guardı yok');
  // Disiplin ve Arkadaşlar kartlarının konumu ownSharedProgram'a göre kayar.
  assert(
    /ownSharedProgram \? styles\.catalogCardPos1 : styles\.catalogCardPos0/.test(group),
    'Disiplin kartı, Aktif Program yokken ilk konuma (pos0) düşmüyor',
  );
  assert(
    /ownSharedProgram \? styles\.catalogCardPos2 : styles\.catalogCardPos1/.test(group),
    'Arkadaşlar kartı, Aktif Program yokken ikinci konuma (pos1) düşmüyor',
  );
});

// ---------------------------------------------------------------------------
// F. Bölümlerin İÇİ korunur: bileşenler, ikonlar, tipografi, route'lar.
// ---------------------------------------------------------------------------
check('F1. Aktif Program ortak bileşeninin veri/işlev sözleşmesi korunur', () => {
  assert(
    /<ProfileSharedProgram accentColor=\{profileAccent\.color\} compact program=\{ownSharedProgram\} \/>/.test(group),
    'ProfileSharedProgram çağrısı değişmiş',
  );
});

check('F2. Disiplin kartı collapsible/compact sözleşmesini korur', () => {
  assert(
    /<ProfileDisciplineCard accentColor=\{profileAccent\.color\} collapsible compact \/>/.test(group),
    'ProfileDisciplineCard çağrısı değişmiş',
  );
});

check('F3. Arkadaşlar satırı: ikonlar, metinler, route ve dokunma alanı korunur', () => {
  assert(/name="people-outline" size=\{18\}/.test(group), 'Arkadaşlar ikonu/boyutu değişmiş');
  assert(/name="chevron-forward" size=\{16\}/.test(group), 'Arkadaşlar chevron ikonu/boyutu değişmiş');
  assert(/t\('friends\.profileRow'\)/.test(group), 'Arkadaşlar başlığı i18n anahtarı değişmiş');
  assert(/t\('friends\.profileRowCaption'\)/.test(group), 'Arkadaşlar açıklaması i18n anahtarı değişmiş');
  assert(/accessibilityRole="button"/.test(group), 'Arkadaşlar satırı buton rolünü kaybetti');
  // Arkadaşlar satırı dokunma alanı (>= 44 pt) ve tam genişliği aynen korunur.
  const friends = styleBlock('friendsRow');
  const minHeight = Number(friends.match(/minHeight:\s*(\d+)/)?.[1]);
  assert(Number.isFinite(minHeight) && minHeight >= 44, `Arkadaşlar satırı < 44 pt (${minHeight})`);
  assert(/width:\s*'100%'/.test(friends), 'Arkadaşlar satırı tam genişliğini kaybetti');
});

check('F4. Kart iç dolgusu içeriği kırpmaz (overflow gizlenmez)', () => {
  const card = styleBlock('catalogCard');
  // Açılan içerik (Aktif Program/Disiplin) doğal akışta büyüsün diye kart
  // içeriği kırpılmaz: sabit yükseklik veya overflow:'hidden' verilmez.
  assert(!/overflow:\s*'hidden'/.test(card), 'katalog kartı içeriği kırpıyor (overflow hidden)');
  assert(!/\bheight:\s*\d/.test(card), 'katalog kartına sabit yükseklik verilmiş');
});

check('F5. Friends zemini alt sınır esnemesinde alt barın arkasına devam eder', () => {
  assert(group.includes('styles.friendsOverscrollFill'), 'Friends alt-esneme dolgusu render edilmiyor');
  assert(/pointerEvents="none"/.test(group), 'alt-esneme dolgusu dokunmaları engelleyebilir');
  assert(
    /backgroundColor:\s*ownSharedProgram \? colors\.surfaceMuted : colors\.surface/.test(group),
    'alt-esneme dolgusu Friends kartıyla aynı tema rengini kullanmıyor',
  );
  const fill = styleBlock('friendsOverscrollFill');
  assert(/position:\s*'absolute'/.test(fill), 'dolgu akış dışına alınmamış');
  assert(/bottom:\s*-FRIENDS_OVERSCROLL_FILL_HEIGHT/.test(fill), 'dolgu kartın altından başlamıyor');
  assert(/height:\s*FRIENDS_OVERSCROLL_FILL_HEIGHT/.test(fill), 'dolgu sabit esneme rezervini kullanmıyor');
});

// ---------------------------------------------------------------------------

/** Bir StyleSheet girdisinin gövdesini döndürür (dengeli süslü parantez). */
function styleBlock(name) {
  const start = code.indexOf(`${name}: {`);
  assert(start !== -1, `stil bloğu bulunamadı: ${name}`);
  let depth = 0;
  for (let i = code.indexOf('{', start); i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error(`stil bloğu kapanışı bulunamadı: ${name}`);
}

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Profil katalog yığını harness: ${passed} kontrol geçti.`);
console.log('  (Canlı render yok — tek kaynak dosya statik olarak denetlendi.)');
