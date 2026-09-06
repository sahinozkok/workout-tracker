import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { AchievementSymbol } from '@/components/achievements/achievement-symbol';
import {
  ACHIEVEMENT_CATEGORIES,
  AchievementCategory,
  achievementEntry,
  formatAchievementValue,
} from '@/constants/achievements';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAchievements } from '@/context/achievement-context';
import { CareerAchievement } from '@/types/achievements';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';

/**
 * KALICI KARİYER BAŞARIMLARI — TEK ORTAK SUNUM BİLEŞENİ.
 *
 * Hem tam ekran `/achievements` hem de Rank → Achievements sekmesi AYNI bileşeni
 * ve AYNI veri kaynağını (`useAchievements()`) kullanır; içerik ve davranış
 * ayrışmaz. Sezondan BAĞIMSIZ, kalıcı 30 başarım; sezon rank rengi değil profil
 * accent'i kullanılır.
 *
 * GÖMÜLEBİLİRLİK — bu bileşen KENDİ dikey `ScrollView`'ını AÇMAZ. Doğal
 * yüksekliğiyle akar; barındıran ekran (rank ekranı zaten bir `ScrollView`
 * içindedir) nested-scroll üretmez. Tam ekran host'u kendi `ScrollView`'ını verir.
 *
 * DURUMLAR — loading / unavailable(+retry) / ready hepsi burada, sahte `0/30`
 * göstermeden ele alınır. `requestSync` çağrısı host'a bırakılır (focus/aktif
 * sekme); bu bileşen yalnız retry için `refresh()` kullanır.
 */

const PROFILE_ACCENT_DEFAULT = '#D5755B';

/** Ham ilerleme + hedefi başarımın birimine göre biçimler (boolean 0/1). */
function progressText(a: CareerAchievement): string {
  const entry = achievementEntry(a.key);
  if (entry.kind === 'boolean') return `${a.isUnlocked ? 1 : 0} / 1`;
  return `${formatAchievementValue(entry, a.currentProgress)} / ${formatAchievementValue(entry, entry.target)}`;
}

export function CareerAchievementsView() {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const { achievements, status, refresh } = useAchievements();
  const accent = useFeatureColor('profile', PROFILE_ACCENT_DEFAULT).color;
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const [detail, setDetail] = useState<CareerAchievement>();

  const byCategory = useMemo(() => {
    const map: Record<AchievementCategory, CareerAchievement[]> = { easy: [], hard: [], medium: [] };
    for (const a of achievements) map[a.category]?.push(a);
    return map;
  }, [achievements]);

  const name = useCallback((a: CareerAchievement) => t(`careerAchievements.items.${a.key}.name`), [t]);

  // Detay penceresi ANAHTAR saklar, nesne değil: arka planda güncel sync gelirse
  // pencere donmuş kopyayı değil güncel ilerlemeyi gösterir.
  const openAchievement = detail ? achievements.find((a) => a.key === detail.key) ?? detail : undefined;

  if (status === 'loading') {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={accent} size="small" />
      </View>
    );
  }

  if (status === 'unavailable') {
    return (
      <View style={styles.centerState}>
        <Text style={styles.stateText}>{t('careerAchievements.loadFailed')}</Text>
        <MotionPressable accessibilityRole="button" onPress={() => void refresh()} style={styles.retry}>
          <Text style={[styles.retryText, { color: accent }]}>{t('careerAchievements.retry')}</Text>
        </MotionPressable>
      </View>
    );
  }

  const earned = achievements.filter((a) => a.isUnlocked).length;
  const total = achievements.length;
  const ratio = total > 0 ? Math.min(1, Math.max(0, earned / total)) : 0;

  return (
    <View>
      {/* ÖZET — "kazanılan / toplam" kalıcı katalogdan; ince ilerleme çizgisi accent. */}
      <View
        accessible
        accessibilityLabel={t('careerAchievements.summaryA11y', { earned, total })}
        style={styles.summary}>
        <Text style={styles.summaryText}>{t('careerAchievements.summaryLabel', { earned, total })}</Text>
        <View style={[styles.summaryTrack, { backgroundColor: colors.surfaceMuted }]}>
          <View style={[styles.summaryFill, { backgroundColor: accent, width: `${Math.round(ratio * 100)}%` }]} />
        </View>
      </View>

      {ACHIEVEMENT_CATEGORIES.map((category) => (
        <View key={category} style={styles.section}>
          <Text style={styles.sectionTitle}>{t(`careerAchievements.sections.${category}`)}</Text>
          <View style={styles.list}>
            {byCategory[category].map((a) => {
              const unlocked = a.isUnlocked;
              const label = name(a);
              return (
                <Pressable
                  accessibilityHint={t('careerAchievements.detail.conditionTitle')}
                  accessibilityLabel={`${label}, ${progressText(a)}, ${
                    unlocked ? t('careerAchievements.a11yState.unlocked') : t('careerAchievements.a11yState.locked')
                  }`}
                  accessibilityRole="button"
                  key={a.key}
                  onPress={() => setDetail(a)}
                  style={({ pressed }) => [styles.row, !unlocked && styles.rowLocked, pressed && styles.pressed]}>
                  <AchievementSymbol accent={accent} achievementKey={a.key} isUnlocked={unlocked} size={28} />
                  <View style={styles.rowBody}>
                    <Text numberOfLines={1} style={[styles.rowName, unlocked && { color: colors.text }]}>
                      {label}
                    </Text>
                    <Text numberOfLines={2} style={styles.rowDesc}>
                      {t(`careerAchievements.items.${a.key}.description`)}
                    </Text>
                  </View>
                  <View style={styles.rowRight}>
                    {unlocked ? (
                      <Ionicons color={accent} name="checkmark-circle" size={18} />
                    ) : (
                      <Ionicons color={colors.textTertiary} name="lock-closed" size={14} />
                    )}
                    <Text style={[styles.rowProgress, unlocked && { color: accent }]}>{progressText(a)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <AchievementDetail achievement={openAchievement} accent={accent} onClose={() => setDetail(undefined)} />
    </View>
  );
}

function AchievementDetail({
  accent,
  achievement,
  onClose,
}: {
  accent: string;
  achievement?: CareerAchievement;
  onClose: () => void;
}) {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  if (!achievement) return null;
  const a = achievement;
  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="overFullScreen" transparent visible>
      <View style={styles.sheetRoot}>
        <Pressable accessibilityLabel={t('careerAchievements.detail.close')} accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <AchievementSymbol accent={accent} achievementKey={a.key} isUnlocked={a.isUnlocked} size={52} />
            <View style={styles.sheetTitles}>
              <Text style={styles.sheetName}>{t(`careerAchievements.items.${a.key}.name`)}</Text>
              <Text style={[styles.sheetState, { color: a.isUnlocked ? accent : colors.textTertiary }]}>
                {a.isUnlocked ? t('careerAchievements.unlocked') : t('careerAchievements.locked')}
              </Text>
            </View>
          </View>

          <Text style={styles.sheetLabel}>{t('careerAchievements.detail.conditionTitle')}</Text>
          <Text style={styles.sheetBody}>{t(`careerAchievements.items.${a.key}.description`)}</Text>

          <Text style={styles.sheetLabel}>{t('careerAchievements.detail.progressTitle')}</Text>
          <Text style={styles.sheetBody}>{progressText(a)}</Text>

          {a.isUnlocked && a.unlockedAt ? (
            <Text style={styles.sheetDate}>
              {t('careerAchievements.unlockedOn', { date: new Date(a.unlockedAt).toLocaleDateString() })}
            </Text>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors, isDark: boolean) {
  return StyleSheet.create({
    // Özet: kazanılan/toplam + ince accent çizgi (yalnız sunum).
    summary: { gap: 8, marginBottom: 16 },
    summaryText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    summaryTrack: { borderRadius: 2, height: 4, overflow: 'hidden', width: '100%' },
    summaryFill: { height: '100%' },

    section: { marginBottom: 20 },
    sectionTitle: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      marginBottom: 10,
      textTransform: 'uppercase',
    },
    list: { gap: 8 },
    row: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderColor: colors.separator,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      minHeight: Layout.minTouchSize + 12,
      padding: 12,
    },
    // Kilitliler ölçülü soluk; açılanlar tam görsel ağırlıkta.
    rowLocked: { opacity: isDark ? 0.7 : 0.6 },
    rowBody: { flex: 1, gap: 2 },
    rowName: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
    rowDesc: { color: colors.textTertiary, fontSize: 12, lineHeight: 16 },
    rowRight: { alignItems: 'flex-end', gap: 4 },
    rowProgress: { color: colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '600' },
    pressed: { opacity: 0.55 },

    centerState: { alignItems: 'center', gap: 12, justifyContent: 'center', minHeight: 96, paddingVertical: 24 },
    stateText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
    retry: { justifyContent: 'center', minHeight: Layout.minTouchSize, paddingHorizontal: 8 },
    retryText: { fontSize: 13, fontWeight: '600' },

    sheetRoot: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.4)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: Layout.radiusLarge,
      borderTopRightRadius: Layout.radiusLarge,
      paddingBottom: 12,
      paddingHorizontal: Layout.screenPadding,
    },
    handle: { alignSelf: 'center', backgroundColor: colors.separator, borderRadius: 3, height: 5, marginTop: 10, width: 40 },
    sheetHeader: { alignItems: 'center', flexDirection: 'row', gap: 14, marginTop: 16 },
    sheetTitles: { flex: 1, gap: 2 },
    sheetName: { color: colors.text, fontSize: 19, fontWeight: '700' },
    sheetState: { fontSize: 13, fontWeight: '600' },
    sheetLabel: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1,
      marginTop: 18,
      textTransform: 'uppercase',
    },
    sheetBody: { color: colors.text, fontSize: 15, lineHeight: 21, marginTop: 6 },
    sheetDate: { color: colors.textTertiary, fontSize: 13, marginTop: 16 },
  });
}
