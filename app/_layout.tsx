import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { FriendMessageAlerts } from '@/components/friends/message-alert-banner';
import { FloatingMascot } from '@/components/mascot/floating-mascot';
import { AchievementUnlockCelebrationLayer } from '@/components/ranks/achievement-unlock-celebration';
import { RankUpCelebrationLayer } from '@/components/ranks/rank-up-celebration';
import { SeasonRecapLayer } from '@/components/ranks/season-recap';
import { AuthProvider, useAuth } from '@/context/auth-context';
import { LanguageProvider, useLanguage, useTranslation } from '@/context/language-context';
import { MascotProvider } from '@/context/mascot-context';
import { ProfileProvider, useProfile } from '@/context/profile-context';
import { RankProvider } from '@/context/rank-context';
import { RewardProvider } from '@/context/reward-context';
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
      {/* Seviye/XP/gül sağlayıcısı WorkoutProvider'ın DIŞINDA durur: set
          tamamlandığında workout akışı ödül uzlaştırmasını buradan çağırır.
          `+N XP` katmanı da bu sağlayıcının içinde, bütün ekranların üzerinde
          tek kopya olarak çizilir. */}
      <RewardProvider>
        {/* Sezonluk rank AYRI bir katmandır: XP/gül/level durumuna hiç
            dokunmaz. `WorkoutProvider`'ın DIŞINDA durur ki antrenman akışı
            set kaydından sonra rank senkronizasyonunu buradan tetikleyebilsin.
            Rank okunamazsa antrenman akışı etkilenmez. */}
        <RankProvider>
          <WorkoutProvider>
            <MascotProvider>
              <SharedDisciplineSync />
              <AppNavigation />
            </MascotProvider>
          </WorkoutProvider>
        </RankProvider>
      </RewardProvider>
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
  const {
    acknowledgeRecoveryRedirect,
    isLoading,
    isPasswordRecovery,
    pendingRecoveryRedirect,
    session,
  } = useAuth();

  /**
   * ŞİFRE DEĞİŞİMİ SONRASI GİRİŞ EKRANINA YÖNLENDİRME.
   *
   * Yönlendirme `ResetPasswordScreen`'de YAPILAMAZ: kurtarma bayrağı düştüğü
   * anda `UserScopedApp` sağlayıcılı ağaca geçer ve o ekran unmount olur.
   * Sinyal `AuthProvider`'da (bu ağacın ÜSTÜNDE) yaşadığı için yeniden mount
   * edilen bu bileşen onu görür.
   *
   * Yönlendirme YALNIZCA `/login` guard'ı gerçekten açıldıktan sonra yapılır
   * (`!session && !isPasswordRecovery`); guard'lar GEVŞETİLMEZ. Sinyal
   * `router.replace`'ten ÖNCE tüketilir, böylece efekt yeniden çalışsa bile
   * tek bir yönlendirme olur.
   */
  useEffect(() => {
    if (!pendingRecoveryRedirect) return;
    if (isLoading || isPasswordRecovery || session) return;

    acknowledgeRecoveryRedirect();
    router.replace('/login');
  }, [acknowledgeRecoveryRedirect, isLoading, isPasswordRecovery, pendingRecoveryRedirect, session]);
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
          {/* Sezon rankı kök Stack'te açılır: yeni bir alt sekme EKLENMEZ ve
              bu ekranda sekme çubuğu görünmez. */}
          <Stack.Screen
            name="rank"
            options={{ headerBackTitle: t('tabs.profile'), title: t('ranks.navTitle') }}
          />
          {/* Rank rehberi de kök Stack'te açılır: native başlık kullanıldığı
              için geri düğmesi ve iOS geri kaydırma hareketi aynen çalışır,
              alt sekme çubuğu görünmez ve yeni sekme EKLENMEZ. */}
          <Stack.Screen
            name="rank-guide"
            options={{ headerBackTitle: t('ranks.navTitle'), title: t('ranks.guide.navTitle') }}
          />
          {/* Rozet vitrini seçimi de kök Stack'te açılır: native başlık
              sayesinde geri düğmesi ve iOS geri kaydırma hareketi aynen
              çalışır, alt sekme çubuğuna YENİ SEKME EKLENMEZ. */}
          <Stack.Screen
            name="rank-showcase"
            options={{
              headerBackTitle: t('tabs.profile'),
              title: t('ranks.achievements.showcase.editTitle'),
            }}
          />
          {/* Arkadaşlık ekranları kök Stack'te açılır: alt sekme çubuğu
              görünmez, native geri hareketi korunur.

              Native başlık kapatılır: bu iki ekran referans tasarımdaki kendi
              başlığını (geri oku + ortalanmış başlık + üç nokta) çizer.
              `headerShown: false` native-stack'in kaydırarak geri gitme
              hareketini etkilemez, bu yüzden iOS jesti aynen çalışır. */}
          <Stack.Screen name="friends/index" options={{ headerShown: false }} />
          <Stack.Screen name="friends/search" options={{ headerShown: false }} />
          {/* Arkadaş sezon sıralaması da kök Stack'te açılır: alt sekme
              çubuğuna YENİ SEKME EKLENMEZ ve ekran kendi başlığını çizer. */}
          <Stack.Screen name="friends/leaderboard" options={{ headerShown: false }} />
          <Stack.Screen
            name="profile/[userId]"
            options={{ headerBackTitle: t('friends.title'), title: '' }}
          />
          {/* Mesajlaşma ekranları da arkadaşlık ekranlarıyla AYNI güvenli
              bölgede, kök Stack'te açılır: alt sekme çubuğuna YENİ SEKME
              EKLENMEZ ve bu ekranlarda sekme çubuğu görünmez. Native başlık
              kapatılır — iki ekran da kendi başlığını çizer; bu native-stack'in
              kaydırarak geri gitme hareketini etkilemediği için iOS jesti
              aynen çalışır. */}
          <Stack.Screen name="messages/index" options={{ headerShown: false }} />
          <Stack.Screen name="messages/[userId]" options={{ headerShown: false }} />
          {/* Engellenen kullanıcılar Ayarlar'dan açılan kök Stack ekranıdır;
              alt sekme çubuğu görünmez ve kendi sade başlığını çizer. */}
          <Stack.Screen name="blocked-users" options={{ headerShown: false }} />
        </Stack.Protected>
        {/* ŞİFRE KURTARMA EKRANI — koşulsuz kayıtlı ama LİSTENİN SONUNDA.
            KOŞULSUZ: kullanıcı başka bir hesapla oturum açmış olsa bile
            e-posta bağlantısı bu ekranı açabilmelidir; guard'lı olsaydı ekran
            mount olamaz, recovery token'ını doğrulayamaz ve mevcut oturum
            kullanıcıyı doğrudan sekmelere taşırdı.
            SIRALAMA BİLİNÇLİDİR — bu kayıt `(auth)` ve oturum korumalı grubun
            SONRASINDADIR. Guard'ı kapanan ekran navigator listesinden tamamen
            çıkarılır ve React Navigation odaklı route silindiğinde
            `routeNames[0]`e düşer (kök Stack'te `initialRouteName` yoktur).
            Bu kayıt `(tabs)`tan ÖNCE olsaydı normal giriş sonrası fallback
            token'sız reset ekranı olur ve login ile reset arasında döngü
            oluşurdu. Sonda olduğu için fallback sırası doğrudur:
            oturum yok → `(auth)`, oturum var → `(tabs)`, kurtarma → bu ekran.
            Ekranın kendisi yalnızca doğrulanmış `type=recovery` callback'i veya
            kalıcı recovery bayrağı varsa formu açar; çıplak `/reset-password`
            yolu yetmez. Kök Stack ekranı olduğu için alt sekme çubuğu görünmez. */}
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
      </Stack>
      {/*
        Maskot Stack'ten sonra kardeş olarak çizilir: her ekranın üzerinde kalır
        ama `box-none` kapsayıcısı sayesinde alttaki butonların dokunmasını
        engellemez. Yalnızca oturum varken render edilir, bu yüzden giriş ve
        kayıt ekranlarında hiç görünmez.

        Kurtarma oturumu da gerçek bir oturumdur; `isPasswordRecovery`
        kontrolü olmasaydı Rosea şifre sıfırlama ekranında görünür ve
        `MascotProvider` mount edilmediği için `useMascot()` hata fırlatırdı.
      */}
      {/*
        Rank yükselme kutlaması Rosea'dan ÖNCE çizilir: perde alttaki ekranı
        kapatır ama Rosea üstte kalır, böylece kutlama tepkisi gerçekten
        görünür. Maskot gibi yalnızca gerçek oturumda mount edilir — giriş,
        kayıt ve şifre kurtarma ekranlarında hiç render edilmez ve o ekranlarda
        `RankProvider`/`MascotProvider` de mount olmadığı için context okuması
        güvenlidir.
      */}
      {/*
        UYGULAMA İÇİ MESAJ BANNER'I — rank/Rosea katmanlarından ÖNCE çizilir.
        Böylece kutlamalar ve maskot banner'ın ÜSTÜNDE kalır; mevcut overlay
        sahiplik sistemine hiç dokunulmaz. Yalnızca gerçek oturumda ve kurtarma
        dışında mount edilir, bu yüzden hesap değişiminde kendiliğinden sıfırlanır.
      */}
      {Boolean(session) && !isPasswordRecovery && <FriendMessageAlerts />}
      {Boolean(session) && !isPasswordRecovery && <RankUpCelebrationLayer />}
      {/*
        Sezon sonu özeti kutlamayla AYNI katman ailesindedir ve ondan SONRA
        çizilir; ama ikisi hiçbir zaman üst üste açılmaz: özet, bekleyen bir
        rank yükselmesi varken kendini hiç göstermez ve sırasını bekler.
      */}
      {Boolean(session) && !isPasswordRecovery && <SeasonRecapLayer />}
      {/*
        Başarı kutlaması ÖNCELİK SIRASINDA en sondadır: bekleyen bir rank
        yükselmesi veya sezon özeti varken kendini hiç göstermez. Üçü de
        `RankContext` üzerinden senkron katman sahipliği alır, bu yüzden
        hiçbir koşulda üst üste binmezler.
      */}
      {Boolean(session) && !isPasswordRecovery && <AchievementUnlockCelebrationLayer />}
      {Boolean(session) && !isPasswordRecovery && <FloatingMascot />}
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
});
