import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useFeatureColor } from '@/hooks/use-feature-colors';
import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { WorkoutVisualPicker } from '@/components/workout-visual-picker';
import { ThemeColors } from '@/constants/theme';
import { getWeekdayLabel, getWeekdayOptions } from '@/constants/weekdays';
import { useTranslation } from '@/context/language-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { Weekday, WorkoutDay, WorkoutVisual } from '@/types/workout';
import { DEFAULT_PROGRAM_VISUAL } from '@/utils/workout-visual';

const PROGRAM_CREATE_ACCENT = '#A56BEF';

export default function CreateProgramScreen() {
  const { addProgram } = useWorkout();
  const { colors, isDark } = useAppTheme();
  // Hazır gün ikonlarının vurgusu Workout Days presetinden gelir.
  const workoutDaysIconColor = useFeatureColor('workoutDays', colors.accentText).color;
  const { locale, t } = useTranslation();
  const weekdayOptions = getWeekdayOptions(locale);
  const styles = createStyles(colors);
  const [programName, setProgramName] = useState('');
  const [programVisual, setProgramVisual] = useState<WorkoutVisual>(DEFAULT_PROGRAM_VISUAL);
  const [dayName, setDayName] = useState('');
  const [days, setDays] = useState<WorkoutDay[]>([]);
  const [selectedWeekday, setSelectedWeekday] = useState<Weekday>(new Date().getDay() as Weekday);
  const [isOffDay, setIsOffDay] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  function handleAddDay() {
    // Otomatik ad YALNIZCA oluşturma anında, aktif dile göre üretilir.
    // Kullanıcının kendi yazdığı adlar dil değişince yeniden yazılmaz.
    const trimmedDayName =
      dayName.trim() ||
      (isOffDay ? t('createProgram.autoOffDayName', { weekday: getWeekdayLabel(selectedWeekday, locale) }) : '');

    if (!trimmedDayName) {
      Alert.alert(t('day.dayNameRequiredTitle'), t('day.dayNameRequiredBody'));
      return;
    }

    if (days.some((day) => day.scheduledWeekday === selectedWeekday)) {
      Alert.alert(t('day.weekdayUsedTitle'), t('day.weekdayUsedBody', { weekday: getWeekdayLabel(selectedWeekday, locale) }));
      return;
    }

    const newDay: WorkoutDay = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: trimmedDayName,
      visual: { type: 'text', text: String(days.length + 1) },
      scheduledWeekday: selectedWeekday,
      isOffDay,
      exercises: [],
    };

    setDays((currentDays) => [...currentDays, newDay]);
    void Haptics.selectionAsync();
    setDayName('');
    setIsOffDay(false);

    const nextWeekday = weekdayOptions.find(
      (option) => ![...days, newDay].some((day) => day.scheduledWeekday === option.value),
    );
    if (nextWeekday) setSelectedWeekday(nextWeekday.value);
  }

  function handleRemoveDay(dayId: string) {
    setDays((currentDays) => currentDays.filter((day) => day.id !== dayId));
  }

  async function handleSave() {
    const trimmedProgramName = programName.trim();

    if (!trimmedProgramName) {
      Alert.alert(t('programDetail.nameRequiredTitle'), t('programDetail.nameRequiredBody'));
      return;
    }

    if (days.length === 0) {
      Alert.alert(t('createProgram.atLeastOneDay'), t('createProgram.atLeastOneDayBody'));
      return;
    }

    setIsSaving(true);
    try {
      await addProgram({ name: trimmedProgramName, visual: programVisual, days });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: '/programs', params: { created: '1' } });
    } catch (error) {
      Alert.alert(
        t('programDetail.updateFailed'),
        error instanceof Error ? error.message : t('common.networkError'),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.formSection}>
            <Text style={styles.label}>{t('programDetail.programName')}</Text>
            <TextInput
              autoFocus
              keyboardAppearance={isDark ? 'dark' : 'light'}
              maxLength={60}
              onChangeText={setProgramName}
              placeholder={t('createProgram.programNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={PROGRAM_CREATE_ACCENT}
              style={[styles.input, styles.programNameInput]}
              value={programName}
            />
            <Text style={styles.counter}>{programName.length}/60</Text>
          </View>

          <Text style={styles.sectionHeading}>{t('createProgram.programIcon')}</Text>
          <View style={styles.visualSection}>
            <WorkoutVisualPicker
              onSelect={setProgramVisual}
              selectedVisual={programVisual}
              variant="programCreate"
            />
          </View>

          <Text style={styles.sectionHeading}>{t('programDetail.workoutDays')}</Text>
          <View style={styles.daysSection}>
            <ScrollView
              contentContainerStyle={styles.weekdayOptions}
              horizontal
              showsHorizontalScrollIndicator={false}>
              {weekdayOptions.map((option) => {
                const selected = selectedWeekday === option.value;
                const used = days.some((day) => day.scheduledWeekday === option.value);

                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: used }}
                    disabled={used}
                    hitSlop={4}
                    key={option.value}
                    onPress={() => setSelectedWeekday(option.value)}
                    style={[
                      styles.weekdayOption,
                      selected && styles.weekdayOptionSelected,
                      used && styles.weekdayOptionUsed,
                    ]}>
                    <Text style={[styles.weekdayOptionText, selected && styles.weekdayOptionTextSelected]}>
                      {option.shortLabel}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.addDayRow}>
              <TextInput
                keyboardAppearance={isDark ? 'dark' : 'light'}
                maxLength={30}
                onChangeText={setDayName}
                onSubmitEditing={handleAddDay}
                placeholder={isOffDay ? t('createProgram.dayNamePlaceholderAuto') : t('createProgram.dayNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                selectionColor={PROGRAM_CREATE_ACCENT}
                style={[styles.input, styles.dayInput]}
                value={dayName}
              />
              <View style={styles.offDayInline}>
                <Text style={styles.offDayLabel}>{t('day.offDay')}</Text>
                <Switch
                  onValueChange={setIsOffDay}
                  style={styles.offDaySwitch}
                  thumbColor={colors.onPrimary}
                  trackColor={{ false: colors.inputBorder, true: PROGRAM_CREATE_ACCENT }}
                  value={isOffDay}
                />
              </View>
              <Pressable
                accessibilityLabel={t('a11y.addDay')}
                accessibilityRole="button"
                hitSlop={4}
                onPress={handleAddDay}
                style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}>
                <Ionicons name="add" size={22} color="#111113" />
              </Pressable>
            </View>

            {days.length === 0 ? (
              <View style={styles.emptyDays}>
                <Text style={styles.emptyDaysText}>{t('createProgram.noDaysYet')}</Text>
              </View>
            ) : (
              <View style={styles.dayList}>
                {days.map((day, index) => (
                  <View key={day.id} style={styles.dayCard}>
                    <View style={styles.dayNumber}>
                      <WorkoutVisualDisplay
                        color={colors.accentText}
                        iconColor={workoutDaysIconColor}
                        size={22}
                        visual={day.visual ?? { type: 'text', text: String(index + 1) }}
                      />
                    </View>
                    <Text style={styles.dayName}>{day.name}</Text>
                    <View style={styles.daySchedule}>
                      <Text style={styles.dayScheduleText}>{getWeekdayLabel(day.scheduledWeekday, locale)}</Text>
                      {day.isOffDay && <Text style={styles.offDayBadge}>{t('createProgram.offDayBadge')}</Text>}
                    </View>
                    <Pressable
                      accessibilityLabel={t('a11y.removeDay', { name: day.name })}
                      accessibilityRole="button"
                      hitSlop={10}
                      onPress={() => handleRemoveDay(day.id)}>
                      <Ionicons name="trash-outline" size={19} color={colors.danger} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          disabled={isSaving}
          onPress={() => void handleSave()}
          style={({ pressed }) => [styles.button, isSaving && styles.buttonDisabled, pressed && styles.buttonPressed]}>
          <Text style={styles.buttonText}>{isSaving ? t('common.saving') : t('a11y.saveProgram')}</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    container: { flex: 1 },
    content: { padding: 20, paddingBottom: 24, paddingTop: 24 },
    formSection: { gap: 4, marginBottom: 36 },
    label: {
      color: colors.textTertiary,
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 1.6,
      textTransform: 'uppercase',
    },
    input: {
      backgroundColor: 'transparent',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRadius: 0,
      color: colors.text,
      fontSize: 15,
      minHeight: 40,
      paddingHorizontal: 0,
      paddingVertical: 8,
    },
    programNameInput: { fontSize: 24, minHeight: 56, paddingVertical: 8 },
    counter: { color: colors.textTertiary, fontSize: 10, marginTop: 2, textAlign: 'right' },
    sectionHeading: {
      color: colors.textTertiary,
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 1.6,
      textTransform: 'uppercase',
    },
    visualSection: { marginBottom: 36, marginTop: 12 },
    daysSection: { marginTop: 14 },
    weekdayOptions: { gap: 8, paddingRight: 2 },
    weekdayOption: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderColor: colors.separator,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      height: 36,
      justifyContent: 'center',
      minWidth: 40,
      paddingHorizontal: 10,
    },
    weekdayOptionSelected: { backgroundColor: PROGRAM_CREATE_ACCENT, borderColor: PROGRAM_CREATE_ACCENT },
    weekdayOptionUsed: { opacity: 0.28 },
    weekdayOptionText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    weekdayOptionTextSelected: { color: '#111113' },
    addDayRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 20 },
    dayInput: { flex: 1, minWidth: 92 },
    offDayInline: { alignItems: 'center', flexDirection: 'row', gap: 4 },
    offDayLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
    offDaySwitch: { marginHorizontal: -5, transform: [{ scale: 0.8 }] },
    addButton: {
      alignItems: 'center',
      backgroundColor: PROGRAM_CREATE_ACCENT,
      borderRadius: 999,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    emptyDays: {
      alignItems: 'center',
      marginTop: 24,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    emptyDaysText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center' },
    dayList: { marginTop: 20 },
    dayCard: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 10,
      minHeight: 52,
      paddingHorizontal: 2,
      paddingVertical: 10,
    },
    dayNumber: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: 7,
      height: 32,
      justifyContent: 'center',
      width: 32,
    },
    dayName: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '500' },
    daySchedule: { alignItems: 'flex-end', gap: 2 },
    dayScheduleText: { color: colors.textSecondary, fontSize: 10, fontWeight: '500' },
    offDayBadge: { color: colors.disciplineCompleted, fontSize: 8, fontWeight: '600' },
    button: {
      alignItems: 'center',
      backgroundColor: PROGRAM_CREATE_ACCENT,
      borderRadius: 999,
      height: 48,
      justifyContent: 'center',
      margin: 20,
      marginTop: 8,
    },
    buttonPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
    buttonDisabled: { opacity: 0.58 },
    buttonText: { color: '#111113', fontSize: 16, fontWeight: '700' },
  });
}
