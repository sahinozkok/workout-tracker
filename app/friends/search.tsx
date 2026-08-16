import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Layout } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { createStyles, PersonRow } from '@/app/friends/index';
import {
  FRIEND_SEARCH_MAX_LENGTH,
  FRIEND_SEARCH_MIN_LENGTH,
  searchProfiles,
  sendFriendRequest,
} from '@/services/friends';
import { FriendSearchResult } from '@/types/friends';

const SEARCH_DEBOUNCE_MS = 350;

export default function FriendSearchScreen() {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const localStyles = createLocalStyles(colors);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FriendSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [pendingId, setPendingId] = useState<string>();
  const [retryVersion, setRetryVersion] = useState(0);
  /** Senkron kilit: aynı event döngüsündeki ikinci çağrıyı kesin engeller. */
  const pendingActionRef = useRef<string>(undefined);
  /** Yalnızca en son sorgunun cevabı uygulanır; eski cevap yenisini ezmez. */
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const trimmed = query.trim();

  useEffect(() => {
    // Generation, uzunluk kontrolünden ÖNCE artar: kullanıcı alanı temizlerse
    // uçuştaki eski cevap da geçersiz olur ve ekrana yazamaz.
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (trimmed.length < FRIEND_SEARCH_MIN_LENGTH) {
      setResults([]);
      setIsSearching(false);
      setHasError(false);
      return;
    }

    setIsSearching(true);
    setHasError(false);

    const timer = setTimeout(async () => {
      try {
        const next = await searchProfiles(trimmed);
        // Bu cevap hâlâ en güncel sorguya mı ait?
        if (!isMountedRef.current || requestIdRef.current !== requestId) return;
        setResults(next);
      } catch {
        if (isMountedRef.current && requestIdRef.current === requestId) setHasError(true);
      } finally {
        if (isMountedRef.current && requestIdRef.current === requestId) setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [retryVersion, trimmed]);

  // Aynı string state'i yeniden render tetiklemediği için ayrı bir sürüm
  // sayacı kullanılır; retry gerçekten yeni bir sorgu çalıştırır.
  const rerun = useCallback(() => setRetryVersion((current) => current + 1), []);

  async function handleAdd(person: FriendSearchResult) {
    // State asenkron olduğu için önce senkron ref kontrol edilir.
    if (pendingActionRef.current) return;
    pendingActionRef.current = person.id;

    setPendingId(person.id);
    try {
      await sendFriendRequest(person.id);
      if (!isMountedRef.current) return;
      // Satır durumunu yerel olarak güncelle: buton anında "gönderildi" olur.
      setResults((current) =>
        current.map((item) =>
          item.id === person.id
            ? { ...item, friendshipDirection: 'outgoing', friendshipStatus: 'pending' }
            : item,
        ),
      );
    } catch {
      if (isMountedRef.current) Alert.alert(t('friends.actionFailed'), t('common.networkError'));
    } finally {
      // Yalnızca hâlâ aktif olan action temizlenir.
      if (pendingActionRef.current === person.id) pendingActionRef.current = undefined;
      if (isMountedRef.current) setPendingId(undefined);
    }
  }

  function renderAction(person: FriendSearchResult) {
    if (person.friendshipStatus === 'accepted') {
      return <Text style={localStyles.stateText}>{t('friends.accepted')}</Text>;
    }

    if (person.friendshipStatus === 'pending') {
      return (
        <Text style={localStyles.stateText}>
          {person.friendshipDirection === 'outgoing' ? t('friends.sent') : t('friends.pending')}
        </Text>
      );
    }

    return (
      <Pressable
        accessibilityLabel={t('friends.add')}
        accessibilityRole="button"
        disabled={pendingId !== undefined}
        onPress={() => void handleAdd(person)}
        style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}>
        {pendingId === person.id ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Text style={localStyles.addText}>{t('friends.add')}</Text>
        )}
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={localStyles.searchField}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onChangeText={setQuery}
          placeholder={t('friends.searchPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          maxLength={FRIEND_SEARCH_MAX_LENGTH}
          returnKeyType="search"
          style={localStyles.input}
          value={query}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {trimmed.length < FRIEND_SEARCH_MIN_LENGTH ? (
          <Text style={styles.emptyText}>{t('friends.searchHint')}</Text>
        ) : hasError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t('friends.loadFailed')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={rerun}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryText}>{t('friends.retry')}</Text>
            </Pressable>
          </View>
        ) : isSearching ? (
          <View style={localStyles.searchingRow}>
            <ActivityIndicator color={colors.textSecondary} size="small" />
          </View>
        ) : results.length === 0 ? (
          <Text style={styles.emptyText}>{t('friends.searchNoResults')}</Text>
        ) : (
          results.map((person) => (
            <PersonRow
              colors={colors}
              key={person.id}
              onPress={
                person.friendshipStatus === 'accepted'
                  ? () => router.push({ pathname: '/profile/[userId]', params: { userId: person.id } })
                  : undefined
              }
              person={person}
              styles={styles}
              t={t}>
              {renderAction(person)}
            </PersonRow>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createLocalStyles(colors: ReturnType<typeof useAppTheme>['colors']) {
  return StyleSheet.create({
    searchField: {
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingBottom: 12,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 8,
    },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusMedium,
      color: colors.text,
      fontSize: 15,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 14,
    },
    searchingRow: { alignItems: 'center', paddingVertical: 28 },
    addText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    stateText: { color: colors.textTertiary, fontSize: 13, paddingHorizontal: 6 },
  });
}
