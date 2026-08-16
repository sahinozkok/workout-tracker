import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { EmailConfirmOutcome, readEmailConfirmCallback } from '@/lib/auth-redirect';
import { supabase } from '@/lib/supabase';

/**
 * E-posta onay bağlantısının indiği ekran (`/confirm`).
 *
 * Bilinçli sınırlar:
 *  - **Başarı yalnızca sunucu doğrulamasıyla gösterilir.** URL'de `type=signup`
 *    ve `access_token` varsa token `supabase.auth.getUser(accessToken)` ile
 *    Supabase'e sorulur; geçerli bir kullanıcı dönmez veya e-posta doğrulanmış
 *    görünmezse geçersiz bağlantı ekranı açılır. Böylece elle yazılmış
 *    `?type=signup`, `?token_hash=…` veya sahte bir `access_token` başarı
 *    gösteremez.
 *  - `getUser(jwt)` yalnızca `GET /user` isteği yapar: oturum oluşturmaz,
 *    depolamaya yazmaz, auth state olayı üretmez. `setSession`,
 *    `exchangeCodeForSession` veya otomatik giriş KULLANILMAZ.
 *  - Token yalnızca geçici yerel değişkende tutulur; state'e yazılmaz,
 *    loglanmaz, hata mesajına konmaz, ekranda gösterilmez ve kalıcı
 *    depolamaya kaydedilmez.
 *  - Aynı callback iki kez işlenmez.
 *  - Unmount sonrası state yazılmaz.
 */
export default function ConfirmEmailScreen() {
  const url = Linking.useLinkingURL();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const [outcome, setOutcome] = useState<EmailConfirmOutcome>();
  const handledUrlRef = useRef<string>(undefined);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!url || handledUrlRef.current === url) return;

    const callback = readEmailConfirmCallback(url);
    // URL henüz gelmediyse işlenmiş sayılmaz; sonraki değerde tekrar denenir.
    if (!callback) return;
    handledUrlRef.current = url;

    let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;

    // Web'de adres çubuğunda kalan token parçası, kontrol bittikten sonra
    // temizlenir; geri tuşuyla tekrar açıldığında hassas veri taşınmaz.
    // Router kendi geçmiş senkronizasyonunu yaptıktan SONRA çalışması için
    // bir tick beklenir.
    function clearSensitiveUrlParts() {
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;
      cleanupTimeout = setTimeout(() => {
        if (window.location.hash || window.location.search) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }, 0);
    }

    if (callback.kind === 'error') {
      if (isMountedRef.current) setOutcome({ status: 'error', reason: callback.reason });
      clearSensitiveUrlParts();
      return () => clearTimeout(cleanupTimeout);
    }

    // Token yalnızca bu yerel değişkende yaşar ve tek bir isteğe girer.
    const accessToken = callback.accessToken;

    void (async () => {
      let nextOutcome: EmailConfirmOutcome = { status: 'error', reason: 'invalid' };
      try {
        const { data, error } = await supabase.auth.getUser(accessToken);
        const user = data?.user;
        // Sunucu geçerli bir kullanıcı döndürdü ve e-posta doğrulanmış mı?
        if (!error && user && (user.email_confirmed_at || user.confirmed_at)) {
          nextOutcome = { status: 'success' };
        }
      } catch {
        // Ağ/sunucu hatası: sahte başarı gösterilmez. Hata nesnesi token
        // içerebileceği için hiçbir yere yazılmaz veya loglanmaz.
      }

      if (isMountedRef.current) setOutcome(nextOutcome);
      clearSensitiveUrlParts();
    })();

    return () => clearTimeout(cleanupTimeout);
  }, [url]);

  if (!outcome) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.subtitle}>{t('auth.confirmChecking')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isSuccess = outcome.status === 'success';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.brandIcon, !isSuccess && styles.brandIconError]}>
          <Ionicons
            name={isSuccess ? 'checkmark' : 'alert-circle-outline'}
            size={30}
            color={colors.onPrimary}
          />
        </View>

        <View style={styles.heading}>
          <Text style={styles.eyebrow}>{t('auth.brand')}</Text>
          <Text style={styles.title}>
            {isSuccess ? t('auth.confirmSuccessTitle') : t('auth.confirmErrorTitle')}
          </Text>
          <Text style={styles.subtitle}>
            {isSuccess
              ? t('auth.confirmSuccessBody')
              : outcome.reason === 'expired'
                ? t('auth.confirmExpiredBody')
                : t('auth.confirmInvalidBody')}
          </Text>
          {isSuccess && <Text style={styles.subtitle}>{t('auth.confirmNoAutoLogin')}</Text>}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/login')}
          style={({ pressed }) => [styles.submitButton, pressed && styles.pressed]}>
          <Text style={styles.submitButtonText}>{t('auth.login')}</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
        </Pressable>

        {!isSuccess && (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.replace('/register')}
            style={styles.secondaryLink}>
            <Text style={styles.secondaryLinkText}>{t('auth.goRegister')}</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
    secondaryLink: { alignItems: 'center', justifyContent: 'center', marginTop: 18, minHeight: Layout.minTouchSize },
    secondaryLinkText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
