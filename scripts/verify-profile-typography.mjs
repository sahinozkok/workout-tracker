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

/** Yorumsuz kaynak — "şu YOK" kontrolleri yanlış alarm üretmesin. */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const profileCode = stripComments(profileSource);
const proofCode = stripComments(proofSource);

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

check('2. Görünen ad ~30 pt / 600 / 36 lh ve ortalı', () => {
  const block = styleBlock(profileCode, 'summaryName');
  assert(/fontSize:\s*30\b/.test(block), 'summaryName fontSize 30 değil');
  assert(/fontWeight:\s*'600'/.test(block), 'summaryName ağırlığı 600 değil');
  assert(/lineHeight:\s*36\b/.test(block), 'summaryName lineHeight 36 değil');
  assert(/textAlign:\s*'center'/.test(block), 'summaryName ortalı değil');
  // 38 pt / 700 baskın serif değerine geri dönülmemeli.
  assert(!/fontSize:\s*38\b/.test(block), 'summaryName eski 38 pt değerine dönmüş');
  assert(!/fontWeight:\s*'700'/.test(block), 'summaryName eski 700 ağırlığına dönmüş');
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

check('4. Kullanıcı adı ~13 pt / 500, normal yazım, vurgu rengi', () => {
  const block = styleBlock(profileCode, 'summaryUsername');
  assert(/fontSize:\s*13\b/.test(block), 'summaryUsername fontSize 13 değil');
  assert(/fontWeight:\s*'500'/.test(block), 'summaryUsername ağırlığı 500 değil');
  assert(/color:\s*profile\.accent/.test(block), 'summaryUsername vurgu rengini kaybetti');
  // Dekoratif uppercase + geniş letterSpacing kalkmalı.
  assert(!/textTransform/.test(block), 'summaryUsername hâlâ uppercase');
  assert(!/letterSpacing/.test(block), 'summaryUsername hâlâ letterSpacing taşıyor');
  assert(!/fontSize:\s*11\b/.test(block), 'summaryUsername eski 11 pt değerine dönmüş');
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

check('6. Edit butonu dokunma yüksekliği en az Layout.minTouchSize', () => {
  const block = styleBlock(profileCode, 'editProfileButton');
  assert(
    /minHeight:\s*Layout\.minTouchSize/.test(block),
    'editProfileButton minHeight Layout.minTouchSize değil',
  );
  assert(!/minHeight:\s*38\b/.test(block), 'editProfileButton eski 38 pt değerine dönmüş');
  // Ayarlar butonu ve mevcut yollar korunur.
  assert(profileSource.includes("router.push('/settings')"), 'ayarlar yolu kayboldu');
});

// ---------------------------------------------------------------------------
// 4 · Profil kanıt istatistikleri (profile-proof-stats.tsx)
// ---------------------------------------------------------------------------

check('7. Kanıt değerleri referanstaki güçlü ~24 pt / 600 ve tabular-nums', () => {
  const block = styleBlock(proofCode, 'value');
  assert(/fontSize:\s*24\b/.test(block), 'kanıt değeri fontSize 24 değil');
  assert(/fontWeight:\s*'600'/.test(block), 'kanıt değeri ağırlığı 600 değil');
  assert(/fontVariant:\s*\['tabular-nums'\]/.test(block), 'tabular-nums kaldırılmış');
  assert(!/fontSize:\s*17\b/.test(block), 'kanıt değeri eski kompakt 17 pt değerine dönmüş');
});

check('8. Kanıt etiketleri en az 10 pt ve okunabilir line height', () => {
  const block = styleBlock(proofCode, 'label');
  const size = Number(block.match(/fontSize:\s*([\d.]+)/)?.[1]);
  const lineHeight = Number(block.match(/lineHeight:\s*([\d.]+)/)?.[1]);
  assert(Number.isFinite(size) && size >= 10, `etiket fontSize < 10 (${size})`);
  assert(Number.isFinite(lineHeight) && lineHeight >= 13, `etiket lineHeight okunabilir değil (${lineHeight})`);
  // Zor okunan 7.5 pt geri gelmemeli.
  assert(!/fontSize:\s*7\.5\b/.test(block), 'etiket eski 7.5 pt değerine dönmüş');
});

check('9. İkon daireleri referanstaki ~60 pt', () => {
  const block = styleBlock(proofCode, 'iconCircle');
  assert(/height:\s*60\b/.test(block) && /width:\s*60\b/.test(block), 'ikon dairesi 60 pt değil');
  assert(/borderRadius:\s*30\b/.test(block), 'ikon dairesi tam yuvarlak değil');
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

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Profil tipografisi harness: ${passed} kontrol geçti.`);
console.log('  (Canlı render yok — iki kaynak dosya statik olarak denetlendi.)');
