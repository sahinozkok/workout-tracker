#!/usr/bin/env node
/**
 * PROFİL EKRANI — GÖRSEL HİYERARŞİ & KORUNAN DAVRANIŞ SÖZLEŞMESİ
 *
 * Kapsam: `app/(tabs)/profile.tsx` yeniden tasarımının KRİTİK hiyerarşisini ve
 * "kesin korunacaklar" davranışlarını kilitler. Amaç, kaynak metnini donduran
 * kırılgan bir test DEĞİL; tasarımın anlamlı sözleşmelerini (bölüm sırası,
 * route'lar, guard'lar, tekrar etmeyen bilgi, erişilebilirlik, sade ayırıcılar)
 * doğrulamaktır.
 *
 * Tipografi PİKSEL değerleri ayrı harness'tadır (`verify-profile-typography`);
 * burada tekrarlanmaz. Rank/achievement/shared-program VERİ akışları da kendi
 * harness'larındadır ve bu tur onlara dokunmaz.
 *
 * Canlı render YOKTUR: tek kaynak dosya statik denetlenir.
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

const raw = source('app/(tabs)/profile.tsx');
/** Yorumsuz kaynak — "şu YOK" ve SIRA kontrolleri yorum metnine takılmasın. */
const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/** JSX'te bir dizgenin ilk konumu (yorumsuz kaynakta). -1 ise hata. */
function at(needle) {
  const index = code.indexOf(needle);
  assert(index !== -1, `beklenen düğüm bulunamadı: ${needle}`);
  return index;
}

/** Yalnız render gövdesi (createStyles öncesi) — sıra kontrolleri için. */
const renderBody = code.slice(0, code.indexOf('function createStyles('));

// ---------------------------------------------------------------------------
// A. Kimlik hiyerarşisi: ad ANA başlık, kullanıcı adı + bio ikincil, eylemler
//    kimliğe yakın.
// ---------------------------------------------------------------------------
check('A1. Kimlik SALT OKUNUR; sıra kullanıcı adı → ad → bio; Düzenle/editör YOK', () => {
  const name = at('styles.summaryName');
  const bio = at('styles.summaryBio');
  const username = at('styles.summaryUsername');
  assert(username < name, 'kullanıcı adı görünen addan sonra gelmemeli (eyebrow konumu)');
  assert(name < bio, 'bio görünen adın ALTINDA olmalı');
  assert(
    /<Text[^>]*numberOfLines=\{2\}[^>]*style=\{styles\.summaryName\}/.test(raw),
    'görünen ad iki satırla sınırlanmamış',
  );
  // ÜRÜN KARARI: profil salt okunur — Düzenle düğmesi, açılır editör ve
  // headerActions satırı KALDIRILDI (düzenleme Ayarlar'dan → /profile-edit).
  assert(!/headerActions/.test(code), 'eski Düzenle/Ayarlar kimlik satırı hâlâ var');
  assert(!/isProfileEditorOpen|handleProfileEditorToggle|MotionCollapsible|editProfileButton/.test(code),
    'açılır profil editörü/Düzenle düğmesi hâlâ profilde');
});

check('A2. Bio TEK yerde: kimlikte profile.bio ile; ilerlemede TEKRAR yok', () => {
  // Salt okunur ekran artık taslak değil, doğrudan `profile.bio` gösterir.
  assert(/styles\.summaryBio\}>\{profile\.bio\.trim\(\)\}/.test(code), 'bio kimlik alanında profile.bio ile gösterilmiyor');
  const progressStart = at('<ProfileProgressSummary');
  const progressEnd = code.indexOf('/>', progressStart);
  const progressProps = code.slice(progressStart, progressEnd);
  assert(!/message=|bio=/.test(progressProps), 'bio hem kimlikte hem ilerlemede gösteriliyor (tekrar)');
});

check('A3. Ayarlar dişlisi kapak altında hero alanında; /settings korunur', () => {
  // Item 6: dişli kimlik metninden ÖNCE (banner hero satırında), sağ üstte.
  const gear = at('styles.settingsButton');
  const summary = at('styles.profileSummary');
  assert(gear < summary, 'Ayarlar dişlisi kimlik metninden önce (hero alanında) olmalı');
  assert(/router\.push\('\/settings'\)/.test(code), 'Ayarlar /settings route’unu kaybetti');
  // Dişli banner hero satırında (heroRow), kimlik metninden ÖNCE.
  assert(at('styles.heroRow') < gear && gear < summary, 'Ayarlar dişlisi banner hero satırında/kimlik öncesinde değil');
});

// ---------------------------------------------------------------------------
// B. Profil düzenleme AYARLAR'a taşındı: tek kaynak hook + /profile-edit ekranı.
// ---------------------------------------------------------------------------
check('B1. Editör profilden KALDIRILDI; tek kaynak useProfileEditor + /profile-edit', () => {
  // Profil ekranında editör alan/kaydet/medya mantığı YOK.
  for (const gone of [
    'updateDraft',
    'handleSave',
    'pickProfileImage',
    'handleRemoveProfileImage',
    'MotionCollapsible',
    'TextInput',
    'uploadProfileMedia',
    'saveProfileMedia',
  ]) {
    assert(!code.includes(gone), `editör mantığı hâlâ profilde: ${gone}`);
  }
  // Ortak hook TEK kaynak (kopyala-yapıştır ikinci uygulama yok).
  const hook = source('hooks/use-profile-editor.ts');
  for (const token of ['updateDraft', 'const save', 'pickImage', 'removeImage', 'stagedPathsRef', 'saveProfile(']) {
    assert(hook.includes(token), `ortak editör hook'unda eksik: ${token}`);
  }
  // /profile-edit ekranı hook'u kullanır ve tüm alanları/medya işlemlerini çizer.
  const editScreen = source('app/profile-edit.tsx');
  assert(/useProfileEditor\(\)/.test(editScreen), '/profile-edit ortak hook’u kullanmıyor');
  for (const token of [
    "updateDraft('displayName'",
    "updateDraft('username'",
    "updateDraft('bio'",
    "updateDraft('trainingGoal'",
    "pickImage('avatar')",
    "pickImage('banner')",
    "removeImage('avatar')",
    "removeImage('banner')",
    'onPress={() => void onSave()}',
  ]) {
    assert(editScreen.includes(token), `/profile-edit alanı/medya eksik: ${token}`);
  }
});

check('B2. Settings girişi profil düzenlemeyi açar; güvenli geri', () => {
  const settings = source('app/settings.tsx');
  assert(/router\.push\('\/profile-edit'\)/.test(settings), 'Ayarlar’da Profili düzenle girişi yok');
  assert(/editRowTitle/.test(settings) && /editRowCaption/.test(settings), 'Profili düzenle satırı başlık/açıklama kullanmıyor');
  // /profile-edit güvenli geri (canGoBack yoksa /settings replace) kullanır.
  const editScreen = source('app/profile-edit.tsx');
  assert(/useSafeBack\('\/settings'\)/.test(editScreen), '/profile-edit güvenli geri (fallback /settings) kullanmıyor');
});

// ---------------------------------------------------------------------------
// C. Level ve rank AYRI sistemler; rank verisi yoksa uydurulmaz.
// ---------------------------------------------------------------------------
check('C1. Level ve rank ayrı; rank yalnız gerçek sezon verisinden geçirilir', () => {
  assert(/<ProfileProgressSummary/.test(code), 'ProfileProgressSummary kaldırılmış');
  assert(/level=\{levelProgress\.level\}/.test(code), 'level gerçek ödül verisini kullanmıyor');
  assert(
    /rank=\{rankSeason \? \{ id: rankSeason\.currentRank, rp: rankSeason\.currentRp \} : undefined\}/.test(code),
    'rank gerçek sezon verisiyle koşullu geçirilmemiş (sahte rank riski)',
  );
  assert(/xpIntoLevel=\{levelProgress\.xpIntoLevel\}/.test(code), 'XP ilerleme verisi kaybolmuş');
});

// ---------------------------------------------------------------------------
// D. Kanıt istatistikleri: tek şerit, anlam/route korunur.
// ---------------------------------------------------------------------------
check('D1. Kanıt şeridi ve seri /streaks route’u korunuyor', () => {
  assert(/<ProfileProofStats/.test(code), 'ProfileProofStats kaldırılmış');
  assert(/onDayStreakPress=\{\(\) => router\.push\('\/streaks'\)\}/.test(code), 'seri /streaks push’u kaybolmuş');
  for (const prop of ['roseBalance=', 'workoutDays=', 'dayStreak=']) {
    assert(code.includes(prop), `kanıt anlamı kayboldu: ${prop}`);
  }
});

// ---------------------------------------------------------------------------
// E. Başarı vitrini: tek mount, seçim ekranı route’u, sıra korunur.
// ---------------------------------------------------------------------------
check('E1. Vitrin tek kez; kariyer başarım ekranları açılıyor', () => {
  // Ürün kararı: profil KALICI kariyer vitrinini gösterir; tek vitrin, tüm
  // başarımlar (/achievements) ve düzenleme (/achievements-showcase) açılır.
  assert((code.match(/<ProfileCareerShowcase/g) ?? []).length === 1, 'vitrin çoğaltılmış/kaldırılmış');
  assert(!/ProfileAchievementShowcase/.test(code), 'profilde eski sezon vitrini kalmış');
  assert(
    /<ProfileCareerShowcase[\s\S]{0,700}router\.push\('\/achievements'\)/.test(raw),
    'vitrin tüm başarımlar ekranını açmıyor',
  );
  assert(
    /<ProfileCareerShowcase[\s\S]{0,700}router\.push\('\/achievements-showcase'\)/.test(raw),
    'vitrin düzenleme ekranını açmıyor',
  );
});

// ---------------------------------------------------------------------------
// F. Paylaşılan aktif program: guard ve ortak sözleşme korunuyor.
// ---------------------------------------------------------------------------
check('F1. ProfileSharedProgram yalnız ownSharedProgram guard’ıyla, ortak sözleşme', () => {
  assert(/ownSharedProgram && \(/.test(code), 'aktif program görünürlük guard’ı kaldırılmış');
  assert(/<ProfileSharedProgram accentColor=\{profileAccent\.color\} compact program=\{ownSharedProgram\}/.test(code),
    'ortak bileşenin veri/işlev sözleşmesi bozulmuş');
});

// ---------------------------------------------------------------------------
// G. Disiplin: açılır/kapanır, profil-özel bileşen.
// ---------------------------------------------------------------------------
check('G1. ProfileDisciplineCard collapsible korunuyor', () => {
  assert(/<ProfileDisciplineCard accentColor=\{profileAccent\.color\} collapsible compact \/>/.test(code),
    'disiplin kartı collapsible davranışını kaybetti');
});

// ---------------------------------------------------------------------------
// H. Arkadaşlar route’u ve erişilebilirlik.
// ---------------------------------------------------------------------------
check('H1. Arkadaşlar satırı /friends route’una erişilebilir bağlı', () => {
  const start = at('styles.friendsRow');
  const around = code.slice(code.lastIndexOf('<Pressable', start), code.indexOf('</Pressable>', start));
  assert(/router\.push\('\/friends'\)/.test(around), 'arkadaşlar /friends push’u kayboldu');
  assert(/accessibilityRole="button"/.test(around), 'arkadaşlar satırı buton rolünü kaybetti');
});

// ---------------------------------------------------------------------------
// I. Sade tasarım: ince ayırıcılar, kart/gradient/glow/gölge YOK.
// ---------------------------------------------------------------------------
check('I1. Bölümler ince (hairline) ayırıcıyla ayrılır', () => {
  assert(/sectionDivider:\s*\{[\s\S]*?height: StyleSheet\.hairlineWidth/.test(code), 'ayırıcı hairline kullanmıyor');
  assert(/sectionDivider:\s*\{[\s\S]*?backgroundColor: colors\.separator/.test(code), 'ayırıcı tema separator rengini kullanmıyor');
  const uses = (renderBody.match(/styles\.sectionDivider/g) ?? []).length;
  assert(uses >= 3, `yeterli bölüm ayırıcı yok (${uses})`);
});

check('I2. Gradient/glow/glassmorphism/ağır gölge YOK; yeni serbest hex YOK', () => {
  assert(!/gradient|LinearGradient/i.test(code), 'gradient eklenmiş');
  assert(!/shadowRadius|shadowOpacity|shadowOffset|elevation:\s*[1-9]/.test(code), 'ağır gölge eklenmiş');
  assert(!/blurRadius|BlurView|backdrop/i.test(code), 'glassmorphism/blur eklenmiş');
  // Yeni bölüm stilleri tema renklerinden gelir (serbest hex değil).
  assert(/summaryBio:\s*\{[\s\S]*?color: colors\.textSecondary/.test(code), 'bio yeni serbest hex kullanıyor');
});

// ---------------------------------------------------------------------------
// J. Erişilebilirlik / dokunma hedefleri (>= 44 pt).
// ---------------------------------------------------------------------------
check('J1. Ayarlar dişlisi ve arkadaşlar satırı en az 44 pt dokunma alanı', () => {
  assert(/settingsButton:\s*\{[\s\S]*?(height|minHeight): Layout\.minTouchSize/.test(code), 'Ayarlar butonu 44 pt değil');
  const friendsStart = code.indexOf('friendsRow:');
  const friends = code.slice(friendsStart, code.indexOf('}', code.indexOf('width:', friendsStart)));
  const minHeight = Number(friends.match(/minHeight:\s*(\d+)/)?.[1]);
  assert(Number.isFinite(minHeight) && minHeight >= 44, `arkadaşlar satırı < 44 pt (${minHeight})`);
});

// ---------------------------------------------------------------------------
// K. Kesin korunanlar: yükleme hatası + yeniden deneme, staged medya temizliği,
//    Reduce Motion helper'ları.
// ---------------------------------------------------------------------------
check('K1. Profil yükleme hatası ve yeniden deneme korunuyor', () => {
  assert(/profileLoadStatus === 'error'/.test(code), 'yükleme hatası satırı kaldırılmış');
  assert(/onPress=\{reloadProfile\}/.test(code), 'yeniden deneme (reloadProfile) kaldırılmış');
});

check('K2. Staged medya temizliği ortak hook’ta (kalıcı medya korunması)', () => {
  // Medya/staged temizlik mantığı artık ortak `useProfileEditor` hook'unda.
  const hook = source('hooks/use-profile-editor.ts');
  assert(/stagedPathsRef/.test(hook), 'staged yol takibi kaldırılmış');
  assert(/removeProfileImagePaths/.test(hook), 'staged medya temizliği kaldırılmış');
});

check('K3. Bölüm girişleri MotionSection ile; eski editör scroll/collapsible YOK', () => {
  assert(/from '@\/components\/motion-section'/.test(raw), 'motion helper importu kaldırılmış');
  assert((code.match(/<MotionSection/g) ?? []).length >= 3, 'bölüm girişleri MotionSection ile yumuşatılmıyor');
  // Açılır editör kaldırıldığı için scroll ölçümü/otomatik-kaydırma ve
  // MotionCollapsible profilde artık YOK.
  assert(
    !/MotionCollapsible|scrollContentHeightRef|editorHeightRef|closeProfileEditor/.test(code),
    'eski editör scroll/collapsible mantığı hâlâ profilde',
  );
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Profil UI hiyerarşi harness: ${passed} kontrol geçti.`);
console.log('  (Canlı render yok — tek kaynak dosya statik olarak denetlendi.)');
