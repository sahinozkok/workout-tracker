import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProgramExerciseListProps } from '@/components/program-exercise-list.types';
import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { ThemeColors } from '@/constants/theme';
import { getProgramExerciseName } from '@/data/exercises';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getExerciseVisual } from '@/utils/workout-visual';

export default function ProgramExerciseList({ exercises, onEdit, onRemove, onReorder }: ProgramExerciseListProps) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);

  function moveExercise(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= exercises.length) return;

    const reorderedExercises = [...exercises];
    const [movedExercise] = reorderedExercises.splice(fromIndex, 1);
    reorderedExercises.splice(toIndex, 0, movedExercise);
    onReorder(reorderedExercises);
  }

  return (
    <View style={styles.container}>
      {exercises.length > 1 && (
        <Text style={styles.reorderHint}>Sıralamayı değiştirmek için sağdaki okları kullan.</Text>
      )}
      {exercises.map((exercise, index) => {
        const exerciseName = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);

        return (
          <View key={exercise.id} style={styles.exerciseRow}>
            <View style={styles.exerciseIcon}>
              <WorkoutVisualDisplay color={colors.accentText} size={23} visual={getExerciseVisual(exercise.visual)} />
            </View>
            <View style={styles.exerciseInfo}>
              <Text style={styles.exerciseName}>{exerciseName}</Text>
              <Text style={styles.exerciseTarget}>
                {exercise.targetSets} set × {exercise.targetReps} tekrar · {exercise.restSeconds} sn dinlenme
              </Text>
            </View>
            <Pressable
              accessibilityLabel={`${exerciseName} egzersizini düzenle`}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => onEdit(exercise, exerciseName)}>
              <Ionicons name="pencil-outline" size={18} color={colors.primaryIcon} />
            </Pressable>
            <Pressable
              accessibilityLabel={`${exerciseName} egzersizini kaldır`}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => onRemove(exercise, exerciseName)}>
              <Ionicons name="trash-outline" size={19} color={colors.danger} />
            </Pressable>
            <View style={styles.arrowControls}>
              <Pressable
                accessibilityLabel={`${exerciseName} egzersizini yukarı taşı`}
                accessibilityRole="button"
                disabled={index === 0}
                onPress={() => moveExercise(index, index - 1)}
                style={[styles.arrowButton, index === 0 && styles.arrowButtonDisabled]}>
                <Ionicons name="chevron-up" size={18} color={colors.text} />
              </Pressable>
              <Pressable
                accessibilityLabel={`${exerciseName} egzersizini aşağı taşı`}
                accessibilityRole="button"
                disabled={index === exercises.length - 1}
                onPress={() => moveExercise(index, index + 1)}
                style={[styles.arrowButton, index === exercises.length - 1 && styles.arrowButtonDisabled]}>
                <Ionicons name="chevron-down" size={18} color={colors.text} />
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { borderTopColor: colors.border, borderTopWidth: 1 },
    reorderHint: {
      backgroundColor: colors.surfaceMuted,
      color: colors.textSecondary,
      fontSize: 11,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    exerciseRow: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 10,
      padding: 14,
    },
    exerciseIcon: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: 9,
      height: 34,
      justifyContent: 'center',
      width: 34,
      overflow: 'hidden',
    },
    exerciseInfo: { flex: 1 },
    exerciseName: { color: colors.text, fontSize: 14, fontWeight: '800' },
    exerciseTarget: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
    arrowControls: { gap: 3 },
    arrowButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderRadius: 7,
      borderWidth: 1,
      height: 26,
      justifyContent: 'center',
      width: 30,
    },
    arrowButtonDisabled: { opacity: 0.25 },
  });
}
