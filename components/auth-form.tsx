import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
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
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

type AuthMode = 'login' | 'register';

export function AuthForm({ mode }: { mode: AuthMode }) {
  const { signIn, signUp } = useAuth();
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Kayıt sonrası doğrulama ekranı: kullanıcı yanlışlıkla tekrar kayıt olamaz.
  const [verificationEmail, setVerificationEmail] = useState<string>();
  const isRegister = mode === 'register';

  async function handleSubmit() {
    const normalizedEmail = email.trim().toLocaleLowerCase('tr-TR');
    const normalizedName = displayName.trim();

    if (isSubmitting) return;

    if (isRegister && normalizedName.length < 2) {
      Alert.alert(t('auth.invalidNameTitle'), t('auth.invalidNameBody'));
      return;
    }

    if (!normalizedEmail.includes('@')) {
      Alert.alert(t('auth.invalidEmailTitle'), t('auth.invalidEmailBody'));
      return;
    }

    if (password.length < 8) {
      Alert.alert(t('auth.invalidPasswordTitle'), t('auth.invalidPasswordBody'));
      return;
    }

    setIsSubmitting(true);
    try {
      if (isRegister) {
        const result = await signUp(normalizedName, normalizedEmail, password);
        if (result.error) {
          Alert.alert(t('auth.registerFailed'), getFriendlyAuthError(result.error, t));
          return;
        }

        // Doğrulama gerekiyorsa kullanıcı uygulamaya alınmaz; bilgi ekranı açılır.
        if (result.needsEmailConfirmation) {
          setVerificationEmail(normalizedEmail);
          setPassword('');
        }
      } else {
        const result = await signIn(normalizedEmail, password);
        if (result.error) Alert.alert(t('auth.loginFailed'), getFriendlyAuthError(result.error, t));
      }
    } catch {
      Alert.alert(t('auth.connectionFailed'), t('auth.connectionFailedBody'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (verificationEmail) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.brandIcon}>
            <Ionicons name="mail-outline" size={30} color={colors.onPrimary} />
          </View>
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>{t('auth.brand')}</Text>
            <Text style={styles.title}>{t('auth.verifyTitle')}</Text>
            <Text style={styles.subtitle}>{t('auth.verifyBody', { email: verificationEmail })}</Text>
            <Text style={styles.subtitle}>{t('auth.verifyHint')}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('./login')}
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
            <Ionicons name="barbell-outline" size={34} color={colors.onPrimary} />
          </View>

          <View style={styles.heading}>
            <Text style={styles.eyebrow}>{t('auth.brand')}</Text>
            <Text style={styles.title}>{isRegister ? t('auth.registerTitle') : t('auth.loginTitle')}</Text>
            <Text style={styles.subtitle}>
              {isRegister
                ? t('auth.registerSubtitle')
                : t('auth.loginSubtitle')}
            </Text>
          </View>

          <View style={styles.formCard}>
            {isRegister && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>{t('auth.displayName')}</Text>
                <TextInput
                  autoComplete="name"
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                  maxLength={40}
                  onChangeText={setDisplayName}
                  placeholder={t('auth.displayNamePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  style={styles.input}
                  value={displayName}
                />
              </View>
            )}

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

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('auth.password')}</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  autoCapitalize="none"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
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

            <Pressable
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={() => void handleSubmit()}
              style={({ pressed }) => [styles.submitButton, (pressed || isSubmitting) && styles.pressed]}>
              <Text style={styles.submitButtonText}>
                {isSubmitting ? t('common.loading') : isRegister ? t('auth.register') : t('auth.login')}
              </Text>
              <Ionicons name="arrow-forward" size={19} color={colors.onPrimary} />
            </Pressable>
          </View>

          <View style={styles.switchModeRow}>
            <Text style={styles.switchModeText}>
              {isRegister ? t('auth.hasAccount') : t('auth.noAccount')}
            </Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.replace(isRegister ? './login' : './register')}>
              <Text style={styles.switchModeLink}>{isRegister ? t('auth.goLogin') : t('auth.goRegister')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Ham Supabase mesajları kullanıcıya gösterilmez; seçilen dile çevrilir. */
function getFriendlyAuthError(message: string, t: (key: string) => string) {
  const normalizedMessage = message.toLocaleLowerCase('en-US');
  if (normalizedMessage.includes('invalid login credentials')) return t('auth.errors.invalidCredentials');
  if (normalizedMessage.includes('email not confirmed')) return t('auth.errors.emailNotConfirmed');
  if (normalizedMessage.includes('already registered') || normalizedMessage.includes('already exists')) {
    return t('auth.errors.userExists');
  }
  if (normalizedMessage.includes('password')) return t('auth.errors.weakPassword');
  if (normalizedMessage.includes('rate limit')) return t('auth.errors.rateLimited');
  return t('auth.errors.generic');
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
    showPasswordButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
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
    switchModeText: { color: colors.textSecondary, fontSize: 14 },
    switchModeLink: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
