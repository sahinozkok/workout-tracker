begin;

-- AI Koç sohbeti. Tek kullanıcı için tek sohbet akışı yeterlidir; çoklu
-- konuşma listesi tutulmaz. Kullanıcı ve asistan mesajları yalnızca
-- doğrulanmış Edge Function tarafından (service_role ile) kaydedilir.
create table public.ai_coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  client_message_id uuid not null,
  -- Asistan mesajını yanıtladığı kullanıcı mesajına açıkça bağlar. Kullanıcı
  -- mesajlarında null, asistan mesajlarında zorunludur.
  reply_to_message_id uuid references public.ai_coach_messages(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ai_coach_messages_reply_link_check check (
    (role = 'user' and reply_to_message_id is null)
    or (role = 'assistant' and reply_to_message_id is not null)
  )
);

-- Aynı kullanıcı mesajının tekrar gönderiminde iki kez kaydını önler.
create unique index ai_coach_messages_user_client_msg_idx
on public.ai_coach_messages (user_id, client_message_id);

-- Bir kullanıcı mesajına yalnızca bir asistan cevabı bağlanabilir.
create unique index ai_coach_messages_reply_unique_idx
on public.ai_coach_messages (user_id, reply_to_message_id)
where role = 'assistant';

-- Kullanıcının sohbetini tarih sırasıyla hızlı yükler.
create index ai_coach_messages_user_created_idx
on public.ai_coach_messages (user_id, created_at);

alter table public.ai_coach_messages enable row level security;

-- Kullanıcı yalnızca kendi mesajlarını okuyabilir.
create policy "ai_coach_messages_select_own"
on public.ai_coach_messages for select
to authenticated
using ((select auth.uid()) = user_id);

-- Kullanıcı yalnızca kendi sohbet geçmişini silebilir.
create policy "ai_coach_messages_delete_own"
on public.ai_coach_messages for delete
to authenticated
using ((select auth.uid()) = user_id);

-- NOT: authenticated role'e bilerek INSERT yetkisi verilmez. Böylece istemci
-- doğrudan mesaj (özellikle 'assistant') oluşturamaz. Ekleme işlemleri yalnızca
-- Edge Function içinde service_role ile yapılır ve RLS'i bypass eder.
revoke all on table public.ai_coach_messages from anon;
grant select, delete on table public.ai_coach_messages to authenticated;

-- Sohbet istekleri de mevcut günlük AI kullanım kaydına yazılır; 'chat'
-- özelliğine izin vermek için feature kısıtını genişlet. Kısıt adı otomatik
-- atanmış olabileceği için ada güvenmeden bulup düşürülür.
do $$
declare
  feature_constraint text;
begin
  select con.conname into feature_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'ai_requests'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%feature%';

  if feature_constraint is not null then
    execute format('alter table public.ai_requests drop constraint %I', feature_constraint);
  end if;
end $$;

alter table public.ai_requests add constraint ai_requests_feature_check
  check (feature in ('weekly_summary', 'exercise_progress', 'chat'));

commit;
