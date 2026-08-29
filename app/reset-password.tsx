import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { readPasswordRecoveryCallback } from '@/lib/auth-redirect';

/** Mevcut kayıt formuyla aynı asgari uzunluk. */
const MIN_PASSWORD_LENGTH = 8;

type ScreenState =
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'error'; reason: 'expired' | 'invalid' };

/**
 * Şifre kurtarma bağlantısının indiği ekran (`/reset-password`).
 *
 * Bu ekran bilinçli olarak `(auth)` grubunun DIŞINDA, kök Stack'tedir:
 * `setSession()` geçici de olsa gerçek bir Supabase oturumu açar ve ekran auth
 * grubunda olsaydı guard kullanıcıyı sekmelere yönlendirebilirdi. Kök Stack'te
 * olduğu için alt sekme çubuğu da görünmez.
 *
 * Token yaşam döngüsü:
 *  - URL yalnızca `type=recovery` + `access_token` + `refresh_token` içerirse
 *    işlenir; hata parametreleri her zaman önceliklidir.
 *  - Token'lar yalnızca yerel değişkende taşınır ve tek bir
 *    `startPasswordRecovery` çağrısına verilir (o da `setSession`'a). State'e,
 *    log'a, ekrana veya uygulamaya ait bir depolama anahtarına yazılmazlar.
 *  - Web'de token'lar yerel değişkene alınır alınmaz adres çubuğu temizlenir.
 *  - Aynı URL yalnızca bir kez işlenir; unmount sonrası state yazılmaz.
 */
export default function ResetPasswordScreen() {
  const url = Linking.useLinkingURL();
  const {
    cancelPasswordRecovery,
    completePasswordRecovery,
    isLoading,
    isPasswordRecovery,
    session,
    startPasswordRecovery,
  } = useAuth();
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  const [screenState, setScreenState] = useState<ScreenState>({ status: 'checking' });
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordRepeat, setShowPasswordRepeat] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handledUrlRef = useRef<string>(undefined);
  const isMountedRef = useRef(true);
  /** URL callback'i işlenirken sürdürme yolu devreye girmemeli. */
  const isProcessingCallbackRef = useRef(false);
  // Aynı karede gelen ikinci dokunuş `isSubmitting` daha güncellenmeden
  // geçebilirdi; ref anında kilitler.
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!url || handledUrlRef.current === url) return;

    const callback = readPasswordRecoveryCallback(url);
    // URL henüz gelmediyse işlenmiş sayılmaz.
    if (!callback) return;
    handledUrlRef.current = url;

    if (callback.kind === 'error') {
      if (isMountedRef.current) setScreenState({ status: 'error', reason: callback.reason });
      clearSensitiveUrlParts();
      return;
    }

    // Token'lar yalnızca bu iki yerel değişkende yaşar.
    const { accessToken, refreshToken } = callback;
    // Adres çubuğu, değerler alındıktan hemen sonra temizlenir.
    clearSensitiveUrlParts();

    isProcessingCallbackRef.current = true;
    void (async () => {
      try {
        const result = await startPasswordRecovery(accessToken, refreshToken);
        if (!isMountedRef.current) return;
        // Sunucu doğrulaması başarısızsa form AÇILMAZ.
        setScreenState(result.error ? { status: 'error', reason: 'invalid' } : { status: 'ready' });
      } finally {
        isProcessingCallbackRef.current = false;
      }
    })();
  }, [startPasswordRecovery, url]);

  /**
   * Uygulama kurtarma formundayken kapatılıp yeniden açılırsa URL'de artık
   * token yoktur (ilk callback'te temizlenir). Bu durumda ekran sonsuza kadar
   * "kontrol ediliyor"da kalırdı.
   *
   * Kalıcı kurtarma bayrağı + mevcut Supabase oturumu birlikte varsa form
   * token'a ihtiyaç duymadan yeniden açılır. Normal (kurtarma olmayan) bir
   * oturum bu koşulu sağlamaz, bu yüzden formu açamaz. Ne callback ne de
   * süren bir kurtarma varsa spinner yerine geçersiz bağlantı ekranı gösterilir.
   */
  useEffect(() => {
    if (isLoading) return;
    if (screenState.status !== 'checking') return;
    // URL callback'i işleniyorsa onun sonucu beklenir: doğrulama bitmeden
    // form açılmaz.
    if (isProcessingCallbackRef.current || handledUrlRef.current) return;

    if (isPasswordRecovery && session) {
      setScreenState({ status: 'ready' });
      return;
    }

    setScreenState({ status: 'error', reason: 'invalid' });
  }, [isLoading, isPasswordRecovery, screenState.status, session]);

  async function handleSubmit() {
    if (isSubmittingRef.current) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      Alert.alert(t('auth.invalidPasswordTitle'), t('auth.invalidPasswordBody'));
      return;
    }

    if (password !== passwordRepeat) {
      // Parolaların kendisi hiçbir mesaja veya log'a girmez.
      Alert.alert(t('auth.resetMismatchTitle'), t('auth.resetMismatchBody'));
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await completePasswordRecovery(password);
      if (result.error) {
        Alert.alert(t('auth.resetFailedTitle'), t('auth.errors.generic'));
        return;
      }

      /**
       * BAŞARILI: YÖNLENDİRME BU EKRANDA YAPILMAZ.
       *
       * `completePasswordRecovery` dönmeden önce kurtarma bayrağını kapatır;
       * o anda `UserScopedApp` sağlayıcılı ağaca geçer ve BU EKRAN UNMOUNT
       * OLUR. Buradaki bir `router.replace` hiç çalışmaz, ekran yeniden mount
       * olup "geçersiz bağlantı" gösterirdi. Yönlendirme, `AuthProvider`'daki
       * tek kullanımlık sinyalle `AppNavigation` tarafından yapılır.
       */
      setPassword('');
      setPasswordRepeat('');
      Alert.alert(t('auth.resetDoneTitle'), t('auth.resetDoneBody'));
    } catch {
      Alert.alert(t('auth.connectionFailed'), t('auth.connectionFailedBody'));
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) setIsSubmitting(false);
    }
  }

  /**
   * Ekrandan çıkışın TEK yolu. Ortada bir kurtarma oturumu varsa önce
   * `cancelPasswordRecovery()` ile gerçekten kapatılır; kapatılamazsa ekranda
   * kalınır ve genel hata gösterilir. Böylece hata ekranındaki bağlantılar da
   * ayakta duran bir kurtarma oturumunu atlayamaz.
   */
  async function leaveRecovery(destination: '/login' | '/forgot-password') {
    if (isSubmittingRef.current) return;

    // Kurtarma oturumu zaten yoksa doğrudan gidilir.
    if (!isPasswordRecovery && !session) {
      router.replace(destination);
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await cancelPasswordRecovery();
      if (result.error) {
        // Oturum kapatılamadıysa kurtarma modu açık kalır: uygulama normal
        // oturum açıkmış gibi davranmaz. Kullanıcı tekrar deneyebilir.
        Alert.alert(t('auth.resetFailedTitle'), t('auth.errors.generic'));
        return;
      }

      router.replace(destination);
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) setIsSubmitting(false);
    }
  }

  if (screenState.status === 'checking') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.subtitle}>{t('auth.resetChecking')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (screenState.status === 'error') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.brandIcon, styles.brandIconError]}>
            <Ionicons name="alert-circle-outline" size={30} color={colors.onPrimary} />
          </View>
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>{t('auth.brand')}</Text>
            <Text style={styles.title}>{t('auth.resetLinkErrorTitle')}</Text>
            <Text style={styles.subtitle}>
              {screenState.reason === 'expired' ? t('auth.resetExpiredBody') : t('auth.resetInvalidBody')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => void leaveRecovery('/forgot-password')}
            style={({ pressed }) => [styles.submitButton, (pressed || isSubmitting) && styles.pressed]}>
            <Text style={styles.submitButtonText}>{t('auth.sendResetLink')}</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
          </Pressable>
          <Pressable
            accessibilityLabel={t('auth.backToLogin')}
            accessibilityRole="link"
            disabled={isSubmitting}
            onPress={() => void leaveRecovery('/login')}
            style={({ pressed }) => [styles.linkButton, (pressed || isSubmitting) && styles.pressed]}>
            <Text style={styles.linkText}>{t('auth.backToLogin')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.brandIcon}>
            <Ionicons name="lock-closed-outline" size={30} color={colors.onPrimary} />
          </View>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>{t('auth.brand')}</Text>
            <Text style={styles.title}>{t('auth.resetTitle')}</Text>
            <Text style={styles.subtitle}>{t('auth.resetSubtitle')}</Text>
          </View>

          <View style={styles.formCard}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('auth.newPassword')}</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="new-password"
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                  onChangeText={setPassword}
                  placeholder={t('auth.passwordPlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry={!showPassword}
                  selectionColor={colors.primary}
                  style={styles.passwordInput}
                  value={password}
                />
                <Pressable
                  accessibilityLabel={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  accessibilityRole="button"
                  onPress={() => setShowPassword((current) => !current)}
                  style={styles.showPasswordButton}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.icon} />
                </Pressable>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('auth.newPasswordRepeat')}</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="new-password"
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                  onChangeText={setPasswordRepeat}
                  placeholder={t('auth.passwordPlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry={!showPasswordRepeat}
                  selectionColor={colors.primary}
                  style={styles.passwordInput}
                  value={passwordRepeat}
                />
                <Pressable
                  accessibilityLabel={showPasswordRepeat ? t('auth.hidePassword') : t('auth.showPassword')}
                  accessibilityRole="button"
                  onPress={() => setShowPasswordRepeat((current) => !current)}
                  style={styles.showPasswordButton}>
                  <Ionicons
                    name={showPasswordRepeat ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.icon}
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={() => void handleSubmit()}
              style={({ pressed }) => [styles.submitButton, (pressed || isSubmitting) && styles.pressed]}>
              <Text style={styles.submitButtonText}>
                {isSubmitting ? t('common.loading') : t('auth.updatePassword')}
              </Text>
              <Ionicons name="checkmark" size={19} color={colors.onPrimary} />
            </Pressable>

            <Pressable
              accessibilityLabel={t('auth.resetCancel')}
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={() => void leaveRecovery('/login')}
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
              <Text style={styles.linkText}>{t('auth.resetCancel')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Web'de adres çubuğundaki token parçalarını siler. */
function clearSensitiveUrlParts() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;

  // Router kendi geçmiş senkronizasyonunu yaptıktan SONRA çalışması için bir
  // tick beklenir.
  setTimeout(() => {
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, 0);
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { flexGrow: 1, justifyContent: 'center', padding: Layout.screenPadding, paddingBottom: 40 },
    centerState: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center', padding: 32 },
    brandIcon: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 16,
      height: 56,
      justifyContent: 'center',
      marginBottom: 24,
      width: 56,
    },
    brandIconError: { backgroundColor: colors.danger },
    heading: { marginBottom: 26 },
    eyebrow: { color: colors.textSecondary, ...Type.eyebrow },
    title: { color: colors.text, ...Type.pageTitle, marginTop: 8 },
    subtitle: { color: colors.textSecondary, ...Type.caption, lineHeight: 19, marginTop: 8 },
    formCard: { gap: 18 },
    fieldGroup: { gap: 8 },
    label: { color: colors.textSecondary, fontSize: 13 },
    passwordRow: {
      alignItems: 'center',
      backgroundColor: colors.background,
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      minHeight: 48,
    },
    passwordInput: { color: colors.text, flex: 1, fontSize: 15, paddingHorizontal: 16, paddingVertical: 12 },
    showPasswordButton: {
      alignItems: 'center',
      height: Layout.minTouchSize,
      justifyContent: 'center',
      width: Layout.minTouchSize,
    },
    submitButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Layout.radiusPill,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      marginTop: 6,
      minHeight: 52,
    },
    submitButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
    linkButton: {
      alignItems: 'center',
      alignSelf: 'center',
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 12,
    },
    linkText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
