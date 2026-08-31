import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { RankEmblem } from '@/components/ranks/rank-emblem';
import { withAlpha } from '@/constants/color-presets';
import { MotionDuration, MotionEasing } from '@/constants/motion';
import { RankId, RANK_IDS, RANK_TIERS } from '@/constants/ranks';
import { Layout } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * Kompakt sezonluk rank rozeti.
 *
 * Kimlik göstergesi olduğu için rengi SEMANTİKTİR: kullanıcının color preset
 * tercihi rank rengini değiştiremez. Zemin, seçilen tier renginin düşük
 * opaklıklı hâlidir; koyu temada biraz daha güçlü tutulur ki okunaklı kalsın.
 * Gradient, neon veya parlama efekti KULLANILMAZ.
 *
 * `onPress` verilmezse rozet salt gösterimdir (arkadaş profili). Verilirse
 * dokunma alanı en az 44 pt yüksekliğe çıkar.
 */

type RankBadgeProps = {
  /** Yalnızca sunucudan gelen rank kimliği. İstemci rank hesaplamaz. */
  rankId: RankId;
  /** Sunucudan gelen güncel RP. */
  rp: number;
  onPress?: () => void;
};

/** Rank adı çevirisi — component içinde sabit kullanıcı metni YOKTUR. */
export function useRankName() {
  const { t } = useTranslation();
  return (rankId: RankId) => t(`ranks.tier.${rankId}`);
}

export function getRankColor(rankId: RankId) {
  return (RANK_TIERS.find((tier) => tier.id === rankId) ?? RANK_TIERS[0]).color;
}

/** Açık/koyu temada okunabilir yumuşak zemin. Mevcut `withAlpha` yardımcısı. */
export function getRankSoftBackground(rankId: RankId, isDark: boolean) {
  return withAlpha(getRankColor(rankId), isDark ? 0.2 : 0.13);
}

export function RankBadge({ onPress, rankId, rp }: RankBadgeProps) {
  const { isDark } = useAppTheme();
  const { t } = useTranslation();
  const rankName = useRankName();
  const reduceMotion = useReducedMotion();

  const color = getRankColor(rankId);
  const styles = useMemo(
    () => createStyles(color, getRankSoftBackground(rankId, isDark), Boolean(onPress)),
    [color, isDark, onPress, rankId],
  );

  /**
   * Rank YÜKSELDİĞİNDE kısa bir ölçek geri bildirimi.
   *
   * Yalnızca gerçekten daha yüksek bir tier'a geçişte oynar; ilk yüklemede ve
   * rank düşüşünde oynamaz. Reduce Motion açıkken hiç çalışmaz. Yeni bir
   * animasyon altyapısı kurulmaz — mevcut motion tokenları kullanılır.
   */
  const scale = useSharedValue(1);
  const previousTierRef = useRef<number>(undefined);

  useEffect(() => {
    const tierIndex = RANK_IDS.indexOf(rankId);
    const previousTier = previousTierRef.current;
    previousTierRef.current = tierIndex;

    if (previousTier === undefined || tierIndex <= previousTier || reduceMotion) return;

    scale.value = withSequence(
      withTiming(1.06, { duration: MotionDuration.instant, easing: MotionEasing.standard }),
      withTiming(1, { duration: MotionDuration.fast, easing: MotionEasing.standard }),
    );
  }, [rankId, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: reduceMotion ? [] : [{ scale: scale.value }],
  }));

  const label = t('ranks.badgeA11y', { rank: rankName(rankId), rp });

  const content = (
    <Animated.View style={[styles.badge, animatedStyle]}>
      <RankEmblem color={color} rankId={rankId} variant="compact" />
      <Text numberOfLines={1} style={styles.rankText}>
        {rankName(rankId)}
      </Text>
      <Text numberOfLines={1} style={styles.rpText}>
        {t('ranks.rpValue', { rp })}
      </Text>
    </Animated.View>
  );

  if (!onPress) {
    return (
      <View accessibilityLabel={label} accessibilityRole="text" accessible>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint={t('ranks.badgeHint')}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.touchable, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

function createStyles(color: string, softBackground: string, isInteractive: boolean) {
  return StyleSheet.create({
    // Dokunulabilir rozette toplam alan 44 pt'ye çıkar (rozet 28 + 2×8 hitSlop
    // değil, gerçek yükseklikle: 44). Salt gösterimde ölçü kompakt kalır.
    touchable: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
    },
    badge: {
      alignItems: 'center',
      backgroundColor: softBackground,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 6,
      minHeight: isInteractive ? 32 : 28,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    rankText: { color, fontSize: 11, fontWeight: '600' },
    rpText: { color, fontSize: 11, fontWeight: '400', opacity: 0.85 },
    pressed: { opacity: 0.6 },
  });
}
