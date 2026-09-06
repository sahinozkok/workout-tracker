import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { RewardToastLayer } from '@/components/rewards/reward-toast';
import { useAuth } from '@/context/auth-context';
import { useLocalDateKey } from '@/hooks/use-shared-discipline-sync';
import {
  awardPetLove,
  claimDailyRewards,
  fetchMyLevelRose,
  fetchMyProgress,
  saveMyLevelRose,
  syncWorkoutRewards,
} from '@/services/rewards';
import { RewardResult, UserProgress } from '@/types/rewards';

/**
 * Seviye/XP/gül durumunun ve `+N XP` geri bildiriminin TEK kaynağı.
 *
 * Kurallar:
 *  - Toplamlar hiçbir zaman istemcide hesaplanmaz; her çağrının cevabındaki
 *    sunucu değerleri olduğu gibi yazılır. Optimistic/sahte puan gösterilmez.
 *  - Popup **yalnızca** sunucu gerçekten yeni ödül yazdığında (`awardedXp > 0`)
 *    gösterilir. "Zaten ödüllendirilmiş" cevabı sessizce yutulur.
 *  - Aynı kullanıcı hareketinden doğan birden çok ödül (set + gün + streak)
 *    kısa bir pencerede toplanır ve tek `+N XP` olarak gösterilir.
 *  - Hesap değişiminde bütün durum ve bekleyen popup temizlenir; önceki
 *    kullanıcının ilerlemesi yeni oturumda görünmez.
 */

const DEFAULT_PROGRESS: UserProgress = {
  level: 1,
  lifetimeXp: 0,
  roseBalance: 0,
  xpForNextLevel: 120,
  xpIntoLevel: 0,
};

/**
 * Birleştirme penceresi. Son set aynı anda set + gün + streak ödülü
 * doğurabilir; bu süre içinde gelen bütün ödüller tek yazıda toplanır.
 */
const REWARD_COALESCE_WINDOW = 700;

/** `setLevelRose` sonucu — sheet buna göre kaydı kapatır veya hata/retry gösterir. */
export type LevelRoseSaveStatus = 'saved' | 'error' | 'noop';

type RewardContextValue = {
  progress: UserProgress;
  isProgressLoading: boolean;
  /** Antrenman günü uzlaştırması (set + gün + streak). */
  syncWorkoutDay: (clientToday: string, targetDate: string) => Promise<void>;
  /** Günlük giriş + kapanmış hafta ödülleri. */
  claimDaily: (clientToday: string) => Promise<void>;
  /** Rosea okşama burst'ü. Sınır yoktur; anahtar retry'da değişmez. */
  awardPetBurst: (burstKey: string) => Promise<void>;
  refreshProgress: () => Promise<void>;
  /**
   * Kullanıcının SEÇTİĞİ seviye gülü kimliği (ham; `null` = otomatik mod → en
   * yüksek açık gül). Sunucudan gelir; yerelde hesaplanmaz.
   */
  selectedRoseId: string | null;
  /**
   * Seçim OKUMASININ ayrık durumu — arkadaş tarafıyla AYNI model:
   *   * `loading`     → tercih henüz sunucudan gelmedi (nötr yükleme gösterimi).
   *   * `unavailable` → okuma başarısız (RPC eksik / ağ / geçersiz yanıt). Bu
   *     durumda TAHMİNİ (otomatik) gül GÖSTERİLMEZ; başarılı bir `null`
   *     ("otomatik mod") ile okuma hatası BİRBİRİNE karışmaz.
   *   * `undefined`   → başarılı okuma (`ready`): `selectedRoseId` geçerlidir
   *     (`null` = gerçek otomatik tercih). Bileşenler bu değeri doğrudan
   *     `ProfileProgressSummary.levelRoseState` prop'una verir.
   */
  levelRoseState: 'loading' | 'unavailable' | undefined;
  /**
   * Seviye gülü seçimini kaydeder (`null` → otomatik). Doğrulama SUNUCUDADIR.
   * Başarısızlıkta önceki seçim KORUNUR ve `'error'` döner; sheet retry gösterir.
   * Aynı değer zaten seçiliyse `'noop'`.
   */
  setLevelRose: (roseId: string | null) => Promise<LevelRoseSaveStatus>;
};

const RewardContext = createContext<RewardContextValue | undefined>(undefined);

export function RewardProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const userId = user?.id;
  /**
   * Cihazın YEREL günü. Uygulama ön plana geldiğinde ve gece yarısı geçildiğinde
   * kendiliğinden değişir; başka bir zamanlayıcı veya polling kurulmaz.
   */
  const todayKey = useLocalDateKey();

  const [progress, setProgress] = useState<UserProgress>(DEFAULT_PROGRESS);
  const [isProgressLoading, setIsProgressLoading] = useState(true);
  /** Seçili seviye gülü (ham; null = otomatik). Sunucu otoritedir. */
  const [selectedRoseId, setSelectedRoseId] = useState<string | null>(null);
  /**
   * Seçim OKUMASININ durumu. `loading` → henüz gelmedi; `ready` → başarılı okuma
   * (selectedRoseId geçerli, null=otomatik); `unavailable` → okuma hatası (asla
   * "otomatik" gibi gösterilmez). Başarılı `null` ile hata artık ayrı tutulur.
   */
  const [roseStatus, setRoseStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  /** Seçim kaydı tek-uçuş kilidi: aynı anda ikinci kaydetme başlamaz. */
  const isSavingRoseRef = useRef(false);
  /** Gösterilecek toplam; her yeni pencere yeni bir kimlik alır. */
  const [toast, setToast] = useState<{ id: number; xp: number }>();

  const isMountedRef = useRef(true);
  /**
   * Hesap sahipliği. Hesap değişince artar; eski hesabın geç gelen cevabı ne
   * ilerlemeyi yazabilir ne de popup açabilir.
   */
  const ownerRef = useRef(0);
  /**
   * Günlük claim'in durumu.
   *
   * `claimedDateRef` yalnızca **başarılı VE tamamen uzlaştırılmış** bir
   * cevaptan sonra yazılır: ağ hatası alan ya da sunucuda hâlâ bekleyen işi
   * olan gün işaretlenmez, böylece aynı gün içinde ön plana dönüş kaldığı
   * yerden devam eder. `isClaimingRef` senkron tek-uçuş kilididir.
   *
   * `claimTokenRef` her isteğe bir kimlik verir. Kilidi YALNIZCA hâlâ aynı
   * hesaba ve aynı isteğe ait `finally` açabilir; aksi hâlde A hesabının geç
   * gelen cevabı, B hesabının uçuştaki claim kilidini açıp ikinci bir istek
   * başlatılmasına yol açardı.
   */
  const claimedDateRef = useRef<string>(undefined);
  const isClaimingRef = useRef(false);
  const claimTokenRef = useRef(0);
  /** Birleştirme penceresinde biriken XP ve tek zamanlayıcı. */
  const pendingXpRef = useRef(0);
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastIdRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
      coalesceTimerRef.current = undefined;
    };
  }, []);

  const clearPendingToast = useCallback(() => {
    if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
    coalesceTimerRef.current = undefined;
    pendingXpRef.current = 0;
    setToast(undefined);
  }, []);

  /** Sunucu gerçekten ödül yazdıysa pencereye ekle; yoksa hiçbir şey yapma. */
  const queueToast = useCallback((awardedXp: number, owner: number) => {
    if (awardedXp <= 0) return;
    pendingXpRef.current += awardedXp;
    if (coalesceTimerRef.current) return;

    coalesceTimerRef.current = setTimeout(() => {
      coalesceTimerRef.current = undefined;
      const total = pendingXpRef.current;
      pendingXpRef.current = 0;
      // Pencere dolarken hesap değiştiyse popup açılmaz.
      if (!isMountedRef.current || owner !== ownerRef.current || total <= 0) return;
      toastIdRef.current += 1;
      setToast({ id: toastIdRef.current, xp: total });
    }, REWARD_COALESCE_WINDOW);
  }, []);

  /** Cevabı uygula: toplamlar sunucudan, popup yalnızca yeni ödülde. */
  const applyResult = useCallback(
    (result: RewardResult | undefined, owner: number) => {
      if (!result) return;
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      setProgress({
        level: result.level,
        lifetimeXp: result.lifetimeXp,
        roseBalance: result.roseBalance,
        xpForNextLevel: result.xpForNextLevel,
        xpIntoLevel: result.xpIntoLevel,
      });
      queueToast(result.awardedXp, owner);
    },
    [queueToast],
  );

  const refreshProgress = useCallback(async () => {
    const owner = ownerRef.current;
    if (!userId) return;
    try {
      const next = await fetchMyProgress();
      if (!isMountedRef.current || owner !== ownerRef.current || !next) return;
      setProgress(next);
    } catch {
      // İlerleme okunamazsa ekran mevcut değerle çalışmaya devam eder.
    } finally {
      if (isMountedRef.current && owner === ownerRef.current) setIsProgressLoading(false);
    }
  }, [userId]);

  /**
   * Seçili seviye gülünü sunucudan yükler.
   *
   * Backend bu RPC'yi henüz tanımıyorsa (eski sunucu) çağrı hata verir; bu
   * durumda seçim "yok (otomatik mod)" kabul edilir ve profil BOZULMAZ —
   * kaydedilemeyen bir tercih kaydedilmiş gibi GÖSTERİLMEZ, yalnızca otomatik
   * varsayılan (en yüksek açık gül) görünür. Geç gelen cevap yeni hesaba yazmaz.
   */
  const loadLevelRose = useCallback(async () => {
    const owner = ownerRef.current;
    if (!userId) return;
    try {
      const sel = await fetchMyLevelRose();
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      setSelectedRoseId(sel);
      setRoseStatus('ready');
    } catch {
      // Okuma hatası "otomatik tercih"e DÖNÜŞTÜRÜLMEZ: başarılı bir `null` ile
      // hata birbirine karışmasın diye seçim SAHTE bir gülle doldurulmaz.
      // Bu KULLANICI için daha önce doğrulanmış bir tercih (status 'ready')
      // varsa geçici hatada KORUNUR; ilk yüklemede (henüz 'ready' değil) nötr
      // 'unavailable' gösterilir. Hesap değişiminde status 'loading'e sıfırlanır,
      // böylece bir hesabın tercihi başka hesaba TAŞINAMAZ.
      if (isMountedRef.current && owner === ownerRef.current) {
        setRoseStatus((prev) => (prev === 'ready' ? 'ready' : 'unavailable'));
      }
    }
  }, [userId]);

  /**
   * Seçimi kaydeder. Pesimistik: state YALNIZCA sunucu onayından sonra değişir,
   * böylece kaydedilemeyen tercih "kaydedilmiş" gibi görünmez. Tek-uçuş kilidi
   * yinelenen kaydetmeyi engeller. Hatada önceki seçim korunur ve `'error'`
   * döner. Geç gelen cevap yeni hesaba yazmaz (owner guard).
   */
  const setLevelRose = useCallback(
    async (roseId: string | null): Promise<LevelRoseSaveStatus> => {
      if (!userId) return 'error';
      if (roseId === selectedRoseId) return 'noop';
      if (isSavingRoseRef.current) return 'error';
      isSavingRoseRef.current = true;
      const owner = ownerRef.current;
      try {
        const saved = await saveMyLevelRose(roseId);
        if (owner !== ownerRef.current) return 'error';
        if (isMountedRef.current) {
          setSelectedRoseId(saved);
          // Başarılı kayıt DOĞRULANMIŞ bir tercihtir: ilk okuma 'unavailable'
          // kalmış olsa bile artık 'ready'dir (placeholder yerine gerçek gül).
          setRoseStatus('ready');
        }
        return 'saved';
      } catch {
        return 'error';
      } finally {
        if (owner === ownerRef.current) isSavingRoseRef.current = false;
      }
    },
    [selectedRoseId, userId],
  );

  // Hesap değişimi: sahiplik artar, durum ve bekleyen popup sıfırlanır.
  useEffect(() => {
    ownerRef.current += 1;
    clearPendingToast();
    // Önceki hesabın claim durumu yeni oturuma sızmaz. Token da ilerletilir:
    // eski hesabın uçuştaki isteğinin `finally` bloğu kilidi açamaz.
    claimedDateRef.current = undefined;
    isClaimingRef.current = false;
    claimTokenRef.current += 1;
    // Önceki hesabın gül seçimi yeni oturuma sızmaz.
    isSavingRoseRef.current = false;
    setSelectedRoseId(null);
    // Oturumlu kullanıcıda okuma yeniden başlar (loading); oturumsuzda gösterim
    // yok, nötr 'ready' bırakılır. Önceki hesabın durumu yeni oturuma sızmaz.
    setRoseStatus(userId ? 'loading' : 'ready');
    setProgress(DEFAULT_PROGRESS);
    setIsProgressLoading(Boolean(userId));
    if (userId) {
      void refreshProgress();
      void loadLevelRose();
    }
  }, [clearPendingToast, loadLevelRose, refreshProgress, userId]);

  const syncWorkoutDay = useCallback(
    async (clientToday: string, targetDate: string) => {
      const owner = ownerRef.current;
      if (!userId) return;
      try {
        applyResult(await syncWorkoutRewards(clientToday, targetDate), owner);
      } catch {
        // Ödül yazılamazsa antrenman akışı engellenmez; sonraki uzlaştırmada
        // aynı olaylar yeniden denenir (defter idempotent).
      }
    },
    [applyResult, userId],
  );

  /**
   * Günlük giriş + kaçırılmış gün/hafta uzlaştırması.
   *
   * Aynı gün için başarılı bir cevap alındıysa bir daha çağrılmaz (gereksiz
   * polling yok). Başarısız kalmışsa sonraki `active` olayında yeniden
   * denenir; sunucudaki idempotency sayesinde aynı daily/day/streak/weekly
   * ödülü ikinci kez yazılmaz.
   */
  const claimDaily = useCallback(
    async (clientToday: string) => {
      if (!userId) return;
      // Bu gün zaten başarıyla tamamlandı: tekrar istek atılmaz.
      if (claimedDateRef.current === clientToday) return;
      // Tek uçuş: devam eden istek varken ikincisi başlatılmaz.
      if (isClaimingRef.current) return;

      isClaimingRef.current = true;
      const owner = ownerRef.current;
      claimTokenRef.current += 1;
      const token = claimTokenRef.current;

      try {
        const result = await claimDailyRewards(clientToday);
        // Hesap arada değiştiyse eski cevap ne ilerlemeyi, ne popup'ı, ne de
        // claim durumunu etkileyebilir.
        if (owner !== ownerRef.current) return;
        // İşaret yalnızca sunucu gerçekten HER ŞEYİ bitirdiğinde konur.
        // `reconciliationPending` true ise gün tamamlanmış sayılmaz ve sonraki
        // foreground kalan batch'i sürdürür.
        if (result && !result.reconciliationPending) claimedDateRef.current = clientToday;
        applyResult(result, owner);
      } catch {
        // Sessiz: işaret konmadığı için sonraki ön plana gelişte tekrar denenir.
      } finally {
        // Kilidi yalnızca hâlâ bu isteğin sahibi açar.
        if (owner === ownerRef.current && claimTokenRef.current === token) {
          isClaimingRef.current = false;
        }
      }
    },
    [applyResult, userId],
  );

  const awardPetBurst = useCallback(
    async (burstKey: string) => {
      const owner = ownerRef.current;
      if (!userId) return;
      try {
        applyResult(await awardPetLove(burstKey), owner);
      } catch {
        // Sessiz: okşama akışı hiçbir koşulda kesilmez.
      }
    },
    [applyResult, userId],
  );

  /**
   * Claim tetikleyicileri: (a) kullanıcı/yerel gün değişimi, (b) uygulamanın
   * yeniden `active` olması.
   *
   * (b) bilinçli olarak eklendi: aynı gün içindeki ilk istek ağ hatası alırsa
   * `todayKey` değişmediği için (a) bir daha tetiklenmezdi ve günlük giriş
   * ödülü o gün kalıcı olarak kaybolurdu. Sürekli çalışan bir interval yoktur;
   * başarılı gün `claimDaily` içinde erken döner. Abonelik cleanup'ta kesin
   * olarak kaldırılır.
   */
  useEffect(() => {
    if (!userId) return;

    void claimDaily(todayKey);

    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void claimDaily(todayKey);
    });

    return () => subscription.remove();
  }, [claimDaily, todayKey, userId]);

  // Başarılı okuma (`ready`) → `undefined` (gerçek gül çözülür); aksi hâlde
  // ayrık durum profil bileşenine geçer (loading/unavailable → placeholder).
  const levelRoseState: 'loading' | 'unavailable' | undefined =
    roseStatus === 'ready' ? undefined : roseStatus;

  const value = useMemo<RewardContextValue>(
    () => ({
      awardPetBurst,
      claimDaily,
      isProgressLoading,
      levelRoseState,
      progress,
      refreshProgress,
      selectedRoseId,
      setLevelRose,
      syncWorkoutDay,
    }),
    [
      awardPetBurst,
      claimDaily,
      isProgressLoading,
      levelRoseState,
      progress,
      refreshProgress,
      selectedRoseId,
      setLevelRose,
      syncWorkoutDay,
    ],
  );

  return (
    <RewardContext.Provider value={value}>
      {children}
      {/* Tek katman: ekranlara kopyalanmış ayrı animasyon yoktur. */}
      <RewardToastLayer
        key={toast?.id}
        onDone={() => setToast(undefined)}
        xp={toast?.xp}
      />
    </RewardContext.Provider>
  );
}

export function useRewards() {
  const context = useContext(RewardContext);
  if (!context) throw new Error('useRewards, RewardProvider içinde kullanılmalıdır.');
  return context;
}

/**
 * Sağlayıcı yokken de güvenle çağrılabilen sürüm.
 *
 * `FloatingMascot`, `Stack`'in kardeşi olarak çizilir ve oturum bilgisi henüz
 * tamamen okunmadan (`isLoading` sürerken `isSessionLoading` çoktan bitmiş
 * olabilir) `RewardProvider`'ın DIŞINDA bir kez render edilebilir. O anda
 * hata fırlatmak uygulamayı açılışta düşürürdü; ödülü sessizce atlamak
 * doğru davranıştır — o pencerede zaten okşama etkileşimi başlamamıştır.
 */
export function useOptionalRewards() {
  return useContext(RewardContext);
}
