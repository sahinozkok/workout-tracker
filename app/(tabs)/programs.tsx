import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';

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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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

        <View style={styles.list}>
          {programs.map((program) => {
            const isActive = program.id === activeProgramId;
            const isBusy = deletingProgramId === program.id || activatingProgramId === program.id;
            const workoutDays = program.days.filter((day) => !day.isOffDay).length;
            const restDays = program.days.filter((day) => day.isOffDay).length;

            return (
              <Pressable
                accessibilityHint={t('programs.openHint')}
                accessibilityRole="button"
                key={program.id}
                onLongPress={() => openProgramMenu(program.id, program.name, isActive)}
                onPress={() => router.push({ pathname: '/program/[id]', params: { id: program.id } })}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                <View style={styles.rowText}>
                  <Text numberOfLines={1} style={styles.rowTitle}>
                    {program.name}
                  </Text>
                  <View style={styles.rowMetaLine}>
                    <Text numberOfLines={1} style={styles.rowMeta}>
                      {t('programs.weeklySummary', { workouts: workoutDays })}
                      {restDays > 0 ? t('programs.restSuffix', { count: restDays }) : ''}
                    </Text>
                    {isActive && <Text style={styles.activeText}>{t('programs.active')}</Text>}
                  </View>
                </View>
                <Pressable
                  accessibilityLabel={t('programs.options', { name: program.name })}
                  accessibilityRole="button"
                  disabled={isBusy}
                  hitSlop={12}
                  onPress={() => openProgramMenu(program.id, program.name, isActive)}
                  style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
                  {isBusy ? (
                    <ActivityIndicator color={colors.textSecondary} size="small" />
                  ) : (
                    <Ionicons name="ellipsis-horizontal" size={18} color={colors.textTertiary} />
                  )}
                </Pressable>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/program/create')}
          style={({ pressed }) => [styles.createAction, pressed && styles.pressed]}>
          <Text style={styles.createActionText}>{t('programs.newProgram')}</Text>
        </Pressable>
      </ScrollView>
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
    list: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth },
    row: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      minHeight: 64,
      paddingVertical: 14,
    },
    rowPressed: { opacity: 0.6 },
    rowText: { flex: 1, gap: 4 },
    rowTitle: { color: colors.text, ...Type.rowTitle },
    rowMetaLine: { alignItems: 'center', flexDirection: 'row' },
    rowMeta: { color: colors.textSecondary, flexShrink: 1, ...Type.caption },
    activeText: { color: colors.disciplineCompleted, ...Type.caption, fontWeight: '500' },
    moreButton: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
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
