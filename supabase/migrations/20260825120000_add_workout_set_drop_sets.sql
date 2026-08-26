/**
 * DROP SET DESTEĞİ
 *
 * Drop setler AYRI `workout_sets` satırı olarak saklanmaz. Ayrı satır olsaydı:
 *   * tamamlanan planlı set sayısı,
 *   * disiplin takvimi ve günlük tamamlanma hesabı,
 *   * XP/gül ödülleri,
 *   * otomatik antrenman bitişi
 * yanlış biçimde artardı. Bunun yerine her ANA set satırı kendi drop
 * parçalarını tek bir JSONB alanında taşır: bir ana set + drop setleri, bütün
 * bu hesaplar açısından TEK tamamlanan settir.
 *
 * Migration additive ve TEKRAR ÇALIŞTIRILABİLİR'dir; mevcut satırlar `default`
 * sayesinde otomatik olarak boş dizi alır.
 *
 * Yeni grant/policy EKLENMEZ: `workout_sets` üzerindeki mevcut RLS politikaları
 * (sahibi = `auth.uid()` olan session'ın satırları) yeni kolon için de aynen
 * geçerlidir. İstemci kullanıcı kimliği, XP veya ödül değeri göndermez;
 * yalnızca kendi setinin performans verisini yazar.
 */

begin;

alter table public.workout_sets
add column if not exists drop_sets jsonb not null default '[]'::jsonb;

/**
 * Şekil güvencesi: değer her zaman bir JSON DİZİSİ olmalıdır. Eleman şeması
 * (`{ weightKg?: number, repetitions: number }`) istemcide ve okuma sırasında
 * ayrıca doğrulanır; burada dizi olma koşulu, tek bir nesnenin ya da metnin
 * yanlışlıkla yazılmasını engeller.
 *
 * `not valid` DEĞİL: kolon yeni ve varsayılanı `'[]'` olduğu için mevcut
 * satırların tamamı kuralı zaten sağlar.
 */
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workout_sets_drop_sets_is_array'
      and conrelid = 'public.workout_sets'::regclass
  ) then
    alter table public.workout_sets
    add constraint workout_sets_drop_sets_is_array
    check (jsonb_typeof(drop_sets) = 'array');
  end if;
end;
$$;

commit;
