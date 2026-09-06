import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Layout } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * GÜVENLİ GERİ — tek kaynak.
 *
 * `router.canGoBack()` doğruysa `router.back()`, değilse verilen `fallback`
 * rotasına `router.replace` yapar → ekran hiçbir durumda takılı kalmaz. Hızlı
 * çift dokunma İKİ navigation üretmez: kısa bir kilit, ikinci dokunuşu yutar ve
 * bir süre sonra kendini sıfırlar (sonraki meşru geri dokunuşu bloklamaz).
 */
export function useSafeBack(fallback: Href) {
  const navigatingRef = useRef(false);
  return useCallback(() => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
    setTimeout(() => {
      navigatingRef.current = false;
    }, 500);
  }, [fallback]);
}

/**
 * Görünür, tema uyumlu, en az 44×44 pt geri düğmesi. Native otomatik geri
 * düğmesine güvenmek yerine ekranda AÇIKÇA `headerLeft` olarak kullanılır. Native
 * geri kaydırma hareketi (native-stack) etkilenmez.
 */
export function HeaderBackButton({
  accessibilityLabel,
  fallback,
  tintColor,
}: {
  accessibilityLabel: string;
  fallback: Href;
  tintColor?: string;
}) {
  const { colors } = useAppTheme();
  const onPress = useSafeBack(fallback);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Ionicons color={tintColor ?? colors.text} name="chevron-back" size={26} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    height: Layout.minTouchSize,
    justifyContent: 'center',
    // Sol kenarda başlık alanına hizalı; en az 44×44 pt dokunma.
    width: Layout.minTouchSize,
  },
  pressed: { opacity: 0.6 },
});
