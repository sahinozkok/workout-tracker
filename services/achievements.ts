import { ACHIEVEMENT_CATALOG, AchievementCategory, isAchievementKey } from '@/constants/achievements';
import { supabase } from '@/lib/supabase';
import {
  AchievementShowcaseSelection,
  CareerAchievement,
  FriendAchievementShowcaseEntry,
} from '@/types/achievements';

/**
 * Kariyer başarımları servis katmanı. Bütün Supabase çağrıları burada toplanır.
 * Sunucu 30 satırı SABİT sırada döner; istemci sırayı KATALOGA göre garanti eder
 * ve bilinmeyen/eksik anahtarları güvenle eler (sahte satır üretmez).
 *
 * İstemci ilerleme/sayaç/user_id GÖNDERMEZ — yalnız `clientToday` (sunucu ±1
 * güne kilitler). Eski sezon RPC'leri (`sync_my_season_achievements` vb.)
 * DEĞİŞTİRİLMEZ; yeni ekran yalnız bu kalıcı RPC'leri kullanır.
 */

type SyncRow = {
  achievement_key: string;
  category: string;
  is_unlocked: boolean;
  unlocked_at: string | null;
  current_progress: number;
  target_progress: number;
};

function toOptional(value: string | null | undefined) {
  return value ?? undefined;
}

const CATEGORY_BY_KEY = new Map(ACHIEVEMENT_CATALOG.map((e) => [e.key, e.category]));
const SORT_BY_KEY = new Map(ACHIEVEMENT_CATALOG.map((e) => [e.key, e.sort]));

/**
 * Kariyer başarımlarını uzlaştırır ve 30 satırı KATALOG SIRASINDA döner. Sunucu
 * satırları güvenle daraltılır: bilinmeyen anahtar atlanır, kategori sunucudan
 * gelmezse katalogdan tamamlanır, ilerleme/hedef sayı değilse 0'a düşülür.
 */
export async function syncMyAchievements(clientToday: string): Promise<CareerAchievement[]> {
  const { data, error } = await supabase.rpc('sync_my_achievements', { client_today: clientToday });
  if (error) throw error;

  const rows = ((data ?? []) as SyncRow[])
    .filter((row) => isAchievementKey(row.achievement_key))
    .map((row): CareerAchievement => {
      const key = row.achievement_key as CareerAchievement['key'];
      const category = (
        row.category === 'easy' || row.category === 'medium' || row.category === 'hard'
          ? row.category
          : CATEGORY_BY_KEY.get(key)
      ) as AchievementCategory;
      return {
        category,
        currentProgress: Number.isFinite(row.current_progress) ? Math.max(0, row.current_progress) : 0,
        isUnlocked: row.is_unlocked === true,
        key,
        targetProgress: Number.isFinite(row.target_progress) ? row.target_progress : 0,
        unlockedAt: toOptional(row.unlocked_at),
      };
    });

  // Sunucu zaten sıralı döndürür; istemci yine de katalog sırasını GARANTİLER
  // ve eksik anahtar gelirse (beklenmez) bunu tespit edilebilir bırakır.
  return rows.sort((a, b) => (SORT_BY_KEY.get(a.key) ?? 0) - (SORT_BY_KEY.get(b.key) ?? 0));
}

type ShowcaseRow = { is_custom: boolean; slot_position: number | null; achievement_key: string | null };

function parseShowcaseSelection(data: unknown): AchievementShowcaseSelection {
  const rows = (data ?? []) as ShowcaseRow[];
  return rows
    .filter((r) => r.achievement_key !== null && isAchievementKey(r.achievement_key))
    .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))
    .map((r) => r.achievement_key as AchievementShowcaseSelection[number]);
}

/** Kendi vitrin seçimi (boş = otomatik mod). */
export async function fetchMyAchievementShowcase(): Promise<AchievementShowcaseSelection> {
  const { data, error } = await supabase.rpc('get_my_achievement_showcase');
  if (error) throw error;
  return parseShowcaseSelection(data);
}

/** Vitrin seçimini kaydeder (boş dizi = otomatik). Doğrulama SUNUCUDA. */
export async function saveMyAchievementShowcase(
  keys: AchievementShowcaseSelection,
): Promise<AchievementShowcaseSelection> {
  const { data, error } = await supabase.rpc('set_my_achievement_showcase', { achievement_keys: keys });
  if (error) throw error;
  return parseShowcaseSelection(data);
}

type FriendShowcaseRow = { achievement_key: string; unlocked_at: string | null };

/**
 * Arkadaşın vitrini — `are_friends` kapılı (sunucu). Arkadaş değil/erişim yok →
 * boş dizi. Yalnız seçili+açık başarımlar; ilerleme/özel veri HİÇ gelmez.
 */
export async function fetchFriendAchievementShowcase(
  targetUserId: string,
): Promise<FriendAchievementShowcaseEntry[]> {
  const { data, error } = await supabase.rpc('get_friend_achievement_showcase', {
    target_user_id: targetUserId,
  });
  if (error) throw error;
  return ((data ?? []) as FriendShowcaseRow[])
    .filter((r) => isAchievementKey(r.achievement_key))
    .map((r) => ({ key: r.achievement_key as FriendAchievementShowcaseEntry['key'], unlockedAt: toOptional(r.unlocked_at) }));
}
