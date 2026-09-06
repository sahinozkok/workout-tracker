#!/usr/bin/env node
/**
 * SEVİYE GÜLÜ — GERÇEK HTTP OTURUM TESTİ (PostgREST + GoTrue, YENİ SÖZLEŞME)
 *
 * Bu test, izole/stub ve tek-transaction authz testlerinin AKSİNE, RPC'leri
 * GERÇEK istemci yolundan (GoTrue ile oturum aç → JWT → PostgREST `/rpc`) çağırır
 * ve `get_friend_level_rose`'un YENİ `returns table` sözleşmesini uçtan uca
 * doğrular: erişim reddi (0 satır) ile otomatik tercih (1 satır + null) AYRIDIR.
 *
 * GÜVENLİK / VERİ KORUMA:
 *   * Yerel adres ve anahtarlar ÇALIŞMA ANINDA ortamdan/.env'den alınır; dosyaya
 *     GÖMÜLMEZ. Token/parola HİÇBİR yere yazdırılmaz.
 *   * Test parolaları rastgele ÜRETİLİR (crypto), tek kullanımlıktır.
 *   * Yalnız YEREL adres kabul edilir; canlı/uzak adres REDDEDİLİR (erken çıkış).
 *   * Yalnız TESTİN OLUŞTURDUĞU kullanıcılar sonda silinir (cascade); mevcut
 *     geliştirme verisi/kullanıcıları KORUNUR. DB SIFIRLANMAZ.
 *   * Ayrıcalık gerektiren kurulum/temizlik (seviye ayarı, kullanıcı silme) yerel
 *     DB konteynerinde `docker exec psql` ile YALNIZ bu test kayıtlarını hedefler.
 *
 * ÖN KOŞUL: yeni migration (`20260911...`) yerel DB'ye uygulanmış olmalı
 * (get_friend_level_rose `returns table`). Uygulanmamışsa test bunu bildirip
 * atlar (skaler sözleşmede bu test anlamlı değildir).
 *
 * ÇALIŞTIRMA:  node ./scripts/verify-level-rose-http.mjs
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal']);
const isLocalUrl = (u) => {
  try {
    return LOCAL_HOSTS.has(new URL(u).hostname);
  } catch {
    return false;
  }
};

/**
 * Yerel Supabase stack'ini KONTEYNERLERDEN keşfeder (URL + anon anahtarı çalışma
 * anında; dosyaya gömülü DEĞİL). Böylece `.env` CANLI adrese işaret etse bile bu
 * test yalnız YEREL'e çalışır ve canlıyı ASLA hedeflemez.
 */
function discoverLocalStack() {
  try {
    const kong = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' })
      .split('\n')
      .find((n) => /supabase_kong_/.test(n));
    if (!kong) return {};
    const portsJson = execFileSync('docker', ['inspect', kong], { encoding: 'utf8' });
    const hostPort = JSON.parse(portsJson)[0]?.NetworkSettings?.Ports?.['8000/tcp']?.[0]?.HostPort;
    const storage = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' })
      .split('\n')
      .find((n) => /supabase_storage_/.test(n));
    const anonKey = storage ? execFileSync('docker', ['exec', storage, 'printenv', 'ANON_KEY'], { encoding: 'utf8' }).trim() : '';
    if (hostPort && anonKey) return { url: `http://127.0.0.1:${hostPort}`, anon: anonKey };
  } catch {
    /* docker yoksa/keşif başarısızsa boş döner */
  }
  return {};
}

// --- Config: (1) ortam, (2) .env — YALNIZ yerel URL ise; (3) yerel stack keşfi ---
function loadConfig() {
  let url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  let anon = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) {
    let env = '';
    try {
      env = readFileSync(resolve(ROOT, '.env'), 'utf8');
    } catch {
      /* .env yoksa atlanır */
    }
    const pick = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '');
    url = url || pick('EXPO_PUBLIC_SUPABASE_URL');
    anon = anon || pick('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }
  // .env genelde CANLI adrese işaret eder → yerel değilse yerel stack'i keşfet.
  if (!url || !anon || !isLocalUrl(url)) {
    const local = discoverLocalStack();
    if (local.url) return local;
  }
  return { url, anon };
}

const { url, anon } = loadConfig();
if (!url || !anon) {
  console.error('EKSİK KONFİG: yerel Supabase URL/anon anahtarı bulunamadı (ortam/.env/konteyner keşfi). `supabase start` çalışıyor mu?');
  process.exit(1);
}

// --- YALNIZ YEREL: canlı/uzak adres REDDEDİLİR ---
if (!isLocalUrl(url)) {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  console.error(`GÜVENLİK DURDURMASI: yalnız yerel adres desteklenir; reddedilen host: "${host}". Canlı/uzak DB'ye çalıştırılmaz.`);
  process.exit(1);
}

// --- Yerel DB konteyneri (ayrıcalıklı kurulum/temizlik için) ---
function findDbContainer() {
  const out = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  return out.split('\n').find((n) => /supabase_db_/.test(n));
}
const DB = findDbContainer();
if (!DB) {
  console.error('Yerel Supabase DB konteyneri bulunamadı (supabase_db_*). `supabase start` çalışıyor olmalı.');
  process.exit(1);
}
const psql = (sql) =>
  execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql], {
    encoding: 'utf8',
  }).trim();

// --- Ön koşul: fonksiyon TABLO sözleşmesinde mi? ---
const sig = psql(
  "select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_friend_level_rose';",
);
if (sig !== 'TABLE(selected_level_rose text)') {
  console.error(
    `ATLANDI: get_friend_level_rose yeni sözleşmede değil (imza: "${sig}"). Yeni migration yerel DB'ye uygulanmalı; skaler sözleşmede bu HTTP testi anlamlı değil.`,
  );
  process.exit(2);
}

// --- HTTP yardımcıları ---
const authHeaders = (token) => ({
  apikey: anon,
  Authorization: `Bearer ${token ?? anon}`,
  'Content-Type': 'application/json',
});

async function signUp() {
  // Rastgele e-posta + parola (parola HİÇBİR yere yazdırılmaz).
  const tag = randomBytes(6).toString('hex');
  const email = `lrhttp-${tag}@test.local`;
  const password = `P${randomBytes(18).toString('base64url')}!9`;
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token || !body.user?.id) {
    throw new Error(`signup başarısız (${res.status}) — autoconfirm kapalı olabilir`);
  }
  return { id: body.user.id, token: body.access_token };
}

async function rpc(name, args, token) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

// --- Test koşucusu ---
let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

const created = [];
async function main() {
  // 1) Üç gerçek oturum aç (A, B, C).
  const A = await signUp();
  const B = await signUp();
  const C = await signUp();
  created.push(A.id, B.id, C.id);

  // 2) Ayrıcalıklı kurulum (yalnız bu üç kullanıcı): L15 için XP + profil/ilerleme.
  const ids = `('${A.id}'::uuid,'${B.id}'::uuid,'${C.id}'::uuid)`;
  psql(`insert into public.profiles(id) values ('${A.id}'),('${B.id}'),('${C.id}') on conflict (id) do nothing;`);
  for (const u of [A, B, C]) psql(`select public.ensure_user_progress('${u.id}'::uuid);`);
  psql(`update public.user_progress set lifetime_xp=2820, selected_level_rose=null where user_id in ${ids};`); // L15

  // 3) A↔B arkadaşlığı GERÇEK RPC yoluyla (send + accept).
  const req = await rpc('send_friend_request', { target_user_id: B.id }, A.token);
  assert(req.ok, `arkadaşlık isteği gönderilemedi (${req.status})`);
  const friendshipId = req.data;
  const resp = await rpc('respond_to_friend_request', { accept: true, friendship_id: friendshipId }, B.token);
  assert(resp.ok, `arkadaşlık isteği kabul edilemedi (${resp.status})`);

  // --- ASSERTLER ---

  await check('1. Yetkili arkadaş + KİMLİK → seçilmiş gül (1 satır)', async () => {
    const set = await rpc('set_my_level_rose', { target_rose: 'rose_15' }, B.token);
    assert(set.ok, `B rose_15 ayarlayamadı (${set.status})`);
    const read = await rpc('get_friend_level_rose', { target_user_id: B.id }, A.token);
    assert(read.ok, `A okuma hatası (${read.status})`);
    assert(Array.isArray(read.data) && read.data.length === 1, `beklenen 1 satır, gelen ${JSON.stringify(read.data)}`);
    assert.equal(read.data[0].selected_level_rose, 'rose_15', 'seçili gül rose_15 olmalı');
  });

  await check('2. Yetkili arkadaş + null → OTOMATİK (1 satır + null, denied DEĞİL)', async () => {
    const set = await rpc('set_my_level_rose', { target_rose: null }, B.token);
    assert(set.ok, `B otomatik moda dönemedi (${set.status})`);
    const read = await rpc('get_friend_level_rose', { target_user_id: B.id }, A.token);
    assert(read.ok, `A okuma hatası (${read.status})`);
    assert(Array.isArray(read.data) && read.data.length === 1, `otomatik: beklenen 1 satır (erişim var), gelen ${JSON.stringify(read.data)}`);
    assert.equal(read.data[0].selected_level_rose, null, 'otomatik modda değer null olmalı');
  });

  await check('3. Arkadaş OLMAYAN → erişim yok (0 satır; otomatik DEĞİL)', async () => {
    const read = await rpc('get_friend_level_rose', { target_user_id: B.id }, C.token);
    assert(read.ok, `okuma isteği hata verdi (${read.status})`);
    assert(Array.isArray(read.data) && read.data.length === 0, `erişim reddi 0 satır olmalı, gelen ${JSON.stringify(read.data)}`);
  });

  await check('4. Oturumsuz seçim reddedilir', async () => {
    // Authorization YOK (yalnız anon apikey). auth.uid() null → RPC reddeder.
    const res = await fetch(`${url}/rest/v1/rpc/set_my_level_rose`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_rose: 'rose_1' }),
    });
    assert(!res.ok, `oturumsuz istek kabul edildi (status ${res.status})`);
  });

  await check('5. KİLİTLİ gül reddedilir (L15 kullanıcı rose_20)', async () => {
    const res = await rpc('set_my_level_rose', { target_rose: 'rose_20' }, A.token);
    assert(!res.ok, `kilitli gül kabul edildi (status ${res.status})`);
  });

  await check('6. BİLİNMEYEN gül reddedilir', async () => {
    const res = await rpc('set_my_level_rose', { target_rose: 'rose_999' }, A.token);
    assert(!res.ok, `bilinmeyen gül kabul edildi (status ${res.status})`);
  });

  await check("7. Başka kullanıcıya yazma yolu YOK (A yalnız kendi satırını değiştirir)", async () => {
    // set_my_level_rose HEDEF ALMAZ; A'nın çağrısı yalnız A'yı etkiler. B null (auto) kalmalı.
    const set = await rpc('set_my_level_rose', { target_rose: 'rose_5' }, A.token);
    assert(set.ok, `A kendi seçimini yapamadı (${set.status})`);
    const bRose = psql(`select coalesce(selected_level_rose,'<null>') from public.user_progress where user_id='${B.id}'::uuid;`);
    assert.equal(bRose, '<null>', "A'nın yazımı B'yi etkiledi");
    const aRose = psql(`select selected_level_rose from public.user_progress where user_id='${A.id}'::uuid;`);
    assert.equal(aRose, 'rose_5', 'A kendi seçimini yazamadı');
  });

  await check('8. Doğrudan tablo UPDATE (PostgREST) doğrulamayı aşamaz (RLS)', async () => {
    const res = await fetch(`${url}/rest/v1/user_progress?user_id=eq.${A.id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(A.token), Prefer: 'return=representation' },
      body: JSON.stringify({ selected_level_rose: 'rose_10' }),
    });
    const rows = res.ok ? await res.json() : [];
    assert(Array.isArray(rows) && rows.length === 0, `doğrudan UPDATE satır etkiledi: ${JSON.stringify(rows)}`);
    // Değer hâlâ RPC ile yazılan rose_5; PATCH değiştirmedi.
    const aRose = psql(`select selected_level_rose from public.user_progress where user_id='${A.id}'::uuid;`);
    assert.equal(aRose, 'rose_5', 'doğrudan UPDATE seçimi değiştirdi (RLS aşıldı)');
  });

  await check('9. XP / roses seçimlerle DEĞİŞMEZ', async () => {
    const row = psql(`select lifetime_xp||'|'||rose_balance from public.user_progress where user_id='${A.id}'::uuid;`);
    const [xp, roses] = row.split('|');
    assert.equal(xp, '2820', `lifetime_xp değişti: ${xp}`);
    assert.equal(roses, '0', `rose_balance değişti: ${roses}`);
    assert.equal(psql('select public.level_for_xp(2820);'), '15', 'seviye değişti');
  });
}

async function cleanup() {
  // YALNIZ testin oluşturduğu kullanıcılar silinir (cascade: profiles/user_progress/
  // friendships). Mevcut geliştirme kullanıcıları/verisi KORUNUR.
  if (created.length === 0) return;
  const list = created.map((id) => `'${id}'::uuid`).join(',');
  try {
    psql(`delete from auth.users where id in (${list});`);
  } catch (error) {
    console.error(`UYARI: test kullanıcıları temizlenemedi (${created.length} kayıt): ${error.message}`);
  }
}

try {
  await main();
} catch (error) {
  failures.push(`kurulum/çalıştırma: ${error.message}`);
} finally {
  await cleanup();
}

if (failures.length > 0) {
  console.error(`\n✗ HTTP oturum testi: ${failures.length} başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Seviye gülü HTTP oturum testi: ${passed} kontrol geçti (GoTrue oturum + PostgREST /rpc, yeni tablo sözleşmesi).`);
console.log('  (Yerel-only; test kullanıcıları oluşturuldu ve silindi; token/parola yazdırılmadı.)');
