import { usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionSection } from '@/components/motion-section';
import { getRankColor, getRankSoftBackground, useRankName } from '@/components/ranks/rank-badge';
import { withAlpha } from '@/constants/color-presets';
import { MotionDuration, MotionEasing, MotionStagger } from '@/constants/motion';
import { canShowRankCelebration } from '@/constants/rank-experience';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useRanks } from '@/context/rank-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { SeasonRecap } from '@/types/ranks';
import { dateFromKey } from '@/utils/workout-schedule';

/**
 * SEZON SONU ÖZETİ — uygulama genelinde **tek** katman.
 *
 * Bilinçli sınırlar:
 *  - Bütün sayılar sunucudan gelir. Bu katman hiçbir RP, rank veya soft reset
 *    değeri HESAPLAMAZ; sunucu verisi eksik/tutarsızsa özet hiç oluşturulmaz
 *    (bkz. `decideSeasonRecap`).
 *  - Aktif antrenman/set giriş ekranında ve oturum akışı ekranlarında
 *    GÖSTERİLMEZ. Özet düşürülmez, **bekletilir**.
 *  - Rank yükselme kutlamasıyla ASLA üst üste açılmaz: bekleyen bir kutlama
 *    varsa önce o gösterilir, özet sırasını bekler.
 *  - Kalıcı kayıt yalnızca overlay gerçekten görünmeye başladığında yazılır.
 *  - Yeni görsel, paket veya tasarım dili eklenmez: rank ekranının tipografi,
 *    boşluk, radius ve renk sistemi aynen kullanılır.
 */

/** Ölçek yalnızca bu kadar oynar: 0.96 → 1. Rank kutlamasıyla aynı. */
const ENTER_SCALE = 0.96;

/** Perde opaklığı — rank kutlamasıyla aynı değerler. */
const SCRIM_ALPHA = { dark: 0.66, light: 0.38 } as const;

export function SeasonRecapLayer() {
  const { colors, isDark } = useAppTheme();
  const { locale, t } = useTranslation();
  const rankName = useRankName();
  const { acknowledgeSeasonRecapShown, dismissSeasonRecap, rankUp, seasonRecap } = useRanks();
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  /** Gösterilen özetin kopyası: açıkken içerik değişip titremez. */
  const [shown, setShown] = useState<SeasonRecap>();
  /** Kapanış animasyonu sürerken ikinci kez kapatılmaz. */
  const isClosingRef = useRef(false);
  /**
   * Layout onayı verilmiş özetin kapanmış sezon numarası.
   *
   * `onLayout` döndürme, yazı tipi ölçeği ve içerik boyu değişiminde yeniden
   * çağrılabilir; bu ref aynı overlay için ikinci bir yazma isteği üretilmesini
   * önler. Context tarafındaki `acknowledgedRecapRef` ikinci bir güvenlik
   * katmanıdır, tek koruma değildir.
   */
  const layoutAcknowledgedRef = useRef<number>(undefined);

  const progress = useSharedValue(0);
  const isSafeScreen = canShowRankCelebration(pathname);

  useEffect(() => {
    // Süren özet varken yenisi başlamaz; güvenli olmayan ekranda beklenir.
    if (shown || !seasonRecap || !isSafeScreen) return;
    // ÖNCELİK: bekleyen rank yükselmesi varsa önce o gösterilir. Kutlama
    // kapandığında `rankUp` temizlenir ve özet sırası gelir.
    if (rankUp) return;

    /**
     * Bu effect YALNIZCA kapıları geçip `shown` state'ini ayarlar.
     *
     * Kalıcı gösterim onayı BURADA VERİLMEZ: `setShown` yalnızca bir sonraki
     * render'ı planlar, dolayısıyla buradan yazılan kayıt overlay hiç
     * render/layout olmadan da diske düşebilirdi. Onay, kart gerçekten
     * mount/layout olduğunda `handleCardLayout` üzerinden verilir.
     */
    setShown(seasonRecap);
    isClosingRef.current = false;
  }, [isSafeScreen, rankUp, seasonRecap, shown]);

  useEffect(() => {
    if (!shown) return;

    progress.value = 0;
    progress.value = withTiming(1, {
      duration: reduceMotion ? MotionDuration.instant : MotionDuration.standard,
      easing: MotionEasing.standard,
    });

    // Katman kapanırsa/unmount olursa süren animasyon kesin olarak durdurulur.
    return () => cancelAnimation(progress);
  }, [progress, reduceMotion, shown]);

  /**
   * Overlay GERÇEKTEN mount/layout oldu → kalıcı gösterim onayı.
   *
   * "Başla" düğmesi BEKLENMEZ. Kullanıcı overlay layout edilmeden uygulamayı
   * kapatırsa kayıt yazılmadığı için özet sonraki açılışta yeniden çıkar;
   * layout edildikten sonra kapatırsa tekrar çıkmaz.
   *
   * Context tarafındaki kimlik, hesap ve sezon guard'ları aynen geçerlidir;
   * depo hatası yutulduğu için bu çağrı özeti veya navigasyonu bozamaz.
   */
  const handleCardLayout = useCallback(() => {
    const current = shown;
    if (!current) return;

    const closedSeasonIndex = current.archive.seasonIndex;
    if (layoutAcknowledgedRef.current === closedSeasonIndex) return;
    layoutAcknowledgedRef.current = closedSeasonIndex;

    void acknowledgeSeasonRecapShown(closedSeasonIndex);
  }, [acknowledgeSeasonRecapShown, shown]);

  /** Kapanış animasyonu bittiğinde çalışır; JS tarafında tek temizlik noktası. */
  const handleClosed = useCallback(
    (closedSeasonIndex: number) => {
      isClosingRef.current = false;
      layoutAcknowledgedRef.current = undefined;
      setShown(undefined);
      dismissSeasonRecap(closedSeasonIndex);
    },
    [dismissSeasonRecap],
  );

  const handleStart = useCallback(() => {
    const current = shown;
    if (!current || isClosingRef.current) return;
    isClosingRef.current = true;

    const closedSeasonIndex = current.archive.seasonIndex;
    progress.value = withTiming(
      0,
      {
        duration: reduceMotion ? MotionDuration.instant : MotionDuration.fast,
        easing: MotionEasing.standard,
      },
      () => {
        'worklet';
        runOnJS(handleClosed)(closedSeasonIndex);
      },
    );
  }, [handleClosed, progress, reduceMotion, shown]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    // Reduce Motion: hareket yok, yalnızca opaklık.
    transform: reduceMotion ? [] : [{ scale: ENTER_SCALE + (1 - ENTER_SCALE) * progress.value }],
  }));

  if (!shown) return null;

  const { archive } = shown;
  const accent = getRankColor(archive.finalRank);
  const seasonLabel = archive.themeName ?? t('ranks.seasonName', { index: archive.seasonIndex });

  return (
    <Animated.View
      accessibilityViewIsModal
      style={[
        styles.layer,
        {
          backgroundColor: withAlpha('#000000', isDark ? SCRIM_ALPHA.dark : SCRIM_ALPHA.light),
          paddingBottom: insets.bottom + Layout.screenPadding,
          paddingTop: insets.top + Layout.screenPadding,
        },
        scrimStyle,
      ]}>
      <Animated.View onLayout={handleCardLayout} style={[styles.card, cardStyle]}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          <MotionSection style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {t('ranks.seasonRecap.title')}
            </Text>
            <Text style={styles.subtitle}>{seasonLabel}</Text>
            <Text style={styles.dateRange}>
              {formatRange(archive.startsOn, archive.endsOn, locale)}
            </Text>
          </MotionSection>

          <MotionSection delay={MotionStagger.step}>
            <View
              accessibilityLabel={t('ranks.seasonRecap.a11y', {
                rank: rankName(archive.finalRank),
                rp: archive.finalRp,
                season: seasonLabel,
                startingRp: shown.startingRp,
              })}
              accessible
              style={[
                styles.finalCard,
                { backgroundColor: getRankSoftBackground(archive.finalRank, isDark) },
              ]}>
              <Text style={styles.finalLabel}>{t('ranks.seasonRecap.finalRank')}</Text>
              <View style={styles.finalRow}>
                <View style={styles.finalRankGroup}>
                  <View style={[styles.dot, { backgroundColor: accent }]} />
                  <Text numberOfLines={1} style={[styles.finalRank, { color: accent }]}>
                    {rankName(archive.finalRank)}
                  </Text>
                </View>
                <Text numberOfLines={1} style={[styles.finalRp, { color: accent }]}>
                  {t('ranks.rpValue', { rp: archive.finalRp })}
                </Text>
              </View>
            </View>
          </MotionSection>

          <MotionSection delay={MotionStagger.step * 2}>
            <StatRow
              label={t('ranks.peakRank')}
              styles={styles}
              value={rankName(archive.peakRank)}
            />
            <StatRow
              label={t('ranks.workouts')}
              styles={styles}
              value={String(archive.workoutsCompleted)}
            />
            <StatRow
              label={t('ranks.planCompletion')}
              styles={styles}
              value={t('ranks.planCompletionValue', {
                done: archive.scheduledDaysCompleted,
                percent: shown.planCompletionPercent,
                total: archive.scheduledDaysTotal,
              })}
            />
            <StatRow
              isLast
              label={t('ranks.longestStreak')}
              styles={styles}
              value={t('ranks.dayCount', { count: archive.longestStreak })}
            />
          </MotionSection>

          <MotionSection delay={MotionStagger.step * 3} style={styles.resetBlock}>
            <Text style={styles.resetLabel}>{t('ranks.seasonRecap.softReset')}</Text>
            <Text style={[styles.resetValue, { color: accent }]}>
              {t('ranks.seasonRecap.softResetValue', {
                from: archive.finalRp,
                to: shown.startingRp,
              })}
            </Text>
            <Text style={styles.resetFootnote}>
              {t('ranks.seasonRecap.nextSeason', {
                season: t('ranks.seasonName', { index: shown.nextSeasonIndex }),
              })}
            </Text>
          </MotionSection>
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          onPress={handleStart}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
          <Text style={styles.buttonText}>{t('ranks.seasonRecap.start')}</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function StatRow({
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
    <View
      accessibilityLabel={`${label}: ${value}`}
      accessible
      style={[styles.statRow, isLast && styles.statRowLast]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.statValue}>
        {value}
      </Text>
    </View>
  );
}

/** `YYYY-MM-DD` çifti → yerelleştirilmiş aralık. Rank ekranıyla aynı biçim. */
function formatRange(startsOn: string, endsOn: string, locale: string) {
  const options = { day: 'numeric', month: 'short' } as const;
  const start = dateFromKey(startsOn).toLocaleDateString(locale, options);
  const end = dateFromKey(endsOn).toLocaleDateString(locale, { ...options, year: 'numeric' });
  return `${start} – ${end}`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    layer: {
      alignItems: 'center',
      bottom: 0,
      justifyContent: 'center',
      left: 0,
      paddingHorizontal: Layout.screenPadding,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.separator,
      borderRadius: Layout.radiusLarge,
      borderWidth: StyleSheet.hairlineWidth,
      // Kart ekranı doldurmaz: uzun içerikte büyümek yerine içerik kayar.
      flexShrink: 1,
      maxWidth: 360,
      padding: 24,
      width: '100%',
    },
    // Küçük ekranda içerik kırpılmaz: kart büyümek yerine içerik kayar.
    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: { gap: 20 },

    header: { gap: 4 },
    title: { color: colors.text, fontSize: 17, fontWeight: '600' },
    subtitle: { color: colors.text, fontSize: 15, fontWeight: '400' },
    dateRange: { color: colors.textSecondary, fontSize: 13, fontWeight: '400' },

    finalCard: { borderRadius: Layout.radiusMedium, gap: 8, padding: 16 },
    finalLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
    finalRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
    },
    finalRankGroup: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 6 },
    dot: { borderRadius: 4, height: 8, width: 8 },
    finalRank: { flexShrink: 1, fontSize: 17, fontWeight: '600' },
    finalRp: { fontSize: 17, fontWeight: '600' },

    statRow: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      paddingVertical: 8,
    },
    statRowLast: { borderBottomWidth: 0 },
    statLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '400' },
    statValue: { color: colors.text, flexShrink: 1, fontSize: 15, fontWeight: '600' },

    resetBlock: { gap: 4 },
    resetLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
    resetValue: { fontSize: 15, fontWeight: '600' },
    resetFootnote: { color: colors.textSecondary, fontSize: 13, fontWeight: '400' },

    button: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusMedium,
      justifyContent: 'center',
      marginTop: 20,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 24,
      width: '100%',
    },
    buttonPressed: { opacity: 0.85 },
    buttonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },
  });
}
