import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
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
import { describePasswordRecoveryRedirect } from '@/lib/auth-redirect';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * Şifre sıfırlama isteği ekranı (`/forgot-password`).
 *
 * Güvenlik notları:
 *  - Hesabın var olup olmadığı ASLA ayırt edilmez. Supabase başarıyla dönerse
 *    her zaman aynı genel mesaj gösterilir; böylece hesap keşfi yapılamaz.
 *  - E-posta adresi ve hata nesneleri loglanmaz.
 *  - İstek sürerken düğme kilitlenir; art arda dokunma ikinci istek üretmez.
 */
export default function ForgotPasswordScreen() {
  const { requestPasswordReset } = useAuth();
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentToEmail, setSentToEmail] = useState<string>();
  // State güncellemesi asenkron olduğu için aynı karede gelen ikinci dokunuş
  // `isSubmitting` henüz `true` olmadan geçebilirdi; ref anında kilitler.
  const isSubmittingRef = useRef(false);

  /**
   * GELİŞTİRME TEŞHİSİ — yalnızca `__DEV__`.
   *
   * Uygulamanın Supabase'e gönderdiği callback adresini gösterir. Expo Go
   * host'u (`<LAN-IP>:<port>`) her açılışta değişebildiği için Supabase
   * Redirect URL listesine hangi adresin eklenmesi gerektiği ancak böyle
   * doğrulanabilir. Token, e-posta veya anahtar İÇERMEZ ve yayın derlemesinde
   * hiç render edilmez.
   */
  const recoveryRedirect = __DEV__ ? describePasswordRecoveryRedirect() : undefined;

  async function handleSubmit() {
    if (isSubmittingRef.current) return;

    // E-posta her zaman değişmez küçük harfe çevrilir; `tr-TR` yereli `I`
    // harfini `ı` yapacağı için kullanılmaz.
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail.includes('@')) {
      Alert.alert(t('auth.invalidEmailTitle'), t('auth.invalidEmailBody'));
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await requestPasswordReset(normalizedEmail);
      if (result.error) {
        // Yalnızca gönderimin kendisi başarısızsa hata gösterilir; bu mesaj
        // hesabın var olup olmadığı hakkında bilgi taşımaz.
        Alert.alert(t('auth.resetRequestFailed'), t('auth.errors.generic'));
        return;
      }

      setSentToEmail(normalizedEmail);
    } catch {
      Alert.alert(t('auth.connectionFailed'), t('auth.connectionFailedBody'));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  if (sentToEmail) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.brandIcon}>
            <Ionicons name="mail-outline" size={30} color={colors.onPrimary} />
          </View>
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>{t('auth.brand')}</Text>
            <Text style={styles.title}>{t('auth.resetSentTitle')}</Text>
            {/* Bilinçli olarak genel: adres kayıtlı mı bilgisi verilmez. */}
            <Text style={styles.subtitle}>{t('auth.resetSentBody', { email: sentToEmail })}</Text>
            <Text style={styles.subtitle}>{t('auth.resetSentHint')}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/login')}
            style={({ pressed }) => [styles.submitButton, pressed && styles.pressed]}>
            <Text style={styles.submitButtonText}>{t('auth.backToLogin')}</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
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
            <Ionicons name="key-outline" size={30} color={colors.onPrimary} />
          </View>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>{t('auth.brand')}</Text>
            <Text style={styles.title}>{t('auth.forgotTitle')}</Text>
            <Text style={styles.subtitle}>{t('auth.forgotSubtitle')}</Text>
            {/* Yalnızca geliştirmede: Supabase'e gönderilen callback adresi.
                Token/e-posta taşımaz, yayın derlemesinde render edilmez. */}
            {Boolean(recoveryRedirect) && (
              <Text selectable style={styles.devRedirect}>
                {`${recoveryRedirect?.environment} · ${recoveryRedirect?.url ?? '—'}`}
              </Text>
            )}
          </View>

          <View style={styles.formCard}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('auth.email')}</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder={t('auth.emailPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                style={styles.input}
                value={email}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={() => void handleSubmit()}
              style={({ pressed }) => [styles.submitButton, (pressed || isSubmitting) && styles.pressed]}>
              <Text style={styles.submitButtonText}>
                {isSubmitting ? t('common.loading') : t('auth.sendResetLink')}
              </Text>
              <Ionicons name="arrow-forward" size={19} color={colors.onPrimary} />
            </Pressable>
          </View>

          <View style={styles.switchModeRow}>
            <Pressable
              accessibilityLabel={t('auth.backToLogin')}
              accessibilityRole="link"
              onPress={() => router.replace('/login')}
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
              <Text style={styles.switchModeLink}>{t('auth.backToLogin')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { flexGrow: 1, justifyContent: 'center', padding: Layout.screenPadding, paddingBottom: 40 },
    brandIcon: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 16,
      height: 56,
      justifyContent: 'center',
      marginBottom: 24,
      width: 56,
    },
    heading: { marginBottom: 26 },
    eyebrow: { color: colors.textSecondary, ...Type.eyebrow },
    title: { color: colors.text, ...Type.pageTitle, marginTop: 8 },
    /** Geliştirme teşhisi; yayın derlemesinde hiç kullanılmaz. */
    devRedirect: {
      color: colors.textTertiary,
      fontSize: 11,
      marginTop: 4,
    },
    subtitle: { color: colors.textSecondary, ...Type.caption, lineHeight: 19, marginTop: 8 },
    formCard: { gap: 18 },
    fieldGroup: { gap: 8 },
    label: { color: colors.textSecondary, fontSize: 13 },
    input: {
      backgroundColor: colors.background,
      borderColor: colors.inputBorder,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      color: colors.text,
      fontSize: 15,
      minHeight: 48,
      paddingHorizontal: 16,
      paddingVertical: 12,
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
    switchModeRow: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 24 },
    linkButton: { alignItems: 'center', justifyContent: 'center', minHeight: Layout.minTouchSize, paddingHorizontal: 12 },
    switchModeLink: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
