begin;

-- Gemini kullanmayan haftalık ve egzersiz özetlerinin kötüye kullanımını
-- sınırlamak için yalnızca Edge Function tarafından yazılan kullanım günlüğü.
create table public.summary_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('weekly_summary', 'exercise_progress')),
  created_at timestamptz not null default timezone('utc', now())
);

create index summary_requests_user_created_idx
on public.summary_requests (user_id, created_at desc);

-- Gerçek model çağrıları için ayrı, kullanıcı eylemi bazlı kota günlüğü.
-- request_key aynı sohbet mesajının ağ hatası sonrası tekrar denenmesini çift
-- saymaz; farklı mesajlarla paralel istek atılması ise atomik olarak sınırlanır.
create table public.ai_quota_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  feature text not null check (feature in ('chat')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, request_key)
);

create index ai_quota_events_user_created_idx
on public.ai_quota_events (user_id, created_at desc);

alter table public.summary_requests enable row level security;
alter table public.ai_quota_events enable row level security;

-- Kullanım sayacı istemciden değiştirilemez ve okunamaz. Edge Function'ın
-- service_role istemcisi RLS'i atlayarak aşağıdaki RPC'yi çağırır.
revoke all on table public.summary_requests from anon, authenticated;
revoke all on table public.ai_quota_events from anon, authenticated;

create or replace function public.consume_ai_quota(
  requested_user_id uuid,
  requested_key uuid,
  requested_feature text,
  requested_limit integer default 15
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  if requested_feature <> 'chat' then
    raise exception 'unsupported ai feature';
  end if;

  if requested_limit < 1 or requested_limit > 100 then
    raise exception 'invalid ai limit';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_user_id::text, 1));

  if exists (
    select 1
    from public.ai_quota_events
    where user_id = requested_user_id and request_key = requested_key
  ) then
    return true;
  end if;

  select count(*) into recent_count
  from public.ai_quota_events
  where user_id = requested_user_id
    and created_at >= timezone('utc', now()) - interval '24 hours';

  if recent_count >= requested_limit then
    return false;
  end if;

  insert into public.ai_quota_events (user_id, request_key, feature)
  values (requested_user_id, requested_key, requested_feature);

  return true;
end;
$$;

revoke all on function public.consume_ai_quota(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, uuid, text, integer) to service_role;

-- Aynı kullanıcıdan gelen eşzamanlı istekleri advisory lock ile sıraya alır;
-- böylece count + insert arasında yarış oluşup günlük sınır aşılamaz.
create or replace function public.consume_summary_quota(
  requested_user_id uuid,
  requested_feature text,
  requested_limit integer default 20
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  if requested_feature not in ('weekly_summary', 'exercise_progress') then
    raise exception 'unsupported summary feature';
  end if;

  if requested_limit < 1 or requested_limit > 100 then
    raise exception 'invalid summary limit';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(requested_user_id::text, 0)
  );

  select count(*) into recent_count
  from public.summary_requests
  where user_id = requested_user_id
    and created_at >= timezone('utc', now()) - interval '24 hours';

  if recent_count >= requested_limit then
    return false;
  end if;

  insert into public.summary_requests (user_id, feature)
  values (requested_user_id, requested_feature);

  return true;
end;
$$;

revoke all on function public.consume_summary_quota(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_summary_quota(uuid, text, integer) to service_role;

commit;
