/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform, StyleSheet } from 'react-native';

const lightColors = {
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceMuted: '#F2F2F7',
    card: '#F2F2F7',
    text: '#000000',
    textSecondary: '#6C6C70',
    textTertiary: '#8E8E93',
    border: '#D8D8DC',
    separator: '#D8D8DC',
    inputBorder: '#D8D8DC',
    primary: '#007AFF',
    primaryStrong: '#0040DD',
    primaryIcon: '#007AFF',
    primarySoft: '#E5F0FF',
    primarySoftBorder: '#9EC8FF',
    primarySoftText: '#0058B8',
    accent: '#FF9500',
    accentBright: '#FF9500',
    accentSoft: '#FFF0DC',
    accentText: '#C25E00',
    onPrimary: '#FFFFFF',
    heroText: '#6C6C70',
    infoSurface: '#E5F0FF',
    infoText: '#0058B8',
    infoIcon: '#007AFF',
    danger: '#FF3B30',
    disciplineCompleted: '#34C759',
    disciplinePartial: '#FF9500',
    disciplineSkipped: '#C7C7CC',
    disciplineEmpty: '#E5E5EA',
    disciplineFuture: '#F2F2F7',
    /**
     * Profil disiplin kartının yıl ızgarasına ÖZEL boş/gelecek hücre renkleri.
     * Kartın zemini `surfaceMuted` olduğu için varsayılan `disciplineEmpty`
     * (koyu temada birebir aynı renk) hücreleri görünmez kılıyordu. Bu ikisi
     * yalnızca profil kartında kullanılır; Ana Sayfa takvimi varsayılanlarda
     * kalır.
     */
    profileCalendarEmpty: '#D3D3DA',
    profileCalendarFuture: '#E2E2E9',
    tint: '#007AFF',
    icon: '#8E8E93',
    tabIconDefault: '#8E8E93',
    tabIconSelected: '#007AFF',
};

const darkColors = {
    background: '#040404ff',
    surface: '#000000',
    surfaceMuted: '#1C1C1E',
    card: '#131315',
    text: '#ebe6e6ff',
    textSecondary: '#8E8E93',
    textTertiary: '#6A6A6E',
    border: '#242426',
    separator: '#242426',
    inputBorder: '#2C2C2E',
    primary: '#0A84FF',
    primaryStrong: '#0A84FF',
    primaryIcon: '#0A84FF',
    primarySoft: '#0E243F',
    primarySoftBorder: '#1E4B80',
    primarySoftText: '#9CC8FF',
    accent: '#FF9F0A',
    accentBright: '#FF9F0A',
    accentSoft: '#2A1B07',
    accentText: '#FF9F0A',
    onPrimary: '#FFFFFF',
    heroText: '#8E8E93',
    infoSurface: '#0E243F',
    infoText: '#9CC8FF',
    infoIcon: '#0A84FF',
    danger: '#FF453A',
    disciplineCompleted: '#30D158',
    disciplineSkipped: '#48484A',
    disciplinePartial: '#FF9F0A',
    disciplineEmpty: '#1C1C1E',
    disciplineFuture: '#0E0E10',
    /** Bkz. açık tema notu. Kart zemininden (#1C1C1E) belirgin biçimde koyu. */
    profileCalendarEmpty: '#060608',
    profileCalendarFuture: '#0C0C0E',
    tint: '#0A84FF',
    icon: '#8E8E93',
    tabIconDefault: '#6A6A6E',
    tabIconSelected: '#FFFFFF',
};

export const Colors = {
  light: lightColors,
  /** Saf beyaz yerine sıcak, düşük kontrastlı açık alternatif. */
  warmLight: {
    ...lightColors,
    background: '#FCE5CD',
    surface: '#FFF3E5',
    surfaceMuted: '#F2D4B7',
    card: '#F7DCC1',
    border: '#DDBB99',
    separator: '#DDBB99',
    inputBorder: '#D3AA84',
    disciplineEmpty: '#EBCBAD',
    disciplineFuture: '#F4D9BD',
    profileCalendarEmpty: '#DDBB9C',
    profileCalendarFuture: '#EACCAF',
  },
  dark: darkColors,
  /** Saf siyah yerine daha yumuşak, kömür tonlu koyu alternatif. */
  softDark: {
    ...darkColors,
    background: '#1B1B1B',
    surface: '#202020',
    surfaceMuted: '#2A2A2A',
    card: '#242424',
    border: '#3B3B3B',
    separator: '#343434',
    inputBorder: '#424242',
    disciplineEmpty: '#303030',
    disciplineFuture: '#252525',
    profileCalendarEmpty: '#121212',
    profileCalendarFuture: '#171717',
  },
};

export type ThemeColors = (typeof Colors)['light'];

/** Ortak yerleşim ölçüleri. Referans görüntüler 393 × 852 pt içindir. */
export const Layout = {
  screenPadding: 20,
  gutter: 16,
  hairline: StyleSheet.hairlineWidth,
  radiusSmall: 8,
  radiusMedium: 12,
  radiusLarge: 16,
  radiusPill: 999,
  tabBarHeight: 56,
  minTouchSize: 44,
};

/** Ekranlar arasında ortak yazı hiyerarşisi. */
export const Type = {
  /** Bölüm üstündeki küçük büyük harfli etiket. */
  eyebrow: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.6 },
  /** Büyük sayfa başlığı — referanslarda ince/regular ağırlıkta. */
  pageTitle: { fontSize: 32, fontWeight: '300' as const, letterSpacing: 0.2 },
  /** Bölüm başlığı. */
  sectionTitle: { fontSize: 20, fontWeight: '600' as const },
  /** Liste satırı başlığı. */
  rowTitle: { fontSize: 17, fontWeight: '500' as const },
  /** Gövde metni. */
  body: { fontSize: 15, fontWeight: '400' as const },
  /** İkincil bilgi. */
  caption: { fontSize: 13, fontWeight: '400' as const },
  /** En küçük ikincil bilgi. */
  footnote: { fontSize: 11, fontWeight: '400' as const },
};

/**
 * Düzenleme/form yüzeylerinin ORTAK ölçeği (Programı düzenle, Egzersizi
 * düzenle, Ayarlar).
 *
 * Ana Sayfa tipografisinden türetildi ve bilinçli olarak dar tutuldu:
 * **dört boyut** (17 / 15 / 13 / 11) ve **iki temel ağırlık** (600 / 400).
 * Burada yalnızca `Type` içinde bulunmayan iki kombinasyon tanımlanır; geri
 * kalanı doğrudan mevcut tokenlardır:
 *   etiket   → `Type.eyebrow` (11 / 600, letterSpacing 0.6)
 *   açıklama → `Type.caption` (13 / 400)
 *   değer    → `Type.body`    (15 / 400)
 *
 * Renk tanımlanmaz: her ekran kendi tema renklerini uygular, böylece açık ve
 * koyu tema tek kaynaktan gelir.
 */
export const Form = {
  /** Sayfa/sheet başlığı. Ana Sayfa'daki 19/600 başlıktan bir kademe sakin. */
  title: { fontSize: 17, fontWeight: '600' as const },
  /** Birincil eylem metni — Ana Sayfa'daki `startButtonText` ile aynı. */
  action: { fontSize: 15, fontWeight: '600' as const },
  /**
   * Input, buton ve sembol seçici AYNI yükseklikte durur. Değer aynı zamanda
   * minimum dokunma alanıdır, bu yüzden kompakt görünüm erişilebilirliği
   * bozmaz.
   */
  controlHeight: Layout.minTouchSize,
  controlRadius: Layout.radiusMedium,
  /** Etiket ↔ kontrol arası (4 pt sistemi). */
  fieldGap: 8,
  /** Alanlar arası. */
  sectionGap: 24,
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
