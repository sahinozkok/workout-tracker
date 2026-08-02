import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { TrainingGoal, UserProfile } from '@/types/profile';

type ProfileContextValue = {
  profile: UserProfile;
  restTimerEnabled: boolean;
  saveProfile: (profile: UserProfile) => Promise<void>;
  setRestTimerEnabled: (enabled: boolean) => Promise<void>;
};

const DEFAULT_PROFILE: UserProfile = {
  avatarUri: undefined,
  displayName: 'Sporcu',
  username: '',
  bio: '',
  trainingGoal: 'consistency',
};

const PROFILE_STORAGE_KEY = '@workout-tracker/profile';
const REST_TIMER_STORAGE_KEY = '@workout-tracker/rest-timer-enabled';
const TRAINING_GOALS: TrainingGoal[] = ['consistency', 'strength', 'muscle', 'fitness'];
const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

export function ProfileProvider({ children }: PropsWithChildren) {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [restTimerEnabled, setRestTimerEnabledState] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      const [savedProfile, savedRestTimerPreference] = await Promise.all([
        AsyncStorage.getItem(PROFILE_STORAGE_KEY),
        AsyncStorage.getItem(REST_TIMER_STORAGE_KEY),
      ]);

      if (savedProfile) {
        const parsedProfile = JSON.parse(savedProfile) as Partial<UserProfile>;
        setProfile({
          avatarUri: typeof parsedProfile.avatarUri === 'string' ? parsedProfile.avatarUri : undefined,
          displayName:
            typeof parsedProfile.displayName === 'string' ? parsedProfile.displayName : DEFAULT_PROFILE.displayName,
          username: typeof parsedProfile.username === 'string' ? parsedProfile.username : DEFAULT_PROFILE.username,
          bio: typeof parsedProfile.bio === 'string' ? parsedProfile.bio : DEFAULT_PROFILE.bio,
          trainingGoal: TRAINING_GOALS.includes(parsedProfile.trainingGoal as TrainingGoal)
            ? (parsedProfile.trainingGoal as TrainingGoal)
            : DEFAULT_PROFILE.trainingGoal,
        });
      }

      if (savedRestTimerPreference !== null) {
        setRestTimerEnabledState(savedRestTimerPreference === 'true');
      }
    }

    loadProfile().catch(() => {
      // Kayıt okunamazsa başlangıç profili kullanılmaya devam eder.
    });
  }, []);

  const saveProfile = useCallback(async (newProfile: UserProfile) => {
    setProfile(newProfile);
    await AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(newProfile));
  }, []);

  const setRestTimerEnabled = useCallback(async (enabled: boolean) => {
    setRestTimerEnabledState(enabled);
    await AsyncStorage.setItem(REST_TIMER_STORAGE_KEY, String(enabled));
  }, []);

  const value = useMemo(
    () => ({ profile, restTimerEnabled, saveProfile, setRestTimerEnabled }),
    [profile, restTimerEnabled, saveProfile, setRestTimerEnabled],
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
