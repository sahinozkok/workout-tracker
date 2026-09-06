import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { useAchievements } from '@/context/achievement-context';
import { useAuth } from '@/context/auth-context';
import { useLanguage } from '@/context/language-context';
import { useProfile } from '@/context/profile-context';
import {
  getStoragePathFromUrl,
  ProfileImageKind,
  ProfileMediaError,
  removeProfileImagePaths,
} from '@/services/profile-media';
import { UserProfile } from '@/types/profile';

export type ProfileSaveOutcome = 'saved' | 'error' | 'invalid';

/**
 * PROFİL DÜZENLEME — TEK KAYNAK.
 *
 * Görünen ad, kullanıcı adı, biyografi, hedef, avatar ve kapak düzenlemesinin
 * bütün durum/doğrulama/medya/kaydetme mantığı buradadır. Hem eski açılır
 * editör yerine gelen `/profile-edit` ekranı hem de gelecekteki tüketiciler AYNI
 * uygulamayı kullanır (kopyala-yapıştır ikinci bir uygulama yoktur).
 *
 * GÜVENCELER (korunur):
 *   * Profil sunucudan OKUNMADAN (`canSaveProfile=false`) galeri açılmaz, yazma
 *     yapılmaz → boş taslak gerçek kaydın üzerine yazılamaz.
 *   * Yüklenip henüz kaydedilmemiş (staged) dosyalar ekrandan çıkışta temizlenir;
 *     kalıcı avatar/kapak asla staged listesine girmez.
 *   * Kullanıcı/hesap değişiminde eski async cevabın yeni kullanıcıya yazmaması:
 *     kalıcılaştırma sahipliği `ProfileProvider` (`canWriteProfile`) içinde; staged
 *     temizliği en güncel `userIdRef` ile yapılır.
 */
export function useProfileEditor() {
  const { user } = useAuth();
  const {
    profile,
    profileLoadStatus,
    saveProfile,
    saveProfileMedia,
    uploadProfileMedia,
  } = useProfile();
  const { t } = useLanguage();
  const { requestSync: requestAchievementSync } = useAchievements();

  const canSaveProfile = profileLoadStatus === 'ready';

  const [draft, setDraft] = useState<UserProfile>(profile);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<ProfileImageKind>();

  // Yüklenmiş ama henüz "Profili kaydet" ile kalıcılaşmamış dosyalar.
  const stagedPathsRef = useRef<Partial<Record<ProfileImageKind, string>>>({});
  const userIdRef = useRef<string | undefined>(user?.id);
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  /**
   * İLK `ready` SEED'İ — yalnız BİR KEZ.
   *
   * `/profile-edit` profil yüklenmeden veya deep-link ile açılırsa `useState`
   * başlangıcı `DEFAULT_PROFILE` olabilir. İlk başarılı `profileLoadStatus ===
   * 'ready'` geçişinde taslağın TAMAMI (ad, kullanıcı adı, bio, hedef, avatar,
   * banner) gerçek profille seed edilir. Sonrasında yalnız avatar/banner eşitlenir
   * (kullanıcının yazdığı metin EZİLMEZ). Owner guard: hesap değişince seed
   * sıfırlanır ve eski kullanıcının taslağı yeni kullanıcıya TAŞINMAZ (keyed
   * provider remount'una ek savunma).
   */
  const hasSeededReadyProfileRef = useRef(false);
  const seededUserIdRef = useRef<string | undefined>(user?.id);

  // Ekrandan çıkışta yalnızca staged dosyalar silinir (en güncel sahip kimliğiyle).
  useEffect(
    () => () => {
      const ownerId = userIdRef.current;
      const pendingPaths = Object.values(stagedPathsRef.current).filter(Boolean) as string[];
      stagedPathsRef.current = {};
      if (ownerId && pendingPaths.length > 0) {
        void removeProfileImagePaths(pendingPaths, ownerId);
      }
    },
    [],
  );

  // İlk `ready` seed'i (ve hesap değişiminde sıfırlama). Effect içinde çalışır;
  // render sırasında state YAZILMAZ. `profile` bağımlılıktadır ama tam seed
  // yalnız `hasSeededReadyProfileRef` false iken bir kez yapılır.
  useEffect(() => {
    // Hesap değişimi: eski taslak yeni kullanıcıya taşınmaz.
    if (seededUserIdRef.current !== user?.id) {
      seededUserIdRef.current = user?.id;
      hasSeededReadyProfileRef.current = false;
      setDraft(profile);
    }
    // İlk başarılı ready'de TAM seed (retry sonrası ilk ready dahil).
    if (profileLoadStatus === 'ready' && !hasSeededReadyProfileRef.current) {
      hasSeededReadyProfileRef.current = true;
      setDraft(profile);
    }
  }, [profile, profileLoadStatus, user?.id]);

  // Kapak/avatar anında kalıcılaştığından profil nesnesi kullanıcı formu
  // doldururken de değişebilir. SEED SONRASI yalnız görsel alanlar eşitlenir;
  // henüz kaydedilmemiş ad/kullanıcı adı/bio/hedef metinleri EZİLMEZ. Seed'den
  // önce hiç yazmaz — tam seed bu işi üstlenir.
  useEffect(() => {
    if (!hasSeededReadyProfileRef.current) return;
    setDraft((current) => ({ ...current, avatarUri: profile.avatarUri, bannerUri: profile.bannerUri }));
  }, [profile.avatarUri, profile.bannerUri]);

  const updateDraft = useCallback(<Key extends keyof UserProfile>(key: Key, value: UserProfile[Key]) => {
    setDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
  }, []);

  const pickImage = useCallback(
    async (kind: ProfileImageKind) => {
      if (uploadingKind) return;

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
        // GIF hareketi korunur: kırpma/yeniden kodlama yok.
        allowsEditing: false,
        mediaTypes: ['images'],
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
        quality: 1,
      });

      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];

      setUploadingKind(kind);
      try {
        const publicUrl = await uploadProfileMedia(kind, {
          fileName: asset.fileName,
          fileSize: asset.fileSize,
          mimeType: asset.mimeType,
          uri: asset.uri,
        });

        const previousStagedPath = stagedPathsRef.current[kind];
        if (previousStagedPath && user?.id) {
          await removeProfileImagePaths([previousStagedPath], user.id);
        }

        const stagedPath = user?.id ? getStoragePathFromUrl(publicUrl, user.id) : undefined;
        stagedPathsRef.current = { ...stagedPathsRef.current, [kind]: stagedPath };

        try {
          await saveProfileMedia(kind, publicUrl);
        } finally {
          stagedPathsRef.current = { ...stagedPathsRef.current, [kind]: undefined };
        }

        updateDraft(kind === 'avatar' ? 'avatarUri' : 'bannerUri', publicUrl);
      } catch (error) {
        if (error instanceof Error && error.message === 'bannerColumnMissing') {
          Alert.alert(t('profile.bannerNotSupported'), t('profile.bannerNotSupportedBody'));
        } else if (error instanceof Error && error.message === 'profileNotLoaded') {
          Alert.alert(t('profile.notLoadedTitle'), t('profile.notLoadedBody'));
        } else {
          const code = error instanceof ProfileMediaError ? error.code : 'uploadFailed';
          Alert.alert(t('profile.uploadFailedTitle'), t(`profile.mediaErrors.${code}`));
        }
      } finally {
        setUploadingKind(undefined);
      }
    },
    [canSaveProfile, t, updateDraft, uploadProfileMedia, saveProfileMedia, uploadingKind, user?.id],
  );

  const removeImage = useCallback(
    async (kind: ProfileImageKind) => {
      const stagedPath = stagedPathsRef.current[kind];
      if (stagedPath) stagedPathsRef.current = { ...stagedPathsRef.current, [kind]: undefined };
      updateDraft(kind === 'avatar' ? 'avatarUri' : 'bannerUri', undefined);

      const ownerId = user?.id;
      if (stagedPath && ownerId) {
        await removeProfileImagePaths([stagedPath], ownerId);
      }
    },
    [updateDraft, user?.id],
  );

  /**
   * Kaydeder. Doğrulama başarısızsa `invalid` (Alert gösterilmiştir), sunucu
   * hatasında `error` (Alert gösterilmiştir), başarıda `saved` döner. Çağıran
   * `saved`'de güvenli geri navigasyonu yapar.
   */
  const save = useCallback(async (): Promise<ProfileSaveOutcome> => {
    const displayName = draft.displayName.trim();
    const username = draft.username.trim().replace(/^@/, '').toLocaleLowerCase('tr-TR');

    if (!displayName) {
      Alert.alert(t('profile.nameRequiredTitle'), t('profile.nameRequiredBody'));
      return 'invalid';
    }
    if (username && !/^[a-z0-9_]{3,24}$/.test(username)) {
      Alert.alert(t('profile.usernameInvalidTitle'), t('profile.usernameInvalidBody'));
      return 'invalid';
    }

    const nextProfile: UserProfile = { ...draft, displayName, username, bio: draft.bio.trim() };

    setIsSaving(true);
    try {
      await saveProfile(nextProfile);
      // Profil kaydı başarılı → ölçülü (coalescing'li, fire-and-forget) başarım senkronu.
      requestAchievementSync();
      stagedPathsRef.current = {};
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return 'saved';
    } catch (error) {
      stagedPathsRef.current = {};
      if (error instanceof Error && error.message === 'bannerColumnMissing') {
        Alert.alert(t('profile.bannerNotSupported'), t('profile.bannerNotSupportedBody'));
        return 'error';
      }
      if (error instanceof Error && error.message === 'profileNotLoaded') {
        Alert.alert(t('profile.notLoadedTitle'), t('profile.notLoadedBody'));
        return 'error';
      }
      Alert.alert(t('profile.saveFailed'), error instanceof Error ? error.message : t('common.networkError'));
      return 'error';
    } finally {
      setIsSaving(false);
    }
  }, [draft, requestAchievementSync, saveProfile, t]);

  const avatarLetter = draft.displayName.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'S';

  return {
    avatarLetter,
    canSaveProfile,
    draft,
    isSaving,
    pickImage,
    removeImage,
    save,
    updateDraft,
    uploadingKind,
  };
}
