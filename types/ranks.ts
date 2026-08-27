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

/** Rank ekranındaki salt okunur haftalık odak kartı. */
export type RankWeekFocus = {
  /** Haftanın Pazartesi başlangıcı (`YYYY-MM-DD`). */
  startsOn: string;
  /** Haftanın Pazar bitişi (`YYYY-MM-DD`). */
  endsOn: string;
  days: RankWeekFocusDay[];
};

export type RankWeekFocusDay = {
  dateKey: string;
  /** Rank kanıtından gelen gerçek ilerleme; ilerleme yoksa `undefined`. */
  state?: 'completed' | 'partial';
  /** Off day ve programsız günlerde false. */
  isScheduledWorkout: boolean;
  /** Otorite programı çözülemediyse false; istemci tahminde bulunmaz. */
  isVerifiable: boolean;
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

/**
 * Yeni sezona geçildikten sonra bir kez gösterilen SEZON SONU ÖZETİ.
 *
 * Bütün sayılar sunucudan gelir: kapanmış sezonun DEĞİŞMEZ arşiv satırı ve
 * yeni sezonun soft reset ile belirlenmiş başlangıç RP'si. İstemci burada
 * hiçbir RP, rank veya soft reset değeri HESAPLAMAZ; `planCompletionPercent`
 * yalnızca sunucunun yazdığı iki sayının gösterim oranıdır.
 */
export type SeasonRecap = {
  /** Kapanmış sezonun sunucu arşivi. */
  archive: RankSeasonArchive;
  /** Kullanıcının şu an içinde olduğu sezon. */
  nextSeasonIndex: number;
  /** Yeni sezona soft reset ile girilen RP — sunucudan. */
  startingRp: number;
  planCompletionPercent: number;
};

/**
 * Arkadaş sezon sıralamasındaki tek satır.
 *
 * Bütün değerler `get_friends_rank_leaderboard()` RPC'sinden gelir; istemci
 * RP, rank veya sıra HESAPLAMAZ. Satırda e-posta, gül bakiyesi, level/XP,
 * bio/hedef, ham `rank_events`, workout ayrıntısı veya disiplin günü YOKTUR.
 */
export type FriendRankLeaderboardEntry = {
  userId: string;
  /** Profil adı okunamadıysa `undefined`; ekran çeviriden yedek metin koyar. */
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  /** Bu satır aktif kullanıcının kendisi mi? */
  isSelf: boolean;
  /**
   * Güncel sezonda rank satırı var mı?
   *
   * `false` ise `currentRp`, `currentRank` ve `position` alanlarının ÜÇÜ DE
   * `undefined`dır: eski sezon değeri kullanılmaz, Bronze/0'a zorlanmaz.
   */
  isRanked: boolean;
  currentRp?: number;
  currentRank?: RankId;
  /** `dense_rank()` sırası — eşit RP aynı numarayı paylaşır. */
  position?: number;
};

/** Arkadaş sezon sıralamasının tam yanıtı. */
export type FriendRankLeaderboard = {
  /** Sunucunun belirlediği güncel sezon. İstemci sezon gönderemez. */
  seasonIndex?: number;
  /** Sunucudan geldiği sıradadır; istemci yeniden sıralamaz. */
  entries: FriendRankLeaderboardEntry[];
  /** Sınırdan bağımsız TOPLAM katılımcı sayısı. */
  participantCount: number;
  /** Sınır nedeniyle bazı katılımcılar listede yoksa `true`. */
  isTruncated: boolean;
};
