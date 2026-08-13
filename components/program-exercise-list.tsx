import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NestableDraggableFlatList, ScaleDecorator } from 'react-native-draggable-flatlist';

import { ProgramExerciseListProps } from '@/components/program-exercise-list.types';
import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { getProgramExerciseName } from '@/data/exercises';
import { useAppTheme } from '@/hooks/use-app-theme';
import { ProgramExercise } from '@/types/workout';
import { getExerciseVisual } from '@/utils/workout-visual';

export default function ProgramExerciseList({ exercises, onEdit, onReorder }: ProgramExerciseListProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <NestableDraggableFlatList<ProgramExercise>
        data={exercises}
        keyExtractor={(item) => item.id}
        onDragEnd={({ data }) => onReorder(data)}
        renderItem={({ item, drag, isActive }) => {
          const exerciseName = getProgramExerciseName(item.exerciseId, item.customExerciseName);

          return (
            <ScaleDecorator>
              <Pressable
                accessibilityHint={t('a11y.editExerciseHint')}
                accessibilityLabel={t('a11y.editExercise', { name: exerciseName })}
                accessibilityRole="button"
                delayLongPress={200}
                disabled={isActive}
                onLongPress={drag}
                onPress={() => onEdit(item, exerciseName)}
                style={({ pressed }) => [
                  styles.exerciseRow,
                  isActive && styles.exerciseRowActive,
                  pressed && styles.pressed,
                ]}>
                <View accessibilityElementsHidden style={styles.dragHandle}>
                  {Array.from({ length: 6 }).map((_, index) => <View key={index} style={styles.dragDot} />)}
                </View>
                <View style={styles.exerciseIcon}>
                  <WorkoutVisualDisplay color={colors.accent} size={20} visual={getExerciseVisual(item.visual)} />
                </View>
                <View style={styles.exerciseInfo}>
                  <Text numberOfLines={1} style={styles.exerciseName}>
                    {exerciseName}
                  </Text>
                  <Text style={styles.exerciseTarget}>
                    {t('day.exerciseTarget', {
                      reps: item.targetReps,
                      rest: item.restSeconds,
                      sets: item.targetSets,
                    })}
                  </Text>
                </View>
              </Pressable>
            </ScaleDecorator>
          );
        }}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth },
    exerciseRow: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 10,
      minHeight: 58,
      paddingVertical: 10,
    },
    exerciseRowActive: { backgroundColor: colors.surfaceMuted },
    exerciseIcon: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: Layout.radiusSmall,
      height: 28,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 28,
    },
    dragHandle: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, width: 8 },
    dragDot: { backgroundColor: colors.textTertiary, borderRadius: 1, height: 2, width: 2 },
    exerciseInfo: { flex: 1, gap: 3 },
    exerciseName: { color: colors.text, fontSize: 15, fontWeight: '500' },
    exerciseTarget: { color: colors.textSecondary, ...Type.caption },
    pressed: { opacity: 0.6 },
  });
}
