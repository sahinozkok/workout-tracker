import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { AchievementSymbol } from '@/components/achievements/achievement-symbol';
import { Layout, ThemeColors } from '@/constants/theme';
import { useAchievements } from '@/context/achievement-context';
import { useTranslation } from '@/context/language-context';
import { useRanks } from '@/context/rank-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';

const PROFILE_ACCENT_DEFAULT = '#D5755B';
const AUTO_DISMISS_MS = 2600;

/**
 * KALICI BAŞARIM KUTLAMASI — sakin, tek katman overlay.
 *
 *   * Aynı başarım yalnız BİR KEZ kutlanır (baseline + onaylı küme context'te).
 *   * Sıradaki tek başarım gösterilir; birden fazla yeni açılış SAKİN KUYRUKLA
 *     sırayla akar (bir onaylanınca sonraki gelir).
 *   * ÖNCELİK: mevcut rank-up / sezon özeti / sezon başarı overlay'i AKTİFKEN
 *     kariyer kutlaması GÖSTERİLMEZ (onlar bitince gösterilir) — mevcut overlay
 *     önceliği korunur.
 *   * Reduce Motion'da sade fade (reanimated FadeIn/Out zaten hafif; RM'de
 *     süre kısalır ve büyük hareket yoktur).
 *   * Hesap izolasyonu context'te (owner guard + kullanıcı başına baseline).
 */
export function AchievementCelebrationOverlay() {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const { acknowledgeCelebration, celebration } = useAchievements();
  const { achievementCelebration, rankUp, seasonRecap } = useRanks();
  const accent = useFeatureColor('profile', PROFILE_ACCENT_DEFAULT).color;
  const reduceMotion = useReducedMotion();

  // Mevcut rank/sezon overlay'lerine ÖNCELİK: onlar aktifken kariyer kutlaması beklemede.
  const higherPriorityActive = Boolean(rankUp || seasonRecap || achievementCelebration);
  const visible = Boolean(celebration) && !higherPriorityActive;

  useEffect(() => {
    if (!visible || !celebration) return;
    const timer = setTimeout(() => acknowledgeCelebration(celebration), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [acknowledgeCelebration, celebration, visible]);

  if (!visible || !celebration) return null;
  const styles = createStyles(colors, isDark);

  return (
    <Animated.View
      entering={reduceMotion ? FadeIn.duration(120) : FadeIn.duration(260)}
      exiting={reduceMotion ? FadeOut.duration(100) : FadeOut.duration(220)}
      pointerEvents="box-none"
      style={styles.root}>
      <Pressable
        accessibilityHint={t('careerAchievements.detail.close')}
        accessibilityLabel={t(`careerAchievements.items.${celebration}.name`)}
        accessibilityRole="button"
        onPress={() => acknowledgeCelebration(celebration)}
        style={styles.backdrop}>
        <View style={styles.card}>
          <AchievementSymbol accent={accent} achievementKey={celebration} isUnlocked size={52} />
          <Text style={[styles.unlocked, { color: accent }]}>{t('careerAchievements.unlocked')}</Text>
          <Text style={styles.name}>{t(`careerAchievements.items.${celebration}.name`)}</Text>
          <Text numberOfLines={3} style={styles.desc}>
            {t(`careerAchievements.items.${celebration}.description`)}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function createStyles(colors: ThemeColors, isDark: boolean) {
  return StyleSheet.create({
    root: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 40 },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      backgroundColor: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)',
      justifyContent: 'center',
      paddingHorizontal: Layout.screenPadding,
    },
    card: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: Layout.radiusLarge,
      gap: 8,
      maxWidth: 320,
      paddingHorizontal: 28,
      paddingVertical: 28,
      width: '100%',
    },
    unlocked: { fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 6, textTransform: 'uppercase' },
    name: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
    desc: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  });
}
