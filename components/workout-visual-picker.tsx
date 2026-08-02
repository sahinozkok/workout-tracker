import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PROGRAM_ICON_OPTIONS } from '@/constants/program-icons';
import { ThemeColors } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { WorkoutVisual } from '@/types/workout';

type WorkoutVisualPickerProps = {
  onSelect: (visual: WorkoutVisual) => void;
  selectedVisual: WorkoutVisual;
};

export function WorkoutVisualPicker({ onSelect, selectedVisual }: WorkoutVisualPickerProps) {
  const { colors, isDark } = useAppTheme();
  const styles = createStyles(colors);
  const [textValue, setTextValue] = useState(selectedVisual.type === 'text' ? selectedVisual.text : '');

  useEffect(() => {
    if (selectedVisual.type === 'text') setTextValue(selectedVisual.text);
  }, [selectedVisual]);

  function applyTextVisual() {
    const trimmedValue = Array.from(textValue.trim()).slice(0, 4).join('');
    if (!trimmedValue) {
      Alert.alert('Sayı veya emoji gerekli', 'Örneğin “1”, “A” veya “🔥” yazabilirsin.');
      return;
    }

    setTextValue(trimmedValue);
    onSelect({ type: 'text', text: trimmedValue });
  }

  async function pickImage() {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Galeri izni gerekli', 'Fotoğraf seçebilmek için galeri erişimine izin vermelisin.');
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
      onSelect({ type: 'image', uri: result.assets[0].uri });
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>İkon seç</Text>
        <ScrollView
          contentContainerStyle={styles.iconOptions}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {PROGRAM_ICON_OPTIONS.map((option) => {
            const isSelected = selectedVisual.type === 'icon' && selectedVisual.icon === option.icon;

            return (
              <Pressable
                accessibilityLabel={`${option.label} simgesi`}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                key={option.icon}
                onPress={() => onSelect({ type: 'icon', icon: option.icon })}
                style={({ pressed }) => [
                  styles.iconOption,
                  isSelected && styles.iconOptionSelected,
                  pressed && styles.pressed,
                ]}>
                <Ionicons name={option.icon} size={23} color={isSelected ? colors.onPrimary : colors.primaryIcon} />
                <Text style={[styles.iconLabel, isSelected && styles.iconLabelSelected]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Sayı veya emoji kullan</Text>
        <View style={styles.textRow}>
          <TextInput
            autoCorrect={false}
            keyboardAppearance={isDark ? 'dark' : 'light'}
            maxLength={8}
            onChangeText={setTextValue}
            onSubmitEditing={applyTextVisual}
            placeholder="Örn. 1 veya 🔥"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.primary}
            style={styles.textInput}
            value={textValue}
          />
          <Pressable
            accessibilityRole="button"
            onPress={applyTextVisual}
            style={({ pressed }) => [styles.applyButton, pressed && styles.pressed]}>
            <Text style={styles.applyButtonText}>Uygula</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={pickImage}
        style={({ pressed }) => [styles.galleryButton, pressed && styles.pressed]}>
        <Ionicons name="images-outline" size={21} color={colors.primaryIcon} />
        <View style={styles.galleryText}>
          <Text style={styles.galleryTitle}>Galeriden fotoğraf seç</Text>
          <Text style={styles.galleryCaption}>Fotoğraf kare olarak kırpılır.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { gap: 16 },
    section: { gap: 8 },
    sectionLabel: { color: colors.text, fontSize: 13, fontWeight: '800' },
    iconOptions: { gap: 8, paddingRight: 2 },
    iconOption: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderRadius: 11,
      borderWidth: 1,
      gap: 4,
      minWidth: 68,
      paddingHorizontal: 9,
      paddingVertical: 9,
    },
    iconOptionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    iconLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
    iconLabelSelected: { color: colors.onPrimary },
    textRow: { flexDirection: 'row', gap: 8 },
    textInput: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: 12,
      borderWidth: 1,
      color: colors.text,
      flex: 1,
      fontSize: 15,
      paddingHorizontal: 13,
      paddingVertical: 11,
    },
    applyButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 12,
      justifyContent: 'center',
      paddingHorizontal: 14,
    },
    applyButtonText: { color: colors.onPrimary, fontSize: 12, fontWeight: '800' },
    galleryButton: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderColor: colors.primarySoftBorder,
      borderRadius: 13,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      padding: 12,
    },
    galleryText: { flex: 1 },
    galleryTitle: { color: colors.primarySoftText, fontSize: 13, fontWeight: '800' },
    galleryCaption: { color: colors.primarySoftText, fontSize: 11, marginTop: 2, opacity: 0.8 },
    pressed: { opacity: 0.7 },
  });
}
