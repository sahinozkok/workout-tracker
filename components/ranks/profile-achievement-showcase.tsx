import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ACHIEVEMENT_ICONS } from '@/components/ranks/achievement-icons';
import { withAlpha } from '@/constants/color-presets';
import {
  SEASON_ACHIEVEMENT_KEYS,
  SeasonAchievementKey,
} from '@/constants/rank-experience';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { SeasonAchievementShowcaseEntry } from '@/types/ranks';

/**
 * PROFİL SEZON ROZETİ VİTRİNİ — kendi profili ve arkadaş profili için TEK
 * bileşen.
 *
 * Bilinçli sınırlar:
 *  - Bu bileşen hiçbir başarı koşulu veya ilerleme HESAPLAMAZ. Yalnızca
 *    sunucudan gelen açılmış rozetleri gösterim için sıralar ve kırpar.
 *    Rozetler kozmetiktir; RP, XP, level veya gül üretmez.
 *  - Rank rozeti burada ÇİZİLMEZ: `RankBadge` her iki profilde de kendi
 *    yerinde kalır ve tasarımı değişmez.
 *  - Yeni gradient, görsel dosyası, emoji veya bağımlılık eklenmez; ikonlar
 *    ortak `ACHIEVEMENT_ICONS` kaynağından gelir.
 *  - Hata durumu kart AÇMAZ: vitrin sessizce gizlenir, profil ekranı çalışmaya
 *    devam eder.
 */

/** Vitrinde en fazla bu kadar rozet gösterilir. */
export const PROFILE_SHOWCASE_LIMIT = 3;

/**
 * Gösterim sırası: EN YENİ açılan rozet önce.
 *
 * `unlockedAt` eşit (veya okunamıyor) olduğunda katalog sırası deterministik
 * yedek anahtardır — aksi hâlde aynı anda açılmış iki rozetin sırası her
 * render'da değişebilirdi. Bu bir güvenlik kırpması DEĞİLDİR: arkadaş
 * tarafında sıralama ve üçlü sınırın otoritesi sunucudur, buradaki sıralama
 * yalnızca kendi profilindeki context verisini kararlı biçimde dizer.
 */
export function selectShowcaseEntries(
  entries: readonly SeasonAchievementShowcaseEntry[],
): SeasonAchievementShowcaseEntry[] {
  const catalogIndex = (key: SeasonAchievementKey) => SEASON_ACHIEVEMENT_KEYS.indexOf(key);
  const time = (value?: string) => {
    if (!value) return Number.NEGATIVE_INFINITY;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };

  return [...entries]
    .sort((left, right) => {
      const diff = time(right.unlockedAt) - time(left.unlockedAt);
      if (diff !== 0) return diff;
      return catalogIndex(left.key) - catalogIndex(right.key);
    })
    .slice(0, PROFILE_SHOWCASE_LIMIT);
}

type ProfileAchievementShowcaseProps = {
  /** Profil sahibinin vurgu rengi. */
  accentColor: string;
  /** Sunucudan gelen AÇILMIŞ rozetler. */
  entries: readonly SeasonAchievementShowcaseEntry[];
  /** Veri okunamadıysa vitrin sessizce gizlenir. */
  hasError?: boolean;
  isLoading?: boolean;
  /** Verilirse vitrine dokunmak bu eylemi çalıştırır (kendi profili). */
  onPress?: () => void;
};

export function ProfileAchievementShowcase({
  accentColor,
  entries,
  hasError = false,
  isLoading = false,
  onPress,
}: ProfileAchievementShowcaseProps) {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Hata: büyük hata kartı veya retry YOK — vitrin sessizce gizlenir.
  if (hasError) return null;

  const visible = selectShowcaseEntries(entries);

  const body = isLoading ? (
    <View style={styles.state}>
      <ActivityIndicator color={colors.textSecondary} size="small" />
    </View>
  ) : visible.length === 0 ? (
    <Text numberOfLines={2} style={styles.empty}>
      {t('ranks.achievements.showcase.empty')}
    </Text>
  ) : (
    <View style={styles.row}>
      {visible.map((entry) => (
        <ShowcaseBadge
          accentColor={accentColor}
          entry={entry}
          isDark={isDark}
          key={entry.key}
          styles={styles}
          t={t}
        />
      ))}
    </View>
  );

  const content = (
    <View style={styles.block}>
      <Text style={styles.sectionLabel}>{t('ranks.achievements.showcase.title')}</Text>
      {body}
    </View>
  );

  if (!onPress) {
    // Arkadaş profilinde vitrin salt okunurdur.
    return content;
  }

  return (
    <Pressable
      accessibilityLabel={t('ranks.achievements.showcase.title')}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

function ShowcaseBadge({
  accentColor,
  entry,
  isDark,
  styles,
  t,
}: {
  accentColor: string;
  entry: SeasonAchievementShowcaseEntry;
  isDark: boolean;
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const name = t(`ranks.achievements.items.${entry.key}.name`);

  return (
    <View accessibilityLabel={name} accessible style={styles.badge}>
      <View
        style={[
          styles.iconWrap,
          // Vurgu renginin düşük opaklıklı tonu; koyu temada biraz güçlü.
          { backgroundColor: withAlpha(accentColor, isDark ? 0.2 : 0.13) },
        ]}>
        <Ionicons color={accentColor} name={ACHIEVEMENT_ICONS[entry.key]} size={18} />
      </View>
      <Text numberOfLines={2} style={styles.badgeName}>
        {name}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    block: { gap: 8, marginTop: 16, width: '100%' },
    sectionLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
    row: { flexDirection: 'row', gap: 8 },
    /** Dokunma hedefi 44 pt'nin altına inmez. */
    badge: {
      alignItems: 'center',
      flex: 1,
      gap: 4,
      minHeight: Layout.minTouchSize,
      paddingVertical: 4,
    },
    iconWrap: {
      alignItems: 'center',
      borderRadius: 16,
      height: 32,
      justifyContent: 'center',
      width: 32,
    },
    badgeName: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '400',
      lineHeight: 14,
      textAlign: 'center',
    },
    state: { alignItems: 'center', justifyContent: 'center', minHeight: Layout.minTouchSize },
    empty: {
      color: colors.textTertiary,
      fontSize: 11,
      fontWeight: '400',
      lineHeight: 15,
      minHeight: 32,
    },
    pressed: { opacity: 0.6 },
  });
}
