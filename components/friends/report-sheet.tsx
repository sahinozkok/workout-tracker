import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendsMetrics, FriendsPalette, useFriendsPalette } from '@/components/friends/friends-theme';
import { useTranslation } from '@/context/language-context';
import { SAFETY_REPORT_DETAILS_MAX_LENGTH } from '@/services/safety';
import { SafetyReportCategory } from '@/types/safety';

const CATEGORIES: SafetyReportCategory[] = [
  'harassment',
  'hate',
  'sexual',
  'violence',
  'spam',
  'other',
];

type ReportSheetProps = {
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (category: SafetyReportCategory, details?: string) => void;
  target: 'message' | 'user';
  visible: boolean;
};

export function ReportSheet({ isSubmitting, onClose, onSubmit, target, visible }: ReportSheetProps) {
  const palette = useFriendsPalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [category, setCategory] = useState<SafetyReportCategory>();
  const [details, setDetails] = useState('');

  useEffect(() => {
    if (visible) return;
    setCategory(undefined);
    setDetails('');
  }, [visible]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={isSubmitting ? undefined : onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}>
        <Pressable
          accessibilityLabel={t('safety.closeReport')}
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={onClose}
          style={styles.backdrop}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>
                {t(target === 'message' ? 'safety.reportMessageTitle' : 'safety.reportUserTitle')}
              </Text>
              <Text style={styles.subtitle}>{t('safety.reportPrivateNote')}</Text>
            </View>
            <Pressable
              accessibilityLabel={t('common.cancel')}
              accessibilityRole="button"
              disabled={isSubmitting}
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <Ionicons color={palette.textSecondary} name="close" size={22} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <Text style={styles.sectionLabel}>{t('safety.reasonLabel')}</Text>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map((item) => {
                const selected = category === item;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    disabled={isSubmitting}
                    key={item}
                    onPress={() => setCategory(item)}
                    style={({ pressed }) => [
                      styles.category,
                      selected && styles.categorySelected,
                      pressed && styles.pressed,
                    ]}>
                    <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                      {t(`safety.categories.${item}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.detailsHeader}>
              <Text style={styles.sectionLabel}>{t('safety.detailsLabel')}</Text>
              <Text style={styles.counter}>
                {details.length}/{SAFETY_REPORT_DETAILS_MAX_LENGTH}
              </Text>
            </View>
            <TextInput
              accessibilityLabel={t('safety.detailsLabel')}
              editable={!isSubmitting}
              maxLength={SAFETY_REPORT_DETAILS_MAX_LENGTH}
              multiline
              onChangeText={setDetails}
              placeholder={t('safety.detailsPlaceholder')}
              placeholderTextColor={palette.textTertiary}
              style={styles.input}
              textAlignVertical="top"
              value={details}
            />
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: isSubmitting, disabled: !category || isSubmitting }}
            disabled={!category || isSubmitting}
            onPress={() => category && onSubmit(category, details)}
            style={({ pressed }) => [
              styles.submit,
              (!category || isSubmitting) && styles.submitDisabled,
              pressed && styles.pressed,
            ]}>
            {isSubmitting ? (
              <ActivityIndicator color={palette.onAccent} />
            ) : (
              <Text style={styles.submitText}>{t('safety.submitReport')}</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(palette: FriendsPalette) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end' },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.58)',
    },
    sheet: {
      backgroundColor: palette.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      gap: 16,
      maxHeight: '88%',
      paddingHorizontal: FriendsMetrics.screenPadding,
      paddingTop: 8,
    },
    handle: {
      alignSelf: 'center',
      backgroundColor: palette.border,
      borderRadius: 2,
      height: 4,
      width: 40,
    },
    header: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
    headerText: { flex: 1, gap: 4 },
    title: { color: palette.text, fontSize: 20, fontWeight: '700' },
    subtitle: { color: palette.textSecondary, fontSize: 13, lineHeight: 18 },
    closeButton: {
      alignItems: 'center',
      height: FriendsMetrics.minTouchSize,
      justifyContent: 'center',
      width: FriendsMetrics.minTouchSize,
    },
    scrollContent: { gap: 12 },
    sectionLabel: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.7,
      textTransform: 'uppercase',
    },
    categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    category: {
      borderColor: palette.border,
      borderRadius: FriendsMetrics.pillRadius,
      borderWidth: FriendsMetrics.hairline,
      justifyContent: 'center',
      minHeight: FriendsMetrics.minTouchSize,
      paddingHorizontal: 14,
    },
    categorySelected: { backgroundColor: palette.accent, borderColor: palette.accent },
    categoryText: { color: palette.textSecondary, fontSize: 14, fontWeight: '600' },
    categoryTextSelected: { color: palette.onAccent },
    detailsHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    counter: { color: palette.textTertiary, fontSize: 12 },
    input: {
      backgroundColor: palette.field,
      borderColor: palette.border,
      borderRadius: FriendsMetrics.cardRadius,
      borderWidth: FriendsMetrics.hairline,
      color: palette.text,
      fontSize: 15,
      lineHeight: 20,
      minHeight: 104,
      padding: 12,
    },
    submit: {
      alignItems: 'center',
      backgroundColor: palette.accent,
      borderRadius: FriendsMetrics.pillRadius,
      justifyContent: 'center',
      minHeight: 48,
    },
    submitDisabled: { opacity: 0.45 },
    submitText: { color: palette.onAccent, fontSize: 15, fontWeight: '700' },
    pressed: { opacity: 0.65 },
  });
}
