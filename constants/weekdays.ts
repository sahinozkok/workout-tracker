import { Weekday } from '@/types/workout';

export const WEEKDAY_VALUES: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** 2024-01-01 Pazartesi; haftanın günü adları buradan locale ile üretilir. */
const REFERENCE_MONDAY = new Date(2024, 0, 1);

function weekdayDate(weekday: Weekday) {
  const date = new Date(REFERENCE_MONDAY);
  const offset = weekday === 0 ? 6 : weekday - 1;
  date.setDate(date.getDate() + offset);
  return date;
}

export function getWeekdayLabel(weekday: Weekday | undefined, locale = 'tr-TR') {
  if (weekday === undefined) return '—';
  return weekdayDate(weekday).toLocaleDateString(locale, { weekday: 'long' });
}

export function getWeekdayShortLabel(weekday: Weekday, locale = 'tr-TR') {
  return weekdayDate(weekday).toLocaleDateString(locale, { weekday: 'short' }).replace('.', '');
}

/** Pazartesi ile başlayan, seçilen dile göre adlandırılmış gün listesi. */
export function getWeekdayOptions(locale = 'tr-TR') {
  return WEEKDAY_VALUES.map((value) => ({
    label: getWeekdayLabel(value, locale),
    shortLabel: getWeekdayShortLabel(value, locale),
    value,
  }));
}
