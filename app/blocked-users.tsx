import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendPersonRow } from '@/components/friends/friend-person-row';
import { FriendsMetrics, FriendsPalette, useFriendsPalette } from '@/components/friends/friends-theme';
import { useTranslation } from '@/context/language-context';
import { listBlockedUsers, unblockUser } from '@/services/safety';
import { BlockedUser } from '@/types/safety';

type ScreenState = 'loading' | 'ready' | 'error';

export default function BlockedUsersScreen() {
  const palette = useFriendsPalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [pendingId, setPendingId] = useState<string | undefined>(undefined);
  const loadIdRef = useRef(0);
  const pendingRef = useRef<string | undefined>(undefined);
  const isMountedRef = useRef(true);

  const load = useCallback(async () => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    try {
      const next = await listBlockedUsers();
      if (!isMountedRef.current || loadIdRef.current !== loadId) return;
      setUsers(next);
      setScreenState('ready');
    } catch {
      if (isMountedRef.current && loadIdRef.current === loadId) setScreenState('error');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      isMountedRef.current = true;
      void load();
      return () => {
        isMountedRef.current = false;
        loadIdRef.current += 1;
      };
    }, [load]),
  );

  function confirmUnblock(user: BlockedUser) {
    Alert.alert(
      t('safety.unblockTitle'),
      t('safety.unblockBody', { name: user.displayName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('safety.unblock'),
          onPress: async () => {
            if (pendingRef.current) return;
            pendingRef.current = user.id;
            setPendingId(user.id);
            try {
              await unblockUser(user.id);
              if (isMountedRef.current) {
                setUsers((current) => current.filter((item) => item.id !== user.id));
              }
            } catch {
              if (isMountedRef.current) {
                Alert.alert(t('safety.actionFailed'), t('common.networkError'));
              }
            } finally {
              if (pendingRef.current === user.id) pendingRef.current = undefined;
              if (isMountedRef.current) setPendingId(undefined);
            }
          },
        },
      ],
    );
  }

  function renderBody() {
    if (screenState === 'loading') {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={palette.accent} />
          <Text style={styles.stateText}>{t('safety.blockedLoading')}</Text>
        </View>
      );
    }

    if (screenState === 'error') {
      return (
        <View style={styles.centerState}>
          <Ionicons color={palette.textTertiary} name="alert-circle-outline" size={30} />
          <Text style={styles.stateText}>{t('safety.blockedFailed')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setScreenState('loading');
              void load();
            }}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
            <Text style={styles.retryText}>{t('messages.retry')}</Text>
          </Pressable>
        </View>
      );
    }

    if (users.length === 0) {
      return (
        <View style={styles.centerState}>
          <View style={styles.emptyIcon}>
            <Ionicons color={palette.textSecondary} name="ban-outline" size={24} />
          </View>
          <Text style={styles.stateTitle}>{t('safety.noBlockedTitle')}</Text>
          <Text style={styles.stateText}>{t('safety.noBlockedBody')}</Text>
        </View>
      );
    }

    return (
      <View style={styles.list}>
        {users.map((user, index) => (
          <FriendPersonRow
            actions={
              <Pressable
                accessibilityLabel={t('safety.unblock')}
                accessibilityRole="button"
                disabled={pendingId !== undefined}
                onPress={() => confirmUnblock(user)}
                style={({ pressed }) => [styles.unblockButton, pressed && styles.pressed]}>
                {pendingId === user.id ? (
                  <ActivityIndicator color={palette.text} size="small" />
                ) : (
                  <Text style={styles.unblockText}>{t('safety.unblock')}</Text>
                )}
              </Pressable>
            }
            isLast={index === users.length - 1}
            key={user.id}
            person={user}
            usernameFallback={t('friends.noUsername')}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable
          accessibilityLabel={t('common.back')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
          <Ionicons color={palette.text} name="chevron-back" size={26} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {t('safety.blockedUsers')}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.explanation}>{t('safety.blockedUsersCaption')}</Text>
        {renderBody()}
      </ScrollView>
    </View>
  );
}

function createStyles(palette: FriendsPalette) {
  return StyleSheet.create({
    root: { backgroundColor: palette.background, flex: 1 },
    header: {
      alignItems: 'center',
      borderBottomColor: palette.separator,
      borderBottomWidth: FriendsMetrics.hairline,
      flexDirection: 'row',
      paddingHorizontal: FriendsMetrics.screenPadding,
    },
    headerButton: {
      alignItems: 'center',
      height: FriendsMetrics.minTouchSize,
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
    content: { paddingBottom: 32, paddingTop: 16 },
    explanation: {
      color: palette.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      paddingBottom: 16,
      paddingHorizontal: FriendsMetrics.screenPadding,
    },
    list: { borderTopColor: palette.separator, borderTopWidth: FriendsMetrics.hairline },
    centerState: { alignItems: 'center', gap: 8, paddingHorizontal: 32, paddingTop: 56 },
    stateTitle: { color: palette.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
    stateText: { color: palette.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
    emptyIcon: {
      alignItems: 'center',
      backgroundColor: palette.field,
      borderRadius: 22,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    unblockButton: {
      alignItems: 'center',
      borderColor: palette.border,
      borderRadius: FriendsMetrics.pillRadius,
      borderWidth: FriendsMetrics.hairline,
      justifyContent: 'center',
      minHeight: FriendsMetrics.minTouchSize,
      minWidth: 88,
      paddingHorizontal: 12,
    },
    unblockText: { color: palette.text, fontSize: 13, fontWeight: '600' },
    retry: { justifyContent: 'center', minHeight: FriendsMetrics.minTouchSize, paddingHorizontal: 16 },
    retryText: { color: palette.accent, fontSize: 14, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
