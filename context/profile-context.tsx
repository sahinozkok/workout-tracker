import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import {
  getStoragePathFromUrl,
  isRemoteImageUrl,
  PickedImage,
  ProfileImageKind,
  removeProfileImagePaths,
  uploadProfileImage,
} from '@/services/profile-media';
import { AppLanguage, TrainingGoal, UserProfile } from '@/types/profile';

type ProfileContextValue = {
  isLoading: boolean;
  preferredLanguage?: AppLanguage;
  profile: UserProfile;
  restTimerEnabled: boolean;
  saveProfile: (profile: UserProfile) => Promise<void>;
  /** Yalnızca avatar/kapak adresini kalıcılaştırır; diğer profil alanlarına dokunmaz. */
  saveProfileMedia: (kind: ProfileImageKind, url: string | undefined) => Promise<void>;
  savePreferredLanguage: (language: AppLanguage) => Promise<void>;
  setRestTimerEnabled: (enabled: boolean) => Promise<void>;
  uploadProfileMedia: (kind: ProfileImageKind, asset: PickedImage) => Promise<string>;
};

type ProfileRow = {
  avatar_url: string | null;
  banner_url?: string | null;
  bio: string;
  display_name: string;
  preferred_language?: string | null;
  rest_timer_enabled: boolean;
  training_goal: TrainingGoal;
  username: string | null;
};

const DEFAULT_PROFILE: UserProfile = {
  avatarUri: undefined,
  bannerUri: undefined,
  displayName: 'Sporcu',
  username: '',
  bio: '',
  trainingGoal: 'consistency',
};

const LOCAL_AVATAR_KEY_PREFIX = '@workout-tracker/local-avatar';
const LEGACY_COLUMNS = 'display_name, username, bio, avatar_url, training_goal, rest_timer_enabled';
const EXTENDED_COLUMNS = `${LEGACY_COLUMNS}, banner_url, preferred_language`;
/** Postgres: kolon bulunamadı. PostgREST ise şema önbelleği için PGRST204 döner. */
const UNDEFINED_COLUMN = '42703';
const POSTGREST_MISSING_COLUMN = 'PGRST204';
/** Yalnızca bu iki yeni kolonun eksikliği "migration uygulanmamış" sayılır. */
const OPTIONAL_COLUMNS = ['banner_url', 'preferred_language'];
const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

/**
 * Sadece `banner_url` / `preferred_language` eksikliğini eksik kolon kabul eder.
 * Başka PGRST204 veya veritabanı hataları yutulmaz; çağırana iletilir.
 */
function isMissingOptionalColumnError(error: { code?: string; message?: string } | null) {
  if (!error) return false;

  const message = error.message ?? '';
  const mentionsOptionalColumn = OPTIONAL_COLUMNS.some((column) => message.includes(column));
  if (!mentionsOptionalColumn) return false;

  if (error.code === UNDEFINED_COLUMN) return true;
  if (error.code === POSTGREST_MISSING_COLUMN) return true;

  return /column .* does not exist/i.test(message) || /schema cache/i.test(message);
}

export function ProfileProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [preferredLanguage, setPreferredLanguage] = useState<AppLanguage>();
  const [restTimerEnabled, setRestTimerEnabledState] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const userId = user?.id;
  // Kalıcılaştırma sırasında güncel profili stale closure olmadan okumak için.
  const profileRef = useRef(profile);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    if (!userId) {
      setProfile(DEFAULT_PROFILE);
      setPreferredLanguage(undefined);
      setRestTimerEnabledState(true);
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadProfile() {
      const extendedResult = await supabase
        .from('profiles')
        .select(EXTENDED_COLUMNS)
        .eq('id', userId)
        .single<ProfileRow>();

      // banner_url / preferred_language henüz yoksa eski kolon kümesiyle devam edilir.
      const { data, error } = isMissingOptionalColumnError(extendedResult.error)
        ? await supabase.from('profiles').select(LEGACY_COLUMNS).eq('id', userId).single<ProfileRow>()
        : extendedResult;

      if (error) throw error;
      if (!isMounted || !data) return;

      const localAvatarUri =
        Platform.OS !== 'web' ? await AsyncStorage.getItem(`${LOCAL_AVATAR_KEY_PREFIX}:${userId}`) : null;
      // Yerel kopya yalnızca Storage'da kalıcı bir görsel yoksa kullanılır.
      const legacyLocalAvatar = data.avatar_url ? undefined : localAvatarUri ?? undefined;

      if (!isMounted) return;
      setProfile({
        avatarUri: data.avatar_url ?? legacyLocalAvatar,
        bannerUri: data.banner_url ?? undefined,
        displayName: data.display_name,
        username: data.username ?? '',
        bio: data.bio,
        trainingGoal: data.training_goal,
      });
      setPreferredLanguage(data.preferred_language === 'en' || data.preferred_language === 'tr' ? data.preferred_language : undefined);
      setRestTimerEnabledState(data.rest_timer_enabled);
    }

    loadProfile()
      .catch(() => {
        // Bağlantı kurulamazsa kullanıcı formu güvenli başlangıç değerleriyle açılır.
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [userId]);

  /**
   * Görseli yükler ve kalıcı URL döndürür. Eski dosya burada silinmez; profil
   * kaydı başarıyla güncellenene kadar mevcut çalışan görsel korunur.
   */
  const uploadProfileMedia = useCallback(
    async (kind: ProfileImageKind, asset: PickedImage) => {
      if (!userId) throw new Error('missingSession');
      const { publicUrl } = await uploadProfileImage(userId, kind, asset);
      return publicUrl;
    },
    [userId],
  );

  /**
   * Kapak/avatar kamera düğmesi profil düzenleme alanı kapalıyken de
   * erişilebilir olduğundan, başarılı yüklemeden sonra adres doğrudan
   * kalıcılaştırılır. Yalnızca ilgili kolon yazılır: kullanıcının o sırada
   * düzenlemekte olduğu ad/bio gibi alanlar hiçbir koşulda sunucuya gitmez.
   *
   * Sıra bilinçli: önce veritabanı güncellenir, eski dosya ancak bu güncelleme
   * başarılı olduktan sonra silinir. Böylece hata durumunda eski çalışan kapak
   * hem veritabanında hem Storage'da bozulmadan kalır.
   */
  const saveProfileMedia = useCallback(
    async (kind: ProfileImageKind, url: string | undefined) => {
      if (!userId) throw new Error('missingSession');

      const nextUrl = isRemoteImageUrl(url) ? url : undefined;
      const field = kind === 'avatar' ? 'avatarUri' : 'bannerUri';
      const column = kind === 'avatar' ? 'avatar_url' : 'banner_url';

      // Önceki adres ref'ten okunur: yükleme sırasında profil değişmiş olsa
      // bile eski/yeni URL karışmaz ve yanlış dosya silinmez.
      const previousUrl = profileRef.current[field];
      const previousPath = getStoragePathFromUrl(previousUrl, userId);
      const nextPath = getStoragePathFromUrl(nextUrl, userId);
      // Aynı yol iki kez hedeflenmesin: yeni dosya eskisiyle aynıysa silinmez.
      const orphanPath = nextPath && nextPath !== previousPath ? nextPath : undefined;

      const { error } = await supabase
        .from('profiles')
        .update({ [column]: nextUrl ?? null })
        .eq('id', userId);

      if (error) {
        // Kayıt başarısız: yeni yüklenen dosya sahipsiz kalmasın.
        await removeProfileImagePaths([orphanPath], userId);
        if (kind === 'banner' && isMissingOptionalColumnError(error)) {
          throw new Error('bannerColumnMissing');
        }
        throw error;
      }

      setProfile((current) => ({ ...current, [field]: nextUrl }));

      // Yalnızca veritabanı güncellendikten sonra eski dosya silinir.
      if (previousPath && previousPath !== nextPath) {
        await removeProfileImagePaths([previousPath], userId);
      }
    },
    [userId],
  );

  const saveProfile = useCallback(
    async (newProfile: UserProfile) => {
      if (!userId) throw new Error('missingSession');

      // Yalnızca kalıcı (http) adresler veritabanına yazılır; yerel file:// veya
      // blob: adresleri hiçbir koşulda profile kaydedilmez.
      const avatarUrl = isRemoteImageUrl(newProfile.avatarUri) ? newProfile.avatarUri : undefined;
      const bannerUrl = isRemoteImageUrl(newProfile.bannerUri) ? newProfile.bannerUri : undefined;

      const updates: Record<string, unknown> = {
        avatar_url: avatarUrl ?? null,
        bio: newProfile.bio,
        display_name: newProfile.displayName,
        training_goal: newProfile.trainingGoal,
        username: newProfile.username || null,
      };

      // Kaydetmeden önceki kalıcı adresler; temizlik kararı bunlara göre verilir.
      const previousAvatarPath = getStoragePathFromUrl(profile.avatarUri, userId);
      const previousBannerPath = getStoragePathFromUrl(profile.bannerUri, userId);
      const nextAvatarPath = getStoragePathFromUrl(avatarUrl, userId);
      const nextBannerPath = getStoragePathFromUrl(bannerUrl, userId);

      const extendedResult = await supabase
        .from('profiles')
        .update({ ...updates, banner_url: bannerUrl ?? null })
        .eq('id', userId);

      let bannerPersisted = true;
      let result = extendedResult;

      if (isMissingOptionalColumnError(extendedResult.error)) {
        // Migration uygulanmadıysa banner sunucuya yazılamaz; diğer alanlar kaydedilir.
        bannerPersisted = false;
        result = await supabase.from('profiles').update(updates).eq('id', userId);
      }

      if (result.error) {
        // Veritabanı güncellemesi başarısız: yeni yüklenen sahipsiz dosyalar
        // temizlenir, eski çalışan dosya ve URL olduğu gibi korunur.
        const orphanPaths = [
          nextAvatarPath && nextAvatarPath !== previousAvatarPath ? nextAvatarPath : undefined,
          nextBannerPath && nextBannerPath !== previousBannerPath ? nextBannerPath : undefined,
        ];
        await removeProfileImagePaths(orphanPaths, userId);
        throw result.error;
      }

      // Yalnızca güncelleme başarılı olduktan sonra önceki dosyalar silinir.
      await removeProfileImagePaths(
        [
          previousAvatarPath && previousAvatarPath !== nextAvatarPath ? previousAvatarPath : undefined,
          bannerPersisted && previousBannerPath && previousBannerPath !== nextBannerPath
            ? previousBannerPath
            : undefined,
        ],
        userId,
      );

      await AsyncStorage.removeItem(`${LOCAL_AVATAR_KEY_PREFIX}:${userId}`).catch(() => undefined);
      setProfile({
        ...newProfile,
        avatarUri: avatarUrl,
        // Kolon yoksa banner kaydedilmiş gibi gösterilmez.
        bannerUri: bannerPersisted ? bannerUrl : undefined,
      });

      if (!bannerPersisted && bannerUrl) {
        // Sunucuya yazılamayan banner dosyası sahipsiz kalmasın.
        await removeProfileImagePaths([nextBannerPath], userId);
        throw new Error('bannerColumnMissing');
      }
    },
    [profile.avatarUri, profile.bannerUri, userId],
  );

  const savePreferredLanguage = useCallback(
    async (language: AppLanguage) => {
      setPreferredLanguage(language);
      if (!userId) return;

      const { error } = await supabase.from('profiles').update({ preferred_language: language }).eq('id', userId);
      // Yalnızca kolon eksikliği yutulur; yerel tercih yine de geçerli kalır.
      if (error && !isMissingOptionalColumnError(error)) throw error;
    },
    [userId],
  );

  const setRestTimerEnabled = useCallback(
    async (enabled: boolean) => {
      if (!userId) throw new Error('missingSession');

      const previousValue = restTimerEnabled;
      setRestTimerEnabledState(enabled);

      const { error } = await supabase.from('profiles').update({ rest_timer_enabled: enabled }).eq('id', userId);

      if (error) {
        setRestTimerEnabledState(previousValue);
        throw error;
      }
    },
    [restTimerEnabled, userId],
  );

  const value = useMemo(
    () => ({
      isLoading,
      preferredLanguage,
      profile,
      restTimerEnabled,
      saveProfile,
      saveProfileMedia,
      savePreferredLanguage,
      setRestTimerEnabled,
      uploadProfileMedia,
    }),
    [
      isLoading,
      preferredLanguage,
      profile,
      restTimerEnabled,
      saveProfile,
      saveProfileMedia,
      savePreferredLanguage,
      setRestTimerEnabled,
      uploadProfileMedia,
    ],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = useContext(ProfileContext);

  if (!context) {
    throw new Error('useProfile, ProfileProvider içinde kullanılmalıdır.');
  }

  return context;
}
