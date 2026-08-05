import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { supabase } from '@/lib/supabase';
import { TrainingGoal, UserProfile } from '@/types/profile';

type ProfileContextValue = {
  isLoading: boolean;
  profile: UserProfile;
  restTimerEnabled: boolean;
  saveProfile: (profile: UserProfile) => Promise<void>;
  setRestTimerEnabled: (enabled: boolean) => Promise<void>;
};

type ProfileRow = {
  avatar_url: string | null;
  bio: string;
  display_name: string;
  rest_timer_enabled: boolean;
  training_goal: TrainingGoal;
  username: string | null;
};

const DEFAULT_PROFILE: UserProfile = {
  avatarUri: undefined,
  displayName: 'Sporcu',
  username: '',
  bio: '',
  trainingGoal: 'consistency',
};

const LOCAL_AVATAR_KEY_PREFIX = '@workout-tracker/local-avatar';
const AVATAR_BUCKET = 'avatars';
const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

async function uploadAvatar(userId: string, localUri: string) {
  const response = await fetch(localUri);
  if (!response.ok) throw new Error('Seçilen profil fotoğrafı okunamadı. Lütfen tekrar seç.');

  const responseContentType = response.headers.get('content-type');
  const contentType = responseContentType?.startsWith('image/') ? responseContentType : 'image/jpeg';
  const fileData = await response.arrayBuffer();
  const filePath = `${userId}/avatar`;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(filePath, fileData, {
    cacheControl: '3600',
    contentType,
    upsert: true,
  });

  if (error) throw error;

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export function ProfileProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [restTimerEnabled, setRestTimerEnabledState] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      setProfile(DEFAULT_PROFILE);
      setRestTimerEnabledState(true);
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadProfile() {
      const [{ data, error }, localAvatarUri] = await Promise.all([
        supabase
          .from('profiles')
          .select('display_name, username, bio, avatar_url, training_goal, rest_timer_enabled')
          .eq('id', userId)
          .single<ProfileRow>(),
        AsyncStorage.getItem(`${LOCAL_AVATAR_KEY_PREFIX}:${userId}`),
      ]);

      if (error) throw error;
      if (!isMounted) return;

      const legacyLocalAvatar = Platform.OS !== 'web' ? localAvatarUri ?? undefined : undefined;
      setProfile({
        avatarUri: data.avatar_url ?? legacyLocalAvatar,
        displayName: data.display_name,
        username: data.username ?? '',
        bio: data.bio,
        trainingGoal: data.training_goal,
      });
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

  const saveProfile = useCallback(
    async (newProfile: UserProfile) => {
      if (!userId) throw new Error('Profil kaydetmek için giriş yapmalısın.');

      const isRemoteAvatar = newProfile.avatarUri?.startsWith('http') ?? false;
      const avatarUrl = newProfile.avatarUri
        ? isRemoteAvatar
          ? newProfile.avatarUri
          : await uploadAvatar(userId, newProfile.avatarUri)
        : undefined;

      if (!newProfile.avatarUri) {
        const { error: removeError } = await supabase.storage
          .from(AVATAR_BUCKET)
          .remove([`${userId}/avatar`]);
        if (removeError && !removeError.message.toLocaleLowerCase('en-US').includes('not found')) {
          throw removeError;
        }
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          avatar_url: avatarUrl ?? null,
          bio: newProfile.bio,
          display_name: newProfile.displayName,
          training_goal: newProfile.trainingGoal,
          username: newProfile.username || null,
        })
        .eq('id', userId);

      if (error) throw error;

      await AsyncStorage.removeItem(`${LOCAL_AVATAR_KEY_PREFIX}:${userId}`);
      setProfile({ ...newProfile, avatarUri: avatarUrl });
    },
    [userId],
  );

  const setRestTimerEnabled = useCallback(
    async (enabled: boolean) => {
      if (!userId) throw new Error('Ayarı kaydetmek için giriş yapmalısın.');

      const previousValue = restTimerEnabled;
      setRestTimerEnabledState(enabled);

      const { error } = await supabase
        .from('profiles')
        .update({ rest_timer_enabled: enabled })
        .eq('id', userId);

      if (error) {
        setRestTimerEnabledState(previousValue);
        throw error;
      }
    },
    [restTimerEnabled, userId],
  );

  const value = useMemo(
    () => ({ isLoading, profile, restTimerEnabled, saveProfile, setRestTimerEnabled }),
    [isLoading, profile, restTimerEnabled, saveProfile, setRestTimerEnabled],
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
