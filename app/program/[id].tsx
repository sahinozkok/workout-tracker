import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { WorkoutVisualPicker } from '@/components/workout-visual-picker';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { getWeekdayLabel } from '@/constants/weekdays';
import { useTranslation } from '@/context/language-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { WorkoutVisual } from '@/types/workout';
import { DEFAULT_PROGRAM_VISUAL, getDayVisual, getProgramVisual } from '@/utils/workout-visual';

export default function ProgramDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isProgramsLoading, programs, updateProgram } = useWorkout();
  const { colors, isDark } = useAppTheme();
  const { locale, t } = useTranslation();
  const styles = createStyles(colors);
  const [isProgramEditorOpen, setIsProgramEditorOpen] = useState(false);
  const [programNameDraft, setProgramNameDraft] = useState('');
  const [programVisualDraft, setProgramVisualDraft] = useState<WorkoutVisual>(DEFAULT_PROGRAM_VISUAL);
  const program = programs.find((item) => item.id === id);

  if (isProgramsLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.centerStateTitle}>{t('programDetail.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!program) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <Stack.Screen options={{ title: t('programDetail.notFoundTitle') }} />
        <View style={styles.centerState}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textTertiary} />
          <Text style={styles.centerStateTitle}>{t('programDetail.notFound')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/programs')}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>{t('programDetail.backToPrograms')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const currentProgram = program;
  const exerciseCount = currentProgram.days.reduce((total, day) => total + day.exercises.length, 0);

  function openProgramEditor() {
    setProgramNameDraft(currentProgram.name);
    setProgramVisualDraft(getProgramVisual(currentProgram.visual, currentProgram.icon));
    setIsProgramEditorOpen(true);
  }

  async function saveProgramChanges() {
    const trimmedName = programNameDraft.trim();
    if (!trimmedName) {
      Alert.alert(t('programDetail.nameRequiredTitle'), t('programDetail.nameRequiredBody'));
      return;
    }

    try {
      await updateProgram(currentProgram.id, { name: trimmedName, visual: programVisualDraft });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsProgramEditorOpen(false);
    } catch (error) {
      Alert.alert(
        t('programDetail.updateFailed'),
        error instanceof Error ? error.message : t('common.networkError'),
      );
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: program.name }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryIcon}>
            <WorkoutVisualDisplay
              color={colors.primary}
              size={24}
              visual={getProgramVisual(program.visual, program.icon)}
            />
          </View>
          <View style={styles.summaryText}>
            <Text numberOfLines={2} style={styles.programName}>
              {program.name}
            </Text>
            <Text style={styles.programMeta}>
              {t('programDetail.summary', { days: program.days.length, exercises: exerciseCount })}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={t('programDetail.editProgramLabel')}
            accessibilityRole="button"
            hitSlop={10}
            onPress={openProgramEditor}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <Ionicons name="pencil-outline" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>

        {isProgramEditorOpen && (
          <View style={styles.editor}>
            <Text style={styles.editorTitle}>{t('programDetail.editProgram')}</Text>
            <View style={styles.field}>
              <Text style={styles.label}>{t('programDetail.programName')}</Text>
              <TextInput
                autoFocus
                keyboardAppearance={isDark ? 'dark' : 'light'}
                maxLength={60}
                onChangeText={setProgramNameDraft}
                placeholder={t('programDetail.programName')}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                style={styles.input}
                value={programNameDraft}
              />
            </View>
            <Text style={styles.label}>{t('programDetail.programIcon')}</Text>
            <WorkoutVisualPicker onSelect={setProgramVisualDraft} selectedVisual={programVisualDraft} />
            <View style={styles.editorActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setIsProgramEditorOpen(false)}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void saveProgramChanges()}
                style={({ pressed }) => [styles.primaryButton, styles.flexButton, pressed && styles.pressed]}>
                <Text style={styles.primaryButtonText}>{t('common.save')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>{t('programDetail.workoutDays')}</Text>

        <View style={styles.dayList}>
          {program.days.map((day, dayIndex) => (
            <Pressable
              accessibilityHint={t('programDetail.openDayHint')}
              accessibilityLabel={t('programDetail.openDayLabel', { name: day.name })}
              accessibilityRole="button"
              key={day.id}
              onPress={() =>
                router.push({
                  pathname: '/program/[id]/day/[dayId]',
                  params: { id: program.id, dayId: day.id },
                })
              }
              style={({ pressed }) => [styles.dayRow, pressed && styles.pressed]}>
              <View style={[styles.dayVisual, day.isOffDay && styles.dayVisualOff]}>
                <WorkoutVisualDisplay
                  color={day.isOffDay ? colors.textTertiary : colors.accent}
                  size={18}
                  visual={getDayVisual(day.visual, dayIndex)}
                />
              </View>
              <View style={styles.dayText}>
                <Text numberOfLines={1} style={[styles.dayName, day.isOffDay && styles.dayNameOff]}>
                  {day.name}
                </Text>
                <Text style={styles.dayWeekday}>{getWeekdayLabel(day.scheduledWeekday, locale)}</Text>
              </View>
              {!day.isOffDay && (
                <Text style={styles.dayCount}>{t('programDetail.exerciseCount', { count: day.exercises.length })}</Text>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 40, paddingHorizontal: Layout.screenPadding, paddingTop: 8 },
    centerState: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center', padding: 30 },
    centerStateTitle: { color: colors.text, fontSize: 17, fontWeight: '500', textAlign: 'center' },
    summaryRow: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 14,
      paddingBottom: 18,
      paddingTop: 6,
    },
    summaryIcon: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 20,
      height: 40,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 40,
    },
    summaryText: { flex: 1, gap: 3 },
    programName: { color: colors.text, fontSize: 15, fontWeight: '500' },
    programMeta: { color: colors.textSecondary, ...Type.caption },
    iconButton: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
    editor: {
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      gap: 14,
      paddingVertical: 18,
    },
    editorTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    field: { gap: 8 },
    label: { color: colors.textSecondary, fontSize: 13 },
    input: {
      backgroundColor: colors.background,
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontSize: 15,
      minHeight: 48,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    editorActions: { flexDirection: 'row', gap: 10 },
    secondaryButton: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    secondaryButtonText: { color: colors.text, fontSize: 15 },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    flexButton: { flex: 1 },
    primaryButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },
    sectionTitle: { color: colors.text, ...Type.sectionTitle, marginBottom: 8, marginTop: 24 },
    dayList: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth },
    dayRow: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 14,
      minHeight: 60,
      paddingVertical: 12,
    },
    dayVisual: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: 16,
      height: 32,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 32,
    },
    dayVisualOff: { backgroundColor: colors.surfaceMuted },
    dayText: { flex: 1, gap: 2 },
    dayName: { color: colors.text, fontSize: 15, fontWeight: '500' },
    dayNameOff: { color: colors.textTertiary },
    dayWeekday: { color: colors.textTertiary, ...Type.footnote },
    dayCount: { color: colors.textSecondary, ...Type.caption },
    pressed: { opacity: 0.6 },
  });
}
