import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Layout, ThemeColors } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { isVerticalEdge, MascotEdge } from '@/types/mascot';

export const BUBBLE_MAX_WIDTH = 188;
export const BUBBLE_GAP = 8;

type Props = {
  /** Maskotun yaslandığı kenar; balon her zaman ekranın içine doğru açılır. */
  edge: MascotEdge;
  /**
   * Üst/alt kenarda balonun maskot kutusuna göre yatay kayması. Çağıran taraf
   * bunu güvenli alan içinde kalacak biçimde hesaplar; böylece maskot kenarın
   * ucuna yakınken bile balon ekran dışına taşmaz. left/right kenarda 0'dır.
   */
  horizontalOffset?: number;
  /** Verilmezse Aşama 1'in varsayılan dokunma mesajı gösterilir. */
  message?: string;
  onPressCta: () => void;
  /** Kutlama balonunda AI Koç CTA'sı bulunmaz. */
  showCta?: boolean;
};

/**
 * Kompakt konuşma balonu. Yalnızca görünür alanı dokunma yakalar; çevresindeki
 * saydam bölge `box-none` sayesinde alttaki ekranın butonlarını engellemez.
 *
 * Balon maskotun kenar/düşünme/tepki dönüş katmanlarının **dışında** render
 * edilir, bu yüzden hiçbir kenarda yazı dönmez.
 */
export function MascotSpeechBubble({
  edge,
  horizontalOffset = 0,
  message,
  onPressCta,
  showCta = true,
}: Props) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  const placement = isVerticalEdge(edge)
    ? // Maskot solda ise balon sağında, sağda ise solunda açılır.
      [edge === 'left' ? styles.bubbleRight : styles.bubbleLeft]
    : // Üst kenarda altında, alt kenarda üstünde; yatay konum dışarıdan gelir.
      [edge === 'top' ? styles.bubbleBelow : styles.bubbleAbove, { left: horizontalOffset }];

  return (
    <View style={[styles.bubble, ...placement]}>
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
    bubbleLeft: { right: '100%', marginRight: BUBBLE_GAP, top: 0 },
    bubbleRight: { left: '100%', marginLeft: BUBBLE_GAP, top: 0 },
    // Üst/alt kenarda genişlik sabittir: `horizontalOffset` bu genişliğe göre
    // hesaplandığı için balon her zaman güvenli alanın içinde kalır.
    bubbleBelow: { top: '100%', marginTop: BUBBLE_GAP, width: BUBBLE_MAX_WIDTH },
    bubbleAbove: { bottom: '100%', marginBottom: BUBBLE_GAP, width: BUBBLE_MAX_WIDTH },
    message: { color: colors.text, fontSize: 13, lineHeight: 18 },
    cta: { alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: 24 },
    ctaText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
