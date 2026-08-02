import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProgramDetailScroll } from '@/components/program-detail-scroll';
import ProgramExerciseList from '@/components/program-exercise-list';
import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { WorkoutVisualPicker } from '@/components/workout-visual-picker';
import { ThemeColors } from '@/constants/theme';
import { getWeekdayLabel, WEEKDAY_OPTIONS } from '@/constants/weekdays';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { ProgramExercise, Weekday, WorkoutDay, WorkoutVisual } from '@/types/workout';
import {
  DEFAULT_EXERCISE_VISUAL,
  DEFAULT_PROGRAM_VISUAL,
  getDayVisual,
  getExerciseVisual,
  getProgramVisual,
} from '@/utils/workout-visual';

export default function ProgramDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    programs,
    removeExerciseFromDay,
    reorderDays,
    reorderExercisesInDay,
    updateDay,
    updateExercise,
    updateProgram,
  } = useWorkout();
  const { colors, isDark } = useAppTheme();
  const styles = createStyles(colors);
  const [isProgramEditorOpen, setIsProgramEditorOpen] = useState(false);
  const [programNameDraft, setProgramNameDraft] = useState('');
  const [programVisualDraft, setProgramVisualDraft] = useState<WorkoutVisual>(DEFAULT_PROGRAM_VISUAL);
  const [editingDayId, setEditingDayId] = useState<string | null>(null);
  const [dayNameDraft, setDayNameDraft] = useState('');
  const [dayVisualDraft, setDayVisualDraft] = useState<WorkoutVisual>({ type: 'text', text: '1' });
  const [dayWeekdayDraft, setDayWeekdayDraft] = useState<Weekday>(1);
  const [dayIsOffDraft, setDayIsOffDraft] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [editingExerciseDayId, setEditingExerciseDayId] = useState<string | null>(null);
  const [editingExerciseName, setEditingExerciseName] = useState('');
  const [exerciseVisualDraft, setExerciseVisualDraft] = useState<WorkoutVisual>(DEFAULT_EXERCISE_VISUAL);
  const [targetSetsDraft, setTargetSetsDraft] = useState('3');
  const [targetRepsDraft, setTargetRepsDraft] = useState('8-10');
  const [restSecondsDraft, setRestSecondsDraft] = useState('90');
  const program = programs.find((item) => item.id === id);

  if (!program) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Program bulunamadı' }} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={44} color={colors.textTertiary} />
          <Text style={styles.notFoundTitle}>Bu program artık mevcut değil</Text>
          <Pressable onPress={() => router.replace('/programs')} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Programlara dön</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const currentProgram = program;
  const exerciseCount = currentProgram.days.reduce((total, day) => total + day.exercises.length, 0);

  function openProgramEditor() {
    setProgramNameDraft(currentProgram.name);
    setProgramVisualDraft(getProgramVisual(currentProgram.visual, currentProgram.icon));
    setIsProgramEditorOpen(true);
  }

  function saveProgramChanges() {
    const trimmedName = programNameDraft.trim();
    if (!trimmedName) {
      Alert.alert('Program adı gerekli', 'Programına kısa ve anlaşılır bir ad ver.');
      return;
    }

    updateProgram(currentProgram.id, { name: trimmedName, visual: programVisualDraft });
    setIsProgramEditorOpen(false);
  }

  function openDayEditor(day: WorkoutDay, index: number) {
    setDayNameDraft(day.name);
    setDayVisualDraft(getDayVisual(day.visual, index));
    setDayWeekdayDraft(day.scheduledWeekday ?? WEEKDAY_OPTIONS[index % WEEKDAY_OPTIONS.length].value);
    setDayIsOffDraft(day.isOffDay ?? false);
    setEditingDayId(day.id);
  }

  function saveDayChanges(dayId: string) {
    const trimmedName = dayNameDraft.trim();
    if (!trimmedName) {
      Alert.alert('Gün adı gerekli', 'Örneğin “Push”, “Pull” veya “Bacak” yazabilirsin.');
      return;
    }

    const weekdayAlreadyUsed = currentProgram.days.some(
      (day) => day.id !== dayId && day.scheduledWeekday === dayWeekdayDraft,
    );
    if (weekdayAlreadyUsed) {
      Alert.alert('Bu tarih zaten kullanılıyor', `${getWeekdayLabel(dayWeekdayDraft)} için başka bir program günü var.`);
      return;
    }

    updateDay(currentProgram.id, dayId, {
      isOffDay: dayIsOffDraft,
      name: trimmedName,
      scheduledWeekday: dayWeekdayDraft,
      visual: dayVisualDraft,
    });
    setEditingDayId(null);
  }

  function moveDay(dayIndex: number, direction: -1 | 1) {
    const targetIndex = dayIndex + direction;
    if (targetIndex < 0 || targetIndex >= currentProgram.days.length) return;

    const reorderedDays = [...currentProgram.days];
    [reorderedDays[dayIndex], reorderedDays[targetIndex]] = [
      reorderedDays[targetIndex],
      reorderedDays[dayIndex],
    ];
    reorderDays(currentProgram.id, reorderedDays);
  }

  function openExerciseEditor(dayId: string, exercise: ProgramExercise, exerciseName: string) {
    setEditingExerciseDayId(dayId);
    setEditingExerciseId(exercise.id);
    setEditingExerciseName(exerciseName);
    setExerciseVisualDraft(getExerciseVisual(exercise.visual));
    setTargetSetsDraft(String(exercise.targetSets));
    setTargetRepsDraft(exercise.targetReps);
    setRestSecondsDraft(String(exercise.restSeconds));
  }

  function closeExerciseEditor() {
    setEditingExerciseDayId(null);
    setEditingExerciseId(null);
  }

  function saveExerciseChanges() {
    if (!editingExerciseDayId || !editingExerciseId) return;

    const targetSets = Number(targetSetsDraft);
    const restSeconds = Number(restSecondsDraft);
    const targetReps = targetRepsDraft.trim();

    if (!Number.isInteger(targetSets) || targetSets < 1 || targetSets > 20) {
      Alert.alert('Set sayısını kontrol et', 'Set sayısı 1 ile 20 arasında tam sayı olmalıdır.');
      return;
    }

    if (!/^\d{1,2}(-\d{1,2})?$/.test(targetReps)) {
      Alert.alert('Tekrar hedefini kontrol et', 'Tekrar sayısını “8” veya “8-10” biçiminde yazabilirsin.');
      return;
    }

    if (!Number.isInteger(restSeconds) || restSeconds < 0 || restSeconds > 600) {
      Alert.alert('Dinlenme süresini kontrol et', 'Dinlenme süresi 0 ile 600 saniye arasında olmalıdır.');
      return;
    }

    updateExercise(currentProgram.id, editingExerciseDayId, editingExerciseId, {
      restSeconds,
      targetReps,
      targetSets,
      visual: exerciseVisualDraft,
    });
    closeExerciseEditor();
  }

  function confirmRemoveExercise(dayId: string, exercise: ProgramExercise, exerciseName: string) {
    Alert.alert('Egzersizi kaldır', `${exerciseName} bu antrenman gününden kaldırılsın mı?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Kaldır',
        style: 'destructive',
        onPress: () => removeExerciseFromDay(currentProgram.id, dayId, exercise.id),
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: program.name }} />
      <ProgramDetailScroll
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.summaryCard}>
          <View style={styles.summaryIcon}>
            <WorkoutVisualDisplay
              color={colors.primaryIcon}
              size={30}
              visual={getProgramVisual(program.visual, program.icon)}
            />
          </View>
          <View style={styles.summaryText}>
            <Text style={styles.programName}>{program.name}</Text>
            <Text style={styles.programMeta}>
              {program.days.length} gün · {exerciseCount} egzersiz
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Program adını ve görselini değiştir"
            accessibilityRole="button"
            onPress={openProgramEditor}
            style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
            <Ionicons name="pencil-outline" size={19} color={colors.primaryIcon} />
          </Pressable>
        </View>

        {isProgramEditorOpen && (
          <View style={styles.editorCard}>
            <Text style={styles.editorTitle}>Programı düzenle</Text>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Program adı</Text>
              <TextInput
                autoFocus
                keyboardAppearance={isDark ? 'dark' : 'light'}
                maxLength={60}
                onChangeText={setProgramNameDraft}
                placeholder="Program adı"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                style={styles.input}
                value={programNameDraft}
              />
            </View>
            <WorkoutVisualPicker onSelect={setProgramVisualDraft} selectedVisual={programVisualDraft} />
            <EditorActions
              onCancel={() => setIsProgramEditorOpen(false)}
              onSave={saveProgramChanges}
            />
          </View>
        )}

        <Text style={styles.sectionTitle}>Antrenman günleri</Text>

        <View style={styles.dayList}>
          {program.days.map((day, dayIndex) => {
            const isEditing = editingDayId === day.id;

            return (
              <View key={day.id} style={styles.dayCard}>
                <Pressable
                  accessibilityHint="Yalnızca bu günün egzersizlerini gösterir"
                  accessibilityLabel={`${day.name} gününü aç`}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: '/program/[id]/day/[dayId]',
                      params: { id: program.id, dayId: day.id },
                    })
                  }
                  style={({ pressed }) => [styles.dayHeader, pressed && styles.pressed]}>
                  <View style={styles.dayVisual}>
                    <WorkoutVisualDisplay
                      color={colors.accentText}
                      size={27}
                      visual={getDayVisual(day.visual, dayIndex)}
                    />
                  </View>
                  <View style={styles.dayTitleArea}>
                    <Text style={styles.dayName}>{day.name}</Text>
                    <Text style={styles.dayMeta}>
                      {getWeekdayLabel(day.scheduledWeekday)} ·{' '}
                      {day.isOffDay ? 'Off day' : `${day.exercises.length} egzersiz`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                </Pressable>

                <View style={styles.dayActions}>
                  <ActionButton
                    disabled={dayIndex === 0}
                    icon="arrow-up-outline"
                    label="Yukarı"
                    onPress={() => moveDay(dayIndex, -1)}
                  />
                  <ActionButton
                    disabled={dayIndex === program.days.length - 1}
                    icon="arrow-down-outline"
                    label="Aşağı"
                    onPress={() => moveDay(dayIndex, 1)}
                  />
                  <ActionButton
                    icon="pencil-outline"
                    label="Düzenle"
                    onPress={() => openDayEditor(day, dayIndex)}
                  />
                  {!day.isOffDay && (
                    <Pressable
                      accessibilityLabel={`${day.name} gününe egzersiz ekle`}
                      accessibilityRole="button"
                      onPress={() =>
                        router.push({
                          pathname: '/program/[id]/day/[dayId]/add-exercise',
                          params: { id: program.id, dayId: day.id },
                        })
                      }
                      style={({ pressed }) => [styles.addExerciseButton, pressed && styles.pressed]}>
                      <Ionicons name="add" size={18} color={colors.onPrimary} />
                      <Text style={styles.addExerciseText}>Egzersiz</Text>
                    </Pressable>
                  )}
                </View>

                {isEditing && (
                  <View style={styles.dayEditor}>
                    <Text style={styles.editorTitle}>Günü düzenle</Text>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Gün adı</Text>
                      <TextInput
                        autoFocus
                        keyboardAppearance={isDark ? 'dark' : 'light'}
                        maxLength={30}
                        onChangeText={setDayNameDraft}
                        placeholder="Gün adı"
                        placeholderTextColor={colors.textTertiary}
                        selectionColor={colors.primary}
                        style={styles.input}
                        value={dayNameDraft}
                      />
                    </View>

                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Gerçek takvim günü</Text>
                      <ScrollView
                        contentContainerStyle={styles.weekdayOptions}
                        horizontal
                        showsHorizontalScrollIndicator={false}>
                        {WEEKDAY_OPTIONS.map((option) => {
                          const selected = dayWeekdayDraft === option.value;
                          const usedByOtherDay = currentProgram.days.some(
                            (programDay) =>
                              programDay.id !== day.id && programDay.scheduledWeekday === option.value,
                          );

                          return (
                            <Pressable
                              accessibilityRole="radio"
                              accessibilityState={{ checked: selected, disabled: usedByOtherDay }}
                              disabled={usedByOtherDay}
                              key={option.value}
                              onPress={() => setDayWeekdayDraft(option.value)}
                              style={[
                                styles.weekdayOption,
                                selected && styles.weekdayOptionSelected,
                                usedByOtherDay && styles.weekdayOptionDisabled,
                              ]}>
                              <Text
                                style={[
                                  styles.weekdayOptionText,
                                  selected && styles.weekdayOptionTextSelected,
                                ]}>
                                {option.shortLabel}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>

                    <View style={styles.offDayRow}>
                      <View style={styles.offDayText}>
                        <Text style={styles.label}>Off day</Text>
                        <Text style={styles.offDayCaption}>Planlı gününde takvim otomatik yeşil olur.</Text>
                      </View>
                      <Switch
                        onValueChange={setDayIsOffDraft}
                        thumbColor={colors.onPrimary}
                        trackColor={{ false: colors.inputBorder, true: colors.primary }}
                        value={dayIsOffDraft}
                      />
                    </View>
                    <WorkoutVisualPicker onSelect={setDayVisualDraft} selectedVisual={dayVisualDraft} />
                    <EditorActions onCancel={() => setEditingDayId(null)} onSave={() => saveDayChanges(day.id)} />
                  </View>
                )}

                {!day.isOffDay && editingExerciseDayId === day.id && editingExerciseId && (
                  <View style={styles.exerciseEditor}>
                    <View style={styles.exerciseEditorHeader}>
                      <View style={styles.exerciseEditorHeaderText}>
                        <Text style={styles.editorTitle}>Egzersizi düzenle</Text>
                        <Text style={styles.exerciseEditorName}>{editingExerciseName}</Text>
                      </View>
                      <Pressable
                        accessibilityLabel="Egzersiz düzenlemeyi kapat"
                        accessibilityRole="button"
                        hitSlop={8}
                        onPress={closeExerciseEditor}>
                        <Ionicons name="close" size={22} color={colors.textSecondary} />
                      </Pressable>
                    </View>

                    <View style={styles.exerciseTargetFields}>
                      <ExerciseTargetInput
                        isDark={isDark}
                        label="Set"
                        onChangeText={setTargetSetsDraft}
                        value={targetSetsDraft}
                      />
                      <ExerciseTargetInput
                        isDark={isDark}
                        keyboardType="default"
                        label="Tekrar"
                        onChangeText={setTargetRepsDraft}
                        value={targetRepsDraft}
                      />
                      <ExerciseTargetInput
                        isDark={isDark}
                        label="Dinlenme"
                        onChangeText={setRestSecondsDraft}
                        value={restSecondsDraft}
                      />
                    </View>

                    <WorkoutVisualPicker onSelect={setExerciseVisualDraft} selectedVisual={exerciseVisualDraft} />
                    <EditorActions onCancel={closeExerciseEditor} onSave={saveExerciseChanges} />
                  </View>
                )}

                {!day.isOffDay && (day.exercises.length === 0 ? (
                  <View style={styles.emptyExercises}>
                    <Text style={styles.emptyExercisesText}>Bu güne henüz egzersiz eklenmedi.</Text>
                  </View>
                ) : (
                  <ProgramExerciseList
                    exercises={day.exercises}
                    onEdit={(exercise, exerciseName) => openExerciseEditor(day.id, exercise, exerciseName)}
                    onRemove={(exercise, exerciseName) => confirmRemoveExercise(day.id, exercise, exerciseName)}
                    onReorder={(exercises) => reorderExercisesInDay(program.id, day.id, exercises)}
                  />
                ))}

                {day.isOffDay && (
                  <View style={styles.offDayNotice}>
                    <Ionicons name="moon-outline" size={20} color={colors.disciplineCompleted} />
                    <Text style={styles.offDayNoticeText}>
                      Bu gün dinlenme günü. Tarihi geldiğinde disiplin takvimine otomatik yeşil işlenir.
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ProgramDetailScroll>
    </SafeAreaView>
  );
}

function EditorActions({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);

  return (
    <View style={styles.editorActions}>
      <Pressable
        accessibilityRole="button"
        onPress={onCancel}
        style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
        <Text style={styles.cancelButtonText}>Vazgeç</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onSave}
        style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
        <Ionicons name="checkmark" size={18} color={colors.onPrimary} />
        <Text style={styles.saveButtonText}>Kaydet</Text>
      </Pressable>
    </View>
  );
}

function ActionButton({
  disabled = false,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, disabled && styles.disabled, pressed && styles.pressed]}>
      <Ionicons name={icon} size={16} color={colors.textSecondary} />
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

function ExerciseTargetInput({
  isDark,
  keyboardType = 'number-pad',
  label,
  onChangeText,
  value,
}: {
  isDark: boolean;
  keyboardType?: 'default' | 'number-pad';
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);

  return (
    <View style={styles.exerciseTargetField}>
      <Text style={styles.exerciseTargetLabel}>{label}</Text>
      <TextInput
        keyboardAppearance={isDark ? 'dark' : 'light'}
        keyboardType={keyboardType}
        maxLength={7}
        onChangeText={onChangeText}
        selectionColor={colors.primary}
        style={styles.exerciseTargetInput}
        value={value}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { gap: 18, padding: 20, paddingBottom: 40 },
    notFound: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 30 },
    notFoundTitle: { color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
    primaryButton: { backgroundColor: colors.primary, borderRadius: 13, paddingHorizontal: 18, paddingVertical: 12 },
    primaryButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '800' },
    summaryCard: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 14,
      padding: 16,
    },
    summaryIcon: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 14,
      height: 52,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 52,
    },
    summaryText: { flex: 1 },
    programName: { color: colors.text, fontSize: 21, fontWeight: '800' },
    programMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
    editButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 11,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    editorCard: {
      backgroundColor: colors.surface,
      borderColor: colors.primarySoftBorder,
      borderRadius: 17,
      borderWidth: 1,
      gap: 16,
      padding: 15,
    },
    editorTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
    fieldGroup: { gap: 7 },
    label: { color: colors.text, fontSize: 13, fontWeight: '700' },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: 12,
      borderWidth: 1,
      color: colors.text,
      fontSize: 15,
      paddingHorizontal: 13,
      paddingVertical: 12,
    },
    editorActions: { flexDirection: 'row', gap: 9, justifyContent: 'flex-end' },
    cancelButton: { borderColor: colors.border, borderRadius: 11, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 10 },
    cancelButtonText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
    saveButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 11,
      flexDirection: 'row',
      gap: 5,
      paddingHorizontal: 15,
      paddingVertical: 10,
    },
    saveButtonText: { color: colors.onPrimary, fontSize: 13, fontWeight: '800' },
    sectionTitle: { color: colors.text, fontSize: 19, fontWeight: '800' },
    dayList: { gap: 14 },
    dayCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      overflow: 'hidden',
    },
    dayHeader: { alignItems: 'center', flexDirection: 'row', gap: 11, padding: 14 },
    dayVisual: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: 11,
      height: 42,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 42,
    },
    dayTitleArea: { flex: 1 },
    dayName: { color: colors.text, fontSize: 16, fontWeight: '800' },
    dayMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    dayActions: {
      borderTopColor: colors.border,
      borderTopWidth: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
      padding: 10,
    },
    actionButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 9,
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 8,
    },
    actionButtonText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
    addExerciseButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 9,
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    addExerciseText: { color: colors.onPrimary, fontSize: 11, fontWeight: '800' },
    dayEditor: {
      backgroundColor: colors.surfaceMuted,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      gap: 15,
      padding: 14,
    },
    weekdayOptions: { gap: 7, paddingRight: 4 },
    weekdayOption: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 9,
      borderWidth: 1,
      minWidth: 46,
      paddingHorizontal: 9,
      paddingVertical: 8,
    },
    weekdayOptionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    weekdayOptionDisabled: { opacity: 0.25 },
    weekdayOptionText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
    weekdayOptionTextSelected: { color: colors.onPrimary },
    offDayRow: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 12,
      flexDirection: 'row',
      gap: 10,
      padding: 11,
    },
    offDayText: { flex: 1 },
    offDayCaption: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    exerciseEditor: {
      backgroundColor: colors.surfaceMuted,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      gap: 15,
      padding: 14,
    },
    exerciseEditorHeader: { alignItems: 'flex-start', flexDirection: 'row' },
    exerciseEditorHeaderText: { flex: 1 },
    exerciseEditorName: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
    exerciseTargetFields: { flexDirection: 'row', gap: 8 },
    exerciseTargetField: { flex: 1, gap: 5 },
    exerciseTargetLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
    exerciseTargetInput: {
      backgroundColor: colors.surface,
      borderColor: colors.inputBorder,
      borderRadius: 10,
      borderWidth: 1,
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
      paddingHorizontal: 9,
      paddingVertical: 10,
    },
    emptyExercises: { borderTopColor: colors.border, borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 16 },
    emptyExercisesText: { color: colors.textSecondary, fontSize: 13 },
    offDayNotice: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      flexDirection: 'row',
      gap: 9,
      padding: 14,
    },
    offDayNoticeText: { color: colors.textSecondary, flex: 1, fontSize: 12, lineHeight: 17 },
    disabled: { opacity: 0.3 },
    pressed: { opacity: 0.7 },
  });
}
