#!/usr/bin/env node
/**
 * PROFİL NAVİGASYONU + LEVEL ROSE YERLEŞİMİ — DAR KAPSAMLI DOĞRULAMA
 *
 * Bu tur eklenen ürün kararlarını statik olarak kilitler:
 *   1. Rozet vitrini geri düğmesi: AÇIK headerLeft + back/fallback replace; kayıt
 *      sonrası da güvenli geri (canGoBack=false'ta takılı kalmaz).
 *   2. Güvenli geri yardımcı: canGoBack→back, değilse replace(fallback); çift
 *      dokunma iki navigation üretmez (kilit).
 *   3. Arkadaş kapağı: native başlık kapalı, tam-bleed banner (aspectRatio 2.25,
 *      üst safe-area yok), çentik altında özel ≥44 pt geri düğmesi (fallback
 *      /friends); avatar kendi profille aynı (80/4/-36).
 *   4. Level Rose yalnız XP satırında bir kez (28 pt); kendi profilde seçici
 *      açılır, arkadaş profilinde SALT OKUNUR.
 *
 * Canlı render YOKTUR: kaynak dosyalar statik denetlenir.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (p) => readFileSync(join(ROOT, p), 'utf8');

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

const backBtn = source('components/navigation/header-back-button.tsx');
const showcase = source('app/achievements-showcase.tsx');
const friend = source('app/profile/[userId].tsx');
const layout = source('app/_layout.tsx');
const summary = source('components/rewards/profile-progress-summary.tsx');
const ownProfile = source('app/(tabs)/profile.tsx');

check('1. useSafeBack: canGoBack→back, değilse replace(fallback); çift-dokunma kilidi', () => {
  assert(/if \(router\.canGoBack\(\)\) router\.back\(\);\s*else router\.replace\(fallback\);/.test(backBtn),
    'useSafeBack back/fallback replace mantığı yok');
  assert(/navigatingRef/.test(backBtn) && /if \(navigatingRef\.current\) return;/.test(backBtn),
    'çift-dokunma kilidi yok (iki navigation riski)');
  // Görünür, ≥44 pt geri düğmesi bileşeni.
  assert(/Layout\.minTouchSize/.test(backBtn), 'HeaderBackButton 44 pt dokunma alanı kullanmıyor');
});

check('2. Rozet vitrini: açık headerLeft (back+fallback) + kayıt sonrası güvenli geri', () => {
  assert(/headerLeft: \(\) => \(\s*<HeaderBackButton[\s\S]*?fallback="\/\(tabs\)\/profile"/.test(showcase),
    'showcase açık headerLeft + fallback kullanmıyor');
  assert(/const safeBack = useSafeBack\('\/\(tabs\)\/profile'\)/.test(showcase), 'showcase güvenli geri hazırlamıyor');
  // Kayıt başarısında raw router.back değil, güvenli geri kullanılır.
  assert(/if \(outcome === 'saved'\) \{\s*[\s\S]*?safeBack\(\);/.test(showcase), 'kayıt sonrası güvenli geri çağrılmıyor');
  assert(!/router\.canGoBack\(\) \) router\.back\(\)/.test(showcase), 'kayıt yolunda eski takılabilen back mantığı kalmış');
});

check('3. Arkadaş kapağı tam-bleed, native başlık kapalı, çentik altında özel geri', () => {
  // Native başlık kapalı (kapak kesilmesin).
  assert(/name="profile\/\[userId\]" options=\{\{ headerShown: false \}\}/.test(layout),
    'profile/[userId] native başlığı kapatılmamış');
  // Üst safe-area yok → kapak fiziksel en üstten, çentiğin arkasından.
  assert(/<SafeAreaView style=\{styles\.safeArea\} edges=\{\[\]\}>/.test(friend), 'arkadaş ekranı üst safe-area boşluğu bırakıyor');
  assert(/banner: \{ aspectRatio: 2\.25/.test(friend), 'arkadaş kapağı kendi profille aynı oranda (2.25) değil');
  // Çentiğin altında özel geri düğmesi: useSafeBack('/friends') + insets.top + 44 pt.
  assert(/useSafeBack\('\/friends'\)/.test(friend), 'arkadaş geri düğmesi fallback /friends kullanmıyor');
  assert(/top: insets\.top \+ 6/.test(friend), 'geri düğmesi çentik altına (insets.top) yerleşmiyor');
  assert(/backButton: \{[\s\S]*?(height|width): Layout\.minTouchSize/.test(friend), 'geri düğmesi 44 pt değil');
  // Avatar kendi profille aynı (80 / 4 kenar / -36 overlap, sol hizalı hero).
  assert(/height: 80[\s\S]*?width: 80/.test(friend) && /borderWidth: 4/.test(friend), 'arkadaş avatarı kendi profil ölçüsünde değil');
  assert(/avatarWrapper: \{ marginTop: -36 \}/.test(friend), 'arkadaş avatarı negatif overlap (-36) kullanmıyor');
});

check('4. Level Rose yalnız Level satırında bir kez (32 pt); flash yok', () => {
  assert(!/name="flash"/.test(summary), 'Level satırında hâlâ flash simgesi var');
  assert((summary.match(/<LevelRoseEmblem/g) ?? []).length === 1, 'Level Rose birden fazla yerde render ediliyor');
  assert(/size=\{32\}/.test(summary), 'Level satırındaki gül 32 pt değil');
  // Gül slot'u Level satırında (levelRoseSpot); eski büyük kimlik gülü yok.
  assert(/levelRow[\s\S]{0,600}levelRoseSpot/.test(summary), 'gül Level satırına yerleştirilmemiş');
  assert(!/levelRoseSlot/.test(summary), 'eski büyük kimlik gülü yuvası hâlâ var');
});

check('5. Kendi profilde gül seçici açılır; arkadaş profilinde SALT OKUNUR', () => {
  // Kendi profil ortak bileşene onLevelPress geçer (seçici açılır); Level satırı onLevelPress varsa Pressable.
  assert(/onLevelPress=\{\(\) => setRoseSheetOpen\(true\)\}/.test(ownProfile), 'kendi profil gül seçiciyi açmıyor');
  assert(/onLevelPress \?[\s\S]*?<Pressable[\s\S]*?onPress=\{onLevelPress\}[\s\S]*?\{levelRow\}/.test(summary),
    'kendi profilde Level satırı seçiciyi açan Pressable değil');
  // Arkadaş profili onLevelPress GEÇMEZ → salt okunur (View).
  const friendSummaryProps = friend.slice(friend.indexOf('<ProfileProgressSummary'), friend.indexOf('/>', friend.indexOf('<ProfileProgressSummary')));
  assert(!/onLevelPress/.test(friendSummaryProps), 'arkadaş profili güle dokunma eylemi ekliyor (salt okunur olmalı)');
  // Nested Pressable yok: XP gülü Pressable'ı bir başka Pressable içinde değil.
  assert(!/<Pressable[\s\S]{0,200}<Pressable[\s\S]{0,120}\{levelRoseVisual\}/.test(summary), 'iç içe Pressable (çift tetik) riski');
});

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Profil navigasyonu + Level Rose harness: ${passed} kontrol geçti.`);
