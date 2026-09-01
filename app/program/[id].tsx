import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionListItem, useListEntrance } from '@/components/motion-list-item';
import { MotionPressable } from '@/components/motion-pressable';
import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { WorkoutVisualPicker } from '@/components/workout-visual-picker';
import { getFeatureFallbackColor } from '@/constants/color-presets';
import { Form, Layout, ThemeColors, Type } from '@/constants/theme';
import { getWeekdayLabel } from '@/constants/weekdays';
import { useTranslation } from '@/context/language-context';
import { useProfile } from '@/context/profile-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { DisciplineStatus, WorkoutVisual } from '@/types/workout';
import { toDateKey } from '@/utils/discipline';
import { getWeekdayDateInCurrentWeek } from '@/utils/workout-schedule';
import { DEFAULT_PROGRAM_VISUAL, getProgramIconBackground, getProgramVisual } from '@/utils/workout-visual';

/**
 * WORKOUT DAYS ZAMAN ÇİZELGESİNİN ÖLÇÜLERİ
 *
 * Bağlantı çizgilerinin konumu bu dört değerden HESAPLANIR; çizgi stillerinde
 * elle yazılmış tek bir konum sabiti yoktur. Satır yüksekliği, dikey boşluk
 * veya çember boyutu ileride değişirse çizgiler kendiliğinden uyar.
 */
const TIMELINE_COLUMN_HEIGHT = 64;
const TIMELINE_ROW_VERTICAL_PADDING = 10;
const DAY_NUMBER_SIZE = 34;
/** Çember sütun içinde dikeyde ortalandığı için üst ve alt boşluk eşittir. */
const DAY_NUMBER_INSET = (TIMELINE_COLUMN_HEIGHT - DAY_NUMBER_SIZE) / 2;

export default function ProgramDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeProgramId, disciplineStatuses, isProgramsLoading, programs, updateProgram } = useWorkout();
  const { colors, isDark } = useAppTheme();
  const { showProgramIcons } = useProfile();
  const { locale, t } = useTranslation();
  // Yalnızca "bugün" göstergeleri.
  const todayColor = useFeatureColor('todayHighlight', colors.primary).color;
  // Hazır program/gün ikonlarının vurgusu Workout Days presetinden gelir.
  const workoutDaysDefault = getFeatureFallbackColor('workoutDays', colors, isDark);
  const workoutDaysIconColor = useFeatureColor('workoutDays', workoutDaysDefault).color;
  const styles = createStyles(colors, todayColor);
  const [isProgramEditorOpen, setIsProgramEditorOpen] = useState(false);
  const [programNameDraft, setProgramNameDraft] = useState('');
  const [programVisualDraft, setProgramVisualDraft] = useState<WorkoutVisual>(DEFAULT_PROGRAM_VISUAL);
  const program = programs.find((item) => item.id === id);
  /**
   * Gün satırlarının hareketi. Kanca erken dönüşlerin ÜSTÜNDE çağrılır; aksi
   * hâlde yükleme/bulunamadı durumlarında kanca sırası bozulurdu.
   */
  const { getDelay } = useListEntrance(program?.days.length ?? 0);

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
  const today = startOfToday();
  const todayKey = toDateKey(today);
  // Renkler yalnızca aktif programda anlamlıdır; disiplin durumu aktif
  // programa göre hesaplanır ve mevcut hesaplama mantığı değiştirilmez.
  const isActiveProgram = currentProgram.id === activeProgramId;
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
      {/*
        Program adı yalnızca aşağıdaki özet alanında gösterilir. Üst çubuk
        başlığı burada ezilmez; app/_layout.tsx içindeki çevrilmiş
        `nav.programDetail` başlığı geçerli kalır, geri butonu korunur.
      */}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.summaryRow}>
          {showProgramIcons && (
            <View
              style={[
                styles.summaryIcon,
                getProgramIconBackground(
                  getProgramVisual(program.visual, program.icon),
                  workoutDaysIconColor,
                  isDark,
                ),
              ]}>
              <WorkoutVisualDisplay
                color={colors.primary}
                iconColor={workoutDaysIconColor}
                size={24}
                visual={getProgramVisual(program.visual, program.icon)}
              />
            </View>
          )}
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

        <Text style={styles.sectionTitle}>{t('programDetail.workoutDays')}</Text>

        <View style={styles.dayList}>
          {program.days.map((day, dayIndex) => {
            const dayDate =
              day.scheduledWeekday === undefined
                ? undefined
                : getWeekdayDateInCurrentWeek(day.scheduledWeekday, today);
            const dayDateKey = dayDate ? toDateKey(dayDate) : undefined;
            const isToday = dayDateKey === todayKey;
            const isFuture = Boolean(dayDate && dayDate.getTime() > today.getTime());
            // Gelecek günlerde ve aktif olmayan programlarda durum üretilmez.
            const status = isActiveProgram && dayDateKey && !isFuture ? disciplineStatuses[dayDateKey] : undefined;
            const isFirstDay = dayIndex === 0;
            const isLastDay = dayIndex === program.days.length - 1;

            return (
              /*
                Gün sırası değişince satır yeni yerine kayar (`layout`); gün
                eklenip silinince yalnızca o satır görünür/kaybolur. Sürükleme
                gesture'ı olmadığı için burada layout animasyonu güvenli.
              */
              <MotionListItem delay={getDelay(dayIndex)} key={day.id}>
                <Pressable
                  accessibilityHint={t('programDetail.openDayHint')}
                  accessibilityLabel={t('programDetail.openDayLabel', { name: day.name })}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: '/program/[id]/day/[dayId]',
                      params: { id: program.id, dayId: day.id },
                    })
                  }
                  style={({ pressed }) => [styles.dayRow, pressed && styles.pressed]}>
                  <View style={styles.timelineColumn}>
                    {/*
                      Zaman çizelgesi İKİ PARÇA hâlinde çizilir: her satır kendi
                      çemberinin üstünü bir önceki satıra, altını bir sonrakine
                      bağlar. İki parça tam olarak satır sınırında buluştuğu
                      için kopukluk oluşmaz; hiçbir parça kendi satırının
                      dışına taşmaz, yani kırpılma riski de yoktur.
                    */}
                    {!isFirstDay && <View style={styles.timelineLineAbove} />}
                    {!isLastDay && <View style={styles.timelineLineBelow} />}
                    <View
                      style={[
                        styles.dayNumber,
                        { borderColor: getDayStatusColor(colors, status) },
                        isToday && styles.dayNumberToday,
                      ]}>
                      <Text
                        style={[
                          styles.dayNumberText,
                          { color: status ? getDayStatusColor(colors, status) : colors.textTertiary },
                          isToday && styles.dayNumberTextToday,
                        ]}>
                        {dayIndex + 1}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.dayText}>
                    <Text numberOfLines={1} style={[styles.dayName, day.isOffDay && styles.dayNameOff]}>
                      {day.name}
                    </Text>
                    <Text numberOfLines={1} style={[styles.dayWeekday, isToday && styles.dayWeekdayToday]}>
                      {isToday ? t('day.today') : getWeekdayLabel(day.scheduledWeekday, locale)}
                      {day.isOffDay
                        ? ''
                        : ` · ${t('programDetail.exerciseCount', { count: day.exercises.length })}`}
                    </Text>
                  </View>

                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </Pressable>
              </MotionListItem>
            );
          })}
        </View>
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsProgramEditorOpen(false)}
        presentationStyle="overFullScreen"
        transparent
        visible={isProgramEditorOpen}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.editorModal}>
          <Pressable
            accessibilityLabel={t('common.cancel')}
            accessibilityRole="button"
            onPress={() => setIsProgramEditorOpen(false)}
            style={styles.editorBackdrop}
          />
          <SafeAreaView edges={['bottom']} style={styles.editorSheet}>
            <View style={styles.editorHandle} />
            <ScrollView
              contentContainerStyle={styles.editorContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <Text style={styles.editorTitle}>{t('programDetail.editProgram')}</Text>

              <View style={styles.editorField}>
                <Text style={styles.editorLabel}>{t('programDetail.programName')}</Text>
                <TextInput
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                  maxLength={60}
                  onChangeText={setProgramNameDraft}
                  placeholder={t('programDetail.programName')}
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  style={styles.editorInput}
                  value={programNameDraft}
                />
              </View>

              {showProgramIcons && (
                <View style={styles.editorField}>
                  <Text style={styles.editorLabel}>{t('programDetail.programIcon')}</Text>
                  <WorkoutVisualPicker
                    onSelect={setProgramVisualDraft}
                    selectedVisual={programVisualDraft}
                    variant="programEdit"
                  />
                </View>
              )}

              <MotionPressable
                accessibilityRole="button"
                onPress={() => void saveProgramChanges()}
                style={styles.editorSaveButton}>
                <Text style={styles.editorSaveButtonText}>{t('common.save')}</Text>
              </MotionPressable>

              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setIsProgramEditorOpen(false)}
                style={({ pressed }) => [styles.editorCancelButton, pressed && styles.pressed]}>
                <Text style={styles.editorCancelButtonText}>{t('common.cancel')}</Text>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Renkler mevcut tema ve mevcut disiplin durumlarından okunur.
 * Durumu olmayan günler (gelecek günler ve henüz durum üretilmemiş günler
 * dahil) nötr koyu gri kalır; asla turuncu/yeşil görünmez.
 */
function getDayStatusColor(colors: ThemeColors, status: DisciplineStatus | undefined) {
  if (status === 'completed') return colors.disciplineCompleted;
  if (status === 'partial') return colors.disciplinePartial;
  if (status === 'skipped') return colors.disciplineSkipped;
  return colors.separator;
}

function createStyles(colors: ThemeColors, todayColor: string) {
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
    editorModal: { flex: 1, justifyContent: 'flex-end' },
    editorBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.58)',
    },
    editorSheet: {
      alignSelf: 'center',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      maxHeight: '92%',
      overflow: 'hidden',
      width: '100%',
    },
    editorHandle: {
      alignSelf: 'center',
      backgroundColor: colors.textTertiary,
      borderRadius: 3,
      height: 5,
      marginTop: 14,
      opacity: 0.48,
      width: 52,
    },
    editorContent: {
      gap: Form.sectionGap,
      paddingBottom: 16,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 20,
    },
    editorTitle: { color: colors.text, ...Form.title },
    editorField: { gap: Form.fieldGap },
    /**
     * Ana Sayfa'daki eyebrow tokenının aynısı. `textTransform: 'uppercase'`
     * BİLİNÇLİ olarak kaldırıldı: Türkçede 'i' harfi noktasız 'I'ya dönüşüyor
     * ve "Program simgesi" → "PROGRAM SIMGESI" gibi hatalı yazım üretiyordu.
     */
    editorLabel: { color: colors.textSecondary, ...Type.eyebrow },
    editorInput: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: Form.controlRadius,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      ...Type.body,
      minHeight: Form.controlHeight,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    editorSaveButton: {
      alignItems: 'center',
      backgroundColor: colors.text,
      borderRadius: Form.controlRadius,
      justifyContent: 'center',
      minHeight: Form.controlHeight,
    },
    editorSaveButtonText: { color: colors.background, ...Form.action },
    // İkincil eylem: aynı dokunma alanı, sakin ağırlık ve ikincil renk.
    editorCancelButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: Form.controlHeight,
    },
    editorCancelButtonText: { color: colors.textSecondary, ...Type.body },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    primaryButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },
    sectionTitle: { color: colors.text, ...Type.sectionTitle, marginBottom: 8, marginTop: 24 },
    dayList: { marginTop: 4 },
    dayRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 14,
      minHeight: TIMELINE_COLUMN_HEIGHT,
      paddingVertical: TIMELINE_ROW_VERTICAL_PADDING,
    },
    timelineColumn: {
      alignItems: 'center',
      height: TIMELINE_COLUMN_HEIGHT,
      justifyContent: 'center',
      width: DAY_NUMBER_SIZE,
    },
    /**
     * Satırın ÜST kenarından (bir önceki satırın alt parçasının bittiği nokta)
     * bu çemberin ÜST kenarına kadar. `bottom`, sütunun altından ölçüldüğü için
     * çemberin üstü `TIMELINE_COLUMN_HEIGHT - DAY_NUMBER_INSET` uzaklıktadır.
     */
    timelineLineAbove: {
      backgroundColor: colors.separator,
      bottom: TIMELINE_COLUMN_HEIGHT - DAY_NUMBER_INSET,
      position: 'absolute',
      top: -TIMELINE_ROW_VERTICAL_PADDING,
      width: StyleSheet.hairlineWidth,
    },
    /**
     * Bu çemberin ALT kenarından satırın alt kenarına kadar. Sonraki satırın
     * üst parçası tam olarak burada devam eder.
     */
    timelineLineBelow: {
      backgroundColor: colors.separator,
      bottom: -TIMELINE_ROW_VERTICAL_PADDING,
      position: 'absolute',
      top: DAY_NUMBER_INSET + DAY_NUMBER_SIZE,
      width: StyleSheet.hairlineWidth,
    },
    dayNumber: {
      alignItems: 'center',
      borderRadius: DAY_NUMBER_SIZE / 2,
      borderWidth: 2,
      height: DAY_NUMBER_SIZE,
      justifyContent: 'center',
      width: DAY_NUMBER_SIZE,
    },
    dayNumberToday: { borderColor: todayColor },
    dayNumberText: { fontSize: 14, fontWeight: '600' },
    dayNumberTextToday: { color: todayColor },
    dayText: { flex: 1, gap: 2 },
    dayName: { color: colors.text, fontSize: 15, fontWeight: '500' },
    dayNameOff: { color: colors.textTertiary },
    dayWeekday: { color: colors.textSecondary, ...Type.caption },
    dayWeekdayToday: { color: todayColor },
    dayCount: { color: colors.textSecondary, ...Type.caption },
    pressed: { opacity: 0.6 },
  });
}
