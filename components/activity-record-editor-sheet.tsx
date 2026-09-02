import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getOnAccentColor } from '@/constants/color-presets';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { WorkoutActivityRecord } from '@/types/workout';
import {
  ACTIVITY_DISTANCE_METERS_MAX,
  ACTIVITY_DISTANCE_METERS_MIN,
  ACTIVITY_DURATION_SECONDS_MAX,
  ACTIVITY_DURATION_SECONDS_MIN,
  describeRpeInput,
  formatMetersAsKilometers,
  parseKilometersToMeters,
  parseMinutesSecondsToSeconds,
  parseOptionalKilometersToMeters,
  parseOptionalRpe,
  rpeBandLabelKey,
  splitSecondsIntoFields,
} from '@/utils/activity-input';

type ActivityRecordEditorSheetProps = {
  /** Düzenlenecek kayıt; `undefined` iken sheet kapalıdır. */
  record?: WorkoutActivityRecord;
  onClose: () => void;
};

/**
 * GEÇMİŞ KARDİYO KAYDINI DÜZENLEME SHEET'İ.
 *
 * Aktif antrenmandaki kardiyo formuyla AYNI parser/sınırları (`activity-input`)
 * kullanır; ikinci bir doğrulama yolu tanımlanmaz. Yalnız performans alanları
 * (süre, mesafe, RPE) düzenlenir — kimlik, snapshot ve `completed_at` context
 * yolunda zaten korunur. Tempo hiçbir zaman yazılmaz.
 */
export function ActivityRecordEditorSheet({ record, onClose }: ActivityRecordEditorSheetProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const accent = useFeatureColor('historyProgress', colors.disciplineCompleted).color;
  const onAccent = getOnAccentColor(accent);
  const styles = useMemo(() => createStyles(colors, accent, onAccent), [colors, accent, onAccent]);
  const { updateActivityRecord, deleteActivityRecord } = useWorkout();

  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [distance, setDistance] = useState('');
  const [rpe, setRpe] = useState('');
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const visible = record !== undefined;
  const isDistanceMode = record?.trackingMode === 'distance';
  const isBusy = isSaving || isDeleting;

  // Kayıt açıldığında alanlar mevcut değerlerle ÖNCEDEN doldurulur.
  useEffect(() => {
    if (!record) return;
    const durationFields = splitSecondsIntoFields(record.durationSeconds);
    setMinutes(durationFields.minutes);
    setSeconds(durationFields.seconds);
    setDistance(record.distanceMeters === undefined ? '' : formatMetersAsKilometers(record.distanceMeters));
    setRpe(record.rpe === undefined ? '' : String(record.rpe));
    setError(undefined);
    setIsSaving(false);
    setIsDeleting(false);
  }, [record]);

  const rpeBand = describeRpeInput(rpe);

  function close() {
    if (isBusy) return;
    onClose();
  }

  async function handleSave() {
    if (!record || isBusy) return;
    setError(undefined);

    const durationResult = parseMinutesSecondsToSeconds(minutes, seconds, {
      min: ACTIVITY_DURATION_SECONDS_MIN,
      max: ACTIVITY_DURATION_SECONDS_MAX,
    });
    if (!durationResult.ok) {
      setError(durationResult.reason === 'range' ? t('day.durationRange') : t('day.durationRequired'));
      return;
    }

    const distanceBounds = { min: ACTIVITY_DISTANCE_METERS_MIN, max: ACTIVITY_DISTANCE_METERS_MAX };
    const distanceResult = isDistanceMode
      ? parseKilometersToMeters(distance, distanceBounds)
      : parseOptionalKilometersToMeters(distance, distanceBounds);
    if (!distanceResult.ok) {
      setError(
        distanceResult.reason === 'empty'
          ? t('day.distanceRequired')
          : distanceResult.reason === 'range'
            ? t('day.distanceRange')
            : t('day.distanceInvalid'),
      );
      return;
    }

    const rpeResult = parseOptionalRpe(rpe);
    if (!rpeResult.ok) {
      setError(t('day.rpeValidation'));
      return;
    }

    setIsSaving(true);
    try {
      await updateActivityRecord(record.id, {
        durationSeconds: durationResult.value,
        distanceMeters: distanceResult.value,
        rpe: rpeResult.value,
      });
      onClose();
    } catch {
      // Hata: kayıt ekranda KALIR (optimistic veri kaybı yok), kullanıcı tekrar dener.
      setError(t('history.saveRecordFailed'));
      setIsSaving(false);
    }
  }

  function confirmDelete() {
    if (!record || isBusy) return;
    Alert.alert(t('history.deleteRecordConfirmTitle'), t('history.deleteRecordConfirmBody'), [
      { style: 'cancel', text: t('common.cancel') },
      { style: 'destructive', text: t('common.delete'), onPress: () => void handleDelete() },
    ]);
  }

  async function handleDelete() {
    if (!record || isBusy) return;
    setError(undefined);
    setIsDeleting(true);
    try {
      await deleteActivityRecord(record.id);
      onClose();
    } catch {
      setError(t('history.deleteRecordFailed'));
      setIsDeleting(false);
    }
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={close}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}>
      {/* Arka plana dokunmak güvenle kapatır (kaydetme/silme sürerken engellenir). */}
      <Pressable accessibilityElementsHidden accessible={false} onPress={close} style={styles.backdrop} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <SafeAreaView accessibilityViewIsModal edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View accessibilityRole="header" style={styles.header}>
            <Text style={styles.title}>{t('history.editRecordTitle')}</Text>
            <Pressable
              accessibilityLabel={t('common.close')}
              accessibilityRole="button"
              disabled={isBusy}
              hitSlop={8}
              onPress={close}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          {record !== undefined && (
            <Text numberOfLines={1} style={styles.exerciseName}>
              {record.exerciseName}
            </Text>
          )}

          {/* Süre — dakika + saniye */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t('history.activityDuration')}</Text>
            <View style={styles.durationRow}>
              <View style={styles.durationCell}>
                <TextInput
                  accessibilityLabel={t('history.editMinutes')}
                  editable={!isBusy}
                  keyboardType="number-pad"
                  maxLength={4}
                  onChangeText={setMinutes}
                  placeholder="0"
                  placeholderTextColor={colors.textTertiary}
                  selectTextOnFocus
                  style={styles.durationInput}
                  value={minutes}
                />
                <Text style={styles.durationUnit}>{t('history.editMinutes')}</Text>
              </View>
              <Text style={styles.durationColon}>:</Text>
              <View style={styles.durationCell}>
                <TextInput
                  accessibilityLabel={t('history.editSeconds')}
                  editable={!isBusy}
                  keyboardType="number-pad"
                  maxLength={2}
                  onChangeText={setSeconds}
                  placeholder="0"
                  placeholderTextColor={colors.textTertiary}
                  selectTextOnFocus
                  style={styles.durationInput}
                  value={seconds}
                />
                <Text style={styles.durationUnit}>{t('history.editSeconds')}</Text>
              </View>
            </View>
          </View>

          {/* Mesafe — mesafe türünde zorunlu, süre türünde isteğe bağlı */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              {t('history.activityDistance')}
              {isDistanceMode ? '' : ` · ${t('day.optional')}`}
            </Text>
            <View style={styles.inlineInputRow}>
              <TextInput
                accessibilityLabel={t('history.activityDistance')}
                editable={!isBusy}
                keyboardType="decimal-pad"
                maxLength={7}
                onChangeText={setDistance}
                placeholder="—"
                placeholderTextColor={colors.textTertiary}
                selectTextOnFocus
                style={styles.inlineInput}
                value={distance}
              />
              <Text style={styles.inlineUnit}>{t('day.kmUnit')}</Text>
            </View>
          </View>

          {/* RPE — isteğe bağlı */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>
              {t('rpe.label')} · {t('day.optional')}
            </Text>
            <View style={styles.inlineInputRow}>
              <TextInput
                accessibilityHint={t('rpe.description')}
                accessibilityLabel={`${t('rpe.label')}, ${t('day.optional')}`}
                editable={!isBusy}
                keyboardType="decimal-pad"
                maxLength={4}
                onChangeText={setRpe}
                placeholder="—"
                placeholderTextColor={colors.textTertiary}
                selectTextOnFocus
                style={styles.inlineInput}
                value={rpe}
              />
              <Text style={styles.inlineUnit}>{rpeBand ? t(rpeBandLabelKey(rpeBand)) : ''}</Text>
            </View>
          </View>

          {error !== undefined && <Text style={styles.error}>{error}</Text>}

          <Pressable
            accessibilityLabel={t('common.save')}
            accessibilityRole="button"
            disabled={isBusy}
            onPress={() => void handleSave()}
            style={({ pressed }) => [styles.saveButton, (pressed || isBusy) && styles.saveButtonPressed]}>
            {isSaving ? (
              <ActivityIndicator color={onAccent} size="small" />
            ) : (
              <Text style={styles.saveButtonText}>{t('common.save')}</Text>
            )}
          </Pressable>

          <Pressable
            accessibilityLabel={t('history.deleteRecord')}
            accessibilityRole="button"
            disabled={isBusy}
            onPress={confirmDelete}
            style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
            {isDeleting ? (
              <ActivityIndicator color={colors.danger} size="small" />
            ) : (
              <Text style={styles.deleteButtonText}>{t('history.deleteRecord')}</Text>
            )}
          </Pressable>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors, accentColor: string, onAccentColor: string) {
  return StyleSheet.create({
    backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.45)', ...StyleSheet.absoluteFillObject },
    container: { flex: 1, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      gap: 16,
      paddingBottom: 8,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 10,
    },
    handle: {
      alignSelf: 'center',
      backgroundColor: colors.separator,
      borderRadius: 3,
      height: 5,
      width: 40,
    },
    header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    title: { color: colors.text, ...Type.sectionTitle },
    closeButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 17,
      height: Layout.minTouchSize,
      justifyContent: 'center',
      width: Layout.minTouchSize,
    },
    exerciseName: { color: colors.textSecondary, ...Type.body, marginTop: -8 },

    field: { gap: 8 },
    fieldLabel: { color: colors.textSecondary, ...Type.eyebrow, textTransform: 'uppercase' },
    durationRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    durationCell: { alignItems: 'center', flex: 1, gap: 4 },
    durationColon: { color: colors.textTertiary, ...Type.sectionTitle },
    durationInput: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusMedium,
      color: colors.text,
      fontVariant: ['tabular-nums'],
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 12,
      textAlign: 'center',
      width: '100%',
      ...Type.rowTitle,
    },
    durationUnit: { color: colors.textTertiary, ...Type.footnote },
    inlineInputRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    inlineInput: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusMedium,
      color: colors.text,
      flex: 1,
      fontVariant: ['tabular-nums'],
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 14,
      ...Type.rowTitle,
    },
    inlineUnit: { color: colors.textSecondary, ...Type.body, minWidth: 48 },
    error: { color: colors.danger, ...Type.caption },

    saveButton: {
      alignItems: 'center',
      backgroundColor: accentColor,
      borderRadius: Layout.radiusMedium,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
    },
    saveButtonPressed: { opacity: 0.85 },
    saveButtonText: { color: onAccentColor, ...Type.rowTitle, fontWeight: '600' },
    deleteButton: { alignItems: 'center', justifyContent: 'center', minHeight: Layout.minTouchSize },
    deleteButtonText: { color: colors.danger, ...Type.body, fontWeight: '600' },
    pressed: { opacity: 0.7 },
  });
}
