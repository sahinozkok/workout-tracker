/**
 * FAZ 2E-2 — Geçmiş kardiyo kaydı DÜZENLE/SİL veri akışı.
 *
 * İki katman denetlenir:
 *  1) GERÇEK saf çekirdek (`applyActivityTotalsDelta`, `getActivityProgressKey`)
 *     tsc ile derlenip ÇAĞRILIR — toplam delta davranışı gerçek koddan ölçülür.
 *  2) `context/workout-context.tsx` `updateActivityRecord` ve migration guard'ın
 *     KAYNAK SÖZLEŞMESİ taranır: yalnız izinli kolonlar, `completed_at` ve
 *     snapshot korunur, optimistic veri kaybı yok, ödül yeniden verilmez.
 *
 * Çalıştırma:  node scripts/verify-activity-write-client.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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

// ---------------------------------------------------------------------------
// 1) GERÇEK saf çekirdek
// ---------------------------------------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), 'rosea-activity-write-'));
let tracking;
try {
  const shim = join(outDir, 'types-workout-shim.ts');
  writeFileSync(
    shim,
    ['ProgramExercise', 'WorkoutActivityRecord', 'WorkoutSetRecord'].map((n) => `export type ${n} = any;\n`).join(''),
  );
  for (const [relative, outName] of [
    ['utils/workout-sets.ts', 'workout-sets'],
    ['utils/workout-tracking.ts', 'workout-tracking'],
  ]) {
    const patched = source(relative)
      .replace(/from '@\/types\/workout'/g, "from './types-workout-shim'")
      .replace(/from '@\/utils\/workout-sets'/g, "from './workout-sets.js'");
    const copy = join(outDir, `${outName}.ts`);
    writeFileSync(copy, patched);
    execFileSync(
      'npx',
      ['tsc', copy, shim, '--outDir', outDir, '--target', 'es2020', '--module', 'esnext',
       '--moduleResolution', 'bundler', '--strict', '--skipLibCheck'],
      { cwd: ROOT, stdio: 'pipe' },
    );
  }
  tracking = await import(pathToFileURL(join(outDir, 'workout-tracking.js')).href);
} catch (error) {
  console.error('Saf çekirdek derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}
const { applyActivityTotalsDelta, getActivityProgressKey } = tracking;

const KEY = getActivityProgressKey('2026-09-01', 'run');

check('Düzenleme: eski katkı çıkar, yeni katkı eklenir', () => {
  const totals = { [KEY]: { durationSeconds: 600, distanceMeters: 2000 } };
  const next = applyActivityTotalsDelta(
    totals,
    { dateKey: '2026-09-01', programExerciseId: 'run', durationSeconds: 600, distanceMeters: 2000 },
    { dateKey: '2026-09-01', programExerciseId: 'run', durationSeconds: 500, distanceMeters: 1500 },
  );
  assertEqual(next[KEY].durationSeconds, 500, 'süre deltası yanlış');
  assertEqual(next[KEY].distanceMeters, 1500, 'mesafe deltası yanlış');
});

check('Düzenleme: aynı günün BAŞKA oturum katkısı korunur', () => {
  // 400+600 süre, 1000+2000 mesafe (iki oturum aynı anahtarda toplanmış).
  const totals = { [KEY]: { durationSeconds: 1000, distanceMeters: 3000 } };
  const next = applyActivityTotalsDelta(
    totals,
    { dateKey: '2026-09-01', programExerciseId: 'run', durationSeconds: 600, distanceMeters: 2000 },
    { dateKey: '2026-09-01', programExerciseId: 'run', durationSeconds: 500, distanceMeters: 1500 },
  );
  assertEqual(next[KEY].durationSeconds, 900, 'diğer oturum süresi bozuldu');
  assertEqual(next[KEY].distanceMeters, 2500, 'diğer oturum mesafesi bozuldu');
});

check('Silme: kaydın katkısı toplamlardan düşer', () => {
  const totals = { [KEY]: { durationSeconds: 1000, distanceMeters: 3000 } };
  const next = applyActivityTotalsDelta(
    totals,
    { dateKey: '2026-09-01', programExerciseId: 'run', durationSeconds: 600, distanceMeters: 2000 },
    undefined,
  );
  assertEqual(next[KEY].durationSeconds, 400, 'silme sonrası süre yanlış');
  assertEqual(next[KEY].distanceMeters, 1000, 'silme sonrası mesafe yanlış');
});

check('Plandan kopuk kayıt (programExerciseId yok) toplamları etkilemez', () => {
  const totals = { [KEY]: { durationSeconds: 600, distanceMeters: 2000 } };
  const next = applyActivityTotalsDelta(
    totals,
    { dateKey: '2026-09-01', programExerciseId: undefined, durationSeconds: 600, distanceMeters: 2000 },
    { dateKey: '2026-09-01', programExerciseId: undefined, durationSeconds: 100, distanceMeters: 100 },
  );
  assertEqual(next[KEY].durationSeconds, 600, 'kopuk kayıt toplamı değiştirdi');
});

check('Toplamlar negatife düşmez (Math.max kapaması)', () => {
  const totals = { [KEY]: { durationSeconds: 100, distanceMeters: 100 } };
  const next = applyActivityTotalsDelta(
    totals,
    { dateKey: '2026-09-01', programExerciseId: 'run', durationSeconds: 9999, distanceMeters: 9999 },
    undefined,
  );
  assertEqual(next[KEY].durationSeconds, 0, 'süre negatife düştü');
  assertEqual(next[KEY].distanceMeters, 0, 'mesafe negatife düştü');
});

// ---------------------------------------------------------------------------
// 2) Context updateActivityRecord SÖZLEŞMESİ
// ---------------------------------------------------------------------------
const contextRaw = source('context/workout-context.tsx');
const context = stripComments(contextRaw);
// updateActivityRecord gövdesini yalıt.
const updateBody = context.slice(
  context.indexOf('async function updateActivityRecord'),
  context.indexOf('async function deleteActivityRecord'),
);

check('Yalnız izinli kolonlar yazılır (duration/distance/rpe)', () => {
  assert(updateBody.includes('duration_seconds: performance.durationSeconds'), 'duration_seconds yazılmıyor');
  assert(updateBody.includes('distance_meters: performance.distanceMeters ?? null'), 'distance_meters yazılmıyor');
  assert(updateBody.includes('rpe: performance.rpe ?? null'), 'rpe yazılmıyor');
});

check('completed_at ve kimlik/snapshot alanları yük\'e KONMAZ', () => {
  const payload = updateBody.slice(updateBody.indexOf('.update('), updateBody.indexOf('.eq('));
  assert(!/completed_at/.test(payload), 'completed_at güncelleniyor');
  assert(!/session_id/.test(payload), 'session_id güncelleniyor');
  assert(!/program_exercise_id/.test(payload), 'program_exercise_id güncelleniyor');
  assert(!/exercise_name/.test(payload), 'exercise_name güncelleniyor');
  assert(!/tracking_mode/.test(payload), 'tracking_mode güncelleniyor');
  assert(!/target_duration_seconds|target_distance_meters/.test(payload), 'hedef snapshot güncelleniyor');
});

check('Doğru satır: .eq(\'id\', recordId) ve mevcut RLS (yeni tablo yok)', () => {
  assert(/\.eq\('id', recordId\)/.test(updateBody), "id ile hedeflenmiyor");
  assert(/from\('workout_activity_records'\)/.test(updateBody), 'mevcut tablo kullanılmıyor');
});

check('Sunucu güncellenen satırı doğrular; 0 satır sessiz başarı sayılmaz', () => {
  assert(
    /\.eq\('id', recordId\)\s*\.select\('id'\)\s*\.single\(\)/.test(updateBody),
    'güncellenen satır sunucudan doğrulanmıyor',
  );
});

check('Optimistic veri kaybı yok: hata state değişiminden ÖNCE fırlar', () => {
  const errorThrow = updateBody.indexOf('if (error) throw error;');
  const totalsWrite = updateBody.indexOf('setActivityTotals(');
  const recordsWrite = updateBody.indexOf('setWorkoutActivityRecords(');
  assert(errorThrow > 0, 'hata fırlatma yok');
  assert(errorThrow < totalsWrite && errorThrow < recordsWrite, 'yerel state hata kontrolünden önce yazılıyor');
});

check('Toplam düzeltmesi applyActivityTotalsDelta ile (eski→yeni)', () => {
  assert(/applyActivityTotalsDelta\(/.test(updateBody), 'delta yardımcısı kullanılmıyor');
});

check('Mesafe türünde mesafe zorunlu', () => {
  assert(
    /trackingMode === 'distance' && performance\.distanceMeters === undefined/.test(updateBody),
    'mesafe türünde mesafe zorunluluğu yok',
  );
});

check('Rank güvenle yeniden senkronlanır; ödül YENİDEN verilmez', () => {
  assert(/void syncRank\?\.\(\);/.test(updateBody), 'syncRank çağrısı yok');
  // Ödül defterini yeniden işleyecek gün senkronu düzenlemede tetiklenmez
  // (save akışının aksine); ledger append-only olduğu için geri alma da yok.
  assert(!/syncWorkoutDay\(/.test(updateBody), 'düzenlemede syncWorkoutDay ödül yolu tetikleniyor');
  assert(!/reward|grantReward|addReward/i.test(updateBody), 'düzenlemede doğrudan ödül veriliyor');
});

check('Silme mevcut deleteActivityRecord ile; ödül geri alınmaz', () => {
  const deleteBody = context.slice(
    context.indexOf('async function deleteActivityRecord'),
    context.indexOf('async function resetCompletedSets'),
  );
  assert(/\.delete\(\)\.eq\('id', recordId\)/.test(deleteBody), 'silme id ile hedeflenmiyor');
  assert(/void syncRank\?\.\(\);/.test(deleteBody), 'silmede syncRank yok');
  assert(!/reward|grantReward/i.test(deleteBody), 'silmede ödül işleniyor');
});

// ---------------------------------------------------------------------------
// 3) Sunucu GUARD sözleşmesi (mevcut migration yeterli — yeni migration yok)
// ---------------------------------------------------------------------------
const migration = source('supabase/migrations/20260905120000_add_activity_tracking_foundation.sql');

check('Guard kimlik/snapshot değişimini reddeder (server-side)', () => {
  assert(/activity_session_immutable/.test(migration), 'session immutability guard yok');
  assert(/activity_snapshot_immutable/.test(migration), 'snapshot immutability guard yok');
  assert(/DÜZENLENEBİLİR[\s\S]*duration_seconds`, `distance_meters`, `rpe`/.test(migration), 'düzenlenebilir kolon sözleşmesi yok');
});

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n✗ Edit/delete veri akışı harness başarısız — ${pass} geçti, ${failures.length} kaldı:`);
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log(`\n✓ Kardiyo edit/delete veri akışı: ${pass} kontrol geçti (gerçek delta çekirdeği + sözleşme).`);
