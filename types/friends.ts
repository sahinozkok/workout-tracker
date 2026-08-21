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
