/**
 * Arkadaşlık arayüzüne **yerel** palet ve ölçüler.
 *
 * Yüzey ve metin renkleri (background, card, field, border, separator, text,
 * textSecondary, textTertiary, danger) TAMAMEN aktif uygulama temasından
 * (`useAppTheme().colors`) türetilir; böylece light, warmLight, system, softDark
 * ve dark temalarının hepsinde Friends ekranı uygulamanın geri kalanıyla aynı
 * yüzeyleri kullanır. Bu dosya artık kendi yüzey renklerini SABİTLEMEZ —
 * `ThemeColors` tek yüzey otoritesidir ve saf siyah/beyaz'a çakılan bir palet
 * kalmaz.
 *
 * Yalnızca Friends'e özel MOR vurgu bu dosyada yaşar: `accent` / `accentStrong`
 * / `onAccent`. Bu vurgu `useFeatureColor('friends', ...)` ile kullanıcı
 * seçimine devredilebilir; kullanıcı renk seçmediyse aşağıdaki mor varsayılan
 * kullanılır (global mavi tema DEĞİL).
 */
import { StyleSheet } from 'react-native';

import type { ThemeColors } from '@/constants/theme';
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

/**
 * Friends'e özel mor vurgunun tema başına varsayılanı. Bu YALNIZCA `accent`
 * ailesidir; hiçbir yüzey/metin rengi içermez (onları tema sağlar). Değerler
 * mevcut Friends vurgusuyla birebir aynıdır, böylece kullanıcı renk seçmediğinde
 * görünüm değişmez.
 */
type FriendsAccent = Pick<FriendsPalette, 'accent' | 'accentStrong' | 'onAccent'>;

const ACCENT_DARK: FriendsAccent = {
  accent: '#A472F0',
  accentStrong: '#7B3FF2',
  onAccent: '#FFFFFF',
};

const ACCENT_LIGHT: FriendsAccent = {
  accent: '#7A3FE0',
  accentStrong: '#6D28D9',
  onAccent: '#FFFFFF',
};

/**
 * Aktif tema yüzeylerinden Friends paletinin yüzey/metin katmanını kurar.
 *
 * `ThemeColors` tek yüzey otoritesidir: her Friends yüzeyi doğrudan bir tema
 * tokenına eşlenir. `field` (arama alanı / çerçeveli buton zemini) kartla
 * karışmaması için `surfaceMuted`'a bağlanır. Böylece light, warmLight, system,
 * softDark ve dark temalarının hepsi tek kaynaktan doğru görünür.
 */
function surfacesFromTheme(colors: ThemeColors): Omit<FriendsPalette, keyof FriendsAccent> {
  return {
    background: colors.background,
    card: colors.card,
    field: colors.surfaceMuted,
    border: colors.border,
    separator: colors.separator,
    text: colors.text,
    textSecondary: colors.textSecondary,
    textTertiary: colors.textTertiary,
    danger: colors.danger,
  };
}

/**
 * Sosyal ekranın paleti.
 *
 * Yüzey/metin renkleri aktif temadan (`useAppTheme().colors`) gelir; yalnızca
 * `accent` ailesi Friends'e özeldir ve `useFeatureColor('friends', ...)` ile
 * kullanıcı tercihine devredilebilir. Kullanıcı renk seçmediyse tema mor
 * varsayılanı kullanılır.
 */
export function useFriendsPalette(): FriendsPalette {
  const { colors, isDark } = useAppTheme();
  const accentBase = isDark ? ACCENT_DARK : ACCENT_LIGHT;
  const base: FriendsPalette = { ...accentBase, ...surfacesFromTheme(colors) };
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
