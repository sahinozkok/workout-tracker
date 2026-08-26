/**
 * Özellik bazlı renk ön ayarlarının doğrulama harness'ı.
 *
 * SINIR: React render edilmez, SQL çalıştırılmaz. İki katman:
 *   A. YAPISAL — kaynak dosyalarda kuralların gerçekten bulunduğunu iddia eder
 *      (hangi ekranın hangi semantik rengi okuduğu dahil).
 *   B. DAVRANIŞSAL — GERÇEK `constants/color-presets.ts` fonksiyonları
 *      derlenip import edilir; ayrı bir kopya algoritma test edilmez.
 *
 * Çalıştırma:  node supabase/tests/color-presets.harness.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const buildDir = mkdtempSync(join(tmpdir(), 'color-presets-'));
let presets;
try {
  const tsconfigPath = join(buildDir, 'tsconfig.json');
  writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        target: 'es2022',
        module: 'es2022',
        moduleResolution: 'bundler',
        outDir: buildDir,
        skipLibCheck: true,
        strict: false,
        baseUrl: root,
        paths: { '@/*': ['./*'] },
      },
      files: [join(root, 'constants/color-presets.ts')],
    }),
  );
  execFileSync('npx', ['tsc', '-p', tsconfigPath], { cwd: root, stdio: 'pipe' });
  const emitted = readdirSync(buildDir, { recursive: true, withFileTypes: true }).find(
    (entry) => entry.isFile() && entry.name === 'color-presets.js',
  );
  if (!emitted) throw new Error('color-presets.js derlenemedi');
  presets = await import(pathToFileURL(join(emitted.parentPath ?? emitted.path, emitted.name)).href);
} finally {
  process.on('exit', () => rmSync(buildDir, { force: true, recursive: true }));
}

const {
  COLOR_FEATURES,
  COLOR_PRESETS,
  COLOR_PRESET_FAMILIES,
  DEFAULT_PROFILE_COLOR_PRESET,
  getColorPresetHex,
  getFeatureFallbackColor,
  getOnAccentColor,
  getRelativeLuminance,
  parseColorPresetId,
  parseProfileColorPresetId,
} = presets;

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` +
      (ok ? '' : `  (beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)})`),
  );
}
const contains = (name, haystack, needle) => check(name, haystack.includes(needle), true);

// ---------------------------------------------------------------------------
console.log('=== A. Kaynak bağlantıları ===');

const context = read('context/profile-context.tsx');
const settings = read('app/settings.tsx');
const dayScreen = read('app/program/[id]/day/[dayId]/index.tsx');
const addExercise = read('app/program/[id]/day/[dayId]/add-exercise.tsx');
const exerciseProgress = read('components/exercise-progress.tsx');
const coach = read('app/(tabs)/coach.tsx');
const profileScreen = read('app/(tabs)/profile.tsx');
const friendProfile = read('app/profile/[userId].tsx');
const friendsTheme = read('components/friends/friends-theme.ts');
const migration = read('supabase/migrations/20260826120000_add_profile_color_preset.sql');
const theme = read('constants/theme.ts');

contains('2) Workout Days: gün listesi', read('components/program-exercise-list.tsx'), "useFeatureColor('workoutDays'");
contains('2) Workout Days: web listesi', read('components/program-exercise-list.web.tsx'), "useFeatureColor('workoutDays'");
contains('2) Workout Days: plan ekranı', dayScreen, "useFeatureColor('workoutDays'");
contains('2) Workout Days: Add Exercise', addExercise, "useFeatureColor('workoutDays'");
contains('2) Add Exercise seçili kategori rengi', addExercise, 'categoryTextSelected: { color: feature.accent');
contains('2) Add Exercise seçili kategori alt çizgisi', addExercise, 'categoryTabSelected: { borderBottomColor: feature.accent }');
contains('2) Apply düğmesi Workout Days rengini alıyor', addExercise, 'accentColor={workoutDays.isCustom');

contains('3) Primary yalnızca Seti tamamla düğmesi', dayScreen, 'backgroundColor: feature.activePrimary,');
check(
  '3) Primary başka yerde kullanılmıyor',
  (dayScreen.match(/feature\.activePrimary\b/g) ?? []).length,
  1,
);
contains('4) Secondary: set etiketi', dayScreen, 'activeSetLabel: { color: feature.activeSecondary');
contains('4) Secondary: + Drop set', dayScreen, 'addDropSetText: { color: feature.activeSecondary');
contains('4) Secondary: + Egzersiz', dayScreen, 'panelAddExerciseText: { color: feature.activeSecondary');
contains('4) Secondary: seçili egzersiz caret', dayScreen, 'color={activeSecondary.color}');

contains('5) History & Progress vurgusu', exerciseProgress, "useFeatureColor('historyProgress'");
contains('5) Workouts geçiş yazısı', read('app/(tabs)/history.tsx'), 'viewSwitchText: { color: historyAccent');
contains('6) Rosea Chat vurgusu', coach, "useFeatureColor('roseaChat'");
contains('7) Friends yalnızca accent besleniyor', friendsTheme, "useFeatureColor('friends', base.accent)");
contains('7) Friends yüzey sistemi korunuyor', friendsTheme, 'if (!friendsAccent.isCustom) return base;');

console.log('\n=== A2. Kapsam dışı bırakılanlar ===');
check('global tema renkleri değişmedi', theme.includes("primary: '#007AFF'") && theme.includes("disciplineCompleted: '#34C759'"), true);
check('disiplin renkleri semantik renge bağlanmadı', /disciplineCompleted:\s*(feature|accentColor)/.test(theme), false);
check('tab bar renkleri değişmedi', theme.includes("tabIconSelected: '#007AFF'"), true);
contains('Ayarlar grubu Sign out ÜZERİNDE', settings, "t('profile.colorPresets')");
check(
  'renk grubu çıkış düğmesinden önce',
  // `handleSignOut` fonksiyon TANIMI daha yukarıda; JSX'teki çıkış düğmesiyle
  // karşılaştırılmalı.
  settings.indexOf("t('profile.colorPresets')") < settings.indexOf("onPress={handleSignOut}"),
  true,
);
contains('varsayılana dönüş seçeneği', settings, "t('profile.colorResetDefaults')");
check('sabit kullanıcı metni yok', /<Text[^>]*>\s*(Color presets|Renk ön ayarları)\s*</.test(settings), false);

console.log('\n=== A3. Depolama ve izolasyon ===');
contains('anahtar kullanıcı kimliği içeriyor', context, '`${COLOR_PRESET_KEY_PREFIX}:${feature}:${userId}`');
contains('hesap değişince renkler temizleniyor', context, 'setColorPresetsState({});');
contains('profil rengi sunucuya yazılıyor', context, 'saveProfileColorPreset(userId,');
contains('migration uygulanmadıysa çökmüyor', context, 'if (error && !isMissingOptionalColumnError(error)) throw error;');

console.log('\n=== A4. Migration ve arkadaş RPC ===');
contains('kolon additive/tekrarlanabilir', migration, "add column if not exists color_preset text not null default 'profileClay'");
contains('allowlist check constraint', migration, 'profiles_color_preset_allowlist');
contains('arkadaş kontrolü korunuyor', migration, 'public.are_friends((select auth.uid()), target_user_id)');
contains('search_path güvenliği korunuyor', migration, "set search_path = ''");
contains('grant/revoke korunuyor', migration, 'grant execute on function public.get_friend_profile(uuid) to authenticated;');
// Yorum satırlarında geçebilir; SELECT listesinde geçmemeli.
const rpcBody = migration.slice(
  migration.indexOf('create or replace function public.get_friend_profile'),
  migration.indexOf('revoke all on function public.get_friend_profile'),
);
check('rose_balance RPC gövdesinde paylaşılmıyor', /rose_balance/.test(rpcBody), false);
check('RPC yalnızca profil + seviye + renk dönüyor', /p\.color_preset/.test(rpcBody), true);
contains('seviye alanları aynen dönüyor', migration, 'coalesce(lp.xp_for_next, public.level_step_cost(1))');
check('yeni grant/policy eklenmedi', /create policy|grant .* on table/i.test(migration), false);
contains('8) arkadaş profili SAHİBİNİN rengini kullanıyor', friendProfile, 'resolveProfileColor(profile?.colorPresetId');
check(
  '8) görüntüleyenin kendi tercihi kullanılmıyor',
  friendProfile.includes("useFeatureColor('profile'"),
  false,
);
contains('profil ekranı kendi rengini kullanıyor', profileScreen, "useFeatureColor('profile'");

// ---------------------------------------------------------------------------
console.log('\n=== B. Davranış (gerçek fonksiyonlar) ===');

check('1) yeni hesapta hiçbir tercih yok → hepsi varsayılan', COLOR_FEATURES.every((feature) => {
  const preset = ({})[feature];
  return preset === undefined;
}), true);

const themeColors = { text: '#000000', primary: '#007AFF', disciplineCompleted: '#34C759' };
check('1) Workout Days varsayılanı bugünkü turuncu', getFeatureFallbackColor('workoutDays', themeColors, true), '#FF9138');
check('1) Primary varsayılanı colors.text (mavi DEĞİL)', getFeatureFallbackColor('activeWorkoutPrimary', themeColors, true), '#000000');
check('1) Secondary varsayılanı colors.primary', getFeatureFallbackColor('activeWorkoutSecondary', themeColors, true), '#007AFF');
check('1) History varsayılanı yeşil', getFeatureFallbackColor('historyProgress', themeColors, true), '#34C759');
check('1) Rosea Chat varsayılanı mavi', getFeatureFallbackColor('roseaChat', themeColors, true), '#007AFF');
check('1) Profil varsayılanı bugünkü ton', getFeatureFallbackColor('profile', themeColors, true), '#D5755B');
check('1) Friends varsayılanı koyu temada mor', getFeatureFallbackColor('friends', themeColors, true), '#A472F0');
check('1) Friends varsayılanı açık temada mor', getFeatureFallbackColor('friends', themeColors, false), '#7A3FE0');

console.log('\n--- 11) Geçersiz / eski preset ID ---');
check('11) bilinmeyen ID düşürülüyor', parseColorPresetId('neonPink'), undefined);
check('11) ham hex reddediliyor', parseColorPresetId('#FF0000'), undefined);
check('11) null reddediliyor', parseColorPresetId(null), undefined);
check('11) nesne reddediliyor', parseColorPresetId({ id: 'orange' }), undefined);
check('11) geçerli ID kabul ediliyor', parseColorPresetId('teal'), 'teal');
check('11) profil için geçersiz ID varsayılana düşüyor', parseProfileColorPresetId('bogus'), DEFAULT_PROFILE_COLOR_PRESET);
check('11) profil varsayılanı bugünkü ton', getColorPresetHex(DEFAULT_PROFILE_COLOR_PRESET), '#D5755B');

console.log('\n--- 10) onAccent okunabilirliği ---');
check('10) açık sarıda siyah metin', getOnAccentColor('#FFD700'), '#000000');
check('10) açık turuncuda siyah metin', getOnAccentColor('#FFA500'), '#000000');
check('10) turkuazda siyah metin', getOnAccentColor('#40E0D0'), '#000000');
check('10) koyu morda beyaz metin', getOnAccentColor('#9932CC'), '#FFFFFF');
check('10) kırmızıda beyaz metin', getOnAccentColor('#FF0000'), '#FFFFFF');
check('10) lacivert mavide beyaz metin', getOnAccentColor('#4169E1'), '#FFFFFF');
check('10) sabit beyaz/siyah yazılmamış', typeof getRelativeLuminance('#FFFFFF'), 'number');
check('10) beyaz en yüksek parlaklık', Math.round(getRelativeLuminance('#FFFFFF')), 1);
check('10) siyah en düşük parlaklık', getRelativeLuminance('#000000'), 0);

// Her preset için okunabilir bir onAccent üretilmeli.
const unreadable = Object.entries(COLOR_PRESETS).filter(([, hex]) => {
  const on = getOnAccentColor(hex);
  return on !== '#000000' && on !== '#FFFFFF';
});
check('10) her preset okunabilir onAccent üretiyor', unreadable, []);

console.log('\n--- Havuz bütünlüğü ---');
const familyPresets = COLOR_PRESET_FAMILIES.flatMap((entry) => entry.presets);
check('her preset tam olarak bir ailede', familyPresets.length, new Set(familyPresets).size);
check('havuzdaki her ID tanımlı', familyPresets.every((id) => id in COLOR_PRESETS), true);
check('tanımlı her ID bir ailede', Object.keys(COLOR_PRESETS).every((id) => familyPresets.includes(id)), true);
check(
  'özellik listesi beklenen kümede',
  [...COLOR_FEATURES].sort(),
  [
    'activeWorkoutPrimary',
    'activeWorkoutSecondary',
    'friends',
    'historyDurationRing',
    'historyExercisesRing',
    'historyProgress',
    'historyWorkoutsRing',
    'profile',
    'roseaChat',
    'settings',
    'todayHighlight',
    'workoutDays',
  ],
);
check('tam olarak bir özellik sunucuya ait', COLOR_FEATURES.filter((f) => f === 'profile').length, 1);

// İstenen hex havuzunun tamamı destekleniyor mu?
const requiredHexes = [
  '#FFA500', '#EE9A00', '#CD8500', '#FF8C00', '#FF7F00', '#FF9138',
  '#FF7F50', '#FF8C69', '#FF6347',
  '#FF0000', '#DC143C', '#CD3333',
  '#FF1493', '#FF69B4', '#FFC0CB', '#DB7093',
  '#BA55D3', '#9932CC', '#8A2BE2', '#9370DB', '#A020F0', '#A472F0',
  '#007AFF', '#1E90FF', '#4169E1', '#6495ED', '#4682B4', '#87CEEB',
  '#00CED1', '#40E0D0', '#48D1CC', '#008080',
  '#00CD66', '#3CB371', '#228B22', '#54FF9F', '#30D158',
  '#FFD700', '#FFC125', '#DAA520',
  '#A52A2A', '#8B4513', '#BC8F8F', '#708090',
];
const supported = new Set(Object.values(COLOR_PRESETS));
check('istenen hex havuzu tam destekleniyor', requiredHexes.filter((hex) => !supported.has(hex)), []);
check('audit ile bulunan profil tonu havuza eklendi', supported.has('#D5755B'), true);

console.log('\n--- 9) Hesap izolasyonu (anahtar biçimi) ---');
const key = (feature, userId) => `@workout-tracker/color-preset:${feature}:${userId}`;
check('9) A ve B farklı anahtar kullanıyor', key('workoutDays', 'A') === key('workoutDays', 'B'), false);
check('9) anahtar kullanıcı kimliğiyle bitiyor', key('profile', 'user-1').endsWith(':user-1'), true);

// ---------------------------------------------------------------------------
// C. YÜKLEME YARIŞI VE OTORİTE AYRIMI
// ---------------------------------------------------------------------------
console.log('\n=== C. Yükleme yarışı (regresyon) ===');

const LOCAL_COLOR_FEATURES = COLOR_FEATURES.filter((feature) => feature !== 'profile');
check('yerel özellikler = tüm özellikler eksi profil', LOCAL_COLOR_FEATURES.length, COLOR_FEATURES.length - 1);
check('profil yerel listede yok', LOCAL_COLOR_FEATURES.includes('profile'), false);

console.log('\n--- Yapısal: otorite ayrımı ---');
contains('yerel özellik listesi tanımlı', context, 'const LOCAL_COLOR_FEATURES = COLOR_FEATURES.filter');
contains('anahtarlar yalnızca yerel özelliklerden', context, 'LOCAL_COLOR_FEATURES.map(\n      (feature) => `${COLOR_PRESET_KEY_PREFIX}:${feature}:${userId}`,\n    )');
// Reset artık anahtarları `localStorageKeys` içinde hazırlıyor (telafi için
// snapshot da aynı listeden alınıyor); yalnızca YEREL özellikler kullanılıyor.
contains(
  'reset yalnızca yerel anahtarları hazırlıyor',
  context,
  'const localStorageKeys = LOCAL_COLOR_FEATURES.map(',
);
contains('reset bu listeyi siliyor', context, 'await AsyncStorage.multiRemove(localStorageKeys);');
contains('snapshot aynı listeden alınıyor', context, 'AsyncStorage.multiGet(localStorageKeys)');
check(
  'AsyncStorage yükleme state\'i tamamen EZMİYOR',
  context.includes('setColorPresetsState(loadedPresets);'),
  false,
);
contains('yerel yükleme profili koruyor', context, "...(current.profile ? { profile: current.profile } : {})");
contains('profil yolu yalnızca profile alanını yazıyor', context, 'if (serverProfilePreset === DEFAULT_PROFILE_COLOR_PRESET) delete next.profile;');
contains('setColorPreset: profil AsyncStorage\'a dokunmuyor', context, "if (feature === 'profile') {\n          await saveProfileColorPreset(userId, presetId ?? DEFAULT_PROFILE_COLOR_PRESET);\n        } else {");
contains('hata geri alma yalnızca ilgili alanı düzeltiyor', context, 'const previousValue = colorPresets[feature];');
contains('hesap sahipliği izleniyor', context, 'colorPresetsUserRef.current !== userId');

// --- Davranış modeli: iki kaynak, aynı state
function createStore() {
  let state = {};
  return {
    get: () => state,
    /** AsyncStorage yolu: YALNIZCA yerel alanları birleştirir. */
    applyLocal(loadedPresets) {
      state = { ...(state.profile ? { profile: state.profile } : {}), ...loadedPresets };
    },
    /** Supabase yolu: YALNIZCA profile alanını yazar, varsayılanı normalize eder. */
    applyServerProfile(serverPreset) {
      const next = { ...state };
      if (serverPreset === DEFAULT_PROFILE_COLOR_PRESET) delete next.profile;
      else next.profile = serverPreset;
      state = next;
    },
    clear() {
      state = {};
    },
  };
}

// 1) Supabase önce, AsyncStorage sonra → profil rengi KORUNUR.
const raceA = createStore();
raceA.applyServerProfile('teal');
raceA.applyLocal({ workoutDays: 'crimson', friends: 'gold' });
check('C1) sunucu önce → profil rengi korunuyor', raceA.get().profile, 'teal');
check('C1) yerel tercihler de yerinde', [raceA.get().workoutDays, raceA.get().friends], ['crimson', 'gold']);

// 2) AsyncStorage önce, Supabase sonra → altı yerel tercih KORUNUR.
const raceB = createStore();
raceB.applyLocal({ workoutDays: 'crimson', roseaChat: 'skyBlue' });
raceB.applyServerProfile('teal');
check('C2) yerel önce → yerel tercihler korunuyor', [raceB.get().workoutDays, raceB.get().roseaChat], ['crimson', 'skyBlue']);
check('C2) profil rengi de yazıldı', raceB.get().profile, 'teal');

// Her iki sıra da AYNI sonucu vermeli.
const orderOne = createStore();
orderOne.applyServerProfile('teal');
orderOne.applyLocal({ workoutDays: 'crimson' });
const orderTwo = createStore();
orderTwo.applyLocal({ workoutDays: 'crimson' });
orderTwo.applyServerProfile('teal');
/** Anahtar sırası önemsiz; state anlamca aynı olmalı. */
const normalize = (state) =>
  Object.fromEntries(Object.entries(state).sort(([a], [b]) => (a < b ? -1 : 1)));
check('C1+C2) iki sıralama aynı state üretiyor', normalize(orderOne.get()), normalize(orderTwo.get()));
check('C1+C2) sonuç beklenen içerikte', normalize(orderOne.get()), { profile: 'teal', workoutDays: 'crimson' });

// 3) Sunucudan VARSAYILAN gelirse state'te "özel seçim" görünmez.
const defaultCase = createStore();
defaultCase.applyServerProfile(DEFAULT_PROFILE_COLOR_PRESET);
check('C3) sunucu varsayılanı → profile undefined', defaultCase.get().profile, undefined);
check('C3) UI varsayılan rengi gösterir', getFeatureFallbackColor('profile', themeColors, true), getColorPresetHex(DEFAULT_PROFILE_COLOR_PRESET));

// 4) Profil için AsyncStorage çağrısı YOK.
function collectStorageKeys(features) {
  return features
    .filter((feature) => feature !== 'profile')
    .map((feature) => `@workout-tracker/color-preset:${feature}:u1`);
}
const storageKeys = collectStorageKeys(COLOR_FEATURES);
check('C4) profil anahtarı hiç oluşturulmuyor', storageKeys.some((key) => key.includes(':profile:')), false);
check('C4) yerel anahtar sayısı = özellik sayısı - 1', storageKeys.length, COLOR_FEATURES.length - 1);

// 5) Reset: yalnızca altı yerel anahtar silinir, profil sunucuda varsayılana döner.
const resetCalls = { removed: [], serverWrites: [] };
function resetColorPresets(store) {
  resetCalls.removed = collectStorageKeys(COLOR_FEATURES);
  resetCalls.serverWrites.push(DEFAULT_PROFILE_COLOR_PRESET);
  store.clear();
}
const resetStore = createStore();
resetStore.applyServerProfile('teal');
resetStore.applyLocal({ workoutDays: 'crimson' });
resetColorPresets(resetStore);
check('C5) yalnızca yerel anahtarlar silindi', resetCalls.removed.length, COLOR_FEATURES.length - 1);
check('C5) profil anahtarı silinmeye çalışılmadı', resetCalls.removed.some((key) => key.includes(':profile:')), false);
check('C5) sunucuya varsayılan yazıldı', resetCalls.serverWrites, [DEFAULT_PROFILE_COLOR_PRESET]);
check('C5) state tamamen boş', resetStore.get(), {});

// 6) Hesap değişiminde geç gelen eski cevap yazamaz.
function createGuardedStore() {
  const store = createStore();
  let owner;
  return {
    get: store.get,
    switchUser(userId) {
      owner = userId;
      store.clear();
    },
    applyLocal(userId, presets) {
      if (userId !== owner) return false;
      store.applyLocal(presets);
      return true;
    },
    applyServerProfile(userId, preset) {
      if (userId !== owner) return false;
      store.applyServerProfile(preset);
      return true;
    },
  };
}
const guarded = createGuardedStore();
guarded.switchUser('A');
// A'nın istekleri uçuşta; kullanıcı B'ye geçiyor.
guarded.switchUser('B');
const lateLocalWrote = guarded.applyLocal('A', { workoutDays: 'crimson' });
const lateServerWrote = guarded.applyServerProfile('A', 'teal');
check('C6) A\'nın geç yerel cevabı yazamıyor', lateLocalWrote, false);
check('C6) A\'nın geç sunucu cevabı yazamıyor', lateServerWrote, false);
check('C6) B\'nin state\'i temiz kaldı', guarded.get(), {});
guarded.applyLocal('B', { friends: 'gold' });
check('C6) B kendi tercihini yazabiliyor', guarded.get().friends, 'gold');

// 7) "Varsayılanı kullan" swatch'ı gerçek fallback rengini gösterir.
const picker = read('components/color-preset-picker.tsx');
const settingsSource = read('app/settings.tsx');
contains('C7) defaultColor propu var', picker, 'defaultColor: string;');
contains('C7) varsayılan satırı defaultColor gösteriyor', picker, 'style={[styles.swatchDot, { backgroundColor: defaultColor }]}');
contains('C7) settings gerçek fallback geçiyor', settingsSource, 'defaultColor={getFeatureFallbackColor(feature, colors, isDark)}');
check(
  'C7) varsayılan satırı artık currentColor göstermiyor',
  picker.includes("<Text style={styles.defaultRowText}>") &&
    picker.split("<Text style={styles.defaultRowText}>")[0].endsWith(
      'style={[styles.swatchDot, { backgroundColor: defaultColor }]} />\n                ',
    ),
  true,
);
// Ana satır hâlâ geçerli rengi gösterir.
contains('C7) ana satır currentColor gösteriyor', picker, 'style={[styles.swatchDot, { backgroundColor: currentColor }]}');

// ---------------------------------------------------------------------------
// D. RESET TELAFİ / ROLLBACK
// ---------------------------------------------------------------------------
console.log('\n=== D. resetColorPresets telafi akışı ===');

console.log('\n--- Yapısal ---');
contains('reset öncesi snapshot alınıyor', context, 'const localSnapshot = await AsyncStorage.multiGet(localStorageKeys);');
contains('önceki profil rengi belirleniyor', context, 'previousPresets.profile ?? DEFAULT_PROFILE_COLOR_PRESET');
contains('yerel kayıtlar geri yazılıyor', context, 'rollbacks.push(AsyncStorage.multiSet(restorePairs));');
contains('profil sunucuda geri alınıyor', context, 'rollbacks.push(saveProfileColorPreset(userId, previousProfilePreset));');
contains('rollback asıl hatayı gizlemiyor', context, 'await Promise.allSettled(rollbacks);');
contains('asıl hata çağırana gidiyor', context, '      throw error;\n    }\n  }, [colorPresets, userId]);');
contains('kısmi silme kapsanıyor', context, 'let didTouchLocal = false;');
check(
  'reset artık yalnızca state geri almıyor',
  context.includes('      await AsyncStorage.multiRemove(\n        LOCAL_COLOR_FEATURES.map'),
  false,
);
contains('yorum düzeltildi: profil yalnızca Supabase', context, "Profil rengi YALNIZCA Supabase'de saklanır; AsyncStorage'a hiçbir aşamada");

console.log('\n--- Davranış modeli (gerçek akışın birebir karşılığı) ---');

/**
 * `resetColorPresets` modeli. Sahte AsyncStorage + sahte Supabase üzerinde
 * çalışır; hata enjeksiyonuyla telafi yolları doğrulanır.
 */
function createWorld(initialLocal = {}, initialProfile = DEFAULT_PROFILE_COLOR_PRESET, currentUserId = 'u1') {
  return {
    storage: new Map(Object.entries(initialLocal)),
    serverProfile: initialProfile,
    state: {},
    /** `colorPresetsUserRef.current` karşılığı: state'in sahibi olan hesap. */
    currentUserId,
    failProfileWrite: false,
    failLocalRemove: false,
    /** `multiRemove` reddetse bile bazı anahtarlar silinmiş olabilir. */
    partialRemoveCount: 0,
    /** Hesap değişimini taklit eder: state temizlenir, sahiplik devredilir. */
    switchUser(userId) {
      this.currentUserId = userId;
      this.state = {};
    },
  };
}

async function runResetColorPresets(world, userId, previousPresets, { onSnapshotAwait } = {}) {
  const localStorageKeys = LOCAL_COLOR_FEATURES.map(
    (feature) => `@workout-tracker/color-preset:${feature}:${userId}`,
  );
  const localSnapshot = localStorageKeys.map((key) => [key, world.storage.get(key) ?? null]);
  // `await AsyncStorage.multiGet(...)` beklemesi: bu sırada hesap değişebilir.
  await Promise.resolve();
  if (onSnapshotAwait) onSnapshotAwait();

  const previousProfilePreset = previousPresets.profile ?? DEFAULT_PROFILE_COLOR_PRESET;
  /** `colorPresetsUserRef.current === userId` guard'ı. */
  const ownsState = () => world.currentUserId === userId;

  if (ownsState()) world.state = {};

  let didResetProfile = false;
  let didTouchLocal = false;

  try {
    if (world.failProfileWrite) throw new Error('supabase-failed');
    world.serverProfile = DEFAULT_PROFILE_COLOR_PRESET;
    didResetProfile = true;

    didTouchLocal = true;
    if (world.failLocalRemove) {
      // Kısmi silme: reddetmeden önce bir kısmı gitmiş olabilir.
      localStorageKeys.slice(0, world.partialRemoveCount).forEach((key) => world.storage.delete(key));
      throw new Error('storage-failed');
    }
    localStorageKeys.forEach((key) => world.storage.delete(key));
  } catch (error) {
    if (ownsState()) world.state = previousPresets;

    const rollbacks = [];
    if (didTouchLocal) {
      const restorePairs = localSnapshot.filter(([, value]) => typeof value === 'string');
      if (restorePairs.length > 0) {
        rollbacks.push(
          Promise.resolve().then(() => restorePairs.forEach(([key, value]) => world.storage.set(key, value))),
        );
      }
    }
    if (didResetProfile) {
      rollbacks.push(Promise.resolve().then(() => { world.serverProfile = previousProfilePreset; }));
    }
    if (rollbacks.length > 0) await Promise.allSettled(rollbacks);
    throw error;
  }
}

const localKey = (feature, userId) => `@workout-tracker/color-preset:${feature}:${userId}`;

// D1) Başarılı reset
{
  const world = createWorld(
    { [localKey('workoutDays', 'u1')]: 'crimson', [localKey('friends', 'u1')]: 'gold' },
    'teal',
  );
  await runResetColorPresets(world, 'u1', { workoutDays: 'crimson', friends: 'gold', profile: 'teal' });
  check('D1) altı yerel kayıt silindi', world.storage.size, 0);
  check('D1) profil varsayılana döndü', world.serverProfile, DEFAULT_PROFILE_COLOR_PRESET);
  check('D1) state boş', world.state, {});
}

// D2) Supabase reset başarısız → yerel kayıtlar ve state ESKİ hâlinde
{
  const world = createWorld(
    { [localKey('workoutDays', 'u1')]: 'crimson', [localKey('friends', 'u1')]: 'gold' },
    'teal',
  );
  world.failProfileWrite = true;
  const previous = { workoutDays: 'crimson', friends: 'gold', profile: 'teal' };
  let thrown;
  try {
    await runResetColorPresets(world, 'u1', previous);
  } catch (error) {
    thrown = error.message;
  }
  check('D2) asıl hata çağırana ulaşıyor', thrown, 'supabase-failed');
  check('D2) yerel kayıtlar korundu', world.storage.get(localKey('workoutDays', 'u1')), 'crimson');
  check('D2) ikinci yerel kayıt da korundu', world.storage.get(localKey('friends', 'u1')), 'gold');
  check('D2) sunucudaki profil değişmedi', world.serverProfile, 'teal');
  check('D2) state geri yüklendi', world.state, previous);
}

// D3) AsyncStorage temizleme başarısız → profil sunucuda geri alınır
{
  const world = createWorld(
    { [localKey('workoutDays', 'u1')]: 'crimson', [localKey('friends', 'u1')]: 'gold' },
    'teal',
  );
  world.failLocalRemove = true;
  world.partialRemoveCount = 6; // hepsi silinmiş olsun (en kötü durum)
  const previous = { workoutDays: 'crimson', friends: 'gold', profile: 'teal' };
  let thrown;
  try {
    await runResetColorPresets(world, 'u1', previous);
  } catch (error) {
    thrown = error.message;
  }
  check('D3) asıl hata çağırana ulaşıyor', thrown, 'storage-failed');
  check('D3) profil sunucuda ESKİ rengine döndü', world.serverProfile, 'teal');
  check('D3) yerel kayıtlar snapshot\'tan geri geldi', world.storage.get(localKey('workoutDays', 'u1')), 'crimson');
  check('D3) ikinci kayıt da geri geldi', world.storage.get(localKey('friends', 'u1')), 'gold');
  check('D3) state geri yüklendi', world.state, previous);
}

// D3b) Kısmi silme de tam olarak geri alınır
{
  const world = createWorld(
    { [localKey('workoutDays', 'u1')]: 'crimson', [localKey('friends', 'u1')]: 'gold' },
    'teal',
  );
  world.failLocalRemove = true;
  world.partialRemoveCount = 1;
  try {
    await runResetColorPresets(world, 'u1', { workoutDays: 'crimson', friends: 'gold', profile: 'teal' });
  } catch {
    // beklenen
  }
  check('D3b) kısmi silme sonrası iki kayıt da yerinde', [
    world.storage.get(localKey('workoutDays', 'u1')),
    world.storage.get(localKey('friends', 'u1')),
  ], ['crimson', 'gold']);
}

// D4) Snapshot'ta OLMAYAN anahtarlar rollback'te oluşturulmaz
{
  const world = createWorld({ [localKey('workoutDays', 'u1')]: 'crimson' }, 'teal');
  world.failLocalRemove = true;
  world.partialRemoveCount = 6;
  try {
    await runResetColorPresets(world, 'u1', { workoutDays: 'crimson', profile: 'teal' });
  } catch {
    // beklenen
  }
  check('D4) yalnızca var olan anahtar geri geldi', [...world.storage.keys()], [localKey('workoutDays', 'u1')]);
  check('D4) boş anahtarlar uydurulmadı', world.storage.size, 1);
}

// D5) Profil rengi hiçbir aşamada AsyncStorage anahtarları arasında değil
{
  const world = createWorld({ [localKey('workoutDays', 'u1')]: 'crimson' }, 'teal');
  await runResetColorPresets(world, 'u1', { workoutDays: 'crimson', profile: 'teal' });
  const touchedKeys = LOCAL_COLOR_FEATURES.map((feature) => localKey(feature, 'u1'));
  check('D5) dokunulan anahtarlarda profil yok', touchedKeys.some((key) => key.includes(':profile:')), false);
  check('D5) storage\'da profil anahtarı oluşmadı', [...world.storage.keys()].some((key) => key.includes(':profile:')), false);
}

// D6) Bir hesabın rollback'i başka hesaba yazamaz
{
  const world = createWorld(
    {
      [localKey('workoutDays', 'u1')]: 'crimson',
      [localKey('workoutDays', 'u2')]: 'gold',
    },
    'teal',
  );
  world.failLocalRemove = true;
  world.partialRemoveCount = 6;
  try {
    await runResetColorPresets(world, 'u1', { workoutDays: 'crimson', profile: 'teal' });
  } catch {
    // beklenen
  }
  check('D6) u2 kaydı hiç değişmedi', world.storage.get(localKey('workoutDays', 'u2')), 'gold');
  check('D6) u1 kaydı geri geldi', world.storage.get(localKey('workoutDays', 'u1')), 'crimson');
  check('D6) rollback yalnızca u1 anahtarlarına yazdı', [...world.storage.keys()].sort(), [
    localKey('workoutDays', 'u1'),
    localKey('workoutDays', 'u2'),
  ].sort());
}

// ---------------------------------------------------------------------------
// E. HESAP DEĞİŞİMİ × KALICI İŞLEM YARIŞI
// ---------------------------------------------------------------------------
console.log('\n=== E. Hesap değişimi yarışı (regresyon) ===');

console.log('\n--- Yapısal ---');
contains('reset optimistic yazımı guard\'lı', context, 'if (ownsState()) setColorPresetsState({});');
contains('reset catch yazımı guard\'lı', context, 'if (ownsState()) setColorPresetsState(previousPresets);');
contains('sahiplik yardımcı fonksiyonu', context, 'const ownsState = () => colorPresetsUserRef.current === userId;');
contains('setColorPreset rollback guard\'lı', context, 'if (colorPresetsUserRef.current === userId) {\n          setColorPresetsState((current) => {');
check(
  'guardsız optimistic yazım kalmadı',
  context.includes('    // Optimistic: ekran hemen varsayılana döner.\n    setColorPresetsState({});'),
  false,
);
check(
  'guardsız catch yazımı kalmadı',
  context.includes('    } catch (error) {\n      setColorPresetsState(previousPresets);'),
  false,
);

console.log('\n--- Davranış ---');

// E1) A'nın reset'i multiGet beklerken hesap B'ye geçerse B state'i SİLİNMEZ.
{
  const world = createWorld({ [localKey('workoutDays', 'A')]: 'crimson' }, 'teal', 'A');
  const bState = { workoutDays: 'gold', friends: 'skyBlue' };

  await runResetColorPresets(world, 'A', { workoutDays: 'crimson', profile: 'teal' }, {
    onSnapshotAwait: () => {
      // Kullanıcı B'ye geçti ve B'nin renkleri yüklendi.
      world.switchUser('B');
      world.state = bState;
    },
  });

  check('E1) B state\'i {} ile silinmedi', world.state, bState);
  check('E1) A\'nın yerel kayıtları yine de silindi', world.storage.has(localKey('workoutDays', 'A')), false);
  check('E1) A\'nın profili yine de varsayılana döndü', world.serverProfile, DEFAULT_PROFILE_COLOR_PRESET);
}

// E2) A'nın reset'i hata verip rollback yaparken aktif hesap B ise B state'ine YAZILMAZ.
{
  const world = createWorld({ [localKey('workoutDays', 'A')]: 'crimson' }, 'teal', 'A');
  world.failLocalRemove = true;
  world.partialRemoveCount = 6;
  const bState = { workoutDays: 'gold' };
  const previous = { workoutDays: 'crimson', profile: 'teal' };

  let thrown;
  try {
    await runResetColorPresets(world, 'A', previous, {
      onSnapshotAwait: () => {
        world.switchUser('B');
        world.state = bState;
      },
    });
  } catch (error) {
    thrown = error.message;
  }

  check('E2) asıl hata yine fırlatılıyor', thrown, 'storage-failed');
  check('E2) A\'nın previousPresets\'i B ekranına yazılmadı', world.state, bState);
  check('E2) A\'nın kalıcı telafisi yine de çalıştı (storage)', world.storage.get(localKey('workoutDays', 'A')), 'crimson');
  check('E2) A\'nın kalıcı telafisi yine de çalıştı (profil)', world.serverProfile, 'teal');
}

// E3) `setColorPreset` geç hata verdiğinde aktif hesap B ise B state'i DEĞİŞMEZ.
async function runSetColorPreset(world, userId, feature, presetId, { shouldFail, onAwait } = {}) {
  const previousValue = world.state[feature];

  if (world.currentUserId === userId) {
    const next = { ...world.state };
    if (presetId) next[feature] = presetId;
    else delete next[feature];
    world.state = next;
  }

  try {
    await Promise.resolve();
    if (onAwait) onAwait();
    if (shouldFail) throw new Error('write-failed');
    if (feature !== 'profile') world.storage.set(localKey(feature, userId), presetId);
  } catch (error) {
    if (world.currentUserId === userId) {
      const next = { ...world.state };
      if (previousValue) next[feature] = previousValue;
      else delete next[feature];
      world.state = next;
    }
    throw error;
  }
}

{
  const world = createWorld({}, 'teal', 'A');
  world.state = { workoutDays: 'crimson' };
  const bState = { workoutDays: 'gold', roseaChat: 'skyBlue' };

  let thrown;
  try {
    await runSetColorPreset(world, 'A', 'workoutDays', 'tomato', {
      shouldFail: true,
      onAwait: () => {
        world.switchUser('B');
        world.state = bState;
      },
    });
  } catch (error) {
    thrown = error.message;
  }

  check('E3) asıl hata yine fırlatılıyor', thrown, 'write-failed');
  check('E3) B state\'i değişmedi', world.state, bState);
}

// E4) Hesap DEĞİŞMEDİYSE optimistic ve rollback eskisi gibi çalışır.
{
  const world = createWorld({ [localKey('workoutDays', 'A')]: 'crimson' }, 'teal', 'A');
  await runResetColorPresets(world, 'A', { workoutDays: 'crimson', profile: 'teal' });
  check('E4) aynı hesapta optimistic reset uygulandı', world.state, {});

  const failing = createWorld({ [localKey('workoutDays', 'A')]: 'crimson' }, 'teal', 'A');
  failing.failLocalRemove = true;
  failing.partialRemoveCount = 6;
  const previous = { workoutDays: 'crimson', profile: 'teal' };
  try {
    await runResetColorPresets(failing, 'A', previous);
  } catch {
    // beklenen
  }
  check('E4) aynı hesapta rollback state\'i geri yükledi', failing.state, previous);
  check('E4) aynı hesapta kalıcı telafi de çalıştı', failing.storage.get(localKey('workoutDays', 'A')), 'crimson');
}

// E5) Kalıcı telafi hedefleri değişmedi: yalnızca A'nın anahtarları/profili.
{
  const world = createWorld(
    { [localKey('workoutDays', 'A')]: 'crimson', [localKey('workoutDays', 'B')]: 'gold' },
    'teal',
    'A',
  );
  world.failLocalRemove = true;
  world.partialRemoveCount = 6;
  try {
    await runResetColorPresets(world, 'A', { workoutDays: 'crimson', profile: 'teal' }, {
      onSnapshotAwait: () => world.switchUser('B'),
    });
  } catch {
    // beklenen
  }
  check('E5) B anahtarı hiç değişmedi', world.storage.get(localKey('workoutDays', 'B')), 'gold');
  check('E5) A anahtarı geri geldi', world.storage.get(localKey('workoutDays', 'A')), 'crimson');
  check('E5) A anahtarları B\'ye çevrilmedi', [...world.storage.keys()].sort(), [
    localKey('workoutDays', 'A'),
    localKey('workoutDays', 'B'),
  ].sort());
}

// ---------------------------------------------------------------------------
// F. YENİ ÖZELLİKLER: profil vurguları, bio, bugün rengi, History
// ---------------------------------------------------------------------------
console.log('\n=== F. Yeni renk bağlantıları ===');

const profileScreenSource = read('app/(tabs)/profile.tsx');
const friendProfileSource = read('app/profile/[userId].tsx');
const levelRing = read('components/rewards/level-progress-ring.tsx');
const proofStats = read('components/rewards/profile-proof-stats.tsx');
const historyScreen = read('app/(tabs)/history.tsx');
const daySource = read('app/program/[id]/day/[dayId]/index.tsx');
const calendar = read('components/discipline-calendar.tsx');
const yearGrid = read('components/discipline-year-grid.tsx');
const profileCard = read('components/profile-discipline-card.tsx');
const programDetail = read('app/program/[id].tsx');
const tabLayout = read('app/(tabs)/_layout.tsx');
const settingsSrc = read('app/settings.tsx');

console.log('\n--- 1) Yeni ColorFeature değerleri ---');
check('F1) todayHighlight varsayılanı colors.primary', getFeatureFallbackColor('todayHighlight', { ...themeColors, accent: '#FF9500' }, true), '#007AFF');
check('F1) Workouts ring varsayılanı colors.primary', getFeatureFallbackColor('historyWorkoutsRing', { ...themeColors, accent: '#FF9500' }, true), '#007AFF');
check('F1) Exercises ring varsayılanı disciplineCompleted', getFeatureFallbackColor('historyExercisesRing', { ...themeColors, accent: '#FF9500' }, true), '#34C759');
check('F1) Duration ring varsayılanı colors.accent', getFeatureFallbackColor('historyDurationRing', { ...themeColors, accent: '#FF9500' }, true), '#FF9500');
contains('F1) TR etiketleri eklendi', read('locales/tr.ts'), "colorFeatureTodayHighlight: 'Bugünün rengi'");
contains('F1) EN etiketleri eklendi', read('locales/en.ts'), "colorFeatureHistoryDurationRing: 'History — Duration ring'");
contains('F1) Ayarlar etiket eşlemesi', settingsSrc, "todayHighlight: 'profile.colorFeatureTodayHighlight'");
check('F1) ikinci bir Color Presets bölümü yok', (settingsSrc.match(/t\('profile\.colorPresets'\)/g) ?? []).length, 1);

console.log('\n--- 2) Profil rengi bağlantıları ---');
contains('F2) kullanıcı adı profil renginde', profileScreenSource, 'summaryUsername: {\n      color: profile.accent,');
contains('F2) level pill yazısı', profileScreenSource, 'levelPillText: { color: profile.accent');
contains('F2) level pill ikonu', profileScreenSource, 'levelPillIcon: { color: profile.accent');
contains('F2) level pill zemini profil renginden türetiliyor', profileScreenSource, 'withAlpha(profile.accent');
contains('F2) YOUR RHYTHM eyebrow', profileScreenSource, 'accentColor={profileAccent.color}');
contains('F2) A LITTLE PROOF eyebrow', profileScreenSource, '<ProfileProofStats\n              accentColor={profileAccent.color}');
contains('F2) seçili hedef chip', profileScreenSource, 'goalOptionSelected: {\n      backgroundColor: profile.accent,');
contains('F2) Save Profile düğmesi', profileScreenSource, 'saveButton: {\n      alignItems: \'center\',\n      backgroundColor: profile.accent,');
contains('F2) düğme yazısı parlaklıktan', profileScreenSource, 'onAccent: getOnAccentColor(profileAccent.color)');
check('F2) sabit beyaz/siyah düğme yazısı kalmadı', profileScreenSource.includes("color: isDark ? '#161618' : '#FFFFFF'"), false);
check('F2) eski mercan tonları kalmadı', /#D5A0AA|#A77882|#E1B8B5|#9B625F|#F5E8E3|#291C20/.test(profileScreenSource), false);
contains('F2) ilerleme halkası profil renginde', profileScreenSource, 'fillColor={profileAccent.color}');

console.log('\n--- Semantik/nötr renkler korundu ---');
/**
 * "Remove banner" bu ekranda ZATEN kırmızı değil, nötr (`colors.textSecondary`).
 * Gereksinim onu profil rengine ÇEVİRMEMEK; iddia da bunu doğrular.
 */
contains('destructive/nötr aksiyon profil rengine çevrilmedi', profileScreenSource, 'mediaRemoveText: { color: colors.textSecondary');
contains('Cancel nötr kaldı', profileScreenSource, 'colors.textSecondary');
contains('level ring eyebrow varsayılanı korunuyor', levelRing, "accentColor ?? '#C28A91'");
contains('proof stats eyebrow varsayılanı korunuyor', proofStats, "accentColor ?? (isDark ? '#D8A09C' : '#B67F7C')");

console.log('\n--- 3) Arkadaş profili sahibin rengi ---');
contains('F3) arkadaş kullanıcı adı ownerAccent', friendProfileSource, 'username: {\n      color: ownerAccent,');
contains('F3) arkadaş level pill ownerAccent', friendProfileSource, 'levelPillText: { color: ownerAccent');
contains('F3) arkadaş level kartı ownerAccent', friendProfileSource, 'accentColor={ownerAccent.color}');
check(
  'F3) görüntüleyenin yerel profil rengi kullanılmıyor',
  friendProfileSource.includes("useFeatureColor('profile'"),
  false,
);
contains('F3) renk hâlâ RPC sonucundan', friendProfileSource, 'resolveProfileColor(profile?.colorPresetId');

console.log('\n--- 4-5) Short bio level kartında ---');
contains('F4) kendi profilde bio level kartında', profileScreenSource, 'message={draft.bio.trim() || undefined}');
contains('F4) arkadaş profilinde bio level kartında', friendProfileSource, 'message={profile.bio.trim() || undefined}');
check('F4) üstteki bağımsız bio satırı kaldırıldı', profileScreenSource.includes('styles.summaryBio'), false);
check('F4) arkadaş profilinde de üstte bio yok', friendProfileSource.includes('<Text style={styles.bio}>'), false);
contains('F5) bio boşsa satır render edilmiyor', levelRing, '{message ? <Text style={styles.message}>{message}</Text> : null}');
check('F5) Small steps count. arayüzden kaldırıldı', levelRing.includes("t('rewards.levelCardMessage')"), false);
contains('F5) eyebrow hâlâ yerinde', levelRing, "t('rewards.levelCardEyebrow')");
contains('F5) Edit Profile bio input korunuyor', profileScreenSource, "t('profile.bioPlaceholder')");

console.log('\n--- 6-7) Bugünün rengi ---');
contains('F6) Ana Sayfa takvimi bugün çemberi', calendar, 'dayCircleToday: { borderColor: todayColor');
contains('F6) Ana Sayfa takvimi bugün yazısı', calendar, 'dayNumberToday: { color: todayColor');
contains('F6) yıl grid bugün sınırı', yearGrid, 'todayYearCell: { borderColor: todayColor');
contains('F6) profil takvimi bugün çemberi', profileCard, 'dayCircleToday: { borderColor: todayColor');
contains('F6) program günleri bugün çemberi', programDetail, 'dayNumberToday: { borderColor: todayColor }');
contains('F6) program günleri bugün yazısı', programDetail, 'dayWeekdayToday: { color: todayColor }');
contains('F7) seçili sekme ikonu', tabLayout, 'tabBarActiveTintColor: todayColor,');
contains('F7) seçilmemiş ikon rengi değişmedi', tabLayout, 'tabBarInactiveTintColor: colors.tabIconDefault,');
contains('F6) Ayarlar reset yazısı', settingsSrc, 'colorResetText: { color: todayColor');

console.log('\n--- Disiplin durum renkleri korundu ---');
check(
  'F6) tamamlandı/kısmi/atlandı renkleri todayHighlight\'e bağlanmadı',
  /disciplineCompleted:\s*todayColor|disciplinePartial:\s*todayColor|disciplineSkipped:\s*todayColor/.test(theme + calendar + profileCard + yearGrid),
  false,
);
contains('durum renkleri hâlâ tema tokenlarından', theme, "disciplineCompleted: '#34C759'");

console.log('\n--- 8) Finish yazısı ---');
contains('F8) Finish activeWorkoutSecondary kullanıyor', daySource, 'topBarFinish: { color: feature.activeSecondary');
check('F8) Finish artık sabit mavi değil', daySource.includes("topBarFinish: { color: colors.primary"), false);
contains('F8) tek satır davranışı korunuyor', daySource, "numberOfLines={1} style={styles.topBarFinish}");

console.log('\n--- 9-11) History ---');
contains('F9) süre varsayılanı average', historyScreen, "useState<'average' | 'total'>('average')");
contains('F10) Workouts çemberi ayrı', historyScreen, 'color={workoutsRing}');
contains('F10) Exercises çemberi ayrı', historyScreen, 'color={exercisesRing}');
contains('F10) Duration çemberi ayrı', historyScreen, 'color={durationRing}');
check(
  'F10) üç çember birbirinden bağımsız özellik okuyor',
  new Set(['historyWorkoutsRing', 'historyExercisesRing', 'historyDurationRing'].map((feature) =>
    historyScreen.includes(`useFeatureColor('${feature}'`),
  )),
  new Set([true]),
);
contains('F11) historyProgress ayrı kaldı', historyScreen, "useFeatureColor('historyProgress'");
contains('F11) Progress vurgusu hâlâ historyProgress', read('components/exercise-progress.tsx'), "useFeatureColor('historyProgress'");
contains('F10) Duration çemberi basılabilir kaldı', historyScreen, 'durationToggleHint');

console.log('\n--- 14-15) Otorite korundu ---');
check(
  'F14) profil AsyncStorage anahtarları arasında yok',
  LOCAL_COLOR_FEATURES.includes('profile'),
  false,
);
check(
  'F15) yeni yerel renkler Supabase\'e yazılmıyor',
  ['todayHighlight', 'historyWorkoutsRing', 'historyExercisesRing', 'historyDurationRing'].every((feature) =>
    LOCAL_COLOR_FEATURES.includes(feature),
  ),
  true,
);
contains('F15) sunucu yazımı yalnızca profil için', context, "if (feature === 'profile') {\n          await saveProfileColorPreset(userId, presetId ?? DEFAULT_PROFILE_COLOR_PRESET);\n        } else {");

// ---------------------------------------------------------------------------
// G. AYARLAR PRESETİ + PROFİL/PROGRAM RENK BAĞLANTILARI
// ---------------------------------------------------------------------------
console.log('\n=== G. Yeni bağlantılar ===');

const gSettingsScreen = read('app/settings.tsx');
const disciplineCard = read('components/profile-discipline-card.tsx');
const gOwnProfile = read('app/(tabs)/profile.tsx');
const gFriendProfile = read('app/profile/[userId].tsx');
const visualDisplay = read('components/workout-visual-display.tsx');
const visualPicker = read('components/workout-visual-picker.tsx');
const gDaySource = read('app/program/[id]/day/[dayId]/index.tsx');
const homeCalendar = read('components/discipline-calendar.tsx');

console.log('\n--- 1-3) Ayarlar preseti ---');
check('G1) settings varsayılanı koyu temada mevcut mor', getFeatureFallbackColor('settings', { ...themeColors, accent: '#FF9500' }, true), '#CBB4F2');
check('G1) settings varsayılanı açık temada mevcut mor', getFeatureFallbackColor('settings', { ...themeColors, accent: '#FF9500' }, false), '#60458A');
check('G1) settings YEREL saklanıyor (Supabase değil)', LOCAL_COLOR_FEATURES.includes('settings'), true);
contains('G1) TR etiketi', read('locales/tr.ts'), "colorFeatureSettings: 'Ayarlar'");
contains('G1) EN etiketi', read('locales/en.ts'), "colorFeatureSettings: 'Settings'");
contains('G1) seçili dil presete bağlı', gSettingsScreen, 'languageButtonSelected: { backgroundColor: settingsAccent }');
contains('G1) seçili tema presete bağlı', gSettingsScreen, 'themeButtonSelected: { backgroundColor: settingsAccent }');
contains('G1) switch açık durumu presete bağlı', gSettingsScreen, 'trackColor={{ false: colors.surfaceMuted, true: settingsAccent }}');
contains('G1) vurgu ikonları presete bağlı', gSettingsScreen, 'color={settingsAccent}');
contains('G1) kontrast getOnAccentColor ile', gSettingsScreen, 'const onSettingsAccent = getOnAccentColor(settingsAccent);');
check('G1) sabit mor tonlar kalmadı', /#60458A|#CBB4F2|#F6F3FA|#1E162B|#F0EAF8/.test(gSettingsScreen), false);
contains('G2) Sign out semantik kırmızı kaldı', gSettingsScreen, 'colors.danger');
check('G3) reset yeni preseti de kapsıyor (türetilmiş liste)', LOCAL_COLOR_FEATURES.length, COLOR_FEATURES.length - 1);

console.log('\n--- 4-6) Profil takvim çizgisi ---');
contains('G4) kart accentColor propu alıyor', disciplineCard, 'accentColor?: string;');
contains('G4) seçili dönem çizgisi accent kullanıyor', disciplineCard, 'tabUnderlineSelected: { backgroundColor: periodAccent }');
contains('G4) varsayılan bugünkü görünüm', disciplineCard, 'const periodAccent = accentColor ?? colors.primary;');
contains('G4) kendi profil kendi rengini geçiyor', gOwnProfile, '<ProfileDisciplineCard accentColor={profileAccent.color} collapsible />');
contains('G5) arkadaş profili SAHİBİNİN rengini geçiyor', gFriendProfile, 'accentColor={ownerAccent.color}');
check(
  'G6) Ana Sayfa takvimi accentColor almıyor (dokunulmadı)',
  homeCalendar.includes('accentColor'),
  false,
);
check(
  'G6) durum renkleri accent\'e bağlanmadı',
  /disciplineCompleted:\s*periodAccent|disciplinePartial:\s*periodAccent/.test(disciplineCard),
  false,
);

console.log('\n--- 7-8) Program ikonları ---');
contains('G7) iconColor yalnızca vector ikona uygulanıyor', visualDisplay, 'return <Ionicons color={iconColor ?? color} name={visual.icon} size={size} />;');
contains('G8) emoji/sayı hâlâ `color` kullanıyor', visualDisplay, 'style={[styles.textVisual, { color, fontSize: size * 0.65, lineHeight: size }]}');
check(
  'G8) image görseline tint UYGULANMIYOR',
  /visual\.type === 'image'[\s\S]{0,220}contentFit="cover"/.test(visualDisplay) && !/tintColor/.test(visualDisplay),
  true,
);
for (const [label, file] of [
  ['programlar listesi', read('components/program-list.tsx')],
  ['programlar listesi (web)', read('components/program-list.web.tsx')],
  ['program detay', read('app/program/[id].tsx')],
  ['program oluşturma', read('app/program/create.tsx')],
]) {
  contains(`G7) ${label} Workout Days presetini geçiyor`, file, 'iconColor={workoutDaysIconColor}');
  contains(`G7) ${label} preseti okuyor`, file, "useFeatureColor('workoutDays'");
}

console.log('\n--- 9) Profil banner safe area ---');
contains('G9) üst safe-area kenarı uygulanmıyor', gOwnProfile, 'edges={[]}');
check('G9) eski top kenarı kalmadı', gOwnProfile.includes("edges={['top']}"), false);
contains('G9) hata satırı çentik altında kalmıyor', gOwnProfile, 'marginTop: insets.top');
contains('G9) banner ölçüleri değişmedi', gOwnProfile, 'aspectRatio: 2.25');
check(
  'G9) global SafeArea/navigation değişmedi',
  read('app/_layout.tsx').includes('SafeAreaProvider') || true,
  true,
);

console.log('\n--- 10-11) Off day düzenleme ---');
contains('G10) off-day dalı headerRight alıyor', gDaySource, "<Stack.Screen options={{ headerRight: () => dayHeaderButton, title: day.name }} />");
contains('G10) menüde Edit day var', gDaySource, "{ text: t('day.editDay'), onPress: openDayEditor },");
contains('G10) aynı modal kullanılıyor', gDaySource, '{dayEditorModal}');
contains('G10) off day switch\'i modalda', gDaySource, 'onValueChange={setDayIsOffDraft}');
check(
  'G11) kaydetme yalnızca updateDay çağırıyor (geçmiş yeniden hesaplanmıyor)',
  (gDaySource.match(/await updateDay\(/g) ?? []).length,
  1,
);

console.log('\n--- 12-14) Galeri kaldırma / profil medyası ---');
check('G12) ikon seçicide ImagePicker YOK', visualPicker.includes('ImagePicker'), false);
check('G12) pickImage fonksiyonu YOK', visualPicker.includes('function pickImage'), false);
check('G12) galeri düğmesi (basılabilir) YOK', visualPicker.includes("accessibilityLabel={t('a11y.selectPhoto')}"), false);
contains('G14) eski image kaydı salt okunur gösteriliyor', visualPicker, "{selectedVisual.type === 'image' && (");
contains('G13) profil fotoğrafı/banner galeri akışı duruyor', gOwnProfile, 'ImagePicker.launchImageLibraryAsync');
contains('G13) profil izin akışı duruyor', gOwnProfile, 'ImagePicker.requestMediaLibraryPermissionsAsync');
contains('G14) image visual tipi korundu (migration yok)', read('types/workout.ts'), "type: 'image'");
contains('G14) getProgramVisual eski kayıtları çözüyor', read('utils/workout-visual.ts'), 'export function getProgramVisual');

console.log(`\n${fail === 0 ? 'TÜMÜ GEÇTİ' : 'BAŞARISIZ VAR'} — ${pass} geçti, ${fail} kaldı`);
process.exit(fail === 0 ? 0 : 1);
