import { Platform } from 'react-native';

const REST_NOTIFICATION_CHANNEL = 'rest-timer';
/** Yalnızca bu uygulamanın mola bildirimlerini hedeflemek için kullanılır. */
export const REST_NOTIFICATION_TYPE = 'workout-tracker/rest-timer';

async function getNotifications() {
  if (Platform.OS === 'web') return undefined;
  return import('expo-notifications');
}

export async function configureRestNotifications() {
  const Notifications = await getNotifications();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function ensureNotificationPermission() {
  const Notifications = await getNotifications();
  if (!Notifications) return undefined;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REST_NOTIFICATION_CHANNEL, {
      name: 'Rest timer',
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
 * Mola bitişi için tek bir bildirim planlar ve kimliğini döndürür. Kimlik,
 * aktif mola kaydıyla birlikte saklanır; böylece uygulama kapanıp açılsa da
 * bildirim iptal edilebilir durumda kalır.
 */
export async function scheduleRestNotification(
  restSeconds: number,
  content: { body: string; title: string },
): Promise<string | undefined> {
  const Notifications = await ensureNotificationPermission();
  if (!Notifications) return undefined;

  return await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      data: { type: REST_NOTIFICATION_TYPE },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, restSeconds),
      channelId: REST_NOTIFICATION_CHANNEL,
    },
  });
}

/** Belirli bir mola bildirimini iptal eder. */
export async function cancelRestNotification(notificationId?: string) {
  const Notifications = await getNotifications();
  if (!Notifications || !notificationId) return;

  await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
}

/**
 * Yalnızca bu uygulamanın mola bildirimlerini iptal eder; başka türdeki
 * bildirimler etkilenmez.
 */
export async function cancelAllRestNotifications() {
  const Notifications = await getNotifications();
  if (!Notifications) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    scheduled
      .filter((notification) => notification.content?.data?.type === REST_NOTIFICATION_TYPE)
      .map((notification) =>
        Notifications.cancelScheduledNotificationAsync(notification.identifier).catch(() => undefined),
      ),
  );
}

/** Kaydedilmiş bildirimin işletim sisteminde hâlâ planlı olup olmadığını söyler. */
export async function isRestNotificationScheduled(notificationId?: string) {
  const Notifications = await getNotifications();
  if (!Notifications || !notificationId) return false;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  return scheduled.some((notification) => notification.identifier === notificationId);
}
