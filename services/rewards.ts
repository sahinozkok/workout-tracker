import { supabase } from '@/lib/supabase';
import { DailyClaimResult, RewardResult, UserProgress } from '@/types/rewards';

/**
 * Seviye/XP/gül servis katmanı. Bütün Supabase çağrıları burada toplanır;
 * ekranlar ve context'ler doğrudan `supabase` istemcisine dokunmaz.
 *
 * **Hiçbir çağrı XP, gül, seviye, streak veya off-day sayısı göndermez.**
 * İstemci yalnızca "hangi olay" ve "hangi gün" bilgisini iletir; tutarı
 * sunucu kendi verisinden hesaplar. Toplamlara doğrudan yazma yolu yoktur:
 * `user_progress` tablosunda istemci için insert/update policy'si bulunmaz.
 */

type ProgressRow = {
  level: number;
  lifetime_xp: number;
  rose_balance: number;
  xp_for_next: number;
  xp_into_level: number;
};

type RewardRow = ProgressRow & {
  awarded_roses: number;
  awarded_xp: number;
};

type DailyClaimRow = RewardRow & {
  reconciliation_pending: boolean | null;
};

function toProgress(row: ProgressRow): UserProgress {
  return {
    level: row.level,
    lifetimeXp: row.lifetime_xp,
    roseBalance: row.rose_balance,
    xpForNextLevel: row.xp_for_next,
    xpIntoLevel: row.xp_into_level,
  };
}

function toReward(row: RewardRow): RewardResult {
  return {
    ...toProgress(row),
    awardedRoses: row.awarded_roses,
    awardedXp: row.awarded_xp,
  };
}

/** RPC'ler `returns table` olduğu için tek satırlık dizi döner. */
function firstRow<T>(data: unknown): T | undefined {
  return ((data ?? []) as T[])[0];
}

export async function fetchMyProgress(): Promise<UserProgress | undefined> {
  const { data, error } = await supabase.rpc('get_my_progress');
  if (error) throw error;
  const row = firstRow<ProgressRow>(data);
  return row ? toProgress(row) : undefined;
}

/**
 * Antrenman kaynaklı bütün ödülleri tek sunucu transaction'ında uzlaştırır:
 * tamamlanan setler + gün/off-day temel ödülü + streak bonusu. Son set için
 * üç ayrı yarışan istek oluşmaz.
 */
export async function syncWorkoutRewards(
  clientToday: string,
  targetDate: string,
): Promise<RewardResult | undefined> {
  const { data, error } = await supabase.rpc('sync_workout_rewards', {
    client_today: clientToday,
    target_date: targetDate,
  });
  if (error) throw error;
  const row = firstRow<RewardRow>(data);
  return row ? toReward(row) : undefined;
}

/**
 * Günlük giriş ödülü + kaçırılmış gün uzlaştırması + kapanmış hafta ödülleri.
 *
 * `reconciliationPending` true dönerse sunucuda hâlâ işlenmemiş geçmiş vardır;
 * çağıranın o günü tamamlanmış saymaması gerekir (bkz. `RewardProvider`).
 */
export async function claimDailyRewards(
  clientToday: string,
): Promise<DailyClaimResult | undefined> {
  const { data, error } = await supabase.rpc('claim_daily_rewards', {
    client_today: clientToday,
  });
  if (error) throw error;
  const row = firstRow<DailyClaimRow>(data);
  if (!row) return undefined;
  return {
    ...toReward(row),
    reconciliationPending: row.reconciliation_pending ?? false,
  };
}

/**
 * Rosea okşama burst'ü: +1 XP / +1 gül. Günlük/haftalık/toplam sınır YOKTUR.
 *
 * `burstKey` aynı burst'ün ağ tekrarında **değişmez**; yeni ve gerçek her burst
 * yeni bir anahtar taşır ve ayrı bir ödüldür.
 */
export async function awardPetLove(burstKey: string): Promise<RewardResult | undefined> {
  const { data, error } = await supabase.rpc('award_pet_love', { burst_key: burstKey });
  if (error) throw error;
  const row = firstRow<RewardRow>(data);
  return row ? toReward(row) : undefined;
}
