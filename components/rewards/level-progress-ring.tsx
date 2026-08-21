import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ProgressRing } from '@/components/progress-ring';
import { MAX_LEVEL } from '@/constants/level-curve';
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

type LevelProgressRingProps = {
  level: number;
  xpForNextLevel: number;
  xpIntoLevel: number;
};

export function LevelProgressRing({
  level,
  xpForNextLevel,
  xpIntoLevel,
}: LevelProgressRingProps) {
  const { isDark } = useAppTheme();
  const { t } = useTranslation();

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
          padding: 16,
          width: '100%',
        },
        topRow: {
          alignItems: 'center',
          flexDirection: 'row',
          gap: 12,
          justifyContent: 'space-between',
        },
        copy: { flex: 1, gap: 6, minWidth: 0 },
        eyebrow: {
          color: '#C28A91',
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
    [cardBackground, isDark, primaryText, secondaryText],
  );

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{t('rewards.levelCardEyebrow')}</Text>
          <Text style={styles.message}>{t('rewards.levelCardMessage')}</Text>
        </View>

        {/* Erişilebilirlik halkanın tamamındadır: iç metinler ayrı ayrı
            okunmaz, ilerleme tek bir öğe olarak duyurulur. */}
        <View
          accessibilityLabel={
            isMaxLevel
              ? t('rewards.progressMaxA11y', { level })
              : t('rewards.progressA11y', { current: xpIntoLevel, level, next: xpForNextLevel })
          }
          accessibilityRole="progressbar"
          accessible>
          <ProgressRing
            color={FILL_COLOR}
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
        </View>
      </View>

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
    </View>
  );
}
