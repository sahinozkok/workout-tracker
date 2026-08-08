import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { WorkoutVisualDisplay } from '@/components/workout-visual-display';
import { PROGRAM_ICON_OPTIONS } from '@/constants/program-icons';
import { ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { WorkoutVisual } from '@/types/workout';

type WorkoutVisualPickerProps = {
  onSelect: (visual: WorkoutVisual) => void;
  selectedVisual: WorkoutVisual;
};

export function WorkoutVisualPicker({ onSelect, selectedVisual }: WorkoutVisualPickerProps) {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
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
          onPress={() => void pickImage()}
          style={({ pressed }) => [
            styles.galleryButton,
            selectedVisual.type === 'image' && styles.selectedControl,
            pressed && styles.pressed,
          ]}>
          {selectedVisual.type === 'image' ? (
            <WorkoutVisualDisplay color={colors.primaryIcon} size={32} visual={selectedVisual} />
          ) : (
            <Ionicons name="image-outline" size={31} color={colors.primaryIcon} />
          )}
        </Pressable>

        <View style={styles.textArea}>
          <Text style={styles.textLabel}>{t('components.useNumberOrEmoji')}</Text>
          <TextInput
            autoCorrect={false}
            keyboardAppearance={isDark ? 'dark' : 'light'}
            maxLength={8}
            onChangeText={setTextValue}
            onSubmitEditing={applyTextVisual}
            placeholder={t('visualPicker.textPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            style={[styles.textInput, selectedVisual.type === 'text' && styles.selectedInput]}
            value={textValue}
          />
        </View>

        <Pressable
          accessibilityLabel={t('a11y.openIconList')}
          accessibilityRole="button"
          accessibilityState={{ expanded: iconsOpen }}
          onPress={() => setIconsOpen((currentValue) => !currentValue)}
          style={({ pressed }) => [
            styles.iconMenuButton,
            (iconsOpen || selectedVisual.type === 'icon') && styles.iconMenuButtonSelected,
            pressed && styles.pressed,
          ]}>
          <Ionicons name="ellipsis-horizontal" size={25} color={colors.textSecondary} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={applyTextVisual}
          style={({ pressed }) => [styles.applyButton, pressed && styles.pressed]}>
          <Text style={styles.applyButtonText}>{t('components.apply')}</Text>
        </Pressable>
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
                    color={isSelected ? colors.onPrimary : colors.primaryIcon}
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { gap: 10 },
    mainRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 7 },
    galleryButton: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.primary,
      borderRadius: 6,
      borderWidth: 2,
      height: 48,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 48,
    },
    selectedControl: { backgroundColor: colors.primarySoft },
    textArea: { flex: 1, gap: 4, minWidth: 92 },
    textLabel: { color: colors.text, fontSize: 9, fontWeight: '500' },
    textInput: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderRadius: 5,
      borderWidth: 1,
      color: colors.text,
      fontSize: 12,
      height: 38,
      paddingHorizontal: 9,
      paddingVertical: 0,
    },
    selectedInput: { borderColor: colors.primary },
    iconMenuButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: 7,
      borderWidth: 1,
      height: 41,
      justifyContent: 'center',
      width: 43,
    },
    iconMenuButtonSelected: { backgroundColor: colors.border, borderColor: colors.textTertiary },
    applyButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      height: 41,
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    applyButtonText: { color: colors.onPrimary, fontSize: 11, fontWeight: '600' },
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
    iconOptionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    pressed: { opacity: 0.7 },
  });
}
