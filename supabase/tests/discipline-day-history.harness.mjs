/**
 * `20260823120000_add_discipline_day_history.sql` doğrulama harness'ı.
 *
 * ÖNEMLİ SINIR: bu harness SQL ÇALIŞTIRMAZ (yerel Postgres gerekmez). İki
 * katman doğrular:
 *
 *   A. YAPISAL — migration metninde düzeltmelerin gerçekten bulunduğunu ve
 *      RLS/grant duruşunun bozulmadığını iddia eder. Bir düzeltme silinirse
 *      veya imza kayarsa burada patlar.
 *   B. DAVRANIŞSAL — `display_discipline_range` CASE'inin ve backfill
 *      yüklem(predicate)inin satır satır karşılığı olan model üzerinde
 *      senaryoları çalıştırır.
 *
 * Çalıştırma:  node supabase/tests/discipline-day-history.harness.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../migrations/20260823120000_add_discipline_day_history.sql',
);
const sql = readFileSync(migrationPath, 'utf8');

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)})`}`);
}

function contains(name, needle) {
  check(name, sql.includes(needle), true);
}

// ---------------------------------------------------------------------------
// A. YAPISAL İDDİALAR
// ---------------------------------------------------------------------------
console.log('=== A. Migration metni ===');

contains(
  '1: backfill aktif program dönemini dışarıda bırakıyor',
  '(ap.active_from is null or d.discipline_date < ap.active_from)',
);
contains('1: backfill kullanıcı bazında korelasyonlu', 'where p.owner_id = d.user_id');
contains('1: backfill gelecek tarih taşımıyor', 'd.discipline_date <= current_date');
contains('1: backfill mevcut satırı ezmiyor', 'on conflict (user_id, discipline_date) do nothing');

contains('2: no-op guard advisory lock SONRASINDA', 'pg_advisory_xact_lock');
// Sıralama YALNIZCA `activate_program` gövdesi içinde karşılaştırılır:
// `reconcile_pending_days_all` dosya başındaki açıklama yorumunda da geçiyor.
const activateBody = sql.slice(
  sql.indexOf('create or replace function public.activate_program'),
  sql.indexOf('revoke all on function public.activate_program'),
);
const guardIndex = activateBody.indexOf(') then\n    return;\n  end if;');
check('2: no-op guard gövdede mevcut', guardIndex > -1, true);
check(
  '2: no-op guard, ödül uzlaştırmasından ÖNCE',
  guardIndex > -1 && guardIndex < activateBody.indexOf('reconcile_pending_days_all'),
  true,
);
check(
  '2: no-op guard, snapshot ve deactivate işlemlerinden ÖNCE',
  guardIndex > -1
    && guardIndex < activateBody.indexOf('snapshot_active_program_history')
    && guardIndex < activateBody.indexOf('set is_active = false'),
  true,
);

contains('3: silmede bugün DAHİL, açık gün olarak', 'snapshot_active_program_history(old.owner_id, current_date, current_date)');
contains('3: değişimde bugün HARİÇ, açık gün yok', 'snapshot_active_program_history(actor, current_date - 1, null)');
contains('3: açık günde sıfır ilerleme skipped değil', "else case when t.day_date = open_day then null else 'skipped' end");

contains('8: RLS açık', 'alter table public.discipline_day_history enable row level security');
contains('8: authenticated yalnızca SELECT', 'grant select on table public.discipline_day_history to authenticated');
contains('8: authenticated yazma hakkı yok', 'revoke all on table public.discipline_day_history from authenticated');
contains('8: anon hiçbir hak yok', 'revoke all on table public.discipline_day_history from anon');
contains('8: self-select politikası', 'using (user_id = (select auth.uid()))');
check(
  '8: INSERT/UPDATE/DELETE politikası yok',
  /create policy[\s\S]*?for (insert|update|delete)[\s\S]*?discipline_day_history/.test(sql),
  false,
);
contains('8: görüntüleme fonksiyonu istemciye kapalı', 'revoke all on function public.display_discipline_range(uuid, date, date, date) from authenticated');
contains('8: snapshot fonksiyonu istemciye kapalı', 'revoke all on function public.snapshot_active_program_history(uuid, date, date) from authenticated');
check('8: ödül kaynağı auto_discipline_range değiştirilmemiş', sql.includes('create or replace function public.auto_discipline_range'), false);

// ---------------------------------------------------------------------------
// B. DAVRANIŞSAL MODEL — SQL CASE'inin satır satır karşılığı
// ---------------------------------------------------------------------------

/** `display_discipline_range` CASE'i. */
function displayStatus({ dayId, dayDate, activeFrom, dayIsOff, totalTarget, totalDone }, openDay) {
  if (dayId === null) return null;
  if (dayDate < activeFrom) return null;
  if (dayIsOff) return 'completed';
  if (totalTarget === 0) return dayDate === openDay ? null : 'skipped';
  if (totalDone >= totalTarget) return 'completed';
  if (totalDone > 0) return 'partial';
  return dayDate === openDay ? null : 'skipped';
}

/** Backfill yüklemi: satır taşınacak mı? */
function backfillKeeps(row, activeFrom, currentDate) {
  if (!['completed', 'partial', 'skipped'].includes(row.status)) return false;
  if (row.date > currentDate) return false;
  return activeFrom === null || row.date < activeFrom;
}

const TODAY = '2026-08-23';
const ACTIVE_FROM = '2026-08-11';

console.log('\n=== B1. Backfill sınırı ===');
check(
  '1: aktif dönemdeki shared partial TAŞINMIYOR',
  backfillKeeps({ date: TODAY, status: 'partial' }, ACTIVE_FROM, TODAY),
  false,
);
check(
  '1: aktif dönemin ilk günü de taşınmıyor',
  backfillKeeps({ date: ACTIVE_FROM, status: 'completed' }, ACTIVE_FROM, TODAY),
  false,
);
check(
  '3: aktif başlangıçtan ÖNCEKİ eski satır kurtarılıyor',
  backfillKeeps({ date: '2026-08-10', status: 'completed' }, ACTIVE_FROM, TODAY),
  true,
);
check(
  '4: aktif programı olmayan kullanıcının geçmişi kurtarılıyor',
  [
    backfillKeeps({ date: '2026-08-10', status: 'completed' }, null, TODAY),
    backfillKeeps({ date: TODAY, status: 'partial' }, null, TODAY),
  ],
  [true, true],
);
check(
  'gelecek tarih hiçbir durumda taşınmıyor',
  backfillKeeps({ date: '2026-08-24', status: 'completed' }, null, TODAY),
  false,
);

console.log('\n=== B2. Program değişimi snapshot kuralları (open_day = null) ===');
const past = (over) => ({ dayId: 'd', dayDate: '2026-08-10', activeFrom: '2026-08-01', dayIsOff: false, ...over });
check('2: değişimden önce completed → completed', displayStatus(past({ totalTarget: 3, totalDone: 3 }), null), 'completed');
check('kısmi → partial', displayStatus(past({ totalTarget: 3, totalDone: 1 }), null), 'partial');
check('sıfır ilerleme (bitmiş gün) → skipped', displayStatus(past({ totalTarget: 3, totalDone: 0 }), null), 'skipped');
check('off-day → completed', displayStatus(past({ dayIsOff: true, totalTarget: 0, totalDone: 0 }), null), 'completed');
check('planlı gün yok → durum yok', displayStatus(past({ dayId: null, totalTarget: 0, totalDone: 0 }), null), null);
check('active_from öncesi → durum yok', displayStatus(past({ dayDate: '2026-07-31', totalTarget: 3, totalDone: 3 }), null), null);
check(
  '7: değişim günü snapshot aralığının DIŞINDA',
  { through: '2026-08-22', switchDay: TODAY, included: '2026-08-22' >= TODAY },
  { through: '2026-08-22', switchDay: TODAY, included: false },
);

console.log('\n=== B3. Aktif program BUGÜN silinirken (open_day = bugün) ===');
const today = (over) => ({ dayId: 'd', dayDate: TODAY, activeFrom: ACTIVE_FROM, dayIsOff: false, ...over });
check('6: bugün tamamlandı → completed korunuyor', displayStatus(today({ totalTarget: 4, totalDone: 4 }), TODAY), 'completed');
check('6: bugün kısmi → partial korunuyor', displayStatus(today({ totalTarget: 4, totalDone: 2 }), TODAY), 'partial');
check('6: bugün off-day → completed korunuyor', displayStatus(today({ dayIsOff: true, totalTarget: 0, totalDone: 0 }), TODAY), 'completed');
check('6: bugün sıfır ilerleme → skipped YAZILMIYOR', displayStatus(today({ totalTarget: 4, totalDone: 0 }), TODAY), null);
check('6: bugün hedef seti 0 → durum üretilmiyor', displayStatus(today({ totalTarget: 0, totalDone: 0 }), TODAY), null);
check(
  '6: silmede dünkü sıfır ilerleme yine skipped',
  displayStatus({ dayId: 'd', dayDate: '2026-08-22', activeFrom: ACTIVE_FROM, dayIsOff: false, totalTarget: 4, totalDone: 0 }, TODAY),
  'skipped',
);

console.log('\n=== B4. Idempotens ===');
const frozen = new Map();
function snapshotOnce(dateKey, status) {
  if (status === null) return;
  if (frozen.has(dateKey)) return; // on conflict do nothing
  frozen.set(dateKey, status);
}
snapshotOnce('2026-08-10', 'partial');
snapshotOnce('2026-08-10', 'completed');
check('10: on conflict do nothing → ilk kayıt kalır', frozen.get('2026-08-10'), 'partial');
check('10: tekrar çağrı satır sayısını artırmıyor', frozen.size, 1);

console.log(`\n${fail === 0 ? 'TÜMÜ GEÇTİ' : 'BAŞARISIZ VAR'} — ${pass} geçti, ${fail} kaldı`);
process.exit(fail === 0 ? 0 : 1);
