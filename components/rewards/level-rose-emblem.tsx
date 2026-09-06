import { Image } from 'expo-image';
import { useMemo } from 'react';

import { LevelRoseId } from '@/constants/level-roses';

/**
 * Seviye gülü sembolü — kademeye özgü YEREL RESİM ASSET'i (gerçek transparan).
 *
 * TEK GÖRSEL KAYNAK — bütün seviye gülü görselleri buradan eşlenir: profildeki
 * kimlik hücresi, seçim penceresindeki grid ve arkadaş profili aynı doğru asseti
 * kullanır.
 *
 * KURALLAR (kullanıcı talebi):
 *   * Gülün arkasında daire, madalyon, renkli kart veya çerçeve YOKTUR.
 *   * Asset'e TINT, ek glow veya dekoratif gölge UYGULANMAZ — güllerin kendi
 *     renkleri/malzemeleri korunur.
 *   * `contain` ile gülün tamamı görünür kalır; kesilme/esneme olmaz.
 *   * Profilde KOMPAKT ölçü korunur; büyük vitrin ikonuna dönüştürülmez.
 */

/** Kademe kimliği → yerel gül asset'i. TEK kaynak; kopyalanmaz. */
export const LEVEL_ROSE_SOURCES: Record<LevelRoseId, number> = {
  rose_1: require('@/assets/images/level-roses/rose-1.png'),
  rose_2: require('@/assets/images/level-roses/rose-2.png'),
  rose_3: require('@/assets/images/level-roses/rose-3.png'),
  rose_4: require('@/assets/images/level-roses/rose-4.png'),
  rose_5: require('@/assets/images/level-roses/rose-5.png'),
  rose_6: require('@/assets/images/level-roses/rose-6.png'),
  rose_7: require('@/assets/images/level-roses/rose-7.png'),
  rose_8: require('@/assets/images/level-roses/rose-8.png'),
  rose_9: require('@/assets/images/level-roses/rose-9.png'),
  rose_10: require('@/assets/images/level-roses/rose-10.png'),
  rose_11: require('@/assets/images/level-roses/rose-11.png'),
  rose_12: require('@/assets/images/level-roses/rose-12.png'),
  rose_13: require('@/assets/images/level-roses/rose-13.png'),
  rose_15: require('@/assets/images/level-roses/rose-15.png'),
  rose_20: require('@/assets/images/level-roses/rose-20.png'),
  rose_25: require('@/assets/images/level-roses/rose-25.png'),
  rose_30: require('@/assets/images/level-roses/rose-30.png'),
  rose_35: require('@/assets/images/level-roses/rose-35.png'),
  rose_40: require('@/assets/images/level-roses/rose-40.png'),
  rose_50: require('@/assets/images/level-roses/rose-50.png'),
  rose_65: require('@/assets/images/level-roses/rose-65.png'),
  rose_80: require('@/assets/images/level-roses/rose-80.png'),
  rose_100: require('@/assets/images/level-roses/rose-100.png'),
  rose_150: require('@/assets/images/level-roses/rose-150.png'),
  rose_200: require('@/assets/images/level-roses/rose-200.png'),
};

type LevelRoseEmblemProps = {
  /** Katalogdan gelen gül kimliği. */
  roseId: LevelRoseId;
  /** Kenar uzunluğu (pt). `contain` oranı korur. */
  size: number;
  /** Verilirse sembol tek başına anlam taşır; verilmezse dekoratiftir. */
  accessibilityLabel?: string;
  /** Kilitli görünüm (seçim penceresinde) için opaklık azaltılır. */
  dimmed?: boolean;
  /**
   * Kilitli (`dimmed`) opaklık. Sabit 0.35 açık temada beyaz/inci gülleri neredeyse
   * görünmez kılıyordu; çağıran TEMA BAZLI ölçülü bir değer geçebilir (açık temada
   * daha yüksek, koyu temada düşük). Verilmezse 0.35 (geriye uyum). Asset rengi
   * KORUNUR — yalnız opaklık değişir, tint/sabit renk uygulanmaz.
   */
  dimOpacity?: number;
};

export function LevelRoseEmblem({ accessibilityLabel, dimmed, dimOpacity, roseId, size }: LevelRoseEmblemProps) {
  const a11y = useMemo(
    () =>
      accessibilityLabel
        ? { accessibilityLabel, accessibilityRole: 'image' as const, accessible: true }
        : {
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants' as const,
          },
    [accessibilityLabel],
  );

  return (
    <Image
      contentFit="contain"
      source={LEVEL_ROSE_SOURCES[roseId]}
      style={{ height: size, opacity: dimmed ? (dimOpacity ?? 0.35) : 1, width: size }}
      {...a11y}
    />
  );
}
