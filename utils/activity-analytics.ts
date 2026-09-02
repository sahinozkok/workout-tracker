/**
 * KARDİYO GELİŞİM ANALİTİĞİ — saf, test edilebilir çekirdek.
 *
 * React, çeviri veya tema bağımlılığı YOKTUR. Bütün değerler veritabanı
 * birimlerinde (metre / saniye) döner; kullanıcıya çevirme ve biçimlendirme
 * işi görüntüleme katmanının işidir.
 *
 * Kurallar:
 *  - Egzersiz gruplaması önce `programExerciseId`, yoksa normalize edilmiş
 *    snapshot egzersiz adı. Program/egzersiz silinmiş olsa bile snapshot adıyla
 *    seri okunabilir.
 *  - Farklı `trackingMode` kayıtları AYNI seride karışmaz (anahtar türü de
 *    içerir; aynı `programExerciseId` zaten tek türe kilitlidir).
 *  - Girdi, YALNIZCA tamamlanmış/görünür oturumların kayıtları olmalıdır; bu
 *    filtre çağırana aittir (History ekranı bunu zaten yapar), tıpkı
 *    `buildActivityProgressEntries` gibi.
 *  - Süre/mesafede yüksek değer daha iyi performanstır; tempoda düşük
 *    `saniye/km` daha iyidir.
 *  - Tempo yalnızca `distanceMeters > 0` VE `durationSeconds > 0` iken hesaplanır
 *    (`derivePaceSecondsPerKm`); NaN, Infinity, sıfır ve geçersiz değerler hiçbir
 *    ortalamaya, en iyiye veya çubuğa girmez.
 *  - Ortalamalar güvenli ve deterministik biçimde yuvarlanır; veri yoksa sahte
 *    0 veya uydurma "best" üretilmez.
 */
import { WorkoutActivityRecord } from '@/types/workout';
import { derivePaceSecondsPerKm } from '@/utils/workout-tracking';

/** Grafik/sekme metriği. Süre her kardiyo kaydında bulunur; diğerleri koşullu. */
export type ActivityMetricKey = 'duration' | 'distance' | 'pace';

/** Grafiğe ve son kayıt listesine hazır tek kayıt. Tempo TÜRETİLMİŞTİR. */
export type ActivityAnalyticsRecord = {
  id: string;
  completedAt: string;
  durationSeconds: number;
  distanceMeters?: number;
  /** `distance>0 && duration>0` iken saniye/km; aksi hâlde tanımsız. */
  paceSecondsPerKm?: number;
  rpe?: number;
};

/**
 * Tek metriğin ortalaması ve en iyisi.
 *
 * `best`, süre/mesafede EN YÜKSEK, tempoda EN DÜŞÜK değerdir (düşük tempo daha
 * hızlıdır). Yalnızca geçerli değer bulunduğunda üretilir.
 */
export type ActivityMetricSummary = {
  average: number;
  best: number;
  /** Bu metriğe giren geçerli örnek sayısı. */
  sampleCount: number;
};

/** Grafiğin tek çubuğu: ham değer + [0,1] normalize yükseklik. */
export type ActivityChartBar = {
  id: string;
  completedAt: string;
  value: number;
  /** [0,1]. Tempoda daha HIZLI (düşük saniye/km) kayıt DAHA YÜKSEK çubuktur. */
  height: number;
};

export type ExerciseActivityAnalytics = {
  key: string;
  exerciseName: string;
  trackingMode: 'duration' | 'distance';
  recordCount: number;
  /** En yeni kayıt (kronolojik son). */
  lastRecord: ActivityAnalyticsRecord;
  /** Son en fazla 8 kayıt, kronolojik ARTAN (en yeni sonda / sağda). */
  recentRecords: ActivityAnalyticsRecord[];
  /** Süre her zaman bulunur. */
  duration: ActivityMetricSummary;
  /** Yalnızca geçerli mesafe verisi varsa. */
  distance?: ActivityMetricSummary;
  /** Yalnızca geçerli tempo verisi varsa. */
  pace?: ActivityMetricSummary;
  /** Yalnızca en az bir kayıtta RPE varsa. */
  averageRpe?: number;
  /** Bu egzersizde gösterilebilecek metrikler (süre her zaman ilk sırada). */
  availableMetrics: ActivityMetricKey[];
  /**
   * Son kaydın bir ÖNCEKİ kayda göre işaretli değişimi (veritabanı birimi).
   * Yalnız iki tarafta da geçerli değer varken üretilir; tek kayıtta boştur
   * (karşılaştırma nötr).
   */
  lastDelta: Partial<Record<ActivityMetricKey, number>>;
};

/** Grafikte gösterilecek son kayıt sayısı. */
export const ACTIVITY_CHART_RECENT_LIMIT = 8;

/** Egzersiz kimliği: önce programExerciseId, yoksa normalize snapshot ad. */
function exerciseIdentity(name: string, programExerciseId: string | undefined): string {
  return programExerciseId ?? `name:${name.trim().toLocaleLowerCase('tr-TR')}`;
}

/** Sonlu ve pozitif mi? (süre/mesafe/tempo geçerlilik kapısı). */
function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Bir kaydın ana performans değerleri analitiğe girebilir mi? */
function isValidActivityRecord(record: WorkoutActivityRecord): boolean {
  if (!isPositiveFinite(record.durationSeconds)) return false;
  return record.trackingMode !== 'distance' || isPositiveFinite(record.distanceMeters);
}

/** Deterministik ortalama: sonlu örneklerin ortalaması, tam sayıya yuvarlanır. */
function roundedAverage(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
}

/** Bir metriğin geçerli örneklerinden özet. Örnek yoksa `undefined`. */
function summarize(values: readonly number[], lowerIsBetter: boolean): ActivityMetricSummary | undefined {
  if (values.length === 0) return undefined;
  return {
    average: roundedAverage(values),
    best: lowerIsBetter ? Math.min(...values) : Math.max(...values),
    sampleCount: values.length,
  };
}

/**
 * Bir metrik serisini [0,1] çubuk yüksekliklerine çevirir.
 *
 * Süre/mesafe: `değer / max` → en yüksek değer tam çubuk.
 * Tempo: `min / değer` → EN HIZLI (en düşük saniye/km) tam çubuk; ham tempo
 * doğrudan yüksekliğe bağlanmaz, böylece hızlı tempo kısa çubuk olmaz.
 * Tek/eşit değerlerde yükseklik 1'dir. Geçersiz değer serilere hiç girmez.
 */
export function toActivityChartBars(
  records: readonly ActivityAnalyticsRecord[],
  metric: ActivityMetricKey,
): ActivityChartBar[] {
  const lowerIsBetter = metric === 'pace';
  const valueOf = (record: ActivityAnalyticsRecord): number | undefined => {
    if (metric === 'duration') return record.durationSeconds;
    if (metric === 'distance') return record.distanceMeters;
    return record.paceSecondsPerKm;
  };

  const valid = records
    .map((record) => ({ record, value: valueOf(record) }))
    .filter((entry): entry is { record: ActivityAnalyticsRecord; value: number } =>
      isPositiveFinite(entry.value),
    );
  if (valid.length === 0) return [];

  const values = valid.map((entry) => entry.value);
  const max = Math.max(...values);
  const min = Math.min(...values);

  return valid.map(({ record, value }) => ({
    id: record.id,
    completedAt: record.completedAt,
    value,
    // max/min pozitif olduğundan bölme güvenli; sonuç daima (0,1] aralığında.
    height: lowerIsBetter ? min / value : value / max,
  }));
}

/** Süre/mesafede artış, tempoda azalış bir GELİŞMEDİR. */
export function isMetricImprovement(metric: ActivityMetricKey, delta: number): boolean {
  if (delta === 0) return false;
  return metric === 'pace' ? delta < 0 : delta > 0;
}

/**
 * Kayıtları egzersiz başına gelişim analitiğine dönüştürür.
 *
 * Sıralama: en son kayıt yapılan egzersiz önce (özet listesi için). Her serinin
 * içi kronolojik artan tutulur.
 */
export function buildActivityAnalytics(
  records: readonly WorkoutActivityRecord[],
): ExerciseActivityAnalytics[] {
  const byExercise = new Map<string, WorkoutActivityRecord[]>();

  for (const record of records) {
    // Bozuk eski/elle eklenmiş veri son kayıt, sayaç veya karşılaştırma olamaz.
    if (!isValidActivityRecord(record)) continue;
    // Tür anahtara dahildir: ad fallback'inde farklı türler aynı seride karışmaz.
    const key = `${exerciseIdentity(record.exerciseName, record.programExerciseId)}#${record.trackingMode}`;
    const bucket = byExercise.get(key);
    if (bucket) bucket.push(record);
    else byExercise.set(key, [record]);
  }

  const analytics = [...byExercise.entries()].map(([key, bucket]) => {
    const sorted = [...bucket].sort((first, second) =>
      first.completedAt.localeCompare(second.completedAt),
    );

    const toAnalyticsRecord = (record: WorkoutActivityRecord): ActivityAnalyticsRecord => {
      const distanceMeters = isPositiveFinite(record.distanceMeters) ? record.distanceMeters : undefined;
      const rpe =
        typeof record.rpe === 'number' && Number.isFinite(record.rpe) && record.rpe >= 0 && record.rpe <= 10
          ? record.rpe
          : undefined;
      return {
        id: record.id,
        completedAt: record.completedAt,
        durationSeconds: record.durationSeconds,
        distanceMeters,
        paceSecondsPerKm: derivePaceSecondsPerKm(distanceMeters, record.durationSeconds),
        rpe,
      };
    };

    const allRecords = sorted.map(toAnalyticsRecord);
    const recentRecords = allRecords.slice(-ACTIVITY_CHART_RECENT_LIMIT);
    const last = allRecords[allRecords.length - 1];

    // Geçerli örnek havuzları (tüm seri; grafik ayrıca son 8'i kullanır).
    const durationValues = allRecords
      .map((record) => record.durationSeconds)
      .filter(isPositiveFinite);
    const distanceValues = allRecords
      .map((record) => record.distanceMeters)
      .filter(isPositiveFinite);
    const paceValues = allRecords
      .map((record) => record.paceSecondsPerKm)
      .filter(isPositiveFinite);
    const rpeValues = allRecords
      .map((record) => record.rpe)
      .filter(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10,
      );

    const duration = summarize(durationValues, false);
    const distance = summarize(distanceValues, false);
    const pace = summarize(paceValues, true);

    // Süre her kardiyo kaydında bulunur; savunmacı olarak yine de garanti edilir.
    const durationSummary: ActivityMetricSummary = duration ?? {
      average: last.durationSeconds,
      best: last.durationSeconds,
      sampleCount: allRecords.length,
    };

    const availableMetrics: ActivityMetricKey[] = ['duration'];
    if (distance) availableMetrics.push('distance');
    if (pace) availableMetrics.push('pace');

    // Son kaydın bir öncekine göre işaretli değişimi — iki tarafta da geçerliyse.
    const previous = allRecords[allRecords.length - 2];
    const lastDelta: Partial<Record<ActivityMetricKey, number>> = {};
    if (previous) {
      lastDelta.duration = last.durationSeconds - previous.durationSeconds;
      if (isPositiveFinite(last.distanceMeters) && isPositiveFinite(previous.distanceMeters)) {
        lastDelta.distance = last.distanceMeters - previous.distanceMeters;
      }
      if (isPositiveFinite(last.paceSecondsPerKm) && isPositiveFinite(previous.paceSecondsPerKm)) {
        lastDelta.pace = last.paceSecondsPerKm - previous.paceSecondsPerKm;
      }
    }

    const latest = sorted[sorted.length - 1];

    return {
      key,
      exerciseName: latest.exerciseName,
      trackingMode: latest.trackingMode,
      recordCount: allRecords.length,
      lastRecord: last,
      recentRecords,
      duration: durationSummary,
      distance,
      pace,
      averageRpe: rpeValues.length > 0 ? Math.round((rpeValues.reduce((s, v) => s + v, 0) / rpeValues.length) * 10) / 10 : undefined,
      availableMetrics,
      lastDelta,
    } satisfies ExerciseActivityAnalytics;
  });

  return analytics.sort((first, second) =>
    second.lastRecord.completedAt.localeCompare(first.lastRecord.completedAt),
  );
}
