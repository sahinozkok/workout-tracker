import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionSwap } from '@/components/motion-section';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { WorkoutActivityRecord } from '@/types/workout';
import {
  ActivityChartBar,
  ActivityMetricKey,
  buildActivityAnalytics,
  ExerciseActivityAnalytics,
  isMetricImprovement,
  toActivityChartBars,
} from '@/utils/activity-analytics';
import { formatMetersAsKilometers } from '@/utils/activity-input';
import { formatDuration } from '@/utils/workout-session';

/** Çubukların azami pikseli. Strength grafiğiyle aynı görsel ağırlık. */
const CHART_BAR_HEIGHT = 132;
/** Son kayıt listesinde gösterilecek satır sayısı. */
const RECENT_LIST_LIMIT = 8;

type ActivityProgressProps = {
  /** YALNIZ tamamlanmış/görünür oturumların kardiyo kayıtları (çağıran filtreler). */
  records: WorkoutActivityRecord[];
  /** Bir kardiyo kaydını düzenlemek için editör sheet'ini açar. */
  onEditRecord: (recordId: string) => void;
};

/**
 * KARDİYO GELİŞİMİ — süre/mesafe/tempo için gerçek gelişim görünümü.
 *
 * Strength `ExerciseProgress` ile AYNI tasarım dili: tek dikey akış, hairline
 * ayırıcılar, `View` tabanlı çubuk grafik, `historyProgress` vurgu rengi. Yeni
 * paket, gradient, glow veya sabit renk yoktur. Bütün sayılar
 * `utils/activity-analytics.ts` saf çekirdeğinden gelir; birim çevirisi ve
 * biçimlendirme yalnız burada yapılır.
 */
export function ActivityProgress({ records, onEditRecord }: ActivityProgressProps) {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const accent = useFeatureColor('historyProgress', colors.disciplineCompleted).color;
  const styles = useMemo(() => createStyles(colors, accent), [colors, accent]);

  const analytics = useMemo(() => buildActivityAnalytics(records), [records]);
  const [selectedKey, setSelectedKey] = useState(analytics[0]?.key);
  const [selectedMetric, setSelectedMetric] = useState<ActivityMetricKey>('duration');
  const [isPickerVisible, setIsPickerVisible] = useState(false);

  // Egzersiz kaybolduysa (silme sonrası) güvenle ilk egzersize dön.
  useEffect(() => {
    if (!analytics.some((exercise) => exercise.key === selectedKey)) {
      setSelectedKey(analytics[0]?.key);
    }
  }, [analytics, selectedKey]);

  const selected =
    analytics.find((exercise) => exercise.key === selectedKey) ?? analytics[0];

  // Egzersiz değişince seçili metrik yeni egzersizde yoksa ilk uygun metriğe dön.
  useEffect(() => {
    if (selected && !selected.availableMetrics.includes(selectedMetric)) {
      setSelectedMetric(selected.availableMetrics[0]);
    }
  }, [selected, selectedMetric]);

  if (!selected) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>{t('history.cardioEmptyTitle')}</Text>
        <Text style={styles.emptyDescription}>{t('history.cardioEmptyBody')}</Text>
      </View>
    );
  }

  const metric = selected.availableMetrics.includes(selectedMetric)
    ? selectedMetric
    : selected.availableMetrics[0];
  const summary = metric === 'distance' ? selected.distance : metric === 'pace' ? selected.pace : selected.duration;
  const bars = toActivityChartBars(selected.recentRecords, metric);
  const delta = selected.lastDelta[metric];
  const recentRecords = [...selected.recentRecords].reverse().slice(0, RECENT_LIST_LIMIT);

  return (
    <View style={styles.container}>
      {/* 1 — Kompakt egzersiz seçici */}
      <Pressable
        accessibilityHint={t('history.cardioPickerHint')}
        accessibilityRole="button"
        onPress={() => setIsPickerVisible(true)}
        style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}>
        <View style={styles.pickerText}>
          <Text style={styles.eyebrow}>{t('history.cardioProgressTitle').toLocaleUpperCase(locale)}</Text>
          <Text numberOfLines={1} style={styles.pickerName}>
            {selected.exerciseName}
          </Text>
        </View>
        <View style={styles.pickerCountRow}>
          <Text style={styles.pickerCount}>{t('history.exerciseCount', { count: analytics.length })}</Text>
          <Ionicons name="chevron-down" size={15} color={colors.textTertiary} />
        </View>
      </Pressable>

      {/* 2 — Son / en iyi / ortalama / kayıt sayısı */}
      <View style={styles.summaryRow}>
        <SummaryItem
          styles={styles}
          label={t('history.metricLast')}
          value={formatMetricValue(metricValueOf(selected.lastRecord, metric), metric, t, locale)}
        />
        <View style={styles.summaryDivider} />
        <SummaryItem
          highlighted
          styles={styles}
          label={t('history.metricBest')}
          value={summary ? formatMetricValue(summary.best, metric, t, locale) : '—'}
        />
        <View style={styles.summaryDivider} />
        <SummaryItem
          styles={styles}
          label={t('history.metricAverage')}
          value={summary ? formatMetricValue(summary.average, metric, t, locale) : '—'}
        />
        <View style={styles.summaryDivider} />
        <SummaryItem
          styles={styles}
          label={t('history.metricRecordCount')}
          value={String(selected.recordCount)}
        />
      </View>

      <View style={styles.divider} />

      {/* 3 — Metrik sekmeleri (yalnız geçerli veri olan metrikler) */}
      <MotionSwap contentWeight="heavy" pace="calm" transitionKey={`${selected.key}:${metric}`}>
        <View>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text style={styles.sectionTitle}>{t('history.cardioTrendTitle')}</Text>
              <Text style={styles.sectionSubtitle}>
                {t('history.cardioChartWindow', { count: bars.length })}
              </Text>
            </View>
            {delta !== undefined && delta !== 0 && (
              <View style={styles.changeIndicator}>
                <Ionicons
                  color={isMetricImprovement(metric, delta) ? accent : colors.accent}
                  name={isMetricImprovement(metric, delta) ? 'arrow-up' : 'arrow-down'}
                  size={12}
                />
                <Text
                  style={[
                    styles.changeText,
                    !isMetricImprovement(metric, delta) && styles.changeTextNegative,
                  ]}>
                  {formatDelta(delta, metric, t, locale)}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.metricTabs}>
            {selected.availableMetrics.map((metricKey) => {
              const isSelected = metricKey === metric;
              return (
                <Pressable
                  accessibilityLabel={t(metricLabelKey(metricKey))}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  hitSlop={8}
                  key={metricKey}
                  onPress={() => setSelectedMetric(metricKey)}
                  style={({ pressed }) => [
                    styles.metricTab,
                    isSelected && styles.metricTabSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text numberOfLines={1} style={[styles.metricText, isSelected && styles.metricTextSelected]}>
                    {t(metricLabelKey(metricKey))}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {bars.length > 0 ? (
            <View
              accessibilityLabel={t('history.cardioChartA11y', {
                exercise: selected.exerciseName,
                metric: t(metricLabelKey(metric)),
                count: bars.length,
              })}
              accessible
              style={styles.chart}>
              {bars.map((bar, index) => (
                <ChartBar
                  bar={bar}
                  isLatest={index === bars.length - 1}
                  key={bar.id}
                  locale={locale}
                  metric={metric}
                  styles={styles}
                  t={t}
                />
              ))}
            </View>
          ) : (
            <View style={styles.chartEmpty}>
              <Text style={styles.chartEmptyText}>{t('history.cardioNoMetricData')}</Text>
            </View>
          )}
        </View>
      </MotionSwap>

      <View style={styles.divider} />

      {/* 4 — Son kayıtlar (düzenlenebilir) */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>{t('history.recentRecordsTitle')}</Text>
          <Text style={styles.sectionSubtitle}>
            {t('history.recentRecordsSubtitle', { count: recentRecords.length })}
          </Text>
        </View>

        <View>
          {recentRecords.map((record, index) => (
            <Pressable
              accessibilityHint={t('history.editRecordRowHint')}
              accessibilityLabel={t('history.recordRowA11y', {
                exercise: selected.exerciseName,
                duration: formatDuration(record.durationSeconds),
                date: formatLongDate(record.completedAt, locale),
              })}
              accessibilityRole="button"
              key={record.id}
              onPress={() => onEditRecord(record.id)}
              style={({ pressed }) => [
                styles.recordRow,
                index > 0 && styles.rowDivided,
                pressed && styles.pressed,
              ]}>
              <View style={styles.recordText}>
                <Text numberOfLines={1} style={styles.recordValue}>
                  {formatRecordPrimary(record, selected.trackingMode, t, locale)}
                </Text>
                <Text style={styles.recordDate}>{formatLongDate(record.completedAt, locale)}</Text>
              </View>
              <View style={styles.recordMetaGroup}>
                {record.paceSecondsPerKm !== undefined && (
                  <Text style={styles.recordMeta}>
                    {formatDuration(Math.round(record.paceSecondsPerKm))} {t('day.paceUnit')}
                  </Text>
                )}
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      <ActivityExercisePicker
        accentColor={accent}
        analytics={analytics}
        colors={colors}
        locale={locale}
        onClose={() => setIsPickerVisible(false)}
        onSelect={(key) => {
          setSelectedKey(key);
          setIsPickerVisible(false);
        }}
        selectedKey={selected.key}
        styles={styles}
        t={t}
        visible={isPickerVisible}
      />
    </View>
  );
}

function SummaryItem({
  highlighted,
  label,
  styles,
  value,
}: {
  highlighted?: boolean;
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  return (
    <View style={styles.summaryItem}>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[styles.summaryValue, highlighted && styles.summaryValueHighlighted]}>
        {value}
      </Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function ChartBar({
  bar,
  isLatest,
  locale,
  metric,
  styles,
  t,
}: {
  bar: ActivityChartBar;
  isLatest: boolean;
  locale: string;
  metric: ActivityMetricKey;
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, number | string>) => string;
}) {
  const height = Math.max(6, bar.height * CHART_BAR_HEIGHT);
  return (
    <View style={styles.barColumn}>
      <Text adjustsFontSizeToFit numberOfLines={1} style={styles.barValue}>
        {formatChartLabel(bar.value, metric, t, locale)}
      </Text>
      <View style={styles.barTrack}>
        <View style={[styles.bar, { height }, isLatest && styles.barLatest]} />
      </View>
      <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.barDate, isLatest && styles.barDateLatest]}>
        {formatShortDate(bar.completedAt, locale)}
      </Text>
    </View>
  );
}

function ActivityExercisePicker({
  accentColor,
  analytics,
  colors,
  locale,
  onClose,
  onSelect,
  selectedKey,
  styles,
  t,
  visible,
}: {
  accentColor: string;
  analytics: ExerciseActivityAnalytics[];
  colors: ThemeColors;
  locale: string;
  onClose: () => void;
  onSelect: (key: string) => void;
  selectedKey: string;
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, number | string>) => string;
  visible: boolean;
}) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase(locale);
  const filtered = analytics.filter((exercise) =>
    exercise.exerciseName.toLocaleLowerCase(locale).includes(normalized),
  );

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.modalSafeArea}>
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderText}>
            <Text style={styles.modalTitle}>{t('history.cardioPickerTitle')}</Text>
            <Text style={styles.modalSubtitle}>{t('history.exerciseCount', { count: analytics.length })}</Text>
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
            placeholder={t('history.cardioSearchPlaceholder')}
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
          {filtered.map((exercise, index) => {
            const isSelected = exercise.key === selectedKey;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                key={exercise.key}
                onPress={() => onSelect(exercise.key)}
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
                    {t('history.activityRecordCount', { count: exercise.recordCount })}
                  </Text>
                </View>
                {isSelected && <Ionicons name="checkmark" size={18} color={accentColor} />}
              </Pressable>
            );
          })}
          {filtered.length === 0 && (
            <View style={styles.modalEmpty}>
              <Text style={styles.modalEmptyText}>{t('history.cardioNoSearchResults')}</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Biçimlendirme — saf; birim çevirisi yalnız görüntüleme katmanında.
// ---------------------------------------------------------------------------
function metricLabelKey(metric: ActivityMetricKey): string {
  if (metric === 'distance') return 'history.activityDistance';
  if (metric === 'pace') return 'history.activityPace';
  return 'history.activityDuration';
}

function metricValueOf(
  record: { durationSeconds: number; distanceMeters?: number; paceSecondsPerKm?: number },
  metric: ActivityMetricKey,
): number | undefined {
  if (metric === 'distance') return record.distanceMeters;
  if (metric === 'pace') return record.paceSecondsPerKm;
  return record.durationSeconds;
}

function formatMetricValue(
  value: number | undefined,
  metric: ActivityMetricKey,
  t: (key: string) => string,
  locale: string,
): string {
  if (value === undefined) return '—';
  if (metric === 'distance') return `${formatMetersAsKilometers(value)} ${t('day.kmUnit')}`;
  if (metric === 'pace') return `${formatDuration(Math.round(value))} ${t('day.paceUnit')}`;
  return formatDuration(value);
}

function formatChartLabel(
  value: number,
  metric: ActivityMetricKey,
  t: (key: string) => string,
  locale: string,
): string {
  if (metric === 'distance') return formatMetersAsKilometers(value);
  if (metric === 'pace') return formatDuration(Math.round(value));
  return formatDuration(value);
}

function formatDelta(
  delta: number,
  metric: ActivityMetricKey,
  t: (key: string) => string,
  locale: string,
): string {
  const sign = delta > 0 ? '+' : '−';
  const magnitude = formatMetricValue(Math.abs(delta), metric, t, locale);
  return `${sign}${magnitude}`;
}

function formatRecordPrimary(
  record: { durationSeconds: number; distanceMeters?: number },
  trackingMode: 'duration' | 'distance',
  t: (key: string) => string,
  locale: string,
): string {
  if (trackingMode === 'distance' && record.distanceMeters !== undefined) {
    return `${formatMetersAsKilometers(record.distanceMeters)} ${t('day.kmUnit')} · ${formatDuration(record.durationSeconds)}`;
  }
  return formatDuration(record.durationSeconds);
}

function dateFromTimestamp(value: string) {
  return new Date(value);
}

function formatShortDate(value: string, locale: string) {
  return dateFromTimestamp(value).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

function formatLongDate(value: string, locale: string) {
  return dateFromTimestamp(value).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

function createStyles(colors: ThemeColors, accentColor: string) {
  const rowDivider = { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth };

  return StyleSheet.create({
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
    summaryDivider: { backgroundColor: colors.separator, marginHorizontal: 10, width: StyleSheet.hairlineWidth },
    summaryValue: { color: colors.text, ...Type.rowTitle, fontVariant: ['tabular-nums'] },
    summaryValueHighlighted: { color: accentColor },
    summaryLabel: { color: colors.textSecondary, ...Type.footnote },

    changeIndicator: { alignItems: 'center', flexDirection: 'row', gap: 3 },
    changeText: { color: accentColor, ...Type.caption, fontVariant: ['tabular-nums'], fontWeight: '500' },
    changeTextNegative: { color: colors.accent },

    metricTabs: { flexDirection: 'row', gap: 20, marginTop: 12 },
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

    chart: { alignItems: 'flex-end', flexDirection: 'row', gap: 5, marginTop: 12, minHeight: 176 },
    barColumn: { alignItems: 'center', flex: 1, gap: 8 },
    barValue: { color: colors.textSecondary, ...Type.footnote, fontVariant: ['tabular-nums'], textAlign: 'center', width: '100%' },
    barTrack: { alignItems: 'center', height: CHART_BAR_HEIGHT, justifyContent: 'flex-end', width: '100%' },
    bar: { backgroundColor: colors.separator, borderRadius: 3, maxWidth: 22, width: '68%' },
    barLatest: { backgroundColor: accentColor },
    barDate: { color: colors.textTertiary, ...Type.footnote, textAlign: 'center', width: '100%' },
    barDateLatest: { color: colors.text },
    chartEmpty: { alignItems: 'center', justifyContent: 'center', minHeight: 176, paddingVertical: 20 },
    chartEmptyText: { color: colors.textSecondary, ...Type.caption, textAlign: 'center' },

    recordRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: Layout.minTouchSize, paddingVertical: 12 },
    recordText: { flex: 1, gap: 3 },
    recordValue: { color: colors.text, ...Type.body, fontVariant: ['tabular-nums'] },
    recordDate: { color: colors.textSecondary, ...Type.caption },
    recordMetaGroup: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    recordMeta: { color: colors.textSecondary, ...Type.caption, fontVariant: ['tabular-nums'] },

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
    searchInput: { color: colors.text, flex: 1, ...Type.body, minHeight: Layout.minTouchSize, paddingVertical: 0 },
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
