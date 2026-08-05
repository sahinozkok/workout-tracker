import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemeColors } from '@/constants/theme';
import { useProfile } from '@/context/profile-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  generateExerciseProgressInsight,
  generateWeeklyWorkoutInsight,
  isGeminiEnabled,
} from '@/services/ai/workout-insights';
import { WeeklyWorkoutInsight } from '@/types/ai';
import { buildExerciseProgressMetrics } from '@/utils/exercise-ai-metrics';
import { buildExerciseAnalytics } from '@/utils/workout-analytics';
import { formatDuration } from '@/utils/workout-session';
import { buildWeeklyWorkoutMetrics } from '@/utils/weekly-workout-metrics';

function formatDateRange(startKey: string, endKey: string) {
  const toDate = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const start = toDate(startKey).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  const end = toDate(endKey).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  return `${start} – ${end}`;
}

function formatDecimal(value: number) {
  return value.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
}

function formatCompactNumber(value: number) {
  if (value >= 1000) return `${formatDecimal(value / 1000)}B`;
  return formatDecimal(value);
}

export default function CoachScreen() {
  const { profile } = useProfile();
  const {
    activeProgramId,
    completedSetCounts,
    disciplineStatuses,
    isProgramsLoading,
    programs,
    workoutSessions,
    workoutSets,
  } = useWorkout();
  const { colors } = useAppTheme();
  const styles = createStyles(colors);
  const [insight, setInsight] = useState<WeeklyWorkoutInsight>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>();
  const [analysisMode, setAnalysisMode] = useState<'weekly' | 'exercise'>('weekly');
  const [selectedExerciseKey, setSelectedExerciseKey] = useState<string>();
  const activeProgram = programs.find((program) => program.id === activeProgramId);
  const metrics = useMemo(
    () =>
      buildWeeklyWorkoutMetrics({
        activeProgramName: activeProgram?.name,
        completedSetCounts,
        disciplineStatuses,
        trainingGoal: profile.trainingGoal,
        workoutSessions,
      }),
    [activeProgram?.name, completedSetCounts, disciplineStatuses, profile.trainingGoal, workoutSessions],
  );
  const completedSessionIds = useMemo(
    () => new Set(workoutSessions.filter((session) => session.status === 'completed').map((session) => session.id)),
    [workoutSessions],
  );
  const exerciseAnalytics = useMemo(
    () => buildExerciseAnalytics(workoutSets.filter((workoutSet) => completedSessionIds.has(workoutSet.sessionId))),
    [completedSessionIds, workoutSets],
  );
  const selectedExercise =
    exerciseAnalytics.find((exercise) => exercise.exerciseKey === selectedExerciseKey) ?? exerciseAnalytics[0];
  const exerciseMetrics = selectedExercise ? buildExerciseProgressMetrics(selectedExercise) : undefined;

  useEffect(() => {
    if (!exerciseAnalytics.some((exercise) => exercise.exerciseKey === selectedExerciseKey)) {
      setSelectedExerciseKey(exerciseAnalytics[0]?.exerciseKey);
    }
  }, [exerciseAnalytics, selectedExerciseKey]);

  function changeAnalysisMode(mode: 'weekly' | 'exercise') {
    setAnalysisMode(mode);
    setInsight(undefined);
    setError(undefined);
  }

  async function generateInsight() {
    setIsGenerating(true);
    setError(undefined);
    void Haptics.selectionAsync();

    try {
      if (analysisMode === 'exercise') {
        if (!exerciseMetrics) throw new Error('Egzersiz verisi bulunamadı.');
        setInsight(await generateExerciseProgressInsight(exerciseMetrics));
      } else {
        setInsight(await generateWeeklyWorkoutInsight(metrics));
      }
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : 'Koç yorumu hazırlanamadı. Lütfen tekrar dene.',
      );
    } finally {
      setIsGenerating(false);
    }
  }

  if (isProgramsLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primaryIcon} size="large" />
          <Text style={styles.mutedText}>Antrenman verilerin hazırlanıyor…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <View style={styles.demoBadge}>
            <View style={[styles.demoDot, isGeminiEnabled && styles.liveDot]} />
            <Text style={[styles.demoBadgeText, isGeminiEnabled && styles.liveBadgeText]}>
              {isGeminiEnabled ? 'GEMINI · GERÇEK AI' : 'DEMO · SAHTE AI'}
            </Text>
          </View>
          <Text style={styles.title}>
            {analysisMode === 'weekly' ? 'Haftalık antrenman özeti' : 'Egzersiz gelişim analizi'}
          </Text>
          <Text style={styles.subtitle}>
            {isGeminiEnabled
              ? 'Sayılar Edge Function tarafından Supabase verilerinden doğrulanır ve Gemini tarafından yorumlanır.'
              : 'Sayılar gerçek Supabase verilerinden hesaplanır. AI yorumu şimdilik cihazında örnek olarak oluşturulur.'}
          </Text>
        </View>

        <View style={styles.modeToggle}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: analysisMode === 'weekly' }}
            onPress={() => changeAnalysisMode('weekly')}
            style={({ pressed }) => [
              styles.modeButton,
              analysisMode === 'weekly' && styles.modeButtonActive,
              pressed && styles.buttonPressed,
            ]}>
            <Ionicons
              name="calendar-outline"
              size={15}
              color={analysisMode === 'weekly' ? colors.onPrimary : colors.textTertiary}
            />
            <Text style={[styles.modeText, analysisMode === 'weekly' && styles.modeTextActive]}>Haftalık</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: analysisMode === 'exercise' }}
            onPress={() => changeAnalysisMode('exercise')}
            style={({ pressed }) => [
              styles.modeButton,
              analysisMode === 'exercise' && styles.modeButtonActive,
              pressed && styles.buttonPressed,
            ]}>
            <Ionicons
              name="trending-up-outline"
              size={15}
              color={analysisMode === 'exercise' ? colors.onPrimary : colors.textTertiary}
            />
            <Text style={[styles.modeText, analysisMode === 'exercise' && styles.modeTextActive]}>Egzersiz</Text>
          </Pressable>
        </View>

        {analysisMode === 'weekly' ? (
          <>
            <View style={styles.periodRow}>
              <Ionicons name="calendar-outline" size={18} color={colors.primaryIcon} />
              <Text style={styles.periodText}>{formatDateRange(metrics.periodStart, metrics.periodEnd)}</Text>
              <Text numberOfLines={1} style={styles.programName}>
                {metrics.activeProgramName ?? 'Aktif program yok'}
              </Text>
            </View>

            <View style={styles.metricsGrid}>
              <MetricCard
                colors={colors}
                icon="checkmark-circle-outline"
                label="Antrenman"
                value={String(metrics.completedWorkouts)}
              />
              <MetricCard
                colors={colors}
                icon="barbell-outline"
                label="Tamamlanan set"
                value={String(metrics.completedSets)}
              />
              <MetricCard
                colors={colors}
                icon="stopwatch-outline"
                label="Ort. süre"
                value={
                  metrics.averageWorkoutDurationSeconds > 0
                    ? formatDuration(metrics.averageWorkoutDurationSeconds)
                    : '—'
                }
              />
            </View>

            <View style={styles.disciplineRow}>
              <DisciplineItem
                color={colors.disciplineCompleted}
                label="Tam"
                labelColor={colors.textSecondary}
                value={metrics.discipline.completed}
              />
              <DisciplineItem
                color={colors.disciplinePartial}
                label="Kısmi"
                labelColor={colors.textSecondary}
                value={metrics.discipline.partial}
              />
              <DisciplineItem
                color={colors.disciplineSkipped}
                label="Atlandı"
                labelColor={colors.textSecondary}
                value={metrics.discipline.skipped}
              />
            </View>
          </>
        ) : exerciseMetrics ? (
          <>
            <ScrollView
              contentContainerStyle={styles.exerciseSelector}
              horizontal
              showsHorizontalScrollIndicator={false}>
              {exerciseAnalytics.map((exercise) => {
                const isSelected = exercise.exerciseKey === selectedExercise?.exerciseKey;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={exercise.exerciseKey}
                    onPress={() => {
                      setSelectedExerciseKey(exercise.exerciseKey);
                      setInsight(undefined);
                      setError(undefined);
                    }}
                    style={({ pressed }) => [
                      styles.exerciseChip,
                      isSelected && styles.exerciseChipActive,
                      pressed && styles.buttonPressed,
                    ]}>
                    <Text
                      numberOfLines={1}
                      style={[styles.exerciseChipText, isSelected && styles.exerciseChipTextActive]}>
                      {exercise.exerciseName}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.periodRow}>
              <Ionicons name="barbell-outline" size={18} color={colors.primaryIcon} />
              <Text numberOfLines={1} style={styles.exerciseName}>{exerciseMetrics.exerciseName}</Text>
              <Text style={styles.programName}>{exerciseMetrics.workoutDays} antrenman günü</Text>
            </View>

            <View style={styles.metricsGrid}>
              <MetricCard
                colors={colors}
                icon="barbell-outline"
                label="En yüksek"
                value={
                  exerciseMetrics.bestWeightKg === undefined
                    ? '—'
                    : `${formatDecimal(exerciseMetrics.bestWeightKg)} kg`
                }
              />
              <MetricCard
                colors={colors}
                icon="repeat-outline"
                label="En çok tekrar"
                value={exerciseMetrics.bestRepetitions?.toString() ?? '—'}
              />
              <MetricCard
                colors={colors}
                icon="layers-outline"
                label="Toplam hacim"
                value={
                  exerciseMetrics.totalVolumeKg > 0
                    ? `${formatCompactNumber(exerciseMetrics.totalVolumeKg)} kg`
                    : '—'
                }
              />
            </View>
          </>
        ) : (
          <View style={styles.noExerciseData}>
            <Ionicons name="barbell-outline" size={30} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>Analiz edilecek egzersiz yok</Text>
            <Text style={styles.emptyText}>
              Ağırlık ve tekrar içeren bir antrenmanı tamamladığında egzersiz analizi açılacak.
            </Text>
          </View>
        )}

        {insight ? (
          <View style={styles.insightSection}>
            <View style={styles.insightHeading}>
              <View style={styles.aiMark}>
                <Ionicons name="sparkles" size={20} color={colors.primaryIcon} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.insightLabel}>AI KOÇ YORUMU</Text>
                <Text style={styles.insightTitle}>{insight.headline}</Text>
              </View>
            </View>

            <Text style={styles.summary}>{insight.summary}</Text>

            <InsightList colors={colors} icon="analytics-outline" items={insight.highlights} title="Öne çıkanlar" />
            <InsightList colors={colors} icon="arrow-forward-circle-outline" items={insight.nextSteps} title="Sonraki adımlar" />

            <Text style={styles.mockNotice}>Bu tıbbi veya profesyonel antrenör tavsiyesi değildir.</Text>
          </View>
        ) : (
          <View style={styles.emptyInsight}>
            <Ionicons name="sparkles-outline" size={30} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>Yorum henüz oluşturulmadı</Text>
            <Text style={styles.emptyText}>
              {analysisMode === 'weekly'
                ? 'Butona bastığında mevcut haftalık verilerin yorumlanacak.'
                : 'Butona bastığında seçili egzersizin kayıtları yorumlanacak.'}
            </Text>
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable
          accessibilityRole="button"
          disabled={isGenerating || (analysisMode === 'exercise' && !exerciseMetrics)}
          onPress={() => void generateInsight()}
          style={({ pressed }) => [
            styles.generateButton,
            pressed && styles.buttonPressed,
            (isGenerating || (analysisMode === 'exercise' && !exerciseMetrics)) && styles.disabledButton,
          ]}>
          {isGenerating ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Ionicons name={insight ? 'refresh' : 'sparkles'} size={20} color={colors.onPrimary} />
          )}
          <Text style={styles.generateButtonText}>
            {isGenerating
              ? 'Yorum hazırlanıyor…'
              : insight
                ? 'Yorumu yenile'
                : analysisMode === 'weekly'
                  ? 'Haftalık özeti oluştur'
                  : 'Egzersizi yorumla'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

type MetricCardProps = {
  colors: ThemeColors;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
};

function MetricCard({ colors, icon, label, value }: MetricCardProps) {
  const styles = createStyles(colors);
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon} size={18} color={colors.primaryIcon} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text numberOfLines={2} style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function DisciplineItem({
  color,
  label,
  labelColor,
  value,
}: {
  color: string;
  label: string;
  labelColor: string;
  value: number;
}) {
  return (
    <View style={baseStyles.disciplineItem}>
      <View style={[baseStyles.disciplineDot, { backgroundColor: color }]} />
      <Text style={[baseStyles.disciplineValue, { color }]}>{value}</Text>
      <Text style={[baseStyles.disciplineLabel, { color: labelColor }]}>{label}</Text>
    </View>
  );
}

function InsightList({
  colors,
  icon,
  items,
  title,
}: {
  colors: ThemeColors;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  items: string[];
  title: string;
}) {
  const styles = createStyles(colors);
  return (
    <View style={styles.listSection}>
      <View style={styles.listTitleRow}>
        <Ionicons name={icon} size={17} color={colors.accentBright} />
        <Text style={styles.listTitle}>{title}</Text>
      </View>
      {items.map((item) => (
        <View key={item} style={styles.listItem}>
          <View style={styles.bullet} />
          <Text style={styles.listText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const baseStyles = StyleSheet.create({
  disciplineDot: { borderRadius: 4, height: 7, width: 7 },
  disciplineItem: { alignItems: 'center', flex: 1, gap: 4 },
  disciplineLabel: { fontSize: 10, fontWeight: '700' },
  disciplineValue: { fontSize: 18, fontWeight: '900' },
});

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    container: { gap: 24, padding: 20, paddingBottom: 44 },
    loadingState: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center' },
    mutedText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    intro: { gap: 8 },
    demoBadge: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 7 },
    demoDot: { backgroundColor: colors.accentBright, borderRadius: 4, height: 7, width: 7 },
    demoBadgeText: { color: colors.accentBright, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
    liveDot: { backgroundColor: colors.disciplineCompleted },
    liveBadgeText: { color: colors.disciplineCompleted },
    title: { color: colors.text, fontSize: 28, fontWeight: '900', lineHeight: 34 },
    subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
    modeToggle: {
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      padding: 4,
    },
    modeButton: {
      alignItems: 'center',
      borderRadius: 8,
      flex: 1,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      paddingVertical: 10,
    },
    modeButtonActive: { backgroundColor: colors.primary },
    modeText: { color: colors.textTertiary, fontSize: 11, fontWeight: '800' },
    modeTextActive: { color: colors.onPrimary },
    exerciseSelector: { gap: 8, paddingRight: 20 },
    exerciseChip: {
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      maxWidth: 190,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    exerciseChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    exerciseChipText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
    exerciseChipTextActive: { color: colors.onPrimary },
    periodRow: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      flexDirection: 'row',
      gap: 8,
      paddingVertical: 13,
    },
    periodText: { color: colors.text, fontSize: 13, fontWeight: '800' },
    exerciseName: { color: colors.text, flex: 1, fontSize: 13, fontWeight: '900' },
    programName: { color: colors.textSecondary, flex: 1, fontSize: 11, textAlign: 'right' },
    metricsGrid: { flexDirection: 'row', gap: 10 },
    metricCard: {
      alignItems: 'flex-start',
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      flex: 1,
      gap: 5,
      minHeight: 111,
      padding: 12,
    },
    metricValue: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 4 },
    metricLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', lineHeight: 14 },
    disciplineRow: {
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      flexDirection: 'row',
      paddingBottom: 18,
    },
    insightSection: { gap: 20 },
    insightHeading: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    aiMark: {
      alignItems: 'center',
      borderColor: colors.primarySoftBorder,
      borderRadius: 12,
      borderWidth: 1,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    flex: { flex: 1 },
    insightLabel: { color: colors.primaryIcon, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
    insightTitle: { color: colors.text, fontSize: 19, fontWeight: '900', marginTop: 3 },
    summary: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
    listSection: { gap: 10 },
    listTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    listTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
    listItem: { alignItems: 'flex-start', flexDirection: 'row', gap: 9, paddingLeft: 2 },
    bullet: { backgroundColor: colors.primaryIcon, borderRadius: 3, height: 5, marginTop: 7, width: 5 },
    listText: { color: colors.textSecondary, flex: 1, fontSize: 13, lineHeight: 19 },
    mockNotice: { color: colors.textTertiary, fontSize: 10, lineHeight: 15 },
    emptyInsight: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      gap: 7,
      paddingHorizontal: 24,
      paddingVertical: 28,
    },
    emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
    emptyText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
    noExerciseData: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      gap: 8,
      paddingHorizontal: 24,
      paddingVertical: 28,
    },
    errorText: { color: colors.danger, fontSize: 12, textAlign: 'center' },
    generateButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 11,
      flexDirection: 'row',
      gap: 9,
      height: 52,
      justifyContent: 'center',
    },
    generateButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '900' },
    buttonPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
    disabledButton: { opacity: 0.7 },
  });
}
