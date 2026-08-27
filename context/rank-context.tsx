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

import { useAuth } from '@/context/auth-context';
import { useLocalDateKey } from '@/hooks/use-shared-discipline-sync';
import { fetchMyRankHistory, syncMyRank } from '@/services/ranks';
import { RankSeasonArchive, RankSeasonSummary } from '@/types/ranks';

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
  /** Güvenli sync. Tekrar çağrılması zararsızdır. */
  syncRank: () => Promise<void>;
  loadHistory: () => Promise<void>;
};

const RankContext = createContext<RankContextValue | undefined>(undefined);

export function RankProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const userId = user?.id;
  /** Cihazın YEREL günü; gece yarısı ve ön plana dönüşte kendiliğinden değişir. */
  const todayKey = useLocalDateKey();

  const [season, setSeason] = useState<RankSeasonSummary>();
  const [isRankLoading, setIsRankLoading] = useState(false);
  const [history, setHistory] = useState<RankSeasonArchive[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const isMountedRef = useRef(true);
  /** Hesap sahipliği. Hesap değişince artar; eski cevap yeni state'e yazamaz. */
  const ownerRef = useRef(0);
  /** Senkron tek-uçuş kilidi. */
  const isSyncingRef = useRef(false);
  /** Uçuş sürerken gelen istek: bitince bir kez daha çalışılır. */
  const hasQueuedSyncRef = useRef(false);
  /** Yerel günün son senkronize edilmiş hâli; aynı gün için tekrar tetiklenmez. */
  const todayKeyRef = useRef(todayKey);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    todayKeyRef.current = todayKey;
  }, [todayKey]);

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

  // Hesap değişimi: sahiplik artar, bütün durum sıfırlanır.
  useEffect(() => {
    ownerRef.current += 1;
    isSyncingRef.current = false;
    hasQueuedSyncRef.current = false;
    setSeason(undefined);
    setHistory([]);
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
      history,
      isHistoryLoading,
      isRankLoading,
      loadHistory,
      season,
      syncRank,
    }),
    [history, isHistoryLoading, isRankLoading, loadHistory, season, syncRank],
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
