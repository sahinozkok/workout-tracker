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
    background: '#101114',
    surface: '#181A1F',
    surfaceMuted: '#22252B',
    text: '#F8FAFC',
    textSecondary: '#A7ABB4',
    textTertiary: '#737985',
    border: '#30343B',
    inputBorder: '#444A54',
    primary: '#1D4ED8',
    primaryStrong: '#0A1A33',
    primaryIcon: '#60A5FA',
    primarySoft: '#13233E',
    primarySoftBorder: '#1E3A5F',
    primarySoftText: '#BFDBFE',
    accent: '#C2410C',
    accentBright: '#FB923C',
    accentSoft: '#3A1D12',
    accentText: '#FDBA74',
    onPrimary: '#FFFFFF',
    heroText: '#BFDBFE',
    infoSurface: '#111F35',
    infoText: '#BFDBFE',
    infoIcon: '#60A5FA',
    danger: '#F87171',
    disciplineCompleted: '#22C55E',
    disciplinePartial: '#F97316',
    disciplineSkipped: '#59606B',
    disciplineEmpty: '#252930',
    disciplineFuture: '#1B1E23',
    tint: '#3B82F6',
    icon: '#A7ABB4',
    tabIconDefault: '#8B909A',
    tabIconSelected: '#60A5FA',
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
