import { Platform } from 'react-native';

/**
 * HEDEF SÜRE BİLDİRİMİ — kardiyo kronometresine özgü.
 *
 * Mola bildirimlerinden TAMAMEN AYRIDIR: ayrı kanal, ayrı `type` ve ayrı toplu
 * temizlik. `cancelAllRestNotifications` yalnız kendi `type`'ını filtreler,
 * buradaki `cancelAllActivityTargetNotifications` da öyle; ikisi birbirinin
 * planlı bildirimini ASLA iptal etmez.
 *
 * Bildirim işleyicisi (`setNotificationHandler`) uygulama açılışında
 * `configureRestNotifications()` içinde bir kez kurulur ve global'dir; burada
 * yeniden kurulmaz.
 */

const ACTIVITY_NOTIFICATION_CHANNEL = 'activity-timer';

/** Yalnızca bu uygulamanın hedef süre bildirimlerini hedeflemek için. */
export const ACTIVITY_NOTIFICATION_TYPE = 'workout-tracker/activity-target';

/** `data.kind` — işleyici tarafında mola bildiriminden ayırt etmek için. */
export const ACTIVITY_NOTIFICATION_KIND = 'activity-target';

async function getNotifications() {
  if (Platform.OS === 'web') return undefined;
  return import('expo-notifications');
}

async function ensureNotificationPermission() {
  const Notifications = await getNotifications();
  if (!Notifications) return undefined;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ACTIVITY_NOTIFICATION_CHANNEL, {
      name: 'Activity timer',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
    });
  }

  const existingPermission = await Notifications.getPermissionsAsync();
  if (existingPermission.status === 'granted') return Notifications;

  const requestedPermission = await Notifications.requestPermissionsAsync();
  return requestedPermission.status === 'granted' ? Notifications : undefined;
}

/**
 * Hedef süre dolduğunda tetiklenecek TEK bildirimi planlar.
 *
 * İzin reddedilirse `undefined` döner ve KRONOMETRE NORMAL ÇALIŞMAYA DEVAM
 * EDER: bildirim bir kolaylıktır, ölçümün koşulu değildir.
 */
export async function scheduleActivityTargetNotification(
  remainingSeconds: number,
  content: { body: string; title: string },
  target: { programExerciseId: string; sessionId: string },
): Promise<string | undefined> {
  const Notifications = await ensureNotificationPermission();
  if (!Notifications) return undefined;

  return await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      data: {
        type: ACTIVITY_NOTIFICATION_TYPE,
        kind: ACTIVITY_NOTIFICATION_KIND,
        sessionId: target.sessionId,
        programExerciseId: target.programExerciseId,
      },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, Math.round(remainingSeconds)),
      channelId: ACTIVITY_NOTIFICATION_CHANNEL,
    },
  });
}

/** Belirli bir hedef bildirimini iptal eder. */
export async function cancelActivityTargetNotification(notificationId?: string) {
  const Notifications = await getNotifications();
  if (!Notifications || !notificationId) return;

  await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
}

/**
 * YALNIZCA hedef süre bildirimlerini iptal eder; mola bildirimleri ve başka
 * türler etkilenmez.
 */
export async function cancelAllActivityTargetNotifications() {
  const Notifications = await getNotifications();
  if (!Notifications) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    scheduled
      .filter((notification) => notification.content?.data?.type === ACTIVITY_NOTIFICATION_TYPE)
      .map((notification) =>
        Notifications.cancelScheduledNotificationAsync(notification.identifier).catch(() => undefined),
      ),
  );
}
