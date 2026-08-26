import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExerciseProgress } from '@/components/exercise-progress';
import { MotionSection, MotionSwap } from '@/components/motion-section';
import { ProgressRing } from '@/components/progress-ring';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { WorkoutProgram, WorkoutSession, WorkoutSetRecord } from '@/types/workout';
import { getSetTotalVolume } from '@/utils/workout-analytics';
import { dateFromKey } from '@/utils/workout-schedule';
import { formatDuration } from '@/utils/workout-session';

/**
 * Sola kaydırarak silme ölçüleri.
 *
 *   * `SWIPE_ACTION_WIDTH` — açıkken görünen kırmızı alanın genişliği.
 *   * `SWIPE_OPEN_THRESHOLD` — bu kadar kaydırılırsa satır AÇIK konuma oturur,
 *     altında kalırsa kapanır. İlk kaydırma yalnızca alanı açar.
 *   * `SWIPE_DELETE_THRESHOLD` — açık konumdan bu kadar DAHA sola kaydırılırsa
 *     düğmeye dokunmadan silme gerçekleşir.
 */
const SWIPE_ACTION_WIDTH = 96;
const SWIPE_OPEN_THRESHOLD = 44;
const SWIPE_DELETE_THRESHOLD = SWIPE_ACTION_WIDTH + 64;
const SWIPE_MAX_TRANSLATE = SWIPE_DELETE_THRESHOLD + 40;

type ExerciseSetGroup = {
  key: string;
  name: string;
  sets: WorkoutSetRecord[];
};

export default function HistoryScreen() {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const { deleteWorkoutSession, isProgramsLoading, programs, workoutSessions, workoutSets } = useWorkout();
  // Sağ üstteki görünüm geçişi Geçmiş ve Gelişim rengini kullanır.
  const historyAccent = useFeatureColor('historyProgress', colors.primary).color;
  /**
   * Üç istatistik çemberi BİRBİRİNDEN BAĞIMSIZ. Seçim yapılmazsa fallback'ler
   * bugünkü renklerdir; ekran bu görevden önceki görünümle birebir aynı kalır.
   * `historyProgress` ayrı kalır ve Progress alt görünümünü yönetmeye devam eder.
   */
  const workoutsRing = useFeatureColor('historyWorkoutsRing', colors.primary).color;
  const exercisesRing = useFeatureColor('historyExercisesRing', colors.disciplineCompleted).color;
  const durationRing = useFeatureColor('historyDurationRing', colors.accent).color;
  const styles = createStyles(colors, historyAccent);
  const [expandedSessionId, setExpandedSessionId] = useState<string>();
  /** Aynı anda yalnızca bir satırın silme alanı açık kalır. */
  const [swipedSessionId, setSwipedSessionId] = useState<string>();
  const [activeView, setActiveView] = useState<'workouts' | 'progress'>('workouts');
  /**
   * Ekran her açılışta ORTALAMA süreyle başlar. Çembere dokunma Average ↔ Total
   * geçişini aynen sürdürür; tercih bilinçli olarak kalıcı saklanmaz.
   */
  const [durationMode, setDurationMode] = useState<'average' | 'total'>('average');
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

  async function handleDeleteSession(sessionId: string) {
    setSwipedSessionId(undefined);
    try {
      await deleteWorkoutSession(sessionId);
    } catch (error) {
      // `deleteWorkoutSession` hata durumunda satırı geri koymuş olur.
      Alert.alert(
        t('history.deleteFailed'),
        error instanceof Error ? error.message : t('common.networkError'),
      );
    }
  }

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
        <MotionSection style={styles.header}>
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
        </MotionSection>

        <MotionSwap transitionKey={activeView}>
        {activeView === 'workouts' ? (
          <>
            <MotionSection delay={40} style={styles.ringRow}>
              <StatRing
                color={workoutsRing}
                colors={colors}
                label={t('history.workouts')}
                styles={styles}
                valueLabel={String(completedSessions.length)}
              />
              <StatRing
                color={exercisesRing}
                colors={colors}
                label={t('history.exercises')}
                styles={styles}
                valueLabel={String(uniqueExerciseCount)}
              />
              <StatRing
                accessibilityHint={t('history.durationToggleHint')}
                color={durationRing}
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
            </MotionSection>

            <MotionSection delay={80} style={styles.list}>
              {completedSessions.map((session) => (
                <SessionHistoryRow
                  colors={colors}
                  expanded={expandedSessionId === session.id}
                  isSwipeOpen={swipedSessionId === session.id}
                  key={session.id}
                  onDelete={() => void handleDeleteSession(session.id)}
                  onSwipeClosed={() =>
                    setSwipedSessionId((currentId) => (currentId === session.id ? undefined : currentId))
                  }
                  onSwipeStart={() => setSwipedSessionId(session.id)}
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
            </MotionSection>
          </>
        ) : (
          <MotionSection delay={40}>
            <ExerciseProgress workoutSets={completedWorkoutSets} />
          </MotionSection>
        )}
        </MotionSwap>
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

/**
 * Satırı sola kaydırınca sağda kırmızı silme alanını açan sarmalayıcı.
 *
 * Dikey liste kaydırması korunur: yatay hareket dikeyden belirgin biçimde
 * baskın olmadan pan yakalanmaz (`onMoveShouldSetPanResponder`).
 *
 * Aynı anda tek satır açık kalır: satır kaydırılmaya başlayınca üst bileşene
 * haber verilir, açık olan diğer satır kendini kapatır.
 *
 * `react-native-gesture-handler` yerine çekirdek `PanResponder` kullanılır;
 * böylece web'de de ek bir uyarlama gerekmez.
 */
function SwipeableSessionRow({
  accessibilityLabel,
  children,
  deleteLabel,
  isOpen,
  onDelete,
  onSwipeStart,
  onClosed,
  styles,
}: {
  accessibilityLabel: string;
  children: React.ReactNode;
  deleteLabel: string;
  isOpen: boolean;
  onDelete: () => void;
  onSwipeStart: () => void;
  onClosed: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  /** Satırın dinlenme konumu: 0 (kapalı) veya -SWIPE_ACTION_WIDTH (açık). */
  const restingOffset = useRef(0);

  const settle = useMemo(
    () => (toValue: number) => {
      restingOffset.current = toValue;
      Animated.spring(translateX, {
        bounciness: 0,
        toValue,
        useNativeDriver: true,
      }).start();
    },
    [translateX],
  );

  // Başka bir satır açılınca bu satır kapanır.
  useEffect(() => {
    if (!isOpen && restingOffset.current !== 0) settle(0);
  }, [isOpen, settle]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Yatay hareket dikeyin 1.5 katından fazla olmadıkça liste kaydırması
        // sahipliği bırakmaz.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderGrant: () => onSwipeStart(),
        onPanResponderMove: (_event, gesture) => {
          const next = Math.min(0, Math.max(-SWIPE_MAX_TRANSLATE, restingOffset.current + gesture.dx));
          translateX.setValue(next);
        },
        onPanResponderRelease: (_event, gesture) => {
          const next = restingOffset.current + gesture.dx;

          if (next <= -SWIPE_DELETE_THRESHOLD) {
            onDelete();
            settle(0);
            onClosed();
            return;
          }

          settle(next <= -SWIPE_OPEN_THRESHOLD ? -SWIPE_ACTION_WIDTH : 0);
          if (next > -SWIPE_OPEN_THRESHOLD) onClosed();
        },
        onPanResponderTerminate: () => settle(restingOffset.current),
      }),
    [onClosed, onDelete, onSwipeStart, settle, translateX],
  );

  return (
    <View style={styles.swipeContainer}>
      <View style={styles.swipeActionLayer}>
        <Pressable
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="button"
          onPress={() => {
            onDelete();
            settle(0);
            onClosed();
          }}
          style={({ pressed }) => [styles.swipeDeleteButton, pressed && styles.pressed]}>
          <Text numberOfLines={1} style={styles.swipeDeleteText}>
            {deleteLabel}
          </Text>
        </Pressable>
      </View>

      <Animated.View style={[styles.swipeSurface, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

function SessionHistoryRow({
  colors,
  expanded,
  isSwipeOpen,
  locale,
  onDelete,
  onSwipeClosed,
  onSwipeStart,
  onToggle,
  program,
  session,
  sets,
  styles,
  t,
}: {
  colors: ThemeColors;
  expanded: boolean;
  isSwipeOpen: boolean;
  locale: string;
  onDelete: () => void;
  onSwipeClosed: () => void;
  onSwipeStart: () => void;
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
  // Drop setler ana satırın içinde saklanır; toplam hacme onlar da dahildir.
  const totalVolume = sets.reduce((total, workoutSet) => total + getSetTotalVolume(workoutSet), 0);

  const workoutName = day?.name ?? t('history.completedWorkout');

  return (
    <View style={styles.sessionRowWrapper}>
      <SwipeableSessionRow
        accessibilityLabel={t('history.deleteWorkoutLabel', { name: workoutName })}
        deleteLabel={t('common.delete')}
        isOpen={isSwipeOpen}
        onClosed={onSwipeClosed}
        onDelete={onDelete}
        onSwipeStart={onSwipeStart}
        styles={styles}>
        <Pressable
          accessibilityHint={t('history.toggleHint')}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={onToggle}
          style={({ pressed }) => [styles.sessionRow, pressed && styles.pressed]}>
          <View style={styles.sessionText}>
            <Text numberOfLines={1} style={styles.sessionTitle}>
              {workoutName}
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
      </SwipeableSessionRow>

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
                  <View key={workoutSet.id}>
                    <View style={styles.setRow}>
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

                    {workoutSet.dropSets.map((dropSet, index) => (
                      <View key={`${workoutSet.id}-drop-${index}`} style={styles.dropSetHistoryRow}>
                        <Text style={styles.dropSetHistoryLabel}>
                          ↳ {t('history.dropSet', { number: index + 1 })}
                        </Text>
                        <Text style={styles.dropSetHistoryValue}>
                          {dropSet.weightKg === undefined
                            ? '—'
                            : `${formatDecimal(dropSet.weightKg, locale)} ${t('history.kg').toLocaleLowerCase(locale)}`}
                          {' × '}
                          {dropSet.repetitions} {t('history.reps').toLocaleLowerCase(locale)}
                        </Text>
                      </View>
                    ))}
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

function createStyles(colors: ThemeColors, historyAccent: string) {
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
    viewSwitchText: { color: historyAccent, fontSize: 13, fontWeight: '500' },
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
    /** Kırmızı alan satırın ARKASINDA durur; yüzey kaydıkça ortaya çıkar. */
    swipeContainer: { overflow: 'hidden', position: 'relative' },
    swipeActionLayer: {
      bottom: 0,
      justifyContent: 'center',
      position: 'absolute',
      right: 0,
      top: 0,
      width: SWIPE_ACTION_WIDTH,
    },
    swipeDeleteButton: {
      alignItems: 'center',
      backgroundColor: colors.danger,
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 8,
      width: '100%',
    },
    swipeDeleteText: { color: colors.onPrimary, ...Type.body, fontWeight: '600' },
    /** Opak zemin: kaydırılmadığında kırmızı alan görünmez. */
    swipeSurface: { backgroundColor: colors.background },
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
    dropSetHistoryRow: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      flexDirection: 'row',
      gap: 8,
      marginBottom: 4,
      marginLeft: 16,
      minHeight: 30,
      paddingHorizontal: 10,
    },
    dropSetHistoryLabel: { color: colors.accent, ...Type.footnote, fontWeight: '600' },
    dropSetHistoryValue: {
      color: colors.textSecondary,
      flex: 1,
      ...Type.footnote,
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    noSetDetails: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    noSetDetailsText: { color: colors.textSecondary, flex: 1, ...Type.footnote, lineHeight: 15 },
    pressed: { opacity: 0.6 },
  });
}
