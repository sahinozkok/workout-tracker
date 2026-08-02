export type TrainingGoal = 'consistency' | 'strength' | 'muscle' | 'fitness';

export type UserProfile = {
  avatarUri?: string;
  displayName: string;
  username: string;
  bio: string;
  trainingGoal: TrainingGoal;
};
