/**
 * SÜRÜMLÜ RANK VERİ SÖZLEŞMESİ — v2 (emerald / diamond)
 *
 * SORUN
 * -----
 * 5. ve 6. kademenin KİMLİĞİ değişti (görsel/UI): eski 'diamond' (taban 1050)
 * artık 'emerald', eski 'master' (taban 1350) artık 'diamond'. Ama aynı '`diamond`'
 * metni eski ve yeni sistemde FARKLI kademeleri ifade eder. Paylaşılan SQL
 * yardımcılarını (`rank_for_rp`, `rank_tier_floor`, …) yerinde değiştirmek, hâlâ
 * ESKİ istemci sürümünü kullanan mobil kullanıcılara giden v1 RPC çıktısını
 * DOLAYLI olarak bozardı (onlarda 'emerald'/'diamond' yanlış kademe veya Bronze
 * olurdu). Mobilde sunucu ve istemci aynı anda güncellenmez.
 *
 * ÇÖZÜM — AÇIK SÜRÜMLEME
 * ----------------------
 * Bu migration hiçbir tarihsel nesneyi DEĞİŞTİRMEZ:
 *   * Paylaşılan yardımcılar (`rank_for_rp`, `rank_tier_floor`,
 *     `rank_reset_base`, `rank_reset_max`, `rank_soft_reset_rp`) OLDUĞU GİBİ
 *     kalır ve ESKİ kademe anlamlarını (diamond@1050, master@1350) üretmeye
 *     devam eder.
 *   * Mevcut v1 RPC'ler (`sync_my_rank`, `get_my_rank_history`,
 *     `get_friend_rank`, `get_friends_rank_leaderboard`) DEĞİŞMEZ → ESKİ
 *     istemciler kesintisiz eski anlamları alır.
 *   * Saklı `user_season_ranks.final_rank` metni yeniden yazılmaz → arşiv RP'si
 *     ve sonucu değişmez.
 *
 * Yalnızca EKLENİR:
 *   * `rank_to_v2(text)` — v1 kademe kimliğini v2'ye çeviren SAF eşleme.
 *   * `*_v2` RPC'ler — v1 mantığını AYNEN çağırır (tek kaynak, kopya yok) ve
 *     yalnızca ÇIKTIDAKİ rank kimliklerini v2'ye çevirir. YENİ istemci yalnız
 *     bu sürümlü sözleşmeyi çağırır.
 *
 * Böylece:
 *   eski sunucu + yeni istemci → yeni istemci v2'yi çağırır, sunucuda yoksa RPC
 *     hatası döner (istemci sahte Bronze üretmez; hata/yeniden-dene akışı).
 *   yeni sunucu + eski istemci → eski istemci v1'i çağırır, eski anlamlar korunur.
 *   yeni sunucu + yeni istemci → v2 çağrılır, Emerald@1050 / Diamond@1350.
 *
 * GÜVENLİK — v2 RPC'ler v1 ile AYNI güvenlik modelini miras alır: `auth.uid()`
 * ile sahiplik, `security definer` + `set search_path = ''`, `are_friends`
 * koruması ve advisory lock hepsi çağrılan v1 fonksiyonunun içinde çalışır.
 * Yardımcı `public`/`anon`/`authenticated`'a kapalıdır; v2 RPC'lerine yalnızca
 * `authenticated` EXECUTE alır.
 */

begin;

-- ---------------------------------------------------------------------------
-- 1) v1 → v2 kademe kimliği eşlemesi (SAF)
-- ---------------------------------------------------------------------------
--
-- Bu, istemcideki "kör string alias"tan FARKLIDIR: eşleme SÜRÜMLÜ RPC'nin
-- İÇİNDE, kimliğin v1 anlamı KESİN bilinirken uygulanır. v2 RPC'nin döndürdüğü
-- 'diamond' her zaman 1350 kademesidir; v1'in döndürdüğü 'diamond' 1050'dir.
create or replace function public.rank_to_v2(rank_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case rank_id
    when 'diamond' then 'emerald'  -- eski 5. kademe (taban 1050)
    when 'master' then 'diamond'   -- eski 6. kademe (taban 1350)
    else rank_id                   -- bronze/silver/gold/platinum/rosea aynı
  end;
$$;

revoke all on function public.rank_to_v2(text) from public;
revoke all on function public.rank_to_v2(text) from anon;
revoke all on function public.rank_to_v2(text) from authenticated;

do $$
begin
  -- Değişmeyen kademeler kimliklerini korur.
  assert public.rank_to_v2('bronze') = 'bronze', 'bronze değişmemeli';
  assert public.rank_to_v2('silver') = 'silver', 'silver değişmemeli';
  assert public.rank_to_v2('gold') = 'gold', 'gold değişmemeli';
  assert public.rank_to_v2('platinum') = 'platinum', 'platinum değişmemeli';
  assert public.rank_to_v2('rosea') = 'rosea', 'rosea değişmemeli';
  -- Yeniden adlandırılan iki kademe.
  assert public.rank_to_v2('diamond') = 'emerald', 'eski diamond → emerald';
  assert public.rank_to_v2('master') = 'diamond', 'eski master → diamond';

  -- SÖZLEŞME ZİNCİRİ — v1 rank_for_rp (DEĞİŞMEDİ) + rank_to_v2 = v2 kimliği.
  -- Sayısal eşikler korunur; yalnızca kimlik yeniden adlandırılır.
  assert public.rank_to_v2(public.rank_for_rp(1049)) = 'platinum', 'platinum sınırı korunmalı';
  assert public.rank_to_v2(public.rank_for_rp(1050)) = 'emerald', '1050 → Emerald (v2)';
  assert public.rank_to_v2(public.rank_for_rp(1349)) = 'emerald', 'emerald sınırı';
  assert public.rank_to_v2(public.rank_for_rp(1350)) = 'diamond', '1350 → Diamond (v2)';
  assert public.rank_to_v2(public.rank_for_rp(1649)) = 'diamond', 'diamond sınırı';
  assert public.rank_to_v2(public.rank_for_rp(1650)) = 'rosea', '1650 → Rosea';
  assert public.rank_to_v2(public.rank_for_rp(0)) = 'bronze', 'taban Bronze';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) v2 RPC'ler — v1'i AYNEN çağırır, yalnız çıktı kimliğini çevirir
-- ---------------------------------------------------------------------------

/**
 * `sync_my_rank` v2. İç `sync_my_rank` bütün yazma/uzlaştırma/advisory-lock ve
 * `assert_client_today` mantığını çalıştırır; buradaki tek fark current/peak
 * rank kimliklerinin v2'ye çevrilmesidir. (VOLATILE — v1 yazma yapar.)
 */
create or replace function public.sync_my_rank_v2(client_today date)
returns table (
  season_index integer,
  starts_on date,
  ends_on date,
  theme_name text,
  starting_rp integer,
  current_rp integer,
  peak_rp integer,
  current_rank text,
  peak_rank text,
  workouts_completed integer,
  scheduled_days_total integer,
  scheduled_days_completed integer,
  longest_streak integer
)
language sql
security definer
set search_path = ''
as $$
  select
    s.season_index,
    s.starts_on,
    s.ends_on,
    s.theme_name,
    s.starting_rp,
    s.current_rp,
    s.peak_rp,
    public.rank_to_v2(s.current_rank),
    public.rank_to_v2(s.peak_rank),
    s.workouts_completed,
    s.scheduled_days_total,
    s.scheduled_days_completed,
    s.longest_streak
  from public.sync_my_rank(client_today) as s;
$$;

revoke all on function public.sync_my_rank_v2(date) from public;
revoke all on function public.sync_my_rank_v2(date) from anon;
grant execute on function public.sync_my_rank_v2(date) to authenticated;

/** `get_my_rank_history` v2 — final/peak rank kimlikleri v2'ye çevrilir. */
create or replace function public.get_my_rank_history_v2()
returns table (
  season_index integer,
  starts_on date,
  ends_on date,
  theme_name text,
  final_rp integer,
  final_rank text,
  peak_rank text,
  workouts_completed integer,
  scheduled_days_total integer,
  scheduled_days_completed integer,
  longest_streak integer
)
language sql
security definer
set search_path = ''
as $$
  select
    h.season_index,
    h.starts_on,
    h.ends_on,
    h.theme_name,
    h.final_rp,
    public.rank_to_v2(h.final_rank),
    public.rank_to_v2(h.peak_rank),
    h.workouts_completed,
    h.scheduled_days_total,
    h.scheduled_days_completed,
    h.longest_streak
  from public.get_my_rank_history() as h;
$$;

revoke all on function public.get_my_rank_history_v2() from public;
revoke all on function public.get_my_rank_history_v2() from anon;
grant execute on function public.get_my_rank_history_v2() to authenticated;

/** `get_friend_rank` v2 — `are_friends` koruması iç fonksiyonda korunur. */
create or replace function public.get_friend_rank_v2(target_user_id uuid)
returns table (
  season_index integer,
  current_rp integer,
  current_rank text,
  peak_rank text
)
language sql
security definer
set search_path = ''
as $$
  select
    f.season_index,
    f.current_rp,
    public.rank_to_v2(f.current_rank),
    public.rank_to_v2(f.peak_rank)
  from public.get_friend_rank(target_user_id) as f;
$$;

revoke all on function public.get_friend_rank_v2(uuid) from public;
revoke all on function public.get_friend_rank_v2(uuid) from anon;
grant execute on function public.get_friend_rank_v2(uuid) to authenticated;

/** `get_friends_rank_leaderboard` v2 — yalnız `current_rank` v2'ye çevrilir. */
create or replace function public.get_friends_rank_leaderboard_v2()
returns table (
  participant_id uuid,
  display_name text,
  username text,
  avatar_url text,
  season_index integer,
  current_rp integer,
  current_rank text,
  rank_position integer,
  is_self boolean,
  is_ranked boolean,
  participant_count integer
)
language sql
security definer
set search_path = ''
as $$
  select
    l.participant_id,
    l.display_name,
    l.username,
    l.avatar_url,
    l.season_index,
    l.current_rp,
    -- Sıralanmamış satırda current_rank NULL'dır; rank_to_v2(NULL) = NULL.
    public.rank_to_v2(l.current_rank),
    l.rank_position,
    l.is_self,
    l.is_ranked,
    l.participant_count
  from public.get_friends_rank_leaderboard() as l;
$$;

revoke all on function public.get_friends_rank_leaderboard_v2() from public;
revoke all on function public.get_friends_rank_leaderboard_v2() from anon;
grant execute on function public.get_friends_rank_leaderboard_v2() to authenticated;

commit;
