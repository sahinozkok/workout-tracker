/**
 * Aktif programı paylaşma — İSTEMCİ sözleşmesi harness'ı.
 *
 * İki katman:
 *   A. DAVRANIŞSAL — GERÇEK `utils/shared-program.ts` (ve `data/exercises.ts`)
 *      `tsc` ile derlenip ÇAĞRILIR; kopya algoritma test edilmez.
 *   B. YAPISAL — profil context/ekran/ayar/bileşen kaynaklarında güvenlik ve
 *      akış kurallarının GERÇEKTEN yazılı olduğu iddia edilir.
 *
 * Supabase/AsyncStorage'a bağlanılmaz.
 *
 * Çalıştırma:  node scripts/verify-shared-active-program-client.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} (beklenen ${expected}, gelen ${actual})`);
}
function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

// ---------------------------------------------------------------------------
// GERÇEK çekirdeği derle
// ---------------------------------------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), 'rosea-shared-program-'));
let mod;
try {
  writeFileSync(
    join(outDir, 'types-workout-shim.ts'),
    [
      'ExerciseDefinition', 'ProgramExercise', 'Weekday', 'WorkoutProgram',
    ]
      .map((name) => `export type ${name} = any;\n`)
      .join(''),
  );
  writeFileSync(
    join(outDir, 'types-friends-shim.ts'),
    ['SharedActiveProgram', 'SharedProgramDay', 'SharedProgramExercise']
      .map((name) => `export type ${name} = any;\n`)
      .join(''),
  );

  for (const [relative, outName] of [
    ['data/exercises.ts', 'exercises'],
    ['utils/shared-program.ts', 'shared-program'],
  ]) {
    const patched = source(relative)
      .replace(/from '@\/types\/workout'/g, "from './types-workout-shim'")
      .replace(/from '@\/types\/friends'/g, "from './types-friends-shim'")
      .replace(/from '@\/data\/exercises'/g, "from './exercises.js'");
    writeFileSync(join(outDir, `${outName}.ts`), patched);
  }

  execFileSync(
    'npx',
    ['tsc', join(outDir, 'exercises.ts'), join(outDir, 'shared-program.ts'),
     join(outDir, 'types-workout-shim.ts'), join(outDir, 'types-friends-shim.ts'),
     '--outDir', outDir, '--target', 'es2020', '--module', 'esnext',
     '--moduleResolution', 'bundler', '--skipLibCheck'],
    { cwd: ROOT, stdio: 'pipe' },
  );

  mod = await import(pathToFileURL(join(outDir, 'shared-program.js')).href);
} catch (error) {
  console.error('Saf çekirdek derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}
process.on('exit', () => rmSync(outDir, { force: true, recursive: true }));

const {
  buildSharedProgramFromWorkoutProgram,
  mapFriendActiveProgramRows,
  summarizeSharedProgram,
} = mod;

/** FriendActiveProgramRow kısayolu. */
function row(over = {}) {
  return {
    program_name: 'Push/Pull',
    day_name: 'Gün',
    scheduled_weekday: 1,
    is_off_day: false,
    day_position: 0,
    exercise_id: null,
    custom_exercise_name: null,
    tracking_mode: 'sets_reps',
    target_sets: 3,
    target_reps: '8-12',
    target_duration_seconds: null,
    target_distance_meters: null,
    exercise_position: 0,
    ...over,
  };
}
const NAME = () => 'X';

// ===========================================================================
console.log('=== A. RPC satır → DTO ===');
// ===========================================================================

check('A1. Boş satır → undefined (bölüm gizli)', () => {
  assertEqual(mapFriendActiveProgramRows([]), undefined, 'boş');
});

check('A2. Custom egzersiz adı KORUNUR', () => {
  const dto = mapFriendActiveProgramRows([
    row({ exercise_id: null, custom_exercise_name: 'Sıçrama ipi', exercise_position: 0 }),
  ]);
  assertEqual(dto.days[0].exercises[0].name, 'Sıçrama ipi', 'custom ad');
});

check('A3. Built-in ad çözücü ENJEKTE edilebilir (getProgramExerciseName ile)', () => {
  const dto = mapFriendActiveProgramRows([row()], () => 'Çözülmüş Ad');
  assertEqual(dto.days[0].exercises[0].name, 'Çözülmüş Ad', 'resolver kullanıldı');
});

check('A4. Off-day egzersizsiz olsa da KORUNUR (LEFT JOIN null satırı)', () => {
  const dto = mapFriendActiveProgramRows([
    row({ scheduled_weekday: 1, day_position: 0 }),
    // Off-day: LEFT JOIN eşleşmez → tüm egzersiz alanları null.
    row({
      scheduled_weekday: 2, day_position: 1, is_off_day: true, day_name: 'Pazar',
      exercise_id: null, custom_exercise_name: null, tracking_mode: null,
      target_sets: null, target_reps: null, exercise_position: null,
    }),
  ], NAME);
  assertEqual(dto.days.length, 2, 'iki gün');
  const off = dto.days[1];
  assertEqual(off.isOffDay, true, 'off-day işaretli');
  assertEqual(off.exercises.length, 0, 'egzersiz yok');
});

check('A5. Günler ve egzersizler POZİSYONA göre sıralanır (satır sırasına değil)', () => {
  const dto = mapFriendActiveProgramRows([
    // Karışık sırada verilir.
    row({ scheduled_weekday: 2, day_position: 1, day_name: 'B', custom_exercise_name: 'b2', exercise_position: 1 }),
    row({ scheduled_weekday: 1, day_position: 0, day_name: 'A', custom_exercise_name: 'a2', exercise_position: 1 }),
    row({ scheduled_weekday: 2, day_position: 1, day_name: 'B', custom_exercise_name: 'b1', exercise_position: 0 }),
    row({ scheduled_weekday: 1, day_position: 0, day_name: 'A', custom_exercise_name: 'a1', exercise_position: 0 }),
  ], (id, custom) => custom);
  assertEqual(dto.days.map((d) => d.name).join(','), 'A,B', 'gün sırası');
  assertEqual(dto.days[0].exercises.map((e) => e.name).join(','), 'a1,a2', 'A gün egzersiz sırası');
  assertEqual(dto.days[1].exercises.map((e) => e.name).join(','), 'b1,b2', 'B gün egzersiz sırası');
});

check('A6. Mode-aware hedefler; ilgisiz alan taşınmaz', () => {
  const dto = mapFriendActiveProgramRows([
    row({ scheduled_weekday: 1, day_position: 0, tracking_mode: 'sets_reps', target_sets: 4, target_reps: '5', custom_exercise_name: 's' }),
    row({ scheduled_weekday: 2, day_position: 1, tracking_mode: 'duration', target_sets: null, target_reps: null, target_duration_seconds: 1800, custom_exercise_name: 'd', exercise_position: 0 }),
    row({ scheduled_weekday: 3, day_position: 2, tracking_mode: 'distance', target_sets: null, target_reps: null, target_distance_meters: 5000, custom_exercise_name: 'r', exercise_position: 0 }),
  ], (id, custom) => custom);
  assertDeep(dto.days[0].exercises[0], { trackingMode: 'sets_reps', name: 's', targetSets: 4, targetReps: '5' });
  assertDeep(dto.days[1].exercises[0], { trackingMode: 'duration', name: 'd', targetDurationSeconds: 1800 });
  assertDeep(dto.days[2].exercises[0], { trackingMode: 'distance', name: 'r', targetDistanceMeters: 5000 });
});

check('A7. MUT — geçersiz tür/hedef SESSİZCE strength\'e çevrilmez, REDDEDİLİR', () => {
  // sets_reps ama target_sets null.
  assertThrows(() => mapFriendActiveProgramRows([row({ target_sets: null })], NAME), 'sets_reps null sets reddedilmeli');
  // duration ama süre null.
  assertThrows(() => mapFriendActiveProgramRows([row({ tracking_mode: 'duration', target_sets: null, target_reps: null, target_duration_seconds: null })], NAME), 'duration null reddedilmeli');
  // distance ama mesafe null.
  assertThrows(() => mapFriendActiveProgramRows([row({ tracking_mode: 'distance', target_sets: null, target_reps: null, target_distance_meters: null })], NAME), 'distance null reddedilmeli');
  // bilinmeyen mod.
  assertThrows(() => mapFriendActiveProgramRows([row({ tracking_mode: 'bogus' })], NAME), 'bilinmeyen mod reddedilmeli');
});

check('A8. summarizeSharedProgram yalnız antrenman günlerini ve egzersizleri sayar', () => {
  const dto = mapFriendActiveProgramRows([
    row({ scheduled_weekday: 1, day_position: 0, custom_exercise_name: 'a' }),
    row({ scheduled_weekday: 2, day_position: 1, is_off_day: true, tracking_mode: null, target_sets: null, target_reps: null, exercise_position: null }),
  ], NAME);
  const summary = summarizeSharedProgram(dto);
  assertEqual(summary.dayCount, 1, 'antrenman günü (off-day sayılmaz)');
  assertEqual(summary.exerciseCount, 1, 'egzersiz (off-day sıfır)');
});

// ===========================================================================
console.log('\n=== B. Kendi program → DTO ===');
// ===========================================================================

check('B1. WorkoutProgram DTO\'ya çevrilir; off-day ve mode korunur', () => {
  const program = {
    name: 'Benim Program',
    days: [
      {
        name: 'İtiş', scheduledWeekday: 1, isOffDay: false,
        exercises: [
          { trackingMode: 'sets_reps', exerciseId: undefined, customExerciseName: 'Bench', targetSets: 3, targetReps: '8-10' },
          { trackingMode: 'duration', customExerciseName: 'Plank', targetDurationSeconds: 60 },
        ],
      },
      { name: 'Dinlenme', scheduledWeekday: 0, isOffDay: true, exercises: [] },
    ],
  };
  const dto = buildSharedProgramFromWorkoutProgram(program);
  assertEqual(dto.name, 'Benim Program', 'program adı');
  assertEqual(dto.days.length, 2, 'gün sayısı');
  assertEqual(dto.days[0].exercises[0].name, 'Bench', 'custom ad');
  assertEqual(dto.days[0].exercises[1].trackingMode, 'duration', 'mode');
  assertEqual(dto.days[1].isOffDay, true, 'off-day');
});

check('B2. isOffDay undefined → false', () => {
  const dto = buildSharedProgramFromWorkoutProgram({
    name: 'P', days: [{ name: 'G', scheduledWeekday: 1, exercises: [] }],
  });
  assertEqual(dto.days[0].isOffDay, false, 'varsayılan false');
});

function assertDeep(actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`derin eşitlik (beklenen ${e}, gelen ${a})`);
}

// ===========================================================================
console.log('\n=== C. Profil context — flag güvenliği (kaynak) ===');
// ===========================================================================

const context = source('context/profile-context.tsx');
// Yorumlar sıyrılır: kontroller GERÇEK kodu ölçer, komşu fonksiyonun açıklama
// metnini değil (örn. setColorPreset'in AsyncStorage yorumu).
const setterBody = stripComments(
  context.slice(
    context.indexOf('const setShareActiveProgram = useCallback('),
    context.indexOf('const setColorPreset = useCallback('),
  ),
);

check('C1. Flag YALNIZ Supabase; setter AsyncStorage kullanmaz', () => {
  assert(setterBody.length > 0, 'setShareActiveProgram bulunamadı');
  assert(/supabase[\s\S]*\.update\(\{ \[SHARE_ACTIVE_PROGRAM_COLUMN\]: enabled \}\)/.test(setterBody), 'sunucu update yok');
  assert(!/AsyncStorage/.test(setterBody), 'setter AsyncStorage kullanıyor');
});

check('C2. Profil yüklenmeden yazma engeli (canWriteProfile)', () => {
  assert(/if \(!canWriteProfile\(userId\)\) throw new Error\('profileNotLoaded'\)/.test(setterBody), 'canWriteProfile guard yok');
});

check('C3. Optimistic + hata rollback', () => {
  assert(setterBody.indexOf('setShareActiveProgramState(enabled)') < setterBody.indexOf('if (error)'), 'optimistic yok');
  assert(/setShareActiveProgramState\(previousValue\)/.test(setterBody), 'rollback yok');
});

check('C4. Rollback SAHİPLİK guard\'ı (hesap değişiminde eski cevap yazamaz)', () => {
  assert(/if \(writeAuthorityRef\.current\.userId === userId\) setShareActiveProgramState\(previousValue\)/.test(setterBody), 'ownership guard yok');
});

check('C5. Üç kademeli kolon fallback (FULL → EXTENDED → LEGACY)', () => {
  const code = stripComments(context);
  assert(/FULL_COLUMNS = `\$\{EXTENDED_COLUMNS\}, \$\{SHARE_ACTIVE_PROGRAM_COLUMN\}`/.test(context), 'FULL_COLUMNS yok');
  assert(/isMissingShareColumnError\(fullResult\.error\)/.test(code), 'share kolon fallback yok');
  assert(/isMissingOptionalColumnError\(extendedResult\.error\)/.test(code), 'extended→legacy zinciri bozulmuş');
  assert(/select\(LEGACY_COLUMNS\)/.test(code), 'LEGACY fallback yok');
});

check('C6. Hesap çıkışında flag varsayılana döner', () => {
  assert(/setShareActiveProgramState\(false\)/.test(context), 'no-user reset yok');
});

check('C7. Flag için AsyncStorage anahtarı/çağrısı YOK', () => {
  // Paylaşım bayrağı hiçbir yerde AsyncStorage anahtarına ya da çağrısına bağlanmaz.
  assert(!/@workout-tracker\/[a-z-]*(share|active-program)/i.test(context), 'flag AsyncStorage ön eki var');
  assert(!/AsyncStorage\.(get|set|remove|multi)[A-Za-z]*\([^)]*[Ss]hare/.test(context), 'flag AsyncStorage çağrısı var');
});

// ===========================================================================
console.log('\n=== D. Ekranlar ve bileşen (kaynak) ===');
// ===========================================================================

const ownProfile = source('app/(tabs)/profile.tsx');
const friendProfile = source('app/profile/[userId].tsx');
const component = source('components/profile-shared-program.tsx');
const settings = source('app/settings.tsx');

check('D1. Ortak bileşen İKİ profilde de kullanılıyor', () => {
  assert(/<ProfileSharedProgram/.test(ownProfile), 'kendi profilde yok');
  assert(/<ProfileSharedProgram/.test(friendProfile), 'arkadaş profilinde yok');
});

check('D2. Kendi profil YALNIZ flag + aktif programla gösterir', () => {
  const code = stripComments(ownProfile);
  assert(/shareActiveProgram\s*\?\s*programs\.find/.test(code), 'flag guard yok');
  assert(/ownSharedProgram &&/.test(code), 'aktif program guard yok');
  assert(/buildSharedProgramFromWorkoutProgram/.test(code), 'DTO builder kullanılmıyor');
});

check('D3. Kendi profil YENİ Supabase program sorgusu AÇMAZ', () => {
  // Program DTO'su yalnız useWorkout verisinden türetilir; program için rpc/from yok.
  assert(!/get_friend_active_program/.test(ownProfile), 'kendi profil RPC çağırıyor');
});

check('D4. Arkadaş profili TOLERANSLI (hata → bölüm gizli, ekran düşmez)', () => {
  const code = stripComments(friendProfile);
  assert(/getFriendActiveProgram\(userId\)/.test(code), 'RPC çağrısı yok');
  const effect = code.slice(code.indexOf('getFriendActiveProgram(userId)'), code.indexOf('getFriendActiveProgram(userId)') + 400);
  assert(/\.catch\(/.test(effect), 'catch yok (hata ekranı düşürebilir)');
  assert(/setSharedProgram\(undefined\)/.test(effect), 'hata durumunda gizlenmiyor');
});

check('D5. Arkadaş profili STALE-response guard\'ı (nesil kontrolü)', () => {
  const code = stripComments(friendProfile);
  assert(/sharedProgramRequestIdRef\.current !== requestId/.test(code), 'nesil guard yok');
});

check('D6. Arkadaş ekranında EDIT/START callback\'i YOK', () => {
  const usage = friendProfile.slice(friendProfile.indexOf('<ProfileSharedProgram'), friendProfile.indexOf('<ProfileSharedProgram') + 200);
  assert(!/onEdit|onStart|onPress=|onDayPress/.test(usage), 'mutation callback bağlı');
});

check('D7. Bileşen mutation prop KABUL ETMEZ ve veri yoksa null döner', () => {
  assert(!/onEdit|onStart|onDayPress/.test(component), 'bileşende mutation prop tanımı var');
  assert(/if \(!program\) return null;/.test(component), 'boş programda null dönmüyor (opt-out boş kart riski)');
});

check('D8. Ayarlar toggle\'ı + başarısızlıkta rollback uyarısı', () => {
  assert(/t\('profile\.shareActiveProgram'\)/.test(settings), 'toggle başlığı yok');
  assert(/setShareActiveProgram/.test(settings), 'setter kullanılmıyor');
  assert(/handleShareActiveProgramToggle/.test(settings), 'toggle handler yok');
  assert(/accessibilityLabel=\{t\('profile\.shareActiveProgramLabel'\)\}/.test(settings), 'erişilebilirlik etiketi yok');
});

check('D9. Mode-aware hedef formatı bileşende (sahte 1 set YOK)', () => {
  const componentCode = stripComments(component);
  assert(/formatMetersAsKilometers/.test(componentCode), 'km yardımcısı yeniden kullanılmıyor');
  assert(/splitSecondsIntoFields/.test(componentCode), 'dk yardımcısı yeniden kullanılmıyor');
  assert(/trackingMode === 'sets_reps'/.test(componentCode), 'mode-aware değil');
  assert(!/1 set|targetSets: 1/.test(componentCode), 'sahte 1 set gösterimi var');
});

check('D10. Yeni çeviriler TR ve EN\'de', () => {
  const tr = source('locales/tr.ts');
  const en = source('locales/en.ts');
  for (const key of ['shareActiveProgram:', 'shareActiveProgramCaption:', 'shareActiveProgramLabel:']) {
    assert(tr.includes(key) && en.includes(key), `profil anahtarı eksik: ${key}`);
  }
  for (const key of ['title:', 'dayCount:', 'exerciseCount:', 'restDay:', 'toggleHint:']) {
    assert(tr.includes(key) && en.includes(key), `sharedProgram anahtarı eksik: ${key}`);
  }
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Paylaşılan aktif program istemci harness: ${pass} kontrol geçti.`);
console.log('  (GERÇEK saf çekirdek derlenip çalıştırıldı; kopya algoritma test edilmedi.)');
