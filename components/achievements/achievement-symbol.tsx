import { Image } from 'react-native';

import { ACHIEVEMENT_VISUALS, AchievementKey } from '@/constants/achievements';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * KALICI KARİYER BAŞARIMI SEMBOLÜ — tek paylaşılan sunum bileşeni.
 *
 * 30 organik PNG asset'i (1254×1254 RGBA, düz `#D5755B`) `ACHIEVEMENT_VISUALS`
 * kaynak haritasından okunur ve React Native `Image` ile çizilir. Görsel bir
 * ALFA MASKE gibi kullanılır: `tintColor` sembolü yeniden boyar, böylece
 *   * AÇIK durum → aktif profil özelliği accent'ini takip eder (tema/palet uyumlu),
 *   * KİLİTLİ durum → tema tersiyer metin rengi + ölçülü opaklık (yerleşim boyu
 *     DEĞİŞMEDEN),
 * ve dört temada (light / warm light / dark / soft dark) açık ve kilitli net ayrılır.
 *
 * SINIRLAR: `resizeMode="contain"` (oran korunur, kırpılmaz), eşit en/boy, kendi
 * arka planı YOK; daire/madalyon/çerçeve/kart/gölge/glow/gradient/animasyon YOK;
 * sabit siyah/beyaz zemin YOK. Sembol DEKORATİF'tir ve erişilebilirlikten
 * gizlenir — kapsayan satır/kart zaten tam lokalize etiketi ve durumu sağlar.
 */
export type AchievementSymbolProps = {
  achievementKey: AchievementKey;
  /** Kenar uzunluğu (pt). `contain` oranı korur; yerleşim boyu durumdan bağımsızdır. */
  size: number;
  isUnlocked: boolean;
  /** Açık sembolün takip ettiği profil özelliği accent rengi. */
  accent: string;
};

export function AchievementSymbol({ accent, achievementKey, isUnlocked, size }: AchievementSymbolProps) {
  const { colors, isDark } = useAppTheme();

  // Kilitli opaklık tema grubuna göre ölçülür: koyu/soft koyu ~0.42, açık/warm ~0.58.
  const lockedOpacity = isDark ? 0.42 : 0.58;

  return (
    <Image
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      resizeMode="contain"
      source={ACHIEVEMENT_VISUALS[achievementKey]}
      style={{
        height: size,
        opacity: isUnlocked ? 1 : lockedOpacity,
        tintColor: isUnlocked ? accent : colors.textTertiary,
        width: size,
      }}
    />
  );
}
