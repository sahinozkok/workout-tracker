import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { PROGRAM_ICON_OPTIONS } from '@/constants/program-icons';
import { Form, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { WorkoutVisual } from '@/types/workout';

type WorkoutVisualPickerProps = {
  onSelect: (visual: WorkoutVisual) => void;
  selectedVisual: WorkoutVisual;
  variant?: 'default' | 'exerciseEdit' | 'programCreate' | 'programEdit';
};

const PROGRAM_CREATE_ACCENT = '#A56BEF';

export function WorkoutVisualPicker({
  onSelect,
  selectedVisual,
  variant = 'default',
}: WorkoutVisualPickerProps) {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const isProgramCreate = variant === 'programCreate';
  const isProgramEdit = variant === 'programEdit';
  const isExerciseEdit = variant === 'exerciseEdit';
  const styles = createStyles(colors, isExerciseEdit, isProgramCreate, isProgramEdit);
  const [textValue, setTextValue] = useState(selectedVisual.type === 'text' ? selectedVisual.text : '');
  const [iconsOpen, setIconsOpen] = useState(false);

  useEffect(() => {
    if (selectedVisual.type === 'text') setTextValue(selectedVisual.text);
  }, [selectedVisual]);

  function applyTextVisual() {
    const trimmedValue = Array.from(textValue.trim()).slice(0, 4).join('');
    if (!trimmedValue) {
      Alert.alert(t('components.numberOrEmojiRequired'), t('components.numberOrEmojiBody'));
      return;
    }

    setTextValue(trimmedValue);
    setIconsOpen(false);
    onSelect({ type: 'text', text: trimmedValue });
  }

  function handleTextChange(value: string) {
    setTextValue(value);
    if (!isExerciseEdit) return;

    const trimmedValue = Array.from(value.trim()).slice(0, 4).join('');
    if (trimmedValue) onSelect({ type: 'text', text: trimmedValue });
  }

  async function pickImage() {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('components.galleryPermission'), t('components.galleryPermissionBody'));
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setIconsOpen(false);
      onSelect({ type: 'image', uri: result.assets[0].uri });
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.mainRow}>
        <Pressable
          accessibilityLabel={t('a11y.selectPhoto')}
          accessibilityRole="button"
          hitSlop={2}
          onPress={() => void pickImage()}
          style={({ pressed }) => [
            styles.galleryButton,
            selectedVisual.type === 'image' && styles.selectedControl,
            pressed && styles.pressed,
          ]}>
          {selectedVisual.type === 'image' ? (
            <WorkoutVisualDisplay
              color={isProgramCreate ? PROGRAM_CREATE_ACCENT : colors.primaryIcon}
              size={32}
              visual={selectedVisual}
            />
          ) : (
            <Ionicons
              name="image-outline"
              size={isProgramCreate || isProgramEdit || isExerciseEdit ? 22 : 31}
              color={isProgramCreate || isProgramEdit || isExerciseEdit ? colors.textSecondary : colors.primaryIcon}
            />
          )}
        </Pressable>

        <View style={styles.textArea}>
          {!isProgramCreate && !isProgramEdit && !isExerciseEdit && (
            <Text style={styles.textLabel}>{t('components.useNumberOrEmoji')}</Text>
          )}
          <TextInput
            autoCorrect={false}
            keyboardAppearance={isDark ? 'dark' : 'light'}
            maxLength={8}
            onChangeText={handleTextChange}
            onSubmitEditing={applyTextVisual}
            placeholder={t('visualPicker.textPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={isProgramCreate ? PROGRAM_CREATE_ACCENT : colors.primary}
            style={[styles.textInput, selectedVisual.type === 'text' && styles.selectedInput]}
            value={textValue}
          />
        </View>

        <Pressable
          accessibilityLabel={t('a11y.openIconList')}
          accessibilityRole="button"
          accessibilityState={{ expanded: iconsOpen }}
          hitSlop={4}
          onPress={() => setIconsOpen((currentValue) => !currentValue)}
          style={({ pressed }) => [
            styles.iconMenuButton,
            (iconsOpen || selectedVisual.type === 'icon') && styles.iconMenuButtonSelected,
            pressed && styles.pressed,
          ]}>
          <Ionicons name="ellipsis-horizontal" size={25} color={colors.textSecondary} />
        </Pressable>

        {!isExerciseEdit && (
          <Pressable
            accessibilityRole="button"
            hitSlop={4}
            onPress={applyTextVisual}
            style={({ pressed }) => [styles.applyButton, pressed && styles.pressed]}>
            <Text style={styles.applyButtonText}>{t('components.apply')}</Text>
          </Pressable>
        )}
      </View>

      {iconsOpen && (
        <View style={styles.iconPanel}>
          <Text style={styles.iconPanelTitle}>{t('components.readyIcons')}</Text>
          <View style={styles.iconGrid}>
            {PROGRAM_ICON_OPTIONS.map((option) => {
              const isSelected = selectedVisual.type === 'icon' && selectedVisual.icon === option.icon;

              return (
                <Pressable
                  accessibilityLabel={t('a11y.selectIcon', { name: t(option.labelKey) })}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  key={option.icon}
                  onPress={() => {
                    onSelect({ type: 'icon', icon: option.icon });
                    setIconsOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.iconOption,
                    isSelected && styles.iconOptionSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Ionicons
                    name={option.icon}
                    size={22}
                    color={
                      isSelected
                        ? isProgramCreate
                          ? '#111113'
                          : colors.onPrimary
                        : isProgramCreate
                          ? colors.textSecondary
                          : colors.primaryIcon
                    }
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

function createStyles(
  colors: ThemeColors,
  isExerciseEdit: boolean,
  isProgramCreate: boolean,
  isProgramEdit: boolean,
) {
  const isCompact = isExerciseEdit || isProgramCreate || isProgramEdit;
  /**
   * "Programı düzenle" ve "Egzersizi düzenle" yüzeyleri ortak form sistemini
   * kullanır: galeri, metin alanı ve üç nokta düğmesi AYNI yükseklik, AYNI
   * köşe yarıçapı ve tam dikey hizayla durur. Yükseklik `Form.controlHeight`
   * olduğu için kompakt görünüm minimum dokunma alanını da karşılar.
   *
   * `programCreate` ve varsayılan varyantlar bilinçli olarak dokunulmadan
   * bırakıldı; bu çalışma yalnızca iki düzenleme ekranını kapsıyor.
   */
  const isEditSurface = isExerciseEdit || isProgramEdit;
  const controlSize = Form.controlHeight;
  const controlRadius = Form.controlRadius;

  return StyleSheet.create({
    container: { gap: 10 },
    mainRow: {
      alignItems: isCompact ? 'center' : 'flex-end',
      flexDirection: 'row',
      gap: isEditSurface ? 8 : 7,
    },
    galleryButton: {
      alignItems: 'center',
      backgroundColor: isProgramCreate ? 'transparent' : isProgramEdit || isExerciseEdit ? colors.surfaceMuted : colors.surface,
      borderColor: isProgramCreate ? colors.separator : isProgramEdit || isExerciseEdit ? 'transparent' : colors.primary,
      borderRadius: isProgramCreate ? 999 : isEditSurface ? controlRadius : 6,
      borderWidth: isProgramCreate ? StyleSheet.hairlineWidth : isEditSurface ? 0 : 2,
      height: isProgramCreate ? 44 : isEditSurface ? controlSize : 48,
      justifyContent: 'center',
      overflow: 'hidden',
      width: isProgramCreate ? 44 : isEditSurface ? controlSize : 48,
    },
    selectedControl: {
      backgroundColor: isProgramCreate ? 'transparent' : isProgramEdit || isExerciseEdit ? colors.surfaceMuted : colors.primarySoft,
      borderColor: isProgramCreate ? PROGRAM_CREATE_ACCENT : colors.primary,
    },
    textArea: { flex: 1, gap: isCompact ? 0 : 4, minWidth: 82 },
    textLabel: { color: colors.text, fontSize: 9, fontWeight: '500' },
    textInput: {
      backgroundColor: isProgramCreate ? 'transparent' : colors.surfaceMuted,
      borderBottomColor: isProgramCreate ? colors.separator : colors.border,
      borderColor: colors.border,
      borderRadius: isProgramCreate ? 0 : isEditSurface ? controlRadius : 5,
      borderWidth: isProgramCreate || isEditSurface ? 0 : 1,
      borderBottomWidth: isProgramCreate ? StyleSheet.hairlineWidth : 0,
      color: colors.text,
      fontSize: isEditSurface ? Type.body.fontSize : isProgramCreate ? 16 : 12,
      height: isEditSurface ? controlSize : isCompact ? 40 : 38,
      paddingHorizontal: isProgramCreate ? 0 : isEditSurface ? 12 : 9,
      paddingVertical: 0,
    },
    selectedInput: {
      borderBottomColor: isProgramCreate ? PROGRAM_CREATE_ACCENT : colors.primary,
      borderColor: isProgramCreate ? undefined : colors.primary,
    },
    iconMenuButton: {
      alignItems: 'center',
      backgroundColor: isProgramCreate ? 'transparent' : colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: isProgramCreate ? 999 : isEditSurface ? controlRadius : 7,
      borderWidth: isEditSurface ? 0 : 1,
      height: isEditSurface ? controlSize : isCompact ? 40 : 41,
      justifyContent: 'center',
      width: isEditSurface ? controlSize : isCompact ? 40 : 43,
    },
    iconMenuButtonSelected: {
      backgroundColor: isProgramCreate ? 'transparent' : isProgramEdit ? colors.surfaceMuted : colors.border,
      borderColor: isProgramCreate ? PROGRAM_CREATE_ACCENT : colors.textTertiary,
    },
    applyButton: {
      alignItems: 'center',
      backgroundColor: isProgramCreate ? PROGRAM_CREATE_ACCENT : isProgramEdit ? colors.text : colors.primary,
      borderRadius: isProgramCreate ? 999 : isProgramEdit ? controlRadius : 8,
      height: isProgramEdit ? controlSize : isCompact ? 40 : 41,
      justifyContent: 'center',
      paddingHorizontal: isCompact ? 16 : 12,
    },
    applyButtonText: {
      color: isProgramCreate ? '#111113' : isProgramEdit ? colors.background : colors.onPrimary,
      fontSize: isProgramEdit ? Form.action.fontSize : isCompact ? 14 : 11,
      fontWeight: isProgramEdit ? Form.action.fontWeight : '700',
    },
    iconPanel: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      gap: 10,
      padding: 10,
    },
    iconPanelTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
    iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    iconOption: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderRadius: 7,
      borderWidth: 1,
      height: 39,
      justifyContent: 'center',
      width: 39,
    },
    iconOptionSelected: {
      backgroundColor: isProgramCreate ? PROGRAM_CREATE_ACCENT : colors.primary,
      borderColor: isProgramCreate ? PROGRAM_CREATE_ACCENT : colors.primary,
    },
    pressed: { opacity: 0.7 },
  });
}
