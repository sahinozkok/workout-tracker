import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileDisciplineCard } from '@/components/profile-discipline-card';
import { Layout, ThemeColors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getFriendDisciplineDays, getFriendProfile } from '@/services/friends';
import { FriendProfile } from '@/types/friends';
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

export default function FriendProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { user } = useAuth();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const isOwnProfile = Boolean(userId) && userId === user?.id;

  // Kendi kimliğiyle açılırsa "erişim yok" göstermek yerine Profil sekmesine
  // yönlendirilir. Yalnızca auth kullanıcı kimliği okunur.
  useEffect(() => {
    if (isOwnProfile) router.replace('/profile');
  }, [isOwnProfile]);

  const [profile, setProfile] = useState<FriendProfile>();
  const [statuses, setStatuses] = useState<Record<string, DisciplineStatus>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const isMountedRef = useRef(true);

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
          <Text style={styles.name}>{profile.displayName}</Text>
          <Text style={styles.username}>
            {profile.username ? `@${profile.username}` : t('friends.noUsername')}
          </Text>
          {profile.bio.trim().length > 0 && <Text style={styles.bio}>{profile.bio}</Text>}

          {/* Ana hedef: bilinmeyen değer gelirse güvenli fallback. */}
          <View style={styles.goalChip}>
            <Text style={styles.goalText}>
              {GOAL_LABEL_KEYS[profile.trainingGoal]
                ? t(GOAL_LABEL_KEYS[profile.trainingGoal])
                : t('profile.goal')}
            </Text>
          </View>
        </View>

        {/* Kendi profiliyle **aynı** kart tasarımı, ancak salt okunur:
            `readOnly` verildiği için `onDayPress` hiç bağlanmaz — gün ayrıntısı
            penceresi açılmaz ve hiçbir mutation tetiklenemez. Kart arkadaşın
            yüklenmiş durum verisini prop olarak alır; hiçbir context okumaz,
            dolayısıyla RLS/friendship kontrolleri ve Supabase sorguları
            değişmez. */}
        <View style={styles.calendarSection}>
          <ProfileDisciplineCard readOnly statuses={statuses} />
        </View>
        <Text style={styles.readOnlyNote}>{t('friends.calendarReadOnly')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
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
    name: { color: colors.text, fontSize: 18, fontWeight: '600', marginTop: 6 },
    username: { color: colors.textTertiary, fontSize: 13 },
    bio: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: 'center' },
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
