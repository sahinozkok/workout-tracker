import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ProfileProvider } from '@/context/profile-context';
import { ThemePreferenceProvider } from '@/context/theme-context';
import { WorkoutProvider } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { configureRestNotifications } from '@/utils/rest-notifications';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemePreferenceProvider>
        <ProfileProvider>
          <WorkoutProvider>
            <AppNavigation />
          </WorkoutProvider>
        </ProfileProvider>
      </ThemePreferenceProvider>
    </GestureHandlerRootView>
  );
}

function AppNavigation() {
  const { colors, isDark } = useAppTheme();
  const baseNavigationTheme = isDark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...baseNavigationTheme,
    colors: {
      ...baseNavigationTheme.colors,
      background: colors.background,
      border: colors.border,
      card: colors.surface,
      notification: colors.danger,
      primary: colors.primary,
      text: colors.text,
    },
  };

  useEffect(() => {
    configureRestNotifications().catch(() => {
      // Bildirim hazırlığı başarısız olsa bile uygulama normal çalışmaya devam eder.
    });
  }, []);

  return (
    <ThemeProvider value={navigationTheme}>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="program/create"
          options={{
            title: 'Yeni Program',
            headerBackTitle: 'Geri',
          }}
        />
        <Stack.Screen name="program/[id]" options={{ headerBackTitle: 'Programlar', title: 'Program Detayı' }} />
        <Stack.Screen
          name="program/[id]/day/[dayId]/index"
          options={{ headerBackTitle: 'Program', title: 'Antrenman Günü' }}
        />
        <Stack.Screen
          name="program/[id]/day/[dayId]/add-exercise"
          options={{ headerBackTitle: 'Program', title: 'Egzersiz Ekle' }}
        />
      </Stack>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
