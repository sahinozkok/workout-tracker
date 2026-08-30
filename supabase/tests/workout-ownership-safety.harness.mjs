/**
 * Antrenman sahipliği ve ödül güvenliği harness'ı.
 *
 * SINIR: SQL ÇALIŞTIRILMAZ. Üç katman:
 *
 *   A. YAPISAL — migration metni AYRIŞTIRILIR (politika gövdeleri, fonksiyon
 *      gövdeleri, preflight bloğu ayrı ayrı çıkarılır) ve iddialar yalnızca
 *      ilgili parça üzerinde kurulur. Yorumda geçen bir kelime testi geçiremez.
 *
 *   B. DAVRANIŞSAL — ödül tavanı, guard geçiş kuralları ve preflight
 *      sınıflandırması modellenir.
 *
 *   C. MUTASYON — yanlış/eski modeller aynı iddialara sokulur ve GERÇEKTEN
 *      düştükleri kanıtlanır.
 *
 * Çalıştırma:  node supabase/tests/workout-ownership-safety.harness.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

const MIGRATION_NAME = '20260906120000_add_workout_ownership_safety.sql';
const MIGRATION_PATH = `supabase/migrations/${MIGRATION_NAME}`;
const PHASE1_NAME = '20260905120000_add_activity_tracking_foundation.sql';

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
// Ayrıştırıcılar
// ---------------------------------------------------------------------------

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/** Yorumsuz tam metin — yapısal iddialar bunun üzerinde çalışır. */
const sqlCode = stripComments(sql);

function functionBody(name) {
  const head = sql.indexOf(`create or replace function public.${name}(`);
  assert(head !== -1, `fonksiyon bulunamadı: ${name}`);
  const end = sql.indexOf('\n$$;', head);
  assert(end !== -1, `fonksiyon gövdesi kapanmıyor: ${name}`);
  return sql.slice(head, end + 4);
}

/** `create policy "<name>"` ifadesinin kendi `);` kapanışına kadar olan gövdesi. */
function policyBody(name) {
  const head = sql.indexOf(`create policy "${name}"`);
  assert(head !== -1, `politika bulunamadı: ${name}`);
  const end = sql.indexOf('\n);', head);
  assert(end !== -1, `politika kapanmıyor: ${name}`);
  return sql.slice(head, end + 3);
}

/** Preflight `do $$ … $$;` bloğu. */
function preflightBlock() {
  const head = sql.indexOf('do $$');
  assert(head !== -1, 'preflight bloğu bulunamadı');
  const end = sql.indexOf('\n$$;', head);
  assert(end !== -1, 'preflight bloğu kapanmıyor');
  return sql.slice(head, end + 4);
}

const preflight = preflightBlock();
const preflightCode = stripComments(preflight);
const rewardsBody = functionBody('sync_workout_rewards');
const rewardsCode = stripComments(rewardsBody);
const sessionGuard = functionBody('workout_sessions_guard');
const sessionGuardCode = stripComments(sessionGuard);

/** Ödül fonksiyonundaki strength döngüsünü izole eder. */
function strengthLoop() {
  const head = rewardsCode.indexOf('for set_row in');
  assert(head !== -1, 'strength döngüsü yok');
  return rewardsCode.slice(head, rewardsCode.indexOf('end loop;', head));
}
/** Aktivite döngüsü. */
function activityLoop() {
  const head = rewardsCode.indexOf('for activity_row in');
  assert(head !== -1, 'aktivite döngüsü yok');
  return rewardsCode.slice(head, rewardsCode.indexOf('end loop;', head));
}

// ===========================================================================
console.log('=== A. Migration hijyeni ve Faz 1 bağımlılığı ===');
// ===========================================================================

/**
 * A1 ve A2 ORİJİNALDE tura özgüydü: "bu turda tam olarak şu iki yeni dosya var"
 * ve "başka hiçbir dosya değişmemiş". İkisi de bu migration'ın kendi turunda
 * doğruydu; commit edildikten ve depoda başka meşru çalışmalar yapıldıktan
 * sonra doğal olarak geçersizleşir — geçersizlikleri güvenlik sözleşmesiyle
 * İLGİSİZDİR. İddialar zayıflatılmadı, KALICI anlamlarına daraltıldı:
 * ikisi de artık migration'ın depoda izlendiğini ve uygulanmış migration'ların
 * kirletilmediğini ölçer. B–G'deki güvenlik kontrollerinden hiçbiri silinmedi.
 */
check('A1. Migration ve harness deponun parçası', () => {
  const tracked = execFileSync('git', ['ls-files', '--', MIGRATION_PATH, 'supabase/tests/workout-ownership-safety.harness.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .sort();
  assertDeepEqual(
    tracked,
    [MIGRATION_PATH, 'supabase/tests/workout-ownership-safety.harness.mjs'],
    'güvenlik migration’ı veya harness’ı izlenmiyor',
  );
});

/**
 * Değiştirilebilir tek yüzey `supabase/tests/` altındaki harness bakımıdır.
 *
 * Bu turda `activity-tracking-foundation.harness.mjs` içindeki İKİ FAZ SINIRI
 * iddiası güncellendi: "Faz 1 tek untracked migration'dır" ve "Faz 1 en son
 * sıradadır". İkisi de Faz 1'in kendi turunda doğruydu; Faz 1 commit edilip
 * sonrasına yeni bir migration eklendiğinde ikisi de doğal olarak geçersizleşir.
 * İddialar zayıflatılmadı, kalıcı anlamlarına daraltıldı.
 *
 * Migration ve istemci dosyalarına dokunmak HER KOŞULDA yasaktır.
 */
check('A2. Uygulanmış migration’lar kirletilmedi', () => {
  const dirtyMigrations = execFileSync('git', ['status', '--porcelain', '--', 'supabase/migrations'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter((line) => !line.startsWith('??'));
  assertEqual(dirtyMigrations.length, 0, `uygulanmış migration kirli: ${dirtyMigrations.join(', ')}`);
  const tracked = execFileSync('git', ['ls-files', 'supabase/migrations'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  assert(tracked.length >= 25, 'izlenen migration sayısı beklenenden az — kontrol vacuous');
});

check('A3. Faz 1 migration DEĞİŞTİRİLMEDİ', () => {
  const diff = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'supabase/migrations'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  assertEqual(diff, '', 'uygulanmış migration değiştirilmiş');
});

check('A4. Timestamp Faz 1’den SONRA ve çakışmıyor', () => {
  const names = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  /**
   * SÖZLEŞME GÜNCELLENDİ (gevşetilmedi, DÜZELTİLDİ).
   *
   * Eski iddia "ownership migration'ı GLOBAL olarak en son dosyadır" idi; bu,
   * yalnızca o an en yeni migration oydu diye doğruydu ve gerçek değişmez
   * değildi. `20260907120000_add_shared_active_program.sql` gibi SONRAKİ, ilgisiz
   * bir migration meşru şekilde eklendiğinde bu tesadüfi varsayım kırılır.
   *
   * GERÇEK değişmez: ownership migration'ı Faz 1'den (aktivite temeli) SONRA
   * sıralanır — çünkü onun kurduğu `tracking_mode` vb. kolonlara bağımlıdır — ve
   * hiçbir timestamp başka bir migration ile ÇAKIŞMAZ. Aşağıdaki kontroller bu
   * değişmezi doğrudan ve daha güçlü biçimde doğrular.
   */
  const phase1Index = names.indexOf(PHASE1_NAME);
  const ownershipIndex = names.indexOf(MIGRATION_NAME);
  assert(phase1Index !== -1, 'Faz 1 migration bulunamadı');
  assert(ownershipIndex !== -1, 'ownership migration bulunamadı');
  assert(ownershipIndex > phase1Index, 'ownership Faz 1’den sonra sıralanmıyor');
  // Faz 1 ile ownership arasında BAŞKA migration girmez: ownership doğrudan onun
  // üzerine inşa edilir.
  assertEqual(ownershipIndex, phase1Index + 1, 'ownership Faz 1’in hemen ardından gelmiyor');
  const stamps = names.map((n) => n.slice(0, 14));
  assertEqual(new Set(stamps).size, stamps.length, 'timestamp çakışması var');
});

check('A5. Tek atomik transaction', () => {
  assertEqual((sqlCode.match(/^begin;$/gm) ?? []).length, 1, 'begin; sayısı bir değil');
  assertEqual((sqlCode.match(/^commit;$/gm) ?? []).length, 1, 'commit; sayısı bir değil');
  assert(!/^rollback;$/m.test(sqlCode), 'koşulsuz rollback var');
  assert(!/commit;[\s\S]*begin;/.test(sqlCode), 'transaction bölünmüş');
  assert(sqlCode.indexOf('\nbegin;') < sqlCode.indexOf('\ncommit;'), 'begin/commit sırası yanlış');
});

check('A6. Faz 1 sözleşmesine dayanıyor', () => {
  assert(/tracking_mode = 'sets_reps'/.test(sqlCode), 'tracking_mode sözleşmesi kullanılmıyor');
  assert(/exercise_done_units\(/.test(sqlCode), 'Faz 1 yardımcısı korunmamış');
});

check('A7. Gizli bilgi ve attribution yok', () => {
  for (const pattern of [
    /eyJ[A-Za-z0-9_-]{15,}/,
    /BEGIN [A-Z ]*PRIVATE KEY/,
    /\b(claude|anthropic|generated-by|co-authored|assistant)\b/i,
    /@(gmail|icloud|me)\.com/,
    /(sk_live|EXPO_TOKEN|service_role)/,
    /postgresql:\/\//,
  ]) {
    assert(!pattern.test(sql), `yasak desen bulundu: ${pattern}`);
  }
});

// ===========================================================================
console.log('\n=== B. Preflight veri denetimi ===');
// ===========================================================================

check('B1. Yedi geçersizlik kategorisi de sayılıyor', () => {
  for (const counter of [
    'bad_session_partial_link',
    'bad_session_day_mismatch',
    'bad_session_owner',
    'bad_set_day_mismatch',
    'bad_set_owner',
    'bad_set_cardio',
    'bad_set_broken_session',
  ]) {
    assert(
      new RegExp(`select count\\(\\*\\) into ${counter}`).test(preflightCode),
      `kategori sayılmıyor: ${counter}`,
    );
  }
});

check('B2. Yarım bağ tespiti (tek-null) doğru ifade', () => {
  assert(
    /\(s\.program_id is null\) <> \(s\.program_day_id is null\)/.test(preflightCode),
    'yarım bağ testi yok',
  );
});

check('B3. Kardiyo-as-set tespiti', () => {
  assert(
    /pe\.tracking_mode is distinct from 'sets_reps'/.test(preflightCode),
    'kardiyo-as-set sayılmıyor',
  );
});

check('B4. FAIL-CLOSED: toplam > 0 ise transaction düşer', () => {
  assert(/total > 0 then/.test(preflightCode), 'toplam kontrolü yok');
  assert(/raise exception/.test(preflightCode), 'exception yok');
  assert(/workout_ownership_preflight_failed/.test(preflightCode), 'sabit hata kodu yok');
});

check('B5. OTOMATİK DÜZELTME YOK', () => {
  for (const forbidden of [/\bupdate\s+public\./i, /\bdelete\s+from\s+public\./i, /\btruncate\b/i]) {
    assert(!forbidden.test(preflightCode), `preflight veri değiştiriyor: ${forbidden}`);
  }
});

check('B6. Hata mesajında kişisel veri YOK — yalnız aggregate', () => {
  const detailStart = preflightCode.indexOf('detail =');
  assert(detailStart !== -1, 'detail bulunamadı');
  const detail = preflightCode.slice(detailStart, preflightCode.indexOf('hint =', detailStart));
  for (const forbidden of ['user_id', 'email', 's.id', 'ws.id', 'uuid', '::text']) {
    assert(!detail.includes(forbidden), `hata mesajında kişisel/kimlik verisi: ${forbidden}`);
  }
  // Yalnızca sayaç değişkenleri geçmeli.
  assert(/bad_session_partial_link/.test(detail), 'aggregate sayı raporlanmıyor');
});

check('B7. Geçerli tarihsel durumlar HATA SAYILMIYOR', () => {
  // Çift-NULL bağ: `<>` ifadesi ikisi de NULL iken false verir → sayılmaz.
  assertEqual(partialLinkIsInvalid(null, null), false, 'çift-NULL bağ hata sayılıyor');
  assertEqual(partialLinkIsInvalid('p', 'd'), false, 'geçerli bağ hata sayılıyor');
  assertEqual(partialLinkIsInvalid('p', null), true, 'yarım bağ yakalanmıyor');
  assertEqual(partialLinkIsInvalid(null, 'd'), true, 'yarım bağ yakalanmıyor');
  // NULL egzersizli set ve soft-delete: sorgular `is not null` ile filtreliyor.
  const setChecks = preflightCode.slice(preflightCode.indexOf('bad_set_day_mismatch'));
  assertEqual(
    (setChecks.match(/ws\.program_exercise_id is not null/g) ?? []).length,
    4,
    'NULL egzersizli tarihsel satır hata sayılabilir',
  );
  assert(!/deleted_at/.test(preflightCode), 'preflight soft-delete edilmiş satırı eliyor/sayıyor');
  assert(!/target_sets/.test(preflightCode), 'preflight ekstra setleri hata sayıyor');
});

/** `(a is null) <> (b is null)` SQL ifadesinin modeli. */
function partialLinkIsInvalid(programId, programDayId) {
  return (programId === null) !== (programDayId === null);
}

// ===========================================================================
console.log('\n=== C. workout_sessions politikaları ===');
// ===========================================================================

check('C1. INSERT açık owner/program/day zinciri', () => {
  const body = policyBody('workout_sessions_insert_own');
  assert(/\(select auth\.uid\(\)\) = user_id/.test(body), 'sahiplik yok');
  assert(/program_id is not null/.test(body), 'program_id non-null şartı yok');
  assert(/program_day_id is not null/.test(body), 'program_day_id non-null şartı yok');
  assert(/join public\.programs as pr on pr\.id = pd\.program_id/.test(body), 'program halkası yok');
  assert(/pd\.id = workout_sessions\.program_day_id/.test(body), 'gün bağı yok');
  assert(/pr\.id = workout_sessions\.program_id/.test(body), 'program bağı yok');
  assert(/pr\.owner_id = \(select auth\.uid\(\)\)/.test(body), 'program sahipliği yok');
});

check('C2. Aktif program / planlı gün şartı EKLENMEDİ', () => {
  const insert = policyBody('workout_sessions_insert_own');
  const update = policyBody('workout_sessions_update_own');
  for (const [label, body] of [['insert', insert], ['update', update]]) {
    assert(!/is_active/.test(body), `${label}: aktif program şartı eklenmiş — meşru akış daralır`);
    assert(!/scheduled_weekday/.test(body), `${label}: planlı gün şartı eklenmiş`);
    assert(!/active_from/.test(body), `${label}: active_from şartı eklenmiş`);
  }
});

check('C3. UPDATE kopuk (çift-NULL) tarihsel oturumu korur', () => {
  const body = policyBody('workout_sessions_update_own');
  assert(
    /program_id is null and program_day_id is null/.test(body),
    'silinmiş program sonrası oturum güncellenemez hâle gelmiş',
  );
  assert(/pr\.owner_id = \(select auth\.uid\(\)\)/.test(body), 'dolu bağ dalında sahiplik yok');
});

check('C4. SELECT ve DELETE politikaları DEĞİŞTİRİLMEDİ', () => {
  for (const action of ['select', 'delete']) {
    assert(
      !sqlCode.includes(`create policy "workout_sessions_${action}_own"`),
      `${action} politikası gereksiz yere yeniden tanımlanmış`,
    );
  }
});

check('C5. Grant/revoke sözleşmesi korunuyor', () => {
  assert(
    !/revoke[^;]*on table public\.workout_sessions/.test(sqlCode),
    'session tablo yetkisi değiştirilmiş',
  );
});

// ===========================================================================
console.log('\n=== D. workout_sessions guard ===');
// ===========================================================================

check('D1. Kimlik alanları değişmez', () => {
  for (const field of ['user_id', 'workout_date', 'started_at', 'created_at']) {
    assert(
      new RegExp(`new\\.${field} is distinct from old\\.${field}`).test(sessionGuardCode),
      `değişmez alan korunmuyor: ${field}`,
    );
  }
  assert(
    /new\.created_at is distinct from old\.created_at then\s*\n\s*raise exception 'session_identity_immutable'/.test(sessionGuardCode),
    'kimlik koşulu raise ile bağlı değil',
  );
});

check('D2. Program/gün bağı: NULL’a düşebilir, başka non-null’a GEÇEMEZ', () => {
  assert(
    /new\.program_id is not null and new\.program_id is distinct from old\.program_id/.test(sessionGuardCode),
    'program bağı korunmuyor',
  );
  assert(
    /new\.program_day_id is not null\s*\n?\s*and new\.program_day_id is distinct from old\.program_day_id/.test(sessionGuardCode),
    'gün bağı korunmuyor',
  );
  // Koşul METİNDE durup RAISE'i etkisizleştirilmiş olabilir: her koşulun
  // gerçekten bir exception'a bağlandığı ayrıca doğrulanır.
  for (const [condition, code] of [
    ['new\\.program_id is not null and new\\.program_id is distinct from old\\.program_id', 'session_program_immutable'],
    ['new\\.program_day_id is not null[\\s\\S]{0,80}?is distinct from old\\.program_day_id', 'session_program_day_immutable'],
  ]) {
    assert(
      new RegExp(`${condition} then\\s*\\n\\s*raise exception '${code}'`).test(sessionGuardCode),
      `koşul raise ile bağlı değil: ${code}`,
    );
  }
  // Model: FK set-null engellenmemeli.
  assertEqual(linkTransitionAllowed('p1', null), true, 'FK set-null engelleniyor');
  assertEqual(linkTransitionAllowed('p1', 'p2'), false, 'başka bağa geçiş serbest');
  assertEqual(linkTransitionAllowed(null, 'p2'), false, 'kopuk bağ yeniden bağlanabiliyor');
  assertEqual(linkTransitionAllowed('p1', 'p1'), true, 'değişmeyen bağ reddediliyor');
});

check('D3. deleted_at TEK YÖNLÜ', () => {
  assert(
    /old\.deleted_at is not null and new\.deleted_at is distinct from old\.deleted_at/.test(sessionGuardCode),
    'deleted_at tek yönlü değil',
  );
  assert(
    /old\.deleted_at is not null and new\.deleted_at is distinct from old\.deleted_at then\s*\n\s*raise exception 'session_delete_marker_immutable'/.test(sessionGuardCode),
    'deleted_at koşulu raise ile bağlı değil',
  );
  assertEqual(deletedAtAllowed(null, '2026-09-01'), true, 'ilk soft-delete engelleniyor');
  assertEqual(deletedAtAllowed('2026-09-01', null), false, 'undelete serbest');
  assertEqual(deletedAtAllowed('2026-09-01', '2026-09-02'), false, 'silme tarihi değiştirilebiliyor');
  assertEqual(deletedAtAllowed('2026-09-01', '2026-09-01'), true, 'değişmeyen değer reddediliyor');
  assertEqual(deletedAtAllowed(null, null), true, 'NULL→NULL reddediliyor');
});

check('D4. Meşru alanlar DÜZENLENEBİLİR kalıyor', () => {
  for (const field of ['status', 'last_resumed_at', 'accumulated_duration_seconds', 'completed_at', 'notes']) {
    assert(
      !new RegExp(`new\\.${field} is distinct from old\\.${field}`).test(sessionGuardCode),
      `meşru alan yanlışlıkla dondurulmuş: ${field}`,
    );
  }
});

check('D5. Guard etkisiz hâle getirilmemiş', () => {
  for (const neutralizer of [/\bif\s+false\b/i, /\band\s+false\b/i, /\bor\s+true\b/i]) {
    assert(!neutralizer.test(sessionGuardCode), `guard etkisiz: ${neutralizer}`);
  }
  assert(
    /create trigger workout_sessions_guard\s*\nbefore update on public\.workout_sessions\s*\nfor each row execute function public\.workout_sessions_guard\(\);/.test(sqlCode),
    'guard trigger kurulu değil (kaldırılmış veya yorum satırına alınmış)',
  );
});

check('D6. Guard execute yetkisi kapalı', () => {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert(
      new RegExp(`revoke all on function public\\.workout_sessions_guard\\(\\) from ${role};`).test(sqlCode),
      `${role} revoke yok`,
    );
  }
  assert(!/grant execute on function public\.workout_sessions_guard/.test(sqlCode), 'execute açılmış');
});

/** Guard'ın bağ geçiş kuralının modeli. */
function linkTransitionAllowed(oldValue, newValue) {
  if (newValue !== null && newValue !== oldValue) return false;
  return true;
}
/** Guard'ın deleted_at kuralının modeli. */
function deletedAtAllowed(oldValue, newValue) {
  if (oldValue !== null && newValue !== oldValue) return false;
  return true;
}

// ===========================================================================
console.log('\n=== E. workout_sets politikaları ve yetkileri ===');
// ===========================================================================

check('E1. INSERT tam sahiplik zinciri', () => {
  const body = policyBody('workout_sets_insert_own');
  assert(/s\.user_id = \(select auth\.uid\(\)\)/.test(body), 'oturum sahipliği yok');
  assert(/pr\.owner_id = \(select auth\.uid\(\)\)/.test(body), 'program sahipliği yok');
  assert(/s\.program_id = pr\.id/.test(body), 'oturum-program bağı yok');
  assert(/s\.program_day_id = pd\.id/.test(body), 'oturum-gün bağı yok');
  assert(/pe\.program_day_id = pd\.id/.test(body), 'egzersiz-gün bağı yok');
});

check('E2. YALNIZ sets_reps', () => {
  const body = policyBody('workout_sets_insert_own');
  assert(/pe\.tracking_mode = 'sets_reps'/.test(body), 'kardiyo-as-set engellenmiyor');
});

check('E3. NULL program_exercise_id insert kendiliğinden reddedilir', () => {
  const body = policyBody('workout_sets_insert_own');
  assert(/pe\.id = workout_sets\.program_exercise_id/.test(body), 'egzersiz join’i yok');
  assert(!/program_exercise_id is null/.test(body), 'NULL kaçışı açılmış');
});

check('E4. set_number tavanı politikaya EKLENMEDİ (ekstra set kaydedilebilir)', () => {
  const body = policyBody('workout_sets_insert_own');
  assert(!/set_number/.test(body), 'insert politikası ekstra set kaydını engelliyor');
  assert(!/target_sets/.test(body), 'insert politikası hedefe bakıyor');
});

check('E5. UPDATE yolu TAMAMEN kapatıldı', () => {
  assert(
    /drop policy if exists "workout_sets_update_own" on public\.workout_sets;/.test(sqlCode),
    'update politikası kaldırılmamış',
  );
  assert(
    !sqlCode.includes('create policy "workout_sets_update_own"'),
    'update politikası yeniden oluşturulmuş',
  );
  assert(
    /revoke update on table public\.workout_sets from authenticated;/.test(sqlCode),
    'UPDATE tablo yetkisi revoke edilmemiş',
  );
});

check('E6. SELECT/INSERT/DELETE yetkileri AÇIKÇA korunuyor', () => {
  assert(
    /grant select, insert, delete on table public\.workout_sets to authenticated;/.test(sqlCode),
    'kalan yetkiler açıkça verilmemiş',
  );
  // Revoke yalnızca UPDATE'i kapsamalı; toptan revoke yapılmamalı.
  assert(
    !/revoke all on table public\.workout_sets/.test(sqlCode),
    'toptan revoke — okuma/yazma da kapanır',
  );
});

check('E7. SELECT ve DELETE politikaları DEĞİŞTİRİLMEDİ', () => {
  for (const action of ['select', 'delete']) {
    assert(
      !sqlCode.includes(`create policy "workout_sets_${action}_own"`),
      `${action} politikası gereksiz yere yeniden tanımlanmış`,
    );
    assert(
      !sqlCode.includes(`drop policy if exists "workout_sets_${action}_own"`),
      `${action} politikası düşürülmüş — undo/orphan davranışı bozulur`,
    );
  }
});

check('E8. Set için guard trigger EKLENMEDİ (yol kapalı, guard gereksiz)', () => {
  assert(
    !/create trigger[^\n]*on public\.workout_sets/.test(sqlCode),
    'gereksiz set trigger’ı eklenmiş',
  );
});

// ===========================================================================
console.log('\n=== F. Ödül sözleşmesi ===');
// ===========================================================================

check('F1. Strength döngüsü tam zinciri uyguluyor', () => {
  const loop = strengthLoop();
  assert(/s\.user_id = actor/.test(loop), 'oturum sahipliği yok');
  assert(/pr\.owner_id = actor/.test(loop), 'program sahipliği yok');
  assert(/s\.program_id = pr\.id/.test(loop), 'oturum-program bağı yok');
  assert(/pe\.program_day_id = pd\.id/.test(loop), 'egzersiz-gün bağı yok');
  assert(/pd\.id = s\.program_day_id/.test(loop), 'oturum-gün bağı yok');
  assert(/pe\.tracking_mode = 'sets_reps'/.test(loop), 'kardiyo filtresi yok');
  assert(/ws\.program_exercise_id is not null/.test(loop), 'NULL filtresi yok');
});

check('F2. set_number <= target_sets TAVANI var', () => {
  const loop = strengthLoop();
  assert(/ws\.set_number <= pe\.target_sets/.test(loop), 'ekstra set tavanı yok');
  assert(/pe\.target_sets is not null/.test(loop), 'NULL target_sets korunmamış');
  assertEqual(setRewarded(1, 3), true, '1/3 ödüllenmiyor');
  assertEqual(setRewarded(3, 3), true, '3/3 ödüllenmiyor');
  assertEqual(setRewarded(4, 3), false, 'ekstra set ödüllendiriliyor');
  assertEqual(setRewarded(100, 3), false, 'tavan üstü ödüllendiriliyor');
});

check('F3. source_key biçimi DEĞİŞMEDİ ve session id içermiyor', () => {
  assert(
    /target_date::text \|\| ':' \|\| set_row\.program_exercise_id::text \|\| ':' \|\| set_row\.set_number::text/.test(rewardsBody),
    'set source_key şeması değişmiş',
  );
  const loop = strengthLoop();
  assert(!/s\.id/.test(loop.slice(loop.indexOf('record_reward'))), 'anahtara session id girmiş');
});

check('F4. Ödül tutarları değişmedi', () => {
  const setMatch = rewardsCode.match(/set_row\.set_number::text,\s*(\d+),\s*(\d+),/);
  assert(setMatch, 'set ödülü okunamadı');
  assertDeepEqual([Number(setMatch[1]), Number(setMatch[2])], [3, 3], 'set ödülü değişmiş');
  const actMatch = rewardsCode.match(/:activity',\s*(\d+),\s*(\d+),/);
  assert(actMatch, 'aktivite ödülü okunamadı');
  assertDeepEqual([Number(actMatch[1]), Number(actMatch[2])], [9, 9], 'aktivite ödülü değişmiş');
});

check('F5. Aktivite döngüsü Faz 1’deki gibi KORUNDU', () => {
  const loop = activityLoop();
  assert(/exercise_done_units\(actor, target_date, target_date, false\)/.test(loop), 'yardımcı çağrısı değişmiş');
  assert(/e\.tracking_mode in \('duration', 'distance'\)/.test(loop), 'tür filtresi değişmiş');
  assert(/ev\.done_units = 1/.test(loop), 'hedef filtresi değişmiş');
});

check('F6. deleted_at filtresi EKLENMEDİ', () => {
  assertEqual((rewardsCode.match(/deleted_at/g) ?? []).length, 0, 'ödül yoluna deleted_at filtresi girmiş');
});

check('F7. Gün/off-day/streak ve güvenlik kapıları korunuyor', () => {
  assert(/assert_client_today\(client_today\)/.test(rewardsCode), 'tarih kapısı kayıp');
  assert(/target_date > client_today or target_date < client_today - 1/.test(rewardsCode), 'tarih penceresi kayıp');
  assert(/pg_advisory_xact_lock/.test(rewardsCode), 'advisory lock kayıp');
  assert(/reconcile_day_rewards\(actor, target_date\)/.test(rewardsCode), 'gün/streak uzlaştırması kayıp');
  assert(/ensure_user_progress\(actor\)/.test(rewardsCode), 'progress hazırlığı kayıp');
});

check('F8. İmza ve güvenlik sözleşmesi korunuyor', () => {
  assert(/sync_workout_rewards\(client_today date, target_date date\)/.test(rewardsBody), 'imza değişmiş');
  assert(/security definer/.test(rewardsBody), 'security definer kayıp');
  assert(/set search_path = ''/.test(rewardsBody), 'search_path kayıp');
  assert(
    /grant execute on function public\.sync_workout_rewards\(date, date\) to authenticated;/.test(sqlCode),
    'grant kayıp',
  );
});

check('F9. Ledger satırları değiştirilmiyor', () => {
  assert(!/insert into public\.reward_ledger/.test(sqlCode), 'ledger’a doğrudan insert');
  assert(!/update public\.reward_ledger/.test(sqlCode), 'ledger güncelleniyor');
  assert(!/delete from public\.reward_ledger/.test(sqlCode), 'ledger siliniyor');
});

/** Ödül tavanının modeli. */
function setRewarded(setNumber, targetSets) {
  if (targetSets === null || targetSets === undefined) return false;
  return setNumber <= targetSets;
}

// ===========================================================================
console.log('\n=== G. Mutasyon / ayırt edicilik ===');
// ===========================================================================

check('G1. MUT — session date guard kaldırılırsa yakalanır', () => {
  const broken = sessionGuardCode.replace(/new\.workout_date is distinct from old\.workout_date/, 'false');
  assertThrows(
    () => assert(/new\.workout_date is distinct from old\.workout_date/.test(broken), 'mutation'),
    'workout_date iddiası vacuous',
  );
});

check('G2. MUT — deleted_at tekrar NULL yapılabilseydi model düşerdi', () => {
  const permissive = () => true;
  assertEqual(permissive('2026-09-01', null), true, 'gevşek model reddediyor — mutasyon geçersiz');
  assertEqual(deletedAtAllowed('2026-09-01', null), false, 'gerçek model undelete’e izin veriyor');
});

check('G3. MUT — çapraz sahiplik zinciri kaldırılmış politika yakalanır', () => {
  const brokenPolicy = 'create policy "x" for insert to authenticated with check (true);';
  assertThrows(
    () => assert(/pr\.owner_id = \(select auth\.uid\(\)\)/.test(brokenPolicy), 'mutation'),
    'sahiplik iddiası vacuous',
  );
  assert(/pr\.owner_id = \(select auth\.uid\(\)\)/.test(policyBody('workout_sets_insert_own')), 'gerçek politika sahipliksiz');
});

check('G4. MUT — tracking_mode filtresi kaldırılırsa kardiyo ödüllenir', () => {
  const brokenLoop = strengthLoop().replace(/pe\.tracking_mode = 'sets_reps'/, 'true');
  assertThrows(
    () => assert(/pe\.tracking_mode = 'sets_reps'/.test(brokenLoop), 'mutation'),
    'tracking_mode iddiası vacuous',
  );
});

check('G5. MUT — target_sets tavanı kaldırılırsa ekstra set ödüllenir', () => {
  const uncapped = (setNumber) => setNumber >= 1;
  assertEqual(uncapped(100), true, 'tavansız model reddediyor — mutasyon geçersiz');
  assertEqual(setRewarded(100, 3), false, 'gerçek model tavansız');
  const brokenLoop = strengthLoop().replace(/ws\.set_number <= pe\.target_sets/, 'true');
  assertThrows(
    () => assert(/ws\.set_number <= pe\.target_sets/.test(brokenLoop), 'mutation'),
    'tavan iddiası vacuous',
  );
});

check('G6. MUT — set UPDATE grant’i geri açılırsa yakalanır', () => {
  const broken = sqlCode.replace(
    /revoke update on table public\.workout_sets from authenticated;/,
    'grant update on table public.workout_sets to authenticated;',
  );
  assertThrows(
    () => assert(/revoke update on table public\.workout_sets from authenticated;/.test(broken), 'mutation'),
    'UPDATE revoke iddiası vacuous',
  );
});

check('G7. MUT — NULL PE insert açılırsa yakalanır', () => {
  const broken = policyBody('workout_sets_insert_own').replace(
    /pe\.id = workout_sets\.program_exercise_id/,
    'workout_sets.program_exercise_id is null',
  );
  assertThrows(
    () => assert(/pe\.id = workout_sets\.program_exercise_id/.test(broken), 'mutation'),
    'NULL insert iddiası vacuous',
  );
});

check('G8. MUT — deleted_at filtresi eklenirse mevcut semantik değişir', () => {
  const broken = rewardsCode.replace('s.user_id = actor', 's.user_id = actor and s.deleted_at is null');
  assertEqual((broken.match(/deleted_at/g) ?? []).length, 1, 'mutasyon uygulanmadı');
  assertThrows(
    () => assertEqual((broken.match(/deleted_at/g) ?? []).length, 0, 'mutation'),
    'deleted_at yokluğu iddiası vacuous',
  );
});

check('G9. MUT — aktif program şartı eklenirse meşru akış daralır', () => {
  const broken = policyBody('workout_sessions_insert_own').replace('pr.owner_id', 'pr.is_active and pr.owner_id');
  assertThrows(
    () => assert(!/is_active/.test(broken), 'mutation'),
    'aktif program yokluğu iddiası vacuous',
  );
  assert(!/is_active/.test(policyBody('workout_sessions_insert_own')), 'gerçek politika aktif program istiyor');
});

check('G10. MUT — FK set-null engellenirse yakalanır', () => {
  const strict = (oldValue, newValue) => newValue === oldValue;
  assertEqual(strict('p1', null), false, 'katı model set-null’a izin veriyor — mutasyon geçersiz');
  assertEqual(linkTransitionAllowed('p1', null), true, 'gerçek model FK set-null’ı engelliyor');
});

check('G11. MUT — preflight otomatik temizlik yapsaydı yakalanırdı', () => {
  const broken = 'delete from public.workout_sets where true;';
  assertThrows(
    () => assert(!/\bdelete\s+from\s+public\./i.test(broken), 'mutation'),
    'otomatik temizlik iddiası vacuous',
  );
});

check('G12. MUT — preflight fail-open olsaydı yakalanırdı', () => {
  const broken = preflightCode.replace(/total > 0 then/, 'false then');
  assertThrows(
    () => assert(/total > 0 then/.test(broken), 'mutation'),
    'fail-closed iddiası vacuous',
  );
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Antrenman sahipliği güvenliği harness: ${pass} kontrol geçti.`);
console.log('');
console.log('  DOĞRULAMA SINIRI — bu harness SQL ÇALIŞTIRMAZ.');
console.log('  Kanıtlar   : kaynak sözleşmesi, politika/guard/preflight yapısı, ödül tavanı');
console.log('               modeli, grant/revoke metni, mutasyon ayırt ediciliği.');
console.log('  KANITLAMAZ : PostgreSQL parser kabulü, gerçek RLS uygulaması, trigger ve FK');
console.log('               runtime davranışı, preflight sorgularının gerçek sonuçları.');
