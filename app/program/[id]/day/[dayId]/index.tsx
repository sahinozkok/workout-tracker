import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { MotionCollapsible, MotionLayout, MotionSwap } from '@/components/motion-section';
import { ProgramDetailScroll } from '@/components/program-detail-scroll';
import ProgramExerciseList from '@/components/program-exercise-list';
import { WorkoutVisualPicker } from '@/components/workout-visual-picker';
import { Form, Layout, ThemeColors, Type } from '@/constants/theme';
import { getWeekdayLabel, getWeekdayOptions } from '@/constants/weekdays';
import { useTranslation } from '@/context/language-context';
import { useMascot } from '@/context/mascot-context';
import { useProfile } from '@/context/profile-context';
import { useWorkout } from '@/context/workout-context';
import { getProgramExerciseName } from '@/data/exercises';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import {
  ProgramExercise,
  Weekday,
  WorkoutDropSetPerformance,
  WorkoutSetPerformance,
  WorkoutSetRecord,
  WorkoutVisual,
  isCardioExercise,
  isStrengthExercise,
  ActivityPerformance,
  CardioProgramExercise,
  StrengthProgramExercise,
  WorkoutTrackingMode,
} from '@/types/workout';
import {
  ACTIVITY_DISTANCE_METERS_MAX,
  ACTIVITY_DISTANCE_METERS_MIN,
  ACTIVITY_DURATION_SECONDS_MAX,
  ACTIVITY_DURATION_SECONDS_MIN,
  classifyRpe,
  describeRpeInput,
  formatMetersAsKilometers,
  formatRpeWithBand,
  parseKilometersToMeters,
  parseMinutesToSeconds,
  parseOptionalKilometersToMeters,
  parseOptionalRpe,
  type RpeBand,
  rpeBandLabelKey,
  TARGET_DISTANCE_METERS_MAX,
  TARGET_DISTANCE_METERS_MIN,
  TARGET_DURATION_SECONDS_MAX,
  TARGET_DURATION_SECONDS_MIN,
} from '@/utils/activity-input';
import { TrackingModeSelector } from '@/components/tracking-mode-selector';
import {
  ActivityTimerState,
  createActivityTimer,
  formatActivityOvertime,
  formatActivityTimerValue,
  getActivityNotificationDelaySeconds,
  getActivityTimerProgress,
  getActivityTimerStorageKey,
  pauseActivityTimer,
  resumeActivityTimer,
} from '@/utils/activity-timer';
import {
  attachActivityNotificationId,
  findSessionActivityTimers,
  loadActivityTimer,
  removeActivityTimer,
  saveActivityTimer,
} from '@/utils/activity-timer-storage';
import {
  cancelActivityTargetNotification,
  scheduleActivityTargetNotification,
} from '@/utils/activity-notifications';
import { toDateKey } from '@/utils/discipline';
import {
  getActivityProgressKey,
  completesWorkoutAfterActivity,
  completesWorkoutAfterSet,
  derivePaceSecondsPerKm,
  exerciseTargetUnits,
  resolveDayProgress,
  resolveExerciseProgress,
} from '@/utils/workout-tracking';
import { getActiveSetLabelNumber } from '@/utils/workout-sets';
import {
  cancelRestNotification,
  isRestNotificationScheduled,
  scheduleRestNotification,
} from '@/utils/rest-notifications';
import { getSetProgressKey } from '@/utils/workout-schedule';
import {
  createRestTimer,
  formatRestTimerValue,
  getRestTimerProgress,
  RestTimerState,
} from '@/utils/rest-timer';
import {
  attachRestNotificationId,
  getRestTimerStorageKey,
  loadRestTimer,
  removeRestTimer,
  saveRestTimer,
} from '@/utils/rest-timer-storage';
import { formatDuration, getWorkoutDurationSeconds } from '@/utils/workout-session';
import { DEFAULT_EXERCISE_VISUAL, getDayVisual, getExerciseVisual } from '@/utils/workout-visual';

const WORKOUT_ORANGE = '#FF9138';

export default function WorkoutDayScreen() {
  const { id, dayId } = useLocalSearchParams<{ id: string; dayId: string }>();
  // Yalnızca yerel, geçici bir UI olayı gönderir; ağ/depolama işlemi yapmaz.
  const { triggerReaction } = useMascot();
  const {
    activityTotals,
    workoutActivityRecords,
    saveActivityRecord,
    deleteActivityRecord,
    completeSet,
    completedSetCounts,
    activeProgramId,
    finishWorkout,
    isProgramsLoading,
    pauseWorkout,
    programs,
    removeExerciseFromDay,
    reorderDays,
    reorderExercisesInDay,
    resetCompletedSets,
    resumeWorkout,
    startWorkout,
    undoCompletedSet,
    updateDay,
    updateExercise,
    workoutSessions,
    workoutSets,
  } = useWorkout();
  const { restTimerEnabled, showExerciseIcons } = useProfile();
  const { colors, isDark } = useAppTheme();
  const { locale, t } = useTranslation();
  /**
   * Üç semantik renk. Kullanıcı seçim yapmadıysa hepsi bugünkü değerlerine
   * düşer; varsayılan görünüm birebir korunur.
   */
  const workoutDays = useFeatureColor('workoutDays', WORKOUT_ORANGE);
  const activePrimary = useFeatureColor('activeWorkoutPrimary', colors.text);
  const activeSecondary = useFeatureColor('activeWorkoutSecondary', colors.primary);
  const styles = createStyles(colors, {
    activePrimary: activePrimary.color,
    // "Seti tamamla" düğmesinin yazısı: varsayılanda bugünkü `colors.background`,
    // özel renkte parlaklığa göre hesaplanan okunabilir renk.
    activePrimaryOn: activePrimary.isCustom ? activePrimary.onColor : colors.background,
    activeSecondary: activeSecondary.color,
    workoutDays: workoutDays.color,
    workoutDaysOn: workoutDays.isCustom ? workoutDays.onColor : '#111111',
  });
  const weekdayOptions = getWeekdayOptions(locale);
  const program = programs.find((item) => item.id === id);
  const day = program?.days.find((item) => item.id === dayId);
  const today = new Date();
  const todayKey = toDateKey(today);
  const restTimerStorageKey = getRestTimerStorageKey(id, dayId, todayKey);
  const matchingWorkoutSessions = workoutSessions.filter(
    (session) =>
      session.programId === id &&
      session.dayId === dayId &&
      session.dateKey === todayKey,
  );
  const workoutSession =
    matchingWorkoutSessions.find(
      (session) => session.status === 'running' || session.status === 'paused',
    ) ?? matchingWorkoutSessions.find((session) => session.status === 'completed');
  const isWorkoutRunning = workoutSession?.status === 'running';
  // Mount durumu YALNIZCA React state yazımını kontrol eder; molanın mantıksal
  // geçerliliği AsyncStorage'daki kaydın `timerId` değerinden okunur.
  const isMountedRef = useRef(true);
  const [clockNow, setClockNow] = useState(Date.now());
  const [restTimer, setRestTimer] = useState<RestTimerState>();
  const [isWorkoutActionPending, setIsWorkoutActionPending] = useState(false);
  const [pendingExerciseId, setPendingExerciseId] = useState<string>();
  const [isDayEditorOpen, setIsDayEditorOpen] = useState(false);
  const [dayNameDraft, setDayNameDraft] = useState('');
  const [dayVisualDraft, setDayVisualDraft] = useState<WorkoutVisual>({ type: 'text', text: '1' });
  const [dayWeekdayDraft, setDayWeekdayDraft] = useState<Weekday>(1);
  const [dayIsOffDraft, setDayIsOffDraft] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [editingExerciseName, setEditingExerciseName] = useState('');
  const [editingTrackingMode, setEditingTrackingMode] = useState<WorkoutTrackingMode>('sets_reps');
  /**
   * Kardiyoda ölçülen SÜRE artık elle girilmez: kronometreden gelir.
   * Mesafe ve RPE bitirme adımında girilir.
   */
  const [activityTimer, setActivityTimer] = useState<ActivityTimerState>();
  const [isFinishingActivity, setIsFinishingActivity] = useState(false);
  const [activityDistanceInput, setActivityDistanceInput] = useState('');
  const [activityRpeInput, setActivityRpeInput] = useState('');
  const [activityError, setActivityError] = useState<string>();
  const [isActivityPending, setIsActivityPending] = useState(false);
  const [targetDurationDraft, setTargetDurationDraft] = useState('');
  const [targetDistanceDraft, setTargetDistanceDraft] = useState('');
  const [exerciseVisualDraft, setExerciseVisualDraft] = useState<WorkoutVisual>(DEFAULT_EXERCISE_VISUAL);
  const [targetSetsDraft, setTargetSetsDraft] = useState('3');
  const [targetRepsDraft, setTargetRepsDraft] = useState('8-10');
  const [restSecondsDraft, setRestSecondsDraft] = useState('90');
  // Yalnızca ekran seçimi; programın kalıcı sırasını değiştirmez.
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>();
  const [weightInput, setWeightInput] = useState('');
  const [repetitionsInput, setRepetitionsInput] = useState('');
  const [rpeInput, setRpeInput] = useState('');
  /**
   * Kullanıcı "Tüm egzersizler" panelinden TAMAMLANMIŞ bir egzersizi elle
   * seçtiyse otomatik temizleme effect'i seçimi hemen bırakmaz; böylece hedefin
   * üstüne ekstra set girilebilir.
   */
  const [isManualSelection, setIsManualSelection] = useState(false);
  /**
   * Egzersiz bazında drop set taslakları. Ekran açık kaldığı sürece korunur:
   * sonraki sete geçilince veya başka egzersizden dönülünce satırlar ve
   * değerler yerinde kalır. Antrenman/ekran kapanınca doğal olarak temizlenir.
   */
  const [dropSetDrafts, setDropSetDrafts] = useState<Record<string, { weight: string; reps: string }[]>>({});
  const [validationError, setValidationError] = useState<string>();
  const [isSetDetailsOpen, setIsSetDetailsOpen] = useState(false);

  // Aktif egzersiz: kullanıcı panelden seçtiyse o, yoksa program sırasındaki
  // ilk tamamlanmamış egzersiz.
  // useMemo: effect bağımlılıklarının her render'da değişmesini engeller.
  /**
   * AKTİF SET AKIŞI YALNIZCA `sets_reps` EGZERSİZLERLE ÇALIŞIR.
   *
   * Kardiyo satırı ileride veritabanından gelirse buraya sızmamalıdır: set
   * paneli, otomatik ilerleme, mola sayacı ve `completeSet` hepsi set birimi
   * varsayar. Daraltma TEK noktada yapılır, aşağıdaki her kullanım bundan
   * beslenir. Kardiyo için arayüz bu fazda BİLİNÇLİ olarak yoktur.
   */
  /**
   * Günün BÜTÜN egzersizleri — seçim listesi, ilerleme ve otomatik bitiş bunu
   * kullanır. Set akışına giren daraltılmış küme aşağıdaki `dayExercises`'tir.
   */
  const allDayExercises = useMemo(() => day?.exercises ?? [], [day?.exercises]);
  const dayExercises = useMemo(
    () => allDayExercises.filter(isStrengthExercise),
    [allDayExercises],
  );
  /** Seçili kardiyo egzersizi; doluyken set paneli yerine aktivite paneli çıkar. */
  const activeCardioExercise = useMemo<CardioProgramExercise | undefined>(() => {
    const selected = allDayExercises.find((exercise) => exercise.id === selectedExerciseId);
    return selected && isCardioExercise(selected) ? selected : undefined;
  }, [allDayExercises, selectedExerciseId]);

  const activeCardioExerciseName = activeCardioExercise
    ? getProgramExerciseName(activeCardioExercise.exerciseId, activeCardioExercise.customExerciseName)
    : '';
  /**
   * Bu oturumda AYNI egzersiz için zaten kayıt var mı? Varsa panel onun
   * değerleriyle açılır ve kaydetme UPDATE'e döner; ikinci satır oluşmaz.
   */
  const existingActivityRecord = useMemo(
    () =>
      activeCardioExercise && workoutSession
        ? workoutActivityRecords.find(
            (record) =>
              record.sessionId === workoutSession.id &&
              record.programExerciseId === activeCardioExercise.id,
          )
        : undefined,
    [activeCardioExercise, workoutActivityRecords, workoutSession],
  );

  /**
   * Kronometre ilerlemesi. `clockNow` saniyede bir tazelendiği için değer
   * güncel kalır; kaynak yine gerçek saat farkıdır.
   */
  const activityProgress = activityTimer
    ? getActivityTimerProgress(activityTimer, clockNow)
    : undefined;
  const activityTimerAccessibilityText = activityProgress
    ? `${formatActivityTimerValue(activityProgress.elapsedSeconds)} · ${
        activityProgress.status === 'running'
          ? t('day.activityRunningState')
          : t('day.activityPausedState')
      }${activityProgress.isTargetReached ? ` · ${t('day.targetReached')}` : ''}`
    : formatActivityTimerValue(0);

  /** Kaydedilmiş tempo — mesafe ve süreden TÜRETİLİR, saklanmaz. */
  const activePaceSecondsPerKm = existingActivityRecord
    ? derivePaceSecondsPerKm(
        existingActivityRecord.distanceMeters,
        existingActivityRecord.durationSeconds,
      )
    : undefined;
  /**
   * RPE (algılanan zorluk) bant açıklaması CANLI türetilir. Sınıflandırma TEK
   * ORTAK saf yardımcıdan (`classifyRpe`) gelir; strength ve kardiyo alanları
   * aynı çekirdeği kullanır. Kendi parse yolları korunur (strength çok ondalık
   * kabul eder, kardiyo tek ondalık) — validasyon/kayıt davranışı değişmez.
   */
  const strengthRpeValue = parseNumberInput(rpeInput);
  const strengthRpeBand: RpeBand | undefined =
    strengthRpeValue !== undefined && strengthRpeValue >= 0 && strengthRpeValue <= 10
      ? classifyRpe(strengthRpeValue)
      : undefined;
  const activityRpeBand = describeRpeInput(activityRpeInput);

  /**
   * KARDİYO KONTROL AŞAMASI — geçişleri açıklayan TEK kararlı anahtar.
   *
   *   * `idle`      : timer yok, bitirme formu kapalı  → Başlat düğmesi
   *   * `tracking`  : timer var, bitirme formu kapalı  → Duraklat/Devam + Bitir
   *   * `finishing` : bitirme formu açık               → mesafe/RPE onayı
   *
   * `activityTimer.status` (running/paused) BİLİNÇLİ olarak anahtara GİRMEZ:
   * duraklat/devam et yalnız etiket değiştirir, timer'ı veya bitirme formu
   * girişlerini remount ETMEZ. Kronometre değeri bu anahtarın DIŞINDADIR;
   * her saniye güncellenen sayı yeniden giriş animasyonu almaz.
   */
  const activityPhase: 'idle' | 'tracking' | 'finishing' = isFinishingActivity
    ? 'finishing'
    : activityTimer
      ? 'tracking'
      : 'idle';

  // Program sırasındaki ilk tamamlanmamış egzersiz.
  const currentExerciseId = dayExercises.find(
    (exercise) => (completedSetCounts[getSetProgressKey(todayKey, exercise.id)] ?? 0) < exercise.targetSets,
  )?.id;
  const activeExercise =
    dayExercises.find((exercise) => exercise.id === selectedExerciseId) ??
    dayExercises.find((exercise) => exercise.id === currentExerciseId) ??
    dayExercises[0];
  /**
   * Aktif panel kardiyoda seçili kardiyo satırını, güç egzersizinde mevcut set
   * satırını gösterir. Geçiş anahtarı yalnız egzersiz kimliği ve takip türünden
   * oluşur; timer durumu, input değeri veya saat tick'i paneli remount etmez.
   */
  const activePanelExercise = activeCardioExercise ?? activeExercise;
  const activeExerciseTransitionKey = activePanelExercise
    ? `${activePanelExercise.id}:${activePanelExercise.trackingMode}`
    : 'none';
  const activeExerciseName = activeExercise
    ? getProgramExerciseName(activeExercise.exerciseId, activeExercise.customExerciseName)
    : '';
  const activeCompletedSets = activeExercise
    ? Math.min(completedSetCounts[getSetProgressKey(todayKey, activeExercise.id)] ?? 0, activeExercise.targetSets)
    : 0;
  const activeSetRecords = activeExercise
    ? workoutSets
        .filter(
          (workoutSet) => workoutSet.dateKey === todayKey && workoutSet.programExerciseId === activeExercise.id,
        )
        .sort((first, second) => first.setNumber - second.setNumber)
    : [];
  const activePreviousRecords = activeExercise
    ? workoutSets
        .filter(
          (workoutSet) => workoutSet.dateKey !== todayKey && workoutSet.programExerciseId === activeExercise.id,
        )
        .sort((first, second) => second.dateKey.localeCompare(first.dateKey))
    : [];
  const activePreviousSet = activePreviousRecords.find(
    (workoutSet) =>
      workoutSet.dateKey === activePreviousRecords[0]?.dateKey &&
      workoutSet.setNumber === activeCompletedSets + 1,
  );
  /** Aktif egzersizin BUGÜNKÜ oturumda kaydedilmiş gerçek set sayısı. */
  const activeActualSetCount = activeSetRecords.length;
  const isActiveExerciseComplete = Boolean(activeExercise && activeCompletedSets >= activeExercise.targetSets);
  /**
   * Tamamlanmış bir egzersiz panelden ELLE seçildiğinde hedefin üstüne ekstra
   * set girilebilir. Normal akışta (otomatik ilerleme) düğme yine kilitlidir.
   */
  const isExtraSetMode =
    isActiveExerciseComplete && isManualSelection && selectedExerciseId === activeExercise?.id;


  // Panelden seçilen egzersizin son seti tamamlandığında seçim bırakılır ve
  // ekran program sırasındaki ilk tamamlanmamış egzersize geçer. Set kaydı
  // başarısız olursa sayaç artmadığı için seçim korunur.
  useEffect(() => {
    if (!selectedExerciseId) return;

    /**
     * Kardiyo seçimi bu otomatik ilerleme kuralının DIŞINDADIR: kural hedefe
     * ulaşan SET egzersizinden sıradakine geçmek içindir. Seçim yalnızca
     * egzersiz günden tamamen kalktığında bırakılır.
     */
    const selectedExercise = dayExercises.find((exercise) => exercise.id === selectedExerciseId);
    if (!selectedExercise) {
      if (!allDayExercises.some((exercise) => exercise.id === selectedExerciseId)) {
        setSelectedExerciseId(undefined);
        setIsManualSelection(false);
      }
      return;
    }

    // Kullanıcı tamamlanmış egzersizi BİLEREK seçtiyse seçim korunur; aksi
    // hâlde son set tamamlanınca sıradaki tamamlanmamış egzersize geçilir.
    if (isManualSelection) return;

    const completedSets = completedSetCounts[getSetProgressKey(todayKey, selectedExercise.id)] ?? 0;
    if (completedSets >= selectedExercise.targetSets) {
      setSelectedExerciseId(undefined);
      setIsManualSelection(false);
    }
  }, [allDayExercises, completedSetCounts, dayExercises, isManualSelection, selectedExerciseId, todayKey]);

  /**
   * Giriş alanları YALNIZCA egzersiz değiştiğinde önerilen değerlerle tazelenir.
   *
   * Eskiden `activeCompletedSets` de bağımlılıktaydı: set başarıyla
   * kaydedilince sayaç artıyor, effect yeniden çalışıyor ve kullanıcının az
   * önce girdiği ağırlık/tekrar önceki antrenmanın değerleriyle EZİLİYORDU.
   * Artık aynı egzersizin sonraki setinde son kaydedilen değerler ekranda
   * kalır; kullanıcı tekrar yazmak zorunda değildir.
   *
   * Öneri sırası (yalnızca egzersize ilk geçişte):
   *   1. bugünkü aktif oturumdaki son set,
   *   2. yoksa önceki antrenmandaki uygun set,
   *   3. o da yoksa hedef tekrar değeri.
   */
  useEffect(() => {
    setValidationError(undefined);
    setRpeInput('');

    const latestSessionSet = activeSetRecords[activeSetRecords.length - 1];
    const suggestedSet = latestSessionSet ?? activePreviousSet;
    setWeightInput(suggestedSet?.weightKg?.toString() ?? '');
    const suggestedRepetitions =
      suggestedSet?.repetitions ?? getFirstTargetRepetition(activeExercise?.targetReps ?? '');
    setRepetitionsInput(suggestedRepetitions?.toString() ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExercise?.id]);

  /**
   * Kardiyo alanları YALNIZCA egzersiz veya mevcut kayıt değiştiğinde tazelenir.
   * Kayıt varsa değerleriyle, yoksa boş açılır — kullanıcının yazdığı değer
   * kaydetme sırasında EZİLMEZ.
   */
  useEffect(() => {
    if (!activeCardioExercise) return;
    setActivityError(undefined);
    setIsFinishingActivity(false);

    // Mesafe ve RPE, varsa kayıtlı değerlerle açılır; süre kronometreden gelir.
    setActivityDistanceInput(
      existingActivityRecord?.distanceMeters === undefined
        ? ''
        : formatMetersAsKilometers(existingActivityRecord.distanceMeters),
    );
    setActivityRpeInput(
      existingActivityRecord?.rpe === undefined ? '' : String(existingActivityRecord.rpe),
    );
  }, [activeCardioExercise, existingActivityRecord]);

  /**
   * KRONOMETRE GERİ YÜKLEME.
   *
   * Uygulama kapatılıp açılsa da ölçüm kaybolmaz: kayıt AsyncStorage'dan
   * okunur ve geçen süre `startedAt` farkından yeniden hesaplanır. Kayıt yoksa
   * kronometre temizlenir; başka egzersizin ölçümü buraya taşınmaz.
   */
  useEffect(() => {
    if (!activeCardioExercise || !workoutSession) {
      setActivityTimer(undefined);
      return;
    }

    let isCurrent = true;
    const storageKey = getActivityTimerStorageKey(workoutSession.id, activeCardioExercise.id);

    void loadActivityTimer(storageKey).then((restored) => {
      if (!isCurrent) return;
      setActivityTimer(restored);
      if (restored) setClockNow(Date.now());
    });

    return () => {
      isCurrent = false;
    };
  }, [activeCardioExercise, workoutSession]);


  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      // Ekrandan çıkmak molayı bitirmez: yalnızca state güncellemesi durur.
      // Aktif mola, kaydı ve bildirimi çalışmaya devam eder.
      isMountedRef.current = false;
    };
  }, []);

  // Tek bir interval; mola sürerken (fazla süre dahil) veya antrenman
  // çalışırken saniyede bir güncellenir ve temizlenerek sızıntı bırakmaz.
  useEffect(() => {
    if (workoutSession?.status !== 'running' && !restTimer) return;

    setClockNow(Date.now());
    const interval = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [restTimer, workoutSession?.status]);

  // Mola sayacı profil ayarından kapatılırsa ekrandaki sayaç da anında düşer;
  // kayıt ve bildirim temizliğini profil ekranı üstlenir.
  useEffect(() => {
    if (!restTimerEnabled) setRestTimer(undefined);
  }, [restTimerEnabled]);

  // Uygulama yeniden açıldığında kayıtlı mola geri yüklenir. Karar, workout
  // verisi Supabase'den yüklenmeden verilmez; aksi hâlde ilk render'daki
  // geçici `undefined` oturum yüzünden geçerli kayıt silinebilirdi.
  useEffect(() => {
    if (isProgramsLoading) return;

    let isEffectActive = true;

    async function restoreRestTimer() {
      const storedTimer = await loadRestTimer(restTimerStorageKey);
      if (!isEffectActive || !isMountedRef.current) return;
      if (!storedTimer) return;

      // Hydration tamamlandı: oturum çalışmıyorsa kayıt gerçekten bayattır.
      if (!isWorkoutRunning) {
        await Promise.allSettled([
          removeRestTimer(restTimerStorageKey, storedTimer.timerId),
          cancelRestNotification(storedTimer.notificationId),
        ]);
        return;
      }

      // Bildirim zamanı geçtiyse yeniden planlanmaz; kayıt yalnızca sayaç içindir.
      const stillScheduled = await isRestNotificationScheduled(storedTimer.notificationId);
      if (!isEffectActive || !isMountedRef.current) return;

      setClockNow(Date.now());
      setRestTimer(stillScheduled ? storedTimer : { ...storedTimer, notificationId: undefined });
    }

    restoreRestTimer().catch(() => {
      // Sayaç okunamazsa antrenman ekranı normal çalışmaya devam eder.
    });

    return () => {
      isEffectActive = false;
    };
  }, [isProgramsLoading, isWorkoutRunning, restTimerStorageKey]);

  if (isProgramsLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.notFound}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.notFoundTitle}>{t('day.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!program || !day) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <Stack.Screen options={{ title: t('day.notFoundTitle') }} />
        <View style={styles.notFound}>
          <Ionicons name="alert-circle-outline" size={42} color={colors.textTertiary} />
          <Text style={styles.notFoundTitle}>{t('day.notFound')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/programs')}
            style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{t('programDetail.backToPrograms')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const selectedProgramId = program.id;
  const selectedDayId = day.id;
  const selectedDayExercises = day.exercises;
  const programDays = program.days;
  const dayIndex = program.days.findIndex((item) => item.id === day.id);
  const isScheduledToday = day.scheduledWeekday === today.getDay();
  const isActiveProgram = program.id === activeProgramId;
  const canTrackToday = isScheduledToday && isActiveProgram;
  const totalTargetSets = dayExercises.reduce((total, exercise) => total + exercise.targetSets, 0);
  const hasCardioExercises = allDayExercises.some(isCardioExercise);
  const dayProgress = resolveDayProgress({
    activityTotals,
    completedSetCounts,
    dateKey: todayKey,
    exercises: allDayExercises,
    getSetProgressKey,
  });
  // Aynı programın aynı günü için geçmiş tamamlanmış antrenmanların ortalaması
  // (bugünkü oturum hariç).
  const previousSessions = workoutSessions.filter(
    (session) =>
      session.programId === program.id &&
      session.dayId === day.id &&
      session.dateKey !== todayKey &&
      session.status === 'completed',
  );
  const averageDurationSeconds = previousSessions.length
    ? Math.round(
        previousSessions.reduce((total, session) => total + session.accumulatedDurationSeconds, 0) /
          previousSessions.length,
      )
    : undefined;
  const isWorkoutComplete =
    dayProgress.targetUnits > 0 && dayProgress.doneUnits >= dayProgress.targetUnits;
  const hasProgress = dayProgress.hasProgress;
  // Antrenman başlamadan önce gün, referans tasarımdaki sade plan görünümünü
  // kullanır; antrenman başlayınca set giriş kartlarına geçilir.
  const isPlanMode = !workoutSession && !hasProgress;
  const elapsedSeconds = workoutSession ? getWorkoutDurationSeconds(workoutSession, clockNow) : 0;
  const restProgress = restTimer ? getRestTimerProgress(restTimer, clockNow) : undefined;
  const canCompleteSets = canTrackToday && workoutSession?.status === 'running';
  const isCompleteSetDisabled =
    !canCompleteSets || Boolean(pendingExerciseId) || (isActiveExerciseComplete && !isExtraSetMode);

  /**
   * Kardiyoda "tamamlandı → kilitle" kuralı YOKTUR: kullanıcı kaydını her zaman
   * düzeltebilmelidir. Düğme yalnızca oturum uygun değilken veya istek
   * uçarken kapanır.
   */
  const isActivityDisabled = !canCompleteSets || isActivityPending;

  const activeDropSetDrafts = activeExercise ? (dropSetDrafts[activeExercise.id] ?? []) : [];

  function addDropSetDraft() {
    if (!activeExercise) return;
    setDropSetDrafts((current) => ({
      ...current,
      [activeExercise.id]: [...(current[activeExercise.id] ?? []), { reps: '', weight: '' }],
    }));
  }

  function updateDropSetDraft(index: number, field: 'reps' | 'weight', value: string) {
    if (!activeExercise) return;
    setDropSetDrafts((current) => {
      const rows = [...(current[activeExercise.id] ?? [])];
      if (!rows[index]) return current;
      rows[index] = { ...rows[index], [field]: value };
      return { ...current, [activeExercise.id]: rows };
    });
  }

  /** Kaldırılan satır taslaktan KALICI olarak çıkar. */
  function removeDropSetDraft(index: number) {
    if (!activeExercise) return;
    setDropSetDrafts((current) => {
      const rows = (current[activeExercise.id] ?? []).filter((_row, rowIndex) => rowIndex !== index);
      return { ...current, [activeExercise.id]: rows };
    });
  }

  async function submitActiveSet() {
    if (!activeExercise || pendingExerciseId) return;

    const repetitions = parseNumberInput(repetitionsInput);
    const weightKg = parseOptionalNumberInput(weightInput);
    const rpe = parseOptionalNumberInput(rpeInput);

    if (repetitions === undefined || !Number.isInteger(repetitions) || repetitions < 0 || repetitions > 1000) {
      setValidationError(t('day.repsValidation'));
      return;
    }

    if (weightKg === null || (weightKg !== undefined && (weightKg < 0 || weightKg > 99999))) {
      setValidationError(t('day.weightValidation'));
      return;
    }

    if (rpe === null || (rpe !== undefined && (rpe < 0 || rpe > 10))) {
      setValidationError(t('day.rpeValidation'));
      return;
    }

    /**
     * Drop set doğrulaması ana set kurallarıyla AYNI sınırları kullanır.
     *   * Tamamen boş satır → drop set yapılmamış sayılır, kayda girmez.
     *   * Kısmen doldurulmuş/geçersiz satır → kayıt engellenir ve lokalize
     *     hata gösterilir.
     */
    const dropSets: WorkoutDropSetPerformance[] = [];
    for (const draft of activeDropSetDrafts) {
      const isEmpty = draft.weight.trim() === '' && draft.reps.trim() === '';
      if (isEmpty) continue;

      const dropRepetitions = parseNumberInput(draft.reps);
      const dropWeightKg = parseOptionalNumberInput(draft.weight);

      if (
        dropRepetitions === undefined ||
        !Number.isInteger(dropRepetitions) ||
        dropRepetitions < 0 ||
        dropRepetitions > 1000 ||
        dropWeightKg === null ||
        (dropWeightKg !== undefined && (dropWeightKg < 0 || dropWeightKg > 99999))
      ) {
        setValidationError(t('day.dropSetValidation'));
        return;
      }

      dropSets.push(dropWeightKg === undefined ? { repetitions: dropRepetitions } : { repetitions: dropRepetitions, weightKg: dropWeightKg });
    }

    setValidationError(undefined);
    // Ana set ve dolu drop setler TEK insert'te kaydedilir; mola yalnızca
    // hepsi kaydedildikten sonra bir kez başlar (bkz. `handleCompleteSet`).
    await handleCompleteSet(activeExercise, { repetitions, weightKg, rpe, dropSets });
  }

  /**
   * Aktif molayı gerçekten bitirir: kayıt silinir, bildirim iptal edilir.
   * Kayıt silindiği için bekleyen bildirim planlaması da geçersiz kalır.
   */
  async function clearRestTimer(timer: RestTimerState | undefined = restTimer) {
    setRestTimer(undefined);
    await Promise.allSettled([
      removeRestTimer(restTimerStorageKey),
      cancelRestNotification(timer?.notificationId),
    ]);
  }

  async function handleWorkoutToggle() {
    setIsWorkoutActionPending(true);
    try {
      void Haptics.selectionAsync();
      if (!workoutSession) {
        await startWorkout(selectedProgramId, selectedDayId, todayKey);
        return;
      }

      if (workoutSession.status === 'running') {
        await pauseWorkout(workoutSession.id);
        void clearRestTimer();
        /**
         * Antrenman duraklatılınca ÇALIŞAN aktivite ölçümü de duraklar; aksi
         * hâlde kullanıcı ara verirken kronometre sessizce sayardı.
         */
        await pauseActivityMeasurement();
        return;
      }

      /**
       * Antrenman devam ettirilince aktivite ölçümü KENDİLİĞİNDEN başlamaz;
       * kullanıcı açıkça `Devam et` demelidir.
       */
      await resumeWorkout(workoutSession.id);
    } catch (error) {
      showWorkoutError(t('day.workoutStateFailed'), error, t);
    } finally {
      setIsWorkoutActionPending(false);
    }
  }

  /** Kronometreyi hem ekrana hem depoya yazar; depo tek doğruluk kaynağıdır. */
  async function persistActivityTimer(timer: ActivityTimerState) {
    setActivityTimer(timer);
    await saveActivityTimer(
      getActivityTimerStorageKey(timer.sessionId, timer.programExerciseId),
      timer,
    );
  }

  /**
   * Hedef süre bildirimini planlar ve kimliğini kayda İLİŞTİRİR.
   *
   * Yalnız `duration` türünde ve yalnız hedef HENÜZ DOLMAMIŞSA planlanır.
   * İzin reddedilirse `undefined` döner; kronometre normal çalışmaya devam eder.
   * `attachActivityNotificationId` aynı `timerId` hâlâ kayıtlı değilse `false`
   * döner ve bildirim hemen iptal edilir — geç gelen planlama yeni ölçüme
   * bulaşmaz.
   */
  async function scheduleActivityTarget(timer: ActivityTimerState) {
    const delaySeconds = getActivityNotificationDelaySeconds(timer, Date.now());
    if (delaySeconds === undefined) return;

    const notificationId = await scheduleActivityTargetNotification(
      delaySeconds,
      {
        body: t('day.activityTargetNotificationBody', { name: timer.exerciseName }),
        title: timer.exerciseName,
      },
      { programExerciseId: timer.programExerciseId, sessionId: timer.sessionId },
    ).catch(() => undefined);
    if (!notificationId) return;

    const storageKey = getActivityTimerStorageKey(timer.sessionId, timer.programExerciseId);
    const attached = await attachActivityNotificationId(
      storageKey,
      timer.timerId,
      timer.startedAt,
      notificationId,
    );
    if (!attached) {
      void cancelActivityTargetNotification(notificationId);
      return;
    }
    setActivityTimer((current) =>
      current?.timerId === timer.timerId ? { ...current, notificationId } : current,
    );
  }

  /**
   * ÖLÇÜMÜ BAŞLAT.
   *
   * Aynı antrenman oturumunda BAŞKA bir kardiyo ölçümü açıksa kullanıcıya
   * sorulur; çalışan ölçüm sessizce çöpe atılmaz.
   */
  async function startActivityMeasurement() {
    if (!activeCardioExercise || !workoutSession || activityTimer) return;
    setActivityError(undefined);

    try {
      const others = await findSessionActivityTimers(workoutSession.id, activeCardioExercise.id);
      if (others.length > 0) {
        const other = others[0];
        Alert.alert(
          t('day.runningActivityTitle'),
          t('day.runningActivityBody', { name: other.timer.exerciseName }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('day.returnToActivity'),
              onPress: () => {
                setSelectedExerciseId(other.timer.programExerciseId);
                setIsManualSelection(true);
              },
            },
            {
              text: t('day.cancelMeasurement'),
              style: 'destructive',
              onPress: () => {
                void cancelActivityTargetNotification(other.timer.notificationId);
                void removeActivityTimer(other.storageKey, other.timer.timerId);
              },
            },
          ],
        );
        return;
      }

      const timer = createActivityTimer({
        exerciseName: activeCardioExerciseName,
        now: Date.now(),
        programExerciseId: activeCardioExercise.id,
        sessionId: workoutSession.id,
        targetDurationSeconds:
          activeCardioExercise.trackingMode === 'duration'
            ? activeCardioExercise.targetDurationSeconds
            : undefined,
        trackingMode: activeCardioExercise.trackingMode,
      });

      setClockNow(Date.now());
      await persistActivityTimer(timer);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void scheduleActivityTarget(timer);
    } catch (error) {
      showWorkoutError(t('day.activityStartFailed'), error, t);
    }
  }

  /** Duraklat — süre donar, bekleyen hedef bildirimi İPTAL edilir. */
  async function pauseActivityMeasurement() {
    if (!activityTimer || activityTimer.status !== 'running') return;
    const paused = pauseActivityTimer(activityTimer, Date.now());
    void cancelActivityTargetNotification(activityTimer.notificationId);
    void Haptics.selectionAsync();
    await persistActivityTimer(paused);
  }

  /** Devam et — bildirim YALNIZ KALAN süre için yeniden planlanır. */
  async function resumeActivityMeasurement() {
    if (!activityTimer || activityTimer.status !== 'paused') return;
    const resumed = resumeActivityTimer(activityTimer, Date.now());
    setClockNow(Date.now());
    void Haptics.selectionAsync();
    await persistActivityTimer(resumed);
    void scheduleActivityTarget(resumed);
  }

  /**
   * ÖLÇÜMÜ İPTAL ET.
   *
   * Yalnız kronometreyi atar; daha önce KAYDEDİLMİŞ veritabanı kaydına
   * DOKUNMAZ. "Yeniden ölç" sırasında vazgeçen kullanıcı eski kaydını korur.
   */
  function confirmCancelMeasurement() {
    if (!activityTimer) return;
    const timer = activityTimer;

    Alert.alert(t('day.cancelMeasurement'), t('day.cancelMeasurementBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('day.cancelMeasurement'),
        style: 'destructive',
        onPress: () => {
          void cancelActivityTargetNotification(timer.notificationId);
          void removeActivityTimer(
            getActivityTimerStorageKey(timer.sessionId, timer.programExerciseId),
            timer.timerId,
          );
          setActivityTimer(undefined);
          setIsFinishingActivity(false);
          setActivityError(undefined);
        },
      },
    ]);
  }

  /**
   * BİTİR — ölçümü durdurur ve onay adımını açar.
   *
   * Bu adımda veritabanına HENÜZ YAZILMAZ; kullanıcı `Kaydet ve bitir` demeden
   * kayıt oluşmaz. Hedefin dolması da aktiviteyi otomatik bitirmez.
   */
  async function finishActivityMeasurement() {
    if (!activityTimer) return;
    if (activityTimer.status === 'running') {
      await pauseActivityMeasurement();
    }
    setIsFinishingActivity(true);
  }

  /**
   * AKTİVİTE KAYDI — doğrula, kaydet, sonra ÖNGÖRÜLEN toplamla bitişe karar ver.
   *
   * Karar `activityTotals` state'ine DEĞİL, `saveActivityRecord`'un döndürdüğü
   * öngörülen toplama dayanır: state bu render'da henüz güncellenmemiştir ve
   * stale closure sessizce yanlış karar verirdi.
   */
  async function submitActivity() {
    if (!activeCardioExercise || isActivityPending) return;

    setActivityError(undefined);

    /**
     * SÜRE KRONOMETREDEN GELİR — elle girilemez.
     *
     * Ölçüm yoksa kayıt yapılmaz: bu, "kullanıcı bitirmeden DB'ye yazılmaz"
     * kuralının istemci tarafındaki son kapısıdır.
     */
    if (!activityTimer) {
      setActivityError(t('day.durationRequired'));
      return;
    }
    const measuredSeconds = getActivityTimerProgress(activityTimer, Date.now()).elapsedSeconds;
    if (
      measuredSeconds < ACTIVITY_DURATION_SECONDS_MIN ||
      measuredSeconds > ACTIVITY_DURATION_SECONDS_MAX
    ) {
      setActivityError(t('day.durationRange'));
      return;
    }
    const duration = { ok: true as const, value: measuredSeconds };

    /**
     * Mesafe `distance` türünde ZORUNLU, `duration` türünde İSTEĞE BAĞLIDIR.
     * Süre her iki türde de zorunludur (kolon `not null`).
     */
    const distanceBounds = {
      max: ACTIVITY_DISTANCE_METERS_MAX,
      min: ACTIVITY_DISTANCE_METERS_MIN,
    };
    const distance =
      activeCardioExercise.trackingMode === 'distance'
        ? parseKilometersToMeters(activityDistanceInput, distanceBounds)
        : parseOptionalKilometersToMeters(activityDistanceInput, distanceBounds);
    if (!distance.ok) {
      setActivityError(
        distance.reason === 'empty'
          ? t('day.distanceRequired')
          : distance.reason === 'range'
            ? t('day.distanceRange')
            : t('day.distanceInvalid'),
      );
      return;
    }

    const rpe = parseOptionalRpe(activityRpeInput);
    if (!rpe.ok) {
      setActivityError(t('day.rpeValidation'));
      return;
    }

    const performance: ActivityPerformance = {
      distanceMeters: distance.value,
      durationSeconds: duration.value,
      rpe: rpe.value,
    };

    setIsActivityPending(true);
    const finishedTimer = activityTimer;
    try {
      const { activityTotals: projectedTotals } = await saveActivityRecord(
        todayKey,
        activeCardioExercise.id,
        performance,
      );

      /**
       * KRONOMETRE KAYDI YALNIZCA BAŞARILI YAZMADAN SONRA TEMİZLENİR.
       *
       * `saveActivityRecord` hata fırlatırsa buraya hiç gelinmez ve ölçüm hem
       * ekranda hem depoda DURUR — kullanıcı ağ hatasında emeğini kaybetmez.
       * Bekleyen hedef bildirimi de burada iptal edilir.
       */
      void cancelActivityTargetNotification(finishedTimer.notificationId);
      await removeActivityTimer(
        getActivityTimerStorageKey(finishedTimer.sessionId, finishedTimer.programExerciseId),
        finishedTimer.timerId,
      );
      setActivityTimer(undefined);
      setIsFinishingActivity(false);

      /**
       * Bitiş kararı BÜTÜN günün egzersizleri üzerinden, ortak saf çekirdekten
       * verilir. Karışık günde yalnız strength ya da yalnız aktivite
       * tamamlanması yetmez; yalnız kardiyo gününde hedef dolunca biter.
       */
      const completesWholeWorkout = completesWorkoutAfterActivity({
        activityTotals: projectedTotals,
        completedSetCounts,
        dateKey: todayKey,
        exercises: allDayExercises,
        getSetProgressKey,
      });

      if (completesWholeWorkout) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (workoutSession?.status === 'running') {
          await finishWorkout(workoutSession.id);
        }
        void clearRestTimer();
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      showWorkoutError(t('day.activitySaveFailed'), error, t);
    } finally {
      setIsActivityPending(false);
    }
  }

  /**
   * KAYDI TEMİZLE — onay ister.
   *
   * Verilmiş ödüller GERİ ALINMAZ; bu, mevcut set undo davranışıyla birebir
   * aynıdır (`undoCompletedSet` de defteri geri sarmaz) ve onay metninde
   * kullanıcıya açıkça söylenir.
   */
  function confirmClearActivity() {
    if (!activeCardioExercise || !existingActivityRecord) return;
    const recordId = existingActivityRecord.id;

    Alert.alert(
      t('day.clearActivityTitle'),
      t('day.clearActivityBody', { name: activeCardioExerciseName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('day.clearActivity'),
          style: 'destructive',
          onPress: () => {
            setIsActivityPending(true);
            void deleteActivityRecord(recordId)
              .then(() => {
                setActivityDistanceInput('');
                setActivityRpeInput('');
                setActivityError(undefined);
              })
              .catch((error) => showWorkoutError(t('day.activityDeleteFailed'), error, t))
              .finally(() => setIsActivityPending(false));
          },
        },
      ],
    );
  }

  async function handleExerciseSelection(
    exerciseId: string,
    isComplete: boolean,
    /**
     * Kardiyo satırı, hedefi dolmamış olsa bile tamamlanmış oturumu devam
     * ettirir: kullanıcı kaydını düzeltebilmelidir ve yazma yolu yalnızca
     * `running` oturumda açıktır. Mevcut resume sözleşmesi yeniden kullanılır,
     * yeni bir akış tasarlanmaz.
     */
    alwaysResume = false,
  ) {
    setSelectedExerciseId(exerciseId);
    setIsManualSelection(isComplete);

    // Son planlı set antrenmanı otomatik bitirir. Kullanıcı tamamlanmış
    // bir egzersize yeniden dokunursa aynı oturumu ekstra set için devam ettir.
    if ((!isComplete && !alwaysResume) || workoutSession?.status !== 'completed') return;

    setIsWorkoutActionPending(true);
    try {
      await resumeWorkout(workoutSession.id);
    } catch (error) {
      showWorkoutError(t('day.workoutStateFailed'), error, t);
    } finally {
      setIsWorkoutActionPending(false);
    }
  }

  function handleFinishWorkout() {
    if (!workoutSession) return;

    Alert.alert(t('day.finishTitle'), t('day.finishBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('day.finish'),
        onPress: () => {
          void finishCurrentWorkout(workoutSession.id);
        },
      },
    ]);
  }

  async function finishCurrentWorkout(sessionId: string) {
    /**
     * KAYDEDİLMEMİŞ ÖLÇÜM VARSA kullanıcı uyarılır; kronometre sessizce çöpe
     * atılmaz. Üç seçenek de mevcut akışları yeniden kullanır.
     */
    if (activityTimer) {
      Alert.alert(
        t('day.runningActivityTitle'),
        t('day.runningActivityBody', { name: activityTimer.exerciseName }),
        [
          {
            text: t('day.returnToActivity'),
            onPress: () => {
              setSelectedExerciseId(activityTimer.programExerciseId);
              setIsManualSelection(true);
            },
          },
          { text: t('day.saveActivity'), onPress: () => void finishActivityMeasurement() },
          {
            text: t('day.cancelMeasurement'),
            style: 'destructive',
            onPress: () => {
              void cancelActivityTargetNotification(activityTimer.notificationId);
              void removeActivityTimer(
                getActivityTimerStorageKey(activityTimer.sessionId, activityTimer.programExerciseId),
                activityTimer.timerId,
              );
              setActivityTimer(undefined);
              setIsFinishingActivity(false);
              void finishCurrentWorkout(sessionId);
            },
          },
        ],
      );
      return;
    }

    setIsWorkoutActionPending(true);
    try {
      await finishWorkout(sessionId);
      // Manuel bitiş de aynı başarı noktasını kullanır: hata olursa buraya
      // hiç gelinmez, dolayısıyla kutlama oynamaz.
      triggerReaction('workout-complete');
      void clearRestTimer();
    } catch (error) {
      showWorkoutError(t('day.finishFailed'), error, t);
    } finally {
      setIsWorkoutActionPending(false);
    }
  }

  async function handleCompleteSet(exercise: StrengthProgramExercise, performance: WorkoutSetPerformance) {
    setPendingExerciseId(exercise.id);
    try {
      await completeSet(todayKey, exercise.id, exercise.targetSets, performance);

      /**
       * OTOMATİK BİTİŞ KARARI — tür-farkında ve TEK kaynaklı.
       *
       * Girdi olarak `dayExercises` (yalnız strength) DEĞİL, günün BÜTÜN
       * egzersizleri verilir: karma bir günde strength hedefleri dolsa bile
       * duration/distance hedefi eksikse oturum KAPANMAMALIDIR. Sayaçlar
       * kayıt gönderilmeden ÖNCEKİ değerlerdir; yardımcı, katkı veren kaydın
       * etkisini kendi içinde öngörür ve ekstra sette hiç bitirmez.
       *
       * Karar matematiği burada DEĞİL, `utils/workout-tracking.ts` içindeki
       * ortak çekirdektedir; ekranda ikinci bir algoritma tutulmaz.
       */
      const completesWholeWorkout = completesWorkoutAfterSet({
        activityTotals,
        completedExerciseId: exercise.id,
        completedSetCounts,
        dateKey: todayKey,
        exercises: day?.exercises ?? [],
        getSetProgressKey,
      });
      if (completesWholeWorkout) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (workoutSession?.status === 'running') {
          await finishWorkout(workoutSession.id);
          // Yalnızca finishWorkout başarıyla döndüyse kutlama oynar. Bu dal
          // erken `return` ettiği için küçük set tepkisi hiç tetiklenmez.
          triggerReaction('workout-complete');
        }
        void clearRestTimer();
        return;
      }

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Set gerçekten kaydedildi ve antrenmanı bitirmiyor: küçük sevinme.
      // Ek haptic yok; yukarıdaki mevcut davranış korunur.
      triggerReaction('set-complete');

      if (!restTimerEnabled || exercise.restSeconds <= 0) return;

      const exerciseName = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);
      // Yeni mola başlamadan önce önceki molanın bildirimi iptal edilir.
      await cancelRestNotification(restTimer?.notificationId);

      const nextRestTimer = createRestTimer(exerciseName, exercise.restSeconds, Date.now());
      setClockNow(Date.now());
      setRestTimer(nextRestTimer);
      // Sıra garanti altına alınır: kimliksiz kayıt, kimlikli kayıttan önce yazılır.
      await saveRestTimer(restTimerStorageKey, nextRestTimer);

      const notificationId = await scheduleRestNotification(exercise.restSeconds, {
        body: t('rest.notificationBody', { name: exerciseName }),
        title: t('rest.notificationTitle'),
      });

      if (!notificationId) return;

      // Kimlik yalnızca aynı mola hâlâ kayıtlıysa eklenir. Ekrandan çıkılmış
      // olsa bile kayıt güncellenir; böylece bildirim sonradan iptal edilebilir.
      const isAttached = await attachRestNotificationId(
        restTimerStorageKey,
        nextRestTimer.timerId,
        notificationId,
      );

      if (!isAttached) {
        // Mola bu sırada bitti/durduruldu, yenisi başladı veya ayar kapatıldı.
        await cancelRestNotification(notificationId);
        return;
      }

      if (isMountedRef.current) {
        setRestTimer((current) =>
          current?.timerId === nextRestTimer.timerId ? { ...current, notificationId } : current,
        );
      }
    } catch (error) {
      showWorkoutError(t('day.setSaveFailed'), error, t);
    } finally {
      setPendingExerciseId(undefined);
    }
  }

  async function handleUndoSet(exercise: ProgramExercise) {
    setPendingExerciseId(exercise.id);
    try {
      await undoCompletedSet(todayKey, exercise.id);
    } catch (error) {
      showWorkoutError(t('day.setUndoFailed'), error, t);
    } finally {
      setPendingExerciseId(undefined);
    }
  }

  async function handleResetSets() {
    setIsWorkoutActionPending(true);
    try {
      await resetCompletedSets(
        todayKey,
        selectedDayExercises.map((exercise) => exercise.id),
      );
      void clearRestTimer();
    } catch (error) {
      showWorkoutError(t('day.resetFailed'), error, t);
    } finally {
      setIsWorkoutActionPending(false);
    }
  }

  function openDayEditor() {
    if (!day) return;
    setDayNameDraft(day.name);
    setDayVisualDraft(getDayVisual(day.visual, dayIndex));
    setDayWeekdayDraft(day.scheduledWeekday ?? weekdayOptions[dayIndex % weekdayOptions.length].value);
    setDayIsOffDraft(day.isOffDay ?? false);
    setIsDayEditorOpen(true);
  }

  async function saveDayChanges() {
    const trimmedName = dayNameDraft.trim();
    if (!trimmedName) {
      Alert.alert(t('day.dayNameRequiredTitle'), t('day.dayNameRequiredBody'));
      return;
    }

    const weekdayAlreadyUsed = programDays.some(
      (programDay) => programDay.id !== selectedDayId && programDay.scheduledWeekday === dayWeekdayDraft,
    );
    if (weekdayAlreadyUsed) {
      Alert.alert(t('day.weekdayUsedTitle'), t('day.weekdayUsedBody', { weekday: getWeekdayLabel(dayWeekdayDraft, locale) }));
      return;
    }

    try {
      await updateDay(selectedProgramId, selectedDayId, {
        isOffDay: dayIsOffDraft,
        name: trimmedName,
        scheduledWeekday: dayWeekdayDraft,
        visual: dayVisualDraft,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsDayEditorOpen(false);
    } catch (error) {
      showWorkoutError(t('day.updateFailed'), error, t);
    }
  }

  async function moveDay(direction: -1 | 1) {
    const targetIndex = dayIndex + direction;
    if (targetIndex < 0 || targetIndex >= programDays.length) return;

    const reorderedDays = [...programDays];
    [reorderedDays[dayIndex], reorderedDays[targetIndex]] = [reorderedDays[targetIndex], reorderedDays[dayIndex]];
    try {
      void Haptics.selectionAsync();
      await reorderDays(selectedProgramId, reorderedDays);
    } catch (error) {
      showWorkoutError(t('day.reorderFailed'), error, t);
    }
  }

  /**
   * Egzersiz düzenleyici YALNIZCA strength alanlarını (set/tekrar/mola) taşır.
   * Kardiyo satırı listede görünmeye devam eder ama bu fazda düzenlenemez;
   * sessizce yanlış alanları göstermek yerine açıkça hiçbir şey yapmaz.
   */
  /**
   * Düzenleyici KAYITLI türle açılır ve o türün hedef alanlarını doldurur.
   * Tür seçici burada YALNIZCA okunur bir göstergedir: mevcut bir egzersizin
   * türünü değiştirmek geçmiş kanıtı bozar ve sunucudaki
   * `program_exercises_mode_guard` bunu zaten reddeder.
   */
  function openExerciseEditor(exercise: ProgramExercise, exerciseName: string) {
    setEditingExerciseId(exercise.id);
    setEditingExerciseName(exerciseName);
    setEditingTrackingMode(exercise.trackingMode);
    setExerciseVisualDraft(getExerciseVisual(exercise.visual));

    if (exercise.trackingMode === 'sets_reps') {
      setTargetSetsDraft(String(exercise.targetSets));
      setTargetRepsDraft(exercise.targetReps);
      setRestSecondsDraft(String(exercise.restSeconds));
      return;
    }
    if (exercise.trackingMode === 'duration') {
      setTargetDurationDraft(String(Math.round(exercise.targetDurationSeconds / 60)));
      return;
    }
    setTargetDistanceDraft(formatMetersAsKilometers(exercise.targetDistanceMeters));
  }

  async function saveExerciseChanges() {
    if (!editingExerciseId) return;

    /**
     * Hedef AYNI MOD İÇİNDE düzenlenir. Yük `trackingMode`'u yalnızca hangi
     * kolonların yazılacağını seçmek için taşır; UPDATE'e hiç konmaz.
     */
    let updates: Parameters<typeof updateExercise>[3];

    if (editingTrackingMode === 'sets_reps') {
      const targetSets = Number(targetSetsDraft);
      const restSeconds = Number(restSecondsDraft);
      const targetReps = targetRepsDraft.trim();

      if (!Number.isInteger(targetSets) || targetSets < 1 || targetSets > 20) {
        Alert.alert(t('day.setsInvalidTitle'), t('day.setsInvalidBody'));
        return;
      }

      if (!/^\d{1,2}(-\d{1,2})?$/.test(targetReps)) {
        Alert.alert(t('day.repsInvalidTitle'), t('day.repsInvalidBody'));
        return;
      }

      if (!Number.isInteger(restSeconds) || restSeconds < 0 || restSeconds > 600) {
        Alert.alert(t('day.restInvalidTitle'), t('day.restInvalidBody'));
        return;
      }

      updates = {
        trackingMode: 'sets_reps',
        restSeconds,
        targetReps,
        targetSets,
        visual: exerciseVisualDraft,
      };
    } else if (editingTrackingMode === 'duration') {
      const parsed = parseMinutesToSeconds(targetDurationDraft, {
        max: TARGET_DURATION_SECONDS_MAX,
        min: TARGET_DURATION_SECONDS_MIN,
      });
      if (!parsed.ok) {
        Alert.alert(t('addExercise.durationInvalidTitle'), t('addExercise.durationInvalidBody'));
        return;
      }
      updates = {
        trackingMode: 'duration',
        targetDurationSeconds: parsed.value,
        visual: exerciseVisualDraft,
      };
    } else {
      const parsed = parseKilometersToMeters(targetDistanceDraft, {
        max: TARGET_DISTANCE_METERS_MAX,
        min: TARGET_DISTANCE_METERS_MIN,
      });
      if (!parsed.ok) {
        Alert.alert(t('addExercise.distanceInvalidTitle'), t('addExercise.distanceInvalidBody'));
        return;
      }
      updates = {
        trackingMode: 'distance',
        targetDistanceMeters: parsed.value,
        visual: exerciseVisualDraft,
      };
    }

    try {
      await updateExercise(selectedProgramId, selectedDayId, editingExerciseId, updates);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditingExerciseId(null);
    } catch (error) {
      showWorkoutError(t('day.exerciseUpdateFailed'), error, t);
    }
  }

  function confirmRemoveExercise() {
    if (!editingExerciseId) return;
    const exerciseId = editingExerciseId;

    Alert.alert(t('day.removeExercise'), t('day.removeExerciseBody', { name: editingExerciseName }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: () => {
          setEditingExerciseId(null);
          void removeExerciseFromDay(selectedProgramId, selectedDayId, exerciseId).catch((error) =>
            showWorkoutError(t('day.removeFailed'), error, t),
          );
        },
      },
    ]);
  }

  /** Gün işlemleri referans gövdeyi bozmamak için başlık menüsünde tutulur. */
  function openDayMenu() {
    Alert.alert(day?.name ?? '', t('day.dayOptions'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('day.editDay'), onPress: openDayEditor },
      ...(dayIndex > 0 ? [{ text: t('day.moveUp'), onPress: () => void moveDay(-1) }] : []),
      ...(dayIndex < programDays.length - 1
        ? [{ text: t('day.moveDown'), onPress: () => void moveDay(1) }]
        : []),
    ]);
  }

  const dayHeaderButton = (
    <Pressable
      accessibilityLabel={t('day.dayOptions')}
      accessibilityRole="button"
      hitSlop={10}
      onPress={openDayMenu}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
      <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
    </Pressable>
  );

  function openAddExercise() {
    router.push({
      pathname: '/program/[id]/day/[dayId]/add-exercise',
      params: { id: selectedProgramId, dayId: selectedDayId },
    });
  }

  /**
   * "Egzersiz ekle" düğmesi AKTİF ANTRENMAN görünümünde özet satırından
   * kaldırıldı; oradaki tek kopyası "Tüm egzersizler" panelinin hemen
   * altındadır. Plan modunda (antrenman başlamadan önce) panel hiç render
   * edilmediği için düğme burada kalır — iki konum birbirini dışlar, aynı
   * anda iki kopya görünmez.
   */
  const daySummaryRow = (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryText}>
        {hasCardioExercises
          ? t('day.exerciseSummary', { exercises: day.exercises.length })
          : t('day.summary', { exercises: day.exercises.length, sets: totalTargetSets })}
      </Text>
      {isPlanMode && !day.isOffDay && (
        <Pressable
          accessibilityLabel={t('day.addExerciseLabel')}
          accessibilityRole="button"
          onPress={openAddExercise}
          style={({ pressed }) => [styles.addExerciseButton, pressed && styles.pressed]}>
          <Text style={styles.addExerciseText}>{t('day.addExercise')}</Text>
        </Pressable>
      )}
    </View>
  );

  /**
   * "Günü düzenle" sayfa içine gömülü form OLARAK DEĞİL, ayrı bir alt sayfa
   * (bottom sheet) olarak açılır — "Programı düzenle" ve "Egzersizi düzenle"
   * ile aynı tasarım ailesi.
   *
   * Aynı modal hem normal antrenman günü hem Off Day ekranında render edilir;
   * formun ikinci bir kopyası YOKTUR. State ve `saveDayChanges` aynen
   * yeniden kullanılır.
   */
  const dayEditorModal = (
    <Modal
      animationType="slide"
      onRequestClose={() => setIsDayEditorOpen(false)}
      presentationStyle="overFullScreen"
      transparent
      visible={isDayEditorOpen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.dayEditorModal}>
        <Pressable
          accessibilityLabel={t('common.cancel')}
          accessibilityRole="button"
          onPress={() => setIsDayEditorOpen(false)}
          style={styles.dayEditorBackdrop}
        />
        <SafeAreaView edges={['bottom']} style={styles.dayEditorSheet}>
          <View style={styles.dayEditorHandle} />
          <ScrollView
            contentContainerStyle={styles.dayEditorContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <Text style={styles.dayEditorTitle}>{t('day.editDay')}</Text>

            <View style={styles.dayEditorField}>
              <Text style={styles.dayEditorLabel}>{t('day.dayName')}</Text>
              <TextInput
                keyboardAppearance={isDark ? 'dark' : 'light'}
                maxLength={30}
                onChangeText={setDayNameDraft}
                placeholder={t('day.dayName')}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                style={styles.dayEditorInput}
                value={dayNameDraft}
              />
            </View>

            <View style={styles.dayEditorField}>
              <Text style={styles.dayEditorLabel}>{t('day.calendarDay')}</Text>
              <ScrollView
                contentContainerStyle={styles.dayWeekdayOptions}
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}>
                {weekdayOptions.map((option) => {
                  const selected = dayWeekdayDraft === option.value;
                  // Başka bir günün kullandığı takvim günü seçilemez.
                  const usedByOtherDay = programDays.some(
                    (programDay) => programDay.id !== selectedDayId && programDay.scheduledWeekday === option.value,
                  );

                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: usedByOtherDay }}
                      disabled={usedByOtherDay}
                      key={option.value}
                      onPress={() => setDayWeekdayDraft(option.value)}
                      style={({ pressed }) => [
                        styles.dayWeekdayOption,
                        selected && styles.dayWeekdayOptionSelected,
                        usedByOtherDay && styles.dayWeekdayOptionDisabled,
                        pressed && styles.pressed,
                      ]}>
                      <Text
                        style={[
                          styles.dayWeekdayOptionText,
                          selected && styles.dayWeekdayOptionTextSelected,
                        ]}>
                        {option.shortLabel}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.dayEditorSwitchRow}>
              <View style={styles.dayEditorSwitchText}>
                <Text style={styles.dayEditorLabel}>{t('day.offDay')}</Text>
                <Text style={styles.dayEditorCaption}>{t('day.offDayCaption')}</Text>
              </View>
              <Switch
                onValueChange={setDayIsOffDraft}
                trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
                value={dayIsOffDraft}
              />
            </View>

            {/* Programı düzenle ile AYNI kompakt seçici; Apply akışı korunur. */}
            <WorkoutVisualPicker
              onSelect={setDayVisualDraft}
              selectedVisual={dayVisualDraft}
              variant="programEdit"
            />

            <MotionPressable
              accessibilityRole="button"
              onPress={() => void saveDayChanges()}
              style={styles.dayEditorSaveButton}>
              <Text style={styles.dayEditorSaveButtonText}>{t('common.save')}</Text>
            </MotionPressable>

            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setIsDayEditorOpen(false)}
              style={({ pressed }) => [styles.dayEditorCancelButton, pressed && styles.pressed]}>
              <Text style={styles.dayEditorCancelButtonText}>{t('common.cancel')}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );

  if (day.isOffDay) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        {/*
          KÖK NEDEN: off-day dalında `headerRight` verilmediği için "Günü
          düzenle" menüsünü açan ⋯ düğmesi hiç çizilmiyordu ve off day bir daha
          normal güne çevrilemiyordu. Normal günle AYNI başlık düğmesi ve AYNI
          `dayEditorModal` kullanılır; yeni bir tasarım eklenmez.
        */}
        <Stack.Screen options={{ headerRight: () => dayHeaderButton, title: day.name }} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {daySummaryRow}
          <View style={styles.restDayContainer}>
            <Ionicons name="moon-outline" size={32} color={colors.textTertiary} />
            <Text style={styles.restDayEyebrow}>
              {getWeekdayLabel(day.scheduledWeekday, locale).toLocaleUpperCase(locale)}
            </Text>
            <Text style={styles.restDayTitle}>
              {isScheduledToday && isActiveProgram
                ? t('day.restDayToday')
                : t('day.restDayOther', { weekday: getWeekdayLabel(day.scheduledWeekday, locale) })}
            </Text>
            <Text style={styles.restDayBody}>
              {isScheduledToday && isActiveProgram
                ? t('day.restDayTodayBody')
                : isActiveProgram
                  ? t('day.restDayActiveBody')
                  : t('day.restDayInactiveBody')}
            </Text>
          </View>
        </ScrollView>
        {dayEditorModal}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={isPlanMode ? ['bottom'] : ['top', 'bottom']}>
      <Stack.Screen
        options={
          isPlanMode
            ? { headerRight: () => dayHeaderButton, headerShown: true, title: day.name }
            : { headerShown: false }
        }
      />
      <View style={styles.workoutScreen}>
      {!isPlanMode && (
        <>
          <View style={styles.workoutTopBar}>
            <Pressable
              accessibilityLabel={t('common.back')}
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.topBarButton, pressed && styles.pressed]}>
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>

            <Pressable
              accessibilityHint={t('a11y.toggleTimer')}
              accessibilityLabel={t('day.workoutProgress', {
                completed: dayProgress.doneUnits,
                total: dayProgress.targetUnits,
              })}
              accessibilityRole="button"
              disabled={!workoutSession || isWorkoutActionPending}
              onPress={() => void handleWorkoutToggle()}
              style={({ pressed }) => [styles.topBarCenter, pressed && styles.pressed]}>
              <Text style={styles.topBarStatus}>
                {t('day.workoutProgress', {
                  completed: dayProgress.doneUnits,
                  total: dayProgress.targetUnits,
                })} ·{' '}
                {formatDuration(elapsedSeconds)}
                {workoutSession?.status === 'paused' ? ` · ${t('day.resumeWorkout')}` : ''}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={isWorkoutActionPending || !workoutSession}
              hitSlop={8}
              onPress={handleFinishWorkout}
              style={({ pressed }) => [styles.topBarButton, pressed && styles.pressed]}>
              <Text numberOfLines={1} style={styles.topBarFinish}>{t('day.finish')}</Text>
            </Pressable>
          </View>

          <View style={styles.topBarProgressTrack}>
            <View
              style={[
                styles.topBarProgressFill,
                {
                  width: `${
                    dayProgress.targetUnits
                      ? (dayProgress.doneUnits / dayProgress.targetUnits) * 100
                      : 0
                  }%`,
                },
              ]}
            />
          </View>
        </>
      )}
      <ProgramDetailScroll
        contentContainerStyle={[styles.content, restTimerEnabled && restTimer && styles.contentWithRestTimer]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {daySummaryRow}

        {isPlanMode ? (
          <>
            {day.exercises.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="barbell-outline" size={30} color={colors.textTertiary} />
                <Text style={styles.emptyTitle}>{t('day.emptyTitle')}</Text>
                <Text style={styles.emptyDescription}>{t('day.emptyBody')}</Text>
              </View>
            ) : (
              <ProgramExerciseList
                exercises={day.exercises}
                onEdit={openExerciseEditor}
                onRemove={() => undefined}
                onReorder={(exercises) => {
                  void reorderExercisesInDay(selectedProgramId, selectedDayId, exercises).catch((error) =>
                    showWorkoutError(t('day.exerciseReorderFailed'), error, t),
                  );
                }}
                showIcons={showExerciseIcons}
              />
            )}

            {!canTrackToday && (
              <View style={styles.scheduleNotice}>
                <Ionicons name="calendar-outline" size={16} color={colors.accent} />
                <View style={styles.scheduleNoticeText}>
                  <Text style={styles.scheduleNoticeTitle}>
                    {isActiveProgram ? t('day.notScheduledTitle') : t('day.notActiveProgramTitle')}
                  </Text>
                  <Text style={styles.scheduleNoticeBody}>
                    {isActiveProgram
                      ? t('day.notScheduledBody', { weekday: getWeekdayLabel(day.scheduledWeekday, locale) })
                      : t('day.notActiveProgramBody')}
                  </Text>
                </View>
              </View>
            )}

          </>
        ) : (
          <>
            {!canTrackToday && (
              <View style={styles.scheduleNotice}>
                <Ionicons name="calendar-outline" size={16} color={colors.accent} />
                <View style={styles.scheduleNoticeText}>
                  <Text style={styles.scheduleNoticeTitle}>
                    {isActiveProgram ? t('day.notScheduledTitle') : t('day.notActiveProgramTitle')}
                  </Text>
                  <Text style={styles.scheduleNoticeBody}>
                    {isActiveProgram
                      ? t('day.notScheduledBody', { weekday: getWeekdayLabel(day.scheduledWeekday, locale) })
                      : t('day.notActiveProgramBody')}
                  </Text>
                </View>
              </View>
            )}

            {isWorkoutComplete && (
              <View style={styles.successCard}>
                <Ionicons name="checkmark-circle" size={20} color={colors.disciplineCompleted} />
                <View style={styles.successText}>
                  <Text style={styles.successTitle}>{t('day.workoutComplete')}</Text>
                  <Text style={styles.successBody}>{t('day.allSetsDoneBody')}</Text>
                </View>
              </View>
            )}

            {/*
              KARDİYO PANELİ — set paneliyle AYNI konumda, aynı ritimde.
              Set paneli hiç render edilmez: iki panel asla üst üste binmez.
            */}
            {activePanelExercise && (
              <MotionLayout style={styles.activeExerciseLayout}>
                <MotionSwap
                  emphasis="clear"
                  pace="calm"
                  style={styles.activeExerciseSwap}
                  transitionKey={activeExerciseTransitionKey}>
                  <>
                  {activeCardioExercise && (
                    <View style={styles.activeSetBlock}>
                <Text style={styles.activeSetLabel}>
                  {activeCardioExercise.trackingMode === 'duration'
                    ? t('day.targetDurationLabel', {
                        minutes: Math.round(activeCardioExercise.targetDurationSeconds / 60),
                      })
                    : t('day.targetDistanceLabel', {
                        km: formatMetersAsKilometers(activeCardioExercise.targetDistanceMeters),
                      })}
                </Text>
                <Text numberOfLines={2} style={styles.activeExerciseName}>
                  {activeCardioExerciseName}
                </Text>

                {/*
                  KRONOMETRE — ekranın görsel odağı.
                  Değer `setInterval` sayısından değil, `clockNow` ile gerçek
                  saat farkından türetilir; arka planda geçen süre kaybolmaz.
                */}
                <View
                  accessibilityLabel={t('day.activityTimerLabel', { name: activeCardioExerciseName })}
                  accessibilityRole="timer"
                  accessibilityValue={{ text: activityTimerAccessibilityText }}
                  style={styles.activityTimerBlock}>
                  <Text style={styles.activityTimerValue}>
                    {formatActivityTimerValue(activityProgress?.elapsedSeconds ?? 0)}
                  </Text>
                  <Text style={styles.activityTimerCaption}>
                    {activityProgress === undefined
                      ? activeCardioExercise.trackingMode === 'duration'
                        ? t('day.targetDurationLabel', {
                            minutes: Math.round(activeCardioExercise.targetDurationSeconds / 60),
                          })
                        : t('day.targetDistanceLabel', {
                            km: formatMetersAsKilometers(activeCardioExercise.targetDistanceMeters),
                          })
                      : activityProgress.isTargetReached
                        ? `${t('day.targetReached')} · ${t('day.overtimeLabel')} ${formatActivityOvertime(activityProgress.overtimeSeconds)}`
                        : activeCardioExercise.trackingMode === 'duration'
                          ? `${t('day.targetRemaining')} ${formatActivityTimerValue(activityProgress.remainingSeconds)}`
                          : activityProgress.status === 'paused'
                            ? t('day.activityPausedState')
                            : t('day.activityRunningState')}
                  </Text>
                  {/*
                    Duraklatıldı satırı MotionCollapsible ile girer/çıkar; böylece
                    kronometrenin ALTINDAKİ içerik ansızın zıplamaz. Kronometre
                    DEĞERİ bu sarmalın DIŞINDA kaldığı için animasyon almaz.
                  */}
                  {activityProgress?.status === 'paused' && !activityProgress.isTargetReached ? (
                    <MotionCollapsible>
                      <Text style={styles.activityTimerState}>{t('day.activityPausedState')}</Text>
                    </MotionCollapsible>
                  ) : null}
                </View>

                {/*
                  KONTROL AŞAMASI — tek sakin MotionSwap.

                  Aşama anahtarı YALNIZ `activityPhase` (idle/tracking/finishing);
                  `activityTimer.status` (running/paused) anahtara GİRMEZ. Böylece
                  Duraklat/Devam Et timer'ı veya bitirme formu girişlerini remount
                  ETMEZ: TextInput odağı ve değerleri (state'te tutulur) korunur.
                  Kronometre bu sınırın DIŞINDADIR; değeri animasyon almaz. Reduce
                  Motion `MotionSwap`/`MotionCollapsible` içinde otomatik çalışır,
                  burada yeni kapı kurulmaz.

                  Küçük koşullu satırlar (hata/RPE bandı/tempo) girip çıkarken alt
                  alanlar zıplamasın diye `MotionCollapsible` kullanır. Aynı bölge
                  AYRICA `MotionSection` ile sarılmaz (çift animasyon yok).
                */}
                <MotionSwap
                  pace="calm"
                  style={styles.activityPhaseSwap}
                  transitionKey={activityPhase}>
                  {/* Kayıtlı ölçüm özeti — yeni ölçüm başlamadan önce görünür. */}
                  {!activityTimer && existingActivityRecord && (
                    <Text style={styles.activityHint}>
                      {t('day.savedActivitySummary')} ·{' '}
                      {formatActivityTimerValue(existingActivityRecord.durationSeconds)}
                      {existingActivityRecord.distanceMeters === undefined
                        ? ''
                        : ` · ${formatMetersAsKilometers(existingActivityRecord.distanceMeters)} ${t('day.kmUnit')}`}
                    </Text>
                  )}

                  {/*
                    BİTİRME ADIMI — yeni modal yığını YOK; aynı panelin içinde
                    compact onay. Ölçülen süre yukarıdaki kronometrede görünür ve
                    DEĞİŞTİRİLEMEZ; burada yalnız mesafe ve RPE girilir. Alan
                    değerleri state'te tutulduğu için aşama değişiminde kaybolmaz.
                  */}
                  {isFinishingActivity && (
                    <>
                      <View style={styles.activityFieldRow}>
                        <Text style={styles.activityFieldLabel}>
                          {t('day.actualDistance')}
                          {activeCardioExercise.trackingMode === 'duration'
                            ? ` · ${t('day.optional')}`
                            : ''}
                        </Text>
                        <TextInput
                          accessibilityHint={t('day.kmUnit')}
                          accessibilityLabel={t('day.actualDistance')}
                          editable={canCompleteSets && !isActivityPending}
                          keyboardType="decimal-pad"
                          maxLength={7}
                          onChangeText={setActivityDistanceInput}
                          placeholder="—"
                          placeholderTextColor={colors.textTertiary}
                          selectTextOnFocus
                          style={styles.activityFieldInput}
                          value={activityDistanceInput}
                        />
                        <Text style={styles.activityFieldUnit}>{t('day.kmUnit')}</Text>
                      </View>

                      <View style={styles.activityFieldRow}>
                        <Text style={styles.activityFieldLabel}>
                          {t('rpe.label')} · {t('day.optional')}
                        </Text>
                        <TextInput
                          accessibilityHint={t('rpe.description')}
                          accessibilityLabel={`${t('rpe.label')}, ${t('day.optional')}`}
                          editable={canCompleteSets && !isActivityPending}
                          keyboardType="decimal-pad"
                          maxLength={4}
                          onChangeText={setActivityRpeInput}
                          placeholder="—"
                          placeholderTextColor={colors.textTertiary}
                          selectTextOnFocus
                          style={styles.activityFieldInput}
                          value={activityRpeInput}
                        />
                        <Text style={styles.activityFieldUnit} />
                      </View>

                      {activityRpeBand && (
                        <MotionCollapsible>
                          <Text style={styles.activityRpeBand}>
                            {t(rpeBandLabelKey(activityRpeBand))}
                          </Text>
                        </MotionCollapsible>
                      )}

                      <Text style={styles.activityHint}>{t('rpe.description')}</Text>

                      {/* Tempo TÜRETİLİR; hiçbir yerde saklanmaz. */}
                      {activePaceSecondsPerKm !== undefined && (
                        <MotionCollapsible>
                          <Text style={styles.activityPace}>
                            {t('day.paceLabel')} · {formatDuration(Math.round(activePaceSecondsPerKm))}{' '}
                            {t('day.paceUnit')}
                          </Text>
                        </MotionCollapsible>
                      )}

                      {activityError && (
                        <MotionCollapsible>
                          <Text style={styles.validationError}>{activityError}</Text>
                        </MotionCollapsible>
                      )}

                      <MotionPressable
                        accessibilityLabel={t('day.activityDoneLabel', { name: activeCardioExerciseName })}
                        accessibilityRole="button"
                        accessibilityState={{ busy: isActivityPending, disabled: isActivityDisabled }}
                        disabled={isActivityDisabled}
                        onPress={() => void submitActivity()}
                        style={[
                          styles.completeSetPill,
                          isActivityDisabled && styles.completeSetPillDisabled,
                        ]}>
                        {isActivityPending ? (
                          <ActivityIndicator color={colors.background} size="small" />
                        ) : (
                          <Text style={styles.completeSetPillText}>
                            {canCompleteSets
                              ? t('day.saveAndFinishActivity')
                              : !workoutSession
                                ? t('day.startFirst')
                                : workoutSession.status === 'paused'
                                  ? t('day.workoutPaused')
                                  : t('day.availableOnScheduledDay')}
                          </Text>
                        )}
                      </MotionPressable>

                      <Pressable
                        accessibilityRole="button"
                        disabled={isActivityPending}
                        onPress={() => setIsFinishingActivity(false)}
                        style={({ pressed }) => [styles.activitySecondaryButton, pressed && styles.pressed]}>
                        <Text style={styles.activitySecondaryText}>{t('day.backToWorkout')}</Text>
                      </Pressable>
                    </>
                  )}

                  {/*
                    KRONOMETRE KONTROLLERİ — bitirme adımında gizlenir.
                    `Duraklat`/`Devam et` ikincil çerçeveli, `Bitir` birincil dolu
                    düğme; ikisi görsel olarak net ayrılır. Duraklat/Devam Et yalnız
                    etiket değiştirir (aşama anahtarı değişmez) → remount YOK.
                  */}
                  {!isFinishingActivity && (
                    <>
                      {activityError && (
                        <MotionCollapsible>
                          <Text style={styles.validationError}>{activityError}</Text>
                        </MotionCollapsible>
                      )}

                      {!activityTimer ? (
                        <MotionPressable
                          accessibilityLabel={t('day.activityDoneLabel', { name: activeCardioExerciseName })}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: isActivityDisabled }}
                          disabled={isActivityDisabled}
                          onPress={() => void startActivityMeasurement()}
                          style={[
                            styles.completeSetPill,
                            isActivityDisabled && styles.completeSetPillDisabled,
                          ]}>
                          <Text style={styles.completeSetPillText}>
                            {canCompleteSets
                              ? existingActivityRecord
                                ? t('day.remeasureActivity')
                                : t('day.startActivity')
                              : !workoutSession
                                ? t('day.startFirst')
                                : workoutSession.status === 'paused'
                                  ? t('day.workoutPaused')
                                  : t('day.availableOnScheduledDay')}
                          </Text>
                        </MotionPressable>
                      ) : (
                        <View style={styles.activityControls}>
                          <Pressable
                            accessibilityRole="button"
                            disabled={isActivityPending}
                            onPress={() =>
                              void (activityTimer.status === 'running'
                                ? pauseActivityMeasurement()
                                : resumeActivityMeasurement())
                            }
                            style={({ pressed }) => [
                              styles.activitySecondaryButton,
                              pressed && styles.pressed,
                            ]}>
                            <Text
                              adjustsFontSizeToFit
                              minimumFontScale={0.9}
                              numberOfLines={1}
                              style={[styles.activitySecondaryText, styles.activityButtonText]}>
                              {activityTimer.status === 'running'
                                ? t('day.pauseActivity')
                                : t('day.resumeActivity')}
                            </Text>
                          </Pressable>
                          <MotionPressable
                            accessibilityRole="button"
                            disabled={isActivityPending}
                            onPress={() => void finishActivityMeasurement()}
                            style={[styles.completeSetPill, styles.activityPrimaryButton]}>
                            <Text
                              adjustsFontSizeToFit
                              minimumFontScale={0.9}
                              numberOfLines={1}
                              style={[styles.completeSetPillText, styles.activityButtonText]}>
                              {t('day.finishActivity')}
                            </Text>
                          </MotionPressable>
                        </View>
                      )}

                      {activityTimer && (
                        <Pressable
                          accessibilityLabel={t('day.cancelMeasurement')}
                          accessibilityRole="button"
                          disabled={isActivityPending}
                          onPress={confirmCancelMeasurement}
                          style={({ pressed }) => [styles.clearActivityButton, pressed && styles.pressed]}>
                          <Text style={styles.clearActivityText}>{t('day.cancelMeasurement')}</Text>
                        </Pressable>
                      )}
                    </>
                  )}

                  {existingActivityRecord && !activityTimer && !isFinishingActivity && (
                    <Pressable
                      accessibilityLabel={t('day.clearActivity')}
                      accessibilityRole="button"
                      disabled={isActivityPending}
                      onPress={confirmClearActivity}
                      style={({ pressed }) => [styles.clearActivityButton, pressed && styles.pressed]}>
                      <Text style={styles.clearActivityText}>{t('day.clearActivity')}</Text>
                    </Pressable>
                  )}
                </MotionSwap>
                    </View>
                  )}

                  {!activeCardioExercise && activeExercise && (
                    <View style={styles.activeSetBlock}>
                <Text style={styles.activeSetLabel}>
                  {t('day.setOfTotal', {
                    // Ekstra sette gerçek sıra gösterilir (4/3, 5/3); disiplin
                    // sayacı bundan bağımsız olarak clamp edilmeye devam eder.
                    current: getActiveSetLabelNumber(activeActualSetCount),
                    total: activeExercise.targetSets,
                  })}
                </Text>
                <Text numberOfLines={2} style={styles.activeExerciseName}>
                  {activeExerciseName}
                </Text>

                <View style={styles.activeValues}>
                  <View style={styles.valueGroup}>
                    <TextInput
                      accessibilityLabel={t('day.kg')}
                      editable={canCompleteSets && !pendingExerciseId}
                      keyboardType="decimal-pad"
                      maxLength={8}
                      onChangeText={setWeightInput}
                      placeholder="—"
                      placeholderTextColor={colors.textTertiary}
                      selectTextOnFocus
                      style={styles.valueInput}
                      value={weightInput}
                    />
                    <Text style={styles.valueUnit}>{t('day.kgUnit')}</Text>
                  </View>
                  <View style={styles.valueGroup}>
                    <TextInput
                      accessibilityLabel={t('day.repsShort')}
                      editable={canCompleteSets && !pendingExerciseId}
                      keyboardType="number-pad"
                      maxLength={5}
                      onChangeText={setRepetitionsInput}
                      placeholder={activeExercise.targetReps}
                      placeholderTextColor={colors.textTertiary}
                      selectTextOnFocus
                      style={styles.valueInput}
                      value={repetitionsInput}
                    />
                    <Text style={styles.valueUnit}>{t('day.repsUnit')}</Text>
                  </View>
                </View>

                {activeDropSetDrafts.length > 0 && (
                  <View style={styles.dropSetList}>
                    {activeDropSetDrafts.map((draft, index) => (
                      <View key={index} style={styles.dropSetRow}>
                        <Text style={styles.dropSetLabel}>{t('day.dropSetNumber', { number: index + 1 })}</Text>
                        <TextInput
                          accessibilityLabel={`${t('day.dropSetNumber', { number: index + 1 })} ${t('day.kg')}`}
                          editable={canCompleteSets && !pendingExerciseId}
                          keyboardType="decimal-pad"
                          maxLength={8}
                          onChangeText={(value) => updateDropSetDraft(index, 'weight', value)}
                          placeholder="—"
                          placeholderTextColor={colors.textTertiary}
                          selectTextOnFocus
                          style={styles.dropSetInput}
                          value={draft.weight}
                        />
                        <Text style={styles.dropSetUnit}>{t('day.kgUnit')}</Text>
                        <TextInput
                          accessibilityLabel={`${t('day.dropSetNumber', { number: index + 1 })} ${t('day.repsShort')}`}
                          editable={canCompleteSets && !pendingExerciseId}
                          keyboardType="number-pad"
                          maxLength={5}
                          onChangeText={(value) => updateDropSetDraft(index, 'reps', value)}
                          placeholder="—"
                          placeholderTextColor={colors.textTertiary}
                          selectTextOnFocus
                          style={styles.dropSetInput}
                          value={draft.reps}
                        />
                        <Text style={styles.dropSetUnit}>{t('day.repsUnit')}</Text>
                        <Pressable
                          accessibilityLabel={t('day.dropSetRemoveLabel', { number: index + 1 })}
                          accessibilityRole="button"
                          disabled={Boolean(pendingExerciseId)}
                          onPress={() => removeDropSetDraft(index)}
                          style={({ pressed }) => [styles.dropSetRemoveButton, pressed && styles.pressed]}>
                          <Ionicons name="close" size={16} color={colors.textSecondary} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                <Pressable
                  accessibilityLabel={t('day.addDropSetLabel')}
                  accessibilityRole="button"
                  disabled={!canCompleteSets || Boolean(pendingExerciseId)}
                  onPress={addDropSetDraft}
                  style={({ pressed }) => [styles.addDropSetButton, pressed && styles.pressed]}>
                  <Text style={styles.addDropSetText}>{t('day.addDropSet')}</Text>
                </Pressable>

                {validationError && <Text style={styles.validationError}>{validationError}</Text>}

                <MotionPressable
                  accessibilityLabel={t('day.completeSetLabel', { name: activeExerciseName })}
                  accessibilityRole="button"
                  disabled={isCompleteSetDisabled}
                  onPress={() => void submitActiveSet()}
                  style={[
                    styles.completeSetPill,
                    isCompleteSetDisabled && styles.completeSetPillDisabled,
                  ]}>
                  {pendingExerciseId === activeExercise.id ? (
                    <ActivityIndicator color={colors.background} size="small" />
                  ) : (
                    <Text style={styles.completeSetPillText}>
                      {isActiveExerciseComplete && !isExtraSetMode
                        ? t('day.completed')
                        : canCompleteSets
                          ? t('day.completeSet')
                          : !workoutSession
                            ? t('day.startFirst')
                            : workoutSession.status === 'paused'
                              ? t('day.workoutPaused')
                              : t('day.availableOnScheduledDay')}
                    </Text>
                  )}
                </MotionPressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isSetDetailsOpen }}
                  hitSlop={8}
                  onPress={() => setIsSetDetailsOpen((current) => !current)}
                  style={({ pressed }) => [styles.detailsToggle, pressed && styles.pressed]}>
                  <Text style={styles.detailsToggleText}>{t('day.details')}</Text>
                  <Ionicons
                    name={isSetDetailsOpen ? 'chevron-up' : 'chevron-down'}
                    size={13}
                    color={colors.textSecondary}
                  />
                </Pressable>

                {isSetDetailsOpen && (
                  <View style={styles.detailsArea}>
                    {activePreviousSet && (
                      <Text style={styles.previousSetText}>
                        {t('day.previousSet', { value: formatSetPerformance(activePreviousSet, t, locale) })}
                      </Text>
                    )}

                    <View style={styles.rpeField}>
                      <View style={styles.rpeLabelRow}>
                        <Text style={styles.rpeLabel}>{t('rpe.label')}</Text>
                        <Text style={styles.rpeOptional}>{t('day.optional')}</Text>
                      </View>
                      <View style={styles.rpeInputRow}>
                        <TextInput
                          accessibilityHint={t('rpe.description')}
                          accessibilityLabel={`${t('rpe.label')}, ${t('day.optional')}`}
                          editable={canCompleteSets && !pendingExerciseId}
                          keyboardType="decimal-pad"
                          maxLength={4}
                          onChangeText={setRpeInput}
                          placeholder={t('day.optional')}
                          placeholderTextColor={colors.textTertiary}
                          style={styles.detailInput}
                          value={rpeInput}
                        />
                        {strengthRpeBand && (
                          <Text style={styles.rpeBandText}>{t(rpeBandLabelKey(strengthRpeBand))}</Text>
                        )}
                      </View>
                      <Text style={styles.rpeDescription}>{t('rpe.description')}</Text>
                    </View>

                    {activeSetRecords.length > 0 && (
                      <View style={styles.completedSetList}>
                        {activeSetRecords.map((workoutSet) => (
                          <View key={workoutSet.id} style={styles.completedSetRow}>
                            <Text style={styles.completedSetNumberText}>
                              {t('day.setLabel', { number: workoutSet.setNumber })}
                            </Text>
                            <Text style={styles.completedSetValue}>
                              {workoutSet.weightKg === undefined
                                ? t('day.bodyweightLabel')
                                : `${formatDecimal(workoutSet.weightKg, locale)} kg`}
                            </Text>
                            <Text style={styles.completedSetValue}>
                              {workoutSet.repetitions === undefined
                                ? t('day.noDetail')
                                : t('day.repsValue', { count: workoutSet.repetitions })}
                            </Text>
                            {workoutSet.rpe !== undefined && (
                              <Text style={styles.completedSetRpe}>
                                {formatRpeWithBand(workoutSet.rpe, t, locale)}
                              </Text>
                            )}
                          </View>
                        ))}
                      </View>
                    )}

                    <View style={styles.detailActions}>
                      {activeCompletedSets > 0 && canCompleteSets && (
                        <Pressable
                          accessibilityLabel={t('day.undoSetLabel', { name: activeExerciseName })}
                          accessibilityRole="button"
                          disabled={Boolean(pendingExerciseId)}
                          onPress={() => void handleUndoSet(activeExercise)}
                          style={({ pressed }) => [styles.detailButton, pressed && styles.pressed]}>
                          <Ionicons name="arrow-undo-outline" size={14} color={colors.text} />
                          <Text style={styles.detailButtonText}>{t('day.setLabel', { number: activeCompletedSets })}</Text>
                        </Pressable>
                      )}
                      {hasProgress && canTrackToday && (
                        <Pressable
                          accessibilityRole="button"
                          disabled={isWorkoutActionPending}
                          onPress={() => void handleResetSets()}
                          style={({ pressed }) => [styles.detailButton, pressed && styles.pressed]}>
                          <Text style={styles.resetButtonText}>{t('day.reset')}</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
                    </View>
                  )}
                  </>
                </MotionSwap>
              </MotionLayout>
            )}

            {averageDurationSeconds !== undefined && (
              <Text style={styles.averageDuration}>
                {t('day.averageDuration', { duration: formatDuration(averageDurationSeconds) })}
              </Text>
            )}

            <View style={styles.allExercisesPanel}>
              <View style={styles.panelGrabber} />
              <Text style={styles.panelTitle}>{t('day.allExercises')}</Text>

              {/*
                Liste günün BÜTÜN egzersizlerini gösterir; kardiyo satırları
                gizlenmez. İlerleme metni türe göre değişir, tamamlanma kararı
                ortak saf çekirdekten gelir.
              */}
              {allDayExercises.map((exercise) => {
                const exerciseName = getProgramExerciseName(exercise.exerciseId, exercise.customExerciseName);
                const exerciseProgress = resolveExerciseProgress(
                  exercise,
                  completedSetCounts[getSetProgressKey(todayKey, exercise.id)] ?? 0,
                  activityTotals[getActivityProgressKey(todayKey, exercise.id)],
                );
                const isComplete = exerciseProgress.doneUnits >= exerciseProgress.targetUnits;
                /**
                 * Strength'te panelde GERÇEK set sayısı gösterilir: hedefi 3 olan
                 * bir egzersize ekstra set eklenirse `4/3` görünür. Disiplin
                 * sayacı hedefe clamp edilmeye devam eder. Kardiyoda birim
                 * ikilidir; ilerleme `0/1` ya da `1/1` olarak okunur.
                 */
                const recordedSets = isStrengthExercise(exercise)
                  ? workoutSets.filter(
                      (workoutSet) =>
                        workoutSet.dateKey === todayKey &&
                        workoutSet.programExerciseId === exercise.id,
                    ).length
                  : 0;
                const displayedSets = Math.max(exerciseProgress.doneUnits, recordedSets);
                const isActive =
                  exercise.id === (activeCardioExercise?.id ?? activeExercise?.id);

                return (
                  <Pressable
                    accessibilityLabel={t('a11y.selectExercise', { name: exerciseName })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    key={exercise.id}
                    onPress={() => {
                      /**
                       * Ekstra set modu YALNIZCA zaten tamamlanmış bir egzersiz
                       * seçildiğinde açılır. Tamamlanmamış egzersizde açık
                       * kalsaydı, son planlı set bittikten sonra seçim
                       * bırakılmaz ve sıradaki egzersize otomatik geçiş
                       * bozulurdu. Her dokunuş bayrağı yeniden yazdığı için
                       * eski mod başka egzersize taşınmaz.
                       */
                      void handleExerciseSelection(
                        exercise.id,
                        isComplete,
                        isCardioExercise(exercise),
                      );
                    }}
                    style={({ pressed }) => [styles.panelRow, pressed && styles.pressed]}>
                    <View style={styles.panelMarker}>
                      {isActive && <Ionicons name="caret-forward" size={11} color={activeSecondary.color} />}
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.panelExerciseName,
                        isActive && styles.panelExerciseNameActive,
                        isComplete && styles.panelExerciseNameComplete,
                      ]}>
                      {exerciseName}
                    </Text>
                    <Text style={[styles.panelSetCount, isComplete && styles.panelSetCountComplete]}>
                      {displayedSets}/{exerciseTargetUnits(exercise)}
                    </Text>
                  </Pressable>
                );
              })}

              {!day.isOffDay && (
                <Pressable
                  accessibilityLabel={t('day.addExerciseLabel')}
                  accessibilityRole="button"
                  onPress={openAddExercise}
                  style={({ pressed }) => [styles.panelAddExerciseButton, pressed && styles.pressed]}>
                  <Text style={styles.panelAddExerciseText}>{t('day.addExercise')}</Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </ProgramDetailScroll>
      {dayEditorModal}
      <Modal
        animationType="fade"
        onRequestClose={() => setEditingExerciseId(null)}
        presentationStyle="overFullScreen"
        transparent
        visible={Boolean(editingExerciseId)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.exerciseEditorModal}>
          <Pressable
            accessibilityLabel={t('common.cancel')}
            accessibilityRole="button"
            onPress={() => setEditingExerciseId(null)}
            style={styles.exerciseEditorBackdrop}
          />
          <SafeAreaView edges={['bottom']} style={styles.exerciseEditorSheet}>
            <ScrollView
              contentContainerStyle={styles.exerciseEditorContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <View style={styles.exerciseEditorHeading}>
                <Text style={styles.exerciseEditorTitle}>{t('day.editExercise')}</Text>
                <Text numberOfLines={2} style={styles.exerciseEditorSubtitle}>{editingExerciseName}</Text>
              </View>

              {/*
                Tür seçici KİLİTLİDİR: kayıtlı bir egzersizin takip biçimini
                değiştirmek geçmiş disiplin ve ödül kanıtını bozar. Kullanıcı
                sunucu hatasına düşürülmez; kural burada açıkça anlatılır.
              */}
              <View style={styles.exerciseTrackingMode}>
                <TrackingModeSelector
                  colors={colors}
                  disabled
                  disabledHint={t('day.trackingModeLocked')}
                  labels={{
                    distance: t('day.trackingModeDistance'),
                    duration: t('day.trackingModeDuration'),
                    sets_reps: t('day.trackingModeSetsReps'),
                  }}
                  onChange={setEditingTrackingMode}
                  title={t('day.trackingModeLabel')}
                  value={editingTrackingMode}
                />
              </View>

              {editingTrackingMode === 'sets_reps' && (
                <View style={styles.exerciseTargetFields}>
                  <ExerciseTargetInput
                    colors={colors}
                    label={t('day.sets')}
                    onChangeText={setTargetSetsDraft}
                    value={targetSetsDraft}
                  />
                  <ExerciseTargetInput
                    colors={colors}
                    keyboardType="default"
                    label={t('day.reps')}
                    onChangeText={setTargetRepsDraft}
                    value={targetRepsDraft}
                  />
                  <ExerciseTargetInput
                    colors={colors}
                    label={t('day.rest')}
                    onChangeText={setRestSecondsDraft}
                    suffix={t('day.secondsSuffix')}
                    value={restSecondsDraft}
                  />
                </View>
              )}

              {editingTrackingMode === 'duration' && (
                <View style={styles.exerciseTargetFields}>
                  <ExerciseTargetInput
                    colors={colors}
                    label={t('day.targetDuration')}
                    onChangeText={setTargetDurationDraft}
                    value={targetDurationDraft}
                  />
                </View>
              )}

              {editingTrackingMode === 'distance' && (
                <View style={styles.exerciseTargetFields}>
                  <ExerciseTargetInput
                    colors={colors}
                    keyboardType="decimal-pad"
                    label={t('day.targetDistance')}
                    onChangeText={setTargetDistanceDraft}
                    value={targetDistanceDraft}
                  />
                </View>
              )}

              <View style={styles.exerciseVisualField}>
                <Text style={styles.exerciseVisualLabel}>{t('day.milestoneMarker')}</Text>
                <WorkoutVisualPicker
                  onSelect={setExerciseVisualDraft}
                  selectedVisual={exerciseVisualDraft}
                  variant="exerciseEdit"
                />
              </View>

              <View style={styles.exerciseEditorActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setEditingExerciseId(null)}
                  style={({ pressed }) => [styles.exerciseCancelButton, pressed && styles.pressed]}>
                  <Text style={styles.exerciseCancelButtonText}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void saveExerciseChanges()}
                  style={({ pressed }) => [styles.exerciseSaveButton, pressed && styles.pressed]}>
                  <Text style={styles.exerciseSaveButtonText}>{t('common.save')}</Text>
                </Pressable>
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={confirmRemoveExercise}
                style={({ pressed }) => [styles.exerciseRemoveButton, pressed && styles.pressed]}>
                <Text style={styles.exerciseRemoveButtonText}>{t('day.removeExercise')}</Text>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
      {isPlanMode && canTrackToday && day.exercises.length > 0 && (
        <View style={styles.startWorkoutFooter}>
          <MotionPressable
            accessibilityRole="button"
            disabled={isWorkoutActionPending}
            onPress={() => void handleWorkoutToggle()}
            style={styles.startWorkoutButton}>
            {isWorkoutActionPending ? (
              <ActivityIndicator color="#111111" size="small" />
            ) : (
              <Ionicons name="play" size={16} color="#111111" />
            )}
            <Text style={styles.startWorkoutText}>{t('day.startWorkout')}</Text>
          </MotionPressable>
        </View>
      )}
      {restTimerEnabled && restTimer && restProgress && (
        <View
          accessibilityLabel={
            restProgress.isOvertime
              ? t('rest.accessibilityOvertime', { seconds: restProgress.overtimeSeconds })
              : t('rest.accessibilityRemaining', {
                  name: restTimer.exerciseName,
                  seconds: restProgress.remainingSeconds,
                })
          }
          accessibilityRole="timer"
          style={[styles.restTimerCard, restProgress.isOvertime && styles.restTimerCardFinished]}>
          <View style={styles.restTimerIcon}>
            <Ionicons
              name={restProgress.isOvertime ? 'notifications' : 'timer-outline'}
              size={20}
              color={restProgress.isOvertime ? colors.accent : colors.textSecondary}
            />
          </View>
          <View style={styles.restTimerText}>
            <Text style={styles.restTimerTitle}>
              {restProgress.isOvertime
                ? t('rest.finishedTitle')
                : t('rest.title', { name: restTimer.exerciseName })}
            </Text>
            <Text style={styles.restTimerCaption}>
              {restProgress.isOvertime
                ? t('rest.overtimeCaption', { overtime: formatDuration(restProgress.overtimeSeconds) })
                : t('rest.caption')}
            </Text>
          </View>
          <Text style={[styles.restTimerValue, restProgress.isOvertime && styles.restTimerValueOvertime]}>
            {formatRestTimerValue(restProgress)}
          </Text>
          <Pressable
            accessibilityLabel={t('rest.dismiss')}
            accessibilityRole="button"
            onPress={() => void clearRestTimer()}
            style={({ pressed }) => [styles.dismissRestTimer, pressed && styles.pressed]}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}
      </View>
    </SafeAreaView>
  );
}

function showWorkoutError(title: string, error: unknown, t: (key: string) => string) {
  Alert.alert(title, error instanceof Error ? error.message : t('common.networkError'));
}

function ExerciseTargetInput({
  colors,
  keyboardType = 'number-pad',
  label,
  onChangeText,
  suffix,
  value,
}: {
  colors: ThemeColors;
  keyboardType?: 'number-pad' | 'default' | 'decimal-pad';
  label: string;
  onChangeText: (value: string) => void;
  suffix?: string;
  value: string;
}) {
  // Yardımcı bileşen yalnızca hedef alanı stillerini kullanır; semantik
  // renkler varsayılanda bırakılır.
  const styles = createStyles(colors, {
    activePrimary: colors.text,
    activePrimaryOn: colors.background,
    activeSecondary: colors.primary,
    workoutDays: WORKOUT_ORANGE,
    workoutDaysOn: '#111111',
  });

  return (
    <View style={styles.targetField}>
      <Text style={styles.exerciseTargetLabel}>{label}</Text>
      <View style={styles.exerciseTargetInputRow}>
        <TextInput
          keyboardType={keyboardType}
          maxLength={5}
          onChangeText={onChangeText}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.primary}
          style={styles.exerciseTargetInput}
          value={value}
        />
        {suffix && <Text style={styles.exerciseTargetSuffix}>{suffix}</Text>}
      </View>
    </View>
  );
}

function getFirstTargetRepetition(targetReps: string) {
  const match = targetReps.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function parseNumberInput(value: string) {
  const normalizedValue = value.trim().replace(',', '.');
  if (!normalizedValue) return undefined;
  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function parseOptionalNumberInput(value: string) {
  if (!value.trim()) return undefined;
  const parsedValue = parseNumberInput(value);
  return parsedValue === undefined ? null : parsedValue;
}

function formatDecimal(value: number, locale: string) {
  return value.toLocaleString(locale, { maximumFractionDigits: 2 });
}

function formatSetPerformance(
  workoutSet: WorkoutSetRecord,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: string,
) {
  const parts = [
    workoutSet.weightKg === undefined ? t('day.bodyweight') : `${formatDecimal(workoutSet.weightKg, locale)} kg`,
    workoutSet.repetitions === undefined ? undefined : t('day.repsValue', { count: workoutSet.repetitions }),
    workoutSet.rpe === undefined ? undefined : formatRpeWithBand(workoutSet.rpe, t, locale),
  ];
  return parts.filter(Boolean).join(' · ');
}

type FeatureColors = {
  activePrimary: string;
  activePrimaryOn: string;
  activeSecondary: string;
  workoutDays: string;
  workoutDaysOn: string;
};

function createStyles(colors: ThemeColors, feature: FeatureColors) {
  return StyleSheet.create({
    activeSetBlock: { alignItems: 'center', gap: 10, paddingTop: 18 },
    /** Panel yüksekliği değişirken aşağıdaki listenin sıçramasını engeller. */
    activeExerciseLayout: { alignSelf: 'stretch', overflow: 'hidden' },
    /** Egzersiz/takip türü değişirken anahtarlı içerik sınırı. */
    activeExerciseSwap: { alignSelf: 'stretch' },
    /**
     * Kardiyo kontrol aşamasının tek geçiş sınırı — YALNIZ yerleşim. MotionSwap
     * bu stili kendi Animated.View'ine uygular; aşama içerikleri onun doğrudan
     * flex çocuklarıdır. `alignItems: 'center'` + `alignSelf: 'stretch'` panelin
     * tam genişlik/ortalama davranışını (`activeSetBlock` ile aynı) korur; `gap:
     * 10` mevcut panel ritmini birebir sürdürür, böylece düğme aralıkları ve son
     * düzeltilen yatay hizalama değişmez.
     */
    activityPhaseSwap: { alignItems: 'center', alignSelf: 'stretch', gap: 10 },
    activeSetLabel: { color: feature.activeSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 },
    activeExerciseName: { color: colors.text, fontSize: 24, fontWeight: '600', textAlign: 'center' },
    activeValues: { alignItems: 'baseline', flexDirection: 'row', gap: 20, marginTop: 6 },
    valueGroup: { alignItems: 'baseline', flexDirection: 'row', gap: 4 },
    valueInput: {
      color: colors.text,
      fontSize: 38,
      fontVariant: ['tabular-nums'],
      fontWeight: '300',
      minWidth: 62,
      paddingVertical: 4,
      textAlign: 'center',
    },
    valueUnit: { color: colors.textSecondary, fontSize: 13 },

    /**
     * KARDİYO YARDIMCI ALANLARI — ana süre/mesafe değerinden görsel olarak
     * İKİNCİLDİR: tek satır, ayrı kart YOK, yığılmış renkli kutu YOK.
     * Dokunma alanı 44 pt'nin altına düşmez.
     */
    activityFieldRow: {
      alignItems: 'center',
      alignSelf: 'stretch',
      flexDirection: 'row',
      gap: 12,
      minHeight: Layout.minTouchSize,
    },
    activityFieldLabel: { color: colors.textSecondary, flex: 1, fontSize: 13 },
    activityFieldInput: {
      borderBottomColor: colors.inputBorder,
      borderBottomWidth: Layout.hairline,
      color: colors.text,
      fontSize: 20,
      fontVariant: ['tabular-nums'],
      fontWeight: '400',
      minHeight: Layout.minTouchSize,
      minWidth: 84,
      paddingVertical: 4,
      textAlign: 'right',
    },
    activityFieldUnit: { color: colors.textSecondary, fontSize: 13, minWidth: 20 },
    activityRpeBand: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right' },
    activityHint: { color: colors.textTertiary, fontSize: 12, lineHeight: 16, textAlign: 'center' },
    activityPace: {
      color: colors.textSecondary,
      fontSize: 13,
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
    },
    /**
     * KRONOMETRE — panelin görsel odağı. Hedef/kalan/fazla süre ikincil
     * hiyerarşide, aynı tipografik aileden ama belirgin biçimde küçük.
     */
    activityTimerBlock: { alignItems: 'center', gap: 4, paddingVertical: 4 },
    activityTimerValue: {
      color: colors.text,
      fontSize: 56,
      fontVariant: ['tabular-nums'],
      fontWeight: '200',
      letterSpacing: 1,
    },
    activityTimerCaption: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
    activityTimerState: { color: colors.textTertiary, fontSize: 12 },
    /** Birincil işlemler alt başparmak bölgesinde, yan yana ve net ayrık. */
    activityControls: { alignSelf: 'stretch', flexDirection: 'row', gap: 10 },
    activitySecondaryButton: {
      alignItems: 'center',
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusPill,
      borderWidth: Layout.hairline,
      flex: 1,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      minWidth: 0,
      paddingHorizontal: 16,
    },
    activitySecondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    /**
     * Yan yana kullanımda `completeSetPill`'in tekil-düğme değerlerini EZER:
     * dikey hizayı ortalamak yerine `stretch` ile satır yüksekliğine (52 pt)
     * oturtur, üst boşluğu (`marginTop`) ve sabit `minWidth`'i sıfırlar, dar
     * yatay padding ile `flex: 1` iki düğmeyi eşit genişliğe getirir. Böylece
     * `Bitir` ile `Duraklat/Devam et` aynı yükseklik ve hizada kalır.
     */
    activityPrimaryButton: {
      alignSelf: 'stretch',
      flex: 1,
      marginTop: 0,
      minWidth: 0,
      paddingHorizontal: 16,
    },
    /** Yan yana düğme metinleri tek satır ve ortalı görünür. */
    activityButtonText: { textAlign: 'center' },
    clearActivityButton: { minHeight: Layout.minTouchSize, justifyContent: 'center', paddingHorizontal: 12 },
    clearActivityText: { color: colors.danger, fontSize: 14, fontWeight: '500' },

    /**
     * Drop set satırı: ana set alanından belirgin biçimde daha KÜÇÜK ama
     * okunabilir. Tipografi ana set girişiyle aynı aileden (tabular-nums,
     * ince ağırlık); yalnızca ölçek küçülür.
     */
    dropSetList: { gap: 8, width: '100%' },
    dropSetRow: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'center' },
    dropSetLabel: { color: colors.textTertiary, ...Type.footnote, minWidth: 46 },
    dropSetInput: {
      color: colors.text,
      fontSize: 20,
      fontVariant: ['tabular-nums'],
      fontWeight: '300',
      minWidth: 46,
      paddingVertical: 2,
      textAlign: 'center',
    },
    dropSetUnit: { color: colors.textSecondary, ...Type.footnote },
    // Dokunma alanı en az 44×44.
    dropSetRemoveButton: {
      alignItems: 'center',
      height: Layout.minTouchSize,
      justifyContent: 'center',
      width: Layout.minTouchSize,
    },
    addDropSetButton: {
      alignItems: 'center',
      alignSelf: 'center',
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 12,
    },
    addDropSetText: { color: feature.activeSecondary, ...Type.caption, fontWeight: '600' },
    /** All exercises panelinin altındaki tek "Egzersiz ekle" düğmesi. */
    panelAddExerciseButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      marginTop: 4,
      minWidth: Layout.minTouchSize,
    },
    panelAddExerciseText: { color: feature.activeSecondary, ...Type.body, fontWeight: '600' },
    completeSetPill: {
      alignItems: 'center',
      alignSelf: 'center',
      // Active Workout — Primary: SADECE bu düğme.
      backgroundColor: feature.activePrimary,
      borderRadius: Layout.radiusPill,
      justifyContent: 'center',
      marginTop: 8,
      minHeight: 52,
      minWidth: 200,
      paddingHorizontal: 32,
    },
    completeSetPillDisabled: { backgroundColor: colors.surfaceMuted },
    completeSetPillText: { color: feature.activePrimaryOn, fontSize: 16, fontWeight: '600' },
    detailsToggle: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 5,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
    },
    detailsToggleText: { color: colors.textSecondary, fontSize: 13 },
    detailsArea: { alignSelf: 'stretch', gap: 12 },
    detailRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    detailLabel: { color: colors.textSecondary, fontSize: 13, width: 46 },
    /**
     * RPE alanı: uzun Türkçe etiket ve Dynamic Type için etiket ÜSTTE, girdi
     * altta yığılır; dar bir yan sütuna sıkışmaz. Açıklama Details açıkken
     * her zaman görünür — ayrı kart/modal yok.
     */
    rpeField: { alignSelf: 'stretch', gap: 8 },
    rpeLabelRow: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    rpeLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 13, fontWeight: '600' },
    rpeOptional: { color: colors.textTertiary, fontSize: 12 },
    rpeInputRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    rpeBandText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    rpeDescription: { color: colors.textTertiary, fontSize: 12, lineHeight: 16 },
    detailInput: {
      backgroundColor: colors.background,
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusSmall,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontSize: 15,
      minHeight: Layout.minTouchSize,
      minWidth: 96,
      paddingHorizontal: 12,
    },
    detailActions: { flexDirection: 'row', gap: 10 },
    detailButton: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 16,
    },
    detailButtonText: { color: colors.text, fontSize: 13 },
    allExercisesPanel: {
      backgroundColor: colors.card,
      borderColor: colors.separator,
      borderRadius: Layout.radiusLarge,
      borderWidth: StyleSheet.hairlineWidth,
      marginTop: 22,
      paddingBottom: 6,
      paddingHorizontal: 16,
      paddingTop: 10,
    },
    panelGrabber: {
      alignSelf: 'center',
      backgroundColor: colors.textTertiary,
      borderRadius: 2,
      height: 3,
      marginBottom: 12,
      width: 34,
    },
    panelTitle: { color: colors.textSecondary, ...Type.eyebrow, marginBottom: 4 },
    panelRow: {
      alignItems: 'center',
      borderTopColor: colors.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 8,
      minHeight: Layout.minTouchSize,
    },
    panelMarker: { alignItems: 'center', width: 12 },
    panelExerciseName: { color: colors.textSecondary, flex: 1, fontSize: 15 },
    panelExerciseNameActive: { color: colors.text, fontWeight: '500' },
    panelExerciseNameComplete: { color: colors.disciplineCompleted },
    panelSetCount: { color: colors.textTertiary, fontSize: 13, fontVariant: ['tabular-nums'] },
    panelSetCountComplete: { color: colors.disciplineCompleted },
    workoutTopBar: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: Layout.screenPadding,
      paddingVertical: 10,
    },
    /**
     * KÖK NEDEN: sabit `width: 44` idi. "Finish" 16 pt'de ~45 pt yer kapladığı
     * için satıra sığmayıp son harf alt satıra düşüyordu. Artık genişlik
     * minimum dokunma alanıdır, metin kadar büyüyebilir ve sıkışmaz.
     */
    topBarButton: {
      alignItems: 'center',
      flexShrink: 0,
      height: Layout.minTouchSize,
      justifyContent: 'center',
      minWidth: Layout.minTouchSize,
      paddingHorizontal: 6,
    },
    topBarCenter: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: Layout.minTouchSize },
    topBarStatus: { color: colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
    // Active Workout — Secondary. Satır kırılması ve dokunma alanı değişmez.
    topBarFinish: { color: feature.activeSecondary, fontSize: 16, fontWeight: '500' },
    topBarProgressTrack: { backgroundColor: colors.surfaceMuted, height: 2, marginHorizontal: Layout.screenPadding },
    topBarProgressFill: { backgroundColor: colors.text, height: '100%' },
    safeArea: { backgroundColor: colors.background, flex: 1 },
    workoutScreen: { flex: 1 },
    content: { gap: 18, paddingBottom: 44, paddingHorizontal: Layout.screenPadding, paddingTop: 12 },
    contentWithRestTimer: { paddingBottom: 120 },
    notFound: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center', padding: 30 },
    notFoundTitle: { color: colors.text, fontSize: 17, fontWeight: '500', textAlign: 'center' },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    primaryButtonText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },

    headerButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
    summaryRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: Layout.minTouchSize,
    },
    summaryText: { color: colors.textSecondary, ...Type.caption, flexShrink: 1 },
    controlsRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    controlGroup: { flexDirection: 'row', gap: 8 },
    controlButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusSmall,
      height: 36,
      justifyContent: 'center',
      width: 40,
    },
    controlButtonDisabled: { opacity: 0.35 },
    addExerciseButton: {
      alignItems: 'center',
      backgroundColor: feature.workoutDays,
      borderRadius: Layout.radiusPill,
      justifyContent: 'center',
      minHeight: 36,
      paddingHorizontal: 18,
    },
    addExerciseText: { color: feature.workoutDaysOn, fontSize: 14, fontWeight: '600' },

    editorSubtitle: { color: colors.textSecondary, ...Type.caption, marginTop: -8 },
    exerciseEditorModal: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'flex-end',
      padding: 12,
    },
    exerciseEditorBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.58)',
    },
    exerciseEditorSheet: {
      backgroundColor: colors.surface,
      borderRadius: 28,
      maxHeight: '92%',
      maxWidth: 640,
      overflow: 'hidden',
      width: '100%',
    },
    // Ölçüler "Programı düzenle" ile birebir aynı sistemden gelir.
    exerciseEditorContent: { gap: Form.sectionGap, padding: Layout.screenPadding },
    exerciseEditorHeading: { gap: 4 },
    exerciseEditorTitle: { color: colors.text, ...Form.title },
    exerciseEditorSubtitle: { color: colors.textSecondary, ...Type.caption, lineHeight: 18 },
    exerciseTrackingMode: { marginBottom: 16 },
    exerciseTargetFields: { flexDirection: 'row', gap: 12 },
    // SET / TEKRAR / DİNLENME etiketleri, diğer form etiketleriyle AYNI token.
    exerciseTargetLabel: { color: colors.textSecondary, ...Type.eyebrow },
    /**
     * Üç alan aynı dikey ölçüyü paylaşır: aynı satır yüksekliği, aynı taban
     * çizgisi hizası ve aynı punto. Sonek de aynı `lineHeight`'i kullanır,
     * böylece "Dinlenme" alanı diğer ikisinden kaymaz.
     */
    exerciseTargetInputRow: {
      alignItems: 'baseline',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 4,
      minHeight: Form.controlHeight,
    },
    exerciseTargetInput: {
      color: colors.text,
      flex: 1,
      ...Form.title,
      fontVariant: ['tabular-nums'],
      lineHeight: 22,
      minHeight: 34,
      padding: 0,
    },
    exerciseTargetSuffix: { color: colors.textSecondary, ...Type.caption, lineHeight: 22 },
    exerciseVisualField: { gap: Form.fieldGap },
    exerciseVisualLabel: { color: colors.textSecondary, ...Type.eyebrow },
    exerciseEditorActions: { flexDirection: 'row', gap: 10 },
    // İkincil eylem: çerçeveli, sakin ağırlık, ikincil renk.
    exerciseCancelButton: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Form.controlRadius,
      borderWidth: StyleSheet.hairlineWidth,
      flex: 1,
      justifyContent: 'center',
      minHeight: Form.controlHeight,
    },
    exerciseCancelButtonText: { color: colors.textSecondary, ...Type.body },
    // Birincil eylem: dolu yüzey.
    exerciseSaveButton: {
      alignItems: 'center',
      backgroundColor: colors.text,
      borderRadius: Form.controlRadius,
      flex: 1,
      justifyContent: 'center',
      minHeight: Form.controlHeight,
    },
    exerciseSaveButtonText: { color: colors.background, ...Form.action },
    // Tehlikeli eylem: kırmızı ama görsel olarak sakin (caption ölçüsü).
    exerciseRemoveButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: Form.controlHeight,
    },
    exerciseRemoveButtonText: { color: colors.danger, ...Type.caption },
    targetField: { flex: 1, gap: 8 },

    /**
     * "Günü düzenle" alt sayfası — ölçüler `app/program/[id].tsx` içindeki
     * "Programı düzenle" sheet'inden BİREBİR alındı; iki ekran aynı görünür.
     * Bütün renkler tema tokenlarından gelir, sabit siyah/beyaz yoktur.
     */
    dayEditorModal: { flex: 1, justifyContent: 'flex-end' },
    dayEditorBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.58)',
    },
    dayEditorSheet: {
      alignSelf: 'center',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      // İçerik kadar yüksek; taşarsa içeride kaydırılır.
      maxHeight: '92%',
      overflow: 'hidden',
      width: '100%',
    },
    dayEditorHandle: {
      alignSelf: 'center',
      backgroundColor: colors.textTertiary,
      borderRadius: 3,
      height: 5,
      marginTop: 14,
      opacity: 0.48,
      width: 52,
    },
    dayEditorContent: {
      gap: Form.sectionGap,
      paddingBottom: 16,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 20,
    },
    dayEditorTitle: { color: colors.text, ...Form.title },
    dayEditorField: { gap: Form.fieldGap },
    dayEditorLabel: { color: colors.textSecondary, ...Type.eyebrow },
    dayEditorCaption: { color: colors.textTertiary, ...Type.caption },
    dayEditorInput: {
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
    dayWeekdayOptions: { gap: 8 },
    // Kompakt ama dokunma alanı `Form.controlHeight` (44 pt).
    dayWeekdayOption: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Form.controlRadius,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
      minHeight: Form.controlHeight,
      minWidth: Form.controlHeight,
      paddingHorizontal: 14,
    },
    dayWeekdayOptionSelected: { backgroundColor: colors.text, borderColor: colors.text },
    // Başka günün kullandığı takvim günü: soluk ve dokunulamaz.
    dayWeekdayOptionDisabled: { opacity: 0.3 },
    dayWeekdayOptionText: { color: colors.textSecondary, ...Type.body },
    dayWeekdayOptionTextSelected: { color: colors.background, fontWeight: '600' },
    dayEditorSwitchRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    dayEditorSwitchText: { flex: 1, gap: 2 },
    dayEditorSaveButton: {
      alignItems: 'center',
      backgroundColor: colors.text,
      borderRadius: Form.controlRadius,
      justifyContent: 'center',
      minHeight: Form.controlHeight,
    },
    dayEditorSaveButtonText: { color: colors.background, ...Form.action },
    dayEditorCancelButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: Form.controlHeight,
    },
    dayEditorCancelButtonText: { color: colors.textSecondary, ...Type.body },
    removeButton: { alignItems: 'center', justifyContent: 'center', minHeight: 36 },
    removeButtonText: { color: colors.danger, fontSize: 14, fontWeight: '500' },

    startWorkoutButton: {
      alignItems: 'center',
      alignSelf: 'stretch',
      backgroundColor: feature.workoutDays,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      minHeight: 54,
      paddingHorizontal: 22,
    },
    startWorkoutFooter: { paddingBottom: 10, paddingHorizontal: Layout.screenPadding, paddingTop: 10 },
    startWorkoutText: { color: feature.workoutDaysOn, fontSize: 16, fontWeight: '700' },

    workoutHeader: { gap: 12 },
    progressTextRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    progressLabel: { color: colors.textSecondary, ...Type.caption },
    progressValue: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '500' },
    progressTrack: { backgroundColor: colors.surfaceMuted, borderRadius: 2, height: 3, overflow: 'hidden' },
    progressFill: { backgroundColor: feature.activeSecondary, borderRadius: 2, height: '100%' },
    workoutControls: { alignItems: 'center', flexDirection: 'row', gap: 14, marginTop: 4 },
    workoutToggleButton: {
      alignItems: 'center',
      backgroundColor: colors.text,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 22,
    },
    workoutPauseButton: { backgroundColor: colors.surfaceMuted },
    workoutButtonDisabled: { opacity: 0.4 },
    workoutToggleText: { color: colors.background, fontSize: 15, fontWeight: '600' },
    workoutStopwatch: { flex: 1 },
    workoutStopwatchText: {
      color: colors.text,
      fontSize: 22,
      fontVariant: ['tabular-nums'],
      fontWeight: '300',
    },
    averageDuration: { color: colors.textTertiary, ...Type.footnote, marginTop: 18, textAlign: 'center' },
    finishWorkoutButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexDirection: 'row',
      gap: 6,
      minHeight: 36,
    },
    finishWorkoutText: { color: colors.textSecondary, fontSize: 13 },

    scheduleNotice: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
    scheduleNoticeText: { flex: 1, gap: 2 },
    scheduleNoticeTitle: { color: colors.text, fontSize: 14, fontWeight: '500' },
    scheduleNoticeBody: { color: colors.textSecondary, ...Type.caption, lineHeight: 18 },
    successCard: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
    successText: { flex: 1, gap: 2 },
    successTitle: { color: colors.text, fontSize: 14, fontWeight: '500' },
    successBody: { color: colors.textSecondary, ...Type.caption, lineHeight: 18 },

    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    sectionTitle: { color: colors.text, ...Type.sectionTitle },
    sectionSubtitle: { color: colors.textSecondary, ...Type.caption },
    resetButton: { alignItems: 'center', justifyContent: 'center', minHeight: 32 },
    resetButtonText: { color: colors.danger, fontSize: 14 },
    emptyState: { alignItems: 'center', gap: 8, paddingVertical: 34 },
    emptyIcon: { alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '500' },
    emptyDescription: {
      color: colors.textSecondary,
      ...Type.caption,
      lineHeight: 19,
      paddingHorizontal: 20,
      textAlign: 'center',
    },
    exerciseList: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth },

    exerciseCard: {
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      gap: 12,
      paddingVertical: 16,
    },
    exerciseCardCurrent: {},
    exerciseCardComplete: { opacity: 0.65 },
    exerciseHeader: { alignItems: 'center', flexDirection: 'row', gap: 14 },
    exerciseVisual: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: Layout.radiusSmall,
      height: 34,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 34,
    },
    exerciseVisualComplete: { backgroundColor: colors.disciplineCompleted },
    exerciseText: { flex: 1, gap: 3 },
    exerciseOrder: { color: colors.textTertiary, ...Type.eyebrow },
    exerciseName: { color: colors.text, fontSize: 15, fontWeight: '500' },
    exerciseTarget: { color: colors.textSecondary, ...Type.caption },
    exerciseProgressTrack: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 2,
      height: 3,
      overflow: 'hidden',
    },
    exerciseProgressFill: { backgroundColor: feature.activeSecondary, borderRadius: 2, height: '100%' },
    exerciseProgressFillComplete: { backgroundColor: colors.disciplineCompleted },
    completedSetList: { gap: 6 },
    completedSetRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    completedSetNumber: { alignItems: 'center', flexDirection: 'row', gap: 4, width: 62 },
    completedSetNumberText: { color: colors.textTertiary, fontSize: 10, fontWeight: '600' },
    completedSetValue: { color: colors.textSecondary, fontSize: 12 },
    completedSetRpe: { color: colors.textTertiary, fontSize: 11 },
    setEntryArea: { gap: 10 },
    nextSetRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    nextSetTitle: { color: colors.text, fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
    previousSetText: { color: colors.textTertiary, flex: 1, fontSize: 11 },
    setInputRow: { flexDirection: 'row', gap: 10 },
    setInputGroup: { flex: 1, gap: 6 },
    setInputLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: '600', letterSpacing: 0.4 },
    setInput: {
      backgroundColor: colors.background,
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusSmall,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontSize: 15,
      minHeight: 44,
      paddingHorizontal: 12,
      textAlign: 'center',
    },
    setInputDisabled: { opacity: 0.45 },
    validationError: { color: colors.danger, fontSize: 12 },
    setControls: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    setCountArea: { alignItems: 'baseline', flexDirection: 'row', flex: 1 },
    setCount: { color: colors.text, fontSize: 18, fontWeight: '500' },
    setCountComplete: { color: colors.disciplineCompleted },
    setTarget: { color: colors.textSecondary, fontSize: 13 },
    undoButton: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    completeSetButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 18,
    },
    completeSetButtonDone: { backgroundColor: colors.disciplineCompleted },
    completeSetButtonDisabled: { backgroundColor: colors.surfaceMuted },
    completeSetButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '600' },

    restDayContainer: { alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 40 },
    restDayIcon: { alignItems: 'center', justifyContent: 'center' },
    restDayEyebrow: { color: colors.textTertiary, ...Type.eyebrow, marginTop: 4 },
    restDayTitle: { color: colors.text, fontSize: 19, fontWeight: '500', textAlign: 'center' },
    restDayBody: {
      color: colors.textSecondary,
      ...Type.caption,
      lineHeight: 19,
      textAlign: 'center',
    },

    restTimerCard: {
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: Layout.radiusLarge,
      bottom: 16,
      flexDirection: 'row',
      gap: 12,
      left: Layout.screenPadding,
      padding: 14,
      position: 'absolute',
      right: Layout.screenPadding,
    },
    restTimerCardFinished: { backgroundColor: colors.surfaceMuted },
    restTimerIcon: { alignItems: 'center', justifyContent: 'center' },
    restTimerText: { flex: 1, gap: 2 },
    restTimerTitle: { color: colors.text, fontSize: 14, fontWeight: '500' },
    restTimerCaption: { color: colors.textSecondary, ...Type.footnote },
    restTimerValue: {
      color: colors.text,
      fontSize: 20,
      fontVariant: ['tabular-nums'],
      fontWeight: '300',
    },
    restTimerValueOvertime: { color: colors.accent, fontWeight: '500' },
    dismissRestTimer: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
    pressed: { opacity: 0.6 },
  });
}
