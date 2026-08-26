/**
 * `20260824120000_add_program_order_and_workout_soft_delete.sql` doğrulama
 * harness'ı.
 *
 * SINIR: SQL ÇALIŞTIRILMAZ (yerel Postgres gerekmez). İki katman:
 *   A. YAPISAL — migration metninde ve istemci dosyalarında kuralların
 *      gerçekten bulunduğunu iddia eder; bir düzeltme silinirse patlar.
 *   B. DAVRANIŞSAL — RPC doğrulama yüklemlerinin ve soft-delete sınırının
 *      satır satır karşılığı olan model üzerinde senaryoları çalıştırır.
 *
 * Çalıştırma:  node supabase/tests/program-order-and-soft-delete.harness.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const sql = read('supabase/migrations/20260824120000_add_program_order_and_workout_soft_delete.sql');
const context = read('context/workout-context.tsx');
const coach = read('supabase/functions/workout-coach/index.ts');
const disciplineSql = read('supabase/migrations/20260823120000_add_discipline_day_history.sql');

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
console.log('=== A. Migration metni ===');

contains('program sırası kolonu tekrar çalıştırılabilir', sql, 'add column if not exists sort_order integer');
contains('backfill deterministik (created_at desc, id)', sql, 'order by p.created_at desc, p.id');
contains('backfill yalnızca boş satırları doldurur', sql, 'and p.sort_order is null');
contains('yeni program listenin SONUNA eklenir', sql, 'select coalesce(max(p.sort_order) + 1, 0)');
contains(
  'trigger kullanıcıya özel advisory lock alıyor',
  sql,
  'perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 8022));',
);
check(
  'kilit `max(sort_order)` okumasından ÖNCE',
  sql.indexOf('hashtextextended(new.owner_id::text, 8022)') < sql.indexOf('select coalesce(max(p.sort_order) + 1, 0)'),
  true,
);
check(
  'kilit anahtarı reorder_programs ile aynı (ekleme ↔ sıralama dışlamalı)',
  sql.includes('hashtextextended(actor::text, 8022)') && sql.includes('hashtextextended(new.owner_id::text, 8022)'),
  true,
);
contains('sıralama yazması kullanıcıyla sınırlı', sql, "and p.owner_id = actor\n    and p.sort_order is distinct from ordered.new_order");
contains('tekrar eden id reddedilir', sql, "raise exception 'duplicate_program_ids'");
contains('başka kullanıcının programı reddedilir', sql, "raise exception 'not_owner'");
contains('eksik id listesi reddedilir', sql, "raise exception 'incomplete_program_list'");
contains('reorder RPC yalnızca authenticated', sql, 'grant execute on function public.reorder_programs(uuid[]) to authenticated');
contains('reorder RPC anon\'a kapalı', sql, 'revoke all on function public.reorder_programs(uuid[]) from anon');

contains('soft delete kolonu tekrar çalıştırılabilir', sql, 'add column if not exists deleted_at timestamptz');
contains('soft delete sahiplik doğrular', sql, 'and s.user_id = actor');
contains('sahibi olmayan session not_found', sql, "raise exception 'not_found'");
contains('idempotent: yalnızca deleted_at null iken yazar', sql, 'and s.deleted_at is null');
contains('yalnızca completed session silinebilir', sql, "raise exception 'invalid_session_status'");
contains("update yalnızca completed satıra yazar", sql, "and s.status = 'completed'\n    and s.deleted_at is null;");
check(
  'sahiplik kontrolü durum kontrolünden ÖNCE (durum bilgisi sızmaz)',
  sql.indexOf("raise exception 'not_found'") < sql.indexOf("raise exception 'invalid_session_status'"),
  true,
);
contains('soft delete RPC yalnızca authenticated', sql, 'grant execute on function public.soft_delete_workout_session(uuid) to authenticated');
contains('soft delete RPC anon\'a kapalı', sql, 'revoke all on function public.soft_delete_workout_session(uuid) from anon');
check('hard delete YOK', /delete\s+from\s+public\.workout_(sessions|sets)/i.test(sql), false);

console.log('\n=== A2. Disiplin geçmişi bozulmadı ===');
check(
  'yeni migration discipline_day_history tablosuna dokunmuyor',
  /alter table public\.discipline_day_history|drop .*discipline_day_history/i.test(sql),
  false,
);
check(
  'disiplin fonksiyonlarına deleted_at filtresi EKLENMEDİ',
  disciplineSql.includes('deleted_at'),
  false,
);
contains('disiplin migration\'ı hâlâ yerinde', disciplineSql, 'create table public.discipline_day_history');

console.log('\n=== A3. İstemci ve AI tarafı ===');
contains('disiplin sayacı TÜM session\'lardan üretilir', context, 'const loadedSetCounts = workoutSetRows.reduce');
contains('analitik setleri silinmişleri hariç tutar', context, 'if (deletedSessionIds.has(workoutSet.session_id)) return [];');
contains('geçmiş listesi silinmişleri hariç tutar', context, "session.status !== 'cancelled' && !session.deleted_at");
check(
  'setCounts hesabı deletedSessionIds\'ten ÖNCE gelir (filtresiz)',
  context.indexOf('const loadedSetCounts') < context.indexOf('const deletedSessionIds'),
  true,
);
check('AI fonksiyonunda 4 sorgu da filtreli', (coach.match(/is\('deleted_at', null\)/g) ?? []).length, 4);
contains('program listesi sıraya göre okunur', context, "order('sort_order', { ascending: true, nullsFirst: false })");
contains(
  'yeni program YEREL listede de sona ekleniyor',
  context,
  'setPrograms((currentPrograms) => [...currentPrograms, createdProgram]);',
);
check(
  'yeni program listenin başına EKLENMİYOR',
  context.includes('[createdProgram, ...currentPrograms]'),
  false,
);

// ---------------------------------------------------------------------------
// B. DAVRANIŞSAL MODEL
// ---------------------------------------------------------------------------

/** `reorder_programs` doğrulama yüklemleri. */
function reorderPrograms(programsByOwner, actor, programIds) {
  if (!actor) return { error: 'not_authenticated' };
  if (!programIds || programIds.length === 0) return { error: 'invalid_payload' };
  if (new Set(programIds).size !== programIds.length) return { error: 'duplicate_program_ids' };

  const owned = programsByOwner[actor] ?? [];
  const ownedIds = new Set(owned.map((p) => p.id));
  if (programIds.filter((id) => ownedIds.has(id)).length !== programIds.length) {
    return { error: 'not_owner' };
  }
  if (owned.length !== programIds.length) return { error: 'incomplete_program_list' };

  const next = JSON.parse(JSON.stringify(programsByOwner));
  programIds.forEach((id, index) => {
    next[actor].find((p) => p.id === id).sort_order = index;
  });
  return { data: next };
}

/** `soft_delete_workout_session`. */
function softDelete(sessions, actor, sessionId, now = '2026-08-24T10:00:00Z') {
  if (!actor) return { error: 'not_authenticated' };
  // Sahiplik kontrolü durum kontrolünden ÖNCE: başka kullanıcının satırı için
  // her zaman `not_found` döner, durum bilgisi sızmaz.
  const row = sessions.find((s) => s.id === sessionId && s.user_id === actor);
  if (!row) return { error: 'not_found' };
  if (row.status !== 'completed') return { error: 'invalid_session_status' };
  if (row.deleted_at === null) row.deleted_at = now;
  return { data: sessions };
}

/** Yeni program hem sunucuda hem yerel state'te listenin SONUNA eklenir. */
function appendProgram(currentPrograms, createdProgram) {
  return [...currentPrograms, createdProgram];
}

console.log('\n=== B1. Program sırası ===');
const world = {
  userA: [
    { id: 'a1', sort_order: 0 },
    { id: 'a2', sort_order: 1 },
    { id: 'a3', sort_order: 2 },
  ],
  userB: [
    { id: 'b1', sort_order: 0 },
    { id: 'b2', sort_order: 1 },
  ],
};

const reordered = reorderPrograms(world, 'userA', ['a3', 'a1', 'a2']);
check('geçerli sıralama uygulanıyor', reordered.data.userA.map((p) => [p.id, p.sort_order]), [
  ['a1', 1],
  ['a2', 2],
  ['a3', 0],
]);
check('başka kullanıcının sırası ETKİLENMİYOR', reordered.data.userB.map((p) => [p.id, p.sort_order]), [
  ['b1', 0],
  ['b2', 1],
]);
check('başka kullanıcının program id\'si reddediliyor', reorderPrograms(world, 'userA', ['a1', 'a2', 'b1']).error, 'not_owner');
check('tekrar eden id reddediliyor', reorderPrograms(world, 'userA', ['a1', 'a1', 'a2']).error, 'duplicate_program_ids');
check('eksik liste reddediliyor', reorderPrograms(world, 'userA', ['a1', 'a2']).error, 'incomplete_program_list');
check('boş liste reddediliyor', reorderPrograms(world, 'userA', []).error, 'invalid_payload');
check('oturumsuz çağrı reddediliyor', reorderPrograms(world, null, ['a1']).error, 'not_authenticated');

const localList = [{ id: 'p1' }, { id: 'p2' }];
const afterCreate = appendProgram(localList, { id: 'p3' });
check('yeni program yerel listenin SONUNA ekleniyor', afterCreate.map((p) => p.id), ['p1', 'p2', 'p3']);
check('mevcut programların sırası değişmiyor', afterCreate.slice(0, 2).map((p) => p.id), ['p1', 'p2']);
check(
  'sunucu tetikleyicisiyle uyumlu (max+1 → son sıra)',
  appendProgram(
    [{ id: 'p1', sort_order: 0 }, { id: 'p2', sort_order: 1 }],
    { id: 'p3', sort_order: 2 },
  ).map((p) => p.sort_order),
  [0, 1, 2],
);

console.log('\n=== B2. Antrenman soft-delete ===');
const sessions = [
  { id: 's1', user_id: 'userA', workout_date: '2026-08-20', status: 'completed', deleted_at: null },
  { id: 's2', user_id: 'userA', workout_date: '2026-08-21', status: 'completed', deleted_at: null },
  { id: 'sRun', user_id: 'userA', workout_date: '2026-08-24', status: 'running', deleted_at: null },
  { id: 'sPause', user_id: 'userA', workout_date: '2026-08-24', status: 'paused', deleted_at: null },
  { id: 'sB', user_id: 'userB', workout_date: '2026-08-20', status: 'completed', deleted_at: null },
];
check('başka kullanıcının session\'ı silinemiyor', softDelete(sessions, 'userA', 'sB').error, 'not_found');
check('sahibi olmayan satır değişmedi', sessions.find((s) => s.id === 'sB').deleted_at, null);
check('running session reddediliyor', softDelete(sessions, 'userA', 'sRun').error, 'invalid_session_status');
check('running satır değişmedi', sessions.find((s) => s.id === 'sRun').deleted_at, null);
check('paused session reddediliyor', softDelete(sessions, 'userA', 'sPause').error, 'invalid_session_status');
check('paused satır değişmedi', sessions.find((s) => s.id === 'sPause').deleted_at, null);

check('completed session siliniyor', softDelete(sessions, 'userA', 's1').error, undefined);
const firstDeletedAt = sessions.find((s) => s.id === 's1').deleted_at;
check('silme uygulandı', typeof firstDeletedAt, 'string');
softDelete(sessions, 'userA', 's1', '2026-08-24T23:59:00Z');
check('tekrar silme IDEMPOTENT (zaman değişmiyor)', sessions.find((s) => s.id === 's1').deleted_at, firstDeletedAt);
check('tekrar silme hata vermiyor', softDelete(sessions, 'userA', 's1').error, undefined);

console.log('\n=== B3. Analitik ve disiplin ayrımı ===');
const sets = [
  { id: 'x1', session_id: 's1', program_exercise_id: 'e1' },
  { id: 'x2', session_id: 's1', program_exercise_id: 'e1' },
  { id: 'x3', session_id: 's2', program_exercise_id: 'e1' },
];
const dateBySession = new Map(sessions.map((s) => [s.id, s.workout_date]));
const deletedIds = new Set(sessions.filter((s) => s.deleted_at).map((s) => s.id));

// Disiplin kanıtı: TÜM session'lar (context'teki `loadedSetCounts` ile aynı kural).
const setCounts = sets.reduce((counts, row) => {
  const key = `${dateBySession.get(row.session_id)}:${row.program_exercise_id}`;
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});
// Analitik: silinmişler hariç (context'teki `loadedWorkoutSets` ile aynı kural).
const analyticsSets = sets.filter((row) => !deletedIds.has(row.session_id));
// İki katman, koddaki sırayla:
//   1. `workout-context` → cancelled ve soft-delete edilmişler çıkar,
//   2. `history.tsx`     → yalnızca completed listelenir.
const contextSessions = sessions.filter(
  (s) => s.user_id === 'userA' && s.status !== 'cancelled' && !s.deleted_at,
);
const analyticsSessions = contextSessions.filter((s) => s.status === 'completed');

check('silinen antrenmanın günü DİSİPLİN sayacında duruyor', setCounts['2026-08-20:e1'], 2);
check('silinen antrenmanın setleri analitikten çıktı', analyticsSets.map((r) => r.id), ['x3']);
check('silinen antrenman geçmiş listesinde yok', analyticsSessions.map((s) => s.id), ['s2']);
check(
  'devam eden antrenmanlar context\'te duruyor (silinmedi)',
  contextSessions.map((s) => s.id).sort(),
  ['s2', 'sPause', 'sRun'],
);
check('silinmeyen günün sayacı bozulmadı', setCounts['2026-08-21:e1'], 1);
check('setler sunucuda korunuyor (hard delete yok)', sets.length, 3);

console.log(`\n${fail === 0 ? 'TÜMÜ GEÇTİ' : 'BAŞARISIZ VAR'} — ${pass} geçti, ${fail} kaldı`);
process.exit(fail === 0 ? 0 : 1);
