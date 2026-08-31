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
check('A1. Görünen ad ANA başlık; kimlik sırası ad → bio → eylemler', () => {
  const name = at('styles.summaryName');
  const bio = at('styles.summaryBio');
  const actions = at('styles.headerActions');
  const username = at('styles.summaryUsername');
  assert(username < name, 'kullanıcı adı görünen addan sonra gelmemeli (eyebrow konumu)');
  assert(name < bio, 'bio görünen adın ALTINDA olmalı');
  assert(bio < actions, 'Düzenle/Ayarlar eylemleri bio/kimlikten sonra, kimliğe yakın olmalı');
  // Ad en fazla 2 satır (dar ekranda taşma yok).
  assert(
    /<Text[^>]*numberOfLines=\{2\}[^>]*style=\{styles\.summaryName\}/.test(raw),
    'görünen ad iki satırla sınırlanmamış',
  );
});

check('A2. Bio TEK yerde: kimlikte gösterilir, halkada TEKRAR edilmez', () => {
  // Kimlikte bio metni draft.bio'dan gelir.
  assert(/styles\.summaryBio\}>\{draft\.bio\.trim\(\)\}/.test(code), 'bio kimlik alanında draft.bio ile gösterilmiyor');
  // LevelProgressRing artık bio'yu `message` olarak ALMAZ (çift gösterim yok).
  const ringStart = at('<LevelProgressRing');
  const ringEnd = code.indexOf('/>', ringStart);
  const ringProps = code.slice(ringStart, ringEnd);
  assert(!/message=/.test(ringProps), 'bio hem kimlikte hem halkada gösteriliyor (tekrar)');
});

check('A3. Düzenle + Ayarlar kimliğe YAKIN (ilerleme/istatistikten ÖNCE)', () => {
  const actions = at('styles.headerActions');
  const ring = at('<LevelProgressRing');
  const proof = at('<ProfileProofStats');
  assert(actions < ring && actions < proof, 'eylemler ekranın dibinde kalmış (kimliğe yakın değil)');
  // İki eylem de kimliğe ait tek satırda ve dengeli.
  assert(/onPress=\{handleProfileEditorToggle\}/.test(code), 'Düzenle mevcut editör toggle handler’ına bağlı değil');
  assert(/router\.push\('\/settings'\)/.test(code), 'Ayarlar /settings route’unu kaybetti');
});

// ---------------------------------------------------------------------------
// B. Düzenleyici (açılır/kapanır) ve otomatik kaydırma korunuyor.
// ---------------------------------------------------------------------------
check('B1. Editör MotionCollapsible; alan/kaydet/medya davranışları korunuyor', () => {
  assert(/<MotionCollapsible style=\{styles\.editorSection\}>/.test(code), 'editör MotionCollapsible değil');
  // Form alanları ve kaydetme korunur (veri mantığı yeniden yazılmadı).
  for (const token of [
    "updateDraft('displayName'",
    "updateDraft('username'",
    "updateDraft('bio'",
    "updateDraft('trainingGoal'",
    'onPress={handleSave}',
    "pickProfileImage('avatar')",
    "pickProfileImage('banner')",
    "handleRemoveProfileImage('avatar')",
    "handleRemoveProfileImage('banner')",
  ]) {
    assert(code.includes(token), `editör davranışı kayboldu: ${token}`);
  }
});

check('B2. Otomatik kaydırma ölçümü ve kapatma mantığı KORUNUYOR', () => {
  // Editör kimliğin altına taşındığı için gerçek içerik ve form yüksekliği
  // ölçülür; eski "anchor sayfanın sonunda" varsayımı kullanılmaz.
  assert(/onContentSizeChange=\{handleScrollContentSizeChange\}/.test(code), 'içerik yüksekliği ölçülmüyor');
  assert(/<View onLayout=\{handleEditorLayout\}>/.test(code), 'editör yüksekliği ölçülmüyor');
  assert(
    /scrollContentHeightRef\.current\s*-\s*editorHeightRef\.current/.test(code),
    'kapanmış içerik yüksekliği gerçek ölçümlerden türetilmiyor',
  );
  assert(!/editorAnchorYRef|editorAnchorHeightRef/.test(code), 'eski alt-anchor varsayımı kalmış');
  // Kapatma yumuşak kaydırma mantığı ekranda hâlâ var.
  assert(/scrollRef\.current\?\.scrollTo\(\{ animated: true/.test(raw), 'yumuşak kapatma kaydırması kaldırılmış');
  assert(/const closeProfileEditor = useCallback\(/.test(raw), 'closeProfileEditor mantığı kaldırılmış');
  // Reduce Motion kapatma kaydırmasını hâlâ kapıyor.
  assert(/!reduceMotion && hasMeasuredLayout/.test(raw), 'Reduce Motion kapatma kaydırması kapısı kaldırılmış');
});

check('B3. Editör kimliğe YAKIN açılır (ilerleme bölümünden ÖNCE)', () => {
  const editor = at('<MotionCollapsible style={styles.editorSection}>');
  const proof = at('<ProfileProofStats');
  const divider = at('styles.sectionDivider');
  assert(editor < proof, 'editör hâlâ ekranın dibinde açılıyor (kimliğe yakın değil)');
  assert(editor < divider, 'editör ilk ayırıcıdan önce, kimlik alanının hemen altında olmalı');
});

// ---------------------------------------------------------------------------
// C. Level ve rank AYRI sistemler; rank verisi yoksa uydurulmaz.
// ---------------------------------------------------------------------------
check('C1. Level ve rank ayrı; rank yalnız gerçek sezon verisinde çizilir', () => {
  assert(/\{rankSeason && \(\s*<RankBadge/.test(code), 'rank rozeti rankSeason guard’ı olmadan çiziliyor (sahte rank riski)');
  assert(/rankId=\{rankSeason\.currentRank\}/.test(code), 'RankBadge gerçek sezon verisini kullanmıyor');
  assert(/<LevelProgressRing/.test(code), 'LevelProgressRing kaldırılmış');
  // Level (ömür boyu) ve rank (sezon) yan yana, aynı bilgi tekrar edilmez.
  assert(/levelPillText/.test(code), 'level göstergesi kaldırılmış');
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
check('E1. Vitrin tek kez; /rank-showcase ve preserveOrder korunuyor', () => {
  assert((code.match(/<ProfileAchievementShowcase/g) ?? []).length === 1, 'vitrin çoğaltılmış/kaldırılmış');
  assert(
    /<ProfileAchievementShowcase[\s\S]{0,700}router\.push\('\/rank-showcase'\)/.test(raw),
    'vitrin /rank-showcase seçim ekranını açmıyor',
  );
  assert(/<ProfileAchievementShowcase[\s\S]{0,700}preserveOrder/.test(raw), 'vitrin preserveOrder sözleşmesini kaybetti');
});

// ---------------------------------------------------------------------------
// F. Paylaşılan aktif program: guard ve ortak sözleşme korunuyor.
// ---------------------------------------------------------------------------
check('F1. ProfileSharedProgram yalnız ownSharedProgram guard’ıyla, ortak sözleşme', () => {
  assert(/ownSharedProgram && \(/.test(code), 'aktif program görünürlük guard’ı kaldırılmış');
  assert(/<ProfileSharedProgram accentColor=\{profileAccent\.color\} program=\{ownSharedProgram\}/.test(code),
    'ortak bileşenin veri/işlev sözleşmesi bozulmuş');
});

// ---------------------------------------------------------------------------
// G. Disiplin: açılır/kapanır, profil-özel bileşen.
// ---------------------------------------------------------------------------
check('G1. ProfileDisciplineCard collapsible korunuyor', () => {
  assert(/<ProfileDisciplineCard accentColor=\{profileAccent\.color\} collapsible \/>/.test(code),
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
check('J1. Kimlik eylemleri ve arkadaşlar satırı en az 44 pt dokunma alanı', () => {
  assert(/editProfileButton:\s*\{[\s\S]*?minHeight: Layout\.minTouchSize/.test(code), 'Düzenle butonu 44 pt değil');
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

check('K2. Staged medya temizliği (kalıcı medya korunması) yerinde', () => {
  assert(/stagedPathsRef/.test(raw), 'staged yol takibi kaldırılmış');
  assert(/removeProfileImagePaths/.test(raw), 'staged medya temizliği kaldırılmış');
});

check('K3. Reduce Motion mevcut helper’lar içinde; ekran akışı helper’larla yumuşak', () => {
  assert(/from '@\/components\/motion-section'/.test(raw), 'motion helper importu kaldırılmış');
  assert((code.match(/<MotionSection/g) ?? []).length >= 3, 'bölüm girişleri MotionSection ile yumuşatılmıyor');
  // Ekran Reduce Motion’u yalnız mevcut helper + kaydırma kapısı için okur.
  assert(/useReducedMotion/.test(raw), 'Reduce Motion okuması kaldırılmış');
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Profil UI hiyerarşi harness: ${passed} kontrol geçti.`);
console.log('  (Canlı render yok — tek kaynak dosya statik olarak denetlendi.)');
