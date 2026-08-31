import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { withAlpha } from '@/constants/color-presets';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * ORTAK BAŞARI MEDALYONU.
 *
 * Rozet kutusunda ve ayrıntı penceresinde AYNI görsel dili taşıyan tek
 * bileşen — sembol yerleşimi iki yerde KOPYALANMAZ.
 *
 * Bilinçli sınırlar:
 *  - Yeni renk, asset veya sembol TANIMLAMAZ. Sembolün kendisi çağıranın
 *    verdiği `icon`'dur; tek kaynak yine `components/ranks/achievement-icons.ts`.
 *  - Güçlü vurgu rengi çağıranın verdiği RANK rengidir (`accent`). Zemin ve
 *    sınır mevcut tema renklerinden ve `withAlpha`'dan türer.
 *  - Gradient, glow, gölge veya emoji YOKTUR: yalnızca ince bir daire sınır ve
 *    kod tabanlı Ionicons sembolü.
 *
 * Açılmış rozet: rank accent rengiyle ince sınır ve accent renkli sembol.
 * Kilitli rozet: tema ayırıcı rengiyle sınır, düşük kontrastlı sembol.
 */
export type AchievementMedallionProps = {
  /** Rank rengi — tek güçlü vurgu. */
  accent: string;
  /** Ionicons glyph adı; `ACHIEVEMENT_ICONS[key]` ile çağıran tarafında okunur. */
  icon: keyof typeof Ionicons.glyphMap;
  isUnlocked: boolean;
  /** Sembol boyutu (pt). Rozet kutusunda 44, ayrıntı penceresinde daha belirgin. */
  size?: number;
};

export function AchievementMedallion({
  accent,
  icon,
  isUnlocked,
  size = 44,
}: AchievementMedallionProps) {
  const { colors, isDark } = useAppTheme();
  // Sembolü saran daire, sembolden bir miktar büyük; oran sabit kalır.
  const frame = Math.round(size * 1.45);

  return (
    <View
      // Salt görsel: durum bilgisi çağıran kartın/pencerenin etiketindedir.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.frame,
        {
          backgroundColor: isUnlocked
            ? withAlpha(accent, isDark ? 0.18 : 0.1)
            : colors.surfaceMuted,
          borderColor: isUnlocked ? withAlpha(accent, isDark ? 0.55 : 0.4) : colors.separator,
          borderRadius: frame / 2,
          height: frame,
          width: frame,
        },
      ]}>
      <Ionicons color={isUnlocked ? accent : colors.textTertiary} name={icon} size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    borderWidth: 1,
    justifyContent: 'center',
  },
});
