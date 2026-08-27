import { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { ProgressRing } from '@/components/progress-ring';
import { MAX_LEVEL } from '@/constants/level-curve';
import { MotionDistance, MotionDuration, MotionEasing } from '@/constants/motion';
import { Fonts } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * Dairesel seviye/XP göstergesi.
 *
 * Yatay bar tamamen kaldırıldı: seviye artık profilin merkezinde bir halkayla
 * gösteriliyor. Halka için yeni bir çizim katmanı veya paket eklenmedi —
 * uygulamada zaten çalışan `ProgressRing` yeniden kullanılıyor (o bileşen
 * `react-native-svg` olmadan, kırpılmış yarım daire maskeleriyle çiziyor).
 *
 * Halkanın içinde iki satır vardır:
 *   satır 1 → `Seviye 3`      (ana metin rengi, kalın)
 *   satır 2 → `144 / 200 XP`  (ikincil renk) veya en yüksek seviyede `MAX`
 *
 * Turuncu **yerel** bir vurgudur: global tema (`constants/theme.ts`) hiç
 * değiştirilmez, bu renk yalnızca seviye göstergesinde yaşar.
 *
 * Gül bakiyesi bu bileşenin sorumluluğu değildir; kendi profildeki kompakt
 * kanıt satırında gösterilir. Arkadaş profili yalnızca bu halkayı kullanır.
 *
 * Teknik defter/ledger bilgisi kullanıcıya HİÇ gösterilmez.
 */

/** Referanstaki yerel mercan vurgu; global tema rengini değiştirmez. */
const FILL_COLOR = '#D5755B';
const RING_SIZE = 96;
const RING_STROKE = 7;

/**
 * Metin sütununun kırpma kutusuna dikeyde eklenen pay (pt).
 *
 * Sütun yatayda KIRPILMAK ZORUNDA (yazı kendi sütununun sağ kenarından sola
 * doğru açılarak görünüyor), ama dikeyde kırpılmamalı: serif başlığın alt
 * uzantıları `lineHeight` kutusunu birkaç piksel taşabiliyor. Bu pay kadar
 * `padding` eklenip aynı miktarda negatif `margin` ile geri alınır; kutu
 * dikeyde genişler, YERLEŞİM ise birebir aynı kalır.
 */
const COPY_CLIP_BLEED = 4;

type LevelProgressRingProps = {
  /**
   * Eyebrow (`YOUR RHYTHM`) rengi. Verilmezse bugünkü ton korunur.
   */
  accentColor?: string;
  /**
   * Halka dolgu rengi. Verilmezse bugünkü `FILL_COLOR` kullanılır; böylece
   * bileşenin başka kullanımları etkilenmez.
   */
  fillColor?: string;
  /**
   * Eyebrow'un hemen altında gösterilen metin (kısa biyografi). Boş veya
   * verilmemişse satır HİÇ render edilmez — eski sabit "Small steps count."
   * metni fallback olarak geri gelmez.
   */
  message?: string;
  level: number;
  /**
   * Giriş animasyonunu tetikleyen anahtar.
   *
   * VERİLMEZSE kart doğrudan son hâlinde çizilir ve hiçbir animasyon çalışmaz
   * — arkadaş profili (`app/profile/[userId].tsx`) bu yolu kullanır.
   *
   * Değeri her DEĞİŞTİĞİNDE animasyon baştan oynar. Bu yüzden kendi profilde
   * yalnızca ekran odak kazandığında artırılır; tema, profil verisi veya başka
   * bir state güncellemesi kartı yeniden oynatmaz.
   */
  revealToken?: number;
  xpForNextLevel: number;
  xpIntoLevel: number;
};

export function LevelProgressRing({
  accentColor,
  fillColor,
  level,
  message,
  revealToken,
  xpForNextLevel,
  xpIntoLevel,
}: LevelProgressRingProps) {
  const { isDark } = useAppTheme();
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  /** Reduce Motion açıkken de, token verilmediğinde de animasyon yoktur. */
  const hasEntrance = revealToken !== undefined && !reduceMotion;

  /**
   * 0 → yalnızca halka görünür ve yatayda ortalıdır.
   * 1 → bugünkü yerleşimin BİREBİR aynısı.
   *
   * Animasyon boyunca yalnızca `opacity` ve `transform` değişir; hiçbir ölçü
   * animasyonlanmadığı için layout sıçraması oluşamaz ve bitiş noktası her
   * zaman mevcut tasarımın tam olarak kendisidir.
   */
  const reveal = useSharedValue(hasEntrance ? 0 : 1);
  /** Ölçülen gerçek genişlikler; sabit ekran genişliği HİÇ kullanılmaz. */
  const rowWidth = useSharedValue(0);
  const copyWidth = useSharedValue(0);

  useEffect(() => {
    if (!hasEntrance) {
      reveal.value = 1;
      return;
    }

    reveal.value = 0;
    reveal.value = withDelay(
      // İlk anda sahnede yalnızca ortadaki halka durur.
      MotionDuration.instant,
      withTiming(1, { duration: MotionDuration.slow, easing: MotionEasing.standard }),
    );
  }, [hasEntrance, reveal, revealToken]);

  const handleRowLayout = useCallback(
    (event: LayoutChangeEvent) => {
      rowWidth.value = event.nativeEvent.layout.width;
    },
    [rowWidth],
  );

  const handleCopyLayout = useCallback(
    (event: LayoutChangeEvent) => {
      copyWidth.value = event.nativeEvent.layout.width;
    },
    [copyWidth],
  );

  /**
   * Halka merkezden mevcut sağ konumuna kayar. `opacity` koruması, genişlik
   * henüz ölçülmemişken halkanın bir kare boyunca son konumunda görünüp ortaya
   * ışınlanmasını engeller.
   */
  const ringStyle = useAnimatedStyle(() => {
    const isMeasured = rowWidth.value > 0;
    const centerShift = isMeasured ? Math.max(0, (rowWidth.value - RING_SIZE) / 2) : 0;

    return {
      opacity: hasEntrance && !isMeasured ? 0 : 1,
      transform: [{ translateX: -centerShift * (1 - reveal.value) }],
    };
  });

  /**
   * Metin sütunu kendi genişliği kadar sağa itilmiş başlar; kırpma kutusu
   * yüzünden hiç görünmez. Halka sağa kayarken bu itme geri alınır, yani yazı
   * halkanın arkasından çıkıyormuş gibi SOLA doğru açılır. Opaklık kullanmaya
   * gerek yok: açılma zaten kırpma ile oluyor.
   */
  const copyStyle = useAnimatedStyle(() => {
    const isMeasured = copyWidth.value > 0;

    return {
      opacity: hasEntrance && !isMeasured ? 0 : 1,
      transform: [{ translateX: copyWidth.value * (1 - reveal.value) }],
    };
  });

  /** Ayırıcı ve "Next level" satırı aynı anda, çok küçük bir kayma ile gelir. */
  const detailsStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateX: MotionDistance.swap * (1 - reveal.value) }],
  }));

  // Oran hesabı BİLİNÇLİ olarak değişmedi; her koşulda 0–1 arasına sıkışır ve
  // en yüksek seviyede halka tamamen dolu gösterilir.
  const isMaxLevel = level >= MAX_LEVEL || xpForNextLevel <= 0;
  const ratio = isMaxLevel
    ? 1
    : Math.min(1, Math.max(0, xpIntoLevel / Math.max(xpForNextLevel, 1)));

  const trackColor = isDark ? '#303034' : '#D8D8DD';
  const cardBackground = isDark ? '#111113' : '#F2F2F4';
  const primaryText = isDark ? '#F4F4F6' : '#202024';
  const secondaryText = isDark ? '#98989E' : '#6F6F76';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          backgroundColor: cardBackground,
          borderRadius: 24,
          // Güvenlik ağı: giriş animasyonu sırasında hiçbir parça kart
          // sınırının dışına taşamaz. Son görünümde hiçbir şey taşmadığı için
          // bugünkü kart birebir aynı çizilir.
          overflow: 'hidden',
          padding: 16,
          width: '100%',
        },
        topRow: {
          alignItems: 'center',
          flexDirection: 'row',
          gap: 12,
          justifyContent: 'space-between',
        },
        /** Yatay kırpma kutusu; ölçüleri `copyInner` belirler. */
        copy: {
          flex: 1,
          marginVertical: -COPY_CLIP_BLEED,
          minWidth: 0,
          overflow: 'hidden',
          paddingVertical: COPY_CLIP_BLEED,
        },
        copyInner: { gap: 6 },
        eyebrow: {
          color: accentColor ?? '#C28A91',
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 1.45,
        },
        message: {
          color: primaryText,
          fontFamily: Fonts.serif,
          fontSize: 22,
          fontWeight: '700',
          lineHeight: 27,
        },
        center: { alignItems: 'center', gap: 0 },
        xpNumber: {
          color: primaryText,
          fontFamily: Fonts.serif,
          fontSize: 30,
          fontVariant: ['tabular-nums'],
          fontWeight: '700',
          lineHeight: 34,
        },
        xpUnit: {
          color: secondaryText,
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 1.1,
        },
        separator: {
          backgroundColor: isDark ? '#2A2A2E' : '#D9D9DE',
          height: StyleSheet.hairlineWidth,
          marginVertical: 14,
          width: '100%',
        },
        footer: {
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        footerLabel: {
          color: secondaryText,
          fontSize: 12,
          fontWeight: '500',
        },
        footerValue: {
          color: secondaryText,
          fontSize: 12,
          fontVariant: ['tabular-nums'],
          fontWeight: '600',
        },
      }),
    [accentColor, cardBackground, isDark, primaryText, secondaryText],
  );

  return (
    <View style={styles.root}>
      <View onLayout={handleRowLayout} style={styles.topRow}>
        <View onLayout={handleCopyLayout} style={styles.copy}>
          <Animated.View style={[styles.copyInner, copyStyle]}>
            <Text style={styles.eyebrow}>{t('rewards.levelCardEyebrow')}</Text>
            {/* Kısa biyografi. Boşsa satır hiç render edilmez. */}
            {message ? <Text style={styles.message}>{message}</Text> : null}
          </Animated.View>
        </View>

        {/* Erişilebilirlik halkanın tamamındadır: iç metinler ayrı ayrı
            okunmaz, ilerleme tek bir öğe olarak duyurulur. Hareket için ek bir
            katman AÇILMAZ; aynı düğüm `Animated.View` olur. */}
        <Animated.View
          accessibilityLabel={
            isMaxLevel
              ? t('rewards.progressMaxA11y', { level })
              : t('rewards.progressA11y', { current: xpIntoLevel, level, next: xpForNextLevel })
          }
          accessibilityRole="progressbar"
          accessible
          style={ringStyle}>
          <ProgressRing
            color={fillColor ?? FILL_COLOR}
            progress={ratio}
            size={RING_SIZE}
            strokeWidth={RING_STROKE}
            trackColor={trackColor}>
            <View style={styles.center}>
              <Text numberOfLines={1} style={styles.xpNumber}>
                {isMaxLevel ? level : xpIntoLevel}
              </Text>
              <Text numberOfLines={1} style={styles.xpUnit}>
                {isMaxLevel ? t('rewards.levelMaxValue') : 'XP'}
              </Text>
            </View>
          </ProgressRing>
        </Animated.View>
      </View>

      <Animated.View style={detailsStyle}>
        <View style={styles.separator} />

        <View style={styles.footer}>
          <Text style={styles.footerLabel}>
            {isMaxLevel ? t('rewards.maximumLevelReached') : t('rewards.levelCardNext')}
          </Text>
          <Text style={styles.footerValue}>
            {isMaxLevel
              ? t('rewards.levelLabel', { level })
              : t('rewards.levelXpValue', { current: xpIntoLevel, next: xpForNextLevel })}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}
