/**
 * Referanstaki üç sekme: İstekler · Arkadaşlar · Öneriler.
 *
 * Sekmeler sola hizalıdır ve mor alt çizgi **etiket genişliği** kadardır —
 * eşit üçe bölünmüş bir sekme çubuğu değildir. `İstekler` etiketinin yanındaki
 * mor badge bekleyen istek sayısını gösterir; sıfırsa hiç çizilmez.
 */
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FriendsMetrics, useFriendsPalette } from '@/components/friends/friends-theme';

export type FriendsTabKey = 'requests' | 'friends' | 'suggestions';

export type FriendsTabItem = {
  badge?: number;
  key: FriendsTabKey;
  label: string;
};

type FriendsTabsProps = {
  items: readonly FriendsTabItem[];
  onSelect: (key: FriendsTabKey) => void;
  selected: FriendsTabKey;
};

export function FriendsTabs({ items, onSelect, selected }: FriendsTabsProps) {
  const palette = useFriendsPalette();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          borderBottomColor: palette.separator,
          borderBottomWidth: FriendsMetrics.hairline,
        },
        // Dar ekranlarda (375 pt) etiketler kesilmek yerine yatay kayar.
        content: { flexDirection: 'row', gap: 22, paddingHorizontal: FriendsMetrics.screenPadding },
        tab: { paddingTop: 14 },
        labelRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
        label: { color: palette.textTertiary, fontSize: 14, fontWeight: '500' },
        labelSelected: { color: palette.text, fontWeight: '600' },
        badge: {
          alignItems: 'center',
          backgroundColor: palette.accent,
          borderRadius: 9,
          height: 18,
          justifyContent: 'center',
          minWidth: 18,
          paddingHorizontal: 5,
        },
        badgeText: { color: palette.onAccent, fontSize: 11, fontWeight: '700' },
        indicator: { height: 2, marginTop: 10, width: '100%' },
        indicatorSelected: { backgroundColor: palette.accent },
      }),
    [palette],
  );

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {items.map((item) => {
          const isSelected = item.key === selected;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              hitSlop={{ bottom: 8, left: 6, right: 6, top: 8 }}
              key={item.key}
              onPress={() => onSelect(item.key)}
              style={styles.tab}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, isSelected && styles.labelSelected]}>{item.label}</Text>
                {Boolean(item.badge) && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.badge}</Text>
                  </View>
                )}
              </View>
              <View style={[styles.indicator, isSelected && styles.indicatorSelected]} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
