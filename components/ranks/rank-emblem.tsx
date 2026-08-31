import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { withAlpha } from '@/constants/color-presets';
import { RankId } from '@/constants/ranks';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * Rank sembolü — kademeye özgü, KOD TABANLI Ionicons işareti.
 *
 * Aynı görsel kaynak üç yerde kullanılır: rank özetindeki büyük hero işareti,
 * `RankBadge` içindeki kompakt işaret ve rank rehberi satırlarındaki orta boy
 * işaret. Böylece renkli nokta yerine tutarlı bir sembol geçer.
 *
 * RENK KURALI — burada YENİ renk tanımlanmaz. Rank rengi çağıran taraftan
 * `color` ile gelir; color preset sistemi bunu değiştiremez.
 * Zemin ve sınır yalnızca mevcut `withAlpha`
 * yardımcısının çok hafif tonlarıdır. Gradient, glow, gölge veya resim asset'i
 * KULLANILMAZ.
 *
 * ERİŞİLEBİLİRLİK — üç kullanım da rank adını zaten metinle sunar; bu yüzden
 * sembol varsayılan olarak DEKORATİFTİR ve VoiceOver'a rank adını ikinci kez
 * okutmaz. Gerçekten tek başına anlam taşıması gerekirse `accessibilityLabel`
 * verilebilir.
 */

/** Kademe → Ionicons işareti. TEK kaynak; kopyalanmaz. */
export const RANK_EMBLEM_ICONS: Record<RankId, keyof typeof Ionicons.glyphMap> = {
  bronze: 'shield-outline',
  silver: 'shield-half-outline',
  gold: 'medal-outline',
  platinum: 'star-outline',
  diamond: 'diamond-outline',
  master: 'trophy-outline',
  rosea: 'rose-outline',
};

export type RankEmblemVariant = 'hero' | 'medium' | 'compact';

/** Her varyantın ölçüsü — 8 pt ritmine yakın, tek yerde tanımlı. */
const VARIANTS: Record<RankEmblemVariant, { box: number; icon: number; radius: number; framed: boolean }> = {
  hero: { box: 56, icon: 30, radius: 16, framed: true },
  medium: { box: 30, icon: 18, radius: 9, framed: true },
  compact: { box: 16, icon: 14, radius: 0, framed: false },
};

type RankEmblemProps = {
  /** Yalnızca sunucudan gelen rank kimliği. */
  rankId: RankId;
  /** Çağıranın mevcut rank sabitlerinden çözdüğü semantik rank rengi. */
  color: string;
  variant?: RankEmblemVariant;
  /** Verilirse sembol tek başına anlam taşır; verilmezse dekoratiftir. */
  accessibilityLabel?: string;
};

export function RankEmblem({ accessibilityLabel, color, rankId, variant = 'medium' }: RankEmblemProps) {
  const { isDark } = useAppTheme();
  const tint = color;
  const spec = VARIANTS[variant];

  const containerStyle = useMemo(
    () =>
      spec.framed
        ? {
            alignItems: 'center' as const,
            backgroundColor: withAlpha(tint, isDark ? 0.18 : 0.12),
            borderColor: withAlpha(tint, isDark ? 0.34 : 0.24),
            borderRadius: spec.radius,
            borderWidth: StyleSheet.hairlineWidth,
            height: spec.box,
            justifyContent: 'center' as const,
            width: spec.box,
          }
        : {
            alignItems: 'center' as const,
            height: spec.box,
            justifyContent: 'center' as const,
            width: spec.box,
          },
    [isDark, spec, tint],
  );

  const a11y = accessibilityLabel
    ? { accessibilityLabel, accessibilityRole: 'image' as const, accessible: true }
    : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };

  return (
    <View style={containerStyle} {...a11y}>
      <Ionicons color={tint} name={RANK_EMBLEM_ICONS[rankId]} size={spec.icon} />
    </View>
  );
}
