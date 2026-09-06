/**
 * KOÇ ANALİZİ ORKESTRASYONU — SAF, BAĞIMLILIK-ENJEKTELİ akış.
 *
 * `handleWorkoutAnalysis` bu fonksiyonu gerçek bağımlılıklarla (Supabase/Gemini)
 * çağırır; testler AYNI fonksiyonu sahte bağımlılıklarla çalıştırır. Böylece
 * claim→prepare→provider→complete SIRASI ve lease/eşzamanlılık sözleşmesi gerçek
 * orkestrasyon üzerinden doğrulanır (yalnız `callGeminiWithFallback` değil).
 *
 * SÖZLEŞME (kritik):
 *   1. Bütün UNBOUNDED hazırlık (session doğrulama, prompt/prepare, kota) CLAIM'DEN
 *      ÖNCE yapılır → lease penceresine girmez.
 *   2. Atomik claim, provider (Gemini) çağrısından HEMEN önce alınır.
 *   3. Claim'den sonra YALNIZ süre-sınırlı işlemler: provider + complete.
 *   4. complete=false ise KAYDEDİLMEMİŞ yerel insight ASLA ready dönmez; DB'nin
 *      güncel durumuna bakılır (completed→cache, generating→in_progress, aksi→hata).
 *   5. Hata olursa yalnız kendi token'ıyla fail edilir (araya giren yeni claim'i
 *      etkilemez).
 */

export type ClaimOutcome = 'claimed' | 'completed' | 'in_progress';

export interface ClaimResult {
  outcome: ClaimOutcome;
  result?: unknown;
  token?: string;
}

export interface LatestRow {
  status: 'generating' | 'completed' | 'failed';
  result?: unknown;
}

export interface AnalysisDeps<TInsight> {
  /** (1) Session sahiplik/tamamlanma doğrulaması. */
  validateSession(): Promise<{ ok: boolean }>;
  /** (2) CLAIM'DEN ÖNCE hazırlık (dil + setler → prompt). Unbounded olabilir. */
  prepare(): Promise<string>;
  /** (3) CLAIM'DEN ÖNCE kota (session-key idempotent). */
  consumeQuota(): Promise<{ allowed: boolean; limit: number }>;
  /** (4) Atomik claim (provider'dan hemen önce). */
  claim(): Promise<ClaimResult>;
  /** (5a) Provider — SÜRE SINIRLI. Geçersiz/boş yanıt fırlatır. */
  runProvider(prompt: string): Promise<TInsight>;
  /** (5b) complete — SÜRE SINIRLI; token+generating eşleşmesi zorunlu. */
  complete(token: string, insight: TInsight): Promise<boolean>;
  /** complete=false sonrası DB'nin güncel durumu. */
  readLatest(): Promise<LatestRow | null>;
  /** Hata/timeout sonrası kendi token'ıyla serbest bırak. */
  fail(token: string): Promise<void>;
  /** DB'den okunan sonucun geçerli insight olup olmadığını doğrular. */
  isValidInsight(value: unknown): value is TInsight;
}

export type OrchestrationResult<TInsight> =
  | { kind: 'ready'; insight: TInsight; cached: boolean }
  | { kind: 'in_progress' }
  | { kind: 'not_found' }
  | { kind: 'quota'; limit: number }
  | { kind: 'error' };

export async function orchestrateWorkoutAnalysis<TInsight>(
  deps: AnalysisDeps<TInsight>,
): Promise<OrchestrationResult<TInsight>> {
  // (1) Session doğrulama.
  const { ok } = await deps.validateSession();
  if (!ok) return { kind: 'not_found' };

  // (2) HAZIRLIK — CLAIM'DEN ÖNCE (unbounded; lease penceresi dışında).
  const prompt = await deps.prepare();

  // (3) KOTA — CLAIM'DEN ÖNCE (idempotent). Reddedilirse claim bile alınmaz.
  const quota = await deps.consumeQuota();
  if (!quota.allowed) return { kind: 'quota', limit: quota.limit };

  // (4) ATOMİK CLAIM — provider'dan HEMEN önce.
  const claimed = await deps.claim();
  if (claimed.outcome === 'completed' && claimed.result !== undefined && deps.isValidInsight(claimed.result)) {
    return { kind: 'ready', insight: claimed.result, cached: true };
  }
  if (claimed.outcome === 'in_progress') return { kind: 'in_progress' };
  if (claimed.outcome !== 'claimed' || !claimed.token) return { kind: 'error' };
  const token = claimed.token;

  // (5) KRİTİK BÖLGE — yalnız süre-sınırlı işlemler. Hata → kendi token'ıyla fail.
  try {
    const insight = await deps.runProvider(prompt);
    const done = await deps.complete(token, insight);
    if (done) return { kind: 'ready', insight, cached: false };

    // complete=false: lease devralınmış. KAYDEDİLMEMİŞ yerel insight ASLA ready dönmez.
    const latest = await deps.readLatest();
    if (latest?.status === 'completed' && latest.result !== undefined && deps.isValidInsight(latest.result)) {
      return { kind: 'ready', insight: latest.result, cached: true };
    }
    if (latest?.status === 'generating') return { kind: 'in_progress' };
    return { kind: 'error' };
  } catch (error) {
    await deps.fail(token);
    throw error;
  }
}
