import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { MotionSection, MotionSwap } from '@/components/motion-section';
import { AchievementDetailSheet } from '@/components/ranks/achievement-detail-sheet';
import { ACHIEVEMENT_ICONS } from '@/components/ranks/achievement-icons';
import { AchievementMedallion } from '@/components/ranks/achievement-medallion';
import { getRankColor, getRankSoftBackground, useRankName } from '@/components/ranks/rank-badge';
import { RankEmblem } from '@/components/ranks/rank-emblem';
import { SeasonAchievementKey, toRankRpDisplay } from '@/constants/rank-experience';
import {
  daysRemainingInSeason,
  nextRank,
  rankFillRatio,
  RankId,
  RANK_RP,
  rpToNextRank,
} from '@/constants/ranks';
import { getOnAccentColor, withAlpha } from '@/constants/color-presets';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useRanks } from '@/context/rank-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { useLocalDateKey } from '@/hooks/use-shared-discipline-sync';
import { RankEvent, RankSeasonArchive, RankWeekFocus, SeasonAchievement } from '@/types/ranks';
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
/**
 * Rank ekranının yerel içerik sekmeleri. Yalnızca sunum içindir — route,
 * bottom tab veya sorgu DEĞİLDİR. Varsayılan `overview`.
 */
type RankTabKey = 'overview' | 'achievements' | 'history';
const RANK_TAB_KEYS: readonly RankTabKey[] = ['overview', 'achievements', 'history'];

/**
 * Uzun liste içerebilen "ağır" sekmeler.
 *
 * Yalnızca sunum: geçiş sınırında (`MotionSwap`) bu sekmelerde `contentWeight`
 * "heavy" olur ve layout animasyonu kapanır — geniş RP/arşiv listesi her
 * geçişte yeniden ölçülmez. Diğer sekmeler normal içerik ağırlığıyla çalışır.
 */
const HEAVY_CONTENT_TABS: readonly RankTabKey[] = ['history'];

export default function RankScreen() {
  const { colors, isDark } = useAppTheme();
  const { locale, t } = useTranslation();
  const {
    achievements,
    events,
    hasAchievementsError,
    history,
    isAchievementsLoading,
    isEventsLoading,
    isHistoryLoading,
    isRankLoading,
    isWeekFocusLoading,
    hasWeekFocusError,
    loadAchievements,
    loadEvents,
    loadHistory,
    loadWeekFocus,
    season,
    weekFocus,
  } = useRanks();
  const rankName = useRankName();
  const todayKey = useLocalDateKey();
  const todayColor = useFeatureColor('todayHighlight', colors.primary).color;
  const styles = useMemo(() => createStyles(colors), [colors]);

  /**
   * Yalnızca sunum state'i: hangi yerel sekmenin görüneceğini seçer. Yeni route,
   * bottom tab, sorgu veya RPC EKLEMEZ ve veri yüklemelerini koşullandırmaz —
   * bütün `loadX` effect'leri sekmeden bağımsız çalışmaya devam eder.
   */
  const [activeTab, setActiveTab] = useState<RankTabKey>('overview');

  // Arşiv ve RP geçmişi yalnızca bu ekran açıldığında yüklenir; arka planda
  // polling YOKTUR.
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadWeekFocus();
  }, [loadWeekFocus]);

  useEffect(() => {
    void loadAchievements();
  }, [loadAchievements]);

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
          {/* Mevcut sezon adı ve tarih aralığı OLDUĞU GİBİ kalır; bilgi düğmesi
              yalnızca sağdaki boşluğa yerleşir ve kart yerleşimini bozmaz. */}
          <View style={styles.headerTextGroup}>
            <Text style={styles.eyebrow}>
              {season.themeName ?? t('ranks.seasonName', { index: season.seasonIndex })}
            </Text>
            <Text style={styles.dateRange}>
              {formatRange(season.startsOn, season.endsOn, locale)}
            </Text>
          </View>
          <MotionPressable
            accessibilityHint={t('ranks.guide.openHint')}
            accessibilityLabel={t('ranks.guide.navTitle')}
            accessibilityRole="button"
            onPress={() => router.push('/rank-guide')}
            style={styles.guideButton}>
            <Ionicons color={colors.textSecondary} name="help-circle-outline" size={22} />
          </MotionPressable>
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
              <View style={styles.cardIdentity}>
                <RankEmblem color={accent} rankId={season.currentRank} variant="hero" />
                <View style={styles.cardTitleGroup}>
                  <Text style={styles.cardEyebrow}>{t('ranks.currentRank')}</Text>
                  <Text numberOfLines={1} style={[styles.cardRank, { color: accent }]}>
                    {rankName(season.currentRank)}
                  </Text>
                </View>
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

        <MotionSection delay={80}>
          <RankTabs
            accent={accent}
            activeTab={activeTab}
            onSelect={setActiveTab}
            styles={styles}
            t={t}
          />
        </MotionSection>

        {/*
          Yerel sekme içeriği tek bir geçiş sınırı altında değişir. `MotionSwap`
          `transitionKey` olarak doğrudan `activeTab` alır: sekmeye basıldığında
          içerik sert biçimde değişmez, mevcut motion altyapısının kısa fade +
          çok küçük dikey girişiyle yerleşir. Reduce Motion `MotionSwap` içinde
          otomatik ele alınır.

          İç dallarda AYRICA `MotionSection delay` KULLANILMAZ: tek geçiş sınırı
          bu işi üstlenir, böylece aynı içerikte çift giriş animasyonu oluşmaz.
          Sade `View` yalnızca yerleşim/boşluk taşır.

          Geçmiş sekmesi uzun RP ve arşiv listeleri içerebildiği için ağır içerik
          sayılır: `contentWeight="heavy"` ile layout animasyonu kapanır, uzun
          liste yeniden ölçülmez. Genel ve Başarılar normal içerik ağırlığıyla
          çalışır.
         */}
        <MotionSwap
          contentWeight={HEAVY_CONTENT_TABS.includes(activeTab) ? 'heavy' : 'regular'}
          transitionKey={activeTab}>
          {activeTab === 'overview' ? (
            <>
              <WeekFocusCard
                colors={colors}
                focus={weekFocus}
                hasError={hasWeekFocusError}
                isLoading={isWeekFocusLoading}
                locale={locale}
                onRetry={() => void loadWeekFocus()}
                styles={styles}
                t={t}
                todayColor={todayColor}
                todayKey={todayKey}
              />

              <View style={styles.statList}>
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
              </View>
            </>
          ) : null}

          {activeTab === 'achievements' ? (
            <View style={styles.achievementsBlock}>
              <Text style={styles.sectionLabel}>{t('ranks.achievements.title')}</Text>
              <AchievementsGrid
                accent={accent}
                achievements={achievements}
                colors={colors}
                hasError={hasAchievementsError}
                isDark={isDark}
                isLoading={isAchievementsLoading}
                locale={locale}
                onRetry={() => void loadAchievements()}
                styles={styles}
                t={t}
              />
            </View>
          ) : null}

          {activeTab === 'history' ? (
            <>
              <View style={styles.historyBlock}>
                <Text style={styles.sectionLabel}>{t('ranks.recentActivity')}</Text>

                {isEventsLoading && events.length === 0 ? (
                  <View style={styles.historyLoading}>
                    <ActivityIndicator color={colors.textSecondary} size="small" />
                  </View>
                ) : events.length === 0 ? (
                  <Text style={styles.emptyText}>{t('ranks.noRecentActivity')}</Text>
                ) : (
                  events.map((event, index) => (
                    <EventRow
                      accent={accent}
                      dangerColor={colors.danger}
                      event={event}
                      isLast={index === events.length - 1}
                      key={event.id}
                      locale={locale}
                      styles={styles}
                      t={t}
                    />
                  ))
                )}
              </View>

              <View style={styles.historyBlock}>
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
              </View>
            </>
          ) : null}
        </MotionSwap>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Sade, alt çizgili yerel sekme şeridi.
 *
 * SUNUM STATE'İ — sekme değişimi yalnızca hangi bölümün render edileceğini
 * seçer; veri yüklemez, route açmaz, sorgu tetiklemez. Her sekme en az 44 pt
 * dokunma yüksekliğindedir, `accessibilityRole="tab"` taşır ve seçili durumu
 * erişilebilirlik ağacına `accessibilityState` ile bildirir. Seçili alt çizgi
 * mevcut rank rengini (accent) kullanır; açık ve koyu temada çalışır.
 */
function RankTabs({
  accent,
  activeTab,
  onSelect,
  styles,
  t,
}: {
  accent: string;
  activeTab: RankTabKey;
  onSelect: (tab: RankTabKey) => void;
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <View style={styles.tabBar}>
      {RANK_TAB_KEYS.map((key) => {
        const isActive = key === activeTab;
        return (
          <MotionPressable
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            key={key}
            onPress={() => onSelect(key)}
            style={styles.tab}>
            <Text
              numberOfLines={1}
              style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
              {t(`ranks.tabs.${key}`)}
            </Text>
            <View
              style={[
                styles.tabUnderline,
                isActive ? { backgroundColor: accent } : undefined,
              ]}
            />
          </MotionPressable>
        );
      })}
    </View>
  );
}

function WeekFocusCard({
  colors,
  focus,
  hasError,
  isLoading,
  locale,
  onRetry,
  styles,
  t,
  todayColor,
  todayKey,
}: {
  colors: ThemeColors;
  focus?: RankWeekFocus;
  hasError: boolean;
  isLoading: boolean;
  locale: string;
  onRetry: () => void;
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, string | number>) => string;
  todayColor: string;
  todayKey: string;
}) {
  if (!focus) {
    return (
      <View style={styles.weekCard}>
        <Text style={styles.weekEyebrow}>{t('ranks.weekFocus.title')}</Text>
        <View style={styles.weekState}>
          {isLoading ? (
            <ActivityIndicator color={colors.textSecondary} size="small" />
          ) : (
            <>
              <Text style={styles.weekStateText}>{t('ranks.weekFocus.unavailable')}</Text>
              <MotionPressable
                accessibilityRole="button"
                onPress={onRetry}
                style={styles.weekRetry}>
                <Text style={[styles.weekRetryText, { color: todayColor }]}>
                  {t('ranks.weekFocus.retry')}
                </Text>
              </MotionPressable>
            </>
          )}
        </View>
      </View>
    );
  }

  const planned = focus.days.filter((day) => day.isScheduledWorkout);
  const completed = planned.filter((day) => day.state === 'completed').length;
  const remaining = Math.max(0, planned.length - completed);
  const message =
    planned.length === 0
      ? t('ranks.weekFocus.noPlanned')
      : remaining === 0
        ? t('ranks.weekFocus.ready', { rp: RANK_RP.weeklyPerfect })
        : t('ranks.weekFocus.remaining', { count: remaining });

  return (
    <View style={styles.weekCard}>
      <View style={styles.weekHeader}>
        <View style={styles.weekHeaderText}>
          <Text style={styles.weekEyebrow}>{t('ranks.weekFocus.title')}</Text>
          <Text style={styles.weekRange}>{formatRange(focus.startsOn, focus.endsOn, locale)}</Text>
        </View>
        {isLoading ? <ActivityIndicator color={colors.textTertiary} size="small" /> : null}
      </View>

      <View style={styles.weekDays}>
        {focus.days.map((day) => {
          const fillColor =
            day.isScheduledWorkout && day.isVerifiable
              ? day.state === 'completed'
                ? colors.disciplineCompleted
                : day.state === 'partial'
                  ? colors.disciplinePartial
                  : undefined
              : undefined;
          const isToday = day.dateKey === todayKey;
          const isMuted = !day.isScheduledWorkout || !day.isVerifiable;

          return (
            <View key={day.dateKey} style={styles.weekDay}>
              <Text style={styles.weekDayLabel}>{formatWeekday(day.dateKey, locale)}</Text>
              <View
                style={[
                  styles.weekDayCircle,
                  day.isScheduledWorkout && !fillColor && styles.weekDayPlanned,
                  isMuted && styles.weekDayMuted,
                  fillColor ? { backgroundColor: fillColor, borderColor: fillColor } : undefined,
                  isToday ? { borderColor: todayColor, borderWidth: 2 } : undefined,
                ]}>
                <Text
                  style={[
                    styles.weekDayNumber,
                    isMuted && styles.weekDayNumberMuted,
                    fillColor ? { color: getOnAccentColor(fillColor) } : undefined,
                  ]}>
                  {dateFromKey(day.dateKey).getDate()}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <Text style={styles.weekMessage}>{message}</Text>
      {hasError ? (
        <MotionPressable accessibilityRole="button" onPress={onRetry} style={styles.weekRetryInline}>
          <Text style={[styles.weekRetryText, { color: todayColor }]}>{t('ranks.weekFocus.retry')}</Text>
        </MotionPressable>
      ) : null}
    </View>
  );
}

/**
 * Sezon başarıları — iki sütunlu kompakt rozet ızgarası.
 *
 * Bu bölüm hiçbir ilerleme HESAPLAMAZ: `currentProgress` / `targetProgress`
 * sunucudan geldiği gibi gösterilir. Rozetler yalnızca görseldir; RP, XP veya
 * gül üretmez. Hata bu bölümle sınırlıdır — ekranın geri kalanı çalışmaya
 * devam eder.
 *
 * İkon eşlemesi `components/ranks/achievement-icons.ts` içindedir; açılma
 * kutlaması da aynı kaynağı kullanır.
 */
function AchievementsGrid({
  accent,
  achievements,
  colors,
  hasError,
  isDark,
  isLoading,
  locale,
  onRetry,
  styles,
  t,
}: {
  accent: string;
  achievements: SeasonAchievement[];
  colors: ThemeColors;
  hasError: boolean;
  isDark: boolean;
  isLoading: boolean;
  locale: string;
  onRetry: () => void;
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  /**
   * Ayrıntısı açık olan rozet.
   *
   * Anahtar saklanır, nesne DEĞİL: arka planda yeni bir sunucu cevabı gelirse
   * pencere donmuş bir kopyayı değil GÜNCEL ilerlemeyi gösterir.
   */
  const [openKey, setOpenKey] = useState<SeasonAchievementKey>();
  const closeDetail = useCallback(() => setOpenKey(undefined), []);

  const openAchievement = achievements.find((entry) => entry.key === openKey);
  const openUnlockedAt = openAchievement?.unlockedAt;
  // Tarih biçimlendirmesi bu ekranın mevcut yardımcısıdır; kopyalanmaz.
  const openUnlockedLabel = openUnlockedAt ? formatUnlockedAt(openUnlockedAt, locale) : undefined;

  if (achievements.length === 0) {
    return (
      <View style={styles.achievementsState}>
        {isLoading ? (
          <ActivityIndicator color={colors.textSecondary} size="small" />
        ) : (
          <>
            <Text style={styles.achievementsStateText}>
              {hasError ? t('ranks.achievements.unavailable') : t('ranks.achievements.empty')}
            </Text>
            {hasError ? (
              <MotionPressable
                accessibilityRole="button"
                onPress={onRetry}
                style={styles.achievementsRetry}>
                <Text style={[styles.achievementsRetryText, { color: accent }]}>
                  {t('ranks.achievements.retry')}
                </Text>
              </MotionPressable>
            ) : null}
          </>
        )}
      </View>
    );
  }

  /**
   * ÖZET — yalnızca sunum bilgisi.
   *
   * Kazanılan sayısı mevcut `isUnlocked` değerlerinden sayılır; yeni başarı
   * mantığı, eşik veya hedef ÜRETİLMEZ. Genel çizginin dolumu kazanılan/toplam
   * oranıdır ve güvenli biçimde 0–1 aralığına sınırlıdır.
   */
  const earnedCount = achievements.filter((entry) => entry.isUnlocked).length;
  const totalCount = achievements.length;
  const summaryRatio = totalCount > 0 ? Math.min(1, Math.max(0, earnedCount / totalCount)) : 0;

  return (
    <>
      <View
        accessible
        accessibilityLabel={t('ranks.achievements.summaryA11y', {
          earned: earnedCount,
          total: totalCount,
        })}
        style={styles.achievementsSummary}>
        <Text style={styles.achievementsSummaryText}>
          {t('ranks.achievements.summaryLabel', { earned: earnedCount, total: totalCount })}
        </Text>
        <View style={[styles.achievementsSummaryTrack, { backgroundColor: colors.surfaceMuted }]}>
          <View
            style={[
              styles.achievementsSummaryFill,
              { backgroundColor: accent, width: `${Math.round(summaryRatio * 100)}%` },
            ]}
          />
        </View>
      </View>

      <View style={styles.achievementsGrid}>
        {achievements.map((achievement) => (
          <AchievementBadge
            accent={accent}
            achievement={achievement}
            colors={colors}
            isDark={isDark}
            key={achievement.key}
            locale={locale}
            onOpen={setOpenKey}
            styles={styles}
            t={t}
          />
        ))}
      </View>

      <AchievementDetailSheet
        accent={accent}
        achievement={openAchievement}
        onClose={closeDetail}
        unlockedLabel={openUnlockedLabel}
      />
      {hasError ? (
        <MotionPressable
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.achievementsRetryInline}>
          <Text style={[styles.achievementsRetryText, { color: accent }]}>
            {t('ranks.achievements.retry')}
          </Text>
        </MotionPressable>
      ) : null}
    </>
  );
}

/**
 * Tek başarı rozet KUTUSU — iki sütunlu koleksiyonun bir hücresi.
 *
 * Yatay küçük kart değil, dikey rozet kutusu: üstte ortak medallion, altında en
 * fazla iki satırlık ad, ardından duruma göre kilitli ilerleme (metin + ince
 * çizgi) veya açılma tarihi/"Açıldı" metni. Hiçbir ilerleme HESAPLANMAZ; dolum
 * oranı yalnızca sunucudan gelen `currentProgress` / `targetProgress` ile
 * bulunur ve güvenli biçimde 0–1 aralığına sınırlanır.
 */
function AchievementBadge({
  accent,
  achievement,
  colors,
  isDark,
  locale,
  onOpen,
  styles,
  t,
}: {
  accent: string;
  achievement: SeasonAchievement;
  colors: ThemeColors;
  isDark: boolean;
  locale: string;
  onOpen: (key: SeasonAchievementKey) => void;
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const { currentProgress, isUnlocked, key, targetProgress, unlockedAt } = achievement;
  const name = t(`ranks.achievements.items.${key}.name`);
  const progressLabel = t('ranks.achievements.progress', {
    current: currentProgress,
    target: targetProgress,
  });
  const unlockedLabel = unlockedAt ? formatUnlockedAt(unlockedAt, locale) : undefined;
  const unlockedDetail = unlockedLabel ?? t('ranks.achievements.unlocked');
  const progressRatio =
    targetProgress > 0 ? Math.min(1, Math.max(0, currentProgress / targetProgress)) : 0;

  return (
    <MotionPressable
      accessibilityHint={t('ranks.achievements.detail.openHint')}
      accessibilityLabel={
        isUnlocked
          ? t('ranks.achievements.unlockedA11y', {
              current: currentProgress,
              name,
              target: targetProgress,
            })
          : t('ranks.achievements.lockedA11y', {
              current: currentProgress,
              name,
              target: targetProgress,
            })
      }
      accessibilityRole="button"
      onPress={() => onOpen(key)}
      style={[
        styles.achievementCard,
        { borderColor: isUnlocked ? withAlpha(accent, isDark ? 0.5 : 0.35) : colors.separator },
        !isUnlocked && styles.achievementCardLocked,
      ]}>
      <AchievementMedallion accent={accent} icon={ACHIEVEMENT_ICONS[key]} isUnlocked={isUnlocked} />

      <Text
        numberOfLines={2}
        style={[styles.achievementName, !isUnlocked && styles.achievementNameLocked]}>
        {name}
      </Text>

      {isUnlocked ? (
        <Text numberOfLines={1} style={styles.achievementDetail}>
          {unlockedDetail}
        </Text>
      ) : (
        <View style={styles.achievementProgress}>
          <Text numberOfLines={1} style={styles.achievementDetail}>
            {progressLabel}
          </Text>
          <View style={[styles.achievementTrack, { backgroundColor: colors.surfaceMuted }]}>
            <View
              style={[
                styles.achievementFill,
                { backgroundColor: accent, width: `${Math.round(progressRatio * 100)}%` },
              ]}
            />
          </View>
        </View>
      )}
    </MotionPressable>
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

/**
 * Tek RP hareketi.
 *
 * Dokunma hedefi YOKTUR: sade, salt okunur bir satırdır. Ham `event_type`,
 * `source_key`, satır kimliği veya JSON metadata GÖSTERİLMEZ — ad zaten
 * serviste güvenli bir çeviri anahtarına dönüştürülmüştür.
 *
 * Güçlü renk yalnızca RP değerindedir: pozitif kazanım rank vurgusu, negatif
 * telafi mevcut `danger` rengiyle çizilir. Ad ve tarih tema renklerinde kalır.
 */
function EventRow({
  accent,
  dangerColor,
  event,
  isLast,
  locale,
  styles,
  t,
}: {
  accent: string;
  dangerColor: string;
  event: RankEvent;
  isLast: boolean;
  locale: string;
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const { amount, isPositive } = toRankRpDisplay(event.rpDelta);

  return (
    <View style={[styles.eventRow, isLast && styles.eventRowLast]}>
      <View style={styles.eventTextGroup}>
        <Text numberOfLines={1} style={styles.eventTitle}>
          {t(`ranks.events.${event.labelKey}`)}
        </Text>
        <Text numberOfLines={2} style={styles.eventMeta}>
          {formatEventDate(event.dateKey, locale)}
          {isPositive ? '' : ` · ${t('ranks.events.correctionNote')}`}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={[styles.eventRp, { color: isPositive ? accent : dangerColor }]}>
        {t(isPositive ? 'ranks.events.rpGain' : 'ranks.events.rpLoss', { rp: amount })}
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

/** `YYYY-MM-DD` → kısa yerelleştirilmiş gün. */
function formatEventDate(dateKey: string, locale: string) {
  return dateFromKey(dateKey).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/** `timestamptz` → kısa yerelleştirilmiş gün. Okunamazsa `undefined`. */
function formatUnlockedAt(timestamp: string, locale: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

function formatWeekday(dateKey: string, locale: string) {
  return dateFromKey(dateKey).toLocaleDateString(locale, { weekday: 'short' }).replace('.', '');
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 40, paddingHorizontal: Layout.screenPadding, paddingTop: 8 },
    centerState: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 32 },
    centerText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },

    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    headerTextGroup: { flexShrink: 1, gap: 4 },
    /** Dokunma alanı 44×44 pt'nin altına inmez. */
    guideButton: {
      alignItems: 'center',
      height: Layout.minTouchSize,
      justifyContent: 'center',
      width: Layout.minTouchSize,
    },
    eyebrow: { color: colors.text, fontSize: 17, fontWeight: '600' },
    dateRange: { color: colors.textSecondary, fontSize: 13, fontWeight: '400' },

    card: { borderRadius: Layout.radiusMedium, gap: 12, padding: 16 },
    cardTopRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
    cardIdentity: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 12 },
    cardTitleGroup: { flexShrink: 1, gap: 2 },
    cardEyebrow: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
    cardRank: { fontSize: 17, fontWeight: '600' },
    cardRp: { fontSize: 17, fontWeight: '600' },
    track: { borderRadius: 3, height: 6, overflow: 'hidden', width: '100%' },
    fill: { height: '100%' },
    cardFootnote: { color: colors.textSecondary, fontSize: 13, fontWeight: '400' },

    /**
     * Sade alt çizgili sekme şeridi — pill veya ayrı kart DEĞİL. Alt kenardaki
     * ince ayraç bütün sekmelerin altında ortak taban çizgisidir; seçili sekme
     * onu accent renkli çizgiyle örter.
     */
    tabBar: {
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      marginTop: 16,
    },
    tab: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 4,
    },
    tabLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    tabLabelActive: { color: colors.text },
    /** Seçili sekmenin altındaki accent çizgi; taban ayraçla hizalanır. */
    tabUnderline: {
      backgroundColor: 'transparent',
      borderRadius: 1,
      bottom: -StyleSheet.hairlineWidth,
      height: 2,
      left: 0,
      position: 'absolute',
      right: 0,
    },

    weekCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radiusMedium,
      gap: 12,
      marginTop: 12,
      padding: 16,
    },
    weekHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    weekHeaderText: { gap: 2 },
    weekEyebrow: { color: colors.text, fontSize: 15, fontWeight: '600' },
    weekRange: { color: colors.textSecondary, fontSize: 11, fontWeight: '400' },
    weekDays: { flexDirection: 'row', justifyContent: 'space-between' },
    weekDay: { alignItems: 'center', gap: 6 },
    weekDayLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '400' },
    weekDayCircle: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: 16,
      borderWidth: 1,
      height: 32,
      justifyContent: 'center',
      width: 32,
    },
    weekDayPlanned: { backgroundColor: colors.surfaceMuted },
    weekDayMuted: { backgroundColor: 'transparent', borderColor: colors.separator },
    weekDayNumber: { color: colors.text, fontSize: 13, fontWeight: '600' },
    weekDayNumberMuted: { color: colors.textTertiary },
    weekMessage: { color: colors.textSecondary, fontSize: 13, fontWeight: '400' },
    weekState: { alignItems: 'center', gap: 8, minHeight: 64, justifyContent: 'center' },
    weekStateText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
    weekRetry: { minHeight: Layout.minTouchSize, justifyContent: 'center' },
    weekRetryInline: { alignSelf: 'flex-start', minHeight: Layout.minTouchSize, justifyContent: 'center' },
    weekRetryText: { fontSize: 13, fontWeight: '600' },

    achievementsBlock: { marginTop: 24 },

    /**
     * Koleksiyon özeti: kazanılan/toplam metni ve ince genel ilerleme çizgisi.
     * Yalnızca sunum — sayılar `isUnlocked` değerlerinden gelir.
     */
    achievementsSummary: { gap: 8, marginBottom: 16 },
    achievementsSummaryText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    achievementsSummaryTrack: { borderRadius: 2, height: 4, overflow: 'hidden', width: '100%' },
    achievementsSummaryFill: { height: '100%' },

    achievementsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    /**
     * İki sütunlu rozet KUTUSU — dikey yerleşim: medallion, ad, durum. Genişlik
     * %48; 375 pt ekranda iki sütun taşmadan sığar ve metinler sarar.
     */
    achievementCard: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 8,
      minHeight: 128,
      padding: 14,
      width: '48%',
    },
    achievementCardLocked: { opacity: 0.82 },
    achievementName: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    achievementNameLocked: { color: colors.textSecondary },
    achievementDetail: {
      color: colors.textTertiary,
      fontSize: 11,
      fontWeight: '400',
      textAlign: 'center',
    },
    /** Kilitli kutuda ilerleme metni + ince çizgi. */
    achievementProgress: { alignItems: 'center', alignSelf: 'stretch', gap: 6 },
    achievementTrack: { borderRadius: 2, height: 4, overflow: 'hidden', width: '100%' },
    achievementFill: { height: '100%' },
    achievementsState: { alignItems: 'center', gap: 8, justifyContent: 'center', minHeight: 64 },
    achievementsStateText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
    achievementsRetry: { justifyContent: 'center', minHeight: Layout.minTouchSize },
    achievementsRetryInline: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
    },
    achievementsRetryText: { fontSize: 13, fontWeight: '600' },

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

    eventRow: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      paddingVertical: 12,
    },
    eventRowLast: { borderBottomWidth: 0 },
    eventTextGroup: { flexShrink: 1, gap: 4 },
    eventTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    eventMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: '400' },
    eventRp: { fontSize: 15, fontWeight: '600' },

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
