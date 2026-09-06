#!/usr/bin/env node
/**
 * PROFİL "SUCCESS" YENİDEN TASARIMI — DAR KAPSAMLI DOĞRULAMA
 *
 * Referans düzeninin (kapak altı → Active Program öncesi) YENİ sözleşmesini
 * kilitler. Eski iki sütunlu Level/Rank akışına, büyük 38 pt XP sayısına veya
 * tasarım aracının yüklenmemiş dosya placeholder'larına ("browse files", "or",
 * kesik kutu) geri kaymayı yakalar.
 *
 * Canlı render YOKTUR: kaynak dosyalar statik denetlenir.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (p) => readFileSync(join(ROOT, p), 'utf8');

const profile = source('app/(tabs)/profile.tsx');
const friend = source('app/profile/[userId].tsx');
const progress = source('components/rewards/profile-progress-summary.tsx');
const proof = source('components/rewards/profile-proof-stats.tsx');
const success = source('components/ranks/profile-career-showcase.tsx');
const en = source('locales/en.ts');
const tr = source('locales/tr.ts');

/** Yorumsuz kaynak — "şu YOK" kontrolleri yorum metnine takılmasın. */
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const progressCode = strip(progress);
const proofCode = strip(proof);
const successCode = strip(success);
const friendCode = strip(friend);

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// 1. Eski iki sütunlu Level/Rank akışı YOK; rank Level/XP özetinden çıktı.
check('1. İki sütunlu Level/Rank kaldırıldı; özet yalnız Level + XP', () => {
  assert(!/identityRow:/.test(progressCode), 'eski identityRow hâlâ var');
  assert(!/identityDivider:/.test(progressCode), 'eski identityDivider hâlâ var');
  assert(!/rankVisualSlot:|RankEmblem|useRankName/.test(progressCode), 'rank hâlâ Level/XP özetinde');
  assert(!/xpValue:|fontSize: 38/.test(progressCode), 'eski büyük 38 pt XP sayısı hâlâ var');
});

// 2. Level gülü ve "Level N" metni AYNI satırda; gül tek kez, 32 pt.
check('2. Level Rose + Level metni aynı satırda (32 pt, tek render)', () => {
  assert(/levelInner:[\s\S]*?flexDirection: 'row'/.test(progress), 'Level satırı yatay değil');
  assert(/levelRow[\s\S]{0,600}levelRoseSpot/.test(progress), 'gül Level satırında değil');
  assert(/<LevelRoseEmblem roseId=\{resolveDisplayedRose\(level, selectedRoseId/.test(progress), 'ortak gül çözümü yok');
  assert(/size=\{32\}/.test(progress), 'Level gülü 32 pt değil');
  assert((progress.match(/<LevelRoseEmblem/g) ?? []).length === 1, 'gül birden fazla render ediliyor');
  assert(/levelValue:[\s\S]*?fontSize: 19/.test(progress), 'Level metni ~19 pt değil');
});

// 3. XP çubuğu + alt metası (Sonraki seviye · değer) ve progressbar rolü korunur.
check('3. XP çubuğu erişilebilir progressbar + alt metası korunur', () => {
  assert(/accessibilityRole="progressbar"/.test(progress), 'progressbar rolü yok');
  assert(/progressFill:[\s\S]*?backgroundColor: accentColor/.test(progress), 'XP dolgusu accent renginde değil');
  assert(/progressTrack:[\s\S]*?backgroundColor: colors\.surfaceMuted[\s\S]*?height: 4/.test(progress), 'XP track 4 pt surfaceMuted değil');
  assert(/t\('rewards\.levelCardNext'\)/.test(progress) && /t\('rewards\.levelXpValue'/.test(progress), 'XP alt metası yok');
  assert(/fontVariant: \['tabular-nums'\]/.test(progress), 'XP değeri tabular değil');
});

// 4. Kanıt istatistikleri ÜÇ sütun; değer/etiket korunur; büyük kart yok.
check('4. Proof stats üç sütun, dekoratif eyebrow yok', () => {
  for (const tok of ['roseBalance', 'workoutDays', 'dayStreak']) assert(proof.includes(tok), `${tok} kayboldu`);
  assert(/stat:[\s\S]*?flex: 1/.test(proof), 'stat sütunları eşit genişlikte değil');
  assert(!/styles\.eyebrow|proofTitle'\)|t\('profile\.proofTitle'\)/.test(proofCode), 'referansta olmayan eyebrow başlığı hâlâ çiziliyor');
  assert(/icon="calendar-outline"/.test(proof), 'Workout Days takvim simgesi kullanmıyor');
  assert(!/LinearGradient|shadowRadius/.test(proof), 'karta gradient/gölge eklenmiş');
});

// 5. Success bölümü: Rank (sol) + dikey ayırıcı + en fazla ÜÇ kalıcı başarım.
check('5. Success bölümü Rank + en fazla üç başarımı birleştirir', () => {
  assert(/successTitle/.test(success), 'Success başlığı locale anahtarı kullanılmıyor');
  assert(/<RankEmblem rankId=\{rank\.id\} size=\{60\}/.test(success), 'rank amblemi ~60 pt çizilmiyor');
  assert(/entries\.slice\(0, 3\)/.test(success), 'başarım vitrini üçle sınırlı değil');
  assert(/<AchievementSymbol/.test(success), 'paylaşılan AchievementSymbol kullanılmıyor');
  assert(/divider:[\s\S]*?width: StyleSheet\.hairlineWidth/.test(success), 'ince dikey ayırıcı yok');
  assert(/divider:[\s\S]*?backgroundColor: colors\.separator/.test(success), 'ayırıcı tema separator rengini kullanmıyor');
});

// 6. Rank/gül/başarım asset'leri çerçevesiz ve tintsiz (kendi renkleri).
check('6. Rank ve güller çerçevesiz/tintsiz', () => {
  const rankColumn = /rankColumn:\s*\{([^}]*)\}/.exec(success);
  assert(rankColumn && !/border(Width|Color|Radius)/.test(rankColumn[1]), 'rank sütununda çerçeve/daire var');
  // Rank amblemine renk/tint prop geçilmez (asset kendi renklerini taşır).
  assert(!/<RankEmblem[^>]*color=/.test(success), 'rank amblemine tint uygulanıyor');
  const roseSpot = /levelRoseSpot:\s*\{([^}]*)\}/.exec(progress);
  assert(roseSpot && !/border(Width|Color|Radius)/.test(roseSpot[1]), 'Level gülü yuvasında çerçeve/daire var');
});

// 7. Placeholder / "browse files" / kesik kutu metni HİÇBİR YERDE yok.
check('7. Tasarım aracı placeholder metinleri sızmamış', () => {
  const forbidden = /browse files|drop files|choose a file|rank or browse/i;
  for (const [name, src] of [['progress', progressCode], ['proof', proofCode], ['success', successCode], ['profile', strip(profile)], ['friend', friendCode]]) {
    assert(!forbidden.test(src), `${name} placeholder metni içeriyor`);
  }
  // Kesik çizgili çerçeve (borderStyle dashed) EKLENMEMİŞ.
  for (const src of [progressCode, proofCode, successCode]) assert(!/borderStyle: 'dashed'/.test(src), 'kesik çizgili placeholder çerçevesi var');
});

// 8. Active Program + alt katalog yapısı ve üst üste binme DEĞİŞMEMİŞ.
check('8. Active Program ve katalog yığını korunuyor', () => {
  assert(/ownSharedProgram && \(/.test(profile), 'aktif program guardı yok');
  assert(/<ProfileSharedProgram accentColor=\{profileAccent\.color\} compact/.test(profile), 'kompakt program satırı bağlı değil');
  assert(/catalogCardPos1:[\s\S]*?marginTop: -18/.test(profile), 'katalog üst üste binme davranışı değişmiş');
  assert(/friendsOverscrollFill/.test(profile), 'Friends alt yüzey çözümü kaldırılmış');
});

// 9. Kendi profil ve arkadaş profili AYNI bilgi hiyerarşisi (ortak bileşenler).
check('9. Kendi/arkadaş profili aynı ortak bileşenleri kullanır', () => {
  for (const comp of ['ProfileProgressSummary', 'ProfileCareerShowcase']) {
    assert((profile.match(new RegExp(`<${comp}`, 'g')) ?? []).length === 1, `kendi profilde ${comp} tek mount değil`);
    assert((friend.match(new RegExp(`<${comp}`, 'g')) ?? []).length === 1, `arkadaş profilinde ${comp} tek mount değil`);
  }
  // Arkadaş profili SALT OKUNUR: rank/başarım düzenleme/navigasyon yok.
  assert(!/onRankPress=|onEdit=|achievements-showcase/.test(friendCode), 'arkadaş profilinde sahibine özel eylemler sızmış');
  // Arkadaş rank/başarım verisi arkadaş kaynaklarından gelir.
  assert(/rank=\{friendRank \? \{ id: friendRank\.currentRank, rp: friendRank\.currentRp \} : undefined\}/.test(friend), 'arkadaş rank verisi bağlı değil');
});

// 10. Loading/error/empty/unranked durumları sahte veri üretmez.
check('10. Durumlar (loading/error/empty/unranked) sahte veri üretmez', () => {
  assert(/rankState: 'ranked' \| 'error' \| 'loading' \| 'unranked'/.test(success), 'rank dört durumu ayırmıyor');
  assert(/rankState === 'ranked' && rank \? \(/.test(success), 'emblem yalnız gerçek rank varken çizilir');
  assert(!/'bronze'/.test(success), 'sahte bronze fallback var');
  assert(/isLoading \?[\s\S]*?ActivityIndicator/.test(success), 'başarım yükleme durumu spinner değil');
  assert(/hasError \?[\s\S]*?careerAchievements\.showcase\.unavailable/.test(success), 'başarım hata durumu nötr metin değil');
  assert(/entries\.length === 0 \?[\s\S]*?careerAchievements\.showcase\.empty/.test(success), 'başarım boş durumu yok');
});

// 11. Success başlığı TR/EN yerelleştirilir (sabit metin değil).
check('11. Success başlığı TR/EN yerelleştirmeden gelir', () => {
  assert(/successTitle: 'SUCCESS'/.test(en), 'EN Success başlığı yok');
  assert(/successTitle: '[^']+'/.test(tr), 'TR Success başlığı yok');
  assert(/t\('careerAchievements\.showcase\.successTitle'\)/.test(success), 'başlık locale anahtarıyla çizilmiyor');
});

// 12. Boş/loading/error başarım sütunu da basılabilir (onPress); arkadaş salt okunur.
check('12. Başarım sütunu onPress ile HER durumda basılabilir; arkadaş salt okunur', () => {
  assert(/const achievementsColumn = onPress \? \(/.test(successCode), 'başarım sütunu onPress ile koşulsuz basılabilir değil');
  assert(!/onPress && entries\.length > 0/.test(successCode), 'başarım sütunu hâlâ entries>0 koşuluna bağlı');
  // Boş durumda erişilebilirlik etiketi boş string DEĞİL; anlamlı lokalize fallback.
  assert(/shown\.length > 0[\s\S]*?:\s*t\('careerAchievements\.showcase\.viewAll'\)/.test(successCode),
    'boş durumda viewAll fallback a11y etiketi yok');
  // Arkadaş profilinde ProfileCareerShowcase'e onPress geçmez → salt okunur View.
  const friendTag = friendCode.slice(
    friendCode.indexOf('<ProfileCareerShowcase'),
    friendCode.indexOf('/>', friendCode.indexOf('<ProfileCareerShowcase')),
  );
  assert(friendTag.length > 0 && !/onPress=/.test(friendTag), 'arkadaş vitrini onPress alıyor (salt okunur olmalı)');
});

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Profil Success bölümü harness: ${passed} kontrol geçti.`);
console.log('  (Canlı render yok — kaynak dosyalar statik olarak denetlendi.)');
