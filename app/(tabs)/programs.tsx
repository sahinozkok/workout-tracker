import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProgramDetailScroll } from '@/components/program-detail-scroll';
import ProgramList from '@/components/program-list';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useProfile } from '@/context/profile-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { WorkoutProgram } from '@/types/workout';

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
    reorderPrograms,
  } = useWorkout();
  const { colors } = useAppTheme();
  const { showProgramIcons } = useProfile();
  const { t } = useTranslation();
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
        t('programs.activateFailed'),
        error instanceof Error ? error.message : t('common.networkError'),
      );
    } finally {
      setActivatingProgramId(undefined);
    }
  }

  async function handleReorderPrograms(reordered: WorkoutProgram[]) {
    try {
      await reorderPrograms(reordered);
    } catch (error) {
      // `reorderPrograms` hata durumunda listeyi eski sıraya geri almış olur.
      Alert.alert(
        t('programs.reorderFailed'),
        error instanceof Error ? error.message : t('common.networkError'),
      );
    }
  }

  function openProgramMenu(programId: string, programName: string, isActive: boolean) {
    Alert.alert(programName, t('programs.menuBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      ...(!isActive
        ? [{ text: t('programs.makeActive'), onPress: () => void handleActivateProgram(programId) }]
        : []),
      {
        text: t('common.edit'),
        onPress: () => router.push({ pathname: '/program/[id]', params: { id: programId } }),
      },
      {
        text: t('common.delete'),
        style: 'destructive' as const,
        onPress: () => confirmDeleteProgram(programId, programName, isActive),
      },
    ]);
  }

  function confirmDeleteProgram(programId: string, programName: string, isActive: boolean) {
    Alert.alert(
      t('programs.deleteTitle'),
      `${t('programs.deleteBody', { name: programName })}${isActive ? t('programs.deleteBodyActive') : ''}`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('programs.deleteConfirm'),
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
        t('programs.deleteFailed'),
        error instanceof Error ? error.message : t('common.networkError'),
      );
    } finally {
      setDeletingProgramId(undefined);
    }
  }

  if (isProgramsLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.centerStateText}>{t('programs.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (programsError) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.centerStateTitle}>{t('programs.loadFailed')}</Text>
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

  if (programs.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <Ionicons name="barbell-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.centerStateTitle}>{t('programs.emptyTitle')}</Text>
          <Text style={styles.centerStateText}>{t('programs.emptyBody')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/program/create')}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>{t('programs.createProgram')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/*
        `ProgramDetailScroll` native'de `NestableScrollContainer`, web'de düz
        `ScrollView`'dur. Sürüklenebilir liste bir kaydırma kabının içinde
        çalışabilsin diye gereklidir (Program detayı ekranıyla aynı kalıp).
      */}
      <ProgramDetailScroll contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{t('programs.savedProgramCount', { count: programs.length })}</Text>
          <Text style={styles.title}>{t('programs.title')}</Text>
        </View>

        {showCreatedNotice && (
          <View style={styles.notice}>
            <Ionicons name="checkmark-circle" size={16} color={colors.disciplineCompleted} />
            <Text style={styles.noticeText}>{t('programs.created')}</Text>
          </View>
        )}

        <ProgramList
          activeProgramId={activeProgramId}
          busyProgramId={deletingProgramId ?? activatingProgramId}
          onOpen={(programId) => router.push({ pathname: '/program/[id]', params: { id: programId } })}
          onOptions={(program, isActive) => openProgramMenu(program.id, program.name, isActive)}
          onReorder={(reordered) => void handleReorderPrograms(reordered)}
          programs={programs}
          showIcons={showProgramIcons}
        />

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/program/create')}
          style={({ pressed }) => [styles.createAction, pressed && styles.pressed]}>
          <Text style={styles.createActionText}>{t('programs.newProgram')}</Text>
        </Pressable>
      </ProgramDetailScroll>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 40, paddingHorizontal: Layout.screenPadding, paddingTop: 16 },
    centerState: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 32 },
    centerStateTitle: { color: colors.text, fontSize: 19, fontWeight: '600', textAlign: 'center' },
    centerStateText: { color: colors.textSecondary, ...Type.caption, textAlign: 'center' },
    header: { gap: 8, marginBottom: 26 },
    eyebrow: { color: colors.textSecondary, ...Type.eyebrow },
    title: { color: colors.text, ...Type.pageTitle },
    notice: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 16 },
    noticeText: { color: colors.textSecondary, ...Type.caption },
    // Satır stilleri `components/program-list` içinde yaşıyor.
    createAction: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingVertical: 10,
    },
    createActionText: { color: colors.text, fontSize: 15, fontWeight: '400' },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusMedium,
      justifyContent: 'center',
      marginTop: 10,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    primaryButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
