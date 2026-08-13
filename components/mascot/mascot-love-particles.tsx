import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * Çift dokunma "sevme" tepkisinde maskotun üstünde beliren küçük kalpler.
 * Yeni görsel veya paket kullanılmaz; mevcut Ionicons seti yeterlidir.
 */
const HEART_COUNT = 4;
const HEART_SIZE = 15;
/** Kalplerin başlangıçtaki yatay dağılımı (kutu merkezine göre). */
const SPREAD = [-19, -6, 7, 19];
const RISE = 32;
const DURATION = 950;
const STAGGER = 90;

type Props = {
  /** Reduce Motion açıkken kalpler yükselmez; sabit durup yumuşakça söner. */
  reduceMotion: boolean;
  /** Kalplerin yayılacağı kare alanın kenar uzunluğu (dokunma hedefi). */
  size: number;
};

function Heart({
  color,
  delay,
  offsetX,
  reduceMotion,
  size,
}: {
  color: string;
  delay: number;
  offsetX: number;
  reduceMotion: boolean;
  size: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: DURATION, easing: Easing.out(Easing.quad) }),
    );

    return () => cancelAnimation(progress);
  }, [delay, progress]);

  const style = useAnimatedStyle(() => {
    // Reduce Motion: yükselme yok, yalnızca sakin bir belirip sönme.
    const rise = reduceMotion ? RISE * 0.35 : RISE * progress.value;
    const opacity =
      progress.value < 0.2 ? progress.value / 0.2 : 1 - (progress.value - 0.2) / 0.8;

    return {
      opacity: Math.max(0, opacity),
      transform: [
        { translateX: offsetX },
        { translateY: -rise },
        { scale: reduceMotion ? 1 : 0.7 + 0.3 * progress.value },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.heart,
        { left: size / 2 - HEART_SIZE / 2, top: size / 2 - HEART_SIZE / 2 },
        style,
      ]}>
      <Ionicons color={color} name="heart" size={HEART_SIZE} />
    </Animated.View>
  );
}

/**
 * `pointerEvents` kapalıdır: hiçbir dokunmayı yakalamaz, ekran düğmelerini
 * engellemez. Tepki bitince çağıran bileşen tarafından unmount edilir;
 * animasyonlar da böylece temizlenir.
 */
export function MascotLoveParticles({ reduceMotion, size }: Props) {
  const { colors } = useAppTheme();

  return (
    <Animated.View pointerEvents="none" style={[styles.container, { height: size, width: size }]}>
      {Array.from({ length: HEART_COUNT }, (_, index) => (
        <Heart
          color={colors.danger}
          delay={index * STAGGER}
          key={index}
          offsetX={SPREAD[index % SPREAD.length]}
          reduceMotion={reduceMotion}
          size={size}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { left: 0, position: 'absolute', top: 0 },
  heart: { position: 'absolute' },
});
