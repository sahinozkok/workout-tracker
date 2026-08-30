import { ColorPresetId } from '@/constants/color-presets';

import { DisciplineStatus, Weekday } from '@/types/workout';

export type FriendshipStatus = 'pending' | 'accepted';

/** İsteğin mevcut kullanıcıya göre yönü. */
export type FriendshipDirection = 'incoming' | 'outgoing';

/**
 * Arama sonucundaki güvenli profil önizlemesi. E-posta, provider metadata
 * veya başka özel alan asla bulunmaz.
 */
export type FriendSearchResult = {
  avatarUrl?: string;
  displayName: string;
  friendshipDirection?: FriendshipDirection;
  friendshipId?: string;
  friendshipStatus?: FriendshipStatus;
  id: string;
  username?: string;
};

export type FriendSummary = {
  avatarUrl?: string;
  displayName: string;
  friendshipId: string;
  id: string;
  username?: string;
};

export type FriendRequest = FriendSummary & {
  createdAt: string;
  direction: FriendshipDirection;
};

/**
 * Arkadaş profilinde gösterilen alanlar; özel workout verisi içermez.
 *
 * Seviye ve seviye içi ilerleme **paylaşılır**; gül bakiyesi ve ödül geçmişi
 * hiçbir koşulda paylaşılmaz (RPC bu alanları zaten döndürmez).
 */
export type FriendProfile = {
  avatarUrl?: string;
  bannerUrl?: string;
  bio: string;
  /** Profil sahibinin seçtiği renk. Migration uygulanmadıysa `undefined`. */
  colorPresetId?: ColorPresetId;
  displayName: string;
  id: string;
  level: number;
  trainingGoal: string;
  username?: string;
  xpForNextLevel: number;
  xpIntoLevel: number;
};

/** Arkadaşın paylaşılan disiplin özeti: yalnızca tarih ve durum. */
export type SharedDisciplineDay = {
  dateKey: string;
  status: DisciplineStatus;
};

/**
 * Paylaşılan aktif programın GÜVENLİ gösterim modeli.
 *
 * Yalnızca ekranda gereken alanları taşır. UUID/satır kimliği, owner kimliği,
 * timestamp, workout geçmişi, performans (kilo/tekrar/RPE), notlar, XP/gül/rank,
 * `rest_seconds` ve görsel/Storage URL'leri BİLİNÇLİ olarak yoktur.
 *
 * Egzersiz, kaynak `ProgramExercise` gibi AYRIK bir birleşimdir: kardiyo sahte
 * bir `1 set` olarak temsil edilmez, her tür kendi hedef alanını taşır.
 */
export type SharedProgramExercise =
  | { trackingMode: 'sets_reps'; name: string; targetSets: number; targetReps: string }
  | { trackingMode: 'duration'; name: string; targetDurationSeconds: number }
  | { trackingMode: 'distance'; name: string; targetDistanceMeters: number };

export type SharedProgramDay = {
  name: string;
  scheduledWeekday?: Weekday;
  isOffDay: boolean;
  /** Off-day veya henüz egzersiz eklenmemiş günde boş olabilir. */
  exercises: SharedProgramExercise[];
};

export type SharedActiveProgram = {
  name: string;
  days: SharedProgramDay[];
};
