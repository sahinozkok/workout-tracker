import { Weekday } from '@/types/workout';

/**
 * Haftalık antrenman hatırlatıcısı — YEREL bildirim tanımı.
 *
 * Epoch timestamp SAKLANMAZ: saat dilimi/DST değişiminde kaymaması için yalnızca
 * `weekday + hour + minute` bileşenleri tutulur ve işletim sistemine haftalık
 * tekrarlı trigger olarak verilir.
 */
export type WorkoutReminder = {
  id: string;
  /** En az bir gün; benzersiz ve Pazartesi→Pazar sıralı tutulur. */
  weekdays: Weekday[];
  hour: number;
  minute: number;
  enabled: boolean;
  /** Her seçili gün için işletim sistemine planlanan bildirim kimlikleri. */
  notificationIds: string[];
};

/** Editör taslağı — henüz `id`/`notificationIds` atanmamıştır. */
export type WorkoutReminderDraft = {
  weekdays: Weekday[];
  hour: number;
  minute: number;
  enabled: boolean;
};
