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
import { Form, Layout, ThemeColors, Type } from '@/constants/theme';
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
          <Pressable
            onPress={() => router.replace('/programs')}
            style={[styles.saveButton, styles.notFoundButton]}>
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
          <View style={styles.header}>
            <Text style={styles.title}>{day.name}</Text>
            <Text style={styles.description}>
              {selectionCount > 0
                ? t('addExercise.selectedCount', { count: selectionCount })
                : t('addExercise.searchPlaceholder')}
            </Text>
          </View>

          <View style={styles.searchSection}>
            <View style={styles.searchField}>
              <Ionicons name="search-outline" size={17} color={colors.textTertiary} />
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
                <Ionicons name="create-outline" size={15} color={colors.accent} />
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
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      hitSlop={6}
                      key={muscleGroup}
                      onPress={() => setSelectedMuscleGroup(muscleGroup)}
                      style={({ pressed }) => [
                        styles.categoryTab,
                        selected && styles.categoryTabSelected,
                        pressed && styles.pressed,
                      ]}>
                      <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                        {getMuscleGroupLabel(muscleGroup, t)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>

          <View style={styles.exerciseLibrary}>
            {filteredExercises.map((exercise, index) => {
              const selected = selectedExerciseIds.includes(exercise.id);

              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  key={exercise.id}
                  onPress={() => toggleExercise(exercise.id)}
                  style={({ pressed }) => [
                    styles.exerciseOption,
                    index > 0 && styles.rowDivided,
                    pressed && styles.pressed,
                  ]}>
                  <View style={styles.exerciseInfo}>
                    <Text style={[styles.exerciseName, selected && styles.exerciseNameSelected]}>
                      {exercise.name}
                    </Text>
                    <Text style={styles.exerciseMeta}>
                      {getMuscleGroupLabel(exercise.muscleGroup, t)} · {getEquipmentLabel(exercise.equipment, t)}
                    </Text>
                  </View>
                  {selected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                </Pressable>
              );
            })}

            {filteredExercises.length === 0 && (
              <View style={styles.noResults}>
                <Text style={styles.noResultsText}>{t('addExercise.noResults')}</Text>
              </View>
            )}
          </View>

          <View style={styles.formSection}>
            <Text style={styles.sectionTitle}>{t('addExercise.targets')}</Text>
            <Text style={styles.sectionDescription}>
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

          <View style={styles.formSection}>
            <Text style={styles.sectionTitle}>{t('addExercise.visual')}</Text>
            <Text style={styles.sectionDescription}>{t('visualPicker.choosePhoto')}</Text>
            <View style={styles.visualPicker}>
              <WorkoutVisualPicker
                onSelect={setExerciseVisual}
                selectedVisual={exerciseVisual}
                variant="programEdit"
              />
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
      <View style={styles.targetInputRow}>
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
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  /** Satırları ayıran saç teli çizgi — Ana Sayfa'daki `lastSection` deseni. */
  const rowDivider = {
    borderTopColor: colors.separator,
    borderTopWidth: StyleSheet.hairlineWidth,
  };

  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    keyboardView: { flex: 1 },
    // Ana Sayfa ile aynı yatay boşluk ve bölüm aralığı.
    content: {
      gap: 26,
      paddingBottom: 32,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 12,
    },
    header: { gap: 4 },
    title: { color: colors.text, ...Type.sectionTitle },
    description: { color: colors.textSecondary, ...Type.caption },

    searchSection: { gap: 16 },
    // Gerçek form alanı olduğu için yüzey kullanılır; çerçeve yok.
    searchField: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: Form.controlRadius,
      flexDirection: 'row',
      gap: 8,
      minHeight: Form.controlHeight,
      paddingHorizontal: 12,
    },
    searchInput: {
      color: colors.text,
      flex: 1,
      ...Type.body,
      minHeight: Form.controlHeight,
      paddingVertical: 0,
    },
    customExerciseNotice: { alignItems: 'flex-start', flexDirection: 'row', gap: 7 },
    customExerciseNoticeText: { color: colors.textSecondary, flex: 1, ...Type.caption },

    // Ana Sayfa'daki Hafta/Ay/Yıl seçicisi: aynı punto, renk + ağırlık + alt çizgi.
    categoryList: { gap: 20, paddingRight: Layout.screenPadding },
    categoryTab: {
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      justifyContent: 'center',
      minHeight: 34,
      paddingBottom: 5,
    },
    categoryTabSelected: { borderBottomColor: colors.text },
    categoryText: { color: colors.textSecondary, ...Type.body },
    categoryTextSelected: { color: colors.text, fontWeight: '600' },

    exerciseLibrary: {},
    exerciseOption: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      minHeight: 56,
      paddingVertical: 12,
    },
    rowDivided: rowDivider,
    exerciseInfo: { flex: 1, gap: 3 },
    exerciseName: { color: colors.text, ...Type.rowTitle },
    exerciseNameSelected: { color: colors.primary },
    exerciseMeta: { color: colors.textSecondary, ...Type.caption },
    noResults: { paddingVertical: 26 },
    noResultsText: { color: colors.textSecondary, ...Type.caption, textAlign: 'center' },

    formSection: { gap: 4 },
    sectionTitle: { color: colors.text, ...Type.sectionTitle },
    sectionDescription: { color: colors.textSecondary, ...Type.caption },
    // Üç alan "Egzersizi düzenle" ile aynı sistemden gelir.
    targetFields: { flexDirection: 'row', gap: 12, marginTop: 14 },
    targetField: { flex: 1, gap: Form.fieldGap },
    targetLabel: { color: colors.textSecondary, ...Type.eyebrow },
    targetInputRow: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      minHeight: Form.controlHeight,
    },
    targetInput: {
      color: colors.text,
      flex: 1,
      ...Form.title,
      fontVariant: ['tabular-nums'],
      padding: 0,
    },
    // Ortak seçicinin kendi ölçüleri korunur; yalnızca bölüm aralığı verilir.
    visualPicker: { marginTop: Form.fieldGap },

    actionBar: {
      alignItems: 'center',
      borderTopColor: colors.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: Layout.screenPadding,
      paddingVertical: 12,
    },
    clearButton: { justifyContent: 'center', minHeight: Layout.minTouchSize, paddingHorizontal: 4 },
    clearButtonText: { color: colors.textSecondary, ...Type.body },
    saveButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Form.controlRadius,
      flex: 1,
      justifyContent: 'center',
      minHeight: Form.controlHeight,
    },
    saveButtonText: { color: colors.onPrimary, ...Form.action },
    saveButtonDisabled: { opacity: 0.5 },
    // Boş durumdaki düğme dikeyde esnemez.
    notFoundButton: { flex: 0, paddingHorizontal: 24 },

    notFound: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 32 },
    notFoundTitle: { color: colors.text, ...Type.sectionTitle, textAlign: 'center' },
    pressed: { opacity: 0.7 },
  });
}
