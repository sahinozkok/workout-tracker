import type { WorkoutReminder, WorkoutReminderDraft } from '@/types/reminders';
import type { Weekday } from '@/types/workout';

/**
 * HATIRLATICI SAF ÇEKİRDEĞİ.
 *
 * SINIR: React yok, AsyncStorage yok, Expo yok. Yalnızca doğrulama, normalleştirme,
 * çakışma ve Expo weekday dönüşümü. Bu dosya hem uygulamada hem harness'ta AYNEN
 * çalışır; bildirim/depolama yan etkileri `utils/workout-reminders.ts`tedir.
 */

/** Kullanıcı en fazla bu kadar hatırlatıcı oluşturabilir. */
export const MAX_REMINDERS = 5;

export const HOUR_MIN = 0;
export const HOUR_MAX = 23;
export const MINUTE_MIN = 0;
export const MINUTE_MAX = 59;

/**
 * Pazartesi→Pazar görüntü sırası. Uygulama içinde Pazar 0'dır; bu dizi haftayı
 * Pazartesi'yle başlatarak hem sıralama hem gün seçici için tek kaynak olur.
 */
export const MONDAY_FIRST_WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** Kaydetme/çakışma nedenleri; ekran her birine lokalize metin bağlar. */
export type ReminderValidationError = 'no_days' | 'invalid_time' | 'max_reached' | 'conflict';

export type ReminderValidation =
  | { ok: true }
  | { ok: false; reason: ReminderValidationError; conflictWeekday?: Weekday };

function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

function isValidTime(hour: number, minute: number) {
  return (
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    hour >= HOUR_MIN &&
    hour <= HOUR_MAX &&
    minute >= MINUTE_MIN &&
    minute <= MINUTE_MAX
  );
}

/** Günleri BENZERSİZ ve Pazartesi→Pazar SIRALI yapar; geçersiz değerleri atar. */
export function normalizeWeekdays(weekdays: readonly Weekday[]): Weekday[] {
  const unique = new Set<Weekday>();
  for (const day of weekdays) {
    if (isWeekday(day)) unique.add(day);
  }
  return MONDAY_FIRST_WEEKDAYS.filter((day) => unique.has(day));
}

/**
 * Uygulama weekday'ini (Pazar 0) Expo weekday'ine (Pazar 1) çevirir: `+1`.
 * Expo haftalık trigger 1–7 bekler (1 = Pazar, 7 = Cumartesi).
 */
export function toExpoWeekday(weekday: Weekday): number {
  return weekday + 1;
}

/** Saat sırasına göre (önce saat, sonra dakika) kararlı sıralama. */
export function sortReminders(reminders: readonly WorkoutReminder[]): WorkoutReminder[] {
  return [...reminders].sort((first, second) =>
    first.hour !== second.hour ? first.hour - second.hour : first.minute - second.minute,
  );
}

/** Taslağı doğrular. Çakışma AYRI kontrol edilir (bkz. `findReminderConflict`). */
export function validateReminderDraft(draft: WorkoutReminderDraft): ReminderValidation {
  if (!isValidTime(draft.hour, draft.minute)) return { ok: false, reason: 'invalid_time' };
  if (normalizeWeekdays(draft.weekdays).length === 0) return { ok: false, reason: 'no_days' };
  return { ok: true };
}

/**
 * İki AÇIK hatırlatıcı aynı `weekday + hour + minute` değerini paylaşamaz.
 *
 * Yalnızca `enabled` taslak, diğer `enabled` hatırlatıcılara karşı kontrol edilir
 * (kapalı hatırlatıcı bildirim üretmediği için çakışmaz). Aynı hatırlatıcının
 * düzenlenmesinde `ignoreId` ile kendisi hariç tutulur. Çakışan İLK günü döndürür.
 */
export function findReminderConflict(
  reminders: readonly WorkoutReminder[],
  candidate: WorkoutReminderDraft,
  ignoreId?: string,
): Weekday | undefined {
  if (!candidate.enabled) return undefined;

  const candidateDays = new Set(normalizeWeekdays(candidate.weekdays));

  for (const existing of reminders) {
    if (existing.id === ignoreId || !existing.enabled) continue;
    if (existing.hour !== candidate.hour || existing.minute !== candidate.minute) continue;
    for (const day of MONDAY_FIRST_WEEKDAYS) {
      if (candidateDays.has(day) && existing.weekdays.includes(day)) return day;
    }
  }
  return undefined;
}

/**
 * Yeni hatırlatıcı eklenip eklenemeyeceğini ve varsa çakışmayı tek adımda çözer.
 * Düzenlemede (`ignoreId` verilmiş) üst sınır kontrolü uygulanmaz.
 */
export function validateReminderSave(
  reminders: readonly WorkoutReminder[],
  draft: WorkoutReminderDraft,
  ignoreId?: string,
): ReminderValidation {
  const base = validateReminderDraft(draft);
  if (!base.ok) return base;

  const isNew = ignoreId === undefined;
  if (isNew && reminders.length >= MAX_REMINDERS) return { ok: false, reason: 'max_reached' };

  const conflictWeekday = findReminderConflict(reminders, draft, ignoreId);
  if (conflictWeekday !== undefined) return { ok: false, reason: 'conflict', conflictWeekday };

  return { ok: true };
}

/**
 * Depodan okunan ham JSON'u FAIL-SAFE ayrıştırır.
 *
 * Bozuk JSON, dizi olmayan kök veya alanı eksik/bozuk kayıt uygulamayı DÜŞÜRMEZ:
 * yalnızca geçerli kayıtlar alınır, günleri normalize edilir, `notificationIds`
 * KORUNUR ve sonuç saat sırasına dizilir.
 */
export function parseStoredReminders(rawValue: string | null): WorkoutReminder[] {
  if (!rawValue) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const valid: WorkoutReminder[] = [];
  const seenIds = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;

    if (typeof record.id !== 'string' || record.id.length === 0) continue;
    if (seenIds.has(record.id)) continue;
    if (typeof record.hour !== 'number' || typeof record.minute !== 'number') continue;
    if (!isValidTime(record.hour, record.minute)) continue;
    if (typeof record.enabled !== 'boolean') continue;
    if (!Array.isArray(record.weekdays)) continue;

    const weekdays = normalizeWeekdays(record.weekdays.filter(isWeekday));
    if (weekdays.length === 0) continue;

    const notificationIds = Array.isArray(record.notificationIds)
      ? [...new Set(record.notificationIds.filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        ))]
      : [];

    seenIds.add(record.id);
    valid.push({
      id: record.id,
      weekdays,
      hour: record.hour,
      minute: record.minute,
      enabled: record.enabled,
      notificationIds,
    });
  }

  return sortReminders(valid);
}

/** Aktif (açık) hatırlatıcı sayısı — Ayarlar alt metni için. */
export function countEnabledReminders(reminders: readonly WorkoutReminder[]): number {
  return reminders.reduce((total, reminder) => total + (reminder.enabled ? 1 : 0), 0);
}
