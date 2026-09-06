#!/usr/bin/env node
/**
 * RANK GÖRSEL GEZİNME — DOĞRULAMA HARNESS'I
 *
 * Bu tur iki görsel sözleşmeyi kilitler:
 *   1. Rank ekranındaki YEREL içerik sekmeleri (Genel / Başarılar / Geçmiş) —
 *      yalnızca sunum state'i: yeni route, bottom tab, sorgu veya RPC YOK ve
 *      veri yüklemeleri sekmeye göre KOŞULLANDIRILMAZ.
 *   2. Kademeye özgü YEREL RESİM ASSET'i (`RankEmblem`) — aynı doğru asset rank
 *      özetinde (hero), `RankBadge` içinde (compact), rank rehberinde (medium)
 *      ve profil özetinde kullanılır; yedi rank için yedi asset eşleşmesi vardır.
 *
 * SÖZLEŞME DEĞİŞİKLİĞİ (kullanıcı talebi) — emblem artık Ionicons değil, gerçek
 * transparan PNG asset'idir. Bu yüzden eski "yalnızca Ionicons / png require
 * yasak / `color` zorunlu prop" beklentileri yeni sözleşmeyle GEÇERSİZDİR;
 * yerlerine daha güçlü kontroller kondu: yedi asset dosyasının gerçekten var
 * olması, PNG + alfa kanalı taşıması ve doğru rank'a eşlenmesi doğrulanır.
 *
 * Projede jest KURULU DEĞİL; diğer rank harness'ları gibi kaynak metni statik
 * denetlenir. Harness gerçek SÖZLEŞMEYİ test eder; yorum/boşluk değişikliklerine
 * bağlı değildir.
 */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (path) => readFileSync(join(ROOT, path), 'utf8');

const screen = source('app/rank.tsx');
const badge = source('components/ranks/rank-badge.tsx');
const guide = source('app/rank-guide.tsx');
const emblem = source('components/ranks/rank-emblem.tsx');
const profileShowcase = source('components/ranks/profile-career-showcase.tsx');
const constants = source('constants/ranks.ts');
const achievementIcons = source('components/ranks/achievement-icons.ts');
const tr = source('locales/tr.ts');
const en = source('locales/en.ts');

let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

/** `activeTab === '<key>'` dallanmasını kendi `) : null}` kapanışına kadar çıkarır. */
function tabBlock(key) {
  // RENDER dalını hedefle (`activeTab === '<key>' ? (`). Not: rank ekranında ayrıca
  // sekme-etkin senkron effect'i (`if (activeTab === 'achievements') ...`) bulunur;
  // bu yüzden yalnız string eşleşmesi değil, koşullu-render biçimi aranır.
  const start = screen.indexOf(`activeTab === '${key}' ? (`);
  assert.ok(start !== -1, `${key} sekmesi ekranda dallanmalı`);
  const rest = screen.slice(start + key.length);
  const end = rest.indexOf(') : null}');
  assert.ok(end !== -1, `${key} sekmesi ) : null} ile kapanmalı`);
  return rest.slice(0, end);
}

// ---------------------------------------------------------------------------
// 1. Üç yerel sekme ve varsayılan overview.
// ---------------------------------------------------------------------------
check(/type RankTabKey =\s*'overview'\s*\|\s*'achievements'\s*\|\s*'history'/.test(screen), 'Üç yerel sekme tipi tanımlı olmalı');
check(/RANK_TAB_KEYS[^\n]*\[\s*'overview',\s*'achievements',\s*'history'\s*\]/.test(screen), 'Sekme sırası overview→achievements→history olmalı');
check(screen.includes("useState<RankTabKey>('overview')"), 'Varsayılan sekme overview olmalı');
for (const key of ['overview', 'achievements', 'history']) {
  check(tr.includes(`${key}:`) && /tabs:\s*{/.test(tr), `Türkçe sekme etiketi ${key} olmalı`);
  check(en.includes(`${key}:`) && /tabs:\s*{/.test(en), `İngilizce sekme etiketi ${key} olmalı`);
  check(screen.includes(`t(\`ranks.tabs.${key}\`)`) || screen.includes("t(`ranks.tabs.${key}`)"), 'Sekme etiketi çeviriden gelmeli');
}
check(/overview:\s*'Genel'/.test(tr) && /achievements:\s*'Başarılar'/.test(tr) && /history:\s*'Geçmiş'/.test(tr), 'Türkçe sekme metinleri doğru olmalı');
check(/overview:\s*'Overview'/.test(en) && /achievements:\s*'Achievements'/.test(en) && /history:\s*'History'/.test(en), 'İngilizce sekme metinleri doğru olmalı');

// ---------------------------------------------------------------------------
// 2. Sekmeler 44 pt ve erişilebilir; seçili durum a11y ağacında.
// ---------------------------------------------------------------------------
check(screen.includes('accessibilityRole="tab"'), 'Sekmeler tab rolü taşımalı');
check(/accessibilityState=\{\{\s*selected:/.test(screen), 'Seçili durum accessibilityState ile bildirilmeli');
check(/tab:\s*\{[^}]*minHeight:\s*Layout\.minTouchSize/.test(screen), 'Her sekme en az 44 pt dokunma yüksekliğinde olmalı');
check(/tabLabel:\s*\{[^}]*color:\s*colors\.textSecondary/.test(screen), 'Seçilmemiş sekme metni textSecondary olmalı');
check(/tabLabelActive:\s*\{[^}]*color:\s*colors\.text/.test(screen), 'Seçili sekme metni colors.text olmalı');
check(screen.includes('backgroundColor: accent') && screen.includes('tabUnderline'), 'Seçili alt çizgi mevcut rank rengini kullanmalı');
check(/tabBar:\s*\{[^}]*borderBottomWidth:\s*StyleSheet\.hairlineWidth/.test(screen), 'Sekme şeridi sade alt çizgili olmalı (pill değil)');
check(!screen.includes('borderRadius: Layout.radiusPill') || !/tab:\s*\{[^}]*radiusPill/.test(screen), 'Sekmeler pill görünümü kullanmamalı');

// ---------------------------------------------------------------------------
// 3. İçerik doğru sekmelere ayrılmış.
// ---------------------------------------------------------------------------
const overviewBlock = tabBlock('overview');
const achievementsBlock = tabBlock('achievements');
const historyBlock = tabBlock('history');
check(overviewBlock.includes('WeekFocusCard') && overviewBlock.includes("t('ranks.seasonEndsIn')"), 'Genel sekmesi haftalık odak ve sezon istatistiklerini içermeli');
check(!overviewBlock.includes('CareerAchievementsView') && !overviewBlock.includes("t('ranks.recentActivity')"), 'Genel sekmesi başarı/geçmiş içeriğini içermemeli');
// ÜRÜN KARARI: Başarılar sekmesi kalıcı kariyer başarımlarının ortak bileşenini
// gösterir (sezonluk grid kaldırıldı).
check(achievementsBlock.includes('CareerAchievementsView') && !achievementsBlock.includes('AchievementsGrid'), 'Başarılar sekmesi kalıcı kariyer başarım bileşenini içermeli');
check(!achievementsBlock.includes('WeekFocusCard') && !achievementsBlock.includes("t('ranks.pastSeasons')"), 'Başarılar sekmesi diğer içerikleri içermemeli');
check(historyBlock.includes("t('ranks.recentActivity')") && historyBlock.includes("t('ranks.pastSeasons')"), 'Geçmiş sekmesi RP hareketleri ve geçmiş sezonları içermeli');
check(!historyBlock.includes('WeekFocusCard') && !historyBlock.includes('CareerAchievementsView'), 'Geçmiş sekmesi diğer içerikleri içermemeli');

// ---------------------------------------------------------------------------
// 4. Veri yüklemeleri sekmeye göre KOŞULLANDIRILMAMIŞ.
// ---------------------------------------------------------------------------
// Eski sezon `loadAchievements` mount effect'i kaldırıldı (kalıcı kariyer sistemine
// devredildi); rank/RP yükleyicileri korunur.
for (const loader of ['loadHistory', 'loadEvents', 'loadWeekFocus']) {
  check(new RegExp(`useEffect\\(\\(\\) => \\{\\s*void ${loader}\\(\\);`).test(screen), `${loader} mount effect'i korunmalı`);
}
check(!/void loadAchievements\(\);/.test(screen), 'eski sezon loadAchievements mount effect\'i hâlâ var');
// Rank/RP yükleyici çağrısının olduğu satırlarda sekme state'i geçmemeli.
for (const line of screen.split('\n')) {
  if (/void load(History|Events|WeekFocus)\(\);/.test(line)) {
    check(!line.includes('activeTab'), 'Veri yüklemesi sekmeye göre koşullandırılmamalı');
  }
}
// Effect'lerin bağımlılık dizileri sekme state'ini içermemeli (sekme değişimi
// yeniden fetch tetiklemez).
check(!/void loadAchievements\(\);\s*\}, \[[^\]]*activeTab/.test(screen), 'Sekme değişimi yeniden yükleme tetiklememeli');
check(!screen.includes('.rpc(') && !screen.includes('supabase'), 'Ekran yeni sorgu/RPC eklememeli');

// ---------------------------------------------------------------------------
// 5. Yedi rank YEREL ASSET'e eşlenir; yeni kimlik sırası doğru; assetler gerçek.
// ---------------------------------------------------------------------------
// constants/ranks.ts, RANK_IDS bloğundaki YENİ yedi kimliği tanımlamalı.
const rankIdsBlock = constants.slice(
  constants.indexOf('RANK_IDS'),
  constants.indexOf('] as const', constants.indexOf('RANK_IDS')),
);
const expectedOrder = ['bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'rosea'];
const rankIds = [...rankIdsBlock.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
check(
  JSON.stringify(rankIds) === JSON.stringify(expectedOrder),
  `RANK_IDS sırası bronze→…→rosea (emerald, diamond) olmalı, gelen: ${rankIds.join(',')}`,
);
check(!rankIds.includes('master'), 'Aktif kimliklerde artık master olmamalı');
const uniqueRankIds = expectedOrder;

// RANK_EMBLEM_SOURCES yedi kimliği yedi yerel rank asset'ine `require` ile eşler.
const sourcePairs = [...emblem.matchAll(/(\w+):\s*require\('([^']+)'\)/g)];
const emblemMap = Object.fromEntries(sourcePairs.map(([, key, path]) => [key, path]));
check(Object.keys(emblemMap).length === 7, 'RankEmblem yedi rank için yedi asset eşleşmesi içermeli');
for (const rankId of uniqueRankIds) {
  check(
    emblemMap[rankId] === `@/assets/images/ranks/rank-${rankId}.png`,
    `${rankId} → assets/images/ranks/rank-${rankId}.png eşleşmesi olmalı`,
  );
}

/** PNG başlığından genişlik/yükseklik/renk tipini okur (IHDR). Renk tipi 6 = RGBA. */
function readPng(path) {
  const buf = readFileSync(join(ROOT, path));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(buf.subarray(0, 8).equals(sig), `${path} geçerli bir PNG olmalı`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25], // 6 = truecolour + alpha
  };
}
for (const rankId of uniqueRankIds) {
  const rel = `assets/images/ranks/rank-${rankId}.png`;
  const png = readPng(rel);
  check(png.colorType === 6, `${rel} gerçek alfa kanalı taşımalı (renk tipi 6)`);
  check(
    png.width >= 128 && png.height >= 128 && png.width <= 1024 && png.height <= 1024,
    `${rel} makul çözünürlükte olmalı (128–1024 px), gelen ${png.width}×${png.height}`,
  );
}

// ---------------------------------------------------------------------------
// 6. Ana ekran, badge, guide VE profil "Success" bölümü aynı ortak RankEmblem'i
//    kullanır. (Rank artık Level/XP özetinde değil, career showcase'de çizilir.)
// ---------------------------------------------------------------------------
const consumers = [
  ['app/rank.tsx', screen],
  ['rank-badge.tsx', badge],
  ['rank-guide.tsx', guide],
  ['profile-career-showcase.tsx', profileShowcase],
];
for (const [name, code] of consumers) {
  check(code.includes("from '@/components/ranks/rank-emblem'"), `${name} RankEmblem'i içe aktarmalı`);
  check(code.includes('<RankEmblem'), `${name} RankEmblem'i kullanmalı`);
}
check(screen.includes('variant="hero"'), 'Rank özeti hero sembolünü kullanmalı');
check(badge.includes('variant="compact"'), 'RankBadge kompakt sembolü kullanmalı');
// ÜRÜN KARARI (item 4): Rank Tiers amblemleri artık `medium` varyant DEĞİL,
// açıkça büyütülmüş bir `size` kullanır (assetlerin iç boşluğu 40 pt'de görünmez
// oluyordu). Global `medium` ölçüsü değişmez → diğer ekranlar büyümez.
check(/<RankEmblem rankId=\{rankId\} size=\{5[0-9]\} \/>/.test(guide), 'Rank rehberi amblemi büyütülmüş açık size kullanmalı');
check(!guide.includes('variant="medium"'), 'Rank rehberi artık medium varyantına bağlı olmamalı');
// Profil "Success" bölümü doğrudan Ionicons yerine ortak asseti kullanır (bu,
// eski `RANK_EMBLEM_ICONS` bağımlılığının kapatıldığının kanıtıdır).
check(
  !profileShowcase.includes('RANK_EMBLEM_ICONS'),
  'Profil Success bölümü artık RANK_EMBLEM_ICONS ile doğrudan Ionicons kullanmamalı',
);
check(
  profileShowcase.includes('<RankEmblem rankId={rank.id}'),
  'Profil Success bölümü rank simgesini ortak asset bileşeninden çizmeli',
);
// Renkli nokta yerini emblem asset'ine bırakmış olmalı.
check(!badge.includes('styles.dot') && !/dot:\s*\{/.test(badge), 'RankBadge içindeki renkli nokta emblemle değişmeli');
check(!guide.includes('styles.tierDot') && !/tierDot:\s*\{/.test(guide), 'Rehber satırındaki renkli nokta emblemle değişmeli');
// Rehberdeki mevcut-rank vurgu çizgisi korunmalı.
check(guide.includes('tierBar') && guide.includes('isCurrent ? color'), 'Rehberdeki mevcut-rank vurgusu korunmalı');
// Emblem asset'e TINT UYGULAMAZ (metalik/gül renkleri korunur) ve `contain`
// ile tüm rozeti gösterir.
check(!/tintColor/.test(emblem), 'Emblem asset tint uygulamamalı (metalik renkleri kaybetmemeli)');
check(emblem.includes('contentFit="contain"'), 'Emblem tüm rozeti görünür tutmak için contain kullanmalı');
check(!emblem.includes("from '@/components/ranks/rank-badge'"), 'RankEmblem ↔ RankBadge modül döngüsü olmamalı');

// ---------------------------------------------------------------------------
// 7. RankBadge animasyonu ve Reduce Motion davranışı korunuyor.
// ---------------------------------------------------------------------------
check(badge.includes('useReducedMotion'), 'RankBadge Reduce Motion okumalı');
check(badge.includes('withSequence') && badge.includes('previousTierRef'), 'Rank-up ölçek animasyonu korunmalı');
check(badge.includes('tierIndex <= previousTier || reduceMotion'), 'Reduce Motion kapısı korunmalı');
check(badge.includes('minHeight: Layout.minTouchSize'), 'Basılabilir rozet 44 pt alan korumalı');
check(badge.includes("t('ranks.badgeA11y'"), 'Rozet erişilebilirlik etiketi korunmalı');

// ---------------------------------------------------------------------------
// 8. Achievement ikon haritası DEĞİŞMEDİ.
// ---------------------------------------------------------------------------
const expectedAchievementIcons = {
  first_workout: 'footsteps-outline',
  workout_5: 'barbell-outline',
  workout_15: 'trophy-outline',
  streak_3: 'flame-outline',
  streak_7: 'flame',
  perfect_week: 'checkmark-done-outline',
};
for (const [key, icon] of Object.entries(expectedAchievementIcons)) {
  check(new RegExp(`${key}:\\s*'${icon}'`).test(achievementIcons), `Achievement ikonu ${key} → ${icon} değişmemeli`);
}

// ---------------------------------------------------------------------------
// 9. Gradient / emoji / yeni asset / yeni paket YOK.
//    Doküman yorumları bu yasakları AÇIKLAR; denetim yalnızca gerçek kodu
//    hedeflesin diye yorumlar çıkarılır.
// ---------------------------------------------------------------------------
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const touched = {
  'app/rank.tsx': stripComments(screen),
  'rank-guide.tsx': stripComments(guide),
  'rank-badge.tsx': stripComments(badge),
  'rank-emblem.tsx': stripComments(emblem),
};
// Dekoratif emoji blokları. Yorumlardaki ok (→, U+2192) ve tire (–, U+2013)
// GİBİ tipografik işaretler bilinçle dışarıda bırakılır.
const emojiPattern = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
for (const [name, code] of Object.entries(touched)) {
  check(!/gradient/i.test(code), `${name} gradient içermemeli`);
  // Kod tarafında glow/gölge/partikül eklenmez. (Rozet parıltısı tasarımın
  // kendisindedir ve PNG asset'inin içindedir; bu bir kod efekti değildir.)
  check(!/\bglow\b|shadowColor|shadowOpacity|shadowRadius|elevation:/i.test(code), `${name} glow/gölge içermemeli`);
  check(!emojiPattern.test(code), `${name} emoji içermemeli`);
}
// Görsel yalnızca ORTAK emblem bileşeninden gelir: ekran/badge/guide kendi
// resim asset'ini `require` etmez, hepsi RankEmblem'den geçer.
for (const [name, code] of [
  ['app/rank.tsx', stripComments(screen)],
  ['rank-guide.tsx', stripComments(guide)],
  ['rank-badge.tsx', stripComments(badge)],
]) {
  check(
    !/require\(['"][^'"]+\.(png|jpg|jpeg|svg|gif)['"]\)/i.test(code),
    `${name} kendi resim asset'ini require etmemeli (ortak RankEmblem'den geçmeli)`,
  );
}
// Emblem YEDİ yerel rank asset'ini require eder; bu, yeni sözleşmenin özüdür.
const emblemCode = stripComments(emblem);
const emblemRequires = [...emblemCode.matchAll(/require\('([^']+\.png)'\)/g)].map((m) => m[1]);
check(emblemRequires.length === 7, 'Emblem yedi rank asseti require etmeli');
// Emblem expo-image kullanır (Ionicons'tan geçiş); yeni ağır paket eklemez.
check(emblem.includes("from 'expo-image'"), 'Emblem statik yerel asset için expo-image kullanmalı');
check(!/@expo\/vector-icons/.test(emblem), 'Emblem artık Ionicons kullanmamalı (asset kullanır)');
check(!/from '(react-native-svg|expo-linear-gradient|@react-native-|lottie)/.test(emblem), 'Emblem yeni paket eklememeli');

console.log(`✓ Rank visual navigation: ${passed} kontrol geçti.`);
