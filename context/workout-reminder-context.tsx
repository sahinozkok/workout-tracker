import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@/context/auth-context';
import { useTranslation } from '@/context/language-context';
import { WorkoutReminder, WorkoutReminderDraft } from '@/types/reminders';
import { Weekday } from '@/types/workout';
import {
  MAX_REMINDERS,
  ReminderValidationError,
  normalizeWeekdays,
  sortReminders,
  validateReminderSave,
} from '@/utils/workout-reminder-core';
import {
  cancelAllReminderNotifications,
  cancelReminderIds,
  createReminderId,
  ensureReminderPermission,
  hasReminderPermission,
  loadReminders,
  saveReminders,
  scheduleReminderNotifications,
} from '@/utils/workout-reminders';

export type ReminderSaveError = ReminderValidationError | 'permission_denied' | 'schedule_failed';

export type ReminderSaveResult =
  | { ok: true }
  | { ok: false; reason: ReminderSaveError; conflictWeekday?: Weekday };

type WorkoutReminderContextValue = {
  reminders: WorkoutReminder[];
  isLoading: boolean;
  maxReminders: number;
  saveReminder: (draft: WorkoutReminderDraft, editingId?: string) => Promise<ReminderSaveResult>;
  toggleReminder: (id: string, enabled: boolean) => Promise<ReminderSaveResult>;
  deleteReminder: (id: string) => Promise<ReminderSaveResult>;
};

const WorkoutReminderContext = createContext<WorkoutReminderContextValue | undefined>(undefined);

export function WorkoutReminderProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const userId = user?.id;

  const [reminders, setReminders] = useState<WorkoutReminder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const mutationInFlightRef = useRef(false);

  /**
   * SAHİPLİK GUARD'I. Hesap değişince ANINDA güncellenir; her async yol yazmadan
   * önce bunu kontrol eder, böylece eski hesabın geç gelen cevabı yeni hesabın
   * state'ini ezemez. Sağlayıcı `key={user.id}` ile zaten remount edilir; bu ref
   * o dosyaya bağımlı kalmamak içindir.
   */
  const ownerRef = useRef<string | undefined>(userId);
  useEffect(() => {
    ownerRef.current = userId;
  }, [userId]);

  const notificationContent = useCallback(
    () => ({ title: t('reminders.notificationTitle'), body: t('reminders.notificationBody') }),
    [t],
  );

  /** Bir kullanıcıya ait bildirimleri güncel tanımla uzlaştırır (izin varsa). */
  const reconcileOnLoad = useCallback(
    async (ownerId: string, loaded: WorkoutReminder[]) => {
      const enabled = loaded.filter((reminder) => reminder.enabled);
      if (enabled.length === 0) return loaded;
      // İzin İSTENMEZ; yalnız zaten verilmişse yeniden planlanır.
      if (!(await hasReminderPermission())) return loaded;

      const Notifications = await ensureReminderPermission();
      if (!Notifications || ownerRef.current !== ownerId) return loaded;

      const content = notificationContent();
      const createdIds: string[] = [];

      try {
        const reconciled: WorkoutReminder[] = [];
        for (const reminder of loaded) {
          if (!reminder.enabled) {
            reconciled.push({ ...reminder, notificationIds: [] });
            continue;
          }
          const notificationIds = await scheduleReminderNotifications(
            Notifications,
            reminder,
            ownerId,
            content,
          );
          createdIds.push(...notificationIds);
          reconciled.push({ ...reminder, notificationIds });
        }

        if (ownerRef.current !== ownerId) {
          await cancelReminderIds(createdIds);
          return loaded;
        }

        // Önce yeni kimlikleri kalıcılaştır. Yazma başarısızsa yeni planları
        // temizleyip eski tanım + eski işletim sistemi planını koruruz.
        await saveReminders(ownerId, reconciled);
        await cancelReminderIds(loaded.flatMap((reminder) => reminder.notificationIds));
        return reconciled;
      } catch {
        await cancelReminderIds(createdIds);
        return loaded;
      }
    },
    [notificationContent],
  );

  useEffect(() => {
    if (!userId) {
      setReminders([]);
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);

    void (async () => {
      const loaded = await loadReminders(userId).catch(() => []);
      if (!active || ownerRef.current !== userId) return;
      const reconciled = await reconcileOnLoad(userId, loaded);
      if (active && ownerRef.current === userId) {
        setReminders(sortReminders(reconciled));
        setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [reconcileOnLoad, userId]);

  /**
   * Çıkışta/hesap değişiminde bu kullanıcının PLANLANMIŞ bildirimleri iptal
   * edilir; TANIMLAR kendi anahtarında KALIR. Yalnız kendi `ownerId`'sini
   * hedefler, mola/aktivite bildirimlerine dokunmaz.
   */
  useEffect(() => {
    if (!userId) return;
    return () => {
      void cancelAllReminderNotifications(userId);
    };
  }, [userId]);

  /** Ortak yazma yolu: doğrula → planla → sakla → eski ID'leri iptal et. */
  const persistReminder = useCallback(
    async (
      draft: WorkoutReminderDraft,
      editingId: string | undefined,
    ): Promise<ReminderSaveResult> => {
      const ownerId = userId;
      if (!ownerId) return { ok: false, reason: 'permission_denied' };
      if (mutationInFlightRef.current) return { ok: false, reason: 'schedule_failed' };

      const validation = validateReminderSave(reminders, draft, editingId);
      if (!validation.ok) return validation;

      mutationInFlightRef.current = true;

      try {
        const normalizedDraft = { ...draft, weekdays: normalizeWeekdays(draft.weekdays) };

        const previous = editingId ? reminders.find((item) => item.id === editingId) : undefined;
        const id = previous?.id ?? createReminderId();
        const previousIds = previous?.notificationIds ?? [];

        let notificationIds: string[] = [];

        if (normalizedDraft.enabled) {
          const Notifications = await ensureReminderPermission();
          // İzin reddedildi: AÇIK gibi kaydetme; editördeki seçimler ekranda kalır.
          if (!Notifications) return { ok: false, reason: 'permission_denied' };
          if (ownerRef.current !== ownerId) return { ok: false, reason: 'permission_denied' };

          try {
            notificationIds = await scheduleReminderNotifications(
              Notifications,
              {
                id,
                weekdays: normalizedDraft.weekdays,
                hour: normalizedDraft.hour,
                minute: normalizedDraft.minute,
              },
              ownerId,
              notificationContent(),
            );
          } catch {
            return { ok: false, reason: 'schedule_failed' };
          }
        }

        const nextReminder: WorkoutReminder = {
          id,
          weekdays: normalizedDraft.weekdays,
          hour: normalizedDraft.hour,
          minute: normalizedDraft.minute,
          enabled: normalizedDraft.enabled,
          notificationIds,
        };

        const nextList = sortReminders(
          previous
            ? reminders.map((item) => (item.id === id ? nextReminder : item))
            : [...reminders, nextReminder],
        );

        if (ownerRef.current !== ownerId) {
          await cancelReminderIds(notificationIds);
          return { ok: false, reason: 'schedule_failed' };
        }

        try {
          // Kalıcı kayıt başarısızsa yeni planı geri al; eski plan hâlâ durur.
          await saveReminders(ownerId, nextList);
        } catch {
          await cancelReminderIds(notificationIds);
          return { ok: false, reason: 'schedule_failed' };
        }

        await cancelReminderIds(previousIds);
        if (ownerRef.current === ownerId) setReminders(nextList);
        else await cancelReminderIds(notificationIds);
        return { ok: true };
      } finally {
        mutationInFlightRef.current = false;
      }
    },
    [notificationContent, reminders, userId],
  );

  const saveReminder = useCallback(
    (draft: WorkoutReminderDraft, editingId?: string) => persistReminder(draft, editingId),
    [persistReminder],
  );

  const toggleReminder = useCallback(
    (id: string, enabled: boolean): Promise<ReminderSaveResult> => {
      const target = reminders.find((item) => item.id === id);
      if (!target) return Promise.resolve({ ok: true });
      return persistReminder(
        { weekdays: target.weekdays, hour: target.hour, minute: target.minute, enabled },
        id,
      );
    },
    [persistReminder, reminders],
  );

  const deleteReminder = useCallback(
    async (id: string) => {
      const ownerId = userId;
      if (!ownerId) return { ok: false, reason: 'schedule_failed' } as const;
      if (mutationInFlightRef.current) return { ok: false, reason: 'schedule_failed' } as const;
      mutationInFlightRef.current = true;

      try {
        const target = reminders.find((item) => item.id === id);
        const nextList = reminders.filter((item) => item.id !== id);
        if (ownerRef.current !== ownerId) return { ok: false, reason: 'schedule_failed' } as const;
        try {
          await saveReminders(ownerId, nextList);
        } catch {
          return { ok: false, reason: 'schedule_failed' } as const;
        }
        if (target) await cancelReminderIds(target.notificationIds);
        if (ownerRef.current === ownerId) setReminders(nextList);
        return { ok: true } as const;
      } finally {
        mutationInFlightRef.current = false;
      }
    },
    [reminders, userId],
  );

  const value = useMemo(
    () => ({
      reminders,
      isLoading,
      maxReminders: MAX_REMINDERS,
      saveReminder,
      toggleReminder,
      deleteReminder,
    }),
    [deleteReminder, isLoading, reminders, saveReminder, toggleReminder],
  );

  return <WorkoutReminderContext.Provider value={value}>{children}</WorkoutReminderContext.Provider>;
}

export function useWorkoutReminders() {
  const context = useContext(WorkoutReminderContext);
  if (!context) {
    throw new Error('useWorkoutReminders, WorkoutReminderProvider içinde kullanılmalıdır.');
  }
  return context;
}
