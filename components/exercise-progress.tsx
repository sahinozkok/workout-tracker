import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { WorkoutSetRecord } from '@/types/workout';
import { buildExerciseAnalytics, ExerciseProgressPoint } from '@/utils/workout-analytics';

type ProgressMetric = 'weight' | 'repetitions' | 'volume';

type ExerciseProgressProps = {
  workoutSets: WorkoutSetRecord[];
};

const METRICS: { key: ProgressMetric; labelKey: string }[] = [
  { key: 'weight', labelKey: 'components.weight' },
  { key: 'repetitions', labelKey: 'components.repetitions' },
  { key: 'volume', labelKey: 'components.volume' },
];

export function ExerciseProgress({ workoutSets }: ExerciseProgressProps) {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const styles = createStyles(colors);
  const analytics = useMemo(() => buildExerciseAnalytics(workoutSets), [workoutSets]);
  const [selectedExerciseKey, setSelectedExerciseKey] = useState(analytics[0]?.exerciseKey);
  const [selectedMetric, setSelectedMetric] = useState<ProgressMetric>('weight');

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
        <View style={styles.emptyIcon}>
          <Ionicons name="trending-up-outline" size={28} color={colors.primaryIcon} />
        </View>
        <Text style={styles.emptyTitle}>{t('components.progressEmptyTitle')}</Text>
        <Text style={styles.emptyDescription}>{t('progress.emptyDescription')}</Text>
      </View>
    );
  }

  const chartPoints = selectedExercise.points
    .map((point) => ({ point, value: getMetricValue(point, selectedMetric) }))
    .filter((item) => item.value !== undefined && item.value > 0)
    .slice(-8) as { point: ExerciseProgressPoint; value: number }[];
  const firstValue = chartPoints[0]?.value;
  const latestValue = chartPoints[chartPoints.length - 1]?.value;
  const changePercentage =
    firstValue && latestValue !== undefined ? ((latestValue - firstValue) / firstValue) * 100 : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.eyebrow}>{t('progress.title').toLocaleUpperCase(locale)}</Text>
          <Text style={styles.sectionTitle}>{t('components.chooseExercise')}</Text>
        </View>
        <View style={styles.exerciseCountBadge}>
          <Text style={styles.exerciseCountText}>{analytics.length}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.exerciseSelector}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {analytics.map((exercise) => {
          const isSelected = exercise.exerciseKey === selectedExercise.exerciseKey;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              key={exercise.exerciseKey}
              onPress={() => setSelectedExerciseKey(exercise.exerciseKey)}
              style={({ pressed }) => [
                styles.exerciseChip,
                isSelected && styles.exerciseChipSelected,
                pressed && styles.pressed,
              ]}>
              <Text
                numberOfLines={1}
                style={[styles.exerciseChipText, isSelected && styles.exerciseChipTextSelected]}>
                {exercise.exerciseName}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.summaryGrid}>
        <ProgressSummary
          colors={colors}
          icon="barbell-outline"
          label={t('progress.bestWeight')}
          value={
            selectedExercise.bestWeightSet?.weightKg === undefined
              ? '—'
              : `${formatDecimal(selectedExercise.bestWeightSet.weightKg, locale)} kg`
          }
        />
        <ProgressSummary
          colors={colors}
          icon="repeat-outline"
          label={t('progress.bestReps')}
          value={selectedExercise.bestRepetitionSet?.repetitions?.toString() ?? '—'}
        />
        <ProgressSummary
          colors={colors}
          icon="layers-outline"
          label={t('progress.totalVolume')}
          value={
            selectedExercise.totalVolumeKg > 0
              ? `${formatCompactNumber(selectedExercise.totalVolumeKg, locale)} kg`
              : '—'
          }
        />
      </View>

      <View style={styles.chartSection}>
        <View style={styles.chartHeading}>
          <View>
            <Text style={styles.chartTitle}>{selectedExercise.exerciseName}</Text>
            <Text style={styles.chartSubtitle}>
              {t('progress.lastWorkoutDays', { count: Math.min(selectedExercise.points.length, 8) })}
            </Text>
          </View>
          {changePercentage !== undefined && chartPoints.length > 1 && (
            <View style={[styles.trendBadge, changePercentage < 0 && styles.trendBadgeNegative]}>
              <Ionicons
                name={changePercentage >= 0 ? 'arrow-up' : 'arrow-down'}
                size={12}
                color={changePercentage >= 0 ? colors.disciplineCompleted : colors.accentBright}
              />
              <Text style={[styles.trendText, changePercentage < 0 && styles.trendTextNegative]}>
                %{formatDecimal(Math.abs(changePercentage), locale)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.metricSelector}>
          {METRICS.map((metric) => {
            const isSelected = metric.key === selectedMetric;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                key={metric.key}
                onPress={() => setSelectedMetric(metric.key)}
                style={({ pressed }) => [
                  styles.metricButton,
                  isSelected && styles.metricButtonSelected,
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.metricText, isSelected && styles.metricTextSelected]}>{t(metric.labelKey)}</Text>
              </Pressable>
            );
          })}
        </View>

        {chartPoints.length > 0 ? (
          <ProgressChart colors={colors} locale={locale} metric={selectedMetric} points={chartPoints} />
        ) : (
          <View style={styles.chartEmpty}>
            <Ionicons name="analytics-outline" size={24} color={colors.textTertiary} />
            <Text style={styles.chartEmptyText}>
              {selectedMetric === 'weight' ? t('progress.noWeightRecord') : t('progress.noMetricData')}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.recordsSection}>
        <View style={styles.recordsHeading}>
          <View style={styles.recordHeadingIcon}>
            <Ionicons name="trophy-outline" size={18} color={colors.accentBright} />
          </View>
          <View>
            <Text style={styles.recordsTitle}>{t('components.personalRecords')}</Text>
            <Text style={styles.recordsSubtitle}>{t('createProgram.recordsSubtitle')}</Text>
          </View>
        </View>

        <RecordRow
          colors={colors}
          dateKey={selectedExercise.bestWeightSet?.dateKey}
          locale={locale}
          label={t('progress.bestWeight')}
          noRecordLabel={t('components.noRecordYet')}
          value={formatWeightRecord(selectedExercise.bestWeightSet, locale)}
        />
        <RecordRow
          colors={colors}
          dateKey={selectedExercise.bestRepetitionSet?.dateKey}
          locale={locale}
          label={t('progress.bestReps')}
          noRecordLabel={t('components.noRecordYet')}
          value={formatRepetitionRecord(selectedExercise.bestRepetitionSet, locale, t('components.repetitions').toLocaleLowerCase(locale))}
        />
        <RecordRow
          colors={colors}
          dateKey={selectedExercise.bestVolumeSet?.dateKey}
          locale={locale}
          label={t('progress.totalVolume')}
          noRecordLabel={t('components.noRecordYet')}
          value={formatVolumeRecord(selectedExercise.bestVolumeSet, locale)}
        />
      </View>
    </View>
  );
}

function ProgressSummary({
  colors,
  icon,
  label,
  value,
}: {
  colors: ThemeColors;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const styles = createStyles(colors);

  return (
    <View style={styles.summaryCard}>
      <Ionicons name={icon} size={16} color={colors.primaryIcon} />
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.summaryValue}>{value}</Text>
      <Text numberOfLines={1} style={styles.summaryLabel}>{label}</Text>
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
  const styles = createStyles(colors);
  const maxValue = Math.max(...points.map((item) => item.value));

  return (
    <View style={styles.chart}>
      {points.map(({ point, value }, index) => {
        const isLatest = index === points.length - 1;
        const height = Math.max(8, (value / maxValue) * 94);
        return (
          <View key={point.dateKey} style={styles.barColumn}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={styles.barValue}>
              {formatChartValue(value, metric, locale)}
            </Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  { height },
                  isLatest && styles.barLatest,
                ]}
              />
            </View>
            <Text style={[styles.barDate, isLatest && styles.barDateLatest]}>{formatShortDate(point.dateKey, locale)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function RecordRow({
  noRecordLabel,
  colors,
  dateKey,
  label,
  locale,
  value,
}: {
  colors: ThemeColors;
  dateKey?: string;
  locale: string;
  noRecordLabel: string;
  label: string;
  value: string;
}) {
  const styles = createStyles(colors);

  return (
    <View style={styles.recordRow}>
      <View style={styles.recordDot} />
      <View style={styles.recordText}>
        <Text style={styles.recordLabel}>{label}</Text>
        <Text style={styles.recordDate}>{dateKey ? formatLongDate(dateKey, locale) : noRecordLabel}</Text>
      </View>
      <Text style={styles.recordValue}>{value}</Text>
    </View>
  );
}

function getMetricValue(point: ExerciseProgressPoint, metric: ProgressMetric) {
  if (metric === 'weight') return point.maxWeightKg;
  if (metric === 'repetitions') return point.maxRepetitions;
  return point.totalVolumeKg > 0 ? point.totalVolumeKg : undefined;
}

function formatWeightRecord(workoutSet: WorkoutSetRecord | undefined, locale: string) {
  if (workoutSet?.weightKg === undefined) return '—';
  const repetitions = workoutSet.repetitions === undefined ? '' : ` × ${workoutSet.repetitions}`;
  return `${formatDecimal(workoutSet.weightKg, locale)} kg${repetitions}`;
}

function formatRepetitionRecord(workoutSet: WorkoutSetRecord | undefined, locale: string, repsLabel: string) {
  if (workoutSet?.repetitions === undefined) return '—';
  const weight = workoutSet.weightKg === undefined ? '' : ` · ${formatDecimal(workoutSet.weightKg, locale)} kg`;
  return `${workoutSet.repetitions} ${repsLabel}${weight}`;
}

function formatVolumeRecord(workoutSet: WorkoutSetRecord | undefined, locale: string) {
  if (workoutSet?.weightKg === undefined || workoutSet.repetitions === undefined) return '—';
  const volume = workoutSet.weightKg * workoutSet.repetitions;
  return `${formatDecimal(volume, locale)} kg`;
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { gap: 22 },
    sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    eyebrow: { color: colors.primaryIcon, fontSize: 9, fontWeight: '600', letterSpacing: 1.2 },
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '600', marginTop: 3 },
    exerciseCountBadge: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      height: 34,
      justifyContent: 'center',
      width: 34,
    },
    exerciseCountText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    exerciseSelector: { gap: 8, paddingRight: 20 },
    exerciseChip: {
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      maxWidth: 180,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    exerciseChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    exerciseChipText: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
    exerciseChipTextSelected: { color: colors.onPrimary },
    summaryGrid: { flexDirection: 'row', gap: 8 },
    summaryCard: {
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      flex: 1,
      gap: 5,
      minHeight: 92,
      padding: 10,
    },
    summaryValue: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: 2 },
    summaryLabel: { color: colors.textTertiary, fontSize: 8, fontWeight: '500' },
    chartSection: { borderBottomColor: colors.border, borderBottomWidth: 1, gap: 16, paddingBottom: 20 },
    chartHeading: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
    chartTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
    chartSubtitle: { color: colors.textTertiary, fontSize: 10, marginTop: 3 },
    trendBadge: {
      alignItems: 'center',
      backgroundColor: '#102617',
      borderRadius: 8,
      flexDirection: 'row',
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    trendBadgeNegative: { backgroundColor: colors.accentSoft },
    trendText: { color: colors.disciplineCompleted, fontSize: 10, fontWeight: '600' },
    trendTextNegative: { color: colors.accentBright },
    metricSelector: { borderColor: colors.border, borderRadius: 10, borderWidth: 1, flexDirection: 'row', padding: 3 },
    metricButton: { alignItems: 'center', borderRadius: 7, flex: 1, paddingVertical: 8 },
    metricButtonSelected: { backgroundColor: colors.primary },
    metricText: { color: colors.textTertiary, fontSize: 10, fontWeight: '500' },
    metricTextSelected: { color: colors.onPrimary },
    chart: { alignItems: 'flex-end', flexDirection: 'row', gap: 5, minHeight: 145 },
    barColumn: { alignItems: 'center', flex: 1, gap: 5 },
    barValue: { color: colors.textSecondary, fontSize: 7, fontWeight: '500', width: '100%', textAlign: 'center' },
    barTrack: { alignItems: 'center', height: 94, justifyContent: 'flex-end', width: '100%' },
    bar: { backgroundColor: colors.primarySoftBorder, borderRadius: 4, maxWidth: 24, width: '70%' },
    barLatest: { backgroundColor: colors.primaryIcon },
    barDate: { color: colors.textTertiary, fontSize: 7, textAlign: 'center' },
    barDateLatest: { color: colors.textSecondary, fontWeight: '600' },
    chartEmpty: { alignItems: 'center', gap: 8, justifyContent: 'center', minHeight: 145 },
    chartEmptyText: { color: colors.textTertiary, fontSize: 11, textAlign: 'center' },
    recordsSection: { gap: 0 },
    recordsHeading: { alignItems: 'center', flexDirection: 'row', gap: 10, marginBottom: 8 },
    recordHeadingIcon: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 9,
      borderWidth: 1,
      height: 36,
      justifyContent: 'center',
      width: 36,
    },
    recordsTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
    recordsSubtitle: { color: colors.textTertiary, fontSize: 9, marginTop: 2 },
    recordRow: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 9,
      minHeight: 61,
      paddingVertical: 10,
    },
    recordDot: { backgroundColor: colors.accentBright, borderRadius: 3, height: 6, width: 6 },
    recordText: { flex: 1 },
    recordLabel: { color: colors.text, fontSize: 12, fontWeight: '500' },
    recordDate: { color: colors.textTertiary, fontSize: 8, marginTop: 3 },
    recordValue: { color: colors.accentText, fontSize: 11, fontWeight: '600', maxWidth: '43%', textAlign: 'right' },
    emptyState: { alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 50 },
    emptyIcon: {
      alignItems: 'center',
      borderColor: colors.primarySoftBorder,
      borderRadius: 14,
      borderWidth: 1,
      height: 54,
      justifyContent: 'center',
      width: 54,
    },
    emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '600', textAlign: 'center' },
    emptyDescription: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, textAlign: 'center' },
    pressed: { opacity: 0.72 },
  });
}
