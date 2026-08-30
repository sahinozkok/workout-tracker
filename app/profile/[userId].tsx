import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { withAlpha } from '@/constants/color-presets';
import { resolveProfileColor } from '@/hooks/use-feature-colors';
import { ProfileAchievementShowcase } from '@/components/ranks/profile-achievement-showcase';
import { RankBadge } from '@/components/ranks/rank-badge';
import { LevelProgressRing } from '@/components/rewards/level-progress-ring';
import { ProfileDisciplineCard } from '@/components/profile-discipline-card';
import { ProfileSharedProgram } from '@/components/profile-shared-program';
import { Fonts, Layout, ThemeColors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { fetchFriendAchievementShowcase, fetchFriendRank } from '@/services/ranks';
import { getFriendActiveProgram, getFriendDisciplineDays, getFriendProfile } from '@/services/friends';
import { FriendProfile, SharedActiveProgram } from '@/types/friends';
import { FriendRankSummary, SeasonAchievementShowcaseEntry } from '@/types/ranks';
import { DisciplineStatus } from '@/types/workout';
import { toDateKey } from '@/utils/discipline';

/** Arkadaş takviminde gösterilen aralık: son bir yıl. */
const VISIBLE_DAYS = 366;

/** Hedef değerleri mevcut profil çevirileriyle eşleşir. */
const GOAL_LABEL_KEYS: Record<string, string> = {
  consistency: 'profile.goalConsistency',
  fitness: 'profile.goalFitness',
  muscle: 'profile.goalMuscle',
  strength: 'profile.goalStrength',
};

/** Arkadaş profilinin bugünkü vurgu tonu. */
const FRIEND_PROFILE_ACCENT_DEFAULT = '#D5755B';

export default function FriendProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { user } = useAuth();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const isOwnProfile = Boolean(userId) && userId === user?.id;

  // Kendi kimliğiyle açılırsa "erişim yok" göstermek yerine Profil sekmesine
  // yönlendirilir. Yalnızca auth kullanıcı kimliği okunur.
  useEffect(() => {
    if (isOwnProfile) router.replace('/profile');
  }, [isOwnProfile]);

  const [profile, setProfile] = useState<FriendProfile>();  /**
   * Profil rengi SAHİBİNDEN gelir; görüntüleyenin kendi tercihi kullanılmaz.
   * Alan yoksa (migration uygulanmadıysa) bugünkü ton uygulanır.
   */
  const ownerAccent = resolveProfileColor(profile?.colorPresetId, FRIEND_PROFILE_ACCENT_DEFAULT);
  const styles = createStyles(colors, ownerAccent.color);

  const [statuses, setStatuses] = useState<Record<string, DisciplineStatus>>({});
  /** Arkadaşın sezon rank özeti. Arkadaş değilse RPC boş döner ve rozet çizilmez. */
  const [friendRank, setFriendRank] = useState<FriendRankSummary>();
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const isMountedRef = useRef(true);

  /**
   * Arkadaşın sezon rozet vitrini.
   *
   * Mevcut profil / disiplin / rank akışından TAMAMEN AYRI ve toleranslı
   * okunur: RPC hatası profili hata ekranına düşürmez, yalnızca vitrin
   * gizlenir. Arkadaş değilse RPC hiç satır döndürmez ve vitrin çizilmez.
   */
  const [showcase, setShowcase] = useState<SeasonAchievementShowcaseEntry[]>([]);
  const [hasShowcaseError, setHasShowcaseError] = useState(false);
  /**
   * İstek nesli: hesap veya route (`userId`) değişirse eski isteğin cevabı
   * YENİ profilin state'ine yazamaz.
   */
  const showcaseRequestIdRef = useRef(0);

  /**
   * Paylaşılan aktif program AYRI ve TOLERANSLI okunur: opt-out / aktif program
   * yok / arkadaş değil / engel durumlarında RPC sıfır satır döner ve bölüm hiç
   * çizilmez. RPC HATASI da profili/takvimi/rank'ı düşürmez — yalnızca program
   * bölümü gizlenir. Kendi istek nesliyle route/hesap değişiminde eski cevap yeni
   * profile yazamaz.
   */
  const [sharedProgram, setSharedProgram] = useState<SharedActiveProgram>();
  const sharedProgramRequestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!userId || isOwnProfile) return;

    setIsLoading(true);
    setHasError(false);
    try {
      // Arkadaş değilse RPC boş döner; takvim isteği hiç yapılmaz.
      const nextProfile = await getFriendProfile(userId);
      if (!isMountedRef.current) return;
      setProfile(nextProfile);

      if (!nextProfile) return;

      const today = new Date();
      const from = new Date(today);
      // Bugün dahil VISIBLE_DAYS gün → bugünden (VISIBLE_DAYS - 1) geriye.
      from.setDate(from.getDate() - (VISIBLE_DAYS - 1));
      const days = await getFriendDisciplineDays(userId, toDateKey(from), toDateKey(today));
      if (!isMountedRef.current) return;

      const next: Record<string, DisciplineStatus> = {};
      for (const day of days) next[day.dateKey] = day.status;
      setStatuses(next);

      /**
       * Rank özeti AYRI ve TOLERANSLI okunur: `sync_my_rank` başka bir
       * kullanıcı için çalıştırılamaz, bu yüzden arkadaşın rank satırı henüz
       * hiç oluşmamış olabilir. O durumda rozet çizilmez ve profil ekranı
       * normal açılmaya devam eder — rank hatası profili düşürmez.
       */
      try {
        const rank = await fetchFriendRank(userId);
        if (isMountedRef.current) setFriendRank(rank);
      } catch {
        if (isMountedRef.current) setFriendRank(undefined);
      }
    } catch {
      if (isMountedRef.current) setHasError(true);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [isOwnProfile, userId]);

  useEffect(() => {
    isMountedRef.current = true;
    void load();

    return () => {
      isMountedRef.current = false;
    };
  }, [load]);

  useEffect(() => {
    // Nesil, uzunluk kontrolünden ÖNCE artar: route değişince uçuştaki eski
    // cevap da geçersizleşir ve yeni profile yazamaz.
    const requestId = showcaseRequestIdRef.current + 1;
    showcaseRequestIdRef.current = requestId;

    setShowcase([]);
    setHasShowcaseError(false);

    if (!userId || isOwnProfile) return;

    let isActive = true;

    fetchFriendAchievementShowcase(userId)
      .then((entries) => {
        // Unmount sonrası ve eski nesil cevabı state'e YAZILMAZ.
        if (!isActive || showcaseRequestIdRef.current !== requestId) return;
        setShowcase(entries);
      })
      .catch(() => {
        if (!isActive || showcaseRequestIdRef.current !== requestId) return;
        // Vitrin sessizce gizlenir; profil ekranı düşmez.
        setHasShowcaseError(true);
      });

    return () => {
      isActive = false;
    };
  }, [isOwnProfile, userId]);

  useEffect(() => {
    // Nesil uzunluk kontrolünden ÖNCE artar: route değişince uçuştaki eski cevap
    // geçersizleşir ve yeni profile yazamaz.
    const requestId = sharedProgramRequestIdRef.current + 1;
    sharedProgramRequestIdRef.current = requestId;

    setSharedProgram(undefined);

    if (!userId || isOwnProfile) return;

    let isActive = true;

    getFriendActiveProgram(userId)
      .then((program) => {
        if (!isActive || sharedProgramRequestIdRef.current !== requestId) return;
        setSharedProgram(program);
      })
      .catch(() => {
        // Program bölümü sessizce gizlenir; profil ekranı düşmez.
        if (!isActive || sharedProgramRequestIdRef.current !== requestId) return;
        setSharedProgram(undefined);
      });

    return () => {
      isActive = false;
    };
  }, [isOwnProfile, userId]);

  if (isOwnProfile || isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // Arkadaşlık kaldırılmışsa veya istek henüz kabul edilmemişse erişim kapalıdır.
  if (hasError || !profile) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>{t('friends.profileUnavailable')}</Text>
          <Text style={styles.emptyBody}>{t('friends.profileUnavailableBody')}</Text>
          {hasError && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryText}>{t('friends.retry')}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const initial = profile.displayName.trim().charAt(0).toLocaleUpperCase('tr-TR') || '?';

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: profile.displayName }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.banner}>
          {profile.bannerUrl ? (
            <Image autoplay contentFit="cover" source={{ uri: profile.bannerUrl }} style={styles.bannerImage} />
          ) : (
            <View style={styles.bannerPlaceholder} />
          )}
        </View>

        <View style={styles.header}>
          <View style={styles.avatar}>
            {profile.avatarUrl ? (
              <Image autoplay contentFit="cover" source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarLetter}>{initial}</Text>
            )}
          </View>
          <Text style={styles.username}>
            {profile.username ? `@${profile.username}` : t('friends.noUsername')}
          </Text>
          <Text style={styles.name}>{profile.displayName}</Text>

          {/* Rank rozeti YALNIZCA `get_friend_rank` veri döndürürse çizilir;
              o RPC de `are_friends` ile korunur. Arkadaş değilse veri hiç
              gelmez. Gül bakiyesi ve ham RP event geçmişi HİÇ gösterilmez. */}
          <View style={styles.levelIdentityRow}>
            <View style={styles.levelPill}>
              <Text style={styles.levelPillIcon}>❀</Text>
              <Text style={styles.levelPillText}>{t('rewards.levelLabel', { level: profile.level })}</Text>
            </View>
            {friendRank && <RankBadge rankId={friendRank.currentRank} rp={friendRank.currentRp} />}
          </View>

          {/* Arkadaşın sezon rozetleri: rank rozeti YENİDEN ÇİZİLMEZ. Salt
              okunurdur (`onPress` verilmez) ve arkadaşın KENDİ seçtiği vurgu
              rengini kullanır. RPC hata verirse sessizce gizlenir. */}
          <ProfileAchievementShowcase
            accentColor={ownerAccent.color}
            entries={showcase}
            hasError={hasShowcaseError}
            preserveOrder
          />

          {/* Ana hedef: bilinmeyen değer gelirse güvenli fallback. */}
          <View style={styles.goalChip}>
            <Text style={styles.goalText}>
              {GOAL_LABEL_KEYS[profile.trainingGoal]
                ? t(GOAL_LABEL_KEYS[profile.trainingGoal])
                : t('profile.goal')}
            </Text>
          </View>
        </View>

        {/* Arkadaşın seviyesi ve ilerlemesi. Gül bakiyesi ve ödül geçmişi
            BİLİNÇLİ olarak gösterilmez — `roseBalance` prop'u hiç verilmez ve
            `get_friend_profile` RPC'si bu alanları zaten döndürmez. Bu ekrana
            yalnızca gerçekten arkadaş olan kullanıcı erişebilir; friendship
            kontrolü RPC içinde `public.are_friends` ile yapılır. */}
        <View style={styles.levelSection}>
          <LevelProgressRing
            accentColor={ownerAccent.color}
            fillColor={ownerAccent.color}
            level={profile.level}
            message={profile.bio.trim() || undefined}
            xpForNextLevel={profile.xpForNextLevel}
            xpIntoLevel={profile.xpIntoLevel}
          />
        </View>

        {/* Paylaşılan aktif program: SEVİYE bölümünden sonra, disiplin kartından
            ÖNCE. Kendi profildekiyle AYNI ortak bileşen; salt okunur — hiçbir
            edit/start callback'i bağlanmaz. RPC veri döndürmezse (opt-out / aktif
            program yok / engel) `sharedProgram` undefined kalır ve hiç çizilmez. */}
        {sharedProgram && (
          <View style={styles.sharedProgramSection}>
            <ProfileSharedProgram accentColor={ownerAccent.color} program={sharedProgram} />
          </View>
        )}

        {/* Kendi profiliyle **aynı** kart tasarımı, ancak salt okunur:
            `readOnly` verildiği için `onDayPress` hiç bağlanmaz — gün ayrıntısı
            penceresi açılmaz ve hiçbir mutation tetiklenemez. Kart arkadaşın
            yüklenmiş durum verisini prop olarak alır; hiçbir context okumaz,
            dolayısıyla RLS/friendship kontrolleri ve Supabase sorguları
            değişmez. */}
        <View style={styles.calendarSection}>
          <ProfileDisciplineCard accentColor={ownerAccent.color} readOnly statuses={statuses} />
        </View>
        <Text style={styles.readOnlyNote}>{t('friends.calendarReadOnly')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors, ownerAccent: string) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 40 },
    centerState: { alignItems: 'center', flex: 1, gap: 10, justifyContent: 'center', paddingHorizontal: 32 },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
    emptyBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    banner: { backgroundColor: colors.surfaceMuted, height: 108, overflow: 'hidden', width: '100%' },
    bannerImage: { height: '100%', width: '100%' },
    bannerPlaceholder: { backgroundColor: colors.surfaceMuted, flex: 1 },
    header: { alignItems: 'center', gap: 4, marginTop: -28, paddingHorizontal: Layout.screenPadding },
    avatar: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.background,
      borderRadius: 32,
      borderWidth: 3,
      height: 64,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 64,
    },
    avatarImage: { height: '100%', width: '100%' },
    avatarLetter: { color: colors.textSecondary, fontSize: 24, fontWeight: '600' },
    name: {
      color: colors.text,
      fontFamily: Fonts.serif,
      fontSize: 34,
      fontWeight: '700',
      lineHeight: 40,
    },
    username: {
      color: ownerAccent,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.8,
      marginTop: 6,
      textTransform: 'uppercase',
    },
    levelIdentityRow: {
      alignItems: 'center',
      flexDirection: 'row',
      // Seviye ve rank rozeti yan yana durduğunda 8 pt boşluk kalır.
      gap: 8,
      justifyContent: 'center',
      marginTop: 10,
      width: '100%',
    },
    levelPill: {
      alignItems: 'center',
      // Arkadaşın KENDİ rengi; görüntüleyenin tercihi kullanılmaz.
      backgroundColor: withAlpha(ownerAccent, 0.14),
      borderColor: withAlpha(ownerAccent, 0.26),
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 5,
      minHeight: 28,
      paddingHorizontal: 11,
    },
    levelPillIcon: { color: ownerAccent, fontSize: 11 },
    levelPillText: { color: ownerAccent, fontSize: 11, fontWeight: '600' },
    levelSection: { marginTop: 20, paddingHorizontal: Layout.screenPadding },
    sharedProgramSection: { marginTop: 18, paddingHorizontal: Layout.screenPadding },
    calendarSection: { marginTop: 18, paddingHorizontal: Layout.screenPadding },
    readOnlyNote: {
      color: colors.textTertiary,
      fontSize: 12,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 4,
    },
    goalChip: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusPill,
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 5,
    },
    goalText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
    retryButton: { justifyContent: 'center', minHeight: Layout.minTouchSize },
    retryText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
