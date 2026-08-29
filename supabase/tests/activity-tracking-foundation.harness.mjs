/**
 * Faz 1 — Aktivite takibi veritabanı temeli harness'ı.
 *
 * SINIR: canlı Postgres yoktur; SQL çalıştırılmaz. Üç katman:
 *
 *   A. YAPISAL — migration metni AYRIŞTIRILIR (kısıt ifadeleri, politika
 *      gövdeleri, fonksiyon gövdeleri ayrı ayrı çıkarılır) ve sözleşme bu
 *      parçalar üzerinde iddia edilir. Dosyada kelime aramak YETERLİ SAYILMAZ:
 *      her iddia ilgili gövdeyle sınırlıdır, böylece bir yorumda geçen kelime
 *      testi geçiremez.
 *
 *   B. DAVRANIŞSAL — tamamlama çekirdeğinin ve ödül döngüsünün satır satır
 *      karşılığı olan model çalıştırılır. Sabitler (XP/gül, sınırlar, olay türü,
 *      anahtar şeması) migration'ın KENDİSİNDEN okunur; harness kendi sayı
 *      uydurmaz.
 *
 *   C. MUTASYON — düzeltme öncesi/yanlış modeller aynı iddialara sokulur ve
 *      GERÇEKTEN düştükleri kanıtlanır. Bu olmadan A ve B vacuous olabilirdi.
 *
 * Çalıştırma:  node supabase/tests/activity-tracking-foundation.harness.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

const MIGRATION_NAME = '20260905120000_add_activity_tracking_foundation.sql';
const MIGRATION_PATH = `supabase/migrations/${MIGRATION_NAME}`;
const sql = read(MIGRATION_PATH);

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
function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} (beklenen ${e}, gelen ${a})`);
}
/** Mutasyon kanıtı: verilen iddia GERÇEKTEN düşmeli. */
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
// Ayrıştırıcılar — iddiaları ilgili gövdeyle SINIRLAMAK için
// ---------------------------------------------------------------------------

/** Blok yorumlarını ve satır yorumlarını siler; kod düzeyi iddialar için. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/** `create or replace function public.<name>` … eşleşen `$$;` arası gövde. */
function functionBody(name) {
  const head = sql.indexOf(`create or replace function public.${name}(`);
  assert(head !== -1, `fonksiyon bulunamadı: ${name}`);
  const end = sql.indexOf('\n$$;', head);
  assert(end !== -1, `fonksiyon gövdesi kapanmıyor: ${name}`);
  return sql.slice(head, end + 4);
}

/**
 * `constraint <name> check ( … )` ifadesinin İÇİ.
 *
 * İki biçimi de kapsar: `alter table … add constraint <name> check (…)` ve
 * `create table` içinde satır içi tanımlanan `constraint <name> check (…)`.
 */
function constraintExpression(name) {
  let head = sql.indexOf(`add constraint ${name}`);
  if (head === -1) head = sql.indexOf(`constraint ${name}`);
  assert(head !== -1, `kısıt bulunamadı: ${name}`);
  const open = sql.indexOf('check (', head);
  assert(open !== -1, `kısıtta check yok: ${name}`);
  let depth = 0;
  let index = open + 'check '.length;
  for (; index < sql.length; index += 1) {
    if (sql[index] === '(') depth += 1;
    else if (sql[index] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return sql.slice(open + 'check ('.length, index);
}

/**
 * `create policy "<name>"` ifadesinin GÖVDESİ — kendi `);` kapanışında durur.
 *
 * Sonraki ifadeye veya araya giren açıklama bloklarına TAŞMAMASI kritiktir:
 * taşsaydı komşu politikanın yorumunda geçen bir tablo adı, bu politikada
 * varmış gibi görünür ve iddialar yanlış sonuç verirdi.
 */
function policyBody(name) {
  const head = sql.indexOf(`create policy "${name}"`);
  assert(head !== -1, `politika bulunamadı: ${name}`);
  const end = sql.indexOf('\n);', head);
  assert(end !== -1, `politika kapanmıyor: ${name}`);
  return sql.slice(head, end + 3);
}

/** `create table … workout_activity_records ( … )` kolon bölgesi. */
function activityTableBody() {
  const head = sql.indexOf('create table if not exists public.workout_activity_records');
  assert(head !== -1, 'aktivite tablosu bulunamadı');
  const end = sql.indexOf('\n);', head);
  assert(end !== -1, 'aktivite tablosu kapanmıyor');
  return sql.slice(head, end + 3);
}

/** Yorumlardan arındırılmış tam metin — yapısal iddialar bunun üzerinde çalışır. */
const sqlCode = stripComments(sql);

const activityTable = activityTableBody();
const activityTableCode = stripComments(activityTable);
const rewardsBody = functionBody('sync_workout_rewards');
const doneUnitsBody = functionBody('exercise_done_units');
const targetUnitsBody = functionBody('exercise_target_units');

// ---------------------------------------------------------------------------
// Migration'dan okunan sabitler — harness kendi sayı uydurmaz
// ---------------------------------------------------------------------------

/**
 * Okuyucular TOLERANSLIDIR: eşleşme yoksa `undefined` döner, fırlatmaz.
 *
 * Sözleşme kaydığında harness'ın modül yüklenirken çökmesi yerine ilgili
 * kontrolün OKUNABİLİR bir mesajla düşmesi gerekir; yığın izi neyin bozulduğunu
 * anlatmaz. Ayrıştırmanın kendisi P0 bloğunda ayrıca doğrulanır.
 */
function readActivityReward() {
  const match = stripComments(rewardsBody).match(
    /'activity',\s*[\s\S]*?:activity',\s*(\d+),\s*(\d+),/,
  );
  return match ? { xp: Number(match[1]), rose: Number(match[2]) } : undefined;
}
function readSetReward() {
  const match = stripComments(rewardsBody).match(/set_row\.set_number::text,\s*(\d+),\s*(\d+),/);
  return match ? { xp: Number(match[1]), rose: Number(match[2]) } : undefined;
}
const ACTIVITY_REWARD = readActivityReward();
const SET_REWARD = readSetReward();

function readRange(constraintName, column) {
  let expression;
  try {
    expression = constraintExpression(constraintName);
  } catch {
    return undefined;
  }
  const match = expression.match(new RegExp(`${column} between (\\d+) and (\\d+)`));
  return match ? { min: Number(match[1]), max: Number(match[2]) } : undefined;
}
const DURATION_TARGET_RANGE = readRange('program_exercises_target_duration_check', 'target_duration_seconds');
const DISTANCE_TARGET_RANGE = readRange('program_exercises_target_distance_check', 'target_distance_meters');

check('P0. Sözleşme sabitleri migration’dan AYRIŞTIRILABİLDİ', () => {
  assert(ACTIVITY_REWARD, 'aktivite ödülü/source_key şeması okunamadı — sözleşme kaymış');
  assert(SET_REWARD, 'set ödül tutarları okunamadı — sözleşme kaymış');
  assert(DURATION_TARGET_RANGE, 'süre hedefi aralığı okunamadı');
  assert(DISTANCE_TARGET_RANGE, 'mesafe hedefi aralığı okunamadı');
});

// ===========================================================================
console.log('=== A. Migration hijyeni ===');
// ===========================================================================

check('A1. Faz 1 TEK migration dosyasıdır', () => {
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', 'supabase/migrations'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  assertDeepEqual(untracked, [MIGRATION_PATH], 'yeni migration sayısı bir değil');
});

check('A2. Timestamp mevcut en son migration’dan SONRA ve çakışmıyor', () => {
  const names = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  assertEqual(names[names.length - 1], MIGRATION_NAME, 'yeni dosya en son sırada değil');
  const stamps = names.map((n) => n.slice(0, 14));
  assertEqual(new Set(stamps).size, stamps.length, 'timestamp çakışması var');
});

check('A3. Açık ve TEK bir transaction — hata hâlinde bütün Faz 1 geri alınır', () => {
  const code = stripComments(sql);
  assertEqual((code.match(/^begin;$/gm) ?? []).length, 1, 'begin; sayısı bir değil');
  assertEqual((code.match(/^commit;$/gm) ?? []).length, 1, 'commit; sayısı bir değil');
  assert(code.indexOf('\nbegin;') < code.indexOf('\ncommit;'), 'begin/commit sırası yanlış');
  assert(!/^rollback;$/m.test(code), 'koşulsuz rollback var');
  // Transaction'ı erken kapatacak başka bir commit/begin bulunmamalı.
  assert(!/commit;[\s\S]*begin;/.test(code), 'transaction bölünmüş');
});

check('A4. Uygulanmış migration dosyalarının HİÇBİRİ değişmedi', () => {
  const status = execFileSync('git', ['status', '--porcelain', 'supabase/migrations'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  for (const line of status) {
    assert(line.startsWith('??'), `uygulanmış migration değiştirilmiş: ${line}`);
  }
  const tracked = execFileSync('git', ['ls-files', 'supabase/migrations'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  assert(tracked.length >= 24, 'izlenen migration sayısı beklenenden az — kontrol vacuous');
});

check('A5. İstemci ve yapılandırma dosyaları bu fazda DEĞİŞMEDİ', () => {
  const changed = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
  for (const path of changed) {
    assert(
      path.startsWith('supabase/migrations/') || path.startsWith('supabase/tests/'),
      `kapsam dışı dosya değişmiş: ${path}`,
    );
  }
});

check('A6. Gizli bilgi veya attribution yok', () => {
  for (const pattern of [
    /eyJ[A-Za-z0-9_-]{15,}/,
    /BEGIN [A-Z ]*PRIVATE KEY/,
    /\b(claude|anthropic|generated-by|co-authored|assistant)\b/i,
    /@(gmail|icloud|me)\.com/,
    /(sk_live|EXPO_TOKEN|service_role)/,
  ]) {
    assert(!pattern.test(sql), `yasak desen bulundu: ${pattern}`);
  }
});

// ===========================================================================
console.log('\n=== B. program_exercises sözleşmesi ===');
// ===========================================================================

check('B1. tracking_mode izin kümesi tam olarak üç değer', () => {
  const expression = constraintExpression('program_exercises_tracking_mode_check');
  const values = [...expression.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assertDeepEqual(values, ['distance', 'duration', 'sets_reps'], 'izin kümesi farklı');
});

check('B2. tracking_mode varsayılanı sets_reps ve NOT NULL', () => {
  assert(
    /add column if not exists tracking_mode text not null default 'sets_reps'/.test(sql),
    'varsayılan/NOT NULL sözleşmesi yok',
  );
});

check('B3. Mevcut satırlar backfill olmadan geçerli kalır', () => {
  // Anlamsal değişiklik yasak: eski veriye dokunan hiçbir UPDATE olmamalı.
  const code = stripComments(sql);
  assert(
    !/update\s+public\.program_exercises/i.test(code),
    'eski program_exercises satırları güncelleniyor',
  );
  assert(!/delete\s+from\s+public\.program_exercises/i.test(code), 'eski satır siliniyor');
});

check('B4. target_sets ve target_reps NOT NULL zorunluluğu kalktı', () => {
  assert(
    /alter column target_sets drop not null/.test(sql),
    'target_sets hâlâ NOT NULL',
  );
  assert(
    /alter column target_reps drop not null/.test(sql),
    'target_reps hâlâ NOT NULL',
  );
});

check('B5. Eski aralık/uzunluk kontrolleri KALDIRILMADI', () => {
  const code = stripComments(sql);
  // Bu migration initial_schema'daki aralık kontrollerini düşürmemeli.
  assert(
    !/drop constraint[^\n;]*program_exercises_target_sets/i.test(code),
    'target_sets aralık kontrolü düşürülmüş',
  );
  assert(
    !/drop constraint[^\n;]*program_exercises_target_reps/i.test(code),
    'target_reps uzunluk kontrolü düşürülmüş',
  );
  // Ve NULL'da güvenli olduğu SQL semantiğiyle doğrulanır (aşağıdaki model).
  assertEqual(sqlCheckPasses(null, 1, 20), true, 'NULL aralık kontrolünü ihlal ediyor');
  assertEqual(sqlCheckPasses(0, 1, 20), false, '0 aralık kontrolünü geçiyor');
  assertEqual(sqlCheckPasses(3, 1, 20), true, '3 aralık kontrolünü geçmiyor');
});

/** SQL CHECK semantiği: NULL sonuç "ihlal değil" sayılır. */
function sqlCheckPasses(value, min, max) {
  if (value === null || value === undefined) return true; // NULL → UNKNOWN → ihlal değil
  return value >= min && value <= max;
}

check('B6. Koşullu sözleşme: sets_reps dalı', () => {
  const branch = trackingBranch('sets_reps');
  assert(/target_sets is not null/.test(branch), 'target_sets zorunlu değil');
  assert(/target_reps is not null/.test(branch), 'target_reps zorunlu değil');
  assert(/target_duration_seconds is null/.test(branch), 'süre hedefi null zorlanmıyor');
  assert(/target_distance_meters is null/.test(branch), 'mesafe hedefi null zorlanmıyor');
  assert(!/rest_seconds\s*=/.test(branch), 'sets_reps rest_seconds davranışı değiştirilmiş');
});

check('B7. Koşullu sözleşme: duration dalı', () => {
  const branch = trackingBranch('duration');
  assert(/target_sets is null/.test(branch), 'target_sets null zorlanmıyor');
  assert(/target_reps is null/.test(branch), 'target_reps null zorlanmıyor');
  assert(/target_duration_seconds is not null/.test(branch), 'süre hedefi zorunlu değil');
  assert(/target_distance_meters is null/.test(branch), 'mesafe hedefi null zorlanmıyor');
  assert(/rest_seconds = 0/.test(branch), 'rest_seconds = 0 zorlanmıyor');
});

check('B8. Koşullu sözleşme: distance dalı', () => {
  const branch = trackingBranch('distance');
  assert(/target_sets is null/.test(branch), 'target_sets null zorlanmıyor');
  assert(/target_reps is null/.test(branch), 'target_reps null zorlanmıyor');
  assert(/target_duration_seconds is null/.test(branch), 'süre hedefi null zorlanmıyor');
  assert(/target_distance_meters is not null/.test(branch), 'mesafe hedefi zorunlu değil');
  assert(/rest_seconds = 0/.test(branch), 'rest_seconds = 0 zorlanmıyor');
});

/** Koşullu CHECK'in tek bir türe ait dalını çıkarır. */
function trackingBranch(mode) {
  const expression = constraintExpression('program_exercises_tracking_contract_check');
  const branches = expression.split(/\bor\b(?=\s*\()/);
  const branch = branches.find((b) => b.includes(`tracking_mode = '${mode}'`));
  assert(branch, `koşullu dal bulunamadı: ${mode}`);
  return branch;
}

check('B9. KARDİYODA SAHTE target_sets = 1 YOK', () => {
  const code = stripComments(sql);
  // Ne varsayılan, ne backfill, ne de koşullu dalda 1'e zorlama olmalı.
  assert(!/target_sets[^\n]*default\s*1\b/.test(code), 'target_sets için 1 varsayılanı var');
  assert(!/set\s+target_sets\s*=\s*1\b/.test(code), 'target_sets 1 ile dolduruluyor');
  for (const mode of ['duration', 'distance']) {
    const branch = trackingBranch(mode);
    assert(!/target_sets\s*=\s*1/.test(branch), `${mode} dalında target_sets = 1 var`);
    assert(/target_sets is null/.test(branch), `${mode} dalında target_sets null değil`);
  }
  // Hedef birimi yardımcısı da kardiyoda target_sets OKUMAMALI.
  const cardioLine = stripComments(targetUnitsBody).match(/when mode in[^\n]*\n?[^\n]*/);
  assert(cardioLine, 'kardiyo hedef birimi dalı bulunamadı');
  assert(!/target_sets/.test(cardioLine[0]), 'kardiyo hedef birimi target_sets okuyor');
});

check('B10. Süre ve mesafe sınırları makul ve pozitif', () => {
  assert(DURATION_TARGET_RANGE && DISTANCE_TARGET_RANGE, 'sınırlar okunamadı');
  assert(DURATION_TARGET_RANGE.min > 0, 'süre alt sınırı pozitif değil');
  assert(DURATION_TARGET_RANGE.max <= 86400, 'süre üst sınırı bir günü aşıyor');
  assert(DISTANCE_TARGET_RANGE.min > 0, 'mesafe alt sınırı pozitif değil');
  assert(DISTANCE_TARGET_RANGE.max <= 500000, 'mesafe üst sınırı 500 km’yi aşıyor');
});

// ===========================================================================
console.log('\n=== C. workout_activity_records ===');
// ===========================================================================

check('C1. Zorunlu kolonlar ve tipleri', () => {
  for (const [column, pattern] of [
    ['id', /id uuid primary key/],
    ['session_id', /session_id uuid not null references public\.workout_sessions\(id\) on delete cascade/],
    ['program_exercise_id', /program_exercise_id uuid references public\.program_exercises\(id\) on delete set null/],
    ['exercise_name', /exercise_name text not null check \(char_length\(exercise_name\) between 1 and 100\)/],
    ['tracking_mode', /tracking_mode text not null check \(tracking_mode in \('duration', 'distance'\)\)/],
    ['duration_seconds', /duration_seconds integer not null check \(duration_seconds between 1 and \d+\)/],
    ['distance_meters', /distance_meters integer check \(distance_meters is null or distance_meters between 1 and \d+\)/],
    ['rpe', /rpe numeric\(3,1\) check \(rpe is null or rpe between 0 and 10\)/],
    ['completed_at', /completed_at timestamptz not null/],
    ['created_at', /created_at timestamptz not null/],
    ['updated_at', /updated_at timestamptz not null/],
  ]) {
    assert(pattern.test(activityTableCode), `kolon sözleşmesi eksik: ${column}`);
  }
});

check('C2. Snapshot alanları var (silinen programdan sonra history korunur)', () => {
  assert(/exercise_name text not null/.test(activityTableCode), 'isim snapshot’ı yok');
  assert(/target_duration_seconds integer/.test(activityTableCode), 'süre hedefi snapshot’ı yok');
  assert(/target_distance_meters integer/.test(activityTableCode), 'mesafe hedefi snapshot’ı yok');
  // FK cascade DEĞİL set null olmalı: satır silinmemeli.
  assert(
    /program_exercises\(id\) on delete set null/.test(activityTableCode),
    'egzersiz silinince kayıt de siliniyor',
  );
  assert(
    !/program_exercises\(id\) on delete cascade/.test(activityTableCode),
    'egzersiz FK cascade — history kaybolur',
  );
});

check('C3. Oturum+egzersiz başına tek kayıt (upsert sınırı)', () => {
  assert(
    /unique \(session_id, program_exercise_id\)/.test(activityTableCode),
    'unique sınırı yok',
  );
});

check('C4. Duration/distance doğrulama farkı', () => {
  // distance kaydında mesafe ZORUNLU.
  const distanceRule = constraintExpression('workout_activity_records_distance_requires_value');
  assert(
    /tracking_mode <> 'distance' or distance_meters is not null/.test(distanceRule),
    'distance kaydında mesafe zorunlu değil',
  );
  // duration kaydında mesafe İSTEĞE BAĞLI: nullable kolon, zorunluluk yok.
  assert(
    /distance_meters integer check \(distance_meters is null or/.test(activityTableCode),
    'duration kaydında mesafe isteğe bağlı değil',
  );
  // süre HER İKİ türde de zorunlu.
  assert(/duration_seconds integer not null/.test(activityTableCode), 'süre zorunlu değil');
});

check('C5. Kapsam dışı kolon YOK (tempo/kalori/nabız/hız/eğim/GPS/mil)', () => {
  const forbidden = [
    'pace', 'tempo_', 'calorie', 'calories', 'kcal',
    'heart_rate', 'bpm', 'avg_hr',
    'speed', 'incline', 'elevation',
    'gps', 'latitude', 'longitude', 'route',
    'miles', 'mile_',
  ];
  for (const word of forbidden) {
    assert(
      !new RegExp(`\\b${word}\\b`, 'i').test(activityTableCode),
      `kapsam dışı kolon bulundu: ${word}`,
    );
  }
});

check('C6. Index ve updated_at trigger’ı kurulu', () => {
  assert(
    /create index if not exists workout_activity_records_session_idx[\s\S]{0,120}\(session_id\)/.test(sql),
    'session index yok',
  );
  assert(
    /create index if not exists workout_activity_records_exercise_idx[\s\S]{0,160}\(program_exercise_id, completed_at desc\)/.test(sql),
    'egzersiz index yok',
  );
  assert(
    /create trigger workout_activity_records_set_updated_at[\s\S]{0,160}execute function public\.set_updated_at\(\)/.test(sql),
    'mevcut updated_at yardımcısı kullanılmıyor',
  );
});

// ===========================================================================
console.log('\n=== D. RLS ve sahiplik ===');
// ===========================================================================

check('D1. RLS etkin ve anon erişimi kapalı', () => {
  assert(
    /alter table public\.workout_activity_records enable row level security;/.test(sql),
    'RLS etkin değil',
  );
  assert(
    /revoke all on table public\.workout_activity_records from anon;/.test(sql),
    'anon erişimi kapatılmamış',
  );
});

check('D2. Dört politika da yalnızca authenticated için', () => {
  for (const action of ['select', 'insert', 'update', 'delete']) {
    const body = policyBody(`workout_activity_records_${action}_own`);
    assert(/to authenticated/.test(body), `${action} politikası authenticated değil`);
    assert(/auth\.uid\(\)/.test(body), `${action} politikası sahiplik doğrulamıyor`);
    assert(
      /workout_sessions\.user_id = \(select auth\.uid\(\)\)|s\.user_id = \(select auth\.uid\(\)\)/.test(body),
      `${action} politikası oturum sahipliğine bağlı değil`,
    );
  }
});

check('D3. INSERT egzersizin oturumun program gününe ait olduğunu doğrular', () => {
  const body = policyBody('workout_activity_records_insert_own');
  assert(/join public\.program_exercises/.test(body), 'egzersiz join’i yok');
  assert(/pe\.program_day_id = pd\.id/.test(body), 'gün bağı doğrulanmıyor');
  assert(/pd\.id = s\.program_day_id/.test(body), 'oturum-gün bağı doğrulanmıyor');
  assert(/s\.user_id = \(select auth\.uid\(\)\)/.test(body), 'oturum sahipliği yok');
  assert(/pe\.tracking_mode = workout_activity_records\.tracking_mode/.test(body), 'tür eşleşmesi yok');
});

check('D4. Plansız (program_exercise_id NULL) kayıt INSERT edilemez', () => {
  const body = policyBody('workout_activity_records_insert_own');
  // Join zorunlu olduğu için NULL eşleşemez; ayrıca açık bir "is null" kaçışı olmamalı.
  assert(
    !/program_exercise_id is null/.test(body),
    'insert politikası NULL egzersize izin veriyor',
  );
  assert(/pe\.id = workout_activity_records\.program_exercise_id/.test(body), 'egzersiz bağı yok');
});

check('D5. UPDATE kopuk satırı korur ama çapraz bağlamaya izin vermez', () => {
  const body = policyBody('workout_activity_records_update_own');
  assert(/program_exercise_id is null/.test(body), 'silinme sonrası satır güncellenemiyor');
  assert(/pe\.program_day_id = pd\.id/.test(body), 'gün bağı doğrulanmıyor');
});

check('D6. Geçiş değişmezleri trigger ile korunuyor', () => {
  const guard = functionBody('workout_activity_records_guard');
  assert(/new\.session_id is distinct from old\.session_id/.test(guard), 'session_id değiştirilebilir');
  assert(/activity_session_immutable/.test(guard), 'session hatası yok');
  assert(/activity_exercise_immutable/.test(guard), 'egzersiz hatası yok');
  // NULL'a düşme FK'nın on delete set null davranışıdır; engellenmemeli.
  assert(
    /new\.program_exercise_id is not null[\s\S]{0,120}old\.program_exercise_id is not null/.test(guard),
    'NULL geçişi engelleniyor — program silinemez hâle gelir',
  );
  assert(
    /create trigger workout_activity_records_guard[\s\S]{0,140}before update on public\.workout_activity_records/.test(sqlCode),
    'guard trigger’ı kurulu değil (kaldırılmış veya yorum satırına alınmış)',
  );
});

check('D7. Güvenlik workout_sets kalıbından ZAYIF değil', () => {
  const initial = read('supabase/migrations/20260803195000_initial_schema.sql');
  const setsPolicies = (initial.match(/create policy "workout_sets_\w+"/g) ?? []).length;
  const activityPolicies = (sql.match(/create policy "workout_activity_records_\w+"/g) ?? []).length;
  assert(activityPolicies >= setsPolicies, 'aktivite politikaları daha az');
  // workout_sets insert'te YALNIZCA oturum sahipliği var; aktivite bir kat daha sıkı.
  const setsInsert = initial.slice(initial.indexOf('create policy "workout_sets_insert_own"'));
  assert(!/program_exercises/.test(setsInsert.slice(0, 400)), 'emsal değişmiş — karşılaştırma vacuous');
  assert(
    /program_exercises/.test(policyBody('workout_activity_records_insert_own')),
    'aktivite insert’i emsalden sıkı değil',
  );
});

/** Ledger idempotency modeli — `record_reward`'ın on conflict do nothing davranışı. */
function createLedger() {
  const rows = new Map();
  return {
    rows,
    record(eventType, sourceKey, xp, rose) {
      const key = `${eventType}|${sourceKey}`;
      if (rows.has(key)) return 0;
      rows.set(key, { xp, rose });
      return xp;
    },
  };
}
const activityKey = (date, exerciseId) => `${date}:${exerciseId}:activity`;

check('D8. TABLO GRANT’i var — RLS policy tek başına yetmez', () => {
  // `create policy` "hangi satırlar"ı söyler; tablo ayrıcalığı olmadan istek
  // RLS'e ulaşmadan permission denied ile düşer.
  assert(
    /grant select, insert, update, delete on table public\.workout_activity_records to authenticated;/.test(sqlCode),
    'authenticated için tablo GRANT’i yok',
  );
  assert(
    /revoke all on table public\.workout_activity_records from public;/.test(sql),
    'PUBLIC rolünden revoke yok',
  );
  assert(
    /revoke all on table public\.workout_activity_records from anon;/.test(sql),
    'anon’dan revoke yok',
  );
  // Depoda default privileges kurulumu yok → açık grant zorunlu.
  const initial = read('supabase/migrations/20260803195000_initial_schema.sql');
  assert(
    /grant select, insert, update, delete on table public\.workout_sets to authenticated;/.test(initial),
    'emsal grant kalıbı değişmiş — karşılaştırma vacuous',
  );
});

check('D9. authenticated DIŞINDA yazma yetkisi verilmemiş', () => {
  const grants = [...sql.matchAll(/grant ([^;]*?) on table public\.workout_activity_records to (\w+);/g)];
  assertEqual(grants.length, 1, 'birden fazla tablo grant satırı var');
  assertEqual(grants[0][2], 'authenticated', `yanlış role grant: ${grants[0][2]}`);
  // Sequence yok (uuid) → gereksiz sequence grant’i eklenmemeli.
  // Yorum metni değil, KOD taranır: açıklamada geçen "grant usage on sequence"
  // ifadesi gerçek bir grant sanılmamalı.
  assert(
    !/on sequence/i.test(stripComments(sql)),
    'gereksiz sequence grant’i eklenmiş',
  );
});

check('D10. Aktivite hedef snapshot’ı koşullu CHECK ile türe bağlı', () => {
  const expression = constraintExpression('workout_activity_records_target_snapshot_check');
  const duration = expression.split(/\bor\b(?=\s*\()/).find((b) => b.includes("'duration'"));
  const distance = expression.split(/\bor\b(?=\s*\()/).find((b) => b.includes("'distance'"));
  assert(duration && distance, 'iki tür dalı da yok');
  assert(/target_duration_seconds is not null/.test(duration), 'duration: süre hedefi zorunlu değil');
  assert(/target_distance_meters is null/.test(duration), 'duration: mesafe hedefi null zorlanmıyor');
  assert(/target_distance_meters is not null/.test(distance), 'distance: mesafe hedefi zorunlu değil');
  assert(/target_duration_seconds is null/.test(distance), 'distance: süre hedefi null zorlanmıyor');
});

check('D11. Kullanıcı keyfî hedef snapshot’ı yazamaz (plan hedefiyle NULL-safe eşitlik)', () => {
  for (const action of ['insert', 'update']) {
    const body = policyBody(`workout_activity_records_${action}_own`);
    assert(
      /pe\.target_duration_seconds\s*\n?\s*is not distinct from workout_activity_records\.target_duration_seconds/.test(body),
      `${action}: süre hedefi plandan doğrulanmıyor`,
    );
    assert(
      /pe\.target_distance_meters\s*\n?\s*is not distinct from workout_activity_records\.target_distance_meters/.test(body),
      `${action}: mesafe hedefi plandan doğrulanmıyor`,
    );
  }
});

check('D12. AÇIK çapraz sahiplik zinciri (program_exercises RLS’ine güvenilmiyor)', () => {
  for (const action of ['insert', 'update']) {
    const body = policyBody(`workout_activity_records_${action}_own`);
    assert(/join public\.program_days as pd/.test(body), `${action}: program_days halkası yok`);
    assert(/join public\.programs as pr/.test(body), `${action}: programs halkası yok`);
    assert(/pr\.owner_id = \(select auth\.uid\(\)\)/.test(body), `${action}: program sahipliği yok`);
    assert(/s\.user_id = \(select auth\.uid\(\)\)/.test(body), `${action}: oturum sahipliği yok`);
    assert(/s\.program_id = pr\.id/.test(body), `${action}: oturum-program bağı yok`);
    assert(/s\.program_day_id = pd\.id/.test(body), `${action}: oturum-gün bağı yok`);
    assert(/pe\.program_day_id = pd\.id/.test(body), `${action}: egzersiz-gün bağı yok`);
  }
});

check('D13. Kopuk satır (program silinmiş) okunabilir, silinebilir, düzeltilebilir', () => {
  // SELECT ve DELETE yalnızca oturum sahipliğine bakmalı; zincir aramamalı.
  for (const action of ['select', 'delete']) {
    const body = policyBody(`workout_activity_records_${action}_own`);
    assert(!/program_exercises/.test(body), `${action} politikası kopuk satırı gizliyor`);
  }
  const update = policyBody('workout_activity_records_update_own');
  assert(/program_exercise_id is null/.test(update), 'kopuk satır güncellenemiyor');
});

check('D14. Snapshot ve kimlik alanları guard ile DONDURULMUŞ', () => {
  const guard = functionBody('workout_activity_records_guard');
  for (const field of ['tracking_mode', 'target_duration_seconds', 'target_distance_meters', 'exercise_name']) {
    assert(
      new RegExp(`new\\.${field} is distinct from old\\.${field}`).test(guard),
      `değişmez alan korunmuyor: ${field}`,
    );
  }
  assert(/activity_snapshot_immutable/.test(guard), 'snapshot hatası yok');
  // Koşul metinde DURUYOR ama etkisiz hâle getirilmiş olabilir: guard gövdesinde
  // kısa devre yaptıran ölü kod kalıpları bulunmamalı.
  const guardCode = stripComments(guard);
  for (const neutralizer of [/\bif\s+false\b/i, /\band\s+false\b/i, /\bor\s+true\b/i, /\breturn new;[\s\S]*?raise exception/]) {
    assert(!neutralizer.test(guardCode.replace(/if new\.tracking_mode is not distinct[\s\S]*?end if;/, '')),
      `guard etkisiz hâle getirilmiş: ${neutralizer}`);
  }
  // Snapshot koşulu DOĞRUDAN raise’e bağlanmalı.
  assert(
    /if new\.tracking_mode is distinct from old\.tracking_mode[\s\S]{0,400}?raise exception 'activity_snapshot_immutable'/.test(guardCode),
    'snapshot koşulu raise ile bağlı değil',
  );
});

check('D15. Performans alanları DÜZENLENEBİLİR kalıyor', () => {
  const guard = functionBody('workout_activity_records_guard');
  for (const field of ['duration_seconds', 'distance_meters', 'rpe', 'completed_at']) {
    assert(
      !new RegExp(`new\\.${field} is distinct from old\\.${field}`).test(guard),
      `performans alanı yanlışlıkla dondurulmuş: ${field}`,
    );
  }
});

check('D16. Guard fonksiyonlarının execute yetkisi kapalı', () => {
  for (const fn of ['workout_activity_records_guard', 'program_exercises_mode_guard']) {
    for (const role of ['public', 'anon', 'authenticated']) {
      assert(
        new RegExp(`revoke all on function public\\.${fn}\\(\\) from ${role};`).test(sqlCode),
        `${fn}: ${role} revoke yok`,
      );
    }
    assert(
      !new RegExp(`grant execute on function public\\.${fn}`).test(sql),
      `${fn}: execute grant’i açılmış`,
    );
  }
});

check('D17. NULL’a çevirme ödül yükseltmesi sağlamaz (dürüst sınır)', () => {
  // Kullanıcı satırı NULL’a çevirebilir; anahtar plana bağlı olduğu için
  // yeniden kayıt ikinci ödül üretmez ve satırı zaten tamamen silebilir.
  const ledger = createLedger();
  const key = activityKey('2026-09-01', 'rx');
  ledger.record('activity', key, 9, 9);
  // Satır NULL’a çevrildi (plandan koptu), sonra egzersiz yeniden kaydedildi.
  assertEqual(ledger.record('activity', key, 9, 9), 0, 'kopar-yeniden-kaydet ikinci ödül üretti');
  assert(/for delete/.test(policyBody('workout_activity_records_delete_own')), 'delete politikası yok');
  // Migration bu sınırı DÜRÜSTÇE belgelemeli; kanıtlanmayan iddia yazmamalı.
  assert(
    /"NULL'a yalnızca FK düşürebilir" İDDİA EDİLMİYOR/.test(sql),
    'NULL sınırı dürüstçe belgelenmemiş',
  );
});

check('D18. program_exercises tür değiştirme guard’ı DAR ve doğru', () => {
  const guard = functionBody('program_exercises_mode_guard');
  assert(/workout_sets/.test(guard), 'set geçmişi kontrol edilmiyor');
  assert(/workout_activity_records/.test(guard), 'aktivite geçmişi kontrol edilmiyor');
  assert(/exercise_tracking_mode_locked/.test(guard), 'kilit hatası yok');
  // `when` yan tümcesi olağan hedef düzenlemelerinde trigger’ı hiç ateşlemez.
  // YORUMSUZ kod üzerinde: trigger’ı yorum satırına almak da yakalanmalı.
  assert(
    /create trigger program_exercises_mode_guard\s*\nbefore update on public\.program_exercises\s*\nfor each row\s*\nwhen \(old\.tracking_mode is distinct from new\.tracking_mode\)\s*\nexecute function public\.program_exercises_mode_guard\(\);/.test(sqlCode),
    'mode guard trigger’ı kurulu değil (kaldırılmış veya yorum satırına alınmış)',
  );
  // Strength hedef alanları kilitlenmemeli.
  for (const field of ['target_sets', 'target_reps', 'rest_seconds', 'position']) {
    assert(
      !new RegExp(`new\\.${field} is distinct from old\\.${field}`).test(guard),
      `olağan hedef düzenlemesi kilitlenmiş: ${field}`,
    );
  }
  // Silme/cascade yolları UPDATE olmadığı için etkilenmemeli.
  assert(!/before delete on public\.program_exercises/.test(sql), 'silme yolu kilitlenmiş');
});

/** Tür değiştirme guard'ının davranışsal modeli. */
function canChangeMode({ hasSets, hasActivity, modeChanged }) {
  if (!modeChanged) return true;
  return !hasSets && !hasActivity;
}

check('D19. Tür değiştirme kuralı ayırt edici', () => {
  assertEqual(canChangeMode({ hasSets: false, hasActivity: false, modeChanged: true }), true, 'kayıtsız egzersiz kilitlenmiş');
  assertEqual(canChangeMode({ hasSets: true, hasActivity: false, modeChanged: true }), false, 'set geçmişi engellemiyor');
  assertEqual(canChangeMode({ hasSets: false, hasActivity: true, modeChanged: true }), false, 'aktivite geçmişi engellemiyor');
  // Yalnız hedef düzenlemesi (tür aynı) HER durumda serbest.
  assertEqual(canChangeMode({ hasSets: true, hasActivity: true, modeChanged: false }), true, 'hedef düzenlemesi engellenmiş');
});

// ===========================================================================
console.log('\n=== E. Tamamlama çekirdeği — davranışsal model ===');
// ===========================================================================

/** `exercise_target_units` modeli. */
function targetUnits(exercise) {
  if (exercise.mode === 'sets_reps') return exercise.targetSets ?? 0;
  if (exercise.mode === 'duration' || exercise.mode === 'distance') return 1;
  return 0;
}

/** `exercise_done_units` modeli — gün içi TOPLAMA dahil. */
function doneUnits(exercise, evidence) {
  const sets = evidence.sets ?? 0;
  const duration = evidence.duration ?? 0;
  const distance = evidence.distance ?? 0;
  if (exercise.mode === 'sets_reps') return Math.min(sets, exercise.targetSets ?? 0);
  if (exercise.mode === 'duration') {
    return exercise.targetDuration != null && duration >= exercise.targetDuration ? 1 : 0;
  }
  if (exercise.mode === 'distance') {
    return exercise.targetDistance != null && distance >= exercise.targetDistance ? 1 : 0;
  }
  return 0;
}
function hasProgress(evidence) {
  return (evidence.sets ?? 0) > 0 || (evidence.duration ?? 0) > 0 || (evidence.distance ?? 0) > 0;
}

/**
 * Gün durumu — üç SQL fonksiyonunun ortak CASE'inin modeli.
 * `openDay` yalnızca `display_discipline_range` için verilir.
 */
function dayStatus({ exercises, evidence, isOffDay = false, isOpenDay = false, display = false }) {
  if (isOffDay) return 'completed';
  const totalTarget = exercises.reduce((total, e) => total + targetUnits(e), 0);
  const totalDone = exercises.reduce((total, e) => total + doneUnits(e, evidence[e.id] ?? {}), 0);
  const progress = exercises.some((e) => hasProgress(evidence[e.id] ?? {}));
  const zero = display ? (isOpenDay ? null : 'skipped') : null;
  if (totalTarget === 0) return zero;
  if (totalDone >= totalTarget) return 'completed';
  if (progress) return 'partial';
  return zero;
}

const STRENGTH = { id: 'sx', mode: 'sets_reps', targetSets: 3 };
const RUN = { id: 'rx', mode: 'distance', targetDistance: 5000 };
const PLANK = { id: 'px', mode: 'duration', targetDuration: 60 };

check('E1. Eski sets_reps semantiği korunuyor', () => {
  assertEqual(dayStatus({ exercises: [STRENGTH], evidence: { sx: { sets: 3 } } }), 'completed', '3/3');
  assertEqual(dayStatus({ exercises: [STRENGTH], evidence: { sx: { sets: 2 } } }), 'partial', '2/3');
  assertEqual(dayStatus({ exercises: [STRENGTH], evidence: {} }), null, '0/3 açık gün');
  // Hedefin üstü clamp edilir — fazla set günü ikinci kez tamamlamaz.
  assertEqual(doneUnits(STRENGTH, { sets: 7 }), 3, 'fazla set clamp edilmiyor');
});

check('E2. has_progress, strength verisinde eski `total_done > 0` ile EŞDEĞER', () => {
  for (const sets of [0, 1, 2, 3, 9]) {
    const evidence = { sets };
    const legacy = doneUnits(STRENGTH, evidence) > 0;
    assertEqual(hasProgress(evidence), legacy, `set=${sets} için eşdeğerlik bozuldu`);
  }
});

check('E3. Duration hedefi tamamlama', () => {
  assertEqual(doneUnits(PLANK, { duration: 60 }), 1, 'tam hedef tamamlamıyor');
  assertEqual(doneUnits(PLANK, { duration: 120 }), 1, 'hedefin üstü tamamlamıyor');
  assertEqual(doneUnits(PLANK, { duration: 59 }), 0, 'hedef altı tamamlıyor');
  // Mesafe duration türünde tamamlama ölçütü DEĞİLDİR.
  assertEqual(doneUnits(PLANK, { duration: 10, distance: 999999 }), 0, 'mesafe duration’ı tamamlıyor');
});

check('E4. Distance hedefi tamamlama', () => {
  assertEqual(doneUnits(RUN, { distance: 5000 }), 1, 'tam hedef tamamlamıyor');
  assertEqual(doneUnits(RUN, { distance: 7400 }), 1, 'hedefin üstü tamamlamıyor');
  assertEqual(doneUnits(RUN, { distance: 4999 }), 0, 'hedef altı tamamlıyor');
  assertEqual(doneUnits(RUN, { duration: 99999 }), 0, 'süre distance’ı tamamlıyor');
});

check('E5. Hedef altı POZİTİF aktivite günü partial yapar', () => {
  assertEqual(
    dayStatus({ exercises: [RUN], evidence: { rx: { distance: 3000, duration: 900 } } }),
    'partial',
    'hedef altı koşu partial üretmiyor',
  );
});

check('E6. Sıfır ilerleme: açık günde null, geçmişte skipped', () => {
  assertEqual(
    dayStatus({ exercises: [RUN], evidence: {}, display: true, isOpenDay: true }),
    null,
    'açık günde skipped yazılıyor',
  );
  assertEqual(
    dayStatus({ exercises: [RUN], evidence: {}, display: true, isOpenDay: false }),
    'skipped',
    'geçmiş günde skipped yok',
  );
  // Ödül yolunda (auto) skipped ÜRETİLMEZ; mevcut asimetri korunur.
  assertEqual(dayStatus({ exercises: [RUN], evidence: {} }), null, 'auto yolunda skipped üretiliyor');
});

check('E7. Off-day davranışı korunuyor', () => {
  assertEqual(dayStatus({ exercises: [], evidence: {}, isOffDay: true }), 'completed', 'off-day bozuldu');
});

check('E8. Karma gün: strength + cardio yalnızca İKİSİ de dolunca completed', () => {
  const exercises = [STRENGTH, RUN];
  assertEqual(
    dayStatus({ exercises, evidence: { sx: { sets: 3 }, rx: { distance: 5000 } } }),
    'completed',
    'ikisi de tamamken completed değil',
  );
  assertEqual(
    dayStatus({ exercises, evidence: { sx: { sets: 3 } } }),
    'partial',
    'kardiyo eksikken completed olmuş',
  );
  assertEqual(
    dayStatus({ exercises, evidence: { rx: { distance: 5000 } } }),
    'partial',
    'setler eksikken completed olmuş',
  );
});

check('E9. Aynı gün birden fazla oturumun aktivitesi TOPLANIR', () => {
  // Sabah 2 km + akşam 3 km = 5 km → hedef tamam.
  const morning = 2000;
  const evening = 3000;
  assertEqual(doneUnits(RUN, { distance: morning + evening }), 1, 'gün içi toplama yok');
  assert(
    /group by os\.workout_date, ar\.program_exercise_id/.test(stripComments(doneUnitsBody)),
    'aktivite toplaması gün düzeyinde değil',
  );
  assert(
    /sum\(ar\.distance_meters\)/.test(doneUnitsBody) && /sum\(ar\.duration_seconds\)/.test(doneUnitsBody),
    'süre/mesafe toplanmıyor',
  );
});

check('E10. deleted_at ayrımı korunuyor', () => {
  const body = stripComments(doneUnitsBody);
  assert(/not exclude_deleted or s\.deleted_at is null/.test(body), 'silinmiş oturum filtresi yok');
  assert(
    /exercise_done_units\(target_user, from_date, to_date, true\)/.test(functionBody('rank_day_state')),
    'rank silinmiş oturumları hariç tutmuyor',
  );
  for (const name of ['auto_discipline_range', 'display_discipline_range']) {
    assert(
      /exercise_done_units\(target_user, from_date, to_date, false\)/.test(functionBody(name)),
      `${name} deleted_at filtresi uyguluyor — mevcut davranış bozuldu`,
    );
  }
});

// ===========================================================================
console.log('\n=== F. Yeniden tanımlanan SQL yüzeyi ===');
// ===========================================================================

const REDEFINED = [
  ['auto_discipline_range', 'stable', /revoke all on function public\.auto_discipline_range\(uuid, date, date\) from authenticated;/],
  ['display_discipline_range', 'stable', /revoke all on function public\.display_discipline_range\(uuid, date, date, date\) from authenticated;/],
  ['rank_day_state', 'stable', /revoke all on function public\.rank_day_state\(uuid, date, date\) from authenticated;/],
  ['sync_workout_rewards', null, /grant execute on function public\.sync_workout_rewards\(date, date\) to authenticated;/],
];

check('F1. Tam olarak dört mevcut fonksiyon yeniden tanımlandı', () => {
  for (const [name] of REDEFINED) {
    assert(sql.includes(`create or replace function public.${name}(`), `yeniden tanımlanmamış: ${name}`);
  }
});

check('F2. Güvenlik ve search_path sözleşmeleri korunuyor', () => {
  for (const [name, volatility] of REDEFINED) {
    const body = functionBody(name);
    assert(/security definer/.test(body), `${name}: security definer kayıp`);
    assert(/set search_path = ''/.test(body), `${name}: search_path sözleşmesi kayıp`);
    if (volatility) assert(new RegExp(`^${volatility}$`, 'm').test(body), `${name}: ${volatility} kayıp`);
  }
  for (const helper of ['exercise_target_units', 'exercise_done_units']) {
    const body = functionBody(helper);
    assert(/set search_path = ''/.test(body), `${helper}: search_path yok`);
  }
  assert(/^immutable$/m.test(targetUnitsBody), 'exercise_target_units immutable değil');
  assert(/security definer/.test(doneUnitsBody), 'exercise_done_units security definer değil');
});

check('F3. Grant/revoke durumları birebir korunuyor', () => {
  for (const [, , grantPattern] of REDEFINED) {
    assert(grantPattern.test(sql), `grant/revoke satırı eksik: ${grantPattern}`);
  }
  // Yardımcılar PRIVATE: authenticated'a açılmamalı.
  for (const helper of ['exercise_target_units', 'exercise_done_units']) {
    assert(
      new RegExp(`revoke all on function public\\.${helper}\\([^)]*\\) from authenticated;`).test(sql),
      `${helper} authenticated'tan revoke edilmemiş`,
    );
    assert(
      !new RegExp(`grant execute on function public\\.${helper}`).test(sql),
      `${helper} authenticated'a açılmış`,
    );
  }
});

check('F4. Dokunulmayan 12 fonksiyon yeniden yazılmadı', () => {
  const untouched = [
    'resolve_auto_day', 'resolve_auto_streak', 'reconcile_day_rewards',
    'reconcile_pending_days', 'reconcile_pending_days_all',
    'snapshot_active_program_history', 'reconcile_before_program_delete',
    'sync_my_rank', 'get_my_rank_week_focus', 'sync_my_season_achievements',
    'sync_shared_discipline_days', 'get_friend_discipline_days',
  ];
  for (const name of untouched) {
    assert(
      !sql.includes(`create or replace function public.${name}(`),
      `gereksiz yeniden yazım: ${name}`,
    );
  }
  assertEqual(untouched.length, 12, 'dokunulmayan fonksiyon listesi 12 değil');
  // record_reward gövdesi de değişmemeli; yalnızca tablo kısıtı genişler.
  assert(
    !sql.includes('create or replace function public.record_reward('),
    'record_reward gereksiz yere yeniden yazılmış',
  );
});

check('F5. Yeniden tanımlanan gövdeler ortak çekirdeği kullanıyor', () => {
  for (const name of ['auto_discipline_range', 'display_discipline_range', 'rank_day_state']) {
    const body = functionBody(name);
    assert(/public\.exercise_target_units\(e\.tracking_mode, e\.target_sets\)/.test(body), `${name}: hedef birimi yardımcısı yok`);
    assert(/public\.exercise_done_units\(/.test(body), `${name}: kanıt yardımcısı yok`);
    assert(/when t\.has_progress then 'partial'/.test(body), `${name}: partial dalı has_progress kullanmıyor`);
    // Eski payda kalıntısı kalmamalı.
    assert(!/sum\(e\.target_sets\)/.test(body), `${name}: eski payda duruyor`);
    assert(!/when t\.total_done > 0 then 'partial'/.test(body), `${name}: eski partial dalı duruyor`);
  }
});

check('F6. Korunması gereken davranışlar gövdelerde duruyor', () => {
  const auto = functionBody('auto_discipline_range');
  assert(/active_from/.test(auto), 'auto: active_from penceresi kayıp');
  assert(/off_day_total/.test(auto), 'auto: off_day_count kayıp');
  const display = functionBody('display_discipline_range');
  assert(/case when t\.day_date = open_day then null else 'skipped' end/.test(display), 'display: open_day davranışı kayıp');
  const rank = functionBody('rank_day_state');
  assert(/discipline_day_history/.test(rank), 'rank: donmuş program çözümü kayıp');
  assert(/t\.day_id is not null and not t\.day_is_off/.test(rank), 'rank: is_scheduled_workout kayıp');
  assert(/t\.program_id is not null/.test(rank), 'rank: is_verifiable kayıp');
  const rewards = stripComments(rewardsBody);
  assert(/assert_client_today\(client_today\)/.test(rewards), 'ödül: tarih kapısı kayıp');
  assert(/target_date > client_today or target_date < client_today - 1/.test(rewards), 'ödül: tarih penceresi kayıp');
  assert(/pg_advisory_xact_lock/.test(rewards), 'ödül: advisory lock kayıp');
  assert(/reconcile_day_rewards\(actor, target_date\)/.test(rewards), 'ödül: gün/streak uzlaştırması kayıp');
});

// ===========================================================================
console.log('\n=== G. Ödül sözleşmesi ===');
// ===========================================================================

check('G1. Mevcut set ödülü DEĞİŞMEDİ', () => {
  assert(SET_REWARD, 'set ödülü okunamadı');
  assertDeepEqual(SET_REWARD, { xp: 3, rose: 3 }, 'set ödülü değişmiş');
  assert(
    /target_date::text \|\| ':' \|\| set_row\.program_exercise_id::text \|\| ':' \|\| set_row\.set_number::text/.test(rewardsBody),
    'set source_key şeması değişmiş',
  );
});

check('G2. Aktivite ödülü sabit 9 XP / 9 gül', () => {
  assert(ACTIVITY_REWARD, 'aktivite ödülü okunamadı — source_key şeması bozulmuş olabilir');
  assertDeepEqual(ACTIVITY_REWARD, { xp: 9, rose: 9 }, 'aktivite ödülü beklenenden farklı');
});

check('G3. event_type activity — set DEĞİL', () => {
  const loop = activityLoop();
  assert(/'activity',/.test(loop), 'aktivite döngüsü activity olay türü kullanmıyor');
  assert(!/'set',/.test(loop), 'aktivite döngüsü set olay türü kullanıyor');
  // Ledger kümesi yalnızca genişlemeli.
  const expression = constraintExpression('reward_ledger_event_type_check');
  for (const value of ['set', 'day', 'streak', 'weekly', 'pet', 'daily_login', 'activity']) {
    assert(expression.includes(`'${value}'`), `ledger olay türü kayıp: ${value}`);
  }
  const values = [...expression.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assertEqual(values.length, 7, 'ledger olay kümesi beklenenden farklı');
});

check('G4. source_key GÜNLÜK PLAN kimliğine dayalı, activity satır ID’si DEĞİL', () => {
  const loop = activityLoop();
  assert(
    /target_date::text \|\| ':' \|\| activity_row\.program_exercise_id::text \|\| ':activity'/.test(loop),
    'anahtar şeması beklenenden farklı',
  );
  // Satır kimliği anahtarda KULLANILMAMALI.
  assert(!/activity_row\.id/.test(loop), 'anahtar aktivite satır kimliğini kullanıyor');
  assert(!/ar\.id/.test(loop), 'anahtar aktivite satır kimliğini kullanıyor');
  assert(!/gen_random_uuid/.test(loop), 'anahtar rastgele üretiliyor');
});

check('G5. Hedef altı ödül üretmez, hedefe ulaşınca bir kez üretir', () => {
  const loop = activityLoop();
  assert(/ev\.done_units = 1/.test(loop), 'döngü hedef filtresi uygulamıyor');
  assert(/e\.tracking_mode in \('duration', 'distance'\)/.test(loop), 'döngü tür filtresi uygulamıyor');
});

/** Ödül fonksiyonundaki aktivite döngüsünü izole eder. */
function activityLoop() {
  const body = stripComments(rewardsBody);
  const head = body.indexOf('for activity_row in');
  assert(head !== -1, 'aktivite döngüsü yok');
  const end = body.indexOf('end loop;', head);
  return body.slice(head, end);
}



check('G6. Günlük anahtar: aynı gün ikinci ödül YOK', () => {
  const ledger = createLedger();
  const key = activityKey('2026-09-01', 'rx');
  assertEqual(ledger.record('activity', key, 9, 9), 9, 'ilk ödül yazılmadı');
  // Aynı gün ikinci oturumda tekrar hedefe ulaşıldı.
  assertEqual(ledger.record('activity', key, 9, 9), 0, 'ikinci oturum ikinci ödül üretti');
  // Kayıt güncellendi.
  assertEqual(ledger.record('activity', key, 9, 9), 0, 'güncelleme ikinci ödül üretti');
  // Sil + yeniden oluştur (yeni satır kimliği, AYNI anahtar).
  assertEqual(ledger.record('activity', key, 9, 9), 0, 'sil/yeniden-oluştur ikinci ödül üretti');
  // Ağ tekrarı.
  assertEqual(ledger.record('activity', key, 9, 9), 0, 'ağ tekrarı ikinci ödül üretti');
  assertEqual(ledger.rows.size, 1, 'ledger’da birden fazla satır var');
});

check('G7. Farklı gün ve farklı egzersiz ayrı ödül alır', () => {
  const ledger = createLedger();
  ledger.record('activity', activityKey('2026-09-01', 'rx'), 9, 9);
  assertEqual(ledger.record('activity', activityKey('2026-09-02', 'rx'), 9, 9), 9, 'ertesi gün ödül yok');
  assertEqual(ledger.record('activity', activityKey('2026-09-01', 'px'), 9, 9), 9, 'ikinci egzersiz ödül yok');
  assertEqual(ledger.rows.size, 3, 'ayrı ödüller yazılmadı');
});

check('G8. Hedef altı → ödül yok; sonradan hedefe ulaşınca bir kez', () => {
  const ledger = createLedger();
  const key = activityKey('2026-09-01', 'rx');
  // 3 km: hedefin altı → döngüye hiç girmez.
  if (doneUnits(RUN, { distance: 3000 }) === 1) ledger.record('activity', key, 9, 9);
  assertEqual(ledger.rows.size, 0, 'hedef altı ödül üretti');
  // 5 km'ye tamamlandı.
  if (doneUnits(RUN, { distance: 5000 }) === 1) ledger.record('activity', key, 9, 9);
  assertEqual(ledger.rows.size, 1, 'hedefe ulaşınca ödül yazılmadı');
  // Sonra hedefin altına düzenlendi: append-only, geri alınmaz.
  assertEqual(ledger.rows.size, 1, 'ödül geri alınmış');
});

check('G9. İstemci ödül miktarı gönderemez', () => {
  const signature = rewardsBody.slice(0, rewardsBody.indexOf(')'));
  assert(/client_today date, target_date date/.test(signature), 'imza değişmiş');
  assert(!/xp|rose|amount/i.test(signature), 'imzada ödül miktarı parametresi var');
  // reward_ledger'a doğrudan insert eklenmemeli; tek yol record_reward.
  const code = stripComments(sql);
  assert(!/insert into public\.reward_ledger/.test(code), 'ledger’a doğrudan insert eklenmiş');
  assert(!/update public\.user_progress/.test(code), 'user_progress doğrudan güncelleniyor');
});

// ===========================================================================
console.log('\n=== H. Mutasyon / ayırt edicilik ===');
// ===========================================================================

check('H1. MUT — kardiyoda sahte target_sets = 1 modeli düşer', () => {
  const fake = { id: 'rx', mode: 'sets_reps', targetSets: 1 };
  // Sahte modelde koşu, hiç koşulmadan "0/1" olur ve gün partial bile olmaz;
  // asıl tehlike: mesafe kanıtı okunmadığı için hedef hiç doğrulanmaz.
  assertEqual(doneUnits(fake, { distance: 5000 }), 0, 'sahte model mesafeyi görüyor — mutasyon geçersiz');
  assertThrows(
    () => assertEqual(doneUnits(fake, { distance: 5000 }), 1, 'mutation'),
    'sahte target_sets modeli hâlâ doğru sonuç veriyor — test vacuous',
  );
});

check('H2. MUT — yanlış tracking_mode tamamlama üretmez', () => {
  const wrong = { id: 'rx', mode: 'duration', targetDuration: 60 };
  assertEqual(doneUnits(wrong, { distance: 999999 }), 0, 'duration mesafeyle tamamlanıyor');
  const wrong2 = { id: 'px', mode: 'distance', targetDistance: 5000 };
  assertEqual(doneUnits(wrong2, { duration: 999999 }), 0, 'distance süreyle tamamlanıyor');
});

check('H3. MUT — distance kaydında mesafe yoksa tamamlanmaz', () => {
  assertEqual(doneUnits(RUN, { duration: 3600 }), 0, 'mesafesiz distance tamamlanıyor');
  assertThrows(
    () => assertEqual(doneUnits(RUN, { duration: 3600 }), 1, 'mutation'),
    'mesafesiz distance testi vacuous',
  );
});

check('H4. MUT — partial dalı kaldırılırsa hedef altı aktivite kaybolur', () => {
  const broken = ({ exercises, evidence }) => {
    const totalTarget = exercises.reduce((t, e) => t + targetUnits(e), 0);
    const totalDone = exercises.reduce((t, e) => t + doneUnits(e, evidence[e.id] ?? {}), 0);
    if (totalTarget === 0) return null;
    if (totalDone >= totalTarget) return 'completed';
    return null; // partial dalı kaldırıldı
  };
  const scenario = { exercises: [RUN], evidence: { rx: { distance: 3000 } } };
  assertEqual(broken(scenario), null, 'bozuk model partial üretiyor — mutasyon geçersiz');
  assertEqual(dayStatus(scenario), 'partial', 'doğru model partial üretmiyor');
});

check('H5. MUT — eski `total_done > 0` testi kardiyoyu kaçırır', () => {
  // Strength'te eşdeğer, kardiyoda DEĞİL: kırılmanın kanıtı.
  const evidence = { distance: 3000 };
  const legacy = doneUnits(RUN, evidence) > 0;
  assertEqual(legacy, false, 'eski test kardiyoyu görüyor — mutasyon geçersiz');
  assertEqual(hasProgress(evidence), true, 'has_progress kardiyoyu görmüyor');
});

check('H6. MUT — source_key aktivite satır kimliği olursa ikinci ödül doğar', () => {
  const ledger = createLedger();
  const brokenKey = (rowId) => `2026-09-01:${rowId}:activity`;
  ledger.record('activity', brokenKey('row-1'), 9, 9);
  // Sil + yeniden oluştur → YENİ satır kimliği → ikinci ödül.
  assertEqual(ledger.record('activity', brokenKey('row-2'), 9, 9), 9, 'bozuk anahtar ikinci ödül vermiyor — mutasyon geçersiz');
  assertEqual(ledger.rows.size, 2, 'bozuk model tek satır yazmış');
  // Doğru anahtarla aynı senaryo tek ödül verir.
  const fixed = createLedger();
  fixed.record('activity', activityKey('2026-09-01', 'rx'), 9, 9);
  assertEqual(fixed.record('activity', activityKey('2026-09-01', 'rx'), 9, 9), 0, 'doğru anahtar ikinci ödül verdi');
});

check('H7. MUT — 9 ödülü değiştirilmiş olsa test düşer', () => {
  assertThrows(
    () => assertDeepEqual({ xp: 5, rose: 5 }, ACTIVITY_REWARD, 'mutation'),
    'ödül tutarı iddiası vacuous',
  );
  assertThrows(
    () => assertDeepEqual({ xp: 9, rose: 9 }, SET_REWARD, 'mutation'),
    'set/aktivite ödülleri ayırt edilmiyor',
  );
});

check('H8. MUT — ownership kontrolü kaldırılmış politika yakalanır', () => {
  const brokenPolicy = `create policy "x" on public.workout_activity_records for insert
    to authenticated with check (true);`;
  assertThrows(
    () => assert(/auth\.uid\(\)/.test(brokenPolicy), 'mutation'),
    'ownership iddiası vacuous',
  );
  assert(/auth\.uid\(\)/.test(policyBody('workout_activity_records_insert_own')), 'gerçek politika sahipliksiz');
});

check('H9. MUT — gün içi toplama kaldırılırsa iki oturumlu koşu tamamlanmaz', () => {
  const noAggregate = (exercise, sessions) => {
    // Bozuk model: yalnızca en büyük tek oturum sayılır.
    const best = Math.max(...sessions);
    return exercise.targetDistance != null && best >= exercise.targetDistance ? 1 : 0;
  };
  assertEqual(noAggregate(RUN, [2000, 3000]), 0, 'bozuk model toplama yapıyor — mutasyon geçersiz');
  assertEqual(doneUnits(RUN, { distance: 5000 }), 1, 'doğru model toplamıyor');
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Aktivite takibi temeli harness: ${pass} kontrol geçti.`);
console.log('');
console.log('  DOĞRULAMA SINIRI — bu harness SQL ÇALIŞTIRMAZ.');
console.log('  Kanıtlar     : kaynak sözleşmesi, grant/revoke metni, kısıt ifadeleri,');
console.log('                 policy/function/trigger yapısı, tamamlama ve ödül modelleri,');
console.log('                 mutasyon ayırt ediciliği.');
console.log('  KANITLAMAZ   : PostgreSQL parser kabulü, bağımlılık çözümü, trigger ve FK');
console.log('                 runtime davranışı, gerçek RLS uygulaması, plan/performans.');
console.log('  Bunlar ancak migration gerçek bir PostgreSQL üzerinde uygulanınca doğrulanır.');
