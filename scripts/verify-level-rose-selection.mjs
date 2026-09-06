#!/usr/bin/env node
/**
 * SEVİYE GÜLÜ SEÇİMİ — SÖZLEŞME + GÜVENLİK + İSTEMCİ ENTEGRASYONU HARNESS'I
 *
 * Bu harness KAYNAK METNİ statik denetler (migration + servis + context + sheet +
 * profil). Statik kontrol GÜVENLİK KANITI DEĞİLDİR: gerçek RPC davranışı ayrı,
 * izole PostgreSQL testinde (`supabase/tests/level_rose_selection_isolated.sql`)
 * çalıştırılır. Bu dosya, o davranışı çağıran istemci sözleşmesini ve migration
 * yüzeyinin bozulmadığını kilitler.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

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

const mig = src('supabase/migrations/20260910120000_add_level_rose_selection.sql');
const migUpgrade = src('supabase/migrations/20260911120000_upgrade_friend_level_rose_to_table.sql');
const service = src('services/rewards.ts');
const context = src('context/reward-context.tsx');
const sheet = src('components/rewards/level-rose-sheet.tsx');
const emblem = src('components/rewards/level-rose-emblem.tsx');
const profile = src('app/(tabs)/profile.tsx');
const summary = src('components/rewards/profile-progress-summary.tsx');
const localeEn = src('locales/en.ts');
const localeTr = src('locales/tr.ts');

// ---------------------------------------------------------------------------
// 1. Migration EKLEMELİDİR: XP/roses/seviye/arşiv verisine dokunmaz.
// ---------------------------------------------------------------------------
check('1. Migration eklemeli; XP/roses/seviye hesabına dokunmaz', () => {
  assert(/add column if not exists selected_level_rose text/.test(mig), 'eklemeli kolon yok');
  // lifetime_xp / rose_balance / level_progress / level_for_xp YENİDEN TANIMLANMAZ
  // ve UPDATE edilmez.
  assert(!/update[\s\S]*?(lifetime_xp|rose_balance)\s*=/.test(mig), 'XP/roses değeri güncellenmemeli');
  assert(!/create or replace function public\.(level_progress|level_for_xp|get_my_progress)\b/.test(mig),
    'seviye/ilerleme fonksiyonları yeniden tanımlanmamalı');
  // Yalnız kendi kolonunu günceller.
  assert(/update public\.user_progress[\s\S]*?set selected_level_rose = target_rose[\s\S]*?where up\.user_id = actor/.test(mig),
    'yalnız selected_level_rose + kendi satırı güncellenmeli');
});

// ---------------------------------------------------------------------------
// 2. Katalog üyeliği CHECK'i (savunma derinliği) + açılma yardımcısı.
// ---------------------------------------------------------------------------
check('2. Katalog CHECK + açılma yardımcısı doğru', () => {
  assert(/constraint user_progress_selected_level_rose_known[\s\S]*?check \(\s*selected_level_rose is null[\s\S]*?in \(/.test(mig),
    'katalog üyeliği CHECK kısıtı yok');
  assert(/function public\.level_rose_unlock_level\(rose_id text\)/.test(mig), 'açılma yardımcısı yok');
  // Sınır eşlemeleri.
  for (const [id, lv] of [['rose_1', 1], ['rose_13', 13], ['rose_15', 15], ['rose_200', 200]]) {
    assert(new RegExp(`when '${id}' then ${lv}\\b`).test(mig), `${id} → ${lv} eşlemesi yok`);
  }
  assert(/immutable/.test(mig), 'yardımcı immutable olmalı');
});

// ---------------------------------------------------------------------------
// 3. set_my_level_rose: SUNUCU seviye + kilitli/bilinmeyen reddi + güvenlik.
// ---------------------------------------------------------------------------
check('3. set_my_level_rose güvenli ve doğrulamalı', () => {
  const fn = mig.slice(mig.indexOf('function public.set_my_level_rose'), mig.indexOf('revoke all on function public.set_my_level_rose'));
  assert(/security definer/.test(fn) && /set search_path = ''/.test(fn), 'security definer + boş search_path yok');
  assert(/actor uuid := \(select auth\.uid\(\)\)/.test(fn), 'auth.uid() ile sahiplik yok');
  assert(/if actor is null then\s*raise exception 'not_authenticated'/.test(fn), 'oturumsuz reddi yok');
  // Bilinmeyen kimlik reddi.
  assert(/if unlock is null then\s*raise exception 'unknown_level_rose'/.test(fn), 'bilinmeyen kimlik reddi yok');
  // Seviye SUNUCUDAN: level_progress(lifetime_xp); istemci seviyesi kullanılmaz.
  assert(/from public\.user_progress[\s\S]*?cross join lateral public\.level_progress\(up\.lifetime_xp\)/.test(fn),
    'seviye sunucu lifetime_xp uzerinden hesaplanmiyor');
  assert(/if coalesce\(user_level, 1\) < unlock then\s*raise exception 'level_rose_locked'/.test(fn),
    'kilitli gül reddi yok');
  // Yalnız kendi satırı.
  assert(/where up\.user_id = actor/.test(fn), 'yalnız kendi satırı güncellenmiyor');
});

// ---------------------------------------------------------------------------
// 4. Grant/revoke: yalnız authenticated EXECUTE; anon/public kapalı.
// ---------------------------------------------------------------------------
check('4. RPC izinleri: authenticated EXECUTE, anon/public kapalı', () => {
  for (const sig of ['set_my_level_rose(text)', 'get_my_level_rose()', 'get_friend_level_rose(uuid)']) {
    assert(mig.includes(`grant execute on function public.${sig} to authenticated`), `${sig} authenticated grant yok`);
    assert(mig.includes(`revoke all on function public.${sig} from anon`), `${sig} anon revoke yok`);
    assert(mig.includes(`revoke all on function public.${sig} from public`), `${sig} public revoke yok`);
  }
  // Yardımcı istemciye açık değil.
  assert(mig.includes('revoke all on function public.level_rose_unlock_level(text) from authenticated'),
    'level_rose_unlock_level authenticated rolune acik olmamali');
  // Arkadaş okuması are_friends korumalı.
  assert(/function public\.get_friend_level_rose[\s\S]*?public\.are_friends\(\(select auth\.uid\(\)\), target_user_id\)/.test(mig),
    'arkadaş okuması are_friends ile korunmalı');
});

// ---------------------------------------------------------------------------
// 5. Servis: parametresiz okuma; yazmada yalnız target_rose (kimlik/seviye YOK).
// ---------------------------------------------------------------------------
check('5. Servis RPC çağrıları güvenli sözleşmede', () => {
  assert(service.includes("supabase.rpc('get_my_level_rose')"), 'get_my_level_rose parametresiz çağrılmıyor');
  assert(/supabase\.rpc\('set_my_level_rose', \{ target_rose: roseId \}\)/.test(service),
    'set_my_level_rose yalnız target_rose göndermeli (kimlik/seviye yok)');
  // Yasak alanlar servis payloadlarında yok.
  const payloads = [...service.matchAll(/rpc\('(get|set)_my_level_rose'(?:, (\{[^}]*\}))?\)/g)].map((m) => m[2] ?? '');
  for (const p of payloads) for (const bad of ['user', 'level', 'uid']) assert(!p.includes(bad), `payload yasak alan: ${p}`);
  // OKUMA ve YAZMA aynı daraltıcıyı kullanır: geçersiz sunucu yanıtı sessizce
  // `null`'a — yani "otomatik tercih"e — çevrilmez, fırlatılır.
  const readFn = service.slice(service.indexOf('export async function fetchMyLevelRose'), service.indexOf('export async function saveMyLevelRose'));
  const writeFn = service.slice(service.indexOf('export async function saveMyLevelRose'));
  assert(/return parseLevelRoseResponse\(data\);/.test(readFn), 'okuma parseLevelRoseResponse kullanmalı');
  assert(/return parseLevelRoseResponse\(data\);/.test(writeFn), 'yazma da parseLevelRoseResponse kullanmalı');
  assert(!/typeof data === 'string' && data\.length > 0 \? data : null/.test(writeFn),
    'yazma geçersiz yanıtı sessizce otomatik (null) tercihe çeviremez');
});

// ---------------------------------------------------------------------------
// 6. Context: eksik backend'i bozmadan ele alır; pesimistik kayıt; hesap izolasyonu.
// ---------------------------------------------------------------------------
check('6. Context: 3-durum okuma, pesimistik kayıt, hesap izolasyonu', () => {
  // OKUMA 3 durumludur (loading/ready/unavailable) — arkadaş tarafıyla AYNI model.
  const loadFn = context.slice(context.indexOf('const loadLevelRose'), context.indexOf('const setLevelRose'));
  // Başarı → ready (seçim + durum birlikte).
  assert(/setSelectedRoseId\(sel\);\s*setRoseStatus\('ready'\)/.test(loadFn), 'başarılı okuma ready yazmıyor');
  // Okuma HATASI "otomatik"e DÖNÜŞTÜRÜLMEZ: catch içinde SAHTE seçim yazılmaz;
  // durum unavailable olur (önceki 'ready' KORUNUR — aynı kullanıcı için).
  assert(!/catch \{[\s\S]*?setSelectedRoseId\(/.test(loadFn), 'okuma hatasında sahte seçim yazılıyor (otomatik ≠ hata)');
  assert(/catch \{[\s\S]*?setRoseStatus\(\(prev\) => \(prev === 'ready' \? 'ready' : 'unavailable'\)\)/.test(loadFn),
    'okuma hatasında unavailable/koruma davranışı yok');
  // Başarılı null ile hata AYRI: exposed durum ready→undefined, aksi→loading/unavailable.
  assert(/roseStatus === 'ready' \? undefined : roseStatus/.test(context), 'levelRoseState türetimi yok');
  assert(/levelRoseState: 'loading' \| 'unavailable' \| undefined/.test(context), 'levelRoseState arayüzü yok');
  // Pesimistik: state YALNIZCA başarıdan sonra; hatada önceki korunur.
  const setFn = context.slice(context.indexOf('const setLevelRose'), context.indexOf('// Hesap değişimi'));
  assert(/const saved = await saveMyLevelRose\(roseId\)/.test(setFn), 'sunucuya kaydetme yok');
  // Başarılı kayıt hem seçimi yazar hem durumu ready yapar (unavailable'dan kurtulur).
  assert(/setSelectedRoseId\(saved\);\s*[\s\S]*?setRoseStatus\('ready'\)[\s\S]*?return 'saved'/.test(setFn),
    'başarıda state/ durum güncellenmiyor');
  assert(/catch \{\s*return 'error'/.test(setFn), 'hatada error dönmüyor (önceki seçim korunur)');
  assert(/if \(roseId === selectedRoseId\) return 'noop'/.test(setFn), 'aynı değerde noop yok');
  assert(/if \(isSavingRoseRef\.current\) return 'error'/.test(setFn), 'yinelenen kaydetme kilidi yok');
  assert(/owner !== ownerRef\.current/.test(setFn), 'geç cevap owner guard yok');
  // Hesap değişiminde seçim ve durum sıfırlanır (başka hesaba TAŞINMAZ).
  assert(/setSelectedRoseId\(null\);\s*[\s\S]*?setRoseStatus\(userId \? 'loading' : 'ready'\)/.test(context),
    'hesap değişiminde seçim/durum sıfırlanmıyor');
});

// ---------------------------------------------------------------------------
// 7. Profil: selectedRoseId gerçekten kullanılıyor; level dokunuşu sheet açıyor.
// ---------------------------------------------------------------------------
check('7. Profil selectedRoseId kullanır; level dokunuşu sheet açar', () => {
  assert(/selectedRoseId, setLevelRose \} = useRewards\(\)/.test(profile), 'context seçim alanları alınmıyor');
  assert(/selectedRoseId=\{selectedRoseId\}/.test(profile), 'ProfileProgressSummary selectedRoseId almıyor (kullanılmayan prop kalmamalı)');
  // Kendi profil de 3-durum okumayı KULLANIR: levelRoseState alınıp özete geçer,
  // böylece yükleme/hata "otomatik gül" gibi gösterilmez (arkadaşla aynı alan).
  assert(/levelRoseState, selectedRoseId/.test(profile), 'context levelRoseState alınmıyor');
  assert(/levelRoseState=\{levelRoseState\}/.test(profile), 'özete levelRoseState geçirilmiyor');
  assert(/onLevelPress=\{\(\) => setRoseSheetOpen\(true\)\}/.test(profile), 'level dokunuşu sheet açmıyor');
  assert(profile.includes('<LevelRoseSheet'), 'LevelRoseSheet render edilmiyor');
  const sheetTag = profile.slice(profile.indexOf('<LevelRoseSheet'), profile.indexOf('/>', profile.indexOf('<LevelRoseSheet')));
  // Rose kaydetme YİNE `setLevelRose` ile yapılır; sheet artık onu saran
  // `handleRoseSelect`'i kullanır (başarılı kayıtta `rose_bud` başarım senkronunu
  // da tetikler). Kaydetme güvencesi korunur.
  assert(/onSelect=\{handleRoseSelect\}/.test(sheetTag), 'sheet onSelect=handleRoseSelect bağlı değil');
  assert(/const handleRoseSelect =[\s\S]*?await setLevelRose\(roseId\)/.test(profile), 'handleRoseSelect setLevelRose ile kaydetmiyor');
  assert(/const handleRoseSelect =[\s\S]*?requestAchievementSync\(\)/.test(profile), 'rose kaydı başarım senkronu istemiyor');
  assert(/onInfo=\{\(\) => setRewardInfoKind\('level'\)\}/.test(sheetTag), 'sheet onInfo XP bilgisine bağlı değil');
  assert(/visible=\{roseSheetOpen\}/.test(sheetTag), 'sheet visible bağlı değil');
  // Özet bileşeni gülü seviye+seçimden çözer (profil auto/manuel ayrımı).
  assert(/resolveDisplayedRose\(level, selectedRoseId/.test(summary), 'özet gülü seviye+seçimden çözmüyor');
});

// ---------------------------------------------------------------------------
// 8. Sheet: kart/daire YOK; kilitli seçilemez; dedupe; info; otomatik mod.
// ---------------------------------------------------------------------------
check('8. Sheet kuralları: kartsız, kilit, dedupe, info, otomatik', () => {
  // Ekranın tamamını kaplamaz (maxHeight) + kaydırılabilir.
  assert(/maxHeight: '82%'/.test(sheet) && sheet.includes('ScrollView'), 'kaydırılabilir, tam-ekran-değil sheet yok');
  // Gül hücresinde kart/daire/çerçeve YOK: item stilinde background/border/radius yok.
  const item = /item:\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? '';
  assert(!/background|border(Width|Color|Radius)/.test(item), 'gül hücresinde kart/çerçeve olmamalı');
  // Kilitli seçilemez.
  assert(/disabled=\{!unlocked \|\| savingId !== undefined\}/.test(sheet), 'kilitli/kaydederken devre dışı değil');
  // Yinelenen kaydetme: kaydederken bütün öğeler devre dışı (savingId).
  assert(/savingId !== undefined/.test(sheet), 'kaydetme sırasında yinelenen işlem engellenmiyor');
  // Seçili küçük işaretle; kart yok.
  assert(/selectedTag[\s\S]*?checkmark-circle/.test(sheet), 'seçili işareti yok');
  // Görünür bilgi eylemi (XP nasıl kazanılır).
  assert(/onPress=\{onInfo\}/.test(sheet) && /information-circle-outline/.test(sheet), 'bilgi eylemi yok');
  // Otomatik mod (null) seçeneği.
  assert(/handleSelect\(null\)/.test(sheet), 'otomatik mod (null) seçeneği yok');
  // Reduce Motion / tema: modal slide + tema renkleri (sabit arka plan yok).
  assert(/useAppTheme\(\)/.test(sheet), 'tema tokenları kullanılmıyor');
  // Tema: sabit hex renk YOK (backdrop gölgesi hariç). Hata/retry metni bütün
  // temalarda okunabilir kalsın diye `colors.dangerText` (danger DEĞİL) kullanır.
  assert(/retryText: \{ color: colors\.dangerText/.test(sheet), 'retry metni okunabilir dangerText tokenı kullanmalı');
  assert(!/retryText: \{ color: colors\.danger,/.test(sheet), 'retry metni doygun danger tokenını kullanmamalı');
  // Anlam yalnız RENGE bağlı değildir: retry göstergesinde ikon + metin var.
  assert(/const retryTag = \([\s\S]*?name="refresh"[\s\S]*?rewards\.roseSheet\.retry/.test(sheet),
    'retry göstergesi renk-dışı sinyal (ikon+metin) içermiyor');
  const hexes = [...sheet.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
  assert(hexes.length === 0, `sheet sabit hex renk içeriyor: ${hexes.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 9. KONTRAST (yürütülebilir): dangerText, bütün tema varyantlarında `surface`
//    üzerinde normal metin için ≥4.5:1 (WCAG AA). Değerler theme.ts'ten okunur.
// ---------------------------------------------------------------------------
check('9. dangerText her temada surface üzerinde ≥4.5:1 kontrast sağlar', () => {
  const theme = src('constants/theme.ts');
  const hexToRgb = (hex) => {
    const n = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  };
  const relLum = (hex) =>
    hexToRgb(hex)
      .map((c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      })
      .reduce((acc, v, i) => acc + [0.2126, 0.7152, 0.0722][i] * v, 0);
  const contrast = (a, b) => {
    const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  // theme.ts'ten bir bloğun (light/dark) belirli bir token değerini çeker.
  const tokenIn = (blockName, token) => {
    const block = new RegExp(`const ${blockName} = \\{([\\s\\S]*?)\\n\\};`).exec(theme)?.[1] ?? '';
    return new RegExp(`${token}:\\s*'(#[0-9a-fA-F]{3,8})'`).exec(block)?.[1];
  };
  // warmLight/softDark override bloklarından (spread + override) token çeker.
  const overrideIn = (blockName, token) => {
    const block = new RegExp(`${blockName}:\\s*\\{([\\s\\S]*?)\\n  \\}`).exec(theme)?.[1] ?? '';
    return new RegExp(`${token}:\\s*'(#[0-9a-fA-F]{3,8})'`).exec(block)?.[1];
  };
  const lightDanger = tokenIn('lightColors', 'dangerText');
  const darkDanger = tokenIn('darkColors', 'dangerText');
  assert(lightDanger && darkDanger, 'dangerText tokenı light/dark bloklarında yok');
  // Her varyantın `surface` değeri (override yoksa temel bloktan gelir).
  const variants = [
    ['light', tokenIn('lightColors', 'surface'), lightDanger],
    ['dark', tokenIn('darkColors', 'surface'), darkDanger],
    // warmLight `surface`'i override eder; dangerText'i etmez → light değeri geçerli.
    ['warmLight', overrideIn('warmLight', 'surface'), lightDanger],
    // softDark `surface`'i override eder; dangerText'i etmez → dark değeri geçerli.
    ['softDark', overrideIn('softDark', 'surface'), darkDanger],
  ];
  for (const [name, surface, textColor] of variants) {
    assert(surface && textColor, `${name}: surface/dangerText çözülemedi`);
    const ratio = contrast(textColor, surface);
    assert(ratio >= 4.5, `${name}: dangerText ${textColor} / surface ${surface} kontrast ${ratio.toFixed(2)} < 4.5`);
  }
});

// ---------------------------------------------------------------------------
// 10. Sözleşme sürüm güvenliği: friend RPC yükseltmesi AYRI, eklemeli migration.
//     Uygulanmış 20260910 SKALER kalır (düzenlenmez); tablo sözleşmesi 20260911.
// ---------------------------------------------------------------------------
check('10. get_friend_level_rose yükseltmesi ayrı eklemeli migration ile', () => {
  // Eski (uygulanmış olabilecek) migration friend RPC'yi SKALER bırakır: bir
  // yerelde/DB'de zaten uygulanmışsa düzenlemek DB'yi güncellemez.
  // friend RPC DDL bloğu (create ... $$ ... $$;) skaler olmalı.
  const friendCreate = /create or replace function public\.get_friend_level_rose[\s\S]*?\$\$;/.exec(mig)?.[0] ?? '';
  assert(/returns text/.test(friendCreate), 'mig 20260910 friend RPC skaler (returns text) kalmalı');
  assert(!/returns table \(selected_level_rose/.test(friendCreate),
    'mig 20260910 tabloya YÜKSELTİLMEMELİ (uygulanmış migration düzenlenmez)');
  // Yükseltme AYRI migration'dadır: drop-first + returns table + yalnız
  // authenticated execute; gizlilik yüzeyi (are_friends) genişlemez.
  assert(/drop function if exists public\.get_friend_level_rose\(uuid\)/.test(migUpgrade), 'yükseltme drop-first yapmıyor');
  assert(/returns table \(selected_level_rose text\)/.test(migUpgrade), 'yükseltme returns table sözleşmesi değil');
  assert(/are_friends\(\(select auth\.uid\(\)\), target_user_id\)/.test(migUpgrade), 'yükseltme are_friends kapısını korumuyor');
  assert(/grant execute on function public\.get_friend_level_rose\(uuid\) to authenticated/.test(migUpgrade), 'authenticated execute grant yok');
  assert(/revoke all on function public\.get_friend_level_rose\(uuid\) from anon/.test(migUpgrade), 'anon revoke yok');
  // Eklemeli: XP/roses/seviye/RP tablolarına DOKUNMAZ (yalnız fonksiyon imzası).
  assert(!/lifetime_xp|rose_balance|current_rp|drop table|delete from/i.test(migUpgrade), 'yükseltme veri/şema tablolarına dokunuyor');
});

// ---------------------------------------------------------------------------
// 11. GÖRSEL: dar (375 pt) düzende kilitli etiket TAŞMAZ (kısa "Lv N"); kilit
//     a11y'de tam kalır; kilitli gül opaklığı TEMA BAZLIDIR (açık > koyu).
// ---------------------------------------------------------------------------
check('11. Kilitli etiket kısa + a11y tam; kilitli gül opaklığı tema bazlı', () => {
  // Görünür etiket HER ZAMAN kısa "Lv N" formudur (kilitlide de) → 5 sütunda taşmaz.
  assert(/const visualLabel = t\('rewards\.roseSheet\.levelLabel'/.test(sheet),
    'görünür etiket kısa levelLabel formunu kullanmıyor');
  // Görünür metin kısa visualLabel'ı gösterir ve tek satıra sınırlanır (taşma yok).
  assert(/\{visualLabel\}\s*<\/Text>/.test(sheet), 'görünür Text kısa visualLabel göstermiyor');
  assert(/numberOfLines=\{1\}/.test(sheet), 'kilitli/açık etiket tek satıra sınırlanmamış');
  // Kilitli öğe GÖRÜNÜR metinde uzun "Locked · Lv N"yi ÇİZMEZ (yalnız a11y'de).
  assert(!/\{label\}/.test(sheet), 'eski birleşik label görünür metinde hâlâ kullanılıyor');
  // ERİŞİLEBİLİRLİK etiketi kilitlide TAM kalır (lockedLabel).
  assert(/const a11yLabel = unlocked\s*\?\s*visualLabel\s*:\s*t\('rewards\.roseSheet\.lockedLabel'/.test(sheet),
    'kilitli a11y etiketi tam "Locked · Lv N" değil');
  assert(/accessibilityLabel=\{a11yLabel\}/.test(sheet), 'a11y etiketi bağlanmıyor');
  // Locale: kısa ve tam formlar ayrı ve mevcut.
  for (const loc of [localeEn, localeTr]) {
    assert(/levelLabel: '(Lv|Sv) \{level\}'/.test(loc), 'kısa levelLabel formu yok');
    assert(/lockedLabel: '(Locked|Kilitli) · (Lv|Sv) \{level\}'/.test(loc), 'tam lockedLabel formu yok');
  }
  // TEMA BAZLI kilitli opaklık: açık > koyu (açık temada gül görünür kalsın).
  const m = /const lockedDimOpacity = isDark \? ([0-9.]+) : ([0-9.]+)/.exec(sheet);
  assert(m, 'tema bazlı lockedDimOpacity yok');
  const [darkOp, lightOp] = [parseFloat(m[1]), parseFloat(m[2])];
  assert(lightOp > darkOp, `açık tema opaklığı (${lightOp}) koyudan (${darkOp}) büyük olmalı`);
  assert(lightOp >= 0.5 && lightOp <= 0.75, `açık tema opaklığı ölçülü olmalı (${lightOp})`);
  assert(darkOp >= 0.3 && darkOp <= 0.45, `koyu tema fazla parlaklaştırılmamalı (${darkOp})`);
  // Emblem tema bazlı opaklığı UYGULAR ve asset rengini korur (tint yok).
  assert(/dimOpacity=\{lockedDimOpacity\}/.test(sheet), 'emblem tema bazlı opaklığı almıyor');
  assert(/opacity: dimmed \? \(dimOpacity \?\? 0\.35\) : 1/.test(emblem), 'emblem dimOpacity uygulamıyor');
  assert(!/tintColor|tint:/.test(emblem), 'emblem tint uyguluyor (asset rengi korunmalı)');
});

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Seviye gülü seçimi harness: ${passed} kontrol geçti (migration + servis + context + sheet + profil).`);
console.log('  (Statik denetim — gerçek RPC davranışı supabase/tests/level_rose_selection_isolated.sql ile.)');
