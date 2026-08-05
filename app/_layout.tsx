import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuthProvider, useAuth } from '@/context/auth-context';
import { ProfileProvider } from '@/context/profile-context';
import { ThemePreferenceProvider } from '@/context/theme-context';
import { WorkoutProvider } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { configureRestNotifications } from '@/utils/rest-notifications';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemePreferenceProvider>
        <AuthProvider>
          <UserScopedApp />
        </AuthProvider>
      </ThemePreferenceProvider>
    </GestureHandlerRootView>
  );
}

function UserScopedApp() {
  const { user } = useAuth();

  return (
    <ProfileProvider key={user?.id ?? 'signed-out'}>
      <WorkoutProvider>
        <AppNavigation />
      </WorkoutProvider>
    </ProfileProvider>
  );
}

function AppNavigation() {
  const { isLoading, session } = useAuth();
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

  if (isLoading) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <ThemeProvider value={navigationTheme}>
      <Stack
        screenOptions={{
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontSize: 19, fontWeight: '900' },
        }}>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(session)}>
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
        </Stack.Protected>
      </Stack>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
});
