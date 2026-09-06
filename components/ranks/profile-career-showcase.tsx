import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AchievementSymbol } from '@/components/achievements/achievement-symbol';
import { useRankName } from '@/components/ranks/rank-badge';
import { RankEmblem } from '@/components/ranks/rank-emblem';
import { AchievementKey } from '@/constants/achievements';
import { RankId } from '@/constants/ranks';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * PROFİL "SUCCESS" BÖLÜMÜ (sunumsal) — referanstaki gibi TEK yatay başarı alanı:
 * solda gerçek RANK amblemi + adı/RP, ince dikey ayırıcı, sağda kullanıcının
 * vitrinde seçtiği en fazla ÜÇ kalıcı kariyer başarımı (AchievementSymbol).
 *
 * Bu alan büyük bir karta ALINMAZ; ekran zemini üzerinde sadedir. Rank ve gül
 * asset'leri çerçevesiz/tintsiz gösterilir. Kendi profilinde düzenlenebilir
 * (`onEdit`) ve basılabilir (`onRankPress`/`onPress`); arkadaş profilinde salt
 * okunur.
 *
 * DURUMLAR AYRI: rank için ranked/loading/error/unranked; başarımlar için
 * yükleniyor (spinner) / erişilemedi (nötr metin) / boş. Sunucu sonucu olmadan
 * sahte rank ya da rozet ÇİZİLMEZ. Bileşen SAF sunumdur — veri çekmez.
 */
export type ProfileCareerShowcaseProps = {
  accentColor: string;
  entries: { key: AchievementKey }[];
  isLoading?: boolean;
  hasError?: boolean;
  /** Başarımlara dokununca (tüm başarımları gör). Verilmezse (arkadaş) salt okunur. */
  onPress?: () => void;
  /** Kendi profilinde vitrin düzenleme. Verilmezse (arkadaş) salt okunur. */
  onEdit?: () => void;
  /** Gerçek sezon verisinden geçen rank özeti. Yoksa durum ayrı gösterilir. */
  rank?: { id: RankId; rp: number };
  /** Rank verisi YÜKLENEMEDİ (sahte Bronze/"rank yok" gösterilmez). */
  hasRankError?: boolean;
  /** Rank verisi YÜKLENİYOR ("henüz rank yok" değil, ayrı durum). */
  isRankLoading?: boolean;
  /** Kendi profilinde rank alanına dokununca /rank açılır. Verilmezse salt okunur. */
  onRankPress?: () => void;
};

export function ProfileCareerShowcase({
  accentColor,
  entries,
  hasError,
  hasRankError,
  isLoading,
  isRankLoading,
  onEdit,
  onPress,
  onRankPress,
  rank,
}: ProfileCareerShowcaseProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const rankName = useRankName();
  const styles = createStyles(colors, accentColor);

  /**
   * Rank hücresi dört durumu AYIRIR — hiçbiri diğerinin yerine geçmez:
   *   ranked   → emblem + "Rank · RP".
   *   error    → veri yüklenemedi (sahte Bronze/"rank yok" DEĞİL).
   *   loading  → veri geliyor (spinner).
   *   unranked → gerçekten sıralanmamış.
   */
  const rankState: 'ranked' | 'error' | 'loading' | 'unranked' = rank
    ? 'ranked'
    : hasRankError
      ? 'error'
      : isRankLoading
        ? 'loading'
        : 'unranked';

  const rankA11yLabel =
    rankState === 'ranked' && rank
      ? `${rankName(rank.id)}, ${t('ranks.rpValue', { rp: rank.rp })}`
      : rankState === 'error'
        ? t('ranks.summaryUnavailableA11y')
        : rankState === 'loading'
          ? t('ranks.summaryLoadingA11y')
          : t('ranks.unranked');

  const rankBody =
    rankState === 'ranked' && rank ? (
      <>
        {/* Rank amblemi DOĞRUDAN: arkasında daire/çerçeve YOK, tint/glow YOK.
            `contain` oranı korur (kesilmez). */}
        <RankEmblem rankId={rank.id} size={60} />
        <View style={styles.rankLabel}>
          <Text numberOfLines={1} style={styles.rankLabelText}>
            {rankName(rank.id)} · {t('ranks.rpValue', { rp: rank.rp })}
          </Text>
        </View>
      </>
    ) : rankState === 'loading' ? (
      <>
        <View style={styles.rankStateSlot}>
          <ActivityIndicator color={colors.textTertiary} size="small" />
        </View>
        <Text numberOfLines={1} style={styles.rankStateText}>
          {t('ranks.summaryLoading')}
        </Text>
      </>
    ) : rankState === 'error' ? (
      <>
        <View style={styles.rankStateSlot}>
          <Ionicons color={colors.textTertiary} name="alert-circle-outline" size={26} />
        </View>
        <Text numberOfLines={1} style={styles.rankStateText}>
          {t('ranks.summaryUnavailable')}
        </Text>
      </>
    ) : (
      <>
        <View style={styles.rankStateSlot}>
          <Ionicons color={colors.textTertiary} name="shield-outline" size={26} />
        </View>
        <Text numberOfLines={1} style={styles.rankStateText}>
          {t('ranks.unranked')}
        </Text>
      </>
    );

  const rankColumn = onRankPress ? (
    <Pressable
      accessibilityHint={t('ranks.badgeHint')}
      accessibilityLabel={rankA11yLabel}
      accessibilityRole="button"
      onPress={onRankPress}
      style={({ pressed }) => [styles.rankColumn, pressed && styles.pressed]}>
      {rankBody}
    </Pressable>
  ) : (
    <View accessibilityLabel={rankA11yLabel} accessible style={styles.rankColumn}>
      {rankBody}
    </View>
  );

  const shown = entries.slice(0, 3);
  /**
   * Dolu durumda seçili başarım adları; boş/yükleniyor/hata durumunda ise anlamlı
   * lokalize bir geri düşüş (boş string DEĞİL) — böylece sütun her durumda
   * basılabilir ve erişilebilir kalır.
   */
  const achievementsA11yLabel =
    shown.length > 0
      ? shown.map((entry) => t(`careerAchievements.items.${entry.key}.name`)).join(', ')
      : t('careerAchievements.showcase.viewAll');

  const achievementsBody = isLoading ? (
    <View style={styles.achievementsState}>
      <ActivityIndicator color={colors.textTertiary} size="small" />
    </View>
  ) : hasError ? (
    <Text style={styles.stateText}>{t('careerAchievements.showcase.unavailable')}</Text>
  ) : entries.length === 0 ? (
    <Text style={styles.stateText}>{t('careerAchievements.showcase.empty')}</Text>
  ) : (
    <View style={styles.medallionRow}>
      {shown.map((entry) => (
        <AchievementSymbol key={entry.key} accent={accentColor} achievementKey={entry.key} isUnlocked size={32} />
      ))}
    </View>
  );

  /**
   * `onPress` verildiyse (kendi profil) sütun HER durumda basılabilir — dolu,
   * boş, yükleniyor veya hata — böylece seçili başarım olmasa da tüm başarımlar
   * ekranına gidilebilir. Arkadaş profilinde `onPress` verilmediği için salt
   * okunur View olarak kalır. Görsel yükseklik/ölçüler değişmez.
   */
  const achievementsColumn = onPress ? (
    <Pressable
      accessibilityHint={t('careerAchievements.showcase.viewAll')}
      accessibilityLabel={achievementsA11yLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.achievementsColumn, pressed && styles.pressed]}>
      {achievementsBody}
    </Pressable>
  ) : (
    <View style={styles.achievementsColumn}>{achievementsBody}</View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('careerAchievements.showcase.successTitle')}</Text>
        {onEdit ? (
          <Pressable
            accessibilityLabel={t('careerAchievements.showcase.viewAll')}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onEdit}
            style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
            <Ionicons color={colors.textSecondary} name="pencil-outline" size={16} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.body}>
        {rankColumn}
        <View style={styles.divider} />
        {achievementsColumn}
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    root: { gap: 14, width: '100%' },
    header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    title: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '500',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    editButton: {
      alignItems: 'center',
      height: Layout.minTouchSize,
      justifyContent: 'center',
      width: Layout.minTouchSize,
    },
    // Sol rank ~1/3, sağ başarımlar geri kalanı; büyük kart YOK.
    body: { alignItems: 'center', flexDirection: 'row', minHeight: 96 },
    rankColumn: {
      alignItems: 'center',
      flexShrink: 0,
      gap: 8,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      width: '36%',
    },
    // Rank adı + RP kompakt etiket: surfaceMuted, büyük turuncu kart DEĞİL.
    rankLabel: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusPill,
      maxWidth: '100%',
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    rankLabelText: {
      color: colors.text,
      fontSize: 11,
      fontVariant: ['tabular-nums'],
      fontWeight: '500',
    },
    // Nötr durum simgeleri emblem ölçüsüyle hizalı; dekoratif daire eklenmez.
    rankStateSlot: { alignItems: 'center', height: 60, justifyContent: 'center', width: 60 },
    rankStateText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500', textAlign: 'center' },
    // İnce, kısa dikey ayırıcı; üst/altta nefes alanı bırakılır.
    divider: {
      alignSelf: 'center',
      backgroundColor: colors.separator,
      height: 56,
      marginHorizontal: 14,
      width: StyleSheet.hairlineWidth,
    },
    achievementsColumn: { flex: 1, justifyContent: 'center', minHeight: Layout.minTouchSize },
    achievementsState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
    medallionRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'center' },
    stateText: { color: colors.textTertiary, fontSize: 13, textAlign: 'center' },
    pressed: { opacity: 0.6 },
  });
}
