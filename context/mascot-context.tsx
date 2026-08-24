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
  MascotReaction,
  MascotReactionType,
  normalizeMascotPosition,
} from '@/types/mascot';

export type MascotCoachHandoffPhase = 'world' | 'departing' | 'chat' | 'returning';

type MascotContextValue = {
  /** Rosea ile sohbet avatarı arasındaki görsel teslimin aşaması. */
  coachHandoffPhase: MascotCoachHandoffPhase;
  enabled: boolean;
  /** AI yanıt hazırlarken sürekli açık kalan durum. */
  isThinking: boolean;
  /** Tercih okunana kadar maskot çizilmez; yanlış konumda "doğup" zıplamaz. */
  isReady: boolean;
  position: MascotPosition;
  /** En son tetiklenen tek seferlik olay; kalıcı değildir. */
  reaction?: MascotReaction;
  savePosition: (position: MascotPosition) => Promise<void>;
  setCoachHandoffPhase: (phase: MascotCoachHandoffPhase) => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  setThinking: (value: boolean) => void;
  triggerReaction: (type: MascotReactionType) => void;
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
  const [coachHandoffPhase, setCoachHandoffPhase] =
    useState<MascotCoachHandoffPhase>('world');
  const [position, setPosition] = useState<MascotPosition>(DEFAULT_MASCOT_POSITION);
  const [isReady, setIsReady] = useState(false);
  const [reaction, setReaction] = useState<MascotReaction>();
  const [isThinking, setIsThinking] = useState(false);
  // Artan sayaç; her olay benzersiz bir kimlik alır.
  const reactionIdRef = useRef(0);

  useEffect(() => {
    if (!userId) {
      // Çıkış yapıldığında maskot görünmez ve durum başlangıca döner.
      setEnabledState(true);
      setCoachHandoffPhase('world');
      setPosition(DEFAULT_MASCOT_POSITION);
      setIsReady(false);
      setReaction(undefined);
      setIsThinking(false);
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
  // triggerReaction'ın kimliği sabit kalsın diye tercih ref üzerinden okunur.
  const enabledRef = useRef(enabled);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const setEnabled = useCallback(async (nextEnabled: boolean) => {
    // Ayar anında uygulanır; kalıcılaştırma başarısız olsa bile UI takılmaz.
    enabledRef.current = nextEnabled;
    setEnabledState(nextEnabled);

    // Tatilde avatar teslim animasyonu oynatılmaz. Rosea geri getirildiğinde
    // bulunduğu route yeni teslimi sıfırdan başlatır.
    if (!nextEnabled) setCoachHandoffPhase('world');

    // Maskot kapatılınca bekleyen kutlama/tepki de temizlenir.
    if (!nextEnabled) setReaction(undefined);

    const ownerId = userIdRef.current;
    if (!ownerId) return;

    await AsyncStorage.setItem(enabledKey(ownerId), nextEnabled ? 'true' : 'false').catch(
      () => undefined,
    );
  }, []);

  /**
   * Tek seferlik olay gönderir. Maskot kapalıyken olay düşürülür: daha sonra
   * oynamak üzere kuyrukta beklemez. Hiçbir kalıcı depolamaya yazılmaz.
   */
  const triggerReaction = useCallback((type: MascotReactionType) => {
    if (!enabledRef.current) return;

    reactionIdRef.current += 1;
    setReaction({ id: reactionIdRef.current, type });
  }, []);

  const setThinking = useCallback((value: boolean) => {
    // Aynı değer için gereksiz render üretmemek adına React'in kendi
    // eşitlik kontrolüne bırakılır.
    setIsThinking(value);
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
    () => ({
      coachHandoffPhase,
      enabled,
      isReady,
      isThinking,
      position,
      reaction,
      savePosition,
      setCoachHandoffPhase,
      setEnabled,
      setThinking,
      triggerReaction,
    }),
    [
      coachHandoffPhase,
      enabled,
      isReady,
      isThinking,
      position,
      reaction,
      savePosition,
      setEnabled,
      setThinking,
      triggerReaction,
    ],
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
