import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemeColors } from '@/constants/theme';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatDuration } from '@/utils/workout-session';

export default function HistoryScreen() {
  const { colors } = useAppTheme();
  const { programs, workoutSessions } = useWorkout();
  const styles = createStyles(colors);
  const completedSessions = workoutSessions.filter((session) => session.status === 'completed');

  if (completedSessions.length > 0) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View>
            <Text style={styles.pageTitle}>Antrenman geçmişi</Text>
            <Text style={styles.pageSubtitle}>Tamamladığın antrenmanların süreleri burada saklanır.</Text>
          </View>

          <View style={styles.sessionList}>
            {completedSessions.map((session) => {
              const program = programs.find((item) => item.id === session.programId);
              const day = program?.days.find((item) => item.id === session.dayId);
              const completedDate = session.completedAt ? new Date(session.completedAt) : new Date(session.startedAt);

              return (
                <View key={session.id} style={styles.sessionCard}>
                  <View style={styles.sessionIcon}>
                    <Ionicons name="checkmark" size={20} color={colors.onPrimary} />
                  </View>
                  <View style={styles.sessionText}>
                    <Text style={styles.sessionTitle}>{day?.name ?? 'Antrenman'}</Text>
                    <Text style={styles.sessionMeta}>
                      {program?.name ?? 'Program'} ·{' '}
                      {completedDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                    </Text>
                  </View>
                  <View style={styles.durationArea}>
                    <Ionicons name="stopwatch-outline" size={15} color={colors.accent} />
                    <Text style={styles.duration}>{formatDuration(session.accumulatedDurationSeconds)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.emptyState}>
        <Ionicons name="calendar-outline" size={48} color={colors.textTertiary} />
        <Text style={styles.title}>Antrenman geçmişin burada görünecek</Text>
        <Text style={styles.description}>
          İlk antrenmanını tamamladıktan sonra setlerini ve gelişimini bu ekrandan takip edeceksin.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: 20, padding: 20, paddingBottom: 36 },
  pageTitle: { color: colors.text, fontSize: 25, fontWeight: '900' },
  pageSubtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  sessionList: { gap: 11 },
  sessionCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    padding: 14,
  },
  sessionIcon: {
    alignItems: 'center',
    backgroundColor: colors.disciplineCompleted,
    borderRadius: 11,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  sessionText: { flex: 1 },
  sessionTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  sessionMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  durationArea: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  duration: { color: colors.text, fontSize: 14, fontVariant: ['tabular-nums'], fontWeight: '900' },
  emptyState: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 32 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  description: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  });
}
