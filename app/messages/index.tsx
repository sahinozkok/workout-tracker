/**
 * `/messages` — sohbet listesi.
 *
 * Kök Stack'te açılır → alt sekme çubuğuna YENİ SEKME EKLENMEZ ve bu ekranda
 * sekme çubuğu görünmez; ekran kendi başlığını çizer, bu yüzden iOS geri
 * kaydırma hareketi aynen çalışır.
 *
 * Bilinçli sınırlar:
 *  - Veri yalnızca `services/messages.ts` üzerinden gelir; bu dosya Supabase
 *    istemcisine HİÇ dokunmaz ve tabloya yazmaz.
 *  - Yalnızca sunucunun döndürdüğü güvenli alanlar gösterilir. Sahte çevrimiçi
 *    durumu, okunmamış sayacı, ortak arkadaş veya son görülme ÜRETİLMEZ.
 *  - Realtime aboneliği YALNIZCA bu ekran odaklıyken yaşar ve blur/unmount'ta
 *    kesin olarak kapatılır; global bir kanal kurulmaz.
 *  - Mesajlar hiçbir kalıcı istemci deposuna yazılmaz.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
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
import { FriendsMetrics, FriendsPalette, useFriendsPalette } from '@/components/friends/friends-theme';
import { MotionListItem, useListEntrance } from '@/components/motion-list-item';
import { MotionSwap } from '@/components/motion-section';
import { useAuth } from '@/context/auth-context';
import { useTranslation } from '@/context/language-context';
import { listFriendConversations, subscribeToFriendMessages } from '@/services/messages';
import { FriendConversationSummary } from '@/types/messages';
import { nextPreviewExpiryAt, prunePreviewExpiry } from '@/utils/friend-messages';

/** Zamanlayıcı sınırın hemen ARDINDA tetiklensin diye küçük bir pay. */
const EXPIRY_TIMER_SLACK_MS = 50;

export default function MessagesScreen() {
  const palette = useFriendsPalette();
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const viewerId = user?.id;
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [conversations, setConversations] = useState<FriendConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasError, setHasError] = useState(false);
  /** Zamanlayıcı YALNIZCA ekran odaklıyken yaşar. */
  const [isFocused, setIsFocused] = useState(false);

  /** Yalnızca EN SON cevap uygulanır; eski cevap yenisini ezemez. */
  const loadIdRef = useRef(0);
  const isMountedRef = useRef(true);
  /** Cevabın ait olduğu hesap; hesap değişince eski cevap yazamaz. */
  const viewerRef = useRef<string>(undefined);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const loadId = loadIdRef.current + 1;
      loadIdRef.current = loadId;
      const owner = viewerRef.current;
      setHasError(false);

      try {
        const next = await listFriendConversations();
        // Ekrandan çıkıldıysa, yeni bir istek başladıysa veya hesap
        // değiştiyse bu cevap state'e YAZILMAZ.
        if (!isMountedRef.current || loadIdRef.current !== loadId) return;
        if (owner !== viewerRef.current) return;
        /**
         * Sorgu sırasında geçerli olan bir önizlemenin süresi cevap
         * dönene kadar dolmuş olabilir. State'e SÜRESİ DOLMUŞ içerik hiç
         * girmez: yazmadan önce temizlenir.
         */
        setConversations(prunePreviewExpiry(next, Date.now()));
      } catch {
        if (!isMountedRef.current || loadIdRef.current !== loadId) return;
        if (owner !== viewerRef.current) return;
        setHasError(true);
      } finally {
        if (isMountedRef.current && loadIdRef.current === loadId) {
          setIsLoading(false);
          if (mode === 'refresh') setIsRefreshing(false);
        }
      }
    },
    [],
  );

  /**
   * Süresi dolmuş son mesaj önizlemesini YEREL olarak düşürür.
   *
   * Saatlik cron beklenmez: kullanıcı açısından mesaj tam 24 saatte kaybolur.
   * Arkadaş satırı SİLİNMEZ, yalnızca önizleme boşalır.
   */
  const prunePreviews = useCallback(() => {
    setConversations((current) => prunePreviewExpiry(current, Date.now()));
  }, []);

  /**
   * TEK "en yakın sona erme" zamanlayıcısı.
   *
   * Her konuşma için ayrı timer kurulmaz ve periyodik `setInterval`
   * KULLANILMAZ: yalnızca bir sonraki sona erme anına tek bir timeout planlanır.
   * `conversations` değişince (yükleme, yenileme, Realtime veya süpürme
   * sonrası) effect yeniden çalışır ve zamanlayıcı otomatik olarak yeniden
   * planlanır. Cleanup blur, unmount ve hesap değişiminde çalıştığı için ekran
   * başına AYNI ANDA en fazla bir timer bulunur.
   */
  useEffect(() => {
    if (!isFocused) return;
    const now = Date.now();

    /**
     * ÖNCE mevcut state temizlenir.
     *
     * `nextPreviewExpiryAt` yalnızca GELECEKTEKİ süreleri döndürür; yükleme
     * ile bu effect arasında süresi dolmuş bir önizleme yalnızca planlamaya
     * bakılsaydı hiç temizlenmeden ekranda kalırdı.
     *
     * Sonsuz döngü OLUŞMAZ: yardımcı değişiklik yoksa AYNI dizi referansını
     * döndürür, bu yüzden `setConversations` çağrılmaz ve React yeniden render
     * etmez. Temizlik olduğunda effect bir kez daha çalışır, ikinci turda
     * temizlenecek satır kalmaz ve zamanlayıcı kurulur.
     */
    const visible = prunePreviewExpiry(conversations, now);
    if (visible !== conversations) {
      setConversations(visible);
      return;
    }

    const upcoming = nextPreviewExpiryAt(visible, now);
    if (upcoming === undefined) return;

    const timer = setTimeout(prunePreviews, Math.max(0, upcoming - now) + EXPIRY_TIMER_SLACK_MS);
    return () => clearTimeout(timer);
  }, [conversations, isFocused, prunePreviews, viewerId]);

  useFocusEffect(
    useCallback(() => {
      isMountedRef.current = true;
      viewerRef.current = viewerId;
      setIsFocused(true);
      void load('initial');

      // Arka plandan dönüşte süreler HEMEN yeniden değerlendirilir.
      const appState = AppState.addEventListener('change', (state) => {
        if (state !== 'active' || !isMountedRef.current) return;
        prunePreviews();
        void load('refresh');
      });

      /**
       * REALTIME — yalnızca bu ekran odaklıyken. Yeni mesaj gelince liste
       * güvenli biçimde tazelenir: önizleme ve sıralama sunucudan okunur,
       * istemcide uydurulmaz.
       */
      const subscription = viewerId
        ? subscribeToFriendMessages({
            channelKey: 'conversations',
            onMessage: () => {
              if (!isMountedRef.current) return;
              void load('refresh');
            },
            viewerId,
          })
        : undefined;

      return () => {
        isMountedRef.current = false;
        // Zamanlayıcı efekti bu bayrakla temizlenir.
        setIsFocused(false);
        appState.remove();
        // Kanal blur/unmount'ta KESİN olarak kaldırılır.
        subscription?.unsubscribe();
      };
    }, [load, prunePreviews, viewerId]),
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    void load('refresh');
  }, [load]);

  const entrance = useListEntrance(conversations.length);

  function formatTime(value?: string) {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }

  function renderRow(conversation: FriendConversationSummary, isLast: boolean) {
    const preview = conversation.lastMessageContent ?? t('messages.noMessagesYet');
    const time = formatTime(conversation.lastMessageAt);

    return (
      <Pressable
        accessibilityLabel={t('messages.openChat', { name: conversation.displayName })}
        accessibilityRole="button"
        onPress={() =>
          router.push({ pathname: '/messages/[userId]', params: { userId: conversation.userId } })
        }
        style={({ pressed }) => [styles.row, !isLast && styles.rowDivider, pressed && styles.pressed]}>
        <FriendAvatar
          avatarUrl={conversation.avatarUrl}
          displayName={conversation.displayName}
          id={conversation.userId}
        />
        <View style={styles.rowText}>
          <View style={styles.rowTopLine}>
            <Text numberOfLines={1} style={styles.name}>
              {conversation.displayName}
            </Text>
            {Boolean(time) && <Text style={styles.time}>{time}</Text>}
          </View>
          <Text
            numberOfLines={1}
            style={[styles.preview, !conversation.lastMessageContent && styles.previewMuted]}>
            {preview}
          </Text>
        </View>
      </Pressable>
    );
  }

  function renderBody() {
    if (isLoading) {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator color={palette.accent} />
          <Text style={styles.stateText}>{t('messages.conversationsLoading')}</Text>
        </View>
      );
    }

    if (hasError) {
      return (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{t('messages.conversationsFailed')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load('initial')}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <Text style={styles.retryText}>{t('messages.retry')}</Text>
          </Pressable>
        </View>
      );
    }

    if (conversations.length === 0) {
      return (
        <FriendsEmptyState
          buttonLabel={t('friends.findFriend')}
          description={t('messages.noConversationsBody')}
          icon="chatbubbles-outline"
          onPress={() => router.push('/friends')}
          title={t('messages.noConversationsTitle')}
        />
      );
    }

    return (
      <View style={styles.list}>
        {conversations.map((conversation, index) => (
          <MotionListItem delay={entrance.getDelay(index)} key={conversation.userId}>
            {renderRow(conversation, index === conversations.length - 1)}
          </MotionListItem>
        ))}
      </View>
    );
  }

  const bodyKey = isLoading
    ? 'loading'
    : hasError
      ? 'error'
      : conversations.length === 0
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
        <Text style={styles.headerTitle}>{t('messages.title')}</Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={
          <RefreshControl
            onRefresh={handleRefresh}
            refreshing={isRefreshing}
            tintColor={palette.textSecondary}
          />
        }
        showsVerticalScrollIndicator={false}>
        {/* Mesajların kalıcı OLMADIĞI açıkça yazar. */}
        <Text style={styles.notice}>{t('messages.expiryNotice')}</Text>
        <MotionSwap transitionKey={bodyKey}>{renderBody()}</MotionSwap>
      </ScrollView>
    </View>
  );
}

function createStyles(palette: FriendsPalette) {
  return StyleSheet.create({
    root: { backgroundColor: palette.background, flex: 1 },

    header: {
      alignItems: 'center',
      backgroundColor: palette.background,
      flexDirection: 'row',
      gap: 8,
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

    content: { paddingTop: 4 },
    notice: {
      color: palette.textTertiary,
      fontSize: 12,
      paddingBottom: 12,
      paddingHorizontal: FriendsMetrics.screenPadding,
      textAlign: 'center',
    },

    list: { paddingHorizontal: 0 },
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      minHeight: FriendsMetrics.rowMinHeight,
      paddingHorizontal: FriendsMetrics.screenPadding,
    },
    rowDivider: {
      borderBottomColor: palette.separator,
      borderBottomWidth: FriendsMetrics.hairline,
    },
    rowText: { flex: 1, gap: 2 },
    rowTopLine: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    name: { color: palette.text, flex: 1, fontSize: 15, fontWeight: '600' },
    time: { color: palette.textTertiary, fontSize: 12 },
    preview: { color: palette.textSecondary, fontSize: 13 },
    previewMuted: { color: palette.textTertiary },

    stateBox: { alignItems: 'center', gap: 12, paddingTop: 48 },
    stateText: { color: palette.textSecondary, fontSize: 13, textAlign: 'center' },
    retryButton: {
      alignItems: 'center',
      backgroundColor: palette.field,
      borderColor: palette.border,
      borderRadius: FriendsMetrics.pillRadius,
      borderWidth: FriendsMetrics.hairline,
      justifyContent: 'center',
      minHeight: FriendsMetrics.minTouchSize,
      paddingHorizontal: 20,
    },
    retryText: { color: palette.text, fontSize: 14, fontWeight: '600' },

    pressed: { opacity: 0.6 },
  });
}
