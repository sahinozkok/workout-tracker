import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { AchievementKey } from '@/constants/achievements';
import { useAuth } from '@/context/auth-context';
import { useLocalDateKey } from '@/hooks/use-shared-discipline-sync';
import {
  fetchMyAchievementShowcase,
  saveMyAchievementShowcase,
  syncMyAchievements,
} from '@/services/achievements';
import { AchievementShowcaseSelection, CareerAchievement } from '@/types/achievements';
import { reconcileCelebrations } from '@/utils/achievement-celebration';

/**
 * KARİYER BAŞARIMLARI — sezondan bağımsız, kalıcı istemci durumu.
 *
 * Sezon `RankContext`'inden AYRIDIR (onu bozmaz). Sunucu 30 satırı yazan tek
 * otoritedir; bu context yalnız okur/gösterir ve kutlama baseline'ını yönetir.
 *
 * SENKRONİZASYON — mount + hesap değişimi + foreground + ekran focus'u dışında,
 * başarımı etkileyen BAŞARILI domain işlemlerinden sonra `requestSync()` ile
 * tetiklenir. `requestSync` DEBOUNCE + COALESCE + TEK-UÇUŞ'tur: hızlı çok sayıda
 * olay TEK RPC'de birleşir. Owner guard: hesap değişince eski cevap yeni duruma
 * yazamaz. Senkron hatası ANA işlemi (workout/program/mesaj) BOZMAZ.
 *
 * KUTLAMA — bir başarım YALNIZCA overlay gösterilip kapandığında (`ack`)
 * onaylanır ve kalıcılaşır; gösterilmeden uygulama kapanırsa sonraki açılışta
 * yeniden bulunur (bkz. `reconcileCelebrations`). İlk başarılı yükleme sessiz
 * baseline'dır (yağmur yok). Sürümlü, kullanıcı başına AsyncStorage anahtarı.
 */

const ACK_STORAGE_PREFIX = '@workout-tracker/career-ach-ack/v1/';
const SYNC_DEBOUNCE_MS = 450;

export type AchievementLoadStatus = 'loading' | 'ready' | 'unavailable';

type AchievementContextValue = {
  achievements: CareerAchievement[];
  status: AchievementLoadStatus;
  /** Ölçülü, coalescing'li senkron isteği (ekran focus / foreground / mutation). */
  requestSync: () => void;
  /** Zorunlu tazeleme (retry). */
  refresh: () => Promise<void>;

  showcaseSelection: AchievementShowcaseSelection;
  showcaseStatus: AchievementLoadStatus;
  loadShowcase: () => Promise<void>;
  saveShowcase: (keys: AchievementShowcaseSelection) => Promise<'saved' | 'error'>;

  celebration?: AchievementKey;
  acknowledgeCelebration: (key: AchievementKey) => void;
};

const AchievementContext = createContext<AchievementContextValue | undefined>(undefined);

export function AchievementProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const userId = user?.id;
  const todayKey = useLocalDateKey();

  const [achievements, setAchievements] = useState<CareerAchievement[]>([]);
  const [status, setStatus] = useState<AchievementLoadStatus>('loading');
  const [showcaseSelection, setShowcaseSelection] = useState<AchievementShowcaseSelection>([]);
  const [showcaseStatus, setShowcaseStatus] = useState<AchievementLoadStatus>('loading');
  const [queue, setQueue] = useState<AchievementKey[]>([]);

  const isMountedRef = useRef(true);
  const ownerRef = useRef(0);
  /** Onaylı (kutlanmış/baseline) küme; kullanıcı başına AsyncStorage'dan. */
  const acknowledgedRef = useRef<Set<AchievementKey> | undefined>(undefined);
  const acknowledgedLoadedRef = useRef(false);
  /** Kuyruktakiler (aynı başarımı iki kez eklememek için ayna). */
  const queuedRef = useRef<Set<AchievementKey>>(new Set());
  /** Tek-uçuş + coalesce. */
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const storageKey = useCallback((id: string) => `${ACK_STORAGE_PREFIX}${id}`, []);

  const persistAck = useCallback(
    async (id: string) => {
      const set = acknowledgedRef.current;
      if (!set) return;
      try {
        await AsyncStorage.setItem(storageKey(id), JSON.stringify([...set]));
      } catch {
        // Yazma hatası uygulamayı çökertmez; bir sonraki ack/baseline'da yeniden denenir.
      }
    },
    [storageKey],
  );

  /** GERÇEK senkron (RPC + reconcile). Tek-uçuş; owner guard'lı. */
  const runSync = useCallback(async () => {
    const id = userId;
    const owner = ownerRef.current;
    if (!id) return;
    if (syncInFlightRef.current) {
      // Uçuşta bir sync varken gelen istek COALESCE edilir: bitince tek tekrar.
      syncQueuedRef.current = true;
      return;
    }
    syncInFlightRef.current = true;
    try {
      const rows = await syncMyAchievements(todayKey);
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      setAchievements(rows);
      setStatus('ready');

      const unlocked = rows.filter((r) => r.isUnlocked).map((r) => r.key);
      if (!acknowledgedLoadedRef.current) {
        let stored: Set<AchievementKey> | undefined;
        try {
          const raw = await AsyncStorage.getItem(storageKey(id));
          if (raw) stored = new Set(JSON.parse(raw) as AchievementKey[]);
        } catch {
          stored = undefined;
        }
        if (owner !== ownerRef.current) return;
        acknowledgedRef.current = stored;
        acknowledgedLoadedRef.current = true;
      }
      const { baseline, toEnqueue } = reconcileCelebrations(unlocked, acknowledgedRef.current, queuedRef.current);
      if (baseline) {
        // İlk başarılı yükleme: sessiz baseline (kutlama yok), kalıcılaştır.
        acknowledgedRef.current = baseline;
        void persistAck(id);
      }
      if (toEnqueue.length > 0) {
        for (const k of toEnqueue) queuedRef.current.add(k);
        setQueue((current) => [...current, ...toEnqueue]);
      }
    } catch {
      // Sunucu sonucu yok → unavailable (sahte 0/unlock yok; ana işlem bozulmaz).
      if (isMountedRef.current && owner === ownerRef.current) {
        setStatus((prev) => (prev === 'ready' ? 'ready' : 'unavailable'));
      }
    } finally {
      if (owner === ownerRef.current) {
        syncInFlightRef.current = false;
        if (syncQueuedRef.current) {
          syncQueuedRef.current = false;
          void runSync();
        }
      }
    }
  }, [persistAck, storageKey, todayKey, userId]);

  /** Ölçülü, coalescing'li istek — hızlı çok sayıda olay tek sync'te birleşir. */
  const requestSync = useCallback(() => {
    if (!userId) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = undefined;
      void runSync();
    }, SYNC_DEBOUNCE_MS);
  }, [runSync, userId]);

  const refresh = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
    await runSync();
  }, [runSync]);

  const loadShowcase = useCallback(async () => {
    const owner = ownerRef.current;
    if (!userId) return;
    setShowcaseStatus((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const keys = await fetchMyAchievementShowcase();
      if (!isMountedRef.current || owner !== ownerRef.current) return;
      setShowcaseSelection(keys);
      setShowcaseStatus('ready');
    } catch {
      if (isMountedRef.current && owner === ownerRef.current) {
        setShowcaseStatus((prev) => (prev === 'ready' ? 'ready' : 'unavailable'));
      }
    }
  }, [userId]);

  const saveShowcase = useCallback(
    async (keys: AchievementShowcaseSelection): Promise<'saved' | 'error'> => {
      const owner = ownerRef.current;
      if (!userId) return 'error';
      try {
        const saved = await saveMyAchievementShowcase(keys);
        if (owner !== ownerRef.current) return 'error';
        if (isMountedRef.current) {
          setShowcaseSelection(saved);
          setShowcaseStatus('ready');
        }
        return 'saved';
      } catch {
        return 'error';
      }
    },
    [userId],
  );

  const acknowledgeCelebration = useCallback(
    (key: AchievementKey) => {
      // Overlay GERÇEKTEN gösterilip kapandı → şimdi onayla + kalıcılaştır.
      if (acknowledgedRef.current) acknowledgedRef.current.add(key);
      else acknowledgedRef.current = new Set([key]);
      queuedRef.current.delete(key);
      if (userId) void persistAck(userId);
      setQueue((current) => (current[0] === key ? current.slice(1) : current.filter((k) => k !== key)));
    },
    [persistAck, userId],
  );

  // Hesap değişimi: sahiplik artar, bütün durum ve baseline önbelleği sıfırlanır.
  useEffect(() => {
    ownerRef.current += 1;
    acknowledgedRef.current = undefined;
    acknowledgedLoadedRef.current = false;
    queuedRef.current = new Set();
    syncInFlightRef.current = false;
    syncQueuedRef.current = false;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
    setAchievements([]);
    setQueue([]);
    setShowcaseSelection([]);
    setStatus(userId ? 'loading' : 'unavailable');
    setShowcaseStatus(userId ? 'loading' : 'unavailable');
    if (userId) {
      void runSync();
      void loadShowcase();
    }
    // runSync/loadShowcase kimliği userId'e bağlı; hesap değişince yenilenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Uygulama foreground'a gelince ölçülü yenileme (interval/polling YOK).
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') requestSync();
    });
    return () => sub.remove();
  }, [requestSync, userId]);

  const value = useMemo<AchievementContextValue>(
    () => ({
      achievements,
      acknowledgeCelebration,
      celebration: queue[0],
      loadShowcase,
      refresh,
      requestSync,
      saveShowcase,
      showcaseSelection,
      showcaseStatus,
      status,
    }),
    [achievements, acknowledgeCelebration, loadShowcase, queue, refresh, requestSync, saveShowcase, showcaseSelection, showcaseStatus, status],
  );

  return <AchievementContext.Provider value={value}>{children}</AchievementContext.Provider>;
}

export function useAchievements() {
  const context = useContext(AchievementContext);
  if (!context) throw new Error('useAchievements, AchievementProvider içinde kullanılmalıdır.');
  return context;
}

export function useOptionalAchievements() {
  return useContext(AchievementContext);
}
