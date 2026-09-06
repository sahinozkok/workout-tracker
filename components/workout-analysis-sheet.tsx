import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import {
  WorkoutAnalysisError,
  WorkoutAnalysisErrorKind,
  generateWorkoutAnalysis,
} from '@/services/ai/workout-insights';
import { useAppTheme } from '@/hooks/use-app-theme';

type WorkoutInsight = {
  headline: string;
  highlights: string[];
  nextSteps: string[];
  summary: string;
};

type SheetState = 'loading' | 'ready' | 'in_progress' | 'error';

/**
 * KOÇ WORKOUT ANALİZİ — belirli, tamamlanmış bir antrenman için GERÇEK AI
 * (Gemini) toparlanma/gelişim analizini gösteren, ekranı KAPLAMAYAN alt sayfa.
 *
 * Durumlar: yükleniyor / başarı / hata + tekrar dene. Sonuç sunucuda saklanır;
 * aynı workout için tekrar açılınca yeni AI maliyeti oluşmaz. Başarılı analiz
 * `coach_to_the_top` kanıtı yazdığı için `onAnalyzed` ile başarım senkronu
 * tetiklenir. Reduce Motion/tema/44 pt kurallarına uyar; 375 pt'de taşmaz.
 */
export function WorkoutAnalysisSheet({
  accentColor,
  onAnalyzed,
  onClose,
  sessionId,
}: {
  accentColor: string;
  onAnalyzed: () => void;
  onClose: () => void;
  sessionId?: string;
}) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [state, setState] = useState<SheetState>('loading');
  const [insight, setInsight] = useState<WorkoutInsight>();
  const [errorKind, setErrorKind] = useState<WorkoutAnalysisErrorKind>('generic');
  // Her istek artan bir kimlik alır; oturum değişince (veya tekrar denenince) eski
  // isteğin geç gelen sonucu YOK SAYILIR (stale-promise koruması).
  const requestRef = useRef(0);
  // onAnalyzed en fazla bir kez (ilk başarılı analizde) tetiklenir.
  const analyzedRef = useRef(false);

  const run = useCallback(
    (targetSession: string) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      setState('loading');
      generateWorkoutAnalysis(targetSession)
        .then((result) => {
          if (requestRef.current !== requestId) return;
          if (result.status === 'in_progress') {
            // Başka istek üretiyor: yeni Gemini çağrısı YOK; kullanıcı tekrar dener.
            setState('in_progress');
            return;
          }
          setInsight(result.insight as WorkoutInsight);
          setState('ready');
          // Başarılı analiz defterе yazıldı → kariyer başarımı (coach_to_the_top)
          // senkronu YALNIZ ilk başarıda bir kez.
          if (!analyzedRef.current) {
            analyzedRef.current = true;
            onAnalyzed();
          }
        })
        .catch((error: unknown) => {
          if (requestRef.current !== requestId) return;
          setErrorKind(error instanceof WorkoutAnalysisError ? error.kind : 'generic');
          setState('error');
        });
    },
    [onAnalyzed],
  );

  useEffect(() => {
    if (!sessionId) {
      // Sheet KAPANDI (sessionId undefined): aktif isteğin jenerasyonunu geçersizle.
      // Geç gelen eski promise state/insight/onAnalyzed'i DEĞİŞTİREMEZ.
      requestRef.current += 1;
      return;
    }
    // Yeni bir workout açıldığında önceki sonuç/istek sıfırlanır.
    setInsight(undefined);
    analyzedRef.current = false;
    run(sessionId);
    return () => {
      // Session değişince VEYA unmount'ta çalışan isteği geçersizle (stale-close).
      // Eski session cevabı yeni ekranı ezemez; kapanış sonrası onAnalyzed olmaz.
      requestRef.current += 1;
    };
  }, [sessionId, run]);

  const errorMessage =
    errorKind === 'quota'
      ? t('history.coachAnalysis.errorQuota')
      : errorKind === 'connection'
        ? t('history.coachAnalysis.errorConnection')
        : t('history.coachAnalysis.error');

  return (
    <Modal
      animationType={reduceMotion ? 'fade' : 'slide'}
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={sessionId !== undefined}>
      <View style={styles.root}>
        <Pressable accessibilityLabel={t('history.coachAnalysis.close')} accessibilityRole="button" onPress={onClose} style={styles.backdrop} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Ionicons color={accentColor} name="sparkles-outline" size={20} />
            <Text style={styles.title}>{t('history.coachAnalysis.title')}</Text>
            <Pressable accessibilityLabel={t('history.coachAnalysis.close')} accessibilityRole="button" hitSlop={8} onPress={onClose} style={styles.closeButton}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>

          {state === 'loading' ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={accentColor} size="large" />
              <Text style={styles.stateText}>{t('history.coachAnalysis.loading')}</Text>
            </View>
          ) : state === 'in_progress' ? (
            <View style={styles.centerState}>
              <Text style={styles.stateText}>{t('history.coachAnalysis.inProgress')}</Text>
              <MotionPressable
                accessibilityRole="button"
                onPress={() => sessionId && run(sessionId)}
                style={styles.retry}>
                <Text style={[styles.retryText, { color: accentColor }]}>{t('history.coachAnalysis.retry')}</Text>
              </MotionPressable>
            </View>
          ) : state === 'error' ? (
            <View style={styles.centerState}>
              <Text style={styles.stateText}>{errorMessage}</Text>
              <MotionPressable
                accessibilityRole="button"
                onPress={() => sessionId && run(sessionId)}
                style={styles.retry}>
                <Text style={[styles.retryText, { color: accentColor }]}>{t('history.coachAnalysis.retry')}</Text>
              </MotionPressable>
            </View>
          ) : insight ? (
            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
              <Text style={styles.insightHeadline}>{insight.headline}</Text>
              <Text style={styles.insightSummary}>{insight.summary}</Text>
              {insight.highlights.map((item, index) => (
                <View key={`h-${index}`} style={styles.bulletRow}>
                  <Ionicons color={accentColor} name="checkmark-circle-outline" size={16} />
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              ))}
              {insight.nextSteps.map((item, index) => (
                <View key={`n-${index}`} style={styles.bulletRow}>
                  <Ionicons color={colors.textSecondary} name="arrow-forward-circle-outline" size={16} />
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              ))}
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.4)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: Layout.radiusLarge,
      borderTopRightRadius: Layout.radiusLarge,
      maxHeight: '78%',
      paddingBottom: 12,
      paddingHorizontal: Layout.screenPadding,
    },
    handle: { alignSelf: 'center', backgroundColor: colors.separator, borderRadius: 3, height: 5, marginTop: 10, width: 40 },
    header: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 14 },
    title: { color: colors.text, flex: 1, fontSize: 18, fontWeight: '700' },
    closeButton: { alignItems: 'center', height: Layout.minTouchSize, justifyContent: 'center', width: Layout.minTouchSize },
    centerState: { alignItems: 'center', gap: 12, paddingVertical: 40 },
    stateText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
    retry: { justifyContent: 'center', minHeight: Layout.minTouchSize, paddingHorizontal: 8 },
    retryText: { fontSize: 14, fontWeight: '600' },
    body: { gap: 12, paddingBottom: 16, paddingTop: 16 },
    insightHeadline: { color: colors.text, fontSize: 17, fontWeight: '700' },
    insightSummary: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
    bulletRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
    bulletText: { color: colors.text, flex: 1, fontSize: 14, lineHeight: 20 },
  });
}
