import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { isMascotForegroundState } from '@/utils/mascot-app-state';

/**
 * Açık göz durumunda beklenen süre. Rastgelelik yalnızca zamanlayıcı
 * planlanırken hesaplanır; render sırasında hiçbir `Math.random()` çalışmaz.
 */
export const BLINK_MIN_DELAY = 3500;
export const BLINK_DELAY_RANGE = 3500; // 3,5–7 sn

/** Kare süreleri: yarı kapalı → kapalı → yarı kapalı → açık. */
export const BLINK_HALF_MS = 65;
export const BLINK_CLOSED_MS = 90;

/**
 * Göz açıldıktan sonra geçiş süresinin normale döndüğü kısa pencere. Blink
 * kareleri arasında crossfade kapalıdır (kareler 65–90 ms sürdüğü için 100 ms'lik
 * geçiş onları yutar); bu bekleme bittiğinde normal ifade değişimleri yeniden
 * mevcut crossfade davranışını kullanır.
 */
export const BLINK_SETTLE_MS = 150;

export type MascotBlinkFrame = 'open' | 'half' | 'closed';

export type MascotBlinkState = {
  frame: MascotBlinkFrame;
  /**
   * Blink sürerken (ve göz açıldıktan hemen sonra) görsel geçişi anlık olmalı.
   * Normal ifade değişimlerinde `false` döner ve mevcut crossfade korunur.
   */
  isInstant: boolean;
};

type Options = {
  /**
   * Maskotun **şu anda** göz kırpabilir durumda olup olmadığı. Çağıran taraf
   * bunu tek bir yerde hesaplar: görünürlük, uyku, sürükleme, AI düşünme,
   * aktif reaction/kutlama/love, ambient peek, Reduce Motion ve çözümlenmiş
   * ifadenin `happy` olması.
   */
  canBlink: boolean;
};

const OPEN_IDLE: MascotBlinkState = { frame: 'open', isInstant: false };

/**
 * Doğal göz kırpma. Yalnızca yerel bir zamanlayıcıdır: ağ isteği, AI çağrısı,
 * kalıcı yazma veya konum değişikliği yapmaz; maskotun animasyon katmanlarına
 * (konum, peek, rotasyon, ölçek) hiç dokunmaz — sadece hangi görselin
 * gösterileceğini söyler.
 *
 * Yaşam döngüsü:
 *  - Koşullar uygunsa 3,5–7 sn'lik rastgele bir bekleme kurulur.
 *  - Sıra tek bir zamanlayıcı zinciriyle yürür (half → closed → half → open),
 *    her adımda yalnızca bir timeout bekler; bu yüzden aynı anda ikinci bir
 *    blink döngüsü oluşamaz.
 *  - Her adım ateşlendiği anda koşullar **ref üzerinden** yeniden doğrulanır;
 *    bozulmuşsa animasyon anında iptal edilir ve kare `open`'a döner.
 *  - Koşul bozulduğunda veya uygulama arka plana alındığında effect yeniden
 *    kurulur, cleanup bekleyen timeout'u temizler ve kare `open` olur.
 *  - Uygulama öne döndüğünde güvenle yeniden planlanır.
 *  - Unmount'ta bekleyen timeout temizlenir ve state güncellenmez.
 */
export function useMascotBlink({ canBlink }: Options): MascotBlinkState {
  const [blink, setBlink] = useState<MascotBlinkState>(OPEN_IDLE);
  const blinkRef = useRef<MascotBlinkState>(OPEN_IDLE);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isMountedRef = useRef(true);

  // Ateşlenme anında güncel değerleri senkron okumak için.
  const canBlinkRef = useRef(canBlink);
  const isAppActiveRef = useRef(isMascotForegroundState(AppState.currentState));

  const [isAppActive, setIsAppActive] = useState(isAppActiveRef.current);

  useEffect(() => {
    canBlinkRef.current = canBlink;
  }, [canBlink]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /** Gereksiz render üretmemek için yalnızca gerçek değişimde state yazılır. */
  const applyBlink = useCallback((next: MascotBlinkState) => {
    if (!isMountedRef.current) return;
    const current = blinkRef.current;
    if (current.frame === next.frame && current.isInstant === next.isInstant) return;
    blinkRef.current = next;
    setBlink(next);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const nextIsActive = isMascotForegroundState(next);
      // Önce senkron ref, sonra React state: aynı anda ateşlenen bir
      // zamanlayıcı bile güncel aktiflik durumunu görür.
      isAppActiveRef.current = nextIsActive;
      setIsAppActive(nextIsActive);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const clearTimer = () => {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };

    // Koşullar uygun değil veya uygulama arka planda: bekleyen adım temizlenir
    // ve göz anında açık kareye döner. Arka planda hiçbir kare ilerlemez.
    if (!canBlink || !isAppActive) {
      clearTimer();
      applyBlink(OPEN_IDLE);
      return;
    }

    // Aynı anda iki zincir oluşmasın.
    clearTimer();

    const isStillAllowed = () =>
      isMountedRef.current && canBlinkRef.current && isAppActiveRef.current;

    /** Koşul bozulduysa animasyon iptal edilir; görsel gerçek ifadeye döner. */
    const cancel = () => {
      timerRef.current = undefined;
      applyBlink(OPEN_IDLE);
    };

    const step = (delay: number, run: () => void) => {
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        if (!isStillAllowed()) {
          cancel();
          return;
        }
        run();
      }, delay);
    };

    const scheduleNextBlink = () => {
      // Rastgele bekleme yalnızca burada, planlama anında hesaplanır.
      const delay = BLINK_MIN_DELAY + Math.random() * BLINK_DELAY_RANGE;
      step(delay, playBlink);
    };

    function playBlink() {
      applyBlink({ frame: 'half', isInstant: true });
      step(BLINK_HALF_MS, () => {
        applyBlink({ frame: 'closed', isInstant: true });
        step(BLINK_CLOSED_MS, () => {
          applyBlink({ frame: 'half', isInstant: true });
          step(BLINK_HALF_MS, () => {
            // Göz açıldı; geçiş kısa bir süre daha anlık kalır.
            applyBlink({ frame: 'open', isInstant: true });
            step(BLINK_SETTLE_MS, () => {
              applyBlink(OPEN_IDLE);
              scheduleNextBlink();
            });
          });
        });
      });
    }

    scheduleNextBlink();

    return clearTimer;
  }, [applyBlink, canBlink, isAppActive]);

  // Unmount'ta bekleyen zamanlayıcı kesin olarak temizlenir.
  useEffect(
    () => () => {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    },
    [],
  );

  return blink;
}
