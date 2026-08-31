import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Tabs } from 'expo-router';
import { PropsWithChildren, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getOnAccentColor } from '@/constants/color-presets';
import {
  MotionDuration,
  MotionEasing,
  MotionScale,
  TAB_TRANSITION_SPEC,
} from '@/constants/motion';
import { Layout } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';

const coachMascotSource = require('../../assets/images/ai-coach-mascot.png');

/**
 * Dört standart sekme ikonunun ORTAK optik boyutu. Ionicons ailesi tek çizgi
 * kalınlığında çizildiği için her ikon aynı pikselde tutarlı görünür; eski
 * Feather'daki -1/-2 düzeltmelerine gerek kalmaz.
 */
const TAB_ICON_SIZE = 24;

/**
 * Sekme ikonu seçildiğinde küçük bir ölçek geri bildirimi verir.
 *
 * ÖNEMLİ: yalnızca SEÇİLME ANINDA `0.92 → 1` oynatılır. Seçili olmayan ikonlar
 * 1 ölçekte durur, yani hiçbir ikonun kalıcı boyutu değişmez. Renk, tür, konum
 * ve tab bar yüksekliği bu bileşenden etkilenmez; ikon `children` olarak
 * olduğu gibi geçirilir (Rosea'nın özel görseli dahil).
 *
 * Reduce Motion açıkken animasyon oynatılmaz; ikon doğrudan son hâlinde kalır.
 */
function TabIconFeedback({ children, focused }: PropsWithChildren<{ focused: boolean }>) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!focused || reduceMotion) {
      scale.value = 1;
      return;
    }

    scale.value = MotionScale.tabIconSelect;
    scale.value = withTiming(1, {
      duration: MotionDuration.fast,
      easing: MotionEasing.standard,
    });
  }, [focused, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

export default function TabLayout() {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Görünür sekme içeriği için temel yükseklik + cihazın gerçek alt güvenli
  // alanı. Home indicator olmayan cihazlarda insets.bottom 0 olduğu için
  // fazladan boşluk oluşmaz.
  const todayColor = useFeatureColor('todayHighlight', colors.tabIconSelected).color;
  const tabBarHeight = Layout.tabBarHeight + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        /**
         * Sakin çapraz geçiş. `fade` YALNIZCA opaklık değiştirir; ekranlar
         * yatay olarak kaymaz ve React Navigation kendi geçişini kullandığı
         * için ekran bileşenleri YENİDEN MOUNT EDİLMEZ — sekme state'i, scroll
         * konumu ve form değerleri korunur, veri tekrar çekilmez.
         *
         * Reduce Motion açıkken de `fade` bırakıldı: içinde konum değişimi
         * yoktur, yalnızca opaklıktır ve "sade fade" beklentisini karşılar.
         */
        animation: 'fade',
        transitionSpec: TAB_TRANSITION_SPEC,
        sceneStyle: { backgroundColor: colors.background },
        // Seçili sekme ikonu. Seçilmemiş ikon rengi DEĞİŞMEZ.
        tabBarActiveTintColor: todayColor,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarShowLabel: false,
        tabBarItemStyle: { paddingTop: 8 },
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.separator,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
          height: tabBarHeight,
          paddingBottom: insets.bottom,
          paddingTop: 4,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, focused, size }) => (
            <TabIconFeedback focused={focused}>
              <Ionicons name={focused ? 'home' : 'home-outline'} size={size ?? TAB_ICON_SIZE} color={color} />
            </TabIconFeedback>
          ),
        }}
      />
      <Tabs.Screen
        name="programs"
        options={{
          title: t('tabs.programs'),
          tabBarIcon: ({ color, focused, size }) => (
            <TabIconFeedback focused={focused}>
              <Ionicons name={focused ? 'barbell' : 'barbell-outline'} size={size ?? TAB_ICON_SIZE} color={color} />
            </TabIconFeedback>
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('tabs.history'),
          tabBarIcon: ({ color, focused, size }) => (
            <TabIconFeedback focused={focused}>
              <Ionicons name={focused ? 'time' : 'time-outline'} size={size ?? TAB_ICON_SIZE} color={color} />
            </TabIconFeedback>
          ),
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: t('tabs.coach'),
          tabBarIcon: ({ color, focused, size }) => (
            <TabIconFeedback focused={focused}>
              {focused ? (
                /**
                 * SEÇİLİ Rosea. Diğer sekmelerin seçili DOLU Ionicons ikonlarıyla
                 * optik olarak uyumlu olması için maskot, aktif sekme rengiyle
                 * (`color`) TAMAMEN DOLU, kompakt bir madalyona oturur. Madalyon
                 * mevcut 42 pt Rosea kutusundan daha dardır; "ayrı büyük buton"
                 * gibi durmaz ve tab bar yüksekliği/ritmi değişmez.
                 *
                 * Rosea görseli/asset'i DEĞİŞMEDİ; yalnızca seçili zemin eklendi.
                 * Maskot, dolu zeminde açık ve koyu temada net kontrastla
                 * görünmesi için mevcut `getOnAccentColor` ile on-accent renge
                 * boyanır (aksi hâlde accent üstünde accent tint kaybolurdu).
                 */
                <View style={[styles.coachMedallion, { backgroundColor: color }]}>
                  <Image
                    contentFit="contain"
                    source={coachMascotSource}
                    style={styles.coachMascotSelected}
                    tintColor={getOnAccentColor(color)}
                  />
                </View>
              ) : (
                /* SEÇİLMEMİŞ Rosea görünümü MEVCUT hâliyle korunur. */
                <Image
                  contentFit="cover"
                  source={coachMascotSource}
                  style={{ height: (size ?? 24) + 6, width: (size ?? 24) + 18 }}
                  tintColor={colors.icon}
                />
              )}
            </TabIconFeedback>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, focused, size }) => (
            <TabIconFeedback focused={focused}>
              <Ionicons name={focused ? 'person' : 'person-outline'} size={size ?? TAB_ICON_SIZE} color={color} />
            </TabIconFeedback>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  /**
   * SEÇİLİ Rosea madalyonu. Kompakt bir daire (34 pt): standart 24 pt filled
   * ikonların optik ağırlığına yakın, mevcut mascot kutusundan (30×42) daha
   * geniş değil. Zemin rengi çağıran tarafından aktif sekme rengiyle inline
   * verilir; burada yeni renk sabiti yoktur. `radiusPill` ile tam daire.
   */
  coachMedallion: {
    alignItems: 'center',
    borderRadius: Layout.radiusPill,
    height: TAB_ICON_SIZE + 10,
    justifyContent: 'center',
    overflow: 'hidden',
    width: TAB_ICON_SIZE + 10,
  },
  /** Maskot dolu madalyonda tamamen görünür; oranı korunur (`contain`). */
  coachMascotSelected: {
    height: TAB_ICON_SIZE - 2,
    width: TAB_ICON_SIZE + 6,
  },
});
