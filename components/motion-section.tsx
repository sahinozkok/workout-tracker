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
  MotionCalmDuration,
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
  /**
   * Geçişin temposu.
   *
   *   * `default` — bugüne kadarki davranış. Yazılmazsa bu geçerlidir, yani
   *     mevcut bütün `MotionSwap` kullanıcıları etkilenmez.
   *   * `calm` — disiplin takvimleri için. Daha uzun süre, çok daha kısa dikey
   *     mesafe; `emphasis` bu tempoda okunmaz, kendi karakterini tanımlar.
   */
  pace?: 'default' | 'calm';
  style?: StyleProp<ViewStyle>;
  transitionKey: string;
}>;

/** Bugünkü (varsayılan) geçiş; hiçbir değeri değiştirilmedi. */
function getDefaultSwapMotion(isHeavy: boolean, isClear: boolean) {
  return {
    entering: isHeavy
      ? FadeIn.duration(MotionDuration.fast).easing(MotionEasing.standard)
      : FadeInDown.duration(isClear ? MotionDuration.standard : MotionDuration.fast)
          .easing(MotionEasing.standard)
          .withInitialValues({
            opacity: 0,
            transform: [{ translateY: isClear ? MotionDistance.section : MotionDistance.swap }],
          }),
    exiting: isClear
      ? FadeOutUp.duration(MotionDuration.fast).easing(MotionEasing.standard)
      : FadeOut.duration(MotionDuration.instant),
    layout: isHeavy ? undefined : LinearTransition.duration(MotionDuration.standard),
  };
}

/**
 * `calm` tempo — şu an yalnızca Ana Sayfa ve Profil disiplin takvimleri.
 *
 * ÇIKIŞTA `FadeOutUp` KULLANILMAZ: Reanimated'in `FadeOutUp`'ı sabit -25 pt
 * ötelemeyle çıkar ve takvim gibi geniş bir blokta bu, sertliğin asıl
 * kaynağıydı. Sakin tempoda çıkış sadece opaklıktır; dikey hareket yalnızca
 * girişte ve 5 pt kadardır.
 *
 * Ağır içerikte (yıl ızgarası) layout animasyonu BİLİNÇLİ olarak yoktur:
 * `LinearTransition` 365 hücrelik ızgarayı yeniden ölçtürür.
 */
function getCalmSwapMotion(isHeavy: boolean) {
  return {
    entering: isHeavy
      ? FadeIn.duration(MotionCalmDuration.heavyEnter).easing(MotionEasing.standard)
      : FadeInDown.duration(MotionCalmDuration.enter)
          .easing(MotionEasing.standard)
          .withInitialValues({
            opacity: 0,
            transform: [{ translateY: MotionDistance.calmSwap }],
          }),
    exiting: FadeOut.duration(
      isHeavy ? MotionCalmDuration.heavyExit : MotionCalmDuration.exit,
    ).easing(MotionEasing.standard),
    layout: isHeavy
      ? undefined
      : LinearTransition.duration(MotionCalmDuration.layout).easing(MotionEasing.standard),
  };
}

/** Aynı alandaki alternatif içerikler arasında kısa bir geçiş uygular. */
export function MotionSwap({
  children,
  contentWeight = 'regular',
  emphasis = 'subtle',
  pace = 'default',
  style,
  transitionKey,
}: MotionSwapProps) {
  const reduceMotion = useReducedMotion();
  const isHeavy = contentWeight === 'heavy';
  const isClear = emphasis === 'clear' && !isHeavy;
  const motion =
    pace === 'calm' ? getCalmSwapMotion(isHeavy) : getDefaultSwapMotion(isHeavy, isClear);

  return (
    <Animated.View
      entering={reduceMotion ? undefined : motion.entering}
      exiting={reduceMotion ? undefined : motion.exiting}
      key={transitionKey}
      layout={reduceMotion ? undefined : motion.layout}
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
