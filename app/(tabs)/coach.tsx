import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTranslation } from '@/context/language-context';
import { useProfile } from '@/context/profile-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  clearCoachMessages,
  createClientMessageId,
  loadCoachMessages,
  sendCoachMessage,
} from '@/services/ai/coach-chat';
import {
  generateExerciseProgressInsight,
  generateWeeklyWorkoutInsight,
} from '@/services/ai/workout-insights';
import { CoachChatMessage, WeeklyWorkoutInsight } from '@/types/ai';
import { buildExerciseProgressMetrics } from '@/utils/exercise-ai-metrics';
import { buildWeeklyWorkoutMetrics } from '@/utils/weekly-workout-metrics';
import { buildExerciseAnalytics } from '@/utils/workout-analytics';

export default function CoachScreen() {
  const { user } = useAuth();
  const { colors } = useAppTheme();
  const { t, tList } = useTranslation();
  const styles = createStyles(colors);
  const listRef = useRef<FlatList<CoachChatMessage>>(null);
  // Klavye açıldığında sekme çubuğu da kapandığı için ofset, sabit bir sayı
  // yerine sekme çubuğunun gerçek yüksekliğinden (güvenli alan dahil) alınır.
  const bottomTabBarHeight = useBottomTabBarHeight();

  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>();
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(() => {
    let isMounted = true;
    loadCoachMessages()
      .then((loaded) => {
        if (isMounted) setMessages(loaded);
      })
      .catch((loadError) => {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : t('coach.loadFailed'));
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [t]);

  useEffect(() => {
    if (messages.length > 0 || isSending) scrollToEnd();
  }, [messages, isSending, scrollToEnd]);

  const deliverMessage = useCallback(async (content: string, clientMessageId: string) => {
    setError(undefined);
    setIsSending(true);
    try {
      const reply = await sendCoachMessage(content, clientMessageId);
      setMessages((current) => [
        ...current.map((message) =>
          message.clientMessageId === clientMessageId && message.role === 'user'
            ? { ...message, status: 'sent' as const }
            : message,
        ),
        reply,
      ]);
    } catch (sendError) {
      setMessages((current) =>
        current.map((message) =>
          message.clientMessageId === clientMessageId && message.role === 'user'
            ? { ...message, status: 'failed' as const }
            : message,
        ),
      );
      setError(sendError instanceof Error ? sendError.message : t('coach.sendFailed'));
    } finally {
      setIsSending(false);
    }
  }, [t]);

  const submit = useCallback(
    (rawText: string) => {
      const content = rawText.trim();
      if (!content || isSending) return;

      const clientMessageId = createClientMessageId();
      const optimisticMessage: CoachChatMessage = {
        clientMessageId,
        content,
        createdAt: new Date().toISOString(),
        id: clientMessageId,
        role: 'user',
        status: 'sending',
      };

      setInput('');
      void Haptics.selectionAsync();
      setMessages((current) => [...current, optimisticMessage]);
      void deliverMessage(content, clientMessageId);
    },
    [deliverMessage, isSending],
  );

  const retry = useCallback(
    (message: CoachChatMessage) => {
      if (isSending) return;
      setMessages((current) =>
        current.map((item) =>
          item.clientMessageId === message.clientMessageId && item.role === 'user'
            ? { ...item, status: 'sending' as const }
            : item,
        ),
      );
      void deliverMessage(message.content, message.clientMessageId);
    },
    [deliverMessage, isSending],
  );

  function confirmClear() {
    if (!user || messages.length === 0 || isSending) return;
    Alert.alert(t('coach.clear'), t('coach.clearBody'), [
      { style: 'cancel', text: t('common.cancel') },
      {
        style: 'destructive',
        text: t('coach.clearConfirm'),
        onPress: () => {
          const previous = messages;
          setMessages([]);
          setError(undefined);
          clearCoachMessages(user.id).catch((clearError) => {
            setMessages(previous);
            setError(clearError instanceof Error ? clearError.message : t('coach.clearFailed'));
          });
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('coach.title')}</Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel={t('coach.analysisLabel')}
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setIsAnalysisOpen(true)}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <Ionicons name="stats-chart-outline" size={19} color={colors.textSecondary} />
          </Pressable>
          {messages.length > 0 && (
            <Pressable
              accessibilityLabel={t('coach.clear')}
              accessibilityRole="button"
              disabled={isSending}
              hitSlop={10}
              onPress={confirmClear}
              style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
              <Ionicons name="trash-outline" size={19} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? bottomTabBarHeight : 0}
        style={styles.flex}>
        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.centerStateText}>{t('coach.loading')}</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={[styles.listContent, messages.length === 0 && styles.listContentEmpty]}
            data={messages}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            onContentSizeChange={scrollToEnd}
            ref={listRef}
            renderItem={({ item }) => (
              <MessageBubble
                colors={colors}
                message={item}
                onRetry={retry}
                retryLabel={t('coach.retry')}
                styles={styles}
              />
            )}
            ListEmptyComponent={
              <WelcomeState
                colors={colors}
                disabled={isSending}
                onPick={submit}
                questions={tList('coach.welcomeQuestions')}
                styles={styles}
                subtitle={t('coach.welcomeBody')}
                title={t('coach.welcomeTitle')}
              />
            }
            ListFooterComponent={
              isSending ? <TypingIndicator colors={colors} label={t('coach.typing')} styles={styles} /> : null
            }
            showsVerticalScrollIndicator={false}
          />
        )}

        {error && (
          <View style={styles.errorBar}>
            <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!isLoading && messages.length > 0 && (
          <View style={styles.quickRow}>
            {tList('coach.quickQuestions').map((question) => (
              <Pressable
                accessibilityRole="button"
                disabled={isSending}
                key={question}
                onPress={() => submit(question)}
                style={({ pressed }) => [
                  styles.quickChip,
                  isSending && styles.quickChipDisabled,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.quickChipText}>{question}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.composer}>
          <TextInput
            editable={!isSending}
            multiline
            onChangeText={setInput}
            placeholder={t('coach.placeholder')}
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            value={input}
          />
          <Pressable
            accessibilityLabel={t('coach.send')}
            accessibilityRole="button"
            disabled={isSending || input.trim().length === 0}
            onPress={() => submit(input)}
            style={({ pressed }) => [
              styles.sendButton,
              (isSending || input.trim().length === 0) && styles.sendButtonDisabled,
              pressed && styles.pressed,
            ]}>
            {isSending ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Ionicons name="arrow-up" size={18} color={colors.onPrimary} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <AnalysisSheet
        colors={colors}
        onClose={() => setIsAnalysisOpen(false)}
        styles={styles}
        visible={isAnalysisOpen}
      />
    </SafeAreaView>
  );
}

type BubbleProps = {
  colors: ThemeColors;
  message: CoachChatMessage;
  onRetry: (message: CoachChatMessage) => void;
  retryLabel: string;
  styles: ReturnType<typeof createStyles>;
};

function MessageBubble({ colors, message, onRetry, retryLabel, styles }: BubbleProps) {
  const isUser = message.role === 'user';
  const isFailed = message.status === 'failed';

  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant]}>
      {!isUser && (
        <View style={styles.assistantMark}>
          <View style={styles.assistantMarkDot} />
        </View>
      )}
      <View style={styles.bubbleColumn}>
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
          <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>{message.content}</Text>
        </View>
        {isFailed && (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => onRetry(message)}
            style={({ pressed }) => [styles.retryRow, pressed && styles.pressed]}>
            <Ionicons name="refresh" size={12} color={colors.danger} />
            <Text style={styles.retryText}>{retryLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function TypingIndicator({
  colors,
  label,
  styles,
}: {
  colors: ThemeColors;
  label: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={[styles.bubbleRow, styles.bubbleRowAssistant]}>
      <View style={styles.assistantMark}>
        <View style={styles.assistantMarkDot} />
      </View>
      <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
        <ActivityIndicator color={colors.textSecondary} size="small" />
        <Text style={styles.typingText}>{label}</Text>
      </View>
    </View>
  );
}

type WelcomeProps = {
  colors: ThemeColors;
  disabled: boolean;
  onPick: (text: string) => void;
  questions: string[];
  styles: ReturnType<typeof createStyles>;
  subtitle: string;
  title: string;
};

function WelcomeState({ colors, disabled, onPick, questions, styles, subtitle, title }: WelcomeProps) {
  return (
    <View style={styles.welcome}>
      <View style={styles.welcomeMark}>
        <Ionicons name="sparkles-outline" size={22} color={colors.primary} />
      </View>
      <Text style={styles.welcomeTitle}>{title}</Text>
      <Text style={styles.welcomeText}>{subtitle}</Text>
      <View style={styles.welcomeList}>
        {questions.map((question) => (
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            key={question}
            onPress={() => onPick(question)}
            style={({ pressed }) => [
              styles.quickChip,
              disabled && styles.quickChipDisabled,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.quickChipText}>{question}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * Haftalık özet ve egzersiz analizi, sohbet düzenini bozmadan başlıktaki
 * eylemden açılan panelde çalışmaya devam eder. Aynı servis fonksiyonlarını
 * ve aynı Edge Function özelliklerini kullanır.
 */
function AnalysisSheet({
  colors,
  onClose,
  styles,
  visible,
}: {
  colors: ThemeColors;
  onClose: () => void;
  styles: ReturnType<typeof createStyles>;
  visible: boolean;
}) {
  const { profile } = useProfile();
  const { t } = useTranslation();
  const { activeProgramId, completedSetCounts, disciplineStatuses, programs, workoutSessions, workoutSets } =
    useWorkout();
  const [mode, setMode] = useState<'weekly' | 'exercise'>('weekly');
  const [selectedExerciseKey, setSelectedExerciseKey] = useState<string>();
  const [insight, setInsight] = useState<WeeklyWorkoutInsight>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>();

  const activeProgram = programs.find((program) => program.id === activeProgramId);
  const metrics = useMemo(
    () =>
      buildWeeklyWorkoutMetrics({
        activeProgramName: activeProgram?.name,
        completedSetCounts,
        disciplineStatuses,
        trainingGoal: profile.trainingGoal,
        workoutSessions,
      }),
    [activeProgram?.name, completedSetCounts, disciplineStatuses, profile.trainingGoal, workoutSessions],
  );
  const completedSessionIds = useMemo(
    () => new Set(workoutSessions.filter((session) => session.status === 'completed').map((session) => session.id)),
    [workoutSessions],
  );
  const exerciseAnalytics = useMemo(
    () => buildExerciseAnalytics(workoutSets.filter((workoutSet) => completedSessionIds.has(workoutSet.sessionId))),
    [completedSessionIds, workoutSets],
  );
  const selectedExercise =
    exerciseAnalytics.find((exercise) => exercise.exerciseKey === selectedExerciseKey) ?? exerciseAnalytics[0];
  const exerciseMetrics = selectedExercise ? buildExerciseProgressMetrics(selectedExercise) : undefined;

  async function generate() {
    setIsGenerating(true);
    setError(undefined);
    try {
      if (mode === 'exercise') {
        if (!exerciseMetrics) throw new Error(t('coach.noExerciseMetrics'));
        setInsight(await generateExerciseProgressInsight(exerciseMetrics));
      } else {
        setInsight(await generateWeeklyWorkoutInsight(metrics));
      }
    } catch (generationError) {
      setError(
        generationError instanceof Error ? generationError.message : t('coach.analysisFailed'),
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function changeMode(nextMode: 'weekly' | 'exercise') {
    setMode(nextMode);
    setInsight(undefined);
    setError(undefined);
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <SafeAreaView style={styles.sheetSafeArea} edges={['top', 'bottom']}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('coach.analysisTitle')}</Text>
          <Pressable
            accessibilityLabel={t('common.close')}
            accessibilityRole="button"
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          <View style={styles.sheetTabs}>
            {(['weekly', 'exercise'] as const).map((option) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === option }}
                hitSlop={8}
                key={option}
                onPress={() => changeMode(option)}
                style={({ pressed }) => [styles.sheetTab, pressed && styles.pressed]}>
                <Text style={[styles.sheetTabText, mode === option && styles.sheetTabTextSelected]}>
                  {option === 'weekly' ? t('coach.weeklySummary') : t('coach.exerciseAnalysis')}
                </Text>
              </Pressable>
            ))}
          </View>

          {mode === 'weekly' ? (
            <Text style={styles.sheetCaption}>
              {t('coach.weeklyMeta', {
                end: metrics.periodEnd,
                sets: metrics.completedSets,
                start: metrics.periodStart,
                workouts: metrics.completedWorkouts,
              })}
            </Text>
          ) : exerciseAnalytics.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sheetChipRow}>
              {exerciseAnalytics.map((exercise) => {
                const isSelected = exercise.exerciseKey === selectedExercise?.exerciseKey;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={exercise.exerciseKey}
                    onPress={() => {
                      setSelectedExerciseKey(exercise.exerciseKey);
                      setInsight(undefined);
                    }}
                    style={({ pressed }) => [
                      styles.sheetChip,
                      isSelected && styles.sheetChipSelected,
                      pressed && styles.pressed,
                    ]}>
                    <Text
                      numberOfLines={1}
                      style={[styles.sheetChipText, isSelected && styles.sheetChipTextSelected]}>
                      {exercise.exerciseName}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={styles.sheetCaption}>{t('coach.noExerciseData')}</Text>
          )}

          {insight && (
            <View style={styles.insightBlock}>
              <Text style={styles.insightTitle}>{insight.headline}</Text>
              <Text style={styles.insightSummary}>{insight.summary}</Text>
              {insight.highlights.map((item) => (
                <View key={item} style={styles.insightItem}>
                  <View style={styles.insightBullet} />
                  <Text style={styles.insightItemText}>{item}</Text>
                </View>
              ))}
              {insight.nextSteps.map((item) => (
                <View key={item} style={styles.insightItem}>
                  <Ionicons name="arrow-forward" size={13} color={colors.primary} />
                  <Text style={styles.insightItemText}>{item}</Text>
                </View>
              ))}
              <Text style={styles.insightNotice}>{t('coach.medicalNotice')}</Text>
            </View>
          )}

          {error && <Text style={styles.sheetError}>{error}</Text>}

          <Pressable
            accessibilityRole="button"
            disabled={isGenerating || (mode === 'exercise' && !exerciseMetrics)}
            onPress={() => void generate()}
            style={({ pressed }) => [
              styles.sheetButton,
              (isGenerating || (mode === 'exercise' && !exerciseMetrics)) && styles.sheetButtonDisabled,
              pressed && styles.pressed,
            ]}>
            {isGenerating ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Text style={styles.sheetButtonText}>
                {insight ? t('coach.regenerate') : t('coach.generate')}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    flex: { flex: 1 },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: Layout.screenPadding,
      paddingVertical: 12,
    },
    headerTitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
    headerActions: { flexDirection: 'row', gap: 4 },
    headerButton: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 },
    centerState: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center' },
    centerStateText: { color: colors.textSecondary, ...Type.caption },
    listContent: { gap: 14, paddingHorizontal: Layout.screenPadding, paddingVertical: 14 },
    listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
    bubbleRow: { flexDirection: 'row', gap: 8 },
    bubbleRowUser: { justifyContent: 'flex-end', paddingLeft: 56 },
    bubbleRowAssistant: { justifyContent: 'flex-start', paddingRight: 40 },
    assistantMark: {
      alignItems: 'center',
      borderColor: colors.primary,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      height: 22,
      justifyContent: 'center',
      marginTop: 4,
      width: 22,
    },
    assistantMarkDot: { backgroundColor: colors.primary, borderRadius: 2.5, height: 5, width: 5 },
    bubbleColumn: { flexShrink: 1, gap: 6 },
    bubble: { borderRadius: 18, paddingHorizontal: 15, paddingVertical: 11 },
    bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 6 },
    bubbleAssistant: {
      backgroundColor: colors.background,
      borderColor: colors.separator,
      borderWidth: StyleSheet.hairlineWidth,
      borderBottomLeftRadius: 6,
    },
    bubbleText: { color: colors.text, fontSize: 15, lineHeight: 21 },
    bubbleTextUser: { color: colors.onPrimary },
    typingBubble: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    typingText: { color: colors.textSecondary, fontSize: 14 },
    retryRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
    retryText: { color: colors.danger, fontSize: 12, fontWeight: '500' },
    welcome: { alignItems: 'center', gap: 10, paddingHorizontal: 8 },
    welcomeMark: {
      alignItems: 'center',
      borderColor: colors.primary,
      borderRadius: 24,
      borderWidth: StyleSheet.hairlineWidth,
      height: 48,
      justifyContent: 'center',
      width: 48,
    },
    welcomeTitle: { color: colors.text, fontSize: 19, fontWeight: '600' },
    welcomeText: {
      color: colors.textSecondary,
      ...Type.caption,
      lineHeight: 19,
      paddingHorizontal: 16,
      textAlign: 'center',
    },
    welcomeList: { alignItems: 'flex-start', alignSelf: 'stretch', gap: 8, marginTop: 8 },
    quickRow: { gap: 8, paddingBottom: 4, paddingHorizontal: Layout.screenPadding, paddingTop: 4 },
    quickChip: {
      alignSelf: 'flex-start',
      borderColor: colors.primary,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
      minHeight: 34,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    quickChipDisabled: { opacity: 0.5 },
    quickChipText: { color: colors.primary, fontSize: 13, fontWeight: '500' },
    errorBar: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: Layout.screenPadding,
      paddingVertical: 8,
    },
    errorText: { color: colors.danger, flex: 1, fontSize: 12 },
    composer: {
      alignItems: 'flex-end',
      flexDirection: 'row',
      gap: 10,
      paddingBottom: 8,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 8,
    },
    input: {
      backgroundColor: colors.background,
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      flex: 1,
      fontSize: 15,
      maxHeight: 120,
      minHeight: 44,
      paddingHorizontal: 18,
      paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    },
    sendButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 22,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    sendButtonDisabled: { opacity: 0.4 },
    sheetSafeArea: { backgroundColor: colors.background, flex: 1 },
    sheetHeader: {
      alignItems: 'center',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: Layout.screenPadding,
      paddingVertical: 12,
    },
    sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
    sheetContent: { gap: 18, padding: Layout.screenPadding },
    sheetTabs: { flexDirection: 'row', gap: 20 },
    sheetTab: { justifyContent: 'center', minHeight: 30 },
    sheetTabText: { color: colors.textSecondary, fontSize: 14 },
    sheetTabTextSelected: { color: colors.text, fontWeight: '600' },
    sheetCaption: { color: colors.textSecondary, ...Type.caption, lineHeight: 19 },
    sheetChipRow: { flexGrow: 0 },
    sheetChip: {
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center',
      marginRight: 8,
      maxWidth: 200,
      minHeight: 34,
      paddingHorizontal: 14,
    },
    sheetChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    sheetChipText: { color: colors.textSecondary, fontSize: 13 },
    sheetChipTextSelected: { color: colors.onPrimary, fontWeight: '500' },
    insightBlock: { gap: 12 },
    insightTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
    insightSummary: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
    insightItem: { alignItems: 'flex-start', flexDirection: 'row', gap: 9 },
    insightBullet: { backgroundColor: colors.textTertiary, borderRadius: 2, height: 4, marginTop: 8, width: 4 },
    insightItemText: { color: colors.textSecondary, flex: 1, fontSize: 14, lineHeight: 20 },
    insightNotice: { color: colors.textTertiary, ...Type.footnote, lineHeight: 15 },
    sheetError: { color: colors.danger, fontSize: 13 },
    sheetButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      justifyContent: 'center',
      minHeight: 50,
    },
    sheetButtonDisabled: { opacity: 0.5 },
    sheetButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
