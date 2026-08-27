import { RankId, RANK_IDS } from '@/constants/ranks';
import { supabase } from '@/lib/supabase';
import { FriendRankSummary, RankSeasonArchive, RankSeasonSummary } from '@/types/ranks';

/**
 * Sezonluk rank servis katmanı. Bütün Supabase çağrıları burada toplanır;
 * ekranlar ve context'ler doğrudan `supabase` istemcisine dokunmaz.
 *
 * **Hiçbir çağrı RP, rank, starting/final RP veya reset miktarı göndermez.**
 * `sync_my_rank`'in tek parametresi istemcinin yerel günüdür ve sunucu onu
 * ±1 güne kilitler. Toplamlara doğrudan yazma yolu YOKTUR: rank tablolarında
 * istemci için insert/update/delete policy'si bulunmaz.
 */

type SeasonRow = {
  season_index: number;
  starts_on: string;
  ends_on: string;
  theme_name: string | null;
  starting_rp: number;
  current_rp: number;
  peak_rp: number;
  current_rank: string;
  peak_rank: string;
  workouts_completed: number;
  scheduled_days_total: number;
  scheduled_days_completed: number;
  longest_streak: number;
};

type HistoryRow = {
  season_index: number;
  starts_on: string;
  ends_on: string;
  theme_name: string | null;
  final_rp: number;
  final_rank: string;
  peak_rank: string;
  workouts_completed: number;
  scheduled_days_total: number;
  scheduled_days_completed: number;
  longest_streak: number;
};

type FriendRankRow = {
  season_index: number;
  current_rp: number;
  current_rank: string;
  peak_rank: string;
};

/**
 * Sunucudan gelen rank kimliğini güvenle daraltır.
 *
 * Sunucu ileride yeni bir tier eklerse eski istemci çökmez; bilinmeyen kimlik
 * en düşük ranka düşer ve ekran çalışmaya devam eder.
 */
function parseRankId(value: unknown): RankId {
  return RANK_IDS.includes(value as RankId) ? (value as RankId) : 'bronze';
}

function toOptional(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** RPC'ler `returns table` olduğu için tek satırlık dizi döner. */
function firstRow<T>(data: unknown): T | undefined {
  return ((data ?? []) as T[])[0];
}

function toSummary(row: SeasonRow): RankSeasonSummary {
  return {
    currentRank: parseRankId(row.current_rank),
    currentRp: row.current_rp,
    endsOn: row.ends_on,
    longestStreak: row.longest_streak,
    peakRank: parseRankId(row.peak_rank),
    peakRp: row.peak_rp,
    scheduledDaysCompleted: row.scheduled_days_completed,
    scheduledDaysTotal: row.scheduled_days_total,
    seasonIndex: row.season_index,
    startingRp: row.starting_rp,
    startsOn: row.starts_on,
    themeName: toOptional(row.theme_name),
    workoutsCompleted: row.workouts_completed,
  };
}

/**
 * Rank senkronizasyonu: sezon geçişleri + güncel sezonun uzlaştırılması.
 *
 * Tekrar çağrılması güvenlidir — sunucu defteri idempotenttir, aynı olay
 * ikinci kez RP üretmez. Ağ hatası antrenman akışını engellemez; çağıran
 * sonraki güvenli sync'te yeniden dener.
 */
export async function syncMyRank(clientToday: string): Promise<RankSeasonSummary | undefined> {
  const { data, error } = await supabase.rpc('sync_my_rank', { client_today: clientToday });
  if (error) throw error;
  const row = firstRow<SeasonRow>(data);
  return row ? toSummary(row) : undefined;
}

/** Kapanmış sezon arşivim. Salt okunur; sunucuda hiçbir şeyi değiştirmez. */
export async function fetchMyRankHistory(): Promise<RankSeasonArchive[]> {
  const { data, error } = await supabase.rpc('get_my_rank_history');
  if (error) throw error;

  return ((data ?? []) as HistoryRow[]).map((row) => ({
    endsOn: row.ends_on,
    finalRank: parseRankId(row.final_rank),
    finalRp: row.final_rp,
    longestStreak: row.longest_streak,
    peakRank: parseRankId(row.peak_rank),
    scheduledDaysCompleted: row.scheduled_days_completed,
    scheduledDaysTotal: row.scheduled_days_total,
    seasonIndex: row.season_index,
    startsOn: row.starts_on,
    themeName: toOptional(row.theme_name),
    workoutsCompleted: row.workouts_completed,
  }));
}

/**
 * Arkadaşın rank özeti.
 *
 * Arkadaş DEĞİLSE RPC hiç satır döndürmez ve burası `undefined` verir; ekran
 * rozeti hiç çizmez. Gül bakiyesi ve ham event geçmişi bu yoldan HİÇ gelmez.
 */
export async function fetchFriendRank(targetUserId: string): Promise<FriendRankSummary | undefined> {
  const { data, error } = await supabase.rpc('get_friend_rank', {
    target_user_id: targetUserId,
  });
  if (error) throw error;

  const row = firstRow<FriendRankRow>(data);
  if (!row) return undefined;

  return {
    currentRank: parseRankId(row.current_rank),
    currentRp: row.current_rp,
    peakRank: parseRankId(row.peak_rank),
    seasonIndex: row.season_index,
  };
}
