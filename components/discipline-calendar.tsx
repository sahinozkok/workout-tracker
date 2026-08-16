import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  AlertButton,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { DisciplineStatus } from '@/types/workout';
import { getWeekdayShortLabel, WEEKDAY_VALUES } from '@/constants/weekdays';
import { toDateKey } from '@/utils/discipline';
import { getSetProgressKey } from '@/utils/workout-schedule';
import { formatDuration } from '@/utils/workout-session';

type CalendarPeriod = 'week' | 'month' | 'year';

const PERIOD_VALUES: CalendarPeriod[] = ['week', 'month', 'year'];

/**
 * `comfortable` Ana Sayfa'nın mevcut ölçüleridir ve hiçbir koşulda değişmez.
 * `compact` profil ekranları içindir: gerçek hücre, boşluk ve yazı ölçüleri
 * küçülür — `transform: scale()` KULLANILMAZ, çünkü ölçekleme dokunma
 * alanlarını da küçültür ve metni bulanıklaştırır.
 */
export type CalendarDensity = 'comfortable' | 'compact';

type CalendarMetrics = {
  dayCircleSize: number;
  dayFontSize: number;
  /** Görsel daire küçülse de dokunma alanı ~44 pt'ye tamamlanır. */
  dayHitSlop: number;
  legendFontSize: number;
  legendGap: number;
  monthCellPaddingVertical: number;
  /** Ay ızgarasında ayrı tutulur: Ana Sayfa'nın mevcut davranışı korunur. */
  monthDayHitSlop: number;
  monthRowGap: number;
  sectionGap: number;
  weekdayFontSize: number;
  yearCellGap: number;
  yearCellHitSlop: number;
  yearCellSize: number;
  yearLabelWidth: number;
};

/** Ana Sayfa takviminin bugünkü ölçüleri; birebir korunur. */
const COMFORTABLE_METRICS: CalendarMetrics = {
  dayCircleSize: 30,
  dayFontSize: 13,
  dayHitSlop: 6,
  legendFontSize: 12,
  legendGap: 16,
  monthCellPaddingVertical: 3,
  monthDayHitSlop: 0,
  monthRowGap: 8,
  sectionGap: 16,
  weekdayFontSize: 11,
  yearCellGap: 3,
  yearCellHitSlop: 0,
  yearCellSize: 14,
  yearLabelWidth: 20,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Kompakt ölçüler kapsayıcının GERÇEK genişliğinden türetilir; sabit bir ekran
 * genişliği varsayılmaz. 375 pt'lik iPhone SE'de profil içeriği 335 pt kalır →
 * hücre 47.8 pt → daire 26 pt ve satır rahatça sığar.
 */
export function getCalendarMetrics(density: CalendarDensity, availableWidth: number): CalendarMetrics {
  if (density === 'comfortable') return COMFORTABLE_METRICS;

  const cellWidth = availableWidth > 0 ? availableWidth / 7 : 48;
  const dayCircleSize = clamp(Math.floor(cellWidth) - 8, 20, 26);

  return {
    dayCircleSize,
    dayFontSize: dayCircleSize >= 24 ? 12 : 11,
    dayHitSlop: Math.max(0, Math.ceil((44 - dayCircleSize) / 2)),
    legendFontSize: 11,
    legendGap: 12,
    monthCellPaddingVertical: 4,
    // Ay hücrelerinde dikey komşular yakın olduğu için yatay paya göre daha
    // ölçülü bir değer kullanılır; yine de 44 pt'ye yaklaşan bir alan kalır.
    monthDayHitSlop: Math.max(0, Math.min(9, Math.ceil((44 - dayCircleSize) / 2))),
    monthRowGap: 6,
    sectionGap: 12,
    weekdayFontSize: 10,
    yearCellGap: 3,
    yearCellHitSlop: 2,
    yearCellSize: 11,
    yearLabelWidth: 16,
  };
}

type DisciplineCalendarViewProps = {
  /**
   * `compact` profil ekranlarında kullanılır; Ana Sayfa varsayılan
   * `comfortable` ölçüsünde kalır.
   */
  density?: CalendarDensity;
  /** Profil ekranı hafta görünümüyle açılır; Ana Sayfa varsayılanı da hafta. */
  initialPeriod?: CalendarPeriod;
  /**
   * Verilmezse takvim **salt okunur** olur: günler basılamaz. Arkadaş
   * profilinde bilinçli olarak verilmez.
   */
  onDayPress?: (dateKey: string) => void;
  statuses: Record<string, DisciplineStatus>;
};

/**
 * Saf takvim görünümü. Yalnızca kendisine verilen `statuses` verisini gösterir;
 * hiçbir context okumaz, hiçbir veri yazmaz. Bu sayede aynı görünüm hem
 * mevcut kullanıcının etkileşimli takviminde hem de arkadaşın salt okunur
 * takviminde kullanılabilir.
 */
export function DisciplineCalendarView({
  density = 'comfortable',
  initialPeriod = 'week',
  onDayPress,
  statuses,
}: DisciplineCalendarViewProps) {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const isCompact = density === 'compact';
  // Ölçüm gelene kadar pencere genişliği güvenli bir başlangıç değeridir;
  // gerçek genişlik `onLayout` ile öğrenilir (sabit ekran varsayımı yok).
  const [measuredWidth, setMeasuredWidth] = useState<number>();
  const availableWidth = measuredWidth ?? windowWidth;
  const metrics = useMemo(
    () => getCalendarMetrics(density, availableWidth),
    [availableWidth, density],
  );
  const styles = useMemo(() => createStyles(colors, metrics), [colors, metrics]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setMeasuredWidth((current) => (current === nextWidth ? current : nextWidth));
  }, []);
  const weekdayLabels = useMemo(() => WEEKDAY_VALUES.map((value) => getWeekdayShortLabel(value, locale)), [locale]);
  const yearWeekdayLabels = useMemo(
    () => weekdayLabels.map((label, index) => (index % 2 === 0 ? label : '')),
    [weekdayLabels],
  );
  const statusLabels = useMemo<Record<DisciplineStatus, string>>(
    () => ({
      completed: t('calendar.completed'),
      partial: t('calendar.partialFull'),
      skipped: t('calendar.skipped'),
    }),
    [t],
  );
  const [period, setPeriod] = useState<CalendarPeriod>(initialPeriod);
  const today = useMemo(() => startOfDay(new Date()), []);
  const dates = useMemo(() => getPeriodDates(period, today), [period, today]);

  function getAccessibilityLabel(date: Date, status: DisciplineStatus | undefined, isFuture: boolean) {
    const dateLabel = date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
    if (isFuture) return `${dateLabel}, ${t('calendar.futureDay')}`;
    return `${dateLabel}, ${status ? statusLabels[status] : t('calendar.unmarked')}`;
  }

  return (
    <View onLayout={isCompact ? handleLayout : undefined} style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('calendar.title')}</Text>
        <Text style={styles.periodLabel}>{getPeriodLabel(period, today, locale, t)}</Text>
      </View>

      <View accessibilityRole="tablist" style={styles.periodPicker}>
        {PERIOD_VALUES.map((option) => {
          const isSelected = option === period;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              hitSlop={8}
              key={option}
              onPress={() => setPeriod(option)}
              style={({ pressed }) => [styles.periodButton, pressed && styles.pressed]}>
              <Text style={[styles.periodButtonText, isSelected && styles.periodButtonTextSelected]}>
                {t(`calendar.${option}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {period === 'week' ? (
        <WeekStrip
          colors={colors}
          dates={dates}
          getLabel={getAccessibilityLabel}
          metrics={metrics}
          onDayPress={onDayPress}
          statuses={statuses}
          styles={styles}
          today={today}
          weekdayLabels={weekdayLabels}
        />
      ) : period === 'year' ? (
        <YearGrid
          colors={colors}
          dates={dates}
          getLabel={getAccessibilityLabel}
          locale={locale}
          metrics={metrics}
          onDayPress={onDayPress}
          statuses={statuses}
          styles={styles}
          today={today}
          weekdayLabels={yearWeekdayLabels}
        />
      ) : (
        <MonthGrid
          colors={colors}
          dates={dates}
          getLabel={getAccessibilityLabel}
          metrics={metrics}
          month={today.getMonth()}
          onDayPress={onDayPress}
          statuses={statuses}
          styles={styles}
          today={today}
          weekdayLabels={weekdayLabels}
        />
      )}

      <View style={styles.legend}>
        <LegendItem color={colors.disciplineCompleted} label={t('calendar.completed')} styles={styles} />
        <LegendItem color={colors.disciplinePartial} label={t('calendar.partial')} styles={styles} />
        <LegendItem color={colors.disciplineSkipped} label={t('calendar.skipped')} styles={styles} />
      </View>
    </View>
  );
}
/**
 * Mevcut kullanıcının takvimi. `WorkoutContext` verisini okuyan adapter
 * katmanıdır: gün ayrıntısı ve izin verilen manuel durum değiştirme burada
 * kalır, görünüm işini `DisciplineCalendarView` yapar.
 */
export function DisciplineCalendar({ density }: { density?: CalendarDensity } = {}) {
  const {
    activeProgramId,
    completedSetCounts,
    disciplineStatuses,
    cycleDisciplineStatus,
    isDateScheduled,
    programs,
    workoutSessions,
  } = useWorkout();
  const { locale, t } = useTranslation();
  const statusLabels = useMemo<Record<DisciplineStatus, string>>(
    () => ({
      completed: t('calendar.completed'),
      partial: t('calendar.partialFull'),
      skipped: t('calendar.skipped'),
    }),
    [t],
  );
  const [pendingDateKey, setPendingDateKey] = useState<string>();

  async function cycleStatus(dateKey: string) {
    if (pendingDateKey) return;

    setPendingDateKey(dateKey);
    try {
      await cycleDisciplineStatus(dateKey);
    } catch (error) {
      Alert.alert(
        t('calendar.saveFailed'),
        error instanceof Error ? error.message : t('common.networkError'),
      );
    } finally {
      setPendingDateKey(undefined);
    }
  }

  function handleDayPress(dateKey: string) {
    const date = dateFromKey(dateKey);
    const status = disciplineStatuses[dateKey];
    const isScheduled = isDateScheduled(dateKey);
    const activeProgram = programs.find((program) => program.id === activeProgramId);
    const scheduledDays = activeProgram?.days.filter((day) => day.scheduledWeekday === date.getDay()) ?? [];
    const totalSets = scheduledDays
      .filter((day) => !day.isOffDay)
      .flatMap((day) => day.exercises)
      .reduce((total, exercise) => total + exercise.targetSets, 0);
    const completedSets = scheduledDays
      .filter((day) => !day.isOffDay)
      .flatMap((day) => day.exercises)
      .reduce(
        (total, exercise) =>
          total + Math.min(completedSetCounts[getSetProgressKey(dateKey, exercise.id)] ?? 0, exercise.targetSets),
        0,
      );
    const completedSession = workoutSessions.find(
      (session) => session.dateKey === dateKey && session.status === 'completed',
    );
    const planLabel = scheduledDays.length
      ? scheduledDays
          .map((day) => (day.isOffDay ? t('calendar.restSuffix', { name: day.name }) : day.name))
          .join(', ')
      : t('calendar.noPlannedWorkout');
    const statusLabel = status ? statusLabels[status] : t('calendar.unmarked');
    const detailLines = [
      t('calendar.status', { status: statusLabel }),
      t('calendar.plan', { plan: planLabel }),
      totalSets > 0 ? t('calendar.progress', { completed: completedSets, total: totalSets }) : undefined,
      completedSession
        ? t('calendar.duration', { duration: formatDuration(completedSession.accumulatedDurationSeconds) })
        : undefined,
    ].filter(Boolean);
    const buttons: AlertButton[] = [{ text: t('common.close'), style: 'cancel' }];

    if (!isScheduled) {
      buttons.push({ text: t('calendar.changeStatus'), onPress: () => void cycleStatus(dateKey) });
    }

    Alert.alert(
      date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }),
      detailLines.join('\n'),
      buttons,
    );
  }

  return (
    <DisciplineCalendarView
      density={density}
      onDayPress={handleDayPress}
      statuses={disciplineStatuses}
    />
  );
}

type GridProps = {
  colors: ThemeColors;
  dates: Date[];
  getLabel: (date: Date, status: DisciplineStatus | undefined, isFuture: boolean) => string;
  metrics: CalendarMetrics;
  /** Verilmezse günler basılamaz (salt okunur takvim). */
  onDayPress?: (dateKey: string) => void;
  statuses: Record<string, DisciplineStatus>;
  styles: ReturnType<typeof createStyles>;
  today: Date;
  weekdayLabels: string[];
};

function WeekStrip({
  colors,
  dates,
  getLabel,
  metrics,
  onDayPress,
  statuses,
  styles,
  today,
  weekdayLabels,
}: GridProps) {
  return (
    <View style={styles.weekStrip}>
      <View style={styles.weekLine} />
      <View style={styles.weekRow}>
        {dates.map((date, index) => {
          const dateKey = toDateKey(date);
          const status = statuses[dateKey];
          const isFuture = date.getTime() > today.getTime();
          const isToday = date.getTime() === today.getTime();
          const filled = !isFuture && status !== undefined;

          return (
            <View key={dateKey} style={styles.weekCell}>
              <Pressable
                accessibilityLabel={getLabel(date, status, isFuture)}
                accessibilityRole="button"
                disabled={isFuture || !onDayPress}
                hitSlop={metrics.dayHitSlop}
                onPress={onDayPress ? () => onDayPress(dateKey) : undefined}
                style={({ pressed }) => [
                  styles.dayCircle,
                  { backgroundColor: filled ? getStatusColor(colors, status, isFuture) : colors.background },
                  !filled && styles.dayCircleOutlined,
                  isToday && styles.dayCircleToday,
                  pressed && styles.pressed,
                ]}>
                <Text
                  style={[
                    styles.dayNumber,
                    filled && styles.dayNumberFilled,
                    isToday && styles.dayNumberToday,
                    isFuture && styles.dayNumberFuture,
                  ]}>
                  {date.getDate()}
                </Text>
              </Pressable>
              <Text style={[styles.weekdayLabel, isToday && styles.weekdayLabelToday]}>
                {weekdayLabels[index] ?? ''}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MonthGrid({
  colors,
  dates,
  getLabel,
  metrics,
  month,
  onDayPress,
  statuses,
  styles,
  today,
  weekdayLabels,
}: GridProps & { month: number }) {
  const weeks = groupIntoWeeks(dates);

  return (
    <View style={styles.monthGrid}>
      <View style={styles.monthRow}>
        {weekdayLabels.map((label) => (
          <Text key={label} style={styles.monthWeekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      {weeks.map((week) => (
        <View key={toDateKey(week[0])} style={styles.monthRow}>
          {week.map((date) => {
            const dateKey = toDateKey(date);
            const status = statuses[dateKey];
            const isFuture = date.getTime() > today.getTime();
            const isOutsideMonth = date.getMonth() !== month;
            const isToday = date.getTime() === today.getTime();
            const filled = !isFuture && !isOutsideMonth && status !== undefined;

            return (
              <View key={dateKey} style={styles.monthCell}>
                {isOutsideMonth ? (
                  <View style={styles.monthCellSpacer} />
                ) : (
                  <Pressable
                    accessibilityLabel={getLabel(date, status, isFuture)}
                    accessibilityRole="button"
                    disabled={isFuture || !onDayPress}
                    hitSlop={metrics.monthDayHitSlop}
                    onPress={onDayPress ? () => onDayPress(dateKey) : undefined}
                    style={({ pressed }) => [
                      styles.dayCircle,
                      { backgroundColor: filled ? getStatusColor(colors, status, isFuture) : colors.background },
                      !filled && styles.dayCircleOutlined,
                      isToday && styles.dayCircleToday,
                      pressed && styles.pressed,
                    ]}>
                    <Text
                      style={[
                        styles.dayNumber,
                        filled && styles.dayNumberFilled,
                        isToday && styles.dayNumberToday,
                        isFuture && styles.dayNumberFuture,
                      ]}>
                      {date.getDate()}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function YearGrid({
  colors,
  dates,
  getLabel,
  locale,
  metrics,
  onDayPress,
  statuses,
  styles,
  today,
  weekdayLabels,
}: GridProps & { locale: string }) {
  const weeks = groupIntoWeeks(dates);

  return (
    <View style={styles.yearGridRow}>
      <View style={styles.yearWeekdayLabels}>
        <View style={styles.yearMonthLabelSpacer} />
        {weekdayLabels.map((label, index) => (
          <Text key={`${label}-${index}`} style={styles.yearWeekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.yearScrollContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.yearScroll}>
        {weeks.map((week) => {
          const monthStart = week.find((date) => date.getDate() === 1);

          return (
            <View key={toDateKey(week[0])} style={styles.yearWeek}>
              <View style={styles.yearMonthLabelContainer}>
                {monthStart && (
                  <Text numberOfLines={1} style={styles.yearMonthLabel}>
                    {monthStart.toLocaleDateString(locale, { month: 'short' }).replace('.', '')}
                  </Text>
                )}
              </View>

              {week.map((date) => {
                const dateKey = toDateKey(date);
                const status = statuses[dateKey];
                const isFuture = date.getTime() > today.getTime();

                return (
                  <Pressable
                    accessibilityLabel={getLabel(date, status, isFuture)}
                    accessibilityRole="button"
                    disabled={isFuture || !onDayPress}
                    hitSlop={metrics.yearCellHitSlop}
                    key={dateKey}
                    onPress={onDayPress ? () => onDayPress(dateKey) : undefined}
                    style={({ pressed }) => [
                      styles.yearDayCell,
                      { backgroundColor: getStatusColor(colors, status, isFuture) },
                      date.getTime() === today.getTime() && styles.todayYearCell,
                      pressed && styles.pressed,
                    ]}
                  />
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function LegendItem({
  color,
  label,
  styles,
}: {
  color: string;
  label: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function startOfWeek(date: Date) {
  const result = startOfDay(date);
  const day = result.getDay();
  result.setDate(result.getDate() + (day === 0 ? -6 : 1 - day));
  return result;
}

function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6);
}

function getDatesBetween(start: Date, end: Date) {
  const dates: Date[] = [];
  let currentDate = startOfDay(start);

  while (currentDate.getTime() <= end.getTime()) {
    dates.push(currentDate);
    currentDate = addDays(currentDate, 1);
  }

  return dates;
}

function getPeriodDates(period: CalendarPeriod, today: Date) {
  if (period === 'week') {
    return getDatesBetween(startOfWeek(today), endOfWeek(today));
  }

  if (period === 'month') {
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return getDatesBetween(startOfWeek(firstDay), endOfWeek(lastDay));
  }

  const lastWeekStart = startOfWeek(today);
  const firstWeekStart = addDays(lastWeekStart, -364);
  return getDatesBetween(firstWeekStart, endOfWeek(today));
}

function groupIntoWeeks(dates: Date[]) {
  const weeks: Date[][] = [];

  for (let index = 0; index < dates.length; index += 7) {
    weeks.push(dates.slice(index, index + 7));
  }

  return weeks;
}

function getPeriodLabel(period: CalendarPeriod, today: Date, locale: string, t: (key: string) => string) {
  if (period === 'week') {
    const firstDay = startOfWeek(today);
    const lastDay = endOfWeek(today);
    const firstLabel = firstDay.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    const lastLabel = lastDay.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    return `${firstLabel} – ${lastLabel}`;
  }

  if (period === 'month') {
    return today.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }

  return t('calendar.lastTwelveMonths');
}

function getStatusColor(colors: ThemeColors, status: DisciplineStatus | undefined, isFuture: boolean) {
  if (isFuture) return colors.disciplineFuture;
  if (status === 'completed') return colors.disciplineCompleted;
  if (status === 'partial') return colors.disciplinePartial;
  if (status === 'skipped') return colors.disciplineSkipped;
  return colors.disciplineEmpty;
}



function createStyles(colors: ThemeColors, metrics: CalendarMetrics) {
  const {
    dayCircleSize,
    dayFontSize,
    legendFontSize,
    legendGap,
    monthCellPaddingVertical,
    monthRowGap,
    sectionGap,
    weekdayFontSize,
    yearCellGap,
    yearCellSize,
    yearLabelWidth,
  } = metrics;

  return StyleSheet.create({
    section: { gap: sectionGap },
    header: { gap: 4 },
    title: { color: colors.text, ...Type.sectionTitle },
    periodLabel: { color: colors.textSecondary, ...Type.caption },
    periodPicker: { flexDirection: 'row', gap: 20 },
    periodButton: { minHeight: 28, justifyContent: 'center' },
    periodButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '400' },
    periodButtonTextSelected: { color: colors.text, fontWeight: '600' },
    weekStrip: { justifyContent: 'center', paddingVertical: 4 },
    weekLine: {
      backgroundColor: colors.separator,
      height: StyleSheet.hairlineWidth,
      left: '7%',
      position: 'absolute',
      right: '7%',
      // Daire yüksekliğinin ortası + `paddingVertical: 4`.
      top: Math.round(dayCircleSize / 2) + 4,
    },
    weekRow: { flexDirection: 'row' },
    weekCell: { alignItems: 'center', flex: 1, gap: 8 },
    dayCircle: {
      alignItems: 'center',
      borderRadius: dayCircleSize / 2,
      height: dayCircleSize,
      justifyContent: 'center',
      width: dayCircleSize,
    },
    dayCircleOutlined: { borderColor: colors.separator, borderWidth: StyleSheet.hairlineWidth },
    dayCircleToday: { borderColor: colors.primary, borderWidth: 1.5 },
    dayNumber: { color: colors.textSecondary, fontSize: dayFontSize, fontWeight: '500' },
    dayNumberFilled: { color: colors.background, fontWeight: '600' },
    dayNumberToday: { color: colors.primary, fontWeight: '600' },
    dayNumberFuture: { color: colors.textTertiary },
    weekdayLabel: { color: colors.textTertiary, fontSize: weekdayFontSize, fontWeight: '400' },
    weekdayLabelToday: { color: colors.primary, fontWeight: '600' },
    monthGrid: { gap: monthRowGap },
    monthRow: { flexDirection: 'row' },
    monthCell: { alignItems: 'center', flex: 1, paddingVertical: monthCellPaddingVertical },
    monthCellSpacer: { height: dayCircleSize, width: dayCircleSize },
    monthWeekdayLabel: {
      color: colors.textTertiary,
      flex: 1,
      fontSize: weekdayFontSize,
      fontWeight: '400',
      textAlign: 'center',
    },
    // Yıl şeridi yatay kaydırılır. ScrollView'a `flex: 1` + `minWidth: 0`
    // verilir: içerik ne kadar geniş olursa olsun satırın dışına taşamaz,
    // kapsayıcıyı büyütemez ve kenardan kesilmez.
    yearGridRow: { flexDirection: 'row' },
    yearScroll: { flex: 1, minWidth: 0 },
    yearWeekdayLabels: { marginRight: 7 },
    yearMonthLabelSpacer: { height: 20 },
    yearWeekdayLabel: {
      color: colors.textTertiary,
      fontSize: 8,
      height: yearCellSize + yearCellGap - 1,
      lineHeight: 13,
      width: yearLabelWidth,
    },
    yearScrollContent: { paddingRight: 2 },
    yearWeek: { gap: yearCellGap, marginRight: yearCellGap, width: yearCellSize },
    yearMonthLabelContainer: { height: 17, overflow: 'visible' },
    yearMonthLabel: { color: colors.textTertiary, fontSize: 9, overflow: 'visible', width: 34 },
    yearDayCell: { borderRadius: 3, height: yearCellSize, width: yearCellSize },
    todayYearCell: { borderColor: colors.primary, borderWidth: 1.5 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: legendGap },
    legendItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    legendDot: { borderRadius: 3, height: 6, width: 6 },
    legendText: { color: colors.textSecondary, fontSize: legendFontSize },
    pressed: { opacity: 0.6 },
  });
}
