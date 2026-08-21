import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LevelProgressRing } from '@/components/rewards/level-progress-ring';
import { ProfileProofStats } from '@/components/rewards/profile-proof-stats';
import { ProfileDisciplineCard } from '@/components/profile-discipline-card';
import { Fonts, Layout, ThemeColors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useLanguage } from '@/context/language-context';
import { useProfile } from '@/context/profile-context';
import { useRewards } from '@/context/reward-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getStoragePathFromUrl,
  ProfileImageKind,
  ProfileMediaError,
  removeProfileImagePaths,
} from '@/services/profile-media';
import { TrainingGoal, UserProfile } from '@/types/profile';
import { calculateDisciplineStreak } from '@/utils/discipline';

const GOAL_OPTIONS: { glyph: string; labelKey: string; value: TrainingGoal }[] = [
  { glyph: '📅', labelKey: 'profile.goalConsistency', value: 'consistency' },
  { glyph: '⚡', labelKey: 'profile.goalStrength', value: 'strength' },
  { glyph: '🏋️', labelKey: 'profile.goalMuscle', value: 'muscle' },
  { glyph: '♡', labelKey: 'profile.goalFitness', value: 'fitness' },
];

export default function ProfileScreen() {
  const { user } = useAuth();
  const { profile, saveProfile, saveProfileMedia, uploadProfileMedia } = useProfile();
  const { colors, isDark } = useAppTheme();
  const { disciplineStatuses, workoutSessions } = useWorkout();
  const { t } = useLanguage();
  const { progress: levelProgress } = useRewards();
  const styles = createStyles(colors, isDark);
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
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

  const isProfileEditorOpenRef = useRef(isProfileEditorOpen);

  useEffect(() => {
    isProfileEditorOpenRef.current = isProfileEditorOpen;
  }, [isProfileEditorOpen]);

  useEffect(() => {
    // Kapak/avatar artık anında kalıcılaştığı için profil nesnesi kullanıcı
    // formu doldururken de değişebilir. Düzenleme alanı açıkken yalnızca
    // görsel alanlar eşitlenir; henüz kaydedilmemiş ad/bio metinleri ezilmez.
    setDraft((current) =>
      isProfileEditorOpenRef.current
        ? { ...current, avatarUri: profile.avatarUri, bannerUri: profile.bannerUri }
        : profile,
    );
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

      // Kalıcılaştırma bitene kadar dosya staged sayılır; bu arada ekrandan
      // çıkılırsa sahipsiz dosya bırakılmaz.
      const stagedPath = user?.id ? getStoragePathFromUrl(publicUrl, user.id) : undefined;
      stagedPathsRef.current = { ...stagedPathsRef.current, [kind]: stagedPath };

      try {
        // Kamera düğmesi düzenleme alanı kapalıyken de erişilebilir olduğundan,
        // kullanıcıdan ayrıca "Profili kaydet" demesi beklenmez.
        await saveProfileMedia(kind, publicUrl);
      } finally {
        // Başarılıysa dosya artık kalıcı: unmount temizliği onu silmemeli.
        // Başarısızsa context dosyayı zaten sildi: aynı yol ikinci kez
        // hedeflenmemeli. Her iki durumda da işaret kaldırılır.
        stagedPathsRef.current = { ...stagedPathsRef.current, [kind]: undefined };
      }

      updateDraft(kind === 'avatar' ? 'avatarUri' : 'bannerUri', publicUrl);
    } catch (error) {
      // Yükleme veya kayıt başarısızsa mevcut çalışan görsel korunur.
      if (error instanceof Error && error.message === 'bannerColumnMissing') {
        Alert.alert(t('profile.bannerNotSupported'), t('profile.bannerNotSupportedBody'));
      } else {
        const code = error instanceof ProfileMediaError ? error.code : 'uploadFailed';
        Alert.alert(t('profile.uploadFailedTitle'), t(`profile.mediaErrors.${code}`));
      }
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
      setIsProfileEditorOpen(false);
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

  const avatarLetter = draft.displayName.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'S';
  const completedWorkoutDayCount = new Set(
    workoutSessions
      .filter((session) => session.status === 'completed')
      .map((session) => session.dateKey),
  ).size;
  const disciplineStreak = calculateDisciplineStreak(disciplineStatuses);
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
            </View>

            <View style={styles.avatarWrapper}>
              <View style={styles.avatar}>
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
              </View>
            </View>
          </View>

          <View style={styles.profileSummary}>
            <Text numberOfLines={1} style={styles.summaryUsername}>
              @{draft.username || t('profile.usernamePlaceholder')}
            </Text>
            <Text style={styles.summaryName}>{draft.displayName || t('profile.displayNamePlaceholder')}</Text>
            {draft.bio.trim().length > 0 && <Text style={styles.summaryBio}>{draft.bio.trim()}</Text>}

            <View style={styles.levelIdentityRow}>
              <View style={styles.levelPill}>
                <Text style={styles.levelPillIcon}>❀</Text>
                <Text style={styles.levelPillText}>{t('rewards.levelLabel', { level: levelProgress.level })}</Text>
              </View>
            </View>

            <View style={styles.levelSection}>
              <LevelProgressRing
                level={levelProgress.level}
                xpForNextLevel={levelProgress.xpForNextLevel}
                xpIntoLevel={levelProgress.xpIntoLevel}
              />
            </View>

            <ProfileProofStats
              dayStreak={disciplineStreak}
              roseBalance={levelProgress.roseBalance}
              workoutDays={completedWorkoutDayCount}
            />

          </View>

          {/* Disiplin kartı düzenleme formunun dışındadır; form kapalıyken de
              görünür ve mevcut kullanıcı için etkileşimlidir. Profil ekranına
              **özel** bir bileşen kullanılır: Ana Sayfa takvimiyle hiçbir stil
              veya ölçü paylaşmaz, yalnızca gerçek veri ve tarih hesaplarını
              paylaşır. Bu sayede karttaki hiçbir değişiklik Ana Sayfa'yı
              etkileyemez. */}
          <View style={styles.calendarSection}>
            <ProfileDisciplineCard collapsible />
          </View>

          {/* Arkadaşlar: yeni sekme eklenmez; kök Stack'teki /friends ekranına gider. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/friends')}
            style={({ pressed }) => [styles.friendsRow, pressed && styles.pressed]}>
            <View style={styles.friendsIcon}>
              <Ionicons name="people-outline" size={18} color={colors.textSecondary} />
            </View>
            <View style={styles.friendsText}>
              <Text style={styles.friendsTitle}>{t('friends.profileRow')}</Text>
              <Text style={styles.friendsCaption}>{t('friends.profileRowCaption')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </Pressable>

          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isProfileEditorOpen }}
              onPress={() => setIsProfileEditorOpen((current) => !current)}
              style={({ pressed }) => [styles.editProfileButton, pressed && styles.pressed]}>
              <Ionicons name="pencil-outline" size={13} color={colors.text} />
              <Text style={styles.editProfileLabel}>{t('common.edit')}</Text>
            </Pressable>

            <Pressable
              accessibilityLabel={t('profile.settings')}
              accessibilityRole="button"
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.settingsButton, pressed && styles.pressed]}>
              <Ionicons name="settings-outline" size={19} color={colors.textSecondary} />
            </Pressable>
          </View>

          {isProfileEditorOpen && (
            <View style={styles.editorSection}>
              <Text style={styles.introText}>{t('profile.intro')}</Text>

              <View style={styles.mediaEditorRow}>
                <View style={styles.avatarEditorPreview}>
                  {draft.avatarUri ? (
                    <Image autoplay contentFit="cover" source={{ uri: draft.avatarUri }} style={styles.mediaPreviewImage} />
                  ) : (
                    <Text style={styles.mediaPreviewLetter}>{avatarLetter}</Text>
                  )}
                  {uploadingKind === 'avatar' && (
                    <View style={styles.mediaPreviewOverlay}>
                      <ActivityIndicator color="#F4F4F6" size="small" />
                    </View>
                  )}
                </View>
                <View style={styles.mediaEditorCopy}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={uploadingKind !== undefined}
                    onPress={() => void pickProfileImage('avatar')}
                    style={({ pressed }) => [styles.mediaChangeButton, pressed && styles.pressed]}>
                    <Text style={styles.mediaChangeText}>
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
                      disabled={uploadingKind !== undefined}
                      onPress={() => void handleRemoveProfileImage('avatar')}
                      style={({ pressed }) => [styles.mediaRemoveButton, pressed && styles.pressed]}>
                      <Text style={styles.mediaRemoveText}>{t('common.remove')}</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              <View style={styles.mediaEditorRow}>
                <View style={styles.bannerEditorPreview}>
                  {draft.bannerUri ? (
                    <Image autoplay contentFit="cover" source={{ uri: draft.bannerUri }} style={styles.mediaPreviewImage} />
                  ) : (
                    <View style={styles.mediaPreviewPlaceholder} />
                  )}
                  {uploadingKind === 'banner' && (
                    <View style={styles.mediaPreviewOverlay}>
                      <ActivityIndicator color="#F4F4F6" size="small" />
                    </View>
                  )}
                </View>
                <View style={styles.mediaEditorCopy}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={uploadingKind !== undefined}
                    onPress={() => void pickProfileImage('banner')}
                    style={({ pressed }) => [styles.mediaChangeButton, pressed && styles.pressed]}>
                    <Text style={styles.mediaChangeText}>
                      {uploadingKind === 'banner'
                        ? t('profile.uploading')
                        : draft.bannerUri
                          ? t('profile.changeBanner')
                          : t('profile.addBanner')}
                    </Text>
                  </Pressable>
                  {draft.bannerUri && (
                    <Pressable
                      accessibilityRole="button"
                      disabled={uploadingKind !== undefined}
                      onPress={() => void handleRemoveProfileImage('banner')}
                      style={({ pressed }) => [styles.mediaRemoveButton, pressed && styles.pressed]}>
                      <Text style={styles.mediaRemoveText}>{t('profile.removeBanner')}</Text>
                    </Pressable>
                  )}
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
                        <Text style={[styles.goalText, isSelected && styles.goalTextSelected]}>
                          {t(option.labelKey)}
                        </Text>
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
                <Text style={styles.saveButtonText}>{isSaving ? t('common.saving') : t('profile.save')}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors, isDark: boolean) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    flex: { flex: 1 },
    // Arkadaşlar satırı en altta olduğu için alt sekme çubuğunun ve alt güvenli
    // alanın üzerinde rahat bir boşluk bırakılır.
    content: { paddingBottom: 56, paddingTop: 0 },
    editorSection: {
      backgroundColor: isDark ? '#111113' : colors.surfaceMuted,
      borderRadius: 28,
      marginHorizontal: 6,
      marginTop: 18,
      overflow: 'hidden',
      paddingBottom: 28,
      paddingTop: 28,
    },
    introText: {
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 21,
      marginBottom: 28,
      paddingHorizontal: 24,
    },
    bannerSection: { marginBottom: 12 },
    banner: {
      aspectRatio: 2.25,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
      width: '100%',
    },
    bannerImage: { height: '100%', width: '100%' },
    bannerPlaceholder: { backgroundColor: colors.surfaceMuted, flex: 1 },
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
    mediaEditorRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 22,
      marginBottom: 28,
      paddingHorizontal: 24,
    },
    avatarEditorPreview: {
      alignItems: 'center',
      backgroundColor: isDark ? '#222225' : '#E5E5EA',
      borderRadius: 38,
      height: 76,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 76,
    },
    bannerEditorPreview: {
      backgroundColor: isDark ? '#222225' : '#E5E5EA',
      borderRadius: 12,
      height: 68,
      overflow: 'hidden',
      width: 116,
    },
    mediaPreviewImage: { height: '100%', width: '100%' },
    mediaPreviewPlaceholder: { backgroundColor: isDark ? '#222225' : '#E5E5EA', flex: 1 },
    mediaPreviewLetter: { color: isDark ? '#D5A0AA' : colors.primarySoftText, fontSize: 25, fontWeight: '600' },
    mediaPreviewOverlay: {
      alignItems: 'center',
      backgroundColor: '#00000099',
      bottom: 0,
      justifyContent: 'center',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    mediaEditorCopy: { alignItems: 'flex-start', flex: 1 },
    mediaChangeButton: { justifyContent: 'center', minHeight: 36 },
    mediaChangeText: { color: colors.text, fontSize: 17, fontWeight: '700' },
    mediaRemoveButton: { justifyContent: 'center', minHeight: 30 },
    mediaRemoveText: { color: colors.textSecondary, fontSize: 15, textDecorationLine: 'underline' },
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
    profileSummary: { alignItems: 'center', gap: 8, paddingHorizontal: Layout.screenPadding, paddingBottom: 18 },
    summaryUsername: {
      color: isDark ? '#D5A0AA' : '#A77882',
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 2.1,
      marginTop: -18,
      textTransform: 'uppercase',
    },
    summaryName: {
      color: isDark ? colors.text : '#42283A',
      fontFamily: Fonts.serif,
      fontSize: 38,
      fontWeight: '700',
      lineHeight: 44,
    },
    summaryBio: {
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 21,
      maxWidth: '88%',
      textAlign: 'center',
    },
    levelIdentityRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 4,
      width: '100%',
    },
    levelPill: {
      alignItems: 'center',
      backgroundColor: isDark ? '#291C20' : '#F5E8E3',
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 5,
      minHeight: 28,
      paddingHorizontal: 11,
    },
    levelPillIcon: { color: '#D5755B', fontSize: 11 },
    levelPillText: { color: isDark ? '#E1B8B5' : '#9B625F', fontSize: 11, fontWeight: '600' },
    editProfileButton: {
      alignItems: 'center',
      borderColor: isDark ? '#4B383D' : '#E8CFC7',
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      minHeight: 38,
      paddingHorizontal: 16,
    },
    editProfileLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
    headerActions: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      marginTop: 12,
    },
    settingsButton: {
      alignItems: 'center',
      borderColor: isDark ? '#4B383D' : '#E8CFC7',
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      height: Layout.minTouchSize,
      justifyContent: 'center',
      width: Layout.minTouchSize,
    },
    field: { gap: 6, marginBottom: 26, paddingHorizontal: 24 },
    labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    label: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    counter: { color: colors.textTertiary, fontSize: 12 },
    input: {
      backgroundColor: 'transparent',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRadius: 0,
      color: colors.text,
      fontSize: 17,
      minHeight: 48,
      paddingHorizontal: 0,
      paddingVertical: 10,
    },
    usernameRow: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      minHeight: 48,
      paddingHorizontal: 0,
    },
    atSign: { color: colors.text, fontSize: 17 },
    usernameInput: { color: colors.text, flex: 1, fontSize: 17, paddingHorizontal: 2, paddingVertical: 10 },
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
      paddingHorizontal: 18,
    },
    goalOptionSelected: {
      backgroundColor: isDark ? '#F2F2F2' : '#1C1C1E',
      borderColor: isDark ? '#F2F2F2' : '#1C1C1E',
    },
    goalGlyph: { fontSize: 13 },
    goalText: { color: colors.textSecondary, fontSize: 15, fontWeight: '400' },
    goalTextSelected: { color: isDark ? '#161618' : '#FFFFFF', fontWeight: '600' },
    saveButton: {
      alignItems: 'center',
      backgroundColor: isDark ? '#F2F2F2' : '#1C1C1E',
      borderRadius: 20,
      justifyContent: 'center',
      marginHorizontal: 24,
      marginTop: 10,
      minHeight: 58,
    },
    saveButtonText: { color: isDark ? '#161618' : '#FFFFFF', fontSize: 17, fontWeight: '700' },
    friendsRow: {
      alignItems: 'center',
      alignSelf: 'center',
      backgroundColor: 'transparent',
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 10,
      marginTop: 24,
      minHeight: 54,
      paddingHorizontal: 12,
      paddingVertical: 9,
      width: 224,
    },
    friendsIcon: {
      alignItems: 'center',
      height: 34,
      justifyContent: 'center',
      width: 34,
    },
    levelSection: { marginTop: 16, width: '100%' },
    friendsText: { flex: 1, gap: 1 },
    friendsTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
    friendsCaption: { color: colors.textSecondary, fontSize: 10, lineHeight: 13 },
    // Takvim ekranın diğer bölümleriyle aynı yatay payı kullanır; içerik
    // genişliği kompakt ölçüleri belirler.
    calendarSection: { marginTop: 8, paddingHorizontal: Layout.screenPadding },
    pressed: { opacity: 0.6 },
  });
}
