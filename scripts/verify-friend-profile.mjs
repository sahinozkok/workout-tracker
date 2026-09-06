#!/usr/bin/env node
/**
 * ARKADAŞ PROFİLİ — GÖRSEL UYUM + GÜL ZİNCİRİ + GİZLİLİK/GÜVENLİK HARNESS'I
 *
 * Kaynak metni statik denetler: arkadaş profili kendi profilimizle AYNI ortak
 * sunum bileşenini (ProfileProgressSummary) SALT OKUNUR kullanır, arkadaşın
 * seçili gülünü get_friend_level_rose zinciriyle gösterir, sahibine özel
 * eylemleri/özel istatistikleri sızdırmaz ve durum (yükleme/erişim yok/hata)
 * ayrımını korur.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

// Saf katalog+çözücüyü GERÇEKTEN derleyip çalıştır (yürütülebilir davranış).
const outDir = mkdtempSync(join(tmpdir(), 'rosea-friendrose-'));
let cat;
try {
  execFileSync(
    'npx',
    ['tsc', join(ROOT, 'constants/level-roses.ts'), '--outDir', outDir, '--target', 'es2020',
      '--module', 'esnext', '--moduleResolution', 'bundler', '--strict'],
    { cwd: ROOT, stdio: 'pipe' },
  );
  cat = await import(pathToFileURL(join(outDir, 'level-roses.js')).href);
} catch (error) {
  console.error('constants/level-roses.ts derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}

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

const screen = src('app/profile/[userId].tsx');
const friendsSvc = src('services/friends.ts');
const migration = src('supabase/migrations/20260910120000_add_level_rose_selection.sql');

// 1. Görsel uyum: ortak ProfileProgressSummary kullanılır (eski ring/pill değil).
check('1. Ortak ProfileProgressSummary kullanılır; eski ring/pill kaldırıldı', () => {
  assert(screen.includes("from '@/components/rewards/profile-progress-summary'"), 'ortak özet içe aktarılmıyor');
  assert(/<ProfileProgressSummary/.test(screen), 'ortak özet kullanılmıyor');
  assert(!/LevelProgressRing/.test(screen), 'eski LevelProgressRing kaldırılmalı');
  assert(!/levelPill/.test(screen), 'eski levelPill kaldırılmalı');
  // Kimlik tipografisi kendi profil summary stilleriyle hizalı.
  for (const s of ['summaryUsername', 'summaryName', 'summaryBio']) {
    assert(screen.includes(s), `kimlik stili eksik: ${s}`);
  }
});

// 2. SALT OKUNUR: seçim/nav/edit yok; gül değiştirme/kaydetme yok.
check('2. Salt okunur: onLevelPress/onRankPress ve sahibine özel eylemler yok', () => {
  const tag = screen.slice(screen.indexOf('<ProfileProgressSummary'), screen.indexOf('/>', screen.indexOf('<ProfileProgressSummary')));
  assert(!/onLevelPress/.test(tag), 'arkadaş özetinde onLevelPress olmamalı (seçim/gül değiştirme yok)');
  assert(!/onRankPress/.test(tag), 'arkadaş özetinde onRankPress olmamalı (/rank nav yok)');
  // Sahibine özel eylemler görünmez.
  assert(!/setRoseSheetOpen|LevelRoseSheet|setLevelRose/.test(screen), 'gül seçim penceresi/kaydetme arkadaş ekranında olmamalı');
  assert(!/router\.push\('\/settings'\)/.test(screen), 'Ayarlar arkadaş ekranında olmamalı');
  assert(!/handleProfileEditorToggle|profile\.save|editProfileButton/.test(screen), 'Düzenle/Kaydet arkadaş ekranında olmamalı');
});

// 3. Gül zinciri: servis + ayrık durum modeli; hata OTOMATİK'e dönüşmez.
check('3. get_friend_level_rose servis→ekran; loading/unavailable/ready AYRI', () => {
  assert(/export async function getFriendLevelRose/.test(friendsSvc), 'servis fonksiyonu yok');
  assert(/supabase\.rpc\('get_friend_level_rose', \{\s*target_user_id: targetUserId/.test(friendsSvc), 'RPC çağrısı yanlış');
  // Servis HATAYI yutup null'a çevirmez (throw eder); çağıran ayırır.
  assert(/if \(error\) throw error/.test(friendsSvc), 'servis hatayı sessizce null yapmamalı');
  // Servis, erişim reddini otomatik tercihten AYIRAN sonucu döndürür
  // (FriendRoseFetch): `ready` | `denied`. Ham yanıt saf parse ile daraltılır.
  assert(/Promise<FriendRoseFetch>/.test(friendsSvc), 'servis ready/denied sonucu döndürmüyor');
  assert(/return parseFriendLevelRoseResponse\(data\)/.test(friendsSvc), 'ham yanıt saf parse ile daraltılmıyor');
  // Ekran AYRIK durum modeli kullanır (FriendRoseState), string|null|undefined değil.
  assert(/useState<FriendRoseState>\(\{ kind: 'loading' \}\)/.test(screen), 'friendRose ayrık durum modeli değil');
  // Gül AYRI efektte okunur (profili engellemez). ERİŞİM REDDİ (`denied`) →
  // `unavailable` (otomatik DEĞİL); yalnız `ready` → selectedId anlamlı.
  assert(/result\.kind === 'ready'\s*\?\s*\{ kind: 'ready', selectedId: result\.selectedId \}\s*:\s*\{ kind: 'unavailable' \}/.test(screen),
    'denied/ready eşlemesi yok (erişim reddi otomatik sayılmamalı)');
  assert(/setFriendRose\(\{ kind: 'unavailable' \}\)/.test(screen), 'hata unavailable olarak işaretlenmiyor');
  assert(!/setFriendRose\([^)]*selectedId: null[^)]*\)/.test(screen), 'hata/yükleme null tercihe DÖNÜŞTÜRÜLMEMELİ');
  // Özete doğru eşleme: ready → selectedId + levelRoseState yok; diğerleri → placeholder.
  assert(/levelRoseState=\{friendRose\.kind === 'ready' \? undefined : friendRose\.kind\}/.test(screen), 'levelRoseState eşlemesi yok');
  assert(/selectedRoseId=\{friendRose\.kind === 'ready' \? friendRose\.selectedId : undefined\}/.test(screen), 'selectedRoseId eşlemesi yok');
});

// 3d. YÜRÜTÜLEBİLİR: parseFriendLevelRoseResponse — erişim reddi ≠ otomatik ≠
// geçersiz yanıt (yeni `returns table` sözleşmesi + eski skaler geriye uyum).
check('3d. parseFriendLevelRoseResponse: denied/ready/geçersiz AYRI', () => {
  // Yeni sözleşme: DİZİ. 0 satır → denied (erişim yok).
  assert.deepEqual(cat.parseFriendLevelRoseResponse([]), { kind: 'denied' }, '0 satır erişim reddi olmalı');
  // 1 satır + null → ready (arkadaşın OTOMATİK tercihi; erişim VAR).
  assert.deepEqual(
    cat.parseFriendLevelRoseResponse([{ selected_level_rose: null }]),
    { kind: 'ready', selectedId: null },
    'null satır otomatik-ready olmalı (denied DEĞİL)',
  );
  // 1 satır + string → ready + açık seçim.
  assert.deepEqual(
    cat.parseFriendLevelRoseResponse([{ selected_level_rose: 'rose_5' }]),
    { kind: 'ready', selectedId: 'rose_5' },
    'string satır açık seçim olmalı',
  );
  // Eski skaler sunucu (geriye uyum): string/null → ready.
  assert.deepEqual(cat.parseFriendLevelRoseResponse('rose_5'), { kind: 'ready', selectedId: 'rose_5' }, 'eski skaler string');
  assert.deepEqual(cat.parseFriendLevelRoseResponse(null), { kind: 'ready', selectedId: null }, 'eski skaler null');
  // GEÇERSİZ sunucu yanıtı (sayı/nesne) SESSİZCE otomatik'e çevrilmez → throw.
  assert.throws(() => cat.parseFriendLevelRoseResponse([{ selected_level_rose: 42 }]), /invalid_level_rose_response/, 'geçersiz satır değeri throw etmeli');
  assert.throws(() => cat.parseFriendLevelRoseResponse(42), /invalid_level_rose_response/, 'geçersiz skaler throw etmeli');
});

// 3b. YÜRÜTÜLEBİLİR: gerçek resolveFriendRoseDisplay davranışı (grep değil).
check('3b. resolveFriendRoseDisplay: başarılı-null ≠ başarısız; tahmini gül yok', () => {
  const autoNull = cat.resolveFriendRoseDisplay({ kind: 'ready', selectedId: null }, 13);
  const failed = cat.resolveFriendRoseDisplay({ kind: 'unavailable' }, 13);
  const loading = cat.resolveFriendRoseDisplay({ kind: 'loading' }, 13);
  const manual = cat.resolveFriendRoseDisplay({ kind: 'ready', selectedId: 'rose_5' }, 13);
  assert.deepEqual(autoNull, { mode: 'rose', roseId: 'rose_13' }, 'başarılı null → otomatik gül');
  assert.notDeepEqual(autoNull, failed, 'başarılı null ile başarısız istek FARKLI olmalı');
  assert.equal(failed.mode, 'placeholder', 'başarısız istek gül göstermemeli (tahmini sembol yok)');
  assert.equal(loading.mode, 'placeholder', 'yükleme gül göstermemeli');
  assert.notDeepEqual(loading, failed, 'loading ile unavailable ayrı olmalı');
  assert.deepEqual(manual, { mode: 'rose', roseId: 'rose_5' }, 'manuel seçim doğru asseti göstermeli');
});

// 3c. YÜRÜTÜLEBİLİR: A→B gecikmiş yanıt B'nin gülünü DEĞİŞTİRMEZ (nesil guard sim).
check('3c. Gecikmiş A yanıtı B profilinin gülünü değiştirmez (simülasyon)', () => {
  // Ekrandaki efektin request-id guard yapısını birebir taklit eden mini state.
  const ref = { current: 0 };
  let applied;
  const startLoad = (respond) => {
    const requestId = ref.current + 1;
    ref.current = requestId;
    return (value) => {
      if (ref.current !== requestId) return; // eski nesil → yazamaz
      applied = value;
    };
  };
  const commitA = startLoad(); // A profili açıldı
  const commitB = startLoad(); // B profiline hızlı geçildi (nesil arttı)
  commitA({ kind: 'ready', selectedId: 'rose_1' }); // A'nın GECİKMİŞ yanıtı gelir
  assert.equal(applied, undefined, 'A yanıtı B nesli altında yazmamalı');
  commitB({ kind: 'ready', selectedId: 'rose_5' }); // B'nin yanıtı
  assert.deepEqual(applied, { kind: 'ready', selectedId: 'rose_5' }, 'yalnız B yazmalı');
});

// 4. Rank: veri yok (sıralanmadı) ≠ okuma hatası.
check('4. Rank hata durumu "rank yok"tan ayrılır', () => {
  assert(/hasFriendRankError, setHasFriendRankError\] = useState\(false\)/.test(screen), 'rank hata durumu yok');
  assert(/catch \{\s*if \(isCurrent\(\)\) setHasFriendRankError\(true\)/.test(screen), 'rank hatası işaretlenmiyor');
  assert(/hasRankError=\{hasFriendRankError\}/.test(screen), 'özet rank hatasını almıyor');
  assert(/rank=\{friendRank \? \{ id: friendRank\.currentRank, rp: friendRank\.currentRp \} : undefined\}/.test(screen),
    'rank arkadaş verisinden gelmiyor');
});

// 5. Veri/gizlilik: özel istatistik yok; kendi context'imiz bağlanmaz.
check('5. Özel veri sızmaz; kendi reward/rank contexti kullanılmaz', () => {
  // Gül bakiyesi / ProfileProofStats RENDER/PROP olarak yok (yorumda anılabilir).
  assert(!/<ProfileProofStats/.test(screen), 'ProfileProofStats arkadaş ekranında render edilmemeli');
  assert(!/import[^\n]*ProfileProofStats/.test(screen), 'ProfileProofStats içe aktarılmamalı');
  assert(!/roseBalance=/.test(screen), 'roseBalance prop olarak geçilmemeli (özel veri)');
  // Kendi context'lerimiz (useRewards/useRanks) arkadaş ekranında KULLANILMAZ.
  assert(!/useRewards\(|useRanks\(/.test(screen), 'kendi reward/rank contexti arkadaş ekranına bağlanmamalı');
  // Bütün değerler görüntülenen profilden (profile.*) veya arkadaş servislerinden.
  assert(/level=\{profile\.level\}/.test(screen), 'seviye görüntülenen profilden gelmeli');
});

// 6. Hızlı A→B geçişinde gecikmiş yanıt yeni profile yazmaz (nesil guard).
check('6. Ana yükleme nesil guardi (A→B karışması yok)', () => {
  assert(/loadRequestIdRef/.test(screen), 'ana yükleme nesil sayacı yok');
  assert(/const isCurrent = \(\) => isMountedRef\.current && loadRequestIdRef\.current === requestId/.test(screen),
    'nesil + mount guard yok');
  // Bütün setStateler isCurrent() ile korunur (profil/statuses/rank/rose).
  assert(!/if \(isMountedRef\.current\) setProfile/.test(screen), 'eski yalnız-mount guard kalmış');
});

// 7. Durum ayrımı: yükleniyor / erişim yok / hata ayrı; uygun retry.
check('7. Yükleniyor / erişim yok / hata ayrılır', () => {
  assert(/if \(isOwnProfile \|\| isLoading\) \{[\s\S]*?ActivityIndicator/.test(screen), 'yükleme durumu yok');
  assert(/if \(hasError \|\| !profile\) \{/.test(screen), 'erişim yok/hata durumu yok');
  // Yalnız gerçek hatada retry; erişim yok (profil undefined) sessiz kalır.
  assert(/hasError &&[\s\S]*?onPress=\{\(\) => \{[\s\S]*?void load\(\);/.test(screen), 'hata retrysi yok');
});

// 7b. Retry gül okumasını da YENİDEN dener (`unavailable` kalıcı takılmaz).
check('7b. Retry gül okumasını da yeniden dener', () => {
  // Okuma tek seferlik bir efekte gömülü DEĞİL; yeniden çağrılabilir bir
  // callback'tir ve efekt onu kullanır.
  assert(/const loadFriendRose = useCallback\(async \(\) => \{/.test(screen),
    'gül okuması yeniden çağrılabilir bir callback olmalı');
  assert(/useEffect\(\(\) => \{\s*void loadFriendRose\(\);\s*\}, \[loadFriendRose\]\);/.test(screen),
    'efekt callbacki çağırmalı');
  // Retry HEM profili HEM gülü tazeler.
  const retry = screen.slice(screen.indexOf('hasError &&'), screen.indexOf('</Pressable>', screen.indexOf('hasError &&')));
  assert(/void load\(\);/.test(retry) && /void loadFriendRose\(\);/.test(retry),
    'retry gül okumasını da yeniden denemeli');
  // Nesil guardi callback içinde KORUNUR: eski cevap yeni sonucun üzerine yazamaz.
  const fn = screen.slice(screen.indexOf('const loadFriendRose'), screen.indexOf('}, [isOwnProfile, userId]);', screen.indexOf('const loadFriendRose')));
  assert(/const requestId = friendRoseRequestIdRef\.current \+ 1;\s*friendRoseRequestIdRef\.current = requestId;/.test(fn),
    'nesil sayacı callback başında artmalı');
  assert(/isMountedRef\.current && friendRoseRequestIdRef\.current === requestId/.test(fn),
    'mount + nesil guardi yok');
  // Nesil, uzunluk kontrolünden ÖNCE artar (erişim reddinde eski sembol kalmaz).
  assert(fn.indexOf('friendRoseRequestIdRef.current = requestId') < fn.indexOf('if (!userId || isOwnProfile) return;'),
    'nesil erken dönüşten SONRA artıyor');
  // Hata hâlâ `unavailable`; null tercihe dönüşmez.
  assert(/catch \{[\s\S]*?setFriendRose\(\{ kind: 'unavailable' \}\)/.test(fn), 'hata unavailable olmalı');
  assert(!/catch \{[\s\S]*?selectedId: null/.test(fn), 'hata null tercihe dönüştürülemez');
});

// 7c. Ana profil BAŞARIYLA açıkken YALNIZ gül okunamadığında da BAĞIMSIZ retry.
check('7c. Profil hazırken gül unavailable ise bağımsız retry görünür', () => {
  // Render edilen (profil hazır) gövdede, gül `unavailable` iken kompakt bir
  // tekrar-deneme yalnız `loadFriendRose`'u çağırır (ana `load()`'u DEĞİL).
  assert(/friendRose\.kind === 'unavailable' &&/.test(screen), 'gül unavailable koşullu retry yok');
  const block = screen.slice(
    screen.indexOf("friendRose.kind === 'unavailable' &&"),
    screen.indexOf('</Pressable>', screen.indexOf("friendRose.kind === 'unavailable' &&")),
  );
  assert(/onPress=\{\(\) => void loadFriendRose\(\)\}/.test(block), 'bağımsız retry loadFriendRose çağırmıyor');
  assert(!/void load\(\)/.test(block), 'gül retrysi ana profil yüklemesini tetiklememeli (bağımsız olmalı)');
  assert(/t\('friends\.roseRetry'\)/.test(block), 'retry mevcut eylem deseninde/locale metni değil');
  // Bu retry ANA hata retry'ından (hasError) AYRIDIR: iki farklı yol vardır.
  assert(/hasError &&[\s\S]*?void loadFriendRose\(\);/.test(screen), 'ana hata retrysi de gülü tazelemeli (7b ile)');
  // KOMPAKT & özete YAKIN: küçük marginTop, 44 pt dokunma alanı korunur, büyük
  // kart/panel/dikkat çekici arka plan YOK (özetin doğal hata durumu gibi).
  const row = /roseRetryRow:\s*\{([\s\S]*?)\}/.exec(screen)?.[1] ?? '';
  assert(/minHeight: Layout\.minTouchSize/.test(row), 'retry 44 pt dokunma alanı yok');
  const mt = /marginTop:\s*([0-9]+)/.exec(row);
  assert(mt && parseInt(mt[1], 10) <= 4, `retry özete yakın olmalı (marginTop ${mt?.[1]} çok büyük)`);
  assert(!/backgroundColor|borderRadius|borderWidth|shadow/.test(row), 'retry büyük kart/arka plan içermemeli');
  // Gül BAŞARILI olunca (loading/ready) satır HİÇ render edilmez → boşluk kalmaz.
  assert(/\{friendRose\.kind === 'unavailable' && \(/.test(screen),
    'retry yalnız unavailable iken koşullu render edilmeli (başarıda boşluk kalmamalı)');
  assert(!/roseRetryRow[\s\S]{0,200}friendRose\.kind === 'ready'/.test(screen),
    'retry ready durumunda da çiziliyor olabilir');
});

// 8. KALICI başarım vitrini korunur; SALT OKUNUR; friendship/mesaj yolları bozulmaz.
check('8. Kariyer başarım vitrini (salt okunur) ve arkadaş işlemleri korunur', () => {
  // Ürün kararı: arkadaş profili KALICI kariyer vitrinini gösterir (sezon değil).
  assert(/<ProfileCareerShowcase/.test(screen), 'kariyer başarım vitrini korunmalı');
  assert(!/ProfileAchievementShowcase/.test(screen), 'arkadaşta eski sezon vitrini kalmış');
  // SALT OKUNUR: düzenleme (onEdit) yok, seçim ekranına/navigasyona gitmez.
  assert(!/onEdit=/.test(screen), 'arkadaş vitrini salt okunur olmalı (onEdit yok)');
  assert(!/achievements-showcase/.test(screen), 'arkadaş profili seçim ekranına gitmemeli');
  // Arkadaş RPC güvenlik zinciri: get_friend_level_rose are_friends korumalı.
  assert(/public\.are_friends\(\(select auth\.uid\(\)\), target_user_id\)/.test(migration),
    'arkadaş gülü okuması are_friends ile korunmalı');
});

// 9. Arkadaş başarım vitrini AYRI loading durumu: loading → ready-empty /
//    ready-data / error ayrılır ve eski nesil cevabı yeni kullanıcıyı bozmaz.
check('9. Vitrin loading→ready-empty/ready-data/error ayrımı + nesil guard', () => {
  // Ekrandaki efektin loading + generation guard yapısını taklit eden mini model.
  const ref = { current: 0 };
  const state = { showcase: [], hasError: false, loading: true };
  const start = (userId) => {
    const requestId = ref.current + 1;
    ref.current = requestId;
    state.showcase = [];
    state.hasError = false;
    if (!userId) {
      state.loading = false;
      return { resolve() {}, reject() {} };
    }
    state.loading = true;
    const guard = () => ref.current === requestId;
    return {
      resolve(entries) {
        if (!guard()) return;
        state.showcase = entries;
        state.loading = false;
      },
      reject() {
        if (!guard()) return;
        state.hasError = true;
        state.loading = false;
      },
    };
  };

  // loading → ready-empty (gerçekten başarılı + boş → empty; "başarım yok" ANCAK burada)
  let r = start('a');
  assert(state.loading === true && state.showcase.length === 0, 'istek sürerken loading olmalı');
  r.resolve([]);
  assert(state.loading === false && state.hasError === false && state.showcase.length === 0, 'ready-empty ayrımı yanlış');

  // loading → ready-data
  r = start('a');
  assert(state.loading === true, 'yeni istek loading açmalı');
  r.resolve([{ key: 'first_step' }]);
  assert(state.loading === false && state.showcase.length === 1, 'ready-data yazılmadı');

  // loading → error
  r = start('a');
  r.reject();
  assert(state.loading === false && state.hasError === true, 'error ayrımı yanlış');

  // Gecikmiş eski kullanıcı isteği yeni kullanıcının durumunu DEĞİŞTİRMEZ.
  const a = start('a');
  const b = start('b');
  a.resolve([{ key: 'first_step' }]);
  assert(state.showcase.length === 0 && state.loading === true, 'eski istek yeni kullanıcının durumunu değiştirdi');
  b.resolve([]);
  assert(state.loading === false, 'yeni istek loading kapatmadı');

  // Kaynakta gerçek yapı: ayrı state + lifecycle + guard + bileşene geçiş.
  assert(/const \[isShowcaseLoading, setIsShowcaseLoading\] = useState\(true\)/.test(screen), 'isShowcaseLoading state yok');
  assert(/setIsShowcaseLoading\(true\)/.test(screen), 'istek başında loading açılmıyor');
  assert(/setShowcase\(entries\);\s*setIsShowcaseLoading\(false\)/.test(screen), 'başarıda loading kapanmıyor');
  assert(/setHasShowcaseError\(true\);\s*setIsShowcaseLoading\(false\)/.test(screen), 'hatada loading kapanmıyor');
  assert(/isLoading=\{isShowcaseLoading\}/.test(screen), 'vitrine isLoading geçirilmiyor');
  // Loading/hata state'i nesil + aktiflik guard'ından SONRA yazılır (eski cevap yazamaz).
  const showcaseEffect = screen.slice(
    screen.indexOf('fetchFriendAchievementShowcase(userId)'),
    screen.indexOf('}, [isOwnProfile, userId]);', screen.indexOf('fetchFriendAchievementShowcase(userId)')),
  );
  assert(/showcaseRequestIdRef\.current !== requestId\) return;\s*setShowcase/.test(showcaseEffect),
    'başarı yazımı nesil guard\'ından sonra değil');
  // Arkadaş vitrini SALT OKUNUR: onPress/onEdit geçmez.
  const tag = screen.slice(screen.indexOf('<ProfileCareerShowcase'), screen.indexOf('/>', screen.indexOf('<ProfileCareerShowcase')));
  assert(!/onPress=|onEdit=/.test(tag), 'arkadaş vitrini salt okunur olmalı (onPress/onEdit yok)');
});

rmSync(outDir, { force: true, recursive: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Arkadaş profili harness: ${passed} kontrol geçti (statik + yürütülebilir davranış).`);
