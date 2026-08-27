import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionSection } from '@/components/motion-section';
import { getRankColor, useRankName } from '@/components/ranks/rank-badge';
import {
  RANK_RP,
  RANK_STREAK_MILESTONES,
  RANK_TIERS,
  RankId,
  SEASON_LENGTH_DAYS,
} from '@/constants/ranks';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useRanks } from '@/context/rank-context';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * RANK REHBERİ — salt okunur açıklama ekranı.
 *
 * Kök Stack'te açılır → alt sekme çubuğu GÖRÜNMEZ, yeni sekme eklenmez ve
 * native geri düğmesi / iOS geri kaydırma hareketi olduğu gibi çalışır.
 *
 * VERİ OTORİTESİ — bu ekran hiçbir RP veya rank HESAPLAMAZ ve hiçbir ağ
 * isteği yapmaz. Gösterilen bütün sayılar `constants/ranks.ts` içindeki TEK
 * kaynaktan (`RANK_RP`, `RANK_STREAK_MILESTONES`, `RANK_TIERS`,
 * `SEASON_LENGTH_DAYS`) okunur; hiçbiri buraya elle kopyalanmaz. Kullanıcının
 * mevcut rankı `useRanks()` içinde ZATEN yüklü olan sezon özetinden gelir.
 *
 * TİPOGRAFİ — rank ekranıyla aynı: dört boyut (17 / 15 / 13 / 11) ve iki
 * ağırlık (600 / 400). Rank rengi YALNIZCA rank işaretinde (nokta) ve mevcut
 * rankın vurgu çizgisinde kullanılır; gövde metinleri tema renklerinde kalır.
 */
export default function RankGuideScreen() {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const rankName = useRankName();
  /** Yeni sorgu YOK: sağlayıcıda zaten bulunan sezon özeti okunur. */
  const { season } = useRanks();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const currentRank = season?.currentRank;
  const seasonWeeks = Math.round(SEASON_LENGTH_DAYS / 7);

  /** Sabitlerden türetilen RP kuralları. Hiçbir değer elle yazılmaz. */
  const earnRules: { key: string; label: string; rp: number }[] = [
    { key: 'partial', label: t('ranks.guide.earnPartial'), rp: RANK_RP.scheduledPartial },
    { key: 'complete', label: t('ranks.guide.earnComplete'), rp: RANK_RP.scheduledCompleteTotal },
    {
      key: 'unscheduled',
      label: t('ranks.guide.earnUnscheduled'),
      rp: RANK_RP.unscheduledWorkout,
    },
    { key: 'weekly', label: t('ranks.guide.earnWeeklyPerfect'), rp: RANK_RP.weeklyPerfect },
    ...RANK_STREAK_MILESTONES.map((milestone) => ({
      key: `streak-${milestone.days}`,
      label: t('ranks.guide.earnStreak', { days: milestone.days }),
      rp: milestone.rp,
    })),
  ];

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MotionSection style={styles.lead}>
          <Text style={styles.leadText}>{t('ranks.guide.lead')}</Text>
        </MotionSection>

        <MotionSection delay={40} style={styles.block}>
          <Text style={styles.sectionLabel}>{t('ranks.guide.earnTitle')}</Text>
          <View style={styles.card}>
            {earnRules.map((rule, index) => (
              <View
                accessibilityLabel={`${rule.label}: ${t('ranks.guide.rpValue', { rp: rule.rp })}`}
                accessible
                key={rule.key}
                style={[styles.row, index === earnRules.length - 1 && styles.rowLast]}>
                <Text style={styles.rowLabel}>{rule.label}</Text>
                <Text numberOfLines={1} style={styles.rowValue}>
                  {t('ranks.guide.rpValue', { rp: rule.rp })}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>
            {t('ranks.guide.earnCompleteNote', {
              partial: RANK_RP.scheduledPartial,
              topUp: RANK_RP.scheduledCompleteTopUp,
              total: RANK_RP.scheduledCompleteTotal,
            })}
          </Text>
          <Text style={styles.note}>{t('ranks.guide.manualNote')}</Text>
        </MotionSection>

        <MotionSection delay={80} style={styles.block}>
          <Text style={styles.sectionLabel}>{t('ranks.guide.tiersTitle')}</Text>
          <View style={styles.card}>
            {RANK_TIERS.map((tier, index) => (
              <TierRow
                isCurrent={tier.id === currentRank}
                isLast={index === RANK_TIERS.length - 1}
                key={tier.id}
                minRp={tier.minRp}
                rankId={tier.id}
                rankName={rankName}
                styles={styles}
                t={t}
              />
            ))}
          </View>
        </MotionSection>

        <MotionSection delay={120} style={styles.block}>
          <Text style={styles.sectionLabel}>{t('ranks.guide.seasonTitle')}</Text>
          <View style={styles.card}>
            <View style={styles.paragraphRow}>
              <Text style={styles.paragraph}>
                {t('ranks.guide.seasonLength', { weeks: seasonWeeks })}
              </Text>
            </View>
            <View style={styles.paragraphRow}>
              <Text style={styles.paragraph}>{t('ranks.guide.seasonArchive')}</Text>
            </View>
            <View style={[styles.paragraphRow, styles.rowLast]}>
              <Text style={styles.paragraph}>{t('ranks.guide.seasonSoftReset')}</Text>
            </View>
          </View>
        </MotionSection>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Tek rank basamağı.
 *
 * Semantik rank rengi YALNIZCA soldaki küçük noktada ve mevcut rankın vurgu
 * çizgisinde kullanılır; color preset sistemine bağlı DEĞİLDİR.
 */
function TierRow({
  isCurrent,
  isLast,
  minRp,
  rankId,
  rankName,
  styles,
  t,
}: {
  isCurrent: boolean;
  isLast: boolean;
  minRp: number;
  rankId: RankId;
  rankName: (id: RankId) => string;
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const color = getRankColor(rankId);
  const label = rankName(rankId);
  const requirement = t('ranks.guide.tierRequirement', { rp: minRp });

  return (
    <View
      accessibilityLabel={
        isCurrent
          ? `${label}, ${requirement}. ${t('ranks.guide.tierCurrentA11y')}`
          : `${label}, ${requirement}`
      }
      accessible
      style={[styles.row, isLast && styles.rowLast]}>
      {/* Vurgu çizgisi: mevcut rank sade bir işaretle ayrılır. */}
      <View style={[styles.tierBar, { backgroundColor: isCurrent ? color : 'transparent' }]} />
      <View style={[styles.tierDot, { backgroundColor: color }]} />
      <Text numberOfLines={1} style={styles.rowLabel}>
        {label}
      </Text>
      {isCurrent && (
        <Text numberOfLines={1} style={[styles.tierCurrent, { color }]}>
          {t('ranks.guide.tierCurrent')}
        </Text>
      )}
      <Text numberOfLines={1} style={styles.rowValue}>
        {requirement}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 40, paddingHorizontal: Layout.screenPadding, paddingTop: 8 },

    lead: { marginBottom: 8 },
    leadText: { color: colors.textSecondary, fontSize: 13, fontWeight: '400', lineHeight: 19 },

    block: { marginTop: 24 },
    sectionLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 8 },

    card: {
      backgroundColor: colors.surface,
      borderColor: colors.separator,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
    },
    row: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'space-between',
      minHeight: Layout.minTouchSize,
      paddingVertical: 12,
    },
    rowLast: { borderBottomWidth: 0 },
    // Uzun TR/EN etiketleri taşmaz: satır sarar, değer sabit kalır.
    rowLabel: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '400', lineHeight: 20 },
    rowValue: { color: colors.text, fontSize: 15, fontWeight: '600' },

    tierBar: { borderRadius: 2, height: 20, width: 3 },
    tierDot: { borderRadius: 4, height: 8, width: 8 },
    tierCurrent: { fontSize: 11, fontWeight: '600' },

    paragraphRow: {
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingVertical: 12,
    },
    paragraph: { color: colors.text, fontSize: 15, fontWeight: '400', lineHeight: 21 },

    note: { color: colors.textSecondary, fontSize: 13, fontWeight: '400', lineHeight: 19, marginTop: 12 },
  });
}
