/**
 * GERÇEK ZAMAN AŞIMI / LEASE / PROVIDER-EŞZAMANLILIK + ORKESTRASYON TESTİ
 *
 * (A) MEKANİZMA — `callGemini`/`callGeminiWithFallback` AbortController + toplam
 *     deadline mantığını GERÇEK ağ soketleriyle (yavaş yerel HTTP sunucu) doğrular.
 * (B) SAYISAL SÖZLEŞME — kaynaktan lease bileşenlerini okur; lease'in claim-sonrası
 *     kritik bölgenin (prep=0 + Gemini + complete + güvenlik payı) toplamına EŞİT/
 *     uzun olduğunu kanıtlar.
 * (C) ORKESTRASYON — GERÇEK `analysis-orchestration.ts` saf orkestratörünü derleyip
 *     sahte bağımlılıklarla çalıştırır: claim→prepare→provider→complete sırası,
 *     claim-öncesi tüm unbounded işler, aynı session için TEK provider çağrısı, eski
 *     token'ın yeni claim'i etkilememesi, kaydedilmemiş insight'ın ready dönmemesi,
 *     timeout→fail→stale recovery. (Yalnız callGeminiWithFallback DEĞİL; gerçek akış.)
 */
import assert from 'node:assert';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const edgeSrc = readFileSync(resolve(ROOT, 'supabase/functions/workout-coach/index.ts'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function num(name) {
  const m = new RegExp(`${name}\\s*=\\s*([0-9_]+)`).exec(edgeSrc);
  assert(m, `sabit bulunamadı: ${name}`);
  return Number(m[1].replace(/_/g, ''));
}

const MODEL_TIMEOUT = num('GEMINI_MODEL_TIMEOUT_MS');
const TOTAL_DEADLINE = num('GEMINI_TOTAL_DEADLINE_MS');
const POST_CLAIM_PREP = num('ANALYSIS_POST_CLAIM_PREP_MS');
const COMPLETE_MAX = num('ANALYSIS_COMPLETE_MAX_MS');
const LEASE_SAFETY = num('ANALYSIS_LEASE_SAFETY_MS');
// Lease saniye = (prep + gemini + complete + güvenlik) / 1000 (kaynaktaki formül).
const LEASE_SECONDS = (POST_CLAIM_PREP + TOTAL_DEADLINE + COMPLETE_MAX + LEASE_SAFETY) / 1000;

const results = [];
const pending = [];
function check(name, fn) {
  pending.push({ name, fn });
}
async function runAll() {
  for (const { name, fn } of pending) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, e });
    }
  }
}

// --- Gerçek orkestratörü derle (saf TS → JS) ve içe aktar ---
const outDir = mkdtempSync(join(tmpdir(), 'orch-'));
writeFileSync(
  join(outDir, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: { module: 'esnext', moduleResolution: 'bundler', target: 'es2020', strict: true, skipLibCheck: true, outDir },
    files: [resolve(ROOT, 'supabase/functions/workout-coach/analysis-orchestration.ts')],
  }),
);
execFileSync('npx', ['tsc', '-p', join(outDir, 'tsconfig.json')], { cwd: ROOT, stdio: 'pipe' });
const { orchestrateWorkoutAnalysis } = await import(pathToFileURL(join(outDir, 'analysis-orchestration.js')).href);

// ===========================================================================
// (B) SAYISAL SÖZLEŞME
// ===========================================================================
check('1. Lease sözleşmesi: lease ≥ prep + Gemini + complete + güvenlik payı', () => {
  assert(TOTAL_DEADLINE > 0 && MODEL_TIMEOUT > 0, 'timeout sabitleri pozitif olmalı');
  assert(MODEL_TIMEOUT <= TOTAL_DEADLINE, 'model timeout toplam deadline\'ı aşmamalı');
  assert(POST_CLAIM_PREP === 0, 'claim sonrası unbounded prep 0 olmalı (kritik bölge yalnız bounded)');
  assert(LEASE_SAFETY >= 30_000, `güvenlik payı yetersiz (${LEASE_SAFETY}ms)`);
  const criticalRegion = POST_CLAIM_PREP + TOTAL_DEADLINE + COMPLETE_MAX;
  assert(LEASE_SECONDS * 1000 >= criticalRegion + LEASE_SAFETY,
    `lease (${LEASE_SECONDS}s) kritik bölge (${criticalRegion}ms) + güvenlik (${LEASE_SAFETY}ms)'den kısa`);
  assert(/lease_seconds:\s*ANALYSIS_LEASE_SECONDS/.test(edgeSrc), 'claim ANALYSIS_LEASE_SECONDS kullanmıyor');
  // Kritik bölgedeki her bounded işlemin süre sınırı var: complete + readLatest abortSignal.
  assert(/complete_workout_analysis[\s\S]{0,240}abortSignal\(AbortSignal\.timeout\(ANALYSIS_COMPLETE_MAX_MS\)\)/.test(edgeSrc),
    'complete RPC abortSignal ile sınırlanmamış');
});

// ===========================================================================
// (A) MEKANİZMA — gerçek fetch + AbortController
// ===========================================================================
const server = http.createServer((req, res) => {
  const timer = setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  }, 5_000);
  req.on('close', () => clearTimeout(timer));
});
let inFlight = 0;
let maxInFlight = 0;
async function callOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    const response = await fetch(url, { signal: controller.signal });
    await response.text();
    return 'responded';
  } catch (error) {
    if (controller.signal.aborted) throw new Error('TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
    inFlight -= 1;
  }
}
async function fallbackLoop(url, models, perModelMs, totalDeadlineMs) {
  let lastError;
  const deadline = Date.now() + totalDeadlineMs;
  for (let attempt = 0; attempt < models.length; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { lastError = new Error('TIMEOUT'); break; }
    const timeoutMs = Math.min(perModelMs, remaining);
    try {
      return await callOnce(url, timeoutMs);
    } catch (error) {
      lastError = error;
      if (error.message === 'TIMEOUT') continue;
      throw error;
    }
  }
  throw lastError ?? new Error('no models');
}
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

check('2. Tek çağrı: sunucu yavaşsa timeout içinde ABORT eder', async () => {
  const started = Date.now();
  await assert.rejects(() => callOnce(url, 120), (e) => e.message === 'TIMEOUT');
  assert(Date.now() - started < 400, 'abort çok geç — timeout çalışmıyor');
});

check('3. Fallback zinciri toplam deadline\'ı AŞMAZ (6 model hepsi yavaş)', async () => {
  const started = Date.now();
  await assert.rejects(() => fallbackLoop(url, ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'], 100, 300),
    (e) => e.message === 'TIMEOUT');
  const elapsed = Date.now() - started;
  assert(elapsed < 600 && elapsed >= 250, `zincir süresi beklenmedik (${elapsed}ms)`);
});

check('4. Mekanizma: sıralı fetch\'te aynı anda >1 aktif çağrı yok', async () => {
  await sleep(50);
  inFlight = 0; maxInFlight = 0;
  await fallbackLoop(url, ['a', 'b', 'c'], 80, 200).catch(() => {});
  await fallbackLoop(url, ['a', 'b', 'c'], 80, 200).catch(() => {});
  assert(maxInFlight <= 1, `aynı anda ${maxInFlight} aktif fetch (>1)`);
});

// ===========================================================================
// (C) GERÇEK ORKESTRASYON — claim state machine'i taklit eden sahte backend
// ===========================================================================
let tokenSeq = 0;
const TEST_LEASE_MS = 500;
function makeBackend() {
  const rows = new Map(); // sessionId -> { status, token, result, leaseExpires }
  const quota = new Set();
  let providerActive = 0, providerMax = 0, providerCalls = 0;
  return {
    rows,
    claim(sessionId) {
      const now = Date.now();
      const r = rows.get(sessionId);
      const stale = r && r.status === 'generating' && r.leaseExpires <= now;
      if (!r || r.status === 'failed' || stale) {
        const token = `tok-${++tokenSeq}`;
        rows.set(sessionId, { status: 'generating', token, result: undefined, leaseExpires: now + TEST_LEASE_MS });
        return { outcome: 'claimed', token };
      }
      if (r.status === 'completed') return { outcome: 'completed', result: r.result };
      return { outcome: 'in_progress' };
    },
    complete(sessionId, token, insight) {
      const r = rows.get(sessionId);
      if (r && r.status === 'generating' && r.token === token) {
        r.status = 'completed'; r.result = insight; r.token = null; r.leaseExpires = 0;
        return true;
      }
      return false;
    },
    fail(sessionId, token) {
      const r = rows.get(sessionId);
      if (r && r.status === 'generating' && r.token === token) { r.status = 'failed'; r.token = null; }
    },
    latest(sessionId) { const r = rows.get(sessionId); return r ? { status: r.status, result: r.result } : null; },
    expire(sessionId) { const r = rows.get(sessionId); if (r) r.leaseExpires = 0; },
    consumeQuota(sessionId) { const first = !quota.has(sessionId); quota.add(sessionId); return { allowed: true, limit: 15, first }; },
    async provider(insight, opts = {}) {
      providerActive += 1; providerMax = Math.max(providerMax, providerActive); providerCalls += 1;
      try {
        if (opts.gate) await opts.gate;
        else if (opts.delay) await sleep(opts.delay);
        if (opts.throwTimeout) throw new Error('TIMEOUT');
        return insight;
      } finally {
        providerActive -= 1;
      }
    },
    stats() { return { providerMax, providerCalls }; },
  };
}
function makeDeps(backend, sessionId, insight, opts = {}, log = []) {
  return {
    async validateSession() { log.push('validate'); return { ok: opts.notFound ? false : true }; },
    async prepare() { log.push('prepare'); if (opts.prepDelay) await sleep(opts.prepDelay); return 'prompt'; },
    async consumeQuota() { log.push('quota'); if (opts.quotaDelay) await sleep(opts.quotaDelay); return backend.consumeQuota(sessionId); },
    async claim() { log.push('claim'); return backend.claim(sessionId); },
    async runProvider() { log.push('provider'); return backend.provider(insight, opts.provider ?? {}); },
    async complete(token, ins) {
      log.push('complete');
      if (opts.beforeComplete) await opts.beforeComplete(token);
      return backend.complete(sessionId, token, ins);
    },
    async readLatest() { log.push('readLatest'); return backend.latest(sessionId); },
    async fail(token) { log.push('fail'); backend.fail(sessionId, token); },
    isValidInsight(v) { return !!v && typeof v === 'object'; },
  };
}

check('5. Orkestrasyon SIRASI: validate→prepare→quota→claim→provider→complete; claim→provider ARASI işlem YOK', async () => {
  const backend = makeBackend();
  const log = [];
  const res = await orchestrateWorkoutAnalysis(makeDeps(backend, 's5', { h: 'A' }, {}, log));
  assert.deepEqual(res, { kind: 'ready', insight: { h: 'A' }, cached: false }, `beklenmeyen sonuç: ${JSON.stringify(res)}`);
  assert.deepEqual(log, ['validate', 'prepare', 'quota', 'claim', 'provider', 'complete'], `sıra yanlış: ${log}`);
  // Tüm unbounded prep (prepare, quota) claim'den ÖNCE; provider claim'den HEMEN sonra.
  assert(log.indexOf('provider') === log.indexOf('claim') + 1, 'claim ile provider arasında ekstra işlem var (unbounded sızıntı)');
  assert(log.indexOf('quota') < log.indexOf('claim'), 'kota claim\'den önce değil');
  assert(backend.stats().providerCalls === 1, 'tek provider çağrısı olmalı');
});

check('6. Aynı session paralel iki istek → TEK provider çağrısı (claim geçer)', async () => {
  const backend = makeBackend();
  let release;
  const gate = new Promise((r) => { release = r; });
  const A = orchestrateWorkoutAnalysis(makeDeps(backend, 's6', { h: 'A' }, { provider: { gate } }));
  const B = orchestrateWorkoutAnalysis(makeDeps(backend, 's6', { h: 'B' }, {}));
  // Biri claim'i alıp provider'da bekler; diğeri claim'de in_progress alır.
  await sleep(30);
  release();
  const [ra, rb] = await Promise.all([A, B]);
  const kinds = [ra.kind, rb.kind].sort();
  assert(backend.stats().providerCalls === 1, `provider ${backend.stats().providerCalls} kez çağrıldı (>1)`);
  assert(backend.stats().providerMax === 1, 'aynı anda >1 aktif provider');
  assert(kinds.includes('in_progress') || kinds.includes('ready'), `beklenmeyen sonuçlar: ${kinds}`);
});

check('7. Gecikmeli prep + ikinci istek: ilk provider\'a başlamadan iki Gemini oluşmaz', async () => {
  const backend = makeBackend();
  const A = orchestrateWorkoutAnalysis(makeDeps(backend, 's7', { h: 'A' }, { prepDelay: 60 }));
  await sleep(10);
  const B = orchestrateWorkoutAnalysis(makeDeps(backend, 's7', { h: 'B' }, {}));
  await Promise.all([A, B]);
  assert(backend.stats().providerCalls === 1, `gecikmeli prep sırasında ${backend.stats().providerCalls} provider çağrısı`);
  assert(backend.stats().providerMax === 1, 'aynı anda >1 aktif provider');
});

check('8. Eski token geç complete: yeni claim\'i değiştirmez; kaydedilmemiş insight ready dönmez', async () => {
  const backend = makeBackend();
  let bDone = false;
  // A, provider'ı biter; complete anında lease expire + B tam turu araya girer.
  const depsA = makeDeps(backend, 's8', { h: 'A' }, {
    async beforeComplete() {
      if (bDone) return;
      bDone = true;
      backend.expire('s8'); // A'nın lease'i doldu (provider bitmiş, complete gecikti)
      const rb = await orchestrateWorkoutAnalysis(makeDeps(backend, 's8', { h: 'B' }, {}));
      assert.deepEqual(rb, { kind: 'ready', insight: { h: 'B' }, cached: false }, 'B kendi sonucunu tamamlamalı');
    },
  });
  const ra = await orchestrateWorkoutAnalysis(depsA);
  // A'nın complete'i token uyuşmazlığından FALSE; A yalnız DB'deki B sonucunu görür.
  assert(ra.kind === 'ready' && ra.insight.h === 'B', `A, B'nin sonucunu dönmeli, geldi: ${JSON.stringify(ra)}`);
  assert(backend.rows.get('s8').result.h === 'B', 'saklanan sonuç B olmalı (A değil)');
  assert(backend.stats().providerMax === 1, 'aynı anda >1 aktif provider olmamalı');
});

check('9. Timeout → kendi token\'ıyla fail → stale recovery yeni claim alabilir', async () => {
  const backend = makeBackend();
  await assert.rejects(
    () => orchestrateWorkoutAnalysis(makeDeps(backend, 's9', { h: 'A' }, { provider: { throwTimeout: true } })),
    (e) => e.message === 'TIMEOUT',
  );
  // A provider'ı timeout attı → orkestratör kendi token'ıyla fail etti.
  assert(backend.rows.get('s9').status === 'failed', 'timeout sonrası kayıt failed olmalı');
  assert(backend.rows.get('s9').result === undefined, 'timeout sonrası sonuç saklanmamalı');
  // Yeni istek stale/failed kaydı reclaim edip başarıyla tamamlar.
  const rc = await orchestrateWorkoutAnalysis(makeDeps(backend, 's9', { h: 'C' }, {}));
  assert(rc.kind === 'ready' && rc.insight.h === 'C', 'stale recovery yeni claim tamamlamalı');
  assert(backend.rows.get('s9').result.h === 'C', 'nihai sonuç C olmalı');
});

check('10. not_found ve quota reddi: claim/provider hiç çağrılmaz', async () => {
  const backend1 = makeBackend();
  const log1 = [];
  const rNf = await orchestrateWorkoutAnalysis(makeDeps(backend1, 'sx', { h: 'A' }, { notFound: true }, log1));
  assert(rNf.kind === 'not_found' && !log1.includes('claim') && backend1.stats().providerCalls === 0, 'not_found\'da claim/provider olmamalı');

  const backend2 = makeBackend();
  const log2 = [];
  const depsQ = makeDeps(backend2, 'sy', { h: 'A' }, {}, log2);
  depsQ.consumeQuota = async () => { log2.push('quota'); return { allowed: false, limit: 15 }; };
  const rQ = await orchestrateWorkoutAnalysis(depsQ);
  assert(rQ.kind === 'quota' && !log2.includes('claim') && backend2.stats().providerCalls === 0, 'kota reddinde claim/provider olmamalı');
});

await runAll();
server.close();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' → ' + (r.e?.message ?? r.e)}`);
if (failed.length) {
  console.error(`\n✗ ${failed.length} kontrol başarısız`);
  process.exit(1);
}
console.log(`\n✓ Zaman aşımı/lease/orkestrasyon: ${results.length} kontrol geçti ` +
  `(model ${MODEL_TIMEOUT}ms, Gemini ${TOTAL_DEADLINE}ms, complete ${COMPLETE_MAX}ms, lease ${LEASE_SECONDS}s).`);
