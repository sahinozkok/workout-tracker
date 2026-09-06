#!/usr/bin/env node
/** Referans profil düzeninin dar, davranış odaklı kaynak sözleşmesi. */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (path) => readFileSync(join(ROOT, path), 'utf8');
const profile = source('app/(tabs)/profile.tsx');
const progress = source('components/rewards/profile-progress-summary.tsx');
const careerShowcase = source('components/ranks/profile-career-showcase.tsx');
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

check('Level satırı + XP tek dikey akış; iki sütunlu Level/Rank kaldırıldı', () => {
  assert((profile.match(/<ProfileProgressSummary/g) ?? []).length === 1, 'özet tek mount değil');
  // ÜRÜN KARARI: eski iki sütunlu Level/Rank kimliği KALDIRILDI; rank Success
  // bölümüne taşındı. Level satırı sola hizalı, ≥44 pt dokunma alanı.
  assert(!/identityRow:/.test(progress), 'eski iki sütunlu Level/Rank satırı hâlâ var');
  assert(!/identityDivider:/.test(progress), 'eski orta ayırıcı hâlâ var');
  assert(/levelRow:[\s\S]*?minHeight: Layout\.minTouchSize/.test(progress), 'Level satırı 44 pt dokunma alanı değil');
  assert(/t\('rewards\.levelLabel', \{ level \}\)/.test(progress), 'Level N metni yok');
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

check('Rank emblemi Success bölümünde dairesiz (~60 pt); level gülü Level satırında (32 pt); ortak asset kaynakları', () => {
  // ÜRÜN KARARI: rank amblemi artık "Success" bölümünde (career showcase),
  // arkasında DAİRE/BORDER/ÇERÇEVE YOK. Level/XP özetinde rank yuvası kalmaz.
  assert(!/identityIcon:/.test(progress), 'eski 56 pt çemberli identityIcon hâlâ var');
  assert(!/rankVisualSlot:/.test(progress), 'rank yuvası hâlâ Level/XP özetinde');
  assert(careerShowcase.includes("from '@/components/ranks/rank-emblem'"), 'rank emblemi ortak kaynaktan gelmiyor');
  assert(/<RankEmblem rankId=\{rank\.id\} size=\{60\}/.test(careerShowcase), 'rank amblemi ~60 pt boyutta çizilmiyor');
  assert(!careerShowcase.includes('RANK_EMBLEM_ICONS'), 'Success bölümü eski RANK_EMBLEM_ICONS haritasını kullanıyor');
  const rankColumn = /rankColumn:\s*\{([^}]*)\}/.exec(careerShowcase);
  assert(rankColumn, 'rankColumn yuvası tanımlı değil');
  assert(!/border(Width|Color|Radius)/.test(rankColumn[1]), 'rank sütununda çerçeve/daire olmamalı');

  // ÜRÜN KARARI: seviye gülü Level satırında (küçük, ~32 pt); daire/çerçeve YOK.
  assert(!/levelRoseSlot:/.test(progress), 'eski büyük kimlik gülü yuvası (levelRoseSlot) hâlâ var');
  assert(!/name="flash"/.test(progress), 'Level satırındaki yıldırım (flash) hâlâ var');
  assert(progress.includes("from '@/components/rewards/level-rose-emblem'"), 'level gülü ortak kaynaktan gelmiyor');
  assert(/<LevelRoseEmblem roseId=\{resolveDisplayedRose\(level, selectedRoseId/.test(progress),
    'level gülü ortak LevelRoseEmblem + resolveDisplayedRose ile çözülmüyor');
  assert(/size=\{32\}/.test(progress), 'Level satırındaki gül 32 pt değil');
  const roseSlot = /levelRoseSpot:\s*\{([^}]*)\}/.exec(progress);
  assert(roseSlot, 'levelRoseSpot yuvası tanımlı değil');
  assert(!/border(Width|Color|Radius)/.test(roseSlot[1]), 'Level gülü yuvasında çerçeve/daire olmamalı');
  // Level metni ("Level N") temiz tipografiyle korunur; gül tek bir yerde render edilir.
  assert(/t\('rewards\.levelLabel', \{ level \}\)/.test(progress), 'Level N metni korunmalı');
  assert((progress.match(/<LevelRoseEmblem/g) ?? []).length === 1, 'level gülü birden fazla yerde render ediliyor');
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

check('Başarım vitrini mount ve seçim sözleşmesi (KALICI kariyer sistemi)', () => {
  // Ürün kararı: profil artık SEZON değil KALICI kariyer vitrinini gösterir.
  // Aynı güvence: TEK vitrin, kariyer verisi, tüm başarımlar + düzenleme rotaları.
  assert((profile.match(/<ProfileCareerShowcase/g) ?? []).length === 1, 'Kariyer vitrini mount sayısı değişmiş');
  assert(!/ProfileAchievementShowcase/.test(profile), 'profilde eski sezon vitrini kalmış (tek vitrin olmalı)');
  assert(/entries=\{careerShowcaseEntries\}/.test(profile), 'kariyer vitrini veri kaynağı değişmiş');
  assert(/onPress=\{\(\) => router\.push\('\/achievements'\)\}/.test(profile), 'tüm başarımlar rotası değişmiş');
  assert(/onEdit=\{\(\) => router\.push\('\/achievements-showcase'\)\}/.test(profile), 'vitrin düzenleme rotası değişmiş');
});

check('Kart yığını yerine hairline bölüm akışı korunur', () => {
  assert(/sectionDivider:[\s\S]*?height: StyleSheet\.hairlineWidth/.test(profile), 'hairline ayırıcı yok');
  assert(!/LinearGradient|BlurView/.test(progress + proof), 'gradient/blur eklenmiş');
});

check('Büyük 38 pt XP sayısı kaldırıldı; XP alt metası sakin', () => {
  assert(!/levelCardEyebrow/.test(progress), 'Your Rhythm etiketi hâlâ çiziliyor');
  // ÜRÜN KARARI: eski büyük 38 pt XP sayısı KALDIRILDI (Level odaklı sakin sunum).
  assert(!/xpValue:/.test(progress), 'eski büyük XP değeri (xpValue) hâlâ var');
  assert(!/fontSize: 38/.test(progress), 'eski 38 pt XP ölçüsü hâlâ var');
  // XP alt metası korunur: "Sonraki seviye" + gerçek değer.
  assert(/t\('rewards\.levelCardNext'\)/.test(progress), 'XP alt etiketi (Sonraki seviye) yok');
  assert(/t\('rewards\.levelXpValue'/.test(progress), 'XP değer metni yok');
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  failures.forEach((failure) => console.error(`  · ${failure}`));
  process.exit(1);
}

console.log(`✓ Profil referans düzeni harness: ${passed} kontrol geçti.`);
