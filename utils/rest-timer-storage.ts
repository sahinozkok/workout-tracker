import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseStoredRestTimer, RestTimerState } from '@/utils/rest-timer';

/** Mola sayacı kayıtlarının tek kaynağı; başka dosyada tekrar yazılmaz. */
export const REST_TIMER_KEY_PREFIX = 'workout-rest-timer';

export function getRestTimerStorageKey(programId: string, dayId: string, dateKey: string) {
  return `${REST_TIMER_KEY_PREFIX}:${programId}:${dayId}:${dateKey}`;
}

/**
 * Tüm yazma/silme işlemleri tek bir kuyruktan geçer. Böylece geç biten eski
 * bir yazma, daha sonra sıraya giren yeni kaydın veya silmenin üzerine geçemez.
 */
let operationQueue: Promise<unknown> = Promise.resolve();

/**
 * `clearAllRestTimers()` bu sayacı artırır. Kuyruğa daha önce girmiş işlemler
 * çalışma anında sayacın değiştiğini görür ve kayıt oluşturmaz.
 */
let invalidationGeneration = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(task, task);
  // Kuyruğun kırılmaması için hatalar burada yutulur; sonuç çağırana gider.
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function loadRestTimer(storageKey: string) {
  return await enqueue(async () => parseStoredRestTimer(await AsyncStorage.getItem(storageKey)));
}

/** Yeni molayı yazar; araya giren bir temizleme olduysa yazma atlanır. */
export async function saveRestTimer(storageKey: string, timer: RestTimerState) {
  const generation = invalidationGeneration;

  await enqueue(async () => {
    if (generation !== invalidationGeneration) return;
    await AsyncStorage.setItem(storageKey, JSON.stringify(timer));
  });
}

/**
 * Kaydı siler. `expectedTimerId` verilirse yalnızca aynı mola hâlâ kayıtlıysa
 * silinir; böylece geç biten eski bir silme yeni molayı kaldıramaz.
 */
export async function removeRestTimer(storageKey: string, expectedTimerId?: string) {
  await enqueue(async () => {
    if (expectedTimerId) {
      const current = parseStoredRestTimer(await AsyncStorage.getItem(storageKey));
      if (current && current.timerId !== expectedTimerId) return;
    }
    await AsyncStorage.removeItem(storageKey);
  });
}

/**
 * Bildirim kimliğini yalnızca aynı `timerId` hâlâ kayıtlıysa ekler.
 * Dönen değer `false` ise bildirim artık geçersizdir ve iptal edilmelidir.
 */
export async function attachRestNotificationId(
  storageKey: string,
  timerId: string,
  notificationId: string,
): Promise<boolean> {
  const generation = invalidationGeneration;

  return await enqueue(async () => {
    if (generation !== invalidationGeneration) return false;

    const current = parseStoredRestTimer(await AsyncStorage.getItem(storageKey));
    if (!current || current.timerId !== timerId) return false;

    await AsyncStorage.setItem(storageKey, JSON.stringify({ ...current, notificationId }));
    return true;
  });
}

/**
 * Yalnızca bu ön eke sahip mola kayıtlarını siler; uygulamanın diğer
 * AsyncStorage verilerine (profil, tema, dil) dokunulmaz. Bekleyen eski
 * işlemler bu çağrıdan sonra kayıt oluşturamaz.
 */
export async function clearAllRestTimers() {
  invalidationGeneration += 1;

  await enqueue(async () => {
    const keys = await AsyncStorage.getAllKeys();
    const restTimerKeys = keys.filter((key) => key.startsWith(`${REST_TIMER_KEY_PREFIX}:`));
    if (restTimerKeys.length === 0) return;

    await AsyncStorage.multiRemove(restTimerKeys);
  });
}
