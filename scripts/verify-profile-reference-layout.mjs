#!/usr/bin/env node
/** Referans profil düzeninin dar, davranış odaklı kaynak sözleşmesi. */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (path) => readFileSync(join(ROOT, path), 'utf8');
const profile = source('app/(tabs)/profile.tsx');
const progress = source('components/rewards/profile-progress-summary.tsx');
const proof = source('components/rewards/profile-proof-stats.tsx');
const program = source('components/profile-shared-program.tsx');
const discipline = source('components/profile-discipline-card.tsx');

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

check('Level ve Rank tek iki-sütunlu kimlik akışında', () => {
  assert((profile.match(/<ProfileProgressSummary/g) ?? []).length === 1, 'özet tek mount değil');
  assert(/identityRow:[\s\S]*?flexDirection: 'row'/.test(progress), 'iki sütunlu yatay düzen yok');
  assert(/identityDivider:[\s\S]*?width: StyleSheet\.hairlineWidth/.test(progress), 'orta ayırıcı yok');
});

check('Level ve Rank değerleri gerçek contextlerden gelir', () => {
  assert(/level=\{levelProgress\.level\}/.test(profile), 'level contextten gelmiyor');
  assert(/rank=\{rankSeason \? \{ id: rankSeason\.currentRank, rp: rankSeason\.currentRp \} : undefined\}/.test(profile), 'rank guardı yok');
});

check('XP yatay ve erişilebilir ilerleme çubuğudur', () => {
  assert(/accessibilityRole="progressbar"/.test(progress), 'progressbar rolü yok');
  assert(/Math\.min\(1, Math\.max\(0,/.test(progress), 'oran 0–1 aralığında değil');
  assert(/progressFill:[\s\S]*?backgroundColor: accentColor/.test(progress), 'dolgu profil accent renginde değil');
});

check('Level ve rank ikonları 56 pt çember içindedir', () => {
  assert(/identityIcon:[\s\S]*?borderRadius: 28[\s\S]*?height: 56[\s\S]*?width: 56/.test(progress), '56 pt çember sözleşmesi yok');
  assert(/RANK_EMBLEM_ICONS\[rank\.id\]/.test(progress), 'rank sembolü ortak kaynaktan gelmiyor');
});

check('Kanıt alanı üç dikey, büyük ama gerçek veri statıdır', () => {
  assert(/iconCircle:[\s\S]*?height: 52[\s\S]*?width: 52/.test(proof), '52 pt proof ikonları yok');
  assert(/stat:[\s\S]*?minHeight: 104/.test(proof), 'dikey stat ritmi yok');
  assert(/isDark \? withAlpha\('#C86E61', 0\.18\)/.test(proof), 'koyu tema proof yüzeyi yok');
  for (const token of ['roseBalance', 'workoutDays', 'dayStreak']) assert(proof.includes(token), `${token} kaybolmuş`);
});

check('Aktif program yalnız opt-in verisi varken kompakt satırdır', () => {
  assert(/ownSharedProgram && \(/.test(profile), 'aktif program guardı yok');
  assert(/<ProfileSharedProgram accentColor=\{profileAccent\.color\} compact/.test(profile), 'kompakt program satırı bağlı değil');
  assert(/compactIcon:[\s\S]*?height: 48[\s\S]*?width: 48/.test(program), 'program satırı ikonu yok');
});

check('Disiplin satırı kompakt başlar, açılır takvim korunur', () => {
  assert(/<ProfileDisciplineCard accentColor=\{profileAccent\.color\} collapsible compact/.test(profile), 'kompakt disiplin satırı bağlı değil');
  assert(/isExpanded && \([\s\S]*?<MotionCollapsible>/.test(discipline), 'açılır takvim gövdesi kaybolmuş');
});

check('Arkadaşlar tam genişlikte, erişilebilir satırdır', () => {
  assert(/friendsRow:[\s\S]*?minHeight: 68[\s\S]*?width: '100%'/.test(profile), 'tam genişlikte arkadaş satırı yok');
  assert(/router\.push\('\/friends'\)/.test(profile), 'arkadaş routeu kaybolmuş');
});

check('Season Badges mount ve seçim sözleşmesi değişmedi', () => {
  assert((profile.match(/<ProfileAchievementShowcase/g) ?? []).length === 1, 'Season Badges mount sayısı değişmiş');
  assert(/entries=\{profileShowcaseEntries\}/.test(profile), 'Season Badges veri kaynağı değişmiş');
  assert(/onPress=\{\(\) => router\.push\('\/rank-showcase'\)\}/.test(profile), 'Season Badges rotası değişmiş');
  assert(/preserveOrder/.test(profile), 'Season Badges sıra sözleşmesi değişmiş');
});

check('Kart yığını yerine hairline bölüm akışı korunur', () => {
  assert(/sectionDivider:[\s\S]*?height: StyleSheet\.hairlineWidth/.test(profile), 'hairline ayırıcı yok');
  assert(!/LinearGradient|BlurView/.test(progress + proof), 'gradient/blur eklenmiş');
});

check('Ritim etiketi kaldırılmış, XP verisi sakin ölçüdedir', () => {
  assert(!/levelCardEyebrow/.test(progress), 'Your Rhythm etiketi hâlâ çiziliyor');
  assert(/xpValue:[\s\S]*?fontSize: 38/.test(progress), 'XP değeri 38 pt değil');
  assert(/xpUnit:[\s\S]*?fontSize: 15/.test(progress), 'XP birimi küçültülmemiş');
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  failures.forEach((failure) => console.error(`  · ${failure}`));
  process.exit(1);
}

console.log(`✓ Profil referans düzeni harness: ${passed} kontrol geçti.`);
