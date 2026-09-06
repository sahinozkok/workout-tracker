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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { getProgramExerciseName } from '@/data/exercises';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { DisciplineStatus, WorkoutVisual } from '@/types/workout';
import { toDateKey } from '@/utils/discipline';
import { formatProgramExerciseTarget } from '@/utils/program-target-format';
import { getWeekdayDateInCurrentWeek } from '@/utils/workout-schedule';
import { DEFAULT_PROGRAM_VISUAL, getProgramIconBackground, getProgramVisual } from '@/utils/workout-visual';

/**
 * WORKOUT DAYS ZAMAN ÇİZELGESİNİN ÖLÇÜLERİ
 *
 * Gün satırları artık egzersiz listesi kadar DEĞİŞKEN yükseklikte olduğu için
 * eski `TIMELINE_COLUMN_HEIGHT = 64` sabit yükseklik varsayımı KALDIRILDI:
 * satır kendi içeriği kadar büyür, timeline sütunu satırın gerçek yüksekliğine
 * `alignItems: 'stretch'` ile uzar ve bağlantı çizgileri satır sınırlarında
 * kesintisiz buluşur.
 *
 * Kalan iki ölçü SÜTUNUN KENDİ geometrisidir; ekran koordinatına bağlı sihirli
 * değer yoktur:
 *   * `DAY_NUMBER_SIZE`          — çemberin çapı; çizgiler çemberin merkezine
 *                                  (`DAY_NUMBER_SIZE / 2`) hizalanır.
 *   * `DAY_ROW_VERTICAL_PADDING` — satırın dikey iç boşluğu; alt/üst çizgiler
 *                                  bu kadar negatif taşarak komşu satırın
 *                                  çizgisiyle tam satır sınırında birleşir.
 */
const DAY_NUMBER_SIZE = 34;
const DAY_ROW_VERTICAL_PADDING = 12;
/** Çizgiyi çember genişliğinin tam ortasına oturtan yatay konum. */
const TIMELINE_LINE_LEFT = (DAY_NUMBER_SIZE - StyleSheet.hairlineWidth) / 2;

export default function ProgramDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeProgramId, disciplineStatuses, isProgramsLoading, programs, updateProgram } = useWorkout();
  const { colors, isDark } = useAppTheme();
  const { showProgramIcons } = useProfile();
  const { locale, t } = useTranslation();
  // Özel üst çubuk native başlığın yerini aldığı için güvenli alan çentik ve
  // Dynamic Island altında elle hesaplanır.
  const insets = useSafeAreaInsets();
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
        Genel "Program Detayı" native başlığı KALDIRILDI: program kimliği
        (ad + meta + düzenle) artık aşağıdaki özel üst çubuktadır. `headerShown:
        false` native-stack'in iOS geri kaydırma hareketini ETKİLEMEZ; jest
        aynen çalışır (bkz. friends/profile ekranları).
      */}
      <Stack.Screen options={{ headerShown: false }} />

      {/*
        ÜST PROGRAM KİMLİĞİ — solda geri, ortada esneyen program adı + meta,
        sağda düzenleme. Geri ve düzenleme dokunma alanları 44×44 pt; uzun
        program adı iki satıra kadar sarar ve iki düğmeyi ekrandan itmez
        (metin bloğu `flex: 1` ile sıkışır, düğmeler sabit genişlikte kalır).
      */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Pressable
          accessibilityLabel={t('common.back')}
          accessibilityRole="button"
          hitSlop={{ bottom: 8, left: 8, right: 8, top: 8 }}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/programs'))}
          style={({ pressed }) => [styles.topBarButton, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>

        {showProgramIcons && (
          <View
            style={[
              styles.topBarIcon,
              getProgramIconBackground(
                getProgramVisual(program.visual, program.icon),
                workoutDaysIconColor,
                isDark,
              ),
            ]}>
            <WorkoutVisualDisplay
              color={colors.primary}
              iconColor={workoutDaysIconColor}
              size={22}
              visual={getProgramVisual(program.visual, program.icon)}
            />
          </View>
        )}

        <View style={styles.topBarText}>
          <Text numberOfLines={2} style={styles.programName}>
            {program.name}
          </Text>
          <Text numberOfLines={1} style={styles.programMeta}>
            {t('programDetail.summary', { days: program.days.length, exercises: exerciseCount })}
          </Text>
        </View>

        <Pressable
          accessibilityLabel={t('programDetail.editProgramLabel')}
          accessibilityRole="button"
          hitSlop={{ bottom: 8, left: 8, right: 8, top: 8 }}
          onPress={openProgramEditor}
          style={({ pressed }) => [styles.topBarButton, pressed && styles.pressed]}>
          <Ionicons name="pencil-outline" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
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
            // Ana başlık: takvim günü / bugün / sıra numarası + güne verilen ad.
            const schedule = isToday
              ? t('day.today')
              : day.scheduledWeekday === undefined
                ? t('programDetail.dayNumberLabel', { number: dayIndex + 1 })
                : getWeekdayLabel(day.scheduledWeekday, locale);
            const dayTitle = t('programDetail.dayTitle', { name: day.name, schedule });
            // VoiceOver: gün başlığı + gerçek egzersiz sayısı ya da dinlenme.
            const daySummaryLabel = day.isOffDay
              ? t('programDetail.restDay')
              : t('programDetail.exerciseCount', { count: day.exercises.length });

            return (
              /*
                Gün sırası değişince satır yeni yerine kayar (`layout`); gün
                eklenip silinince yalnızca o satır görünür/kaybolur. Sürükleme
                gesture'ı olmadığı için burada layout animasyonu güvenli.
              */
              <MotionListItem delay={getDelay(dayIndex)} key={day.id}>
                <Pressable
                  accessibilityHint={t('programDetail.openDayHint')}
                  accessibilityLabel={`${dayTitle}, ${daySummaryLabel}`}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: '/program/[id]/day/[dayId]',
                      params: { id: program.id, dayId: day.id },
                    })
                  }
                  style={({ pressed }) => [styles.dayRow, pressed && styles.pressed]}>
                  {/*
                    ZAMAN ÇİZELGESİ — satır DEĞİŞKEN yükseklikte olduğu için
                    sütun `alignItems: 'stretch'` ile satırın gerçek yüksekliğine
                    uzar. Çember sütunun tepesinde, gün başlığıyla dikeyde
                    ortalanır; üst/alt çizgiler yalnızca sütunun kendi
                    ölçülerinden (`DAY_NUMBER_SIZE`, `DAY_ROW_VERTICAL_PADDING`)
                    türetilir. İlk satırda üst, son satırda alt çizgi çizilmez;
                    aradaki her satırın alt çizgisi bir sonrakinin üst çizgisiyle
                    tam satır sınırında buluşur, uzun günlerde de kopmaz.
                  */}
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.timelineColumn}>
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
                    <View style={styles.dayHeaderRow}>
                      <Text
                        numberOfLines={2}
                        style={[styles.dayName, day.isOffDay && styles.dayNameOff, isToday && styles.dayNameToday]}>
                        {dayTitle}
                      </Text>
                    </View>

                    {day.isOffDay ? (
                      <Text style={styles.dayStateText}>{t('programDetail.restDay')}</Text>
                    ) : day.exercises.length === 0 ? (
                      <Text style={styles.dayStateText}>{t('programDetail.emptyDay')}</Text>
                    ) : (
                      <View style={styles.exerciseList}>
                        {day.exercises.map((exercise) => (
                          <View key={exercise.id} style={styles.exerciseRow}>
                            <Text numberOfLines={2} style={styles.exerciseName}>
                              {getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName)}
                            </Text>
                            <Text style={styles.exerciseTarget}>
                              {formatProgramExerciseTarget(exercise, t)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>

                  <View style={styles.chevronColumn}>
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </View>
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
    content: { paddingBottom: 40, paddingHorizontal: Layout.screenPadding, paddingTop: 4 },
    centerState: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center', padding: 30 },
    centerStateTitle: { color: colors.text, fontSize: 17, fontWeight: '500', textAlign: 'center' },
    // ÜST PROGRAM KİMLİĞİ — solda/sağda sabit 44 pt düğmeler, ortada esneyen ad.
    topBar: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 8,
      paddingBottom: 12,
      paddingHorizontal: Layout.screenPadding - 6,
    },
    topBarButton: {
      alignItems: 'center',
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    topBarIcon: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 19,
      height: 38,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 38,
    },
    // Program adı ve meta baskın düğmeleri değil kimliği önceler: metin bloğu
    // sıkışabilir (`flex: 1`, `minWidth: 0`), düğmeler sabit kalır.
    topBarText: { flex: 1, gap: 2, minWidth: 0 },
    programName: { color: colors.text, fontSize: 18, fontWeight: '600' },
    programMeta: { color: colors.textSecondary, ...Type.caption },
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
    sectionTitle: { color: colors.text, ...Type.sectionTitle, marginBottom: 8, marginTop: 20 },
    dayList: { marginTop: 4 },
    /**
     * Sabit yükseklik YOK. `alignItems: 'stretch'` ile timeline sütunu ve
     * chevron satırın gerçek yüksekliğine uzar; satır egzersiz listesi kadar
     * doğal büyür ve içerik kırpılmaz.
     */
    dayRow: {
      alignItems: 'stretch',
      flexDirection: 'row',
      gap: 14,
      paddingVertical: DAY_ROW_VERTICAL_PADDING,
    },
    // Çember tepede; sütun tüm satır boyunca uzar, çizgiler ona göre çizilir.
    timelineColumn: {
      alignItems: 'center',
      justifyContent: 'flex-start',
      width: DAY_NUMBER_SIZE,
    },
    /**
     * Satırın ÜST kenarından (`-DAY_ROW_VERTICAL_PADDING`) çemberin MERKEZİNE
     * (`DAY_NUMBER_SIZE / 2`) kadar. Bir önceki satırın alt çizgisi tam satır
     * sınırında buluşur; çemberin dolu zemini uçları maskeler.
     */
    timelineLineAbove: {
      backgroundColor: colors.separator,
      height: DAY_NUMBER_SIZE / 2 + DAY_ROW_VERTICAL_PADDING,
      left: TIMELINE_LINE_LEFT,
      position: 'absolute',
      top: -DAY_ROW_VERTICAL_PADDING,
      width: StyleSheet.hairlineWidth,
    },
    /**
     * Çemberin MERKEZİNDEN satırın ALT kenarına (`bottom: -DAY_ROW_VERTICAL_
     * PADDING`) kadar. Değişken satır yüksekliğinde `top`+`bottom` ile uzar;
     * sonraki satırın üst çizgisi tam burada devam eder.
     */
    timelineLineBelow: {
      backgroundColor: colors.separator,
      bottom: -DAY_ROW_VERTICAL_PADDING,
      left: TIMELINE_LINE_LEFT,
      position: 'absolute',
      top: DAY_NUMBER_SIZE / 2,
      width: StyleSheet.hairlineWidth,
    },
    dayNumber: {
      alignItems: 'center',
      // Dolu zemin çizginin çember içinden geçen ucunu maskeler.
      backgroundColor: colors.background,
      borderRadius: DAY_NUMBER_SIZE / 2,
      borderWidth: 2,
      height: DAY_NUMBER_SIZE,
      justifyContent: 'center',
      width: DAY_NUMBER_SIZE,
    },
    dayNumberToday: { borderColor: todayColor },
    dayNumberText: { fontSize: 14, fontWeight: '600' },
    dayNumberTextToday: { color: todayColor },
    dayText: { flex: 1, gap: 8, minWidth: 0 },
    // Başlık, çember çapıyla eş yükseklikte ve dikeyde ortalı: gün numarası
    // satır başlığıyla görsel olarak dengeli hizalanır.
    dayHeaderRow: { justifyContent: 'center', minHeight: DAY_NUMBER_SIZE },
    dayName: { color: colors.text, fontSize: 16, fontWeight: '600' },
    dayNameOff: { color: colors.textTertiary },
    dayNameToday: { color: todayColor },
    dayStateText: { color: colors.textTertiary, ...Type.caption },
    exerciseList: { gap: 8 },
    exerciseRow: {
      alignItems: 'baseline',
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
    },
    // Egzersiz adı gün başlığıyla YARIŞMAZ: set/tekrar metniyle aynı ikincil
    // katmanda kalır (textSecondary, 13 pt, regular). `flex: 1` uzun adların
    // iki satıra sarmasını ve hedefin sağda kalmasını korur.
    exerciseName: { color: colors.textSecondary, flex: 1, fontSize: 13, fontWeight: '400' },
    exerciseTarget: {
      color: colors.textSecondary,
      fontSize: 13,
      fontVariant: ['tabular-nums'],
      fontWeight: '500',
      textAlign: 'right',
    },
    // Chevron gün başlığıyla hizalanır: `alignSelf: 'flex-start'` sütunu satırın
    // tamamına uzamaktan alıkoyar, yalnız başlık yüksekliğini kaplar ve içinde
    // ortalanır (uzun günlerde satırın ortasında yüzmez).
    chevronColumn: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: DAY_NUMBER_SIZE },
    pressed: { opacity: 0.6 },
  });
}
