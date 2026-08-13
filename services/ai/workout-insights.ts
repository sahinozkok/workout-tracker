import {
  ExerciseProgressInsight,
  ExerciseProgressMetrics,
  WeeklyWorkoutInsight,
  WeeklyWorkoutMetrics,
} from '@/types/ai';
import { supabase } from '@/lib/supabase';

const isCoachBackendEnabled = process.env.EXPO_PUBLIC_AI_PROVIDER === 'gemini';

const GOAL_SUGGESTIONS: Record<WeeklyWorkoutMetrics['trainingGoal'], string> = {
  consistency: 'Gelecek antrenmanın gününü şimdiden netleştirerek ritmini koru.',
  fitness: 'Antrenman düzenini korurken toparlanma kaliteni de takip et.',
  muscle: 'Kas gelişimi için düzenli antrenmanın yanında set kalitesine ve toparlanmaya odaklan.',
  strength: 'Güç hedefin için ana hareketlerde kontrollü ve ölçülebilir ilerlemeyi sürdür.',
};

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function workoutComparison(metrics: WeeklyWorkoutMetrics) {
  const difference = metrics.completedWorkouts - metrics.previousWeekCompletedWorkouts;
  if (difference > 0) return `Geçen haftaya göre ${difference} antrenman daha fazla tamamladın.`;
  if (difference < 0) return `Geçen haftaya göre ${Math.abs(difference)} antrenman geridesin.`;
  return `Tamamlanan antrenman sayın geçen haftayla aynı: ${metrics.completedWorkouts}.`;
}

function setComparison(metrics: WeeklyWorkoutMetrics) {
  const difference = metrics.completedSets - metrics.previousWeekCompletedSets;
  if (difference > 0) return `Tamamlanan set sayın geçen haftadan ${difference} daha yüksek.`;
  if (difference < 0) return `Tamamlanan set sayın geçen haftadan ${Math.abs(difference)} daha düşük.`;
  return metrics.completedSets > 0
    ? `Set sayın geçen haftayla aynı seviyede: ${metrics.completedSets}.`
    : 'Bu hafta henüz tamamlanmış set bulunmuyor.';
}

function buildMockInsight(metrics: WeeklyWorkoutMetrics): WeeklyWorkoutInsight {
  if (metrics.completedWorkouts === 0 && metrics.completedSets === 0) {
    return {
      generatedAt: new Date().toISOString(),
      headline: 'Bu haftanın ilk adımı seni bekliyor',
      highlights: [
        metrics.activeProgramName
          ? `${metrics.activeProgramName} aktif program olarak hazır.`
          : 'Henüz aktif bir program seçilmemiş.',
        'Tamamlanan bir antrenman veya set henüz kaydedilmedi.',
      ],
      nextSteps: [
        metrics.activeProgramName ? 'Planındaki sıradaki antrenmanı başlat.' : 'Bir programı aktif hale getir.',
        GOAL_SUGGESTIONS[metrics.trainingGoal],
      ],
      provider: 'mock',
      summary: 'Bu özet gerçek Supabase verilerinden hazırlandı. Veri oluştuğunda haftalık değişimleri burada göreceksin.',
    };
  }

  const disciplineWins = metrics.discipline.completed + metrics.discipline.partial;

  return {
    generatedAt: new Date().toISOString(),
    headline:
      metrics.completedWorkouts > metrics.previousWeekCompletedWorkouts
        ? 'Bu hafta ritmini yükseltiyorsun'
        : metrics.completedWorkouts > 0
          ? 'Bu haftanın antrenman verileri hazır'
          : 'Set ilerlemen kaydediliyor',
    highlights: [workoutComparison(metrics), setComparison(metrics), `${disciplineWins} planlı günde ilerleme kaydettin.`],
    nextSteps: [
      metrics.discipline.partial > 0
        ? 'Kısmi kalan antrenmanını tamamlayabiliyorsan haftayı güçlü kapat.'
        : 'Bir sonraki antrenmanda aynı düzeni korumaya odaklan.',
      GOAL_SUGGESTIONS[metrics.trainingGoal],
    ],
    provider: 'mock',
    summary: `${metrics.completedWorkouts} antrenmanda toplam ${metrics.completedSets} set tamamladın. Bu yorum, uygulamadaki doğrulanmış haftalık sayılardan üretildi.`,
  };
}

function isWorkoutInsight(value: unknown): value is WeeklyWorkoutInsight {
  if (!value || typeof value !== 'object') return false;
  const insight = value as Record<string, unknown>;
  return (
    typeof insight.generatedAt === 'string' &&
    typeof insight.headline === 'string' &&
    typeof insight.summary === 'string' &&
    (insight.provider === 'deterministic' || insight.provider === 'gemini' || insight.provider === 'mock') &&
    Array.isArray(insight.highlights) &&
    insight.highlights.every((item) => typeof item === 'string') &&
    Array.isArray(insight.nextSteps) &&
    insight.nextSteps.every((item) => typeof item === 'string')
  );
}

async function invokeWorkoutCoach(body: { exerciseName?: string; feature: 'exercise_progress' | 'weekly_summary' }) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error('Özet servisi için oturumun yenilenemedi. Çıkış yapıp tekrar giriş yapmayı dene.');
  }

  const { data, error } = await supabase.functions.invoke('workout-coach', {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    let message = 'Özet servisine ulaşılamadı.';
    const context = 'context' in error ? error.context : undefined;

    if (context instanceof Response) {
      try {
        const payload = (await context.clone().json()) as { error?: unknown; message?: unknown };
        const serverMessage = typeof payload.error === 'string' ? payload.error : payload.message;
        if (typeof serverMessage === 'string' && serverMessage.trim()) message = serverMessage;
      } catch {
        // Sunucu JSON döndürmediyse kullanıcıya güvenli genel mesaj gösterilir.
      }
    }

    throw new Error(message);
  }
  if (!isWorkoutInsight(data)) throw new Error('Özet beklenen biçimde gelmedi.');
  return data;
}

export async function generateWeeklyWorkoutInsight(metrics: WeeklyWorkoutMetrics) {
  if (isCoachBackendEnabled) return invokeWorkoutCoach({ feature: 'weekly_summary' });

  await wait(550);
  return buildMockInsight(metrics);
}

function formatDecimal(value: number) {
  return value.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
}

function buildWeightObservation(metrics: ExerciseProgressMetrics) {
  const { firstMaxWeightKg, latestMaxWeightKg } = metrics;
  if (firstMaxWeightKg === undefined || latestMaxWeightKg === undefined) {
    return 'Ağırlık değişimini yorumlamak için daha fazla ağırlık kaydı gerekiyor.';
  }

  const difference = latestMaxWeightKg - firstMaxWeightKg;
  if (difference > 0) {
    const percentage = firstMaxWeightKg > 0 ? (difference / firstMaxWeightKg) * 100 : 0;
    return `İlk kayda göre en yüksek çalışma ağırlığın ${formatDecimal(difference)} kg (%${formatDecimal(percentage)}) arttı.`;
  }
  if (difference < 0) {
    return `Son antrenmandaki en yüksek ağırlık, ilk kaydından ${formatDecimal(Math.abs(difference))} kg daha düşük.`;
  }
  return `İlk ve son kaydındaki en yüksek ağırlık aynı: ${formatDecimal(latestMaxWeightKg)} kg.`;
}

function buildExerciseMockInsight(metrics: ExerciseProgressMetrics): ExerciseProgressInsight {
  if (metrics.totalSets === 0) {
    return {
      generatedAt: new Date().toISOString(),
      headline: `${metrics.exerciseName} için veri bekleniyor`,
      highlights: ['Henüz tamamlanmış set bulunmuyor.'],
      nextSteps: ['Bir sonraki antrenmanda ağırlık ve tekrarlarını kaydet.'],
      provider: 'mock',
      summary: 'Egzersiz analizi, kaydettiğin gerçek setlerden oluşturulur.',
    };
  }

  const hasWeightProgress =
    metrics.firstMaxWeightKg !== undefined &&
    metrics.latestMaxWeightKg !== undefined &&
    metrics.latestMaxWeightKg > metrics.firstMaxWeightKg;
  const highlights = [
    buildWeightObservation(metrics),
    metrics.bestWeightKg === undefined
      ? 'Henüz ağırlık girilmemiş; tekrar kayıtların yine de izleniyor.'
      : `Kaydedilen en yüksek ağırlık ${formatDecimal(metrics.bestWeightKg)} kg.`,
    metrics.bestRepetitions === undefined
      ? 'Tekrar rekoru için yeterli kayıt yok.'
      : `Tek bir setteki tekrar rekorun ${metrics.bestRepetitions}.`,
  ];

  return {
    generatedAt: new Date().toISOString(),
    headline: hasWeightProgress
      ? `${metrics.exerciseName} ilerlemen olumlu görünüyor`
      : `${metrics.exerciseName} verilerin hazır`,
    highlights,
    nextSteps: [
      metrics.workoutDays < 3
        ? 'Daha güvenilir bir eğilim için en az birkaç farklı antrenman günü kaydet.'
        : 'Bir sonraki antrenmanda ağırlık ve tekrarlarını aynı doğrulukla kaydetmeye devam et.',
      'Yalnızca sayılara değil, hareket kalitesi ve toparlanmana da dikkat et.',
    ],
    provider: 'mock',
    summary: `${metrics.workoutDays} antrenman gününde ${metrics.totalSets} set ve ${formatDecimal(metrics.totalVolumeKg)} kg toplam hacim kaydettin. Yorum yalnızca doğrulanmış uygulama verilerini kullanır.`,
  };
}

export async function generateExerciseProgressInsight(metrics: ExerciseProgressMetrics) {
  if (isCoachBackendEnabled) {
    return invokeWorkoutCoach({ exerciseName: metrics.exerciseName, feature: 'exercise_progress' });
  }

  await wait(550);
  return buildExerciseMockInsight(metrics);
}
