import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { WorkoutReminder } from '@/types/reminders';
import { parseStoredReminders, toExpoWeekday } from '@/utils/workout-reminder-core';

/**
 * HATIRLATICI KALICILIĞI + İŞLETİM SİSTEMİ BİLDİRİMLERİ.
 *
 * Mola (`rest-timer`) ve aktivite (`activity-timer`) bildirimlerinden TAMAMEN
 * AYRIDIR: ayrı kanal, ayrı `type` ve YALNIZ kendi `type`'ını (gerekirse
 * `ownerId`) filtreleyen temizlik. Bu modül global notification handler'ı YENİDEN
 * KURMAZ; o `configureRestNotifications()` içinde bir kez kurulur.
 */

/** Reminder bildirimlerini hedeflemek için ayrı tür. */
export const WORKOUT_REMINDER_TYPE = 'workout-tracker/workout-reminder';
/** Ayrı Android kanalı. */
export const WORKOUT_REMINDER_CHANNEL = 'workout-reminders';
/** Bildirime dokununca gidilecek TEK adres. */
export const WORKOUT_REMINDER_URL = '/';

const STORAGE_PREFIX = '@workout-tracker/workout-reminders';

export function getReminderStorageKey(userId: string) {
  return `${STORAGE_PREFIX}:${userId}`;
}

async function getNotifications() {
  if (Platform.OS === 'web') return undefined;
  return import('expo-notifications');
}

// ---------------------------------------------------------------------------
// Depolama — kullanıcıya göre ayrı anahtar, fail-safe okuma
// ---------------------------------------------------------------------------

export async function loadReminders(userId: string): Promise<WorkoutReminder[]> {
  const raw = await AsyncStorage.getItem(getReminderStorageKey(userId)).catch(() => null);
  return parseStoredReminders(raw);
}

export async function saveReminders(userId: string, reminders: WorkoutReminder[]): Promise<void> {
  await AsyncStorage.setItem(getReminderStorageKey(userId), JSON.stringify(reminders));
}

/** Çakışmasız kimlik üreteci — bağımlılıksız. */
export function createReminderId(now = Date.now()) {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// İzin — YALNIZ kaydetme/açma sırasında çağrılır (ekran açılışında değil)
// ---------------------------------------------------------------------------

type NotificationsModule = NonNullable<Awaited<ReturnType<typeof getNotifications>>>;

async function ensureChannel(Notifications: NotificationsModule) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(WORKOUT_REMINDER_CHANNEL, {
      name: 'Workout reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 150, 250],
    });
  }
}

/**
 * İzin ister ve kanalı kurar. İzin verildiyse modülü, aksi hâlde `undefined`
 * döner. Çağıran taraf `undefined` gelince hatırlatıcıyı AÇIK göstermez.
 */
export async function ensureReminderPermission(): Promise<NotificationsModule | undefined> {
  const Notifications = await getNotifications();
  if (!Notifications) return undefined;

  await ensureChannel(Notifications);

  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return Notifications;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted' ? Notifications : undefined;
}

/** İzni İSTEMEDEN yalnız mevcut durumu okur (login uzlaştırması için). */
export async function hasReminderPermission(): Promise<boolean> {
  const Notifications = await getNotifications();
  if (!Notifications) return false;
  const existing = await Notifications.getPermissionsAsync().catch(() => undefined);
  return existing?.status === 'granted';
}

// ---------------------------------------------------------------------------
// Planlama — bir hatırlatıcı için haftalık tekrarlı trigger'lar
// ---------------------------------------------------------------------------

/**
 * Bir hatırlatıcının HER seçili günü için haftalık bildirim planlar ve ID'leri
 * döndürür. ATOMİK: herhangi bir adım başarısız olursa BU çağrıda oluşan yeni
 * ID'ler temizlenir ve hata yükseltilir; çağıran eski planı korur.
 */
export async function scheduleReminderNotifications(
  Notifications: NotificationsModule,
  reminder: Pick<WorkoutReminder, 'id' | 'weekdays' | 'hour' | 'minute'>,
  ownerId: string,
  content: { title: string; body: string },
): Promise<string[]> {
  const createdIds: string[] = [];
  try {
    for (const weekday of reminder.weekdays) {
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: content.title,
          body: content.body,
          data: {
            type: WORKOUT_REMINDER_TYPE,
            ownerId,
            reminderId: reminder.id,
            weekday,
            url: WORKOUT_REMINDER_URL,
          },
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: toExpoWeekday(weekday),
          hour: reminder.hour,
          minute: reminder.minute,
          channelId: WORKOUT_REMINDER_CHANNEL,
        },
      });
      createdIds.push(notificationId);
    }
    return createdIds;
  } catch (error) {
    // Kısmi başarısızlık: BU işlemde oluşan ID'ler geri alınır.
    await cancelReminderNotificationIds(Notifications, createdIds);
    throw error;
  }
}

/** Verilen bildirim kimliklerini iptal eder (yalnız bu ID'ler). */
export async function cancelReminderNotificationIds(
  Notifications: NotificationsModule,
  notificationIds: readonly string[],
): Promise<void> {
  await Promise.all(
    notificationIds.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)),
  );
}

/** İzin/kanal olmadan, mevcut modülle iptal (silme/kapatma için kolaylık). */
export async function cancelReminderIds(notificationIds: readonly string[]): Promise<void> {
  if (notificationIds.length === 0) return;
  const Notifications = await getNotifications();
  if (!Notifications) return;
  await cancelReminderNotificationIds(Notifications, notificationIds);
}

/**
 * YALNIZCA reminder tipindeki bildirimleri iptal eder; `ownerId` verilirse yalnız
 * o kullanıcınınkiler. Mola ve aktivite bildirimlerine ASLA dokunmaz.
 */
export async function cancelAllReminderNotifications(ownerId?: string): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    scheduled
      .filter((notification) => {
        const data = notification.content?.data;
        if (data?.type !== WORKOUT_REMINDER_TYPE) return false;
        return ownerId === undefined || data?.ownerId === ownerId;
      })
      .map((notification) =>
        Notifications.cancelScheduledNotificationAsync(notification.identifier).catch(() => undefined),
      ),
  );
}

// ---------------------------------------------------------------------------
// Bildirime dokunma gözlemcisi — YALNIZ reminder tipi + tam '/' adresi
// ---------------------------------------------------------------------------

/**
 * Reminder bildirimine dokunulduğunda `onOpen()` çağrılır. Soğuk açılıştaki son
 * yanıt da işlenir. Yalnızca kendi `type`'ımız VE tam `'/'` adresi kabul edilir;
 * başka türler veya keyfî URL'ler yok sayılır (açık yönlendirme yapılmaz).
 */
export function addReminderResponseListener(onOpen: () => void): () => void {
  if (Platform.OS === 'web') return () => undefined;

  let subscription: { remove: () => void } | undefined;
  let cancelled = false;

  const isReminderResponse = (response: unknown) => {
    const data = (response as { notification?: { request?: { content?: { data?: Record<string, unknown> } } } })
      ?.notification?.request?.content?.data;
    return data?.type === WORKOUT_REMINDER_TYPE && data?.url === WORKOUT_REMINDER_URL;
  };

  void (async () => {
    const Notifications = await getNotifications();
    if (!Notifications || cancelled) return;

    subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (isReminderResponse(response)) {
        onOpen();
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    });

    // Uygulama bildirime dokunularak SOĞUK açıldıysa son yanıt burada yakalanır.
    const last = await Notifications.getLastNotificationResponseAsync().catch(() => null);
    if (!cancelled && last && isReminderResponse(last)) {
      onOpen();
      await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    }
  })();

  return () => {
    cancelled = true;
    subscription?.remove();
  };
}
