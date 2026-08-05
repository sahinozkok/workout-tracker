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

import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { WorkoutVisualPicker } from '@/components/workout-visual-picker';
import { ThemeColors } from '@/constants/theme';
import { getWeekdayLabel, WEEKDAY_OPTIONS } from '@/constants/weekdays';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { Weekday, WorkoutDay, WorkoutVisual } from '@/types/workout';
import { DEFAULT_PROGRAM_VISUAL } from '@/utils/workout-visual';

export default function CreateProgramScreen() {
  const { addProgram } = useWorkout();
  const { colors, isDark } = useAppTheme();
  const styles = createStyles(colors);
  const [programName, setProgramName] = useState('');
  const [programVisual, setProgramVisual] = useState<WorkoutVisual>(DEFAULT_PROGRAM_VISUAL);
  const [dayName, setDayName] = useState('');
  const [days, setDays] = useState<WorkoutDay[]>([]);
  const [selectedWeekday, setSelectedWeekday] = useState<Weekday>(new Date().getDay() as Weekday);
  const [isOffDay, setIsOffDay] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  function handleAddDay() {
    const trimmedDayName = dayName.trim() || (isOffDay ? `${getWeekdayLabel(selectedWeekday)} Off Day` : '');

    if (!trimmedDayName) {
      Alert.alert('Gün adı gerekli', 'Örneğin “Push”, “Pull” veya “Full Body” yazabilirsin.');
      return;
    }

    if (days.some((day) => day.scheduledWeekday === selectedWeekday)) {
      Alert.alert('Bu tarih zaten kullanılıyor', `${getWeekdayLabel(selectedWeekday)} için daha önce bir gün ekledin.`);
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

    const nextWeekday = WEEKDAY_OPTIONS.find(
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
      Alert.alert('Program adı gerekli', 'Programına kısa ve anlaşılır bir ad ver.');
      return;
    }

    if (days.length === 0) {
      Alert.alert('En az bir gün ekle', 'Programı kaydetmeden önce bir antrenman günü oluştur.');
      return;
    }

    setIsSaving(true);
    try {
      await addProgram({ name: trimmedProgramName, visual: programVisual, days });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: '/programs', params: { created: '1' } });
    } catch (error) {
      Alert.alert(
        'Program kaydedilemedi',
        error instanceof Error ? error.message : 'Lütfen internet bağlantını kontrol edip tekrar dene.',
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
            <Text style={styles.label}>Program adı</Text>
            <TextInput
              autoFocus
              keyboardAppearance={isDark ? 'dark' : 'light'}
              maxLength={60}
              onChangeText={setProgramName}
              placeholder="Örn. 3 Günlük Full Body"
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              style={styles.input}
              value={programName}
            />
            <Text style={styles.counter}>{programName.length}/60</Text>
          </View>

          <Text style={styles.sectionHeading}>Program simgesi</Text>
          <View style={styles.visualSection}>
            <WorkoutVisualPicker onSelect={setProgramVisual} selectedVisual={programVisual} />
          </View>

          <Text style={styles.sectionHeading}>Antrenman günleri</Text>
          <View style={styles.daysSection}>
            <ScrollView
              contentContainerStyle={styles.weekdayOptions}
              horizontal
              showsHorizontalScrollIndicator={false}>
              {WEEKDAY_OPTIONS.map((option) => {
                const selected = selectedWeekday === option.value;
                const used = days.some((day) => day.scheduledWeekday === option.value);

                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: used }}
                    disabled={used}
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
                placeholder={isOffDay ? 'Boş bırakırsan otomatik ad verilir' : 'Örn. Push veya Bacak'}
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                selectionColor={colors.primary}
                style={[styles.input, styles.dayInput]}
                value={dayName}
              />
              <View style={styles.offDayInline}>
                <Text style={styles.offDayLabel}>Off day</Text>
                <Switch
                  onValueChange={setIsOffDay}
                  thumbColor={colors.onPrimary}
                  trackColor={{ false: colors.inputBorder, true: colors.primary }}
                  value={isOffDay}
                />
              </View>
              <Pressable
                accessibilityLabel="Antrenman günü ekle"
                accessibilityRole="button"
                onPress={handleAddDay}
                style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}>
                <Ionicons name="add" size={24} color={colors.onPrimary} />
              </Pressable>
            </View>

            {days.length === 0 ? (
              <View style={styles.emptyDays}>
                <Ionicons name="calendar-outline" size={24} color={colors.textTertiary} />
                <Text style={styles.emptyDaysText}>Henüz antrenman günü eklemedin.</Text>
              </View>
            ) : (
              <View style={styles.dayList}>
                {days.map((day, index) => (
                  <View key={day.id} style={styles.dayCard}>
                    <View style={styles.dayNumber}>
                      <WorkoutVisualDisplay
                        color={colors.accentText}
                        size={22}
                        visual={day.visual ?? { type: 'text', text: String(index + 1) }}
                      />
                    </View>
                    <Text style={styles.dayName}>{day.name}</Text>
                    <View style={styles.daySchedule}>
                      <Text style={styles.dayScheduleText}>{getWeekdayLabel(day.scheduledWeekday)}</Text>
                      {day.isOffDay && <Text style={styles.offDayBadge}>OFF DAY</Text>}
                    </View>
                    <Pressable
                      accessibilityLabel={`${day.name} gününü kaldır`}
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
          <Text style={styles.buttonText}>{isSaving ? 'Kaydediliyor…' : 'Programı kaydet'}</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    container: { flex: 1 },
    content: { gap: 22, padding: 20, paddingBottom: 24 },
    formSection: { backgroundColor: colors.surface, gap: 6, padding: 10 },
    label: { color: colors.text, fontSize: 12, fontWeight: '800' },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: 10,
      borderWidth: 1,
      color: colors.text,
      fontSize: 14,
      paddingHorizontal: 13,
      paddingVertical: 12,
    },
    counter: { color: colors.textTertiary, fontSize: 10, textAlign: 'right' },
    sectionHeading: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: 18,
      fontWeight: '900',
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    visualSection: { paddingHorizontal: 1, paddingBottom: 8 },
    daysSection: { gap: 16, paddingHorizontal: 1 },
    weekdayOptions: { gap: 6, paddingRight: 8 },
    weekdayOption: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 8,
      borderWidth: 1,
      justifyContent: 'center',
      minWidth: 40,
      paddingHorizontal: 9,
      paddingVertical: 8,
    },
    weekdayOptionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    weekdayOptionUsed: { opacity: 0.3 },
    weekdayOptionText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
    weekdayOptionTextSelected: { color: colors.onPrimary },
    addDayRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    dayInput: { flex: 1, minWidth: 105 },
    offDayInline: { alignItems: 'center', flexDirection: 'row', gap: 4 },
    offDayLabel: { color: colors.text, fontSize: 15, fontWeight: '900' },
    addButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      height: 44,
      justifyContent: 'center',
      width: 42,
    },
    emptyDays: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 10,
      gap: 8,
      marginHorizontal: 14,
      padding: 24,
    },
    emptyDaysText: { color: colors.textSecondary, fontSize: 12 },
    dayList: { gap: 8 },
    dayCard: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 9,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      padding: 11,
    },
    dayNumber: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: 7,
      height: 32,
      justifyContent: 'center',
      width: 32,
    },
    dayName: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '800' },
    daySchedule: { alignItems: 'flex-end', gap: 2 },
    dayScheduleText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
    offDayBadge: { color: colors.disciplineCompleted, fontSize: 8, fontWeight: '900' },
    button: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 9,
      margin: 18,
      marginTop: 7,
      height: 50,
      justifyContent: 'center',
      paddingVertical: 0,
    },
    buttonPressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
    buttonDisabled: { opacity: 0.58 },
    buttonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '900' },
  });
}
