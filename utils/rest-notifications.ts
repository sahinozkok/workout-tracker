import { Platform } from 'react-native';

const REST_NOTIFICATION_CHANNEL = 'rest-timer';
let pendingRestNotificationId: string | undefined;

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
      name: 'Mola hatırlatıcıları',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
    });
  }

  const existingPermission = await Notifications.getPermissionsAsync();
  if (existingPermission.status === 'granted') return Notifications;

  const requestedPermission = await Notifications.requestPermissionsAsync();
  return requestedPermission.status === 'granted' ? Notifications : undefined;
}

export async function scheduleRestNotification(exerciseName: string, restSeconds: number) {
  const Notifications = await ensureNotificationPermission();
  if (!Notifications) return false;

  if (pendingRestNotificationId) {
    await Notifications.cancelScheduledNotificationAsync(pendingRestNotificationId).catch(() => undefined);
  }

  pendingRestNotificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Mola süren bitti',
      body: `${exerciseName}: sıradaki sete hazırsın.`,
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, restSeconds),
      channelId: REST_NOTIFICATION_CHANNEL,
    },
  });

  return true;
}

export async function cancelRestNotification() {
  const Notifications = await getNotifications();
  if (!Notifications || !pendingRestNotificationId) return;

  await Notifications.cancelScheduledNotificationAsync(pendingRestNotificationId).catch(() => undefined);
  pendingRestNotificationId = undefined;
}
