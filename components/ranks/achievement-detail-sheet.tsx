import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ACHIEVEMENT_ICONS } from '@/components/ranks/achievement-icons';
import { getOnAccentColor, withAlpha } from '@/constants/color-presets';
import { MotionDuration, MotionEasing } from '@/constants/motion';
import { SeasonAchievementKey } from '@/constants/rank-experience';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { SeasonAchievement } from '@/types/ranks';

/**
 * ROZET AYRINTI PENCERESİ.
 *
 * Bilinçli sınırlar:
 *  - Bu pencere hiçbir başarı koşulu HESAPLAMAZ ve RP, XP, level veya gül
 *    ÜRETMEZ. Bütün değerler `SeasonAchievement` içindeki sunucu alanlarıdır:
 *    `currentProgress`, `targetProgress`, `isUnlocked`, `unlockedAt`.
 *  - Hedef sayıları burada veya çeviri dosyalarında SABİTLENMEZ; ekranda
 *    görünen her sayı sunucu cevabından gelir.
 *  - Ham `achievement_key`, kullanıcı kimliği, RPC adı veya metadata
 *    GÖSTERİLMEZ; anahtar yalnızca çeviri ve ikon aramasında kullanılır.
 *  - Yeni gradient, görsel, ses veya paket YOKTUR: mevcut Ionicons seti,
 *    mevcut tema renkleri ve mevcut motion tokenları kullanılır. Güçlü vurgu
 *    rengi çağıranın verdiği RANK rengidir.
 *
 * TİPOGRAFİ — dört boyut (17 / 15 / 13 / 11) ve iki ağırlık (600 / 400);
 * rank ekranının düzeniyle aynıdır.
 */

/**
 * Kalan miktar cümlesinin BİRİMİ.
 *
 * Yalnızca ölçü adıdır — hiçbir hedef veya eşik sayısı taşımaz. Kalan sayının
 * kendisi sunucudan gelen `targetProgress` ve `currentProgress` farkıdır.
 */
type RemainingUnit = 'workout' | 'day' | 'perfectWeek';

const REMAINING_UNIT: Record<SeasonAchievementKey, RemainingUnit> = {
  first_workout: 'workout',
  workout_5: 'workout',
  workout_15: 'workout',
  streak_3: 'day',
  streak_7: 'day',
  /**
   * Kusursuz hafta GÜN saymaz: ilerlemesi tamamlanmış HAFTA sayısıdır.
   * `day` birimiyle "3 gün kaldı" gibi yanlış bir cümle üretilirdi.
   */
  perfect_week: 'perfectWeek',
};

/** Perde opaklığı — mevcut rank katmanlarından hafif, çünkü bu bir kutlama değil. */
const SCRIM_ALPHA = { dark: 0.5, light: 0.28 } as const;

/** Giriş ölçeği: 0.97 → 1. Gösterişli değil, yalnızca hafif bir yerleşme. */
const ENTER_SCALE = 0.97;

export type AchievementDetailSheetProps = {
  /** Rank rengi — tek güçlü vurgu. */
  accent: string;
  /** Gösterilecek rozet; `undefined` iken pencere kapalıdır. */
  achievement?: SeasonAchievement;
  onClose: () => void;
  /**
   * Kazanılma tarihinin BİÇİMLENMİŞ hâli.
   *
   * Biçimlendirme rank ekranındaki mevcut yardımcıyla yapılır; tarih mantığı
   * burada KOPYALANMAZ. Okunamayan bir zaman damgasında `undefined` gelir ve
   * satır hiç gösterilmez.
   */
  unlockedLabel?: string;
};

export function AchievementDetailSheet({
  accent,
  achievement,
  onClose,
  unlockedLabel,
}: AchievementDetailSheetProps) {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const styles = createStyles(colors);

  const progress = useSharedValue(0);
  const isOpen = achievement !== undefined;

  useEffect(() => {
    if (!isOpen) {
      progress.value = 0;
      return;
    }

    progress.value = 0;
    progress.value = withTiming(1, {
      // Reduce Motion: giriş animasyonu yok, içerik anında yerinde.
      duration: reduceMotion ? MotionDuration.instant : MotionDuration.standard,
      easing: MotionEasing.standard,
    });

    return () => cancelAnimation(progress);
  }, [isOpen, progress, reduceMotion]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    // Reduce Motion: hareket yok, yalnızca opaklık.
    transform: reduceMotion ? [] : [{ scale: ENTER_SCALE + (1 - ENTER_SCALE) * progress.value }],
  }));

  if (!achievement) return null;

  const { currentProgress, isUnlocked, key, targetProgress } = achievement;
  const name = t(`ranks.achievements.items.${key}.name`);
  const description = t(`ranks.achievements.items.${key}.description`);
  const status = isUnlocked
    ? t('ranks.achievements.detail.statusUnlocked')
    : t('ranks.achievements.detail.statusInProgress');

  /**
   * KALAN MİKTAR — ilerleme yeniden hesaplanmaz.
   *
   * Sunucunun verdiği iki alanın farkıdır; hiçbir eşik istemcide saklanmaz.
   * Sunucu beklenmedik biçimde hedefi aşmış bir ilerleme döndürürse negatif
   * sayı gösterilmez.
   */
  const remaining = Math.max(0, targetProgress - currentProgress);
  const unit = REMAINING_UNIT[key];
  const remainingLabel = t(
    remaining === 1
      ? `ranks.achievements.detail.remaining.${unit}One`
      : `ranks.achievements.detail.remaining.${unit}Other`,
    { count: remaining },
  );

  return (
    <Modal
      // Animasyonu paylaşılan değerle kendimiz sürüyoruz.
      animationType="none"
      // Android donanım geri tuşu.
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible>
      <Animated.View
        style={[
          styles.root,
          { backgroundColor: withAlpha('#000000', isDark ? SCRIM_ALPHA.dark : SCRIM_ALPHA.light) },
          scrimStyle,
        ]}>
        {/*
          Arka plana dokunma da kapatır. Ekran okuyucu için gizlidir: kapatma
          eylemi aşağıdaki gerçek düğmeden yapılır, dev bir isimsiz düğme
          duyurulmaz.
         */}
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />

        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.separator },
            cardStyle,
          ]}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            // Küçük iPhone ekranlarında içeriğin tamamı erişilebilir kalır.
            bounces={false}>
            <View
              style={[
                styles.iconWrap,
                {
                  backgroundColor: isUnlocked
                    ? withAlpha(accent, isDark ? 0.2 : 0.12)
                    : colors.surfaceMuted,
                },
              ]}>
              <Ionicons
                color={isUnlocked ? accent : colors.textTertiary}
                name={ACHIEVEMENT_ICONS[key]}
                size={26}
              />
            </View>

            <Text accessibilityRole="header" style={styles.name}>
              {name}
            </Text>

            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor: isUnlocked
                    ? withAlpha(accent, isDark ? 0.2 : 0.12)
                    : colors.surfaceMuted,
                },
              ]}>
              <Text style={[styles.statusText, isUnlocked && { color: accent }]}>{status}</Text>
            </View>

            <Text style={styles.description}>{description}</Text>

            <View style={styles.rows}>
              <DetailRow
                isLast={!isUnlocked && remaining === 0}
                label={t('ranks.achievements.detail.progressLabel')}
                styles={styles}
                value={t('ranks.achievements.progress', {
                  current: currentProgress,
                  target: targetProgress,
                })}
              />

              {/* Kilitli rozette kalan miktar; açılmış rozette kazanılma tarihi. */}
              {!isUnlocked && remaining > 0 ? (
                <DetailRow
                  isLast
                  label={t('ranks.achievements.detail.remainingLabel')}
                  styles={styles}
                  value={remainingLabel}
                />
              ) : null}

              {isUnlocked && unlockedLabel ? (
                <DetailRow
                  isLast
                  label={t('ranks.achievements.detail.unlockedAtLabel')}
                  styles={styles}
                  value={unlockedLabel}
                />
              ) : null}
            </View>

            <Pressable
              accessibilityLabel={t('ranks.achievements.detail.closeA11y')}
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: accent },
                pressed && styles.closeButtonPressed,
              ]}>
              <Text style={[styles.closeText, { color: getOnAccentColor(accent) }]}>
                {t('ranks.achievements.detail.close')}
              </Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/** Etiket + değer satırı — rank ekranındaki istatistik satırıyla aynı düzen. */
function DetailRow({
  isLast = false,
  label,
  styles,
  value,
}: {
  isLast?: boolean;
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  return (
    <View style={[styles.row, isLast && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: Layout.screenPadding,
    },
    /** Tam ekran bir sayfa DEĞİL: ortada, sınırlı yükseklikte bir kart. */
    card: {
      borderRadius: Layout.radiusLarge,
      borderWidth: StyleSheet.hairlineWidth,
      maxHeight: '80%',
      maxWidth: 360,
      overflow: 'hidden',
      width: '100%',
    },
    content: { alignItems: 'center', gap: 12, padding: 20 },

    iconWrap: {
      alignItems: 'center',
      borderRadius: 26,
      height: 52,
      justifyContent: 'center',
      width: 52,
    },
    name: { color: colors.text, fontSize: 17, fontWeight: '600', textAlign: 'center' },

    statusPill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
    statusText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },

    description: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '400',
      lineHeight: 19,
      textAlign: 'center',
    },

    rows: { alignSelf: 'stretch', marginTop: 4 },
    row: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    rowLast: { borderBottomWidth: 0 },
    rowLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 13, fontWeight: '400' },
    /** Uzun TR/EN değerleri sarar; sabit genişlik yok, taşma olmaz. */
    rowValue: {
      color: colors.text,
      flexShrink: 1,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'right',
    },

    closeButton: {
      alignItems: 'center',
      alignSelf: 'stretch',
      borderRadius: Layout.radiusMedium,
      justifyContent: 'center',
      marginTop: 4,
      minHeight: Layout.minTouchSize,
    },
    closeButtonPressed: { opacity: 0.92 },
    closeText: { fontSize: 15, fontWeight: '600' },
  });
}
