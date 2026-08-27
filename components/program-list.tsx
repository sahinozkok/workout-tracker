import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { NestableDraggableFlatList, ScaleDecorator } from 'react-native-draggable-flatlist';

import { useFeatureColor } from '@/hooks/use-feature-colors';
import {
  MotionListItem,
  useListCellExiting,
  useListEntrance,
} from '@/components/motion-list-item';
import { ProgramListProps } from '@/components/program-list.types';
import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { getFeatureFallbackColor } from '@/constants/color-presets';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { WorkoutProgram } from '@/types/workout';
import { getProgramIconBackground, getProgramVisual } from '@/utils/workout-visual';

/**
 * Program listesi (native).
 *
 * Uzun basış SÜRÜKLEMEYİ başlatır; kısa dokunma program detayını açar. Satırın
 * sağındaki üç nokta düğmesi seçenek menüsünü açmaya devam eder — menü artık
 * uzun basışa değil yalnızca o düğmeye bağlıdır, çünkü uzun basış sürüklemeye
 * ayrıldı.
 *
 * Web'de `react-native-draggable-flatlist` çalışmadığı için `.web.tsx` eşi
 * HTML5 sürükle-bırak kullanır (projedeki `program-exercise-list` kalıbı).
 *
 * HAREKET: satırlar ilk yüklemede küçük bir stagger ile gelir, silinen satır
 * kısa bir opaklık çıkışıyla kaybolur. Sürükleme sırasında diğer satırların
 * kayması KÜTÜPHANENİN kendi hücre animasyonudur ve bilerek olduğu gibi
 * bırakıldı; üstüne Reanimated layout animation eklenmez.
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
  const workoutDaysDefault = getFeatureFallbackColor('workoutDays', colors, isDark);
  const workoutDaysIconColor = useFeatureColor('workoutDays', workoutDaysDefault).color;
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const { getDelay } = useListEntrance(programs.length);
  const itemExitingAnimation = useListCellExiting();

  return (
    <View style={styles.list}>
      <NestableDraggableFlatList<WorkoutProgram>
        data={programs}
        itemExitingAnimation={itemExitingAnimation}
        keyExtractor={(item) => item.id}
        onDragEnd={({ data }) => onReorder(data)}
        renderItem={({ item, drag, getIndex, isActive: isDragging }) => {
          const isActive = item.id === activeProgramId;
          const isBusy = busyProgramId === item.id;
          const workoutDays = item.days.filter((day) => !day.isOffDay).length;
          const restDays = item.days.filter((day) => day.isOffDay).length;

          /**
           * `activeScale={1}`: `ScaleDecorator`'ın varsayılan ~1.1'lik
           * büyütmesi, uzun program adlarında satırı ekranın soluna/sağına
           * taşırıyordu. Ölçek kapatıldı; satır genişliği sürükleme boyunca
           * SABİT kalır. Yükselme hissi `rowDragging` içindeki zemin ve gölge
           * ile korunur.
           */
          return (
            <ScaleDecorator activeScale={1}>
              {/*
                Giriş animasyonu hücrenin İÇİNDE durur; sürüklerken satır
                unmount olmadığı için tekrar oynamaz. Çıkış ve kayma dışarıda
                kalır (bkz. `useListCellExiting`).
              */}
              <MotionListItem delay={getDelay(getIndex() ?? 0)} disableExiting disableLayout>
                <Pressable
                  accessibilityHint={t('programs.openHint')}
                  accessibilityRole="button"
                  delayLongPress={200}
                  disabled={isDragging}
                  onLongPress={drag}
                  onPress={() => onOpen(item.id)}
                  style={({ pressed }) => [
                    styles.row,
                    isDragging && styles.rowDragging,
                    pressed && styles.rowPressed,
                  ]}>
                  {showIcons && (
                    <View
                      style={[
                        styles.programIcon,
                        getProgramIconBackground(
                          getProgramVisual(item.visual, item.icon),
                          workoutDaysIconColor,
                          isDark,
                        ),
                      ]}>
                      <WorkoutVisualDisplay
                        color={colors.primary}
                        iconColor={workoutDaysIconColor}
                        size={22}
                        visual={getProgramVisual(item.visual, item.icon)}
                      />
                    </View>
                  )}
                  <View style={styles.rowText}>
                    <Text numberOfLines={1} style={styles.rowTitle}>
                      {item.name}
                    </Text>
                    <View style={styles.rowMetaLine}>
                      <Text numberOfLines={1} style={styles.rowMeta}>
                        {t('programs.weeklySummary', { workouts: workoutDays })}
                        {restDays > 0 ? t('programs.restSuffix', { count: restDays }) : ''}
                      </Text>
                      {isActive && <Text style={styles.activeText}>{t('programs.active')}</Text>}
                    </View>
                  </View>
                  <Pressable
                    accessibilityLabel={t('programs.options', { name: item.name })}
                    accessibilityRole="button"
                    disabled={isBusy}
                    hitSlop={12}
                    onPress={() => onOptions(item, isActive)}
                    style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
                    {isBusy ? (
                      <ActivityIndicator color={colors.textSecondary} size="small" />
                    ) : (
                      <Ionicons name="ellipsis-horizontal" size={18} color={colors.textTertiary} />
                    )}
                  </Pressable>
                </Pressable>
              </MotionListItem>
            </ScaleDecorator>
          );
        }}
      />
    </View>
  );
}

/**
 * Stiller `app/(tabs)/programs.tsx` içindeki mevcut satır tasarımından BİREBİR
 * alındı; tek ekleme sürüklenen satırın `rowDragging` görünümüdür.
 */
export function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    list: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth },
    row: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      minHeight: 64,
      paddingVertical: 14,
    },
    /** Sürüklenirken hafif yükselme; satır ölçüleri ve tipografi değişmez. */
    rowDragging: {
      backgroundColor: colors.surfaceMuted,
      borderBottomColor: 'transparent',
      borderRadius: Layout.radiusMedium,
      elevation: 4,
      shadowColor: colors.text,
      shadowOffset: { height: 2, width: 0 },
      shadowOpacity: 0.18,
      shadowRadius: 8,
    },
    /** Web sürümünde satır içeriği ayrı bir Pressable; ölçüler aynı kalır. */
    rowMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12 },
    rowPressed: { opacity: 0.6 },
    programIcon: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 10,
      height: 38,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 38,
    },
    rowText: { flex: 1, gap: 4 },
    rowTitle: { color: colors.text, ...Type.rowTitle },
    rowMetaLine: { alignItems: 'center', flexDirection: 'row' },
    rowMeta: { color: colors.textSecondary, flexShrink: 1, ...Type.caption },
    activeText: { color: colors.disciplineCompleted, ...Type.caption, fontWeight: '500' },
    moreButton: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
    pressed: { opacity: 0.6 },
  });
}
