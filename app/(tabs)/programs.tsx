import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { ThemeColors } from '@/constants/theme';
import { getWeekdayLabel } from '@/constants/weekdays';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getProgramVisual } from '@/utils/workout-visual';

export default function ProgramsScreen() {
  const { activateProgram, activeProgramId, programs } = useWorkout();
  const { colors } = useAppTheme();
  const styles = createStyles(colors);

  if (programs.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.emptyState}>
          <View style={styles.iconCircle}>
            <Ionicons name="barbell-outline" size={36} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>Henüz programın yok</Text>
          <Text style={styles.description}>
            Push, pull veya full body gibi ilk antrenman programını oluşturarak başlayabilirsin.
          </Text>
          <CreateButton />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Programların</Text>
            <Text style={styles.subtitle}>{programs.length} kayıtlı program</Text>
          </View>
          <CreateButton compact />
        </View>

        <View style={styles.programList}>
          {programs.map((program) => {
            const isActive = program.id === activeProgramId;

            return (
              <View key={program.id} style={[styles.programCard, isActive && styles.programCardActive]}>
                <Pressable
                  accessibilityHint="Program detaylarını açar"
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/program/[id]', params: { id: program.id } })}
                  style={({ pressed }) => [styles.programCardMain, pressed && styles.programCardPressed]}>
                  <View style={styles.programIcon}>
                    <WorkoutVisualDisplay
                      color={colors.primaryIcon}
                      size={28}
                      visual={getProgramVisual(program.visual, program.icon)}
                    />
                  </View>
                  <View style={styles.programInfo}>
                    <Text style={styles.programName}>{program.name}</Text>
                    <Text style={styles.programMeta}>{program.days.length} antrenman günü</Text>
                    <View style={styles.dayChips}>
                      {program.days.map((day) => (
                        <View key={day.id} style={[styles.dayChip, day.isOffDay && styles.offDayChip]}>
                          <Text style={[styles.dayChipText, day.isOffDay && styles.offDayChipText]}>
                            {getWeekdayLabel(day.scheduledWeekday).slice(0, 3)} · {day.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                </Pressable>

                {isActive ? (
                  <View style={styles.activeProgramRow}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.disciplineCompleted} />
                    <Text style={styles.activeProgramText}>Aktif program · Takvim bu programa göre işleniyor</Text>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => activateProgram(program.id)}
                    style={({ pressed }) => [styles.activateButton, pressed && styles.buttonPressed]}>
                    <Ionicons name="radio-button-off-outline" size={17} color={colors.primaryIcon} />
                    <Text style={styles.activateButtonText}>Aktif program yap</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.memoryNotice}>
          <Ionicons name="information-circle-outline" size={20} color={colors.infoIcon} />
          <Text style={styles.memoryNoticeText}>
            Bu aşamada programlar yalnızca uygulama açıkken saklanır. Kalıcı kayıt özelliğini daha sonra ekleyeceğiz.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CreateButton({ compact = false }: { compact?: boolean }) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/program/create')}
      style={({ pressed }) => [styles.button, compact && styles.compactButton, pressed && styles.buttonPressed]}>
      <Ionicons name="add" size={20} color={colors.onPrimary} />
      {!compact && <Text style={styles.buttonText}>Program oluştur</Text>}
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: 20, padding: 20 },
  emptyState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 32 },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 32,
    height: 64,
    justifyContent: 'center',
    marginBottom: 18,
    width: 64,
  },
  emptyTitle: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  description: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 25, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginTop: 3 },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 7,
    marginTop: 22,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  compactButton: { height: 44, marginTop: 0, paddingHorizontal: 12, paddingVertical: 0 },
  buttonPressed: { opacity: 0.78 },
  buttonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '700' },
  programList: { gap: 12 },
  programCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  programCardActive: { borderColor: colors.disciplineCompleted },
  programCardMain: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  programCardPressed: { opacity: 0.72 },
  programIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 13,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  programInfo: { flex: 1 },
  programName: { color: colors.text, fontSize: 18, fontWeight: '800' },
  programMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  dayChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  dayChip: { backgroundColor: colors.surfaceMuted, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  dayChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  offDayChip: { backgroundColor: colors.primarySoft },
  offDayChipText: { color: colors.disciplineCompleted },
  activeProgramRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  activeProgramText: { color: colors.disciplineCompleted, flex: 1, fontSize: 11, fontWeight: '800' },
  activateButton: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  activateButtonText: { color: colors.primaryIcon, fontSize: 12, fontWeight: '800' },
  memoryNotice: {
    alignItems: 'flex-start',
    backgroundColor: colors.infoSurface,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 9,
    padding: 14,
  },
  memoryNoticeText: { color: colors.infoText, flex: 1, fontSize: 13, lineHeight: 19 },
  });
}
