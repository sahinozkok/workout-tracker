import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TimePickerProps } from '@/components/time-picker.types';
import { Layout, ThemeColors } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * WEB saat/dakika fallback'i — native picker importu içermez, aynı prop
 * sözleşmesini uygular. Sınırlarda döner (0↔23, 0↔59). Web hedef platform
 * değildir; amaç web export'un ve tip güvenliğinin bozulmamasıdır.
 */
export default function TimePicker({ hour, minute, onChange }: TimePickerProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const wrap = (value: number, max: number) => (value + (max + 1)) % (max + 1);

  return (
    <View style={styles.container}>
      <Stepper
        colors={colors}
        label="Saat"
        onDecrement={() => onChange(wrap(hour - 1, 23), minute)}
        onIncrement={() => onChange(wrap(hour + 1, 23), minute)}
        styles={styles}
        value={hour}
      />
      <Text style={styles.separator}>:</Text>
      <Stepper
        colors={colors}
        label="Dakika"
        onDecrement={() => onChange(hour, wrap(minute - 1, 59))}
        onIncrement={() => onChange(hour, wrap(minute + 1, 59))}
        styles={styles}
        value={minute}
      />
    </View>
  );
}

function Stepper({
  colors,
  label,
  onDecrement,
  onIncrement,
  styles,
  value,
}: {
  colors: ThemeColors;
  label: string;
  onDecrement: () => void;
  onIncrement: () => void;
  styles: ReturnType<typeof createStyles>;
  value: number;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityLabel={`${label} +`}
        accessibilityRole="button"
        onPress={onIncrement}
        style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}>
        <Ionicons color={colors.text} name="chevron-up" size={20} />
      </Pressable>
      <Text style={styles.value}>{String(value).padStart(2, '0')}</Text>
      <Pressable
        accessibilityLabel={`${label} -`}
        accessibilityRole="button"
        onPress={onDecrement}
        style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}>
        <Ionicons color={colors.text} name="chevron-down" size={20} />
      </Pressable>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'center' },
    stepper: { alignItems: 'center', gap: 4 },
    stepButton: {
      alignItems: 'center',
      height: Layout.minTouchSize,
      justifyContent: 'center',
      width: Layout.minTouchSize,
    },
    value: {
      color: colors.text,
      fontSize: 34,
      fontVariant: ['tabular-nums'],
      fontWeight: '300',
      minWidth: 52,
      textAlign: 'center',
    },
    separator: { color: colors.textSecondary, fontSize: 34, fontWeight: '300' },
    pressed: { opacity: 0.6 },
  });
}
