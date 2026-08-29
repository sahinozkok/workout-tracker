/**
 * UYGULAMA İÇİ MESAJ BANNER'I — tek global ön plan dinleyicisi.
 *
 * Bilinçli sınırlar:
 *  - YALNIZCA uygulama gerçekten ön plandayken çalışır. Uzaktan push,
 *    işletim sistemi bildirimi, mesaj sayısı ve "görüldü" bilgisi YOKTUR;
 *    arka planda veya kapalıyken hiçbir şey göstermez.
 *  - Supabase istemcisine HİÇ dokunmaz: abonelik `services/messages.ts`
 *    üzerinden kurulur ve karar mantığı saf yardımcılardadır.
 *  - Rank/Rosea/başarı katmanlarının SAHİPLİK sistemine dokunmaz. `_layout`
 *    içinde o katmanlardan ÖNCE çizilir, bu yüzden kutlamalar banner'ın
 *    üstünde kalır ve z-index çatışması oluşmaz.
 *  - Önizleme hiçbir yere loglanmaz ve kalıcı depoya yazılmaz.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendsMetrics, FriendsPalette, useFriendsPalette } from '@/components/friends/friends-theme';
import { MotionDuration, MotionEasing } from '@/constants/motion';
import { useAuth } from '@/context/auth-context';
import { useTranslation } from '@/context/language-context';
import {
  FriendMessageChannelStatus,
  listFriendConversations,
  subscribeToFriendMessages,
} from '@/services/messages';
import {
  ALERT_VISIBLE_MS,
  getActiveConversation,
  isForegroundAppState,
  MessageAlert,
  nextAlert,
  rememberAlertId,
  shouldShowAlert,
  toMessageAlert,
} from '@/utils/friend-message-alerts';

/** Giriş mesafesi — üstten aşağı doğru çok kısa bir kayma. */
const ENTER_OFFSET = 12;

export function FriendMessageAlerts() {
  const palette = useFriendsPalette();
  const { t } = useTranslation();
  const { user } = useAuth();
  const viewerId = user?.id;
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [alert, setAlert] = useState<MessageAlert>();

  const isMountedRef = useRef(true);
  /**
   * Olayın ait olduğu hesap. Hesap değişince eski kanalın geç gelen olayı
   * YENİ hesabın ekranında banner gösteremez.
   */
  const viewerRef = useRef<string>(undefined);
  /** Gösterilmiş mesaj kimlikleri — aynı mesaj iki kez banner üretmez. */
  const seenIdsRef = useRef<ReadonlySet<string>>(new Set());
  /** TEK görünürlük zamanlayıcısı; her yeni mesajda baştan kurulur. */
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /**
   * Uygulama gerçekten ön planda mı?
   *
   * `AppState.currentState` MOUNT ANINDA `null` veya `'unknown'` olabilir; bu
   * yüzden `=== 'active'` karşılaştırması açılışta yanlışlıkla `false`
   * mühürlerdi ve `change` yalnızca GEÇİŞLERDE tetiklendiği için uygulama hiç
   * arka plana gitmezse banner sonsuza kadar bastırılırdı. Karar artık
   * `isForegroundAppState` ile tersinden verilir.
   */
  const isForegroundRef = useRef(isForegroundAppState(AppState.currentState));
  /**
   * Arkadaş kimliği → görünen ad.
   *
   * Realtime yükü profil bilgisi taşımaz. Harita mount'ta ve öne dönüşte BİR
   * kez doldurulur; bilinmeyen bir gönderen gelirse tazelenir. Böylece banner
   * başına ağ çağrısı YAPILMAZ.
   */
  const namesRef = useRef<Map<string, string>>(new Map());
  /** Ad tazelemesi tek uçuşlu; hızlı mesajlarda istek yığılmaz. */
  const isLoadingNamesRef = useRef(false);
  /**
   * Kanal durumu — `SUBSCRIBED` gelmezse abonelik ÇALIŞMIYOR demektir.
   * Sessiz başarı varsayımı yapılmaz; geliştirmede görünür hâle getirilir.
   */
  const [channelStatus, setChannelStatus] = useState<FriendMessageChannelStatus>();

  const progress = useSharedValue(0);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === undefined) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = undefined;
  }, []);

  const dismiss = useCallback(() => {
    clearHideTimer();
    setAlert(undefined);
  }, [clearHideTimer]);

  /** Ad haritasını tazeler. Hata sessizce yutulur: banner adsız da çalışır. */
  const refreshNames = useCallback(async (owner: string | undefined) => {
    if (isLoadingNamesRef.current) return;
    isLoadingNamesRef.current = true;
    try {
      const conversations = await listFriendConversations();
      if (!isMountedRef.current || owner !== viewerRef.current) return;
      const next = new Map<string, string>();
      for (const conversation of conversations) next.set(conversation.userId, conversation.displayName);
      namesRef.current = next;
    } catch {
      // Ad okunamadıysa banner yine gösterilir; yalnızca ad eksik kalır.
    } finally {
      isLoadingNamesRef.current = false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    viewerRef.current = viewerId;

    if (viewerId) void refreshNames(viewerId);

    const appState = AppState.addEventListener('change', (state) => {
      isForegroundRef.current = isForegroundAppState(state);
      // Arka plana geçince banner asılı kalmaz.
      if (!isForegroundRef.current && isMountedRef.current) {
        dismiss();
        return;
      }
      if (viewerId) void refreshNames(viewerId);
    });

    /**
     * TEK GLOBAL ABONELİK. Sohbet ve konuşma listesi ekranlarının kendi
     * kanalları vardır; bu kanal yalnızca banner içindir ve mesaj kimliğine
     * göre dedupe edilir.
     */
    const subscription = viewerId
      ? subscribeToFriendMessages({
          channelKey: 'alerts',
          onStatus: (status) => {
            if (!isMountedRef.current || viewerRef.current !== viewerId) return;
            setChannelStatus(status);
          },
          onMessage: (message) => {
            // Hesap veya ekran değiştiyse eski callback state'e YAZAMAZ.
            if (!isMountedRef.current || viewerRef.current !== viewerId) return;

            const decision = shouldShowAlert({
              // Aktif sohbet SENKRON okunur: React turu beklenmez.
              activeConversation: getActiveConversation(),
              isForeground: isForegroundRef.current,
              message,
              nowMs: Date.now(),
              seenIds: seenIdsRef.current,
              viewerId,
            });
            if (!decision) return;

            seenIdsRef.current = rememberAlertId(seenIdsRef.current, message.id);
            const senderName = namesRef.current.get(message.senderId);
            // Ad bilinmiyorsa (yeni arkadaş) harita tazelenir; bu mesaj adsız
            // gösterilir, sonraki mesajlar adı taşır.
            if (!senderName) void refreshNames(viewerId);
            // SON MESAJ politikası: yeni mesaj mevcut banner'ın yerini alır.
            setAlert((current) => nextAlert(current, toMessageAlert(message, senderName)));
          },
          viewerId,
        })
      : undefined;

    return () => {
      isMountedRef.current = false;
      appState.remove();
      // Kanal ve zamanlayıcı KESİN olarak temizlenir.
      subscription?.unsubscribe();
      clearHideTimer();
    };
  }, [clearHideTimer, dismiss, refreshNames, viewerId]);

  /** Hesap değişince önceki hesabın banner'ı ve dedupe geçmişi düşer. */
  useEffect(() => {
    seenIdsRef.current = new Set();
    setAlert(undefined);
    clearHideTimer();
  }, [clearHideTimer, viewerId]);

  /** Görünürlük: tek zamanlayıcı, her yeni banner'da baştan kurulur. */
  useEffect(() => {
    if (!alert) return;

    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) setAlert(undefined);
    }, ALERT_VISIBLE_MS);

    return clearHideTimer;
  }, [alert, clearHideTimer]);

  /** Giriş animasyonu — Reduce Motion açıkken yalnızca opaklık. */
  useEffect(() => {
    if (!alert) {
      progress.value = 0;
      return;
    }

    progress.value = 0;
    progress.value = withTiming(1, {
      duration: reduceMotion ? MotionDuration.instant : MotionDuration.standard,
      easing: MotionEasing.standard,
    });

    return () => cancelAnimation(progress);
  }, [alert, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduceMotion ? [] : [{ translateY: -ENTER_OFFSET * (1 - progress.value) }],
  }));

  /**
   * GELİŞTİRME TEŞHİSİ — kanal bağlanamadıysa sessiz kalınmaz.
   *
   * Token, e-posta veya içerik taşımaz; yalnızca kanal durumunu gösterir ve
   * yayın derlemesinde hiç render edilmez.
   */
  if (!alert) {
    if (!__DEV__ || !channelStatus || channelStatus === 'SUBSCRIBED') return null;
    return (
      <View pointerEvents="none" style={[styles.layer, { paddingTop: insets.top + 6 }]}>
        <View style={styles.banner}>
          <View style={[styles.accentBar, { backgroundColor: palette.danger }]} />
          <Text numberOfLines={1} style={styles.preview}>
            {`realtime: ${channelStatus}`}
          </Text>
        </View>
      </View>
    );
  }

  const preview = alert.preview.length > 0 ? alert.preview : t('messages.alertFallback');
  /** Ad biliniyorsa `{name}: {preview}`, bilinmiyorsa yalnızca önizleme. */
  const label = alert.senderName
    ? t('messages.alertPreview', { name: alert.senderName, preview })
    : preview;

  function openConversation() {
    const senderId = alert?.senderId;
    dismiss();
    if (!senderId) return;
    router.push({ pathname: '/messages/[userId]', params: { userId: senderId } });
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.layer, { paddingTop: insets.top + 6 }, animatedStyle]}>
      <Pressable
        accessibilityLabel={
          alert.senderName
            ? t('messages.alertOpenA11y', { name: alert.senderName })
            : t('messages.alertFallback')
        }
        accessibilityRole="button"
        onPress={openConversation}
        style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
        <View style={[styles.accentBar, { backgroundColor: palette.accent }]} />
        <Text numberOfLines={1} style={styles.preview}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function createStyles(palette: FriendsPalette) {
  return StyleSheet.create({
    /** Üstte, güvenli alanın altında; alttaki dokunmaları engellemez. */
    layer: {
      /**
       * Stack'in ÜSTÜNDE çizilir. iOS'ta kardeş sırası yeterlidir ama
       * Android'de `elevation` olmadan mutlak konumlu kardeş navigator'ın
       * ARKASINDA kalabilir; ikisi birlikte verilir.
       */
      elevation: 8,
      left: 0,
      paddingHorizontal: FriendsMetrics.screenPadding,
      position: 'absolute',
      right: 0,
      top: 0,
      zIndex: 100,
    },
    banner: {
      alignItems: 'center',
      backgroundColor: palette.card,
      borderColor: palette.border,
      borderRadius: FriendsMetrics.cardRadius,
      borderWidth: FriendsMetrics.hairline,
      flexDirection: 'row',
      gap: 10,
      minHeight: FriendsMetrics.minTouchSize,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    /** Friends vurgusu — yeni renk sistemi eklenmez. */
    accentBar: { borderRadius: 2, height: 20, width: 3 },
    preview: { color: palette.text, flex: 1, fontSize: 13, fontWeight: '600' },
    pressed: { opacity: 0.85 },
  });
}
