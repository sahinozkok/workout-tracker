import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WorkoutVisualPicker } from '@/components/workout-visual-picker';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useWorkout } from '@/context/workout-context';
import { EXERCISES, EXERCISE_MUSCLE_GROUPS, getProgramExerciseName } from '@/data/exercises';
import { useAppTheme } from '@/hooks/use-app-theme';
import { WorkoutVisual } from '@/types/workout';
import { getEquipmentLabel, getMuscleGroupLabel } from '@/utils/exercise-labels';
import { DEFAULT_EXERCISE_VISUAL } from '@/utils/workout-visual';

export default function AddExerciseScreen() {
  const { id, dayId } = useLocalSearchParams<{ id: string; dayId: string }>();
  const { addExerciseToDay, isProgramsLoading, programs } = useWorkout();
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const [search, setSearch] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState(EXERCISE_MUSCLE_GROUPS[0]);
  // Seçim sırası korunur; kullanıcı hangi sırayla seçtiyse o sırayla eklenir.
  const [selectedExerciseIds, setSelectedExerciseIds] = useState<string[]>([]);
  const [targetSets, setTargetSets] = useState('3');
  const [targetReps, setTargetReps] = useState('8-10');
  const [restSeconds, setRestSeconds] = useState('90');
  const [exerciseVisual, setExerciseVisual] = useState<WorkoutVisual>(DEFAULT_EXERCISE_VISUAL);
  const [isSaving, setIsSaving] = useState(false);

  const program = programs.find((item) => item.id === id);
  const day = program?.days.find((item) => item.id === dayId);
  const filteredExercises = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('tr-TR');

    if (!normalizedSearch) return EXERCISES.filter((exercise) => exercise.muscleGroup === selectedMuscleGroup);

    return EXERCISES.filter((exercise) =>
      `${exercise.name} ${exercise.muscleGroup} ${exercise.equipment}`
        .toLocaleLowerCase('tr-TR')
        .includes(normalizedSearch),
    );
  }, [search, selectedMuscleGroup]);

  if (isProgramsLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.notFound}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.notFoundTitle}>{t('addExercise.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!program || !day) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.notFound}>
          <Text style={styles.notFoundTitle}>{t('addExercise.notFound')}</Text>
          <Pressable onPress={() => router.replace('/programs')} style={styles.saveButton}>
            <Text style={styles.saveButtonText}>{t('addExercise.backToPrograms')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const programId = program.id;
  const workoutDay = day;
  const selectedExercises = selectedExerciseIds.flatMap((exerciseId) => {
    const match = EXERCISES.find((exercise) => exercise.id === exerciseId);
    return match ? [match] : [];
  });
  const customExerciseName = search.trim();
  const hasCustomExercise = selectedExercises.length === 0 && customExerciseName.length > 0;
  const selectionCount = selectedExercises.length || (hasCustomExercise ? 1 : 0);

  function toggleExercise(exerciseId: string) {
    setSelectedExerciseIds((current) =>
      current.includes(exerciseId)
        ? current.filter((item) => item !== exerciseId)
        : [...current, exerciseId],
    );
  }

  async function handleSave() {
    // Hızlı çift dokunmada ikinci istek yok sayılır.
    if (isSaving) return;

    const queue = selectedExercises.length
      ? selectedExercises.map((exercise) => ({ exerciseId: exercise.id, name: exercise.name }))
      : customExerciseName
        ? [{ exerciseId: undefined, name: customExerciseName }]
        : [];

    if (queue.length === 0) {
      Alert.alert(t('addExercise.nameRequiredTitle'), t('addExercise.nameRequiredBody'));
      return;
    }

    const parsedSets = Number(targetSets);
    const parsedRestSeconds = Number(restSeconds);
    const trimmedReps = targetReps.trim();

    if (!Number.isInteger(parsedSets) || parsedSets < 1 || parsedSets > 20) {
      Alert.alert(t('addExercise.setsInvalidTitle'), t('addExercise.setsInvalidBody'));
      return;
    }

    if (!/^\d{1,2}(-\d{1,2})?$/.test(trimmedReps)) {
      Alert.alert(t('addExercise.repsInvalidTitle'), t('addExercise.repsInvalidBody'));
      return;
    }

    if (!Number.isInteger(parsedRestSeconds) || parsedRestSeconds < 0 || parsedRestSeconds > 600) {
      Alert.alert(t('addExercise.restInvalidTitle'), t('addExercise.restInvalidBody'));
      return;
    }

    // Mevcut duplicate kuralına saygı: zaten ekli olanlar atlanır.
    const existingNames = new Set(
      workoutDay.exercises.map((exercise) =>
        getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName).toLocaleLowerCase('tr-TR'),
      ),
    );
    const duplicates = queue.filter((item) => existingNames.has(item.name.toLocaleLowerCase('tr-TR')));
    const pending = queue.filter((item) => !existingNames.has(item.name.toLocaleLowerCase('tr-TR')));

    if (pending.length === 0) {
      Alert.alert(t('addExercise.duplicateTitle'), t('addExercise.duplicateBody', { name: queue[0].name }));
      return;
    }

    setIsSaving(true);
    const failed: string[] = [];
    try {
      // Seçim sırası korunarak tek tek eklenir; hata olursa kalanlar denenir
      // ve sonuç kullanıcıya açıkça bildirilir.
      for (const item of pending) {
        try {
          await addExerciseToDay(programId, workoutDay.id, {
            customExerciseName: item.exerciseId ? undefined : item.name,
            exerciseId: item.exerciseId,
            restSeconds: parsedRestSeconds,
            targetReps: trimmedReps,
            targetSets: parsedSets,
            visual: exerciseVisual,
          });
        } catch {
          failed.push(item.name);
        }
      }

      if (failed.length > 0) {
        Alert.alert(
          t('addExercise.addFailed'),
          t('addExercise.partialFailure', { added: pending.length - failed.length, failed: failed.length }),
        );
        setSelectedExerciseIds([]);
        return;
      }

      if (duplicates.length > 0) {
        Alert.alert(
          t('addExercise.duplicateTitle'),
          t('addExercise.duplicateSkipped', { names: duplicates.map((item) => item.name).join(', ') }),
          [{ text: t('common.ok'), onPress: () => router.back() }],
        );
        return;
      }

      router.back();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: t('addExercise.title', { day: day.name }) }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
        style={styles.keyboardView}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View>
            <Text style={styles.title}>{day.name}</Text>
            <Text style={styles.description}>
              {selectionCount > 0
                ? t('addExercise.selectedCount', { count: selectionCount })
                : t('addExercise.searchPlaceholder')}
            </Text>
          </View>

          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={20} color={colors.textTertiary} />
            <TextInput
              autoCapitalize="none"
              keyboardAppearance={isDark ? 'dark' : 'light'}
              onChangeText={setSearch}
              placeholder={t('addExercise.searchPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              style={styles.searchInput}
              value={search}
            />
          </View>

          {customExerciseName && selectedExercises.length === 0 ? (
            <View style={styles.customExerciseNotice}>
              <Ionicons name="create-outline" size={20} color={colors.accentText} />
              <Text style={styles.customExerciseNoticeText}>
                {t('addExercise.customNotice', { name: customExerciseName })}
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.categoryList}
              horizontal
              showsHorizontalScrollIndicator={false}>
              {EXERCISE_MUSCLE_GROUPS.map((muscleGroup) => {
                const selected = muscleGroup === selectedMuscleGroup;

                return (
                  <Pressable
                    key={muscleGroup}
                    onPress={() => setSelectedMuscleGroup(muscleGroup)}
                    style={[styles.categoryChip, selected && styles.categoryChipSelected]}>
                    <Text style={[styles.categoryChipText, selected && styles.categoryChipTextSelected]}>
                      {getMuscleGroupLabel(muscleGroup, t)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.exerciseLibrary}>
            {filteredExercises.map((exercise) => {
              const selected = selectedExerciseIds.includes(exercise.id);

              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  key={exercise.id}
                  onPress={() => toggleExercise(exercise.id)}
                  style={({ pressed }) => [
                    styles.exerciseOption,
                    selected && styles.exerciseOptionSelected,
                    pressed && styles.pressed,
                  ]}>
                  <View style={[styles.exerciseIcon, selected && styles.exerciseIconSelected]}>
                    <Ionicons
                      name="barbell-outline"
                      size={20}
                      color={selected ? colors.onPrimary : colors.primaryIcon}
                    />
                  </View>
                  <View style={styles.exerciseInfo}>
                    <Text style={styles.exerciseName}>{exercise.name}</Text>
                    <Text style={styles.exerciseMeta}>
                      {getMuscleGroupLabel(exercise.muscleGroup, t)} · {getEquipmentLabel(exercise.equipment, t)}
                    </Text>
                  </View>
                  {selected && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                </Pressable>
              );
            })}

            {filteredExercises.length === 0 && (
              <View style={styles.noResults}>
                <Text style={styles.noResultsText}>{t('addExercise.noResults')}</Text>
              </View>
            )}
          </View>

          <View style={styles.targetsCard}>
            <Text style={styles.targetsTitle}>{t('addExercise.targets')}</Text>
            <Text style={styles.targetsDescription}>
              {selectedExercises.length > 0
                ? selectedExercises.map((exercise) => exercise.name).join(', ')
                : customExerciseName || t('addExercise.nameRequiredBody')}
            </Text>

            <View style={styles.targetFields}>
              <TargetInput
                label={t('addExercise.sets')}
                onChangeText={setTargetSets}
                value={targetSets}
                colors={colors}
                isDark={isDark}
              />
              <TargetInput
                keyboardType="default"
                label={t('addExercise.reps')}
                onChangeText={setTargetReps}
                value={targetReps}
                colors={colors}
                isDark={isDark}
              />
              <TargetInput
                label={t('addExercise.rest')}
                onChangeText={setRestSeconds}
                value={restSeconds}
                colors={colors}
                isDark={isDark}
              />
            </View>
          </View>

          <View style={styles.visualCard}>
            <Text style={styles.targetsTitle}>{t('addExercise.visual')}</Text>
            <Text style={styles.targetsDescription}>{t('visualPicker.choosePhoto')}</Text>
            <View style={styles.visualPicker}>
              <WorkoutVisualPicker onSelect={setExerciseVisual} selectedVisual={exerciseVisual} />
            </View>
          </View>
        </ScrollView>

        <View style={styles.actionBar}>
          {selectedExercises.length > 0 && (
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={() => setSelectedExerciseIds([])}
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}>
              <Text style={styles.clearButtonText}>{t('addExercise.clearSelection')}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={isSaving || selectionCount === 0}
            onPress={() => void handleSave()}
            style={({ pressed }) => [
              styles.saveButton,
              (isSaving || selectionCount === 0) && styles.saveButtonDisabled,
              pressed && styles.pressed,
            ]}>
            {isSaving ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.saveButtonText}>
                {hasCustomExercise ? t('addExercise.addCustom') : t('addExercise.addSelected', { count: selectionCount })}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type TargetInputProps = {
  colors: ThemeColors;
  isDark: boolean;
  keyboardType?: 'default' | 'number-pad';
  label: string;
  onChangeText: (value: string) => void;
  value: string;
};

function TargetInput({ colors, isDark, keyboardType = 'number-pad', label, onChangeText, value }: TargetInputProps) {
  const styles = createStyles(colors);

  return (
    <View style={styles.targetField}>
      <Text style={styles.targetLabel}>{label}</Text>
      <TextInput
        keyboardAppearance={isDark ? 'dark' : 'light'}
        keyboardType={keyboardType}
        maxLength={7}
        onChangeText={onChangeText}
        selectionColor={colors.primary}
        style={styles.targetInput}
        value={value}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    keyboardView: { flex: 1 },
    actionBar: {
      alignItems: 'center',
      borderTopColor: colors.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: Layout.screenPadding,
      paddingVertical: 12,
    },
    clearButton: { justifyContent: 'center', minHeight: Layout.minTouchSize, paddingHorizontal: 12 },
    clearButtonText: { color: colors.textSecondary, fontSize: 14 },
    content: { gap: 15, padding: 18, paddingBottom: 30 },
    notFound: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 30 },
    notFoundTitle: { color: colors.text, fontSize: 18, fontWeight: '500', textAlign: 'center' },
    eyebrow: { color: colors.accentBright, fontSize: 12, fontWeight: '500', letterSpacing: 1.1 },
    title: { color: colors.text, fontSize: 27, fontWeight: '500', marginTop: 4 },
    description: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 6 },
    searchContainer: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.inputBorder,
      borderRadius: 9,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 9,
      paddingHorizontal: 14,
    },
    searchInput: { color: colors.text, flex: 1, fontSize: 15, paddingVertical: 14 },
    customExerciseNotice: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
      borderRadius: 9,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 9,
      padding: 12,
    },
    customExerciseNoticeText: { color: colors.accentText, flex: 1, fontSize: 13, lineHeight: 19 },
    categoryList: { gap: 8, paddingRight: 20 },
    categoryChip: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 13,
      paddingVertical: 8,
    },
    categoryChipSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
    categoryChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
    categoryChipTextSelected: { color: colors.primarySoftText },
    exerciseLibrary: { gap: 9 },
    exerciseOption: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 9,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 11,
      padding: 12,
    },
    exerciseOptionSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
    exerciseIcon: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 10,
      height: 38,
      justifyContent: 'center',
      width: 38,
    },
    exerciseIconSelected: { backgroundColor: colors.primary },
    exerciseInfo: { flex: 1 },
    exerciseName: { color: colors.text, fontSize: 14, fontWeight: '500' },
    exerciseMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
    pressed: { opacity: 0.72 },
    noResults: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 9, padding: 20 },
    noResultsText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
    targetsCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      padding: 16,
    },
    targetsTitle: { color: colors.text, fontSize: 18, fontWeight: '500' },
    targetsDescription: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
    visualCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      padding: 16,
    },
    visualPicker: { marginTop: 16 },
    targetFields: { flexDirection: 'row', gap: 9, marginTop: 16 },
    targetField: { flex: 1, gap: 6 },
    targetLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
    targetInput: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: 11,
      borderWidth: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
      paddingHorizontal: 10,
      paddingVertical: 11,
    },
    saveButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      flex: 1,
      justifyContent: 'center',
      minHeight: 50,
    },
    saveButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '500' },
    saveButtonDisabled: { opacity: 0.58 },
  });
}
