begin;

create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in ('weekly_summary', 'exercise_progress')),
  provider text not null default 'gemini' check (provider in ('gemini')),
  model text not null,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index ai_requests_user_created_idx
on public.ai_requests (user_id, created_at desc);

alter table public.ai_requests enable row level security;

create policy "ai_requests_select_own"
on public.ai_requests for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "ai_requests_insert_own"
on public.ai_requests for insert
to authenticated
with check ((select auth.uid()) = user_id);

revoke all on table public.ai_requests from anon;
grant select, insert on table public.ai_requests to authenticated;

commit;
