import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TimePicker from '@/components/time-picker';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { getWeekdayShortLabel, WEEKDAY_VALUES } from '@/constants/weekdays';
import { useTranslation } from '@/context/language-context';
import { ReminderSaveResult, useWorkoutReminders } from '@/context/workout-reminder-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { WorkoutReminder } from '@/types/reminders';
import { Weekday } from '@/types/workout';
import { normalizeWeekdays } from '@/utils/workout-reminder-core';

/** `hour:minute` → cihazın 12/24 tercihini izleyen yerel saat metni. */
function formatReminderTime(hour: number, minute: number, locale: string) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

function formatDays(weekdays: readonly Weekday[], locale: string) {
  return weekdays.map((weekday) => getWeekdayShortLabel(weekday, locale)).join(' · ');
}

type EditorState = { id?: string; hour: number; minute: number; weekdays: Weekday[]; enabled: boolean };

export default function RemindersScreen() {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { reminders, isLoading, maxReminders, saveReminder, toggleReminder, deleteReminder } = useWorkoutReminders();

  const [editor, setEditor] = useState<EditorState | undefined>();
  const [editorError, setEditorError] = useState<string>();

  const atLimit = isLoading || reminders.length >= maxReminders;

  function showPermissionAlert() {
    Alert.alert(t('reminders.permissionTitle'), t('reminders.permissionBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('reminders.openSettings'), onPress: () => void Linking.openSettings() },
    ]);
  }

  function messageForError(result: Extract<ReminderSaveResult, { ok: false }>) {
    switch (result.reason) {
      case 'no_days':
        return t('reminders.errorNoDays');
      case 'invalid_time':
        return t('reminders.errorInvalidTime');
      case 'max_reached':
        return t('reminders.errorMaxReached', { count: maxReminders });
      case 'conflict':
        return t('reminders.errorConflict');
      case 'schedule_failed':
        return t('reminders.errorScheduleFailed');
      default:
        return undefined;
    }
  }

  function openNew() {
    const today = new Date().getDay() as Weekday;
    setEditorError(undefined);
    setEditor({ hour: 18, minute: 0, weekdays: [today], enabled: true });
  }

  function openEdit(reminder: WorkoutReminder) {
    setEditorError(undefined);
    setEditor({
      id: reminder.id,
      hour: reminder.hour,
      minute: reminder.minute,
      weekdays: reminder.weekdays,
      enabled: reminder.enabled,
    });
  }

  async function handleToggle(reminder: WorkoutReminder, enabled: boolean) {
    const result = await toggleReminder(reminder.id, enabled);
    if (result.ok) return;
    if (result.reason === 'permission_denied') showPermissionAlert();
    else Alert.alert(t('reminders.navTitle'), messageForError(result) ?? t('common.unknownError'));
  }

  async function handleSave() {
    if (!editor) return;
    const draft = {
      weekdays: normalizeWeekdays(editor.weekdays),
      hour: editor.hour,
      minute: editor.minute,
      enabled: editor.enabled,
    };
    const result = await saveReminder(draft, editor.id);
    if (result.ok) {
      setEditor(undefined);
      setEditorError(undefined);
      return;
    }
    if (result.reason === 'permission_denied') {
      // Seçimler KAYBOLMAZ: editör açık kalır.
      showPermissionAlert();
      return;
    }
    setEditorError(messageForError(result));
  }

  function confirmDelete(id: string) {
    Alert.alert(t('reminders.deleteTitle'), t('reminders.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const result = await deleteReminder(id);
            if (result.ok) setEditor(undefined);
            else Alert.alert(t('reminders.navTitle'), messageForError(result) ?? t('common.unknownError'));
          })();
        },
      },
    ]);
  }

  function toggleEditorDay(weekday: Weekday) {
    setEditorError(undefined);
    setEditor((current) => {
      if (!current) return current;
      const has = current.weekdays.includes(weekday);
      const nextDays = has
        ? current.weekdays.filter((day) => day !== weekday)
        : normalizeWeekdays([...current.weekdays, weekday]);
      return { ...current, weekdays: nextDays };
    });
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={colors.textSecondary} />
          </View>
        ) : reminders.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons color={colors.textTertiary} name="notifications-outline" size={34} />
            <Text style={styles.emptyTitle}>{t('reminders.emptyTitle')}</Text>
            <Text style={styles.emptyBody}>{t('reminders.emptyBody')}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {reminders.map((reminder, index) => (
              <Pressable
                accessibilityLabel={t('reminders.reminderRowA11y', {
                  time: formatReminderTime(reminder.hour, reminder.minute, locale),
                  days: formatDays(reminder.weekdays, locale),
                })}
                accessibilityRole="button"
                key={reminder.id}
                onPress={() => openEdit(reminder)}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && styles.rowDivider,
                  pressed && styles.pressed,
                ]}>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTime, !reminder.enabled && styles.rowMuted]}>
                    {formatReminderTime(reminder.hour, reminder.minute, locale)}
                  </Text>
                  <Text style={styles.rowDays}>{formatDays(reminder.weekdays, locale)}</Text>
                </View>
                <Switch
                  accessibilityLabel={t('reminders.toggleA11y')}
                  onValueChange={(value) => void handleToggle(reminder, value)}
                  thumbColor={undefined}
                  trackColor={{ false: colors.surfaceMuted, true: colors.text }}
                  value={reminder.enabled}
                />
              </Pressable>
            ))}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: atLimit }}
          disabled={atLimit}
          onPress={openNew}
          style={({ pressed }) => [styles.addButton, atLimit && styles.addButtonDisabled, pressed && styles.pressed]}>
          <Ionicons color={atLimit ? colors.textTertiary : colors.background} name="add" size={18} />
          <Text style={[styles.addButtonText, atLimit && styles.addButtonTextDisabled]}>
            {t('reminders.addReminder')}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setEditor(undefined)}
        presentationStyle="pageSheet"
        visible={editor !== undefined}>
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.editorHeader}>
            <Pressable
              accessibilityLabel={t('common.cancel')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setEditor(undefined)}>
              <Text style={styles.editorCancel}>{t('common.cancel')}</Text>
            </Pressable>
            <Text style={styles.editorTitle}>{editor?.id ? t('reminders.editTitle') : t('reminders.newTitle')}</Text>
            <Pressable
              accessibilityLabel={t('common.save')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => void handleSave()}>
              <Text style={styles.editorSave}>{t('common.save')}</Text>
            </Pressable>
          </View>

          {editor && (
            <ScrollView contentContainerStyle={styles.editorContent} showsVerticalScrollIndicator={false}>
              <View style={styles.pickerBox}>
                <TimePicker
                  hour={editor.hour}
                  minute={editor.minute}
                  onChange={(hour, minute) => {
                    setEditorError(undefined);
                    setEditor((current) => (current ? { ...current, hour, minute } : current));
                  }}
                />
              </View>

              <Text style={styles.sectionLabel}>{t('reminders.daysLabel')}</Text>
              <View style={styles.dayRow}>
                {WEEKDAY_VALUES.map((weekday) => {
                  const selected = editor.weekdays.includes(weekday);
                  return (
                    <Pressable
                      accessibilityLabel={getWeekdayShortLabel(weekday, locale)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      key={weekday}
                      onPress={() => toggleEditorDay(weekday)}
                      style={[styles.dayChip, selected && styles.dayChipSelected]}>
                      <Text style={[styles.dayChipText, selected && styles.dayChipTextSelected]}>
                        {getWeekdayShortLabel(weekday, locale)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {editorError && <Text style={styles.editorError}>{editorError}</Text>}

              {editor.id && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => editor.id && confirmDelete(editor.id)}
                  style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
                  <Ionicons color={colors.danger} name="trash-outline" size={16} />
                  <Text style={styles.deleteText}>{t('common.delete')}</Text>
                </Pressable>
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { flexGrow: 1, paddingBottom: 32, paddingHorizontal: Layout.screenPadding, paddingTop: 8 },
    emptyState: { alignItems: 'center', flex: 1, gap: 10, justifyContent: 'center', paddingVertical: 56 },
    emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '600', textAlign: 'center' },
    emptyBody: { color: colors.textSecondary, ...Type.caption, textAlign: 'center' },

    list: {},
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      minHeight: Layout.minTouchSize,
      paddingVertical: 14,
    },
    rowDivider: { borderTopColor: colors.border, borderTopWidth: Layout.hairline },
    rowText: { flex: 1, gap: 2, minWidth: 0 },
    rowTime: { color: colors.text, fontSize: 28, fontVariant: ['tabular-nums'], fontWeight: '400' },
    rowMuted: { color: colors.textTertiary },
    rowDays: { color: colors.textSecondary, ...Type.caption },

    addButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: colors.text,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 8,
      marginTop: 24,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    addButtonDisabled: { backgroundColor: colors.surfaceMuted },
    addButtonText: { color: colors.background, fontSize: 15, fontWeight: '600' },
    addButtonTextDisabled: { color: colors.textTertiary },

    editorHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: Layout.screenPadding,
      paddingVertical: 14,
    },
    editorTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
    editorCancel: { color: colors.textSecondary, fontSize: 15, fontWeight: '400' },
    editorSave: { color: colors.text, fontSize: 15, fontWeight: '600' },
    editorContent: { gap: 20, paddingBottom: 32, paddingHorizontal: Layout.screenPadding, paddingTop: 8 },
    pickerBox: { alignItems: 'center', minHeight: 44 },
    sectionLabel: { color: colors.textSecondary, ...Type.eyebrow, textTransform: 'uppercase' },
    dayRow: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
    dayChip: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: Layout.radiusMedium,
      borderWidth: Layout.hairline,
      flex: 1,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingVertical: 8,
    },
    dayChipSelected: { backgroundColor: colors.text, borderColor: colors.text },
    dayChipText: { color: colors.text, ...Type.caption, fontWeight: '600' },
    dayChipTextSelected: { color: colors.background },
    editorError: { color: colors.danger, ...Type.caption },
    deleteButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
      minHeight: Layout.minTouchSize,
    },
    deleteText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
