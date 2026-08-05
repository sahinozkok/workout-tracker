/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    background: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceMuted: '#F1F5F9',
    text: '#0F172A',
    textSecondary: '#64748B',
    textTertiary: '#94A3B8',
    border: '#E2E8F0',
    inputBorder: '#CBD5E1',
    primary: '#1E40AF',
    primaryStrong: '#0B1F3A',
    primaryIcon: '#1D4ED8',
    primarySoft: '#DBEAFE',
    primarySoftBorder: '#93C5FD',
    primarySoftText: '#1E3A8A',
    accent: '#C2410C',
    accentBright: '#FB923C',
    accentSoft: '#FFEDD5',
    accentText: '#9A3412',
    onPrimary: '#FFFFFF',
    heroText: '#DBEAFE',
    infoSurface: '#E0F2FE',
    infoText: '#075985',
    infoIcon: '#0369A1',
    danger: '#DC2626',
    disciplineCompleted: '#16A34A',
    disciplinePartial: '#C2410C',
    disciplineSkipped: '#94A3B8',
    disciplineEmpty: '#E2E8F0',
    disciplineFuture: '#F1F5F9',
    tint: '#1E40AF',
    icon: '#64748B',
    tabIconDefault: '#64748B',
    tabIconSelected: '#1E40AF',
  },
  dark: {
    background: '#000000',
    surface: '#000000',
    surfaceMuted: '#000000',
    text: '#F8FAFC',
    textSecondary: '#A5A9B2',
    textTertiary: '#6F7580',
    border: '#242424',
    inputBorder: '#343434',
    primary: '#2E5BEA',
    primaryStrong: '#000000',
    primaryIcon: '#6EA3FF',
    primarySoft: '#111C3D',
    primarySoftBorder: '#203B7A',
    primarySoftText: '#C7D7FF',
    accent: '#F97316',
    accentBright: '#F59E0B',
    accentSoft: '#351B0D',
    accentText: '#FDBA74',
    onPrimary: '#FFFFFF',
    heroText: '#B9BDC6',
    infoSurface: '#000000',
    infoText: '#C7D7FF',
    infoIcon: '#6EA3FF',
    danger: '#F87171',
    disciplineCompleted: '#22C55E',
    disciplinePartial: '#F97316',
    disciplineSkipped: '#59606B',
    disciplineEmpty: '#20242A',
    disciplineFuture: '#111318',
    tint: '#4F7BFF',
    icon: '#A7ABB4',
    tabIconDefault: '#8B909A',
    tabIconSelected: '#6EA3FF',
  },
};

export type ThemeColors = (typeof Colors)['light'];

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
