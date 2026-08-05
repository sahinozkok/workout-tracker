import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExerciseProgress } from '@/components/exercise-progress';
import { ThemeColors } from '@/constants/theme';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { WorkoutProgram, WorkoutSession, WorkoutSetRecord } from '@/types/workout';
import { dateFromKey } from '@/utils/workout-schedule';
import { formatDuration } from '@/utils/workout-session';

type ExerciseSetGroup = {
  key: string;
  name: string;
  sets: WorkoutSetRecord[];
};

export default function HistoryScreen() {
  const { colors } = useAppTheme();
  const { isProgramsLoading, programs, workoutSessions, workoutSets } = useWorkout();
  const styles = createStyles(colors);
  const [expandedSessionId, setExpandedSessionId] = useState<string>();
  const [activeView, setActiveView] = useState<'workouts' | 'progress'>('workouts');
  const completedSessions = [...workoutSessions]
    .filter((session) => session.status === 'completed')
    .sort(
      (first, second) =>
        new Date(second.completedAt ?? second.startedAt).getTime() -
        new Date(first.completedAt ?? first.startedAt).getTime(),
    );
  const completedSessionIds = new Set(completedSessions.map((session) => session.id));
  const completedWorkoutSets = workoutSets.filter((workoutSet) => completedSessionIds.has(workoutSet.sessionId));
  const totalDurationSeconds = completedSessions.reduce(
    (total, session) => total + session.accumulatedDurationSeconds,
    0,
  );

  if (isProgramsLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.emptyState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Antrenman geçmişin yükleniyor…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (completedSessions.length > 0) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View>
            <Text style={styles.pageTitle}>Geçmiş ve ilerleme</Text>
            <Text style={styles.pageSubtitle}>
              {activeView === 'workouts'
                ? 'Tamamladığın antrenmanları ve setleri incele.'
                : 'Egzersiz gelişimini ve kişisel rekorlarını takip et.'}
            </Text>
          </View>

          <View style={styles.viewToggle}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: activeView === 'workouts' }}
              onPress={() => setActiveView('workouts')}
              style={({ pressed }) => [
                styles.viewToggleButton,
                activeView === 'workouts' && styles.viewToggleButtonActive,
                pressed && styles.pressed,
              ]}>
              <Ionicons
                name="time-outline"
                size={15}
                color={activeView === 'workouts' ? colors.onPrimary : colors.textTertiary}
              />
              <Text
                style={[
                  styles.viewToggleText,
                  activeView === 'workouts' && styles.viewToggleTextActive,
                ]}>
                Antrenmanlar
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: activeView === 'progress' }}
              onPress={() => setActiveView('progress')}
              style={({ pressed }) => [
                styles.viewToggleButton,
                activeView === 'progress' && styles.viewToggleButtonActive,
                pressed && styles.pressed,
              ]}>
              <Ionicons
                name="trending-up-outline"
                size={15}
                color={activeView === 'progress' ? colors.onPrimary : colors.textTertiary}
              />
              <Text
                style={[
                  styles.viewToggleText,
                  activeView === 'progress' && styles.viewToggleTextActive,
                ]}>
                İlerleme
              </Text>
            </Pressable>
          </View>

          {activeView === 'workouts' ? (
            <>
              <View style={styles.summaryRow}>
                <SummaryMetric
                  colors={colors}
                  icon="checkmark-circle-outline"
                  label="Antrenman"
                  value={String(completedSessions.length)}
                />
                <SummaryMetric
                  colors={colors}
                  icon="barbell-outline"
                  label="Toplam set"
                  value={String(completedWorkoutSets.length)}
                />
                <SummaryMetric
                  colors={colors}
                  icon="stopwatch-outline"
                  label="Toplam süre"
                  value={formatCompactDuration(totalDurationSeconds)}
                />
              </View>

              <View style={styles.sessionList}>
                {completedSessions.map((session) => (
                  <SessionHistoryCard
                    colors={colors}
                    expanded={expandedSessionId === session.id}
                    key={session.id}
                    onToggle={() =>
                      setExpandedSessionId((currentId) => (currentId === session.id ? undefined : session.id))
                    }
                    program={programs.find((item) => item.id === session.programId)}
                    session={session}
                    sets={workoutSets.filter((workoutSet) => workoutSet.sessionId === session.id)}
                  />
                ))}
              </View>
            </>
          ) : (
            <ExerciseProgress workoutSets={completedWorkoutSets} />
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.emptyState}>
        <Ionicons name="calendar-outline" size={48} color={colors.textTertiary} />
        <Text style={styles.emptyTitle}>Antrenman geçmişin burada görünecek</Text>
        <Text style={styles.description}>
          İlk antrenmanını tamamladıktan sonra setlerini ve gelişimini bu ekrandan takip edeceksin.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function SummaryMetric({
  colors,
  icon,
  label,
  value,
}: {
  colors: ThemeColors;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const styles = createStyles(colors);

  return (
    <View style={styles.summaryMetric}>
      <Ionicons name={icon} size={17} color={colors.primaryIcon} />
      <Text numberOfLines={1} style={styles.summaryValue}>{value}</Text>
      <Text numberOfLines={1} style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function SessionHistoryCard({
  colors,
  expanded,
  onToggle,
  program,
  session,
  sets,
}: {
  colors: ThemeColors;
  expanded: boolean;
  onToggle: () => void;
  program?: WorkoutProgram;
  session: WorkoutSession;
  sets: WorkoutSetRecord[];
}) {
  const styles = createStyles(colors);
  const day = program?.days.find((item) => item.id === session.dayId);
  const sessionDate = dateFromKey(session.dateKey);
  const exerciseGroups = groupSetsByExercise(sets);
  const totalVolume = sets.reduce(
    (total, workoutSet) =>
      total + (workoutSet.weightKg ?? 0) * (workoutSet.repetitions ?? 0),
    0,
  );

  return (
    <View style={[styles.sessionCard, expanded && styles.sessionCardExpanded]}>
      <Pressable
        accessibilityHint="Antrenman setlerini gösterir veya gizler"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.sessionHeader, pressed && styles.pressed]}>
        <View style={styles.sessionIcon}>
          <Ionicons name="checkmark" size={19} color={colors.onPrimary} />
        </View>
        <View style={styles.sessionText}>
          <Text style={styles.sessionTitle}>{day?.name ?? 'Tamamlanan antrenman'}</Text>
          <Text numberOfLines={1} style={styles.sessionMeta}>{program?.name ?? 'Silinmiş program'}</Text>
          <Text style={styles.sessionDate}>
            {sessionDate.toLocaleDateString('tr-TR', {
              day: 'numeric',
              month: 'long',
              weekday: 'long',
              year: 'numeric',
            })}
          </Text>
        </View>
        <View style={styles.sessionSummary}>
          <View style={styles.durationArea}>
            <Ionicons name="stopwatch-outline" size={14} color={colors.accentBright} />
            <Text style={styles.duration}>{formatDuration(session.accumulatedDurationSeconds)}</Text>
          </View>
          <Text style={styles.setCount}>{sets.length} set</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textTertiary}
        />
      </Pressable>

      {expanded && (
        <View style={styles.sessionDetails}>
          <View style={styles.detailSummary}>
            <Text style={styles.detailSummaryText}>{sets.length} tamamlanan set</Text>
            {totalVolume > 0 && (
              <Text style={styles.volumeText}>{formatDecimal(totalVolume)} kg hacim</Text>
            )}
          </View>

          {exerciseGroups.length > 0 ? (
            exerciseGroups.map((group) => (
              <View key={group.key} style={styles.exerciseGroup}>
                <View style={styles.exerciseHeading}>
                  <View style={styles.exerciseIcon}>
                    <Ionicons name="barbell-outline" size={16} color={colors.primaryIcon} />
                  </View>
                  <Text style={styles.exerciseName}>{group.name}</Text>
                  <Text style={styles.exerciseSetCount}>{group.sets.length} set</Text>
                </View>

                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderText, styles.setColumn]}>SET</Text>
                  <Text style={styles.tableHeaderText}>KG</Text>
                  <Text style={styles.tableHeaderText}>TEKRAR</Text>
                  <Text style={styles.tableHeaderText}>RPE</Text>
                </View>

                {group.sets.map((workoutSet) => (
                  <View key={workoutSet.id} style={styles.setRow}>
                    <View style={styles.setNumberCell}>
                      <View style={styles.setNumberBadge}>
                        <Text style={styles.setNumberText}>{workoutSet.setNumber}</Text>
                      </View>
                    </View>
                    <Text style={styles.setValue}>
                      {workoutSet.weightKg === undefined ? '—' : formatDecimal(workoutSet.weightKg)}
                    </Text>
                    <Text style={styles.setValue}>{workoutSet.repetitions ?? '—'}</Text>
                    <Text style={styles.setValue}>
                      {workoutSet.rpe === undefined ? '—' : formatDecimal(workoutSet.rpe)}
                    </Text>
                  </View>
                ))}
              </View>
            ))
          ) : (
            <View style={styles.noSetDetails}>
              <Ionicons name="information-circle-outline" size={20} color={colors.textTertiary} />
              <Text style={styles.noSetDetailsText}>
                Bu antrenman eski sürümde kaydedildiği için set detayları bulunmuyor.
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function groupSetsByExercise(sets: WorkoutSetRecord[]) {
  const groups = new Map<string, ExerciseSetGroup>();

  [...sets]
    .sort((first, second) => first.completedAt.localeCompare(second.completedAt))
    .forEach((workoutSet) => {
      const key = workoutSet.programExerciseId ?? workoutSet.exerciseName;
      const currentGroup = groups.get(key);
      if (currentGroup) {
        currentGroup.sets.push(workoutSet);
        return;
      }

      groups.set(key, {
        key,
        name: workoutSet.exerciseName,
        sets: [workoutSet],
      });
    });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    sets: group.sets.sort((first, second) => first.setNumber - second.setNumber),
  }));
}

function formatDecimal(value: number) {
  return value.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}

function formatCompactDuration(totalSeconds: number) {
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)} dk`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return minutes > 0 ? `${hours} sa ${minutes} dk` : `${hours} sa`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { backgroundColor: colors.background, flex: 1 },
    content: { gap: 24, padding: 20, paddingBottom: 40 },
    pageTitle: { color: colors.text, fontSize: 29, fontWeight: '900', lineHeight: 35 },
    pageSubtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
    viewToggle: {
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      padding: 4,
    },
    viewToggleButton: {
      alignItems: 'center',
      borderRadius: 8,
      flex: 1,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      paddingVertical: 10,
    },
    viewToggleButtonActive: { backgroundColor: colors.primary },
    viewToggleText: { color: colors.textTertiary, fontSize: 11, fontWeight: '800' },
    viewToggleTextActive: { color: colors.onPrimary },
    summaryRow: { flexDirection: 'row', gap: 9 },
    summaryMetric: {
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      flex: 1,
      gap: 4,
      minHeight: 94,
      padding: 11,
    },
    summaryValue: { color: colors.text, fontSize: 19, fontWeight: '900', marginTop: 3 },
    summaryLabel: { color: colors.textSecondary, fontSize: 9, fontWeight: '700' },
    sessionList: { gap: 12 },
    sessionCard: {
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      borderTopColor: colors.border,
      borderTopWidth: 1,
    },
    sessionCardExpanded: { borderColor: colors.primarySoftBorder, borderWidth: 1 },
    sessionHeader: { alignItems: 'center', flexDirection: 'row', gap: 10, paddingVertical: 14 },
    sessionIcon: {
      alignItems: 'center',
      backgroundColor: colors.disciplineCompleted,
      borderRadius: 10,
      height: 38,
      justifyContent: 'center',
      marginLeft: 1,
      width: 38,
    },
    sessionText: { flex: 1 },
    sessionTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
    sessionMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    sessionDate: { color: colors.textTertiary, fontSize: 9, marginTop: 3 },
    sessionSummary: { alignItems: 'flex-end', gap: 3 },
    durationArea: { alignItems: 'center', flexDirection: 'row', gap: 4 },
    duration: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '900' },
    setCount: { color: colors.textTertiary, fontSize: 9, fontWeight: '700' },
    sessionDetails: { borderTopColor: colors.border, borderTopWidth: 1, gap: 18, padding: 14 },
    detailSummary: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    detailSummaryText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
    volumeText: { color: colors.accentText, fontSize: 11, fontWeight: '900' },
    exerciseGroup: { gap: 8 },
    exerciseHeading: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    exerciseIcon: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 7,
      borderWidth: 1,
      height: 28,
      justifyContent: 'center',
      width: 28,
    },
    exerciseName: { color: colors.text, flex: 1, fontSize: 13, fontWeight: '900' },
    exerciseSetCount: { color: colors.textTertiary, fontSize: 9, fontWeight: '700' },
    tableHeader: { flexDirection: 'row', paddingHorizontal: 3 },
    tableHeaderText: { color: colors.textTertiary, flex: 1, fontSize: 8, fontWeight: '900', textAlign: 'center' },
    setColumn: { flex: 0.55, textAlign: 'left' },
    setRow: {
      alignItems: 'center',
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      minHeight: 36,
      paddingHorizontal: 3,
    },
    setNumberCell: { alignItems: 'flex-start', flex: 0.55 },
    setNumberBadge: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 6,
      justifyContent: 'center',
      minWidth: 28,
      paddingVertical: 4,
    },
    setNumberText: { color: colors.primarySoftText, fontSize: 10, fontWeight: '900' },
    setValue: { color: colors.textSecondary, flex: 1, fontSize: 11, fontWeight: '700', textAlign: 'center' },
    noSetDetails: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingVertical: 6 },
    noSetDetailsText: { color: colors.textSecondary, flex: 1, fontSize: 11, lineHeight: 16 },
    emptyState: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 32 },
    emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    description: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    loadingText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
    pressed: { opacity: 0.72 },
  });
}
