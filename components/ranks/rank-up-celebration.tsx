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

import { getRankColor, getRankSoftBackground, useRankName } from '@/components/ranks/rank-badge';
import { withAlpha } from '@/constants/color-presets';
import { MotionDuration, MotionEasing } from '@/constants/motion';
import { canShowRankCelebration } from '@/constants/rank-experience';
import { Layout } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useMascot } from '@/context/mascot-context';
import { useRanks } from '@/context/rank-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { RankUpCelebration } from '@/types/ranks';

/**
 * RANK YÜKSELME KUTLAMASI — uygulama genelinde **tek** katman.
 *
 * Bilinçli sınırlar:
 *  - Kutlama hiçbir akışı yönetmez. Set kaydı, antrenman bitişi, otomatik
 *    kronometre, mola sayacı ve navigasyon bu katmandan TAMAMEN bağımsızdır;
 *    burada bir hata olsa bile o akışlar etkilenmez.
 *  - Aktif antrenman/set giriş ekranında ve oturum akışı ekranlarında
 *    GÖSTERİLMEZ. Kutlama düşürülmez, **bekletilir**: kullanıcı güvenli bir
 *    ekrana geçtiğinde bir kez gösterilir (`canShowRankCelebration`).
 *  - Süren bir kutlama bölünmez; kapanana kadar yenisi başlamaz.
 *  - Confetti, ses ve uzun sahne YOKTUR: kısa bir fade + ölçek, tek düğme.
 *  - Reduce Motion açıkken ölçek hiç uygulanmaz, yalnızca çok kısa bir fade
 *    kalır.
 *  - Yeni paket eklenmez; mevcut motion tokenları ve tema renkleri kullanılır.
 */

/** Ölçek yalnızca bu kadar oynar: 0.96 → 1. */
const ENTER_SCALE = 0.96;

/**
 * Perde opaklığı. Koyu temada arka plan zaten koyu olduğu için biraz güçlü
 * tutulur; açık temada kartın kenarı kaybolmasın diye daha hafiftir.
 */
const SCRIM_ALPHA = { dark: 0.66, light: 0.38 } as const;

export function RankUpCelebrationLayer() {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const rankName = useRankName();
  const { acknowledgeRankUpShown, dismissRankUp, rankUp } = useRanks();
  const { triggerReaction } = useMascot();
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  /** Gösterilen kutlamanın kopyası: açıkken içerik değişip titremez. */
  const [shown, setShown] = useState<RankUpCelebration>();
  /** Kapanış animasyonu sürerken ikinci kez kapatılmaz. */
  const isClosingRef = useRef(false);

  const progress = useSharedValue(0);
  const isSafeScreen = canShowRankCelebration(pathname);

  useEffect(() => {
    // Süren kutlama varken yenisi başlamaz; güvenli olmayan ekranda beklenir.
    if (shown || !rankUp || !isSafeScreen) return;

    setShown(rankUp);
    isClosingRef.current = false;

    /**
     * GÖSTERİM ONAYI tam burada verilir — "Devam" düğmesi BEKLENMEZ.
     *
     * Kalıcı kayıt yalnızca bu anda ilerler: kullanıcı kutlamayı görmeden
     * uygulamayı kapatırsa sonraki açılışta kutlama yeniden oluşturulur,
     * bir kez görünmeye başladıysa tekrar oynatılmaz. Depo hatası yutulduğu
     * için bu çağrı kutlamayı, navigasyonu veya başka bir akışı bozamaz.
     */
    void acknowledgeRankUpShown(rankUp.id);

    /**
     * Rosea tepkisi kutlama başına **bir kez**, onayla AYNI gösterim
     * başlangıcında tetiklenir.
     *
     * `triggerReaction` maskot kapalıysa (tatilde) olayı kendisi düşürür;
     * burada Rosea zorla geri getirilmez. Sürükleme, uyku, blink, nefes,
     * AI sohbeti ve antrenman tepkisi mantığına dokunulmaz.
     */
    triggerReaction('rank-up');
  }, [acknowledgeRankUpShown, isSafeScreen, rankUp, shown, triggerReaction]);

  useEffect(() => {
    if (!shown) return;

    progress.value = 0;
    progress.value = withTiming(1, {
      duration: reduceMotion ? MotionDuration.instant : MotionDuration.standard,
      easing: MotionEasing.standard,
    });

    // Katman kapanırsa/unmount olursa süren animasyon kesin olarak durdurulur.
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion, shown]);

  /** Kapanış animasyonu bittiğinde çalışır; JS tarafında tek temizlik noktası. */
  const handleClosed = useCallback(
    (celebrationId: number) => {
      isClosingRef.current = false;
      setShown(undefined);
      // Yalnızca gösterilen kutlamayı temizler: bu sırada daha yüksek bir rank
      // gelmişse o kutlama korunur ve sırayla gösterilir.
      dismissRankUp(celebrationId);
    },
    [dismissRankUp],
  );

  const handleContinue = useCallback(() => {
    const current = shown;
    if (!current || isClosingRef.current) return;
    isClosingRef.current = true;

    const celebrationId = current.id;
    progress.value = withTiming(
      0,
      {
        duration: reduceMotion ? MotionDuration.instant : MotionDuration.fast,
        easing: MotionEasing.standard,
      },
      () => {
        'worklet';
        runOnJS(handleClosed)(celebrationId);
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

  const toColor = getRankColor(shown.toRank);
  const fromLabel = rankName(shown.fromRank);
  const toLabel = rankName(shown.toRank);

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[
        styles.layer,
        { backgroundColor: withAlpha('#000000', isDark ? SCRIM_ALPHA.dark : SCRIM_ALPHA.light) },
        scrimStyle,
      ]}>
      <Animated.View
        accessibilityLabel={t('ranks.rankUp.a11y', {
          from: fromLabel,
          rp: shown.rp,
          to: toLabel,
        })}
        accessibilityRole="alert"
        accessible
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.separator },
          cardStyle,
        ]}>
        <Text style={[styles.title, { color: colors.text }]}>{t('ranks.rankUp.title')}</Text>

        <View style={styles.transitionRow}>
          <Text numberOfLines={1} style={[styles.fromRank, { color: colors.textSecondary }]}>
            {fromLabel}
          </Text>
          <Text style={[styles.arrow, { color: colors.textTertiary }]}>→</Text>
          <View
            style={[
              styles.badge,
              { backgroundColor: getRankSoftBackground(shown.toRank, isDark) },
            ]}>
            <View style={[styles.dot, { backgroundColor: toColor }]} />
            <Text numberOfLines={1} style={[styles.toRank, { color: toColor }]}>
              {toLabel}
            </Text>
          </View>
        </View>

        <Text style={[styles.rp, { color: colors.textSecondary }]}>
          {t('ranks.rpValue', { rp: shown.rp })}
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
            {t('ranks.rankUp.continue')}
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
    gap: 16,
    maxWidth: 320,
    padding: 24,
    width: '100%',
  },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  transitionRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'center' },
  fromRank: { flexShrink: 1, fontSize: 15, fontWeight: '400' },
  arrow: { fontSize: 15, fontWeight: '400' },
  badge: {
    alignItems: 'center',
    borderRadius: Layout.radiusPill,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dot: { borderRadius: 4, height: 8, width: 8 },
  toRank: { flexShrink: 1, fontSize: 15, fontWeight: '600' },
  rp: { fontSize: 13, fontWeight: '400' },
  button: {
    alignItems: 'center',
    borderRadius: Layout.radiusMedium,
    justifyContent: 'center',
    minHeight: Layout.minTouchSize,
    paddingHorizontal: 24,
    width: '100%',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
