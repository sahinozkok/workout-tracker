import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ThemePreference = 'system' | 'light' | 'dark';

type ThemeContextValue = {
  colorScheme: 'light' | 'dark';
  colors: (typeof Colors)['light'];
  isDark: boolean;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const THEME_STORAGE_KEY = '@workout-tracker/theme-preference';

export function ThemePreferenceProvider({ children }: PropsWithChildren) {
  const systemColorScheme = useColorScheme() ?? 'light';
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const colorScheme = preference === 'system' ? systemColorScheme : preference;

  useEffect(() => {
    async function loadPreference() {
      const savedPreference = await AsyncStorage.getItem(THEME_STORAGE_KEY);

      if (savedPreference === 'system' || savedPreference === 'light' || savedPreference === 'dark') {
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

  const value = useMemo(
    () => ({
      colorScheme,
      colors: Colors[colorScheme],
      isDark: colorScheme === 'dark',
      preference,
      setPreference,
    }),
    [colorScheme, preference, setPreference],
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
