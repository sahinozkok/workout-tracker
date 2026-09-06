-- =============================================================================
-- SEVİYE GÜLÜ SEÇİMİ — GERÇEK YETKİLENDİRME TESTİ (RLS + JWT + authenticated)
-- YENİ SÖZLEŞME: get_friend_level_rose `returns table` (erişim reddi ≠ otomatik)
-- =============================================================================
-- Bu test, izole/stub SQL testinin AKSİNE, GERÇEK yerel Supabase yığınına karşı
-- çalışır: gerçek migrationlar, gerçek seviye fonksiyonları, gerçek `auth` şeması
-- ve RLS. Kullanıcı yetkileri `authenticated` ROLÜ + JWT claim ile taklit edilir
-- (service-role/superuser ile DEĞİL). Kurulum (kullanıcı/ilerleme/arkadaşlık)
-- superuser ile yapılır; ASSERT'ler `authenticated` rolü altında koşar.
--
-- VERİ KORUMA — HER ŞEY TEK BİR TRANSACTION içindedir ve sonda ROLLBACK edilir:
--   * Yeni tablo-sözleşmeli fonksiyon transaction İÇİNDE kurulur (DDL de geri
--     alınır → çalışan dev DB şeması DEĞİŞMEZ; test sonrası fonksiyon eski
--     skaler halinde kalır).
--   * Test kullanıcıları/arkadaşlıkları/sezonları savepoint + ROLLBACK ile geri
--     alınır → mevcut geliştirme verisi KORUNUR, hiçbir kayıt kalmaz.
-- Geliştirme veritabanı SIFIRLANMAZ, mevcut kullanıcılar SİLİNMEZ.
--
-- ÇALIŞTIRMA (yerel; canlı DB DEĞİL):
--   docker exec -i supabase_db_<proje> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/level_rose_selection_authz.sql
-- Başarılıysa ">>> ALL LEVEL-ROSE AUTHZ TESTS PASSED <<<" basılır ve HER ŞEY
-- ROLLBACK edilir; herhangi bir assert düşerse psql sıfırdan farklı kodla çıkar.
\set ON_ERROR_STOP on
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set C '33333333-3333-3333-3333-333333333333'

begin;

-- ============ (0) YENİ SÖZLEŞMEYİ KUR (transaction içinde; ROLLBACK ile geri alınır) ============
-- `20260911..._upgrade_friend_level_rose_to_table.sql` ile AYNI DDL. Transaction
-- geri alındığında bu da geri alınır; dev DB'deki fonksiyon değişmeden kalır.
drop function if exists public.get_friend_level_rose(uuid);
create function public.get_friend_level_rose(target_user_id uuid)
returns table (selected_level_rose text)
language sql stable security definer set search_path = ''
as $$
  select up.selected_level_rose
  from public.user_progress as up
  where (select auth.uid()) is not null
    and up.user_id = target_user_id
    and public.are_friends((select auth.uid()), target_user_id);
$$;
revoke all on function public.get_friend_level_rose(uuid) from public;
revoke all on function public.get_friend_level_rose(uuid) from anon;
grant execute on function public.get_friend_level_rose(uuid) to authenticated;

-- İmza gerçekten TABLO mu? (yükseltme kanıtı)
do $$ begin
  assert (select pg_get_function_result(p.oid) from pg_proc p
          join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='get_friend_level_rose')
         = 'TABLE(selected_level_rose text)', 'FAIL 0: yeni sözleşme TABLO değil';
end $$;

-- ============ SETUP (superuser; RLS bypass yalnız kurulum için) ============
insert into auth.users (id,email,aud,role) values
  (:'A','a-lrauthz@test.local','authenticated','authenticated'),
  (:'B','b-lrauthz@test.local','authenticated','authenticated'),
  (:'C','c-lrauthz@test.local','authenticated','authenticated')
  on conflict (id) do nothing;
insert into public.profiles (id) values (:'A'::uuid),(:'B'::uuid),(:'C'::uuid) on conflict (id) do nothing;
select public.ensure_user_progress(:'A'::uuid);
select public.ensure_user_progress(:'B'::uuid);
select public.ensure_user_progress(:'C'::uuid);
update public.user_progress set lifetime_xp=2820, rose_balance=7, selected_level_rose=null where user_id=:'A'::uuid; -- L15
update public.user_progress set lifetime_xp=2820, rose_balance=3, selected_level_rose=null where user_id=:'B'::uuid; -- L15
update public.user_progress set lifetime_xp=2820, rose_balance=0, selected_level_rose=null where user_id=:'C'::uuid;
delete from public.friendships where (requester_id=:'A'::uuid and receiver_id=:'B'::uuid) or (requester_id=:'B'::uuid and receiver_id=:'A'::uuid);
insert into public.friendships (requester_id,receiver_id,status) values (:'A'::uuid,:'B'::uuid,'accepted');
-- A ve C arasında arkadaşlık YOK.

-- B kendi gülünü RPC ile ayarlar (kalıcı setup; A okuyacak).
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select public.set_my_level_rose('rose_15') as b_sets;
reset role;
set local "request.jwt.claims" = '';

-- ============ 1) Oturumsuz seçim yapamaz ============
savepoint s1;
  set local role anon;
  set local "request.jwt.claims" = '';
  do $$ declare ok boolean:=false; begin
    begin perform public.set_my_level_rose('rose_1'); exception when others then ok:=true; end;
    assert ok, 'FAIL 1: oturumsuz kullanıcı seçim yapabildi';
  end $$;
rollback to savepoint s1;

-- ============ 2) Kullanıcı kendi geçerli gülünü seçebilir ============
savepoint s2;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  select public.set_my_level_rose('rose_15');
  do $$ begin
    assert (select selected_level_rose from public.user_progress where user_id=auth.uid()) = 'rose_15',
      'FAIL 2: kendi seçimi yazılmadı';
  end $$;
rollback to savepoint s2;

-- ============ 3) Kilitli gül reddedilir (L15 kullanıcı rose_20) ============
savepoint s3;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  do $$ declare ok boolean:=false; begin
    begin perform public.set_my_level_rose('rose_20'); exception when others then ok:=true; end;
    assert ok, 'FAIL 3: kilitli gül kabul edildi';
  end $$;
  do $$ begin assert (select selected_level_rose from public.user_progress where user_id=auth.uid()) is null,
    'FAIL 3b: reddedilen seçim yine de yazıldı'; end $$;
rollback to savepoint s3;

-- ============ 4) Bilinmeyen gül reddedilir ============
savepoint s4;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  do $$ declare ok boolean:=false; begin
    begin perform public.set_my_level_rose('rose_999'); exception when others then ok:=true; end;
    assert ok, 'FAIL 4: bilinmeyen gül kabul edildi';
  end $$;
rollback to savepoint s4;

-- ============ 5) Doğrudan tablo UPDATE seçim kontrolünü aşamaz (RLS) ============
savepoint s5;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  do $$ declare n int; begin
    update public.user_progress set selected_level_rose='rose_20' where user_id=auth.uid();
    get diagnostics n = row_count;
    assert n = 0, 'FAIL 5: authenticated doğrudan UPDATE yapabildi (RLS aşıldı)';
    update public.user_progress set selected_level_rose='rose_1' where user_id='22222222-2222-2222-2222-222222222222';
    get diagnostics n = row_count;
    assert n = 0, 'FAIL 5b: başka kullanıcının satırı doğrudan güncellenebildi';
  end $$;
rollback to savepoint s5;

-- ============ 6) XP / RP / roses / seviye seçimle DEĞİŞMEZ ============
-- RP AYRI bir sistemdir (`user_season_ranks.current_rp`); seçim ona da dokunmaz.
insert into public.rank_seasons (season_index,starts_on,ends_on,theme_name)
  values (9001, date '2026-01-05', date '2026-01-05' + 55, 'authz-test')
  on conflict (season_index) do nothing;
insert into public.user_season_ranks (user_id,season_index,starting_rp,current_rp,peak_rp)
  values (:'A'::uuid,9001,100,137,137)
  on conflict (user_id,season_index) do update set current_rp = 137, peak_rp = 137;
savepoint s6;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  select public.set_my_level_rose('rose_10');
  reset role;
  do $$ begin
    assert (select lifetime_xp from public.user_progress where user_id='11111111-1111-1111-1111-111111111111')=2820,
      'FAIL 6: lifetime_xp değişti';
    assert (select rose_balance from public.user_progress where user_id='11111111-1111-1111-1111-111111111111')=7,
      'FAIL 6b: rose_balance değişti';
    assert public.level_for_xp(2820)=15, 'FAIL 6c: seviye değişti';
    assert (select current_rp from public.user_season_ranks
            where user_id='11111111-1111-1111-1111-111111111111' and season_index=9001)=137,
      'FAIL 6d: RP (current_rp) değişti';
  end $$;
rollback to savepoint s6;

-- ============ 7) YENİ SÖZLEŞME: izinli arkadaş + KİMLİK → 1 satır seçili gül;
--                arkadaş olmayan → 0 satır (erişim yok, otomatik DEĞİL) ============
savepoint s7;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  do $$ begin
    assert (select count(*) from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) = 1,
      'FAIL 7: izinli arkadaş için 1 satır dönmedi';
    assert (select selected_level_rose from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) = 'rose_15',
      'FAIL 7b: arkadaş B''nin SEÇİLİ gülü okunamadı';
  end $$;
  set local "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
  do $$ begin
    assert (select count(*) from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) = 0,
      'FAIL 7c: arkadaş OLMAYAN C erişebildi (erişim reddi ≠ 0 satır değil)';
  end $$;
rollback to savepoint s7;

-- ============ 7-auto) YENİ SÖZLEŞME: izinli arkadaş + OTOMATİK (null) → 1 satır
--                + null (erişim VAR; "0 satır/denied" ile KARIŞTIRILMAZ) ============
savepoint s7auto;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  select public.set_my_level_rose(null); -- B otomatik moda döner
  set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  do $$ begin
    assert (select count(*) from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) = 1,
      'FAIL 7-auto: otomatik moddaki arkadaş için erişim 0 satıra düştü (denied ile karıştı)';
    assert (select selected_level_rose from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) is null,
      'FAIL 7-auto-b: otomatik modda seçili gül null olmalı (ama erişim VAR)';
  end $$;
rollback to savepoint s7auto;

-- ============ 8) A, B'nin tercihini DEĞİŞTİREMEZ (RPC target'sız; auth.uid A) ============
savepoint s8;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  select public.set_my_level_rose('rose_5'); -- A kendi satırını değiştirir
  reset role;
  do $$ begin
    assert (select selected_level_rose from public.user_progress where user_id='22222222-2222-2222-2222-222222222222')='rose_15',
      'FAIL 8: A, B''nin seçimini etkiledi';
  end $$;
rollback to savepoint s8;

-- ============ 9) ENGELLENMİŞ kullanıcı gülü okuyamaz (İKİ YÖNDE de 0 satır) ============
savepoint s9;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  do $$ begin
    assert (select count(*) from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) = 1,
      'FAIL 9a: engelden ÖNCE arkadaş erişimi yok (1 satır bekleniyordu)';
  end $$;
  select public.block_user('22222222-2222-2222-2222-222222222222'::uuid);
  do $$ begin
    assert (select count(*) from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) = 0,
      'FAIL 9b: ENGELLEYEN kullanıcı hâlâ erişebildi';
  end $$;
  set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  do $$ begin
    assert (select count(*) from public.get_friend_level_rose('11111111-1111-1111-1111-111111111111')) = 0,
      'FAIL 9c: ENGELLENEN kullanıcı karşı tarafa erişebildi';
  end $$;
rollback to savepoint s9;

-- ============ 10) Gül okuması mevcut gizlilik yüzeyini GENİŞLETMEZ ============
savepoint s10;
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
  do $$ begin
    assert (select count(*) from public.get_friend_level_rose('22222222-2222-2222-2222-222222222222')) = 0,
      'FAIL 10: arkadaş olmayan C erişebildi';
    assert not public.are_friends('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222'),
      'FAIL 10b: C ile B arkadaş görünüyor (kurulum bozuk)';
  end $$;
rollback to savepoint s10;

reset role;
select '>>> ALL LEVEL-ROSE AUTHZ TESTS PASSED <<<' as result;

-- HER ŞEYİ GERİ AL: test verisi + inline fonksiyon DDL'i dahil hiçbir iz kalmaz.
rollback;
