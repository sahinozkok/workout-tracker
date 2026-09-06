import { ProgramExercise } from '@/types/workout';
import { formatMetersAsKilometers, splitSecondsIntoFields } from '@/utils/activity-input';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Program Detayı gün listesinde her egzersizin yanında gösterilen AYRINTILI,
 * LOKALİZE hedef metni. Saf ve tracking-mode üzerinde exhaustive.
 *
 * `utils/workout-tracking.ts` içindeki `formatExerciseTargetLabel`in kompakt,
 * dilden bağımsız `3×8-10` / sabit `dk`·`km` biçiminden BİLİNÇLİ olarak
 * ayrıdır: burada birim sözcükleri (`set`·`tekrar`, `dk`·`sn`, `km`) TR/EN
 * çeviri sisteminden gelir, böylece
 *   sets_reps → `4 set × 8–10 tekrar`
 *   duration  → `20 dk` · `1 dk 30 sn` · `45 sn`
 *   distance  → `5 km`
 * gibi okunur.
 *
 * KONUM: bu formatter locale ve sunuma bağlıdır; bu yüzden yalıtılmış derlenen
 * saf ilerleme çekirdeği `workout-tracking.ts`e DEĞİL, kendi küçük modülüne
 * konur. Süre/mesafe biçimlendirmesi mevcut saf yardımcıları
 * (`splitSecondsIntoFields`, `formatMetersAsKilometers`) yeniden kullanır;
 * ikinci bir format mantığı yazılmaz. `targetReps` aralığı (ör. `8-10`) aynen
 * korunur, sahte varsayılan üretilmez ve kardiyo asla sahte `1 set` göstermez.
 */
export function formatProgramExerciseTarget(exercise: ProgramExercise, t: Translate): string {
  if (exercise.trackingMode === 'sets_reps') {
    return t('programDetail.targetSetsReps', {
      reps: exercise.targetReps,
      sets: exercise.targetSets,
    });
  }

  if (exercise.trackingMode === 'duration') {
    const { minutes, seconds } = splitSecondsIntoFields(exercise.targetDurationSeconds);
    const minuteUnit = t('day.minutesUnit');
    const secondUnit = t('day.secondsUnit');
    if (seconds === '0') return `${minutes} ${minuteUnit}`;
    if (minutes === '0') return `${seconds} ${secondUnit}`;
    return `${minutes} ${minuteUnit} ${seconds} ${secondUnit}`;
  }

  return `${formatMetersAsKilometers(exercise.targetDistanceMeters)} ${t('day.kmUnit')}`;
}
