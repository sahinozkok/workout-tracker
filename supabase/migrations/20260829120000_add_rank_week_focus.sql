begin;

/**
 * Rank ekranındaki "bu haftaki odak" kartı için salt okunur görünüm.
 *
 * İstemci yalnızca yerel gününü gönderir. Kullanıcı kimliği auth.uid() ile
 * belirlenir ve tarih mevcut assert_client_today korumasından geçer.
 * Gün durumları yeniden hesaplanmaz: rank sisteminin tek kanıt kaynağı olan
 * rank_day_state kullanılır. Bu nedenle elle işaretlenen takvim durumu, silinen
 * antrenman veya başka bir kullanıcının verisi bu yanıta karışamaz.
 */
create or replace function public.get_my_rank_week_focus(client_today date)
returns table (
  week_starts_on date,
  week_ends_on date,
  day_date date,
  state text,
  is_scheduled_workout boolean,
  is_verifiable boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  week_start date;
  week_end date;
begin
  if actor is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  perform public.assert_client_today(client_today);

  week_start := client_today - (extract(isodow from client_today)::integer - 1);
  week_end := week_start + 6;

  return query
  select
    week_start,
    week_end,
    d.day_date,
    d.state,
    d.is_scheduled_workout,
    d.is_verifiable
  from public.rank_day_state(actor, week_start, week_end) as d
  order by d.day_date;
end;
$$;

revoke all on function public.get_my_rank_week_focus(date) from public;
revoke all on function public.get_my_rank_week_focus(date) from anon;
revoke all on function public.get_my_rank_week_focus(date) from authenticated;
grant execute on function public.get_my_rank_week_focus(date) to authenticated;

comment on function public.get_my_rank_week_focus(date) is
  'Returns the authenticated user current local week rank focus using server-verified rank_day_state evidence.';

commit;
