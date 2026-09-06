import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProfileCareerShowcase } from '@/components/ranks/profile-career-showcase';
import { ProfileProgressSummary } from '@/components/rewards/profile-progress-summary';
import { ProfileProofStats } from '@/components/rewards/profile-proof-stats';
import { LevelRoseSheet } from '@/components/rewards/level-rose-sheet';
import { RewardInfoSheet, RewardInfoKind } from '@/components/rewards/reward-info-sheet';
import { ProfileDisciplineCard } from '@/components/profile-discipline-card';
import { ProfileSharedProgram } from '@/components/profile-shared-program';
import { MotionSection } from '@/components/motion-section';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useLanguage } from '@/context/language-context';
import { useProfile } from '@/context/profile-context';
import { useAchievements } from '@/context/achievement-context';
import { useRanks } from '@/context/rank-context';
import { useRewards } from '@/context/reward-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { calculateDisciplineStreak } from '@/utils/discipline';
import { buildSharedProgramFromWorkoutProgram } from '@/utils/shared-program';

/** Profil ekranının bugünkü vurgu tonu (seviye rozeti / ilerleme halkası). */
const PROFILE_ACCENT_DEFAULT = '#D5755B';
/** Sert iOS esnemelerinde bile Friends zemininin bitmemesi için ekran katsayısı. */
const FRIENDS_OVERSCROLL_SCREEN_MULTIPLIER = 3;

/**
 * PROFİL — artık SALT OKUNUR özet. Profil düzenleme Ayarlar → "Profili düzenle"
 * (`/profile-edit`) üzerinden yapılır; bu ekranda açılır editör, "Düzenle"
 * düğmesi ve ona ait scroll/otomatik-kaydırma mantığı YOKTUR. Avatar, kapak, ad,
 * kullanıcı adı ve bio güncel `ProfileProvider` verisini gösterir.
 */
export default function ProfileScreen() {
  const { profile, profileLoadStatus, reloadProfile, shareActiveProgram } = useProfile();
  const { colors, isDark } = useAppTheme();
  const { height: windowHeight } = useWindowDimensions();
  const friendsOverscrollFillHeight = windowHeight * FRIENDS_OVERSCROLL_SCREEN_MULTIPLIER;
  const insets = useSafeAreaInsets();
  const { activeProgramId, disciplineStatuses, programs, workoutSessions } = useWorkout();
  const { t } = useLanguage();
  const { progress: levelProgress, levelRoseState, selectedRoseId, setLevelRose } = useRewards();
  const { hasRankError, isRankLoading, season: rankSeason } = useRanks();
  const {
    achievements: careerAchievements,
    requestSync: requestAchievementSync,
    showcaseSelection: careerShowcaseSelection,
    status: achievementStatus,
    showcaseStatus: achievementShowcaseStatus,
  } = useAchievements();

  /**
   * Level rose seçimi KAYDEDİLİNCE `rose_bud` için ölçülü senkron (fire-and-forget).
   */
  const handleRoseSelect = useCallback(
    async (roseId: string | null) => {
      const outcome = await setLevelRose(roseId);
      if (outcome === 'saved') requestAchievementSync();
      return outcome;
    },
    [requestAchievementSync, setLevelRose],
  );

  // Profil'e girildiğinde kariyer başarım verisi güncellenir (coalescing'li).
  useFocusEffect(
    useCallback(() => {
      requestAchievementSync();
    }, [requestAchievementSync]),
  );

  const careerShowcaseEntries = useMemo(() => {
    const unlocked = careerAchievements.filter((a) => a.isUnlocked);
    const byKey = new Map(unlocked.map((a) => [a.key, a]));
    if (careerShowcaseSelection.length > 0) {
      return careerShowcaseSelection.filter((k) => byKey.has(k)).map((k) => ({ key: k }));
    }
    return [...unlocked]
      .sort((a, b) => (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? ''))
      .slice(0, 3)
      .map((a) => ({ key: a.key }));
  }, [careerAchievements, careerShowcaseSelection]);

  const profileAccent = useFeatureColor('profile', PROFILE_ACCENT_DEFAULT);
  const styles = useMemo(
    () => createStyles(colors, isDark, profileAccent.color),
    [colors, isDark, profileAccent.color],
  );

  const [rewardInfoKind, setRewardInfoKind] = useState<RewardInfoKind>();
  const [roseSheetOpen, setRoseSheetOpen] = useState(false);

  const avatarLetter = profile.displayName.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'S';
  const completedWorkoutDayCount = new Set(
    workoutSessions.filter((session) => session.status === 'completed').map((session) => session.dateKey),
  ).size;
  const disciplineStreak = calculateDisciplineStreak(disciplineStatuses);

  const activeProgram = shareActiveProgram
    ? programs.find((program) => program.id === activeProgramId)
    : undefined;
  const ownSharedProgram = activeProgram ? buildSharedProgramFromWorkoutProgram(activeProgram) : undefined;

  return (
    /*
      Banner ekranın EN ÜSTÜNDEN başlasın diye üst safe-area kenarı bilinçli
      olarak uygulanmaz (çentiğin arkasına uzanır). Yalnız banner'dan ÖNCE
      çizilebilen hata satırı `insets.top` kadar aşağı alınır.
    */
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {profileLoadStatus === 'error' && (
          <View style={[styles.loadErrorRow, { marginTop: insets.top }]}>
            <View style={styles.loadErrorText}>
              <Text style={styles.loadErrorTitle}>{t('profile.loadFailed')}</Text>
              <Text style={styles.loadErrorBody}>{t('profile.loadFailedBody')}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={reloadProfile}
              style={({ pressed }) => [styles.loadErrorButton, pressed && styles.pressed]}>
              <Text style={styles.loadErrorButtonText}>{t('profile.loadRetry')}</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.bannerSection}>
          <View style={styles.banner}>
            {profile.bannerUri ? (
              <Image autoplay contentFit="cover" source={{ uri: profile.bannerUri }} style={styles.bannerImage} />
            ) : (
              <View style={styles.bannerPlaceholder} />
            )}
          </View>

          {/* Kapağın HEMEN ALTINDA: solda avatar (kapağa taşar), sağda Ayarlar
              dişlisi. Dişli kapağın/çentiğin üzerinde DEĞİL, hero kapsayıcısı
              içinde kontrollü konumdadır (mutlak ekran koordinatı yok). */}
          <View style={styles.heroRow}>
            <View style={styles.avatarWrapper}>
              <View style={styles.avatar}>
                {profile.avatarUri ? (
                  <Image autoplay contentFit="cover" source={{ uri: profile.avatarUri }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarLetter}>{avatarLetter}</Text>
                )}
              </View>
            </View>

            <Pressable
              accessibilityLabel={t('profile.settings')}
              accessibilityRole="button"
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}>
              <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>

        {/* KİMLİK — salt okunur: @kullanıcı, ana ad, ikincil bio. Düzenle/Ayarlar
            satırı KALDIRILDI (düzenleme Ayarlar'dan). */}
        <MotionSection style={styles.profileSummary}>
          <Text numberOfLines={1} style={styles.summaryUsername}>
            @{profile.username || t('profile.usernamePlaceholder')}
          </Text>
          <Text numberOfLines={2} style={styles.summaryName}>
            {profile.displayName || t('profile.displayNamePlaceholder')}
          </Text>
          {profile.bio.trim() ? <Text style={styles.summaryBio}>{profile.bio.trim()}</Text> : null}
        </MotionSection>

        <View style={[styles.sectionDivider, styles.firstDividerSpacing]} />

        <MotionSection delay={40} style={styles.progressSection}>
          <ProfileProgressSummary
            accentColor={profileAccent.color}
            level={levelProgress.level}
            levelRoseState={levelRoseState}
            onLevelPress={() => setRoseSheetOpen(true)}
            selectedRoseId={selectedRoseId}
            xpForNextLevel={levelProgress.xpForNextLevel}
            xpIntoLevel={levelProgress.xpIntoLevel}
          />

          <View style={styles.proofSpacer} />
          <ProfileProofStats
            accentColor={profileAccent.color}
            dayStreak={disciplineStreak}
            onDayStreakPress={() => router.push('/streaks')}
            onRosesPress={() => setRewardInfoKind('roses')}
            roseBalance={levelProgress.roseBalance}
            workoutDays={completedWorkoutDayCount}
          />
        </MotionSection>

        <View style={styles.sectionDivider} />

        <MotionSection delay={80} style={styles.showcaseSection}>
          <ProfileCareerShowcase
            accentColor={profileAccent.color}
            entries={careerShowcaseEntries}
            hasError={achievementStatus === 'unavailable'}
            hasRankError={hasRankError}
            isLoading={achievementStatus === 'loading' || achievementShowcaseStatus === 'loading'}
            isRankLoading={isRankLoading}
            onEdit={() => router.push('/achievements-showcase')}
            onPress={() => router.push('/achievements')}
            onRankPress={() => router.push('/rank')}
            rank={rankSeason ? { id: rankSeason.currentRank, rp: rankSeason.currentRp } : undefined}
          />
        </MotionSection>

        <View style={styles.sectionDivider} />

        <View style={styles.catalogStack}>
          {ownSharedProgram && (
            <MotionSection delay={40} style={[styles.catalogCard, styles.catalogCardPos0]}>
              <ProfileSharedProgram accentColor={profileAccent.color} compact program={ownSharedProgram} />
            </MotionSection>
          )}

          <MotionSection
            delay={40}
            style={[styles.catalogCard, ownSharedProgram ? styles.catalogCardPos1 : styles.catalogCardPos0]}>
            <ProfileDisciplineCard accentColor={profileAccent.color} collapsible compact />
          </MotionSection>

          <MotionSection
            delay={80}
            style={[styles.catalogCard, ownSharedProgram ? styles.catalogCardPos2 : styles.catalogCardPos1]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/friends')}
              style={({ pressed }) => [styles.friendsRow, pressed && styles.pressed]}>
              <View style={styles.friendsIcon}>
                <Ionicons name="people-outline" size={18} color={colors.textSecondary} />
              </View>
              <View style={styles.friendsText}>
                <Text style={styles.friendsTitle}>{t('friends.profileRow')}</Text>
                <Text style={styles.friendsCaption}>{t('friends.profileRowCaption')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
            <View
              pointerEvents="none"
              style={[
                styles.friendsOverscrollFill,
                {
                  backgroundColor: ownSharedProgram ? colors.surfaceMuted : colors.surface,
                  bottom: -friendsOverscrollFillHeight,
                  height: friendsOverscrollFillHeight,
                },
              ]}></View>
          </MotionSection>
        </View>
      </ScrollView>
      <RewardInfoSheet
        accentColor={profileAccent.color}
        kind={rewardInfoKind}
        onClose={() => setRewardInfoKind(undefined)}
      />
      <LevelRoseSheet
        accentColor={profileAccent.color}
        level={levelProgress.level}
        onClose={() => setRoseSheetOpen(false)}
        onInfo={() => setRewardInfoKind('level')}
        onSelect={handleRoseSelect}
        selectedRoseId={selectedRoseId}
        visible={roseSheetOpen}
      />
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors, isDark: boolean, accent: string) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 0, paddingTop: 0 },
    bannerSection: { marginBottom: 12 },
    banner: {
      aspectRatio: 2.25,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
      width: '100%',
    },
    bannerImage: { height: '100%', width: '100%' },
    bannerPlaceholder: { backgroundColor: colors.surfaceMuted, flex: 1 },
    /**
     * Kapak altındaki hero satırı: solda avatar (yukarı taşan), sağda Ayarlar.
     * `alignItems: flex-start` → dişli satırın ÜST hizasında (kapağın hemen
     * altında) kalır; avatarın negatif üst margin'i yalnızca avatarı yukarı taşır.
     */
    heroRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: Layout.screenPadding,
    },
    avatarWrapper: { marginTop: -36 },
    avatar: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderColor: colors.background,
      borderRadius: 40,
      borderWidth: 4,
      height: 80,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 80,
    },
    avatarImage: { height: '100%', width: '100%' },
    avatarLetter: { color: colors.primarySoftText, fontSize: 28, fontWeight: '500' },
    /**
     * Ayarlar dişlisi — kapak altında, sağ hero alanında; en az 44×44 pt. Tema
     * tokenları; sabit siyah/beyaz zemin YOK. Kapağın/çentiğin üzerinde değil.
     */
    settingsButton: {
      alignItems: 'center',
      borderColor: isDark ? '#4B383D' : '#E8CFC7',
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      height: Layout.minTouchSize,
      justifyContent: 'center',
      marginTop: 8,
      width: Layout.minTouchSize,
    },
    profileSummary: { alignItems: 'center', gap: 6, paddingHorizontal: Layout.screenPadding, paddingBottom: 12 },
    summaryUsername: {
      color: accent,
      fontSize: 12,
      fontWeight: '500',
      marginTop: 4,
    },
    summaryName: {
      color: isDark ? colors.text : '#42283A',
      fontSize: 27,
      fontWeight: '500',
      lineHeight: 33,
      textAlign: 'center',
    },
    summaryBio: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '400',
      lineHeight: 19,
      marginTop: 2,
      paddingHorizontal: 8,
      textAlign: 'center',
    },
    loadErrorRow: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusMedium,
      flexDirection: 'row',
      gap: 12,
      marginBottom: 12,
      marginHorizontal: Layout.screenPadding,
      padding: 14,
    },
    loadErrorText: { flex: 1, gap: 2 },
    loadErrorTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    loadErrorBody: { color: colors.textSecondary, ...Type.caption, lineHeight: 18 },
    loadErrorButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 4,
    },
    loadErrorButtonText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
    friendsRow: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      flexDirection: 'row',
      gap: 12,
      minHeight: 68,
      paddingVertical: 12,
      width: '100%',
    },
    friendsIcon: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: 24,
      borderWidth: StyleSheet.hairlineWidth,
      height: 48,
      justifyContent: 'center',
      width: 48,
    },
    friendsText: { flex: 1, gap: 1 },
    friendsTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
    friendsCaption: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    friendsOverscrollFill: { left: 0, position: 'absolute', right: 0 },
    sectionDivider: {
      backgroundColor: colors.separator,
      height: StyleSheet.hairlineWidth,
      marginHorizontal: Layout.screenPadding,
      marginVertical: 20,
    },
    firstDividerSpacing: { marginVertical: 12 },
    progressSection: { alignItems: 'center', paddingHorizontal: Layout.screenPadding },
    // XP çubuğu ile üçlü kanıt arasında sakin nefes alanı (ayırıcı çizgi YOK —
    // referanstaki gibi Level/XP ve istatistikler tek sakin blok akışında).
    proofSpacer: { height: 28, width: '100%' },
    showcaseSection: { paddingHorizontal: Layout.screenPadding },
    catalogStack: { width: '100%' },
    catalogCard: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingBottom: 26,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 22,
      width: '100%',
    },
    catalogCardPos0: { backgroundColor: colors.surfaceMuted, zIndex: 1 },
    catalogCardPos1: { backgroundColor: colors.surface, marginTop: -18, zIndex: 2 },
    catalogCardPos2: { backgroundColor: colors.surfaceMuted, marginTop: -18, zIndex: 3 },
    pressed: { opacity: 0.6 },
  });
}
