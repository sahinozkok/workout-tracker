/**
 * Arkadaşlık ana ekranı — referans tasarımın tek uygulaması.
 *
 * `/friends` ve `/friends/search` rotalarının **ikisi de** bu bileşeni render
 * eder; tek fark aramanın otomatik odaklanmasıdır. Böylece kullanıcı arama
 * yapmak için görsel olarak farklı bir sayfaya atılmaz, ama mevcut
 * `/friends/search` yolu da kırılmaz.
 *
 * Veri erişimi tamamen `services/friends.ts` üzerindendir; bu dosya Supabase
 * istemcisine hiç dokunmaz. Mevcut yarış (loadId/requestId) ve çift dokunma
 * (pendingActionRef) korumaları olduğu gibi taşınmıştır.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendPersonRow } from '@/components/friends/friend-person-row';
import { FriendsEmptyState } from '@/components/friends/friends-empty-state';
import { FriendsTabs, FriendsTabKey } from '@/components/friends/friends-tabs';
import { FriendsMetrics, useFriendsPalette } from '@/components/friends/friends-theme';
import { MotionListItem, useListEntrance } from '@/components/motion-list-item';
import { MotionSwap } from '@/components/motion-section';
import { useTranslation } from '@/context/language-context';
import {
  cancelFriendRequest,
  FRIEND_SEARCH_MAX_LENGTH,
  FRIEND_SEARCH_MIN_LENGTH,
  listFriendRequests,
  listFriends,
  removeFriend,
  respondToFriendRequest,
  searchProfiles,
  sendFriendRequest,
} from '@/services/friends';
import { FriendRequest, FriendSearchResult, FriendSummary } from '@/types/friends';

const SEARCH_DEBOUNCE_MS = 350;

type FriendsScreenProps = {
  /** `/friends/search` yolundan açıldığında arama alanı hazır odaklanır. */
  autoFocusSearch?: boolean;
};

export function FriendsScreen({ autoFocusSearch = false }: FriendsScreenProps) {
  const palette = useFriendsPalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [selectedTab, setSelectedTab] = useState<FriendsTabKey>('friends');
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [pendingId, setPendingId] = useState<string>();

  const [query, setQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [results, setResults] = useState<FriendSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearchError, setHasSearchError] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);

  /** Senkron kilit: aynı event döngüsündeki ikinci çağrıyı kesin engeller. */
  const pendingActionRef = useRef<string>(undefined);
  /** Yalnızca en son listeleme cevabı uygulanır; eski cevap yenisini ezmez. */
  const loadIdRef = useRef(0);
  /** Aynı koruma arama için; eski sorgunun cevabı yenisini ezemez. */
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const searchInputRef = useRef<TextInput>(null);

  const trimmed = query.trim();
  const isSearchActive = trimmed.length >= FRIEND_SEARCH_MIN_LENGTH;

  const load = useCallback(async () => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    setHasError(false);
    try {
      const [nextFriends, nextRequests] = await Promise.all([listFriends(), listFriendRequests()]);
      if (!isMountedRef.current || loadIdRef.current !== loadId) return;
      setFriends(nextFriends);
      setRequests(nextRequests);
    } catch {
      if (isMountedRef.current && loadIdRef.current === loadId) setHasError(true);
    } finally {
      if (isMountedRef.current && loadIdRef.current === loadId) setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      isMountedRef.current = true;
      void load();
      return () => {
        isMountedRef.current = false;
      };
    }, [load]),
  );

  // Arama: en az iki karakter + debounce + yarış koruması.
  useEffect(() => {
    // Generation, uzunluk kontrolünden ÖNCE artar: kullanıcı alanı temizlerse
    // uçuştaki eski cevap da geçersiz olur ve ekrana yazamaz.
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (trimmed.length < FRIEND_SEARCH_MIN_LENGTH) {
      setResults([]);
      setIsSearching(false);
      setHasSearchError(false);
      return;
    }

    setIsSearching(true);
    setHasSearchError(false);

    const timer = setTimeout(async () => {
      try {
        const next = await searchProfiles(trimmed);
        if (!isMountedRef.current || requestIdRef.current !== requestId) return;
        setResults(next);
      } catch {
        if (isMountedRef.current && requestIdRef.current === requestId) setHasSearchError(true);
      } finally {
        if (isMountedRef.current && requestIdRef.current === requestId) setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [retryVersion, trimmed]);

  // Aynı string state'i yeniden render tetiklemediği için ayrı bir sürüm
  // sayacı kullanılır; retry gerçekten yeni bir sorgu çalıştırır.
  const rerunSearch = useCallback(() => setRetryVersion((current) => current + 1), []);

  const focusSearch = useCallback(() => searchInputRef.current?.focus(), []);

  async function runAction(actionId: string, action: () => Promise<void>) {
    if (pendingActionRef.current) return;
    pendingActionRef.current = actionId;
    setPendingId(actionId);
    try {
      await action();
      await load();
      // Açık bir arama varsa sonuç satırlarının durumu da backend'den tazelenir.
      if (isMountedRef.current && isSearchActive) rerunSearch();
    } catch {
      if (isMountedRef.current) Alert.alert(t('friends.actionFailed'), t('common.networkError'));
    } finally {
      if (pendingActionRef.current === actionId) pendingActionRef.current = undefined;
      if (isMountedRef.current) setPendingId(undefined);
    }
  }

  async function handleAdd(person: FriendSearchResult) {
    // State asenkron olduğu için önce senkron ref kontrol edilir.
    if (pendingActionRef.current) return;
    pendingActionRef.current = person.id;
    setPendingId(person.id);
    try {
      await sendFriendRequest(person.id);
      if (!isMountedRef.current) return;
      // Satır durumunu yerel olarak güncelle: buton anında "Gönderildi" olur.
      setResults((current) =>
        current.map((item) =>
          item.id === person.id
            ? { ...item, friendshipDirection: 'outgoing', friendshipStatus: 'pending' }
            : item,
        ),
      );
      // Gönderilen istekler sekmesi ve badge gerçek backend sonucuyla tazelenir.
      await load();
    } catch {
      if (isMountedRef.current) Alert.alert(t('friends.actionFailed'), t('common.networkError'));
    } finally {
      if (pendingActionRef.current === person.id) pendingActionRef.current = undefined;
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

  /** Başlıktaki üç nokta: yalnızca gerçekten var olan eylemleri sunar. */
  function openScreenMenu() {
    Alert.alert(t('friends.moreActions'), undefined, [
      { text: t('friends.refresh'), onPress: () => void load() },
      { text: t('friends.findFriend'), onPress: focusSearch },
      // Mesajlar kök Stack'te ayrı bir ekrandır; mevcut üç sekmeye dördüncü
      // bir sekme SIKIŞTIRILMAZ.
      { text: t('messages.menuAction'), onPress: () => router.push('/messages') },
      // Sezon sıralaması kök Stack'te ayrı bir ekrandır; mevcut üç sekmeye
      // dördüncü bir sekme SIKIŞTIRILMAZ.
      {
        text: t('friends.leaderboard.menuAction'),
        onPress: () => router.push('/friends/leaderboard'),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  const incoming = requests.filter((request) => request.direction === 'incoming');
  const outgoing = requests.filter((request) => request.direction === 'outgoing');
  const isBusy = pendingId !== undefined;

  /**
   * Her liste kendi "ilk gerçek yükleme"sini ayrı takip eder: arkadaşlar
   * dolarken gelen istekler hâlâ boş olabilir. Sonraki tazelemelerde satırlar
   * unmount olmadığı için hiçbir giriş tekrar oynamaz.
   */
  const friendsEntrance = useListEntrance(friends.length);
  const incomingEntrance = useListEntrance(incoming.length);
  const outgoingEntrance = useListEntrance(outgoing.length);
  const resultsEntrance = useListEntrance(results.length);

  function goToProfile(userId: string) {
    router.push({ pathname: '/profile/[userId]', params: { userId } });
  }

  function renderSearchAction(person: FriendSearchResult) {
    if (person.friendshipStatus === 'accepted') {
      return <Text style={styles.stateText}>{t('friends.accepted')}</Text>;
    }

    // Gelen bekleyen istek varsa "Ekle" gösterilmez: ikinci bir istek gitmez.
    if (person.friendshipStatus === 'pending') {
      return (
        <Text style={styles.stateText}>
          {person.friendshipDirection === 'outgoing' ? t('friends.sent') : t('friends.pending')}
        </Text>
      );
    }

    return (
      <Pressable
        accessibilityLabel={t('friends.add')}
        accessibilityRole="button"
        disabled={isBusy}
        onPress={() => void handleAdd(person)}
        style={({ pressed }) => [styles.accentPill, pressed && styles.pressed]}>
        {pendingId === person.id ? (
          <ActivityIndicator color={palette.onAccent} size="small" />
        ) : (
          <Text style={styles.accentPillText}>{t('friends.add')}</Text>
        )}
      </Pressable>
    );
  }

  function renderSearchBlock() {
    // Kullanıcı yazmaya başladı ama henüz iki karaktere ulaşmadıysa neden
    // sonuç gelmediği açıkça söylenir; hiç yazılmadıysa referanstaki gibi
    // arama alanının altında hiçbir şey görünmez.
    if (!isSearchActive) {
      return trimmed.length > 0 ? <Text style={styles.mutedLine}>{t('friends.searchHint')}</Text> : null;
    }

    if (hasSearchError) {
      return (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{t('friends.loadFailed')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={rerunSearch}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <Text style={styles.retryText}>{t('friends.retry')}</Text>
          </Pressable>
        </View>
      );
    }

    if (isSearching) {
      return (
        <View style={styles.searchingRow}>
          <ActivityIndicator color={palette.textSecondary} size="small" />
        </View>
      );
    }

    if (results.length === 0) {
      return <Text style={styles.mutedLine}>{t('friends.searchNoResults')}</Text>;
    }

    return (
      <View style={styles.resultsBlock}>
        <Text style={styles.sectionLabel}>{t('friends.sectionSuggestions')}</Text>
        <View style={styles.resultsList}>
          {/*
            Arama sonuçları her tuşta yeniden mount oluyor (yükleniyor
            göstergesi araya giriyor). Bu yüzden giriş animasyonu YALNIZCA ilk
            sonuç partisinde açık; sonrasında kapatılır, yoksa her karakterde
            bütün liste yeniden belirirdi.
          */}
          {results.map((person, index) => (
            <MotionListItem
              delay={resultsEntrance.getDelay(index)}
              disableEntering={!resultsEntrance.isFirstBatch}
              key={person.id}>
              <FriendPersonRow
                actions={renderSearchAction(person)}
                avatarSize={FriendsMetrics.avatarSizeCompact}
                card
                onPress={
                  person.friendshipStatus === 'accepted' ? () => goToProfile(person.id) : undefined
                }
                person={person}
                usernameFallback={t('friends.noUsername')}
              />
            </MotionListItem>
          ))}
        </View>
      </View>
    );
  }

  function renderTabContent() {
    if (isLoading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={palette.accent} size="large" />
          <Text style={styles.mutedLine}>{t('friends.loading')}</Text>
        </View>
      );
    }

    if (selectedTab === 'friends') {
      if (friends.length === 0) {
        return (
          <FriendsEmptyState
            buttonLabel={t('friends.findFriend')}
            description={t('friends.noFriendsBody')}
            icon="people"
            onPress={focusSearch}
            title={t('friends.noFriendsTitle')}
          />
        );
      }

      return (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {t('friends.sectionFriends', { count: friends.length })}
          </Text>
          {friends.map((friend, index) => (
            <MotionListItem delay={friendsEntrance.getDelay(index)} key={friend.friendshipId}>
              <FriendPersonRow
                actions={
                  <>
                    {/* Sohbet YALNIZCA gerçekten kabul edilmiş arkadaşta
                        görünür: arama sonuçları, istekler ve öneriler bu
                        butonu almaz. */}
                    <Pressable
                      accessibilityLabel={t('messages.openChat', { name: friend.displayName })}
                      accessibilityRole="button"
                      /* 36 pt genişlik + 8 pt sol hitSlop = 44 pt; yükseklik
                         zaten 44 pt. Üç noktanın hitSlop'una taşmaz. */
                      hitSlop={{ bottom: 0, left: 8, right: 0, top: 0 }}
                      onPress={() =>
                        router.push({
                          pathname: '/messages/[userId]',
                          params: { userId: friend.id },
                        })
                      }
                      style={({ pressed }) => [styles.messageButton, pressed && styles.pressed]}>
                      <Ionicons
                        color={palette.textSecondary}
                        name="chatbubble-outline"
                        size={18}
                      />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={t('friends.remove')}
                      accessibilityRole="button"
                      disabled={isBusy}
                      hitSlop={{ bottom: 10, left: 10, right: 6, top: 10 }}
                      onPress={() => confirmRemove(friend)}
                      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                      <Ionicons color={palette.textSecondary} name="ellipsis-vertical" size={18} />
                    </Pressable>
                  </>
                }
                isLast={index === friends.length - 1}
                onPress={() => goToProfile(friend.id)}
                person={friend}
                usernameFallback={t('friends.noUsername')}
              />
            </MotionListItem>
          ))}
        </View>
      );
    }

    if (selectedTab === 'requests') {
      if (incoming.length === 0 && outgoing.length === 0) {
        return (
          <FriendsEmptyState
            description={t('friends.noRequestsBody')}
            icon="mail-open-outline"
            title={t('friends.noRequests')}
          />
        );
      }

      return (
        <>
          {incoming.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('friends.sectionIncoming')}</Text>
              {incoming.map((request, index) => (
                <MotionListItem
                  delay={incomingEntrance.getDelay(index)}
                  key={request.friendshipId}>
                  <FriendPersonRow
                    actions={
                      <>
                        <Pressable
                          accessibilityRole="button"
                          disabled={isBusy}
                          onPress={() =>
                            void runAction(request.friendshipId, () =>
                              respondToFriendRequest(request.friendshipId, true),
                            )
                          }
                          style={({ pressed }) => [styles.accentPill, pressed && styles.pressed]}>
                          <Text style={styles.accentPillText}>{t('friends.accept')}</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          disabled={isBusy}
                          onPress={() =>
                            void runAction(request.friendshipId, () =>
                              respondToFriendRequest(request.friendshipId, false),
                            )
                          }
                          style={({ pressed }) => [styles.outlinePill, pressed && styles.pressed]}>
                          <Text style={styles.outlinePillText}>{t('friends.decline')}</Text>
                        </Pressable>
                      </>
                    }
                    isLast={index === incoming.length - 1}
                    person={request}
                    usernameFallback={t('friends.noUsername')}
                  />
                </MotionListItem>
              ))}
            </View>
          )}

          {outgoing.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('friends.sectionOutgoing')}</Text>
              {outgoing.map((request, index) => (
                <MotionListItem
                  delay={outgoingEntrance.getDelay(index)}
                  key={request.friendshipId}>
                  <FriendPersonRow
                    actions={
                      <Pressable
                        accessibilityRole="button"
                        disabled={isBusy}
                        onPress={() =>
                          void runAction(request.friendshipId, () =>
                            cancelFriendRequest(request.friendshipId),
                          )
                        }
                        style={({ pressed }) => [styles.outlinePill, pressed && styles.pressed]}>
                        <Text style={styles.outlinePillText}>{t('friends.cancel')}</Text>
                      </Pressable>
                    }
                    isLast={index === outgoing.length - 1}
                    person={request}
                    usernameFallback={t('friends.noUsername')}
                  />
                </MotionListItem>
              ))}
            </View>
          )}
        </>
      );
    }

    // Öneriler: backend'de otomatik öneri sistemi yok, sahte kullanıcı
    // üretilmez. Referans boş durumu korunur ve buton aramaya odaklanır.
    return (
      <FriendsEmptyState
        buttonLabel={t('friends.findFriend')}
        description={t('friends.suggestionsBody')}
        icon="person-add-outline"
        onPress={focusSearch}
        title={t('friends.suggestionsTitle')}
      />
    );
  }

  const isSearchHighlighted = isSearchFocused || query.length > 0;

  /**
   * Sekme içeriğinin crossfade anahtarı.
   *
   * BİLİNÇLİ olarak yalnızca "yükleniyor / boş / dolu" ayrımını taşır. Satır
   * SAYISINI taşımaz: bir istek kabul edilince liste dolu kalıyorsa yalnızca o
   * satır çıkar, bütün blok yeniden belirmez.
   */
  const tabContentKey = isLoading
    ? 'loading'
    : selectedTab === 'friends'
      ? `friends:${friends.length === 0 ? 'empty' : 'list'}`
      : selectedTab === 'requests'
        ? `requests:${incoming.length === 0 && outgoing.length === 0 ? 'empty' : 'list'}`
        : 'suggestions';

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable
          accessibilityLabel={t('common.back')}
          accessibilityRole="button"
          hitSlop={{ bottom: 10, left: 10, right: 10, top: 10 }}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
          <Ionicons color={palette.text} name="chevron-back" size={26} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {t('friends.title')}
        </Text>
        <Pressable
          accessibilityLabel={t('friends.moreActions')}
          accessibilityRole="button"
          hitSlop={{ bottom: 10, left: 10, right: 10, top: 10 }}
          onPress={openScreenMenu}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
          <Ionicons color={palette.text} name="ellipsis-vertical" size={20} />
        </Pressable>
      </View>

      <View style={[styles.searchField, isSearchHighlighted && styles.searchFieldActive]}>
        <Ionicons color={palette.textSecondary} name="search" size={18} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocusSearch}
          maxLength={FRIEND_SEARCH_MAX_LENGTH}
          onBlur={() => setIsSearchFocused(false)}
          onChangeText={setQuery}
          onFocus={() => setIsSearchFocused(true)}
          placeholder={t('friends.searchPlaceholder')}
          placeholderTextColor={palette.textTertiary}
          ref={searchInputRef}
          returnKeyType="search"
          style={styles.searchInput}
          value={query}
        />
        {query.length > 0 && (
          <Pressable
            accessibilityLabel={t('common.cancel')}
            accessibilityRole="button"
            hitSlop={{ bottom: 10, left: 10, right: 10, top: 10 }}
            onPress={() => setQuery('')}>
            <Ionicons color={palette.textTertiary} name="close-circle" size={17} />
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {renderSearchBlock()}

        <FriendsTabs
          items={[
            { badge: requests.length, key: 'requests', label: t('friends.requestsTab') },
            { key: 'friends', label: t('friends.friendsTab') },
            { key: 'suggestions', label: t('friends.suggestionsTab') },
          ]}
          onSelect={setSelectedTab}
          selected={selectedTab}
        />

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

        <MotionSwap transitionKey={tabContentKey}>{renderTabContent()}</MotionSwap>
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
    // Başlık iki kenar butonu arasında gerçekten ortalanır: her iki tarafta da
    // aynı genişlikte bir buton olduğu için `flex: 1` ortalaması kaymaz.
    headerTitle: {
      color: palette.text,
      flex: 1,
      fontSize: 17,
      fontWeight: '600',
      textAlign: 'center',
    },
    searchField: {
      alignItems: 'center',
      backgroundColor: palette.field,
      borderColor: palette.border,
      borderRadius: FriendsMetrics.searchRadius,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 8,
      marginHorizontal: FriendsMetrics.screenPadding,
      marginTop: 6,
      minHeight: FriendsMetrics.searchHeight,
      paddingHorizontal: 12,
    },
    /** Referans: arama yapılırken/odaklanınca çerçeve morlaşır. */
    searchFieldActive: { borderColor: palette.accent },
    searchInput: {
      color: palette.text,
      flex: 1,
      fontSize: 15,
      minHeight: FriendsMetrics.searchHeight,
      paddingHorizontal: 0,
      paddingVertical: 0,
    },
    content: { flexGrow: 1, paddingTop: 12 },
    section: { marginTop: 18 },
    sectionLabel: {
      color: palette.textTertiary,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.7,
      marginBottom: 8,
      paddingHorizontal: FriendsMetrics.screenPadding,
    },
    resultsBlock: { marginBottom: 6 },
    resultsList: { gap: 8 },
    searchingRow: { alignItems: 'center', paddingVertical: 22 },
    centerState: { alignItems: 'center', gap: 12, paddingVertical: 48 },
    mutedLine: {
      color: palette.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      paddingHorizontal: FriendsMetrics.screenPadding,
      paddingVertical: 20,
      textAlign: 'center',
    },
    stateText: { color: palette.textTertiary, fontSize: 13, paddingHorizontal: 4 },
    iconButton: {
      alignItems: 'center',
      height: 36,
      justifyContent: 'center',
      width: 28,
    },
    /** Sohbet balonu: 44 pt yükseklik, sol hitSlop ile 44 pt genişlik. */
    messageButton: {
      alignItems: 'center',
      height: FriendsMetrics.minTouchSize,
      justifyContent: 'center',
      width: 36,
    },
    accentPill: {
      alignItems: 'center',
      backgroundColor: palette.accent,
      borderRadius: FriendsMetrics.pillRadius,
      justifyContent: 'center',
      minHeight: 34,
      minWidth: 62,
      paddingHorizontal: 14,
    },
    accentPillText: { color: palette.onAccent, fontSize: 13, fontWeight: '600' },
    outlinePill: {
      alignItems: 'center',
      borderColor: palette.border,
      borderRadius: FriendsMetrics.pillRadius,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 34,
      paddingHorizontal: 14,
    },
    outlinePillText: { color: palette.textSecondary, fontSize: 13, fontWeight: '500' },
    errorBox: { gap: 6, paddingHorizontal: FriendsMetrics.screenPadding, paddingTop: 20 },
    errorText: { color: palette.danger, fontSize: 13 },
    retryButton: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 40 },
    retryText: { color: palette.accent, fontSize: 14, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
