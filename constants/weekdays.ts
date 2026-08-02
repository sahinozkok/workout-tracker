import { Weekday } from '@/types/workout';

export const WEEKDAY_OPTIONS: { shortLabel: string; label: string; value: Weekday }[] = [
  { shortLabel: 'Pzt', label: 'Pazartesi', value: 1 },
  { shortLabel: 'Sal', label: 'Salı', value: 2 },
  { shortLabel: 'Çar', label: 'Çarşamba', value: 3 },
  { shortLabel: 'Per', label: 'Perşembe', value: 4 },
  { shortLabel: 'Cum', label: 'Cuma', value: 5 },
  { shortLabel: 'Cmt', label: 'Cumartesi', value: 6 },
  { shortLabel: 'Paz', label: 'Pazar', value: 0 },
];

export function getWeekdayLabel(weekday?: Weekday) {
  return WEEKDAY_OPTIONS.find((option) => option.value === weekday)?.label ?? 'Gün seçilmedi';
}
