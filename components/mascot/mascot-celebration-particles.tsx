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

/** Maskotun yakınında kalan küçük kutlama parçacıkları. Tam ekran konfeti yok. */
const PARTICLE_COUNT = 8;
const PARTICLE_SIZE = 6;
const TRAVEL = 34;
const DURATION = 900;
const STAGGER = 45;

type Props = {
  /** Reduce Motion açıkken parçacıklar yayılmaz, yalnızca belirip söner. */
  reduceMotion: boolean;
  /** Parçacıkların yayılacağı kare alanın kenar uzunluğu (dokunma hedefi). */
  size: number;
};

function Particle({
  angle,
  color,
  delay,
  reduceMotion,
  size,
}: {
  angle: number;
  color: string;
  delay: number;
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
    // Reduce Motion açıkken parçacık yer değiştirmez, yalnızca belirip söner.
    const distance = reduceMotion ? TRAVEL * 0.45 : TRAVEL * progress.value;
    const opacity = progress.value < 0.25 ? progress.value / 0.25 : 1 - (progress.value - 0.25) / 0.75;

    return {
      opacity: Math.max(0, opacity),
      transform: [
        { translateX: Math.cos(angle) * distance },
        { translateY: Math.sin(angle) * distance },
        { scale: reduceMotion ? 1 : 0.6 + 0.4 * (1 - progress.value) },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          backgroundColor: color,
          left: size / 2 - PARTICLE_SIZE / 2,
          top: size / 2 - PARTICLE_SIZE / 2,
        },
        style,
      ]}
    />
  );
}

/**
 * Kutlama sırasında maskotun çevresinde beliren parçacıklar. `pointerEvents`
 * kapalıdır: hiçbir dokunmayı yakalamaz. Kutlama bitince çağıran bileşen
 * tarafından unmount edilir, animasyonlar da böylece temizlenir.
 */
export function MascotCelebrationParticles({ reduceMotion, size }: Props) {
  const { colors } = useAppTheme();

  const palette = [colors.primary, colors.disciplineCompleted, colors.accent];

  return (
    <Animated.View pointerEvents="none" style={[styles.container, { height: size, width: size }]}>
      {Array.from({ length: PARTICLE_COUNT }, (_, index) => (
        <Particle
          angle={(index / PARTICLE_COUNT) * Math.PI * 2}
          color={palette[index % palette.length]}
          delay={index * STAGGER}
          key={index}
          reduceMotion={reduceMotion}
          size={size}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { left: 0, position: 'absolute', top: 0 },
  particle: {
    borderRadius: PARTICLE_SIZE / 2,
    height: PARTICLE_SIZE,
    position: 'absolute',
    width: PARTICLE_SIZE,
  },
});
