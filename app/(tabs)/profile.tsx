import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { getOnAccentColor } from '@/constants/color-presets';
import { ProfileAchievementShowcase } from '@/components/ranks/profile-achievement-showcase';
import { ProfileProgressSummary } from '@/components/rewards/profile-progress-summary';
import { ProfileProofStats } from '@/components/rewards/profile-proof-stats';
import { RewardInfoSheet, RewardInfoKind } from '@/components/rewards/reward-info-sheet';
import { ProfileDisciplineCard } from '@/components/profile-discipline-card';
import { ProfileSharedProgram } from '@/components/profile-shared-program';
import { MotionCollapsible, MotionSection } from '@/components/motion-section';
import { MotionDuration } from '@/constants/motion';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useLanguage } from '@/context/language-context';
import { useProfile } from '@/context/profile-context';
import { useRanks } from '@/context/rank-context';
import { useRewards } from '@/context/reward-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import {
  getStoragePathFromUrl,
  ProfileImageKind,
  ProfileMediaError,
  removeProfileImagePaths,
} from '@/services/profile-media';
import { TrainingGoal, UserProfile } from '@/types/profile';
import { calculateDisciplineStreak } from '@/utils/discipline';
import { buildSharedProgramFromWorkoutProgram } from '@/utils/shared-program';

const GOAL_OPTIONS: { glyph: string; labelKey: string; value: TrainingGoal }[] = [
  { glyph: '📅', labelKey: 'profile.goalConsistency', value: 'consistency' },
  { glyph: '⚡', labelKey: 'profile.goalStrength', value: 'strength' },
  { glyph: '🏋️', labelKey: 'profile.goalMuscle', value: 'muscle' },
  { glyph: '♡', labelKey: 'profile.goalFitness', value: 'fitness' },
];

/** Profil ekranının bugünkü vurgu tonu (seviye rozeti / ilerleme halkası). */
const PROFILE_ACCENT_DEFAULT = '#D5755B';
const PROFILE_CONTENT_BOTTOM_PADDING = 56;

export default function ProfileScreen() {
  const { user } = useAuth();
  const {
    profile,
    profileLoadStatus,
    reloadProfile,
    saveProfile,
    saveProfileMedia,
    shareActiveProgram,
    uploadProfileMedia,
  } = useProfile();
  /**
   * Yazma izni tek kaynaktan: profil GERÇEKTEN yüklendiyse. İlk yükleme,
   * yeniden deneme ve hata durumlarının hepsinde kapalı kalır.
   */
  const canSaveProfile = profileLoadStatus === 'ready';
  const { colors, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { activeProgramId, disciplineStatuses, programs, workoutSessions } = useWorkout();
  const { t } = useLanguage();
  const { progress: levelProgress } = useRewards();
  /**
   * Sezonluk rank. Level ve gül bakiyesinden TAMAMEN ayrıdır; sunucu değeri
   * gelmeden rozet hiç çizilmez (istemci rank uydurmaz).
   */
  /**
   * Vitrin MEVCUT context verisini kullanır: başarılar için İKİNCİ bir
   * Supabase sorgusu açılmaz. `loadAchievements`, kutlama baseline'ı, kuyruk
   * ve overlay koordinasyonu olduğu gibi kalır.
   */
  const {
    hasAchievementsError,
    hasShowcaseSelectionError,
    isAchievementsLoading,
    isShowcaseSelectionReady,
    profileShowcaseEntries,
    season: rankSeason,
  } = useRanks();
  /**
   * Profil vurgusu. Sunucudan gelen tercih her zaman doludur; yine de
   * savunmacı olarak bugünkü tona düşülür.
   */
  const profileAccent = useFeatureColor('profile', PROFILE_ACCENT_DEFAULT);
  const styles = createStyles(colors, isDark, {
    accent: profileAccent.color,
    // Renkli düğme yazısı parlaklıktan hesaplanır; sabit beyaz/siyah yok.
    onAccent: getOnAccentColor(profileAccent.color),
  });
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [rewardInfoKind, setRewardInfoKind] = useState<RewardInfoKind>();
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<ProfileImageKind>();
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const editorHeightRef = useRef(0);
  const scrollContentHeightRef = useRef(0);
  const scrollViewportHeightRef = useRef(0);
  const closeEditorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Yüklenmiş ama henüz "Profili kaydet" ile kalıcılaşmamış dosyalar.
  // Ref kullanılır; unmount temizliği her zaman en güncel değeri görür.
  const stagedPathsRef = useRef<Partial<Record<ProfileImageKind, string>>>({});
  const userIdRef = useRef<string | undefined>(user?.id);
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  useEffect(
    () => () => {
      if (closeEditorTimerRef.current) clearTimeout(closeEditorTimerRef.current);
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

  const handleProfileScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollYRef.current = event.nativeEvent.contentOffset.y;
    },
    [],
  );

  const handleEditorLayout = useCallback((event: LayoutChangeEvent) => {
    editorHeightRef.current = event.nativeEvent.layout.height;
  }, []);

  const handleScrollContentSizeChange = useCallback((_width: number, height: number) => {
    scrollContentHeightRef.current = height;
  }, []);

  const handleScrollLayout = useCallback((event: LayoutChangeEvent) => {
    scrollViewportHeightRef.current = event.nativeEvent.layout.height;
  }, []);

  const closeProfileEditor = useCallback(
    (afterClose?: () => void) => {
      if (closeEditorTimerRef.current) clearTimeout(closeEditorTimerRef.current);

      // Form artık kimlik alanının hemen altında; altında ilerleme, program,
      // disiplin ve arkadaşlar bölümleri de bulunur. Bu yüzden eski
      // "Edit/Ayarlar satırı + alt padding" hesabı geçerli değildir. Açık
      // içeriğin gerçek yüksekliğinden yalnız form yüksekliği çıkarılır; önce
      // yeni maksimum noktaya kaydırılıp sonra form kaldırılır. Böylece iOS'un
      // içerik kısalınca yaptığı ani ScrollView clamp'i görünmez.
      const collapsedContentHeight = Math.max(
        0,
        scrollContentHeightRef.current - editorHeightRef.current,
      );
      const targetY = Math.max(0, collapsedContentHeight - scrollViewportHeightRef.current);
      const hasMeasuredLayout =
        scrollViewportHeightRef.current > 0 &&
        scrollContentHeightRef.current > 0 &&
        editorHeightRef.current > 0;
      const shouldScrollFirst =
        !reduceMotion && hasMeasuredLayout && scrollYRef.current > targetY + 8;

      if (!shouldScrollFirst) {
        setIsProfileEditorOpen(false);
        afterClose?.();
        return;
      }

      scrollRef.current?.scrollTo({ animated: true, y: targetY });
      closeEditorTimerRef.current = setTimeout(() => {
        closeEditorTimerRef.current = undefined;
        setIsProfileEditorOpen(false);
        afterClose?.();
      }, MotionDuration.slow);
    },
    [reduceMotion],
  );

  const handleProfileEditorToggle = useCallback(() => {
    if (isProfileEditorOpen) closeProfileEditor();
    else setIsProfileEditorOpen(true);
  }, [closeProfileEditor, isProfileEditorOpen]);

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

    /**
     * Profil sunucudan okunmadan galeri HİÇ açılmaz: izin istenmez, dosya
     * seçilmez, Storage'a yükleme başlamaz. Kesin engel context'tedir; bu
     * kontrol kullanıcıya neden olmadığını da anlatır.
     */
    if (!canSaveProfile) {
      Alert.alert(t('profile.notLoadedTitle'), t('profile.notLoadedBody'));
      return;
    }

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
      } else if (error instanceof Error && error.message === 'profileNotLoaded') {
        // Yükleme sırasında profil durumu değiştiyse: context yeni dosyayı
        // zaten temizledi, kullanıcıya ne yapması gerektiği söylenir.
        Alert.alert(t('profile.notLoadedTitle'), t('profile.notLoadedBody'));
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
      closeProfileEditor(() => Alert.alert(t('profile.saved'), t('profile.savedBody')));
    } catch (error) {
      // Başarısız kayıtta context yeni dosyaları sildi; işaretler tekrar
      // silmeye çalışılmaması için temizlenir.
      stagedPathsRef.current = {};
      if (error instanceof Error && error.message === 'bannerColumnMissing') {
        Alert.alert(t('profile.bannerNotSupported'), t('profile.bannerNotSupportedBody'));
        return;
      }
      // Profil okunamadıysa yazma zaten engellendi; teknik kod yerine ne
      // yapılması gerektiğini söyleyen bir mesaj gösterilir.
      if (error instanceof Error && error.message === 'profileNotLoaded') {
        Alert.alert(t('profile.notLoadedTitle'), t('profile.notLoadedBody'));
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

  /**
   * Kendi profilde de arkadaşların GÖRECEĞİ program sunumu gösterilir. Yeni bir
   * Supabase sorgusu AÇILMAZ: DTO yalnızca opt-in açıkken ve aktif program varken
   * mevcut `useWorkout` verisinden türetilir. Kapalıysa veya aktif program yoksa
   * `undefined` kalır ve bileşen hiç render edilmez.
   */
  const activeProgram = shareActiveProgram
    ? programs.find((program) => program.id === activeProgramId)
    : undefined;
  const ownSharedProgram = activeProgram
    ? buildSharedProgramFromWorkoutProgram(activeProgram)
    : undefined;

  return (
    /*
      Banner ekranın EN ÜSTÜNDEN başlasın diye üst safe-area kenarı bilinçli
      olarak uygulanmaz. Banner'ın kendi yüksekliği, `contentFit`, GIF ve
      yükleme mantığı değişmez; yalnızca çentiğin arkasına uzanır.

      Bu yalnızca BU ekranı etkiler: global SafeArea veya navigation ayarı
      değiştirilmez, alt tab bar ve diğer ekranlar aynı kalır. Banner'dan
      sonraki bütün içerik zaten onun altında olduğu için fazladan üst boşluk
      oluşmaz; yalnızca banner'dan ÖNCE çizilebilen hata satırı `insets.top`
      kadar aşağı alınır ki status bar'ın arkasında kalmasın.
    */
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onLayout={handleScrollLayout}
          onScroll={handleProfileScroll}
          onContentSizeChange={handleScrollContentSizeChange}
          ref={scrollRef}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>
          {/* Yalnızca sunucudan okuma başarısızken görünür. Ekranın mevcut
              yerleşimi değişmez; başarılı yüklemede hiç render edilmez. */}
          {profileLoadStatus === 'error' && (
            <View style={[styles.loadErrorRow, { marginTop: insets.top }]}>
              <View style={styles.loadErrorText}>
                <Text style={styles.loadErrorTitle}>{t('profile.loadFailed')}</Text>
                <Text style={styles.loadErrorBody}>{t('profile.loadFailedBody')}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={reloadProfile}
                style={({ pressed }) => [styles.loadErrorButton, pressed && styles.pressed]}>
                <Text style={styles.loadErrorButtonText}>{t('profile.loadRetry')}</Text>
              </Pressable>
            </View>
          )}

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

          {/* KİMLİK — ekranın kişisel başlığı. Görünen ad ANA başlık; kullanıcı
              adı ve bio ikincil, rahat okunur. Düzenle/Ayarlar kimliğe yakın,
              kompakt ve dengeli durur ve düzenleyici hemen altında açılır. */}
          <MotionSection style={styles.profileSummary}>
            <Text numberOfLines={1} style={styles.summaryUsername}>
              @{draft.username || t('profile.usernamePlaceholder')}
            </Text>
            <Text numberOfLines={2} style={styles.summaryName}>
              {draft.displayName || t('profile.displayNamePlaceholder')}
            </Text>
            {draft.bio.trim() ? (
              <Text style={styles.summaryBio}>{draft.bio.trim()}</Text>
            ) : null}

            {/* Düzenle mevcut açılır düzenleyiciyi açar; Ayarlar `/settings`e gider. */}
            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: isProfileEditorOpen }}
                onPress={handleProfileEditorToggle}
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
          </MotionSection>

          {isProfileEditorOpen && (
            <View onLayout={handleEditorLayout}>
              <MotionCollapsible style={styles.editorSection}>
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
                    disabled={uploadingKind !== undefined || !canSaveProfile}
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
                      disabled={uploadingKind !== undefined || !canSaveProfile}
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
                    disabled={uploadingKind !== undefined || !canSaveProfile}
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
                      disabled={uploadingKind !== undefined || !canSaveProfile}
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

              <MotionPressable
                accessibilityRole="button"
                // Profil okunamadıysa kaydetme kapalıdır: ekrandaki boş taslak
                // gerçek kaydın üzerine yazılamaz. Kesin engel context'tedir.
                disabled={isSaving || !canSaveProfile}
                onPress={handleSave}
                style={[
                  styles.saveButton,
                  // Devre dışı sönükleştirme korunur; basılı geri bildirimi
                  // artık `MotionPressable` üretir.
                  (isSaving || !canSaveProfile) && styles.pressed,
                ]}>
                <Text style={styles.saveButtonText}>{isSaving ? t('common.saving') : t('profile.save')}</Text>
              </MotionPressable>
              </MotionCollapsible>
            </View>
          )}

          <View style={styles.sectionDivider} />

          {/* İLERLEME — referanstaki düz akış: Level/Rank kimliği yan yana,
              altında yatay XP ritmi. İki sistem yine ayrıdır ve bütün değerler
              mevcut contextlerden gelir; istemci sahte rank üretmez. */}
          <MotionSection delay={40} style={styles.progressSection}>
            <ProfileProgressSummary
              accentColor={profileAccent.color}
              level={levelProgress.level}
              onLevelPress={() => setRewardInfoKind('level')}
              onRankPress={() => router.push('/rank')}
              rank={rankSeason ? { id: rankSeason.currentRank, rp: rankSeason.currentRp } : undefined}
              xpForNextLevel={levelProgress.xpForNextLevel}
              xpIntoLevel={levelProgress.xpIntoLevel}
            />

            <View style={styles.innerDivider} />
            <ProfileProofStats
              accentColor={profileAccent.color}
              dayStreak={disciplineStreak}
              onDayStreakPress={() => router.push('/streaks')}
              onRosesPress={() => setRewardInfoKind('roses')}
              roseBalance={levelProgress.roseBalance}
              workoutDays={completedWorkoutDayCount}
            />
          </MotionSection>

          <View style={styles.sectionDivider} />

          {/* Sezon rozetleri: rank rozeti YENİDEN ÇİZİLMEZ, yalnızca kozmetik
              başarı rozetleri gösterilir. Veri mount olan `RankContext`ten gelir;
              yeni sorgu açılmaz. Hata durumunda vitrin sessizce gizlenir ve profil
              çalışmaya devam eder. */}
          <MotionSection delay={80} style={styles.showcaseSection}>
            <ProfileAchievementShowcase
              accentColor={profileAccent.color}
              entries={profileShowcaseEntries}
              hasError={hasAchievementsError || hasShowcaseSelectionError}
              /* Seçim hazır olmadan otomatik vitrinmiş gibi YANLIŞ rozet
                 gösterilmez: hazır olana kadar yükleniyor durumunda kalır. */
              isLoading={isAchievementsLoading || !isShowcaseSelectionReady}
              onPress={() => router.push('/rank-showcase')}
              preserveOrder
            />
          </MotionSection>

          {/* Paylaşılan aktif program: yalnızca opt-in açık VE aktif program
              varken görünür; aksi hâlde bileşen hiç render edilmez ve akış aynen
              korunur. Arkadaşların göreceği sunumun BİREBİR aynısıdır (aynı ortak
              bileşen; veri/işlev sözleşmesi değişmez). */}
          {ownSharedProgram && (
            <>
              <View style={styles.sectionDivider} />
              <MotionSection delay={40} style={styles.sharedProgramSection}>
                <ProfileSharedProgram accentColor={profileAccent.color} compact program={ownSharedProgram} />
              </MotionSection>
            </>
          )}

          <View style={styles.sectionDivider} />
          {/* Disiplin: Profil ekranına ÖZEL bileşen; Ana Sayfa takvimiyle hiçbir
              stil veya ölçü paylaşmaz, yalnızca gerçek veri ve tarih hesaplarını
              paylaşır. Profil akışının bir bölümü gibi durur, dev bağımsız kart
              değildir. Açılır/kapanır davranışı korunur. */}
          <MotionSection delay={40} style={styles.calendarSection}>
            <ProfileDisciplineCard accentColor={profileAccent.color} collapsible compact />
          </MotionSection>

          <View style={styles.sectionDivider} />
          {/* Arkadaşlar: yeni sekme eklenmez; kök Stack'teki /friends ekranına
              gider. Profil akışının sonunda sade bir navigasyon satırıdır. */}
          <MotionSection delay={80} style={styles.friendsSection}>
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
          </MotionSection>
        </ScrollView>
      </KeyboardAvoidingView>
      <RewardInfoSheet
        accentColor={profileAccent.color}
        kind={rewardInfoKind}
        onClose={() => setRewardInfoKind(undefined)}
      />
    </SafeAreaView>
  );
}

function createStyles(
  colors: ThemeColors,
  isDark: boolean,
  profile: { accent: string; onAccent: string },
) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    flex: { flex: 1 },
    // Arkadaşlar satırı en altta olduğu için alt sekme çubuğunun ve alt güvenli
    // alanın üzerinde rahat bir boşluk bırakılır.
    content: { paddingBottom: PROFILE_CONTENT_BOTTOM_PADDING, paddingTop: 0 },
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
    // Profil medyası ön izleme harfi de profil vurgusunu kullanır.
    mediaPreviewLetter: { color: profile.accent, fontSize: 25, fontWeight: '600' },
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
    // Olumlu medya eylemleri (fotoğraf/banner değiştir-ekle) profil vurgusunu
    // kullanır. Hemen altındaki `mediaRemoveText` nötr kalır.
    mediaChangeText: { color: profile.accent, fontSize: 17, fontWeight: '700' },
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
    profileSummary: { alignItems: 'center', gap: 6, paddingHorizontal: Layout.screenPadding, paddingBottom: 18 },
    summaryUsername: {
      color: profile.accent,
      fontSize: 13,
      fontWeight: '500',
      marginTop: -18,
    },
    summaryName: {
      color: isDark ? colors.text : '#42283A',
      fontSize: 30,
      fontWeight: '600',
      lineHeight: 36,
      textAlign: 'center',
    },
    // Bio kimlik alanında, görünen adın hemen altında ikincil hiyerarşide ve
    // rahat okunur. Halka `message` olarak TEKRAR gösterilmez (tek yer).
    summaryBio: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 2,
      paddingHorizontal: 8,
      textAlign: 'center',
    },
    editProfileButton: {
      alignItems: 'center',
      borderColor: isDark ? '#4B383D' : '#E8CFC7',
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
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
      backgroundColor: profile.accent,
      borderColor: profile.accent,
    },
    goalGlyph: { fontSize: 13 },
    goalText: { color: colors.textSecondary, fontSize: 15, fontWeight: '400' },
    goalTextSelected: { color: profile.onAccent, fontWeight: '600' },
    /**
     * Yükleme hatası satırı. Ekranın mevcut tipografisini ve tema renklerini
     * kullanır; yeni bir tasarım dili getirmez ve hata yokken hiç çizilmez.
     */
    loadErrorRow: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusMedium,
      flexDirection: 'row',
      gap: 12,
      marginBottom: 12,
      marginHorizontal: Layout.screenPadding,
      padding: 14,
    },
    loadErrorText: { flex: 1, gap: 2 },
    loadErrorTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    loadErrorBody: { color: colors.textSecondary, ...Type.caption, lineHeight: 18 },
    loadErrorButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 4,
    },
    loadErrorButtonText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
    saveButton: {
      alignItems: 'center',
      backgroundColor: profile.accent,
      borderRadius: 20,
      justifyContent: 'center',
      marginHorizontal: 24,
      marginTop: 10,
      minHeight: 58,
    },
    saveButtonText: { color: profile.onAccent, fontSize: 17, fontWeight: '700' },
    friendsRow: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      flexDirection: 'row',
      gap: 12,
      minHeight: 68,
      paddingVertical: 12,
      width: '100%',
    },
    friendsIcon: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: 24,
      borderWidth: StyleSheet.hairlineWidth,
      height: 48,
      justifyContent: 'center',
      width: 48,
    },
    friendsText: { flex: 1, gap: 1 },
    friendsTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
    friendsCaption: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    /**
     * Bölümler büyük yuvarlak kartlar yerine boşluk + ince ayırıcı ile ayrılır.
     * Ayırıcı tema `separator` rengini ve `StyleSheet.hairlineWidth`i kullanır;
     * yeni renk/gölge getirmez. Ekran yatay payıyla hizalıdır.
     */
    sectionDivider: {
      backgroundColor: colors.separator,
      height: StyleSheet.hairlineWidth,
      marginHorizontal: Layout.screenPadding,
      marginVertical: 20,
    },
    // İlerleme bölümü: level + rank + halka + kanıt şeridi tek, ortalı akışta.
    progressSection: { alignItems: 'center', paddingHorizontal: Layout.screenPadding },
    innerDivider: {
      backgroundColor: colors.separator,
      height: StyleSheet.hairlineWidth,
      marginBottom: 28,
      width: '100%',
    },
    showcaseSection: { paddingHorizontal: Layout.screenPadding },
    friendsSection: { paddingHorizontal: Layout.screenPadding },
    // Takvim ve paylaşılan program ekranın diğer bölümleriyle aynı yatay payı
    // kullanır; içerik genişliği kompakt ölçüleri belirler.
    calendarSection: { paddingHorizontal: Layout.screenPadding },
    sharedProgramSection: { paddingHorizontal: Layout.screenPadding },
    pressed: { opacity: 0.6 },
  });
}
