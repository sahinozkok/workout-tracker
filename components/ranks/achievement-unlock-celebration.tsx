import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ACHIEVEMENT_ICONS } from '@/components/ranks/achievement-icons';
import { withAlpha } from '@/constants/color-presets';
import { MotionDuration, MotionEasing } from '@/constants/motion';
import { canShowRankCelebration, SeasonAchievementKey } from '@/constants/rank-experience';
import { Layout } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useMascot } from '@/context/mascot-context';
import { useRanks } from '@/context/rank-context';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * BAŞARI AÇILMA KUTLAMASI — uygulama genelinde **tek** katman.
 *
 * Bilinçli sınırlar:
 *  - Bu katman hiçbir başarı koşulu veya ilerleme HESAPLAMAZ; hangi rozetin
 *    kutlanacağına `RankContext` karar verir, o da sunucudan gelen "açık"
 *    listesini kullanır. Rozetler RP, XP veya gül üretmez.
 *  - Aktif antrenman/set giriş ekranında ve oturum akışı ekranlarında
 *    GÖSTERİLMEZ. Kutlama düşürülmez, **bekletilir** (`canShowRankCelebration`).
 *  - ÖNCELİK: rank yükselme > sezon özeti > başarı rozeti. Bekleyen bir rank
 *    yükselmesi veya sezon özeti varsa bu katman kendini hiç göstermez; ayrıca
 *    `claimRankOverlay` ile senkron sahiplik alır, böylece iki katman aynı
 *    karede üst üste açılamaz.
 *  - Kalıcı kayıt yalnızca kart gerçekten render/layout olduğunda ilerler.
 *  - Confetti, ses, yeni görsel ve yeni paket YOKTUR: kısa fade + hafif ölçek,
 *    tek düğme. Reduce Motion açıkken ölçek hiç uygulanmaz.
 */

/** Ölçek yalnızca bu kadar oynar: 0.96 → 1. Rank kutlamasıyla aynı. */
const ENTER_SCALE = 0.96;

/** Perde opaklığı — rank kutlamasıyla aynı değerler. */
const SCRIM_ALPHA = { dark: 0.66, light: 0.38 } as const;

/** Bu katmanın sahiplik kimliği. */
const OVERLAY_OWNER = 'achievement' as const;

export function AchievementUnlockCelebrationLayer() {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const {
    achievementCelebration,
    acknowledgeAchievementCelebrationShown,
    activeRankOverlay,
    claimRankOverlay,
    dismissAchievementCelebration,
    rankUp,
    releaseRankOverlay,
    seasonRecap,
  } = useRanks();
  const { triggerReaction } = useMascot();
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  /** Gösterilen kutlamanın kopyası: açıkken içerik değişip titremez. */
  const [shown, setShown] = useState<SeasonAchievementKey>();
  /** Kapanış animasyonu sürerken ikinci kez kapatılmaz. */
  const isClosingRef = useRef(false);
  /**
   * Layout onayı verilmiş rozet.
   *
   * `onLayout` döndürme, yazı tipi ölçeği ve içerik boyu değişiminde yeniden
   * çağrılabilir; bu ref aynı kutlama için ikinci bir yazma isteği üretilmesini
   * önler. Context tarafındaki kontrol ikinci güvenlik katmanıdır.
   */
  const layoutAcknowledgedRef = useRef<SeasonAchievementKey>(undefined);

  const progress = useSharedValue(0);
  const isSafeScreen = canShowRankCelebration(pathname);

  useEffect(() => {
    // Süren kutlama varken yenisi başlamaz; güvenli olmayan ekranda beklenir.
    if (shown || !achievementCelebration || !isSafeScreen) return;
    // ÖNCELİK: rank yükselme ve sezon özeti önce gösterilir.
    if (rankUp || seasonRecap) return;
    // Senkron sahiplik: başka bir katman görünürken açılmaz.
    /**
     * `activeRankOverlay` bilinçli bir bağımlılıktır: claim başarısız olup
     * effect çıktığında, kilit serbest kaldığı anda bu effect yeniden çalışır
     * ve bekleyen katman kendiliğinden açılır. Başka bir state değişikliği
     * BEKLENMEZ. Öncelik korunur ve süren kutlama YARIDA KESİLMEZ.
     */
    if (!claimRankOverlay(OVERLAY_OWNER)) return;

    setShown(achievementCelebration);
    isClosingRef.current = false;
    layoutAcknowledgedRef.current = undefined;
  }, [
    achievementCelebration,
    activeRankOverlay,
    claimRankOverlay,
    isSafeScreen,
    rankUp,
    seasonRecap,
    shown,
  ]);

  // Katman unmount olursa sahiplik KESİN olarak bırakılır; kilit asılı kalmaz.
  useEffect(() => () => releaseRankOverlay(OVERLAY_OWNER), [releaseRankOverlay]);

  useEffect(() => {
    if (!shown) return;

    progress.value = 0;
    progress.value = withTiming(1, {
      duration: reduceMotion ? MotionDuration.instant : MotionDuration.standard,
      easing: MotionEasing.standard,
    });

    return () => cancelAnimation(progress);
  }, [progress, reduceMotion, shown]);

  /**
   * Kart GERÇEKTEN mount/layout oldu → kalıcı gösterim onayı.
   *
   * "Devam" düğmesi BEKLENMEZ. Kullanıcı kart layout edilmeden uygulamayı
   * kapatırsa kayıt yazılmadığı için rozet sonraki açılışta yeniden çıkar;
   * layout edildikten sonra kapatırsa tekrar çıkmaz.
   *
   * Rosea tepkisi de kutlama başına **bir kez**, aynı gösterim başlangıcında
   * tetiklenir. `triggerReaction` maskot kapalıysa (tatilde) olayı kendisi
   * düşürür; Rosea zorla geri getirilmez ve mevcut animasyonlarına dokunulmaz.
   */
  const handleCardLayout = useCallback(() => {
    const current = shown;
    if (!current) return;
    if (layoutAcknowledgedRef.current === current) return;
    layoutAcknowledgedRef.current = current;

    void acknowledgeAchievementCelebrationShown(current);
    triggerReaction('rank-up');
  }, [acknowledgeAchievementCelebrationShown, shown, triggerReaction]);

  /** Kapanış animasyonu bittiğinde çalışır; JS tarafında tek temizlik noktası. */
  const handleClosed = useCallback(
    (key: SeasonAchievementKey) => {
      isClosingRef.current = false;
      layoutAcknowledgedRef.current = undefined;
      setShown(undefined);
      // Sahiplik bırakılır: sıradaki rozet (veya başka katman) açılabilir.
      releaseRankOverlay(OVERLAY_OWNER);
      dismissAchievementCelebration(key);
    },
    [dismissAchievementCelebration, releaseRankOverlay],
  );

  const handleContinue = useCallback(() => {
    const current = shown;
    if (!current || isClosingRef.current) return;
    isClosingRef.current = true;

    progress.value = withTiming(
      0,
      {
        duration: reduceMotion ? MotionDuration.instant : MotionDuration.fast,
        easing: MotionEasing.standard,
      },
      () => {
        'worklet';
        runOnJS(handleClosed)(current);
      },
    );
  }, [handleClosed, progress, reduceMotion, shown]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    // Reduce Motion: hareket yok, yalnızca opaklık.
    transform: reduceMotion
      ? []
      : [{ scale: ENTER_SCALE + (1 - ENTER_SCALE) * progress.value }],
  }));

  if (!shown) return null;

  const name = t(`ranks.achievements.items.${shown}.name`);
  const description = t(`ranks.achievements.items.${shown}.description`);

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[
        styles.layer,
        { backgroundColor: withAlpha('#000000', isDark ? SCRIM_ALPHA.dark : SCRIM_ALPHA.light) },
        scrimStyle,
      ]}>
      <Animated.View
        accessibilityLabel={t('ranks.achievements.celebration.a11y', { name })}
        accessibilityRole="alert"
        accessible
        onLayout={handleCardLayout}
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.separator },
          cardStyle,
        ]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons color={colors.primary} name={ACHIEVEMENT_ICONS[shown]} size={26} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>
          {t('ranks.achievements.celebration.title')}
        </Text>
        <Text numberOfLines={2} style={[styles.name, { color: colors.text }]}>
          {name}
        </Text>
        <Text numberOfLines={3} style={[styles.description, { color: colors.textSecondary }]}>
          {description}
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={handleContinue}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary },
            pressed && styles.buttonPressed,
          ]}>
          <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
            {t('ranks.achievements.celebration.continue')}
          </Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: Layout.screenPadding,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  card: {
    alignItems: 'center',
    borderRadius: Layout.radiusLarge,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    maxWidth: 320,
    padding: 24,
    width: '100%',
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    marginBottom: 4,
    width: 52,
  },
  title: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  name: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  description: { fontSize: 13, fontWeight: '400', lineHeight: 19, textAlign: 'center' },
  button: {
    alignItems: 'center',
    borderRadius: Layout.radiusMedium,
    justifyContent: 'center',
    marginTop: 4,
    minHeight: Layout.minTouchSize,
    paddingHorizontal: 24,
    width: '100%',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
