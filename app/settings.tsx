import { Ionicons } from '@expo/vector-icons';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Layout, ThemeColors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useLanguage } from '@/context/language-context';
import { useProfile } from '@/context/profile-context';
import { ThemePreference } from '@/context/theme-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { AppLanguage } from '@/types/profile';
import { cancelAllRestNotifications } from '@/utils/rest-notifications';
import { clearAllRestTimers } from '@/utils/rest-timer-storage';

const LANGUAGE_OPTIONS: { labelKey: string; value: AppLanguage }[] = [
  { labelKey: 'profile.languageTurkish', value: 'tr' },
  { labelKey: 'profile.languageEnglish', value: 'en' },
];

export default function SettingsScreen() {
  const { signOut } = useAuth();
  const { restTimerEnabled, savePreferredLanguage, setRestTimerEnabled } = useProfile();
  const { colors, preference, setPreference } = useAppTheme();
  const { language, setLanguage, t } = useLanguage();
  const styles = createStyles(colors);

  async function handleLanguageChange(nextLanguage: AppLanguage) {
    setLanguage(nextLanguage);
    try {
      await savePreferredLanguage(nextLanguage);
    } catch {
      Alert.alert(t('profile.languageFailed'), t('common.networkError'));
    }
  }

  async function handleRestTimerToggle(enabled: boolean) {
    try {
      await setRestTimerEnabled(enabled);
      // Ayar kapatılınca planlanmış mola bildirimleri ve yalnızca rest-timer
      // ön ekine sahip AsyncStorage kayıtları temizlenir; başka veri silinmez.
      if (!enabled) await Promise.all([cancelAllRestNotifications(), clearAllRestTimers()]);
    } catch {
      Alert.alert(t('profile.restTimerFailed'), t('profile.restTimerFailedBody'));
    }
  }

  function handleSignOut() {
    Alert.alert(t('profile.signOut'), t('profile.signOutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.signOut'),
        style: 'destructive',
        onPress: async () => {
          const result = await signOut();
          if (result.error) Alert.alert(t('profile.signOutFailed'), result.error);
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('profile.language')}</Text>
            <Text style={styles.caption}>{t('profile.languageCaption')}</Text>
          </View>
          <View accessibilityRole="radiogroup" style={styles.languageToggle}>
            {LANGUAGE_OPTIONS.map((option) => {
              const isSelected = language === option.value;

              return (
                <Pressable
                  accessibilityLabel={t(option.labelKey)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  key={option.value}
                  onPress={() => void handleLanguageChange(option.value)}
                  style={({ pressed }) => [
                    styles.languageButton,
                    isSelected && styles.languageButtonSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.languageText, isSelected && styles.languageTextSelected]}>
                    {option.value.toLocaleUpperCase('en-US')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.settingRow}>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('profile.appearance')}</Text>
            <Text style={styles.caption}>{t('profile.appearanceCaption')}</Text>
          </View>
          <View accessibilityRole="radiogroup" style={styles.themeToggle}>
            <ThemeButton
              colors={colors}
              icon="sunny-outline"
              label={t('profile.themeLight')}
              onSelect={setPreference}
              selected={preference === 'light'}
              styles={styles}
              value="light"
            />
            <ThemeButton
              colors={colors}
              icon="phone-portrait-outline"
              label={t('profile.themeSystem')}
              onSelect={setPreference}
              selected={preference === 'system'}
              styles={styles}
              value="system"
            />
            <ThemeButton
              colors={colors}
              icon="moon"
              label={t('profile.themeDark')}
              onSelect={setPreference}
              selected={preference === 'dark'}
              styles={styles}
              value="dark"
            />
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.settingRow}>
          <View style={styles.settingIcon}>
            <Ionicons name="time-outline" size={18} color={colors.accent} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('profile.restTimer')}</Text>
            <Text style={styles.caption}>{t('profile.restTimerCaption')}</Text>
          </View>
          <Switch
            accessibilityLabel={t('profile.restTimerLabel')}
            onValueChange={(enabled) => void handleRestTimerToggle(enabled)}
            thumbColor={Platform.OS === 'android' ? colors.onPrimary : undefined}
            trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
            value={restTimerEnabled}
          />
        </View>

        <View style={styles.divider} />

        <Pressable
          accessibilityRole="button"
          onPress={handleSignOut}
          style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}>
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.signOutText}>{t('profile.signOut')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ThemeButton({
  colors,
  icon,
  label,
  onSelect,
  selected,
  styles,
  value,
}: {
  colors: ThemeColors;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onSelect: (preference: ThemePreference) => void;
  selected: boolean;
  styles: ReturnType<typeof createStyles>;
  value: ThemePreference;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={() => onSelect(value)}
      style={({ pressed }) => [styles.themeButton, selected && styles.themeButtonSelected, pressed && styles.pressed]}>
      <Ionicons name={icon} size={15} color={selected ? colors.onPrimary : colors.textTertiary} />
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 40, paddingTop: 8 },
    settingRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: Layout.screenPadding,
    },
    settingIcon: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: Layout.radiusSmall,
      height: 34,
      justifyContent: 'center',
      width: 34,
    },
    settingText: { flex: 1, gap: 2 },
    settingTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    caption: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
    divider: {
      backgroundColor: colors.separator,
      height: StyleSheet.hairlineWidth,
      marginHorizontal: Layout.screenPadding,
      marginVertical: 22,
    },
    languageToggle: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusSmall,
      flexDirection: 'row',
      gap: 2,
      padding: 3,
    },
    languageButton: {
      alignItems: 'center',
      borderRadius: 6,
      height: 28,
      justifyContent: 'center',
      paddingHorizontal: 10,
    },
    languageButtonSelected: { backgroundColor: colors.primary },
    languageText: { color: colors.textTertiary, fontSize: 12, fontWeight: '600' },
    languageTextSelected: { color: colors.onPrimary },
    themeToggle: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusSmall,
      flexDirection: 'row',
      gap: 2,
      padding: 3,
    },
    themeButton: { alignItems: 'center', borderRadius: 6, height: 28, justifyContent: 'center', width: 30 },
    themeButtonSelected: { backgroundColor: colors.primary },
    signOutButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexDirection: 'row',
      gap: 8,
      marginHorizontal: Layout.screenPadding,
      minHeight: Layout.minTouchSize,
    },
    signOutText: { color: colors.danger, fontSize: 15, fontWeight: '500' },
    pressed: { opacity: 0.6 },
  });
}
