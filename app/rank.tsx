import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionSection } from '@/components/motion-section';
import { getRankColor, getRankSoftBackground, useRankName } from '@/components/ranks/rank-badge';
import {
  daysRemainingInSeason,
  nextRank,
  rankFillRatio,
  RankId,
  rpToNextRank,
} from '@/constants/ranks';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useRanks } from '@/context/rank-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useLocalDateKey } from '@/hooks/use-shared-discipline-sync';
import { RankSeasonArchive } from '@/types/ranks';
import { dateFromKey } from '@/utils/workout-schedule';

/**
 * Sezonluk rank detay ekranı.
 *
 * Kök Stack'te açılır → alt sekme çubuğu GÖRÜNMEZ ve yeni bir sekme eklenmez.
 * Bütün sayılar sunucudan gelir; bu ekran hiçbir RP veya rank hesaplamaz,
 * yalnızca `rpToNextRank` / `rankFillRatio` gibi saf gösterim yardımcılarını
 * kullanır.
 *
 * TİPOGRAFİ — dört boyut (17 / 15 / 13 / 11) ve iki ağırlık (600 / 400).
 * Rank rengi yalnızca rozet, ilerleme çubuğu ve tek bir vurgu değerinde
 * kullanılır; gövde metinleri tema renklerinde kalır.
 */
export default function RankScreen() {
  const { colors, isDark } = useAppTheme();
  const { locale, t } = useTranslation();
  const { history, isHistoryLoading, isRankLoading, loadHistory, season } = useRanks();
  const rankName = useRankName();
  const todayKey = useLocalDateKey();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Arşiv yalnızca bu ekran açıldığında yüklenir; arka planda polling yoktur.
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  if (!season) {
    return (
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <View style={styles.centerState}>
          {isRankLoading ? (
            <>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={styles.centerText}>{t('ranks.loading')}</Text>
            </>
          ) : (
            <>
              <Ionicons color={colors.textTertiary} name="cloud-offline-outline" size={40} />
              <Text style={styles.centerText}>{t('ranks.loadFailed')}</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const accent = getRankColor(season.currentRank);
  const upcoming = nextRank(season.currentRp);
  const remaining = rpToNextRank(season.currentRp);
  const fill = rankFillRatio(season.currentRp);
  const daysLeft = daysRemainingInSeason(season.endsOn, todayKey);
  const planCompletion =
    season.scheduledDaysTotal > 0
      ? Math.round((season.scheduledDaysCompleted / season.scheduledDaysTotal) * 100)
      : 0;

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MotionSection style={styles.header}>
          <Text style={styles.eyebrow}>
            {season.themeName ?? t('ranks.seasonName', { index: season.seasonIndex })}
          </Text>
          <Text style={styles.dateRange}>
            {formatRange(season.startsOn, season.endsOn, locale)}
          </Text>
        </MotionSection>

        <MotionSection delay={40}>
          <View
            accessibilityLabel={t('ranks.progressA11y', {
              rank: rankName(season.currentRank),
              remaining,
              rp: season.currentRp,
            })}
            accessibilityRole="progressbar"
            accessibilityValue={{ max: 100, min: 0, now: Math.round(fill * 100) }}
            accessible
            style={[styles.card, { backgroundColor: getRankSoftBackground(season.currentRank, isDark) }]}>
            <View style={styles.cardTopRow}>
              <View style={styles.cardTitleGroup}>
                <Text style={styles.cardEyebrow}>{t('ranks.currentRank')}</Text>
                <Text style={[styles.cardRank, { color: accent }]}>
                  {rankName(season.currentRank)}
                </Text>
              </View>
              <Text style={[styles.cardRp, { color: accent }]}>
                {t('ranks.rpValue', { rp: season.currentRp })}
              </Text>
            </View>

            <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
              <View
                style={[styles.fill, { backgroundColor: accent, width: `${Math.round(fill * 100)}%` }]}
              />
            </View>

            <Text style={styles.cardFootnote}>
              {upcoming
                ? t('ranks.rpToNext', { rank: rankName(upcoming.id), rp: remaining })
                : t('ranks.maxRank')}
            </Text>
          </View>
        </MotionSection>

        <MotionSection delay={80} style={styles.statList}>
          <StatRow label={t('ranks.seasonEndsIn')} styles={styles} value={t('ranks.dayCount', { count: daysLeft })} />
          <StatRow label={t('ranks.peakRank')} styles={styles} value={rankName(season.peakRank)} />
          <StatRow label={t('ranks.workouts')} styles={styles} value={String(season.workoutsCompleted)} />
          <StatRow
            label={t('ranks.planCompletion')}
            styles={styles}
            value={t('ranks.planCompletionValue', {
              done: season.scheduledDaysCompleted,
              percent: planCompletion,
              total: season.scheduledDaysTotal,
            })}
          />
          <StatRow
            isLast
            label={t('ranks.longestStreak')}
            styles={styles}
            value={t('ranks.dayCount', { count: season.longestStreak })}
          />
        </MotionSection>

        <MotionSection delay={120} style={styles.historyBlock}>
          <Text style={styles.sectionLabel}>{t('ranks.pastSeasons')}</Text>

          {isHistoryLoading && history.length === 0 ? (
            <View style={styles.historyLoading}>
              <ActivityIndicator color={colors.textSecondary} size="small" />
            </View>
          ) : history.length === 0 ? (
            <Text style={styles.emptyText}>{t('ranks.noPastSeasons')}</Text>
          ) : (
            history.map((archive, index) => (
              <ArchiveRow
                archive={archive}
                isLast={index === history.length - 1}
                key={archive.seasonIndex}
                locale={locale}
                rankName={rankName}
                styles={styles}
                t={t}
              />
            ))
          )}
        </MotionSection>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatRow({
  isLast = false,
  label,
  styles,
  value,
}: {
  isLast?: boolean;
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  return (
    <View style={[styles.statRow, isLast && styles.statRowLast]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.statValue}>
        {value}
      </Text>
    </View>
  );
}

function ArchiveRow({
  archive,
  isLast,
  locale,
  rankName,
  styles,
  t,
}: {
  archive: RankSeasonArchive;
  isLast: boolean;
  locale: string;
  rankName: (rankId: RankId) => string;
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const finalColor = getRankColor(archive.finalRank);
  const planCompletion =
    archive.scheduledDaysTotal > 0
      ? Math.round((archive.scheduledDaysCompleted / archive.scheduledDaysTotal) * 100)
      : 0;

  return (
    <View style={[styles.archiveRow, isLast && styles.archiveRowLast]}>
      <View style={styles.archiveTopRow}>
        <Text numberOfLines={1} style={styles.archiveTitle}>
          {archive.themeName ?? t('ranks.seasonName', { index: archive.seasonIndex })}
        </Text>
        <Text numberOfLines={1} style={[styles.archiveRank, { color: finalColor }]}>
          {rankName(archive.finalRank)} · {t('ranks.rpValue', { rp: archive.finalRp })}
        </Text>
      </View>
      <Text numberOfLines={1} style={styles.archiveMeta}>
        {formatRange(archive.startsOn, archive.endsOn, locale)}
      </Text>
      <Text numberOfLines={2} style={styles.archiveMeta}>
        {t('ranks.peakRank')}: {rankName(archive.peakRank)} · {t('ranks.workouts')}:{' '}
        {archive.workoutsCompleted} · {t('ranks.planCompletion')}: {planCompletion}% ·{' '}
        {t('ranks.longestStreak')}: {t('ranks.dayCount', { count: archive.longestStreak })}
      </Text>
    </View>
  );
}

/** `YYYY-MM-DD` çifti → yerelleştirilmiş aralık. */
function formatRange(startsOn: string, endsOn: string, locale: string) {
  const options = { day: 'numeric', month: 'short' } as const;
  const start = dateFromKey(startsOn).toLocaleDateString(locale, options);
  const end = dateFromKey(endsOn).toLocaleDateString(locale, {
    ...options,
    year: 'numeric',
  });
  return `${start} – ${end}`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 40, paddingHorizontal: Layout.screenPadding, paddingTop: 8 },
    centerState: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 32 },
    centerText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },

    header: { gap: 4, marginBottom: 16 },
    eyebrow: { color: colors.text, fontSize: 17, fontWeight: '600' },
    dateRange: { color: colors.textSecondary, fontSize: 13, fontWeight: '400' },

    card: { borderRadius: Layout.radiusMedium, gap: 12, padding: 16 },
    cardTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    cardTitleGroup: { gap: 2 },
    cardEyebrow: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
    cardRank: { fontSize: 17, fontWeight: '600' },
    cardRp: { fontSize: 17, fontWeight: '600' },
    track: { borderRadius: 3, height: 6, overflow: 'hidden', width: '100%' },
    fill: { height: '100%' },
    cardFootnote: { color: colors.textSecondary, fontSize: 13, fontWeight: '400' },

    statList: { marginTop: 24 },
    statRow: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      minHeight: Layout.minTouchSize,
      paddingVertical: 8,
    },
    statRowLast: { borderBottomWidth: 0 },
    statLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '400' },
    statValue: { color: colors.text, flexShrink: 1, fontSize: 15, fontWeight: '600' },

    historyBlock: { marginTop: 24 },
    sectionLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 8 },
    historyLoading: { alignItems: 'center', paddingVertical: 24 },
    emptyText: { color: colors.textTertiary, fontSize: 13, fontWeight: '400', paddingVertical: 16 },

    archiveRow: {
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      gap: 4,
      paddingVertical: 12,
    },
    archiveRowLast: { borderBottomWidth: 0 },
    archiveTopRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
    },
    archiveTitle: { color: colors.text, flexShrink: 1, fontSize: 15, fontWeight: '600' },
    archiveRank: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
    archiveMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: '400' },
  });
}
