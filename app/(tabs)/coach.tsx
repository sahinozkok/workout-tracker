import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemeColors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  clearCoachMessages,
  createClientMessageId,
  loadCoachMessages,
  sendCoachMessage,
} from '@/services/ai/coach-chat';
import { CoachChatMessage } from '@/types/ai';

const QUICK_QUESTIONS = [
  'Bu haftaki gelişimimi özetle',
  'Hangi egzersizde en çok geliştim?',
  'Antrenman düzenimi nasıl iyileştirebilirim?',
  'Son antrenmanımı yorumla',
];

export default function CoachScreen() {
  const { user } = useAuth();
  const { colors } = useAppTheme();
  const styles = createStyles(colors);
  const listRef = useRef<FlatList<CoachChatMessage>>(null);

  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>();

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
          setError(loadError instanceof Error ? loadError.message : 'Sohbet geçmişi yüklenemedi.');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (messages.length > 0 || isSending) scrollToEnd();
  }, [messages, isSending, scrollToEnd]);

  const deliverMessage = useCallback(
    async (content: string, clientMessageId: string) => {
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
        setError(sendError instanceof Error ? sendError.message : 'Mesaj gönderilemedi.');
      } finally {
        setIsSending(false);
      }
    },
    [],
  );

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
    Alert.alert('Sohbeti temizle', 'Tüm sohbet geçmişin kalıcı olarak silinsin mi?', [
      { style: 'cancel', text: 'Vazgeç' },
      {
        style: 'destructive',
        text: 'Temizle',
        onPress: () => {
          const previous = messages;
          setMessages([]);
          setError(undefined);
          clearCoachMessages(user.id).catch((clearError) => {
            setMessages(previous);
            setError(clearError instanceof Error ? clearError.message : 'Sohbet temizlenemedi.');
          });
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AI Koç</Text>
        {messages.length > 0 && (
          <Pressable
            accessibilityLabel="Sohbeti temizle"
            accessibilityRole="button"
            disabled={isSending}
            hitSlop={10}
            onPress={confirmClear}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}>
            <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        style={styles.flex}>
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={colors.primaryIcon} size="large" />
            <Text style={styles.mutedText}>Sohbet yükleniyor…</Text>
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
              <MessageBubble colors={colors} message={item} onRetry={retry} styles={styles} />
            )}
            ListEmptyComponent={
              <WelcomeState colors={colors} disabled={isSending} onPick={submit} styles={styles} />
            }
            ListFooterComponent={isSending ? <TypingIndicator colors={colors} styles={styles} /> : null}
            showsVerticalScrollIndicator={false}
          />
        )}

        {error && (
          <View style={styles.errorBar}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.inputBar}>
          <TextInput
            editable={!isSending}
            multiline
            onChangeText={setInput}
            placeholder="Koçuna bir şey sor…"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            value={input}
          />
          <Pressable
            accessibilityLabel="Gönder"
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
              <Ionicons name="arrow-up" size={20} color={colors.onPrimary} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type BubbleProps = {
  colors: ThemeColors;
  message: CoachChatMessage;
  onRetry: (message: CoachChatMessage) => void;
  styles: ReturnType<typeof createStyles>;
};

function MessageBubble({ colors, message, onRetry, styles }: BubbleProps) {
  const isUser = message.role === 'user';
  const isFailed = message.status === 'failed';

  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant]}>
      {!isUser && (
        <View style={styles.assistantMark}>
          <Ionicons name="sparkles" size={13} color={colors.primaryIcon} />
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
            <Ionicons name="refresh" size={13} color={colors.danger} />
            <Text style={styles.retryText}>Gönderilemedi · Tekrar dene</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function TypingIndicator({ colors, styles }: { colors: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={[styles.bubbleRow, styles.bubbleRowAssistant]}>
      <View style={styles.assistantMark}>
        <Ionicons name="sparkles" size={13} color={colors.primaryIcon} />
      </View>
      <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
        <ActivityIndicator color={colors.textSecondary} size="small" />
        <Text style={styles.typingText}>Koç yazıyor…</Text>
      </View>
    </View>
  );
}

type WelcomeProps = {
  colors: ThemeColors;
  disabled: boolean;
  onPick: (text: string) => void;
  styles: ReturnType<typeof createStyles>;
};

function WelcomeState({ colors, disabled, onPick, styles }: WelcomeProps) {
  return (
    <View style={styles.welcome}>
      <View style={styles.welcomeMark}>
        <Ionicons name="sparkles" size={28} color={colors.primaryIcon} />
      </View>
      <Text style={styles.welcomeTitle}>AI Koçuna hoş geldin</Text>
      <Text style={styles.welcomeText}>
        Antrenman kayıtlarına dayanarak sorularını yanıtlar. Aşağıdaki hızlı sorulardan biriyle başlayabilirsin.
      </Text>
      <View style={styles.quickList}>
        {QUICK_QUESTIONS.map((question) => (
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            key={question}
            onPress={() => onPick(question)}
            style={({ pressed }) => [styles.quickChip, pressed && styles.pressed, disabled && styles.quickChipDisabled]}>
            <Text style={styles.quickChipText}>{question}</Text>
            <Ionicons name="arrow-forward" size={15} color={colors.primaryIcon} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    flex: { flex: 1 },
    header: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    headerTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
    clearButton: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
    loadingState: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center' },
    mutedText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    listContent: { gap: 14, paddingHorizontal: 16, paddingVertical: 18 },
    listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
    bubbleRow: { flexDirection: 'row', gap: 8, maxWidth: '100%' },
    bubbleRowUser: { justifyContent: 'flex-end', paddingLeft: 48 },
    bubbleRowAssistant: { justifyContent: 'flex-start', paddingRight: 40 },
    assistantMark: {
      alignItems: 'center',
      borderColor: colors.primarySoftBorder,
      borderRadius: 14,
      borderWidth: 1,
      height: 28,
      justifyContent: 'center',
      marginTop: 2,
      width: 28,
    },
    bubbleColumn: { flexShrink: 1, gap: 5 },
    bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
    bubbleUser: { backgroundColor: colors.primary, borderTopRightRadius: 4 },
    bubbleAssistant: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderTopLeftRadius: 4,
      borderWidth: 1,
    },
    bubbleText: { color: colors.text, fontSize: 15, lineHeight: 21 },
    bubbleTextUser: { color: colors.onPrimary },
    typingBubble: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    typingText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    retryRow: { alignItems: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 2 },
    retryText: { color: colors.danger, fontSize: 12, fontWeight: '700' },
    welcome: { alignItems: 'center', gap: 12, paddingHorizontal: 12 },
    welcomeMark: {
      alignItems: 'center',
      borderColor: colors.primarySoftBorder,
      borderRadius: 18,
      borderWidth: 1,
      height: 60,
      justifyContent: 'center',
      width: 60,
    },
    welcomeTitle: { color: colors.text, fontSize: 20, fontWeight: '900' },
    welcomeText: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      paddingHorizontal: 12,
      textAlign: 'center',
    },
    quickList: { alignSelf: 'stretch', gap: 10, marginTop: 8 },
    quickChip: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    quickChipDisabled: { opacity: 0.5 },
    quickChipText: { color: colors.text, flexShrink: 1, fontSize: 14, fontWeight: '700' },
    errorBar: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    errorText: { color: colors.danger, flex: 1, fontSize: 12, fontWeight: '600' },
    inputBar: {
      alignItems: 'flex-end',
      borderTopColor: colors.border,
      borderTopWidth: 1,
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: 20,
      borderWidth: 1,
      color: colors.text,
      flex: 1,
      fontSize: 15,
      maxHeight: 120,
      paddingHorizontal: 16,
      paddingTop: Platform.OS === 'ios' ? 12 : 8,
      paddingBottom: Platform.OS === 'ios' ? 12 : 8,
    },
    sendButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 20,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    sendButtonDisabled: { opacity: 0.5 },
    pressed: { opacity: 0.7 },
  });
}
