import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DisciplineCalendar } from '@/components/discipline-calendar';
import { MotionSection } from '@/components/motion-section';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { calculateDisciplineStreak, toDateKey } from '@/utils/discipline';
import { buildWorkoutEstimate, WorkoutEstimate } from '@/utils/workout-estimate';
import { formatDuration } from '@/utils/workout-session';
import { exerciseTargetUnits } from '@/utils/workout-tracking';

export default function HomeScreen() {
  const {
    activeProgramId,
    disciplineStatuses,
    isProgramsLoading,
    programs,
    programsError,
    refreshPrograms,
    workoutSessions,
  } = useWorkout();
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const styles = createStyles(colors);
  const today = new Date();
  const todayKey = toDateKey(today);
  const disciplineStreak = calculateDisciplineStreak(disciplineStatuses);
  const activeProgram = programs.find((program) => program.id === activeProgramId);
  const todayDay = activeProgram?.days.find((day) => day.scheduledWeekday === today.getDay());
  const todaySession = workoutSessions.find(
    (session) =>
      session.programId === activeProgram?.id && session.dayId === todayDay?.id && session.dateKey === todayKey,
  );
  const lastCompletedSession = [...workoutSessions]
    .filter((session) => session.status === 'completed')
    .sort(
      (first, second) =>
        new Date(second.completedAt ?? second.startedAt).getTime() -
        new Date(first.completedAt ?? first.startedAt).getTime(),
    )[0];
  const lastProgram = programs.find((program) => program.id === lastCompletedSession?.programId);
  const lastDay = lastProgram?.days.find((day) => day.id === lastCompletedSession?.dayId);
  const weekdayLabel = today.toLocaleDateString(locale, { weekday: 'long' }).toLocaleUpperCase(locale);
  const monthLabel = today.toLocaleDateString(locale, { month: 'long' });

  const [, setEstimateTick] = useState(0);
  // Tahmin YALNIZCA planlı (dinlenme olmayan) bir gün için türetilir; geçmiş
  // örnek yoksa veya bugün tamamlandıysa çekirdek `undefined` döndürür.
  const workoutEstimate =
    activeProgram && todayDay && !todayDay.isOffDay
      ? buildWorkoutEstimate({
          sessions: workoutSessions,
          programId: activeProgram.id,
          dayId: todayDay.id,
          currentSession: todaySession,
          now: Date.now(),
        })
      : undefined;
  const estimateStatus = workoutEstimate?.status;

  /**
   * Yalnız RENDER YENİLEYİCİ. Hem "şimdi başlarsan" saatini hem de çalışan
   * antrenmanın kalan süresini en fazla 30 saniyede bir tazeler. Duraklatılmış
   * tahminde zaman ilerlemediği, tahmin yokken de gösterilecek değer olmadığı
   * için interval kurulmaz. Süre KAYNAĞI sayaç değil, her render'daki `now`dır.
   */
  useEffect(() => {
    if (!estimateStatus || estimateStatus === 'paused') return;
    const interval = setInterval(() => setEstimateTick((tick) => tick + 1), 30_000);
    return () => clearInterval(interval);
  }, [estimateStatus]);

  if (isProgramsLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.centerStateText}>{t('home.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (programsError) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.centerStateTitle}>{t('home.loadErrorTitle')}</Text>
          <Text style={styles.centerStateText}>{programsError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void refreshPrograms()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  function openTodayWorkout() {
    if (!activeProgram || !todayDay) return;
    void Haptics.selectionAsync();
    router.push({ pathname: '/program/[id]/day/[dayId]', params: { id: activeProgram.id, dayId: todayDay.id } });
  }

  const startLabel =
    todaySession?.status === 'completed'
      ? t('home.workoutDone')
      : todaySession
        ? t('home.resumeWorkout')
        : t('home.startWorkout');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MotionSection style={styles.header}>
          <View style={styles.headerTopRow}>
            <Text style={styles.weekday}>{weekdayLabel}</Text>
            {disciplineStreak > 0 && (
              <View style={styles.streak}>
                <View style={styles.streakDot} />
                <Text style={styles.streakText}>{t('home.streakDays', { count: disciplineStreak })}</Text>
              </View>
            )}
          </View>
          <View style={styles.dateRow}>
            <Text style={styles.dayNumber}>{today.getDate()}</Text>
            <Text style={styles.monthName}>{monthLabel}</Text>
          </View>
          <Text numberOfLines={2} style={styles.programName}>
            {programs.length === 0
              ? t('home.readyQuestion')
              : activeProgram
                ? activeProgram.name
                : t('home.chooseActiveProgram')}
          </Text>
        </MotionSection>

        {programs.length === 0 ? (
          <MotionSection delay={40} style={styles.card}>
            <Text style={styles.cardEyebrow}>{t('home.start')}</Text>
            <Text style={styles.cardTitle}>{t('home.firstProgram')}</Text>
            <Text style={styles.cardMeta}>{t('home.firstProgramBody')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/program/create')}
              style={({ pressed }) => [styles.startButton, pressed && styles.pressed]}>
              <Ionicons name="add" size={18} color={colors.background} />
              <Text style={styles.startButtonText}>{t('home.createProgram')}</Text>
            </Pressable>
          </MotionSection>
        ) : todayDay ? (
          <MotionSection delay={40} style={styles.card}>
            <Text style={styles.cardEyebrow}>{t('home.todayWorkout')}</Text>
            <Text style={styles.cardTitle}>{todayDay.isOffDay ? t('home.restDay') : todayDay.name}</Text>
            <Text style={styles.cardMeta}>
              {todayDay.isOffDay
                ? t('home.restDayBody')
                : t('home.exerciseSetSummary', {
                    exercises: todayDay.exercises.length,
                    sets: todayDay.exercises.reduce((total, exercise) => total + exerciseTargetUnits(exercise), 0),
                  })}
            </Text>
            {/* Süre tahmini: egzersiz/set özetinin ALTINDA, başlat düğmesinden
                görsel olarak daha düşük öncelikli ince bir bilgi satırı. Geçmiş
                örnek yoksa `workoutEstimate` undefined olur ve satır hiç çizilmez. */}
            {!todayDay.isOffDay && workoutEstimate && (
              <View accessible accessibilityLabel={getEstimateLines(workoutEstimate, t, locale).join('. ')} style={styles.estimateRow}>
                <Ionicons color={colors.textSecondary} name="time-outline" size={13} style={styles.estimateIcon} />
                <View style={styles.estimateTextGroup}>
                  {getEstimateLines(workoutEstimate, t, locale).map((line, index) => (
                    <Text key={index} style={styles.estimateText}>
                      {line}
                    </Text>
                  ))}
                </View>
              </View>
            )}
            {!todayDay.isOffDay && (
              <Pressable
                accessibilityRole="button"
                disabled={todaySession?.status === 'completed'}
                onPress={openTodayWorkout}
                style={({ pressed }) => [
                  styles.startButton,
                  todaySession?.status === 'completed' && styles.startButtonDone,
                  pressed && styles.pressed,
                ]}>
                <Ionicons
                  name={
                    todaySession?.status === 'completed'
                      ? 'checkmark'
                      : todaySession
                        ? 'play-forward'
                        : 'play'
                  }
                  size={16}
                  color={todaySession?.status === 'completed' ? colors.textSecondary : colors.background}
                />
                <Text
                  style={[
                    styles.startButtonText,
                    todaySession?.status === 'completed' && styles.startButtonTextDone,
                  ]}>
                  {startLabel}
                </Text>
              </Pressable>
            )}
            {todayDay.isOffDay && (
              <Pressable
                accessibilityRole="button"
                onPress={openTodayWorkout}
                style={({ pressed }) => [styles.secondaryLink, pressed && styles.pressed]}>
                <Text style={styles.secondaryLinkText}>{t('home.openDay')}</Text>
              </Pressable>
            )}
          </MotionSection>
        ) : activeProgram ? (
          <MotionSection delay={40} style={styles.card}>
            <Text style={styles.cardEyebrow}>{t('home.today')}</Text>
            <Text style={styles.cardTitle}>{t('home.noPlannedWorkout')}</Text>
            <Text style={styles.cardMeta}>{t('home.noPlannedWorkoutBody')}</Text>
          </MotionSection>
        ) : (
          <MotionSection delay={40} style={styles.card}>
            <Text style={styles.cardEyebrow}>{t('home.activeProgram')}</Text>
            <Text style={styles.cardTitle}>{t('home.noActiveProgram')}</Text>
            <Text style={styles.cardMeta}>{t('home.noActiveProgramBody')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/programs')}
              style={({ pressed }) => [styles.startButton, pressed && styles.pressed]}>
              <Text style={styles.startButtonText}>{t('home.goToPrograms')}</Text>
            </Pressable>
          </MotionSection>
        )}

        <MotionSection delay={80}>
          <DisciplineCalendar />
        </MotionSection>

        {lastCompletedSession && (
          <MotionSection delay={120} style={styles.lastSection}>
            <View style={styles.lastRow}>
              <View style={styles.lastIcon}>
                <Ionicons name="checkmark" size={15} color={colors.background} />
              </View>
              <View style={styles.lastText}>
                <Text style={styles.lastTitle}>{t('home.lastWorkout', { name: lastDay?.name ?? t('home.workout') })}</Text>
                <Text numberOfLines={1} style={styles.lastMeta}>
                  {lastProgram?.name ?? t('home.deletedProgram')}
                </Text>
              </View>
              <Text style={styles.lastDuration}>
                {formatDuration(lastCompletedSession.accumulatedDurationSeconds)}
              </Text>
            </View>
          </MotionSection>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Metin uygulama dilini, saat çevrimi ise cihazın 12/24 saat tercihini izler.
 * Yalnız `hour12` yazmamak yeterli değildir: `locale='en'` kendi başına 12 saat
 * varsayımına geçebilir. Bu yüzden sistem formatter'ının çözdüğü hourCycle açıkça
 * uygulama dilindeki formatter'a aktarılır.
 */
function formatFinishTime(finishAt: number, locale: string) {
  const systemHourCycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return new Date(finishAt).toLocaleTimeString(locale, {
    hour: 'numeric',
    hourCycle: systemHourCycle,
    minute: '2-digit',
  });
}

/**
 * Tahmin durumuna göre gösterilecek metin satırları. Dakikaya yuvarlar ve
 * negatif/"şimdi biter" göstermez: `exceeded` durumunda yalnız tek satır döner.
 */
function getEstimateLines(
  estimate: WorkoutEstimate,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: string,
): string[] {
  if (estimate.exceeded) return [t('home.estimateExceeded')];

  const remainingMinutes = Math.max(1, Math.round(estimate.remainingSeconds / 60));

  if (estimate.status === 'not_started') {
    const averageMinutes = Math.max(1, Math.round(estimate.averageSeconds / 60));
    const lines = [t('home.estimateApproxDuration', { minutes: averageMinutes })];
    if (estimate.finishAt !== undefined) {
      lines.push(t('home.estimateStartFinish', { time: formatFinishTime(estimate.finishAt, locale) }));
    }
    return lines;
  }

  if (estimate.status === 'running' && estimate.finishAt !== undefined) {
    return [
      t('home.estimateRunningFinish', {
        time: formatFinishTime(estimate.finishAt, locale),
        minutes: remainingMinutes,
      }),
    ];
  }

  // `paused` (aşılmamış): kesin bitiş saati verilmez.
  return [t('home.estimatePausedRemaining', { minutes: remainingMinutes })];
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { gap: 26, paddingBottom: 36, paddingHorizontal: Layout.screenPadding, paddingTop: 12 },
    centerState: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 32 },
    centerStateTitle: { color: colors.text, fontSize: 19, fontWeight: '600', textAlign: 'center' },
    centerStateText: { color: colors.textSecondary, ...Type.caption, textAlign: 'center' },
    header: { gap: 2 },
    headerTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    weekday: { color: colors.textSecondary, ...Type.eyebrow },
    streak: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    streakDot: { backgroundColor: colors.accent, borderRadius: 3, height: 6, width: 6 },
    streakText: { color: colors.accent, fontSize: 12, fontWeight: '500' },
    dateRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 8, marginTop: 2 },
    dayNumber: { color: colors.text, fontSize: 52, fontWeight: '200', lineHeight: 58 },
    monthName: { color: colors.text, fontSize: 20, fontWeight: '300', paddingBottom: 10 },
    programName: { color: colors.text, ...Type.rowTitle, marginTop: 10 },
    card: {
      backgroundColor: colors.card,
      borderRadius: Layout.radiusLarge,
      gap: 4,
      padding: 20,
    },
    cardEyebrow: { color: colors.textSecondary, ...Type.eyebrow },
    cardTitle: { color: colors.text, fontSize: 28, fontWeight: '600', marginTop: 6 },
    cardMeta: { color: colors.textSecondary, ...Type.caption },
    estimateRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 6, marginTop: 8 },
    estimateIcon: { marginTop: 1 },
    estimateTextGroup: { flex: 1, gap: 1 },
    estimateText: { color: colors.textSecondary, ...Type.footnote, fontVariant: ['tabular-nums'] },
    startButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: colors.text,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 8,
      marginTop: 18,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    startButtonDone: { backgroundColor: colors.surfaceMuted },
    startButtonText: { color: colors.background, fontSize: 15, fontWeight: '600' },
    startButtonTextDone: { color: colors.textSecondary },
    secondaryLink: { alignSelf: 'flex-start', marginTop: 14, minHeight: 32, justifyContent: 'center' },
    /**
     * Dinlenme günü "Günü aç" bağlantısı. Renk `colors.primary`'den (iOS sistem
     * mavisi #007AFF / #0A84FF) ana sayfanın kendi hiyerarşisindeki nötr metin
     * rengine alındı: kart içindeki diğer bütün içerik `colors.text` ve
     * `colors.textSecondary` kullanırken tek mavi öğe buydu.
     *
     * Kontrast da düzelir: kart zemininde (#F2F2F7 / #131315) ölçülen oran
     * mavi için 3.60 (açık) ile WCAG AA normal metin eşiğinin ALTINDAYDI;
     * `colors.text` 18.82 (açık) ve 15.02 (koyu) verir.
     *
     * `fontWeight: '500'` korunur — bağlantı, `cardMeta` gövde metninden
     * ağırlıkla ayrışmaya devam eder. Genel `primary` rengine ve başka
     * ekranlardaki bağlantı stillerine (ör. `app/(auth)/confirm.tsx` kendi
     * ayrı StyleSheet'ini kullanır) DOKUNULMAZ.
     */
    secondaryLinkText: { color: colors.text, fontSize: 15, fontWeight: '500' },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusMedium,
      justifyContent: 'center',
      marginTop: 8,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    primaryButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },
    lastSection: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 18 },
    lastRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    lastIcon: {
      alignItems: 'center',
      backgroundColor: colors.disciplineCompleted,
      borderRadius: 13,
      height: 26,
      justifyContent: 'center',
      width: 26,
    },
    lastText: { flex: 1 },
    lastTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
    lastMeta: { color: colors.textSecondary, ...Type.footnote, marginTop: 2 },
    lastDuration: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'], fontWeight: '400' },
    pressed: { opacity: 0.7 },
  });
}
