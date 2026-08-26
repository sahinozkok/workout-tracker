import { PropsWithChildren } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';

import {
  MotionDistance,
  MotionDuration,
  MotionEasing,
  MotionStagger,
} from '@/constants/motion';

type MotionSectionProps = PropsWithChildren<{
  delay?: number;
  style?: StyleProp<ViewStyle>;
}>;

/** Ekran bölümünü ilk görünümünde sakin biçimde yerleştirir. */
export function MotionSection({ children, delay = 0, style }: MotionSectionProps) {
  const reduceMotion = useReducedMotion();
  const safeDelay = Math.min(Math.max(delay, 0), MotionStagger.max);

  return (
    <Animated.View
      entering={
        reduceMotion
          ? undefined
          : FadeInDown.duration(MotionDuration.standard)
              .delay(safeDelay)
              .easing(MotionEasing.standard)
              .withInitialValues({ opacity: 0, transform: [{ translateY: MotionDistance.section }] })
      }
      style={style}>
      {children}
    </Animated.View>
  );
}

type MotionSwapProps = PropsWithChildren<{
  contentWeight?: 'regular' | 'heavy';
  emphasis?: 'subtle' | 'clear';
  style?: StyleProp<ViewStyle>;
  transitionKey: string;
}>;

/** Aynı alandaki alternatif içerikler arasında kısa bir geçiş uygular. */
export function MotionSwap({
  children,
  contentWeight = 'regular',
  emphasis = 'subtle',
  style,
  transitionKey,
}: MotionSwapProps) {
  const reduceMotion = useReducedMotion();
  const isHeavy = contentWeight === 'heavy';
  const isClear = emphasis === 'clear' && !isHeavy;

  return (
    <Animated.View
      entering={
        reduceMotion
          ? undefined
          : isHeavy
            ? FadeIn.duration(MotionDuration.fast).easing(MotionEasing.standard)
            : FadeInDown.duration(isClear ? MotionDuration.standard : MotionDuration.fast)
              .easing(MotionEasing.standard)
              .withInitialValues({
                opacity: 0,
                transform: [{ translateY: isClear ? MotionDistance.section : MotionDistance.swap }],
              })
      }
      exiting={
        reduceMotion
          ? undefined
          : isClear
            ? FadeOutUp.duration(MotionDuration.fast).easing(MotionEasing.standard)
            : FadeOut.duration(MotionDuration.instant)
      }
      key={transitionKey}
      layout={reduceMotion || isHeavy ? undefined : LinearTransition.duration(MotionDuration.standard)}
      style={style}>
      {children}
    </Animated.View>
  );
}

/** Açılır alanların sert biçimde belirip kaybolmasını önler. */
export function MotionCollapsible({ children, style }: Omit<MotionSectionProps, 'delay'>) {
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      entering={
        reduceMotion
          ? undefined
          : FadeInDown.duration(MotionDuration.standard)
              .easing(MotionEasing.standard)
              .withInitialValues({
                opacity: 0,
                transform: [{ translateY: MotionDistance.section }],
              })
      }
      exiting={reduceMotion ? undefined : FadeOutUp.duration(MotionDuration.fast)}
      layout={reduceMotion ? undefined : LinearTransition.duration(MotionDuration.standard)}
      style={style}>
      {children}
    </Animated.View>
  );
}
