import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AchievementSymbol } from '@/components/achievements/achievement-symbol';
import { HeaderBackButton, useSafeBack } from '@/components/navigation/header-back-button';
import { MotionPressable } from '@/components/motion-pressable';
import { MotionSection } from '@/components/motion-section';
import { AchievementKey } from '@/constants/achievements';
import { getOnAccentColor, withAlpha } from '@/constants/color-presets';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAchievements } from '@/context/achievement-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';

const PROFILE_ACCENT_DEFAULT = '#D5755B';
export const CAREER_SHOWCASE_LIMIT = 3;

export default function AchievementsShowcaseScreen() {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const { achievements, status, refresh, requestSync, showcaseSelection, showcaseStatus, loadShowcase, saveShowcase } =
    useAchievements();

  // Ekrana girildiğinde açılmış başarımlar güncellenir (coalescing'li; döngü yok).
  useFocusEffect(
    useCallback(() => {
      requestSync();
    }, [requestSync]),
  );
  const accent = useFeatureColor('profile', PROFILE_ACCENT_DEFAULT).color;
  // Kaydetme sonrası ve geri düğmesinde AYNI güvenli davranış: geçmiş varsa
  // geri, yoksa profile'a replace → ekran takılı kalmaz.
  const safeBack = useSafeBack('/(tabs)/profile');
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [draft, setDraft] = useState<AchievementKey[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaveError, setHasSaveError] = useState(false);
  const isMountedRef = useRef(true);
  const seededRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Taslak YALNIZCA seçim gerçekten yüklendikten (ready) sonra bir kez hazırlanır.
  useEffect(() => {
    if (showcaseStatus !== 'ready' || seededRef.current) return;
    seededRef.current = true;
    setDraft([...showcaseSelection]);
  }, [showcaseSelection, showcaseStatus]);

  const unlocked = achievements.filter((a) => a.isUnlocked);
  const hasError = status === 'unavailable' || showcaseStatus === 'unavailable';
  const isPending = status === 'loading' || showcaseStatus === 'loading' || (showcaseStatus !== 'ready' && !hasError);
  const canSave = showcaseStatus === 'ready' && !hasError && !isSaving;

  const bodyState: 'error' | 'loading' | 'empty' | 'grid' = hasError
    ? 'error'
    : isPending
      ? 'loading'
      : unlocked.length === 0
        ? 'empty'
        : 'grid';

  const retry = useCallback(() => {
    void refresh();
    void loadShowcase();
  }, [loadShowcase, refresh]);

  const toggle = useCallback((key: AchievementKey) => {
    setHasSaveError(false);
    setDraft((current) => {
      if (current.includes(key)) return current.filter((k) => k !== key);
      if (current.length >= CAREER_SHOWCASE_LIMIT) return current;
      return [...current, key];
    });
  }, []);

  const save = useCallback(
    async (keys: AchievementKey[]) => {
      if (isSaving) return;
      setIsSaving(true);
      setHasSaveError(false);
      const outcome = await saveShowcase(keys);
      if (!isMountedRef.current) return;
      setIsSaving(false);
      if (outcome === 'saved') {
        // canGoBack=false olsa bile ekran takılı kalmaz (fallback replace).
        safeBack();
      } else {
        setHasSaveError(true);
      }
    },
    [isSaving, safeBack, saveShowcase],
  );

  function renderBody() {
    if (bodyState === 'error') {
      return (
        <View style={styles.centerState}>
          <Text style={styles.stateText}>{t('careerAchievements.showcase.loadFailed')}</Text>
          <MotionPressable accessibilityRole="button" onPress={retry} style={styles.retry}>
            <Text style={[styles.retryText, { color: accent }]}>{t('careerAchievements.showcase.retry')}</Text>
          </MotionPressable>
        </View>
      );
    }
    if (bodyState === 'loading') {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }
    if (bodyState === 'empty') {
      return (
        <View style={styles.centerState}>
          <Text style={styles.stateText}>{t('careerAchievements.showcase.empty')}</Text>
        </View>
      );
    }
    return (
      <View style={styles.grid}>
        {unlocked.map((a) => {
          const position = draft.indexOf(a.key);
          const isSelected = position >= 0;
          const name = t(`careerAchievements.items.${a.key}.name`);
          return (
            <MotionPressable
              accessibilityHint={t('careerAchievements.showcase.toggleHint')}
              accessibilityLabel={
                isSelected
                  ? t('careerAchievements.showcase.selectedA11y', { name, position: position + 1 })
                  : t('careerAchievements.showcase.unselectedA11y', { name })
              }
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              disabled={isSaving}
              key={a.key}
              onPress={() => toggle(a.key)}
              style={[
                styles.card,
                isSelected && { backgroundColor: withAlpha(accent, isDark ? 0.16 : 0.1), borderColor: accent },
              ]}>
              <View style={styles.cardTop}>
                {/* Organik sembol DOĞRUDAN — daire/disk/tile YOK. Seçili → accent
                    tint; seçilmemiş → tersiyer + ölçülü opaklık (contain, kare). */}
                <AchievementSymbol accent={accent} achievementKey={a.key} isUnlocked={isSelected} size={30} />
                {isSelected && (
                  <View style={[styles.order, { backgroundColor: accent }]}>
                    <Text style={[styles.orderText, { color: getOnAccentColor(accent) }]}>{position + 1}</Text>
                  </View>
                )}
              </View>
              <Text numberOfLines={2} style={[styles.cardName, isSelected && { color: colors.text }]}>
                {name}
              </Text>
            </MotionPressable>
          );
        })}
      </View>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      {/* AÇIK `headerLeft` — native otomatik geri düğmesine güvenilmez; güvenilir,
          görünür, ≥44 pt geri düğmesi. Native geri kaydırma hareketi korunur. */}
      <Stack.Screen
        options={{
          headerLeft: () => (
            <HeaderBackButton accessibilityLabel={t('common.back')} fallback="/(tabs)/profile" />
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MotionSection style={styles.header}>
          <Text style={styles.lead}>{t('careerAchievements.showcase.editLead', { count: CAREER_SHOWCASE_LIMIT })}</Text>
        </MotionSection>
        <MotionSection delay={40}>{renderBody()}</MotionSection>
        {hasSaveError && <Text style={styles.saveError}>{t('careerAchievements.showcase.saveFailed')}</Text>}
      </ScrollView>

      {bodyState === 'grid' && (
        <View style={[styles.footer, { borderTopColor: colors.separator }]}>
          <MotionPressable
            accessibilityRole="button"
            accessibilityState={{ busy: isSaving, disabled: !canSave }}
            disabled={!canSave}
            onPress={() => void save(draft)}
            style={[styles.primaryButton, { backgroundColor: accent }, !canSave && styles.disabled]}>
            {isSaving ? (
              <ActivityIndicator color={getOnAccentColor(accent)} size="small" />
            ) : (
              <Text style={[styles.primaryButtonText, { color: getOnAccentColor(accent) }]}>
                {t('careerAchievements.showcase.save')}
              </Text>
            )}
          </MotionPressable>
          {(showcaseSelection.length > 0 || draft.length > 0) && (
            <MotionPressable
              accessibilityRole="button"
              disabled={!canSave}
              onPress={() => {
                setDraft([]);
                void save([]);
              }}
              style={[styles.secondaryButton, !canSave && styles.disabled]}>
              <Text style={styles.secondaryButtonText}>{t('careerAchievements.showcase.useAutomatic')}</Text>
            </MotionPressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 24, paddingHorizontal: Layout.screenPadding, paddingTop: 8 },
    header: { marginBottom: 16 },
    lead: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    card: {
      backgroundColor: colors.card,
      borderColor: colors.separator,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 8,
      minHeight: 88,
      padding: 12,
      width: '48%',
    },
    cardTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    order: { alignItems: 'center', borderRadius: 10, height: 20, justifyContent: 'center', width: 20 },
    orderText: { fontSize: 11, fontWeight: '600' },
    cardName: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', lineHeight: 17 },
    centerState: { alignItems: 'center', gap: 12, paddingVertical: 40 },
    stateText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
    retry: { justifyContent: 'center', minHeight: Layout.minTouchSize },
    retryText: { fontSize: 13, fontWeight: '600' },
    saveError: { color: colors.dangerText, fontSize: 13, marginTop: 16 },
    footer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 8,
      paddingBottom: 8,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 12,
    },
    primaryButton: {
      alignItems: 'center',
      borderRadius: Layout.radiusMedium,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      width: '100%',
    },
    primaryButtonText: { fontSize: 15, fontWeight: '600' },
    secondaryButton: { alignItems: 'center', justifyContent: 'center', minHeight: Layout.minTouchSize, width: '100%' },
    secondaryButtonText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    disabled: { opacity: 0.6 },
  });
}
