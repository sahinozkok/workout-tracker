/**
 * Arkadaşlık listelerinin ortak avatarı.
 *
 * Gerçek profil fotoğrafı varsa o gösterilir; yoksa referanstaki gibi renkli
 * bir daire içinde baş harf gösterilir. Renk kullanıcı kimliğinden türer,
 * yani uydurulmuş bir kullanıcı verisi değildir.
 */
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FriendsMetrics, useAvatarTone, useFriendsPalette } from '@/components/friends/friends-theme';

type FriendAvatarProps = {
  avatarUrl?: string;
  displayName: string;
  /** Renk tohumu — kullanıcı kimliği. */
  id: string;
  size?: number;
};

export function FriendAvatar({
  avatarUrl,
  displayName,
  id,
  size = FriendsMetrics.avatarSize,
}: FriendAvatarProps) {
  const palette = useFriendsPalette();
  const tone = useAvatarTone(id);
  // Türkçe'de 'i' → 'İ' olduğu için baş harf yerel kurallarla büyütülür.
  const initial = displayName.trim().charAt(0).toLocaleUpperCase('tr-TR') || '?';

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          alignItems: 'center',
          backgroundColor: tone,
          borderRadius: size / 2,
          height: size,
          justifyContent: 'center',
          overflow: 'hidden',
          width: size,
        },
        image: { height: '100%', width: '100%' },
        letter: {
          color: palette.onAccent,
          fontSize: Math.round(size * 0.4),
          fontWeight: '600',
        },
      }),
    [palette.onAccent, size, tone],
  );

  return (
    <View style={styles.root}>
      {avatarUrl ? (
        <Image contentFit="cover" source={{ uri: avatarUrl }} style={styles.image} />
      ) : (
        <Text style={styles.letter}>{initial}</Text>
      )}
    </View>
  );
}
