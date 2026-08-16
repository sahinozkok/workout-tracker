import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getEmailConfirmRedirectUrl, getPasswordRecoveryRedirectUrl } from '@/lib/auth-redirect';
import { supabase } from '@/lib/supabase';

type AuthResult = { error?: string };
type SignUpResult = AuthResult & { needsEmailConfirmation?: boolean };

type AuthContextValue = {
  isLoading: boolean;
  /**
   * Şifre kurtarma oturumu açık. Bu sırada kullanıcı yalnızca yeni şifre
   * ekranını görebilir; sekmeler, workout, profil, arkadaşlık ve AI ekranları
   * açılmaz.
   */
  isPasswordRecovery: boolean;
  session: Session | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (displayName: string, email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  startPasswordRecovery: (accessToken: string, refreshToken: string) => Promise<AuthResult>;
  completePasswordRecovery: (newPassword: string) => Promise<AuthResult>;
  cancelPasswordRecovery: () => Promise<AuthResult>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Yalnızca "kurtarma sürüyor" bilgisini tutar. HİÇBİR token burada saklanmaz;
 * oturumun kendisini Supabase kendi depolama mekanizmasıyla yönetir. Uygulama
 * kurtarma sırasında kapatılıp açılırsa bu bayrak sayesinde kullanıcı normal
 * verilere değil yine yeni şifre ekranına düşer.
 */
const RECOVERY_PENDING_KEY = 'auth.password-recovery-pending';

/**
 * Bayrağın okunma sonucu. `unknown`, depolamanın okunamadığı belirsiz
 * durumdur ve sessizce `clear` sayılmaz: belirsizken normal uygulama verisi
 * açılmaz.
 */
type RecoveryPendingStatus = 'pending' | 'clear' | 'unknown';

async function readRecoveryPending(): Promise<RecoveryPendingStatus> {
  // Geçici bir depolama hatası tüm akışı bozmasın diye bir kez yeniden denenir.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return (await AsyncStorage.getItem(RECOVERY_PENDING_KEY)) === '1' ? 'pending' : 'clear';
    } catch {
      // Sonraki denemeye geçilir; hata nesnesi loglanmaz.
    }
  }

  return 'unknown';
}

/**
 * Bayrağı yazar. Dönen değer **kalıcı olarak yazılabildi mi** sorusunun
 * yanıtıdır; çağıran taraf buna göre fail-closed davranır.
 */
async function writeRecoveryPending(isPending: boolean): Promise<boolean> {
  try {
    if (isPending) await AsyncStorage.setItem(RECOVERY_PENDING_KEY, '1');
    else await AsyncStorage.removeItem(RECOVERY_PENDING_KEY);
    return true;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  // Bayrak okunmadan yönlendirme yapılmaz; aksi hâlde kurtarma sırasında
  // uygulama yeniden açıldığında sekmeler bir an görünebilirdi.
  const [isRecoveryFlagLoaded, setIsRecoveryFlagLoaded] = useState(false);
  /** Açılıştaki "takılı kalmış bayrak" kontrolü yalnızca bir kez yapılır. */
  const hasCheckedStaleFlagRef = useRef(false);
  /** `setSession` uçuştayken oturum henüz yoktur; bu bir takılı bayrak değildir. */
  const isStartingRecoveryRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (isMounted) setSession(data.session);
      })
      .finally(() => {
        if (isMounted) setIsSessionLoading(false);
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Normal `SIGNED_IN` ile kurtarma oturumu burada ayrılmaz: kurtarma
      // bayrağı yalnızca `startPasswordRecovery` içinde, `setSession`
      // çağrısından ÖNCE açılır. Bu yüzden normal giriş asla kurtarma
      // sayılmaz.
      setSession(nextSession);
      setIsSessionLoading(false);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      const status = await readRecoveryPending();

      if (status === 'unknown') {
        // Depolama belirsiz: kurtarma sürüyor olabilir. Normal uygulama
        // verilerini açmak yerine oturum yerel olarak kapatılır ve kullanıcı
        // giriş ekranına düşer. Bayrak "yüklendi" işareti ancak bundan sonra
        // verilir; bu sırada `isLoading` true kaldığı için hiçbir kullanıcı
        // verisi sağlayıcısı mount edilmez.
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {
          // Yerel çıkış da başarısızsa aşağıdaki `setIsPasswordRecovery(true)`
          // devreye girer ve uygulama yine kapalı kalır.
        }
      }

      if (!isMounted) return;

      if (status === 'pending') setIsPasswordRecovery(true);
      else if (status === 'unknown') {
        // Yerel çıkış sonrası hâlâ bir oturum kaldıysa kullanıcı sekmelere
        // düşmemeli: kurtarma kilidi açık bırakılır.
        const { data } = await supabase.auth.getSession();
        if (!isMounted) return;
        if (data.session) setIsPasswordRecovery(true);
      }

      setIsRecoveryFlagLoaded(true);
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // Bayrak açık ama ortada oturum yoksa kurtarılacak bir şey de yoktur:
  // önceki çalıştırmadan takılı kalmış bayrak temizlenir.
  //
  // Bu kontrol YALNIZCA açılışta, bir kez çalışır. Sürekli çalışsaydı
  // `startPasswordRecovery` sırasında da tetiklenirdi: bayrak `setSession`
  // tamamlanmadan önce açıldığı için "kurtarma açık ama henüz oturum yok"
  // anı normaldir ve kurtarmayı iptal etmemelidir.
  useEffect(() => {
    if (hasCheckedStaleFlagRef.current) return;
    if (!isRecoveryFlagLoaded || isSessionLoading) return;

    hasCheckedStaleFlagRef.current = true;
    if (isStartingRecoveryRef.current || !isPasswordRecovery || session) return;

    setIsPasswordRecovery(false);
    void writeRecoveryPending(false);
  }, [isPasswordRecovery, isRecoveryFlagLoaded, isSessionLoading, session]);

  /**
   * Kurtarma oturumunu kapatır. Başarısız olursa `false` döner ve çağıran
   * taraf kurtarma modunu AÇIK bırakır: uygulama hiçbir zaman "normal oturum
   * açık" gibi davranmaz.
   */
  const endRecoverySession = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) return true;

    // Ağ hatasında yerel oturumu kapatmak için ikinci bir deneme.
    const { error: localError } = await supabase.auth.signOut({ scope: 'local' });
    return !localError;
  }, []);

  const clearRecoveryState = useCallback(async () => {
    setIsPasswordRecovery(false);
    await writeRecoveryPending(false);
  }, []);

  /**
   * Başarısız bir kurtarma başlangıcını **fail-closed** kapatır: oturum
   * gerçekten kapatılabildiyse kurtarma durumu temizlenir. Kapatılamadıysa
   * (hem global hem yerel çıkış başarısız) kurtarma modu ve pending bayrağı
   * AÇIK bırakılır — aksi hâlde ayakta kalan oturumla birlikte sekmeler
   * açılırdı. Kullanıcı ekranda kalır ve iptali yeniden deneyebilir.
   */
  const abortRecoveryStart = useCallback(
    async (message: string): Promise<AuthResult> => {
      const didEnd = await endRecoverySession();
      if (!didEnd) return { error: 'recovery_signout_failed' };

      await clearRecoveryState();
      return { error: message };
    },
    [clearRecoveryState, endRecoverySession],
  );

  /**
   * Şifre sıfırlama e-postası ister. Supabase bu uç noktada hesabın var olup
   * olmadığını bilinçli olarak sızdırmaz; ekran da her durumda genel bir mesaj
   * gösterir. E-posta adresi ve hata nesnesi loglanmaz.
   */
  const requestPasswordReset = useCallback(async (email: string): Promise<AuthResult> => {
    const redirectTo = getPasswordRecoveryRedirectUrl();
    const { error } = await supabase.auth.resetPasswordForEmail(
      email,
      redirectTo ? { redirectTo } : {},
    );
    return error ? { error: error.message } : {};
  }, []);

  /**
   * Kurtarma bağlantısındaki token'larla geçici oturumu açar.
   *
   * Sıra bilinçlidir: önce kurtarma modu açılır, sonra `setSession` çağrılır.
   * Böylece oturum doğduğu anda bile kullanıcı sekmelere düşmez.
   * `setSession` token'ları Supabase sunucusunda doğrular (süresi geçmemişse
   * `GET /user`, geçmişse refresh); sahte veya süresi dolmuş token oturum
   * açmaz. Token'lar yalnızca bu çağrıya girer; state'e, log'a veya uygulamaya
   * ait bir depolama anahtarına yazılmaz.
   */
  const startPasswordRecovery = useCallback(
    async (accessToken: string, refreshToken: string): Promise<AuthResult> => {
      isStartingRecoveryRef.current = true;
      setIsPasswordRecovery(true);

      try {
        // Bayrak KALICI olarak yazılamadıysa oturum hiç açılmaz. Aksi hâlde
        // uygulama tam o anda kapanırsa geride bayraksız bir kurtarma oturumu
        // kalır ve sonraki açılışta normal sekmeler açılabilirdi.
        const didPersistFlag = await writeRecoveryPending(true);
        if (!didPersistFlag) {
          setIsPasswordRecovery(false);
          return { error: 'recovery_flag_not_persisted' };
        }

        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error || !data.session || !data.user) {
          return await abortRecoveryStart(error?.message ?? 'invalid_recovery_session');
        }

        // Oturumun gerçekten geçerli bir kullanıcıya ait olduğu ayrıca sunucuya
        // sorulur; doğrulanmadan yeni şifre formu açılmaz.
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) {
          return await abortRecoveryStart(userError?.message ?? 'invalid_recovery_session');
        }

        return {};
      } catch (error) {
        // Hata nesnesi token içerebileceği için loglanmaz, yalnızca mesajı
        // çağırana döner ve ekranda genel metne çevrilir.
        return await abortRecoveryStart(
          error instanceof Error ? error.message : 'invalid_recovery_session',
        );
      } finally {
        isStartingRecoveryRef.current = false;
      }
    },
    [abortRecoveryStart],
  );

  /** Yeni şifreyi yazar ve kurtarma oturumunu kapatır. */
  const completePasswordRecovery = useCallback(
    async (newPassword: string): Promise<AuthResult> => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      // Başarısızsa oturum kurtarma modunda kalır: kullanıcı sekmelere geçemez.
      if (error) return { error: error.message };

      const didEnd = await endRecoverySession();
      if (!didEnd) return { error: 'recovery_signout_failed' };

      await clearRecoveryState();
      return {};
    },
    [clearRecoveryState, endRecoverySession],
  );

  /** Kullanıcı vazgeçti: kurtarma oturumu kapatılır, bayrak temizlenir. */
  const cancelPasswordRecovery = useCallback(async (): Promise<AuthResult> => {
    const didEnd = await endRecoverySession();
    if (!didEnd) return { error: 'recovery_signout_failed' };

    await clearRecoveryState();
    return {};
  }, [clearRecoveryState, endRecoverySession]);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }, []);

  const signUp = useCallback(async (
    displayName: string,
    email: string,
    password: string,
  ): Promise<SignUpResult> => {
    // Onay e-postasındaki bağlantı, Supabase Dashboard'daki Site URL yerine
    // çalışılan ortamın gerçek adresine döner. Bu olmadan bağlantı varsayılan
    // Site URL'ine (örn. http://localhost:3000) gidip "bağlantı reddedildi"
    // hatası veriyordu.
    const emailRedirectTo = getEmailConfirmRedirectUrl();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });

    if (error) return { error: error.message };
    return { needsEmailConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async (): Promise<AuthResult> => {
    const { error } = await supabase.auth.signOut();
    return error ? { error: error.message } : {};
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      cancelPasswordRecovery,
      completePasswordRecovery,
      isLoading: isSessionLoading || !isRecoveryFlagLoaded,
      isPasswordRecovery,
      requestPasswordReset,
      session,
      signIn,
      signOut,
      signUp,
      startPasswordRecovery,
      user: session?.user ?? null,
    }),
    [
      cancelPasswordRecovery,
      completePasswordRecovery,
      isPasswordRecovery,
      isRecoveryFlagLoaded,
      isSessionLoading,
      requestPasswordReset,
      session,
      signIn,
      signOut,
      signUp,
      startPasswordRecovery,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth, AuthProvider içinde kullanılmalıdır.');
  }

  return context;
}
