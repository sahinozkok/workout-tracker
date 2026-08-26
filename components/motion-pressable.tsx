import { forwardRef } from 'react';
import { Pressable, PressableProps, StyleProp, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { MotionDuration, MotionEasing, MotionOpacity, MotionScale } from '@/constants/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type MotionPressableProps = Omit<PressableProps, 'style'> & {
  /**
   * Statik stil. `Pressable`'ın fonksiyon biçimli `style` API'si BİLİNÇLİ
   * olarak desteklenmez: basılı geri bildirimi bu bileşen kendisi üretir, iki
   * kaynağın aynı anda opaklık yazması karışıklık olurdu.
   */
  style?: StyleProp<ViewStyle>;
};

/**
 * Birincil eylem düğmeleri için dokunma geri bildirimi.
 *
 * Neden `Animated.createAnimatedComponent(Pressable)`?
 *   Ekstra bir sarmalayıcı `View` EKLENMEZ. Sarmalayıcı olsaydı `flex: 1`,
 *   `alignSelf` gibi düzen değerleri bir seviye kayar ve buton yerleşimi
 *   değişebilirdi. Bu bileşen aynı düğüm üzerinde çalışır; ölçü, konum ve
 *   yerleşim birebir korunur.
 *
 * Davranış:
 *   * basılınca `MotionDuration.instant` içinde `scale: 0.97` + `opacity: 0.92`,
 *   * bırakılınca `MotionDuration.fast` içinde eski hâline,
 *   * `disabled` iken hiç hareket etmez,
 *   * Reduce Motion açıkken ölçek uygulanmaz; yalnızca opaklık kalır.
 *
 * `onPress`, `onLongPress`, `hitSlop`, `disabled`, `accessibilityRole`,
 * `accessibilityLabel`, `accessibilityState` ve test özellikleri dahil bütün
 * `Pressable` propları OLDUĞU GİBİ iletilir; ek bir çağrı sarmalanmadığı için
 * çift işlem veya çift callback oluşmaz.
 */
export const MotionPressable = forwardRef<View, MotionPressableProps>(function MotionPressable(
  { disabled, onPressIn, onPressOut, style, ...rest },
  ref,
) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value * (1 - MotionOpacity.pressed),
    transform: reduceMotion
      ? []
      : [{ scale: 1 - progress.value * (1 - MotionScale.pressed) }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(event) => {
        // Devre dışı düğme hareket etmez.
        if (!disabled) {
          progress.value = withTiming(1, {
            duration: MotionDuration.instant,
            easing: MotionEasing.press,
          });
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        progress.value = withTiming(0, {
          duration: MotionDuration.fast,
          easing: MotionEasing.standard,
        });
        onPressOut?.(event);
      }}
      ref={ref}
      style={[style, animatedStyle]}
    />
  );
});
