import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { ThemeColors } from '@/constants/theme';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getProgramVisual } from '@/utils/workout-visual';

export default function ProgramsScreen() {
  const { created } = useLocalSearchParams<{ created?: string }>();
  const {
    activateProgram,
    activeProgramId,
    deleteProgram,
    isProgramsLoading,
    programs,
    programsError,
    refreshPrograms,
  } = useWorkout();
  const { colors } = useAppTheme();
  const styles = createStyles(colors);
  const [activatingProgramId, setActivatingProgramId] = useState<string>();
  const [deletingProgramId, setDeletingProgramId] = useState<string>();
  const [showCreatedNotice, setShowCreatedNotice] = useState(created === '1');

  useEffect(() => {
    if (created !== '1') return;
    setShowCreatedNotice(true);
    const timeout = setTimeout(() => setShowCreatedNotice(false), 2400);
    return () => clearTimeout(timeout);
  }, [created]);

  async function handleActivateProgram(programId: string) {
    setActivatingProgramId(programId);
    try {
      await activateProgram(programId);
    } catch (error) {
      Alert.alert(
        'Aktif program değiştirilemedi',
        error instanceof Error ? error.message : 'Lütfen internet bağlantını kontrol edip tekrar dene.',
      );
    } finally {
      setActivatingProgramId(undefined);
    }
  }

  function openProgramMenu(programId: string, programName: string, isActive: boolean) {
    Alert.alert(programName, 'Program için yapmak istediğin işlemi seç.', [
      { text: 'Vazgeç', style: 'cancel' },
      ...(!isActive
        ? [{ text: 'Aktif program yap', onPress: () => void handleActivateProgram(programId) }]
        : []),
      {
        text: 'Düzenle',
        onPress: () => router.push({ pathname: '/program/[id]', params: { id: programId } }),
      },
      {
        text: 'Sil',
        style: 'destructive' as const,
        onPress: () => confirmDeleteProgram(programId, programName, isActive),
      },
    ]);
  }

  function confirmDeleteProgram(programId: string, programName: string, isActive: boolean) {
    Alert.alert(
      'Programı sil',
      `“${programName}” ve içindeki günler silinecek.${isActive ? ' Bu program şu anda aktif.' : ''}`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Programı sil',
          style: 'destructive',
          onPress: () => void handleDeleteProgram(programId),
        },
      ],
    );
  }

  async function handleDeleteProgram(programId: string) {
    setDeletingProgramId(programId);
    try {
      await deleteProgram(programId);
    } catch (error) {
      Alert.alert(
        'Program silinemedi',
        error instanceof Error ? error.message : 'Lütfen internet bağlantını kontrol edip tekrar dene.',
      );
    } finally {
      setDeletingProgramId(undefined);
    }
  }

  if (isProgramsLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Programların yükleniyor…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (programsError) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.emptyState}>
          <Ionicons name="cloud-offline-outline" size={42} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>Programlar yüklenemedi</Text>
          <Text style={styles.description}>{programsError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void refreshPrograms()}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
            <Text style={styles.buttonText}>Tekrar dene</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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

        {showCreatedNotice && (
          <View style={styles.successNotice}>
            <Ionicons name="checkmark-circle" size={19} color={colors.disciplineCompleted} />
            <Text style={styles.successNoticeText}>Programın kaydedildi.</Text>
          </View>
        )}

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
                    <Text numberOfLines={1} style={styles.programName}>{program.name}</Text>
                    <View style={styles.programMetaRow}>
                      <Text numberOfLines={1} style={styles.programMeta}>
                        Haftada {program.days.filter((day) => !day.isOffDay).length} antrenman
                        {program.days.some((day) => day.isOffDay) ? ` · ${program.days.filter((day) => day.isOffDay).length} dinlenme` : ''}
                      </Text>
                      {isActive && (
                        <View style={styles.activeBadge}>
                          <View style={styles.activeDot} />
                          <Text style={styles.activeBadgeText}>AKTİF</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityLabel={`${program.name} seçenekleri`}
                  accessibilityRole="button"
                  disabled={deletingProgramId === program.id || activatingProgramId === program.id}
                  hitSlop={8}
                  onPress={() => openProgramMenu(program.id, program.name, isActive)}
                  style={({ pressed }) => [styles.moreButton, pressed && styles.buttonPressed]}>
                  {deletingProgramId === program.id || activatingProgramId === program.id ? (
                    <ActivityIndicator color={colors.primaryIcon} size="small" />
                  ) : (
                    <Ionicons name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
                  )}
                </Pressable>
              </View>
            );
          })}
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
  content: { gap: 24, padding: 20, paddingBottom: 40 },
  emptyState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 32 },
  loadingState: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center', padding: 32 },
  loadingText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    height: 64,
    justifyContent: 'center',
    marginBottom: 18,
    width: 64,
  },
  emptyTitle: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  description: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 29, fontWeight: '900', lineHeight: 35 },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginTop: 3 },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    marginTop: 22,
    paddingHorizontal: 18,
    height: 50,
    justifyContent: 'center',
    paddingVertical: 0,
  },
  compactButton: { height: 46, marginTop: 0, paddingHorizontal: 13, paddingVertical: 0 },
  buttonPressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  buttonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '900' },
  programList: { gap: 10 },
  successNotice: {
    alignItems: 'center',
    borderColor: colors.disciplineCompleted,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  successNoticeText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  programCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  programCardActive: { borderBottomColor: colors.primary },
  programCardMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 15,
  },
  programCardPressed: { opacity: 0.72 },
  programIcon: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 43,
    justifyContent: 'center',
    width: 43,
  },
  programInfo: { flex: 1, minWidth: 0 },
  programName: { color: colors.text, flexShrink: 1, fontSize: 17, fontWeight: '900' },
  programMetaRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 3 },
  programMeta: { color: colors.textSecondary, flex: 1, fontSize: 12 },
  activeBadge: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  activeDot: { backgroundColor: colors.disciplineCompleted, borderRadius: 4, height: 7, width: 7 },
  activeBadgeText: { color: colors.disciplineCompleted, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  moreButton: { alignItems: 'center', height: 46, justifyContent: 'center', marginLeft: 8, width: 46 },
  });
}
