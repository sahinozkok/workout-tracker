import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Layout, ThemeColors } from '@/constants/theme';
import { WorkoutTrackingMode } from '@/types/workout';

/**
 * TAKİP BİÇİMİ SEÇİCİ — compact segmented control.
 *
 * Erişilebilirlik kararları:
 *   * Seçili durum YALNIZCA renkle anlatılmaz; kenarlık kalınlaşır, ikon dolu
 *     varyanta geçer ve metin ağırlığı artar. Renk körlüğünde de okunur.
 *   * Her segment `Layout.minTouchSize` (44 pt) yüksekliğindedir.
 *   * `accessibilityRole="radio"` + `accessibilityState.selected` ile VoiceOver
 *     grubu tek bir seçim kümesi olarak okur.
 *
 * Yeni paket, asset, gradient veya emoji YOKTUR; mevcut tema tokenları ve
 * Ionicons kullanılır.
 */

type Option = {
  mode: WorkoutTrackingMode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
};

const OPTIONS: readonly Option[] = [
  { mode: 'sets_reps', label: 'sets_reps', icon: 'barbell-outline', iconActive: 'barbell' },
  { mode: 'duration', label: 'duration', icon: 'time-outline', iconActive: 'time' },
  { mode: 'distance', label: 'distance', icon: 'walk-outline', iconActive: 'walk' },
];

type Props = {
  colors: ThemeColors;
  disabled?: boolean;
  /** Devre dışı bırakılma nedeni; doluysa alanın altında gösterilir. */
  disabledHint?: string;
  labels: Record<WorkoutTrackingMode, string>;
  onChange: (mode: WorkoutTrackingMode) => void;
  title: string;
  value: WorkoutTrackingMode;
};

export function TrackingModeSelector({
  colors,
  disabled = false,
  disabledHint,
  labels,
  onChange,
  title,
  value,
}: Props) {
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View accessibilityRole="radiogroup" style={styles.row}>
        {OPTIONS.map((option) => {
          const isSelected = option.mode === value;
          return (
            <Pressable
              accessibilityHint={disabled ? disabledHint : undefined}
              accessibilityLabel={labels[option.mode]}
              accessibilityRole="radio"
              accessibilityState={{ disabled, selected: isSelected }}
              disabled={disabled}
              key={option.mode}
              onPress={() => onChange(option.mode)}
              style={({ pressed }) => [
                styles.segment,
                isSelected && styles.segmentSelected,
                disabled && styles.segmentDisabled,
                pressed && !disabled && styles.pressed,
              ]}>
              <Ionicons
                color={isSelected ? colors.primary : colors.textSecondary}
                name={isSelected ? option.iconActive : option.icon}
                size={16}
              />
              <Text
                numberOfLines={1}
                style={[styles.segmentText, isSelected && styles.segmentTextSelected]}>
                {labels[option.mode]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {disabled && disabledHint ? <Text style={styles.hint}>{disabledHint}</Text> : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { gap: 8 },
    title: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    row: { flexDirection: 'row', gap: 8 },
    segment: {
      alignItems: 'center',
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusMedium,
      borderWidth: Layout.hairline,
      flex: 1,
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 8,
    },
    // Seçili durum: kalın kenarlık + dolu ikon + kalın metin. Renk TEK sinyal değil.
    segmentSelected: { borderColor: colors.primary, borderWidth: 2 },
    segmentDisabled: { opacity: 0.5 },
    pressed: { opacity: 0.7 },
    segmentText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
    segmentTextSelected: { color: colors.text, fontWeight: '700' },
    hint: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  });
}
