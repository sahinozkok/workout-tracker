import { ProgramExercise, WorkoutActivityRecord } from '@/types/workout';
import { contributesToPlannedProgress } from '@/utils/workout-sets';

/**
 * TÜR-FARKINDA İLERLEME ÇEKİRDEĞİ — istemcideki TEK doğruluk kaynağı.
 *
 * Tamamlama formülü daha önce dört yerde kopyalanmıştı (üç SQL fonksiyonu ve
 * istemcideki takvim hesabı). SQL tarafı `exercise_target_units` /
 * `exercise_done_units` yardımcılarında toplandı; bu modül onun istemci
 * karşılığıdır ve AYNI kararları verir:
 *
 *   hedef birimi     sets_reps → targetSets
 *                    duration / distance → 1
 *
 *   tamamlanan birim sets_reps → min(tamamlanan set, targetSets)
 *                    duration  → gün içi toplam süre >= hedef ? 1 : 0
 *                    distance  → gün içi toplam mesafe >= hedef ? 1 : 0
 *
 *   ilerleme         en az bir set VEYA pozitif bir aktivite değeri
 *
 * `hasProgress` AYRI bir sinyaldir: kardiyoda tamamlanan birim ikilidir
 * (0 veya 1), dolayısıyla hedefin altında biten gerçek bir koşu
 * `doneUnits = 0` üretir ama gün için `partial` sayılmalıdır. Strength'te
 * `hasProgress` ile `doneUnits > 0` matematiksel olarak EŞDEĞERDİR, bu yüzden
 * yalnızca strength içeren programlarda sonuç eski davranışla birebir aynıdır.
 */

/** Gün + egzersiz düzeyinde biriktirilmiş aktivite toplamı. */
export type ActivityTotals = {
  durationSeconds: number;
  distanceMeters: number;
};

export type ExerciseProgress = {
  /** Bu egzersizin güne kattığı hedef birimi. */
  targetUnits: number;
  /** Bu egzersizde gerçekten tamamlanan birim. */
  doneUnits: number;
  /** Hedefe ulaşılmasa bile gerçek bir ilerleme var mı? */
  hasProgress: boolean;
};

export type DayProgress = ExerciseProgress;

const EMPTY_TOTALS: ActivityTotals = { durationSeconds: 0, distanceMeters: 0 };

/** Aktivite toplamlarının `gün + egzersiz` anahtarı. */
export function getActivityProgressKey(dateKey: string, programExerciseId: string) {
  return `${dateKey}:${programExerciseId}`;
}

/**
 * Aktivite kayıtlarını gün + egzersiz düzeyinde TOPLAR.
 *
 * Aynı egzersiz aynı günde birden fazla oturumda görünebilir (ör. sabah/akşam);
 * bu yüzden toplama oturum düzeyinde DEĞİL gün düzeyinde yapılır. Plandan
 * kopmuş (`programExerciseId` yok) kayıtlar hiçbir hedefe katkı veremez ve
 * atlanır.
 */
export function aggregateActivityTotals(
  records: readonly WorkoutActivityRecord[],
): Record<string, ActivityTotals> {
  return records.reduce<Record<string, ActivityTotals>>((totals, record) => {
    if (!record.programExerciseId) return totals;

    const key = getActivityProgressKey(record.dateKey, record.programExerciseId);
    const current = totals[key] ?? EMPTY_TOTALS;
    totals[key] = {
      durationSeconds: current.durationSeconds + record.durationSeconds,
      distanceMeters: current.distanceMeters + (record.distanceMeters ?? 0),
    };
    return totals;
  }, {});
}

/** Egzersizin güne kattığı hedef birimi. Saf fonksiyon. */
export function exerciseTargetUnits(exercise: ProgramExercise): number {
  return exercise.trackingMode === 'sets_reps' ? exercise.targetSets : 1;
}

/**
 * Tek egzersizin ilerlemesi. Saf fonksiyon.
 *
 * `duration` türünde mesafe İSTEĞE BAĞLI olarak ölçülebilir ama tamamlanma
 * ölçütü DEĞİLDİR. `distance` türünde süre kayıtta zorunludur ama tamamlanma
 * ölçütü mesafedir. Hedefin üstüne çıkmak yalnızca BİR tamamlanmış birim verir;
 * fazlası disipline veya ödüle yansımaz.
 */
export function resolveExerciseProgress(
  exercise: ProgramExercise,
  completedSets: number,
  activityTotals: ActivityTotals | undefined,
): ExerciseProgress {
  const totals = activityTotals ?? EMPTY_TOTALS;
  const targetUnits = exerciseTargetUnits(exercise);

  if (exercise.trackingMode === 'sets_reps') {
    const safeSets = Math.max(0, completedSets);
    return {
      targetUnits,
      doneUnits: Math.min(safeSets, exercise.targetSets),
      hasProgress: safeSets > 0,
    };
  }

  if (exercise.trackingMode === 'duration') {
    const reached = totals.durationSeconds >= exercise.targetDurationSeconds;
    return {
      targetUnits,
      doneUnits: reached ? 1 : 0,
      // Süre modunda mesafe de gerçek bir ilerleme kanıtıdır, ama TAMAMLAMA
      // ölçütü değildir.
      hasProgress: totals.durationSeconds > 0 || totals.distanceMeters > 0,
    };
  }

  const reached = totals.distanceMeters >= exercise.targetDistanceMeters;
  return {
    targetUnits,
    doneUnits: reached ? 1 : 0,
    hasProgress: totals.durationSeconds > 0 || totals.distanceMeters > 0,
  };
}

/** Bir günün bütün egzersizlerinin toplamı. Saf fonksiyon. */
export function summarizeDayProgress(entries: readonly ExerciseProgress[]): DayProgress {
  return entries.reduce<DayProgress>(
    (total, entry) => ({
      targetUnits: total.targetUnits + entry.targetUnits,
      doneUnits: total.doneUnits + entry.doneUnits,
      hasProgress: total.hasProgress || entry.hasProgress,
    }),
    { targetUnits: 0, doneUnits: 0, hasProgress: false },
  );
}

/**
 * Bir günün ilerlemesini plan ve kanıtlardan TEK adımda çözer.
 *
 * Takvim, ana sayfa özeti ve disiplin hesabı bu fonksiyonu kullanır; ikinci bir
 * bağımsız algoritma bırakılmaz.
 */
export function resolveDayProgress(input: {
  dateKey: string;
  exercises: readonly ProgramExercise[];
  completedSetCounts: Record<string, number>;
  activityTotals: Record<string, ActivityTotals>;
  getSetProgressKey: (dateKey: string, programExerciseId: string) => string;
}): DayProgress {
  const { dateKey, exercises, completedSetCounts, activityTotals, getSetProgressKey } = input;

  return summarizeDayProgress(
    exercises.map((exercise) =>
      resolveExerciseProgress(
        exercise,
        completedSetCounts[getSetProgressKey(dateKey, exercise.id)] ?? 0,
        activityTotals[getActivityProgressKey(dateKey, exercise.id)],
      ),
    ),
  );
}

/**
 * Kaydedilen bir setin ARDINDAN oluşacak gün durumu.
 *
 * `contributes`, kaydın PLANLI ilerlemeye katkı verip vermediğidir: hedefi
 * dolmuş bir egzersize eklenen EKSTRA set katkı vermez ve hiçbir koşulda
 * otomatik bitiş tetikleyemez.
 */
export type ProjectedSetOutcome = {
  contributes: boolean;
  progress: DayProgress;
};

/**
 * Set kalıcı olarak kaydedildikten SONRAKİ gün ilerlemesini öngörür.
 *
 * Öngörülen sayaç yalnız İLGİLİ tarih + egzersiz anahtarına yazılır; girdi
 * haritası değiştirilmez ve başka hiçbir gün ya da egzersiz etkilenmez.
 * Katkı kuralı `utils/workout-sets.ts` içindeki `contributesToPlannedProgress`
 * ile PAYLAŞILIR — ikinci bir katkı tanımı yoktur.
 */
export function resolveProjectedSetProgress(input: {
  dateKey: string;
  exercises: readonly ProgramExercise[];
  completedSetCounts: Record<string, number>;
  activityTotals: Record<string, ActivityTotals>;
  getSetProgressKey: (dateKey: string, programExerciseId: string) => string;
  completedExerciseId: string;
}): ProjectedSetOutcome {
  const {
    dateKey,
    exercises,
    completedSetCounts,
    activityTotals,
    getSetProgressKey,
    completedExerciseId,
  } = input;

  const completed = exercises.find((exercise) => exercise.id === completedExerciseId);
  const progressKey = getSetProgressKey(dateKey, completedExerciseId);

  /**
   * Öngörü YALNIZCA gerçekten set üretebilen bir egzersiz için yapılır.
   * Egzersiz o günde bulunamazsa veya kardiyo türündeyse hiçbir sayaç
   * artırılmaz; böylece bir strength olayı kardiyo gününü bitiremez.
   */
  const clampedCount =
    completed !== undefined && completed.trackingMode === 'sets_reps'
      ? Math.min(Math.max(completedSetCounts[progressKey] ?? 0, 0), completed.targetSets)
      : 0;
  const contributes =
    completed !== undefined &&
    completed.trackingMode === 'sets_reps' &&
    contributesToPlannedProgress(clampedCount, completed.targetSets);

  const projectedCounts = contributes
    ? { ...completedSetCounts, [progressKey]: clampedCount + 1 }
    : completedSetCounts;

  return {
    contributes,
    progress: resolveDayProgress({
      dateKey,
      exercises,
      completedSetCounts: projectedCounts,
      activityTotals,
      getSetProgressKey,
    }),
  };
}

/**
 * Bu set kaydı BÜTÜN günü bitiriyor mu? TÜR-FARKINDA karar.
 *
 * `utils/workout-sets.ts` içindeki `completesWholeWorkout` yalnız set toplamına
 * bakıyordu; karma bir günde strength hedefleri dolduğunda kardiyo hedefi
 * eksik olsa bile oturumu kapatırdı. Buradaki karar günün BÜTÜN egzersizlerini
 * ortak `resolveDayProgress` çekirdeğinden geçirir ve yalnız
 * `doneUnits >= targetUnits` olduğunda biter.
 *
 * Strength-only günde sonuç eski davranışla MATEMATİKSEL OLARAK AYNIDIR:
 * `targetUnits` set hedeflerinin toplamı, katkı veren bir kayıtta `doneUnits`
 * ise clamp edilmiş toplam + 1'dir.
 */
export function completesWorkoutAfterSet(input: {
  dateKey: string;
  exercises: readonly ProgramExercise[];
  completedSetCounts: Record<string, number>;
  activityTotals: Record<string, ActivityTotals>;
  getSetProgressKey: (dateKey: string, programExerciseId: string) => string;
  completedExerciseId: string;
}): boolean {
  const { contributes, progress } = resolveProjectedSetProgress(input);
  if (!contributes) return false;
  return progress.targetUnits > 0 && progress.doneUnits >= progress.targetUnits;
}

/**
 * Bir aktivite kaydının gün toplamına KATKISI.
 *
 * Plandan kopmuş (`programExerciseId` yok) kayıt hiçbir hedefe katkı veremez;
 * `aggregateActivityTotals` ile AYNI kural.
 */
export type ActivityContribution = {
  dateKey: string;
  programExerciseId?: string;
  durationSeconds: number;
  distanceMeters?: number;
};

/**
 * Tek kaydın değişimini toplamlara UYGULAR — yeniden yükleme gerekmeden.
 *
 * INSERT'te `previous` yoktur, DELETE'te `next` yoktur, UPDATE'te ikisi de
 * vardır. UPDATE'te eski katkı ÇIKARILIR ve yeni katkı EKLENİR; iki kaydı
 * birlikte saymak (yalnızca yeniyi eklemek) aynı egzersizi iki kez kaydetmiş
 * gibi gösterip günü haksız yere tamamlardı.
 *
 * Aynı günün BAŞKA oturumlarından gelen katkılar aynı anahtarda toplandığı için
 * doğal olarak korunur: delta yalnızca farkı işler, anahtarı sıfırlamaz.
 * Negatife düşme matematiksel olarak mümkün olmasa da `Math.max` ile kapatılır;
 * bozuk bir sunucu cevabı toplamları negatife çeviremez.
 */
export function applyActivityTotalsDelta(
  totals: Record<string, ActivityTotals>,
  previous: ActivityContribution | undefined,
  next: ActivityContribution | undefined,
): Record<string, ActivityTotals> {
  const updated: Record<string, ActivityTotals> = { ...totals };

  const shift = (contribution: ActivityContribution | undefined, sign: 1 | -1) => {
    if (!contribution?.programExerciseId) return;
    const key = getActivityProgressKey(contribution.dateKey, contribution.programExerciseId);
    const current = updated[key] ?? EMPTY_TOTALS;
    updated[key] = {
      durationSeconds: Math.max(0, current.durationSeconds + sign * contribution.durationSeconds),
      distanceMeters: Math.max(0, current.distanceMeters + sign * (contribution.distanceMeters ?? 0)),
    };
  };

  shift(previous, -1);
  shift(next, 1);
  return updated;
}

/**
 * Bir aktivite kaydedildikten SONRA bütün gün tamamlandı mı?
 *
 * `completesWorkoutAfterSet` ile aynı çekirdeği kullanır; tek fark, kanıtın set
 * sayacından değil ÖNGÖRÜLEN aktivite toplamlarından gelmesidir. Çağıran taraf
 * güncellenmiş toplamı `applyActivityTotalsDelta` ile hesaplayıp buraya verir;
 * böylece karar henüz yazılmamış React state'ine (stale closure) değil, gerçek
 * kayıt sonucuna dayanır.
 *
 * Karışık günde yalnız strength ya da yalnız aktivite tamamlanması YETMEZ;
 * yalnız kardiyo gününde hedef dolduğunda oturum bitebilir.
 */
export function completesWorkoutAfterActivity(input: {
  dateKey: string;
  exercises: readonly ProgramExercise[];
  completedSetCounts: Record<string, number>;
  activityTotals: Record<string, ActivityTotals>;
  getSetProgressKey: (dateKey: string, programExerciseId: string) => string;
}): boolean {
  const progress = resolveDayProgress(input);
  return progress.targetUnits > 0 && progress.doneUnits >= progress.targetUnits;
}

/**
 * Tempo — mesafe ve süreden TÜRETİLİR, hiçbir yerde saklanmaz.
 *
 * Bu fazda hiçbir yüzey göstermez; ileride history/progress için hazır durur.
 * Geçersiz girdide `undefined` döner, sahte değer üretmez.
 */
export function derivePaceSecondsPerKm(
  distanceMeters: number | undefined,
  durationSeconds: number,
): number | undefined {
  if (!distanceMeters || distanceMeters <= 0) return undefined;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined;
  return durationSeconds / (distanceMeters / 1000);
}

/**
 * Program listelerinde gösterilen kısa hedef etiketi. Saf fonksiyon.
 *
 * Strength'te mevcut `3×8-10` biçimi AYNEN korunur; kardiyo türleri kendi
 * birimlerini gösterir. Bu bir "kardiyo arayüzü" değildir — yalnızca veritabanı
 * bir kardiyo satırı döndürdüğünde listenin boş veya yanlış görünmemesini
 * sağlar.
 */
export function formatExerciseTargetLabel(exercise: ProgramExercise): string {
  if (exercise.trackingMode === 'sets_reps') {
    return `${exercise.targetSets}×${exercise.targetReps}`;
  }
  if (exercise.trackingMode === 'duration') {
    const minutes = Math.round(exercise.targetDurationSeconds / 60);
    return `${minutes} dk`;
  }
  return `${(exercise.targetDistanceMeters / 1000).toFixed(1)} km`;
}
