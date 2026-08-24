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

/**
 * Profil yükleme yaşam döngüsü.
 *
 * Boolean bir "hata var mı" bayrağı YETMEZ: yeniden denemede bayrak istek
 * uçarken hemen `false` olur ve o aralıkta `profile` hâlâ varsayılan
 * değerlerdedir. Bu üç durumlu makine "başarıyla yüklendi"yi ayrı ve KESİN
 * biçimde ifade eder; yazma izni yalnızca `ready` durumuna bağlanır.
 *
 *   idle    → oturum yok
 *   loading → sorgu uçuşta (ilk yükleme veya yeniden deneme)
 *   ready   → veri gerçekten `setProfile` ile uygulandı
 *   error   → sorgu başarısız
 */
export type ProfileLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

type ProfileContextValue = {
  isLoading: boolean;
  /** Yazma izni ve hata satırı YALNIZCA bu değerden türetilir. */
  profileLoadStatus: ProfileLoadStatus;
  preferredLanguage?: AppLanguage;
  profile: UserProfile;
  restTimerEnabled: boolean;
  showExerciseIcons: boolean;
  showProgramIcons: boolean;
  /** Başarısız yüklemeyi yeniden dener. */
  reloadProfile: () => void;
  saveProfile: (profile: UserProfile) => Promise<void>;
  /** Yalnızca avatar/kapak adresini kalıcılaştırır; diğer profil alanlarına dokunmaz. */
  saveProfileMedia: (kind: ProfileImageKind, url: string | undefined) => Promise<void>;
  savePreferredLanguage: (language: AppLanguage) => Promise<void>;
  setRestTimerEnabled: (enabled: boolean) => Promise<void>;
  setShowExerciseIcons: (enabled: boolean) => Promise<void>;
  setShowProgramIcons: (enabled: boolean) => Promise<void>;
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
const SHOW_EXERCISE_ICONS_KEY_PREFIX = '@workout-tracker/show-exercise-icons';
const SHOW_PROGRAM_ICONS_KEY_PREFIX = '@workout-tracker/show-program-icons';
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
  const [showExerciseIcons, setShowExerciseIconsState] = useState(false);
  const [showProgramIcons, setShowProgramIconsState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  /**
   * Durum, AİT OLDUĞU kullanıcıyla birlikte tutulur. `_layout` sağlayıcıyı
   * `key={user?.id}` ile remount ettiği için pratikte zaten taşınmaz; buradaki
   * sahiplik kontrolü o dosyaya bağımlı kalmamak içindir. Hesap değiştiğinde,
   * effect henüz çalışmamış olsa bile türetilen değer asla `ready` okunmaz.
   */
  const [loadState, setLoadState] = useState<{ status: ProfileLoadStatus; userId?: string }>({
    status: 'idle',
  });
  /** Artırıldığında yükleme effect'i yeniden çalışır (yeniden dene). */
  const [reloadToken, setReloadToken] = useState(0);
  const userId = user?.id;
  /**
   * Render sırasında türetilir: durum başka bir hesaba aitse `ready` sayılmaz.
   * Böylece hesap değişiminden sonraki ilk karede bile yazma açılmaz.
   */
  const profileLoadStatus: ProfileLoadStatus =
    loadState.userId === userId ? loadState.status : userId ? 'loading' : 'idle';
  // Kalıcılaştırma sırasında güncel profili stale closure olmadan okumak için.
  const profileRef = useRef(profile);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  /**
   * ASYNC İŞLEM SIRASINDA yazma yetkisi.
   *
   * `profileLoadStatus`'ı doğrudan callback closure'ından okumak yetmez:
   * dependency listesi yalnızca SONRAKİ çağrıları günceller, hâlihazırda
   * uçuşta olan bir işlem başladığı render'daki eski `ready` değerini taşımaya
   * devam eder. Uzun süren bir Storage yüklemesi sırasında hesap değişir,
   * sağlayıcı kapanır veya profil yeniden yüklenmeye başlarsa o eski değer
   * yanlış hesaba yazma başlatabilirdi. Bu yüzden yetki her zaman ref'ten,
   * yani en güncel değerden okunur.
   */
  const writeAuthorityRef = useRef<{
    isMounted: boolean;
    status: ProfileLoadStatus;
    userId?: string;
  }>({ isMounted: true, status: 'idle', userId: undefined });

  // Bağımlılık listesi YOK: her render'dan sonra güncellenir.
  useEffect(() => {
    writeAuthorityRef.current.status = profileLoadStatus;
    writeAuthorityRef.current.userId = userId;
  });

  /**
   * Mount durumu setup'ta AÇIKÇA etkinleştirilir, cleanup'ta düşürülür.
   *
   * Setup'taki atama gereksiz değildir: Strict Mode geliştirme kontrolünde
   * effect `setup → cleanup → setup` sırasıyla çalışır. Yalnızca cleanup
   * yazsaydı ikinci setup'tan sonra `isMounted` `false` kalır ve profil yazma
   * yetkisi geliştirme ortamında kalıcı olarak kapanırdı.
   */
  useEffect(() => {
    writeAuthorityRef.current.isMounted = true;

    return () => {
      writeAuthorityRef.current.isMounted = false;
      writeAuthorityRef.current.status = 'idle';
      writeAuthorityRef.current.userId = undefined;
    };
  }, []);

  /**
   * Yazma izni: sağlayıcı hâlâ ayakta, profil gerçekten yüklenmiş ve işlem
   * başlatıldığı hesap hâlâ aktif hesap mı? Async bir işlemin ortasında da
   * çağrılabilir; her seferinde güncel değeri okur.
   */
  const canWriteProfile = useCallback((ownerId: string) => {
    const authority = writeAuthorityRef.current;
    return authority.isMounted && authority.status === 'ready' && authority.userId === ownerId;
  }, []);

  useEffect(() => {
    if (!userId) {
      setProfile(DEFAULT_PROFILE);
      setPreferredLanguage(undefined);
      setRestTimerEnabledState(true);
      setLoadState({ status: 'idle', userId: undefined });
      setIsLoading(false);
      return;
    }

    /**
     * `isMounted` çalıştırma BAŞINA tanımlıdır. `userId` değiştiğinde React
     * önce bu çalıştırmanın cleanup'ını yürütür, bu yüzden eski hesabın geç
     * tamamlanan isteği ne `profile`'ı ne de durumu yazabilir; `ready` durumu
     * hesaplar arasında taşınamaz. Unmount sonrası da aynı koruma geçerlidir.
     */
    let isMounted = true;
    setIsLoading(true);
    // Yeniden deneme dahil her sorgu `loading` ile başlar → Save kapalı kalır.
    setLoadState({ status: 'loading', userId });

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
      if (!isMounted) return;
      // Satır yoksa sessizce `loading`'de kalınmaz; kontrollü hataya düşülür.
      if (!data) throw new Error('profileRowMissing');

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
      // `ready` YALNIZCA veri gerçekten uygulandıktan sonra yazılır; erken
      // dönülen hiçbir yol bu satıra ulaşamaz.
      setLoadState({ status: 'ready', userId });
    }

    loadProfile()
      .catch(() => {
        /**
         * Hata artık SESSİZCE yutulmuyor.
         *
         * Eskiden buradaki boş `catch` yüzünden okuma başarısız olduğunda
         * `profile` `DEFAULT_PROFILE` olarak kalıyordu ve ekran, kullanıcının
         * kaydı silinmiş gibi boş görünüyordu. Daha kötüsü: o boş taslakla
         * "Profili kaydet"e basmak gerçek kaydın üzerine yazıyordu. Bayrak
         * ekrana bildirilir, kaydetme ise `saveProfile` içinde engellenir.
         */
        if (isMounted) setLoadState({ status: 'error', userId });
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reloadToken, userId]);

  const reloadProfile = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!userId) {
      setShowExerciseIconsState(false);
      setShowProgramIconsState(false);
      return;
    }

    let isMounted = true;

    AsyncStorage.multiGet([
      `${SHOW_PROGRAM_ICONS_KEY_PREFIX}:${userId}`,
      `${SHOW_EXERCISE_ICONS_KEY_PREFIX}:${userId}`,
    ])
      .then((entries) => {
        if (!isMounted) return;
        setShowProgramIconsState(entries[0]?.[1] === 'true');
        setShowExerciseIconsState(entries[1]?.[1] === 'true');
      })
      .catch(() => {
        if (!isMounted) return;
        setShowProgramIconsState(false);
        setShowExerciseIconsState(false);
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

      /**
       * VERİ KORUMASI — profil okunmadan Storage'a dosya YÜKLENMEZ.
       *
       * Kontrol yüklemeden ÖNCEDİR: aksi hâlde dosya yüklenir, ardından gelen
       * `saveProfileMedia` engellenir ve Storage'da sahipsiz bir dosya kalırdı.
       * Yetki güncel ref'ten okunur, closure'dan değil.
       */
      if (!canWriteProfile(userId)) throw new Error('profileNotLoaded');

      const { publicUrl } = await uploadProfileImage(userId, kind, asset);

      /**
       * Yükleme uzun sürebilir; bu sırada hesap değişmiş, sağlayıcı kapanmış
       * veya profil yeniden yüklenmeye başlamış olabilir. Yetki TEKRAR
       * kontrol edilir ve düşmüşse az önce yüklenen dosya sahipsiz bırakılmaz.
       */
      if (!canWriteProfile(userId)) {
        const uploadedPath = getStoragePathFromUrl(publicUrl, userId);
        // Eski kalıcı görsel HİÇBİR koşulda hedeflenmez: yalnızca bu çağrıda
        // üretilen yol, ve yalnızca mevcut kalıcı yoldan farklıysa silinir.
        const currentAvatarPath = getStoragePathFromUrl(profileRef.current.avatarUri, userId);
        const currentBannerPath = getStoragePathFromUrl(profileRef.current.bannerUri, userId);
        const isPermanent = uploadedPath === currentAvatarPath || uploadedPath === currentBannerPath;
        // Tek temizleme noktası: `pickProfileImage` bu dosyayı staged olarak
        // hiç işaretlemediği için ikinci bir silme denemesi oluşmaz.
        if (!isPermanent) await removeProfileImagePaths([uploadedPath], userId);
        throw new Error('profileNotLoaded');
      }

      return publicUrl;
    },
    [canWriteProfile, userId],
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

      /**
       * VERİ KORUMASI — veri katmanındaki kesin engel. Düğmenin kapalı
       * olmasına güvenilmez; profil okunmadan `avatar_url` / `banner_url`
       * yazılmaz.
       *
       * Yetki closure'dan DEĞİL güncel ref'ten okunur: sağlayıcı kapandıysa,
       * hesap değiştiyse veya durum artık `ready` değilse DB güncellemesi hiç
       * başlatılmaz. Bu çağrıya yeni yüklenmiş bir URL verildiyse o dosya
       * sahipsiz kalmasın diye AŞAĞIDAKİ hata dalıyla AYNI orphan kuralıyla
       * temizlenir — `orphanPath` tanımı gereği eski kalıcı dosyayı asla
       * hedeflemez.
       */
      if (!canWriteProfile(userId)) {
        await removeProfileImagePaths([orphanPath], userId);
        throw new Error('profileNotLoaded');
      }

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
    [canWriteProfile, userId],
  );

  const saveProfile = useCallback(
    async (newProfile: UserProfile) => {
      if (!userId) throw new Error('missingSession');

      /**
       * VERİ KORUMASI — profil sunucudan okunamadıysa hiçbir yazma yapılmaz.
       *
       * Okuma başarısızken ekrandaki taslak gerçek kayıt değil, varsayılan boş
       * değerlerdir. Bu hâlde kaydetmek `display_name`, `username`, `bio`,
       * `avatar_url` ve `banner_url` alanlarını kullanıcının gerçek kaydının
       * üzerine boş olarak yazardı. Önce yeniden yükleme başarılı olmalı.
       *
       * Kontrol `!== 'ready'` şeklindedir, "hata var mı" değil: ilk yükleme ve
       * yeniden deneme sürerken de yazma kapalıdır. Yetki güncel ref'ten
       * okunur, böylece uzun süren bir etkileşim sonrası eski callback üzerinden
       * yazma başlatılamaz.
       */
      if (!canWriteProfile(userId)) throw new Error('profileNotLoaded');

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
    [canWriteProfile, profile.avatarUri, profile.bannerUri, userId],
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

  const setShowProgramIcons = useCallback(
    async (enabled: boolean) => {
      if (!userId) throw new Error('missingSession');
      const previousValue = showProgramIcons;
      setShowProgramIconsState(enabled);

      try {
        await AsyncStorage.setItem(`${SHOW_PROGRAM_ICONS_KEY_PREFIX}:${userId}`, String(enabled));
      } catch (error) {
        setShowProgramIconsState(previousValue);
        throw error;
      }
    },
    [showProgramIcons, userId],
  );

  const setShowExerciseIcons = useCallback(
    async (enabled: boolean) => {
      if (!userId) throw new Error('missingSession');
      const previousValue = showExerciseIcons;
      setShowExerciseIconsState(enabled);

      try {
        await AsyncStorage.setItem(`${SHOW_EXERCISE_ICONS_KEY_PREFIX}:${userId}`, String(enabled));
      } catch (error) {
        setShowExerciseIconsState(previousValue);
        throw error;
      }
    },
    [showExerciseIcons, userId],
  );

  const value = useMemo(
    () => ({
      isLoading,
      preferredLanguage,
      profileLoadStatus,
      reloadProfile,
      profile,
      restTimerEnabled,
      showExerciseIcons,
      showProgramIcons,
      saveProfile,
      saveProfileMedia,
      savePreferredLanguage,
      setRestTimerEnabled,
      setShowExerciseIcons,
      setShowProgramIcons,
      uploadProfileMedia,
    }),
    [
      isLoading,
      preferredLanguage,
      profileLoadStatus,
      reloadProfile,
      profile,
      restTimerEnabled,
      showExerciseIcons,
      showProgramIcons,
      saveProfile,
      saveProfileMedia,
      savePreferredLanguage,
      setRestTimerEnabled,
      setShowExerciseIcons,
      setShowProgramIcons,
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
