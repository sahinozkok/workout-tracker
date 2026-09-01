#!/usr/bin/env node
/** Profildeki XP/gül bilgi pencerelerinin sunucu kurallarıyla dar sözleşmesi. */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (path) => readFileSync(join(ROOT, path), 'utf8');
const profile = source('app/(tabs)/profile.tsx');
const progress = source('components/rewards/profile-progress-summary.tsx');
const proof = source('components/rewards/profile-proof-stats.tsx');
const sheet = source('components/rewards/reward-info-sheet.tsx');
const tr = source('locales/tr.ts');
const en = source('locales/en.ts');
const rewards = source('supabase/migrations/20260820090000_add_progression_rewards.sql');
const safety = source('supabase/migrations/20260906120000_add_workout_ownership_safety.sql');
const curve = source('constants/level-curve.ts');

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

check('Level ve güller ayrı tetikleyicilerle aynı bilgi penceresine bağlı', () => {
  assert(/onLevelPress=\{\(\) => setRewardInfoKind\('level'\)\}/.test(profile), 'level tetikleyicisi yok');
  assert(/onRosesPress=\{\(\) => setRewardInfoKind\('roses'\)\}/.test(profile), 'gül tetikleyicisi yok');
  assert((profile.match(/<RewardInfoSheet/g) ?? []).length === 1, 'bilgi penceresi tek mount değil');
});

check('Level ve gül statları erişilebilir butona dönüşür', () => {
  assert(/onLevelPress \? \([\s\S]*?accessibilityRole="button"/.test(progress), 'level butonu yok');
  assert(/onPress=\{onRosesPress\}/.test(proof), 'gül butonu yok');
  assert(/proofRosesOpenA11y/.test(proof), 'gül erişilebilirlik metni yok');
});

check('Pencere ekranı kaplamayan alt sayfadır ve üç kapatma yolu vardır', () => {
  assert(/transparent[\s\S]*?visible=\{kind !== undefined\}/.test(sheet), 'şeffaf modal yok');
  assert(/maxHeight: '78%'/.test(sheet), 'ekranı kaplamayan yükseklik sınırı yok');
  assert(/onRequestClose=\{onClose\}/.test(sheet), 'Android geri kapısı yok');
  assert((sheet.match(/onPress=\{onClose\}/g) ?? []).length >= 2, 'arka plan ve düğme kapıları yok');
});

check('Pencere erişilebilir ve dokunma hedefi en az 44 pt', () => {
  assert(/accessibilityViewIsModal/.test(sheet), 'modal erişilebilirlik sınırı yok');
  assert(/minHeight: Layout\.minTouchSize/.test(sheet), '44 pt kapatma hedefi yok');
});

check('Planlı set ödülü sunucuyla aynı: 3 XP ve 3 gül', () => {
  assert(/PLANLI tamamlanan setler: \+3 XP \/ \+3 gül/.test(safety), 'sunucu set sözleşmesi değişmiş');
  assert(/setXp: '[^']*\+3 XP/.test(tr) && /setRoses: '[^']*\+3 gül/.test(tr), 'TR set metni yanlış');
  assert(/setXp: '[^']*\+3 XP/.test(en) && /setRoses: '[^']*\+3 roses/.test(en), 'EN set metni yanlış');
});

check('Süre ve mesafe ödülü sunucuyla aynı: 9 XP ve 9 gül', () => {
  assert(/Hedefi tamamlanmış planlı süre\/mesafe egzersizleri: \+9 XP \/ \+9 gül/.test(safety), 'sunucu aktivite sözleşmesi değişmiş');
  assert(/activityXp: '[^']*\+9 XP/.test(tr) && /activityRoses: '[^']*\+9 gül/.test(tr), 'TR aktivite metni yanlış');
});

check('Gün ve günlük giriş ödülleri sunucuyla aynı', () => {
  assert(/day_xp := 10/.test(rewards), 'sunucu gün ödülü değişmiş');
  assert(/'daily_login', client_today::text, 5, 5/.test(rewards), 'sunucu günlük giriş ödülü değişmiş');
  assert(/dayXp: '[^']*\+10 XP/.test(tr) && /consistencyXp: '[^']*\+5 XP/.test(tr), 'TR gün bonusları yanlış');
});

check('Seri, hafta ve Rosea bonuslarının eşit XP/gül sözleşmesi korunur', () => {
  assert(/streak_value, streak_value/.test(rewards), 'seri XP/gül eşitliği değişmiş');
  assert(/week_row\.green_days, week_row\.green_days/.test(rewards), 'hafta XP/gül eşitliği değişmiş');
  assert(/'pet', burst_key::text, 1, 1/.test(rewards), 'Rosea bonusu değişmiş');
});

check('Seviye eğrisi ekrandaki açıklamayla aynı eşiklere bağlı', () => {
  for (const token of ['return 120', 'return 150', 'return 200', 'return 250', 'return 300', 'return 400']) {
    assert(curve.includes(token), `${token} seviye eğrisinde yok`);
  }
  assert(/120 XP;[^']*150;[^']*200;[^']*250;[^']*300;[^']*400 XP/.test(tr), 'TR seviye açıklaması eksik');
  assert(/maximum level is 999/.test(en), 'EN maksimum seviye açıklaması eksik');
});

check('Season Badges sözleşmesine dokunulmaz', () => {
  assert((profile.match(/<ProfileAchievementShowcase/g) ?? []).length === 1, 'Season Badges mount değişmiş');
  assert(/entries=\{profileShowcaseEntries\}/.test(profile), 'Season Badges verisi değişmiş');
  assert(/preserveOrder/.test(profile), 'Season Badges sıra sözleşmesi değişmiş');
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  failures.forEach((failure) => console.error(`  · ${failure}`));
  process.exit(1);
}

console.log(`✓ Profil ödül bilgi penceresi harness: ${passed} kontrol geçti.`);
