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

import { ThemeColors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useAppTheme } from '@/hooks/use-app-theme';

type AuthMode = 'login' | 'register';

export function AuthForm({ mode }: { mode: AuthMode }) {
  const { signIn, signUp } = useAuth();
  const { colors, isDark } = useAppTheme();
  const styles = createStyles(colors);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isRegister = mode === 'register';

  async function handleSubmit() {
    const normalizedEmail = email.trim().toLocaleLowerCase('tr-TR');
    const normalizedName = displayName.trim();

    if (isRegister && normalizedName.length < 2) {
      Alert.alert('Adını kontrol et', 'Görünen ad en az 2 karakter olmalı.');
      return;
    }

    if (!normalizedEmail.includes('@')) {
      Alert.alert('E-postanı kontrol et', 'Geçerli bir e-posta adresi yazmalısın.');
      return;
    }

    if (password.length < 8) {
      Alert.alert('Şifreni kontrol et', 'Şifren en az 8 karakter olmalı.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isRegister) {
        const result = await signUp(normalizedName, normalizedEmail, password);
        if (result.error) {
          Alert.alert('Hesap oluşturulamadı', getFriendlyAuthError(result.error));
          return;
        }

        if (result.needsEmailConfirmation) {
          Alert.alert(
            'E-postanı kontrol et',
            'Hesabını etkinleştirmek için gönderdiğimiz bağlantıya dokun. Sonra giriş yapabilirsin.',
            [{ text: 'Tamam', onPress: () => router.replace('./login') }],
          );
        }
      } else {
        const result = await signIn(normalizedEmail, password);
        if (result.error) Alert.alert('Giriş yapılamadı', getFriendlyAuthError(result.error));
      }
    } catch {
      Alert.alert('Bağlantı kurulamadı', 'İnternet bağlantını kontrol edip tekrar dene.');
    } finally {
      setIsSubmitting(false);
    }
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
            <Text style={styles.eyebrow}>SET GÜNLÜĞÜ</Text>
            <Text style={styles.title}>{isRegister ? 'Hesabını oluştur' : 'Tekrar hoş geldin'}</Text>
            <Text style={styles.subtitle}>
              {isRegister
                ? 'Programlarını ve antrenman geçmişini hesabında güvenle sakla.'
                : 'Programlarına ve antrenman geçmişine devam etmek için giriş yap.'}
            </Text>
          </View>

          <View style={styles.formCard}>
            {isRegister && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Görünen ad</Text>
                <TextInput
                  autoComplete="name"
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                  maxLength={40}
                  onChangeText={setDisplayName}
                  placeholder="Adın"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  style={styles.input}
                  value={displayName}
                />
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>E-posta</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="ornek@email.com"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                style={styles.input}
                value={email}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Şifre</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  autoCapitalize="none"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                  onChangeText={setPassword}
                  placeholder="En az 8 karakter"
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry={!showPassword}
                  selectionColor={colors.primary}
                  style={styles.passwordInput}
                  value={password}
                />
                <Pressable
                  accessibilityLabel={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
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
                {isSubmitting ? 'Lütfen bekle…' : isRegister ? 'Hesap oluştur' : 'Giriş yap'}
              </Text>
              <Ionicons name="arrow-forward" size={19} color={colors.onPrimary} />
            </Pressable>
          </View>

          <View style={styles.switchModeRow}>
            <Text style={styles.switchModeText}>
              {isRegister ? 'Zaten hesabın var mı?' : 'Henüz hesabın yok mu?'}
            </Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => router.replace(isRegister ? './login' : './register')}>
              <Text style={styles.switchModeLink}>{isRegister ? 'Giriş yap' : 'Hesap oluştur'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function getFriendlyAuthError(message: string) {
  const normalizedMessage = message.toLocaleLowerCase('en-US');
  if (normalizedMessage.includes('invalid login credentials')) return 'E-posta veya şifre hatalı.';
  if (normalizedMessage.includes('email not confirmed')) return 'Önce e-posta adresini doğrulamalısın.';
  if (normalizedMessage.includes('already registered')) return 'Bu e-posta adresiyle daha önce hesap oluşturulmuş.';
  if (normalizedMessage.includes('password')) return 'Şifre güvenlik koşullarını karşılamıyor.';
  if (normalizedMessage.includes('rate limit')) return 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.';
  return message;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 40 },
    brandIcon: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 20,
      height: 64,
      justifyContent: 'center',
      marginBottom: 24,
      width: 64,
    },
    heading: { marginBottom: 22 },
    eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
    title: { color: colors.text, fontSize: 30, fontWeight: '900', marginTop: 6 },
    subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 8 },
    formCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 20,
      borderWidth: 1,
      gap: 16,
      padding: 18,
    },
    fieldGroup: { gap: 7 },
    label: { color: colors.text, fontSize: 13, fontWeight: '800' },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: 12,
      borderWidth: 1,
      color: colors.text,
      fontSize: 15,
      paddingHorizontal: 13,
      paddingVertical: 13,
    },
    passwordRow: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
    },
    passwordInput: { color: colors.text, flex: 1, fontSize: 15, paddingHorizontal: 13, paddingVertical: 13 },
    showPasswordButton: { padding: 12 },
    submitButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 12,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      marginTop: 3,
      paddingVertical: 14,
    },
    submitButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '900' },
    switchModeRow: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 20 },
    switchModeText: { color: colors.textSecondary, fontSize: 13 },
    switchModeLink: { color: colors.primaryIcon, fontSize: 13, fontWeight: '900' },
    pressed: { opacity: 0.7 },
  });
}
