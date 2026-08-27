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
  decideRankCelebration,
  rankCelebrationStorageKey,
} from '@/constants/rank-experience';
import { RankId, RANK_IDS } from '@/constants/ranks';
import { useAuth } from '@/context/auth-context';
import { useLocalDateKey } from '@/hooks/use-shared-discipline-sync';
import { fetchMyRankEvents, fetchMyRankHistory, syncMyRank } from '@/services/ranks';
import {
  RankEvent,
  RankSeasonArchive,
  RankSeasonSummary,
  RankUpCelebration,
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
  /** Kapanmış sezon arşivi; yalnızca detay ekranı istediğinde yüklenir. */
  history: RankSeasonArchive[];
  isHistoryLoading: boolean;
  /** Son RP hareketleri; yalnızca rank ekranı istediğinde yüklenir. */
  events: RankEvent[];
  isEventsLoading: boolean;
  /** Gösterilmeyi bekleyen rank yükselmesi. Gösterilince temizlenir. */
  rankUp?: RankUpCelebration;
  /** Güvenli sync. Tekrar çağrılması zararsızdır. */
  syncRank: () => Promise<void>;
  loadHistory: () => Promise<void>;
  loadEvents: () => Promise<void>;
  /**
   * Kutlama ekranda GERÇEKTEN gösterilmeye başladı. Onay kaydı yalnızca
   * burada yazılır; kapanışı yönetmez.
   */
  acknowledgeRankUpShown: (celebrationId: number) => Promise<void>;
  /** Kutlama kapandı. Yalnızca aynı kimliğe sahip kutlamayı temizler. */
  dismissRankUp: (celebrationId: number) => void;
};

/** AsyncStorage'da tutulan onay kaydının bellek içi hâli. */
type CelebrationBaseline = {
  userId: string;
  seasonIndex: number;
  rank: RankId;
};

const RankContext = createContext<RankContextValue | undefined>(undefined);

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
  const [history, setHistory] = useState<RankSeasonArchive[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [events, setEvents] = useState<RankEvent[]>([]);
  const [isEventsLoading, setIsEventsLoading] = useState(false);
  const [rankUp, setRankUp] = useState<RankUpCelebration>();

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

  const runSync = useCallback(async () => {
    if (!userId) return;

    // Tek uçuş: devam eden istek varken ikincisi başlatılmaz, ama not düşülür.
    if (isSyncingRef.current) {
      hasQueuedSyncRef.current = true;
      return;
    }

    isSyncingRef.current = true;
    const owner = ownerRef.current;

    try {
      const next = await syncMyRank(todayKeyRef.current);
      // Hesap arada değiştiyse eski cevap hiçbir şeyi yazamaz.
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      if (next) setSeason(next);

      /**
       * RP geçmişi YALNIZCA daha önce istendiyse tazelenir. Kullanıcı rank
       * ekranını hiç açmadıysa arka planda tek bir ek istek bile atılmaz.
       */
      if (hasRequestedEventsRef.current) loadEventsRef.current();
    } catch {
      // Sessiz: rank okunamazsa ekran mevcut değerle çalışmaya devam eder ve
      // sonraki güvenli sync aynı olayları idempotent biçimde tamamlar.
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
    baselineRef.current = undefined;
    rankUpRef.current = undefined;
    seasonRef.current = undefined;
    acknowledgedCelebrationIdRef.current = 0;
    celebrationChainRef.current = Promise.resolve();
    setSeason(undefined);
    setHistory([]);
    setEvents([]);
    setRankUp(undefined);
    setIsRankLoading(Boolean(userId));
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

  const value = useMemo<RankContextValue>(
    () => ({
      acknowledgeRankUpShown,
      dismissRankUp,
      events,
      history,
      isEventsLoading,
      isHistoryLoading,
      isRankLoading,
      loadEvents,
      loadHistory,
      rankUp,
      season,
      syncRank,
    }),
    [
      acknowledgeRankUpShown,
      dismissRankUp,
      events,
      history,
      isEventsLoading,
      isHistoryLoading,
      isRankLoading,
      loadEvents,
      loadHistory,
      rankUp,
      season,
      syncRank,
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
