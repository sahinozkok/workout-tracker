import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Layout } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * `+N XP` geri bildirimi — uygulama genelinde **tek** katman.
 *
 * Bilinçli sınırlar:
 *  - Modal, kutlama ekranı veya ses yoktur; yaklaşık bir saniye görünen küçük
 *    bir yazıdır.
 *  - `pointerEvents="none"`: altındaki hiçbir dokunmayı engellemez.
 *  - Reduce Motion açıkken yalnızca fade uygulanır, kayma hareketi olmaz.
 *  - Yalnızca sunucu gerçekten ödül yazdığında mount edilir; "zaten
 *    ödüllendirilmiş" cevabında hiç görünmez (bkz. `RewardProvider`).
 *
 * Gül bakiyesi XP ile birlikte arttığı için yazıda yalnızca XP gösterilir;
 * bakiye aynı anda profildeki sayıda güncellenir.
 */

const FADE_IN = 160;
const HOLD = 700;
const FADE_OUT = 240;
const RISE = 14;

type RewardToastLayerProps = {
  onDone: () => void;
  /** `undefined` → hiçbir şey render edilmez. */
  xp?: number;
};

export function RewardToastLayer({ onDone, xp }: RewardToastLayerProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const progress = useSharedValue(0);
  const isVisible = typeof xp === 'number' && xp > 0;

  useEffect(() => {
    if (!isVisible) return;

    progress.value = 0;
    progress.value = withSequence(
      withTiming(1, { duration: FADE_IN, easing: Easing.out(Easing.quad) }),
      withDelay(
        HOLD,
        withTiming(0, { duration: FADE_OUT, easing: Easing.in(Easing.quad) }, (finished) => {
          'worklet';
          if (finished) runOnJS(onDone)();
        }),
      ),
    );
    // `key` her yeni ödülde değiştiği için bileşen yeniden mount edilir ve
    // dizi baştan oynar; üst üste binen ikinci bir animasyon oluşmaz.
  }, [isVisible, onDone, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    // Reduce Motion: yalnızca fade; konum hiç değişmez.
    transform: reduceMotion ? [] : [{ translateY: (1 - progress.value) * RISE }],
  }));

  if (!isVisible) return null;

  return (
    <View pointerEvents="none" style={[styles.layer, { paddingTop: insets.top + 8 }]}>
      <Animated.View
        style={[
          styles.pill,
          { backgroundColor: colors.surfaceMuted, borderColor: colors.separator },
          animatedStyle,
        ]}>
        <Text style={[styles.text, { color: colors.text }]}>
          {t('rewards.xpGain', { amount: xp })}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  pill: {
    borderRadius: Layout.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  text: { fontSize: 14, fontWeight: '700' },
});
