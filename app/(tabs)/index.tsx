import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DisciplineCalendar } from '@/components/discipline-calendar';
import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { ThemeColors } from '@/constants/theme';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { calculateDisciplineStreak, toDateKey } from '@/utils/discipline';
import { formatDuration } from '@/utils/workout-session';
import { getDayVisual } from '@/utils/workout-visual';

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
  const styles = createStyles(colors);
  const today = new Date();
  const todayKey = toDateKey(today);
  const disciplineStreak = calculateDisciplineStreak(disciplineStatuses);
  const activeProgram = programs.find((program) => program.id === activeProgramId);
  const todayDay = activeProgram?.days.find((day) => day.scheduledWeekday === today.getDay());
  const todaySession = workoutSessions.find(
    (session) => session.programId === activeProgram?.id && session.dayId === todayDay?.id && session.dateKey === todayKey,
  );
  const lastCompletedSession = [...workoutSessions]
    .filter((session) => session.status === 'completed')
    .sort((first, second) =>
      new Date(second.completedAt ?? second.startedAt).getTime() -
      new Date(first.completedAt ?? first.startedAt).getTime(),
    )[0];
  const lastProgram = programs.find((program) => program.id === lastCompletedSession?.programId);
  const lastDay = lastProgram?.days.find((day) => day.id === lastCompletedSession?.dayId);
  const flameScale = useRef(new Animated.Value(1)).current;
  const todayLabel = today
    .toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })
    .toLocaleUpperCase('tr-TR');

  useEffect(() => {
    if (disciplineStreak === 0) return;
    Animated.sequence([
      Animated.spring(flameScale, { friction: 4, toValue: 1.18, useNativeDriver: true }),
      Animated.spring(flameScale, { friction: 5, toValue: 1, useNativeDriver: true }),
    ]).start();
  }, [disciplineStreak, flameScale]);

  if (isProgramsLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Antrenman bilgilerin yükleniyor…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (programsError) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.loadingState}>
          <Ionicons name="cloud-offline-outline" size={42} color={colors.textTertiary} />
          <Text style={styles.errorTitle}>Antrenman bilgilerin yüklenemedi</Text>
          <Text style={styles.errorText}>{programsError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void refreshPrograms()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}>
            <Text style={styles.primaryButtonText}>Tekrar dene</Text>
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.overview}>
          <Text style={styles.eyebrow}>{todayLabel}</Text>
          <Text style={styles.title}>
            {programs.length === 0
              ? 'Antrenmanına hazır mısın?'
              : activeProgram
                ? activeProgram.name
                : 'Aktif programını seç'}
          </Text>

          <View style={styles.streakRow}>
            <Animated.View style={[styles.flameBadge, { transform: [{ scale: flameScale }] }]}>
              <View style={styles.flameGlow} />
              <Ionicons name="flame" size={34} color={colors.accentBright} />
              <View style={styles.flameSpark} />
            </Animated.View>
            <View>
              <Text style={styles.streakText}>{disciplineStreak} gün seri</Text>
              <Text style={styles.streakCaption}>Bugünkü planın seriyi belirler</Text>
            </View>
          </View>
        </View>

        {programs.length === 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/program/create')}
            style={({ pressed }) => [styles.primaryButton, styles.fullButton, pressed && styles.buttonPressed]}>
            <Ionicons name="add" size={21} color={colors.onPrimary} />
            <Text style={styles.primaryButtonText}>İlk programını oluştur</Text>
          </Pressable>
        ) : todayDay ? (
          <View style={styles.todaySection}>
            <Text style={styles.sectionLabel}>BUGÜN</Text>
            <Pressable
              accessibilityRole="button"
              onPress={openTodayWorkout}
              style={({ pressed }) => [styles.todayWorkout, pressed && styles.cardPressed]}>
              <View style={styles.todayVisual}>
                <WorkoutVisualDisplay
                  color={todayDay.isOffDay ? colors.primaryIcon : colors.accentText}
                  size={29}
                  visual={getDayVisual(todayDay.visual, activeProgram?.days.indexOf(todayDay) ?? 0)}
                />
              </View>
              <View style={styles.todayText}>
                <Text style={styles.todayTitle}>{todayDay.isOffDay ? 'Dinlenme günü' : todayDay.name}</Text>
                <Text style={styles.todayMeta}>
                  {todayDay.isOffDay
                    ? 'Programındaki planlı toparlanma günü'
                    : `${todayDay.exercises.length} egzersiz · ${todayDay.exercises.reduce((sum, exercise) => sum + exercise.targetSets, 0)} set`}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            </Pressable>
            {!todayDay.isOffDay && (
              <Pressable
                accessibilityRole="button"
                disabled={todaySession?.status === 'completed'}
                onPress={openTodayWorkout}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.fullButton,
                  todaySession?.status === 'completed' && styles.completedButton,
                  pressed && styles.buttonPressed,
                ]}>
                <Ionicons
                  name={todaySession?.status === 'completed' ? 'checkmark-circle' : todaySession ? 'play-forward' : 'play'}
                  size={20}
                  color={colors.onPrimary}
                />
                <Text style={styles.primaryButtonText}>
                  {todaySession?.status === 'completed'
                    ? 'Bugünkü antrenman tamamlandı'
                    : todaySession
                      ? 'Antrenmana devam et'
                      : 'Antrenmanı başlat'}
                </Text>
              </Pressable>
            )}
          </View>
        ) : activeProgram ? (
          <View style={styles.restNotice}>
            <Ionicons name="moon-outline" size={22} color={colors.primaryIcon} />
            <View style={styles.todayText}>
              <Text style={styles.todayTitle}>Bugün planlanmış antrenman yok</Text>
              <Text style={styles.todayMeta}>Toparlan ve bir sonraki antrenmana hazırlan.</Text>
            </View>
          </View>
        ) : null}

        <DisciplineCalendar />

        {lastCompletedSession && (
          <View style={styles.lastSection}>
            <Text style={styles.sectionLabel}>SON ANTRENMAN</Text>
            <View style={styles.lastWorkout}>
              <View style={styles.lastWorkoutIcon}>
                <Ionicons name="checkmark" size={19} color={colors.onPrimary} />
              </View>
              <View style={styles.todayText}>
                <Text style={styles.lastWorkoutTitle}>{lastDay?.name ?? 'Antrenman'}</Text>
                <Text style={styles.todayMeta}>{lastProgram?.name ?? 'Program'}</Text>
              </View>
              <View style={styles.durationArea}>
                <Ionicons name="stopwatch-outline" size={15} color={colors.accent} />
                <Text style={styles.durationText}>{formatDuration(lastCompletedSession.accumulatedDurationSeconds)}</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    loadingState: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center', padding: 32 },
    loadingText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
    errorTitle: { color: colors.text, fontSize: 20, fontWeight: '900', textAlign: 'center' },
    errorText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    container: { gap: 28, padding: 20, paddingBottom: 44 },
    overview: { gap: 5, paddingHorizontal: 1, paddingTop: 4 },
    eyebrow: { color: colors.accentBright, fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
    title: { color: colors.text, fontSize: 29, fontWeight: '900', lineHeight: 35 },
    streakRow: { alignItems: 'center', flexDirection: 'row', gap: 13, marginTop: 18 },
    flameBadge: {
      alignItems: 'center',
      borderColor: colors.accent,
      borderRadius: 18,
      borderWidth: 1,
      height: 56,
      justifyContent: 'center',
      overflow: 'hidden',
      shadowColor: colors.accentBright,
      shadowOffset: { height: 0, width: 0 },
      shadowOpacity: 0.35,
      shadowRadius: 10,
      width: 56,
    },
    flameGlow: {
      backgroundColor: colors.accentSoft,
      borderRadius: 22,
      height: 44,
      opacity: 0.82,
      position: 'absolute',
      width: 44,
    },
    flameSpark: {
      backgroundColor: colors.accentBright,
      borderRadius: 3,
      height: 5,
      position: 'absolute',
      right: 9,
      top: 8,
      width: 5,
    },
    streakText: { color: colors.text, fontSize: 20, fontWeight: '900' },
    streakCaption: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    sectionLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
    todaySection: { gap: 11 },
    todayWorkout: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderTopColor: colors.border,
      borderBottomWidth: 1,
      borderTopWidth: 1,
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 14,
    },
    todayVisual: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      height: 48,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 48,
    },
    todayText: { flex: 1 },
    todayTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
    todayMeta: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 10,
      flexDirection: 'row',
      gap: 8,
      height: 50,
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    fullButton: { alignSelf: 'stretch' },
    completedButton: { backgroundColor: colors.disciplineCompleted },
    primaryButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '900' },
    restNotice: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderTopColor: colors.border,
      borderBottomWidth: 1,
      borderTopWidth: 1,
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 16,
    },
    lastSection: { gap: 10 },
    lastWorkout: {
      alignItems: 'center',
      borderTopColor: colors.border,
      borderTopWidth: 1,
      flexDirection: 'row',
      gap: 11,
      paddingTop: 13,
    },
    lastWorkoutIcon: {
      alignItems: 'center',
      backgroundColor: colors.disciplineCompleted,
      borderRadius: 9,
      height: 38,
      justifyContent: 'center',
      width: 38,
    },
    lastWorkoutTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
    durationArea: { alignItems: 'center', flexDirection: 'row', gap: 4 },
    durationText: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '900' },
    buttonPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
    cardPressed: { opacity: 0.68 },
  });
}
