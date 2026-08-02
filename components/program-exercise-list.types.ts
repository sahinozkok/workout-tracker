import { ProgramExercise } from '@/types/workout';

export type ProgramExerciseListProps = {
  exercises: ProgramExercise[];
  onEdit: (exercise: ProgramExercise, exerciseName: string) => void;
  onRemove: (exercise: ProgramExercise, exerciseName: string) => void;
  onReorder: (exercises: ProgramExercise[]) => void;
};
