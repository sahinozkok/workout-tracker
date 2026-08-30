/**
 * KARDİYO KRONOMETRESİ — saf çekirdek.
 *
 * Mola sayacıyla aynı ilkeyi izler: geçen süre `setInterval` sayısından DEĞİL,
 * gerçek saat damgalarından hesaplanır. Uygulama arka plana geçse, ekran
 * kilitlense veya süreç öldürülüp yeniden açılsa da ölçüm doğru kalır —
 * `setInterval` yalnızca ekranı tazelemek içindir, kaynak değildir.
 *
 * Duraklatma modeli: duraklatıldığında o ana kadarki süre `accumulatedSeconds`
 * içine DONDURULUR ve `startedAt` kaldırılır. Devam edildiğinde `startedAt`
 * yeniden yazılır; böylece duraklamada geçen zaman ölçüme EKLENMEZ.
 */

export type ActivityTimerStatus = 'running' | 'paused';

export type ActivityTimerState = {
  timerId: string;
  sessionId: string;
  programExerciseId: string;
  exerciseName: string;
  trackingMode: 'duration' | 'distance';
  targetDurationSeconds?: number;
  /** Duraklatmalara kadar birikmiş süre (saniye). */
  accumulatedSeconds: number;
  /** Yalnızca `running` durumunda dolu; şu anki koşunun başlangıcı (ms). */
  startedAt?: number;
  status: ActivityTimerStatus;
  notificationId?: string;
};

export type ActivityTimerProgress = {
  /** Ölçülen toplam süre (saniye). Veritabanına yazılacak değer budur. */
  elapsedSeconds: number;
  /** Hedefe kalan süre; hedef yoksa veya dolduysa 0. */
  remainingSeconds: number;
  /** Hedefin ne kadar aşıldığı; hedef yoksa 0. */
  overtimeSeconds: number;
  /** Hedef gerçekten dolduysa true. Hedefi olmayan türde daima false. */
  isTargetReached: boolean;
  status: ActivityTimerStatus;
};

/** `workout_activity_records.duration_seconds between 1 and 86400` üst sınırı. */
export const ACTIVITY_TIMER_MAX_SECONDS = 86400;

/** Çakışma ihtimali yok denecek kadar düşük, bağımlılıksız kimlik üreteci. */
export function createActivityTimerId(now: number) {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createActivityTimer(input: {
  sessionId: string;
  programExerciseId: string;
  exerciseName: string;
  trackingMode: 'duration' | 'distance';
  targetDurationSeconds?: number;
  now: number;
}): ActivityTimerState {
  return {
    timerId: createActivityTimerId(input.now),
    sessionId: input.sessionId,
    programExerciseId: input.programExerciseId,
    exerciseName: input.exerciseName,
    trackingMode: input.trackingMode,
    targetDurationSeconds: input.targetDurationSeconds,
    accumulatedSeconds: 0,
    startedAt: input.now,
    status: 'running',
  };
}

/**
 * Ölçülen süre. `running` durumunda birikmiş süreye şu anki koşu eklenir.
 *
 * Sonuç 24 saatte KIRPILIR: veritabanı kolonu bunun üstünü kabul etmez ve
 * kullanıcıyı kaydetme anında anlaşılmaz bir Postgres hatasına düşürmek yerine
 * ölçüm sınırda durdurulur.
 */
export function getActivityTimerElapsedSeconds(timer: ActivityTimerState, now: number): number {
  const running =
    timer.status === 'running' && typeof timer.startedAt === 'number'
      ? Math.floor((now - timer.startedAt) / 1000)
      : 0;
  const total = timer.accumulatedSeconds + Math.max(0, running);
  return Math.min(Math.max(0, total), ACTIVITY_TIMER_MAX_SECONDS);
}

export function getActivityTimerProgress(
  timer: ActivityTimerState,
  now: number,
): ActivityTimerProgress {
  const elapsedSeconds = getActivityTimerElapsedSeconds(timer, now);
  const target = timer.targetDurationSeconds;

  if (target === undefined || target <= 0) {
    // Mesafe hedefli egzersizde süre hedefi YOKTUR; kronometre serbest sayar.
    return { elapsedSeconds, remainingSeconds: 0, overtimeSeconds: 0, isTargetReached: false, status: timer.status };
  }

  return {
    elapsedSeconds,
    remainingSeconds: Math.max(0, target - elapsedSeconds),
    overtimeSeconds: Math.max(0, elapsedSeconds - target),
    isTargetReached: elapsedSeconds >= target,
    status: timer.status,
  };
}

/** Duraklat — geçen süre dondurulur, `startedAt` kaldırılır. */
export function pauseActivityTimer(timer: ActivityTimerState, now: number): ActivityTimerState {
  if (timer.status === 'paused') return timer;
  return {
    ...timer,
    accumulatedSeconds: getActivityTimerElapsedSeconds(timer, now),
    startedAt: undefined,
    status: 'paused',
    // Planlanmış bildirim duraklatmada iptal edilir; kimlik de bırakılır.
    notificationId: undefined,
  };
}

/** Devam et — yeni koşu başlar, duraklamada geçen zaman EKLENMEZ. */
export function resumeActivityTimer(timer: ActivityTimerState, now: number): ActivityTimerState {
  if (timer.status === 'running') return timer;
  return { ...timer, startedAt: now, status: 'running' };
}

/**
 * Hedef süre bildirimi için kalan saniye.
 *
 * Hedef yoksa (mesafe türü) veya hedef zaten dolduysa `undefined` döner ve
 * çağıran taraf bildirim PLANLAMAZ.
 */
export function getActivityNotificationDelaySeconds(
  timer: ActivityTimerState,
  now: number,
): number | undefined {
  if (timer.trackingMode !== 'duration') return undefined;
  const progress = getActivityTimerProgress(timer, now);
  if (progress.isTargetReached) return undefined;
  return progress.remainingSeconds > 0 ? progress.remainingSeconds : undefined;
}

/** `sessionId + programExerciseId` — aynı anda tek kronometre bu ayrımla korunur. */
export const ACTIVITY_TIMER_KEY_PREFIX = 'workout-activity-timer';

export function getActivityTimerStorageKey(sessionId: string, programExerciseId: string) {
  return `${ACTIVITY_TIMER_KEY_PREFIX}:${sessionId}:${programExerciseId}`;
}

/**
 * Depodan okunan kaydı DOĞRULAR.
 *
 * Bozuk veya eksik alanlı kayıt sessizce varsayılana çevrilmez: `undefined`
 * döner ve çağıran taraf kronometreyi hiç geri yüklemez. `running` durumunda
 * `startedAt` zorunludur — aksi hâlde süre hesaplanamaz.
 */
export function parseStoredActivityTimer(rawValue: string | null): ActivityTimerState | undefined {
  if (!rawValue) return undefined;

  try {
    const parsed = JSON.parse(rawValue) as Partial<ActivityTimerState>;

    if (
      typeof parsed.timerId !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.programExerciseId !== 'string' ||
      typeof parsed.exerciseName !== 'string' ||
      (parsed.trackingMode !== 'duration' && parsed.trackingMode !== 'distance') ||
      typeof parsed.accumulatedSeconds !== 'number' ||
      !Number.isFinite(parsed.accumulatedSeconds) ||
      parsed.accumulatedSeconds < 0 ||
      (parsed.status !== 'running' && parsed.status !== 'paused')
    ) {
      return undefined;
    }

    if (parsed.status === 'running' && typeof parsed.startedAt !== 'number') return undefined;

    const target =
      typeof parsed.targetDurationSeconds === 'number' &&
      Number.isFinite(parsed.targetDurationSeconds) &&
      parsed.targetDurationSeconds > 0
        ? parsed.targetDurationSeconds
        : undefined;

    return {
      timerId: parsed.timerId,
      sessionId: parsed.sessionId,
      programExerciseId: parsed.programExerciseId,
      exerciseName: parsed.exerciseName,
      trackingMode: parsed.trackingMode,
      targetDurationSeconds: target,
      accumulatedSeconds: parsed.accumulatedSeconds,
      startedAt: parsed.status === 'running' ? parsed.startedAt : undefined,
      status: parsed.status,
      notificationId: typeof parsed.notificationId === 'string' ? parsed.notificationId : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Kronometre gösterimi — `MM:SS`, bir saati aşınca `H:MM:SS`. */
export function formatActivityTimerValue(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const minutePart = String(minutes).padStart(2, '0');
  const secondPart = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutePart}:${secondPart}` : `${minutePart}:${secondPart}`;
}

/** Fazla süre gösterimi — `+00:32`. */
export function formatActivityOvertime(overtimeSeconds: number) {
  return `+${formatActivityTimerValue(overtimeSeconds)}`;
}
