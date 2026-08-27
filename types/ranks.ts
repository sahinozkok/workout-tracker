import { RankId } from '@/constants/ranks';

/**
 * Sunucudan gelen sezonluk rank özeti.
 *
 * Bütün sayılar SUNUCU tarafından hesaplanır. İstemci hiçbir alanı gönderemez
 * ve hiçbirini yerel olarak türetmez; ekranlar yalnızca burada gelen değeri
 * gösterir.
 */
export type RankSeasonSummary = {
  seasonIndex: number;
  /** `YYYY-MM-DD` — sezonun Pazartesi başlangıcı. */
  startsOn: string;
  /** `YYYY-MM-DD` — sezonun Pazar bitişi. */
  endsOn: string;
  /** İleride özel tema adı eklenirse dolu gelir; şimdilik `undefined`. */
  themeName?: string;
  /** Sezona soft reset ile girilen RP. */
  startingRp: number;
  currentRp: number;
  peakRp: number;
  currentRank: RankId;
  peakRank: RankId;
  /** Bu sezonda tamamlanan (silinmemiş) antrenman sayısı. */
  workoutsCompleted: number;
  /** Sezondaki planlı antrenman günü sayısı (off day hariç). */
  scheduledDaysTotal: number;
  /** Bunların kaçı tam tamamlandı. */
  scheduledDaysCompleted: number;
  /** Sezon penceresindeki en uzun kesintisiz disiplin serisi. */
  longestStreak: number;
};

/**
 * Kapanmış (arşivlenmiş) sezon kaydı.
 *
 * Bu satırlar sunucuda DEĞİŞMEZDİR: sezon kapandıktan sonra antrenman silinse
 * bile final sonucu değişmez.
 */
export type RankSeasonArchive = {
  seasonIndex: number;
  startsOn: string;
  endsOn: string;
  themeName?: string;
  finalRp: number;
  finalRank: RankId;
  peakRank: RankId;
  workoutsCompleted: number;
  scheduledDaysTotal: number;
  scheduledDaysCompleted: number;
  longestStreak: number;
};

/** Arkadaş profilinde gösterilen GÜVENLİ özet. Ham event geçmişi İÇERMEZ. */
export type FriendRankSummary = {
  seasonIndex: number;
  currentRp: number;
  currentRank: RankId;
  peakRank: RankId;
};
