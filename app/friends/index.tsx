import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  cancelFriendRequest,
  listFriendRequests,
  listFriends,
  removeFriend,
  respondToFriendRequest,
} from '@/services/friends';
import { FriendRequest, FriendSummary } from '@/types/friends';

export default function FriendsScreen() {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  /** Aynı satıra hızlı çift basmayı engeller. */
  const [pendingId, setPendingId] = useState<string>();
  /** Senkron kilit: aynı event döngüsündeki ikinci çağrıyı kesin engeller. */
  const pendingActionRef = useRef<string>(undefined);
  /** Focus/refocus sırasında eski `load()` cevabı yenisini ezmesin. */
  const loadIdRef = useRef(0);
  const isMountedRef = useRef(true);

  const load = useCallback(async () => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    setHasError(false);

    try {
      const [nextFriends, nextRequests] = await Promise.all([listFriends(), listFriendRequests()]);
      // Bu cevap hâlâ en güncel yüklemeye mi ait?
      if (!isMountedRef.current || loadIdRef.current !== loadId) return;
      setFriends(nextFriends);
      setRequests(nextRequests);
    } catch {
      if (isMountedRef.current && loadIdRef.current === loadId) setHasError(true);
    } finally {
      if (isMountedRef.current && loadIdRef.current === loadId) setIsLoading(false);
    }
  }, []);

  // Ekran odağa geldiğinde listeler tazelenir; unmount sonrası state yazılmaz.
  useFocusEffect(
    useCallback(() => {
      isMountedRef.current = true;
      void load();

      return () => {
        isMountedRef.current = false;
      };
    }, [load]),
  );

  async function runAction(actionId: string, action: () => Promise<void>) {
    // State asenkron olduğu için önce senkron ref kontrol edilir.
    if (pendingActionRef.current) return;
    pendingActionRef.current = actionId;

    setPendingId(actionId);
    try {
      await action();
      await load();
    } catch {
      if (isMountedRef.current) Alert.alert(t('friends.actionFailed'), t('common.networkError'));
    } finally {
      // Yalnızca hâlâ aktif olan action temizlenir.
      if (pendingActionRef.current === actionId) pendingActionRef.current = undefined;
      if (isMountedRef.current) setPendingId(undefined);
    }
  }

  function confirmRemove(friend: FriendSummary) {
    Alert.alert(t('friends.removeTitle'), t('friends.removeBody', { name: friend.displayName }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('friends.remove'),
        style: 'destructive',
        onPress: () => void runAction(friend.friendshipId, () => removeFriend(friend.friendshipId)),
      },
    ]);
  }

  const incoming = requests.filter((request) => request.direction === 'incoming');
  const outgoing = requests.filter((request) => request.direction === 'outgoing');

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.caption}>{t('friends.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/friends/search')}
          style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}>
          <Ionicons name="search" size={16} color={colors.primary} />
          <Text style={styles.searchButtonText}>{t('friends.search')}</Text>
        </Pressable>

        {hasError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t('friends.loadFailed')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryText}>{t('friends.retry')}</Text>
            </Pressable>
          </View>
        )}

        {incoming.length > 0 && (
          <Section title={t('friends.incomingRequests')} styles={styles}>
            {incoming.map((request) => (
              <PersonRow
                colors={colors}
                key={request.friendshipId}
                person={request}
                styles={styles}
                t={t}>
                <Pressable
                  accessibilityLabel={t('friends.accept')}
                  accessibilityRole="button"
                  disabled={pendingId !== undefined}
                  onPress={() =>
                    void runAction(request.friendshipId, () =>
                      respondToFriendRequest(request.friendshipId, true),
                    )
                  }
                  style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
                  <Text style={styles.acceptText}>{t('friends.accept')}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={t('friends.decline')}
                  accessibilityRole="button"
                  disabled={pendingId !== undefined}
                  onPress={() =>
                    void runAction(request.friendshipId, () =>
                      respondToFriendRequest(request.friendshipId, false),
                    )
                  }
                  style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
                  <Text style={styles.dangerText}>{t('friends.decline')}</Text>
                </Pressable>
              </PersonRow>
            ))}
          </Section>
        )}

        {outgoing.length > 0 && (
          <Section title={t('friends.outgoingRequests')} styles={styles}>
            {outgoing.map((request) => (
              <PersonRow
                colors={colors}
                key={request.friendshipId}
                person={request}
                styles={styles}
                t={t}>
                <Pressable
                  accessibilityLabel={t('friends.cancel')}
                  accessibilityRole="button"
                  disabled={pendingId !== undefined}
                  onPress={() =>
                    void runAction(request.friendshipId, () => cancelFriendRequest(request.friendshipId))
                  }
                  style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
                  <Text style={styles.mutedActionText}>{t('friends.cancel')}</Text>
                </Pressable>
              </PersonRow>
            ))}
          </Section>
        )}

        <Section title={t('friends.friendsList')} styles={styles}>
          {friends.length === 0 ? (
            <Text style={styles.emptyText}>{t('friends.noFriends')}</Text>
          ) : (
            friends.map((friend) => (
              <PersonRow
                colors={colors}
                key={friend.friendshipId}
                onPress={() => router.push({ pathname: '/profile/[userId]', params: { userId: friend.id } })}
                person={friend}
                styles={styles}
                t={t}>
                <Pressable
                  accessibilityLabel={t('friends.remove')}
                  accessibilityRole="button"
                  disabled={pendingId !== undefined}
                  hitSlop={8}
                  onPress={() => confirmRemove(friend)}
                  style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
                  <Ionicons name="person-remove-outline" size={18} color={colors.danger} />
                </Pressable>
              </PersonRow>
            ))
          )}
        </Section>

        {incoming.length === 0 && outgoing.length === 0 && (
          <Text style={styles.emptyText}>{t('friends.noRequests')}</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  children,
  styles,
  title,
}: {
  children: React.ReactNode;
  styles: ReturnType<typeof createStyles>;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function PersonRow({
  children,
  colors,
  onPress,
  person,
  styles,
  t,
}: {
  children?: React.ReactNode;
  colors: ThemeColors;
  onPress?: () => void;
  person: { avatarUrl?: string; displayName: string; username?: string };
  styles: ReturnType<typeof createStyles>;
  t: (key: string) => string;
}) {
  const initial = person.displayName.trim().charAt(0).toLocaleUpperCase('tr-TR') || '?';

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [styles.rowMain, pressed && onPress && styles.pressed]}>
        <View style={styles.avatar}>
          {person.avatarUrl ? (
            <Image autoplay contentFit="cover" source={{ uri: person.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarLetter}>{initial}</Text>
          )}
        </View>
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={styles.rowName}>
            {person.displayName}
          </Text>
          <Text numberOfLines={1} style={styles.rowUsername}>
            {person.username ? `@${person.username}` : t('friends.noUsername')}
          </Text>
        </View>
      </Pressable>
      <View style={styles.rowActions}>{children}</View>
      <Ionicons name="chevron-forward" size={14} color={onPress ? colors.textTertiary : 'transparent'} />
    </View>
  );
}

export function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 40, paddingTop: 8 },
    centerState: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center' },
    caption: { color: colors.textSecondary, fontSize: 13 },
    searchButton: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 8,
      marginHorizontal: Layout.screenPadding,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 14,
    },
    searchButtonText: { color: colors.primary, fontSize: 15, fontWeight: '500' },
    section: { marginTop: 26 },
    sectionTitle: {
      color: colors.textTertiary,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.6,
      marginBottom: 8,
      paddingHorizontal: Layout.screenPadding,
      textTransform: 'uppercase',
    },
    row: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 8,
      minHeight: 60,
      paddingHorizontal: Layout.screenPadding,
    },
    rowMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12, minHeight: Layout.minTouchSize },
    avatar: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 18,
      height: 36,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 36,
    },
    avatarImage: { height: '100%', width: '100%' },
    avatarLetter: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
    rowText: { flex: 1, gap: 2 },
    rowName: { color: colors.text, fontSize: 15, fontWeight: '500' },
    rowUsername: { color: colors.textTertiary, fontSize: 12 },
    rowActions: { alignItems: 'center', flexDirection: 'row', gap: 4 },
    actionButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      minWidth: Layout.minTouchSize,
      paddingHorizontal: 6,
    },
    acceptText: { color: colors.disciplineCompleted, fontSize: 14, fontWeight: '600' },
    dangerText: { color: colors.danger, fontSize: 14, fontWeight: '500' },
    mutedActionText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      paddingHorizontal: Layout.screenPadding,
      paddingVertical: 12,
    },
    errorBox: { gap: 8, paddingHorizontal: Layout.screenPadding, paddingTop: 20 },
    errorText: { color: colors.danger, fontSize: 13 },
    retryButton: { alignSelf: 'flex-start', minHeight: Layout.minTouchSize, justifyContent: 'center' },
    retryText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
