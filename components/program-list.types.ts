import { WorkoutProgram } from '@/types/workout';

export type ProgramListProps = {
  activeProgramId?: string;
  /** Aktivasyon/silme sürerken satırın üç nokta düğmesi beklemeye alınır. */
  busyProgramId?: string;
  onOpen: (programId: string) => void;
  onOptions: (program: WorkoutProgram, isActive: boolean) => void;
  onReorder: (programs: WorkoutProgram[]) => void;
  programs: WorkoutProgram[];
  showIcons: boolean;
};
