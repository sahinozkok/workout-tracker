import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * Uykuya dalma bekleme aralığı. Süre render sırasında değil, yalnızca effect
 * çalışırken bir kez hesaplanır.
 */
export const SLEEP_MIN_DELAY = 45000;
export const SLEEP_DELAY_RANGE = 30000; // 45–75 sn

type Options = {
  /**
   * Maskotun **şu anda** uyuyabilir durumda olup olmadığı. Sürükleme, açık
   * balon, aktif reaction, AI thinking, aktif/duraklatılmış antrenman veya
   * maskotun gizli olması bu değeri `false` yapar.
   */
  canSleep: boolean;
};

/**
 * Yerel "uyku" durumu. Ağ isteği, AI çağrısı veya kalıcı yazma yapmaz; durum
 * yalnızca mevcut uygulama oturumunda yaşar ve hiçbir yere kaydedilmez.
 *
 * Yaşam döngüsü:
 *  - Koşullar uygunsa 45–75 sn'lik rastgele bir zamanlayıcı kurulur.
 *  - Koşullar bozulursa (tepki, sürükleme, balon, antrenman, AI) veya uygulama
 *    arka plana alınırsa zamanlayıcı temizlenir ve maskot **hemen uyanır**.
 *  - Uygulama öne döndüğünde koşullar uygunsa süre yeniden planlanır.
 *  - Zaten uyuyorken yeni zamanlayıcı kurulmaz; her planlama öncesi mevcut
 *    zamanlayıcı temizlendiği için aynı anda iki zamanlayıcı oluşamaz.
 *  - Zamanlayıcı ateşlendiği anda koşullar tekrar kontrol edilir.
 *  - Effect cleanup'ı ve unmount effect'i bekleyen zamanlayıcıyı temizler,
 *    böylece unmount sonrası state güncellemesi olmaz.
 */
export function useMascotSleep({ canSleep }: Options) {
  const [isAsleep, setIsAsleep] = useState(false);
  const isAsleepRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Ateşlenme anında güncel değerleri senkron okumak için.
  const canSleepRef = useRef(canSleep);
  const isAppActiveRef = useRef(AppState.currentState === 'active');

  const [isAppActive, setIsAppActive] = useState(isAppActiveRef.current);

  useEffect(() => {
    canSleepRef.current = canSleep;
  }, [canSleep]);

  /** Gereksiz render üretmemek için yalnızca gerçek değişimde state yazılır. */
  const setAsleep = useCallback((next: boolean) => {
    if (isAsleepRef.current === next) return;
    isAsleepRef.current = next;
    setIsAsleep(next);
  }, []);

  /** Kullanıcı etkileşiminde anında uyandırmak için. */
  const wake = useCallback(() => setAsleep(false), [setAsleep]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const nextIsActive = next === 'active';
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

    // Koşullar bozuldu veya uygulama arka planda: zamanlayıcı temizlenir ve
    // maskot hemen uyanır.
    if (!canSleep || !isAppActive) {
      clearTimer();
      setAsleep(false);
      return;
    }

    // Zaten uyuyorsa yeni zamanlayıcı kurulmaz.
    if (isAsleep) {
      clearTimer();
      return;
    }

    // Aynı anda iki zamanlayıcı oluşmasın.
    clearTimer();

    // Rastgele gecikme effect yaşam döngüsünde bir kez hesaplanır.
    const delay = SLEEP_MIN_DELAY + Math.random() * SLEEP_DELAY_RANGE;

    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      // Son anda koşullar bozulduysa uyunmaz.
      if (!canSleepRef.current || !isAppActiveRef.current) return;
      setAsleep(true);
    }, delay);

    return clearTimer;
  }, [canSleep, isAppActive, isAsleep, setAsleep]);

  // Unmount'ta bekleyen zamanlayıcı kesin olarak temizlenir.
  useEffect(
    () => () => {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    },
    [],
  );

  return { isAsleep, wake };
}
