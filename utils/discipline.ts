import { DisciplineStatus } from '@/types/workout';

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * DST/saat dilimi GÜVENLİ gün kaydırma.
 *
 * Tarih öğle (12:00) demirlemesiyle kurulur: ilkbahar ileri-saatinde gece
 * yarısı bazı bölgelerde HİÇ yaşanmaz ve gece yarısı demirli bir `Date`
 * beklenmedik güne kayabilir. Öğleden gün eklemek/çıkarmak, gün 23 veya 25
 * saat sürse de her zaman doğru takvim gününde kalır. Ay/yıl sınırı
 * `setDate` tarafından normalize edilir (örn. `-1` gün 1 Ocak'tan 31 Aralık'a).
 */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  date.setDate(date.getDate() + deltaDays);
  return toDateKey(date);
}

/** `completed` ve `partial` seriyi SÜRDÜREN durumlardır; `skipped` sürdürmez. */
const STREAK_STATUSES: ReadonlySet<DisciplineStatus> = new Set<DisciplineStatus>([
  'completed',
  'partial',
]);

export type DisciplineStreakPeriod = {
  startDateKey: string;
  endDateKey: string;
  length: number;
  /** Yalnız hâlâ yaşayan (bugün ya da — gün içi koruma ile — dün biten) dönem. */
  isCurrent: boolean;
};

export type DisciplineStreakInsights = {
  currentStreak: number;
  longestStreak: number;
  /** Bütün dönem uzunluklarının ortalaması; dönem yoksa 0. Ondalık olabilir. */
  averageStreak: number;
  totalStreaks: number;
  /** En yeniden eskiye sıralı. */
  periods: DisciplineStreakPeriod[];
};

/**
 * GÖRÜNEN disiplin takviminin (`disciplineStatuses`) seri analizini yapan SAF
 * çekirdek. Sistem saatine bağlı DEĞİLDİR: `todayKey` dışarıdan enjekte edilir.
 *
 * Bu metrik, sezonluk rank sistemindeki sunucu-kontrollü `rankSeason` seri
 * verisinden BAĞIMSIZDIR ve onunla birleştirilmez.
 *
 * Kurallar:
 *  - `completed` ve `partial` seriyi sürdürür; `skipped`, eksik gün veya geçersiz
 *    durum seriyi kırar.
 *  - Gelecek tarihler (`> todayKey`) tamamen yok sayılır.
 *  - Bir günlük seri geçerlidir ve ortalamaya katılır.
 *  - Ortalama: tüm dönem uzunlukları toplamı / dönem sayısı (dönem yoksa 0).
 *  - GÜNCEL seri GRACE-AWARE'dir: bugün `completed`/`partial` ise bugünden,
 *    bugün henüz işaretsizse ama dün seriyi sürdürüyorsa dünden geriye sayılır
 *    (gün içi koruma — sabah antrenman yapılmadı diye seri sıfırlanmaz). Bugün
 *    `skipped` ise ya da son başarılı gün dünden eskiyse güncel seri 0'dır.
 *
 * Girdi nesnesi MUTATE EDİLMEZ; yalnız okunur.
 */
export function analyzeDisciplineStreaks(
  statuses: Record<string, DisciplineStatus>,
  todayKey: string,
): DisciplineStreakInsights {
  // Yalnız bugüne kadar olan, seriyi sürdüren günler; kronolojik sırada.
  const streakDays = Object.keys(statuses)
    .filter((dateKey) => dateKey <= todayKey && STREAK_STATUSES.has(statuses[dateKey]))
    .sort();

  /**
   * Takvim-ARDIŞIK günleri tek döneme grupla. Eksik gün VEYA `skipped` araya
   * girdiğinde `streakDays` içinde o gün bulunmaz, dolayısıyla ardışıklık kırılır
   * ve yeni dönem başlar; iki kırılma türünü ayrı ele almaya gerek yoktur.
   * Ardışıklık DST-güvenli `shiftDateKey` ile ölçülür; her takvim günü tek tek
   * dolaşılmaz, yalnız işaretli günler gezilir.
   */
  const periods: DisciplineStreakPeriod[] = [];
  for (const dateKey of streakDays) {
    const last = periods[periods.length - 1];
    if (last && shiftDateKey(last.endDateKey, 1) === dateKey) {
      last.endDateKey = dateKey;
      last.length += 1;
    } else {
      periods.push({ startDateKey: dateKey, endDateKey: dateKey, length: 1, isCurrent: false });
    }
  }

  /**
   * Güncel serinin demirlendiği gün:
   *  - bugün seriyi sürdürüyorsa → bugün,
   *  - bugün henüz işaretsiz ve dün sürdürüyorsa → dün (gün içi koruma),
   *  - bugün `skipped` / geçersizse veya son başarı dünden eskiyse → yok.
   */
  const todayStatus = statuses[todayKey];
  let anchorKey: string | undefined;
  if (todayStatus !== undefined && STREAK_STATUSES.has(todayStatus)) {
    anchorKey = todayKey;
  } else if (todayStatus === undefined) {
    const yesterdayKey = shiftDateKey(todayKey, -1);
    const yesterdayStatus = statuses[yesterdayKey];
    if (yesterdayStatus !== undefined && STREAK_STATUSES.has(yesterdayStatus)) {
      anchorKey = yesterdayKey;
    }
  }

  let currentStreak = 0;
  if (anchorKey !== undefined) {
    const currentPeriod = periods.find((period) => period.endDateKey === anchorKey);
    if (currentPeriod) {
      currentPeriod.isCurrent = true;
      currentStreak = currentPeriod.length;
    }
  }

  const totalStreaks = periods.length;
  const longestStreak = periods.reduce((max, period) => Math.max(max, period.length), 0);
  const totalLength = periods.reduce((sum, period) => sum + period.length, 0);
  const averageStreak = totalStreaks === 0 ? 0 : totalLength / totalStreaks;

  // Dönemler kronolojik kuruldu; listeyi en yeniden eskiye çevir.
  periods.reverse();

  return { currentStreak, longestStreak, averageStreak, totalStreaks, periods };
}

/**
 * Geriye uyumlu ince sarmalayıcı: tek bir "güncel seri" anlamı olsun diye yeni
 * çekirdeğin GRACE-AWARE `currentStreak` sonucunu döndürür. Ana sayfa, profil,
 * Rosea ve seri geçmişi ekranı aynı değeri paylaşır.
 */
export function calculateDisciplineStreak(statuses: Record<string, DisciplineStatus>) {
  return analyzeDisciplineStreaks(statuses, toDateKey(new Date())).currentStreak;
}
