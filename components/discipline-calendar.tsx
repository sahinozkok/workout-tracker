import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemeColors } from '@/constants/theme';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { DisciplineStatus } from '@/types/workout';
import { toDateKey } from '@/utils/discipline';

type CalendarPeriod = 'week' | 'month' | 'year';

const PERIOD_OPTIONS: { label: string; value: CalendarPeriod }[] = [
  { label: 'Hafta', value: 'week' },
  { label: 'Ay', value: 'month' },
  { label: 'Yıl', value: 'year' },
];

const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const YEAR_WEEKDAY_LABELS = ['Pzt', '', 'Çar', '', 'Cum', '', 'Paz'];

const STATUS_LABELS: Record<DisciplineStatus, string> = {
  completed: 'Tamamlandı',
  partial: 'Eksik tamamlandı',
  skipped: 'Atlandı',
};

export function DisciplineCalendar() {
  const { disciplineStatuses, cycleDisciplineStatus, isDateScheduled } = useWorkout();
  const { colors } = useAppTheme();
  const styles = createStyles(colors);
  const [period, setPeriod] = useState<CalendarPeriod>('month');
  const today = useMemo(() => startOfDay(new Date()), []);
  const dates = useMemo(() => getPeriodDates(period, today), [period, today]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Disiplin takvimi</Text>
          <Text style={styles.periodLabel}>{getPeriodLabel(period, today)}</Text>
        </View>

        <View style={styles.periodPicker}>
          {PERIOD_OPTIONS.map((option) => {
            const isSelected = option.value === period;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                key={option.value}
                onPress={() => setPeriod(option.value)}
                style={({ pressed }) => [
                  styles.periodButton,
                  isSelected && styles.periodButtonSelected,
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.periodButtonText, isSelected && styles.periodButtonTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {period === 'year' ? (
        <YearGrid
          colors={colors}
          dates={dates}
          onDayPress={cycleDisciplineStatus}
          isDateScheduled={isDateScheduled}
          statuses={disciplineStatuses}
          styles={styles}
          today={today}
        />
      ) : (
        <WeekOrMonthGrid
          colors={colors}
          dates={dates}
          month={period === 'month' ? today.getMonth() : undefined}
          onDayPress={cycleDisciplineStatus}
          isDateScheduled={isDateScheduled}
          statuses={disciplineStatuses}
          styles={styles}
          today={today}
        />
      )}

      <View style={styles.legend}>
        <LegendItem color={colors.disciplineCompleted} label="Tamamlandı" styles={styles} />
        <LegendItem color={colors.disciplinePartial} label="Eksik" styles={styles} />
        <LegendItem color={colors.disciplineSkipped} label="Atlandı" styles={styles} />
      </View>

      <Text style={styles.hint}>
        Planlı program günleri setlerinden otomatik hesaplanır. Plansız günlere dokunarak durum ekleyebilirsin.
      </Text>
    </View>
  );
}

type GridProps = {
  colors: ThemeColors;
  dates: Date[];
  onDayPress: (dateKey: string) => void;
  isDateScheduled: (dateKey: string) => boolean;
  statuses: Record<string, DisciplineStatus>;
  styles: ReturnType<typeof createStyles>;
  today: Date;
};

function WeekOrMonthGrid({
  colors,
  dates,
  isDateScheduled,
  month,
  onDayPress,
  statuses,
  styles,
  today,
}: GridProps & { month?: number }) {
  const weeks = groupIntoWeeks(dates);

  return (
    <View style={styles.calendarGrid}>
      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((label) => (
          <Text key={label} style={styles.weekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      {weeks.map((week) => (
        <View key={toDateKey(week[0])} style={styles.weekRow}>
          {week.map((date) => {
            const dateKey = toDateKey(date);
            const status = statuses[dateKey];
            const isFuture = date.getTime() > today.getTime();
            const isOutsideMonth = month !== undefined && date.getMonth() !== month;
            const isScheduled = isDateScheduled(dateKey);

            return (
              <Pressable
                accessibilityLabel={getAccessibilityLabel(date, status, isFuture)}
                accessibilityRole="button"
                disabled={isFuture || isOutsideMonth || isScheduled}
                key={dateKey}
                onPress={() => onDayPress(dateKey)}
                style={({ pressed }) => [
                  styles.dayCell,
                  {
                    backgroundColor: isOutsideMonth
                      ? 'transparent'
                      : getStatusColor(colors, status, isFuture),
                  },
                  pressed && styles.pressed,
                ]}>
                {!isOutsideMonth && (
                  <Text style={[styles.dayNumber, status && styles.dayNumberMarked]}>{date.getDate()}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function YearGrid({ colors, dates, isDateScheduled, onDayPress, statuses, styles, today }: GridProps) {
  const weeks = groupIntoWeeks(dates);

  return (
    <View style={styles.yearGridRow}>
      <View style={styles.yearWeekdayLabels}>
        <View style={styles.yearMonthLabelSpacer} />
        {YEAR_WEEKDAY_LABELS.map((label, index) => (
          <Text key={`${label}-${index}`} style={styles.yearWeekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.yearScrollContent}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {weeks.map((week) => {
          const monthStart = week.find((date) => date.getDate() === 1);

          return (
            <View key={toDateKey(week[0])} style={styles.yearWeek}>
              <View style={styles.yearMonthLabelContainer}>
                {monthStart && (
                  <Text numberOfLines={1} style={styles.yearMonthLabel}>
                    {monthStart.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', '')}
                  </Text>
                )}
              </View>

              {week.map((date) => {
                const dateKey = toDateKey(date);
                const status = statuses[dateKey];
                const isFuture = date.getTime() > today.getTime();
                const isScheduled = isDateScheduled(dateKey);

                return (
                  <Pressable
                    accessibilityLabel={getAccessibilityLabel(date, status, isFuture)}
                    accessibilityRole="button"
                    disabled={isFuture || isScheduled}
                    key={dateKey}
                    onPress={() => onDayPress(dateKey)}
                    style={({ pressed }) => [
                      styles.yearDayCell,
                      {
                        backgroundColor: getStatusColor(colors, status, isFuture),
                      },
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

function LegendItem({ color, label, styles }: { color: string; label: string; styles: ReturnType<typeof createStyles> }) {
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

function getPeriodLabel(period: CalendarPeriod, today: Date) {
  if (period === 'week') {
    const firstDay = startOfWeek(today);
    const lastDay = endOfWeek(today);
    const firstLabel = firstDay.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
    const lastLabel = lastDay.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${firstLabel} – ${lastLabel}`;
  }

  if (period === 'month') {
    return today.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  }

  return 'Son 12 ay';
}

function getStatusColor(colors: ThemeColors, status: DisciplineStatus | undefined, isFuture: boolean) {
  if (isFuture) return colors.disciplineFuture;
  if (status === 'completed') return colors.disciplineCompleted;
  if (status === 'partial') return colors.disciplinePartial;
  if (status === 'skipped') return colors.disciplineSkipped;
  return colors.disciplineEmpty;
}

function getAccessibilityLabel(date: Date, status: DisciplineStatus | undefined, isFuture: boolean) {
  const dateLabel = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  if (isFuture) return `${dateLabel}, gelecek gün`;
  return `${dateLabel}, ${status ? STATUS_LABELS[status] : 'işaretlenmedi'}`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 20,
      borderWidth: 1,
      gap: 16,
      padding: 16,
    },
    header: { gap: 14 },
    headerText: { gap: 3 },
    title: { color: colors.text, fontSize: 18, fontWeight: '800' },
    periodLabel: { color: colors.textSecondary, fontSize: 13, textTransform: 'capitalize' },
    periodPicker: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 12,
      flexDirection: 'row',
      padding: 3,
    },
    periodButton: {
      alignItems: 'center',
      borderRadius: 9,
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    periodButtonSelected: { backgroundColor: colors.primary },
    periodButtonText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
    periodButtonTextSelected: { color: colors.onPrimary },
    calendarGrid: { gap: 6 },
    weekRow: { flexDirection: 'row', gap: 6 },
    weekdayLabel: {
      color: colors.textSecondary,
      flex: 1,
      fontSize: 11,
      fontWeight: '700',
      textAlign: 'center',
    },
    dayCell: {
      alignItems: 'center',
      aspectRatio: 1,
      borderRadius: 7,
      flex: 1,
      justifyContent: 'center',
    },
    dayNumber: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
    dayNumberMarked: { color: colors.onPrimary },
    yearGridRow: { flexDirection: 'row' },
    yearWeekdayLabels: { marginRight: 6 },
    yearMonthLabelSpacer: { height: 18 },
    yearWeekdayLabel: {
      color: colors.textSecondary,
      fontSize: 8,
      height: 14,
      lineHeight: 11,
      width: 18,
    },
    yearScrollContent: { paddingRight: 2 },
    yearWeek: { gap: 3, marginRight: 3, width: 11 },
    yearMonthLabelContainer: { height: 15, overflow: 'visible' },
    yearMonthLabel: { color: colors.textSecondary, fontSize: 8, overflow: 'visible', width: 30 },
    yearDayCell: { borderRadius: 3, height: 11, width: 11 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    legendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
    legendDot: { borderRadius: 3, height: 10, width: 10 },
    legendText: { color: colors.textSecondary, fontSize: 11 },
    hint: { color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
    pressed: { opacity: 0.65 },
  });
}
