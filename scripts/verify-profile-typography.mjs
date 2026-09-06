#!/usr/bin/env node
/**
 * PROFİL TİPOGRAFİSİ — DOĞRULAMA HARNESS'I
 *
 * Kapsam: SADECE profil kimliği ve profil kanıt istatistiklerinin TİPOGRAFİ ve
 * OKUNABİLİRLİK hiyerarşisi. Rank/level/XP/gül/seri hesapları, Supabase akışları,
 * yükleme/kaydetme güvenlik kapıları ve bileşen sırası BURADA test edilmez —
 * onlar kendi harness'larındadır ve bu düzenlemede değişmemiştir.
 *
 * Canlı render YOKTUR: iki kaynak dosya statik olarak denetlenir. Amaç, dar
 * tasarım düzenlemesinin (font boyutu/ağırlığı, dokunma hedefi, aralık) geri
 * kaymasını (regression) yakalamaktır. Her kontrol, eski değere geri dönüldüğünde
 * DÜŞECEK şekilde yazılmıştır.
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

const profileSource = source('app/(tabs)/profile.tsx');
const proofSource = source('components/rewards/profile-proof-stats.tsx');
const progressSource = source('components/rewards/profile-progress-summary.tsx');
const successSource = source('components/ranks/profile-career-showcase.tsx');
const friendSource = source('app/profile/[userId].tsx');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

/** Yorumsuz kaynak — "şu YOK" kontrolleri yanlış alarm üretmesin. */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const profileCode = stripComments(profileSource);
const proofCode = stripComments(proofSource);
const progressCode = stripComments(progressSource);
const successCode = stripComments(successSource);
const friendCode = stripComments(friendSource);

/** Bir stil bloğunu ` name: { ... }` olarak ayıklar. */
function styleBlock(code, name) {
  const start = code.indexOf(`${name}: {`);
  if (start < 0) throw new Error(`${name} stili bulunamadı`);
  let depth = 0;
  for (let i = code.indexOf('{', start); i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error(`${name} stil bloğu kapanmadı`);
}

// ---------------------------------------------------------------------------
// 1 · Profil kimliği — görünen ad (summaryName)
// ---------------------------------------------------------------------------

check('1. Görünen ad sistem fontu kullanır (serif import kaldırıldı)', () => {
  const block = styleBlock(profileCode, 'summaryName');
  // Serif font kalkmış olmalı: ne stil ne de import kalır.
  assert(!/fontFamily/.test(block), 'summaryName hâlâ özel bir fontFamily taşıyor');
  assert(!/Fonts\.serif/.test(profileCode), 'summaryName hâlâ Fonts.serif kullanıyor');
  assert(
    !/import\s*\{[^}]*\bFonts\b[^}]*\}\s*from\s*'@\/constants\/theme'/.test(profileSource),
    'kullanılmayan Fonts importu kaldırılmamış',
  );
  assert(!/\bFonts\./.test(profileCode), 'dosyada hâlâ Fonts kullanımı var');
});

check('2. Görünen ad 27 pt / 500 / 33 lh ve ortalı (zarif ölçü)', () => {
  const block = styleBlock(profileCode, 'summaryName');
  assert(/fontSize:\s*27\b/.test(block), 'summaryName fontSize 27 değil');
  assert(/fontWeight:\s*'500'/.test(block), 'summaryName ağırlığı 500 değil');
  assert(/lineHeight:\s*33\b/.test(block), 'summaryName lineHeight 33 değil');
  assert(/textAlign:\s*'center'/.test(block), 'summaryName ortalı değil');
  // Eski 30/38 pt ve 600/700 ağırlık değerlerine geri dönülmemeli.
  assert(!/fontSize:\s*(30|38)\b/.test(block), 'summaryName eski 30/38 pt değerine dönmüş');
  assert(!/fontWeight:\s*'(600|700)'/.test(block), 'summaryName eski 600/700 ağırlığına dönmüş');
});

check('3. Görünen ad en fazla 2 satır (taşma/kırpılma kontrollü)', () => {
  // `{2}` regex niceleyicisidir; süslü parantez kaçırılır.
  assert(
    /<Text[^>]*numberOfLines=\{2\}[^>]*style=\{styles\.summaryName\}/.test(profileSource) ||
      /style=\{styles\.summaryName\}[^>]*numberOfLines=\{2\}/.test(profileSource),
    'summaryName 2 satırla sınırlanmamış',
  );
});

// ---------------------------------------------------------------------------
// 2 · Profil kimliği — kullanıcı adı (summaryUsername)
// ---------------------------------------------------------------------------

check('4. Kullanıcı adı 12 pt / 500, normal yazım, vurgu rengi', () => {
  const block = styleBlock(profileCode, 'summaryUsername');
  assert(/fontSize:\s*12\b/.test(block), 'summaryUsername fontSize 12 değil');
  assert(/fontWeight:\s*'500'/.test(block), 'summaryUsername ağırlığı 500 değil');
  assert(/color:\s*accent\b/.test(block), 'summaryUsername vurgu rengini kaybetti');
  // Dekoratif uppercase + geniş letterSpacing kalkmalı.
  assert(!/textTransform/.test(block), 'summaryUsername hâlâ uppercase');
  assert(!/letterSpacing/.test(block), 'summaryUsername hâlâ letterSpacing taşıyor');
  assert(!/fontSize:\s*13\b/.test(block), 'summaryUsername eski 13 pt değerine dönmüş');
});

// ---------------------------------------------------------------------------
// 3 · Genel ritim ve edit butonu
// ---------------------------------------------------------------------------

check('5. profileSummary ritmi: kimlik sıkı, büyük bölüm ayrık', () => {
  const summary = styleBlock(profileCode, 'profileSummary');
  const gap = Number(summary.match(/gap:\s*(\d+)/)?.[1]);
  assert(Number.isFinite(gap), 'profileSummary gap okunamadı');
  // Kimlik öğeleri artık daha sıkı (eski 8 değil).
  assert(gap <= 6, `profileSummary gap kimliği sıkılaştırmıyor (gap=${gap})`);

  const summaryBottom = Number(summary.match(/paddingBottom:\s*(\d+)/)?.[1]);
  const divider = styleBlock(profileCode, 'sectionDivider');
  const dividerSpace = Number(divider.match(/marginVertical:\s*(\d+)/)?.[1]);
  assert(Number.isFinite(summaryBottom), 'profileSummary paddingBottom okunamadı');
  assert(Number.isFinite(dividerSpace), 'sectionDivider marginVertical okunamadı');
  assert(summaryBottom + dividerSpace >= 28, `kimlik/bölüm ayrımı yetersiz (${summaryBottom + dividerSpace} pt)`);
});

check('6. Düzenle profilden kaldırıldı; Ayarlar dişlisi 44 pt; /settings korunur', () => {
  // ÜRÜN KARARI: profilde artık "Düzenle" düğmesi YOK (düzenleme Ayarlar'dan).
  assert(!/editProfileButton/.test(profileCode), 'profilde eski Düzenle düğmesi hâlâ var');
  const gear = styleBlock(profileCode, 'settingsButton');
  assert(
    /(minHeight|height):\s*Layout\.minTouchSize/.test(gear),
    'Ayarlar dişlisi 44 pt dokunma hedefinde değil',
  );
  assert(profileSource.includes("router.push('/settings')"), 'ayarlar yolu kayboldu');
});

// ---------------------------------------------------------------------------
// 4 · Profil kanıt istatistikleri (profile-proof-stats.tsx)
// ---------------------------------------------------------------------------

check('7. Kanıt değerleri sakin 22 pt / 500, 26 lh ve tabular-nums', () => {
  const block = styleBlock(proofCode, 'value');
  assert(/fontSize:\s*22\b/.test(block), 'kanıt değeri fontSize 22 değil');
  assert(/fontWeight:\s*'500'/.test(block), 'kanıt değeri ağırlığı 500 değil');
  assert(/lineHeight:\s*26\b/.test(block), 'kanıt değeri lineHeight 26 değil');
  assert(/fontVariant:\s*\['tabular-nums'\]/.test(block), 'tabular-nums kaldırılmış');
  assert(!/fontSize:\s*24\b/.test(block), 'kanıt değeri eski 24 pt değerine dönmüş');
});

check('8. Kanıt etiketleri 11 pt / 400, normal yazım (uppercase transform yok)', () => {
  const block = styleBlock(proofCode, 'label');
  const size = Number(block.match(/fontSize:\s*([\d.]+)/)?.[1]);
  const lineHeight = Number(block.match(/lineHeight:\s*([\d.]+)/)?.[1]);
  assert(size === 11, `etiket fontSize 11 değil (${size})`);
  assert(/fontWeight:\s*'400'/.test(block), 'etiket ağırlığı 400 değil');
  assert(Number.isFinite(lineHeight) && lineHeight >= 15, `etiket lineHeight < 15 (${lineHeight})`);
  // Normal başlık biçimi: uppercase transform ve geniş letterSpacing kalkmalı.
  assert(!/textTransform/.test(block), 'etiket hâlâ uppercase transform taşıyor');
  assert(!/letterSpacing:\s*0\.4/.test(block), 'etiket eski letterSpacing 0.4 değerine dönmüş');
  // Zor okunan 7.5 pt geri gelmemeli.
  assert(!/fontSize:\s*7\.5\b/.test(block), 'etiket eski 7.5 pt değerine dönmüş');
});

check('9. İkon daireleri dengeli ~52 pt', () => {
  const block = styleBlock(proofCode, 'iconCircle');
  assert(/height:\s*52\b/.test(block) && /width:\s*52\b/.test(block), 'ikon dairesi 52 pt değil');
  assert(/borderRadius:\s*26\b/.test(block), 'ikon dairesi tam yuvarlak değil');
});

check('10. Her istatistiğin yerleşim yüksekliği en az 44 pt', () => {
  const block = styleBlock(proofCode, 'stat');
  const minHeight = Number(block.match(/minHeight:\s*(\d+)/)?.[1]);
  assert(Number.isFinite(minHeight) && minHeight >= 44, `stat minHeight < 44 (${minHeight})`);
});

check('11. Etiket küçülmesi minimumFontScale 0.85 altına düşmez', () => {
  const match = proofCode.match(/minimumFontScale=\{([\d.]+)\}/);
  assert(match, 'minimumFontScale bulunamadı');
  const scale = Number(match[1]);
  assert(scale >= 0.85, `minimumFontScale 0.85 altında (${scale})`);
  // Tek satırda kontrollü küçülme korunur.
  assert(/adjustsFontSizeToFit/.test(proofCode), 'adjustsFontSizeToFit kaldırılmış');
  assert(/numberOfLines=\{1\}/.test(proofCode), 'etiket tek satır kısıtını kaybetti');
});

// ---------------------------------------------------------------------------
// 5 · Korunması gereken davranışlar
// ---------------------------------------------------------------------------

check('12. Seri alanı basılabilir ve erişilebilir kalır', () => {
  assert(proofSource.includes('onDayStreakPress'), 'seri press davranışı kaldırılmış');
  assert(proofSource.includes('accessibilityRole="button"'), 'seri butonu erişilebilir rolü kaybetti');
  assert(proofSource.includes('hitSlop'), 'seri dokunma alanı hitSlop koruması kayboldu');
  assert(proofSource.includes('accessibilityLabel'), 'kanıt erişilebilirlik metni kayboldu');
});

check('13. Üç rengin anlamı ve kompakt tek satır korunur', () => {
  for (const color of ['#C86E61', '#7C9978', '#BD9147']) {
    assert(proofSource.includes(color), `kanıt rengi kayboldu: ${color}`);
  }
  // Tek satır düzeni (row) hâlâ üç istatistiği yan yana taşır.
  assert(/(\{t\('profile\.proofRoses'\))/.test(proofSource), 'gül etiketi kayboldu');
  assert(proofSource.includes("t('profile.proofWorkoutDays')"), 'antrenman günü etiketi kayboldu');
  assert(proofSource.includes("t('profile.proofDayStreak')"), 'seri etiketi kayboldu');
});

check('14. Kart/gradient/gölge/emoji EKLENMEMİŞ', () => {
  assert(!/gradient/i.test(proofCode), 'gradient eklenmiş');
  assert(!/shadow(Radius|Opacity|Offset|Color)/.test(proofCode), 'gölge eklenmiş');
  assert(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(proofCode), 'emoji eklenmiş');
});

// ---------------------------------------------------------------------------
// 6 · Zarif tipografi düzenlemesinin YENİ değerleri (bio / level / XP / Success)
// ---------------------------------------------------------------------------

check('15. Biyografi 13 pt / 400 / 19 lh (kendi + arkadaş aynı)', () => {
  for (const [name, code] of [['kendi', profileCode], ['arkadaş', friendCode]]) {
    const block = styleBlock(code, 'summaryBio');
    assert(/fontSize:\s*13\b/.test(block), `${name} bio fontSize 13 değil`);
    assert(/fontWeight:\s*'400'/.test(block), `${name} bio ağırlığı 400 değil`);
    assert(/lineHeight:\s*19\b/.test(block), `${name} bio lineHeight 19 değil`);
    assert(/color:\s*colors\.textSecondary/.test(block), `${name} bio ikincil rengini kaybetti`);
    assert(/textAlign:\s*'center'/.test(block), `${name} bio ortalamayı kaybetti`);
  }
});

check('16. Kendi ve arkadaş kimlik tipografisi AYNI (isim 27/500/33, username 12/500)', () => {
  const nameBlock = styleBlock(friendCode, 'summaryName');
  assert(/fontSize:\s*27\b/.test(nameBlock), 'arkadaş isim fontSize 27 değil');
  assert(/fontWeight:\s*'500'/.test(nameBlock), 'arkadaş isim ağırlığı 500 değil');
  assert(/lineHeight:\s*33\b/.test(nameBlock), 'arkadaş isim lineHeight 33 değil');
  const userBlock = styleBlock(friendCode, 'summaryUsername');
  assert(/fontSize:\s*12\b/.test(userBlock), 'arkadaş username fontSize 12 değil');
  assert(/fontWeight:\s*'500'/.test(userBlock), 'arkadaş username ağırlığı 500 değil');
});

check('17. Level metni 19 pt / 500 (24 lh); Level Rose/dokunma değişmez', () => {
  const block = styleBlock(progressCode, 'levelValue');
  assert(/fontSize:\s*19\b/.test(block), 'levelValue fontSize 19 değil');
  assert(/fontWeight:\s*'500'/.test(block), 'levelValue ağırlığı 500 değil');
  assert(/lineHeight:\s*24\b/.test(block), 'levelValue lineHeight 24 değil');
  assert(!/fontSize:\s*22\b/.test(block), 'levelValue eski 22 pt değerine dönmüş');
  // Level Rose ölçüsü (32 pt) DEĞİŞMEZ.
  assert(/size=\{32\}/.test(progressSource), 'Level Rose ölçüsü değişmiş');
});

check('18. XP hedef değeri (progressValue) 13 pt / 500 ve tabular-nums; renk korunur', () => {
  const block = styleBlock(progressCode, 'progressValue');
  assert(/fontSize:\s*13\b/.test(block), 'progressValue fontSize 13 değil');
  assert(/fontWeight:\s*'500'/.test(block), 'progressValue ağırlığı 500 değil');
  assert(/fontVariant:\s*\['tabular-nums'\]/.test(block), 'progressValue tabular-nums kaybetti');
  assert(/color:\s*colors\.textSecondary/.test(block), 'progressValue rengi değişmiş');
  assert(!/fontWeight:\s*'600'/.test(block), 'progressValue eski 600 ağırlığına dönmüş');
  // progressLabel ve ortadaki nokta 13 pt / 400 (Type.caption) yapısını korur.
  assert(/progressLabel:[\s\S]*?Type\.caption/.test(progressCode), 'progressLabel Type.caption yapısını kaybetti');
});

check('19. Success başlığı 11 pt / 500 (letterSpacing 0.8, uppercase korunur)', () => {
  const block = styleBlock(successCode, 'title');
  assert(/fontSize:\s*11\b/.test(block), 'Success başlığı fontSize 11 değil');
  assert(/fontWeight:\s*'500'/.test(block), 'Success başlığı ağırlığı 500 değil');
  assert(/letterSpacing:\s*0\.8\b/.test(block), 'Success başlığı letterSpacing 0.8 değil');
  assert(/textTransform:\s*'uppercase'/.test(block), 'Success başlığı uppercase davranışını kaybetti');
  // Locale anahtarı korunur (sabit metin değil).
  assert(/t\('careerAchievements\.showcase\.successTitle'\)/.test(successSource), 'Success başlığı locale anahtarını kaybetti');
});

check('20. Rank/RP etiketi 11 pt / 500 + tabular; rank durum metni 500', () => {
  const label = styleBlock(successCode, 'rankLabelText');
  assert(/fontSize:\s*11\b/.test(label), 'rankLabelText fontSize 11 değil');
  assert(/fontWeight:\s*'500'/.test(label), 'rankLabelText ağırlığı 500 değil');
  assert(/fontVariant:\s*\['tabular-nums'\]/.test(label), 'rankLabelText tabular-nums kaybetti');
  assert(!/fontSize:\s*12\b/.test(label), 'rankLabelText eski 12 pt değerine dönmüş');
  // Tek satır + taşma koruması korunur.
  assert(/numberOfLines=\{1\} style=\{styles\.rankLabelText\}/.test(successSource), 'rank etiketi tek satır kısıtını kaybetti');
  const state = styleBlock(successCode, 'rankStateText');
  assert(/fontWeight:\s*'500'/.test(state), 'rankStateText ağırlığı 500 değil');
});

check('21. Proof etiketleri normal başlık biçimi (TR/EN locale değerleri)', () => {
  assert(/proofRoses:\s*'Güller'/.test(localeTr), 'TR proofRoses normal başlık değil');
  assert(/proofWorkoutDays:\s*'Antrenman Günü'/.test(localeTr), 'TR proofWorkoutDays normal başlık değil');
  assert(/proofDayStreak:\s*'Günlük Seri'/.test(localeTr), 'TR proofDayStreak normal başlık değil');
  assert(/proofRoses:\s*'Roses'/.test(localeEn), 'EN proofRoses normal başlık değil');
  assert(/proofWorkoutDays:\s*'Workout Days'/.test(localeEn), 'EN proofWorkoutDays normal başlık değil');
  assert(/proofDayStreak:\s*'Day Streak'/.test(localeEn), 'EN proofDayStreak normal başlık değil');
  // Erişilebilirlik cümleleri DEĞİŞMEZ (sayı + anlam korunur).
  assert(/proofRosesA11y:\s*'\{count\} gül'/.test(localeTr), 'TR gül a11y cümlesi değişmiş');
  assert(/proofRosesA11y:\s*'\{count\} roses'/.test(localeEn), 'EN gül a11y cümlesi değişmiş');
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Profil tipografisi harness: ${passed} kontrol geçti.`);
console.log('  (Canlı render yok — kaynak dosyalar statik olarak denetlendi.)');
