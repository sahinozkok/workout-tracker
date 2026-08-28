/**
 * `/messages/[userId]` — tek arkadaşla sohbet.
 *
 * Kök Stack'te açılır → alt sekme çubuğu görünmez, yeni sekme EKLENMEZ; ekran
 * kendi başlığını çizdiği için iOS geri kaydırma hareketi aynen çalışır.
 *
 * Bilinçli sınırlar:
 *  - Supabase istemcisine HİÇ dokunulmaz: okuma, gönderme ve Realtime
 *    aboneliği `services/messages.ts` üzerinden yapılır.
 *  - Mesajlar hiçbir kalıcı istemci deposuna (AsyncStorage vb.) YAZILMAZ.
 *  - Okundu bilgisi, yazıyor göstergesi, çevrimiçi durumu, medya, düzenleme,
 *    silme ve reaksiyon YOKTUR; ödül/RP/XP/gül üretilmez.
 *  - Süre dolumu cron'a bağlı değildir: tek bir "en yakın sona erme"
 *    zamanlayıcısı mesajları tam 24 saatte ekrandan kaldırır.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendAvatar } from '@/components/friends/friend-avatar';
import { FriendsMetrics, FriendsPalette, useFriendsPalette } from '@/components/friends/friends-theme';
import { MotionPressable } from '@/components/motion-pressable';
import { useAuth } from '@/context/auth-context';
import { useTranslation } from '@/context/language-context';
import { getFriendProfile } from '@/services/friends';
import {
  FRIEND_MESSAGE_MAX_LENGTH,
  getFriendMessages,
  isFriendMessageRateLimited,
  isNotFriendsError,
  sendFriendMessage,
  subscribeToFriendMessages,
} from '@/services/messages';
import { FriendProfile } from '@/types/friends';
import { FriendMessage, FriendMessageCursor } from '@/types/messages';
import {
  belongsToConversation,
  mergeFriendMessages,
  nextExpiryAt,
  PendingSend,
  pruneExpiredMessages,
  resolveSendKey,
} from '@/utils/friend-messages';
import { createIdempotencyKey } from '@/utils/idempotency-key';

/** Zamanlayıcı sınırın hemen ARDINDA tetiklensin diye küçük bir pay. */
const EXPIRY_TIMER_SLACK_MS = 50;

type ScreenState = 'loading' | 'ready' | 'error' | 'not-friends';
type SendError = 'failed' | 'rate-limited';

export default function ChatScreen() {
  const palette = useFriendsPalette();
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ userId?: string }>();
  const counterpartId = typeof params.userId === 'string' ? params.userId : undefined;
  const viewerId = user?.id;
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [profile, setProfile] = useState<FriendProfile>();
  const [messages, setMessages] = useState<FriendMessage[]>([]);
  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [cursor, setCursor] = useState<FriendMessageCursor>();
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<SendError>();

  const isMountedRef = useRef(true);
  /** Yalnızca EN SON yükleme cevabı uygulanır. */
  const loadIdRef = useRef(0);
  /**
   * AKTİF KONUŞMANIN SAHİPLİK ANAHTARI — `${viewerId}:${counterpartId}`.
   *
   * Yalnızca `viewerId` YETMEZ: aynı hesapla A'dan B'ye geçildiğinde A'nın
   * uçuştaki Realtime callback'i, sayfalama cevabı veya gönderim sonucu B'nin
   * state'ine yazabilirdi. Anahtar senkron olarak güncellenir; bütün async
   * işlemler başlangıçta onu yakalar ve HER state yazımından önce (finally
   * dahil) karşılaştırır.
   */
  const conversationRef = useRef<string>(undefined);
  /** Senkron kilit: aynı karedeki ikinci dokunuş ikinci RPC üretemez. */
  const sendingRef = useRef(false);
  /** Aynı kilit sayfalama için; çift dokunuş iki sayfa isteği başlatamaz. */
  const loadingOlderRef = useRef(false);
  /** Başarısız taslağın anahtarı; aynı içerik retry'ında KORUNUR. */
  const pendingSendRef = useRef<PendingSend>(undefined);
  /** Tek "en yakın sona erme" zamanlayıcısı. */
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /**
   * Bir sonraki içerik ölçümünde en alta kaydırılsın mı?
   *
   * İlk yükleme ve YENİ canlı mesajda `true`; ESKİ sayfa eklenirken `false`
   * kalır, böylece kullanıcı geçmişi okurken en alta atılmaz.
   */
  const shouldScrollToEndRef = useRef(true);

  /** Aktif konuşmanın kimliği; hesap veya kişi değişince değişir. */
  const conversationKey = viewerId && counterpartId ? `${viewerId}:${counterpartId}` : undefined;

  /** Süresi dolanları düşürür ve SIRADAKİ sona erme anına yeniden planlar. */
  const scheduleExpirySweep = useCallback(() => {
    if (expiryTimerRef.current !== undefined) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = undefined;
    }

    setMessages((current) => {
      const now = Date.now();
      const visible = pruneExpiredMessages(current, now);
      const upcoming = nextExpiryAt(visible, now);

      if (upcoming !== undefined) {
        // HER MESAJ İÇİN ayrı timeout zinciri kurulmaz: tek zamanlayıcı.
        expiryTimerRef.current = setTimeout(
          () => scheduleExpirySweep(),
          Math.max(0, upcoming - now) + EXPIRY_TIMER_SLACK_MS,
        );
      }

      return visible.length === current.length ? current : visible;
    });
  }, []);

  const applyIncoming = useCallback(
    (incoming: FriendMessage[]) => {
      setMessages((current) => mergeFriendMessages(current, incoming));
      scheduleExpirySweep();
    },
    [scheduleExpirySweep],
  );

  const load = useCallback(async () => {
    if (!counterpartId || !viewerId) return;
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    const owner = conversationRef.current;

    const isStale = () =>
      !isMountedRef.current || loadIdRef.current !== loadId || owner !== conversationRef.current;

    try {
      /**
       * ARKADAŞLIK OTORİTESİ sunucudadır: profil yalnızca kabul edilmiş
       * arkadaşa dönerimden, boş cevap "artık arkadaş değilsiniz" demektir.
       */
      const nextProfile = await getFriendProfile(counterpartId);
      if (isStale()) return;

      if (!nextProfile) {
        // Eski mesajlar ekranda TUTULMAZ.
        setProfile(undefined);
        setMessages([]);
        setCursor(undefined);
        setHasMore(false);
        setScreenState('not-friends');
        return;
      }

      const page = await getFriendMessages(counterpartId);
      if (isStale()) return;

      setProfile(nextProfile);
      // Sunucu en yeni önce döner; ekranda doğal kronolojik sıra gösterilir.
      setMessages(pruneExpiredMessages(mergeFriendMessages([], page.messages), Date.now()));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setScreenState('ready');
      // İlk yükleme en alttan başlar.
      shouldScrollToEndRef.current = true;
      scheduleExpirySweep();
    } catch (error) {
      if (isStale()) return;
      /**
       * Profil OKUNDUKTAN SONRA arkadaşlık kaldırılmış olabilir: geçmiş RPC'si
       * o zaman `not_friends` ile düşer. Bu genel bir yükleme hatası DEĞİLDİR;
       * kullanıcıya doğru durum gösterilir ve eski mesajlar ekranda tutulmaz.
       */
      if (isNotFriendsError(error)) {
        setProfile(undefined);
        setMessages([]);
        setCursor(undefined);
        setHasMore(false);
        setScreenState('not-friends');
        return;
      }
      setScreenState('error');
    }
  }, [counterpartId, scheduleExpirySweep, viewerId]);

  useFocusEffect(
    useCallback(() => {
      isMountedRef.current = true;

      /**
       * KONUŞMA DEĞİŞTİ Mİ? Anahtar SENKRON olarak burada güncellenir; bu
       * andan sonra eski konuşmanın uçuştaki bütün cevapları geçersizdir.
       *
       * Eski konuşmanın mesajı, cursor'ı, hatası ve gönderim state'i yeni
       * kişiye GÖRÜNMEZ; başarısız retry anahtarı da taşınmaz.
       */
      if (conversationRef.current !== conversationKey) {
        conversationRef.current = conversationKey;
        pendingSendRef.current = undefined;
        sendingRef.current = false;
        loadingOlderRef.current = false;
        shouldScrollToEndRef.current = true;
        setProfile(undefined);
        setMessages([]);
        setCursor(undefined);
        setHasMore(false);
        setIsLoadingOlder(false);
        setIsSending(false);
        setSendError(undefined);
        setDraft('');
        setScreenState('loading');
      }

      void load();

      // Arka plandan dönüşte süreler yeniden değerlendirilir.
      const appState = AppState.addEventListener('change', (state) => {
        if (state !== 'active' || !isMountedRef.current) return;
        scheduleExpirySweep();
      });

      /**
       * REALTIME — YALNIZCA bu ekran odaklıyken. Gelen satır açık konuşmaya ait
       * değilse veya süresi geçmişse eklenmez; `id` ile dedupe edilir.
       */
      const subscription =
        viewerId && counterpartId
          ? subscribeToFriendMessages({
              channelKey: `chat:${counterpartId}`,
              onMessage: (message) => {
                // Hesap VEYA konuşma değiştiyse eski callback state'e YAZAMAZ.
                if (!isMountedRef.current || conversationRef.current !== conversationKey) return;
                if (!belongsToConversation(message, viewerId, counterpartId)) return;
                // Canlı mesaj geldi: en alta kaydırılır.
                shouldScrollToEndRef.current = true;
                applyIncoming([message]);
              },
              viewerId,
            })
          : undefined;

      return () => {
        isMountedRef.current = false;
        appState.remove();
        subscription?.unsubscribe();
        if (expiryTimerRef.current !== undefined) {
          clearTimeout(expiryTimerRef.current);
          expiryTimerRef.current = undefined;
        }
      };
    }, [applyIncoming, conversationKey, counterpartId, load, scheduleExpirySweep, viewerId]),
  );

  const loadOlder = useCallback(async () => {
    if (!counterpartId || !cursor) return;
    // ÇİFT DOKUNMA: senkron kilit, aynı karedeki ikinci isteği keser.
    if (loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    const owner = conversationRef.current;

    /**
     * ESKİ sayfa eklenirken en alta ATLANMAZ: kullanıcının okuduğu mesaj
     * ekranda kalır (`maintainVisibleContentPosition` konumu korur).
     */
    shouldScrollToEndRef.current = false;

    try {
      // OFFSET kullanılmaz: sunucunun keyset imleci taşınır.
      const page = await getFriendMessages(counterpartId, cursor);
      if (!isMountedRef.current || owner !== conversationRef.current) return;
      applyIncoming(page.messages);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      // Sessiz kalınır: mevcut mesajlar korunur, kullanıcı tekrar deneyebilir.
    } finally {
      /**
       * KİLİT SIFIRLAMASI DA SAHİPLİĞE BAĞLIDIR.
       *
       * A konuşmasının geç biten isteği, B'de ŞU AN süren sayfalamanın
       * kilidini açamaz — açsaydı B'de aynı sayfa için ikinci bir RPC
       * başlatılabilirdi. Ref yazımı ile state yazımı AYNI sahiplik kararını
       * kullanır; konuşma değiştiyse yeni konuşmanın kendi kilidi zaten
       * `useFocusEffect` içinde sıfırlanmıştır.
       */
      if (owner === conversationRef.current) {
        loadingOlderRef.current = false;
        if (isMountedRef.current) setIsLoadingOlder(false);
      }
    }
  }, [applyIncoming, counterpartId, cursor]);

  const send = useCallback(async () => {
    if (!counterpartId) return;
    // ÇİFT DOKUNMA: senkron kilit, aynı karede ikinci çağrıyı keser.
    if (sendingRef.current) return;

    const content = draft.trim();
    if (content.length < 1 || content.length > FRIEND_MESSAGE_MAX_LENGTH) return;

    /**
     * IDEMPOTENCY: aynı içerik yeniden denenirse AYNI anahtar kullanılır ve
     * sunucu ikinci mesaj yazmaz. Kullanıcı başarısız taslağı değiştirirse bu
     * yeni bir mesajdır ve yeni anahtar üretilir.
     */
    const pending = resolveSendKey(pendingSendRef.current, content, createIdempotencyKey);
    pendingSendRef.current = pending;

    sendingRef.current = true;
    setIsSending(true);
    setSendError(undefined);
    const owner = conversationRef.current;

    try {
      const message = await sendFriendMessage(counterpartId, content, pending.clientMessageId);
      // Konuşma veya hesap değiştiyse bu sonuç YENİ state'e yazamaz.
      if (!isMountedRef.current || owner !== conversationRef.current) return;

      // Gönderilen mesaj en altta: kaydırma yapılır.
      shouldScrollToEndRef.current = true;
      // Realtime olayı önce ya da sonra gelsin: `id` dedupe'u tek balon bırakır.
      applyIncoming([message]);
      pendingSendRef.current = undefined;
      setDraft('');
    } catch (error) {
      if (!isMountedRef.current || owner !== conversationRef.current) return;

      /**
       * Arkadaşlık arada kaldırılmışsa sohbet kapanır. Supabase hataları her
       * zaman `Error` örneği DEĞİLDİR; ayrım güvenli okuyucudan geçer ve ham
       * hata metni KULLANICIYA GÖSTERİLMEZ.
       */
      if (isNotFriendsError(error)) {
        setProfile(undefined);
        setMessages([]);
        setCursor(undefined);
        setHasMore(false);
        setSendError(undefined);
        setScreenState('not-friends');
        return;
      }

      setSendError(isFriendMessageRateLimited(error) ? 'rate-limited' : 'failed');
    } finally {
      /**
       * Gönderim kilidi de aynı kurala tabidir: A'nın geç biten gönderimi
       * B'de süren gönderimin kilidini açıp ikinci bir RPC'ye yol veremez.
       */
      if (owner === conversationRef.current) {
        sendingRef.current = false;
        if (isMountedRef.current) setIsSending(false);
      }
    }
  }, [applyIncoming, counterpartId, draft]);

  const trimmedDraft = draft.trim();
  const canSend =
    screenState === 'ready' &&
    !isSending &&
    trimmedDraft.length > 0 &&
    trimmedDraft.length <= FRIEND_MESSAGE_MAX_LENGTH;

  function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }

  function renderBubble(message: FriendMessage) {
    const isOwn = message.senderId === viewerId;
    const time = formatTime(message.createdAt);
    const name = profile?.displayName ?? t('messages.unknownUser');

    return (
      <View
        accessibilityLabel={
          isOwn
            ? t('messages.sentA11y', { content: message.content, time })
            : t('messages.receivedA11y', { content: message.content, name, time })
        }
        accessible
        key={message.id}
        style={[styles.bubbleRow, isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
          <Text selectable style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}>
            {message.content}
          </Text>
          <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>{time}</Text>
        </View>
      </View>
    );
  }

  function renderBody() {
    if (screenState === 'loading') {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator color={palette.accent} />
          <Text style={styles.stateText}>{t('messages.chatLoading')}</Text>
        </View>
      );
    }

    if (screenState === 'not-friends') {
      return (
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle}>{t('messages.notFriendsTitle')}</Text>
          <Text style={styles.stateText}>{t('messages.notFriendsBody')}</Text>
        </View>
      );
    }

    if (screenState === 'error') {
      return (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{t('messages.chatFailed')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <Text style={styles.retryText}>{t('messages.retry')}</Text>
          </Pressable>
        </View>
      );
    }

    if (messages.length === 0) {
      return (
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle}>{t('messages.emptyChatTitle')}</Text>
          <Text style={styles.stateText}>{t('messages.emptyChatBody')}</Text>
        </View>
      );
    }

    return (
      <View style={styles.thread}>
        {hasMore && (
          <Pressable
            accessibilityRole="button"
            disabled={isLoadingOlder}
            onPress={() => void loadOlder()}
            style={({ pressed }) => [styles.loadOlder, pressed && styles.pressed]}>
            <Text style={styles.loadOlderText}>
              {isLoadingOlder ? t('messages.loadingOlder') : t('messages.loadOlder')}
            </Text>
          </Pressable>
        )}
        {messages.map(renderBubble)}
      </View>
    );
  }

  const scrollRef = useRef<ScrollView>(null);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable
          accessibilityLabel={t('common.back')}
          accessibilityRole="button"
          hitSlop={{ bottom: 10, left: 10, right: 10, top: 10 }}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages'))}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
          <Ionicons color={palette.text} name="chevron-back" size={26} />
        </Pressable>

        <View style={styles.headerIdentity}>
          {Boolean(profile) && (
            <FriendAvatar
              avatarUrl={profile?.avatarUrl}
              displayName={profile?.displayName ?? ''}
              id={counterpartId ?? ''}
              size={FriendsMetrics.avatarSizeCompact}
            />
          )}
          <Text numberOfLines={1} style={styles.headerTitle}>
            {profile?.displayName ?? t('messages.title')}
          </Text>
        </View>

        <View style={styles.headerButton} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          /**
           * Yukarıya içerik eklendiğinde görünen mesajın ekran konumu korunur;
           * "Eski mesajları yükle" listeyi kaydırmaz.
           */
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onContentSizeChange={() => {
            // YALNIZCA ilk yükleme ve yeni canlı mesajda en alta kaydırılır.
            if (!shouldScrollToEndRef.current) return;
            shouldScrollToEndRef.current = false;
            scrollRef.current?.scrollToEnd({ animated: false });
          }}
          ref={scrollRef}
          showsVerticalScrollIndicator={false}>
          <Text style={styles.notice}>{t('messages.expiryNotice')}</Text>
          {renderBody()}
        </ScrollView>

        {screenState === 'ready' && (
          <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
            {Boolean(sendError) && (
              <View style={styles.sendErrorRow}>
                <Text style={styles.sendErrorText}>
                  {sendError === 'rate-limited'
                    ? t('messages.rateLimited')
                    : t('messages.sendFailed')}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSending}
                  onPress={() => void send()}
                  style={({ pressed }) => [styles.sendRetry, pressed && styles.pressed]}>
                  <Text style={styles.sendRetryText}>{t('messages.sendRetry')}</Text>
                </Pressable>
              </View>
            )}

            <View style={styles.composerRow}>
              <TextInput
                accessibilityLabel={t('messages.composerPlaceholder')}
                maxLength={FRIEND_MESSAGE_MAX_LENGTH}
                multiline
                onChangeText={setDraft}
                placeholder={t('messages.composerPlaceholder')}
                placeholderTextColor={palette.textTertiary}
                style={styles.input}
                value={draft}
              />
              <MotionPressable
                accessibilityLabel={t('messages.send')}
                accessibilityRole="button"
                accessibilityState={{ busy: isSending, disabled: !canSend }}
                disabled={!canSend}
                onPress={() => void send()}
                style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}>
                {isSending ? (
                  <ActivityIndicator color={palette.onAccent} size="small" />
                ) : (
                  <Ionicons color={palette.onAccent} name="arrow-up" size={20} />
                )}
              </MotionPressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

function createStyles(palette: FriendsPalette) {
  return StyleSheet.create({
    root: { backgroundColor: palette.background, flex: 1 },
    flex: { flex: 1 },

    header: {
      alignItems: 'center',
      backgroundColor: palette.background,
      borderBottomColor: palette.separator,
      borderBottomWidth: FriendsMetrics.hairline,
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
    headerIdentity: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      minHeight: FriendsMetrics.headerHeight,
    },
    headerTitle: { color: palette.text, flexShrink: 1, fontSize: 17, fontWeight: '600' },

    content: { gap: 8, paddingHorizontal: FriendsMetrics.screenPadding, paddingVertical: 12 },
    notice: { color: palette.textTertiary, fontSize: 12, textAlign: 'center' },

    thread: { gap: 8 },
    loadOlder: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: FriendsMetrics.minTouchSize,
    },
    loadOlderText: { color: palette.accent, fontSize: 13, fontWeight: '600' },

    bubbleRow: { flexDirection: 'row' },
    bubbleRowOwn: { justifyContent: 'flex-end' },
    bubbleRowOther: { justifyContent: 'flex-start' },
    bubble: {
      borderRadius: FriendsMetrics.cardRadius,
      gap: 2,
      maxWidth: '82%',
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    /** Gönderilen: Friends vurgusu + doğru `onAccent`. */
    bubbleOwn: { backgroundColor: palette.accent },
    /** Gelen: mevcut Friends kart yüzeyi. */
    bubbleOther: { backgroundColor: palette.card },
    bubbleText: { color: palette.text, fontSize: 15, lineHeight: 20 },
    bubbleTextOwn: { color: palette.onAccent },
    bubbleTime: { color: palette.textTertiary, fontSize: 11, textAlign: 'right' },
    bubbleTimeOwn: { color: palette.onAccent, opacity: 0.75 },

    stateBox: { alignItems: 'center', gap: 8, paddingTop: 48 },
    stateTitle: { color: palette.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
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

    composer: {
      backgroundColor: palette.background,
      borderTopColor: palette.separator,
      borderTopWidth: FriendsMetrics.hairline,
      gap: 8,
      paddingHorizontal: FriendsMetrics.screenPadding,
      paddingTop: 8,
    },
    composerRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 8 },
    input: {
      backgroundColor: palette.field,
      borderColor: palette.border,
      borderRadius: FriendsMetrics.searchRadius,
      borderWidth: FriendsMetrics.hairline,
      color: palette.text,
      flex: 1,
      fontSize: 15,
      maxHeight: 120,
      minHeight: FriendsMetrics.minTouchSize,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    sendButton: {
      alignItems: 'center',
      backgroundColor: palette.accent,
      borderRadius: FriendsMetrics.minTouchSize / 2,
      height: FriendsMetrics.minTouchSize,
      justifyContent: 'center',
      width: FriendsMetrics.minTouchSize,
    },
    sendButtonDisabled: { opacity: 0.5 },

    sendErrorRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    sendErrorText: { color: palette.danger, flex: 1, fontSize: 12 },
    sendRetry: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: FriendsMetrics.minTouchSize,
      paddingHorizontal: 4,
    },
    sendRetryText: { color: palette.accent, fontSize: 13, fontWeight: '600' },

    pressed: { opacity: 0.6 },
  });
}
