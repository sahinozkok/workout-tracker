import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExerciseProgress } from '@/components/exercise-progress';
import { ProgressRing } from '@/components/progress-ring';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
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
  const { locale, t } = useTranslation();
  const { isProgramsLoading, programs, workoutSessions, workoutSets } = useWorkout();
  const styles = createStyles(colors);
  const [expandedSessionId, setExpandedSessionId] = useState<string>();
  const [activeView, setActiveView] = useState<'workouts' | 'progress'>('workouts');
  const [durationMode, setDurationMode] = useState<'average' | 'total'>('total');
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
  const averageDurationSeconds =
    completedSessions.length > 0 ? Math.round(totalDurationSeconds / completedSessions.length) : 0;
  const uniqueExerciseCount = new Set(
    completedWorkoutSets.map((workoutSet) => workoutSet.exerciseName.trim().toLocaleLowerCase(locale)),
  ).size;

  if (isProgramsLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.centerStateText}>{t('history.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (completedSessions.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <Ionicons name="time-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.centerStateTitle}>{t('history.emptyTitle')}</Text>
          <Text style={styles.centerStateText}>{t('history.emptyBody')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <Text style={styles.eyebrow}>{t('history.eyebrow')}</Text>
            <Pressable
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => setActiveView((current) => (current === 'workouts' ? 'progress' : 'workouts'))}
              style={({ pressed }) => [styles.viewSwitch, pressed && styles.pressed]}>
              <Text style={styles.viewSwitchText}>
                {activeView === 'workouts' ? t('history.progressView') : t('history.workoutsView')}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.title}>{t('history.title')}</Text>
          <Text style={styles.description}>
            {activeView === 'workouts' ? t('history.workoutsDescription') : t('history.progressDescription')}
          </Text>
        </View>

        {activeView === 'workouts' ? (
          <>
            <View style={styles.ringRow}>
              <StatRing
                color={colors.primary}
                colors={colors}
                label={t('history.workouts')}
                styles={styles}
                valueLabel={String(completedSessions.length)}
              />
              <StatRing
                color={colors.disciplineCompleted}
                colors={colors}
                label={t('history.exercises')}
                styles={styles}
                valueLabel={String(uniqueExerciseCount)}
              />
              <StatRing
                accessibilityHint={t('history.durationToggleHint')}
                color={colors.accent}
                colors={colors}
                label={
                  durationMode === 'total' ? t('history.totalDuration') : t('history.averageDuration')
                }
                onPress={() =>
                  setDurationMode((current) => (current === 'total' ? 'average' : 'total'))
                }
                styles={styles}
                valueLabel={formatCompactDuration(
                  durationMode === 'total' ? totalDurationSeconds : averageDurationSeconds,
                )}
              />
            </View>

            <View style={styles.list}>
              {completedSessions.map((session) => (
                <SessionHistoryRow
                  colors={colors}
                  expanded={expandedSessionId === session.id}
                  key={session.id}
                  onToggle={() =>
                    setExpandedSessionId((currentId) => (currentId === session.id ? undefined : session.id))
                  }
                  program={programs.find((item) => item.id === session.programId)}
                  session={session}
                  locale={locale}
                  sets={workoutSets.filter((workoutSet) => workoutSet.sessionId === session.id)}
                  styles={styles}
                  t={t}
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

function StatRing({
  accessibilityHint,
  color,
  colors,
  label,
  onPress,
  styles,
  valueLabel,
}: {
  accessibilityHint?: string;
  color: string;
  colors: ThemeColors;
  label: string;
  onPress?: () => void;
  styles: ReturnType<typeof createStyles>;
  valueLabel: string;
}) {
  const content = (
    <>
      <ProgressRing
        color={color}
        progress={1}
        size={68}
        strokeWidth={5}
        trackColor={colors.surfaceMuted}>
        <Text numberOfLines={1} style={styles.ringValue}>
          {valueLabel}
        </Text>
      </ProgressRing>
      <View style={styles.ringLabelRow}>
        <Text numberOfLines={1} style={styles.ringLabel}>
          {label}
        </Text>
        {onPress && <Ionicons color={colors.textTertiary} name="swap-horizontal" size={11} />}
      </View>
    </>
  );

  if (!onPress) return <View style={styles.ringItem}>{content}</View>;

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={`${label}: ${valueLabel}`}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.ringItem, pressed && styles.ringItemPressed]}>
      {content}
    </Pressable>
  );
}

function SessionHistoryRow({
  colors,
  expanded,
  locale,
  onToggle,
  program,
  session,
  sets,
  styles,
  t,
}: {
  colors: ThemeColors;
  expanded: boolean;
  locale: string;
  onToggle: () => void;
  program?: WorkoutProgram;
  session: WorkoutSession;
  sets: WorkoutSetRecord[];
  styles: ReturnType<typeof createStyles>;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const day = program?.days.find((item) => item.id === session.dayId);
  const sessionDate = dateFromKey(session.dateKey);
  const exerciseGroups = groupSetsByExercise(sets);
  const totalVolume = sets.reduce(
    (total, workoutSet) => total + (workoutSet.weightKg ?? 0) * (workoutSet.repetitions ?? 0),
    0,
  );

  return (
    <View style={styles.sessionRowWrapper}>
      <Pressable
        accessibilityHint={t('history.toggleHint')}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.sessionRow, pressed && styles.pressed]}>
        <View style={styles.sessionText}>
          <Text numberOfLines={1} style={styles.sessionTitle}>
            {day?.name ?? t('history.completedWorkout')}
          </Text>
          <Text numberOfLines={1} style={styles.sessionDate}>
            {sessionDate.toLocaleDateString(locale, {
              day: 'numeric',
              month: 'long',
              weekday: 'long',
              year: 'numeric',
            })}
          </Text>
        </View>
        <View style={styles.sessionSummary}>
          <Text style={styles.sessionDuration}>{formatDuration(session.accumulatedDurationSeconds)}</Text>
          <Text style={styles.sessionSetCount}>{t('history.setCount', { count: sets.length })}</Text>
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.sessionDetails}>
          <View style={styles.detailSummary}>
            <Text style={styles.detailSummaryText}>{program?.name ?? t('history.deletedProgram')}</Text>
            {totalVolume > 0 && (
              <Text style={styles.volumeText}>{t('history.volume', { value: formatDecimal(totalVolume, locale) })}</Text>
            )}
          </View>

          {exerciseGroups.length > 0 ? (
            exerciseGroups.map((group) => (
              <View key={group.key} style={styles.exerciseGroup}>
                <View style={styles.exerciseHeading}>
                  <Text numberOfLines={1} style={styles.exerciseName}>
                    {group.name}
                  </Text>
                  <Text style={styles.exerciseSetCount}>{t('history.setCount', { count: group.sets.length })}</Text>
                </View>

                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderText, styles.setColumn]}>{t('history.set')}</Text>
                  <Text style={styles.tableHeaderText}>{t('history.kg')}</Text>
                  <Text style={styles.tableHeaderText}>{t('history.reps')}</Text>
                  <Text style={styles.tableHeaderText}>{t('history.rpe')}</Text>
                </View>

                {group.sets.map((workoutSet) => (
                  <View key={workoutSet.id} style={styles.setRow}>
                    <Text style={[styles.setValue, styles.setColumn, styles.setNumberText]}>
                      {workoutSet.setNumber}
                    </Text>
                    <Text style={styles.setValue}>
                      {workoutSet.weightKg === undefined ? '—' : formatDecimal(workoutSet.weightKg, locale)}
                    </Text>
                    <Text style={styles.setValue}>{workoutSet.repetitions ?? '—'}</Text>
                    <Text style={styles.setValue}>
                      {workoutSet.rpe === undefined ? '—' : formatDecimal(workoutSet.rpe, locale)}
                    </Text>
                  </View>
                ))}
              </View>
            ))
          ) : (
            <View style={styles.noSetDetails}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textTertiary} />
              <Text style={styles.noSetDetailsText}>{t('history.noSetDetails')}</Text>
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

function formatDecimal(value: number, locale: string) {
  return value.toLocaleString(locale, { maximumFractionDigits: 2 });
}

function formatCompactDuration(totalSeconds: number) {
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}dk`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return minutes > 0 ? `${hours}sa ${minutes}dk` : `${hours}sa`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 40, paddingHorizontal: Layout.screenPadding, paddingTop: 16 },
    centerState: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 32 },
    centerStateTitle: { color: colors.text, fontSize: 19, fontWeight: '600', textAlign: 'center' },
    centerStateText: { color: colors.textSecondary, ...Type.caption, textAlign: 'center' },
    header: { gap: 8, marginBottom: 26 },
    headerTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    eyebrow: { color: colors.textSecondary, ...Type.eyebrow },
    viewSwitch: { justifyContent: 'center', minHeight: 28 },
    viewSwitchText: { color: colors.primary, fontSize: 13, fontWeight: '500' },
    title: { color: colors.text, ...Type.pageTitle },
    description: { color: colors.textSecondary, ...Type.caption },
    ringRow: { flexDirection: 'row', gap: 12, marginBottom: 26 },
    ringItem: { alignItems: 'center', flex: 1, gap: 10 },
    ringItemPressed: { opacity: 0.65 },
    ringValue: { color: colors.text, fontSize: 17, fontWeight: '500' },
    ringLabelRow: { alignItems: 'center', flexDirection: 'row', gap: 3, justifyContent: 'center' },
    ringLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 12 },
    list: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth },
    sessionRowWrapper: {
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sessionRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 64, paddingVertical: 14 },
    sessionText: { flex: 1, gap: 4 },
    sessionTitle: { color: colors.text, ...Type.rowTitle },
    sessionDate: { color: colors.textSecondary, ...Type.caption },
    sessionSummary: { alignItems: 'flex-end', gap: 4 },
    sessionDuration: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] },
    sessionSetCount: { color: colors.textSecondary, ...Type.footnote },
    sessionDetails: { gap: 16, paddingBottom: 18 },
    detailSummary: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    detailSummaryText: { color: colors.textSecondary, ...Type.footnote },
    volumeText: { color: colors.accent, ...Type.footnote, fontWeight: '500' },
    exerciseGroup: { gap: 6 },
    exerciseHeading: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    exerciseName: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '500' },
    exerciseSetCount: { color: colors.textTertiary, ...Type.footnote },
    tableHeader: { flexDirection: 'row' },
    tableHeaderText: {
      color: colors.textTertiary,
      flex: 1,
      fontSize: 9,
      fontWeight: '600',
      letterSpacing: 0.4,
      textAlign: 'center',
    },
    setColumn: { flex: 0.5, textAlign: 'left' },
    setRow: {
      alignItems: 'center',
      borderTopColor: colors.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      minHeight: 34,
    },
    setNumberText: { color: colors.textTertiary },
    setValue: { color: colors.textSecondary, flex: 1, fontSize: 12, textAlign: 'center' },
    noSetDetails: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    noSetDetailsText: { color: colors.textSecondary, flex: 1, ...Type.footnote, lineHeight: 15 },
    pressed: { opacity: 0.6 },
  });
}
