import { parseColorPresetId } from '@/constants/color-presets';
import { supabase } from '@/lib/supabase';
import {
  FriendProfile,
  FriendRequest,
  FriendSearchResult,
  FriendSummary,
  FriendshipDirection,
  FriendshipStatus,
  SharedDisciplineDay,
} from '@/types/friends';
import { DisciplineStatus } from '@/types/workout';

/**
 * Arkadaşlık servis katmanı. Bütün Supabase çağrıları burada toplanır;
 * ekranlar doğrudan `supabase` istemcisine dokunmaz.
 *
 * Yazma işlemlerinin hepsi doğrulanmış RPC'ler üzerinden yapılır — istemci
 * `friendships` veya `shared_discipline_days` tablolarına doğrudan yazamaz.
 */

/** Arama en az bu kadar karakterle başlar. */
export const FRIEND_SEARCH_MIN_LENGTH = 2;
/** SQL tarafı da aynı üst sınırı doğrular. */
export const FRIEND_SEARCH_MAX_LENGTH = 64;
/** Tek senkronizasyonda gönderilen en fazla gün sayısı (RPC de doğrular). */
export const DISCIPLINE_SYNC_MAX_DAYS = 366;

type ProfilePreviewRow = {
  avatar_url: string | null;
  display_name: string;
  id: string;
  username: string | null;
};

function toOptional(value: string | null | undefined) {
  return value ?? undefined;
}

export async function searchProfiles(query: string): Promise<FriendSearchResult[]> {
  const trimmed = query.trim().slice(0, FRIEND_SEARCH_MAX_LENGTH);
  if (trimmed.length < FRIEND_SEARCH_MIN_LENGTH) return [];

  const { data, error } = await supabase.rpc('search_profiles', { search_query: trimmed });
  if (error) throw error;

  return ((data ?? []) as (ProfilePreviewRow & {
    friendship_direction: string | null;
    friendship_id: string | null;
    friendship_status: string | null;
  })[]).map((row) => ({
    avatarUrl: toOptional(row.avatar_url),
    displayName: row.display_name,
    friendshipDirection: (row.friendship_direction as FriendshipDirection | null) ?? undefined,
    friendshipId: toOptional(row.friendship_id),
    friendshipStatus: (row.friendship_status as FriendshipStatus | null) ?? undefined,
    id: row.id,
    username: toOptional(row.username),
  }));
}

export async function listFriends(): Promise<FriendSummary[]> {
  const { data, error } = await supabase.rpc('list_friends');
  if (error) throw error;

  return ((data ?? []) as (ProfilePreviewRow & { friendship_id: string })[]).map((row) => ({
    avatarUrl: toOptional(row.avatar_url),
    displayName: row.display_name,
    friendshipId: row.friendship_id,
    id: row.id,
    username: toOptional(row.username),
  }));
}

export async function listFriendRequests(): Promise<FriendRequest[]> {
  const { data, error } = await supabase.rpc('list_friend_requests');
  if (error) throw error;

  return ((data ?? []) as (ProfilePreviewRow & {
    created_at: string;
    direction: string;
    friendship_id: string;
  })[]).map((row) => ({
    avatarUrl: toOptional(row.avatar_url),
    createdAt: row.created_at,
    direction: row.direction as FriendshipDirection,
    displayName: row.display_name,
    friendshipId: row.friendship_id,
    id: row.id,
    username: toOptional(row.username),
  }));
}

export async function sendFriendRequest(targetUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('send_friend_request', {
    target_user_id: targetUserId,
  });
  if (error) throw error;
  return data as string;
}

export async function respondToFriendRequest(friendshipId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_to_friend_request', {
    accept,
    friendship_id: friendshipId,
  });
  if (error) throw error;
}

export async function cancelFriendRequest(friendshipId: string) {
  const { error } = await supabase.rpc('cancel_friend_request', { friendship_id: friendshipId });
  if (error) throw error;
}

export async function removeFriend(friendshipId: string) {
  const { error } = await supabase.rpc('remove_friend', { friendship_id: friendshipId });
  if (error) throw error;
}

/** Arkadaş değilse RPC boş döner; ekran "erişim yok" durumunu gösterir. */
export async function getFriendProfile(targetUserId: string): Promise<FriendProfile | undefined> {
  const { data, error } = await supabase.rpc('get_friend_profile', {
    target_user_id: targetUserId,
  });
  if (error) throw error;

  const row = ((data ?? []) as {
    avatar_url: string | null;
    banner_url: string | null;
    bio: string;
    display_name: string;
    id: string;
    color_preset: string | null;
    level: number | null;
    training_goal: string;
    username: string | null;
    xp_for_next: number | null;
    xp_into_level: number | null;
  }[])[0];

  if (!row) return undefined;

  return {
    avatarUrl: toOptional(row.avatar_url),
    bannerUrl: toOptional(row.banner_url),
    bio: row.bio,
    /**
     * Profil rengi PROFİL SAHİBİNDEN gelir; görüntüleyen arkadaşın kendi
     * tercihi kullanılmaz. Migration uygulanmadıysa alan gelmez ve
     * `parseColorPresetId` `undefined` döndürür → ekran bugünkü tona düşer.
     */
    colorPresetId: parseColorPresetId(row.color_preset),
    displayName: row.display_name,
    id: row.id,
    // Seviye alanları RPC'den gelir; gül bakiyesi ve ödül geçmişi HİÇ gelmez.
    level: row.level ?? 1,
    trainingGoal: row.training_goal,
    username: toOptional(row.username),
    xpForNextLevel: row.xp_for_next ?? 0,
    xpIntoLevel: row.xp_into_level ?? 0,
  };
}

export async function getFriendDisciplineDays(
  targetUserId: string,
  fromDate: string,
  toDate: string,
): Promise<SharedDisciplineDay[]> {
  const { data, error } = await supabase.rpc('get_friend_discipline_days', {
    from_date: fromDate,
    target_user_id: targetUserId,
    to_date: toDate,
  });
  if (error) throw error;

  return ((data ?? []) as { discipline_date: string; status: DisciplineStatus }[]).map((row) => ({
    dateKey: row.discipline_date,
    status: row.status,
  }));
}

/**
 * Kendi disiplin özetini paylaşılan tabloya yazar. RPC gelecek tarihleri ve
 * 366 günden eskiyi reddeder, durum değerlerini doğrular ve payload boyutunu
 * sınırlar. Başarısızlık çağırana bildirilir; ana uygulamayı engellemez.
 *
 * `clientToday` cihazın YEREL günüdür (`toDateKey(new Date())`). Sunucunun
 * `current_date` değeri UTC olduğu için ikisi bir gün sapabilir; RPC bu sapmayı
 * en fazla ±1 gün olarak doğrular ve 366 günlük pencereyi doğrulanmış bu tarihe
 * göre hesaplar. Daha büyük sapma `invalid_client_date` ile reddedilir.
 */
export async function syncSharedDisciplineDays(
  days: { date: string; status: DisciplineStatus }[],
  clientToday: string,
): Promise<number> {
  // Boş dizi geçerli bir snapshot'tır: paylaşım penceresini temizler.
  // Bu yüzden burada erken dönülmez.
  const { data, error } = await supabase.rpc('sync_shared_discipline_days', {
    client_today: clientToday,
    days,
  });
  if (error) throw error;
  return (data as number | null) ?? 0;
}
