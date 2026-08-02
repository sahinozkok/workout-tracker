import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DisciplineCalendar } from '@/components/discipline-calendar';
import { ThemeColors } from '@/constants/theme';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { calculateDisciplineStreak } from '@/utils/discipline';

export default function HomeScreen() {
  const { activeProgramId, disciplineStatuses, programs } = useWorkout();
  const { colors } = useAppTheme();
  const styles = createStyles(colors);
  const disciplineStreak = calculateDisciplineStreak(disciplineStatuses);
  const activeProgram = programs.find((program) => program.id === activeProgramId);
  const todayLabel = new Date()
    .toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })
    .toLocaleUpperCase('tr-TR');

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{todayLabel}</Text>
          <Text style={styles.title}>
            {programs.length === 0
              ? 'Antrenmanına hazır mısın?'
              : activeProgram
                ? `${activeProgram.name} aktif`
                : 'Aktif programını seç'}
          </Text>
          <Text style={styles.subtitle}>
            {programs.length === 0
              ? 'İlk programını oluştur. Hareketleri ve setlerini sonraki adımlarda birlikte ekleyeceğiz.'
              : activeProgram
                ? 'Disiplin takvimi ve set ilerlemesi bu programın haftalık planına göre hesaplanıyor.'
                : 'Programlar sekmesinden takvimde kullanılacak programı aktif hale getir.'}
          </Text>

          {programs.length === 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/program/create')}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}>
              <Ionicons name="add-circle-outline" size={22} color={colors.onPrimary} />
              <Text style={styles.primaryButtonText}>İlk programını oluştur</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.sectionTitle}>Genel durum</Text>
        <View style={styles.statsRow}>
          <StatCard label="Program" value={String(programs.length)} icon="barbell-outline" />
          <StatCard label="Seri" value={`${disciplineStreak} gün`} icon="flame-outline" tone="accent" />
        </View>

        <DisciplineCalendar />

        <View style={styles.infoCard}>
          <View style={styles.infoIcon}>
            <Ionicons name="calendar-outline" size={24} color={colors.primaryIcon} />
          </View>
          <View style={styles.infoText}>
            <Text style={styles.infoTitle}>Takvimi nasıl kullanırsın?</Text>
            <Text style={styles.infoBody}>
              Aktif programındaki tamamlanan setler takvime otomatik işlenir. Off day yalnızca tarihi
              geldiğinde yeşil olur; diğer günleri kutuya dokunarak elle işaretleyebilirsin.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type StatCardProps = {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: 'primary' | 'accent';
};

function StatCard({ label, value, icon, tone = 'primary' }: StatCardProps) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);

  return (
    <View style={styles.statCard}>
      <Ionicons name={icon} size={22} color={tone === 'accent' ? colors.accent : colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 22 },
  hero: { backgroundColor: colors.primaryStrong, borderRadius: 24, padding: 24, gap: 12 },
  eyebrow: { color: colors.accentBright, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.onPrimary, fontSize: 30, lineHeight: 36, fontWeight: '800' },
  subtitle: { color: colors.heroText, fontSize: 16, lineHeight: 23 },
  primaryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  buttonPressed: { opacity: 0.78 },
  primaryButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 5,
  },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '800' },
  statLabel: { color: colors.textSecondary, fontSize: 12 },
  infoCard: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primarySoftBorder,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  infoIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  infoText: { flex: 1, gap: 4 },
  infoTitle: { color: colors.primarySoftText, fontSize: 16, fontWeight: '800' },
  infoBody: { color: colors.primarySoftText, fontSize: 14, lineHeight: 20 },
  });
}
