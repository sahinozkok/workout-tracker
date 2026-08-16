import { DisciplineStatus } from '@/types/workout';

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

/** Arkadaş profilinde gösterilen alanlar; özel workout verisi içermez. */
export type FriendProfile = {
  avatarUrl?: string;
  bannerUrl?: string;
  bio: string;
  displayName: string;
  id: string;
  trainingGoal: string;
  username?: string;
};

/** Arkadaşın paylaşılan disiplin özeti: yalnızca tarih ve durum. */
export type SharedDisciplineDay = {
  dateKey: string;
  status: DisciplineStatus;
};
