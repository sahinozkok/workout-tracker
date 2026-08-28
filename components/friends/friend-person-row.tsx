/**
 * Referanstaki kişi satırı: solda avatar, ortada isim + kullanıcı adı, sağda
 * eyleme özel alan.
 *
 * Sağdaki `actions` yuvası çağırana aittir: kabul edilmiş arkadaş satırında
 * sohbet balonu ve üç nokta oraya yerleşir. Bu bileşen hiçbir eylemi kendisi
 * KARARLAŞTIRMAZ, bu yüzden arama sonuçları ve istek satırları mesaj butonu
 * ALMAZ. Satırda yalnızca gerçek veri gösterilir; "ortak arkadaş" veya
 * "çevrimiçi" gibi alanlar üretilmez.
 */
import { ReactNode, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FriendAvatar } from '@/components/friends/friend-avatar';
import { FriendsMetrics, useFriendsPalette } from '@/components/friends/friends-theme';

export type FriendPerson = {
  avatarUrl?: string;
  displayName: string;
  id: string;
  username?: string;
};

type FriendPersonRowProps = {
  /** Sağdaki eylem alanı (üç nokta, Kabul et/Reddet, Ekle …). */
  actions?: ReactNode;
  avatarSize?: number;
  /** `true` → kart görünümü (arama sonuçları); `false` → ayırıcılı liste satırı. */
  card?: boolean;
  /** Satırın son öğesinde alt ayırıcı çizilmez. */
  isLast?: boolean;
  onPress?: () => void;
  person: FriendPerson;
  /** Kullanıcı adı yoksa gösterilecek yedek metin. */
  usernameFallback: string;
};

export function FriendPersonRow({
  actions,
  avatarSize,
  card = false,
  isLast = false,
  onPress,
  person,
  usernameFallback,
}: FriendPersonRowProps) {
  const palette = useFriendsPalette();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          alignItems: 'center',
          flexDirection: 'row',
          gap: 12,
          minHeight: FriendsMetrics.rowMinHeight,
          paddingHorizontal: FriendsMetrics.screenPadding,
        },
        card: {
          backgroundColor: palette.card,
          borderRadius: FriendsMetrics.cardRadius,
          marginHorizontal: FriendsMetrics.screenPadding,
          minHeight: 60,
          paddingHorizontal: 12,
        },
        divider: {
          borderBottomColor: palette.separator,
          borderBottomWidth: FriendsMetrics.hairline,
        },
        main: {
          alignItems: 'center',
          flex: 1,
          flexDirection: 'row',
          gap: 12,
          minHeight: FriendsMetrics.rowMinHeight,
        },
        mainCard: { minHeight: 60 },
        text: { flex: 1, gap: 2 },
        name: { color: palette.text, fontSize: 15, fontWeight: '600' },
        username: { color: palette.textTertiary, fontSize: 13 },
        actions: { alignItems: 'center', flexDirection: 'row', gap: 8 },
        pressed: { opacity: 0.6 },
      }),
    [palette],
  );

  return (
    <View style={[styles.root, card ? styles.card : !isLast && styles.divider]}>
      <Pressable
        accessibilityRole={onPress ? 'button' : undefined}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [
          styles.main,
          card && styles.mainCard,
          pressed && Boolean(onPress) && styles.pressed,
        ]}>
        <FriendAvatar
          avatarUrl={person.avatarUrl}
          displayName={person.displayName}
          id={person.id}
          size={avatarSize}
        />
        <View style={styles.text}>
          <Text numberOfLines={1} style={styles.name}>
            {person.displayName}
          </Text>
          <Text numberOfLines={1} style={styles.username}>
            {person.username ? `@${person.username}` : usernameFallback}
          </Text>
        </View>
      </Pressable>
      {Boolean(actions) && <View style={styles.actions}>{actions}</View>}
    </View>
  );
}
