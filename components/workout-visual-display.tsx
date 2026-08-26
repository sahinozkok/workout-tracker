import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, Text } from 'react-native';

import { WorkoutVisual } from '@/types/workout';

type WorkoutVisualDisplayProps = {
  color: string;
  /**
   * Yalnızca HAZIR (vector) ikonun rengi. Verilmezse `color` kullanılır.
   *
   * Ayrı tutulur çünkü emoji/sayı görsellerinin (`type: 'text'`) doğal
   * görünümü DEĞİŞMEMELİDİR; onlar `color` ile çizilmeye devam eder.
   * `type: 'image'` zaten hiç tint almaz (geriye dönük uyumluluk).
   */
  iconColor?: string;
  size?: number;
  visual: WorkoutVisual;
};

export function WorkoutVisualDisplay({ color, iconColor, size = 24, visual }: WorkoutVisualDisplayProps) {
  if (visual.type === 'image') {
    return (
      <Image
        contentFit="cover"
        source={{ uri: visual.uri }}
        style={{ borderRadius: Math.max(6, size * 0.25), height: size, width: size }}
      />
    );
  }

  if (visual.type === 'text') {
    return (
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        style={[styles.textVisual, { color, fontSize: size * 0.65, lineHeight: size }]}>
        {visual.text}
      </Text>
    );
  }

  return <Ionicons color={iconColor ?? color} name={visual.icon} size={size} />;
}

const styles = StyleSheet.create({
  textVisual: { fontWeight: '600', maxWidth: 46, minWidth: 24, textAlign: 'center' },
});
