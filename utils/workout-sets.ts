import { WorkoutSetRecord } from '@/types/workout';

/**
 * Set sayımıyla ilgili SAF kurallar.
 *
 * Bu fonksiyonlar hem uygulamada (`workout-context`, aktif antrenman ekranı)
 * hem de `supabase/tests/active-workout.harness.mjs` içinde AYNEN kullanılır;
 * testler ayrı bir kopya algoritmayı değil gerçek mantığı doğrular.
 *
 * Temel ayrım:
 *   * GERÇEK set sayısı — kaydedilmiş satır sayısı. Hedefin üstüne çıkabilir
 *     (ekstra set: 4/3). Set numarası ve undo bunu kullanır.
 *   * PLANLI ilerleme — hedefe clamp edilmiş sayaç. Disiplin takvimi, otomatik
 *     antrenman bitişi ve ödüller bunu kullanır.
 */

type SessionSetLike = Pick<WorkoutSetRecord, 'sessionId' | 'programExerciseId' | 'setNumber'>;

/** Bir oturum + egzersiz için kaydedilmiş GERÇEK set sayısı. */
export function getActualSetCount(
  sets: SessionSetLike[],
  sessionId: string,
  programExerciseId: string,
) {
  return sets.filter(
    (workoutSet) =>
      workoutSet.sessionId === sessionId && workoutSet.programExerciseId === programExerciseId,
  ).length;
}

/**
 * Oturumdaki en yüksek `set_number`. Yeni set numarası ve undo hedefi bundan
 * türer; clamp edilmiş sayaçtan DEĞİL.
 */
export function getHighestSetNumber(
  sets: SessionSetLike[],
  sessionId: string,
  programExerciseId: string,
) {
  return sets.reduce(
    (highest, workoutSet) =>
      workoutSet.sessionId === sessionId && workoutSet.programExerciseId === programExerciseId
        ? Math.max(highest, workoutSet.setNumber)
        : highest,
    0,
  );
}

/**
 * Bu kayıt PLANLANAN eksik bir seti tamamlıyor mu?
 *
 * Hedefi dolmuş bir egzersize eklenen ekstra set plan ilerlemesine katkı
 * vermez; bu yüzden otomatik antrenman bitişini de tetikleyemez.
 */
export function contributesToPlannedProgress(completedSets: number, targetSets: number) {
  return completedSets < targetSets;
}

/**
 * Bu set kaydı bütün antrenmanı bitiriyor mu?
 *
 * Ekstra set (katkısız) hiçbir koşulda antrenmanı bitirmez: aksi hâlde başka
 * egzersizde hâlâ eksik planlı set varken antrenman yanlışlıkla kapanırdı.
 */
export function completesWholeWorkout({
  completedSets,
  targetSets,
  totalCompletedSets,
  totalTargetSets,
}: {
  completedSets: number;
  targetSets: number;
  totalCompletedSets: number;
  totalTargetSets: number;
}) {
  if (!contributesToPlannedProgress(completedSets, targetSets)) return false;
  return totalTargetSets > 0 && totalCompletedSets + 1 >= totalTargetSets;
}

/**
 * Undo sonrası disiplin sayacı: KALAN gerçek set sayısının hedefe clamp'i.
 *
 * "Mevcut sayaçtan 1 çıkar" YANLIŞTIR: 4/3 durumunda sayaç zaten 3'te sabittir,
 * 4. set silinince gerçek sayı 3 olur ve sayaç 3 KALMALIDIR; çıkarma onu 2'ye
 * düşürüp o günün disiplin ilerlemesini haksız yere geri alırdı.
 */
export function getDisciplineCountAfterUndo(remainingActualSetCount: number, targetSets: number) {
  return Math.min(Math.max(remainingActualSetCount, 0), targetSets);
}

/**
 * Aktif set başlığında gösterilecek sıra numarası.
 *
 * Normal akış hedefe kadar sayar (1/3, 2/3, 3/3); hedef dolduktan sonra girilen
 * ekstra setler gerçek sayıdan devam eder (4/3, 5/3). Disiplin sayacı bundan
 * bağımsız olarak clamp edilmeye devam eder.
 */
export function getActiveSetLabelNumber(actualSetCount: number) {
  return actualSetCount + 1;
}
