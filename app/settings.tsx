import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ColorPresetRow } from '@/components/color-preset-picker';
import { COLOR_FEATURES, ColorFeature, ColorPresetId, SETTINGS_ACCENT_DARK, SETTINGS_ACCENT_LIGHT, getColorPresetHex, getFeatureFallbackColor, getOnAccentColor, withAlpha } from '@/constants/color-presets';
import { MASCOT_NAME } from '@/constants/mascot';
import { Form, Layout, ThemeColors, Type } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useLanguage } from '@/context/language-context';
import { useMascot } from '@/context/mascot-context';
import { useProfile } from '@/context/profile-context';
import { ThemePreference } from '@/context/theme-context';
import { useWorkoutReminders } from '@/context/workout-reminder-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { AppLanguage } from '@/types/profile';
import { cancelAllRestNotifications } from '@/utils/rest-notifications';
import { countEnabledReminders } from '@/utils/workout-reminder-core';
import { clearAllRestTimers } from '@/utils/rest-timer-storage';

const LANGUAGE_OPTIONS: { labelKey: string; value: AppLanguage }[] = [
  { labelKey: 'profile.languageTurkish', value: 'tr' },
  { labelKey: 'profile.languageEnglish', value: 'en' },
];

const FEATURE_LABEL_KEYS: Record<ColorFeature, string> = {
  workoutDays: 'profile.colorFeatureWorkoutDays',
  activeWorkoutPrimary: 'profile.colorFeatureActiveWorkoutPrimary',
  activeWorkoutSecondary: 'profile.colorFeatureActiveWorkoutSecondary',
  historyProgress: 'profile.colorFeatureHistoryProgress',
  roseaChat: 'profile.colorFeatureRoseaChat',
  profile: 'profile.colorFeatureProfile',
  friends: 'profile.colorFeatureFriends',
  todayHighlight: 'profile.colorFeatureTodayHighlight',
  historyWorkoutsRing: 'profile.colorFeatureHistoryWorkoutsRing',
  historyExercisesRing: 'profile.colorFeatureHistoryExercisesRing',
  historyDurationRing: 'profile.colorFeatureHistoryDurationRing',
  settings: 'profile.colorFeatureSettings',
};

export default function SettingsScreen() {
  const { signOut } = useAuth();
  const {
    restTimerEnabled,
    savePreferredLanguage,
    setRestTimerEnabled,
    setShowExerciseIcons,
    setShowProgramIcons,
    shareActiveProgram,
    setShareActiveProgram,
    showExerciseIcons,
    showProgramIcons,
    colorPresets,
    resetColorPresets,
    setColorPreset,
  } = useProfile();
  const { enabled: mascotEnabled, setEnabled: setMascotEnabled } = useMascot();
  const { reminders } = useWorkoutReminders();
  const { colors, isDark, preference, setPreference } = useAppTheme();
  const { language, setLanguage, t } = useLanguage();
  const enabledReminderCount = countEnabledReminders(reminders);
  const reminderSubtitle =
    enabledReminderCount === 0
      ? t('reminders.settingsSubtitleEmpty')
      : enabledReminderCount === 1
        ? t('reminders.settingsSubtitleCountOne')
        : t('reminders.settingsSubtitleCount', { count: enabledReminderCount });
  const todayColor = useFeatureColor('todayHighlight', colors.primary).color;
  /**
   * Ayarlar ekranının vurgu rengi. Varsayılan bugünkü mordur; kullanıcı bir
   * preset seçmezse ekran birebir aynı görünür. Tehlikeli `Sign out` bu renge
   * BAĞLANMAZ, semantik kırmızı kalır.
   */
  const settingsAccent = useFeatureColor(
    'settings',
    isDark ? SETTINGS_ACCENT_DARK : SETTINGS_ACCENT_LIGHT,
  ).color;
  const onSettingsAccent = getOnAccentColor(settingsAccent);
  const styles = createStyles(colors, isDark, todayColor, settingsAccent, onSettingsAccent);

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

  async function handleDisplayPreferenceToggle(
    setter: (enabled: boolean) => Promise<void>,
    enabled: boolean,
  ) {
    try {
      await setter(enabled);
    } catch {
      Alert.alert(t('profile.displayPreferenceFailed'), t('profile.displayPreferenceFailedBody'));
    }
  }

  /**
   * Aktif program paylaşımı. Başarısız kayıtta context değeri önceki hâline
   * geri döndürür; burada yalnızca anlaşılır bir uyarı gösterilir.
   */
  async function handleShareActiveProgramToggle(enabled: boolean) {
    try {
      await setShareActiveProgram(enabled);
    } catch {
      Alert.alert(t('profile.displayPreferenceFailed'), t('profile.displayPreferenceFailedBody'));
    }
  }

  async function handleColorSelect(feature: ColorFeature, presetId: ColorPresetId | undefined) {
    try {
      await setColorPreset(feature, presetId);
    } catch {
      Alert.alert(t('profile.colorSaveFailed'), t('common.networkError'));
    }
  }

  function handleResetColors() {
    Alert.alert(t('profile.colorResetDefaults'), t('profile.colorResetConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.colorResetDefaults'),
        onPress: () => {
          void resetColorPresets().catch(() =>
            Alert.alert(t('profile.colorSaveFailed'), t('common.networkError')),
          );
        },
      },
    ]);
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
      <Stack.Screen
        options={{
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              accessibilityLabel={t('tabs.profile')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace('/(tabs)/profile')
              }
              style={({ pressed }) => [styles.headerBackButton, pressed && styles.pressed]}>
              <Ionicons name="chevron-back" size={22} color={settingsAccent} />
              <Text style={styles.headerBackText}>{t('tabs.profile')}</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        style={styles.settingsCard}>
        <View style={[styles.settingRow, styles.topSettingRow]}>
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

        <View style={[styles.settingRow, styles.topSettingRow, styles.appearanceRow]}>
          <View style={styles.appearanceText}>
            <Text style={styles.appearanceTitle}>{t('profile.appearance')}</Text>
            <Text style={styles.appearanceCaption}>{t('profile.appearanceCaption')}</Text>
          </View>
          <View accessibilityRole="radiogroup" style={styles.themeToggle}>
            <ThemeButton
              colors={colors}
              icon="sunny-outline"
              label={t('profile.themeLight')}
              onAccent={onSettingsAccent}
              onSelect={setPreference}
              selected={preference === 'light'}
              styles={styles}
              value="light"
            />
            <ThemeButton
              colors={colors}
              icon="sunny"
              label={t('profile.themeWarmLight')}
              onAccent={onSettingsAccent}
              onSelect={setPreference}
              selected={preference === 'warmLight'}
              styles={styles}
              value="warmLight"
            />
            <ThemeButton
              colors={colors}
              icon="phone-portrait-outline"
              label={t('profile.themeSystem')}
              onAccent={onSettingsAccent}
              onSelect={setPreference}
              selected={preference === 'system'}
              styles={styles}
              value="system"
            />
            <ThemeButton
              colors={colors}
              icon="moon-outline"
              label={t('profile.themeSoftDark')}
              onAccent={onSettingsAccent}
              onSelect={setPreference}
              selected={preference === 'softDark'}
              styles={styles}
              value="softDark"
            />
            <ThemeButton
              colors={colors}
              icon="ellipse"
              label={t('profile.themeDark')}
              onAccent={onSettingsAccent}
              onSelect={setPreference}
              selected={preference === 'dark'}
              styles={styles}
              value="dark"
            />
          </View>
        </View>

        <View style={styles.divider} />

        <View style={[styles.settingRow, styles.featureRow]}>
          <View style={styles.settingIcon}>
            <Ionicons name="albums-outline" size={19} color={settingsAccent} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('profile.programListIcons')}</Text>
            <Text style={styles.caption}>{t('profile.programListIconsCaption')}</Text>
          </View>
          <Switch
            accessibilityLabel={t('profile.programListIconsLabel')}
            onValueChange={(enabled) => void handleDisplayPreferenceToggle(setShowProgramIcons, enabled)}
            thumbColor={Platform.OS === 'android' ? '#F6F5F7' : undefined}
            trackColor={{ false: colors.surfaceMuted, true: settingsAccent }}
            value={showProgramIcons}
          />
        </View>

        <View style={styles.divider} />

        <View style={[styles.settingRow, styles.featureRow]}>
          <View style={styles.settingIcon}>
            <Ionicons name="barbell-outline" size={19} color={settingsAccent} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('profile.workoutDayIcons')}</Text>
            <Text style={styles.caption}>{t('profile.workoutDayIconsCaption')}</Text>
          </View>
          <Switch
            accessibilityLabel={t('profile.workoutDayIconsLabel')}
            onValueChange={(enabled) => void handleDisplayPreferenceToggle(setShowExerciseIcons, enabled)}
            thumbColor={Platform.OS === 'android' ? '#F6F5F7' : undefined}
            trackColor={{ false: colors.surfaceMuted, true: settingsAccent }}
            value={showExerciseIcons}
          />
        </View>

        <View style={styles.divider} />

        <View style={[styles.settingRow, styles.featureRow]}>
          <View style={styles.settingIcon}>
            <Ionicons name="share-social-outline" size={19} color={settingsAccent} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('profile.shareActiveProgram')}</Text>
            <Text style={styles.caption}>{t('profile.shareActiveProgramCaption')}</Text>
          </View>
          <Switch
            accessibilityLabel={t('profile.shareActiveProgramLabel')}
            onValueChange={(enabled) => void handleShareActiveProgramToggle(enabled)}
            thumbColor={Platform.OS === 'android' ? '#F6F5F7' : undefined}
            trackColor={{ false: colors.surfaceMuted, true: settingsAccent }}
            value={shareActiveProgram}
          />
        </View>

        <View style={styles.divider} />

        <View style={[styles.settingRow, styles.featureRow]}>
          <View style={styles.settingIcon}>
            <Ionicons name="time-outline" size={19} color={settingsAccent} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('profile.restTimer')}</Text>
            <Text style={styles.caption}>{t('profile.restTimerCaption')}</Text>
          </View>
          <Switch
            accessibilityLabel={t('profile.restTimerLabel')}
            onValueChange={(enabled) => void handleRestTimerToggle(enabled)}
            thumbColor={Platform.OS === 'android' ? '#F6F5F7' : undefined}
            trackColor={{ false: colors.surfaceMuted, true: settingsAccent }}
            value={restTimerEnabled}
          />
        </View>

        <View style={styles.divider} />

        <View style={[styles.settingRow, styles.featureRow]}>
          <View style={styles.settingIcon}>
            <Ionicons name="happy-outline" size={19} color={settingsAccent} />
          </View>
          <View style={styles.settingText}>
            {/* Etiket duruma göre değişir: görünürken "tatile gönder",
                gizliyken "geri getir". Saklanan boolean tercih aynen korunur —
                yalnızca metin duruma bakar, değer hiçbir yerde terslenmez. */}
            <Text style={styles.settingTitle}>
              {t(mascotEnabled ? 'mascot.holidaySend' : 'mascot.holidayReturn', {
                name: MASCOT_NAME,
              })}
            </Text>
            <Text style={styles.caption}>{t('mascot.settingsCaption', { name: MASCOT_NAME })}</Text>
          </View>
          <Switch
            accessibilityLabel={t(
              mascotEnabled ? 'mascot.holidaySend' : 'mascot.holidayReturn',
              { name: MASCOT_NAME },
            )}
            onValueChange={(enabled) => void setMascotEnabled(enabled)}
            thumbColor={Platform.OS === 'android' ? '#F6F5F7' : undefined}
            trackColor={{ false: colors.surfaceMuted, true: settingsAccent }}
            value={mascotEnabled}
          />
        </View>

        <View style={styles.divider} />

        <Pressable
          accessibilityLabel={t('reminders.settingsTitle')}
          accessibilityRole="button"
          onPress={() => router.push('/reminders')}
          style={({ pressed }) => [styles.settingRow, styles.featureRow, pressed && styles.pressed]}>
          <View style={styles.settingIcon}>
            <Ionicons name="notifications-outline" size={19} color={settingsAccent} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('reminders.settingsTitle')}</Text>
            <Text style={styles.caption}>{reminderSubtitle}</Text>
          </View>
          <Ionicons color={colors.textTertiary} name="chevron-forward" size={18} />
        </Pressable>

        <View style={styles.divider} />

        <Pressable
          accessibilityLabel={t('safety.blockedUsers')}
          accessibilityRole="button"
          onPress={() => router.push('/blocked-users')}
          style={({ pressed }) => [styles.settingRow, styles.featureRow, pressed && styles.pressed]}>
          <View style={styles.settingIcon}>
            <Ionicons name="ban-outline" size={19} color={settingsAccent} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('safety.blockedUsers')}</Text>
            <Text style={styles.caption}>{t('safety.blockedUsersCaption')}</Text>
          </View>
          <Ionicons color={colors.textTertiary} name="chevron-forward" size={18} />
        </Pressable>

        <View style={styles.divider} />

        {/*
          RENK ÖN AYARLARI — son ayar grubu, "Çıkış yap"ın hemen üzerinde.
          Ayarların mevcut tasarım dili korunur: yüzey/metin renkleri global
          temadan gelir, yalnızca örnek daireleri seçilen rengi gösterir.
        */}
        <View style={styles.colorSection}>
          <Text style={styles.colorSectionTitle}>{t('profile.colorPresets')}</Text>
          <Text style={styles.caption}>{t('profile.colorPresetsCaption')}</Text>

          <View style={styles.colorRows}>
            {COLOR_FEATURES.map((feature) => (
              <ColorPresetRow
                currentColor={
                  colorPresets[feature]
                    ? getColorPresetHex(colorPresets[feature] as ColorPresetId)
                    : getFeatureFallbackColor(feature, colors, isDark)
                }
                defaultColor={getFeatureFallbackColor(feature, colors, isDark)}
                feature={feature}
                key={feature}
                labelKey={FEATURE_LABEL_KEYS[feature]}
                onSelect={(presetId) => void handleColorSelect(feature, presetId)}
                selectedPresetId={colorPresets[feature]}
              />
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={handleResetColors}
            style={({ pressed }) => [styles.colorResetButton, pressed && styles.pressed]}>
            <Text style={styles.colorResetText}>{t('profile.colorResetDefaults')}</Text>
          </Pressable>
        </View>

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
  onAccent,
  onSelect,
  selected,
  styles,
  value,
}: {
  colors: ThemeColors;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onSelect: (preference: ThemePreference) => void;
  /** Seçili ikonun okunabilir ön plan rengi (Ayarlar presetinden hesaplanır). */
  onAccent: string;
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
      <Ionicons name={icon} size={23} color={selected ? onAccent : colors.textTertiary} />
    </Pressable>
  );
}

function createStyles(
  colors: ThemeColors,
  isDark: boolean,
  todayColor: string,
  settingsAccent: string,
  onSettingsAccent: string,
) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    settingsCard: {
      backgroundColor: colors.background,
      flex: 1,
    },
    headerBackButton: {
      alignItems: 'center',
      flexDirection: 'row',
      minHeight: Layout.minTouchSize,
      paddingRight: 8,
    },
    headerBackText: { color: settingsAccent, fontSize: 17 },
    content: {
      paddingBottom: 28,
      paddingHorizontal: 20,
      paddingTop: 20,
    },
    settingRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      minHeight: Layout.minTouchSize,
    },
    topSettingRow: { alignItems: 'flex-start' },
    appearanceRow: {
      alignItems: 'stretch',
      backgroundColor: colors.surface,
      borderRadius: 28,
      flexDirection: 'column',
      gap: 28,
      marginTop: 32,
      padding: 24,
    },
    appearanceText: { gap: 8 },
    appearanceTitle: { color: colors.text, fontSize: 30, fontWeight: '700', lineHeight: 36 },
    appearanceCaption: { color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
    featureRow: { minHeight: 80 },
    settingIcon: {
      alignItems: 'center',
      backgroundColor: withAlpha(settingsAccent, isDark ? 0.16 : 0.12),
      borderRadius: 12,
      height: 42,
      justifyContent: 'center',
      width: 42,
    },
    settingText: { flex: 1, gap: 4 },
    /**
     * Ayar adı Ana Sayfa'daki satır başlığı ölçüsünde: okunur ama bağırmıyor.
     * Eski 17/700 hem çok büyük hem çok kalındı.
     */
    settingTitle: { color: colors.text, ...Form.action, lineHeight: 20 },
    caption: { color: colors.textSecondary, ...Type.caption, lineHeight: 18 },
    colorSection: { gap: 4 },
    colorSectionTitle: { color: colors.text, ...Type.rowTitle },
    colorRows: { marginTop: 8 },
    colorResetButton: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      marginTop: 4,
      minHeight: Layout.minTouchSize,
    },
    colorResetText: { color: todayColor, ...Type.body },
    divider: {
      backgroundColor: colors.separator,
      height: StyleSheet.hairlineWidth,
      marginVertical: 20,
    },
    languageToggle: {
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 2,
      padding: 3,
    },
    languageButton: {
      alignItems: 'center',
      borderRadius: Layout.radiusPill,
      height: 34,
      justifyContent: 'center',
      minWidth: 44,
      paddingHorizontal: 10,
    },
    languageButtonSelected: { backgroundColor: settingsAccent },
    languageText: { color: colors.textTertiary, ...Type.caption, fontWeight: '600' },
    // Kontrast parlaklıktan hesaplanır; sabit açık ton varsayılmaz.
    languageTextSelected: { color: onSettingsAccent },
    themeToggle: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 4,
      padding: 6,
    },
    themeButton: {
      alignItems: 'center',
      borderRadius: Layout.radiusPill,
      flex: 1,
      justifyContent: 'center',
      minHeight: 56,
    },
    themeButtonSelected: { backgroundColor: settingsAccent },
    signOutButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexDirection: 'row',
      gap: 8,
      marginTop: 20,
      minHeight: Layout.minTouchSize,
    },
    signOutText: { color: colors.danger, ...Form.action },
    pressed: { opacity: 0.6 },
  });
}
