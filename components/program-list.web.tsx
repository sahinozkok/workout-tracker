import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useFeatureColor } from '@/hooks/use-feature-colors';
import { createStyles } from '@/components/program-list';
import { ProgramListProps } from '@/components/program-list.types';
import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getProgramIconBackground, getProgramVisual } from '@/utils/workout-visual';

/**
 * Program listesi (web).
 *
 * `react-native-draggable-flatlist` web'de çalışmadığı için sürükleme HTML5
 * drag-and-drop ile yapılır. Satır tasarımı native sürümle AYNI `createStyles`
 * fonksiyonundan gelir; iki platform arasında görsel fark oluşmaz.
 */
export default function ProgramList({
  activeProgramId,
  busyProgramId,
  onOpen,
  onOptions,
  onReorder,
  programs,
  showIcons,
}: ProgramListProps) {
  const { colors, isDark } = useAppTheme();
  // Hazır program ikonlarının vurgusu Workout Days presetinden gelir.
  const workoutDaysIconColor = useFeatureColor('workoutDays', colors.primary).color;
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const [draggingIndex, setDraggingIndex] = useState<number>();
  // Sürükleme bittikten hemen sonraki tıklamanın detay açmasını engeller.
  const didDragRef = useRef(false);

  function moveProgram(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= programs.length) return;

    const reordered = [...programs];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    onReorder(reordered);
  }

  return (
    <View style={styles.list}>
      {programs.map((program, index) => {
        const isActive = program.id === activeProgramId;
        const isBusy = busyProgramId === program.id;
        const workoutDays = program.days.filter((day) => !day.isOffDay).length;
        const restDays = program.days.filter((day) => day.isOffDay).length;
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
            if (draggingIndex !== undefined) moveProgram(draggingIndex, index);
          },
        };

        return (
          <View
            {...(webDragProps as object)}
            key={program.id}
            style={[styles.row, draggingIndex === index && styles.rowDragging]}>
            <Pressable
              accessibilityHint={t('programs.openHint')}
              accessibilityRole="button"
              onPress={() => {
                if (!didDragRef.current) onOpen(program.id);
              }}
              style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}>
              {showIcons && (
                <View
                  style={[
                    styles.programIcon,
                    getProgramIconBackground(
                      getProgramVisual(program.visual, program.icon),
                      workoutDaysIconColor,
                      isDark,
                    ),
                  ]}>
                  <WorkoutVisualDisplay
                    color={colors.primary}
                    iconColor={workoutDaysIconColor}
                    size={22}
                    visual={getProgramVisual(program.visual, program.icon)}
                  />
                </View>
              )}
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={styles.rowTitle}>
                  {program.name}
                </Text>
                <View style={styles.rowMetaLine}>
                  <Text numberOfLines={1} style={styles.rowMeta}>
                    {t('programs.weeklySummary', { workouts: workoutDays })}
                    {restDays > 0 ? t('programs.restSuffix', { count: restDays }) : ''}
                  </Text>
                  {isActive && <Text style={styles.activeText}>{t('programs.active')}</Text>}
                </View>
              </View>
            </Pressable>
            <Pressable
              accessibilityLabel={t('programs.options', { name: program.name })}
              accessibilityRole="button"
              disabled={isBusy}
              hitSlop={12}
              onPress={() => onOptions(program, isActive)}
              style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
              {isBusy ? (
                <ActivityIndicator color={colors.textSecondary} size="small" />
              ) : (
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.textTertiary} />
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
