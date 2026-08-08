import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useLanguage } from '@/context/language-context';
import { useProfile } from '@/context/profile-context';
import { ThemePreference } from '@/context/theme-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getStoragePathFromUrl,
  ProfileImageKind,
  ProfileMediaError,
  removeProfileImagePaths,
} from '@/services/profile-media';
import { AppLanguage, TrainingGoal, UserProfile } from '@/types/profile';
import { cancelAllRestNotifications } from '@/utils/rest-notifications';
import { clearAllRestTimers } from '@/utils/rest-timer-storage';

const GOAL_OPTIONS: { glyph: string; labelKey: string; value: TrainingGoal }[] = [
  { glyph: '📅', labelKey: 'profile.goalConsistency', value: 'consistency' },
  { glyph: '⚡', labelKey: 'profile.goalStrength', value: 'strength' },
  { glyph: '🏋️', labelKey: 'profile.goalMuscle', value: 'muscle' },
  { glyph: '♡', labelKey: 'profile.goalFitness', value: 'fitness' },
];

const LANGUAGE_OPTIONS: { labelKey: string; value: AppLanguage }[] = [
  { labelKey: 'profile.languageTurkish', value: 'tr' },
  { labelKey: 'profile.languageEnglish', value: 'en' },
];

export default function ProfileScreen() {
  const { signOut, user } = useAuth();
  const { profile, restTimerEnabled, saveProfile, savePreferredLanguage, setRestTimerEnabled, uploadProfileMedia } =
    useProfile();
  const { colors, isDark, preference, setPreference } = useAppTheme();
  const { language, setLanguage, t } = useLanguage();
  const styles = createStyles(colors);
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<ProfileImageKind>();
  // Yüklenmiş ama henüz "Profili kaydet" ile kalıcılaşmamış dosyalar.
  // Ref kullanılır; unmount temizliği her zaman en güncel değeri görür.
  const stagedPathsRef = useRef<Partial<Record<ProfileImageKind, string>>>({});
  const userIdRef = useRef<string | undefined>(user?.id);

  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  useEffect(
    () => () => {
      // Kaydetmeden ekrandan çıkıldıysa yalnızca staged dosyalar silinir;
      // kalıcı olarak kaydedilmiş avatar/banner asla bu listeye girmez.
      const ownerId = userIdRef.current;
      const pendingPaths = Object.values(stagedPathsRef.current).filter(Boolean) as string[];
      stagedPathsRef.current = {};
      if (ownerId && pendingPaths.length > 0) {
        void removeProfileImagePaths(pendingPaths, ownerId);
      }
    },
    [],
  );

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  function updateDraft<Key extends keyof UserProfile>(key: Key, value: UserProfile[Key]) {
    setDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
  }

  async function pickProfileImage(kind: ProfileImageKind) {
    if (uploadingKind) return;

    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('profile.permissionTitle'), t('profile.permissionBody'));
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      // GIF'in hareketi korunması için kırpma/düzenleme ve yeniden kodlama yok.
      allowsEditing: false,
      mediaTypes: ['images'],
      // iOS'un GIF'i JPEG gibi uyumlu bir biçime dönüştürmesini engeller.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      quality: 1,
    });

    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    setUploadingKind(kind);
    try {
      // Kalıcı URL yalnızca yükleme tamamlandıktan sonra profile yazılır.
      const publicUrl = await uploadProfileMedia(kind, {
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        mimeType: asset.mimeType,
        uri: asset.uri,
      });

      // Aynı tür için daha önce yüklenip kaydedilmemiş dosya varsa silinir.
      const previousStagedPath = stagedPathsRef.current[kind];
      if (previousStagedPath && user?.id) {
        await removeProfileImagePaths([previousStagedPath], user.id);
      }

      const stagedPath = user?.id ? getStoragePathFromUrl(publicUrl, user.id) : undefined;
      stagedPathsRef.current = { ...stagedPathsRef.current, [kind]: stagedPath };
      updateDraft(kind === 'avatar' ? 'avatarUri' : 'bannerUri', publicUrl);
    } catch (error) {
      // Yükleme başarısızsa mevcut çalışan görsel korunur.
      const code = error instanceof ProfileMediaError ? error.code : 'uploadFailed';
      Alert.alert(t('profile.uploadFailedTitle'), t(`profile.mediaErrors.${code}`));
    } finally {
      setUploadingKind(undefined);
    }
  }

  /**
   * Avatar ve kapak için ortak kaldırma akışı. Yalnızca bu oturumda yüklenip
   * henüz kaydedilmemiş (staged) dosya hemen Storage'dan silinir; kalıcı
   * görsel, kullanıcı "Profili kaydet" dediğinde DB güncellemesi başarılı
   * olduktan sonra context tarafından temizlenir.
   */
  async function handleRemoveProfileImage(kind: ProfileImageKind) {
    const stagedPath = stagedPathsRef.current[kind];
    // Ref önce temizlenir: unmount temizliği aynı dosyayı ikinci kez silmeye çalışmaz.
    if (stagedPath) stagedPathsRef.current = { ...stagedPathsRef.current, [kind]: undefined };
    updateDraft(kind === 'avatar' ? 'avatarUri' : 'bannerUri', undefined);

    const ownerId = user?.id;
    if (stagedPath && ownerId) {
      // removeProfileImagePaths yolun kullanıcıya ait olduğunu ayrıca doğrular.
      await removeProfileImagePaths([stagedPath], ownerId);
    }
  }

  async function handleLanguageChange(nextLanguage: AppLanguage) {
    setLanguage(nextLanguage);
    try {
      await savePreferredLanguage(nextLanguage);
    } catch {
      Alert.alert(t('profile.languageFailed'), t('common.networkError'));
    }
  }

  async function handleSave() {
    const displayName = draft.displayName.trim();
    const username = draft.username.trim().replace(/^@/, '').toLocaleLowerCase('tr-TR');

    if (!displayName) {
      Alert.alert(t('profile.nameRequiredTitle'), t('profile.nameRequiredBody'));
      return;
    }

    if (username && !/^[a-z0-9_]{3,24}$/.test(username)) {
      Alert.alert(t('profile.usernameInvalidTitle'), t('profile.usernameInvalidBody'));
      return;
    }

    const nextProfile: UserProfile = {
      ...draft,
      displayName,
      username,
      bio: draft.bio.trim(),
    };

    setIsSaving(true);
    try {
      await saveProfile(nextProfile);
      // Dosyalar artık kalıcı: temizlik listesinden çıkarılır ki unmount
      // sırasında yanlışlıkla silinmesinler.
      stagedPathsRef.current = {};
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t('profile.saved'), t('profile.savedBody'));
    } catch (error) {
      // Başarısız kayıtta context yeni dosyaları sildi; işaretler tekrar
      // silmeye çalışılmaması için temizlenir.
      stagedPathsRef.current = {};
      if (error instanceof Error && error.message === 'bannerColumnMissing') {
        Alert.alert(t('profile.bannerNotSupported'), t('profile.bannerNotSupportedBody'));
        return;
      }
      Alert.alert(t('profile.saveFailed'), error instanceof Error ? error.message : t('common.networkError'));
    } finally {
      setIsSaving(false);
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

  const avatarLetter = draft.displayName.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'S';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.bannerSection}>
            <View style={styles.banner}>
              {draft.bannerUri ? (
                <Image autoplay contentFit="cover" source={{ uri: draft.bannerUri }} style={styles.bannerImage} />
              ) : (
                <View style={styles.bannerPlaceholder} />
              )}
              <Pressable
                accessibilityLabel={draft.bannerUri ? t('profile.changeBanner') : t('profile.addBanner')}
                accessibilityRole="button"
                disabled={uploadingKind !== undefined}
                onPress={() => void pickProfileImage('banner')}
                style={({ pressed }) => [styles.bannerButton, pressed && styles.pressed]}>
                {uploadingKind === 'banner' ? (
                  <ActivityIndicator color={colors.text} size="small" />
                ) : (
                  <Ionicons name="camera-outline" size={18} color={colors.text} />
                )}
              </Pressable>
            </View>

            <View style={styles.avatarWrapper}>
              <Pressable
                accessibilityLabel={draft.avatarUri ? t('profile.changePhoto') : t('profile.choosePhoto')}
                accessibilityRole="button"
                disabled={uploadingKind !== undefined}
                onPress={() => void pickProfileImage('avatar')}
                style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}>
                {draft.avatarUri ? (
                  <Image autoplay contentFit="cover" source={{ uri: draft.avatarUri }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarLetter}>{avatarLetter}</Text>
                )}
                {uploadingKind === 'avatar' && (
                  <View style={styles.avatarOverlay}>
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  </View>
                )}
              </Pressable>
            </View>
          </View>

          <Text style={styles.introText}>{t('profile.intro')}</Text>

          <View style={styles.photoRow}>
            <View style={styles.photoText}>
              <Text style={styles.photoTitle}>{t('profile.avatar')}</Text>
              <Text style={styles.caption}>{t('profile.avatarCaption')}</Text>
              <View style={styles.photoActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={uploadingKind !== undefined}
                  onPress={() => void pickProfileImage('avatar')}
                  style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}>
                  <Text style={styles.photoButtonGlyph}>🖼</Text>
                  <Text style={styles.photoButtonText}>
                    {uploadingKind === 'avatar'
                      ? t('profile.uploading')
                      : draft.avatarUri
                        ? t('profile.changePhoto')
                        : t('profile.choosePhoto')}
                  </Text>
                </Pressable>
                {draft.avatarUri && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleRemoveProfileImage('avatar')}
                    style={({ pressed }) => [styles.removePhotoButton, pressed && styles.pressed]}>
                    <Text style={styles.removePhotoText}>{t('common.remove')}</Text>
                  </Pressable>
                )}
                {draft.bannerUri && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleRemoveProfileImage('banner')}
                    style={({ pressed }) => [styles.removePhotoButton, pressed && styles.pressed]}>
                    <Text style={styles.removePhotoText}>{t('profile.removeBanner')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('profile.displayName')}</Text>
            <TextInput
              keyboardAppearance={isDark ? 'dark' : 'light'}
              maxLength={40}
              onChangeText={(value) => updateDraft('displayName', value)}
              placeholder={t('profile.displayNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              style={styles.input}
              value={draft.displayName}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('profile.username')}</Text>
            <View style={styles.usernameRow}>
              <Text style={styles.atSign}>@</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                maxLength={24}
                onChangeText={(value) => updateDraft('username', value.replace(/^@/, ''))}
                placeholder={t('profile.usernamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                style={styles.usernameInput}
                value={draft.username}
              />
            </View>
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>{t('profile.bio')}</Text>
              <Text style={styles.counter}>{draft.bio.length}/140</Text>
            </View>
            <TextInput
              keyboardAppearance={isDark ? 'dark' : 'light'}
              maxLength={140}
              multiline
              onChangeText={(value) => updateDraft('bio', value)}
              placeholder={t('profile.bioPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              style={[styles.input, styles.bioInput]}
              textAlignVertical="top"
              value={draft.bio}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('profile.goal')}</Text>
            <View accessibilityRole="radiogroup" style={styles.goalOptions}>
              {GOAL_OPTIONS.map((option) => {
                const isSelected = draft.trainingGoal === option.value;

                return (
                  <Pressable
                    accessibilityLabel={t(option.labelKey)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    key={option.value}
                    onPress={() => updateDraft('trainingGoal', option.value)}
                    style={({ pressed }) => [
                      styles.goalOption,
                      isSelected && styles.goalOptionSelected,
                      pressed && styles.pressed,
                    ]}>
                    <Text style={styles.goalGlyph}>{option.glyph}</Text>
                    <Text style={[styles.goalText, isSelected && styles.goalTextSelected]}>{t(option.labelKey)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={isSaving}
            onPress={handleSave}
            style={({ pressed }) => [styles.saveButton, (pressed || isSaving) && styles.pressed]}>
            <Ionicons name="checkmark" size={18} color={colors.onPrimary} />
            <Text style={styles.saveButtonText}>{isSaving ? t('common.saving') : t('profile.save')}</Text>
          </Pressable>

          <View style={styles.divider} />

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

          <View style={styles.accountRow}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.disciplineCompleted} />
            <View style={styles.settingText}>
              <Text style={styles.settingTitle}>{t('profile.accountConnected')}</Text>
              <Text numberOfLines={1} style={styles.caption}>
                {user?.email}
              </Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={handleSignOut}
            style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}>
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.signOutText}>{t('profile.signOut')}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
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
    flex: { flex: 1 },
    content: { paddingBottom: 40, paddingTop: 0 },
    introText: {
      color: colors.textSecondary,
      ...Type.caption,
      marginBottom: 22,
      paddingHorizontal: Layout.screenPadding,
    },
    bannerSection: { marginBottom: 12 },
    banner: {
      aspectRatio: 3,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
      width: '100%',
    },
    bannerImage: { height: '100%', width: '100%' },
    bannerPlaceholder: { backgroundColor: colors.surfaceMuted, flex: 1 },
    bannerButton: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 22,
      height: Layout.minTouchSize,
      justifyContent: 'center',
      opacity: 0.9,
      position: 'absolute',
      right: 12,
      top: 12,
      width: Layout.minTouchSize,
    },
    avatarWrapper: { marginTop: -36, paddingHorizontal: Layout.screenPadding },
    avatarOverlay: {
      alignItems: 'center',
      backgroundColor: '#00000099',
      bottom: 0,
      justifyContent: 'center',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    photoRow: { flexDirection: 'row', gap: 14, marginBottom: 24, paddingHorizontal: Layout.screenPadding },
    avatar: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderColor: colors.background,
      borderRadius: 40,
      borderWidth: 4,
      height: 80,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 80,
    },
    avatarImage: { height: '100%', width: '100%' },
    avatarLetter: { color: colors.primarySoftText, fontSize: 28, fontWeight: '500' },
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
    photoText: { flex: 1, gap: 2 },
    photoTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    caption: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
    photoActions: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 10 },
    photoButton: {
      alignItems: 'center',
      borderColor: colors.primary,
      borderRadius: Layout.radiusSmall,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 6,
      minHeight: 32,
      paddingHorizontal: 12,
    },
    photoButtonGlyph: { fontSize: 12 },
    photoButtonText: { color: colors.primary, fontSize: 13, fontWeight: '500' },
    removePhotoButton: { justifyContent: 'center', minHeight: 32 },
    removePhotoText: { color: colors.danger, fontSize: 13, fontWeight: '500' },
    field: { paddingHorizontal: Layout.screenPadding, gap: 8, marginBottom: 18 },
    labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    label: { color: colors.textSecondary, fontSize: 13 },
    counter: { color: colors.textTertiary, fontSize: 12 },
    input: {
      backgroundColor: colors.background,
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontSize: 15,
      minHeight: 48,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    usernameRow: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      minHeight: 48,
      paddingHorizontal: 16,
    },
    atSign: { color: colors.textSecondary, fontSize: 15 },
    usernameInput: { color: colors.text, flex: 1, fontSize: 15, paddingHorizontal: 6, paddingVertical: 12 },
    bioInput: { minHeight: 48 },
    goalOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    goalOption: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 6,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 16,
    },
    goalOptionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    goalGlyph: { fontSize: 13 },
    goalText: { color: colors.text, fontSize: 14, fontWeight: '400' },
    goalTextSelected: { color: colors.onPrimary, fontWeight: '500' },
    saveButton: { marginHorizontal: Layout.screenPadding,
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      marginTop: 8,
      minHeight: 52,
    },
    saveButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
    divider: { marginHorizontal: Layout.screenPadding,
      backgroundColor: colors.separator,
      height: StyleSheet.hairlineWidth,
      marginVertical: 22,
    },
    settingRow: { paddingHorizontal: Layout.screenPadding, alignItems: 'center', flexDirection: 'row', gap: 12 },
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
    themeToggle: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusSmall,
      flexDirection: 'row',
      gap: 2,
      padding: 3,
    },
    themeButton: { alignItems: 'center', borderRadius: 6, height: 28, justifyContent: 'center', width: 30 },
    themeButtonSelected: { backgroundColor: colors.primary },
    accountRow: { paddingHorizontal: Layout.screenPadding, alignItems: 'center', flexDirection: 'row', gap: 12 },
    signOutButton: { marginHorizontal: Layout.screenPadding,
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexDirection: 'row',
      gap: 8,
      marginTop: 18,
      minHeight: Layout.minTouchSize,
    },
    signOutText: { color: colors.danger, fontSize: 15, fontWeight: '500' },
    pressed: { opacity: 0.6 },
  });
}
