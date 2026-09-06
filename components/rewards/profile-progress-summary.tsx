import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { LevelRoseEmblem } from '@/components/rewards/level-rose-emblem';
import { MAX_LEVEL } from '@/constants/level-curve';
import { resolveDisplayedRose } from '@/constants/level-roses';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

type ProfileProgressSummaryProps = {
  accentColor: string;
  level: number;
  /** Kendi profilde verilir: Level satırı gül seçim penceresini açar. */
  onLevelPress?: () => void;
  /**
   * Kullanıcının SEÇTİĞİ seviye gülü kimliği (kalıcı tercih). `null`/tanımsız =
   * otomatik mod → en yüksek açılmış gül. Manuel seçim seviye atlayınca
   * KENDİLİĞİNDEN değişmez; gerçek seviye `level` prop'unda ayrı taşınır.
   */
  selectedRoseId?: string | null;
  /**
   * BAŞKA kullanıcı (arkadaş) profilinde gül tercihi AYRI okunduğunda kullanılır:
   * `loading` = tercih henüz gelmedi, `unavailable` = okunamadı (RPC eksik / ağ /
   * erişim / geçersiz). İkisinde de gül GÖSTERİLMEZ (nötr placeholder) — arkadaşın
   * SEÇMEDİĞİ bir gül sembolü çizilmez; "Level N" metni korunur. Verilmezse
   * (kendi profilimiz) mevcut otomatik davranış aynen sürer.
   */
  levelRoseState?: 'loading' | 'unavailable';
  xpForNextLevel: number;
  xpIntoLevel: number;
};

/**
 * PROFİL İLERLEME BLOĞU — referanstaki gibi TEK dikey akış:
 *   1. Level satırı: küçük gerçek seviye gülü + "Level N" (sola hizalı).
 *   2. İnce yatay XP çubuğu + altında "Sonraki seviye · {current} / {next} XP".
 *
 * RANK ARTIK BURADA DEĞİL — eski iki sütunlu Level/Rank kimliği KALDIRILDI; rank
 * aşağıdaki "Success" bölümüne (ProfileCareerShowcase) taşındı. Eski büyük 38 pt
 * XP sayısı da yoktur; sunum sakin ve Level odaklıdır.
 */
export function ProfileProgressSummary({
  accentColor,
  level,
  levelRoseState,
  onLevelPress,
  selectedRoseId,
  xpForNextLevel,
  xpIntoLevel,
}: ProfileProgressSummaryProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors, accentColor);
  const isMaxLevel = level >= MAX_LEVEL || xpForNextLevel <= 0;
  const progress = isMaxLevel
    ? 1
    : Math.min(1, Math.max(0, xpIntoLevel / Math.max(1, xpForNextLevel)));

  /**
   * SEVİYE GÜLÜ — Level satırında, "Level N" metninin solunda. Görünür gül 32 pt;
   * arkasında daire/çerçeve/tint/glow YOKTUR (kendi renkleri korunur). Arkadaş
   * profilinde tercih henüz bilinmiyor/okunamadıysa TAHMİNİ gül çizilmez, nötr
   * placeholder gösterilir. Gül tek bir yerde render edilir.
   */
  const levelRoseVisual =
    levelRoseState === 'loading' ? (
      <ActivityIndicator color={colors.textTertiary} size="small" />
    ) : levelRoseState === 'unavailable' ? (
      <Ionicons color={colors.textTertiary} name="flower-outline" size={28} />
    ) : (
      <LevelRoseEmblem roseId={resolveDisplayedRose(level, selectedRoseId ?? undefined).id} size={32} />
    );

  /**
   * Level satırı — kendi profilde bütün satır (≥44 pt) gül seçicisini açar;
   * arkadaş profilinde salt okunur (View). NESTED Pressable yoktur.
   */
  const levelRow = (
    <View style={styles.levelInner}>
      <View style={styles.levelRoseSpot}>{levelRoseVisual}</View>
      <Text numberOfLines={1} style={styles.levelValue}>
        {t('rewards.levelLabel', { level })}
      </Text>
    </View>
  );

  return (
    <View style={styles.root}>
      {onLevelPress ? (
        <Pressable
          accessibilityHint={t('rewards.info.levelOpenHint')}
          accessibilityLabel={t('rewards.levelLabel', { level })}
          accessibilityRole="button"
          onPress={onLevelPress}
          style={({ pressed }) => [styles.levelRow, pressed && styles.pressed]}>
          {levelRow}
        </Pressable>
      ) : (
        <View accessibilityLabel={t('rewards.levelLabel', { level })} accessible style={styles.levelRow}>
          {levelRow}
        </View>
      )}

      <View style={styles.xpBlock}>
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
          <Text style={styles.progressDot}> · </Text>
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
    root: { gap: 14, width: '100%' },
    // Level satırı sola hizalı; bütün satır ≥44 pt dokunma alanı (gül seçici).
    levelRow: { alignSelf: 'flex-start', minHeight: Layout.minTouchSize, justifyContent: 'center' },
    levelInner: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    // Görünür gül 32 pt; slot 34 pt. Daire/çerçeve/tint YOK.
    levelRoseSpot: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 },
    levelValue: { color: colors.text, fontSize: 19, fontWeight: '500', lineHeight: 24 },
    xpBlock: { gap: 8, width: '100%' },
    progressTrack: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 2,
      height: 4,
      overflow: 'hidden',
      width: '100%',
    },
    progressFill: { backgroundColor: accentColor, borderRadius: 2, height: '100%' },
    progressFooter: { alignItems: 'center', flexDirection: 'row' },
    progressLabel: { color: colors.textSecondary, ...Type.caption },
    progressDot: { color: colors.textTertiary, ...Type.caption },
    progressValue: {
      color: colors.textSecondary,
      fontSize: 13,
      fontVariant: ['tabular-nums'],
      fontWeight: '500',
    },
    pressed: { opacity: 0.6 },
  });
}
