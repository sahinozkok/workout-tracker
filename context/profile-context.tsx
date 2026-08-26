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

import {
  COLOR_FEATURES,
  ColorFeature,
  ColorPresetId,
  DEFAULT_PROFILE_COLOR_PRESET,
  parseColorPresetId,
  parseProfileColorPresetId,
} from '@/constants/color-presets';
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
  /**
   * Özellik renk tercihleri. `undefined` = kullanıcı seçmedi → ekran bugünkü
   * rengini kullanmaya devam eder (varsayılan görünüm birebir korunur).
   * `profile` alanı sunucudan gelir ve her zaman gerçek bir değere sahiptir.
   */
  colorPresets: Partial<Record<ColorFeature, ColorPresetId>>;
  setColorPreset: (feature: ColorFeature, presetId: ColorPresetId | undefined) => Promise<void>;
  resetColorPresets: () => Promise<void>;
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
  color_preset?: string | null;
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
/**
 * Özellik renk tercihleri. Anahtar kullanıcı kimliğiyle biter: aynı cihazdaki
 * iki hesap birbirinin renklerini görmez. Profil rengi buraya YAZILMAZ; o
 * sunucuda saklanır ve arkadaşlara gösterilir.
 */
const COLOR_PRESET_KEY_PREFIX = '@workout-tracker/color-preset';
/**
 * OTORİTE AYRIMI.
 *
 *   * `profile` rengi YALNIZCA Supabase'de saklanır ve oradan yüklenir; çünkü
 *     arkadaşlara gösterilir ve cihazlar arası aynı olmalıdır. Bu özellik için
 *     AsyncStorage'a hiç okuma/yazma/silme yapılmaz.
 *   * Diğer altı tercih cihaz yerelidir ve kullanıcı kimliği içeren
 *     AsyncStorage anahtarlarında tutulur.
 *
 * İki kaynak `colorPresets` state'ini paylaştığı için her biri YALNIZCA kendi
 * sahip olduğu alanları yazar (functional update). Böylece hangi isteğin önce
 * bittiği sonucu değiştirmez.
 */
const LOCAL_COLOR_FEATURES = COLOR_FEATURES.filter((feature) => feature !== 'profile');
const LEGACY_COLUMNS = 'display_name, username, bio, avatar_url, training_goal, rest_timer_enabled';
const EXTENDED_COLUMNS = `${LEGACY_COLUMNS}, banner_url, preferred_language, color_preset`;
/** Postgres: kolon bulunamadı. PostgREST ise şema önbelleği için PGRST204 döner. */
const UNDEFINED_COLUMN = '42703';
const POSTGREST_MISSING_COLUMN = 'PGRST204';
/** Yalnızca bu iki yeni kolonun eksikliği "migration uygulanmamış" sayılır. */
const OPTIONAL_COLUMNS = ['banner_url', 'preferred_language', 'color_preset'];
const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

/**
 * Sadece `banner_url` / `preferred_language` / `color_preset` eksikliğini eksik
 * kolon kabul eder.
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

/**
 * Profil rengini sunucuya yazar.
 *
 * Profil rengi YALNIZCA Supabase'de saklanır; AsyncStorage'a hiçbir aşamada
 * yazılmaz, okunmaz veya silinmez. Arkadaşlara gösterildiği ve cihazlar arası
 * aynı olması gerektiği için tek doğru kaynağı sunucudur.
 *
 * Migration HENÜZ UYGULANMADIYSA `color_preset` kolonu yoktur; bu durumda hata
 * yutulur ve uygulama çalışmaya devam eder (mevcut optional-column yaklaşımı).
 * O sürede renk kalıcı olmaz ve arkadaş paylaşımı devre dışı kalır; oturum
 * içinde seçilen değer yalnızca ekranda görünür.
 */
async function saveProfileColorPreset(userId: string, presetId: ColorPresetId) {
  const { error } = await supabase.from('profiles').update({ color_preset: presetId }).eq('id', userId);
  if (error && !isMissingOptionalColumnError(error)) throw error;
}

export function ProfileProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [preferredLanguage, setPreferredLanguage] = useState<AppLanguage>();
  const [restTimerEnabled, setRestTimerEnabledState] = useState(true);
  const [showExerciseIcons, setShowExerciseIconsState] = useState(false);
  const [showProgramIcons, setShowProgramIconsState] = useState(false);
  const [colorPresets, setColorPresetsState] = useState<Partial<Record<ColorFeature, ColorPresetId>>>({});
  /**
   * `colorPresets` state'inin hangi kullanıcıya ait olduğu. Hesap değişince
   * ANINDA güncellenir; her iki async yükleme yolu yazmadan önce bunu kontrol
   * eder, böylece geç tamamlanan eski istek yeni hesabın rengini ezemez.
   */
  const colorPresetsUserRef = useRef<string | undefined>(undefined);
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
      /**
       * Profil rengi YALNIZCA sunucudan gelir. Bu yol state'in TAMAMINI değil
       * yalnızca `profile` alanını yazar; aynı anda yüklenen yerel tercihler
       * korunur (sıra bağımsızlığı).
       *
       * Sunucudaki değer varsayılana eşitse state'te `undefined` olarak
       * normalize edilir; aksi hâlde kullanıcı hiçbir şey seçmediği hâlde
       * arayüzde "özel seçim" varmış gibi görünürdü.
       *
       * Kolon yoksa (migration uygulanmadıysa) veya değer geçersizse yine
       * varsayılana düşülür — mevcut optional-column davranışı korunur.
       */
      if (colorPresetsUserRef.current === userId) {
        const serverProfilePreset = parseProfileColorPresetId(data.color_preset);
        setColorPresetsState((current) => {
          const next = { ...current };
          if (serverProfilePreset === DEFAULT_PROFILE_COLOR_PRESET) delete next.profile;
          else next.profile = serverProfilePreset;
          return next;
        });
      }
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
    /**
     * Hesap değiştiği anda (veya çıkışta) renk state'i SENKRON olarak temizlenir
     * ve sahiplik yeni kullanıcıya geçer. Bu effect'in gövdesi, iki async
     * yükleme yolunun cevaplarından ÖNCE çalışır; dolayısıyla A hesabının geç
     * gelen cevabı B'ye yazamaz.
     */
    if (colorPresetsUserRef.current !== userId) {
      colorPresetsUserRef.current = userId;
      setColorPresetsState({});
    }

    if (!userId) {
      setShowExerciseIconsState(false);
      setShowProgramIconsState(false);
      return;
    }

    let isMounted = true;

    // Profil rengi BİLİNÇLİ olarak dışarıda: o yalnızca Supabase'de yaşar.
    const colorKeys = LOCAL_COLOR_FEATURES.map(
      (feature) => `${COLOR_PRESET_KEY_PREFIX}:${feature}:${userId}`,
    );

    AsyncStorage.multiGet([
      `${SHOW_PROGRAM_ICONS_KEY_PREFIX}:${userId}`,
      `${SHOW_EXERCISE_ICONS_KEY_PREFIX}:${userId}`,
      ...colorKeys,
    ])
      .then((entries) => {
        if (!isMounted) return;
        setShowProgramIconsState(entries[0]?.[1] === 'true');
        setShowExerciseIconsState(entries[1]?.[1] === 'true');

        if (colorPresetsUserRef.current !== userId) return;

        // Eski/geçersiz ID sessizce düşer; o özellik varsayılana döner.
        const loadedPresets: Partial<Record<ColorFeature, ColorPresetId>> = {};
        LOCAL_COLOR_FEATURES.forEach((feature, index) => {
          const presetId = parseColorPresetId(entries[index + 2]?.[1]);
          if (presetId) loadedPresets[feature] = presetId;
        });

        /**
         * State'in TAMAMI değiştirilmez: Supabase'den gelmiş olabilecek
         * `profile` değeri korunur, yalnızca yerel alanlar birleştirilir.
         */
        setColorPresetsState((current) => ({
          ...(current.profile ? { profile: current.profile } : {}),
          ...loadedPresets,
        }));
      })
      .catch(() => {
        if (!isMounted) return;
        setShowProgramIconsState(false);
        setShowExerciseIconsState(false);
        // Yalnızca YEREL alanlar sıfırlanır; sunucudan gelen profil korunur.
        if (colorPresetsUserRef.current === userId) {
          setColorPresetsState((current) => (current.profile ? { profile: current.profile } : {}));
        }
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

  /**
   * Tek bir özelliğin rengini kaydeder. `undefined` verilirse tercih silinir ve
   * o özellik BUGÜNKÜ varsayılan rengine döner.
   *
   * Profil rengi ayrıca sunucuya yazılır: arkadaşlar profili sahibinin seçtiği
   * renkte görür. Sunucu yazımı başarısız olursa yerel değişiklik de geri
   * alınır — iki taraf tutarsız kalmaz.
   */
  /**
   * Tek bir özelliğin rengini kaydeder.
   *
   * Yazma hedefi özelliğin SAHİBİNE göre seçilir: `profile` yalnızca Supabase'e,
   * diğer altısı yalnızca AsyncStorage'a. Profil için AsyncStorage'a hiç
   * dokunulmaz.
   *
   * Hata durumunda YALNIZCA bu alan geri alınır — eski state nesnesinin tamamı
   * yazılsaydı, bu sırada değiştirilen başka bir renk sessizce ezilirdi.
   */
  const setColorPreset = useCallback(
    async (feature: ColorFeature, presetId: ColorPresetId | undefined) => {
      if (!userId) throw new Error('missingSession');
      const previousValue = colorPresets[feature];

      setColorPresetsState((current) => {
        const next = { ...current };
        if (presetId) next[feature] = presetId;
        else delete next[feature];
        return next;
      });

      try {
        if (feature === 'profile') {
          await saveProfileColorPreset(userId, presetId ?? DEFAULT_PROFILE_COLOR_PRESET);
        } else {
          const storageKey = `${COLOR_PRESET_KEY_PREFIX}:${feature}:${userId}`;
          if (presetId) await AsyncStorage.setItem(storageKey, presetId);
          else await AsyncStorage.removeItem(storageKey);
        }
      } catch (error) {
        /**
         * SAHİPLİK GUARD'I: istek geç hata verdiğinde hesap değişmiş olabilir.
         * Eski hesabın değeri yeni hesabın ekranına YAZILMAZ; kalıcı kaynaklar
         * yakalanmış `userId` ile zaten doğru hesaba yazılmıştır.
         */
        if (colorPresetsUserRef.current === userId) {
          setColorPresetsState((current) => {
            const next = { ...current };
            if (previousValue) next[feature] = previousValue;
            else delete next[feature];
            return next;
          });
        }
        throw error;
      }
    },
    [colorPresets, userId],
  );

  /**
   * Bütün özellikleri varsayılana döndürür.
   *
   * İKİ KALICI KAYNAK, TEK İŞLEM: altı yerel renk AsyncStorage'dan silinir,
   * profil rengi Supabase'de varsayılana yazılır. Bunlar arasında dağıtık bir
   * transaction yoktur; bu yüzden herhangi bir adım başarısız olursa ELDE
   * EDİLEN KALICI DEĞİŞİKLİKLER DE GERİ ALINIR (telafi/compensation).
   *
   * Eski davranış yalnızca React state'ini geri alıyordu: AsyncStorage silme
   * başarılı olup Supabase yazımı başarısız olduğunda ekranda renkler geri
   * gelmiş görünüyor ama kayıtlar silinmiş kalıyordu; uygulama yeniden
   * açıldığında altı yerel renk kayboluyordu.
   */
  const resetColorPresets = useCallback(async () => {
    if (!userId) throw new Error('missingSession');

    const previousPresets = colorPresets;
    const localStorageKeys = LOCAL_COLOR_FEATURES.map(
      (feature) => `${COLOR_PRESET_KEY_PREFIX}:${feature}:${userId}`,
    );
    /**
     * Geri alma için EKSİKSİZ snapshot. `multiGet` her anahtar için bir satır
     * döndürür; değeri `null` olanlar "kayıt yoktu" demektir ve rollback'te
     * YENİDEN OLUŞTURULMAZ.
     */
    const localSnapshot = await AsyncStorage.multiGet(localStorageKeys);
    const previousProfilePreset = previousPresets.profile ?? DEFAULT_PROFILE_COLOR_PRESET;

    /**
     * SAHİPLİK GUARD'I — `multiGet` beklenirken kullanıcı hesap değiştirmiş
     * olabilir. Bu durumda A'nın optimistic yazımı B'nin yeni yüklenmiş renk
     * state'ini `{}` ile silerdi.
     *
     * Kalıcı adımlar (Supabase + AsyncStorage) yakalanmış `userId` ile devam
     * eder ve A'nın kaynaklarını doğru şekilde tamamlar/geri alır; değişen tek
     * şey, artık B'nin React state'ine HİÇBİR koşulda yazılmamasıdır.
     */
    const ownsState = () => colorPresetsUserRef.current === userId;

    // Optimistic: ekran hemen varsayılana döner.
    if (ownsState()) setColorPresetsState({});

    let didResetProfile = false;
    /**
     * `multiRemove` REDDEDİLSE bile bazı anahtarlar silinmiş olabilir. Bu
     * yüzden bayrak çağrıdan ÖNCE set edilir: telafi "başarıyla silindi mi"
     * değil, "dokunuldu mu" sorusuna göre çalışır.
     */
    let didTouchLocal = false;

    try {
      /**
       * SIRA ÖNEMLİ: önce sunucu, sonra yerel. Sunucu adımı başarısız olursa
       * yerel kayıtlara hiç dokunulmamış olur ve telafiye gerek kalmaz.
       */
      await saveProfileColorPreset(userId, DEFAULT_PROFILE_COLOR_PRESET);
      didResetProfile = true;

      didTouchLocal = true;
      await AsyncStorage.multiRemove(localStorageKeys);
    } catch (error) {
      // Aynı guard: A'nın renkleri B'nin ekranına yazılamaz.
      if (ownsState()) setColorPresetsState(previousPresets);

      /**
       * Telafi adımları. `allSettled`: rollback sırasında oluşan ikincil bir
       * hata ASIL hatayı gizlemez — çağırana her zaman ilk gerçek hata gider.
       * Yalnızca gerçekten uygulanmış adımlar geri alınır.
       */
      const rollbacks: Promise<unknown>[] = [];

      if (didTouchLocal) {
        const restorePairs = localSnapshot
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .map(([key, value]) => [key, value] as [string, string]);

        if (restorePairs.length > 0) rollbacks.push(AsyncStorage.multiSet(restorePairs));
      }

      if (didResetProfile) {
        rollbacks.push(saveProfileColorPreset(userId, previousProfilePreset));
      }

      if (rollbacks.length > 0) await Promise.allSettled(rollbacks);

      throw error;
    }
  }, [colorPresets, userId]);

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
      colorPresets,
      resetColorPresets,
      setColorPreset,
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
      colorPresets,
      resetColorPresets,
      setColorPreset,
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
