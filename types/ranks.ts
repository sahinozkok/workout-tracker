import { RankEventKind, RankEventLabelKey } from '@/constants/rank-experience';
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

/**
 * Kullanıcının kendi RP hareketi — `public.rank_events` satırının EKRANDA
 * gereken parçası.
 *
 * Ham `event_type`, `source_key`, satır kimliği veya JSON metadata kullanıcıya
 * GÖSTERİLMEZ; bu tip zaten yalnızca gösterime dönüştürülmüş alanları taşır.
 * `id` sadece React listesi için kullanılır.
 *
 * Satırlar sunucuda üretilir ve append-only'dir: `rpDelta` bir kanıt
 * geçersizleştiğinde (ör. antrenman silindiğinde) negatif olabilir.
 */
export type RankEvent = {
  id: string;
  kind: RankEventKind;
  /** Sunucudan gelen RP değişimi. Negatif değer bir telafi satırıdır. */
  rpDelta: number;
  /** Kullanıcı metnine dönüşmüş etkinlik adının çeviri anahtarı. */
  labelKey: RankEventLabelKey;
  /**
   * Ekranda gösterilecek tarih (`YYYY-MM-DD`). Sunucuda `awarded_for_date`
   * boş kalabildiği için o durumda kaydın oluşturulma günü kullanılır.
   */
  dateKey: string;
};

/**
 * Aynı sezon içinde gerçekleşmiş, henüz gösterilmemiş rank yükselmesi.
 *
 * `id` artan bir sayaçtır: React yeniden render olduğunda, tekrar sync'te veya
 * AppState dönüşünde aynı yükseliş ikinci kez oynatılmaz.
 */
export type RankUpCelebration = {
  id: number;
  fromRank: RankId;
  toRank: RankId;
  /** Sunucudan gelen güncel RP. İstemci bu değeri hesaplamaz. */
  rp: number;
  seasonIndex: number;
};
