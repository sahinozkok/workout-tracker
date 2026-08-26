/**
 * Arkadaşlık arayüzüne **yerel** palet ve ölçüler.
 *
 * Referans tasarım mor vurgulu ve neredeyse saf siyah zeminlidir; uygulamanın
 * global teması ise mavi vurguludur. Bu yüzden `constants/theme.ts` HİÇ
 * değiştirilmez — mor vurgu yalnızca bu dosyayı içe aktaran arkadaşlık
 * ekranlarında yaşar. Diğer bütün ekranlar global temada kalır.
 *
 * Açık temada aynı yerleşim, kontrastı korunmuş açık yüzeylerle kurulur:
 * referans koyu temayı birebir hedefler, açık tema okunabilirliği hedefler.
 */
import { StyleSheet } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';

export type FriendsPalette = {
  /** Mor vurgu: seçili sekme çizgisi, Ekle/Kabul et butonları, badge. */
  accent: string;
  /** Profil kartındaki ikon kutusunun daha doygun moru. */
  accentStrong: string;
  /** Mor üzerindeki metin/ikon. */
  onAccent: string;
  background: string;
  /** Kart ve arama sonucu yüzeyi. */
  card: string;
  /** Arama alanı ve çerçeveli buton zemini. */
  field: string;
  /** Görünür çerçeve (arama alanı, ikincil buton). */
  border: string;
  /** Satır ayırıcısı — çerçeveden daha düşük kontrastlı. */
  separator: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  danger: string;
};

/** Referans görselden alınan koyu tema değerleri. */
const DARK: FriendsPalette = {
  accent: '#A472F0',
  accentStrong: '#7B3FF2',
  onAccent: '#FFFFFF',
  background: '#000000',
  card: '#141416',
  field: '#141416',
  border: '#242427',
  separator: '#1C1C1F',
  text: '#FFFFFF',
  textSecondary: '#9A9AA0',
  textTertiary: '#6E6E74',
  danger: '#FF453A',
};

/** Aynı yerleşimin açık tema karşılığı; mor vurgu kontrast için koyulaşır. */
const LIGHT: FriendsPalette = {
  accent: '#7A3FE0',
  accentStrong: '#6D28D9',
  onAccent: '#FFFFFF',
  background: '#FFFFFF',
  card: '#F5F5F7',
  field: '#F2F2F6',
  border: '#DEDEE3',
  separator: '#E4E4E9',
  text: '#0B0B0C',
  textSecondary: '#5E5E63',
  textTertiary: '#8A8A90',
  danger: '#D6291E',
};

/**
 * Sosyal ekranın paleti.
 *
 * YALNIZCA semantik `accent` (ve ona bağlı `accentStrong` / `onAccent`)
 * kullanıcı tercihinden beslenir. Yüzey, kart, ayırıcı, metin ve `danger`
 * renkleri BU DOSYADAKİ değerlerden gelmeye devam eder — genel yüzey sistemi
 * bozulmaz. Kullanıcı renk seçmediyse palet birebir bugünkü hâlidir.
 */
export function useFriendsPalette(): FriendsPalette {
  const { isDark } = useAppTheme();
  const base = isDark ? DARK : LIGHT;
  const friendsAccent = useFeatureColor('friends', base.accent);

  if (!friendsAccent.isCustom) return base;

  return {
    ...base,
    accent: friendsAccent.color,
    // Basılı/vurgulu durum için aynı renk kullanılır; ayrı bir ton üretilmez.
    accentStrong: friendsAccent.color,
    onAccent: friendsAccent.onColor,
  };
}

/**
 * Referanstan ölçülen yerleşim değerleri (yaklaşık 393 pt genişlik içindir).
 * Global `Layout` değiştirilmediği için bu ölçüler yalnızca burada geçerlidir.
 */
export const FriendsMetrics = {
  screenPadding: 16,
  headerHeight: 44,
  searchHeight: 44,
  searchRadius: 12,
  rowMinHeight: 64,
  avatarSize: 42,
  /** Arama sonucu kartındaki avatar bir tık küçüktür. */
  avatarSizeCompact: 38,
  cardRadius: 14,
  pillRadius: 10,
  /** Dokunma hedefi hiçbir yerde bunun altına inmez (hitSlop ile tamamlanır). */
  minTouchSize: 44,
  hairline: StyleSheet.hairlineWidth,
};

/**
 * Profil fotoğrafı olmayan kullanıcıların baş harf dairesi.
 *
 * Renk kullanıcı **kimliğinden** türetilir: aynı kişi her ekranda aynı rengi
 * alır. Bu bir kullanıcı verisi değil, yalnızca deterministik bir görsel
 * ayırt ediciliktir — referanstaki renkli avatarların karşılığıdır.
 */
const AVATAR_TONES_DARK = ['#B03A38', '#1C7A72', '#5B3FA8', '#A9701F', '#2C7B4C', '#33559E'];
const AVATAR_TONES_LIGHT = ['#C24B48', '#158B80', '#6D4BC4', '#B87C22', '#2F8A55', '#3C63B4'];

export function useAvatarTone(seed: string): string {
  const { isDark } = useAppTheme();
  const tones = isDark ? AVATAR_TONES_DARK : AVATAR_TONES_LIGHT;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100003;
  }
  return tones[hash % tones.length];
}
