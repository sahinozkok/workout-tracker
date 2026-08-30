import { WorkoutSession } from '@/types/workout';
import { getWorkoutDurationSeconds } from '@/utils/workout-session';

/**
 * BUGÜNKÜ ANTRENMAN SÜRE TAHMİNİ — saf çekirdek.
 *
 * Tahmin YALNIZCA aynı `programId + dayId` için GEÇMİŞTE tamamlanmış oturumların
 * gerçek sürelerinden türetilir. Veritabanına hiçbir tahmin yazılmaz; her şey
 * mevcut `workoutSessions` verisinden hesaplanır.
 *
 * Zaman `now` ile enjekte edilir; hiçbir hesap sistem saatine bağlı değildir.
 * `getWorkoutDurationSeconds` TEK süre kaynağıdır (kopya bir formül yazılmaz).
 */

/** En son en fazla bu kadar geçerli tamamlanmış oturum ortalamaya girer. */
export const MAX_HISTORY_SAMPLES = 5;

export type WorkoutEstimateStatus = 'not_started' | 'running' | 'paused';

export type HistoricalAverage = {
  /** Geçmiş ortalama, saniye (tam sayıya yuvarlı). */
  averageSeconds: number;
  /** Ortalamaya giren geçerli örnek sayısı (1–5). */
  sampleCount: number;
};

export type WorkoutEstimate = HistoricalAverage & {
  status: WorkoutEstimateStatus;
  /** Bugünkü oturumda geçen gerçek süre (saniye). Başlamadıysa 0. */
  elapsedSeconds: number;
  /** Tahmini kalan süre (saniye). `exceeded` ise 0; asla negatif olmaz. */
  remainingSeconds: number;
  /** Geçen süre geçmiş ortalamayı aştı mı? */
  exceeded: boolean;
  /**
   * Tahmini bitiş anı (epoch ms). YALNIZCA kesin bir saat verilebildiğinde
   * doludur: `not_started` ve aşılmamış `running`. `paused` ve `exceeded`
   * durumunda `undefined` — kullanıcı ne zaman devam edeceği bilinmediği için
   * kesin bir bitiş saati uydurulmaz.
   */
  finishAt?: number;
};

function isValidDuration(value: number) {
  return Number.isFinite(value) && value > 0;
}

/**
 * Aynı program/gün için GEÇMİŞ ortalamayı çözer.
 *
 * Kurallar (ayırt edici):
 *   - Yalnızca `status === 'completed'` oturumlar.
 *   - Bugünkü aktif oturum (`excludeSessionId`) örneğe DAHİL EDİLMEZ.
 *   - Süresi 0/geçersiz oturumlar elenir.
 *   - En son (completedAt, yoksa startedAt) en fazla 5 örnek alınır.
 *   - Aritmetik ortalama, saniye. Örnek yoksa `undefined`.
 */
export function resolveHistoricalAverage(
  sessions: readonly WorkoutSession[],
  programId: string,
  dayId: string,
  excludeSessionId?: string,
): HistoricalAverage | undefined {
  const samples = sessions
    .filter(
      (session) =>
        session.programId === programId &&
        session.dayId === dayId &&
        session.status === 'completed' &&
        session.id !== excludeSessionId,
    )
    .map((session) => ({ session, duration: getWorkoutDurationSeconds(session) }))
    .filter((entry) => isValidDuration(entry.duration))
    .sort(
      (first, second) =>
        new Date(second.session.completedAt ?? second.session.startedAt).getTime() -
        new Date(first.session.completedAt ?? first.session.startedAt).getTime(),
    )
    .slice(0, MAX_HISTORY_SAMPLES);

  if (samples.length === 0) return undefined;

  const total = samples.reduce((sum, entry) => sum + entry.duration, 0);
  return { averageSeconds: Math.round(total / samples.length), sampleCount: samples.length };
}

/**
 * Bugünkü antrenman için gösterilecek tahmini üretir. Geçmiş örnek yoksa veya
 * bugünkü oturum tamamlandıysa `undefined` döner (tahmin satırı hiç gösterilmez).
 */
export function buildWorkoutEstimate(input: {
  sessions: readonly WorkoutSession[];
  programId: string;
  dayId: string;
  /** Bugünkü oturum (varsa). `undefined` ise henüz başlamamış demektir. */
  currentSession?: WorkoutSession;
  now: number;
}): WorkoutEstimate | undefined {
  const { sessions, programId, dayId, currentSession, now } = input;

  // Bugünkü antrenman tamamlandıysa tahmin gösterilmez.
  if (currentSession?.status === 'completed') return undefined;

  const average = resolveHistoricalAverage(sessions, programId, dayId, currentSession?.id);
  if (!average) return undefined;

  const status: WorkoutEstimateStatus =
    currentSession?.status === 'running'
      ? 'running'
      : currentSession?.status === 'paused'
        ? 'paused'
        : 'not_started';

  // Başlamadıysa geçen süre 0'dır; aksi hâlde TEK süre kaynağından okunur.
  const elapsedSeconds = currentSession ? getWorkoutDurationSeconds(currentSession, now) : 0;
  const exceeded = elapsedSeconds >= average.averageSeconds;
  const remainingSeconds = exceeded ? 0 : average.averageSeconds - elapsedSeconds;

  let finishAt: number | undefined;
  if (!exceeded) {
    if (status === 'not_started') finishAt = now + average.averageSeconds * 1000;
    else if (status === 'running') finishAt = now + remainingSeconds * 1000;
    // `paused`: kesin bitiş saati yok.
  }

  return {
    averageSeconds: average.averageSeconds,
    sampleCount: average.sampleCount,
    status,
    elapsedSeconds,
    remainingSeconds,
    exceeded,
    finishAt,
  };
}
