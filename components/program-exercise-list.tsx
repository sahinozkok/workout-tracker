import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NestableDraggableFlatList, ScaleDecorator } from 'react-native-draggable-flatlist';

import { ProgramExerciseListProps } from '@/components/program-exercise-list.types';
import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { ThemeColors } from '@/constants/theme';
import { getProgramExerciseName } from '@/data/exercises';
import { useAppTheme } from '@/hooks/use-app-theme';
import { ProgramExercise } from '@/types/workout';
import { getExerciseVisual } from '@/utils/workout-visual';

export default function ProgramExerciseList({ exercises, onEdit, onRemove, onReorder }: ProgramExerciseListProps) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      {exercises.length > 1 && (
        <Text style={styles.reorderHint}>Sıralamak için sağdaki tutamacı basılı tutup sürükle.</Text>
      )}
      <NestableDraggableFlatList<ProgramExercise>
        data={exercises}
        keyExtractor={(item) => item.id}
        onDragEnd={({ data }) => onReorder(data)}
        renderItem={({ item, drag, isActive }) => {
          const exerciseName = getProgramExerciseName(item.exerciseId, item.customExerciseName);

          return (
            <ScaleDecorator>
              <View style={[styles.exerciseRow, isActive && styles.exerciseRowActive]}>
                <ExerciseContent exercise={item} exerciseName={exerciseName} colors={colors} />
                <Pressable
                  accessibilityLabel={`${exerciseName} egzersizini düzenle`}
                  accessibilityRole="button"
                  disabled={isActive}
                  hitSlop={8}
                  onPress={() => onEdit(item, exerciseName)}>
                  <Ionicons name="pencil-outline" size={18} color={colors.primaryIcon} />
                </Pressable>
                <Pressable
                  accessibilityLabel={`${exerciseName} egzersizini kaldır`}
                  accessibilityRole="button"
                  disabled={isActive}
                  hitSlop={8}
                  onPress={() => onRemove(item, exerciseName)}>
                  <Ionicons name="trash-outline" size={19} color={colors.danger} />
                </Pressable>
                <Pressable
                  accessibilityHint="Basılı tutup yukarı veya aşağı sürükle"
                  accessibilityLabel={`${exerciseName} egzersizini sırala`}
                  delayLongPress={150}
                  disabled={isActive}
                  hitSlop={8}
                  onLongPress={drag}
                  style={styles.dragHandle}>
                  <Ionicons name="reorder-three-outline" size={24} color={colors.textSecondary} />
                </Pressable>
              </View>
            </ScaleDecorator>
          );
        }}
      />
    </View>
  );
}

function ExerciseContent({
  colors,
  exercise,
  exerciseName,
}: {
  colors: ThemeColors;
  exercise: ProgramExercise;
  exerciseName: string;
}) {
  const styles = createStyles(colors);

  return (
    <>
      <View style={styles.exerciseIcon}>
        <WorkoutVisualDisplay color={colors.accentText} size={23} visual={getExerciseVisual(exercise.visual)} />
      </View>
      <View style={styles.exerciseInfo}>
        <Text style={styles.exerciseName}>{exerciseName}</Text>
        <Text style={styles.exerciseTarget}>
          {exercise.targetSets} set × {exercise.targetReps} tekrar · {exercise.restSeconds} sn dinlenme
        </Text>
      </View>
    </>
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
    exerciseRowActive: { backgroundColor: colors.primarySoft, opacity: 0.96 },
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
    dragHandle: { alignItems: 'center', justifyContent: 'center', minHeight: 34, minWidth: 30 },
  });
}
