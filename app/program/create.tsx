import { Ionicons } from '@expo/vector-icons';
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

  function handleSave() {
    const trimmedProgramName = programName.trim();

    if (!trimmedProgramName) {
      Alert.alert('Program adı gerekli', 'Programına kısa ve anlaşılır bir ad ver.');
      return;
    }

    if (days.length === 0) {
      Alert.alert('En az bir gün ekle', 'Programı kaydetmeden önce bir antrenman günü oluştur.');
      return;
    }

    addProgram({ name: trimmedProgramName, visual: programVisual, days });
    router.replace('/programs');
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
          <View>
            <Text style={styles.step}>PROGRAM BİLGİLERİ</Text>
            <Text style={styles.title}>İlk programını oluştur</Text>
            <Text style={styles.description}>
              Programına bir ad ver ve haftadaki antrenman günlerini ekle. Egzersizleri bir sonraki aşamada bağlayacağız.
            </Text>
          </View>

          <View style={styles.fieldGroup}>
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

          <View style={styles.fieldGroup}>
            <Text style={styles.sectionTitle}>Program simgesi</Text>
            <Text style={styles.helperText}>İkon, sayı/emoji veya galerinden bir fotoğraf seç.</Text>
            <WorkoutVisualPicker onSelect={setProgramVisual} selectedVisual={programVisual} />
          </View>

          <View style={styles.divider} />

          <View style={styles.fieldGroup}>
            <Text style={styles.sectionTitle}>Antrenman günleri</Text>
            <Text style={styles.helperText}>Her günü gerçek haftadaki bir güne bağla.</Text>

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

            <View style={styles.offDayRow}>
              <View style={styles.offDayText}>
                <Text style={styles.label}>Off day</Text>
                <Text style={styles.helperText}>Bu gün geldiğinde disiplin takviminde yeşil görünür.</Text>
              </View>
              <Switch
                onValueChange={setIsOffDay}
                thumbColor={colors.onPrimary}
                trackColor={{ false: colors.inputBorder, true: colors.primary }}
                value={isOffDay}
              />
            </View>

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
              <Pressable
                accessibilityLabel="Antrenman günü ekle"
                accessibilityRole="button"
                onPress={handleAddDay}
                style={({ pressed }) => [styles.addButton, pressed && styles.buttonPressed]}>
                <Ionicons name="add" size={24} color={colors.onPrimary} />
              </Pressable>
            </View>
          </View>

          {days.length === 0 ? (
            <View style={styles.emptyDays}>
              <Ionicons name="calendar-outline" size={28} color={colors.textTertiary} />
              <Text style={styles.emptyDaysText}>Henüz antrenman günü eklemedin.</Text>
            </View>
          ) : (
            <View style={styles.dayList}>
              {days.map((day, index) => (
                <View key={day.id} style={styles.dayCard}>
                  <View style={styles.dayNumber}>
                    <WorkoutVisualDisplay
                      color={colors.accentText}
                      size={25}
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
                    <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          onPress={handleSave}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
          <Text style={styles.buttonText}>Programı kaydet</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },
  content: { gap: 18, padding: 20, paddingBottom: 28 },
  step: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', marginTop: 4 },
  description: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 8 },
  fieldGroup: { gap: 8 },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  counter: { color: colors.textTertiary, fontSize: 12, textAlign: 'right' },
  divider: { backgroundColor: colors.border, height: 1 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  helperText: { color: colors.textSecondary, fontSize: 13 },
  weekdayOptions: { gap: 7, paddingRight: 8 },
  weekdayOption: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minWidth: 48,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  weekdayOptionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  weekdayOptionUsed: { opacity: 0.28 },
  weekdayOptionText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  weekdayOptionTextSelected: { color: colors.onPrimary },
  offDayRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 13,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  offDayText: { flex: 1, gap: 2 },
  addDayRow: { flexDirection: 'row', gap: 10 },
  dayInput: { flex: 1 },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    justifyContent: 'center',
    width: 54,
  },
  emptyDays: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 16,
    gap: 8,
    padding: 24,
  },
  emptyDaysText: { color: colors.textSecondary, fontSize: 14 },
  dayList: { gap: 10 },
  dayCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  dayNumber: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  dayName: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '700' },
  daySchedule: { alignItems: 'flex-end', gap: 3 },
  dayScheduleText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  offDayBadge: { color: colors.disciplineCompleted, fontSize: 9, fontWeight: '900' },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    margin: 20,
    marginTop: 8,
    paddingVertical: 15,
  },
  buttonPressed: { opacity: 0.78 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' },
  });
}
