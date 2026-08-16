import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { DISCIPLINE_SYNC_MAX_DAYS, syncSharedDisciplineDays } from '@/services/friends';
import { DisciplineStatus } from '@/types/workout';
import { toDateKey } from '@/utils/discipline';

export type SharedDisciplineSnapshot = {
  /** Cihazın YEREL bugünü; RPC pencereyi buna göre doğrular. */
  clientToday: string;
  days: { date: string; status: DisciplineStatus }[];
  /**
   * Snapshot'ın imzası: `clientToday` + günler. Tarih imzaya dahildir, çünkü
   * gün listesi hiç değişmese bile yerel gün değişince 366 günlük pencere
   * kayar ve sunucuya yeni pencere bildirilmelidir.
   */
  signature: string;
};

/** İmza: gün listesi aynı kalsa bile yeni yerel gün yeni snapshot demektir. */
export function buildSnapshotSignature(
  clientToday: string,
  days: { date: string; status: DisciplineStatus }[],
) {
  return `${clientToday}|${days.map((day) => `${day.date}:${day.status}`).join(',')}`;
}

type SendSnapshot = (
  days: { date: string; status: DisciplineStatus }[],
  clientToday: string,
) => Promise<unknown>;

/**
 * Tek uçuş (single-flight) + en yeni kazanır (latest-wins) kuyruğu.
 *
 * React'ten bağımsızdır; hem hook hem de deterministik testler aynı mantığı
 * kullanır. Akış:
 *   1. `enqueue` yalnızca EN GÜNCEL snapshot'ı saklar; bekleyen eski snapshot
 *      sessizce düşer (A → B → C sırasında B hiç gönderilmez).
 *   2. Aynı anda yalnızca bir RPC çalışır; devam eden çağrı bitmeden yenisi
 *      başlamaz.
 *   3. Çağrı bitince kuyrukta bekleyen en güncel snapshot gönderilir.
 *   4. İmza YALNIZCA gerçekten uygulanmış snapshot için işaretlenir; başarısız
 *      çağrı başarılı sayılmaz ve sonraki değişiklikte yeniden denenir.
 *   5. `reset` (hesap değişimi) kuyruğu, imzayı ve devam eden çağrının
 *      otoritesini sıfırlar: eski hesabın geç gelen cevabı yeni hesabın
 *      durumunu değiştiremez.
 *   6. `setActive(false)` (unmount) kuyruğu durdurur; unmount sonrası hiçbir
 *      React state'i güncellenmez — bu kuyruk zaten hiç state tutmaz.
 */
export function createSharedDisciplineSyncQueue(send: SendSnapshot) {
  let pending: (SharedDisciplineSnapshot & { runId: number }) | undefined;
  let appliedSignature: string | undefined;
  let isDraining = false;
  let isActive = true;
  /** Devam eden isteğin sahipliği; hesap değişince artar ve eski cevap düşer. */
  let runId = 0;

  async function drain() {
    if (isDraining) return;
    isDraining = true;

    try {
      while (isActive && pending) {
        const next = pending;
        pending = undefined;

        // Eski hesabın kuyruğu veya zaten uygulanmış içerik: gönderilmez.
        if (next.runId !== runId) continue;
        if (next.signature === appliedSignature) continue;

        try {
          await send(next.days, next.clientToday);
          // Hesap arada değiştiyse imza yeni hesaba yazılmaz.
          if (next.runId === runId) appliedSignature = next.signature;
        } catch {
          // Sessizce geçilir: senkronizasyon hatası ana uygulamayı engellemez.
          // İmza işaretlenmediği için sonraki değişiklikte yeniden denenir.
        }
      }
    } finally {
      isDraining = false;
    }
  }

  return {
    enqueue(snapshot: SharedDisciplineSnapshot) {
      if (!isActive) return;
      // Aynı başarılı snapshot tekrar gönderilmez.
      if (snapshot.signature === appliedSignature) return;
      pending = { ...snapshot, runId };
      void drain();
    },
    /** Hesap değişimi: kuyruk, imza ve devam eden isteğin otoritesi sıfırlanır. */
    reset() {
      pending = undefined;
      appliedSignature = undefined;
      runId += 1;
    },
    setActive(next: boolean) {
      isActive = next;
      if (!next) pending = undefined;
      else void drain();
    },
    /** Testler ve teşhis için salt okunur durum. */
    get state() {
      return {
        appliedSignature,
        isDraining,
        pendingSignature: pending?.signature,
        runId,
      };
    },
  };
}

export type SharedDisciplineSyncQueue = ReturnType<typeof createSharedDisciplineSyncQueue>;

/** Gece yarısını bir saniye geçen ana kadar kalan süre (ms). */
function millisecondsUntilNextLocalMidnight(now: Date) {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    1,
    0,
  );
  // Saat geri alındıysa veya hesaplama sapmışsa en az bir saniye beklenir.
  return Math.max(nextMidnight.getTime() - now.getTime(), 1000);
}

/**
 * Cihazın YEREL gününü izler.
 *
 *  - Başlangıç değeri `toDateKey(new Date())`.
 *  - Uygulama `active` durumuna döndüğünde tarih yeniden hesaplanır; böylece
 *    arka planda geçen gece, değişen sistem saati veya değişen saat dilimi
 *    uygulama öne geldiğinde algılanır.
 *  - Ön planda kalınırsa bir sonraki yerel gece yarısından hemen sonra çalışan
 *    TEK bir `setTimeout` kurulur ve her seferinde yeniden planlanır.
 *    Sürekli interval/polling yoktur.
 *  - Zamanlayıcı arka planda tetiklenirse tarih güncellenmez (bu, ağ isteği
 *    başlatırdı); uygulama `active` olduğunda zaten yeniden hesaplanır.
 *  - Cleanup hem `setTimeout`'u hem de AppState aboneliğini tamamen kaldırır.
 */
export function useLocalDateKey() {
  const [dateKey, setDateKey] = useState(() => toDateKey(new Date()));

  useEffect(() => {
    let isMounted = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const scheduleNextMidnight = () => {
      if (timeout) clearTimeout(timeout);
      if (!isMounted) return;
      timeout = setTimeout(handleMidnight, millisecondsUntilNextLocalMidnight(new Date()));
    };

    const refresh = () => {
      if (!isMounted) return;
      const next = toDateKey(new Date());
      setDateKey((current) => (current === next ? current : next));
      scheduleNextMidnight();
    };

    function handleMidnight() {
      if (!isMounted) return;
      // Arka plandayken tarih güncellenmez: uyanınca AppState dinleyicisi
      // zaten güncel değeri hesaplar.
      if (AppState.currentState === 'active') refresh();
      else scheduleNextMidnight();
    }

    scheduleNextMidnight();

    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') refresh();
    });

    return () => {
      isMounted = false;
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
      subscription?.remove();
    };
  }, []);

  return dateKey;
}

/**
 * Kullanıcının disiplin özetini arkadaşlara açık tabloya senkronize eder.
 *
 * Sınırlar bilinçli:
 *  - **Veri başarıyla yüklenmeden hiç çalışmaz.** `isWorkoutDataReady`,
 *    WorkoutContext'in yüklemeyi bitirdiğini VE hata almadığını belirtir.
 *    Yükleme hatası sonrası `disciplineStatuses` boş kalabilir; bu boş değerin
 *    snapshot olarak gidip paylaşılan geçmişi silmesi engellenir.
 *    `refreshPrograms()` sonradan başarılı olursa senkronizasyon kaldığı
 *    yerden devam eder.
 *  - Başarıyla yüklenmiş gerçekten boş veri yine de `[]` olarak gönderilir:
 *    yerelde silinen günler arkadaş görünümünden de kalkar.
 *  - Yalnızca bugün dahil son `DISCIPLINE_SYNC_MAX_DAYS` gün. Pencerenin sonu
 *    `useLocalDateKey` ile izlenen YEREL gündür: uygulama gece boyunca açık
 *    kalırsa veya ertesi gün arka plandan öne gelirse gün değişimi algılanır
 *    ve pencere kayar.
 *  - Payload gerçekten değiştiğinde gönderilir; aynı içerik tekrar yollanmaz.
 *    "Aynı içerik" tanımına yerel gün de dahildir (bkz.
 *    `buildSnapshotSignature`), çünkü gün değişince pencere de değişir.
 *  - Aynı anda tek RPC çalışır; hızlı değişimde yalnızca en güncel snapshot
 *    gönderilir (bkz. `createSharedDisciplineSyncQueue`).
 *  - Arka plan görevi yoktur; uygulama kapalıyken hiçbir şey çalışmaz.
 */
export function useSharedDisciplineSync(
  userId: string | undefined,
  disciplineStatuses: Record<string, DisciplineStatus>,
  isWorkoutDataReady: boolean,
) {
  const queueRef = useRef<SharedDisciplineSyncQueue>(undefined);
  if (!queueRef.current) queueRef.current = createSharedDisciplineSyncQueue(syncSharedDisciplineDays);

  const lastUserIdRef = useRef<string | undefined>(undefined);
  const hasSeenUserRef = useRef(false);
  /** Yerel gün; gece yarısı veya arka plandan dönüşte kendiliğinden değişir. */
  const todayKey = useLocalDateKey();

  // Unmount sonrası kuyruk durur; bekleyen snapshot gönderilmez.
  useEffect(() => {
    const queue = queueRef.current;
    queue?.setActive(true);
    return () => queue?.setActive(false);
  }, []);

  useEffect(() => {
    if (hasSeenUserRef.current && lastUserIdRef.current === userId) return;
    hasSeenUserRef.current = true;
    lastUserIdRef.current = userId;
    queueRef.current?.reset();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    // Veri başarıyla yüklenmeden snapshot gönderilmez: yükleme sürüyorsa da,
    // yükleme hata ile bittiyse de kuyruğa hiçbir şey girmez.
    if (!isWorkoutDataReady) return;

    // Pencere, izlenen yerel gün üzerinden hesaplanır: effect yalnızca
    // dependency değişince çalıştığı için burada `new Date()` kullanılsaydı
    // uygulama gece boyunca açık kalırken gün değişimi kaçırılırdı.
    const [year, month, day] = todayKey.split('-').map(Number);
    const oldest = new Date(year, month - 1, day);
    // Bugün dahil 366 gün → bugünden 365 gün geriye.
    oldest.setDate(oldest.getDate() - (DISCIPLINE_SYNC_MAX_DAYS - 1));
    const oldestKey = toDateKey(oldest);

    const days = Object.entries(disciplineStatuses)
      .filter(([dateKey]) => dateKey <= todayKey && dateKey >= oldestKey)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, status]) => ({ date, status }));

    // Boş dizi geçerlidir: yükleme başarıyla bittikten sonra gerçekten boşsa
    // paylaşım penceresini temizler. Bu yüzden erken `return` yoktur.
    queueRef.current?.enqueue({
      clientToday: todayKey,
      days,
      signature: buildSnapshotSignature(todayKey, days),
    });
  }, [disciplineStatuses, isWorkoutDataReady, todayKey, userId]);
}
