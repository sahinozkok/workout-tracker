#!/usr/bin/env node
/**
 * REGRESYON: "season === undefined" tek kök nedeninin ürettiği üç belirtiyi
 * (profil vitrini sonsuz loading, Rank unranked, Rank alanına dokununca ekran
 * açılmaması) ve bunların düzeltmesini kilitler.
 *
 * Kök neden: `syncMyRank` hata verir ya da boş dönerse `runSync` sessizce
 * `season`'ı undefined bırakıyor, `isRankLoading`'i false yapıyor ve HİÇBİR
 * hata bayrağı üretmiyordu. season tek kaynak olduğu için:
 *   - Rank alanı `onRankPress && rank` olduğundan basılamıyordu,
 *   - `isShowcaseSelectionReady` (season?.seasonIndex gerektirir) sonsuza kadar
 *     false kalıp vitrini spinner'da donduruyordu,
 *   - ProfileProgressSummary rank verisi olmayınca "unranked" gösteriyordu.
 *
 * Canlı render yok: tek kaynak dosyalar statik olarak denetlenir. Bu harness'ın
 * her kontrolü DÜZELTME ÖNCESİ kodda başarısız olacak biçimde yazılmıştır.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (path) => readFileSync(join(ROOT, path), 'utf8');
const rankContext = source('context/rank-context.tsx');
const profile = source('app/(tabs)/profile.tsx');
const progress = source('components/rewards/profile-progress-summary.tsx');
const rankScreen = source('app/rank.tsx');
const showcase = source('components/ranks/profile-achievement-showcase.tsx');

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
/** Bir fonksiyon/callback gövdesini ada göre kabaca yalıtır. */
function slice(code, startMarker, endMarker) {
  const start = code.indexOf(startMarker);
  if (start < 0) return '';
  const end = endMarker ? code.indexOf(endMarker, start) : code.length;
  return code.slice(start, end < 0 ? code.length : end);
}

const runSync = slice(rankContext, 'const runSync = useCallback', 'const syncRank =');
const loadAchievements = slice(rankContext, 'const loadAchievements = useCallback', 'useEffect(() => {\n    loadAchievementsRef');
const loadShowcase = slice(rankContext, 'const loadShowcaseSelection = useCallback', 'const saveShowcaseSelection');
const resetEffect = slice(rankContext, 'ownerRef.current += 1;', '}, [userId]);');

// ---------------------------------------------------------------------------
// 1. Soğuk açılış: profil rank/başarı yüklemesini kendiliğinden başlatır.
//    (RankProvider mount → runSync; runSync başarılı olursa loadAchievements.)
// ---------------------------------------------------------------------------
check('1. Soğuk açılışta mount → runSync → loadAchievements zinciri kurulur', () => {
  assert(/useEffect\(\(\) => \{[\s\S]*?void runSync\(\);[\s\S]*?AppState\.addEventListener/.test(rankContext),
    'mount/AppState effect runSync çağırmıyor');
  // Başarılar rank ekranı koşuluna BAĞLI DEĞİL: her başarılı sync sonrası çağrılır.
  assert(/loadAchievementsRef\.current\(\);/.test(runSync), 'runSync başarı yüklemesini tetiklemiyor');
  // State güncellemesi render bekleyebilir; aynı uçuşun başarı/vitrin RPC'si
  // sezonu senkron ref üzerinden hemen görmelidir.
  assert(/if \(next\) \{[\s\S]*?seasonRef\.current = next;[\s\S]*?setSeason\(next\);/.test(runSync),
    'başarılı sync sezon referansını başarı yüklemesinden önce güncellemiyor');
  // Profil, rank ekranına girmeden bu context verisini kullanır (ikinci sorgu yok).
  assert(profile.includes('useRanks()'), 'profil RankContext verisini kullanmıyor');
});

// ---------------------------------------------------------------------------
// 2. Showcase success-empty → spinner biter, empty state oluşur.
//    (season varken isLoading yalnız achievements/selection'a bağlı; boş entries
//     → bileşen empty gösterir.)
// ---------------------------------------------------------------------------
check('2. season geldiğinde vitrin loading bitip empty state gösterebilir', () => {
  assert(/rankSeason \? isAchievementsLoading \|\| !isShowcaseSelectionReady/.test(profile),
    'season varken eski isLoading sözleşmesi korunmuyor');
  assert(/visible\.length === 0 \?[\s\S]*?showcase\.empty/.test(showcase), 'boş durum metni yok');
});

// ---------------------------------------------------------------------------
// 3. Showcase/achievement hatası → spinner SONSUZA kadar kalmaz.
// ---------------------------------------------------------------------------
check('3. Başarı/showcase (veya rank) hatası vitrini sonsuz spinnerda bırakmaz', () => {
  // Profil vitrini hata durumunu iletiyor ve bileşen hatada sessizce gizleniyor.
  assert(/hasError=\{hasAchievementsError \|\| hasShowcaseSelectionError \|\| hasRankError\}/.test(profile),
    'vitrin hata girişi rank hatasını içermiyor');
  assert(/if \(hasError\) return null;/.test(showcase), 'vitrin hatada gizlenmiyor');
});

// ---------------------------------------------------------------------------
// 4. Rank sync error + season undefined → Rank ekranı error/retry gösterir.
// ---------------------------------------------------------------------------
check('4. season yok + loading bitti → Rank ekranı hata + Retry gösterir', () => {
  const noSeasonBranch = slice(rankScreen, 'if (!season) {', 'const accent = getRankColor');
  assert(/isRankLoading \?/.test(noSeasonBranch), 'loading dalı yok');
  assert(/ranks\.loadFailed/.test(noSeasonBranch), 'hata metni yok');
  assert(/onPress=\{\(\) => void syncRank\(\)\}/.test(noSeasonBranch), 'Retry syncRank çağırmıyor');
  assert(/common\.retry/.test(noSeasonBranch), 'Retry etiketi yok');
  assert(rankScreen.includes('syncRank,'), 'syncRank context’ten alınmıyor');
});

// ---------------------------------------------------------------------------
// 5. Retry success → gerçek season görünür. (Retry = güvenli syncRank yolu;
//    runSync başarıda season'ı yazar ve hatayı temizler.)
// ---------------------------------------------------------------------------
check('5. Retry güvenli syncRank yolunu yeniden çalıştırır ve başarıda season yazılır', () => {
  assert(/const syncRank = useCallback\(async \(\) => \{\s*await runSync\(\);/.test(rankContext),
    'syncRank runSync sarmalayıcısı değil');
  assert(/if \(next\) \{[\s\S]*?seasonRef\.current = next;[\s\S]*?setSeason\(next\);\s*setHasRankError\(false\);/.test(runSync),
    'başarılı cevapta season yazılıp hata temizlenmiyor');
});

// ---------------------------------------------------------------------------
// 6. Zero-RP/yeni kullanıcı GEÇERLİ season cevabı hata sayılmaz.
//    (hata YALNIZCA next yokken ve elde season yokken işaretlenir.)
// ---------------------------------------------------------------------------
check('6. Geçerli season cevabı (zero-RP dahil) hata sayılmaz', () => {
  assert(/\} else if \(!seasonRef\.current\) \{\s*[\s\S]*?setHasRankError\(true\);/.test(runSync),
    'hata bayrağı yalnız boş cevap + season yok koşuluna bağlı değil');
  // next dolu (season) dalında setHasRankError(true) YAZILMAZ.
  const trueBranch = slice(runSync, 'if (next) {', '} else if (!seasonRef.current)');
  assert(trueBranch.length > 0 && !trueBranch.includes('setHasRankError(true)'),
    'dolu cevap dalında yanlışlıkla hata işaretleniyor');
});

// ---------------------------------------------------------------------------
// 7. Rank verisi undefined olsa bile profil Rank alanı /rank navigasyonuna açık.
// ---------------------------------------------------------------------------
check('7. Rank alanı rank verisi olmadan da basılabilir ( /rank açar )', () => {
  // Gate artık `onRankPress && rank` DEĞİL, yalnız `onRankPress`.
  assert(/\{onRankPress \? \(/.test(progress), 'rank hücresi hâlâ rank verisine bağlı basılabilir');
  assert(!/onRankPress && rank \?/.test(progress), 'eski `onRankPress && rank` gate’i hâlâ duruyor');
  assert(/onRankPress=\{\(\) => router\.push\('\/rank'\)\}/.test(profile), 'profil /rank push’unu geçirmiyor');
  // Sahte rank üretilmez: veri yoksa yine "unranked" içerik gösterilir.
  assert(/rank \?[\s\S]*?ranks\.rpValue[\s\S]*?:[\s\S]*?ranks\.unranked/.test(progress),
    'veri yokken unranked erişilebilirlik etiketi kullanılmıyor');
});

// ---------------------------------------------------------------------------
// 8. Aynı anda birden fazla sync/achievement isteği oluşmaz (single-flight).
// ---------------------------------------------------------------------------
check('8. Sync ve başarı yüklemesi tek-uçuş kilidi kullanır', () => {
  assert(/if \(isSyncingRef\.current\) \{\s*hasQueuedSyncRef\.current = true;\s*return;/.test(runSync),
    'sync tek-uçuş kilidi yok');
  assert(/if \(isAchievementsFetchingRef\.current\) \{\s*hasQueuedAchievementsRef\.current = true;\s*return;/.test(loadAchievements),
    'başarı yüklemesi tek-uçuş kilidi yok');
});

// ---------------------------------------------------------------------------
// 9. Hata sonrası single-flight kilitleri açılır (finally hep sıfırlar).
// ---------------------------------------------------------------------------
check('9. Hata sonrası tek-uçuş kilitleri finally’de serbest bırakılır', () => {
  assert(/finally \{[\s\S]*?isSyncingRef\.current = false;/.test(runSync), 'sync kilidi finally’de açılmıyor');
  assert(/finally \{[\s\S]*?isAchievementsFetchingRef\.current = false;/.test(loadAchievements),
    'başarı kilidi finally’de açılmıyor');
  // Yeni hata bayrağı akışı ENGELLEMEZ: yalnız durum işaretlenir.
  assert(/catch \{[\s\S]*?!seasonRef\.current[\s\S]*?setHasRankError\(true\);/.test(runSync),
    'catch dalında hata bayrağı season yokken işaretlenmiyor');
});

// ---------------------------------------------------------------------------
// 10. Hesap A’nın geç cevabı hesap B’ye yazılmaz (owner guard korunur).
// ---------------------------------------------------------------------------
check('10. Hesap sahipliği: geç gelen cevap yeni hesaba yazılmaz', () => {
  assert(/owner !== ownerRef\.current/.test(runSync), 'runSync owner guard’ı yok');
  assert(/owner !== ownerRef\.current/.test(loadAchievements), 'loadAchievements owner guard’ı yok');
  assert(/owner !== ownerRef\.current/.test(loadShowcase), 'loadShowcaseSelection owner guard’ı yok');
  // Yeni hata yazımı da yalnızca hâlâ güncel hesap için yapılır.
  assert(/owner === ownerRef\.current && !seasonRef\.current/.test(runSync),
    'hata bayrağı hesap sahipliğini atlıyor');
  // Hesap değişiminde bayrak da sıfırlanır.
  assert(/setHasRankError\(false\);/.test(resetEffect), 'hesap değişiminde rank hatası sıfırlanmıyor');
});

// ---------------------------------------------------------------------------
// 11. Celebration/baseline ve selection-ready sözleşmeleri korunur.
// ---------------------------------------------------------------------------
check('11. Kutlama/baseline ve isShowcaseSelectionReady sözleşmeleri bozulmaz', () => {
  // Uzlaştırma yalnız gerçek RPC sonucundan, sezon bilindiğinde tetiklenir.
  assert(/const seasonIndex = seasonRef\.current\?\.seasonIndex;\s*if \(seasonIndex === undefined\) return;/.test(loadAchievements),
    'kutlama uzlaştırma gate’i (seasonIndex) değişmiş');
  assert(/achievementCelebrationChainRef\.current = achievementCelebrationChainRef\.current/.test(loadAchievements),
    'kutlama zinciri kaldırılmış');
  // selection-ready hâlâ cevabın sezonu ile eşleşmeye bağlı.
  assert(/isShowcaseSelectionReady =\s*showcaseSelectionResult !== undefined &&\s*season\?\.seasonIndex !== undefined &&\s*showcaseSelectionResult\.seasonIndex === season\.seasonIndex/.test(rankContext),
    'isShowcaseSelectionReady sözleşmesi değişmiş');
});

if (failures.length > 0) {
  console.error('✗ Rank erişilebilirlik + hata kurtarma harness başarısız:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ Rank erişilebilirlik + hata kurtarma harness: ${passed} kontrol geçti.`);
console.log('  (Canlı render yok — kaynak dosyalar statik olarak denetlendi.)');
