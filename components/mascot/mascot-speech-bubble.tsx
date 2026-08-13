import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MascotSide } from '@/types/mascot';

export const BUBBLE_MAX_WIDTH = 188;
export const BUBBLE_GAP = 8;

type Props = {
  /** Verilmezse Aşama 1'in varsayılan dokunma mesajı gösterilir. */
  message?: string;
  onPressCta: () => void;
  /** Kutlama balonunda AI Koç CTA'sı bulunmaz. */
  showCta?: boolean;
  /** Maskotun yaslandığı kenar; balon her zaman ekranın içine doğru açılır. */
  side: MascotSide;
};

/**
 * Kompakt konuşma balonu. Yalnızca görünür alanı dokunma yakalar; çevresindeki
 * saydam bölge `box-none` sayesinde alttaki ekranın butonlarını engellemez.
 */
export function MascotSpeechBubble({ message, onPressCta, showCta = true, side }: Props) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  return (
    <View style={[styles.bubble, side === 'right' ? styles.bubbleLeftOfMascot : styles.bubbleRightOfMascot]}>
      <Text style={styles.message}>{message ?? t('mascot.bubbleMessage')}</Text>
      {showCta && (
        <Pressable
          accessibilityLabel={t('mascot.bubbleCta')}
          accessibilityRole="button"
          hitSlop={6}
          onPress={onPressCta}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
          <Text style={styles.ctaText}>{t('mascot.bubbleCta')}</Text>
          <Ionicons name="arrow-forward" size={12} color={colors.primary} />
        </Pressable>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    bubble: {
      backgroundColor: colors.surface,
      borderColor: colors.separator,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 6,
      maxWidth: BUBBLE_MAX_WIDTH,
      paddingHorizontal: 12,
      paddingVertical: 10,
      position: 'absolute',
      // Koyu temada da kenarı belirgin kalsın diye yumuşak bir gölge.
      shadowColor: '#000000',
      shadowOffset: { height: 2, width: 0 },
      shadowOpacity: 0.18,
      shadowRadius: 8,
      elevation: 4,
    },
    /** Maskot sağ kenardaysa balon solunda açılır. */
    bubbleLeftOfMascot: { right: '100%', marginRight: BUBBLE_GAP },
    /** Maskot sol kenardaysa balon sağında açılır. */
    bubbleRightOfMascot: { left: '100%', marginLeft: BUBBLE_GAP },
    message: { color: colors.text, fontSize: 13, lineHeight: 18 },
    cta: { alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: 24 },
    ctaText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
