/**
 * Referanstaki boş durum kartı: ortalanmış koyu kart, yuvarlak ikon alanı,
 * başlık, açıklama ve mor eylem butonu.
 *
 * Yalnızca gerçekten veri yokken gösterilir; yükleme ve hata durumları
 * çağıran ekranda ayrı ayrı ele alınır.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FriendsMetrics, useFriendsPalette } from '@/components/friends/friends-theme';

type FriendsEmptyStateProps = {
  buttonLabel?: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  title: string;
};

export function FriendsEmptyState({
  buttonLabel,
  description,
  icon,
  onPress,
  title,
}: FriendsEmptyStateProps) {
  const palette = useFriendsPalette();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          alignItems: 'center',
          backgroundColor: palette.card,
          borderRadius: 18,
          gap: 6,
          marginHorizontal: FriendsMetrics.screenPadding,
          marginTop: 28,
          paddingHorizontal: 24,
          paddingVertical: 28,
        },
        iconWrap: {
          alignItems: 'center',
          backgroundColor: palette.field,
          borderColor: palette.border,
          borderRadius: 28,
          borderWidth: FriendsMetrics.hairline,
          height: 56,
          justifyContent: 'center',
          marginBottom: 10,
          width: 56,
        },
        title: { color: palette.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
        description: {
          color: palette.textSecondary,
          fontSize: 13,
          lineHeight: 19,
          textAlign: 'center',
        },
        button: {
          alignItems: 'center',
          backgroundColor: palette.accent,
          borderRadius: FriendsMetrics.pillRadius,
          justifyContent: 'center',
          marginTop: 14,
          minHeight: FriendsMetrics.minTouchSize,
          paddingHorizontal: 22,
        },
        buttonText: { color: palette.onAccent, fontSize: 14, fontWeight: '600' },
        pressed: { opacity: 0.6 },
      }),
    [palette],
  );

  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Ionicons color={palette.textSecondary} name={icon} size={24} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {Boolean(buttonLabel) && Boolean(onPress) && (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>{buttonLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
