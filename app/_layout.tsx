import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { FloatingMascot } from '@/components/mascot/floating-mascot';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { LanguageProvider, useLanguage, useTranslation } from '@/context/language-context';
import { MascotProvider } from '@/context/mascot-context';
import { ProfileProvider, useProfile } from '@/context/profile-context';
import { ThemePreferenceProvider } from '@/context/theme-context';
import { useWorkout, WorkoutProvider } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useSharedDisciplineSync } from '@/hooks/use-shared-discipline-sync';
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
  const { isLoading, isPasswordRecovery, user } = useAuth();

  // Şifre kurtarma sırasında Supabase'de geçici bir oturum vardır, ama bu
  // oturum yalnızca şifreyi değiştirmek içindir. Profil, workout, maskot ve
  // paylaşılan disiplin senkronizasyonu HİÇ mount edilmez: kullanıcı verisi
  // ne ekrana gelir ne de ağdan çekilir.
  //
  // `isLoading` de beklenir: oturum ve kurtarma bayrağı tamamen okunmadan
  // hiçbir kullanıcı verisi sağlayıcısı mount edilmez. Aksi hâlde bayrak
  // okunurken açılan sağlayıcılar veri çekmeye başlayabilirdi.
  // `AppNavigation` bu sırada mevcut yükleniyor ekranını gösterir.
  if (isLoading || isPasswordRecovery) return <AppNavigation />;

  return (
    <ProfileProvider key={user?.id ?? 'signed-out'}>
      <LanguageSync />
      <WorkoutProvider>
        <MascotProvider>
          <SharedDisciplineSync />
          <AppNavigation />
        </MascotProvider>
      </WorkoutProvider>
    </ProfileProvider>
  );
}

/**
 * Disiplin özetini arkadaşlara açık tabloya senkronize eder. Görsel çıktısı
 * yoktur; yalnızca sınırlı ve değişime bağlı bir yazma yapar.
 *
 * Hazırlık koşulu bilinçli olarak iki parçalıdır: yükleme bitmiş OLMALI ve
 * `programsError` boş OLMALI. `refreshPrograms()` Supabase hatası aldığında
 * `isProgramsLoading` false döner ama `disciplineStatuses` boş kalabilir; bu
 * boş değer "gerçek boş snapshot" sanılıp gönderilirse arkadaşlarla paylaşılan
 * geçmiş silinirdi. Sonraki başarılı `refreshPrograms()` çağrısında koşul
 * yeniden sağlanır ve senkronizasyon kaldığı yerden devam eder.
 */
function SharedDisciplineSync() {
  const { user } = useAuth();
  const { disciplineStatuses, isProgramsLoading, programsError } = useWorkout();
  const isWorkoutDataReady = !isProgramsLoading && !programsError;
  useSharedDisciplineSync(user?.id, disciplineStatuses, isWorkoutDataReady);
  return null;
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
  const { isLoading, isPasswordRecovery, session } = useAuth();
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
        {/* Kurtarma sırasında giriş/kayıt ekranları da kapalıdır: kullanıcı
            yalnızca yeni şifre ekranını görür. */}
        <Stack.Protected guard={!session && !isPasswordRecovery}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        {/* Şifre kurtarma ekranı `(auth)` grubunun dışında, kök Stack'tedir:
            `setSession()` geçici bir oturum açtığı için auth grubunda olsaydı
            guard kullanıcıyı sekmelere düşürebilirdi. Bağlantı oturum
            yokken de açılabilmeli, bu yüzden koşul iki durumu birden kapsar.
            Kök Stack ekranı olduğu için alt sekme çubuğu görünmez. */}
        <Stack.Protected guard={!session || isPasswordRecovery}>
          <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={Boolean(session) && !isPasswordRecovery}>
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
          {/* Arkadaşlık ekranları kök Stack'te açılır: alt sekme çubuğu
              görünmez, native geri hareketi korunur. */}
          <Stack.Screen
            name="friends/index"
            options={{ headerBackTitle: t('tabs.profile'), title: t('friends.title') }}
          />
          <Stack.Screen
            name="friends/search"
            options={{ headerBackTitle: t('friends.title'), title: t('friends.search') }}
          />
          <Stack.Screen
            name="profile/[userId]"
            options={{ headerBackTitle: t('friends.title'), title: '' }}
          />
        </Stack.Protected>
      </Stack>
      {/*
        Maskot Stack'ten sonra kardeş olarak çizilir: her ekranın üzerinde kalır
        ama `box-none` kapsayıcısı sayesinde alttaki butonların dokunmasını
        engellemez. Yalnızca oturum varken render edilir, bu yüzden giriş ve
        kayıt ekranlarında hiç görünmez.

        Kurtarma oturumu da gerçek bir oturumdur; `isPasswordRecovery`
        kontrolü olmasaydı Rosa şifre sıfırlama ekranında görünür ve
        `MascotProvider` mount edilmediği için `useMascot()` hata fırlatırdı.
      */}
      {Boolean(session) && !isPasswordRecovery && <FloatingMascot />}
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
});
