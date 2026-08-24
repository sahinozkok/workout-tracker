import { Ionicons } from '@expo/vector-icons';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MASCOT_NAME } from '@/constants/mascot';
import { Form, Layout, ThemeColors, Type } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useLanguage } from '@/context/language-context';
import { useMascot } from '@/context/mascot-context';
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
  const {
    restTimerEnabled,
    savePreferredLanguage,
    setRestTimerEnabled,
    setShowExerciseIcons,
    setShowProgramIcons,
    showExerciseIcons,
    showProgramIcons,
  } = useProfile();
  const { enabled: mascotEnabled, setEnabled: setMascotEnabled } = useMascot();
  const { colors, isDark, preference, setPreference } = useAppTheme();
  const { language, setLanguage, t } = useLanguage();
  const styles = createStyles(colors, isDark);

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

        <View style={[styles.settingRow, styles.featureRow]}>
          <View style={styles.settingIcon}>
            <Ionicons name="albums-outline" size={19} color={isDark ? '#CBB4F2' : '#60458A'} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('profile.programListIcons')}</Text>
            <Text style={styles.caption}>{t('profile.programListIconsCaption')}</Text>
          </View>
          <Switch
            accessibilityLabel={t('profile.programListIconsLabel')}
            onValueChange={(enabled) => void handleDisplayPreferenceToggle(setShowProgramIcons, enabled)}
            thumbColor={Platform.OS === 'android' ? '#F6F5F7' : undefined}
            trackColor={{ false: colors.surfaceMuted, true: '#60458A' }}
            value={showProgramIcons}
          />
        </View>

        <View style={styles.divider} />

        <View style={[styles.settingRow, styles.featureRow]}>
          <View style={styles.settingIcon}>
            <Ionicons name="barbell-outline" size={19} color={isDark ? '#CBB4F2' : '#60458A'} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('profile.workoutDayIcons')}</Text>
            <Text style={styles.caption}>{t('profile.workoutDayIconsCaption')}</Text>
          </View>
          <Switch
            accessibilityLabel={t('profile.workoutDayIconsLabel')}
            onValueChange={(enabled) => void handleDisplayPreferenceToggle(setShowExerciseIcons, enabled)}
            thumbColor={Platform.OS === 'android' ? '#F6F5F7' : undefined}
            trackColor={{ false: colors.surfaceMuted, true: '#60458A' }}
            value={showExerciseIcons}
          />
        </View>

        <View style={styles.divider} />

        <View style={[styles.settingRow, styles.featureRow]}>
          <View style={styles.settingIcon}>
            <Ionicons name="time-outline" size={19} color={isDark ? '#CBB4F2' : '#60458A'} />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingTitle}>{t('profile.restTimer')}</Text>
            <Text style={styles.caption}>{t('profile.restTimerCaption')}</Text>
          </View>
          <Switch
            accessibilityLabel={t('profile.restTimerLabel')}
            onValueChange={(enabled) => void handleRestTimerToggle(enabled)}
            thumbColor={Platform.OS === 'android' ? '#F6F5F7' : undefined}
            trackColor={{ false: colors.surfaceMuted, true: '#60458A' }}
            value={restTimerEnabled}
          />
        </View>

        <View style={styles.divider} />

        <View style={[styles.settingRow, styles.featureRow]}>
          <View style={styles.settingIcon}>
            <Ionicons name="happy-outline" size={19} color={isDark ? '#CBB4F2' : '#60458A'} />
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
            trackColor={{ false: colors.surfaceMuted, true: '#60458A' }}
            value={mascotEnabled}
          />
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

function createStyles(colors: ThemeColors, isDark: boolean) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    settingsCard: {
      backgroundColor: colors.background,
      flex: 1,
    },
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
    appearanceRow: { marginTop: 32 },
    featureRow: { minHeight: 80 },
    settingIcon: {
      alignItems: 'center',
      backgroundColor: isDark ? '#1E162B' : '#F0EAF8',
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
    languageButtonSelected: { backgroundColor: '#60458A' },
    languageText: { color: colors.textTertiary, ...Type.caption, fontWeight: '600' },
    languageTextSelected: { color: '#F6F3FA' },
    themeToggle: {
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 2,
      padding: 3,
    },
    themeButton: { alignItems: 'center', borderRadius: Layout.radiusPill, height: 34, justifyContent: 'center', width: 36 },
    themeButtonSelected: { backgroundColor: '#60458A' },
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
