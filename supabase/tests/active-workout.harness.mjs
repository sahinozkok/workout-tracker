/**
 * Aktif antrenman davranışlarının doğrulama harness'ı.
 *
 * SINIR: React render edilmez, SQL çalıştırılmaz. İki katman:
 *   A. YAPISAL — kaynak dosyalarda kuralların gerçekten bulunduğunu iddia eder.
 *   B. DAVRANIŞSAL — `completeSet` / `undoCompletedSet` / mola biçimlendirme /
 *      drop set doğrulama kurallarının satır satır karşılığı olan model.
 *
 * Çalıştırma:  node supabase/tests/active-workout.harness.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

/**
 * GERÇEK yardımcıları test et: `utils/workout-sets.ts` burada derlenip
 * import edilir. Böylece harness ayrı bir kopya algoritmayı değil,
 * uygulamanın çalıştırdığı fonksiyonların ta kendisini doğrular.
 */
const buildDir = mkdtempSync(join(tmpdir(), 'workout-sets-'));
let sets;
try {
  // `@/` alias'ı yalnızca tsconfig `paths` ile çözülür; CLI bayrağı yoktur.
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
      files: [join(root, 'utils/workout-sets.ts')],
    }),
  );
  execFileSync('npx', ['tsc', '-p', tsconfigPath], { cwd: root, stdio: 'pipe' });
  // tsc çıktıyı kaynak dizin yapısını koruyarak yazar; dosyayı arayarak bul.
  const emitted = readdirSync(buildDir, { recursive: true, withFileTypes: true }).find(
    (entry) => entry.isFile() && entry.name === 'workout-sets.js',
  );
  if (!emitted) throw new Error('workout-sets.js derlenemedi');
  sets = await import(pathToFileURL(join(emitted.parentPath ?? emitted.path, emitted.name)).href);
} finally {
  process.on('exit', () => rmSync(buildDir, { force: true, recursive: true }));
}

const {
  completesWholeWorkout: realCompletesWholeWorkout,
  contributesToPlannedProgress,
  getActiveSetLabelNumber,
  getActualSetCount,
  getDisciplineCountAfterUndo,
  getHighestSetNumber,
} = sets;

const context = read('context/workout-context.tsx');
const screen = read('app/program/[id]/day/[dayId]/index.tsx');
const restTimer = read('utils/rest-timer.ts');
const analytics = read('utils/workout-analytics.ts');
const migration = read('supabase/migrations/20260825120000_add_workout_set_drop_sets.sql');
const types = read('types/workout.ts');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` +
      (ok ? '' : `  (beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)})`),
  );
}
const contains = (name, haystack, needle) => check(name, haystack.includes(needle), true);

console.log('=== A. Kaynak kuralları ===');
check('completeSet erken dönüşü kaldırıldı', context.includes('if (currentCount >= targetSets) return;'), false);
contains(
  'set numarası gerçek en yükseğe göre',
  context,
  'getHighestSetNumber(workoutSets, session.id, programExerciseId) + 1',
);
contains('disiplin sayacı hâlâ hedefe clamp', context, 'Math.min((currentCounts[progressKey] ?? 0) + 1, targetSets)');
contains('undo gerçek son seti siliyor', context, ".eq('set_number', lastSetNumber)");
check('undo artık clamp edilmiş sayaçla silmiyor', context.includes(".eq('set_number', currentCount)"), false);
contains('ana insert drop_sets yazıyor', context, 'drop_sets: dropSets,');
contains('drop_sets okuma doğrulanıyor', context, 'dropSets: parseDropSets(workoutSet.drop_sets)');
contains('mola toplam süreyi gösteriyor', restTimer, 'progress.isOvertime ? progress.totalRestSeconds : progress.remainingSeconds');
check('+00:01 biçimi kaldırıldı', restTimer.includes("`${progress.isOvertime ? '+' : ''}"), false);
contains('toplam hacim drop set dahil', analytics, 'export function getSetTotalVolume');
contains('set rekoru ana set hacmiyle', analytics, 'const volume = getSetVolume(workoutSet);');
contains('migration additive/tekrarlanabilir', migration, "add column if not exists drop_sets jsonb not null default '[]'::jsonb");
check('migration yeni grant/policy eklemiyor', /grant |create policy/i.test(migration), false);
contains('tip: WorkoutDropSetPerformance', types, 'export type WorkoutDropSetPerformance');
contains('tip: performansta dropSets', types, 'dropSets?: WorkoutDropSetPerformance[];');
contains('tip: kayıtta dropSets', types, 'dropSets: WorkoutDropSetPerformance[];');

console.log('\n=== A2. Ekran kuralları ===');
check(
  'giriş alanları set kaydında sıfırlanmıyor',
  screen.includes('}, [activeExercise?.id, activeCompletedSets]);'),
  false,
);
contains('öneri önce bugünkü son set', screen, 'const suggestedSet = latestSessionSet ?? activePreviousSet;');
contains('elle seçim ekstra set açıyor', screen, 'const isExtraSetMode =');
contains('elle seçimde otomatik temizleme durur', screen, 'if (isManualSelection) return;');
contains('panel satırı seçilebilir', screen, 'setIsManualSelection(isComplete);');
/**
 * KALICI ANLAM: egzersiz SEÇİMİ manuel modu koşulsuz açmaz — `isComplete`'ten
 * türetir. Faz 2C'de "çalışan aktiviteye dön" uyarıları seçimi programatik
 * olarak taşıdığı için dosyanın BAŞKA yerlerinde `setIsManualSelection(true)`
 * bulunuyor; bu, iddianın koruduğu hatayla ilgisizdir. İddia zayıflatılmadı,
 * ait olduğu fonksiyonun gövdesine daraltıldı.
 */
const exerciseSelectionStart = screen.indexOf('async function handleExerciseSelection(');
const exerciseSelectionBody = screen.slice(
  exerciseSelectionStart,
  // Yalnız BU fonksiyonun gövdesi; sonraki fonksiyon bildiriminde kesilir.
  screen.indexOf('\n  function ', exerciseSelectionStart),
);
check(
  'egzersiz seçimi gövdesi bulundu',
  exerciseSelectionBody.length > 200 && exerciseSelectionBody.includes('setIsManualSelection('),
  true,
);
check(
  'manuel mod koşulsuz açılmıyor',
  exerciseSelectionBody.includes('setIsManualSelection(true);'),
  false,
);
/**
 * KALICI ANLAM: panel, hedefe clamp edilmiş disiplin sayacını DEĞİL, gerçek
 * kayıt sayısını gösterir (4/3 görünür). Faz 2B'de clamp'li değer ortak
 * çekirdekten (`exerciseProgress.doneUnits`) geldiği için ifade değişti;
 * `Math.max(..., recordedSets)` kuralı aynen duruyor.
 */
contains('panelde gerçek set sayısı', screen, 'const displayedSets = Math.max(exerciseProgress.doneUnits, recordedSets);');
/**
 * Bu iddianın KALICI anlamı "bitiş kararı ekranda satır içi hesaplanmıyor,
 * ortak saf yardımcıdan geliyor"dur. Yardımcının adı strength-only
 * `completesWholeWorkout`tan tür-farkında `completesWorkoutAfterSet`e taşındı;
 * iddia zayıflatılmadı, güncel yardımcıya bağlandı. Ayırt edici kontroller
 * A3b'de.
 */
contains('otomatik bitiş ortak yardımcıdan', screen, 'completesWorkoutAfterSet({');
check(
  'eski ham bitiş hesabı kaldırıldı',
  screen.includes('const completesWholeWorkout = totalCompletedSets + 1 >= totalTargetSets;'),
  false,
);
contains('aktif başlık gerçek sayıdan', screen, 'getActiveSetLabelNumber(activeActualSetCount)');
check(
  'aktif başlık artık clamp etmiyor',
  screen.includes('Math.min(activeCompletedSets + 1, activeExercise.targetSets)'),
  false,
);
contains('undo kalan gerçek sayıdan clamp', context, 'getDisciplineCountAfterUndo(remainingActualSetCount, targetSets)');
check(
  'undo artık ham çıkarma yapmıyor',
  context.includes('[progressKey]: Math.max((currentCounts[progressKey] ?? 0) - 1, 0),'),
  false,
);
contains('egzersiz ekle panelin altında', screen, 'styles.panelAddExerciseButton');
check(
  'egzersiz ekle aktif görünümde özet satırında değil',
  screen.includes('{isPlanMode && !day.isOffDay && ('),
  true,
);
contains('drop set satırı kaldırma 44pt', screen, 'height: Layout.minTouchSize,\n      justifyContent: \'center\',\n      width: Layout.minTouchSize,');
contains('drop set metinleri lokalize', screen, "t('day.dropSetValidation')");
check(
  'seti tamamla düğmesi drop satırlarının ALTINDA',
  screen.indexOf('styles.addDropSetButton') < screen.indexOf("t('day.completeSetLabel'"),
  true,
);

console.log('\n=== A3. Tür-farkında sözleşme (Faz 2A) ===');
/**
 * Bu grup, A ve A2'deki set-only dondurmaların ARTIK YETERSİZ kalan yanını
 * kapatır: eski kontroller "hedefe clamp ediliyor mu" diye soruyordu ama
 * `targetSets`in yalnızca strength egzersizde OKUNABİLİR olduğunu hiç
 * doğrulamıyordu. Kardiyo satırları veritabanından gelmeye başladığında bu
 * fark sessiz bir hataya dönüşürdü.
 */
const tracking = read('utils/workout-tracking.ts');
const programExercise = read('utils/program-exercise.ts');

contains('tip: üç takip türü tanımlı', types, "export type WorkoutTrackingMode = 'sets_reps' | 'duration' | 'distance'");
contains('tip: strength varyantı ayrık', types, 'export type StrengthProgramExercise');
contains('tip: ProgramExercise ayrık birleşim', types, 'export type ProgramExercise =');
contains('tip: kardiyoda targetSets ERİŞİLEMEZ', types, 'targetSets?: never;');
contains('tip: strength’te kardiyo hedefi ERİŞİLEMEZ', types, 'targetDurationSeconds?: never;');
contains('tip: daraltma korumacısı var', types, 'exercise is StrengthProgramExercise');

check(
  'sahte targetSets = 1 hiçbir istemci kaynağında yok',
  [types, context, screen, tracking, programExercise].some((file) => /targetSets:\s*1\b/.test(file)),
  false,
);

contains('completeSet strength dışını REDDEDİYOR', context, 'if (!isStrengthExercise(exercise)) {');
/** `completeSet` gövdesi — sıralama iddiaları dosyanın tamamında değil BURADA ölçülür. */
const completeSetBody = context.slice(
  context.indexOf('async function completeSet('),
  context.indexOf('async function undoCompletedSet('),
);
check(
  'completeSet gövdesi bulundu',
  completeSetBody.length > 200 && completeSetBody.includes("from('workout_sets')"),
  true,
);
check(
  'completeSet reddi INSERT’ten ÖNCE',
  (() => {
    const guardAt = completeSetBody.indexOf('if (!isStrengthExercise(exercise)) {');
    const insertAt = completeSetBody.indexOf("from('workout_sets')");
    // Eksik bir koruma `-1 < n` sayesinde SESSİZCE geçmemeli.
    return guardAt >= 0 && insertAt >= 0 && guardAt < insertAt;
  })(),
  true,
);
contains('undo strength dışını REDDEDİYOR', context, 'if (exercise && !isStrengthExercise(exercise)) {');

contains('aktif set ekranı TEK noktada daraltıyor', screen, '.filter(isStrengthExercise)');
check(
  'aktif ekranda daraltılmamış ikinci hedef toplaması yok',
  /\(day\?\.exercises[^)]*\)\.reduce/.test(screen.replace(/\s+/g, ' ')),
  false,
);

contains('yeni egzersiz yükü türü AÇIKÇA yazıyor', programExercise, "tracking_mode: 'sets_reps' as const");
contains('yeni egzersiz yükü kardiyo hedefini AÇIKÇA null bırakıyor', programExercise, 'target_duration_seconds: null');
/**
 * Faz 2A'da yol yalnız strength üretiyordu; Faz 2B'de aynı ortak yardımcı
 * ÜÇ modu da üretir. İddia zayıflatılmadı: yük hâlâ tek yerde kuruluyor ve
 * ekran satır içi nesne yazmıyor.
 */
contains('ekleme yolu ortak yükü kullanıyor', context, 'buildProgramExerciseInsertPayload(exercise, {');

contains('aktivite kayıtları OKUNUYOR', context, "from('workout_activity_records')");
/**
 * FAZ 2A'YA ÖZGÜ İDDİA KALDIRILDI, YERİNE GERÇEK SÖZLEŞME KONDU.
 *
 * "Aktivite yazma yolu yok" iddiası Faz 2A turunda doğruydu; Faz 2B yazma
 * yolunu KASITLI olarak ekler. Boş bir yoklukla değil, yazmanın hangi kapılardan
 * geçtiğiyle ölçülür. Ayrıntılı yük/immutable/delta sözleşmesi
 * `scripts/verify-activity-tracking-client-write.mjs` içindedir.
 */
contains('aktivite yazma yolu strength’i REDDEDİYOR', context, 'if (!isCardioExercise(exercise)) {');
contains('aktivite yazma yolu aktif oturum İSTİYOR', context, "if (!session) throw new Error('Aktiviteyi kaydetmek için antrenmanı başlatmalısın.');");
contains('aktivite toplamları delta ile düzeltiliyor', context, 'applyActivityTotalsDelta(');
check(
  'aktivite UPDATE’i kayıt kimliğiyle hedefleniyor — ikinci satır yok',
  /\.update\(performancePayload\)[\s\S]{0,80}\.eq\('id', existing\.id\)/.test(context),
  true,
);

console.log('\n--- A3b. Otomatik bitiş tür-farkında ---');
/**
 * ESKİ SÖZLEŞME YETERSİZDİ: A2'deki "eski ham bitiş hesabı kaldırıldı"
 * kontrolü yalnızca `totalCompletedSets + 1 >= totalTargetSets` metninin
 * ekranda bulunmadığını doğruluyordu. Hesap `completesWholeWorkout`
 * yardımcısına taşındığında metin kayboldu ama YALNIZ STRENGTH toplamlarıyla
 * beslenmeye devam etti; karma bir günde eksik kardiyo hedefi görünmezdi.
 * Aşağıdaki kontroller kararın gerçekten BÜTÜN egzersizler üzerinden
 * verildiğini ölçer.
 */
contains('otomatik bitiş tür-farkında yardımcıdan', screen, 'completesWorkoutAfterSet({');
contains('karar BÜTÜN egzersizleri alıyor', screen, 'exercises: day?.exercises ?? [],');
contains('karar mevcut aktivite toplamlarını alıyor', screen, 'activityTotals,');
check(
  'strength-only toplamları ARTIK otomatik bitiş kaynağı değil',
  /computeCompletesWholeWorkout|completesWholeWorkout\s*\(/.test(screen),
  false,
);
check(
  'karar girdisi dayExercises (strength filtresi) DEĞİL',
  /completesWorkoutAfterSet\(\{[\s\S]{0,400}?exercises:\s*dayExercises/.test(screen),
  false,
);
check(
  'bitiş kontrolü set INSERT’inden SONRA',
  (() => {
    const body = screen.slice(
      screen.indexOf('async function handleCompleteSet('),
      screen.indexOf('async function handleCompleteSet(') + 3000,
    );
    const awaitAt = body.indexOf('await completeSet(todayKey');
    const decideAt = body.indexOf('completesWorkoutAfterSet({');
    // Eksik bir çağrı `-1 < n` sayesinde SESSİZCE geçmemeli.
    return awaitAt >= 0 && decideAt >= 0 && awaitAt < decideAt;
  })(),
  true,
);
contains('karar matematiği ortak çekirdekte', tracking, 'export function completesWorkoutAfterSet');
contains('öngörü ortak çekirdekte', tracking, 'export function resolveProjectedSetProgress');
contains('öngörü ortak katkı kuralını kullanıyor', tracking, 'contributesToPlannedProgress(clampedCount, completed.targetSets)');
/**
 * KALICI ANLAM: ekran mode-aware matematiği YENİDEN YAZMAZ. Faz 2A'da bu,
 * "çekirdek adları ekranda hiç geçmesin" diye ölçülüyordu; Faz 2B'de ekran
 * kardiyo ilerlemesini göstermek zorunda olduğu için çekirdeği İÇE AKTARARAK
 * kullanır — doğru olan da budur. İddia, satır içi ikinci formülün
 * bulunmadığına daraltıldı.
 */
check(
  'ekranda satır içi ikinci hedef/ilerleme formülü yok',
  /reduce\([^)]*exercise\.target(Sets|DurationSeconds|DistanceMeters)/.test(screen.replace(/\s+/g, ' ')),
  false,
);
check(
  'kardiyo ilerlemesi ortak çekirdekten okunuyor',
  /resolveExerciseProgress\(\s*exercise,/.test(screen) && /exerciseTargetUnits\(exercise\)/.test(screen),
  true,
);
contains('mode-aware yardımcılar ortak modülden import ediliyor', screen, "} from '@/utils/workout-tracking';");

contains('takvim ortak ilerleme çekirdeğini kullanıyor', read('components/discipline-calendar.tsx'), 'resolveDayProgress');
contains('disiplin hesabı ortak çekirdeği kullanıyor', read('utils/workout-schedule.ts'), 'resolveDayProgress');

// ---------------------------------------------------------------------------
console.log('\n=== B. Davranış modeli ===');

/** `completeSet` modeli. */
function completeSet(state, { programExerciseId, targetSets, performance }) {
  const rows = state.sets.filter((row) => row.programExerciseId === programExerciseId);
  const highest = rows.reduce((max, row) => Math.max(max, row.setNumber), 0);
  const setNumber = highest + 1;
  state.sets.push({
    programExerciseId,
    setNumber,
    weightKg: performance.weightKg,
    repetitions: performance.repetitions,
    dropSets: performance.dropSets ?? [],
  });
  state.counts[programExerciseId] = Math.min((state.counts[programExerciseId] ?? 0) + 1, targetSets);
  // Ödül/Rosea tepkisi ana set başına BİR kez.
  state.rewardCalls += 1;
  return setNumber;
}

/** `undoCompletedSet` modeli. */
function undoCompletedSet(state, programExerciseId) {
  if ((state.counts[programExerciseId] ?? 0) === 0) return undefined;
  const rows = state.sets.filter((row) => row.programExerciseId === programExerciseId);
  const last = rows.reduce((max, row) => Math.max(max, row.setNumber), 0);
  if (last === 0) return undefined;
  state.sets = state.sets.filter(
    (row) => !(row.programExerciseId === programExerciseId && row.setNumber === last),
  );
  state.counts[programExerciseId] = Math.max((state.counts[programExerciseId] ?? 0) - 1, 0);
  return last;
}

const world = { sets: [], counts: {}, rewardCalls: 0 };
const EX = 'ex1';
const TARGET = 3;

for (let i = 0; i < TARGET; i += 1) {
  completeSet(world, { programExerciseId: EX, targetSets: TARGET, performance: { repetitions: 8, weightKg: 60 } });
}
check('4) hedef kadar set kaydedildi', world.sets.length, 3);
check('disiplin sayacı hedefte', world.counts[EX], 3);

// Ekstra (4.) set
const extraSetNumber = completeSet(world, {
  programExerciseId: EX,
  targetSets: TARGET,
  performance: { repetitions: 6, weightKg: 50 },
});
check('4) ekstra set kaydedilebiliyor', world.sets.length, 4);
check('ekstra set gerçek numarayla (4)', extraSetNumber, 4);
check('6) ekstra set disiplini hedefin üstüne çıkarmıyor', world.counts[EX], 3);

// Undo → gerçek son set (4)
check('5) undo 4. seti siliyor', undoCompletedSet(world, EX), 4);
check('kalan setler 1..3', world.sets.map((r) => r.setNumber), [1, 2, 3]);

// Drop setler
const withDrops = { sets: [], counts: {}, rewardCalls: 0 };
completeSet(withDrops, {
  programExerciseId: EX,
  targetSets: TARGET,
  performance: {
    repetitions: 8,
    weightKg: 60,
    dropSets: [
      { repetitions: 6, weightKg: 40 },
      { repetitions: 4, weightKg: 30 },
    ],
  },
});
check('11) iki drop set doğru sırayla saklandı', withDrops.sets[0].dropSets.map((d) => d.weightKg), [40, 30]);
check('12) drop setler tamamlanan set sayısını artırmıyor', withDrops.sets.length, 1);
check('12) drop setler disiplin sayacını artırmıyor', withDrops.counts[EX], 1);
check('12) ödül/tepki ana set için bir kez', withDrops.rewardCalls, 1);

// Hacim
const totalVolume = (row) =>
  (row.weightKg ?? 0) * (row.repetitions ?? 0) +
  row.dropSets.reduce((sum, d) => sum + (d.weightKg ?? 0) * d.repetitions, 0);
check('13) drop hacmi toplam hacme dahil', totalVolume(withDrops.sets[0]), 60 * 8 + 40 * 6 + 30 * 4);

// Drop set doğrulama
/** Ekrandaki `parseNumberInput` ile AYNI: boş metin `undefined` döner. */
function parseNumberInput(value) {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}
/** Ekrandaki `parseOptionalNumberInput`: boş → undefined, geçersiz → null. */
function parseOptionalNumberInput(value) {
  if (!value.trim()) return undefined;
  const parsed = parseNumberInput(value);
  return parsed === undefined ? null : parsed;
}

function validateDropDrafts(drafts) {
  const result = [];
  for (const draft of drafts) {
    if (draft.weight.trim() === '' && draft.reps.trim() === '') continue;
    const reps = parseNumberInput(draft.reps);
    const weight = parseOptionalNumberInput(draft.weight);
    if (reps === undefined || !Number.isInteger(reps) || reps < 0 || reps > 1000) {
      return { error: 'dropSetValidation' };
    }
    if (weight === null || (weight !== undefined && (weight < 0 || weight > 99999))) {
      return { error: 'dropSetValidation' };
    }
    result.push(weight === undefined ? { repetitions: reps } : { repetitions: reps, weightKg: weight });
  }
  return { data: result };
}
check('9) tamamen boş satır kayda girmiyor', validateDropDrafts([{ weight: '', reps: '' }]).data, []);
check('10) kısmen doldurulmuş satır engelliyor', validateDropDrafts([{ weight: '40', reps: '' }]).error, 'dropSetValidation');
check('ağırlıksız drop set geçerli', validateDropDrafts([{ weight: '', reps: '10' }]).data, [{ repetitions: 10 }]);
check('10) ağırlık dolu tekrar boş → hata', validateDropDrafts([{ weight: '40', reps: '' }]).error, 'dropSetValidation');
check('geçersiz metin ağırlık → hata', validateDropDrafts([{ weight: 'abc', reps: '8' }]).error, 'dropSetValidation');
check('ondalık tekrar → hata', validateDropDrafts([{ weight: '40', reps: '8.5' }]).error, 'dropSetValidation');

// Mola biçimlendirme
function formatRest({ isOvertime, totalRestSeconds, remainingSeconds }) {
  const seconds = isOvertime ? totalRestSeconds : remainingSeconds;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
check('8) 180 sn mola, 1 sn aşımda 03:01', formatRest({ isOvertime: true, totalRestSeconds: 181, remainingSeconds: 0 }), '03:01');
check('8) 2 sn aşımda 03:02', formatRest({ isOvertime: true, totalRestSeconds: 182, remainingSeconds: 0 }), '03:02');
check('hedef dolmadan geri sayım', formatRest({ isOvertime: false, totalRestSeconds: 12, remainingSeconds: 168 }), '02:48');
check('tam bitiş anı 00:00', formatRest({ isOvertime: false, totalRestSeconds: 180, remainingSeconds: 0 }), '00:00');

// Eski kayıt güvenliği
function parseDropSets(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const reps = Number(item.repetitions);
    if (!Number.isInteger(reps) || reps < 0 || reps > 1000) return [];
    if (item.weightKg === undefined || item.weightKg === null) return [{ repetitions: reps }];
    const weight = Number(item.weightKg);
    if (!Number.isFinite(weight) || weight < 0 || weight > 99999) return [];
    return [{ repetitions: reps, weightKg: weight }];
  });
}
check('19) null drop_sets → []', parseDropSets(null), []);
check('19) eksik alan → []', parseDropSets(undefined), []);
check('geçersiz eleman atılıyor', parseDropSets([{ repetitions: 'x' }, { repetitions: 5 }]), [{ repetitions: 5 }]);
check('metin değer → []', parseDropSets('[]'), []);

// ---------------------------------------------------------------------------
// C. REGRESYONLAR — GERÇEK yardımcı fonksiyonlarla
// ---------------------------------------------------------------------------
console.log('\n=== C. Regresyonlar (gerçek utils/workout-sets fonksiyonları) ===');

const SESSION = 's1';

/** Eski (hatalı) bitiş hesabı — testin gerçekten hata yakaladığını kanıtlar. */
function legacyCompletesWholeWorkout({ totalCompletedSets, totalTargetSets }) {
  return totalCompletedSets + 1 >= totalTargetSets;
}

// 1) 9/10 iken TAMAMLANMIŞ egzersize ekstra set → workout BİTMEZ.
const extraOnComplete = {
  completedSets: 3,
  targetSets: 3,
  totalCompletedSets: 9,
  totalTargetSets: 10,
};
check('C1) ekstra set 9/10 iken workout bitirmiyor', realCompletesWholeWorkout(extraOnComplete), false);
check('C1) ekstra set plan ilerlemesine katkı vermiyor', contributesToPlannedProgress(3, 3), false);
check(
  'C1) ESKİ kod bu hatayı yapıyordu (test gerçekten yakalıyor)',
  legacyCompletesWholeWorkout(extraOnComplete),
  true,
);

// 2) 9/10 iken gerçek son EKSİK planlı set → workout BİTER.
const lastPlanned = {
  completedSets: 2,
  targetSets: 3,
  totalCompletedSets: 9,
  totalTargetSets: 10,
};
check('C2) son eksik planlı set workout bitiriyor', realCompletesWholeWorkout(lastPlanned), true);
check('C2) bu set plan ilerlemesine katkı veriyor', contributesToPlannedProgress(2, 3), true);

// Ara planlı set antrenmanı bitirmez.
check(
  'C2b) ortadaki planlı set bitirmiyor',
  realCompletesWholeWorkout({ completedSets: 1, targetSets: 3, totalCompletedSets: 5, totalTargetSets: 10 }),
  false,
);

// 3) 4/3 undo → 3/3
const sets4 = [1, 2, 3, 4].map((setNumber) => ({
  sessionId: SESSION,
  programExerciseId: EX,
  setNumber,
}));
check('C3) 4/3 gerçek set sayısı', getActualSetCount(sets4, SESSION, EX), 4);
check('C3) undo hedefi gerçek en yüksek set (4)', getHighestSetNumber(sets4, SESSION, EX), 4);
check('C3) 4/3 undo sonrası disiplin sayacı 3/3', getDisciplineCountAfterUndo(3, 3), 3);

// 4) 3/3 undo → 2/3, ve zinciri sonuna kadar
check('C4) 3/3 undo → 2/3', getDisciplineCountAfterUndo(2, 3), 2);
check('C4) 2/3 undo → 1/3', getDisciplineCountAfterUndo(1, 3), 1);
check('C4) 1/3 undo → 0/3', getDisciplineCountAfterUndo(0, 3), 0);
check('C4) sayaç negatife düşmüyor', getDisciplineCountAfterUndo(-1, 3), 0);
check('C4) 5/3 undo → 4 kalan yine 3/3', getDisciplineCountAfterUndo(4, 3), 3);

// 5-7) Manuel ekstra set modu
function resolveManualSelection(isComplete) {
  // Ekrandaki `setIsManualSelection(isComplete)` ile aynı kural.
  return isComplete;
}
check('C5) tamamlanmamış egzersize dokunma ekstra modu AÇMIYOR', resolveManualSelection(false), false);
check('C7) tamamlanmış egzersize dokunma ekstra modu açıyor', resolveManualSelection(true), true);

// 6) Tamamlanmamış egzersiz tamamlanınca seçim bırakılır (otomatik geçiş).
function shouldReleaseSelection({ completedSets, targetSets, isManualSelection }) {
  if (isManualSelection) return false;
  return completedSets >= targetSets;
}
check(
  'C6) manuel olmayan seçim, hedef dolunca bırakılıyor',
  shouldReleaseSelection({ completedSets: 3, targetSets: 3, isManualSelection: false }),
  true,
);
check(
  'C6) hedef dolmadan seçim korunuyor',
  shouldReleaseSelection({ completedSets: 2, targetSets: 3, isManualSelection: false }),
  false,
);
check(
  'C7b) ekstra set modunda seçim bırakılmıyor',
  shouldReleaseSelection({ completedSets: 3, targetSets: 3, isManualSelection: true }),
  false,
);

// 8) Aktif başlık ekstra sette 4/3
check('C8) normal akış başlığı 1,2,3', [0, 1, 2].map((count) => getActiveSetLabelNumber(count)), [1, 2, 3]);
check('C8) ilk ekstra set başlığı 4', getActiveSetLabelNumber(3), 4);
check('C8) sonraki ekstra set başlığı 5', getActiveSetLabelNumber(4), 5);

// 9) Drop set hiçbir sayacı ayrıca artırmıyor
const dropWorld = { sets: [], counts: {}, rewardCalls: 0 };
completeSet(dropWorld, {
  programExerciseId: EX,
  targetSets: 3,
  performance: { repetitions: 8, weightKg: 60, dropSets: [{ repetitions: 6, weightKg: 40 }] },
});
check('C9) drop set gerçek set sayısını artırmıyor', getActualSetCount(
  dropWorld.sets.map((row) => ({ ...row, sessionId: SESSION })),
  SESSION,
  EX,
), 1);
check('C9) drop set plan sayacını artırmıyor', dropWorld.counts[EX], 1);
check('C9) drop set ödül çağrısını artırmıyor', dropWorld.rewardCalls, 1);
check(
  'C9) drop setli set de plan katkısı kuralına tabi',
  realCompletesWholeWorkout({ completedSets: 3, targetSets: 3, totalCompletedSets: 9, totalTargetSets: 10 }),
  false,
);

console.log(`\n${fail === 0 ? 'TÜMÜ GEÇTİ' : 'BAŞARISIZ VAR'} — ${pass} geçti, ${fail} kaldı`);
process.exit(fail === 0 ? 0 : 1);
