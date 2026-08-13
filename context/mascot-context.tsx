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

import { useAuth } from '@/context/auth-context';
import {
  DEFAULT_MASCOT_POSITION,
  MascotPosition,
  normalizeMascotPosition,
} from '@/types/mascot';

type MascotContextValue = {
  enabled: boolean;
  /** Tercih okunana kadar maskot çizilmez; yanlış konumda "doğup" zıplamaz. */
  isReady: boolean;
  position: MascotPosition;
  savePosition: (position: MascotPosition) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
};

const ENABLED_KEY_PREFIX = 'mascot:enabled';
const POSITION_KEY_PREFIX = 'mascot:position';

const MascotContext = createContext<MascotContextValue | undefined>(undefined);

function enabledKey(userId: string) {
  return `${ENABLED_KEY_PREFIX}:${userId}`;
}

function positionKey(userId: string) {
  return `${POSITION_KEY_PREFIX}:${userId}`;
}

/**
 * Aşama 1 tamamen cihaz içi çalışır: Supabase tablosu, ağ isteği ve AI çağrısı
 * yoktur. Anahtarlar kullanıcı kimliğiyle ayrıldığı için başka bir hesap giriş
 * yaptığında önceki kullanıcının tercihi veya konumu taşınmaz.
 */
export function MascotProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const userId = user?.id;

  const [enabled, setEnabledState] = useState(true);
  const [position, setPosition] = useState<MascotPosition>(DEFAULT_MASCOT_POSITION);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!userId) {
      // Çıkış yapıldığında maskot görünmez ve durum başlangıca döner.
      setEnabledState(true);
      setPosition(DEFAULT_MASCOT_POSITION);
      setIsReady(false);
      return;
    }

    let isMounted = true;
    setIsReady(false);

    async function loadPreferences(ownerId: string) {
      const [storedEnabled, storedPosition] = await AsyncStorage.multiGet([
        enabledKey(ownerId),
        positionKey(ownerId),
      ]);

      if (!isMounted) return;

      // Kayıt yoksa maskot varsayılan olarak açıktır.
      setEnabledState(storedEnabled[1] === null ? true : storedEnabled[1] === 'true');

      if (storedPosition[1]) {
        try {
          setPosition(normalizeMascotPosition(JSON.parse(storedPosition[1])));
        } catch {
          setPosition(DEFAULT_MASCOT_POSITION);
        }
      } else {
        setPosition(DEFAULT_MASCOT_POSITION);
      }
    }

    loadPreferences(userId)
      .catch(() => {
        // Yerel depolama okunamazsa güvenli varsayılanlarla devam edilir.
      })
      .finally(() => {
        if (isMounted) setIsReady(true);
      });

    return () => {
      isMounted = false;
    };
  }, [userId]);

  // Yazma sırasında oturumun güncel sahibini stale closure olmadan okumak için.
  const userIdRef = useRef(userId);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const setEnabled = useCallback(async (nextEnabled: boolean) => {
    // Ayar anında uygulanır; kalıcılaştırma başarısız olsa bile UI takılmaz.
    setEnabledState(nextEnabled);

    const ownerId = userIdRef.current;
    if (!ownerId) return;

    await AsyncStorage.setItem(enabledKey(ownerId), nextEnabled ? 'true' : 'false').catch(
      () => undefined,
    );
  }, []);

  const savePosition = useCallback(async (nextPosition: MascotPosition) => {
    const safePosition = normalizeMascotPosition(nextPosition);
    setPosition(safePosition);

    const ownerId = userIdRef.current;
    if (!ownerId) return;

    await AsyncStorage.setItem(positionKey(ownerId), JSON.stringify(safePosition)).catch(
      () => undefined,
    );
  }, []);

  const value = useMemo(
    () => ({ enabled, isReady, position, savePosition, setEnabled }),
    [enabled, isReady, position, savePosition, setEnabled],
  );

  return <MascotContext.Provider value={value}>{children}</MascotContext.Provider>;
}

export function useMascot() {
  const context = useContext(MascotContext);

  if (!context) {
    throw new Error('useMascot, MascotProvider içinde kullanılmalıdır.');
  }

  return context;
}
