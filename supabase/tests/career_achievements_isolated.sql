-- =============================================================================
-- İZOLE DAVRANIŞ TESTİ — kariyer başarımları (sezondan bağımsız, kalıcı)
-- Dosya: supabase/migrations/20260912120000_add_career_achievements.sql
-- =============================================================================
-- Gerçek RPC MANTIĞINI izole PostgreSQL'de ÇALIŞTIRIR. Domain tabloları gerçek
-- kolonlarıyla kurulur; yalnız dış yardımcılar (auth.uid, assert_client_today,
-- rank_peak_streak, rank_day_state, level_for_xp) SÖZLEŞMEYE UYGUN STUB'lardır.
-- Bu bir STUB testidir; TAM RLS/JWT entegrasyonu DEĞİLDİR (o ayrı authz testinde).
--
-- ÇALIŞTIRMA:
--   docker run -d --name lrpg -e POSTGRES_PASSWORD=pw postgres:16-alpine
--   docker cp supabase/tests/career_achievements_isolated.sql lrpg:/tmp/t.sql
--   docker cp supabase/migrations/20260912120000_add_career_achievements.sql lrpg:/tmp/mig.sql
--   docker exec -e PGPASSWORD=pw lrpg psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/t.sql
--   docker rm -f lrpg
\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;

-- --- Domain tabloları (gerçek kolonlar) ---
create table public.profiles(id uuid primary key, color_preset text default 'profileClay');
create table public.programs(id uuid primary key default gen_random_uuid(), owner_id uuid);
create table public.workout_sessions(id uuid primary key default gen_random_uuid(), user_id uuid,
  status text default 'completed', deleted_at timestamptz, workout_date date default current_date);
create table public.workout_sets(id uuid primary key default gen_random_uuid(), session_id uuid,
  exercise_name text, weight_kg numeric(7,2), repetitions smallint, completed_at timestamptz default now());
create table public.workout_activity_records(id uuid primary key default gen_random_uuid(), session_id uuid,
  duration_seconds integer, distance_meters integer);
create table public.friendships(requester_id uuid, receiver_id uuid, status text);
create table public.friend_messages(id uuid primary key default gen_random_uuid(), sender_id uuid);
create table public.ai_coach_messages(id uuid primary key default gen_random_uuid(), user_id uuid, role text, reply_to_message_id uuid);
create table public.user_progress(user_id uuid primary key, lifetime_xp integer default 0, selected_level_rose text);
create table public.user_season_ranks(user_id uuid, season_index integer, peak_rp integer);
create table public.rank_events(user_id uuid, season_index integer, event_type text, source_key text, rp_delta integer);
create table public.rank_settings(rp_epoch date);
insert into public.rank_settings values (date '2026-01-01');
-- AI kota/log tabloları — gerçekçi stub'lar (Blocker 1: workout_analysis feature +
-- UUID request_key). Section 0'ın koşullu ALTER yolları bunlar var olunca çalışır:
-- feature check ('chat') → ('chat','workout_analysis') olarak yeniden kurulur.
create table public.ai_quota_events(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  request_key uuid not null,
  feature text not null check (feature in ('chat')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, request_key)
);
create table public.ai_requests(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  feature text not null check (feature in ('weekly_summary','exercise_progress','chat')),
  model text not null default 'x',
  created_at timestamptz not null default timezone('utc', now())
);

-- --- Stub yardımcılar (sözleşmeye uygun; kontrol edilebilir) ---
create or replace function public.assert_client_today(client_today date) returns void
  language plpgsql as $$ begin return; end; $$;
-- streak: per-user test_streak tablosundan
create table public.test_streak(user_id uuid primary key, value integer);
create or replace function public.rank_peak_streak(u uuid, a date, b date, c date) returns integer
  language sql stable as $$ select coalesce((select value from public.test_streak where user_id=u),0) $$;
-- day_state: per-user test_day_state satırlarından
create table public.test_day_state(user_id uuid, day_date date, state text, is_scheduled_workout boolean);
create or replace function public.rank_day_state(u uuid, f date, t date)
  returns table(day_date date, state text, is_scheduled_workout boolean, is_frozen boolean, is_verifiable boolean)
  language sql stable as $$
    select d.day_date, d.state, d.is_scheduled_workout, false, true
    from public.test_day_state d where d.user_id=u and d.day_date between f and t $$;
-- level_for_xp: stub -> level = lifetime_xp (test lifetime_xp=200 → level 200)
create or replace function public.level_for_xp(x integer) returns integer language sql immutable as $$ select coalesce(x,1) $$;

-- === GERÇEK MIGRATION ===
\i /tmp/mig.sql

-- --- Test kullanıcıları ---
\set U1 '11111111-1111-1111-1111-111111111111'
\set U2 '22222222-2222-2222-2222-222222222222'
insert into auth.users values (:'U1'),(:'U2');
insert into public.profiles(id) values (:'U1'),(:'U2');
insert into public.user_progress(user_id) values (:'U1'),(:'U2');

create or replace function pg_temp.prog(u uuid, k text) returns integer language sql stable as $$
  select current_progress from public.sync_my_achievements(current_date) where achievement_key=k $$;
create or replace function pg_temp.unl(u uuid, k text) returns boolean language sql stable as $$
  select is_unlocked from public.sync_my_achievements(current_date) where achievement_key=k $$;
create or replace function pg_temp.expect_err(sql text, needle text) returns void language plpgsql as $$
begin begin execute sql; raise exception 'BEKLENEN HATA YOK: %',sql;
  exception when others then if position(needle in sqlerrm)=0 then raise exception 'YANLIS HATA: % (beklenen %)',sqlerrm,needle; end if; end; end $$;

do $$
declare U1 uuid := '11111111-1111-1111-1111-111111111111';
        U2 uuid := '22222222-2222-2222-2222-222222222222';
        U3 uuid := '33333333-3333-3333-3333-333333333333';
        FA uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
        FB uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
        FC uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
        n integer; sid uuid; s2 uuid; okb boolean; oc text; rj jsonb; mon date;
        tokA uuid; tokB uuid; tokX uuid;
begin
  -- 0) OTURUMSUZ reddi
  perform set_config('test.uid','',true);
  perform pg_temp.expect_err($q$ select public.sync_my_achievements(current_date) $q$, 'not_authenticated');

  -- 1) Katalog: 30 benzersiz anahtar, sabit sıra, doğru kategori sayıları
  select count(*) into n from public.achievement_catalog(); assert n=30, '30 anahtar';
  select count(distinct achievement_key) into n from public.achievement_catalog(); assert n=30, 'benzersiz';
  select count(*) into n from public.achievement_catalog() where category='easy'; assert n=10,'10 easy';
  select count(*) into n from public.achievement_catalog() where category='medium'; assert n=10,'10 medium';
  select count(*) into n from public.achievement_catalog() where category='hard'; assert n=10,'10 hard';
  -- sabit sıra 1..30
  select count(*) into n from (select sort_order, row_number() over (order by sort_order) rn from public.achievement_catalog()) t where sort_order<>rn; assert n=0,'sort 1..30';

  perform set_config('test.uid', U1::text, true);
  -- Başlangıçta hiçbiri açık değil, sync 30 satır döner
  select count(*) into n from public.sync_my_achievements(current_date); assert n=30, '30 satir doner';
  assert not pg_temp.unl(U1,'first_step'), 'baslangic kilitli';

  -- 2) WORKOUT sınırları 1/5/15/50/100
  for i in 1..5 loop insert into public.workout_sessions(user_id,status) values (U1,'completed'); end loop;
  assert pg_temp.unl(U1,'first_step'), 'first_step@5';
  assert pg_temp.unl(U1,'warmup_done'), 'warmup@5';
  assert not pg_temp.unl(U1,'rhythm_found'), 'rhythm not@5';
  assert pg_temp.prog(U1,'warmup_done')=5, 'warmup prog 5';
  for i in 1..10 loop insert into public.workout_sessions(user_id,status) values (U1,'completed'); end loop; -- 15
  assert pg_temp.unl(U1,'rhythm_found'), 'rhythm@15';
  -- iptal/silinmiş sayılmaz
  insert into public.workout_sessions(user_id,status) values (U1,'cancelled');
  insert into public.workout_sessions(user_id,status,deleted_at) values (U1,'completed',now());
  assert pg_temp.prog(U1,'rhythm_found')=15, 'cancelled/deleted haric';
  for i in 1..35 loop insert into public.workout_sessions(user_id,status) values (U1,'completed'); end loop; -- 50
  assert pg_temp.unl(U1,'half_century'), 'half@50';
  assert not pg_temp.unl(U1,'iron_will_100'), 'iron not@50';
  for i in 1..50 loop insert into public.workout_sessions(user_id,status) values (U1,'completed'); end loop; -- 100
  assert pg_temp.unl(U1,'iron_will_100'), 'iron@100';

  -- 3) STREAK 3/7/30 (stub)
  insert into public.test_streak values (U1,3) on conflict(user_id) do update set value=3;
  assert pg_temp.unl(U1,'three_day_spark') and not pg_temp.unl(U1,'weekly_flame'), 'streak3';
  update public.test_streak set value=7 where user_id=U1;
  assert pg_temp.unl(U1,'weekly_flame') and not pg_temp.unl(U1,'thirty_day_discipline'), 'streak7';
  update public.test_streak set value=30 where user_id=U1;
  assert pg_temp.unl(U1,'thirty_day_discipline'), 'streak30';

  -- 4) CARDIO 10 seans / 100km / 500dk
  for i in 1..9 loop
    insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into sid;
    insert into public.workout_activity_records(session_id,duration_seconds,distance_meters) values (sid,100,100);
  end loop;
  assert pg_temp.prog(U1,'cardio_discipline')=9 and pg_temp.unl(U1,'pulse_rising'), 'cardio9';
  insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into sid;
  insert into public.workout_activity_records(session_id,duration_seconds,distance_meters) values (sid,100,100);
  assert pg_temp.unl(U1,'cardio_discipline'), 'cardio10';
  -- büyük mesafe/süre tek kayıtla sınırları geç
  insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into sid;
  insert into public.workout_activity_records(session_id,duration_seconds,distance_meters) values (sid,30000,100000);
  assert pg_temp.unl(U1,'cardio_traveler'), 'traveler 100km';
  assert pg_temp.unl(U1,'against_time'), 'against_time 500dk';

  -- 5) HACİM tek-workout 10.000 & kariyer 250.000; ayrıca SET 1000
  insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into sid;
  insert into public.workout_sets(session_id,exercise_name,weight_kg,repetitions)
    select sid,'squat',100,100; -- 10.000 tek workout
  assert pg_temp.unl(U1,'ten_ton_club'), 'ten_ton single 10000';
  -- kariyer 250.000: 25 workout x 10.000
  for i in 1..25 loop
    insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into sid;
    insert into public.workout_sets(session_id,exercise_name,weight_kg,repetitions) select sid,'dl',100,100;
  end loop;
  assert pg_temp.unl(U1,'quarter_million'), 'career 250000';
  -- 1000 set: tek sesyona 1000 hafif set
  insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into sid;
  insert into public.workout_sets(session_id,exercise_name,weight_kg,repetitions)
    select sid,'acc',1,1 from generate_series(1,1000);
  assert pg_temp.unl(U1,'thousand_sets'), 'thousand_sets';

  -- 6) PR sayacı: aynı harekette artan ağırlıklar 3 PR; eşit tekrar PR değil
  insert into public.workout_sessions(user_id,status,workout_date) values (U1,'completed',date '2026-02-01') returning id into sid;
  insert into public.workout_sets(session_id,exercise_name,weight_kg,repetitions) values (sid,'bench',50,5);
  insert into public.workout_sessions(user_id,status,workout_date) values (U1,'completed',date '2026-02-02') returning id into sid;
  insert into public.workout_sets(session_id,exercise_name,weight_kg,repetitions) values (sid,'bench',60,5);
  insert into public.workout_sessions(user_id,status,workout_date) values (U1,'completed',date '2026-02-03') returning id into sid;
  insert into public.workout_sets(session_id,exercise_name,weight_kg,repetitions) values (sid,'bench',60,5); -- eşit, PR değil
  -- bench: 50 (PR1), 60 (PR2). squat/dl/acc de PR üretir ama pr_hunter>=3 zaten karşılanır.
  assert pg_temp.unl(U1,'pr_hunter'), 'pr_hunter>=3';

  -- 7) Basit boolean başarımlar
  insert into public.programs(owner_id) values (U1); assert pg_temp.unl(U1,'own_path'),'own_path';
  -- wise_counsel: GERÇEK kullanıcı mesajına BAĞLI assistant yanıtı gerekir.
  declare umsg uuid;
  begin
    insert into public.ai_coach_messages(user_id,role) values (U1,'user') returning id into umsg;
    assert not pg_temp.unl(U1,'wise_counsel'),'sadece user mesaji yetmez';
    -- bağı OLMAYAN assistant (otomatik/sistem gibi) AÇMAMALI
    insert into public.ai_coach_messages(user_id,role,reply_to_message_id) values (U1,'assistant',null);
    assert not pg_temp.unl(U1,'wise_counsel'),'baglantisiz assistant acmamali';
    -- gerçek kullanıcı mesajına bağlı assistant → açar
    insert into public.ai_coach_messages(user_id,role,reply_to_message_id) values (U1,'assistant',umsg);
    assert pg_temp.unl(U1,'wise_counsel'),'wise_counsel gercek yanit';
  end;
  insert into public.friend_messages(sender_id) values (U1); assert pg_temp.unl(U1,'first_message'),'first_message';
  update public.profiles set color_preset='oceanTeal' where id=U1; assert pg_temp.unl(U1,'new_perspective'),'new_perspective';
  update public.user_progress set selected_level_rose='rose_5' where user_id=U1; assert pg_temp.unl(U1,'rose_bud'),'rose_bud';
  update public.user_progress set lifetime_xp=200 where user_id=U1; assert pg_temp.unl(U1,'full_bloom'),'full_bloom L200';

  -- 8) ARKADAŞ 1 & 5; silme sonrası unlock KORUNUR (kalıcılık)
  insert into public.friendships values (U1,gen_random_uuid(),'accepted');
  assert pg_temp.unl(U1,'social_step') and not pg_temp.unl(U1,'strong_circle'),'social_step';
  insert into public.friendships values (U1,gen_random_uuid(),'accepted');
  insert into public.friendships values (gen_random_uuid(),U1,'accepted');
  insert into public.friendships values (U1,gen_random_uuid(),'accepted');
  insert into public.friendships values (U1,gen_random_uuid(),'accepted'); -- 5
  assert pg_temp.unl(U1,'strong_circle'),'strong_circle@5';
  delete from public.friendships where requester_id=U1; -- arkadaş sil
  assert pg_temp.unl(U1,'strong_circle'),'strong_circle KALICI (silme sonrası)';
  assert pg_temp.prog(U1,'strong_circle') < 5, 'ilerleme dustu ama unlock durur';

  -- 9) RANK: first_rank_up (peak>=200) & rosea (peak>=1650) HERHANGİ sezonda
  insert into public.user_season_ranks values (U1, 1, 150);
  assert not pg_temp.unl(U1,'first_rank_up'),'rankup not@150';
  insert into public.user_season_ranks values (U1, 2, 300); -- başka sezon
  assert pg_temp.unl(U1,'first_rank_up'),'rankup@300 (sezon2)';
  assert not pg_temp.unl(U1,'rosea_rank'),'rosea not';
  insert into public.user_season_ranks values (U1, 3, 1700);
  assert pg_temp.unl(U1,'rosea_rank'),'rosea@1700';
  -- sonraki sezon düşüş: rosea KORUNUR
  insert into public.user_season_ranks values (U1, 4, 100);
  assert pg_temp.unl(U1,'rosea_rank'),'rosea KALICI';

  -- 10) PERFECT WEEK: net RP>0
  insert into public.rank_events values (U1,1,'weekly_perfect','2026-02-10',25);
  assert pg_temp.unl(U1,'perfect_week'),'perfect_week net>0';

  -- 11) PROGRAM LOYALTY: 14 ardışık temiz gün + en az 1 tamamlanmış planlı gün
  insert into public.test_day_state
    select U2, (date '2026-03-01' + g), 'completed', true from generate_series(0,13) g; -- 14 planlı tamam
  perform set_config('test.uid', U2::text, true);
  assert pg_temp.unl(U2,'program_loyalty'),'loyalty 14 temiz';
  -- Bir kötü gün araya girerse (yeni kullanıcı bağlamında) aralık 14'e ulaşmaz
  delete from public.test_day_state where user_id=U2;
  insert into public.test_day_state select U2,(date '2026-03-01'+g),'completed',true from generate_series(0,6) g;
  insert into public.test_day_state values (U2, date '2026-03-08','missed',true); -- kötü gün
  insert into public.test_day_state select U2,(date '2026-03-09'+g),'completed',true from generate_series(0,6) g;
  -- (U2 defterinde loyalty zaten açıldı; kalıcı → hâlâ açık. İlerleme türetimini
  --  ayrı bir taze kullanıcıyla test edelim.)
  assert pg_temp.unl(U2,'program_loyalty'),'loyalty KALICI';

  -- 12) IDEMPOTENCY: iki sync çift satır yazmaz
  perform set_config('test.uid', U1::text, true);
  perform public.sync_my_achievements(current_date);
  perform public.sync_my_achievements(current_date);
  select count(*) into n from public.career_achievements where user_id=U1 and achievement_key='first_step';
  assert n=1, 'idempotent: tek satir';

  -- 13) KALICILIK: bütün workoutlar silinse bile unlock durur
  update public.workout_sessions set deleted_at=now() where user_id=U1;
  assert pg_temp.unl(U1,'iron_will_100'),'unlock veri silinince de durur';
  assert pg_temp.prog(U1,'iron_will_100')=0,'ilerleme 0 ama unlock durur';

  -- 14) COACH_TO_THE_TOP: 30 benzersiz TAMAMLANMIŞ (completed+result) analiz
  for i in 1..29 loop
    insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into sid;
    insert into public.ai_workout_analyses(user_id,workout_session_id,status,result) values (U1,sid,'completed','{}'::jsonb);
  end loop;
  assert not pg_temp.unl(U1,'coach_to_the_top'),'29 analiz yetmez';
  insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into sid;
  insert into public.ai_workout_analyses(user_id,workout_session_id,status,result) values (U1,sid,'completed','{}'::jsonb);
  assert pg_temp.unl(U1,'coach_to_the_top'),'30 analiz acar';
  assert pg_temp.prog(U1,'coach_to_the_top')=30,'coach ilerleme 30';
  -- GENERATING/FAILED analiz SAYILMAZ (yalnız completed+result).
  insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into s2;
  insert into public.ai_workout_analyses(user_id,workout_session_id,status,result) values (U1,s2,'generating',null);
  assert pg_temp.prog(U1,'coach_to_the_top')=30,'generating sayilmamali';
  update public.ai_workout_analyses set status='failed' where user_id=U1 and workout_session_id=s2;
  assert pg_temp.prog(U1,'coach_to_the_top')=30,'failed sayilmamali';
  -- GUARD: başka kullanıcının session'ı reddedilir (insert)
  insert into public.workout_sessions(user_id,status) values (U2,'completed') returning id into s2;
  okb:=false; begin insert into public.ai_workout_analyses(user_id,workout_session_id,status,result) values (U1,s2,'completed','{}'::jsonb); exception when others then okb:=true; end;
  assert okb,'baska kullanici session reddedilmeli';
  -- GUARD: tamamlanmamış session reddedilir
  insert into public.workout_sessions(user_id,status) values (U1,'running') returning id into s2;
  okb:=false; begin insert into public.ai_workout_analyses(user_id,workout_session_id,status,result) values (U1,s2,'completed','{}'::jsonb); exception when others then okb:=true; end;
  assert okb,'tamamlanmamis session reddedilmeli';

  -- 14a) ATOMİK CLAIM + SAHİPLİK TOKENI: eşzamanlılık, stale reclaim, token güvenliği
  insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into sid;
  -- İlk claim üretim hakkını + TOKEN'ı alır.
  select outcome, claim_token into oc, tokA from public.claim_workout_analysis(U1,sid,120);
  assert oc='claimed' and tokA is not null,'ilk claim token verir';
  -- Eşzamanlı ikinci istek: taze generating → in_progress, TOKEN VERİLMEZ (null).
  select outcome, claim_token into oc, tokX from public.claim_workout_analysis(U1,sid,120);
  assert oc='in_progress' and tokX is null,'ikinci istek in_progress + token yok';
  -- Yanlış token ile complete/fail ETKİSİZ (durum generating kalır).
  assert not public.complete_workout_analysis(U1,sid,gen_random_uuid(),'{"h":9}'::jsonb),'yanlis token complete false';
  assert (select status from public.ai_workout_analyses where user_id=U1 and workout_session_id=sid)='generating','yanlis token durum degismez';
  -- Doğru token ile tamamla → completed; token TEMİZLENİR.
  assert public.complete_workout_analysis(U1,sid,tokA,'{"h":1}'::jsonb),'dogru token complete true';
  assert (select claim_token from public.ai_workout_analyses where user_id=U1 and workout_session_id=sid) is null,'complete sonrasi token temizlenir';
  -- Artık claim cache döner (completed).
  select outcome, result into oc, rj from public.claim_workout_analysis(U1,sid,120); assert oc='completed' and rj is not null,'completed cache';
  -- Aynı token ikinci kez complete → false (temizlendi + generating degil).
  assert not public.complete_workout_analysis(U1,sid,tokA,'{"h":2}'::jsonb),'ikinci complete false';

  -- ESKİ TOKEN YENİ CLAIM'İ DEĞİŞTİREMEZ (items 2 zorunlu senaryo 1-9):
  insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into s2;
  -- 1) A claim → token A.
  select outcome, claim_token into oc, tokA from public.claim_workout_analysis(U1,s2,120); assert oc='claimed','A claim';
  -- 2) Lease kontrollü olarak expire edilir.
  update public.ai_workout_analyses set lease_expires_at = timezone('utc',now()) - interval '1 hour' where user_id=U1 and workout_session_id=s2;
  -- 3) B reclaim → token B (A'dan farklı).
  select outcome, claim_token into oc, tokB from public.claim_workout_analysis(U1,s2,120); assert oc='claimed','B reclaim';
  assert tokB is not null and tokB <> tokA,'B token yeni ve farkli';
  -- 4) Token A ile complete → false, durum degismez (hala generating, B'nin).
  assert not public.complete_workout_analysis(U1,s2,tokA,'{"h":"A"}'::jsonb),'eski token A complete false';
  assert (select status from public.ai_workout_analyses where user_id=U1 and workout_session_id=s2)='generating','A complete durumu degistiremez';
  -- 5) Token A ile fail → durum degismez.
  perform public.fail_workout_analysis(U1,s2,tokA);
  assert (select status from public.ai_workout_analyses where user_id=U1 and workout_session_id=s2)='generating','A fail durumu degistiremez';
  -- 6) Token B ile complete → true.
  assert public.complete_workout_analysis(U1,s2,tokB,'{"h":"B"}'::jsonb),'B complete true';
  -- 7) Sonuc YALNIZ B'nin sonucu.
  assert (select result->>'h' from public.ai_workout_analyses where user_id=U1 and workout_session_id=s2)='B','sonuc B''nin';
  -- 8) Token B ile ikinci complete → false.
  assert not public.complete_workout_analysis(U1,s2,tokB,'{"h":"B2"}'::jsonb),'B ikinci complete false';

  -- STALE reclaim temel akışı: generating + lease geçmiş → yeniden claim.
  insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into s2;
  select claim_token into tokA from public.claim_workout_analysis(U1,s2,120);
  update public.ai_workout_analyses set lease_expires_at = timezone('utc',now()) - interval '1 hour' where user_id=U1 and workout_session_id=s2;
  select outcome into oc from public.claim_workout_analysis(U1,s2,120); assert oc='claimed','stale reclaim';
  -- FAIL (dogru token) → yeniden claim edilebilir.
  select claim_token into tokB from public.ai_workout_analyses where user_id=U1 and workout_session_id=s2;
  perform public.fail_workout_analysis(U1,s2,tokB);
  select outcome into oc from public.claim_workout_analysis(U1,s2,120); assert oc='claimed','failed reclaim';
  -- 9) GUARD: başka kullanıcı bu session'ı claim edemez (insert guard).
  okb:=false; begin perform public.claim_workout_analysis(U2,sid,120); exception when others then okb:=true; end;
  assert okb,'baska kullanici claim edemez';
  -- GUARD: tamamlanmamış session claim edilemez.
  insert into public.workout_sessions(user_id,status) values (U1,'running') returning id into s2;
  okb:=false; begin perform public.claim_workout_analysis(U1,s2,120); exception when others then okb:=true; end;
  assert okb,'tamamlanmamis session claim edilemez';

  -- 14b) ON_THE_PODIUM: SUNUCU-zamanlı, hafta-sonu arkadaş çevresinden (immutable)
  insert into auth.users values (U3); insert into public.user_progress(user_id) values (U3);
  update public.career_feature_config set effective_from = date '2026-01-01' where feature='podium';
  perform set_config('test.uid', U3::text, true);
  -- Arkadaşlık GEÇMİŞİ: FA/FB/FC 2026-01-01'den beri açık (Şubat haftalarında aktif).
  insert into public.friendship_intervals(user_low,user_high,started_at) values
    (least(U3,FA),greatest(U3,FA),timestamptz '2026-01-01'),
    (least(U3,FB),greatest(U3,FB),timestamptz '2026-01-01'),
    (least(U3,FC),greatest(U3,FC),timestamptz '2026-01-01');
  -- DEVAM EDEN hafta (bugün): SUNUCU zamanına göre kapanmadı → açmaz (client tarihi yok).
  insert into public.rank_events values (U3,1,'scheduled_day', to_char(current_date,'YYYY-MM-DD'), 999);
  assert not pg_temp.unl(U3,'on_the_podium'),'devam eden hafta acmamali';
  -- KAPANMIŞ W1 (2026-02-02): U3 4. (FA40,FB30,FC20,U3=10)
  insert into public.rank_events values
    (FA,1,'scheduled_day','2026-02-03',40),(FB,1,'scheduled_day','2026-02-03',30),
    (FC,1,'scheduled_day','2026-02-03',20),(U3,1,'scheduled_day','2026-02-03',10);
  assert not pg_temp.unl(U3,'on_the_podium'),'4. sira acmamali';
  -- KAPANMIŞ W2 (2026-02-09): U3 1.
  insert into public.rank_events values (U3,1,'scheduled_day','2026-02-10',50);
  assert pg_temp.unl(U3,'on_the_podium'),'kapanmis hafta ilk3 acar';
  -- Snapshot DEĞİŞMEZ: RP düşse/arkadaş değişse + TEKRAR finalize.
  delete from public.rank_events where user_id=U3 and source_key='2026-02-10';
  assert pg_temp.unl(U3,'on_the_podium'),'podium KALICI (RP dusse de)';
  assert (select rank from public.career_podium_results where user_id=U3 and week_start=date '2026-02-09')=1,'W2 snapshot rank 1';
  perform public.career_finalize_podium(U3);
  assert (select rank from public.career_podium_results where user_id=U3 and week_start=date '2026-02-09')=1,'re-finalize snapshot DEGISTIRMEZ';
  select count(*) into n from public.career_podium_results where user_id=U3 and week_start=date '2026-02-09'; assert n=1,'duplicate yok';

  -- 14c) HAFTA-SONU ARKADAŞ ÇEVRESİ (Blocker 4) — W3 (2026-03-02..08 Pzt-Paz)
  -- Synced aktörler auth.users + user_progress gerektirir; "arkadaşlar" (U1/U2)
  -- yalnız rank_events + friendship_intervals'ta yaşar (FK yok).
  insert into auth.users values (FA),(FC); insert into public.user_progress(user_id) values (FA),(FC);
  -- FA senaryosu: FA=10; arkadaş U1 W3 KAPANIŞINDAN ÖNCE (01-01) aktif, puanı 50 → FA 2. → AÇAR.
  insert into public.rank_events values (FA,1,'scheduled_day','2026-03-03',10);
  insert into public.friendship_intervals(user_low,user_high,started_at) values (least(FA,U1),greatest(FA,U1),timestamptz '2026-01-01');
  insert into public.rank_events values (U1,1,'scheduled_day','2026-03-04',50);
  perform set_config('test.uid', FA::text, true);
  assert pg_temp.unl(FA,'on_the_podium'),'W3 FA ilk3 (arkadas hafta-sonunda aktif → rank 2)';
  -- FC senaryosu: FC=10; U2 W3 kapanışında aktif (01-01) puan 5; U1 SONRADAN (04-01) eklenmiş.
  --   Katılımcı = FC + U2 (U1 sayılmaz) → FC=10 > U2=5 → FC rank 1 → AÇAR.
  insert into public.rank_events values (FC,1,'scheduled_day','2026-03-05',10);
  insert into public.friendship_intervals(user_low,user_high,started_at) values (least(FC,U2),greatest(FC,U2),timestamptz '2026-01-01');
  insert into public.friendship_intervals(user_low,user_high,started_at) values (least(FC,U1),greatest(FC,U1),timestamptz '2026-04-01');
  insert into public.rank_events values (U2,1,'scheduled_day','2026-03-06',5);
  perform set_config('test.uid', FC::text, true);
  assert pg_temp.unl(FC,'on_the_podium'),'W3 FC ilk3 (sonradan eklenen arkadas katilmaz → rank 1)';
  -- KANIT: sonradan eklenen U1'in dev puanı hafta-sonu snapshot sırasını DEĞİŞTİRMEZ.
  insert into public.rank_events values (U1,1,'scheduled_day','2026-03-07',999);
  perform public.career_finalize_podium(FC);
  assert (select rank from public.career_podium_results where user_id=FC and week_start=date '2026-03-02')=1,
    'sonradan eklenen arkadas hafta-sonu snapshot sirasini DEGISTIRMEZ';
  perform set_config('test.uid', U1::text, true);

  -- 14d) AI KOTA (Blocker 1): workout_analysis AYRI feature + UUID request_key
  perform set_config('test.uid', U1::text, true);
  -- workout_analysis: gerçek session UUID request_key olur (eski 'analysis:<id>' yok).
  insert into public.workout_sessions(user_id,status) values (U1,'completed') returning id into sid;
  assert public.consume_ai_quota(U1, sid, 'workout_analysis', 15), 'workout_analysis kota true';
  select count(*) into n from public.ai_quota_events where user_id=U1 and request_key=sid and feature='workout_analysis';
  assert n=1, 'analiz kota kaydi feature=workout_analysis';
  -- Aynı session tekrarı (retry) çift saymaz (idempotent request_key).
  assert public.consume_ai_quota(U1, sid, 'workout_analysis', 15), 'ayni session retry true';
  select count(*) into n from public.ai_quota_events where user_id=U1 and request_key=sid;
  assert n=1, 'ayni session tek kayit (double-consume yok)';
  -- Analiz asla chat olarak LOGLANMAZ.
  select count(*) into n from public.ai_quota_events where user_id=U1 and request_key=sid and feature='chat';
  assert n=0, 'analiz chat olarak loglanmamali';
  -- chat kotası bozulmadı (ayrı, bağımsız key).
  assert public.consume_ai_quota(U1, gen_random_uuid(), 'chat', 15), 'chat kota calisir';
  -- Geçersiz feature reddedilir.
  perform pg_temp.expect_err($q$ select public.consume_ai_quota('11111111-1111-1111-1111-111111111111'::uuid, gen_random_uuid(), 'summary', 15) $q$, 'unsupported ai feature');
  -- UUID-olmayan request_key artık İMKÂNSIZ (tip zorlaması): eski 'analysis:<id>' bug'ı gitti.
  perform pg_temp.expect_err($q$ select public.consume_ai_quota('11111111-1111-1111-1111-111111111111'::uuid, 'analysis:xyz', 'workout_analysis', 15) $q$, 'invalid input syntax for type uuid');

  -- 14e) FRIENDSHIP HELPER GÜVENLİĞİ (Blocker 1): dış-callable helper YOK; trigger çalışır
  -- Dışarıdan çağrılabilir aç/kapat yardımcı fonksiyonları KALDIRILDI.
  assert (select count(*) from pg_proc where proname in ('friendship_interval_open','friendship_interval_close'))=0,
    'friendship_interval_open/close hala var (dis-callable helper acigi)';
  -- Trigger fonksiyonu authenticated tarafından EXECUTE edilemez.
  assert not has_function_privilege('authenticated','public.friendship_intervals_sync()','EXECUTE'),
    'friendship_intervals_sync authenticated-executable (acik)';
  -- Trigger üzerinden normal arkadaş kabulü aralık AÇAR (iki izole test uuid'i).
  insert into public.friendships values ('cccccccc-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002','accepted');
  assert (select count(*) from public.friendship_intervals
          where user_low=least('cccccccc-0000-0000-0000-000000000001'::uuid,'cccccccc-0000-0000-0000-000000000002'::uuid)
            and user_high=greatest('cccccccc-0000-0000-0000-000000000001'::uuid,'cccccccc-0000-0000-0000-000000000002'::uuid)
            and ended_at is null)=1,
    'kabul trigger araligi acmali';
  -- Silme aralığı KAPATIR (ended_at set) — append-only + kontrollü kapanış.
  delete from public.friendships where requester_id='cccccccc-0000-0000-0000-000000000001';
  assert (select count(*) from public.friendship_intervals
          where user_low=least('cccccccc-0000-0000-0000-000000000001'::uuid,'cccccccc-0000-0000-0000-000000000002'::uuid)
            and user_high=greatest('cccccccc-0000-0000-0000-000000000001'::uuid,'cccccccc-0000-0000-0000-000000000002'::uuid)
            and ended_at is null)=0,
    'silme trigger araligi kapatmali';

  -- 15) HESAP İZOLASYONU: U1 açılmaları U2'ye sızmaz
  select count(*) into n from public.career_achievements where user_id=U2;
  assert n = (select count(*) from public.career_achievements where user_id=U2 and achievement_key='program_loyalty'),
    'U2 yalniz kendi unlocklari';

  raise notice 'TUM KARIYER BASARIM TESTLERI GECTI';
end $$;
