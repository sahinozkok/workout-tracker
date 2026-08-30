/**
 * Aktif programı profilde paylaşma — SQL GÜVENLİK sözleşmesi harness'ı.
 *
 * SINIR: SQL ÇALIŞTIRILMAZ (statik). Migration metni okunur ve güvenlik
 * sözleşmesinin GERÇEKTEN yazılı olduğu iddia edilir. Docker/local Supabase
 * varsa ayrıca runtime testi `README`/CI tarafında yapılabilir; bu dosya remote
 * veya docker'a DOKUNMAZ.
 *
 * Çalıştırma:  node supabase/tests/shared-active-program.harness.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

let pass = 0;
const failures = [];
function check(name, condition) {
  if (condition) pass += 1;
  else failures.push(name);
}
const has = (name, haystack, needle) => check(name, haystack.includes(needle));
const hasNot = (name, haystack, needle) => check(name, !haystack.includes(needle));

const migration = read('supabase/migrations/20260907120000_add_shared_active_program.sql');
// `get_friend_profile`in DONDURULMUŞ 11 sütunlu sözleşmesinin yaşadığı dosya.
const frozen = read('supabase/migrations/20260903120000_add_friend_message_safety.sql');

// ---------------------------------------------------------------------------
console.log('=== A. Kolon ===');
// ---------------------------------------------------------------------------
has(
  'A1. kolon not null default false, additive',
  migration,
  'add column if not exists show_active_program_on_profile boolean not null default false',
);

// ---------------------------------------------------------------------------
console.log('=== B. RPC güvenlik başlığı ===');
// ---------------------------------------------------------------------------
has('B1. RPC adı doğru', migration, 'create or replace function public.get_friend_active_program(target_user_id uuid)');
has('B2. security definer', migration, 'security definer');
has('B3. stable', migration, 'stable');
has('B4. search_path boş', migration, "set search_path = ''");
has('B5. language sql', migration, 'language sql');
has('B6. tek transaction (begin)', migration, 'begin;');
has('B7. tek transaction (commit)', migration, 'commit;');

// ---------------------------------------------------------------------------
console.log('=== C. Erişim koşulları ===');
// ---------------------------------------------------------------------------
has('C1. giriş yapmamış → veri yok', migration, '(select auth.uid()) is not null');
has('C2. kendi hesabı arkadaş RPC\'sinden okunamaz', migration, '(select auth.uid()) <> target_user_id');
has('C3. yalnız kabul edilmiş arkadaş', migration, 'public.are_friends((select auth.uid()), target_user_id)');
has('C4. engel varsa sıfır satır', migration, 'not public.has_block_between((select auth.uid()), target_user_id)');
has('C5. opt-in true şartı', migration, 'pr.show_active_program_on_profile');
has('C6. yalnız aktif program', migration, 'p.is_active');
has('C7. hedef kullanıcının programı', migration, 'p.owner_id = target_user_id');

// ---------------------------------------------------------------------------
console.log('=== D. Şema ve sıralama ===');
// ---------------------------------------------------------------------------
has('D1. programs public. ile', migration, 'from public.programs as p');
has('D2. profiles join public. ile', migration, 'join public.profiles as pr on pr.id = p.owner_id');
has('D3. program_days join public. ile', migration, 'join public.program_days as d on d.program_id = p.id');
has('D4. LEFT JOIN program_exercises (off-day korunur)', migration, 'left join public.program_exercises as e on e.program_day_id = d.id');
has('D5. sıralama day_position sonra exercise_position', migration, 'order by d.position asc, e.position asc');

// ---------------------------------------------------------------------------
console.log('=== E. Grant / revoke ===');
// ---------------------------------------------------------------------------
has('E1. revoke public', migration, 'revoke all on function public.get_friend_active_program(uuid) from public;');
has('E2. revoke anon', migration, 'revoke all on function public.get_friend_active_program(uuid) from anon;');
has('E3. grant authenticated', migration, 'grant execute on function public.get_friend_active_program(uuid) to authenticated;');
// Tablolara doğrudan SELECT/policy açılmaz; own-only RLS gevşetilmez.
check('E4. yeni tablo grant YOK', !/grant\s+.*\s+on\s+table/i.test(migration));
check('E5. yeni policy YOK', !/create\s+policy/i.test(migration));

// ---------------------------------------------------------------------------
console.log('=== F. Dönüş tipi — yalnız gösterim alanları ===');
// ---------------------------------------------------------------------------
// Yalnız `returns table (...)` bloğunu izole et; imzadaki `target_user_id uuid`
// veya WHERE'deki owner filtresi bu kontrole karışmasın.
const returnBlock = migration.slice(
  migration.indexOf('returns table ('),
  migration.indexOf('language sql'),
);
for (const allowed of [
  'program_name', 'day_name', 'scheduled_weekday', 'is_off_day', 'day_position',
  'exercise_id', 'custom_exercise_name', 'tracking_mode', 'target_sets', 'target_reps',
  'target_duration_seconds', 'target_distance_meters', 'exercise_position',
]) {
  has(`F.allow ${allowed}`, returnBlock, allowed);
}
// Yasak alanların HİÇBİRİ dönüş tipinde yok. (`exercise_id` metin katalog
// referansıdır ve İZİNLİDİR; yasak olan satır UUID'leri / owner / performanstır.)
for (const forbidden of [
  'owner', 'uuid', 'created_at', 'updated_at', 'rest_seconds', 'weight',
  'repetition', 'rpe', 'notes', 'visual', 'xp', 'rose', 'rank', 'session', 'storage',
]) {
  hasNot(`F.deny ${forbidden}`, returnBlock, forbidden);
}

// ---------------------------------------------------------------------------
console.log('=== G. get_friend_profile DONDURULMUŞ sözleşmesi korunuyor ===');
// ---------------------------------------------------------------------------
// Bu migration `get_friend_profile`e HİÇ dokunmaz. Yorumlar sıyrılır: açıklama
// metnindeki referans "tanımlıyor" sayılmaz, yalnız GERÇEK SQL denetlenir.
const migrationCode = migration
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*$/gm, '');
hasNot('G1. yeni migration get_friend_profile TANIMLAMIYOR', migrationCode, 'get_friend_profile');
// 11 sütunlu dönüş tipi kendi dosyasında aynen duruyor.
has('G2. frozen fonksiyon tanımı yerinde', frozen, 'create or replace function public.get_friend_profile(target_user_id uuid)');
const frozenReturn = frozen.slice(
  frozen.indexOf('create or replace function public.get_friend_profile'),
  frozen.indexOf('$$', frozen.indexOf('create or replace function public.get_friend_profile')),
);
for (const column of [
  'id uuid', 'display_name text', 'username text', 'bio text', 'avatar_url text',
  'banner_url text', 'training_goal text', 'level integer', 'xp_into_level integer',
  'xp_for_next integer', 'color_preset text',
]) {
  has(`G3.col ${column}`, frozenReturn, column);
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((name) => console.error('  - ' + name));
  process.exit(1);
}
console.log(`\n✓ Paylaşılan aktif program SQL harness: ${pass} kontrol geçti.`);
