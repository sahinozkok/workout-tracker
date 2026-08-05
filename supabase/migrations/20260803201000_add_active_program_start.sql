begin;

alter table public.programs
add column active_from date;

update public.programs
set active_from = current_date
where is_active and active_from is null;

alter table public.programs
add constraint programs_active_from_required
check (not is_active or active_from is not null);

create or replace function public.activate_program(target_program_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.programs
    where id = target_program_id
      and owner_id = (select auth.uid())
  ) then
    raise exception 'Program bulunamadı veya kullanıcıya ait değil.';
  end if;

  update public.programs
  set is_active = false,
      active_from = null
  where owner_id = (select auth.uid())
    and is_active;

  update public.programs
  set is_active = true,
      active_from = current_date
  where id = target_program_id
    and owner_id = (select auth.uid());
end;
$$;

revoke all on function public.activate_program(uuid) from public;
revoke all on function public.activate_program(uuid) from anon;
grant execute on function public.activate_program(uuid) to authenticated;

commit;
