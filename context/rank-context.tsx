import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import {
  canClaimRankOverlay,
  decideAchievementCelebrations,
  decideRankCelebration,
  decideSeasonRecap,
  parseCelebratedAchievementKeys,
  rankCelebrationStorageKey,
  RankOverlayOwner,
  seasonAchievementCelebrationStorageKey,
  SeasonAchievementKey,
  seasonRecapStorageKey,
  serializeCelebratedAchievementKeys,
} from '@/constants/rank-experience';
import { RankId, RANK_IDS } from '@/constants/ranks';
import { useAuth } from '@/context/auth-context';
import { useLocalDateKey } from '@/hooks/use-shared-discipline-sync';
import {
  fetchMyRankEvents,
  fetchMyRankHistory,
  fetchMyRankWeekFocus,
  fetchMyShowcaseSelection,
  saveMyShowcaseSelection,
  syncMyRank,
  syncMySeasonAchievements,
} from '@/services/ranks';
import {
  RankEvent,
  RankSeasonArchive,
  RankSeasonSummary,
  RankUpCelebration,
  RankWeekFocus,
  SeasonAchievement,
  SeasonAchievementShowcaseEntry,
  SeasonRecap,
  SeasonShowcaseSelection,
  SeasonShowcaseSelectionResult,
  SeasonShowcaseSelectionSaveResult,
} from '@/types/ranks';

/**
 * Sezonluk rank durumunun TEK kaynağı.
 *
 * Kurallar (`RewardProvider` ile aynı duruş, ama tamamen AYRI katman):
 *  - Toplamlar hiçbir zaman istemcide hesaplanmaz; sunucu cevabı olduğu gibi
 *    yazılır. Optimistic/sahte RP GÖSTERİLMEZ.
 *  - Sürekli polling YOKTUR. Sync yalnızca (a) hesap/yerel gün değişiminde,
 *    (b) uygulama `active` olduğunda ve (c) antrenman akışı açıkça istediğinde
 *    çalışır.
 *  - Tek uçuş (single-flight): devam eden bir sync varken ikincisi başlamaz;
 *    ama "bu arada yeni bir istek geldi" bilgisi tutulur ve uçuş bitince bir
 *    kez daha çalışır (aksi hâlde son set'in RP'si bir sonraki açılışa kalırdı).
 *  - Hesap sahipliği: A hesabının geç gelen cevabı B'nin state'ine YAZILMAZ.
 *  - Ağ hatası hiçbir akışı engellemez; sunucu defteri idempotent olduğu için
 *    sonraki güvenli sync eksikleri tamamlar.
 *
 * XP/gül/level tarafına HİÇ dokunmaz: `RewardProvider` davranışı aynen kalır.
 */

type RankContextValue = {
  /** Sunucudan gelen güncel sezon özeti. Henüz yüklenmediyse `undefined`. */
  season?: RankSeasonSummary;
  isRankLoading: boolean;
  /**
   * İlk gerçek rank isteği TAMAMLANDI ama sunucudan gösterilebilir bir sezon
   * gelmedi (RPC hata verdi ya da boş döndü). Yalnızca elde HİÇ sezon yokken
   * `true` olur; eldeki sezon geçici bir hatayla silinmez. Rank ekranı bunu
   * sonsuz spinner yerine hata + Retry göstermek, profil de vitrini sonsuz
   * loading'de bırakmamak için kullanır. Rank/RP İSTEMCİDE HESAPLANMAZ.
   */
  hasRankError: boolean;
  /** Kapanmış sezon arşivi; yalnızca detay ekranı istediğinde yüklenir. */
  history: RankSeasonArchive[];
  isHistoryLoading: boolean;
  /** Son RP hareketleri; yalnızca rank ekranı istediğinde yüklenir. */
  events: RankEvent[];
  isEventsLoading: boolean;
  /** Güncel haftanın sunucu tarafından doğrulanmış odak görünümü. */
  weekFocus?: RankWeekFocus;
  isWeekFocusLoading: boolean;
  hasWeekFocusError: boolean;
  /**
   * Güncel sezonun görsel başarıları. Yalnızca Rank ekranı istediğinde
   * yüklenir; RP/XP/gül tarafına HİÇ dokunmaz.
   */
  achievements: SeasonAchievement[];
  isAchievementsLoading: boolean;
  hasAchievementsError: boolean;
  /**
   * VİTRİN SEÇİMİ — güncel sezon.
   *
   * Boş liste = OTOMATİK mod. Dolu liste kullanıcının seçtiği SIRAYI taşır.
   * Seçim kozmetiktir; RP, XP, level veya gül üretmez ve başarı koşullarına,
   * kutlama/baseline mantığına DOKUNMAZ.
   */
  showcaseSelection: SeasonShowcaseSelection;
  isShowcaseSelectionLoading: boolean;
  hasShowcaseSelectionError: boolean;
  /** Özel seçim var mı? `false` ise vitrin otomatik moddadır. */
  isShowcaseSelectionCustom: boolean;
  /**
   * GÜNCEL sezonun seçimi gerçekten yüklendi mi?
   *
   * `false` iken taslak hazırlanmamalı ve vitrin otomatik moddaymış gibi
   * gösterilmemelidir. Sezon değişince yeni sezonun cevabı gelene kadar
   * yeniden `false` olur.
   */
  isShowcaseSelectionReady: boolean;
  /** Cevabın ait olduğu sezon; `undefined` = henüz yüklenmedi. */
  showcaseSelectionSeasonIndex?: number;
  /**
   * Profilde gösterilecek rozetler — SIRASI HAZIR.
   *
   * Özel seçim varsa seçim sırasında, yoksa en son kazanılan üç rozet.
   */
  profileShowcaseEntries: SeasonAchievementShowcaseEntry[];
  loadShowcaseSelection: () => Promise<void>;
  /**
   * Seçimi kaydeder. Boş dizi otomatik moda döner.
   *
   * Ağ/sunucu hatası FIRLATILIR. Çağrı başarılı olsa bile sonuç yalnızca
   * `status === 'applied'` ise güncel sezona uygulanmıştır; diğer durumlar
   * BAŞARISIZLIKTIR ve çağıran ekranı kapatmamalıdır.
   */
  saveShowcaseSelection: (
    keys: readonly SeasonAchievementKey[],
  ) => Promise<SeasonShowcaseSelectionSaveResult>;
  /** Gösterilmeyi bekleyen başarı kutlaması (kuyruğun başı). */
  achievementCelebration?: SeasonAchievementKey;
  /**
   * Kutlama ekranda GERÇEKTEN render/layout oldu. Kalıcı kayıt yalnızca burada
   * ilerler; kapanışı yönetmez.
   */
  acknowledgeAchievementCelebrationShown: (key: SeasonAchievementKey) => Promise<void>;
  /** Kutlama kapandı. Kuyruktan yalnızca bu rozeti düşürür. */
  dismissAchievementCelebration: (key: SeasonAchievementKey) => void;
  /**
   * KATMAN SAHİPLİĞİ — aynı anda yalnızca bir rank overlay'i görünebilir.
   *
   * Senkron ve ref tabanlıdır: iki katman aynı karede birden claim edemez.
   * `false` dönerse çağıran katman gösterime BAŞLAMAZ ve sırasını bekler.
   */
  claimRankOverlay: (owner: RankOverlayOwner) => boolean;
  /**
   * Şu an görünen katman. Katmanların açılma effect'leri bunu DİNLER; kilit
   * serbest kaldığında bekleyen uygun katman kendiliğinden yeniden dener.
   */
  activeRankOverlay?: RankOverlayOwner;
  /** Sahipliği bırakır. Yalnızca sahibi olan katman bırakabilir. */
  releaseRankOverlay: (owner: RankOverlayOwner) => void;
  /** Gösterilmeyi bekleyen rank yükselmesi. Gösterilince temizlenir. */
  rankUp?: RankUpCelebration;
  /** Güvenli sync. Tekrar çağrılması zararsızdır. */
  syncRank: () => Promise<void>;
  loadHistory: () => Promise<void>;
  loadEvents: () => Promise<void>;
  loadWeekFocus: () => Promise<void>;
  loadAchievements: () => Promise<void>;
  /**
   * Kutlama ekranda GERÇEKTEN gösterilmeye başladı. Onay kaydı yalnızca
   * burada yazılır; kapanışı yönetmez.
   */
  acknowledgeRankUpShown: (celebrationId: number) => Promise<void>;
  /** Kutlama kapandı. Yalnızca aynı kimliğe sahip kutlamayı temizler. */
  dismissRankUp: (celebrationId: number) => void;
  /** Gösterilmeyi bekleyen sezon sonu özeti. Kapanınca temizlenir. */
  seasonRecap?: SeasonRecap;
  /**
   * Sezon özeti ekranda GERÇEKTEN gösterilmeye başladı. Kayıt yalnızca burada
   * yazılır; kapanışı yönetmez.
   */
  acknowledgeSeasonRecapShown: (closedSeasonIndex: number) => Promise<void>;
  /** Özet kapandı. Yalnızca aynı kapanmış sezonun özetini temizler. */
  dismissSeasonRecap: (closedSeasonIndex: number) => void;
};

/** AsyncStorage'da tutulan onay kaydının bellek içi hâli. */
type CelebrationBaseline = {
  userId: string;
  seasonIndex: number;
  rank: RankId;
};

const RankContext = createContext<RankContextValue | undefined>(undefined);

/**
 * Sezon özeti için arşiv isteğinin oturum başına en fazla kaç kez
 * DENENEBİLECEĞİ.
 *
 * Yeniden deneme yalnızca doğal tetikleyicilere (rank sync, AppState dönüşü)
 * bağlıdır — zamanlayıcı veya polling YOKTUR. Bu üst sınır, sunucu ısrarla
 * hata verdiğinde antrenman boyunca her set sonrası yeni bir istek atılmasını
 * önler. Sınır dolduğunda karar "özet yok" diye KAPATILMAZ: rank ekranından
 * gelen başarılı bir yükleme özeti hâlâ açabilir, uygulama yeniden
 * başladığında da deneme hakkı sıfırlanır.
 */
const RECAP_HISTORY_MAX_ATTEMPTS = 3;

/** Depodan okunan rank kimliğini güvenle daraltır; bozuk kayıt yok sayılır. */
function parseStoredRank(value: string | null): RankId | undefined {
  return value && RANK_IDS.includes(value as RankId) ? (value as RankId) : undefined;
}

export function RankProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const userId = user?.id;
  /** Cihazın YEREL günü; gece yarısı ve ön plana dönüşte kendiliğinden değişir. */
  const todayKey = useLocalDateKey();

  const [season, setSeason] = useState<RankSeasonSummary>();
  const [isRankLoading, setIsRankLoading] = useState(false);
  const [hasRankError, setHasRankError] = useState(false);
  const [history, setHistory] = useState<RankSeasonArchive[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [events, setEvents] = useState<RankEvent[]>([]);
  const [isEventsLoading, setIsEventsLoading] = useState(false);
  const [weekFocus, setWeekFocus] = useState<RankWeekFocus>();
  const [isWeekFocusLoading, setIsWeekFocusLoading] = useState(false);
  const [hasWeekFocusError, setHasWeekFocusError] = useState(false);
  const [achievements, setAchievements] = useState<SeasonAchievement[]>([]);
  const [isAchievementsLoading, setIsAchievementsLoading] = useState(false);
  const [hasAchievementsError, setHasAchievementsError] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState<SeasonAchievementKey[]>([]);
  /**
   * Sunucudan gelen SON başarılı seçim cevabı — sezon kimliğiyle birlikte.
   *
   * `undefined` = henüz yüklenmedi. Bu ayrım kritiktir: "sıfır rozet"
   * (otomatik mod) ile "cevap gelmedi" birbirine karışırsa ekran boş taslağı
   * kaydedilebilir sanır ve kullanıcının kayıtlı seçimini ezebilir.
   */
  const [showcaseSelectionResult, setShowcaseSelectionResult] =
    useState<SeasonShowcaseSelectionResult>();
  const [isShowcaseSelectionLoading, setIsShowcaseSelectionLoading] = useState(false);
  const [hasShowcaseSelectionError, setHasShowcaseSelectionError] = useState(false);
  /**
   * Aktif katman — REAKTİF.
   *
   * Değer bilinçli olarak context'e AÇILIR: bir katmanın `claimRankOverlay`
   * çağrısı başarısız olduğunda effect'i çıkar, ve kilit serbest kaldığında
   * yeniden denemesi için bir bağımlılık değişimi gerekir. Bu state olmasaydı
   * bekleyen katman, alakasız başka bir state değişikliği olana kadar hiç
   * açılmazdı. Senkron OTORİTE hâlâ `activeOverlayRef`tir; bu state yalnızca
   * bekleyen katmanları uyandırır.
   */
  const [activeRankOverlay, setActiveOverlay] = useState<RankOverlayOwner>();
  const [rankUp, setRankUp] = useState<RankUpCelebration>();
  const [seasonRecap, setSeasonRecap] = useState<SeasonRecap>();

  const isMountedRef = useRef(true);
  /** Hesap sahipliği. Hesap değişince artar; eski cevap yeni state'e yazamaz. */
  const ownerRef = useRef(0);
  /** Senkron tek-uçuş kilidi. */
  const isSyncingRef = useRef(false);
  /** Uçuş sürerken gelen istek: bitince bir kez daha çalışılır. */
  const hasQueuedSyncRef = useRef(false);
  /** Yerel günün son senkronize edilmiş hâli; aynı gün için tekrar tetiklenmez. */
  const todayKeyRef = useRef(todayKey);

  /** RP geçmişi bu oturumda en az bir kez istendi mi? */
  const hasRequestedEventsRef = useRef(false);
  /** Geçmiş için tek uçuş + kuyruk; sync ile aynı kalıp. */
  const isEventsFetchingRef = useRef(false);
  const hasQueuedEventsRef = useRef(false);
  /** `runSync` içinden çağrılabilmesi için kimliği sabit olmayan referans. */
  const loadEventsRef = useRef<() => void>(() => undefined);

  /** Haftalık odak yalnızca Rank ekranı istediğinde yüklenir ve tazelenir. */
  const hasRequestedWeekFocusRef = useRef(false);
  const isWeekFocusFetchingRef = useRef(false);
  const hasQueuedWeekFocusRef = useRef(false);
  const loadWeekFocusRef = useRef<() => void>(() => undefined);

  /** Sezon başarıları da yalnızca Rank ekranı istediğinde yüklenir. */
  const hasRequestedAchievementsRef = useRef(false);
  const isAchievementsFetchingRef = useRef(false);
  const hasQueuedAchievementsRef = useRef(false);
  const loadAchievementsRef = useRef<() => void>(() => undefined);

  /** `${userId}:${seasonIndex}` — seçim bu oturumda okundu mu? */
  const loadedShowcaseSelectionRef = useRef<string>(undefined);
  /** Seçim okuması için tek uçuş + kuyruk; diğer yüklemelerle aynı kalıp. */
  const isShowcaseSelectionFetchingRef = useRef(false);
  const hasQueuedShowcaseSelectionRef = useRef(false);

  /** Depodaki "gösterildi" kaydının bellek içi kopyası. */
  const celebratedAchievementsRef = useRef<{
    keys: SeasonAchievementKey[];
    seasonIndex: number;
    userId: string;
  }>(undefined);
  /** Kutlama kararları ve depo yazmaları sıraya alınır: iki cevap yarışamaz. */
  const achievementCelebrationChainRef = useRef<Promise<void>>(Promise.resolve());
  /** Bekleyen kuyruğun senkron kopyası. */
  const achievementQueueRef = useRef<SeasonAchievementKey[]>([]);

  /**
   * Aktif rank katmanı. Senkron OTORİTE budur; state yalnızca yeniden render
   * içindir. Böylece iki katman aynı karede claim edemez.
   */
  const activeOverlayRef = useRef<RankOverlayOwner>(undefined);

  /** Kutlama onay kaydının bellek içi kopyası; her seferinde depo okunmaz. */
  const baselineRef = useRef<CelebrationBaseline>(undefined);
  /** Kutlama kararları sıraya alınır: iki sezon cevabı yarışamaz. */
  const celebrationChainRef = useRef<Promise<void>>(Promise.resolve());
  /** Artan kutlama kimliği. */
  const celebrationIdRef = useRef(0);
  /** Bekleyen kutlamanın senkron kopyası (state flush'ını beklemeden okunur). */
  const rankUpRef = useRef<RankUpCelebration>(undefined);
  /** Onay kaydı yazılmış son kutlama; aynı kutlama iki kez yazılmaz. */
  const acknowledgedCelebrationIdRef = useRef(0);
  /** Güncel sezonun senkron kopyası; gösterim onayında sahiplik kontrolü için. */
  const seasonRef = useRef<RankSeasonSummary>(undefined);

  /** Arşiv en az bir kez BAŞARIYLA okundu mu? Boş dizi ile karışmasın diye. */
  const hasLoadedHistoryRef = useRef(false);
  /** Sezon özeti kararları sıraya alınır: iki cevap yarışamaz. */
  const recapChainRef = useRef<Promise<void>>(Promise.resolve());
  /** Bekleyen özetin senkron kopyası. */
  const seasonRecapRef = useRef<SeasonRecap>(undefined);
  /** `${userId}:${closedSeasonIndex}` — karar verilmiş özet; tekrar sorulmaz. */
  const resolvedRecapRef = useRef<string>(undefined);
  /** `${userId}:${seasonIndex}` — özet için arşiv bu oturumda istendi mi? */
  const requestedRecapHistoryRef = useRef<string>(undefined);
  /** Aynı istek için harcanan deneme hakkı; istek fırtınasını önler. */
  const recapHistoryAttemptsRef = useRef<{ count: number; key: string }>(undefined);
  /** Gösterim kaydı yazılmış son özet. Aynı özet iki kez yazılmaz. */
  const acknowledgedRecapRef = useRef<string>(undefined);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    todayKeyRef.current = todayKey;
  }, [todayKey]);

  useEffect(() => {
    rankUpRef.current = rankUp;
  }, [rankUp]);

  useEffect(() => {
    seasonRef.current = season;
  }, [season]);

  useEffect(() => {
    seasonRecapRef.current = seasonRecap;
  }, [seasonRecap]);

  const runSync = useCallback(async () => {
    if (!userId) return;

    // Tek uçuş: devam eden istek varken ikincisi başlatılmaz, ama not düşülür.
    if (isSyncingRef.current) {
      hasQueuedSyncRef.current = true;
      return;
    }

    isSyncingRef.current = true;
    const owner = ownerRef.current;
    // Gerçek uçuş başlıyor: ekran loading gösterebilir ve önceki hata temizlenir
    // (Retry de bu yoldan geçtiği için spinner'a döner).
    if (isMountedRef.current) {
      setIsRankLoading(true);
      setHasRankError(false);
    }

    try {
      const next = await syncMyRank(todayKeyRef.current);
      // Hesap arada değiştiyse eski cevap hiçbir şeyi yazamaz.
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      if (next) {
        // Aynı uçuşun hemen ardından başlayan başarı/vitrin yüklemesi React
        // render'ını beklemeden güncel sezonu görsün. Aksi hâlde hızlı bir RPC
        // cevabı ilk açılışta seçim yüklemesini bir sonraki sync'e bırakabilir.
        seasonRef.current = next;
        setSeason(next);
        setHasRankError(false);
      } else if (!seasonRef.current) {
        /**
         * İstek TAMAMLANDI ama sunucu sezon döndürmedi ve elde de sezon yok.
         * Ekran bunu sonsuz spinner değil, hata + Retry olarak göstermeli.
         * Zero-RP/yeni kullanıcı GEÇERLİ bir satır döndürür (season dolu olur),
         * dolayısıyla burada yanlışlıkla hata sayılmaz.
         */
        setHasRankError(true);
      }

      /**
       * RP geçmişi YALNIZCA daha önce istendiyse tazelenir. Kullanıcı rank
       * ekranını hiç açmadıysa arka planda tek bir ek istek bile atılmaz.
       */
      if (hasRequestedEventsRef.current) loadEventsRef.current();
      if (hasRequestedWeekFocusRef.current) loadWeekFocusRef.current();
      /**
       * BAŞARILAR HER BAŞARILI RANK SYNC'İNDEN SONRA UZLAŞTIRILIR.
       *
       * Bilinçli olarak `hasRequestedAchievementsRef` koşuluna BAĞLI DEĞİLDİR:
       * `sync_my_season_achievements` rozetleri yazan RPC'dir, dolayısıyla
       * yalnızca Rank ekranı açıldığında çağrılsaydı kullanıcı antrenmandan
       * hemen sonraki kutlamayı kaçırırdı.
       *
       * Ek yük sınırlıdır ve yeni bir istek DÖNGÜSÜ kurulmaz: `loadAchievements`
       * kendi tek-uçuş kilidini uygular (eşzamanlı ikinci RPC başlamaz), RPC
       * idempotenttir ve POLLING/interval YOKTUR — tetikleyici yalnızca zaten
       * var olan rank sync'idir.
       */
      loadAchievementsRef.current();
    } catch {
      // Rank okunamazsa akış engellenmez; sonraki güvenli sync eksikleri
      // idempotent tamamlar. Yalnızca gösterilecek hiç sezon YOKKEN hata
      // işaretlenir — eldeki sezon geçici bir hatayla silinmez.
      if (isMountedRef.current && owner === ownerRef.current && !seasonRef.current) {
        setHasRankError(true);
      }
    } finally {
      // Kilidi yalnızca hâlâ aynı hesabın uçuşu açar.
      if (owner === ownerRef.current) {
        isSyncingRef.current = false;
        if (isMountedRef.current) setIsRankLoading(false);

        if (hasQueuedSyncRef.current) {
          hasQueuedSyncRef.current = false;
          void runSync();
        }
      }
    }
  }, [userId]);

  const syncRank = useCallback(async () => {
    await runSync();
  }, [runSync]);

  const loadHistory = useCallback(async () => {
    if (!userId) return;
    const owner = ownerRef.current;
    setIsHistoryLoading(true);
    try {
      const rows = await fetchMyRankHistory();
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      // Boş dizi "arşiv yok" demektir; "henüz okunmadı" ile karışmaması için
      // başarı ayrı bir bayrakla işaretlenir (sezon özeti buna bakar).
      hasLoadedHistoryRef.current = true;
      setHistory(rows);
    } catch {
      // Arşiv okunamazsa ekran boş liste ile açılır; kullanıcı tekrar deneyebilir.
    } finally {
      if (isMountedRef.current && owner === ownerRef.current) setIsHistoryLoading(false);
    }
  }, [userId]);

  /**
   * Son RP hareketleri.
   *
   * `syncRank` ile AYNI tek-uçuş kalıbını kullanır: devam eden istek varken
   * ikincisi başlamaz, ama not düşülür ve uçuş bitince bir kez daha çalışır.
   * Hesap sahipliği burada da geçerlidir; A'nın geç gelen cevabı B'nin
   * listesine yazılmaz. Hata hiçbir akışı engellemez, liste boş kalır.
   */
  const loadEvents = useCallback(async () => {
    if (!userId) return;
    hasRequestedEventsRef.current = true;

    if (isEventsFetchingRef.current) {
      hasQueuedEventsRef.current = true;
      return;
    }

    isEventsFetchingRef.current = true;
    const owner = ownerRef.current;
    if (isMountedRef.current) setIsEventsLoading(true);

    try {
      const rows = await fetchMyRankEvents();
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      setEvents(rows);
    } catch {
      // RP geçmişi okunamazsa yalnızca bu bölüm boş kalır; rank, antrenman ve
      // set kaydı akışları etkilenmez.
    } finally {
      if (owner === ownerRef.current) {
        isEventsFetchingRef.current = false;
        if (isMountedRef.current) setIsEventsLoading(false);

        if (hasQueuedEventsRef.current) {
          hasQueuedEventsRef.current = false;
          void loadEvents();
        }
      }
    }
  }, [userId]);

  useEffect(() => {
    loadEventsRef.current = () => {
      void loadEvents();
    };
  }, [loadEvents]);

  /**
   * Güncel haftanın odak görünümü.
   *
   * Events ile aynı tek-uçuş/latest-wins ve hesap sahipliği kurallarını
   * uygular. Hata yalnızca kartta gösterilir; rank ve antrenman akışlarını
   * hiçbir koşulda engellemez.
   */
  const loadWeekFocus = useCallback(async () => {
    if (!userId) return;
    hasRequestedWeekFocusRef.current = true;

    if (isWeekFocusFetchingRef.current) {
      hasQueuedWeekFocusRef.current = true;
      return;
    }

    isWeekFocusFetchingRef.current = true;
    const owner = ownerRef.current;
    if (isMountedRef.current) {
      setIsWeekFocusLoading(true);
      setHasWeekFocusError(false);
    }

    try {
      const next = await fetchMyRankWeekFocus(todayKeyRef.current);
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      setWeekFocus(next);
    } catch {
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      setHasWeekFocusError(true);
    } finally {
      if (owner === ownerRef.current) {
        isWeekFocusFetchingRef.current = false;
        if (isMountedRef.current) setIsWeekFocusLoading(false);

        if (hasQueuedWeekFocusRef.current) {
          hasQueuedWeekFocusRef.current = false;
          void loadWeekFocus();
        }
      }
    }
  }, [userId]);

  useEffect(() => {
    loadWeekFocusRef.current = () => {
      void loadWeekFocus();
    };
  }, [loadWeekFocus]);

  /**
   * Depodaki "gösterildi" kaydını okur ve bellek içi kopyayı tazeler.
   *
   * Bozuk JSON `undefined` döner; çağıran bunu "baseline yok" olarak yorumlar
   * ve mevcut açılmış rozetleri güvenli baseline yazar. Depo hatası yutulur.
   */
  const readCelebratedAchievements = useCallback(
    async (ownerId: string, seasonIndex: number) => {
      const cached = celebratedAchievementsRef.current;
      if (cached && cached.userId === ownerId && cached.seasonIndex === seasonIndex) {
        return cached.keys;
      }

      const raw = await AsyncStorage.getItem(
        seasonAchievementCelebrationStorageKey(ownerId, seasonIndex),
      ).catch(() => null);

      return parseCelebratedAchievementKeys(raw);
    },
    [],
  );

  /**
   * Yeni açılan rozetleri kutlama kuyruğuna alır.
   *
   * DEĞİŞMEZLER
   *  - İlk çalıştırmada kutlama ÜRETİLMEZ: mevcut rozetler baseline yazılır.
   *  - Kuyruk katalog sırasındadır; birden fazla rozet tek tek gösterilir.
   *  - Karar "gösterildi" DEĞİLDİR: kalıcı kayıt yalnızca overlay gerçekten
   *    render/layout olduğunda ilerler (`acknowledgeAchievementCelebrationShown`).
   *  - Hesap veya sezon arada değişirse geç gelen cevap YENİ duruma yazamaz.
   */
  const reconcileAchievementCelebrations = useCallback(
    async (ownerId: string, seasonIndex: number, unlockedKeys: string[], owner: number) => {
      if (owner !== ownerRef.current) return;

      const stored = await readCelebratedAchievements(ownerId, seasonIndex);
      if (!isMountedRef.current || owner !== ownerRef.current) return;

      const decision = decideAchievementCelebrations({ celebrated: stored, unlockedKeys });

      // Baseline henüz yoksa sessizce yazılır; eski rozetler kutlanmaz.
      if (decision.type === 'seed') {
        await AsyncStorage.setItem(
          seasonAchievementCelebrationStorageKey(ownerId, seasonIndex),
          serializeCelebratedAchievementKeys(decision.celebrated),
        ).catch(() => undefined);
      }

      if (!isMountedRef.current || owner !== ownerRef.current) return;
      celebratedAchievementsRef.current = {
        keys: decision.celebrated,
        seasonIndex,
        userId: ownerId,
      };

      // Aynı kuyruk tekrar yazılmaz: gereksiz render ve sıfırlama olmaz.
      const next = decision.queue;
      const current = achievementQueueRef.current;
      const isSame =
        current.length === next.length && current.every((key, index) => key === next[index]);
      if (isSame) return;

      achievementQueueRef.current = next;
      setAchievementQueue(next);
    },
    [readCelebratedAchievements],
  );

  /**
   * Vitrin seçimi — güncel sezon.
   *
   * Diğer yüklemelerle AYNI kurallar: tek uçuş, latest-wins kuyruğu ve hesap
   * sahipliği. Hata YALNIZCA seçim durumunu etkiler; profil ve rank akışları
   * çalışmaya devam eder ve vitrin otomatik moda düşer.
   */
  const loadShowcaseSelection = useCallback(async () => {
    if (!userId) return;

    if (isShowcaseSelectionFetchingRef.current) {
      hasQueuedShowcaseSelectionRef.current = true;
      return;
    }

    isShowcaseSelectionFetchingRef.current = true;
    const owner = ownerRef.current;
    if (isMountedRef.current) {
      setIsShowcaseSelectionLoading(true);
      setHasShowcaseSelectionError(false);
    }

    try {
      const next = await fetchMyShowcaseSelection();
      if (!isMountedRef.current || owner !== ownerRef.current) return;

      /**
       * SEZON SAHİPLİĞİ — cevabın ait olduğu sezon, İSTEMCİNİN ŞU ANKİ
       * sezonuyla eşleşmiyorsa hiçbir şey yazılmaz.
       *
       * Aksi hâlde sezon geçişi sırasında uçuşta olan ESKİ sezon cevabı yeni
       * sezonun state'ine düşer, `loadedShowcaseSelectionRef` yanlışlıkla
       * yeni sezonla işaretlenir ve yeni sezon eski sezonun özel seçimini
       * kullanmaya başlardı.
       */
      if (!next || next.seasonIndex !== seasonRef.current?.seasonIndex) return;

      setShowcaseSelectionResult(next);
      // Bu (kullanıcı, sezon) için seçim okundu; gereksiz tekrar istenmez.
      loadedShowcaseSelectionRef.current = `${userId}:${next.seasonIndex}`;
    } catch {
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      setHasShowcaseSelectionError(true);
    } finally {
      if (owner === ownerRef.current) {
        isShowcaseSelectionFetchingRef.current = false;
        if (isMountedRef.current) setIsShowcaseSelectionLoading(false);

        if (hasQueuedShowcaseSelectionRef.current) {
          hasQueuedShowcaseSelectionRef.current = false;
          void loadShowcaseSelection();
        }
      }
    }
  }, [userId]);

  /**
   * Seçimi kaydeder.
   *
   * Kalıcı state YALNIZCA sunucu kaydı BAŞARILI olduğunda güncellenir; hata
   * yukarı fırlatılır ve önceki geçerli seçim olduğu gibi kalır. Optimistic
   * yazma YOKTUR. Sunucu kaydedilen son hâli döndürdüğü için ikinci bir okuma
   * sorgusu yapılmaz.
   */
  const saveShowcaseSelection = useCallback(
    async (
      keys: readonly SeasonAchievementKey[],
    ): Promise<SeasonShowcaseSelectionSaveResult> => {
      if (!userId) return { status: 'unavailable' };
      const owner = ownerRef.current;

      const next = await saveMyShowcaseSelection(keys);

      // Hesap arada değiştiyse eski cevap yeni hesabın state'ine YAZAMAZ.
      if (owner !== ownerRef.current) return { status: 'account-changed' };
      if (!isMountedRef.current) return { status: 'unavailable' };

      // Okunamayan cevap (oturum yok / bozuk yanıt) state'e YAZILMAZ.
      if (!next) return { status: 'unavailable' };

      /**
       * Kaydetme sırasında sezon değiştiyse bu cevap ARTIK GEÇERSİZDİR: yeni
       * sezonun state'ine yazılmaz ve yeni sezonun seçimi baştan yüklenir.
       *
       * `loadedShowcaseSelectionRef` YALNIZCA temizlenir; eski sezon kimliğiyle
       * DAMGALANMAZ, aksi hâlde yeni sezon için okuma bir daha istenmezdi.
       * Çağırana başarısızlık bildirilir: seçim güncel sezona uygulanmamıştır,
       * ekran kapanmamalı ve taslak korunmalıdır.
       */
      if (next.seasonIndex !== seasonRef.current?.seasonIndex) {
        loadedShowcaseSelectionRef.current = undefined;
        void loadShowcaseSelection();
        return { status: 'season-changed' };
      }

      setShowcaseSelectionResult(next);
      setHasShowcaseSelectionError(false);
      loadedShowcaseSelectionRef.current = `${userId}:${next.seasonIndex}`;
      return {
        keys: next.isCustom ? next.keys : [],
        seasonIndex: next.seasonIndex,
        status: 'applied',
      };
    },
    [loadShowcaseSelection, userId],
  );

  /**
   * Sezon başarıları.
   *
   * Haftalık odakla AYNI tek-uçuş / latest-wins / hesap sahipliği kurallarını
   * uygular: A hesabının geç gelen cevabı B'nin state'ine yazamaz, uçuş
   * sürerken ikinci istek başlamaz ama not düşülür. Hata YALNIZCA bu bölümde
   * gösterilir; rank ekranının geri kalanını ve antrenman akışlarını hiçbir
   * koşulda engellemez.
   */
  const loadAchievements = useCallback(async () => {
    if (!userId) return;
    hasRequestedAchievementsRef.current = true;

    if (isAchievementsFetchingRef.current) {
      hasQueuedAchievementsRef.current = true;
      return;
    }

    isAchievementsFetchingRef.current = true;
    const owner = ownerRef.current;
    if (isMountedRef.current) {
      setIsAchievementsLoading(true);
      setHasAchievementsError(false);
    }

    try {
      const next = await syncMySeasonAchievements(todayKeyRef.current);
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      setAchievements(next);

      /**
       * KUTLAMA UZLAŞTIRMASI YALNIZCA BURADAN — BAŞARILI RPC SONUCUNDAN —
       * TETİKLENİR.
       *
       * Daha önce bu iş `achievements` state'ini dinleyen bir effect'teydi ve
       * o state BAŞLANGIÇTA `[]` olduğu için sezon önce hazır olduğunda henüz
       * yüklenmemiş boş dizi baseline yazılabiliyordu. Sonraki gerçek cevap
       * geldiğinde saklanan baseline boş olduğu için GEÇMİŞ ROZETLERİN TAMAMI
       * yeni kazanılmış sanılıp kutlanıyordu.
       *
       * Artık gate açık: uzlaştırma yalnızca `next` — yani bu kullanıcı ve bu
       * sezon için gerçekten dönmüş bir RPC sonucu — ile çalışır. Başlangıç
       * `[]`'i, hata sonrası `[]` ve cevap öncesi `[]` baseline ÜRETEMEZ.
       *
       * Sezon kimliği cevabın geldiği ANDA okunur; henüz bilinmiyorsa
       * uzlaştırma atlanır ve bir sonraki başarılı rank sync'i (o da
       * `loadAchievements`i tetikler) işi tamamlar.
       */
      const seasonIndex = seasonRef.current?.seasonIndex;
      if (seasonIndex === undefined) return;

      const unlockedKeys = next
        .filter((achievement) => achievement.isUnlocked)
        .map((achievement) => achievement.key);

      // Zincir: iki cevap aynı anda depo okuyup yazamaz.
      achievementCelebrationChainRef.current = achievementCelebrationChainRef.current
        .then(() => reconcileAchievementCelebrations(userId, seasonIndex, unlockedKeys, owner))
        .catch(() => undefined);

      /**
       * Vitrin seçimi (kullanıcı, sezon) başına BİR KEZ okunur. Sezon
       * değişince anahtar değişir ve yeni sezon otomatik modda başlar; polling
       * KURULMAZ.
       */
      if (loadedShowcaseSelectionRef.current !== `${userId}:${seasonIndex}`) {
        void loadShowcaseSelection();
      }
    } catch {
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      setHasAchievementsError(true);
    } finally {
      if (owner === ownerRef.current) {
        isAchievementsFetchingRef.current = false;
        if (isMountedRef.current) setIsAchievementsLoading(false);

        if (hasQueuedAchievementsRef.current) {
          hasQueuedAchievementsRef.current = false;
          void loadAchievements();
        }
      }
    }
  }, [loadShowcaseSelection, reconcileAchievementCelebrations, userId]);

  useEffect(() => {
    loadAchievementsRef.current = () => {
      void loadAchievements();
    };
  }, [loadAchievements]);

  // -------------------------------------------------------------------------
  // Başarı açılma kutlaması — baseline, kuyruk, gösterim onayı
  // -------------------------------------------------------------------------


  /**
   * Kutlamanın GÖSTERİM ONAYI.
   *
   * Kalıcı kaydı ilerleten TEK yol budur ve yalnızca kart gerçekten
   * render/layout olduğunda çağrılır — "Devam" düğmesi BEKLENMEZ. Böylece
   * kullanıcı kutlamayı görmeden uygulamayı kapatırsa rozet sonraki açılışta
   * tekrar çıkar; bir kez görünmeye başladıysa tekrar oynatılmaz.
   *
   * State'i KAPATMAZ; kapatma `dismissAchievementCelebration` işidir.
   * Aynı kutlamanın ikinci onayı yeni yazma üretmez.
   */
  const acknowledgeAchievementCelebrationShown = useCallback(
    async (key: SeasonAchievementKey) => {
      const ownerId = userId;
      const seasonIndex = seasonRef.current?.seasonIndex;
      if (!ownerId || seasonIndex === undefined) return;
      // Kimlik kontrolü: yalnızca kuyruğun başındaki kutlama onaylanabilir.
      if (achievementQueueRef.current[0] !== key) return;

      const owner = ownerRef.current;
      achievementCelebrationChainRef.current = achievementCelebrationChainRef.current
        .then(async () => {
          const cached = celebratedAchievementsRef.current;
          const existing =
            cached && cached.userId === ownerId && cached.seasonIndex === seasonIndex
              ? cached.keys
              : ((await readCelebratedAchievements(ownerId, seasonIndex)) ?? []);

          // Zaten yazılmışsa ikinci yazma yapılmaz.
          if (existing.includes(key)) return;

          const nextKeys = [...existing, key];
          await AsyncStorage.setItem(
            seasonAchievementCelebrationStorageKey(ownerId, seasonIndex),
            serializeCelebratedAchievementKeys(nextKeys),
          ).catch(() => undefined);

          // Bellek içi kopya YALNIZCA hâlâ güncel hesap için tazelenir.
          if (owner !== ownerRef.current) return;
          celebratedAchievementsRef.current = { keys: nextKeys, seasonIndex, userId: ownerId };
        })
        .catch(() => undefined);

      await achievementCelebrationChainRef.current;
    },
    [readCelebratedAchievements, userId],
  );

  /** Kutlama kapandı: kuyruktan düşer, sıradaki rozet yüzeye çıkar. */
  const dismissAchievementCelebration = useCallback((key: SeasonAchievementKey) => {
    const next = achievementQueueRef.current.filter((queued) => queued !== key);
    if (next.length === achievementQueueRef.current.length) return;
    achievementQueueRef.current = next;
    setAchievementQueue(next);
  }, []);

  // -------------------------------------------------------------------------
  // Katman sahipliği — aynı anda tek overlay
  // -------------------------------------------------------------------------

  const claimRankOverlay = useCallback((owner: RankOverlayOwner) => {
    if (!canClaimRankOverlay(activeOverlayRef.current, owner)) return false;
    // Senkron yazma: aynı karede ikinci bir katman claim edemez.
    activeOverlayRef.current = owner;
    setActiveOverlay(owner);
    return true;
  }, []);

  const releaseRankOverlay = useCallback((owner: RankOverlayOwner) => {
    // Yalnızca sahibi bırakabilir; başka katmanın kilidi düşürülemez.
    if (activeOverlayRef.current !== owner) return;
    activeOverlayRef.current = undefined;
    setActiveOverlay(undefined);
  }, []);

  /**
   * Kutlamanın GÖSTERİM ONAYI.
   *
   * Kalıcı kaydı ilerleten TEK yol budur ve yalnızca kutlama güvenli bir
   * ekranda gerçekten görünmeye başladığında çağrılır — "Devam" düğmesi
   * beklenmez. Böylece:
   *   * kullanıcı kutlamayı görmeden uygulamayı kapatırsa sonraki açılışta
   *     kutlama yeniden oluşturulur,
   *   * kutlama bir kez görünmeye başladıysa uygulama kapatılıp açılsa bile
   *     tekrar oynatılmaz.
   *
   * State'i KAPATMAZ; kapatma `dismissRankUp` sorumluluğunda kalır.
   *
   * Sahiplik üç kapıyla doğrulanır: kimlik hâlâ bekleyen kutlamaya ait olmalı
   * (hesap değişiminde `rankUpRef` temizlenir), oturumda bir kullanıcı olmalı
   * ve kutlama güncel sezona ait olmalı. Depo hatası yutulur: kutlama, sonraki
   * ekran veya navigasyon hiçbir koşulda bundan etkilenmez.
   */
  const acknowledgeRankUpShown = useCallback(
    async (celebrationId: number) => {
      if (!userId) return;

      const celebration = rankUpRef.current;
      if (!celebration || celebration.id !== celebrationId) return;
      // Aynı kutlama için ikinci bir yazma yapılmaz.
      if (acknowledgedCelebrationIdRef.current === celebrationId) return;
      if (seasonRef.current?.seasonIndex !== celebration.seasonIndex) return;

      acknowledgedCelebrationIdRef.current = celebrationId;

      await AsyncStorage.setItem(
        rankCelebrationStorageKey(userId, celebration.seasonIndex),
        celebration.toRank,
      ).catch(() => undefined);
    },
    [userId],
  );

  const dismissRankUp = useCallback((celebrationId: number) => {
    if (rankUpRef.current?.id === celebrationId) rankUpRef.current = undefined;
    setRankUp((current) => (current && current.id !== celebrationId ? current : undefined));
  }, []);

  /**
   * SEZON SONU ÖZETİ — gösterim kararı.
   *
   * Rank yükselme akışından TAMAMEN ayrıdır: kendi AsyncStorage anahtarını,
   * kendi zincirini ve kendi onayını kullanır; ikisi birbirinin kaydını
   * okumaz veya bozamaz.
   *
   * Özet YALNIZCA şu koşullarda oluşur:
   *   * oturumda bir kullanıcı var,
   *   * güncel sezon sunucudan yüklendi ve ilk sezon DEĞİL,
   *   * arşiv başarıyla okundu,
   *   * en yeni kapanmış sezon güncel sezonun HEMEN ÖNCEKİSİ,
   *   * sunucu verisi tutarlı (`decideSeasonRecap`),
   *   * bu özet daha önce gerçekten gösterilmemiş.
   *
   * Karar "gösterildi" anlamına GELMEZ; kalıcı kayıt yalnızca overlay ekranda
   * görünmeye başladığında `acknowledgeSeasonRecapShown` ile yazılır. Böylece
   * kullanıcı özeti görmeden uygulamayı kapatırsa özet kaybolmaz.
   */
  const resolveSeasonRecap = useCallback(
    async (
      ownerId: string,
      snapshot: RankSeasonSummary,
      archives: RankSeasonArchive[],
      owner: number,
    ) => {
      if (owner !== ownerRef.current) return;
      // İlk sezonda gösterilecek kapanmış sezon yoktur.
      if (snapshot.seasonIndex < 2) return;

      const closedSeasonIndex = snapshot.seasonIndex - 1;
      const recapKey = `${ownerId}:${closedSeasonIndex}`;

      // Bu özet için karar zaten verildi (gösterildi ya da uygun değil).
      if (resolvedRecapRef.current === recapKey) return;
      // Aynı özet zaten bekliyor: ikinci bir overlay ÜRETİLMEZ.
      if (seasonRecapRef.current?.archive.seasonIndex === closedSeasonIndex) return;

      const stored = await AsyncStorage.getItem(
        seasonRecapStorageKey(ownerId, closedSeasonIndex),
      ).catch(() => null);
      if (!isMountedRef.current || owner !== ownerRef.current) return;

      if (stored !== null) {
        resolvedRecapRef.current = recapKey;
        return;
      }

      const plan = hasLoadedHistoryRef.current
        ? decideSeasonRecap({
            archives,
            currentSeasonIndex: snapshot.seasonIndex,
            startingRp: snapshot.startingRp,
          })
        : undefined;

      if (!plan) {
        /**
         * Arşiv hiç okunmamış, OKUNAMAMIŞ ya da bu sezon başlamadan önce
         * okunmuş olabilir. Sezon başına BİR KEZ istenir; polling veya
         * otomatik yeniden deneme YOKTUR.
         */
        const requestKey = `${ownerId}:${snapshot.seasonIndex}`;
        const attempts =
          recapHistoryAttemptsRef.current?.key === requestKey
            ? recapHistoryAttemptsRef.current.count
            : 0;

        if (
          requestedRecapHistoryRef.current !== requestKey &&
          attempts < RECAP_HISTORY_MAX_ATTEMPTS
        ) {
          requestedRecapHistoryRef.current = requestKey;
          recapHistoryAttemptsRef.current = { count: attempts + 1, key: requestKey };
          await loadHistory();

          /**
           * İstek BAŞARISIZSA guard geri açılır: karar "özet yok" diye
           * kapatılmaz ve bir sonraki DOĞAL tetikleyici (rank sync, AppState
           * dönüşü, rank ekranından gelen başarılı yükleme) yeniden
           * deneyebilir. Guard'ın hâlâ bu isteğe ait olduğu doğrulanır, aksi
           * hâlde arada değişen hesabın guard'ı silinirdi.
           *
           * Başarılıysa hiçbir şey yapılmaz: `history` değiştiği için bu akış
           * kendiliğinden yeniden çalışır.
           */
          if (
            !hasLoadedHistoryRef.current &&
            owner === ownerRef.current &&
            requestedRecapHistoryRef.current === requestKey
          ) {
            requestedRecapHistoryRef.current = undefined;
          }
          return;
        }

        /**
         * Karar ANCAK arşiv gerçekten okunduysa kapatılır. Aksi hâlde tek bir
         * ağ hatası sezon özetini bütün oturum boyunca yutardı: deneme hakkı
         * bitse bile karar açık kalır ve rank ekranından gelen başarılı bir
         * yükleme özeti açabilir.
         */
        if (hasLoadedHistoryRef.current) resolvedRecapRef.current = recapKey;
        return;
      }

      const archive = archives.find((row) => row.seasonIndex === plan.closedSeasonIndex);
      if (!archive) {
        resolvedRecapRef.current = recapKey;
        return;
      }

      // Hesap arada değiştiyse yeni hesabın durumuna HİÇBİR ŞEY yazılmaz.
      if (!isMountedRef.current || owner !== ownerRef.current) return;

      const next: SeasonRecap = {
        archive,
        nextSeasonIndex: plan.nextSeasonIndex,
        planCompletionPercent: plan.planCompletionPercent,
        startingRp: snapshot.startingRp,
      };
      seasonRecapRef.current = next;
      setSeasonRecap(next);
    },
    [loadHistory],
  );

  useEffect(() => {
    if (!userId || !season) return;
    const owner = ownerRef.current;
    // Zincir: iki cevap aynı anda depo okuyup yazamaz.
    recapChainRef.current = recapChainRef.current
      .then(() => resolveSeasonRecap(userId, season, history, owner))
      .catch(() => undefined);
  }, [history, resolveSeasonRecap, season, userId]);

  /**
   * Sezon özetinin GÖSTERİM ONAYI.
   *
   * Kalıcı kaydı yazan TEK yol budur ve yalnızca overlay güvenli bir ekranda
   * gerçekten görünmeye başladığında çağrılır — düğme beklenmez. State'i
   * KAPATMAZ; kapatma `dismissSeasonRecap` sorumluluğundadır.
   *
   * Sahiplik üç kapıyla doğrulanır: kapanmış sezon kimliği hâlâ bekleyen
   * özete ait olmalı (hesap değişiminde `seasonRecapRef` temizlenir), oturumda
   * bir kullanıcı olmalı ve özet güncel sezona ait olmalı. Depo hatası yutulur.
   */
  const acknowledgeSeasonRecapShown = useCallback(
    async (closedSeasonIndex: number) => {
      if (!userId) return;

      const recap = seasonRecapRef.current;
      if (!recap || recap.archive.seasonIndex !== closedSeasonIndex) return;
      if (seasonRef.current?.seasonIndex !== recap.nextSeasonIndex) return;

      const recapKey = `${userId}:${closedSeasonIndex}`;
      // Aynı özet için ikinci bir yazma yapılmaz.
      if (acknowledgedRecapRef.current === recapKey) return;
      acknowledgedRecapRef.current = recapKey;
      resolvedRecapRef.current = recapKey;

      await AsyncStorage.setItem(
        seasonRecapStorageKey(userId, closedSeasonIndex),
        String(closedSeasonIndex),
      ).catch(() => undefined);
    },
    [userId],
  );

  const dismissSeasonRecap = useCallback((closedSeasonIndex: number) => {
    if (seasonRecapRef.current?.archive.seasonIndex === closedSeasonIndex) {
      seasonRecapRef.current = undefined;
    }
    setSeasonRecap((current) =>
      current && current.archive.seasonIndex !== closedSeasonIndex ? current : undefined,
    );
  }, []);

  /**
   * Rank yükselme kararı — sunucudan yeni bir sezon özeti geldiğinde.
   *
   * AsyncStorage burada YALNIZCA "hangi rank zaten kutlandı" bilgisini tutar;
   * RP veya rank HESAPLAMAZ. Kalıcı kayıt kutlama ekranda gerçekten
   * gösterilmeye başlayana kadar İLERLETİLMEZ (bkz. `acknowledgeRankUpShown`).
   */
  const reconcileCelebration = useCallback(
    async (ownerId: string, snapshot: RankSeasonSummary, owner: number) => {
      if (owner !== ownerRef.current) return;

      const storageKey = rankCelebrationStorageKey(ownerId, snapshot.seasonIndex);
      let baseline = baselineRef.current;

      // Bellek içi kopya bu hesaba ve bu sezona ait değilse depo okunur.
      if (
        !baseline ||
        baseline.userId !== ownerId ||
        baseline.seasonIndex !== snapshot.seasonIndex
      ) {
        const stored = await AsyncStorage.getItem(storageKey).catch(() => null);
        if (!isMountedRef.current || owner !== ownerRef.current) return;

        const storedRank = parseStoredRank(stored);
        baseline = storedRank
          ? { rank: storedRank, seasonIndex: snapshot.seasonIndex, userId: ownerId }
          : undefined;
      }

      const decision = decideRankCelebration({
        baseline: baseline ? { rank: baseline.rank, seasonIndex: baseline.seasonIndex } : undefined,
        order: RANK_IDS,
        pendingFromRank:
          rankUpRef.current?.seasonIndex === snapshot.seasonIndex
            ? rankUpRef.current.fromRank
            : undefined,
        season: { currentRank: snapshot.currentRank, seasonIndex: snapshot.seasonIndex },
      });

      if (decision.type === 'idle') return;

      /**
       * KAYIT ZAMANLAMASI — kutlamanın kaybolmaması bu ayrıma bağlıdır.
       *
       *   * `seed` (ilk yükleme / yeni sezon) ve `settle` (düşüş) kutlama
       *     ÜRETMEZ, dolayısıyla kayıtları hemen yazılabilir. Depo yazması
       *     sahiplik kontrolünden önce yapılır ve bilinçlidir: anahtar
       *     `ownerId` ile isimlendirildiği için bu kayıt her hâlükârda o
       *     hesabın doğru onayıdır.
       *   * `celebrate` kararında BURADA HİÇBİR ŞEY YAZILMAZ. Kutlama henüz
       *     ekranda gösterilmedi; kullanıcı aktif antrenmandayken bekliyor
       *     olabilir. Kayıt erken yazılsaydı, kullanıcı kutlamayı görmeden
       *     uygulamayı kapattığında yükseliş kalıcı olarak kaybolurdu. Onay
       *     yalnızca gösterim gerçekten başladığında `acknowledgeRankUpShown`
       *     ile yazılır.
       */
      if (decision.type !== 'celebrate') {
        await AsyncStorage.setItem(storageKey, decision.baseline.rank).catch(() => undefined);

        // Yeni sezona geçildiğinde bir önceki sezonun kaydı gereksizdir.
        if (decision.type === 'seed' && snapshot.seasonIndex > 1) {
          await AsyncStorage.removeItem(
            rankCelebrationStorageKey(ownerId, snapshot.seasonIndex - 1),
          ).catch(() => undefined);
        }
      }

      // Bellek içi kopya ve kutlama YALNIZCA hâlâ güncel hesaba yazılır:
      // A'nın geç gelen cevabı B'nin durumuna karışamaz.
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      /**
       * Bellek içi referans `celebrate` kararında da ilerler: aynı oturumdaki
       * tekrar sync'ler ikinci bir bekleyen kutlama üretmez. Kalıcı kayıt
       * ilerlemediği için soğuk açılışta kutlama yeniden oluşturulabilir.
       */
      baselineRef.current = { ...decision.baseline, userId: ownerId };

      if (decision.type !== 'celebrate') return;

      celebrationIdRef.current += 1;
      const next: RankUpCelebration = {
        fromRank: decision.fromRank,
        id: celebrationIdRef.current,
        rp: snapshot.currentRp,
        seasonIndex: snapshot.seasonIndex,
        toRank: decision.toRank,
      };
      rankUpRef.current = next;
      setRankUp(next);
    },
    [],
  );

  useEffect(() => {
    if (!userId || !season) return;
    const owner = ownerRef.current;
    // Zincir: iki sezon cevabı aynı anda depo okuyup yazamaz.
    celebrationChainRef.current = celebrationChainRef.current
      .then(() => reconcileCelebration(userId, season, owner))
      .catch(() => undefined);
  }, [reconcileCelebration, season, userId]);

  // Hesap değişimi: sahiplik artar, bütün durum sıfırlanır.
  useEffect(() => {
    ownerRef.current += 1;
    isSyncingRef.current = false;
    hasQueuedSyncRef.current = false;
    isEventsFetchingRef.current = false;
    hasQueuedEventsRef.current = false;
    hasRequestedEventsRef.current = false;
    isWeekFocusFetchingRef.current = false;
    hasQueuedWeekFocusRef.current = false;
    hasRequestedWeekFocusRef.current = false;
    isAchievementsFetchingRef.current = false;
    hasQueuedAchievementsRef.current = false;
    hasRequestedAchievementsRef.current = false;
    loadedShowcaseSelectionRef.current = undefined;
    isShowcaseSelectionFetchingRef.current = false;
    hasQueuedShowcaseSelectionRef.current = false;
    celebratedAchievementsRef.current = undefined;
    achievementQueueRef.current = [];
    achievementCelebrationChainRef.current = Promise.resolve();
    // Kilit hiçbir koşulda hesap değişiminde asılı kalmaz.
    activeOverlayRef.current = undefined;
    baselineRef.current = undefined;
    rankUpRef.current = undefined;
    seasonRef.current = undefined;
    acknowledgedCelebrationIdRef.current = 0;
    celebrationChainRef.current = Promise.resolve();
    hasLoadedHistoryRef.current = false;
    seasonRecapRef.current = undefined;
    resolvedRecapRef.current = undefined;
    requestedRecapHistoryRef.current = undefined;
    recapHistoryAttemptsRef.current = undefined;
    acknowledgedRecapRef.current = undefined;
    recapChainRef.current = Promise.resolve();
    setSeason(undefined);
    setHistory([]);
    setEvents([]);
    setWeekFocus(undefined);
    setHasWeekFocusError(false);
    setIsWeekFocusLoading(false);
    setAchievements([]);
    setHasAchievementsError(false);
    setIsAchievementsLoading(false);
    setAchievementQueue([]);
    setShowcaseSelectionResult(undefined);
    setHasShowcaseSelectionError(false);
    setIsShowcaseSelectionLoading(false);
    setActiveOverlay(undefined);
    setRankUp(undefined);
    setSeasonRecap(undefined);
    setIsRankLoading(Boolean(userId));
    setHasRankError(false);
  }, [userId]);

  /**
   * Sync tetikleyicileri: (a) hesap veya yerel gün değişimi, (b) uygulamanın
   * yeniden `active` olması.
   *
   * Interval veya polling KURULMAZ. (b) bilinçlidir: aynı gün içindeki ilk
   * istek ağ hatası alırsa `todayKey` değişmediği için (a) bir daha
   * tetiklenmezdi ve sezon geçişi o gün tamamlanmadan kalırdı.
   */
  useEffect(() => {
    if (!userId) return;

    void runSync();

    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void runSync();
    });

    return () => subscription.remove();
  }, [runSync, todayKey, userId]);

  /**
   * GÜNCEL sezonun cevabı elimizde mi?
   *
   * Cevabın sezonu istemcinin şu anki sezonuyla eşleşmiyorsa (sezon yeni
   * geçmiş, yeni cevap henüz gelmemiş) seçim HAZIR SAYILMAZ: vitrin yükleniyor
   * kalır ve eski sezonun seçimi yeni sezona uygulanmaz.
   */
  const showcaseSelectionSeasonIndex = showcaseSelectionResult?.seasonIndex;
  const isShowcaseSelectionReady =
    showcaseSelectionResult !== undefined &&
    season?.seasonIndex !== undefined &&
    showcaseSelectionResult.seasonIndex === season.seasonIndex;

  /** Özel seçim anahtarları — YALNIZCA hazır ve özel modda dolu. */
  const showcaseSelection = useMemo<SeasonShowcaseSelection>(
    () =>
      isShowcaseSelectionReady && showcaseSelectionResult?.isCustom
        ? showcaseSelectionResult.keys
        : [],
    [isShowcaseSelectionReady, showcaseSelectionResult],
  );

  /**
   * PROFİLDE GÖSTERİLECEK ROZETLER — sırası hazır.
   *
   * Özel seçim varsa seçim SIRASI korunur; seçilen bir rozet artık açık
   * değilse (beklenmez) sessizce düşer, uydurma rozet gösterilmez. Seçim
   * yoksa mevcut "en son kazanılan üç rozet" davranışı aynen sürer.
   *
   * İstemci burada hiçbir başarı koşulu HESAPLAMAZ; yalnızca sunucudan gelen
   * `isUnlocked` / `unlockedAt` alanlarını kullanır.
   */
  const profileShowcaseEntries = useMemo<SeasonAchievementShowcaseEntry[]>(() => {
    const unlocked = achievements.filter((achievement) => achievement.isUnlocked);

    if (showcaseSelection.length === 0) {
      return unlocked.map((achievement) => ({
        key: achievement.key,
        unlockedAt: achievement.unlockedAt,
      }));
    }

    return showcaseSelection
      .map((key) => unlocked.find((achievement) => achievement.key === key))
      .filter((achievement): achievement is SeasonAchievement => achievement !== undefined)
      .map((achievement) => ({ key: achievement.key, unlockedAt: achievement.unlockedAt }));
  }, [achievements, showcaseSelection]);

  const value = useMemo<RankContextValue>(
    () => ({
      acknowledgeRankUpShown,
      achievementCelebration: achievementQueue[0],
      achievements,
      acknowledgeAchievementCelebrationShown,
      activeRankOverlay,
      hasShowcaseSelectionError,
      isShowcaseSelectionCustom: showcaseSelection.length > 0,
      isShowcaseSelectionLoading,
      isShowcaseSelectionReady,
      loadShowcaseSelection,
      profileShowcaseEntries,
      saveShowcaseSelection,
      showcaseSelection,
      showcaseSelectionSeasonIndex,
      acknowledgeSeasonRecapShown,
      claimRankOverlay,
      dismissAchievementCelebration,
      dismissRankUp,
      dismissSeasonRecap,
      events,
      history,
      hasAchievementsError,
      hasWeekFocusError,
      isAchievementsLoading,
      isEventsLoading,
      isHistoryLoading,
      isRankLoading,
      hasRankError,
      isWeekFocusLoading,
      loadAchievements,
      loadEvents,
      loadHistory,
      loadWeekFocus,
      releaseRankOverlay,
      rankUp,
      season,
      seasonRecap,
      syncRank,
      weekFocus,
    }),
    [
      acknowledgeRankUpShown,
      achievementQueue,
      achievements,
      acknowledgeAchievementCelebrationShown,
      activeRankOverlay,
      hasShowcaseSelectionError,
      isShowcaseSelectionLoading,
      isShowcaseSelectionReady,
      loadShowcaseSelection,
      profileShowcaseEntries,
      saveShowcaseSelection,
      showcaseSelection,
      showcaseSelectionSeasonIndex,
      acknowledgeSeasonRecapShown,
      claimRankOverlay,
      dismissAchievementCelebration,
      dismissRankUp,
      dismissSeasonRecap,
      events,
      history,
      hasAchievementsError,
      hasWeekFocusError,
      isAchievementsLoading,
      isEventsLoading,
      isHistoryLoading,
      isRankLoading,
      hasRankError,
      isWeekFocusLoading,
      loadAchievements,
      loadEvents,
      loadHistory,
      loadWeekFocus,
      releaseRankOverlay,
      rankUp,
      season,
      seasonRecap,
      syncRank,
      weekFocus,
    ],
  );

  return <RankContext.Provider value={value}>{children}</RankContext.Provider>;
}

export function useRanks() {
  const context = useContext(RankContext);
  if (!context) throw new Error('useRanks, RankProvider içinde kullanılmalıdır.');
  return context;
}

/**
 * Sağlayıcı yokken de güvenle çağrılabilen sürüm.
 *
 * `WorkoutProvider` rank sağlayıcısının içinde mount edilir, ama antrenman
 * akışının rank olmadan da çalışabilmesi gerekir: rank yalnızca bir göstergedir
 * ve hiçbir koşulda set kaydını, kronometreyi veya molayı engellememelidir.
 */
export function useOptionalRanks() {
  return useContext(RankContext);
}
