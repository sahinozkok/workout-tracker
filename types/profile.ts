export type TrainingGoal = 'consistency' | 'strength' | 'muscle' | 'fitness';

export type AppLanguage = 'tr' | 'en';

export type UserProfile = {
  avatarUri?: string;
  bannerUri?: string;
  displayName: string;
  username: string;
  bio: string;
  trainingGoal: TrainingGoal;
};
