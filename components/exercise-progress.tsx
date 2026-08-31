import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { WorkoutSetRecord } from '@/types/workout';
import {
  buildExerciseAnalytics,
  ExerciseAnalytics,
  ExerciseProgressPoint,
} from '@/utils/workout-analytics';

type ProgressMetric = 'strength' | 'volume' | 'weight';

/** Grafik çubuklarının azami pikseli. Grafik bölümün görsel odağı olduğu için
 * çubuklar bilinçli olarak uzun tutulur; oran hesabı değişmez. */
const CHART_BAR_HEIGHT = 132;

type ExerciseProgressProps = {
  workoutSets: WorkoutSetRecord[];
};

type PerformanceChange = {
  direction: 'negative' | 'neutral' | 'positive';
  label: string;
};

const METRICS: { key: ProgressMetric; labelKey: string }[] = [
  { key: 'weight', labelKey: 'components.weight' },
  { key: 'strength', labelKey: 'progress.estimatedStrength' },
  { key: 'volume', labelKey: 'components.volume' },
];

export function ExerciseProgress({ workoutSets }: ExerciseProgressProps) {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  // Geçmiş ve Gelişim vurgusu; seçilmediyse bugünkü yeşil.
  const progressAccent = useFeatureColor('historyProgress', colors.disciplineCompleted).color;
  const styles = createStyles(colors, progressAccent);
  const analytics = useMemo(() => buildExerciseAnalytics(workoutSets), [workoutSets]);
  const [selectedExerciseKey, setSelectedExerciseKey] = useState(analytics[0]?.exerciseKey);
  const [selectedMetric, setSelectedMetric] = useState<ProgressMetric>('weight');
  const [isPickerVisible, setIsPickerVisible] = useState(false);

  useEffect(() => {
    if (!analytics.some((exercise) => exercise.exerciseKey === selectedExerciseKey)) {
      setSelectedExerciseKey(analytics[0]?.exerciseKey);
    }
  }, [analytics, selectedExerciseKey]);

  const selectedExercise =
    analytics.find((exercise) => exercise.exerciseKey === selectedExerciseKey) ?? analytics[0];

  if (!selectedExercise) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>{t('components.progressEmptyTitle')}</Text>
        <Text style={styles.emptyDescription}>{t('progress.emptyDescription')}</Text>
      </View>
    );
  }

  const latestPoint = selectedExercise.points[selectedExercise.points.length - 1];
  const previousPoint = selectedExercise.points[selectedExercise.points.length - 2];
  const repetitionsLabel = t('components.repetitions').toLocaleLowerCase(locale);
  const latestPerformance = formatPerformance(latestPoint?.topSet, locale, repetitionsLabel);
  const previousPerformance = formatPerformance(previousPoint?.topSet, locale, repetitionsLabel);
  const bestPerformance = formatPerformance(selectedExercise.bestPerformanceSet, locale, repetitionsLabel);
  const performanceChange = getPerformanceChange(latestPoint?.topSet, previousPoint?.topSet, locale, t);
  const chartPoints = selectedExercise.points
    .map((point) => ({ point, value: getMetricValue(point, selectedMetric) }))
    .filter((item) => item.value !== undefined && item.value > 0)
    .slice(-8) as { point: ExerciseProgressPoint; value: number }[];
  const previousValue = chartPoints[chartPoints.length - 2]?.value;
  const latestValue = chartPoints[chartPoints.length - 1]?.value;
  const changePercentage =
    previousValue && latestValue !== undefined
      ? ((latestValue - previousValue) / previousValue) * 100
      : undefined;
  const recordHistory = selectedExercise.recordHistory.slice(0, 6);

  return (
    <View style={styles.container}>
      {/*
        Tek dikey bilgi akışı: kart yığını yok. Bölümler başlık, boşluk ve
        `hairlineWidth` ayırıcılarla ayrılır; zemin ekran temasıdır.
      */}
      {/* 1 — Kompakt egzersiz seçici */}
      <Pressable
        accessibilityHint={t('progress.exercisePickerHint')}
        accessibilityRole="button"
        onPress={() => setIsPickerVisible(true)}
        style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}>
        <View style={styles.pickerText}>
          <Text style={styles.eyebrow}>{t('progress.title').toLocaleUpperCase(locale)}</Text>
          <Text numberOfLines={1} style={styles.pickerName}>
            {selectedExercise.exerciseName}
          </Text>
        </View>
        <View style={styles.pickerCountRow}>
          <Text style={styles.pickerCount}>
            {t('progress.exerciseCount', { count: analytics.length })}
          </Text>
          <Ionicons name="chevron-down" size={15} color={colors.textTertiary} />
        </View>
      </Pressable>

      {/* 2 — Tek satırlık özet: son / en iyi / antrenman sayısı */}
      <View style={styles.summaryRow}>
        <ProgressSummary
          colors={colors}
          label={t('progress.latestPerformance')}
          value={latestPerformance}
        />
        <View style={styles.summaryDivider} />
        <ProgressSummary
          colors={colors}
          highlighted
          label={t('progress.bestPerformance')}
          value={bestPerformance}
        />
        <View style={styles.summaryDivider} />
        <ProgressSummary
          colors={colors}
          label={t('progress.workoutCount')}
          value={String(selectedExercise.points.length)}
        />
      </View>

      <View style={styles.divider} />

      {/* 3 — Son ve önceki antrenman karşılaştırması */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.eyebrow}>{t('progress.comparisonTitle')}</Text>
          {previousPoint && performanceChange && (
            <ChangeIndicator change={performanceChange} colors={colors} />
          )}
        </View>

        {/* Önceki antrenman yoksa `formatPerformance` zaten "—" döndürür. */}
        <View style={styles.comparisonRow}>
          <View style={styles.comparisonColumn}>
            <Text style={styles.comparisonLabel}>{t('progress.previousWorkout')}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.comparisonValuePrevious}>
              {previousPerformance}
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color={colors.textTertiary} />
          <View style={[styles.comparisonColumn, styles.comparisonColumnEnd]}>
            <Text style={styles.comparisonLabel}>{t('progress.latestWorkout')}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.comparisonValueLatest}>
              {latestPerformance}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.divider} />

      {/* 4 — Performans grafiği ve ölçüm sekmeleri (ekranın görsel odağı) */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderText}>
            <Text style={styles.sectionTitle}>{t('progress.trendTitle')}</Text>
            <Text style={styles.sectionSubtitle}>
              {t('progress.lastWorkoutDays', { count: Math.min(selectedExercise.points.length, 8) })}
            </Text>
          </View>
          {changePercentage !== undefined && chartPoints.length > 1 && (
            <View style={styles.changeIndicator}>
              <Ionicons
                name={changePercentage >= 0 ? 'arrow-up' : 'arrow-down'}
                size={12}
                color={changePercentage >= 0 ? colors.disciplineCompleted : colors.accent}
              />
              <Text style={[styles.changeText, changePercentage < 0 && styles.changeTextNegative]}>
                %{formatDecimal(Math.abs(changePercentage), locale)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.metricTabs}>
          {METRICS.map((metric) => {
            const isSelected = metric.key === selectedMetric;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                hitSlop={8}
                key={metric.key}
                onPress={() => setSelectedMetric(metric.key)}
                style={({ pressed }) => [
                  styles.metricTab,
                  isSelected && styles.metricTabSelected,
                  pressed && styles.pressed,
                ]}>
                <Text numberOfLines={1} style={[styles.metricText, isSelected && styles.metricTextSelected]}>
                  {t(metric.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {chartPoints.length >= 2 ? (
          <ProgressChart colors={colors} locale={locale} metric={selectedMetric} points={chartPoints} />
        ) : (
          <View style={styles.chartEmpty}>
            <Text style={styles.chartEmptyTitle}>{t('progress.chartNeedsAnotherWorkoutTitle')}</Text>
            <Text style={styles.chartEmptyText}>{t('progress.chartNeedsAnotherWorkout')}</Text>
          </View>
        )}
      </View>

      <View style={styles.divider} />

      {/* 5 — Rekor geçmişi (sade liste) */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>{t('progress.recordHistory')}</Text>
          <Text style={styles.sectionSubtitle}>{t('progress.recordHistorySubtitle')}</Text>
        </View>

        {recordHistory.length > 0 ? (
          <View style={styles.recordList}>
            {recordHistory.map((record, index) => (
              <RecordRow
                key={`${record.kind}-${record.set.id}`}
                colors={colors}
                dateKey={record.dateKey}
                divided={index > 0}
                label={
                  record.kind === 'weight'
                    ? t('progress.newWeightRecord')
                    : t('progress.newRepetitionRecord')
                }
                locale={locale}
                value={formatPerformance(record.set, locale, repetitionsLabel)}
              />
            ))}
          </View>
        ) : (
          <Text style={styles.recordsEmpty}>{t('components.noRecordYet')}</Text>
        )}
      </View>

      <ExercisePickerModal
        analytics={analytics}
        colors={colors}
        locale={locale}
        onClose={() => setIsPickerVisible(false)}
        onSelect={(exerciseKey) => {
          setSelectedExerciseKey(exerciseKey);
          setIsPickerVisible(false);
        }}
        selectedExerciseKey={selectedExercise.exerciseKey}
        t={t}
        visible={isPickerVisible}
      />
    </View>
  );
}

function ExercisePickerModal({
  analytics,
  colors,
  locale,
  onClose,
  onSelect,
  selectedExerciseKey,
  t,
  visible,
}: {
  analytics: ExerciseAnalytics[];
  colors: ThemeColors;
  locale: string;
  onClose: () => void;
  onSelect: (exerciseKey: string) => void;
  selectedExerciseKey: string;
  t: (key: string, params?: Record<string, number | string>) => string;
  visible: boolean;
}) {
  const accentColor = useFeatureColor('historyProgress', colors.disciplineCompleted).color;
  const styles = createStyles(colors, accentColor);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const filteredExercises = analytics.filter((exercise) =>
    exercise.exerciseName.toLocaleLowerCase(locale).includes(normalizedQuery),
  );

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.modalSafeArea}>
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderText}>
            <Text style={styles.modalTitle}>{t('components.chooseExercise')}</Text>
            <Text style={styles.modalSubtitle}>{t('progress.exerciseCount', { count: analytics.length })}</Text>
          </View>
          <Pressable
            accessibilityLabel={t('common.close')}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.modalCloseButton, pressed && styles.pressed]}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.searchField}>
          <Ionicons name="search" size={16} color={colors.textTertiary} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder={t('progress.searchExercises')}
            placeholderTextColor={colors.textTertiary}
            style={styles.searchInput}
            value={query}
          />
          {query.length > 0 && (
            <Pressable accessibilityLabel={t('common.clear')} hitSlop={8} onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
            </Pressable>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.exerciseList} keyboardShouldPersistTaps="handled">
          {filteredExercises.map((exercise, index) => {
            const isSelected = exercise.exerciseKey === selectedExerciseKey;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                key={exercise.exerciseKey}
                onPress={() => onSelect(exercise.exerciseKey)}
                style={({ pressed }) => [
                  styles.exerciseRow,
                  index > 0 && styles.rowDivided,
                  pressed && styles.pressed,
                ]}>
                <View style={styles.exerciseRowText}>
                  <Text
                    numberOfLines={1}
                    style={[styles.exerciseRowName, isSelected && styles.exerciseRowNameSelected]}>
                    {exercise.exerciseName}
                  </Text>
                  <Text style={styles.exerciseRowMeta}>
                    {t('progress.workoutDays', { count: exercise.points.length })}
                  </Text>
                </View>
                {isSelected && <Ionicons name="checkmark" size={18} color={colors.disciplineCompleted} />}
              </Pressable>
            );
          })}

          {filteredExercises.length === 0 && (
            <View style={styles.modalEmpty}>
              <Text style={styles.modalEmptyText}>{t('progress.noExerciseSearchResults')}</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ChangeIndicator({ change, colors }: { change: PerformanceChange; colors: ThemeColors }) {
  const accentColor = useFeatureColor('historyProgress', colors.disciplineCompleted).color;
  const styles = createStyles(colors, accentColor);

  return (
    <View style={styles.changeIndicator}>
      {change.direction !== 'neutral' && (
        <Ionicons
          color={change.direction === 'positive' ? colors.disciplineCompleted : colors.accent}
          name={change.direction === 'positive' ? 'arrow-up' : 'arrow-down'}
          size={12}
        />
      )}
      <Text
        style={[
          styles.changeText,
          change.direction === 'negative' && styles.changeTextNegative,
          change.direction === 'neutral' && styles.changeTextNeutral,
        ]}>
        {change.label}
      </Text>
    </View>
  );
}

function ProgressSummary({
  colors,
  highlighted,
  label,
  value,
}: {
  colors: ThemeColors;
  highlighted?: boolean;
  label: string;
  value: string;
}) {
  const accentColor = useFeatureColor('historyProgress', colors.disciplineCompleted).color;
  const styles = createStyles(colors, accentColor);

  return (
    <View style={styles.summaryItem}>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.summaryValue, highlighted && styles.summaryValueHighlighted]}>
        {value}
      </Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function ProgressChart({
  colors,
  locale,
  metric,
  points,
}: {
  colors: ThemeColors;
  locale: string;
  metric: ProgressMetric;
  points: { point: ExerciseProgressPoint; value: number }[];
}) {
  const accentColor = useFeatureColor('historyProgress', colors.disciplineCompleted).color;
  const styles = createStyles(colors, accentColor);
  const maxValue = Math.max(...points.map((item) => item.value));

  return (
    <View style={styles.chart}>
      {points.map(({ point, value }, index) => {
        const isLatest = index === points.length - 1;
        const height = Math.max(6, (value / maxValue) * CHART_BAR_HEIGHT);
        return (
          <View key={point.dateKey} style={styles.barColumn}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.barValue}>
              {formatChartValue(value, metric, locale)}
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { height }, isLatest && styles.barLatest]} />
            </View>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[styles.barDate, isLatest && styles.barDateLatest]}>
              {formatShortDate(point.dateKey, locale)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function RecordRow({
  colors,
  dateKey,
  divided,
  label,
  locale,
  value,
}: {
  colors: ThemeColors;
  dateKey: string;
  divided: boolean;
  locale: string;
  label: string;
  value: string;
}) {
  const accentColor = useFeatureColor('historyProgress', colors.disciplineCompleted).color;
  const styles = createStyles(colors, accentColor);

  return (
    <View style={[styles.recordRow, divided && styles.rowDivided]}>
      <View style={styles.recordText}>
        <Text numberOfLines={1} style={styles.recordLabel}>
          {label}
        </Text>
        <Text style={styles.recordDate}>{formatLongDate(dateKey, locale)}</Text>
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.recordValue}>
        {value}
      </Text>
    </View>
  );
}

function getMetricValue(point: ExerciseProgressPoint, metric: ProgressMetric) {
  if (metric === 'weight') return point.topSet?.weightKg;
  if (metric === 'strength') return point.estimatedOneRepMaxKg;
  return point.totalVolumeKg > 0 ? point.totalVolumeKg : undefined;
}

function getPerformanceChange(
  latestSet: WorkoutSetRecord | undefined,
  previousSet: WorkoutSetRecord | undefined,
  locale: string,
  t: (key: string, params?: Record<string, number | string>) => string,
): PerformanceChange | undefined {
  if (!latestSet || !previousSet) return undefined;

  if (latestSet.weightKg !== undefined && previousSet.weightKg !== undefined) {
    const weightDifference = latestSet.weightKg - previousSet.weightKg;
    if (weightDifference !== 0) {
      return {
        direction: weightDifference > 0 ? 'positive' : 'negative',
        label: `${weightDifference > 0 ? '+' : ''}${formatDecimal(weightDifference, locale)} kg`,
      };
    }
  }

  if (latestSet.repetitions !== undefined && previousSet.repetitions !== undefined) {
    const repetitionDifference = latestSet.repetitions - previousSet.repetitions;
    if (repetitionDifference !== 0) {
      return {
        direction: repetitionDifference > 0 ? 'positive' : 'negative',
        label: t('progress.repetitionChange', {
          count: `${repetitionDifference > 0 ? '+' : ''}${repetitionDifference}`,
        }),
      };
    }
  }

  return { direction: 'neutral', label: t('progress.noChange') };
}

function formatPerformance(
  workoutSet: WorkoutSetRecord | undefined,
  locale: string,
  repetitionsLabel: string,
) {
  if (!workoutSet) return '—';
  const weight = workoutSet.weightKg;
  const repetitions = workoutSet.repetitions;
  if (weight !== undefined && repetitions !== undefined) {
    return `${formatDecimal(weight, locale)} kg × ${repetitions}`;
  }
  if (weight !== undefined) return `${formatDecimal(weight, locale)} kg`;
  if (repetitions !== undefined) return `${repetitions} ${repetitionsLabel}`;
  return '—';
}

function formatChartValue(value: number, metric: ProgressMetric, locale: string) {
  if (metric === 'volume') return formatCompactNumber(value, locale);
  return formatDecimal(value, locale);
}

function formatCompactNumber(value: number, locale: string) {
  if (value >= 1000) {
    return `${(value / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })}B`;
  }
  return formatDecimal(value, locale);
}

function formatDecimal(value: number, locale: string) {
  return value.toLocaleString(locale, { maximumFractionDigits: 1 });
}

function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatShortDate(dateKey: string, locale: string) {
  return dateFromKey(dateKey).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

function formatLongDate(dateKey: string, locale: string) {
  return dateFromKey(dateKey).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

function createStyles(colors: ThemeColors, accentColor: string) {
  /** Kayıt satırlarını ve modal satırlarını ayıran saç teli çizgi. */
  const rowDivider = {
    borderTopColor: colors.separator,
    borderTopWidth: StyleSheet.hairlineWidth,
  };

  return StyleSheet.create({
    /**
     * Tek dikey akış. Bölümler kartlarla değil; başlık, boşluk ve `divider`
     * (hairline) ile ayrılır. Zemin ekran temasından gelir (`screenPadding`
     * History ekranındadır), böylece görünüm sakin bir günlük gibi durur.
     */
    container: { gap: 20 },
    section: { gap: 14 },
    eyebrow: { color: colors.textSecondary, ...Type.eyebrow },
    sectionTitle: { color: colors.text, ...Type.sectionTitle },
    sectionSubtitle: { color: colors.textSecondary, ...Type.caption, marginTop: 3 },
    sectionHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    sectionHeaderText: { flex: 1 },
    divider: { backgroundColor: colors.separator, height: StyleSheet.hairlineWidth },
    rowDivided: rowDivider,

    pickerRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: Layout.minTouchSize },
    pickerText: { flex: 1, gap: 4 },
    pickerName: { color: colors.text, ...Type.sectionTitle },
    pickerCountRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
    pickerCount: { color: colors.textTertiary, flexShrink: 1, ...Type.caption },

    summaryRow: { alignItems: 'stretch', flexDirection: 'row' },
    summaryItem: { flex: 1, gap: 5, justifyContent: 'flex-start' },
    summaryDivider: {
      backgroundColor: colors.separator,
      marginHorizontal: 12,
      width: StyleSheet.hairlineWidth,
    },
    summaryValue: {
      color: colors.text,
      ...Type.rowTitle,
      fontVariant: ['tabular-nums'],
    },
    summaryValueHighlighted: { color: accentColor },
    summaryLabel: { color: colors.textSecondary, ...Type.footnote },

    comparisonRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 12 },
    comparisonColumn: { flex: 1, gap: 6 },
    comparisonColumnEnd: { alignItems: 'flex-end' },
    comparisonLabel: { color: colors.textSecondary, ...Type.caption },
    comparisonValuePrevious: { color: colors.text, ...Type.rowTitle },
    comparisonValueLatest: { color: colors.text, ...Type.rowTitle, fontWeight: '600' },
    changeIndicator: { alignItems: 'center', flexDirection: 'row', gap: 3 },
    changeText: { color: accentColor, ...Type.caption, fontWeight: '500' },
    changeTextNegative: { color: colors.accent },
    changeTextNeutral: { color: colors.textSecondary },

    metricTabs: { flexDirection: 'row', gap: 20 },
    metricTab: {
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      flexShrink: 1,
      justifyContent: 'center',
      minHeight: 32,
      paddingBottom: 6,
    },
    metricTabSelected: { borderBottomColor: accentColor },
    metricText: { color: colors.textSecondary, ...Type.body },
    metricTextSelected: { color: accentColor, fontWeight: '600' },

    /** Grafik ekranın ana görsel odağı — çubuklar daha uzun ve öne çıkar. */
    chart: { alignItems: 'flex-end', flexDirection: 'row', gap: 5, marginTop: 4, minHeight: 176 },
    barColumn: { alignItems: 'center', flex: 1, gap: 8 },
    barValue: {
      color: colors.textSecondary,
      ...Type.footnote,
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
      width: '100%',
    },
    barTrack: { alignItems: 'center', height: CHART_BAR_HEIGHT, justifyContent: 'flex-end', width: '100%' },
    bar: { backgroundColor: colors.separator, borderRadius: 3, maxWidth: 22, width: '68%' },
    barLatest: { backgroundColor: accentColor },
    barDate: { color: colors.textTertiary, ...Type.footnote, textAlign: 'center', width: '100%' },
    barDateLatest: { color: colors.text },
    chartEmpty: {
      alignItems: 'center',
      gap: 8,
      justifyContent: 'center',
      minHeight: 176,
      paddingHorizontal: 8,
      paddingVertical: 20,
    },
    chartEmptyTitle: { color: colors.text, ...Type.rowTitle, fontWeight: '600', textAlign: 'center' },
    chartEmptyText: { color: colors.textSecondary, ...Type.caption, textAlign: 'center' },

    recordList: {},
    recordRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 52, paddingVertical: 12 },
    recordText: { flex: 1, gap: 3 },
    recordLabel: { color: colors.text, ...Type.body },
    recordDate: { color: colors.textSecondary, ...Type.caption },
    recordValue: {
      color: accentColor,
      ...Type.rowTitle,
      fontVariant: ['tabular-nums'],
      maxWidth: '40%',
      textAlign: 'right',
    },
    recordsEmpty: { color: colors.textSecondary, ...Type.caption, paddingVertical: 12, textAlign: 'center' },

    emptyState: { alignItems: 'center', gap: 8, paddingVertical: 40 },
    emptyTitle: { color: colors.text, ...Type.sectionTitle, textAlign: 'center' },
    emptyDescription: { color: colors.textSecondary, ...Type.caption, textAlign: 'center' },

    modalSafeArea: { backgroundColor: colors.background, flex: 1 },
    modalHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      paddingHorizontal: Layout.screenPadding,
      paddingVertical: 16,
    },
    modalHeaderText: { flex: 1, gap: 2 },
    modalTitle: { color: colors.text, ...Type.sectionTitle },
    modalSubtitle: { color: colors.textSecondary, ...Type.caption },
    modalCloseButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 17,
      height: 34,
      justifyContent: 'center',
      width: 34,
    },
    searchField: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusMedium,
      flexDirection: 'row',
      gap: 8,
      marginHorizontal: Layout.screenPadding,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 12,
    },
    searchInput: {
      color: colors.text,
      flex: 1,
      ...Type.body,
      minHeight: Layout.minTouchSize,
      paddingVertical: 0,
    },
    exerciseList: { paddingBottom: 24, paddingHorizontal: Layout.screenPadding, paddingTop: 8 },
    exerciseRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 56, paddingVertical: 12 },
    exerciseRowText: { flex: 1, gap: 3 },
    exerciseRowName: { color: colors.text, ...Type.rowTitle },
    exerciseRowNameSelected: { color: accentColor },
    exerciseRowMeta: { color: colors.textSecondary, ...Type.caption },
    modalEmpty: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 48 },
    modalEmptyText: { color: colors.textSecondary, ...Type.caption, textAlign: 'center' },
    pressed: { opacity: 0.7 },
  });
}
