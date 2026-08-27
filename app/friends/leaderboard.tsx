/**
 * `/friends/leaderboard` — arkadaşlar arası sezon sıralaması.
 *
 * KAPSAM — global leaderboard YOKTUR. Liste sunucudaki
 * `get_friends_rank_leaderboard()` RPC'sinden gelir; o da yalnızca aktif
 * kullanıcıyı ve `status = 'accepted'` arkadaşlarını kapsar. Bu ekran hiçbir
 * RP, rank veya sıra HESAPLAMAZ, Supabase istemcisine dokunmaz ve sunucuya
 * kullanıcı kimliği/sezon/RP GÖNDERMEZ.
 *
 * Kök Stack'te açılır → alt sekme çubuğuna yeni sekme EKLENMEZ. Tasarım
 * mevcut arkadaşlık ailesinden gelir (`useFriendsPalette` + `FriendsMetrics`);
 * rank renkleri semantik olarak `RankBadge` üzerinden kullanılır.
 *
 * Polling, interval ve Realtime aboneliği YOKTUR: veri yalnızca ekran
 * odaklandığında ve kullanıcı listeyi aşağı çektiğinde tazelenir.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendAvatar } from '@/components/friends/friend-avatar';
import { FriendsEmptyState } from '@/components/friends/friends-empty-state';
import { FriendsMetrics, useFriendsPalette } from '@/components/friends/friends-theme';
import { MotionListItem, useListEntrance } from '@/components/motion-list-item';
import { MotionSwap } from '@/components/motion-section';
import { RankBadge, useRankName } from '@/components/ranks/rank-badge';
import { useTranslation } from '@/context/language-context';
import { useRanks } from '@/context/rank-context';
import { fetchFriendsRankLeaderboard } from '@/services/ranks';
import { FriendRankLeaderboard, FriendRankLeaderboardEntry } from '@/types/ranks';

export default function FriendsLeaderboardScreen() {
  const palette = useFriendsPalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const rankName = useRankName();
  /** Mevcut güvenli rank yenileme metodu; ikinci bir sync sistemi kurulmaz. */
  const { syncRank } = useRanks();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [board, setBoard] = useState<FriendRankLeaderboard>();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasError, setHasError] = useState(false);

  /** Yalnızca en son cevap uygulanır; eski cevap yenisini ezemez. */
  const loadIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const loadId = loadIdRef.current + 1;
      loadIdRef.current = loadId;
      setHasError(false);

      try {
        /**
         * Kendi satırının güncel olması için önce mevcut güvenli rank
         * senkronizasyonu çalıştırılır. `syncRank` tek uçuşludur, idempotenttir
         * ve hatayı kendi içinde yutar — sıralama isteği buna bağlı değildir.
         */
        await syncRank();
        const next = await fetchFriendsRankLeaderboard();
        if (!isMountedRef.current || loadIdRef.current !== loadId) return;
        setBoard(next);
      } catch {
        if (isMountedRef.current && loadIdRef.current === loadId) setHasError(true);
      } finally {
        if (isMountedRef.current && loadIdRef.current === loadId) {
          setIsLoading(false);
          if (mode === 'refresh') setIsRefreshing(false);
        }
      }
    },
    [syncRank],
  );

  useFocusEffect(
    useCallback(() => {
      isMountedRef.current = true;
      void load('initial');
      return () => {
        isMountedRef.current = false;
      };
    }, [load]),
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void load('refresh');
  }, [load]);

  /**
   * Kendi satırı listeden ÇIKARILIR ve üstte tek bir vurgulu satırda gösterilir.
   * Böylece kullanıcı listede iki kez görünmez.
   */
  const selfEntry = board?.entries.find((entry) => entry.isSelf);
  const others = useMemo(
    () => board?.entries.filter((entry) => !entry.isSelf) ?? [],
    [board],
  );
  const othersEntrance = useListEntrance(others.length);

  function openEntry(entry: FriendRankLeaderboardEntry) {
    if (entry.isSelf) {
      router.push('/rank');
      return;
    }
    router.push({ pathname: '/profile/[userId]', params: { userId: entry.userId } });
  }

  function describe(entry: FriendRankLeaderboardEntry) {
    const name = entry.displayName ?? t('friends.leaderboard.unknownUser');
    if (!entry.isRanked || entry.currentRank === undefined || entry.currentRp === undefined) {
      return t('friends.leaderboard.unrankedA11y', { name });
    }
    return t('friends.leaderboard.rankedA11y', {
      name,
      position: entry.position ?? 0,
      rank: rankName(entry.currentRank),
      rp: entry.currentRp,
    });
  }

  function renderRow(entry: FriendRankLeaderboardEntry, isLast: boolean) {
    const name = entry.displayName ?? t('friends.leaderboard.unknownUser');

    return (
      <Pressable
        accessibilityLabel={describe(entry)}
        accessibilityRole="button"
        onPress={() => openEntry(entry)}
        style={({ pressed }) => [
          styles.row,
          entry.isSelf && styles.selfRow,
          !entry.isSelf && !isLast && styles.rowDivider,
          pressed && styles.pressed,
        ]}>
        <View style={styles.positionBox}>
          <Text style={[styles.position, entry.isSelf && styles.positionSelf]}>
            {entry.isRanked ? String(entry.position) : '–'}
          </Text>
        </View>

        <FriendAvatar
          avatarUrl={entry.avatarUrl}
          displayName={name}
          id={entry.userId}
          size={FriendsMetrics.avatarSizeCompact}
        />

        <View style={styles.nameBlock}>
          <View style={styles.nameLine}>
            <Text numberOfLines={1} style={styles.name}>
              {name}
            </Text>
            {entry.isSelf && <Text style={styles.youTag}>{t('friends.leaderboard.you')}</Text>}
          </View>
          <Text numberOfLines={1} style={styles.username}>
            {entry.username ? `@${entry.username}` : t('friends.noUsername')}
          </Text>
        </View>

        <View style={styles.trailing}>
          {entry.isRanked && entry.currentRank !== undefined && entry.currentRp !== undefined ? (
            <RankBadge rankId={entry.currentRank} rp={entry.currentRp} />
          ) : (
            <Text numberOfLines={2} style={styles.unranked}>
              {t('friends.leaderboard.unranked')}
            </Text>
          )}
        </View>
      </Pressable>
    );
  }

  function renderBody() {
    if (isLoading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={palette.accent} size="large" />
          <Text style={styles.mutedLine}>{t('friends.leaderboard.loading')}</Text>
        </View>
      );
    }

    if (hasError) {
      return (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{t('friends.loadFailed')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load('initial')}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <Text style={styles.retryText}>{t('friends.retry')}</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <>
        {Boolean(selfEntry) && <View style={styles.selfBlock}>{renderRow(selfEntry!, true)}</View>}

        {others.length === 0 ? (
          <FriendsEmptyState
            buttonLabel={t('friends.findFriend')}
            description={t('friends.leaderboard.emptyBody')}
            icon="podium-outline"
            onPress={() => router.push('/friends')}
            title={t('friends.leaderboard.emptyTitle')}
          />
        ) : (
          <View style={styles.listBlock}>
            <Text style={styles.sectionLabel}>
              {t('friends.leaderboard.sectionFriends', { count: others.length })}
            </Text>
            {others.map((entry, index) => (
              <MotionListItem delay={othersEntrance.getDelay(index)} key={entry.userId}>
                {renderRow(entry, index === others.length - 1)}
              </MotionListItem>
            ))}
            {Boolean(board?.isTruncated) && (
              <Text style={styles.limitNote}>
                {t('friends.leaderboard.limitNote', {
                  shown: board?.entries.length ?? 0,
                  total: board?.participantCount ?? 0,
                })}
              </Text>
            )}
          </View>
        )}
      </>
    );
  }

  const bodyKey = isLoading
    ? 'loading'
    : hasError
      ? 'error'
      : others.length === 0
        ? 'empty'
        : 'list';

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable
          accessibilityLabel={t('common.back')}
          accessibilityRole="button"
          hitSlop={{ bottom: 10, left: 10, right: 10, top: 10 }}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/friends'))}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
          <Ionicons color={palette.text} name="chevron-back" size={26} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {t('friends.leaderboard.title')}
        </Text>
        {/* Sağda simetri için boş alan: başlık gerçekten ortalanır. */}
        <View style={styles.headerButton} />
      </View>

      {board?.seasonIndex !== undefined && (
        <Text style={styles.seasonLabel}>
          {t('ranks.seasonName', { index: board.seasonIndex })}
        </Text>
      )}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl
            colors={[palette.accent]}
            onRefresh={handleRefresh}
            refreshing={isRefreshing}
            tintColor={palette.accent}
          />
        }
        showsVerticalScrollIndicator={false}>
        <MotionSwap transitionKey={bodyKey}>{renderBody()}</MotionSwap>
      </ScrollView>
    </View>
  );
}

function createStyles(palette: ReturnType<typeof useFriendsPalette>) {
  return StyleSheet.create({
    root: { backgroundColor: palette.background, flex: 1 },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      paddingHorizontal: FriendsMetrics.screenPadding - 6,
    },
    headerButton: {
      alignItems: 'center',
      height: FriendsMetrics.headerHeight,
      justifyContent: 'center',
      width: FriendsMetrics.minTouchSize,
    },
    headerTitle: {
      color: palette.text,
      flex: 1,
      fontSize: 17,
      fontWeight: '600',
      textAlign: 'center',
    },
    seasonLabel: {
      color: palette.textTertiary,
      fontSize: 13,
      paddingHorizontal: FriendsMetrics.screenPadding,
      paddingTop: 2,
      textAlign: 'center',
    },
    content: { flexGrow: 1, paddingTop: 14 },

    selfBlock: { marginBottom: 6 },
    listBlock: { marginTop: 12 },
    sectionLabel: {
      color: palette.textTertiary,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.7,
      marginBottom: 4,
      paddingHorizontal: FriendsMetrics.screenPadding,
    },

    row: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      minHeight: FriendsMetrics.rowMinHeight,
      paddingHorizontal: FriendsMetrics.screenPadding,
    },
    /** Kendi satırı: aynı ölçüler, yalnızca yüzey ve çerçeveyle ayrılır. */
    selfRow: {
      backgroundColor: palette.card,
      borderColor: palette.border,
      borderRadius: FriendsMetrics.cardRadius,
      borderWidth: FriendsMetrics.hairline,
      marginHorizontal: FriendsMetrics.screenPadding,
      paddingHorizontal: 12,
    },
    rowDivider: {
      borderBottomColor: palette.separator,
      borderBottomWidth: FriendsMetrics.hairline,
    },
    positionBox: { alignItems: 'center', minWidth: 26 },
    position: { color: palette.textSecondary, fontSize: 15, fontWeight: '600' },
    positionSelf: { color: palette.accent },
    nameBlock: { flex: 1, gap: 2 },
    nameLine: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    name: { color: palette.text, flexShrink: 1, fontSize: 15, fontWeight: '600' },
    youTag: { color: palette.accent, fontSize: 11, fontWeight: '600' },
    username: { color: palette.textTertiary, fontSize: 13 },
    trailing: { alignItems: 'flex-end', maxWidth: 132 },
    unranked: {
      color: palette.textTertiary,
      fontSize: 11,
      lineHeight: 15,
      textAlign: 'right',
    },

    limitNote: {
      color: palette.textTertiary,
      fontSize: 11,
      lineHeight: 16,
      paddingHorizontal: FriendsMetrics.screenPadding,
      paddingTop: 12,
    },
    centerState: { alignItems: 'center', gap: 12, paddingVertical: 48 },
    mutedLine: { color: palette.textSecondary, fontSize: 13, textAlign: 'center' },
    errorBox: { gap: 6, paddingHorizontal: FriendsMetrics.screenPadding, paddingTop: 20 },
    errorText: { color: palette.danger, fontSize: 13 },
    retryButton: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 40 },
    retryText: { color: palette.accent, fontSize: 14, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
