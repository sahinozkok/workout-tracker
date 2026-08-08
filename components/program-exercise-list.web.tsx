import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProgramExerciseListProps } from '@/components/program-exercise-list.types';
import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { getProgramExerciseName } from '@/data/exercises';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getExerciseVisual } from '@/utils/workout-visual';

export default function ProgramExerciseList({ exercises, onEdit, onReorder }: ProgramExerciseListProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const [draggingIndex, setDraggingIndex] = useState<number>();
  const didDragRef = useRef(false);

  function moveExercise(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= exercises.length) return;

    const reorderedExercises = [...exercises];
    const [movedExercise] = reorderedExercises.splice(fromIndex, 1);
    reorderedExercises.splice(toIndex, 0, movedExercise);
    onReorder(reorderedExercises);
  }

  return (
    <View style={styles.container}>
      {exercises.map((exercise, index) => {
        const exerciseName = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);
        const webDragProps = {
          draggable: true,
          onDragEnd: () => {
            didDragRef.current = true;
            setDraggingIndex(undefined);
            setTimeout(() => {
              didDragRef.current = false;
            }, 0);
          },
          onDragOver: (event: { preventDefault: () => void }) => event.preventDefault(),
          onDragStart: (event: { dataTransfer?: { effectAllowed: string } }) => {
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
            setDraggingIndex(index);
          },
          onDrop: (event: { preventDefault: () => void }) => {
            event.preventDefault();
            if (draggingIndex !== undefined) moveExercise(draggingIndex, index);
          },
        };

        return (
          <View
            {...(webDragProps as object)}
            key={exercise.id}
            style={[styles.exerciseRow, draggingIndex === index && styles.exerciseRowActive]}>
            <Pressable
              accessibilityHint={t('a11y.editExerciseHint')}
              accessibilityLabel={t('a11y.editExercise', { name: exerciseName })}
              accessibilityRole="button"
              onPress={() => {
                if (!didDragRef.current) onEdit(exercise, exerciseName);
              }}
              style={({ pressed }) => [styles.exerciseMain, pressed && styles.pressed]}>
              <View style={styles.exerciseIcon}>
                <WorkoutVisualDisplay color={colors.accent} size={20} visual={getExerciseVisual(exercise.visual)} />
              </View>
              <View style={styles.exerciseInfo}>
                <Text numberOfLines={1} style={styles.exerciseName}>
                  {exerciseName}
                </Text>
                <Text style={styles.exerciseTarget}>
                  {t('day.exerciseTarget', {
                    reps: exercise.targetReps,
                    rest: exercise.restSeconds,
                    sets: exercise.targetSets,
                  })}
                </Text>
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth },
    exerciseRow: {
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      minHeight: 64,
    },
    exerciseRowActive: { backgroundColor: colors.surfaceMuted, opacity: 0.7 },
    exerciseMain: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 14,
      minHeight: 64,
      paddingVertical: 12,
    },
    exerciseIcon: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: Layout.radiusSmall,
      height: 34,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 34,
    },
    exerciseInfo: { flex: 1, gap: 3 },
    exerciseName: { color: colors.text, fontSize: 15, fontWeight: '500' },
    exerciseTarget: { color: colors.textSecondary, ...Type.caption },
    pressed: { opacity: 0.6 },
  });
}
