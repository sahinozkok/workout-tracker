import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { isMascotForegroundState } from '@/utils/mascot-app-state';

/**
 * Uykuya dalma bekleme aralığı. Süre render sırasında değil, yalnızca effect
 * çalışırken bir kez hesaplanır.
 */
export const SLEEP_MIN_DELAY = 45000;
export const SLEEP_DELAY_RANGE = 30000; // 45–75 sn

/**
 * Uykuya hazırlanma (esneme) süresi. Bekleme dolduğunda maskot doğrudan
 * uyumaz: önce bu kadar süre `isDrowsy` durumunda kalır, sonra uyur.
 */
export const SLEEP_DROWSY_DURATION = 3000;

/** Esneme bittikten sonra gerçek uyku başlamadan önceki sakinleşme süresi. */
export const SLEEP_SETTLE_DURATION = 2000;

/** Uyku durum makinesinin dört fazı. */
export type MascotSleepPhase = 'awake' | 'drowsy' | 'settling' | 'asleep';

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
 * Durum akışı:
 *
 *   uyanık ──(45–75 sn)──▶ isDrowsy ──(3000 ms)──▶ isSettling ──(2000 ms)──▶ isAsleep
 *      ▲                      │                         │                       │
 *      └──────────────────────┴─────────────────────────┴───────────────────────┘
 *         canSleep bozulunca / arka plan / wake()
 *
 * Yaşam döngüsü:
 *  - Koşullar uygunsa 45–75 sn'lik rastgele bir **ana zamanlayıcı** kurulur.
 *  - Süre dolunca maskot doğrudan uyumaz: önce `isDrowsy` olur ve ayrı bir
 *    **geçiş zamanlayıcısı** başlar. Esneme bitince iki saniyelik sakinleşme
 *    fazına geçer; bu süre dolunca `isAsleep` açılır.
 *  - Koşullar bozulursa (tepki, sürükleme, balon, antrenman, AI) veya uygulama
 *    arka plana alınırsa iki zamanlayıcı da temizlenir; hem `isDrowsy` hem
 *    `isAsleep` **hemen** sıfırlanır.
 *  - Uygulama öne döndüğünde koşullar uygunsa normal bekleme yeniden planlanır.
 *  - Her aşamada aynı anda en fazla bir ana ve bir geçiş zamanlayıcısı bulunur;
 *    planlamadan önce ilgili zamanlayıcı her zaman temizlenir.
 *  - Her timeout ateşlendiğinde `canSleep`, AppState ve mount durumu ref
 *    üzerinden yeniden doğrulanır.
 *  - Effect cleanup'ları ve unmount effect'i bekleyen zamanlayıcıları temizler,
 *    böylece unmount sonrası state güncellemesi olmaz.
 */
export function useMascotSleep({ canSleep }: Options) {
  /**
   * Tek bir faz state'i: uykuya ait tüm boolean değerler bundan türetilir.
   * boolean olsaydı `drowsy → asleep` geçişi iki state yazımı gerektirir ve
   * React'in otomatik gruplaması olmasa aralarında bir kare "uyanık" görünürdü.
   * Tek değer bu geçişi atomik yapar.
   */
  const [phase, setPhase] = useState<MascotSleepPhase>('awake');
  const phaseRef = useRef<MascotSleepPhase>('awake');
  /** 45–75 sn'lik ana bekleme. */
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Uykuya hazırlanma geçişi. Ana zamanlayıcıdan ayrı tutulur. */
  const drowsyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Ateşlenme anında güncel değerleri senkron okumak için.
  const canSleepRef = useRef(canSleep);
  const isAppActiveRef = useRef(isMascotForegroundState(AppState.currentState));
  const isMountedRef = useRef(true);

  const [isAppActive, setIsAppActive] = useState(isAppActiveRef.current);

  useEffect(() => {
    canSleepRef.current = canSleep;
  }, [canSleep]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /** Gereksiz render üretmemek için yalnızca gerçek değişimde state yazılır. */
  const applyPhase = useCallback((next: MascotSleepPhase) => {
    if (!isMountedRef.current || phaseRef.current === next) return;
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearDrowsyTimer = useCallback(() => {
    if (!drowsyTimerRef.current) return;
    clearTimeout(drowsyTimerRef.current);
    drowsyTimerRef.current = undefined;
  }, []);

  /**
   * Kullanıcı etkileşiminde anında uyandırmak için. Süren uykuya hazırlanma
   * geçişi de iptal edilir: zamanlayıcı temizlenir ve iki durum da sıfırlanır.
   */
  const wake = useCallback(() => {
    clearDrowsyTimer();
    applyPhase('awake');
  }, [applyPhase, clearDrowsyTimer]);

  const isDrowsy = phase === 'drowsy';
  const isSettling = phase === 'settling';
  const isAsleep = phase === 'asleep';

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

    // Koşullar bozuldu veya uygulama arka planda: iki zamanlayıcı da temizlenir
    // ve maskot hemen uyanır (uykuya hazırlanma da iptal olur).
    if (!canSleep || !isAppActive) {
      clearTimer();
      clearDrowsyTimer();
      applyPhase('awake');
      return;
    }

    // Zaten uyuyorsa veya uykuya hazırlanıyorsa yeni ana zamanlayıcı kurulmaz;
    // geçiş zamanlayıcısı aşağıdaki ayrı effect'e aittir.
    if (isAsleep || isDrowsy || isSettling) {
      clearTimer();
      return;
    }

    // Aynı anda iki ana zamanlayıcı oluşmasın.
    clearTimer();

    // Rastgele gecikme effect yaşam döngüsünde bir kez hesaplanır.
    const delay = SLEEP_MIN_DELAY + Math.random() * SLEEP_DELAY_RANGE;

    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      // Son anda koşullar bozulduysa uyunmaz.
      if (!canSleepRef.current || !isAppActiveRef.current || !isMountedRef.current) return;
      // Doğrudan uyku yok: önce kısa uykuya hazırlanma durumu.
      applyPhase('drowsy');
    }, delay);

    return clearTimer;
  }, [
    applyPhase,
    canSleep,
    clearDrowsyTimer,
    isAppActive,
    isAsleep,
    isDrowsy,
    isSettling,
  ]);

  /**
   * Uykuya hazırlanma geçişi. Ana zamanlayıcıdan ayrı bir effect'te tutulur:
   * ana effect `isDrowsy` değiştiğinde yeniden kurulduğu için geçiş
   * zamanlayıcısı orada yaşasaydı kendi cleanup'ı tarafından iptal edilirdi.
   */
  useEffect(() => {
    if (!isDrowsy && !isSettling) {
      clearDrowsyTimer();
      return;
    }

    // Aynı anda iki geçiş zamanlayıcısı oluşmasın.
    clearDrowsyTimer();

    const nextPhase: MascotSleepPhase = isDrowsy ? 'settling' : 'asleep';
    const duration = isDrowsy ? SLEEP_DROWSY_DURATION : SLEEP_SETTLE_DURATION;

    drowsyTimerRef.current = setTimeout(() => {
      drowsyTimerRef.current = undefined;
      // Ateşlenme anında koşullar yeniden doğrulanır.
      if (!canSleepRef.current || !isAppActiveRef.current || !isMountedRef.current) {
        applyPhase('awake');
        return;
      }

      // Her geçiş tek yazımdır; arada "uyanık" karesi üretilmez.
      applyPhase(nextPhase);
    }, duration);

    return clearDrowsyTimer;
  }, [applyPhase, clearDrowsyTimer, isDrowsy, isSettling]);

  // Unmount'ta bekleyen zamanlayıcılar kesin olarak temizlenir.
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      if (drowsyTimerRef.current) {
        clearTimeout(drowsyTimerRef.current);
        drowsyTimerRef.current = undefined;
      }
    },
    [],
  );

  // `isAppActive` de dışa verilir: uygulama ön planda mı bilgisini isteyen
  // diğer maskot animasyonları (uyanık nefesi) ikinci bir AppState dinleyicisi
  // kurmak zorunda kalmaz. Uyku davranışı bundan etkilenmez.
  return { isAppActive, isAsleep, isDrowsy, isSettling, wake };
}
