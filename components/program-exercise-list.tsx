import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NestableDraggableFlatList, ScaleDecorator } from 'react-native-draggable-flatlist';

import {
  MotionListItem,
  useListCellExiting,
  useListEntrance,
} from '@/components/motion-list-item';
import { ProgramExerciseListProps } from '@/components/program-exercise-list.types';
import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { getProgramExerciseName } from '@/data/exercises';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { ProgramExercise } from '@/types/workout';
import { getExerciseVisual } from '@/utils/workout-visual';
import { formatExerciseTargetLabel } from '@/utils/workout-tracking';

/** Varsayılan Antrenman Günleri rengi; kullanıcı seçim yapmadıysa bu kullanılır. */
const WORKOUT_ORANGE = '#FF9138';

/**
 * Bir günün egzersiz listesi (native).
 *
 * HAREKET: satırlar ilk yüklemede küçük stagger ile gelir; güne egzersiz
 * eklenince yalnızca yeni satır belirir, silinince yalnızca o satır kısa bir
 * opaklık çıkışıyla kaybolur. Uzun basış sürükleme gesture'ı ve satırların
 * sürüklenirken kayması kütüphaneye ait; üzerine hiçbir şey eklenmedi.
 */
export default function ProgramExerciseList({ exercises, onEdit, onReorder, showIcons = false }: ProgramExerciseListProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  // Antrenman Günleri semantik rengi; seçilmediyse bugünkü turuncu.
  const workoutDaysColor = useFeatureColor('workoutDays', WORKOUT_ORANGE).color;
  const styles = createStyles(colors, workoutDaysColor);
  const { getDelay } = useListEntrance(exercises.length);
  const itemExitingAnimation = useListCellExiting();

  return (
    <View style={styles.container}>
      <NestableDraggableFlatList<ProgramExercise>
        data={exercises}
        itemExitingAnimation={itemExitingAnimation}
        keyExtractor={(item) => item.id}
        onDragEnd={({ data }) => onReorder(data)}
        renderItem={({ item, drag, getIndex, isActive }) => {
          const exerciseName = getProgramExerciseName(item.exerciseId, item.customExerciseName);

          return (
            /**
             * `activeScale={1}`: `ScaleDecorator`'ın varsayılan ~1.1'lik
             * büyütmesi sürüklenen satırı yatayda genişletiyor, uzun egzersiz
             * adlarında satır listenin kenarlarından taşıp kırpılıyordu. Ölçek
             * kapatıldı; satır genişliği ve yatay konumu sürükleme boyunca
             * SABİT kalır. Aktiflik hissi `exerciseRowActive` zemininden gelir
             * (Program listesindeki çözümün aynısı).
             */
            <ScaleDecorator activeScale={1}>
              {/* Giriş hücrenin içinde; çıkış `itemExitingAnimation` ile. */}
              <MotionListItem delay={getDelay(getIndex() ?? 0)} disableExiting disableLayout>
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
                  {showIcons && (
                    <View style={styles.exerciseIcon}>
                      <WorkoutVisualDisplay color={workoutDaysColor} size={20} visual={getExerciseVisual(item.visual)} />
                    </View>
                  )}
                  <View style={styles.exerciseInfo}>
                    <Text numberOfLines={1} style={styles.exerciseName}>
                      {exerciseName}
                    </Text>
                    <View style={styles.targetInfo}>
                      <Text style={styles.exerciseTarget}>{formatExerciseTargetLabel(item)}</Text>
                      <Text style={styles.exerciseRest}>{t('day.restSecondsShort', { seconds: item.restSeconds })}</Text>
                    </View>
                  </View>
                </Pressable>
              </MotionListItem>
            </ScaleDecorator>
          );
        }}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors, workoutDaysColor: string) {
  return StyleSheet.create({
    container: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth },
    exerciseRow: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      // İkon ile ad arası. `gap` yalnızca kardeşler arasında uygulandığı için
      // "exercise icons" kapalıyken (tek çocuk) fazladan boşluk oluşmaz.
      // Web sürümündeki `exerciseMain` ile AYNI değer.
      gap: 12,
      minHeight: 72,
      paddingVertical: 12,
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
    exerciseInfo: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12 },
    exerciseName: { color: colors.text, flex: 1, fontSize: 16, fontWeight: '600' },
    targetInfo: { alignItems: 'flex-end', gap: 2 },
    exerciseTarget: { color: workoutDaysColor, fontSize: 16, fontWeight: '600' },
    exerciseRest: { color: colors.textTertiary, fontSize: 13 },
    pressed: { opacity: 0.6 },
  });
}
