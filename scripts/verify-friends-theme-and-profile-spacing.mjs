#!/usr/bin/env node
/**
 * Üç dar UI düzeltmesinin kaynak sözleşmesi:
 *   1. Friends paleti yüzey/metin renklerini aktif temadan alır.
 *   2. Friends vurgusu hâlâ useFeatureColor('friends', ...) üzerinden gelir.
 *   3. Profil kimliği → Level/Rank aralığı azaltılır (global aralık korunur).
 *   4. Profil ScrollView'ından eski 56 pt alt boşluk kaldırılır.
 *
 * Canlı render yok: tek kaynak dosyalar statik olarak denetlenir.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (path) => readFileSync(join(ROOT, path), 'utf8');
const friendsTheme = source('components/friends/friends-theme.ts');
const profile = source('app/(tabs)/profile.tsx');

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
function assert(value, message) {
  if (!value) throw new Error(message);
}

// Palet hook gövdesini (useFriendsPalette) yalıtır.
const paletteHook = friendsTheme.slice(
  friendsTheme.indexOf('export function useFriendsPalette'),
  friendsTheme.indexOf('export const FriendsMetrics'),
);
// surfacesFromTheme yüzey eşlemesi.
const surfaceMap = friendsTheme.slice(
  friendsTheme.indexOf('function surfacesFromTheme'),
  friendsTheme.indexOf('export function useFriendsPalette'),
);

// ---------------------------------------------------------------------------
// 1. Friends yüzey/metin paleti aktif useAppTheme().colors değerlerinden gelir.
// ---------------------------------------------------------------------------
check('1. Friends yüzey/metin paleti aktif temadan (useAppTheme().colors) türer', () => {
  assert(/const \{ colors, isDark \} = useAppTheme\(\)/.test(paletteHook), 'palet aktif tema colors değerini okumuyor');
  const surfacePairs = {
    background: 'colors.background',
    card: 'colors.card',
    field: 'colors.surfaceMuted',
    border: 'colors.border',
    separator: 'colors.separator',
    text: 'colors.text',
    textSecondary: 'colors.textSecondary',
    textTertiary: 'colors.textTertiary',
    danger: 'colors.danger',
  };
  for (const [key, token] of Object.entries(surfacePairs)) {
    const re = new RegExp(`${key}:\\s*${token.replace('.', '\\.')}\\b`);
    assert(re.test(surfaceMap), `${key} yüzeyi ${token} tokenından gelmiyor`);
  }
});

// ---------------------------------------------------------------------------
// 2. Friends vurgu rengi hâlâ useFeatureColor('friends', ...) üzerinden gelir.
// ---------------------------------------------------------------------------
check('2. Friends vurgusu useFeatureColor(\'friends\', ...) ile korunuyor', () => {
  assert(/useFeatureColor\('friends', base\.accent\)/.test(paletteHook), 'friends özellik rengi çağrısı kaybolmuş');
  assert(/accent: friendsAccent\.color/.test(paletteHook), 'kullanıcı seçili accent uygulanmıyor');
  assert(/accentStrong: friendsAccent\.color/.test(paletteHook), 'accentStrong kullanıcı seçiminden gelmiyor');
  assert(/onAccent: friendsAccent\.onColor/.test(paletteHook), 'onAccent kullanıcı seçiminden gelmiyor');
  // Vurgu varsayılanları (mor) korunur; global mavi temaya kaymaz.
  assert(/ACCENT_DARK[\s\S]*?accent: '#A472F0'/.test(friendsTheme), 'koyu tema mor accent varsayılanı değişmiş');
  assert(/ACCENT_LIGHT[\s\S]*?accent: '#7A3FE0'/.test(friendsTheme), 'açık tema mor accent varsayılanı değişmiş');
});

// ---------------------------------------------------------------------------
// 3. Friends palette YÜZEYLERİNDE sabit #000000/#FFFFFF kalmaz.
// ---------------------------------------------------------------------------
check('3. Friends yüzeylerinde sabit #000000/#FFFFFF yok', () => {
  // Yüzey/metin katmanı yalnız tema tokenlarından gelir; hiç hex içermemeli.
  assert(!/#[0-9A-Fa-f]{6}/.test(surfaceMap), 'yüzey eşlemesi hâlâ ham hex içeriyor');
  // Saf siyah/beyaz artık palet YÜZEYİ olarak hiçbir yerde yazılmıyor.
  assert(!/(background|card|field|border|separator|text|textSecondary|textTertiary|danger):\s*'#000000'/.test(friendsTheme),
    'yüzey rengi saf siyaha sabitlenmiş');
  assert(!/(background|card|field|border|separator|text|textSecondary|textTertiary|danger):\s*'#FFFFFF'/.test(friendsTheme),
    'yüzey rengi saf beyaza sabitlenmiş');
  // Eski sabit DARK/LIGHT yüzey paletleri kaldırıldı.
  assert(!/const DARK: FriendsPalette/.test(friendsTheme), 'eski sabit DARK yüzey paleti hâlâ duruyor');
  assert(!/const LIGHT: FriendsPalette/.test(friendsTheme), 'eski sabit LIGHT yüzey paleti hâlâ duruyor');
});

// ---------------------------------------------------------------------------
// 4. Profil kimliği → Level/Rank aralığı azalır; global aralık DEĞİŞMEZ.
// ---------------------------------------------------------------------------
check('4. Yalnız ilk ayırıcı aralığı azalır; global sectionDivider korunur', () => {
  const global = Number(friendsMarginOf(profile, 'sectionDivider'));
  const first = Number(profile.match(/firstDividerSpacing:\s*\{\s*marginVertical:\s*(\d+)/)?.[1]);
  assert(global === 20, `global sectionDivider marginVertical değişmiş (${global})`);
  assert(Number.isFinite(first) && first < global, `ilk ayırıcı aralığı azaltılmamış (${first})`);
  // İlk ayırıcı sectionDivider'ı KORUYARAK override alır (global stil bozulmaz).
  assert(/style=\{\[styles\.sectionDivider, styles\.firstDividerSpacing\]\}/.test(profile),
    'ilk ayırıcı sectionDivider + firstDividerSpacing bileşimini kullanmıyor');
  // Kimlik bloğunun alt boşluğu da hafifçe azaltıldı.
  const summaryBottom = Number(profile.match(/profileSummary:\s*\{[^}]*paddingBottom:\s*(\d+)/)?.[1]);
  assert(Number.isFinite(summaryBottom) && summaryBottom <= 12, `kimlik alt boşluğu azaltılmamış (${summaryBottom})`);
});

// ---------------------------------------------------------------------------
// 5. Edit/Ayarlar ve Level/Rank içerik ölçüleri korunur.
// ---------------------------------------------------------------------------
check('5. Edit/Ayarlar ve Level/Rank içerik ölçüleri korunuyor', () => {
  const progress = source('components/rewards/profile-progress-summary.tsx');
  assert(/editProfileButton:\s*\{[\s\S]*?minHeight: Layout\.minTouchSize/.test(profile), 'Düzenle butonu 44 pt dokunma alanını kaybetti');
  assert(/settingsButton:\s*\{[\s\S]*?(height|minHeight): Layout\.minTouchSize/.test(profile), 'Ayarlar butonu 44 pt dokunma alanını kaybetti');
  assert(/name="pencil-outline" size=\{13\}/.test(profile), 'Düzenle ikonu boyutu değişmiş');
  assert(/name="settings-outline" size=\{19\}/.test(profile), 'Ayarlar ikonu boyutu değişmiş');
  // Level/Rank simge çemberi ve satır yüksekliği aynı.
  assert(/identityIcon:[\s\S]*?height: 56[\s\S]*?width: 56/.test(progress), 'Level/Rank simge çemberi 56 pt değil');
  assert(/identityRow:[\s\S]*?minHeight: 116/.test(progress), 'Level/Rank satır yüksekliği değişmiş');
});

// ---------------------------------------------------------------------------
// 6. Profil ScrollView'ından eski 56 pt alt boşluk kaldırılır.
// ---------------------------------------------------------------------------
check('6. Eski 56 pt alt boşluk kaldırıldı', () => {
  assert(!/PROFILE_CONTENT_BOTTOM_PADDING/.test(profile), 'eski 56 pt sabit hâlâ tanımlı');
  assert(/content:\s*\{\s*paddingBottom:\s*0/.test(profile), 'içerik alt boşluğu 0 değil');
  // Tab bar yüksekliği/insets.bottom içeriğe İKİNCİ kez eklenmiyor.
  const contentStyle = profile.match(/content:\s*\{[^}]*\}/)?.[0] ?? '';
  assert(!/insets|tabBar/i.test(contentStyle), 'içerik boşluğuna insets/tabBar elle eklenmiş');
});

// ---------------------------------------------------------------------------
// 7. Katalog kartının iç alt dolgusu ve Friends ≥44 pt dokunma alanı korunur.
// ---------------------------------------------------------------------------
check('7. Katalog kartı iç dolgusu ve Friends dokunma alanı korunuyor', () => {
  assert(/catalogCard:\s*\{[\s\S]*?paddingBottom:\s*26/.test(profile), 'katalog kartı iç alt dolgusu (26) değişmiş');
  const friendsStart = profile.indexOf('friendsRow:');
  const friendsBlock = profile.slice(friendsStart, profile.indexOf('}', profile.indexOf('minHeight', friendsStart)) + 1);
  const minHeight = Number(friendsBlock.match(/minHeight:\s*(\d+)/)?.[1]);
  assert(Number.isFinite(minHeight) && minHeight >= 44, `Friends satırı < 44 pt (${minHeight})`);
});

// ---------------------------------------------------------------------------
// 8. Katalog bindirmesi ve tema tokenları bozulmaz.
// ---------------------------------------------------------------------------
check('8. Katalog bindirmesi (-18) ve tema token zeminleri korunuyor', () => {
  assert(/catalogCardPos1:\s*\{[\s\S]*?marginTop: -18/.test(profile), 'ikinci kart -18 bindirmesini kaybetti');
  assert(/catalogCardPos2:\s*\{[\s\S]*?marginTop: -18/.test(profile), 'üçüncü kart -18 bindirmesini kaybetti');
  assert(/catalogCardPos0:\s*\{ backgroundColor: colors\.surfaceMuted/.test(profile), 'pos0 zemini tema tokenından gelmiyor');
  assert(/catalogCardPos1:\s*\{ backgroundColor: colors\.surface/.test(profile), 'pos1 zemini tema tokenından gelmiyor');
});

/** Bir stil adındaki marginVertical değerini döndürür. */
function friendsMarginOf(code, styleName) {
  const block = code.match(new RegExp(`${styleName}:\\s*\\{[^}]*\\}`))?.[0] ?? '';
  return block.match(/marginVertical:\s*(\d+)/)?.[1];
}

if (failures.length > 0) {
  console.error('✗ Friends teması + profil aralığı harness başarısız:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Friends teması + profil aralığı harness: ${passed} kontrol geçti.`);
console.log('  (Canlı render yok — kaynak dosyalar statik olarak denetlendi.)');
