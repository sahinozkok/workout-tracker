import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * Otomatik selamlamanın planlanma aralığı. Süre render sırasında değil,
 * yalnızca effect çalışırken bir kez hesaplanır.
 */
export const AUTO_GREETING_MIN_DELAY = 10000;
export const AUTO_GREETING_DELAY_RANGE = 6000; // 10–16 sn

type Options = {
  /**
   * Selamlamanın **şu anda** planlanabilir olup olmadığı. Maskot kapalı,
   * gizli, sürükleniyor, başka balon açık, AI düşünüyor veya herhangi bir
   * reaction oynuyorsa `false` gelir.
   */
  canGreet: boolean;
  /** Selamlama zamanı geldiğinde çağrılır. Yalnızca balon açmalıdır. */
  onGreet: () => void;
};

/**
 * Uygulama oturumu başına **bir kez**, Ana Sayfa'da uygun koşullarda bekleyip
 * otomatik selamlamayı tetikler.
 *
 * Yaşam döngüsü:
 *  - Koşullar uygunsa (veya uygulama tekrar aktif olduysa) zamanlayıcı kurulur.
 *  - Koşullar bozulur, ekran değişir veya uygulama arka plana alınırsa effect
 *    cleanup'ı bekleyen zamanlayıcıyı iptal eder.
 *  - Selamlama henüz gösterilmediyse koşullar tekrar uygun olduğunda yeniden
 *    planlanır.
 *  - Zamanlayıcı ateşlendiği anda koşullar bozulmuşsa selamlama gösterilmez ve
 *    "gösterildi" bayrağı yakılmaz; böylece aktif bir tepki asla kesilmez.
 *  - Unmount'ta zamanlayıcı ve AppState listener'ı temizlenir.
 *
 * Ağ isteği, AI çağrısı veya kalıcı yazma yapmaz.
 */
export function useMascotAutoGreeting({ canGreet, onGreet }: Options) {
  /** Oturum başına tek gösterim. */
  const hasGreetedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Ateşlenme anında güncel değerleri okumak için; effect'in kimliğini
  // gereksiz yere değiştirmezler.
  const canGreetRef = useRef(canGreet);
  const onGreetRef = useRef(onGreet);
  /**
   * Aktiflik durumunun senkron kopyası. React state güncellemesi ve effect
   * cleanup'ı bir sonraki tick'e kaldığı için, uygulama `inactive`/`background`
   * durumuna geçerken zamanlayıcı aynı anda ateşlenirse yalnızca state'e
   * bakmak yetmez.
   */
  const isAppActiveRef = useRef(AppState.currentState === 'active');

  const [isAppActive, setIsAppActive] = useState(isAppActiveRef.current);

  useEffect(() => {
    canGreetRef.current = canGreet;
  }, [canGreet]);

  useEffect(() => {
    onGreetRef.current = onGreet;
  }, [onGreet]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const nextIsActive = next === 'active';
      // Önce senkron ref, sonra React state: aynı anda ateşlenen bir zamanlayıcı
      // bile güncel aktiflik durumunu görür.
      isAppActiveRef.current = nextIsActive;
      setIsAppActive(nextIsActive);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (hasGreetedRef.current || !canGreet || !isAppActive) return;

    // Rastgele gecikme effect yaşam döngüsünde bir kez hesaplanır.
    const delay = AUTO_GREETING_MIN_DELAY + Math.random() * AUTO_GREETING_DELAY_RANGE;

    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;

      // Son anda koşullar bozulduysa veya uygulama arka plana geçtiyse
      // gösterme; bayrak yanmadığı için selamlama uygulama tekrar aktif
      // olduğunda yeniden planlanabilir.
      if (!canGreetRef.current || !isAppActiveRef.current) return;

      hasGreetedRef.current = true;
      onGreetRef.current();
    }, delay);

    return () => {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };
  }, [canGreet, isAppActive]);

  // Unmount'ta bekleyen zamanlayıcı kesin olarak temizlenir.
  useEffect(
    () => () => {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    },
    [],
  );
}
