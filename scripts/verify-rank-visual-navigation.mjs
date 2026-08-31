#!/usr/bin/env node
/**
 * RANK GÖRSEL GEZİNME — DOĞRULAMA HARNESS'I
 *
 * Bu tur iki görsel sözleşmeyi kilitler:
 *   1. Rank ekranındaki YEREL içerik sekmeleri (Genel / Başarılar / Geçmiş) —
 *      yalnızca sunum state'i: yeni route, bottom tab, sorgu veya RPC YOK ve
 *      veri yüklemeleri sekmeye göre KOŞULLANDIRILMAZ.
 *   2. Kademeye özgü, KOD TABANLI `RankEmblem` sembolü — aynı kaynak rank
 *      özetinde (hero), `RankBadge` içinde (compact) ve rank rehberinde (medium)
 *      kullanılır; yedi rank için yedi geçerli Ionicons eşleşmesi vardır.
 *
 * Projede jest KURULU DEĞİL; diğer rank harness'ları gibi kaynak metni statik
 * denetlenir. Ionicons isimleri projede KURULU glyph map'e karşı doğrulanır,
 * böylece geçersiz bir isim sessizce geçemez.
 *
 * Harness gerçek SÖZLEŞMEYİ test eder; yorum/boşluk değişikliklerine bağlı
 * değildir.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const source = (path) => readFileSync(join(ROOT, path), 'utf8');

const screen = source('app/rank.tsx');
const badge = source('components/ranks/rank-badge.tsx');
const guide = source('app/rank-guide.tsx');
const emblem = source('components/ranks/rank-emblem.tsx');
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
  const start = screen.indexOf(`activeTab === '${key}'`);
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
check(!overviewBlock.includes('AchievementsGrid') && !overviewBlock.includes("t('ranks.recentActivity')"), 'Genel sekmesi başarı/geçmiş içeriğini içermemeli');
check(achievementsBlock.includes('AchievementsGrid') && achievementsBlock.includes("t('ranks.achievements.title')"), 'Başarılar sekmesi başarı grid’ini içermeli');
check(!achievementsBlock.includes('WeekFocusCard') && !achievementsBlock.includes("t('ranks.pastSeasons')"), 'Başarılar sekmesi diğer içerikleri içermemeli');
check(historyBlock.includes("t('ranks.recentActivity')") && historyBlock.includes("t('ranks.pastSeasons')"), 'Geçmiş sekmesi RP hareketleri ve geçmiş sezonları içermeli');
check(!historyBlock.includes('WeekFocusCard') && !historyBlock.includes('AchievementsGrid'), 'Geçmiş sekmesi diğer içerikleri içermemeli');

// ---------------------------------------------------------------------------
// 4. Veri yüklemeleri sekmeye göre KOŞULLANDIRILMAMIŞ.
// ---------------------------------------------------------------------------
for (const loader of ['loadHistory', 'loadEvents', 'loadWeekFocus', 'loadAchievements']) {
  check(new RegExp(`useEffect\\(\\(\\) => \\{\\s*void ${loader}\\(\\);`).test(screen), `${loader} mount effect'i korunmalı`);
}
// Yükleyici çağrısının olduğu satırlarda sekme state'i geçmemeli.
for (const line of screen.split('\n')) {
  if (/void load(History|Events|WeekFocus|Achievements)\(\);/.test(line)) {
    check(!line.includes('activeTab'), 'Veri yüklemesi sekmeye göre koşullandırılmamalı');
  }
}
// Effect'lerin bağımlılık dizileri sekme state'ini içermemeli (sekme değişimi
// yeniden fetch tetiklemez).
check(!/void loadAchievements\(\);\s*\}, \[[^\]]*activeTab/.test(screen), 'Sekme değişimi yeniden yükleme tetiklememeli');
check(!screen.includes('.rpc(') && !screen.includes('supabase'), 'Ekran yeni sorgu/RPC eklememeli');

// ---------------------------------------------------------------------------
// 5. Yedi rank için yedi geçerli emblem eşleşmesi.
// ---------------------------------------------------------------------------
const rankIds = [...constants.matchAll(/'(bronze|silver|gold|platinum|diamond|master|rosea)'/g)]
  .map((match) => match[1]);
const uniqueRankIds = [...new Set(rankIds)];
check(uniqueRankIds.length === 7, 'constants/ranks.ts yedi rank tanımlamalı');

const emblemPairs = [...emblem.matchAll(/(\w+):\s*'([a-z-]+)'/g)]
  .filter(([, key]) => uniqueRankIds.includes(key));
const emblemMap = Object.fromEntries(emblemPairs.map(([, key, icon]) => [key, icon]));
check(Object.keys(emblemMap).length === 7, 'RankEmblem yedi rank için yedi eşleşme içermeli');

const expectedEmblem = {
  bronze: 'shield-outline',
  silver: 'shield-half-outline',
  gold: 'medal-outline',
  platinum: 'star-outline',
  diamond: 'diamond-outline',
  master: 'trophy-outline',
  rosea: 'rose-outline',
};
for (const rankId of uniqueRankIds) {
  check(emblemMap[rankId] === expectedEmblem[rankId], `${rankId} → ${expectedEmblem[rankId]} eşleşmesi olmalı`);
}

// İkon isimleri KURULU Ionicons sürümünde gerçekten geçerli olmalı.
const glyphMap = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json');
for (const [rankId, icon] of Object.entries(emblemMap)) {
  check(icon in glyphMap, `${rankId} için ${icon} geçerli bir Ionicons ismi olmalı`);
}

// ---------------------------------------------------------------------------
// 6. Ana ekran, badge ve guide aynı RankEmblem'i kullanır.
// ---------------------------------------------------------------------------
for (const [name, code] of [['app/rank.tsx', screen], ['rank-badge.tsx', badge], ['rank-guide.tsx', guide]]) {
  check(code.includes("from '@/components/ranks/rank-emblem'"), `${name} RankEmblem'i içe aktarmalı`);
  check(code.includes('<RankEmblem'), `${name} RankEmblem'i kullanmalı`);
}
check(screen.includes('variant="hero"'), 'Rank özeti hero sembolünü kullanmalı');
check(badge.includes('variant="compact"'), 'RankBadge kompakt sembolü kullanmalı');
check(guide.includes('variant="medium"'), 'Rank rehberi orta boy sembolü kullanmalı');
// Renkli nokta yerini sembole bırakmış olmalı.
check(!badge.includes('styles.dot') && !/dot:\s*\{/.test(badge), 'RankBadge içindeki renkli nokta sembolle değişmeli');
check(!guide.includes('styles.tierDot') && !/tierDot:\s*\{/.test(guide), 'Rehber satırındaki renkli nokta sembolle değişmeli');
// Rehberdeki mevcut-rank vurgu çizgisi korunmalı.
check(guide.includes('tierBar') && guide.includes('isCurrent ? color'), 'Rehberdeki mevcut-rank vurgusu korunmalı');
// Emblem yeni renk tanımlamaz; çağıranların çözdüğü semantik renk zorunlu prop'tur.
check(/color:\s*string;/.test(emblem) && emblem.includes('withAlpha'), 'Emblem semantik rengi zorunlu prop olarak almalı');
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
  check(!/\bglow\b|shadowColor|shadowOpacity|shadowRadius|elevation:/i.test(code), `${name} glow/gölge içermemeli`);
  check(!emojiPattern.test(code), `${name} emoji içermemeli`);
  check(!/require\(['"][^'"]+\.(png|jpg|jpeg|svg|gif)['"]\)/i.test(code), `${name} yeni resim asset'i içermemeli`);
}
// Emblem yalnızca mevcut Ionicons paketini kullanır; yeni paket eklemez.
check(emblem.includes("from '@expo/vector-icons'"), 'Emblem mevcut @expo/vector-icons paketini kullanmalı');
check(!/from '(react-native-svg|expo-linear-gradient|@react-native-|lottie)/.test(emblem), 'Emblem yeni paket eklememeli');

console.log(`✓ Rank visual navigation: ${passed} kontrol geçti.`);
