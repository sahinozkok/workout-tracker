import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ACTIVITY_TIMER_KEY_PREFIX,
  ActivityTimerState,
  getActivityTimerStorageKey,
  parseStoredActivityTimer,
} from '@/utils/activity-timer';

/**
 * Kardiyo kronometresi kalıcılığı.
 *
 * Mola sayacıyla AYNI kuyruk/geçersizleştirme desenini kullanır ama tamamen
 * AYRI bir ön ekte yaşar (`workout-activity-timer:` ↔ `workout-rest-timer:`).
 * İki modülün toplu temizliği kendi ön ekini filtrelediği için birbirinin
 * kaydını ASLA silmez.
 *
 * Anahtar `sessionId + programExerciseId` içerir: aynı oturumda başka bir
 * kardiyo egzersizine geçmek çalışan ölçümü ezmez, kendi anahtarında durur.
 */
export { ACTIVITY_TIMER_KEY_PREFIX, getActivityTimerStorageKey };

let operationQueue: Promise<unknown> = Promise.resolve();
let invalidationGeneration = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(task, task);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function loadActivityTimer(storageKey: string) {
  return await enqueue(async () => parseStoredActivityTimer(await AsyncStorage.getItem(storageKey)));
}

/** Kaydı yazar; araya giren bir temizleme olduysa yazma atlanır. */
export async function saveActivityTimer(storageKey: string, timer: ActivityTimerState) {
  const generation = invalidationGeneration;

  await enqueue(async () => {
    if (generation !== invalidationGeneration) return;
    await AsyncStorage.setItem(storageKey, JSON.stringify(timer));
  });
}

/**
 * Kaydı siler. `expectedTimerId` verilirse yalnızca aynı ölçüm hâlâ kayıtlıysa
 * silinir; geç biten eski bir silme yeni ölçümü kaldıramaz.
 */
export async function removeActivityTimer(storageKey: string, expectedTimerId?: string) {
  await enqueue(async () => {
    if (expectedTimerId) {
      const current = parseStoredActivityTimer(await AsyncStorage.getItem(storageKey));
      if (current && current.timerId !== expectedTimerId) return;
    }
    await AsyncStorage.removeItem(storageKey);
  });
}

/**
 * Bildirim kimliğini yalnızca aynı `timerId` hâlâ kayıtlıysa ekler.
 * `false` dönerse bildirim artık geçersizdir ve iptal edilmelidir.
 */
export async function attachActivityNotificationId(
  storageKey: string,
  timerId: string,
  expectedStartedAt: number | undefined,
  notificationId: string,
): Promise<boolean> {
  const generation = invalidationGeneration;

  return await enqueue(async () => {
    if (generation !== invalidationGeneration) return false;

    const current = parseStoredActivityTimer(await AsyncStorage.getItem(storageKey));
    if (
      !current ||
      current.timerId !== timerId ||
      current.status !== 'running' ||
      current.startedAt !== expectedStartedAt
    ) {
      return false;
    }

    await AsyncStorage.setItem(storageKey, JSON.stringify({ ...current, notificationId }));
    return true;
  });
}

/**
 * Bu oturuma ait BAŞKA kardiyo kronometrelerini bulur.
 *
 * Aynı antrenman oturumunda aynı anda yalnızca BİR ölçüm çalışabilir; yeni bir
 * egzersizde başlatmadan önce çağıran taraf bunları görüp kullanıcıya sorar.
 * Çalışan ölçüm sessizce çöpe atılmaz.
 */
export async function findSessionActivityTimers(sessionId: string, exceptExerciseId?: string) {
  return await enqueue(async () => {
    const keys = await AsyncStorage.getAllKeys();
    const sessionPrefix = `${ACTIVITY_TIMER_KEY_PREFIX}:${sessionId}:`;
    const matching = keys.filter(
      (key) => key.startsWith(sessionPrefix) && key !== `${sessionPrefix}${exceptExerciseId ?? ''}`,
    );
    if (matching.length === 0) return [];

    const entries = await AsyncStorage.multiGet(matching);
    return entries.flatMap(([key, value]) => {
      const timer = parseStoredActivityTimer(value);
      return timer ? [{ storageKey: key, timer }] : [];
    });
  });
}

/**
 * YALNIZCA bu ön eke sahip kronometre kayıtlarını siler. Mola kayıtları,
 * profil, tema ve dil verilerine dokunulmaz. Logout / hesap değişiminde çağrılır.
 */
export async function clearAllActivityTimers() {
  invalidationGeneration += 1;

  await enqueue(async () => {
    const keys = await AsyncStorage.getAllKeys();
    const activityKeys = keys.filter((key) => key.startsWith(`${ACTIVITY_TIMER_KEY_PREFIX}:`));
    if (activityKeys.length === 0) return;

    await AsyncStorage.multiRemove(activityKeys);
  });
}
