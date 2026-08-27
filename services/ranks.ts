import {
  FriendRankLeaderboardRow,
  parseFriendRankLeaderboard,
  parseRankEventKind,
  RANK_EVENT_LIMIT,
  resolveRankEventLabel,
} from '@/constants/rank-experience';
import { RankId, RANK_IDS } from '@/constants/ranks';
import { supabase } from '@/lib/supabase';
import {
  FriendRankLeaderboard,
  FriendRankSummary,
  RankEvent,
  RankSeasonArchive,
  RankSeasonSummary,
  RankWeekFocus,
} from '@/types/ranks';

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
 * `rank_events` satırının SEÇİLEN alanları.
 *
 * `day_state`, PostgREST'in `metadata->>state` yansımasıdır: JSON'un tamamı
 * çekilmez, yalnızca planlı günün kısmi/tam bilgisi gelir. Diğer türlerde bu
 * alan `null` döner ve genel etiket kullanılır.
 */
type RankEventRow = {
  id: string;
  event_type: string;
  rp_delta: number;
  awarded_for_date: string | null;
  created_at: string;
  day_state: string | null;
};

type RankWeekFocusRow = {
  week_starts_on: string;
  week_ends_on: string;
  day_date: string;
  state: string | null;
  is_scheduled_workout: boolean;
  is_verifiable: boolean;
};

/** `timestamptz` → `YYYY-MM-DD`. Ekran tarihi cihazın yerel gününde gösterir. */
function toDateKey(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 10);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

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

/**
 * Kullanıcının KENDİ son RP hareketleri.
 *
 * GÜVENLİK — sorgu `public.rank_events` tablosuna DOĞRUDAN gider ve hiçbir
 * kullanıcı kimliği GÖNDERMEZ. Satır izolasyonunun tek otoritesi
 * `rank_events_select_own` RLS politikasıdır (`auth.uid() = user_id`); istemci
 * tarafında `eq('user_id', …)` gibi ikinci bir filtre YOKTUR, çünkü öyle bir
 * filtre güvenlik sağlamaz ama "istemci kimlik gönderiyor" izlenimi yaratır.
 * Tabloda istemci için insert/update/delete policy'si bulunmadığından bu yol
 * salt okunurdur.
 *
 * Yalnızca ekranda kullanılan alanlar seçilir: `season_index` ve `source_key`
 * hiç çekilmez, metadata'dan da yalnızca planlı günün durumu (`state`) okunur
 * — `desired_rp` / `written_rp` gibi denetim alanları istemciye HİÇ gelmez.
 *
 * Sıralama en yeni kayıt önce (`created_at desc`), en fazla
 * `RANK_EVENT_LIMIT` satır. Polling YOKTUR; çağıran ekran istediğinde çalışır.
 */
export async function fetchMyRankEvents(): Promise<RankEvent[]> {
  const { data, error } = await supabase
    .from('rank_events')
    .select('id, event_type, rp_delta, awarded_for_date, created_at, day_state:metadata->>state')
    .order('created_at', { ascending: false })
    .limit(RANK_EVENT_LIMIT);

  if (error) throw error;

  const events: RankEvent[] = [];

  for (const row of (data ?? []) as RankEventRow[]) {
    const kind = parseRankEventKind(row.event_type);
    // Sunucu ileride yeni bir tür eklerse eski istemci ham anahtar göstermez:
    // satır sessizce atlanır ve liste çalışmaya devam eder.
    if (!kind) continue;

    events.push({
      dateKey: row.awarded_for_date ?? toDateKey(row.created_at),
      id: row.id,
      kind,
      labelKey: resolveRankEventLabel(kind, row.day_state),
      rpDelta: row.rp_delta,
    });
  }

  return events;
}

/**
 * Güncel yerel haftanın sunucu tarafından doğrulanmış rank odağı.
 *
 * Kullanıcı kimliği veya program bilgisi gönderilmez. RPC aktif kullanıcıyı
 * `auth.uid()` ile belirler ve yalnızca `rank_day_state` kanıtını döndürür.
 */
export async function fetchMyRankWeekFocus(clientToday: string): Promise<RankWeekFocus> {
  const { data, error } = await supabase.rpc('get_my_rank_week_focus', {
    client_today: clientToday,
  });
  if (error) throw error;

  const rows = (data ?? []) as RankWeekFocusRow[];
  if (rows.length !== 7) throw new Error('invalid_rank_week_focus');

  const startsOn = rows[0]?.week_starts_on;
  const endsOn = rows[0]?.week_ends_on;
  if (!startsOn || !endsOn) throw new Error('invalid_rank_week_focus');

  return {
    days: rows.map((row) => ({
      dateKey: row.day_date,
      isScheduledWorkout: row.is_scheduled_workout === true,
      isVerifiable: row.is_verifiable === true,
      state:
        row.state === 'completed' || row.state === 'partial' ? row.state : undefined,
    })),
    endsOn,
    startsOn,
  };
}

/**
 * Arkadaşlar arası sezon sıralaması.
 *
 * GÜVENLİK — RPC'nin PARAMETRESİ YOKTUR. Aktif kullanıcı sunucuda
 * `auth.uid()` ile belirlenir; istemci kullanıcı kimliği, sezon numarası, RP
 * veya rank GÖNDEREMEZ. Kapsam sunucuda aktif kullanıcı ile
 * `friendships.status = 'accepted'` karşı taraflarıyla sınırlıdır; bekleyen
 * istekler ve arkadaş olmayanlar hiç dönmez. Global leaderboard YOKTUR.
 *
 * Sıralama ve sıra numaraları sunucudan geldiği gibi korunur — bu katman
 * yalnızca satırları güvenle daraltır. Bilinmeyen bir rank kimliği ekranı
 * çökertmez, bozuk satır sessizce düşer ve güncel sezonda rank satırı olmayan
 * arkadaş Bronze/0'a ZORLANMAZ.
 */
export async function fetchFriendsRankLeaderboard(): Promise<FriendRankLeaderboard> {
  const { data, error } = await supabase.rpc('get_friends_rank_leaderboard');
  if (error) throw error;

  return parseFriendRankLeaderboard<RankId>(data as FriendRankLeaderboardRow[] | null, {
    fallbackRank: 'bronze',
    order: RANK_IDS,
  });
}
