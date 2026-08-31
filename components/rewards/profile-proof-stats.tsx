import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

type ProfileProofStatsProps = {
  /** Eyebrow (`A LITTLE PROOF`) rengi. Verilmezse bugünkü ton korunur. */
  accentColor?: string;
  dayStreak: number;
  /** Verilirse YALNIZ seri istatistiği basılabilir olur; diğer ikisi değişmez. */
  onDayStreakPress?: () => void;
  roseBalance: number;
  workoutDays: number;
};

type ProofStatProps = {
  accessibilityLabel: string;
  backgroundColor: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  value: number;
};

/** Referanstaki kompakt üçlü profil kanıtı: gül, antrenman ve seri. */
export function ProfileProofStats({
  accentColor,
  dayStreak,
  onDayStreakPress,
  roseBalance,
  workoutDays,
}: ProfileProofStatsProps) {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: { gap: 10, paddingHorizontal: 4, paddingVertical: 4, width: '100%' },
        header: {
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        eyebrow: {
          color: accentColor ?? (isDark ? '#D8A09C' : '#B67F7C'),
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 1.35,
        },
        row: {
          alignItems: 'center',
          flexDirection: 'row',
        },
        stat: {
          alignItems: 'center',
          flex: 1,
          flexDirection: 'row',
          gap: 8,
          minHeight: 44,
          minWidth: 0,
        },
        pressed: { opacity: 0.6 },
        iconCircle: {
          alignItems: 'center',
          borderRadius: 16,
          height: 32,
          justifyContent: 'center',
          width: 32,
        },
        statCopy: { flex: 1, gap: 2, minWidth: 0 },
        value: {
          color: colors.text,
          fontSize: 17,
          fontVariant: ['tabular-nums'],
          fontWeight: '600',
          lineHeight: 20,
        },
        label: {
          color: colors.textSecondary,
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.4,
          lineHeight: 13,
          textTransform: 'uppercase',
        },
      }),
    [accentColor, colors.text, colors.textSecondary, isDark],
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{t('profile.proofTitle')}</Text>
        <Ionicons color={isDark ? '#9CB79A' : '#6F906D'} name="leaf-outline" size={13} />
      </View>

      <View style={styles.row}>
        <ProofStat
          accessibilityLabel={t('profile.proofRosesA11y', { count: roseBalance })}
          backgroundColor="#F3DDD7"
          color="#C86E61"
          icon="heart"
          label={t('profile.proofRoses')}
          value={roseBalance}
        />
        <ProofStat
          accessibilityLabel={t('profile.proofWorkoutDaysA11y', { count: workoutDays })}
          backgroundColor="#DFEBDD"
          color="#7C9978"
          icon="radio-button-on-outline"
          label={t('profile.proofWorkoutDays')}
          value={workoutDays}
        />
        <ProofStat
          accessibilityLabel={
            onDayStreakPress
              ? t('profile.proofDayStreakOpenA11y', { count: dayStreak })
              : t('profile.proofDayStreakA11y', { count: dayStreak })
          }
          backgroundColor="#F5E7C5"
          color="#BD9147"
          icon="flame-outline"
          label={t('profile.proofDayStreak')}
          onPress={onDayStreakPress}
          value={dayStreak}
        />
      </View>
    </View>
  );

  function ProofStat({
    accessibilityLabel,
    backgroundColor,
    color,
    icon,
    label,
    onPress,
    value,
  }: ProofStatProps) {
    const content = (
      <>
        <View style={[styles.iconCircle, { backgroundColor }]}>
          <Ionicons color={color} name={icon} size={16} />
        </View>
        <View style={styles.statCopy}>
          <Text style={styles.value}>{value}</Text>
          <Text adjustsFontSizeToFit minimumFontScale={0.85} numberOfLines={1} style={styles.label}>
            {label}
          </Text>
        </View>
      </>
    );

    // Yalnız seri alanına `onPress` gelir; buton olur. Görsel yükseklik
    // değişmez — 44 pt dokunma alanı `hitSlop` ile sağlanır, böylece istatistik
    // komşularından görsel olarak kopmaz.
    if (onPress) {
      return (
        <Pressable
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="button"
          hitSlop={{ bottom: 8, left: 6, right: 6, top: 8 }}
          onPress={onPress}
          style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>
          {content}
        </Pressable>
      );
    }

    return (
      <View accessibilityLabel={accessibilityLabel} accessible style={styles.stat}>
        {content}
      </View>
    );
  }
}
