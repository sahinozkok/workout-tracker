/**
 * Mola sayacı yalnızca başlangıç/bitiş zaman damgalarından hesaplanır.
 * Böylece uygulama arka plana alınsa, ekran kilitlense veya kapatılıp
 * açılsa da süre doğru kalır; kalıcı depoya saniye yazılmaz.
 */
export type RestTimerState = {
  /** Planlanan molanın bittiği an (ms). */
  endsAt: number;
  exerciseName: string;
  /** Planlanmış bildirimin kimliği; yeniden açılışta iptal edebilmek için saklanır. */
  notificationId?: string;
  /** Molanın başladığı an (ms). */
  startedAt: number;
  /**
   * Her mola için benzersiz kimlik. Bildirim planlaması geç tamamlandığında
   * kaydın hâlâ aynı mola olup olmadığı buradan doğrulanır; React component'in
   * mount durumundan bağımsızdır.
   */
  timerId: string;
};

export type RestTimerProgress = {
  /** Planlanan süre dolduysa true; sayaç ileri saymaya devam eder. */
  isOvertime: boolean;
  /** Hedefin ne kadar aşıldığı (saniye). */
  overtimeSeconds: number;
  /** Planlanan mola süresi (saniye). */
  plannedSeconds: number;
  /** Hedefe kalan süre (saniye). */
  remainingSeconds: number;
  /** Gerçek toplam mola = planlanan + fazla süre. */
  totalRestSeconds: number;
};

/** Çakışma ihtimali yok denecek kadar düşük, bağımlılıksız kimlik üreteci. */
export function createRestTimerId(now: number) {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRestTimer(exerciseName: string, restSeconds: number, now: number): RestTimerState {
  const safeSeconds = Math.max(0, Math.round(restSeconds));
  return {
    endsAt: now + safeSeconds * 1000,
    exerciseName,
    startedAt: now,
    timerId: createRestTimerId(now),
  };
}

export function getRestTimerProgress(timer: RestTimerState, now: number): RestTimerProgress {
  const plannedSeconds = Math.max(0, Math.round((timer.endsAt - timer.startedAt) / 1000));
  // Gerçek geçen mola süresi; hedeften bağımsızdır.
  const elapsedSeconds = Math.max(0, Math.floor((now - timer.startedAt) / 1000));
  const overtimeSeconds = Math.max(0, Math.floor((now - timer.endsAt) / 1000));
  const remainingSeconds = Math.min(plannedSeconds, Math.max(0, Math.ceil((timer.endsAt - now) / 1000)));

  return {
    // Tam bitiş anında ve sonraki ilk saniye dolana kadar `00:00` gösterilir;
    // `+00:01` ancak bir tam saniye aşıldığında başlar.
    isOvertime: overtimeSeconds >= 1,
    overtimeSeconds,
    plannedSeconds,
    remainingSeconds,
    totalRestSeconds: elapsedSeconds,
  };
}

/**
 * Depodan okunan kaydı doğrular. Eski sürümde `startedAt` bulunmayan kayıtlar
 * için planlanan süre bilinmediğinden başlangıç, bitiş anına eşitlenir.
 */
export function parseStoredRestTimer(rawValue: string | null, fallbackPlannedSeconds = 0): RestTimerState | undefined {
  if (!rawValue) return undefined;

  try {
    const parsed = JSON.parse(rawValue) as Partial<RestTimerState>;
    if (typeof parsed.endsAt !== 'number' || typeof parsed.exerciseName !== 'string') return undefined;

    const startedAt =
      typeof parsed.startedAt === 'number' ? parsed.startedAt : parsed.endsAt - fallbackPlannedSeconds * 1000;

    return {
      endsAt: parsed.endsAt,
      exerciseName: parsed.exerciseName,
      notificationId: typeof parsed.notificationId === 'string' ? parsed.notificationId : undefined,
      startedAt,
      // Eski sürüm kayıtlarında kimlik yoktur; başlangıç anından türetilir.
      timerId: typeof parsed.timerId === 'string' ? parsed.timerId : `legacy-${startedAt}`,
    };
  } catch {
    return undefined;
  }
}

/**
 * Görünen saat.
 *
 *   * Hedef dolana kadar: kalan süre geri sayar (`03:00` → `00:00`).
 *   * Hedef dolduktan sonra: yalnızca aşan süre değil, TOPLAM geçen mola
 *     gösterilir. 180 sn'lik molada bir saniye sonra `03:01`, sonra `03:02`.
 *     `+00:01` biçimi KULLANILMAZ.
 *
 * `overtimeSeconds` alanı kaldırılmadı: erişilebilirlik ve açıklama metinleri
 * hedefin ne kadar aşıldığını ayrıca kullanabilir.
 */
export function formatRestTimerValue(progress: RestTimerProgress) {
  const seconds = progress.isOvertime ? progress.totalRestSeconds : progress.remainingSeconds;
  const minutePart = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secondPart = String(seconds % 60).padStart(2, '0');
  return `${minutePart}:${secondPart}`;
}
