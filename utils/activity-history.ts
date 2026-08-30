import { WorkoutActivityRecord, WorkoutSetRecord } from '@/types/workout';
import { derivePaceSecondsPerKm } from '@/utils/workout-tracking';

/**
 * GEÇMİŞ EKRANI için saf türetmeler.
 *
 * Ekran hiçbir hesabı satır içinde yapmaz; buradaki fonksiyonlar hem uygulamada
 * hem `scripts/verify-activity-timer-and-history.mjs` içinde AYNEN çalışır.
 *
 * Değerler veritabanındaki birimlerde (metre / saniye) tutulur; kullanıcıya
 * çevirme işi görüntüleme katmanının işidir.
 */

export type SessionActivitySummary = {
  setCount: number;
  activityCount: number;
  /** Benzersiz egzersiz sayısı — strength ve aktivite AYNI egzersizi iki kez saymaz. */
  uniqueExerciseCount: number;
  durationSeconds: number;
};

/** Egzersiz kimliği yoksa ada düşülür; silinmiş programda snapshot adı kalır. */
function exerciseIdentity(name: string, programExerciseId: string | undefined) {
  return programExerciseId ?? `name:${name.trim().toLocaleLowerCase('tr-TR')}`;
}

/**
 * Bir oturumun compact özeti.
 *
 * `uniqueExerciseCount`, strength ve aktivite kimliklerini TEK kümede toplar:
 * aynı egzersiz hem set hem aktivite üretmişse (veri bozukluğu) iki kez
 * sayılmaz.
 */
export function summarizeSessionActivity(input: {
  sets: readonly WorkoutSetRecord[];
  activityRecords: readonly WorkoutActivityRecord[];
  durationSeconds: number;
}): SessionActivitySummary {
  const identities = new Set<string>();
  for (const set of input.sets) {
    identities.add(exerciseIdentity(set.exerciseName, set.programExerciseId));
  }
  for (const record of input.activityRecords) {
    identities.add(exerciseIdentity(record.exerciseName, record.programExerciseId));
  }

  return {
    setCount: input.sets.length,
    activityCount: input.activityRecords.length,
    uniqueExerciseCount: identities.size,
    durationSeconds: input.durationSeconds,
  };
}

/** Bütün tamamlanmış antrenmanlardaki benzersiz egzersiz sayısı. */
export function countUniqueExercises(
  sets: readonly WorkoutSetRecord[],
  activityRecords: readonly WorkoutActivityRecord[],
) {
  const identities = new Set<string>();
  for (const set of sets) identities.add(exerciseIdentity(set.exerciseName, set.programExerciseId));
  for (const record of activityRecords) {
    identities.add(exerciseIdentity(record.exerciseName, record.programExerciseId));
  }
  return identities.size;
}

export type ActivityHistoryEntry = {
  id: string;
  exerciseName: string;
  trackingMode: 'duration' | 'distance';
  durationSeconds: number;
  distanceMeters?: number;
  targetDurationSeconds?: number;
  targetDistanceMeters?: number;
  rpe?: number;
  /** Mesafe ve süreden TÜRETİLİR; veritabanında saklanmaz. */
  paceSecondsPerKm?: number;
  /** Hedefe ulaşıldı mı? Süre türünde süreye, mesafe türünde MESAFEYE bakılır. */
  isTargetReached: boolean;
  completedAt: string;
};

/**
 * Oturumun aktivite kayıtlarını görüntülemeye hazır hâle getirir.
 *
 * Sıralama `completedAt` artan — kullanıcı antrenman içinde ne zaman yaptıysa
 * o sırada görür. Egzersiz adı KAYITTAKİ snapshot'tan gelir; program veya
 * egzersiz silinmiş olsa bile geçmiş okunur kalır.
 */
export function buildActivityHistoryEntries(
  records: readonly WorkoutActivityRecord[],
): ActivityHistoryEntry[] {
  return [...records]
    .sort((first, second) => first.completedAt.localeCompare(second.completedAt))
    .map((record) => ({
      id: record.id,
      exerciseName: record.exerciseName,
      trackingMode: record.trackingMode,
      durationSeconds: record.durationSeconds,
      distanceMeters: record.distanceMeters,
      targetDurationSeconds: record.targetDurationSeconds,
      targetDistanceMeters: record.targetDistanceMeters,
      rpe: record.rpe,
      paceSecondsPerKm: derivePaceSecondsPerKm(record.distanceMeters, record.durationSeconds),
      isTargetReached:
        record.trackingMode === 'duration'
          ? record.targetDurationSeconds !== undefined &&
            record.durationSeconds >= record.targetDurationSeconds
          : record.targetDistanceMeters !== undefined &&
            (record.distanceMeters ?? 0) >= record.targetDistanceMeters,
      completedAt: record.completedAt,
    }));
}

export type ActivityProgressEntry = {
  key: string;
  exerciseName: string;
  trackingMode: 'duration' | 'distance';
  recordCount: number;
  lastCompletedAt: string;
  lastDurationSeconds: number;
  lastDistanceMeters?: number;
  lastPaceSecondsPerKm?: number;
};

/**
 * Gelişim sekmesindeki SADE aktivite bölümü.
 *
 * Bu fazda grafik yoktur: egzersiz başına son kayıt ve toplam kayıt sayısı.
 * Amaç, yalnız kardiyo yapan kullanıcının "veri yok" görmesini engellemektir.
 * Sıralama en yeni kayıttan eskiye.
 */
export function buildActivityProgressEntries(
  records: readonly WorkoutActivityRecord[],
): ActivityProgressEntry[] {
  const byExercise = new Map<string, WorkoutActivityRecord[]>();

  for (const record of records) {
    const key = exerciseIdentity(record.exerciseName, record.programExerciseId);
    const bucket = byExercise.get(key);
    if (bucket) bucket.push(record);
    else byExercise.set(key, [record]);
  }

  return [...byExercise.entries()]
    .map(([key, bucket]) => {
      const sorted = [...bucket].sort((first, second) =>
        first.completedAt.localeCompare(second.completedAt),
      );
      const last = sorted[sorted.length - 1];
      return {
        key,
        exerciseName: last.exerciseName,
        trackingMode: last.trackingMode,
        recordCount: sorted.length,
        lastCompletedAt: last.completedAt,
        lastDurationSeconds: last.durationSeconds,
        lastDistanceMeters: last.distanceMeters,
        lastPaceSecondsPerKm: derivePaceSecondsPerKm(last.distanceMeters, last.durationSeconds),
      };
    })
    .sort((first, second) => second.lastCompletedAt.localeCompare(first.lastCompletedAt));
}
