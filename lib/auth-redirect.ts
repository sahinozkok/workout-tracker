import * as Linking from 'expo-linking';

/**
 * E-posta onay bağlantısının uygulamaya döneceği yer.
 *
 * Expo Router'da `(auth)` bir **route group**'tur ve URL'de görünmez:
 * `app/(auth)/confirm.tsx` dosyası `/confirm` yoluna karşılık gelir. Supabase
 * Dashboard'daki Redirect URL listesi de bu yolu içermelidir.
 */
/**
 * Baştaki `/` bilinçli olarak YOKTUR: `Linking.createURL('/confirm')` native
 * tarafta `workouttracker:///confirm` (üç eğik çizgi) üretebiliyor.
 * `createURL('confirm')` her ortamda doğru sonucu verir:
 *   - web:             `<origin>/confirm`
 *   - dev/prod build:  `workouttracker://confirm`
 *   - Expo Go:         `exp://<ip>:8081/--/confirm`
 * Route'un gerçek web yolu yine `/confirm`'dür.
 */
export const EMAIL_CONFIRM_PATH = 'confirm';

/**
 * Çalışılan ortama uygun `emailRedirectTo` üretir:
 *   - Web geliştirme: `http://localhost:8081/confirm` (Metro portu neyse o;
 *     `window.location.origin` kullanılır).
 *   - Web yayın: `https://<domain>/confirm`.
 *   - Development/standalone build: `workouttracker://confirm` (app.json'daki
 *     `scheme`).
 *   - Expo Go: `exp://<ip>:8081/--/confirm`.
 *
 * Statik web dışa aktarımında (prerender) `window` yoktur; bu durumda
 * `undefined` döner ve `signUp` çağrısına parametre eklenmez.
 */
export function getEmailConfirmRedirectUrl(): string | undefined {
  const url = Linking.createURL(EMAIL_CONFIRM_PATH);
  return url ? url : undefined;
}

/** Ekranda gösterilen nihai sonuç. Hiçbir varyantı token taşımaz. */
export type EmailConfirmOutcome =
  | { status: 'success' }
  | { status: 'error'; reason: 'expired' | 'invalid' };

/**
 * URL'den okunan ham sonuç. `verify` durumundaki `accessToken` yalnızca
 * Supabase'e sorulmak üzere GEÇİCİ olarak taşınır: state'e yazılmaz,
 * loglanmaz, ekranda gösterilmez ve kalıcı depolamaya kaydedilmez.
 */
export type EmailConfirmCallback =
  | { kind: 'verify'; accessToken: string }
  | { kind: 'error'; reason: 'expired' | 'invalid' };

/** Her iki akışta da okunan, hassas olmayan anahtarlar. */
const COMMON_VALUE_KEYS = ['error', 'error_code', 'error_description', 'type'];

/**
 * E-posta onayı için okunan anahtarlar. `refresh_token`, `code` ve
 * `token_hash` bilinçli olarak listede DEĞİLDİR: onay akışı bunları
 * kullanmaz ve değerleri hiçbir yere taşınmamalı.
 */
const CONFIRM_VALUE_KEYS = [...COMMON_VALUE_KEYS, 'access_token'];

/**
 * Şifre kurtarma yalnızca burada `refresh_token`'ı da okur: Supabase'in
 * `setSession()` çağrısı iki token'ı birlikte ister. Değerler yine hiçbir
 * state'e, log'a veya uygulamaya ait depolamaya girmez.
 */
const RECOVERY_VALUE_KEYS = [...CONFIRM_VALUE_KEYS, 'refresh_token'];

function readUrlParams(url: string, valueKeys: string[]) {
  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : url.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf('?');
  const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1);

  const keys = new Set<string>();
  const values: Record<string, string> = {};

  for (const chunk of [query, fragment]) {
    for (const part of chunk.split('&')) {
      if (!part) continue;
      const equalsIndex = part.indexOf('=');
      const rawKey = equalsIndex === -1 ? part : part.slice(0, equalsIndex);
      const key = safeDecode(rawKey);
      if (!key) continue;
      keys.add(key);
      if (valueKeys.includes(key) && !(key in values)) {
        values[key] = equalsIndex === -1 ? '' : safeDecode(part.slice(equalsIndex + 1));
      }
    }
  }

  return { keys, values };
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    // Bozuk kaçış dizisi: ham değer kullanılır, hata fırlatılmaz.
    return value;
  }
}

/**
 * Supabase'in onay bağlantısından döndüğü URL'i yorumlar.
 *
 * Bu projede `flowType` varsayılan olarak **implicit**'tir (auth-js 2.112
 * varsayılanı) ve `detectSessionInUrl: false` olduğundan istemci URL'e hiç
 * dokunmaz. Bu yüzden gelen adres iki biçimden biri olur:
 *   - Başarılı:  `<redirect>#access_token=…&refresh_token=…&type=signup`
 *   - Başarısız: `<redirect>#error=access_denied&error_code=otp_expired&…`
 *
 * Kurallar:
 *   - Hata parametreleri HER ZAMAN önceliklidir; URL'de token da olsa hata
 *     gösterilir.
 *   - `type` değeri `signup` değilse başarı yolu hiç açılmaz.
 *   - `access_token` yoksa başarı yolu açılmaz. Yalnızca `type`, `code` veya
 *     `token_hash` bulunması sahte başarıya yeterdi; bu yüzden tek başına
 *     hiçbiri kabul edilmez.
 *   - Token'ın kendisi burada doğrulanmaz; çağıran taraf Supabase sunucusuna
 *     sorar. Bu fonksiyon yalnızca "sorulmaya değer bir token var mı"yı söyler.
 *   - PKCE (`?code=…`) bu projede kullanılmıyor; doğrulanmamış `code` başarı
 *     sayılmaz. PKCE'ye geçilirse ayrıca ve güvenli biçimde eklenmelidir.
 *
 * `undefined` dönmesi "URL henüz gelmedi" demektir (native'de ilk render).
 */
export function readEmailConfirmCallback(url: string | null | undefined): EmailConfirmCallback | undefined {
  if (!url) return undefined;

  const { keys, values } = readUrlParams(url, CONFIRM_VALUE_KEYS);

  const failure = readFailure(keys, values);
  if (failure) return failure;

  const accessToken = values.access_token;
  // `type=recovery` token'ı burada ASLA kabul edilmez: kurtarma akışının
  // token'ı yalnızca `/reset-password` ekranında işlenir.
  if (values.type === 'signup' && accessToken) return { kind: 'verify', accessToken };

  // Doğrudan `/confirm` adresine gidilmiş, eksik ya da sahte parametreler
  // gelmiş: doğrulanacak bir şey yok.
  return { kind: 'error', reason: 'invalid' };
}

/** Hata parametreleri her iki akışta da her şeyden önce gelir. */
function readFailure(
  keys: Set<string>,
  values: Record<string, string>,
): { kind: 'error'; reason: 'expired' | 'invalid' } | undefined {
  if (!keys.has('error') && !keys.has('error_code') && !keys.has('error_description')) return undefined;

  const marker = `${values.error_code ?? ''} ${values.error ?? ''} ${values.error_description ?? ''}`
    .toLocaleLowerCase('en-US');
  return { kind: 'error', reason: marker.includes('expired') ? 'expired' : 'invalid' };
}

// ---------------------------------------------------------------------------
// Şifre kurtarma
// ---------------------------------------------------------------------------

/**
 * Şifre sıfırlama bağlantısının indiği yol. `app/reset-password.tsx` bilinçli
 * olarak `(auth)` grubunun DIŞINDA, kök Stack'tedir: kurtarma sırasında
 * Supabase geçici bir oturum açar ve ekran auth grubunda olsaydı guard
 * kullanıcıyı sekmelere düşürebilirdi.
 *
 * Baştaki `/` yine yoktur (`workouttracker:///reset-password` olmasın diye).
 */
export const PASSWORD_RECOVERY_PATH = 'reset-password';

/**
 * `resetPasswordForEmail` için ortama uygun `redirectTo`:
 *   - Web geliştirme: `http://localhost:8081/reset-password`
 *   - Web yayın:      `https://<domain>/reset-password`
 *   - Native build:   `workouttracker://reset-password`
 *   - Expo Go:        `exp://<ip>:8081/--/reset-password`
 */
export function getPasswordRecoveryRedirectUrl(): string | undefined {
  const url = Linking.createURL(PASSWORD_RECOVERY_PATH);
  return url ? url : undefined;
}

/**
 * URL'den okunan ham kurtarma sonucu. `recover` durumundaki token'lar yalnızca
 * `supabase.auth.setSession()` çağrısına verilmek üzere GEÇİCİ olarak taşınır.
 */
export type PasswordRecoveryCallback =
  | { kind: 'recover'; accessToken: string; refreshToken: string }
  | { kind: 'error'; reason: 'expired' | 'invalid' };

/**
 * Supabase'in şifre sıfırlama bağlantısından döndüğü URL'i yorumlar.
 *
 * Kurallar (onay akışıyla aynı sıkılıkta):
 *   - Hata parametreleri HER ZAMAN önceliklidir.
 *   - Yalnızca `type=recovery` kabul edilir; `signup` token'ı reddedilir.
 *   - Hem `access_token` hem `refresh_token` zorunludur (`setSession` ikisini
 *     birden ister ve eksik olanı zaten reddeder).
 *   - Tek başına `code`, `token_hash` veya `type` başarı sayılmaz.
 *   - Token'ların geçerliliği burada denenmez; `setSession` Supabase
 *     sunucusunda doğrular.
 */
export function readPasswordRecoveryCallback(
  url: string | null | undefined,
): PasswordRecoveryCallback | undefined {
  if (!url) return undefined;

  const { keys, values } = readUrlParams(url, RECOVERY_VALUE_KEYS);

  const failure = readFailure(keys, values);
  if (failure) return failure;

  const accessToken = values.access_token;
  const refreshToken = values.refresh_token;
  if (values.type === 'recovery' && accessToken && refreshToken) {
    return { kind: 'recover', accessToken, refreshToken };
  }

  return { kind: 'error', reason: 'invalid' };
}
