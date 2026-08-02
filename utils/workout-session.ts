import { WorkoutSession } from '@/types/workout';

export function getWorkoutDurationSeconds(session: WorkoutSession, now = Date.now()) {
  if (session.status !== 'running' || !session.lastResumedAt) {
    return session.accumulatedDurationSeconds;
  }

  const runningSeconds = Math.max(0, Math.floor((now - new Date(session.lastResumedAt).getTime()) / 1000));
  return session.accumulatedDurationSeconds + runningSeconds;
}

export function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}
