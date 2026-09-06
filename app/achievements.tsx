import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CareerAchievementsView } from '@/components/achievements/career-achievements-view';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAchievements } from '@/context/achievement-context';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * KALICI KARİYER BAŞARIMLARI — tam ekran.
 *
 * Sunum tamamen ortak `CareerAchievementsView` bileşenindedir; Rank →
 * Achievements sekmesiyle AYNI veri ve davranışı paylaşır (içerik ayrışmaz).
 * Bu ekran yalnız kendi `ScrollView`'ını ve giriş metnini verir; ekrana
 * girildiğinde ölçülü (debounce+coalesce+tek-uçuş) `requestSync()` tetikler.
 */
export default function AchievementsScreen() {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const { requestSync } = useAchievements();

  useFocusEffect(
    useCallback(() => {
      requestSync();
    }, [requestSync]),
  );

  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>{t('careerAchievements.screenLead')}</Text>
        <CareerAchievementsView />
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 32, paddingHorizontal: Layout.screenPadding, paddingTop: 8 },
    lead: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  });
}
