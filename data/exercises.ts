import { ExerciseDefinition } from '@/types/workout';

type ExerciseCategory = {
  muscleGroup: string;
  groups: string[];
};

const EXERCISE_CATEGORIES: ExerciseCategory[] = [
  {
    muscleGroup: 'Göğüs',
    groups: [
      `Flat barbell bench press, Incline barbell bench press, Decline barbell bench press, Close-grip bench press, Wide-grip bench press, Reverse-grip bench press, Floor press, Pin press, Feet-up bench press, Guillotine press, Smith machine bench press`,
      `Flat dumbbell bench press, Incline dumbbell press, Decline dumbbell press, Dumbbell flye (flat), Incline dumbbell flye, Decline dumbbell flye, Dumbbell pullover, Single-arm dumbbell press, Squeeze press`,
      `Cable crossover, Low-to-high cable crossover, High-to-low cable crossover, Flat cable flye, Cable chest press, Standing cable chest press, Incline cable flye, Single-arm cable press`,
      `Machine chest press, Seated chest press machine, Pec deck (machine flye), Iso-lateral / Hammer Strength chest press, Incline machine press`,
      `Push-up, Incline push-up, Decline push-up, Wide push-up, Diamond/close push-up, Spiderman push-up, One-arm push-up, Clap/plyometric push-up, Chest dip (parallel bar dip)`,
    ],
  },
  {
    muscleGroup: 'Sırt',
    groups: [
      `Pull-up, Wide-grip pull-up, Neutral-grip pull-up, Chin-up, Weighted chin-up, Lat pulldown (wide-grip), Close-grip lat pulldown, Neutral-grip pulldown, Reverse-grip pulldown, Straight-arm pulldown, Single-arm lat pulldown, Assisted pull-up (machine/band)`,
      `Bent-over barbell row, Pendlay row, Yates row (underhand), T-bar row, Chest-supported row, Seated cable row (wide & close grip), Single-arm dumbbell row, Chest-supported dumbbell row, Seal row, Meadows row, Gorilla row, Inverted row (Australian pull-up / ring row), Machine low row, Machine high row, Smith machine row, Renegade row, Landmine row`,
      `Conventional deadlift, Barbell dead row, Rack pull`,
      `Straight-arm pulldown, Face pull, Reverse flye, Back extension / hyperextension, Superman, Resistance-band pull-apart, Shrug (trap work — see Shoulders)`,
    ],
  },
  {
    muscleGroup: 'Omuz',
    groups: [
      `Overhead press / military press / strict press (barbell), Seated barbell shoulder press, Dumbbell shoulder press, Seated dumbbell press, Arnold press, Push press, Push jerk, Split jerk, Sots press, Cuban press, Bent press, Landmine press, Machine shoulder press, Smith machine press, Pike push-up, Handstand push-up, Clean and press`,
      `Dumbbell lateral raise, Seated lateral raise, Cable lateral raise, Machine lateral raise, Leaning cable lateral raise, Bent-arm lateral raise, Behind-the-back cable raise`,
      `Dumbbell front raise, Barbell front raise, Plate front raise, Cable front raise, Incline front raise`,
      `Rear delt flye / reverse flye, Bent-over lateral raise, Seated rear lateral raise, Cable rear delt flye, Reverse pec deck, Face pull, Cable high pulley lateral extension`,
      `Barbell shrug, Dumbbell shrug, Smith machine shrug, Cable shrug, Upright row (barbell/dumbbell/cable), High pull, External rotation (rotator cuff), Internal rotation, YTWL raises`,
    ],
  },
  {
    muscleGroup: 'Biceps',
    groups: [
      `Barbell curl (standing), Cheat curl, EZ-bar curl, Wide-grip & close-grip barbell curl, Cable curl (bar), Cable rope curl, High cable curl / overhead cable curl, Bayesian cable curl, Dumbbell curl (standing), Seated dumbbell curl, Alternating dumbbell curl, Supine (lying) dumbbell curl, Hammer curl, Cross-body hammer curl, Incline dumbbell curl, Spider curl, Concentration curl, Preacher curl (barbell), Dumbbell preacher curl, Standing one-arm preacher curl, Machine/Scott curl, Zottman curl, Incline Zottman curl, Reverse curl (barbell), Dumbbell reverse curl, Cable reverse curl / reverse preacher curl, Drag curl, Bicep 21s, Eccentric curl, Kettlebell curl, Resistance-band curl, Kneeling cable curl, Fat-bar/axle curl, Chin-up (compound), TRX/ring bodyweight curl`,
    ],
  },
  {
    muscleGroup: 'Triceps',
    groups: [
      `Cable pushdown (straight bar), Rope pushdown, V-bar pushdown, Reverse-grip pushdown, Skull crusher (lying triceps extension, EZ-bar/barbell/dumbbell), Incline & decline skull crusher, Close-grip bench press, Overhead triceps extension (dumbbell), Cable overhead rope extension, Single-arm overhead extension, Triceps kickback (dumbbell), Cable kickback, Bench dip, Parallel-bar (triceps) dip, Machine triceps dip, Board press, JM press, Tate press, Diamond push-up, Cobra push-up, Kettlebell/band triceps extension, Smith machine close-grip press`,
    ],
  },
  {
    muscleGroup: 'Ön kol / Kavrama',
    groups: [
      `Wrist curl (barbell), Dumbbell wrist curl, Behind-the-back barbell wrist curl, Reverse wrist curl / wrist extension, Dumbbell wrist extension, Cable wrist curl, Finger curls, Reverse curl, EZ-bar reverse curl, Cable reverse curl, Hammer curl, Zottman curl, Wrist roller, Plate pinch, Farmer's walk / carry, Suitcase carry, Dead hang, One-arm hang, Weighted hang, Hand-gripper squeeze, Ball/putty squeeze, Fat-bar deadlift / Fat Gripz work, Forearm pronation/supination rotation, Radial deviation, Ulnar deviation, Fingertip push-up`,
    ],
  },
  {
    muscleGroup: 'Karın / Core',
    groups: [
      `Crunch, Bicycle crunch, Reverse crunch, Cable crunch, Swiss-ball crunch, Sit-up, V sit-up, Butterfly sit-up, Decline sit-up, Weighted/medicine-ball sit-up, Plank (front), Side plank / side bridge, RKC plank, Plank shoulder taps, Body saw, Plank knee-to-elbow, Plank to push-up, Mountain climber, Russian twist, Hanging leg raise, Hanging knee raise, Vertical knee raise (captain's chair), Leg raise / leg lowering, Dragon flag, Dead bug, Bird dog, Pallof press, Ab wheel rollout, Woodchopper (cable), Toe touches, Flutter kicks, Hollow-body hold, Swiss-ball pike, Windshield wipers, Cable/standing oblique crunch, L-sit`,
    ],
  },
  {
    muscleGroup: 'Quadriceps / Bacak',
    groups: [
      `Barbell back squat (high-bar & low-bar), Front squat, Goblet squat, Sumo squat, Zercher squat, Overhead squat, Box squat, Pause squat, Bulgarian split squat, Split squat, Cyclist squat, Sissy squat, Spanish squat, Hindu squat, Prisoner squat, Cossack squat, Pistol squat, Skater squat, Jump squat, Steinborn squat, Smith machine squat, Hack squat (machine & barbell), Pendulum squat, Belt squat`,
      `Leg press (45° sled), Horizontal leg press, Single-leg leg press, Leg extension (machine)`,
      `Forward lunge, Reverse lunge, Walking lunge, Lateral lunge, Curtsy lunge, Step-up, High step-up, Deficit lunge`,
    ],
  },
  {
    muscleGroup: 'Arka bacak',
    groups: [
      `Lying leg curl, Seated leg curl, Standing (single-leg) leg curl, Nordic hamstring curl, Assisted Nordic curl, Glute-ham raise (GHR), Swiss-ball leg curl, Slider/valslide leg curl, TRX hamstring curl, Romanian deadlift (barbell), Dumbbell RDL, Single-leg RDL, Stiff-legged deadlift, Good morning, Cable pull-through, Kettlebell swing, Back extension (hamstring-biased)`,
    ],
  },
  {
    muscleGroup: 'Kalça',
    groups: [
      `Barbell hip thrust, Bodyweight hip thrust, B-stance hip thrust, Banded hip thrust, Glute bridge, Single-leg glute bridge, Frog pump, Cable glute kickback, Glute kickback machine, Donkey kick, Fire hydrant, Clamshell, Hip abduction machine (seated), Standing cable hip abduction, Lateral band walk, Hip adduction machine, Curtsy lunge, Sumo/wide-stance work, Cable pull-through, Step-up`,
    ],
  },
  {
    muscleGroup: 'Baldır',
    groups: [
      `Standing calf raise (bodyweight), Standing calf raise machine, Barbell standing calf raise, Dumbbell standing calf raise, Smith machine calf raise, Seated calf raise (machine), Seated barbell calf raise, Donkey calf raise, Weighted donkey calf raise, Leg-press calf raise (calf press), 45° sled calf press, Single-leg calf raise, Single-leg calf raise off step, Rotary/lever calf extension, Tibialis raise (dorsiflexion), Reverse calf raise, Banded calf raise`,
    ],
  },
  {
    muscleGroup: 'Tüm vücut / Güç',
    groups: [
      `Conventional deadlift, Sumo deadlift, Romanian deadlift, Stiff-leg deadlift, Trap-bar / hex-bar deadlift, Deficit deadlift, Rack pull, Snatch-grip deadlift, Single-leg deadlift, Suitcase deadlift, Jefferson deadlift, Clean deadlift, Banded deadlift`,
      `Snatch (full/squat snatch), Power snatch, Split snatch, Muscle snatch, Hang snatch, Snatch pull, Overhead squat, Clean and jerk, Power clean, Hang clean, Squat clean, Clean pull, Split jerk, Power jerk, Squat jerk, Push press, Push jerk`,
      `Thruster, Turkish get-up, Kettlebell swing (Russian & American), Kettlebell clean, Kettlebell snatch, Kettlebell high pull, Kettlebell windmill, Kettlebell halo, Wall ball, Medicine ball slam, Burpee, Clean and press, Farmer's walk, Sled push/pull, Battle ropes`,
    ],
  },
  {
    muscleGroup: 'Kardiyo',
    groups: [
      `Treadmill, Elliptical trainer / cross-trainer, Stationary bike (upright), Recumbent bike, Air bike / assault bike, Spin bike, Rowing machine (erg), Ski erg, Stair climber / stepper, StairMill (rotating stairs), Jacob's Ladder, Versaclimber, Arc trainer, Curved manual treadmill, Elliptical glider`,
    ],
  },
];

function splitOutsideParentheses(source: string) {
  const entries: string[] = [];
  let depth = 0;
  let current = '';

  for (const character of source) {
    if (character === '(') depth += 1;
    if (character === ')') depth = Math.max(0, depth - 1);

    if (character === ',' && depth === 0) {
      entries.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  if (current.trim()) entries.push(current.trim());
  return entries;
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function inferEquipment(name: string, muscleGroup: string) {
  const normalizedName = name.toLocaleLowerCase('en-US');

  if (muscleGroup === 'Kardiyo') return 'Kardiyo makinesi';
  if (normalizedName.includes('dumbbell')) return 'Dumbbell';
  if (normalizedName.includes('barbell') || normalizedName.includes('ez-bar')) return 'Barbell';
  if (normalizedName.includes('kettlebell')) return 'Kettlebell';
  if (normalizedName.includes('cable')) return 'Kablo';
  if (normalizedName.includes('landmine')) return 'Landmine';
  if (normalizedName.includes('band')) return 'Direnç bandı';
  if (normalizedName.includes('trx') || normalizedName.includes('ring')) return 'Askı sistemi';
  if (normalizedName.includes('medicine ball') || normalizedName.includes('wall ball')) return 'Sağlık topu';
  if (normalizedName.includes('machine') || normalizedName.includes('smith') || normalizedName.includes('pec deck')) {
    return 'Makine';
  }
  if (
    normalizedName.includes('push-up') ||
    normalizedName.includes('pull-up') ||
    normalizedName.includes('chin-up') ||
    normalizedName.includes('plank') ||
    normalizedName.includes('sit-up') ||
    normalizedName.includes('crunch') ||
    normalizedName.includes('dip') ||
    normalizedName.includes('dead hang') ||
    normalizedName.includes('burpee')
  ) {
    return 'Vücut ağırlığı';
  }

  return 'Çeşitli';
}

export const EXERCISES: ExerciseDefinition[] = EXERCISE_CATEGORIES.flatMap((category) => {
  const seenNames = new Set<string>();

  return category.groups.flatMap((group) =>
    splitOutsideParentheses(group).flatMap((name) => {
      const normalizedName = name.toLocaleLowerCase('en-US');

      if (!name || seenNames.has(normalizedName)) return [];
      seenNames.add(normalizedName);

      return [
        {
          id: `${slugify(category.muscleGroup)}-${slugify(name)}`,
          name,
          muscleGroup: category.muscleGroup,
          equipment: inferEquipment(name, category.muscleGroup),
        },
      ];
    }),
  );
});

export const EXERCISE_MUSCLE_GROUPS = EXERCISE_CATEGORIES.map((category) => category.muscleGroup);

export function getExerciseById(exerciseId?: string) {
  return exerciseId ? EXERCISES.find((exercise) => exercise.id === exerciseId) : undefined;
}

export function getProgramExerciseName(exerciseId?: string, customExerciseName?: string) {
  return getExerciseById(exerciseId)?.name ?? customExerciseName ?? 'Bilinmeyen egzersiz';
}
