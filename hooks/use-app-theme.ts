import { useThemePreference } from '@/context/theme-context';

export function useAppTheme() {
  return useThemePreference();
}
