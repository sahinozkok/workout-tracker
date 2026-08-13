import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuthProvider, useAuth } from '@/context/auth-context';
import { LanguageProvider, useLanguage, useTranslation } from '@/context/language-context';
import { ProfileProvider, useProfile } from '@/context/profile-context';
import { ThemePreferenceProvider } from '@/context/theme-context';
import { WorkoutProvider } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { configureRestNotifications } from '@/utils/rest-notifications';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LanguageProvider>
        <ThemePreferenceProvider>
          <AuthProvider>
            <UserScopedApp />
          </AuthProvider>
        </ThemePreferenceProvider>
      </LanguageProvider>
    </GestureHandlerRootView>
  );
}

function UserScopedApp() {
  const { user } = useAuth();

  return (
    <ProfileProvider key={user?.id ?? 'signed-out'}>
      <LanguageSync />
      <WorkoutProvider>
        <AppNavigation />
      </WorkoutProvider>
    </ProfileProvider>
  );
}

/** Hesapta kayıtlı dil tercihi varsa oturum açıldığında uygulanır. */
function LanguageSync() {
  const { preferredLanguage } = useProfile();
  const { language, setLanguage } = useLanguage();

  useEffect(() => {
    if (preferredLanguage && preferredLanguage !== language) setLanguage(preferredLanguage);
  }, [language, preferredLanguage, setLanguage]);

  return null;
}

function AppNavigation() {
  const { isLoading, session } = useAuth();
  const { t } = useTranslation();
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
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontSize: 17, fontWeight: '600' },
        }}>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(session)}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="program/create"
            options={{
              title: t('createProgram.title'),
              headerBackTitle: t('common.back'),
            }}
          />
          <Stack.Screen
            name="program/[id]"
            options={{ headerBackTitle: t('tabs.programs'), title: t('nav.programDetail') }}
          />
          <Stack.Screen
            name="program/[id]/day/[dayId]/index"
            options={{ headerBackTitle: t('nav.program'), title: t('nav.workoutDay') }}
          />
          <Stack.Screen
            name="program/[id]/day/[dayId]/add-exercise"
            options={{ headerBackTitle: t('nav.program'), title: t('nav.addExercise') }}
          />
          <Stack.Screen
            name="settings"
            options={{ headerBackTitle: t('tabs.profile'), title: t('profile.settings') }}
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
