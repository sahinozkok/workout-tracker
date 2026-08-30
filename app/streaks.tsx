import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionSection } from '@/components/motion-section';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useLocalDateKey } from '@/hooks/use-shared-discipline-sync';
import { analyzeDisciplineStreaks, DisciplineStreakPeriod } from '@/utils/discipline';
import { dateFromKey } from '@/utils/workout-schedule';

/**
 * SERİ GEÇMİŞİ ekranı.
 *
 * GÖRÜNEN disiplin takvimini (`disciplineStatuses`) analiz eder. Sunucuya YENİ
 * istek AÇMAZ; yükleme/hata durumları `WorkoutContext`in mevcut sinyallerinden
 * gelir. Sezonluk rank sisteminin `rankSeason` seri verisiyle KARIŞTIRILMAZ;
 * bütün hesap saf `analyzeDisciplineStreaks` çekirdeğindedir.
 *
 * TİPOGRAFİ — dört boyut (52 / 17 / 13 / 11) ve iki ağırlık (600 / 400).
 * Hiyerarşi büyük sayı + sakin tipografi + ince ayırıcılarla kurulur; kart
 * yığını, emoji, gradient veya büyük gölge yoktur.
 */
export default function StreaksScreen() {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const { disciplineStatuses, isProgramsLoading, programsError } = useWorkout();
  const todayKey = useLocalDateKey();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const insights = useMemo(
    () => analyzeDisciplineStreaks(disciplineStatuses, todayKey),
    [disciplineStatuses, todayKey],
  );

  if (programsError) {
    return (
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <View style={styles.centerState}>
          <Ionicons color={colors.textTertiary} name="cloud-offline-outline" size={40} />
          <Text style={styles.centerTitle}>{t('streaks.loadFailed')}</Text>
          <Text style={styles.centerText}>{t('streaks.loadFailedBody')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isProgramsLoading) {
    return (
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.centerText}>{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const averageLabel = formatAverage(insights.averageStreak, locale);

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MotionSection style={styles.hero}>
          <Text style={styles.heroEyebrow}>{t('streaks.currentStreak')}</Text>
          <Text
            accessibilityLabel={t('streaks.currentA11y', { count: insights.currentStreak })}
            accessible
            style={styles.heroValue}>
            {insights.currentStreak}
          </Text>
        </MotionSection>

        <MotionSection delay={40}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{insights.longestStreak}</Text>
              <Text style={styles.summaryLabel}>{t('streaks.longestStreak')}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{averageLabel}</Text>
              <Text style={styles.summaryLabel}>{t('streaks.averageStreak')}</Text>
            </View>
          </View>
        </MotionSection>

        <MotionSection delay={80} style={styles.section}>
          <Text style={styles.sectionTitle}>{t('streaks.historyTitle')}</Text>

          {insights.periods.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons color={colors.textTertiary} name="flame-outline" size={34} />
              <Text style={styles.centerTitle}>{t('streaks.emptyTitle')}</Text>
              <Text style={styles.centerText}>{t('streaks.emptyBody')}</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {insights.periods.map((period, index) => (
                <StreakPeriodRow
                  colors={colors}
                  isLast={index === insights.periods.length - 1}
                  key={`${period.startDateKey}-${period.endDateKey}`}
                  locale={locale}
                  period={period}
                  styles={styles}
                  t={t}
                />
              ))}
            </View>
          )}
        </MotionSection>
      </ScrollView>
    </SafeAreaView>
  );
}

function StreakPeriodRow({
  colors,
  isLast,
  locale,
  period,
  styles,
  t,
}: {
  colors: ThemeColors;
  isLast: boolean;
  locale: string;
  period: DisciplineStreakPeriod;
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const dateLabel = formatPeriodDates(period, locale);
  const dayLabel =
    period.length === 1 ? t('streaks.dayCountOne') : t('streaks.dayCount', { count: period.length });
  const a11yLabel = period.isCurrent
    ? `${dateLabel}, ${dayLabel}, ${t('streaks.inProgress')}`
    : `${dateLabel}, ${dayLabel}`;

  return (
    <View
      accessibilityLabel={a11yLabel}
      accessible
      style={[styles.row, !isLast && styles.rowDivider]}>
      <View style={styles.rowText}>
        <Text style={styles.rowDate}>{dateLabel}</Text>
        {period.isCurrent && <Text style={styles.rowCurrent}>{t('streaks.inProgress')}</Text>}
      </View>
      <Text style={styles.rowDays}>{dayLabel}</Text>
    </View>
  );
}

/** En fazla bir ondalık; tam sayıda gereksiz `,0`/`.0` gösterilmez. */
function formatAverage(value: number, locale: string) {
  return value.toLocaleString(locale, { maximumFractionDigits: 1 });
}

/**
 * Dönem tarih aralığı, yerelleştirilmiş. Tek günlük seride TEK tarih gösterilir;
 * aynı gün iki kez yazılmaz.
 */
function formatPeriodDates(period: DisciplineStreakPeriod, locale: string) {
  const endLong = dateFromKey(period.endDateKey).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  if (period.startDateKey === period.endDateKey) return endLong;

  const start = dateFromKey(period.startDateKey).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
  });
  return `${start} – ${endLong}`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 40, paddingHorizontal: Layout.screenPadding, paddingTop: 8 },
    centerState: { alignItems: 'center', flex: 1, gap: 10, justifyContent: 'center', padding: 32 },
    centerTitle: { color: colors.text, fontSize: 17, fontWeight: '600', textAlign: 'center' },
    centerText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },

    hero: { alignItems: 'center', gap: 4, paddingBottom: 20, paddingTop: 20 },
    heroEyebrow: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    heroValue: {
      color: colors.text,
      fontSize: 52,
      fontVariant: ['tabular-nums'],
      fontWeight: '400',
      lineHeight: 60,
    },

    summaryRow: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: Layout.radiusMedium,
      borderWidth: Layout.hairline,
      flexDirection: 'row',
    },
    summaryCell: { alignItems: 'center', flex: 1, gap: 3, paddingHorizontal: 12, paddingVertical: 16 },
    summaryDivider: { alignSelf: 'stretch', backgroundColor: colors.border, width: Layout.hairline },
    summaryValue: {
      color: colors.text,
      fontSize: 17,
      fontVariant: ['tabular-nums'],
      fontWeight: '600',
    },
    summaryLabel: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },

    section: { gap: 10, paddingTop: 28 },
    sectionTitle: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },

    list: {},
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      minHeight: Layout.minTouchSize,
      paddingVertical: 12,
    },
    rowDivider: { borderBottomColor: colors.border, borderBottomWidth: Layout.hairline },
    rowText: { flex: 1, gap: 2, minWidth: 0 },
    rowDate: { color: colors.text, fontSize: 17, fontWeight: '400' },
    rowCurrent: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    rowDays: {
      color: colors.textSecondary,
      fontSize: 13,
      fontVariant: ['tabular-nums'],
      fontWeight: '400',
    },

    emptyState: { alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingVertical: 44 },
  });
}
