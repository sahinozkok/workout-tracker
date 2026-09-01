import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { Colors, ThemeColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ThemePreference = 'system' | 'light' | 'warmLight' | 'softDark' | 'dark';

type ThemeContextValue = {
  colorScheme: 'light' | 'dark';
  colors: ThemeColors;
  isDark: boolean;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const THEME_STORAGE_KEY = '@workout-tracker/theme-preference';

export function ThemePreferenceProvider({ children }: PropsWithChildren) {
  const systemColorScheme = useColorScheme() ?? 'light';
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const colorScheme =
    preference === 'system'
      ? systemColorScheme
      : preference === 'dark' || preference === 'softDark'
        ? 'dark'
        : 'light';

  useEffect(() => {
    async function loadPreference() {
      const savedPreference = await AsyncStorage.getItem(THEME_STORAGE_KEY);

      if (
        savedPreference === 'system' ||
        savedPreference === 'light' ||
        savedPreference === 'warmLight' ||
        savedPreference === 'softDark' ||
        savedPreference === 'dark'
      ) {
        setPreferenceState(savedPreference);
      }
    }

    loadPreference().catch(() => {
      // Depolama okunamazsa güvenli varsayılan olan sistem teması kullanılır.
    });
  }, []);

  const setPreference = useCallback((newPreference: ThemePreference) => {
    setPreferenceState(newPreference);
    AsyncStorage.setItem(THEME_STORAGE_KEY, newPreference).catch(() => {
      // Seçim ekranda uygulanır; depolama hatası uygulamanın çalışmasını engellemez.
    });
  }, []);

  const colors =
    preference === 'warmLight'
      ? Colors.warmLight
      : preference === 'softDark'
        ? Colors.softDark
        : Colors[colorScheme];

  const value = useMemo(
    () => ({
      colorScheme,
      colors,
      isDark: colorScheme === 'dark',
      preference,
      setPreference,
    }),
    [colorScheme, colors, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePreference() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useThemePreference, ThemePreferenceProvider içinde kullanılmalıdır.');
  }

  return context;
}
