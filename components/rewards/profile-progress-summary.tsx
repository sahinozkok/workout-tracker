import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RANK_EMBLEM_ICONS } from '@/components/ranks/rank-emblem';
import { getRankColor, useRankName } from '@/components/ranks/rank-badge';
import { MAX_LEVEL } from '@/constants/level-curve';
import { RankId } from '@/constants/ranks';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

type ProfileProgressSummaryProps = {
  accentColor: string;
  level: number;
  onRankPress?: () => void;
  rank?: { id: RankId; rp: number };
  xpForNextLevel: number;
  xpIntoLevel: number;
};

/** Referanstaki düz Level/Rank kimliği ile yatay XP akışını tek yerde kurar. */
export function ProfileProgressSummary({
  accentColor,
  level,
  onRankPress,
  rank,
  xpForNextLevel,
  xpIntoLevel,
}: ProfileProgressSummaryProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const rankName = useRankName();
  const styles = createStyles(colors, accentColor);
  const isMaxLevel = level >= MAX_LEVEL || xpForNextLevel <= 0;
  const progress = isMaxLevel
    ? 1
    : Math.min(1, Math.max(0, xpIntoLevel / Math.max(1, xpForNextLevel)));

  const rankContent = rank ? (
    <>
      <View style={[styles.identityIcon, { borderColor: getRankColor(rank.id) }]}>
        <Ionicons color={getRankColor(rank.id)} name={RANK_EMBLEM_ICONS[rank.id]} size={23} />
      </View>
      <Text numberOfLines={1} style={styles.identityValue}>
        {rankName(rank.id)} · {t('ranks.rpValue', { rp: rank.rp })}
      </Text>
    </>
  ) : (
    <>
      <View style={styles.identityIcon}>
        <Ionicons color={colors.textTertiary} name="shield-outline" size={23} />
      </View>
      <Text numberOfLines={1} style={[styles.identityValue, styles.identityValueMuted]}>
        {t('ranks.unranked')}
      </Text>
    </>
  );

  return (
    <View style={styles.root}>
      <View style={styles.identityRow}>
        <View accessibilityLabel={t('rewards.levelLabel', { level })} accessible style={styles.identityCell}>
          <View style={styles.identityIcon}>
            <Ionicons color={accentColor} name="star" size={23} />
          </View>
          <Text numberOfLines={1} style={styles.identityValue}>
            {t('rewards.levelLabel', { level })}
          </Text>
        </View>

        <View style={styles.identityDivider} />

        {onRankPress && rank ? (
          <Pressable
            accessibilityLabel={`${rankName(rank.id)}, ${t('ranks.rpValue', { rp: rank.rp })}`}
            accessibilityRole="button"
            onPress={onRankPress}
            style={({ pressed }) => [styles.identityCell, pressed && styles.pressed]}>
            {rankContent}
          </Pressable>
        ) : (
          <View style={styles.identityCell}>{rankContent}</View>
        )}
      </View>

      <View style={styles.divider} />

      <View style={styles.rhythm}>
        <Text style={styles.eyebrow}>{t('rewards.levelCardEyebrow')}</Text>
        <View style={styles.xpRow}>
          <Ionicons color={accentColor} name="flash" size={28} />
          <Text style={styles.xpValue}>{isMaxLevel ? level : xpIntoLevel}</Text>
          <Text style={styles.xpUnit}>{isMaxLevel ? t('rewards.levelMaxValue') : 'XP'}</Text>
        </View>

        <View
          accessibilityLabel={
            isMaxLevel
              ? t('rewards.progressMaxA11y', { level })
              : t('rewards.progressA11y', { current: xpIntoLevel, level, next: xpForNextLevel })
          }
          accessibilityRole="progressbar"
          accessibilityValue={{ max: 100, min: 0, now: Math.round(progress * 100) }}
          style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        <View style={styles.progressFooter}>
          <Text style={styles.progressLabel}>
            {isMaxLevel ? t('rewards.maximumLevelReached') : t('rewards.levelCardNext')}
          </Text>
          <Text style={styles.progressValue}>
            {isMaxLevel
              ? t('rewards.levelLabel', { level })
              : t('rewards.levelXpValue', { current: xpIntoLevel, next: xpForNextLevel })}
          </Text>
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    root: { width: '100%' },
    identityRow: { alignItems: 'center', flexDirection: 'row', minHeight: 116 },
    identityCell: {
      alignItems: 'center',
      flex: 1,
      gap: 10,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      minWidth: 0,
    },
    identityIcon: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: 28,
      borderWidth: StyleSheet.hairlineWidth,
      height: 56,
      justifyContent: 'center',
      width: 56,
    },
    identityDivider: { backgroundColor: colors.separator, height: 48, width: StyleSheet.hairlineWidth },
    identityValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
    identityValueMuted: { color: colors.textSecondary },
    divider: { backgroundColor: colors.separator, height: StyleSheet.hairlineWidth },
    rhythm: { gap: 16, paddingVertical: 28 },
    eyebrow: {
      color: accentColor,
      ...Type.eyebrow,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    xpRow: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
    xpValue: {
      color: colors.text,
      fontSize: 44,
      fontVariant: ['tabular-nums'],
      fontWeight: '600',
      lineHeight: 48,
    },
    xpUnit: { color: colors.textSecondary, fontSize: 17, fontWeight: '600' },
    progressTrack: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 2,
      height: 4,
      overflow: 'hidden',
      width: '100%',
    },
    progressFill: { backgroundColor: accentColor, borderRadius: 2, height: '100%' },
    progressFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    progressLabel: { color: colors.textSecondary, ...Type.caption },
    progressValue: {
      color: colors.text,
      fontSize: 13,
      fontVariant: ['tabular-nums'],
      fontWeight: '600',
    },
    pressed: { opacity: 0.6 },
  });
}
