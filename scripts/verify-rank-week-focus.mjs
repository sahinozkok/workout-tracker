import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const source = (path) => readFileSync(join(root, path), 'utf8');

const migration = source('supabase/migrations/20260829120000_add_rank_week_focus.sql');
const service = source('services/ranks.ts');
const context = source('context/rank-context.tsx');
const screen = source('app/rank.tsx');
const types = source('types/ranks.ts');
const tr = source('locales/tr.ts');
const en = source('locales/en.ts');

let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

// Sunucu otoritesi ve güvenlik sınırı.
check(migration.includes('security definer'), 'RPC security definer olmalı');
check(migration.includes("set search_path = ''"), 'RPC güvenli search_path kullanmalı');
check(migration.includes('actor uuid := auth.uid()'), 'Aktif kullanıcı auth.uid ile belirlenmeli');
check(migration.includes('perform public.assert_client_today(client_today)'), 'Yerel gün doğrulanmalı');
check(migration.includes('public.rank_day_state(actor, week_start, week_end)'), 'Tek kanıt kaynağı rank_day_state olmalı');
check(!migration.includes('manual_discipline_statuses'), 'Elle işaretlenen durum okunmamalı');
check(migration.includes('revoke all on function public.get_my_rank_week_focus(date) from anon'), 'Anon erişimi kapalı olmalı');
check(migration.includes('grant execute on function public.get_my_rank_week_focus(date) to authenticated'), 'Yalnız authenticated çalıştırabilmeli');
check(!/target_user|user_id\s+uuid/i.test(migration.split('returns table')[0]), 'RPC kullanıcı parametresi almamalı');

// İstemci yalnızca yerel günü gönderir ve yedi satırı doğrular.
check(service.includes("supabase.rpc('get_my_rank_week_focus'"), 'Servis doğru RPCyi çağırmalı');
check(service.includes('client_today: clientToday'), 'Servis yalnız yerel günü göndermeli');
check(service.includes("rows.length !== 7"), 'Bozuk hafta yanıtı reddedilmeli');
check(types.includes('export type RankWeekFocus'), 'Hafta tipi tanımlı olmalı');
check(types.includes("state?: 'completed' | 'partial'"), 'İstemci yalnız güvenli durumları kabul etmeli');

// Context yaşam döngüsü: ekran isterse yükle, hesap değişiminde temizle.
check(context.includes('hasRequestedWeekFocusRef'), 'İstek talep bayrağı olmalı');
check(context.includes('isWeekFocusFetchingRef'), 'Tek uçuş kilidi olmalı');
check(context.includes('hasQueuedWeekFocusRef'), 'Latest-wins kuyruğu olmalı');
check(context.includes('owner !== ownerRef.current'), 'Hesap sahipliği korunmalı');
check(context.includes('setWeekFocus(undefined)'), 'Hesap değişiminde hafta temizlenmeli');
check(context.includes('setHasWeekFocusError(true)'), 'Kart hata durumu sunmalı');
check(context.includes('if (hasRequestedWeekFocusRef.current) loadWeekFocusRef.current()'), 'Rank sync sonrası istenmiş kart tazelenmeli');

// Ekran kapsamı ve ürün kuralları.
check(screen.includes("t('ranks.weekFocus.title')"), 'Kart başlığı çeviriden gelmeli');
check(screen.includes('RANK_RP.weeklyPerfect'), 'Bonus tek sabitten gelmeli');
check(!screen.includes('Hafta kapandığında +25'), 'Bonus ekranda sabit yazılmamalı');
check(screen.includes("useFeatureColor('todayHighlight'"), 'Bugün vurgusu semantik presetten gelmeli');
check(screen.includes('colors.disciplineCompleted'), 'Tam gün semantik yeşil olmalı');
check(screen.includes('colors.disciplinePartial'), 'Kısmi gün semantik turuncu olmalı');
check(screen.includes('onRetry={() => void loadWeekFocus()}'), 'Kullanıcı tekrar deneyebilmeli');
check(tr.includes('Kusursuz hafta bonusuna {count} gün kaldı.'), 'Türkçe kalan gün metni olmalı');
check(en.includes('{count} days left for the perfect week bonus.'), 'İngilizce kalan gün metni olmalı');

// Pazartesi-Pazar ve özet hesabının saf modeli.
const monday = new Date(2026, 7, 24);
const days = Array.from({ length: 7 }, (_, index) => {
  const date = new Date(monday);
  date.setDate(monday.getDate() + index);
  return date;
});
check(days[0].getDay() === 1 && days[6].getDay() === 0, 'Hafta Pazartesi-Pazar olmalı');

const focus = [
  { isScheduledWorkout: true, state: 'completed' },
  { isScheduledWorkout: false, state: 'completed' },
  { isScheduledWorkout: true, state: 'partial' },
  { isScheduledWorkout: true, state: undefined },
];
const planned = focus.filter((day) => day.isScheduledWorkout);
const remaining = planned.length - planned.filter((day) => day.state === 'completed').length;
check(planned.length === 3, 'Off day planlı gün sayılmamalı');
check(remaining === 2, 'Kısmi ve tamamlanmamış planlı günler kalan sayılmalı');

console.log(`✓ Rank week focus: ${passed} kontrol geçti.`);
