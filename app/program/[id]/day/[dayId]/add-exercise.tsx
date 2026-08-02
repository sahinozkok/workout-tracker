import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
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
import { ThemeColors } from '@/constants/theme';
import { useWorkout } from '@/context/workout-context';
import { EXERCISES, EXERCISE_MUSCLE_GROUPS, getProgramExerciseName } from '@/data/exercises';
import { useAppTheme } from '@/hooks/use-app-theme';
import { WorkoutVisual } from '@/types/workout';
import { DEFAULT_EXERCISE_VISUAL } from '@/utils/workout-visual';

export default function AddExerciseScreen() {
  const { id, dayId } = useLocalSearchParams<{ id: string; dayId: string }>();
  const { addExerciseToDay, programs } = useWorkout();
  const { colors, isDark } = useAppTheme();
  const styles = createStyles(colors);
  const [search, setSearch] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState(EXERCISE_MUSCLE_GROUPS[0]);
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>();
  const [targetSets, setTargetSets] = useState('3');
  const [targetReps, setTargetReps] = useState('8-10');
  const [restSeconds, setRestSeconds] = useState('90');
  const [exerciseVisual, setExerciseVisual] = useState<WorkoutVisual>(DEFAULT_EXERCISE_VISUAL);

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

  if (!program || !day) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.notFound}>
          <Text style={styles.notFoundTitle}>Program veya antrenman günü bulunamadı.</Text>
          <Pressable onPress={() => router.replace('/programs')} style={styles.saveButton}>
            <Text style={styles.saveButtonText}>Programlara dön</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const programId = program.id;
  const workoutDay = day;
  const selectedExercise = EXERCISES.find((exercise) => exercise.id === selectedExerciseId);

  function handleSave() {
    const customExerciseName = search.trim();
    const exerciseName = selectedExercise?.name ?? customExerciseName;

    if (!exerciseName) {
      Alert.alert('Egzersiz adı gerekli', 'Kütüphaneden bir egzersiz seç veya kendi egzersizinin adını yaz.');
      return;
    }

    const alreadyExists = workoutDay.exercises.some(
      (exercise) =>
        getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName).toLocaleLowerCase('tr-TR') ===
        exerciseName.toLocaleLowerCase('tr-TR'),
    );

    if (alreadyExists) {
      Alert.alert('Egzersiz zaten ekli', `${exerciseName} bu antrenman gününde zaten bulunuyor.`);
      return;
    }

    const parsedSets = Number(targetSets);
    const parsedRestSeconds = Number(restSeconds);
    const trimmedReps = targetReps.trim();

    if (!Number.isInteger(parsedSets) || parsedSets < 1 || parsedSets > 20) {
      Alert.alert('Set sayısını kontrol et', 'Set sayısı 1 ile 20 arasında tam sayı olmalıdır.');
      return;
    }

    if (!/^\d{1,2}(-\d{1,2})?$/.test(trimmedReps)) {
      Alert.alert('Tekrar hedefini kontrol et', 'Tekrar sayısını “8” veya “8-10” biçiminde yazabilirsin.');
      return;
    }

    if (!Number.isInteger(parsedRestSeconds) || parsedRestSeconds < 0 || parsedRestSeconds > 600) {
      Alert.alert('Dinlenme süresini kontrol et', 'Dinlenme süresi 0 ile 600 saniye arasında olmalıdır.');
      return;
    }

    addExerciseToDay(programId, workoutDay.id, {
      customExerciseName: selectedExercise ? undefined : customExerciseName,
      exerciseId: selectedExercise?.id,
      restSeconds: parsedRestSeconds,
      targetReps: trimmedReps,
      targetSets: parsedSets,
      visual: exerciseVisual,
    });
    router.back();
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: `${day.name} · Egzersiz Ekle` }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
        style={styles.keyboardView}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View>
            <Text style={styles.eyebrow}>EGZERSİZ KÜTÜPHANESİ</Text>
            <Text style={styles.title}>{day.name}</Text>
            <Text style={styles.description}>Bir hareket seç ve hedef set, tekrar ve dinlenme süresini belirle.</Text>
          </View>

          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={20} color={colors.textTertiary} />
            <TextInput
              autoCapitalize="none"
              keyboardAppearance={isDark ? 'dark' : 'light'}
              onChangeText={(value) => {
                setSearch(value);
                setSelectedExerciseId(undefined);
              }}
              placeholder="Egzersiz veya kas grubu ara"
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              style={styles.searchInput}
              value={search}
            />
          </View>

          {search.trim() ? (
            <View style={styles.customExerciseNotice}>
              <Ionicons name="create-outline" size={20} color={colors.accentText} />
              <Text style={styles.customExerciseNoticeText}>
                Listeden seçim yapmazsan “{search.trim()}” adıyla kendi egzersizin eklenecek.
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
                      {muscleGroup}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.exerciseLibrary}>
            {filteredExercises.map((exercise) => {
              const selected = selectedExerciseId === exercise.id;

              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={exercise.id}
                  onPress={() => setSelectedExerciseId(exercise.id)}
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
                      {exercise.muscleGroup} · {exercise.equipment}
                    </Text>
                  </View>
                  {selected && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                </Pressable>
              );
            })}

            {filteredExercises.length === 0 && (
              <View style={styles.noResults}>
                <Text style={styles.noResultsText}>Bu aramayla eşleşen egzersiz bulunamadı.</Text>
              </View>
            )}
          </View>

          <View style={styles.targetsCard}>
            <Text style={styles.targetsTitle}>Hedefler</Text>
            <Text style={styles.targetsDescription}>
              {selectedExercise?.name ?? (search.trim() || 'Listeden seç veya yukarıya kendi egzersizini yaz.')}
            </Text>

            <View style={styles.targetFields}>
              <TargetInput
                label="Set"
                onChangeText={setTargetSets}
                value={targetSets}
                colors={colors}
                isDark={isDark}
              />
              <TargetInput
                keyboardType="default"
                label="Tekrar"
                onChangeText={setTargetReps}
                value={targetReps}
                colors={colors}
                isDark={isDark}
              />
              <TargetInput
                label="Dinlenme (sn)"
                onChangeText={setRestSeconds}
                value={restSeconds}
                colors={colors}
                isDark={isDark}
              />
            </View>
          </View>

          <View style={styles.visualCard}>
            <Text style={styles.targetsTitle}>Egzersiz görseli</Text>
            <Text style={styles.targetsDescription}>
              Egzersizin başında görünecek ikon, sayı/emoji veya fotoğrafı seç.
            </Text>
            <View style={styles.visualPicker}>
              <WorkoutVisualPicker onSelect={setExerciseVisual} selectedVisual={exerciseVisual} />
            </View>
          </View>
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          onPress={handleSave}
          style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
          <Text style={styles.saveButtonText}>Egzersizi ekle</Text>
        </Pressable>
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
    content: { gap: 18, padding: 20, paddingBottom: 30 },
    notFound: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 30 },
    notFoundTitle: { color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    eyebrow: { color: colors.accentBright, fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
    title: { color: colors.text, fontSize: 27, fontWeight: '800', marginTop: 4 },
    description: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 6 },
    searchContainer: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.inputBorder,
      borderRadius: 14,
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
      borderRadius: 13,
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
    categoryChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
    categoryChipTextSelected: { color: colors.primarySoftText },
    exerciseLibrary: { gap: 9 },
    exerciseOption: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 14,
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
    exerciseName: { color: colors.text, fontSize: 14, fontWeight: '800' },
    exerciseMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
    pressed: { opacity: 0.72 },
    noResults: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 14, padding: 20 },
    noResultsText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
    targetsCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      padding: 16,
    },
    targetsTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
    targetsDescription: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
    visualCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      padding: 16,
    },
    visualPicker: { marginTop: 16 },
    targetFields: { flexDirection: 'row', gap: 9, marginTop: 16 },
    targetField: { flex: 1, gap: 6 },
    targetLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
    targetInput: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: 11,
      borderWidth: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      paddingHorizontal: 10,
      paddingVertical: 11,
    },
    saveButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 14,
      margin: 20,
      marginTop: 8,
      paddingVertical: 15,
    },
    saveButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' },
  });
}
