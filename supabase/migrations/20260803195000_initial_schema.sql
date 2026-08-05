begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Sporcu' check (char_length(display_name) between 1 and 40),
  username text unique check (username is null or username ~ '^[a-z0-9_]{3,24}$'),
  bio text not null default '' check (char_length(bio) <= 140),
  avatar_url text,
  training_goal text not null default 'consistency'
    check (training_goal in ('consistency', 'strength', 'muscle', 'fitness')),
  rest_timer_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  visual jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index programs_one_active_per_user_idx
on public.programs (owner_id)
where is_active;

create index programs_owner_id_idx on public.programs (owner_id);

create table public.program_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  visual jsonb,
  scheduled_weekday smallint not null check (scheduled_weekday between 0 and 6),
  is_off_day boolean not null default false,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (program_id, scheduled_weekday)
);

create index program_days_program_id_idx on public.program_days (program_id);

create table public.program_exercises (
  id uuid primary key default gen_random_uuid(),
  program_day_id uuid not null references public.program_days(id) on delete cascade,
  exercise_id text,
  custom_exercise_name text check (
    custom_exercise_name is null or char_length(custom_exercise_name) between 1 and 100
  ),
  visual jsonb,
  target_sets smallint not null check (target_sets between 1 and 20),
  target_reps text not null check (char_length(target_reps) between 1 and 30),
  rest_seconds integer not null default 60 check (rest_seconds between 0 and 3600),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (exercise_id is not null or custom_exercise_name is not null)
);

create index program_exercises_day_id_idx on public.program_exercises (program_day_id);

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid references public.programs(id) on delete set null,
  program_day_id uuid references public.program_days(id) on delete set null,
  workout_date date not null default current_date,
  status text not null default 'running' check (status in ('running', 'paused', 'completed', 'cancelled')),
  started_at timestamptz not null default timezone('utc', now()),
  last_resumed_at timestamptz,
  completed_at timestamptz,
  accumulated_duration_seconds integer not null default 0 check (accumulated_duration_seconds >= 0),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index workout_sessions_user_date_idx
on public.workout_sessions (user_id, workout_date desc);

create index workout_sessions_program_day_idx
on public.workout_sessions (program_id, program_day_id, workout_date desc);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  program_exercise_id uuid references public.program_exercises(id) on delete set null,
  exercise_name text not null check (char_length(exercise_name) between 1 and 100),
  set_number smallint not null check (set_number between 1 and 100),
  weight_kg numeric(7,2) check (weight_kg is null or weight_kg >= 0),
  repetitions smallint check (repetitions is null or repetitions between 0 and 1000),
  rpe numeric(3,1) check (rpe is null or rpe between 0 and 10),
  completed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (session_id, program_exercise_id, set_number)
);

create index workout_sets_session_id_idx on public.workout_sets (session_id);
create index workout_sets_program_exercise_idx on public.workout_sets (program_exercise_id);

create table public.manual_discipline_statuses (
  user_id uuid not null references auth.users(id) on delete cascade,
  discipline_date date not null,
  status text not null check (status in ('completed', 'partial', 'skipped')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, discipline_date)
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger programs_set_updated_at
before update on public.programs
for each row execute function public.set_updated_at();

create trigger program_days_set_updated_at
before update on public.program_days
for each row execute function public.set_updated_at();

create trigger program_exercises_set_updated_at
before update on public.program_exercises
for each row execute function public.set_updated_at();

create trigger workout_sessions_set_updated_at
before update on public.workout_sessions
for each row execute function public.set_updated_at();

create trigger manual_discipline_statuses_set_updated_at
before update on public.manual_discipline_statuses
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Sporcu'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select
  users.id,
  coalesce(
    nullif(trim(users.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
    'Sporcu'
  )
from auth.users as users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.programs enable row level security;
alter table public.program_days enable row level security;
alter table public.program_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_sets enable row level security;
alter table public.manual_discipline_statuses enable row level security;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "programs_select_own"
on public.programs for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "programs_insert_own"
on public.programs for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "programs_update_own"
on public.programs for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "programs_delete_own"
on public.programs for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy "program_days_select_own"
on public.program_days for select
to authenticated
using (
  exists (
    select 1 from public.programs
    where programs.id = program_days.program_id
      and programs.owner_id = (select auth.uid())
  )
);

create policy "program_days_insert_own"
on public.program_days for insert
to authenticated
with check (
  exists (
    select 1 from public.programs
    where programs.id = program_days.program_id
      and programs.owner_id = (select auth.uid())
  )
);

create policy "program_days_update_own"
on public.program_days for update
to authenticated
using (
  exists (
    select 1 from public.programs
    where programs.id = program_days.program_id
      and programs.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.programs
    where programs.id = program_days.program_id
      and programs.owner_id = (select auth.uid())
  )
);

create policy "program_days_delete_own"
on public.program_days for delete
to authenticated
using (
  exists (
    select 1 from public.programs
    where programs.id = program_days.program_id
      and programs.owner_id = (select auth.uid())
  )
);

create policy "program_exercises_select_own"
on public.program_exercises for select
to authenticated
using (
  exists (
    select 1
    from public.program_days
    join public.programs on programs.id = program_days.program_id
    where program_days.id = program_exercises.program_day_id
      and programs.owner_id = (select auth.uid())
  )
);

create policy "program_exercises_insert_own"
on public.program_exercises for insert
to authenticated
with check (
  exists (
    select 1
    from public.program_days
    join public.programs on programs.id = program_days.program_id
    where program_days.id = program_exercises.program_day_id
      and programs.owner_id = (select auth.uid())
  )
);

create policy "program_exercises_update_own"
on public.program_exercises for update
to authenticated
using (
  exists (
    select 1
    from public.program_days
    join public.programs on programs.id = program_days.program_id
    where program_days.id = program_exercises.program_day_id
      and programs.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.program_days
    join public.programs on programs.id = program_days.program_id
    where program_days.id = program_exercises.program_day_id
      and programs.owner_id = (select auth.uid())
  )
);

create policy "program_exercises_delete_own"
on public.program_exercises for delete
to authenticated
using (
  exists (
    select 1
    from public.program_days
    join public.programs on programs.id = program_days.program_id
    where program_days.id = program_exercises.program_day_id
      and programs.owner_id = (select auth.uid())
  )
);

create policy "workout_sessions_select_own"
on public.workout_sessions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "workout_sessions_insert_own"
on public.workout_sessions for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "workout_sessions_update_own"
on public.workout_sessions for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "workout_sessions_delete_own"
on public.workout_sessions for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "workout_sets_select_own"
on public.workout_sets for select
to authenticated
using (
  exists (
    select 1 from public.workout_sessions
    where workout_sessions.id = workout_sets.session_id
      and workout_sessions.user_id = (select auth.uid())
  )
);

create policy "workout_sets_insert_own"
on public.workout_sets for insert
to authenticated
with check (
  exists (
    select 1 from public.workout_sessions
    where workout_sessions.id = workout_sets.session_id
      and workout_sessions.user_id = (select auth.uid())
  )
);

create policy "workout_sets_update_own"
on public.workout_sets for update
to authenticated
using (
  exists (
    select 1 from public.workout_sessions
    where workout_sessions.id = workout_sets.session_id
      and workout_sessions.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workout_sessions
    where workout_sessions.id = workout_sets.session_id
      and workout_sessions.user_id = (select auth.uid())
  )
);

create policy "workout_sets_delete_own"
on public.workout_sets for delete
to authenticated
using (
  exists (
    select 1 from public.workout_sessions
    where workout_sessions.id = workout_sets.session_id
      and workout_sessions.user_id = (select auth.uid())
  )
);

create policy "discipline_statuses_select_own"
on public.manual_discipline_statuses for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "discipline_statuses_insert_own"
on public.manual_discipline_statuses for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "discipline_statuses_update_own"
on public.manual_discipline_statuses for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "discipline_statuses_delete_own"
on public.manual_discipline_statuses for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.profiles from anon;
revoke all on table public.programs from anon;
revoke all on table public.program_days from anon;
revoke all on table public.program_exercises from anon;
revoke all on table public.workout_sessions from anon;
revoke all on table public.workout_sets from anon;
revoke all on table public.manual_discipline_statuses from anon;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.programs to authenticated;
grant select, insert, update, delete on table public.program_days to authenticated;
grant select, insert, update, delete on table public.program_exercises to authenticated;
grant select, insert, update, delete on table public.workout_sessions to authenticated;
grant select, insert, update, delete on table public.workout_sets to authenticated;
grant select, insert, update, delete on table public.manual_discipline_statuses to authenticated;

commit;
