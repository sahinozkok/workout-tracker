import { DisciplineStatus } from '@/types/workout';

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateDisciplineStreak(statuses: Record<string, DisciplineStatus>) {
  const todayKey = toDateKey(new Date());
  const markedDateKeys = Object.keys(statuses)
    .filter((dateKey) => dateKey <= todayKey)
    .sort();

  if (markedDateKeys.length === 0) return 0;

  const latestDateKey = markedDateKeys[markedDateKeys.length - 1];
  const [year, month, day] = latestDateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  let streak = 0;

  while (statuses[toDateKey(date)] === 'completed' || statuses[toDateKey(date)] === 'partial') {
    streak += 1;
    date.setDate(date.getDate() - 1);
  }

  return streak;
}
