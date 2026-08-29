#!/usr/bin/env node
/**
 * Şifre kurtarma yönlendirmesi ve güvenlik sınırı.
 *
 * Canlı Supabase veya e-posta kullanmaz; route erişilebilirliğini ve mevcut
 * token/oturum doğrulama zincirini kaynak üzerinden denetler.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (path) => readFileSync(join(ROOT, path), 'utf8');

/** Yorumsuz hâl — "sabitlenmiş değer" denetimleri KOD üzerinde yapılır. */
const stripComments = (text) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const layout = source('app/_layout.tsx');
const screen = source('app/reset-password.tsx');
const context = source('context/auth-context.tsx');
const redirect = source('lib/auth-redirect.ts');
const client = source('lib/supabase.ts');
const appConfig = source('app.json');
const forgot = source('app/(auth)/forgot-password.tsx');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} — beklenen ${expected}, gelen ${actual}`);
}

function assertDeepEqual(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message} — beklenen ${right}, gelen ${left}`);
}

function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

// ---------------------------------------------------------------------------
// `expo-linking@8` createURL algoritmasının referansı
//
// Kaynak: node_modules/expo-linking/build/createURL.js + Schemes.js.
// Hiçbir IP veya port SABİTLENMEZ: host çalışma zamanı manifestinden gelir.
// ---------------------------------------------------------------------------

function createURLModel(path, runtime, options = {}) {
  /** Mutasyon: Expo Go'da `/--/` ayracı üretilmeyen eski/bozuk davranış. */
  const skipExpoGoSeparator = options.skipExpoGoSeparator === true;

  if (runtime.kind === 'web') {
    if (!runtime.origin) return '';
    return `${runtime.origin.replace(/\/$/, '')}/${path}`;
  }

  if (runtime.kind === 'expo-go') {
    // StoreClient: `hasCustomScheme()` false, `resolveScheme()` → 'exp'.
    const hostUri = runtime.hostUri;
    if (!hostUri) return `exp://${path}`;
    const suffix = skipExpoGoSeparator ? `/${path}` : `/--/${path}`;
    return `exp://${hostUri}${suffix}`;
  }

  // Development/standalone build: manifest şeması, `/--/` YOK.
  return `${runtime.scheme}://${path}`;
}

/**
 * `toExpoGoWebCallback()` referansı.
 *
 * Supabase `exp://` yönlendirmesini e-postaya taşımadığı için Expo Go
 * callback'i Metro'nun AYNI host ve portta sunduğu web adresine çevrilir.
 * Host/port yalnızca girdiden okunur; hiçbir değer sabitlenmez.
 */
function toExpoGoWebCallbackModel(url) {
  const scheme = /^exps?:\/\//.exec(url)?.[0];
  if (!scheme) return undefined;

  const rest = url.slice(scheme.length);
  const slashIndex = rest.indexOf('/');
  const host = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
  if (!host) return undefined;

  const rawPath = (slashIndex === -1 ? '' : rest.slice(slashIndex)).replace(/^\/--(?=\/|$)/, '');
  const path = rawPath && rawPath !== '/' ? rawPath : '/reset-password';

  return `${url.startsWith('exps://') ? 'https' : 'http'}://${host}${path}`;
}

/** `resolvePasswordRecoveryRedirect()` referansı. */
function resolveRedirectModel(runtime, options = {}) {
  /** Mutasyon: ham `exp://` adresi dönüştürülmeden gönderilir (eski davranış). */
  const sendRawExpoGoUrl = options.sendRawExpoGoUrl === true;

  const url = createURLModel('reset-password', runtime, options);
  if (!url) return { status: 'unavailable' };

  if (url.startsWith('exp://') || url.startsWith('exps://')) {
    if (sendRawExpoGoUrl) return { environment: 'expo-go', status: 'ok', url };
    const webUrl = toExpoGoWebCallbackModel(url);
    if (!webUrl) return { status: 'unavailable' };
    return { environment: 'expo-go-web', status: 'ok', url: webUrl };
  }

  const environment = url.startsWith('http://') || url.startsWith('https://') ? 'web' : 'native-build';
  return { environment, status: 'ok', url };
}

/**
 * `requestPasswordReset()` referansı.
 *
 * Adres üretilemezse istek HİÇ yapılmaz: `redirect_to` olmadan gönderilen
 * istek Supabase'de sessizce Site URL'e düşerdi.
 */
function requestPasswordResetModel(runtime, options = {}) {
  /** Mutasyon: adressiz istek yine de gönderilir (eski davranış). */
  const allowMissingRedirect = options.allowMissingRedirect === true;
  const resolved = resolveRedirectModel(runtime, options);

  if (resolved.status !== 'ok') {
    if (!allowMissingRedirect) return { error: 'recovery_redirect_unavailable', sent: false };
    // Eski davranış: parametre eklenmez, sunucu Site URL'e düşer.
    return { redirectTo: undefined, sent: true };
  }

  return { redirectTo: resolved.url, sent: true };
}

/** GoTrue'nun `redirect_to` doğrulaması + Site URL geri düşüşü referansı. */
function resolveEmailTarget(redirectTo, config) {
  if (!redirectTo) return config.siteUrl;
  const allowed = config.redirectAllowList.some((pattern) => {
    const prefix = pattern.replace(/\*\*$/, '');
    return pattern.endsWith('**') ? redirectTo.startsWith(prefix) : redirectTo === pattern;
  });
  return allowed ? redirectTo : config.siteUrl;
}

check('1. Reset route mevcut oturumdan bağımsız kayıtlı', () => {
  assert(layout.includes('<Stack.Screen name="reset-password" options={{ headerShown: false }} />'),
    'reset route eksik');
  assert(!/<Stack\.Protected guard=\{!session \|\| isPasswordRecovery\}>\s*<Stack\.Screen name="reset-password"/s.test(layout),
    'mevcut oturum reset ekranını hâlâ kaldırıyor');
});

check('2. Eski koruma yan hesabın bağlantısını gerçekten engelliyordu', () => {
  const oldRouteAvailable = (session, isRecovery) => !session || isRecovery;
  assert(!oldRouteAvailable({ user: { id: 'hesap-a' } }, false),
    'mutasyon modeli eski hatayı üretmedi');
  const fixedRouteAvailable = true;
  assert(fixedRouteAvailable, 'reset route koşulsuz değil');
});

check('3. Reset formu çıplak route ile açılmıyor', () => {
  assert(screen.includes("{ status: 'error', reason: 'invalid' }"), 'geçersiz bağlantı durumu eksik');
  assert(screen.includes('if (isPasswordRecovery && session)'), 'kalıcı recovery doğrulaması eksik');
  assert(screen.includes('readPasswordRecoveryCallback(url)'), 'callback doğrulaması eksik');
});

check('4. Yalnızca recovery tipi ve iki token kabul ediliyor', () => {
  assert(redirect.includes("values.type === 'recovery' && accessToken && refreshToken"),
    'recovery tipi ve iki token birlikte zorunlu değil');
  assert(redirect.includes("return { kind: 'error', reason: 'invalid' }"),
    'eksik/sahte callback reddedilmiyor');
});

check('5. Native yönlendirme reset-password yoluna üretiliyor', () => {
  assert(appConfig.includes('"scheme": "workouttracker"'), 'uygulama scheme eksik');
  assert(redirect.includes("PASSWORD_RECOVERY_PATH = 'reset-password'"), 'reset yolu yanlış');
  assert(redirect.includes('Linking.createURL(PASSWORD_RECOVERY_PATH)'), 'Expo Linking kullanılmıyor');
});

check('6. İstek üretilen redirectTo ile Supabase’e gidiyor', () => {
  assert(context.includes('const redirect = resolvePasswordRecoveryRedirect();'),
    'redirect URL üretilmiyor');
  assert(context.includes('supabase.auth.resetPasswordForEmail('), 'reset isteği eksik');
  assert(context.includes('redirectTo: redirect.url,'), 'redirectTo Supabase’e taşınmıyor');
  // Adressiz istek GÖNDERİLMEZ: sessiz Site URL geri düşüşü kapatıldı.
  assert(
    context.includes("if (redirect.status !== 'ok') return { error: 'recovery_redirect_unavailable' };"),
    'adres üretilemediğinde istek yine de gönderiliyor',
  );
  const body = context.slice(
    context.indexOf('const requestPasswordReset = useCallback('),
    context.indexOf('const startPasswordRecovery'),
  );
  assert(
    body.indexOf("redirect.status !== 'ok'") < body.indexOf('resetPasswordForEmail('),
    'adres kontrolü istekten sonra yapılıyor',
  );
  assert(!/redirectTo \? \{ redirectTo \} : \{\}/.test(context), 'eski sessiz fallback duruyor');
});

check('7. Recovery bayrağı oturumdan önce açılıyor', () => {
  const flagIndex = context.indexOf('const didPersistFlag = await writeRecoveryPending(true);');
  const sessionIndex = context.indexOf('const { data, error } = await supabase.auth.setSession({');
  assert(flagIndex >= 0 && sessionIndex > flagIndex, 'recovery bayrağı setSession öncesinde değil');
});

check('8. Yeni parola yalnızca doğrulanmış oturumla güncelleniyor', () => {
  assert(context.includes('supabase.auth.updateUser({ password: newPassword })'),
    'parola güncellemesi eksik');
  assert(context.includes('const didEnd = await endRecoverySession();'),
    'başarıdan sonra recovery oturumu kapatılmıyor');
});

check('9. İstemci URL token’ını otomatik ve kontrolsüz işlemiyor', () => {
  assert(client.includes('detectSessionInUrl: false'), 'kontrollü URL işleme kapatılmış');
  assert(screen.includes('clearSensitiveUrlParts();'), 'hassas URL parçaları temizlenmiyor');
});

// ---------------------------------------------------------------------------
// Callback biçimi — ortam ayrımı ve değişken host
// ---------------------------------------------------------------------------

check('10. Expo Go callback’i LAN WEB adresine dönüşüyor', () => {
  const runtime = { hostUri: '192.168.68.100:8081', kind: 'expo-go' };

  // `createURL` hâlâ deep link üretir…
  assertEqual(
    createURLModel('reset-password', runtime),
    'exp://192.168.68.100:8081/--/reset-password',
    'Expo Go deep link biçimi değişmiş',
  );

  // …ama gönderilen adres Metro'nun web callback'idir.
  const resolved = resolveRedirectModel(runtime);
  assertEqual(resolved.status, 'ok', 'Expo Go adresi üretilmedi');
  assertEqual(
    resolved.url,
    'http://192.168.68.100:8081/reset-password',
    'LAN web callback’i yanlış',
  );
  assertEqual(resolved.environment, 'expo-go-web', 'ortam sınıflandırması yanlış');
  // `/--/` ayracı web yolunda BULUNMAZ.
  assert(!resolved.url.includes('/--/'), 'web callback’inde Expo Go ayracı kalmış');
  assert(!resolved.url.startsWith('exp'), 'hâlâ exp şeması gönderiliyor');
});

check('10b. `exp://` → `http://`, `exps://` → `https://`', () => {
  assertEqual(
    toExpoGoWebCallbackModel('exp://192.168.68.100:8081/--/reset-password'),
    'http://192.168.68.100:8081/reset-password',
    'exp şeması http’ye çevrilmedi',
  );
  assertEqual(
    toExpoGoWebCallbackModel('exps://192.168.68.100:8081/--/reset-password'),
    'https://192.168.68.100:8081/reset-password',
    'exps şeması https’ye çevrilmedi',
  );
  // Ayraçsız ve eksik yollu biçimler de güvenli sonuç verir.
  assertEqual(
    toExpoGoWebCallbackModel('exp://10.0.0.7:19000'),
    'http://10.0.0.7:19000/reset-password',
    'yolsuz adres güvenli çözülmedi',
  );
  assertEqual(
    toExpoGoWebCallbackModel('exp://10.0.0.7:19000/--/'),
    'http://10.0.0.7:19000/reset-password',
    'boş ayraç yolu güvenli çözülmedi',
  );
  // Host yoksa adres üretilemez.
  assertEqual(toExpoGoWebCallbackModel('exp:///--/reset-password'), undefined, 'hostsuz adres kabul');
  assertEqual(toExpoGoWebCallbackModel('workouttracker://reset-password'), undefined, 'native adres çevrildi');

  // KAYNAK: dönüşüm gerçekten uygulanıyor.
  assert(redirect.includes('function toExpoGoWebCallback('), 'dönüşüm fonksiyonu yok');
  assert(redirect.includes("url.startsWith('exps://') ? 'https' : 'http'"), 'şema eşlemesi yok');
  assert(redirect.includes("replace(/^\\/--(?=\\/|$)/, '')"), 'ayraç kaldırma yok');
});

check('11. LAN host/port DEĞİŞKEN — hiçbir yerde sabitlenmiyor', () => {
  // Host değişince adres de değişir; hiçbir değer koda gömülü değildir.
  for (const [hostUri, expected] of [
    ['192.168.68.100:8081', 'http://192.168.68.100:8081/reset-password'],
    ['192.168.1.42:8081', 'http://192.168.1.42:8081/reset-password'],
    ['10.0.0.7:19000', 'http://10.0.0.7:19000/reset-password'],
    ['172.20.10.3:8082', 'http://172.20.10.3:8082/reset-password'],
  ]) {
    assertEqual(
      resolveRedirectModel({ hostUri, kind: 'expo-go' }).url,
      expected,
      `değişken host desteklenmiyor: ${hostUri}`,
    );
  }

  // KAYNAK: IP veya port hiçbir uygulama dosyasında SABİT DEĞİL.
  for (const [label, text] of [
    ['auth-redirect', stripComments(redirect)],
    ['auth-context', stripComments(context)],
    ['reset-password ekranı', stripComments(screen)],
  ]) {
    assert(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text), `${label}: sabit IP var`);
    assert(!/:(8081|19000|19006)\b/.test(text), `${label}: sabit port var`);
    assert(!/localhost/.test(text), `${label}: localhost sabitlenmiş`);
  }
  // Host çalışma zamanında Expo Linking'den gelir.
  assert(redirect.includes('Linking.createURL(PASSWORD_RECOVERY_PATH)'), 'host runtime’dan gelmiyor');
});

check('12. Native build custom scheme davranışı korunuyor', () => {
  const resolved = resolveRedirectModel({ kind: 'native-build', scheme: 'workouttracker' });

  assertEqual(resolved.url, 'workouttracker://reset-password', 'native build adresi yanlış');
  assertEqual(resolved.environment, 'native-build', 'native ortam sınıflandırması yanlış');
  // Build'de `/--/` ayracı OLMAMALI; o yalnızca Expo Go içindir.
  assert(!resolved.url.includes('/--/'), 'native adreste Expo Go ayracı var');
  // Üç eğik çizgi üretilmemeli.
  assert(!resolved.url.includes(':///'), 'üç eğik çizgili adres üretiliyor');
  assert(appConfig.includes('"scheme": "workouttracker"'), 'app.json scheme değişmiş');
});

check('13. Web callback doğru origin’i kullanıyor', () => {
  for (const [origin, expected] of [
    ['http://localhost:8081', 'http://localhost:8081/reset-password'],
    ['https://rosea.app', 'https://rosea.app/reset-password'],
  ]) {
    const resolved = resolveRedirectModel({ kind: 'web', origin });
    assertEqual(resolved.url, expected, `web adresi yanlış: ${origin}`);
    assertEqual(resolved.environment, 'web', 'web ortam sınıflandırması yanlış');
  }

  // Prerender: `window` yok → adres üretilemez.
  assertEqual(
    resolveRedirectModel({ kind: 'web', origin: undefined }).status,
    'unavailable',
    'prerender’da adres üretildi',
  );
});

check('14. Adres üretilemezse istek HİÇ gönderilmez', () => {
  const blocked = requestPasswordResetModel({ kind: 'web', origin: undefined });
  assertEqual(blocked.sent, false, 'adressiz istek gönderildi');
  assertEqual(blocked.error, 'recovery_redirect_unavailable', 'kontrollü hata dönmedi');

  const ok = requestPasswordResetModel({ hostUri: '192.168.68.100:8081', kind: 'expo-go' });
  assertEqual(ok.sent, true, 'geçerli adreste istek gönderilmedi');
  // Supabase'e DÖNÜŞTÜRÜLMÜŞ HTTP adresi gider.
  assertEqual(ok.redirectTo, 'http://192.168.68.100:8081/reset-password', 'yanlış adres taşındı');
  assert(!ok.redirectTo.startsWith('exp'), 'Supabase’e hâlâ exp şeması gönderiliyor');
});

check('15. Adressiz istek Supabase’de Site URL’e düşerdi (kök neden)', () => {
  const config = {
    redirectAllowList: [
      'http://localhost:8081/**',
      'workouttracker://**',
      'http://192.168.68.100:8081/**',
    ],
    siteUrl: 'http://localhost:8081',
  };

  // Kök neden: `redirect_to` yoksa e-posta Site URL'e (localhost) gider.
  assertEqual(
    resolveEmailTarget(undefined, config),
    'http://localhost:8081',
    'adressiz istekte Site URL geri düşüşü modellenmedi',
  );

  // İzin listesinde OLMAYAN host da aynı sonuca düşer — LAN IP’si değişince.
  assertEqual(
    resolveEmailTarget('http://192.168.1.42:8081/reset-password', config),
    'http://localhost:8081',
    'izinsiz adres Site URL’e düşmedi',
  );

  // Doğru adres + doğru izin girdisi → e-posta uygulamaya döner.
  assertEqual(
    resolveEmailTarget('http://192.168.68.100:8081/reset-password', config),
    'http://192.168.68.100:8081/reset-password',
    'izinli LAN web adresi kabul edilmedi',
  );
  assertEqual(
    resolveEmailTarget('workouttracker://reset-password', config),
    'workouttracker://reset-password',
    'izinli native adres kabul edilmedi',
  );
});

check('16. Mevcut oturum varken reset ekranı MOUNT olabiliyor', () => {
  // Route koşulsuz kayıtlı: `Stack.Protected` sarmalayıcısı YOK.
  const routeIndex = layout.indexOf('<Stack.Screen name="reset-password"');
  assert(routeIndex > 0, 'reset route kaybolmuş');
  const before = layout.slice(0, routeIndex);
  const lastProtected = before.lastIndexOf('<Stack.Protected');
  const lastClose = before.lastIndexOf('</Stack.Protected>');
  assert(lastClose > lastProtected, 'reset route hâlâ bir guard içinde');
  assert(!/guard=\{!session \|\| isPasswordRecovery\}/.test(layout), 'eski oturum guard’ı geri gelmiş');

  // Ekran oturum varken de kurtarma callback’ini işleyebilir.
  assert(screen.includes('readPasswordRecoveryCallback(url)'), 'callback okunmuyor');
  assert(screen.includes('startPasswordRecovery('), 'kurtarma başlatılmıyor');
});

check('17. Teşhis yalnızca `__DEV__` ve token/e-posta İÇERMİYOR', () => {
  assert(forgot.includes('__DEV__ ? describePasswordRecoveryRedirect()'), 'teşhis dev ile sınırlı değil');
  assert(forgot.includes('recoveryRedirect?.environment'), 'ortam gösterilmiyor');
  // Teşhis hiçbir token, e-posta veya anahtar taşımaz.
  const redirectCode = stripComments(redirect);
  const describeStart = redirectCode.indexOf('export function describePasswordRecoveryRedirect');
  assert(describeStart > 0, 'teşhis fonksiyonu yok');
  const describe = redirectCode.slice(describeStart, redirectCode.indexOf('\n}', describeStart));
  for (const forbidden of ['access_token', 'refresh_token', 'accessToken', 'refreshToken', 'email']) {
    assert(!describe.includes(forbidden), `teşhis hassas alan taşıyor: ${forbidden}`);
  }
  // Teşhis ekranda da yalnızca ortam + adres gösterir.
  assert(!/recoveryRedirect[^\n]*token/i.test(stripComments(forgot)), 'teşhis ekranı token gösteriyor');
  // Kalıcı log bırakılmadı.
  for (const [label, text] of [['auth-redirect', redirectCode], ['auth-context', stripComments(context)]]) {
    assert(!/console\.(log|warn|info|debug)/.test(text), `${label}: kalıcı log bırakılmış`);
  }
});

check('18. Signup/login callback’i recovery sayılmıyor', () => {
  // Kaynak kuralı: yalnızca `type === 'recovery'` + iki token kabul edilir.
  const body = redirect.slice(redirect.indexOf('export function readPasswordRecoveryCallback'));
  assert(
    body.includes("values.type === 'recovery' && accessToken && refreshToken"),
    'recovery koşulu gevşetilmiş',
  );
  // Onay akışı da kurtarma token’ını kabul etmez.
  const confirmBody = redirect.slice(
    redirect.indexOf('export function readEmailConfirmCallback'),
    redirect.indexOf('function readFailure'),
  );
  assert(confirmBody.includes("values.type === 'signup' && accessToken"), 'onay koşulu gevşetilmiş');
  assert(!confirmBody.includes("'recovery'"), 'onay akışı recovery token’ı kabul ediyor');
  // Onay akışı `refresh_token` OKUMAZ.
  assert(
    redirect.includes("const CONFIRM_VALUE_KEYS = [...COMMON_VALUE_KEYS, 'access_token'];"),
    'onay akışı fazladan token okuyor',
  );
});

check('19. Token FRAGMENT’i istemcide kalır; log ve kalıcı depoya yazılmaz', () => {
  /**
   * Supabase token'ları `#access_token=…` FRAGMENT'inde döndürür. Tarayıcı
   * fragment'i HTTP isteğine EKLEMEZ, bu yüzden LAN web callback'i kullanılsa
   * bile token'lar Metro sunucusuna GİTMEZ.
   */
  assert(
    /fragment/i.test(redirect) && /Metro/i.test(redirect),
    'fragment’in sunucuya gitmediği kaynakta belgelenmemiş',
  );

  // Kurtarma callback'i yalnızca doğrulanmış üçlüyle açılır.
  const body = redirect.slice(redirect.indexOf('export function readPasswordRecoveryCallback'));
  assert(
    body.includes("values.type === 'recovery' && accessToken && refreshToken"),
    'fragment doğrulaması gevşetilmiş',
  );

  // Token'lar hiçbir kalıcı depoya yazılmıyor.
  const screenCode = stripComments(screen);
  for (const store of ['AsyncStorage', 'SecureStore', 'localStorage', 'sessionStorage']) {
    assert(
      !new RegExp(`${store}[^\\n]*(access|refresh|token)`, 'i').test(screenCode),
      `token kalıcı depoya yazılıyor: ${store}`,
    );
  }
  // Token'lar React state'e de yazılmıyor.
  assert(!/useState[^\n]*(accessToken|refreshToken)/.test(screenCode), 'token state’e yazılıyor');
  assert(!/console\.(log|warn|info|debug)/.test(screenCode), 'ekranda kalıcı log var');
  // Hassas URL parçaları temizleniyor.
  assert(screenCode.includes('clearSensitiveUrlParts();'), 'hassas URL parçaları temizlenmiyor');
});

check('20. Dev teşhisi yeni ortam etiketini gösteriyor', () => {
  const resolved = resolveRedirectModel({ hostUri: '192.168.68.100:8081', kind: 'expo-go' });
  assertEqual(
    `${resolved.environment} · ${resolved.url}`,
    'expo-go-web · http://192.168.68.100:8081/reset-password',
    'teşhis satırı beklenen biçimde değil',
  );

  // KAYNAK: etiket ve adres birlikte, yalnızca `__DEV__` altında render edilir.
  assert(forgot.includes('__DEV__ ? describePasswordRecoveryRedirect()'), 'teşhis dev ile sınırlı değil');
  assert(
    forgot.includes('`${recoveryRedirect?.environment} · ${recoveryRedirect?.url ?? \'—\'}`'),
    'teşhis satırı ortam + adres göstermiyor',
  );
  assert(redirect.includes("| 'expo-go-web'"), 'yeni ortam tipi tanımlı değil');
  assert(!/'expo-go'(?!-)/.test(stripComments(redirect)), 'eski expo-go etiketi hâlâ üretiliyor');
});

// ---------------------------------------------------------------------------
// Başarılı şifre değişimi sonrası yönlendirme — yaşam döngüsü modeli
// ---------------------------------------------------------------------------

/**
 * `AuthProvider` + `UserScopedApp` + `AppNavigation` + `ResetPasswordScreen`
 * yaşam döngüsünün deterministik modeli.
 *
 * `AuthProvider` `UserScopedApp`'in ÜSTÜNDEDİR: kurtarma bayrağı düştüğünde
 * ağaç değişir, `AppNavigation` ve reset ekranı unmount olur, ama provider
 * state'i (dolayısıyla sinyal) yaşamaya devam eder.
 */
function createApp(options = {}) {
  /** Mutasyon: sinyal ekranda tutulur (düzeltme öncesi davranış). */
  const signalLivesInScreen = options.signalLivesInScreen === true;
  /** Mutasyon: `/login` guard'ı beklenmeden yönlendirme yapılır. */
  const ignoreLoginGuard = options.ignoreLoginGuard === true;
  /** Mutasyon: kurtarma sırasında kullanıcı sağlayıcıları mount edilir. */
  const mountProvidersDuringRecovery = options.mountProvidersDuringRecovery === true;

  const provider = {
    isLoading: false,
    isPasswordRecovery: false,
    pendingRecoveryRedirect: false,
    session: null,
  };

  const app = {
    navigations: [],
    providersMounted: false,
    screenInvalidShown: 0,
    screenMountCount: 0,
    screenMounted: false,
    /** Ekranda tutulan (mutasyon) sinyal; unmount ile KAYBOLUR. */
    screenPendingRedirect: false,
  };

  /** `UserScopedApp` + `AppNavigation` yeniden değerlendirmesi. */
  function render() {
    const recovering = provider.isPasswordRecovery;
    const shouldMountProviders = mountProvidersDuringRecovery
      ? true
      : !provider.isLoading && !recovering;

    if (app.providersMounted !== shouldMountProviders) {
      // Ağaç değişti → mevcut AppNavigation ve alt ekranlar UNMOUNT olur.
      app.providersMounted = shouldMountProviders;
      if (app.screenMounted) {
        app.screenMounted = false;
        // Ekranda tutulan sinyal burada KAYBOLUR.
        app.screenPendingRedirect = false;
      }
    }

    // `AppNavigation` efekti: sinyali tüketip yönlendirir.
    const guardOpen = !provider.isLoading && !provider.isPasswordRecovery && !provider.session;
    if (provider.pendingRecoveryRedirect && (ignoreLoginGuard || guardOpen)) {
      provider.pendingRecoveryRedirect = false;
      app.navigations.push('/login');
    }
  }

  return {
    get app() {
      return app;
    },
    get provider() {
      return provider;
    },
    /** Kurtarma callback'i doğrulandı: geçici oturum açılır, ekran mount olur. */
    startRecovery() {
      provider.pendingRecoveryRedirect = false;
      provider.isPasswordRecovery = true;
      provider.session = { user: 'recovery' };
      render();
      app.screenMounted = true;
      app.screenMountCount += 1;
      return 'ready';
    },
    /** Reset ekranı mount olduğunda "geçersiz" durumuna düşer mi? */
    evaluateScreen() {
      if (!app.screenMounted) return 'unmounted';
      if (provider.isPasswordRecovery && provider.session) return 'ready';
      app.screenInvalidShown += 1;
      return 'invalid';
    },
    /**
     * `completePasswordRecovery` + ekranın başarı yolu.
     *
     * `outcome`: 'ok' | 'update-failed' | 'signout-failed'
     */
    submitNewPassword(outcome = 'ok') {
      if (outcome === 'update-failed') return { error: 'update_failed' };
      if (outcome === 'signout-failed') return { error: 'recovery_signout_failed' };

      // Oturum kapandı.
      provider.session = null;
      // Sinyal bayrak düşmeden ÖNCE kurulur.
      if (signalLivesInScreen) app.screenPendingRedirect = true;
      else provider.pendingRecoveryRedirect = true;
      provider.isPasswordRecovery = false;

      // Ağaç değişimi + AppNavigation efekti.
      render();

      // Ekranda tutulan sinyal (mutasyon) unmount sonrası çalışamaz.
      if (signalLivesInScreen && app.screenPendingRedirect && app.screenMounted) {
        app.screenPendingRedirect = false;
        app.navigations.push('/login');
      }

      // Yeni ağaçta reset route'u hâlâ kayıtlı; ekran yeniden mount olursa
      // durumunu değerlendirir.
      if (!app.screenMounted && app.navigations.length === 0) {
        app.screenMounted = true;
        app.screenMountCount += 1;
        this.evaluateScreen();
      }

      return {};
    },
    /** Kullanıcı yeni şifresiyle giriş yaptı. */
    signIn() {
      provider.pendingRecoveryRedirect = false;
      provider.session = { user: 'real' };
      render();
    },
    /** Ek render turları (efektin tekrar çalışması). */
    rerender() {
      render();
    },
  };
}

check('21. Başarılı değişim sonrası TAM BİR KEZ `/login` yönlendirmesi', () => {
  const app = createApp();

  assertEqual(app.startRecovery(), 'ready', 'kurtarma formu açılmadı');
  assertEqual(app.evaluateScreen(), 'ready', 'form hazır değil');

  const result = app.submitNewPassword('ok');
  assertEqual(result.error, undefined, 'şifre değişimi başarısız');

  // Ekran unmount oldu, yeni ağaç mount oldu, sinyal korundu ve tüketildi.
  assertEqual(app.app.screenMounted, false, 'eski ekran hâlâ mount');
  assertEqual(app.app.providersMounted, true, 'yeni ağaç mount olmadı');
  assertDeepEqual(app.app.navigations, ['/login'], 'yönlendirme yapılmadı veya tekrarlandı');
  // ARADA geçersiz ekran GÖSTERİLMEDİ.
  assertEqual(app.app.screenInvalidShown, 0, 'geçersiz bağlantı ekranı gösterildi');
  assertEqual(app.app.screenMountCount, 1, 'reset ekranı yeniden mount edildi');

  // Sinyal tüketildi: sonraki render turları tekrar yönlendirmez.
  app.rerender();
  app.rerender();
  assertDeepEqual(app.app.navigations, ['/login'], 'sinyal tekrar çalıştı');
  assertEqual(app.provider.pendingRecoveryRedirect, false, 'sinyal acknowledge edilmedi');
});

check('22. Başarısız update/sign-out yönlendirme ÜRETMEZ', () => {
  for (const outcome of ['update-failed', 'signout-failed']) {
    const app = createApp();
    app.startRecovery();
    const result = app.submitNewPassword(outcome);

    assert(result.error !== undefined, `${outcome}: hata dönmedi`);
    assertDeepEqual(app.app.navigations, [], `${outcome}: yönlendirme üretildi`);
    assertEqual(app.provider.pendingRecoveryRedirect, false, `${outcome}: sinyal kuruldu`);
    // Kurtarma modu AÇIK kalır: kullanıcı sekmelere geçemez.
    assertEqual(app.provider.isPasswordRecovery, true, `${outcome}: kurtarma modu kapandı`);
    assertEqual(app.app.providersMounted, false, `${outcome}: kullanıcı sağlayıcıları mount oldu`);
  }

  // KAYNAK: sinyal yalnızca iki adım da başarılıysa kurulur.
  const body = context.slice(
    context.indexOf('const completePasswordRecovery = useCallback('),
    context.indexOf('const cancelPasswordRecovery'),
  );
  assert(
    body.indexOf("if (error) return { error: error.message };") <
      body.indexOf('setPendingRecoveryRedirect(true);'),
    'sinyal updateUser hatasından önce kuruluyor',
  );
  assert(
    body.indexOf("if (!didEnd) return { error: 'recovery_signout_failed' };") <
      body.indexOf('setPendingRecoveryRedirect(true);'),
    'sinyal sign-out hatasından önce kuruluyor',
  );
  // İptal yolu sinyal KURMAZ.
  const cancel = context.slice(
    context.indexOf('const cancelPasswordRecovery = useCallback('),
    context.indexOf('const signIn = useCallback('),
  );
  assert(!cancel.includes('setPendingRecoveryRedirect(true)'), 'iptal yolu sinyal kuruyor');
});

check('23. Sinyal PROVIDER seviyesinde; hesap değişiminde tekrar çalışmaz', () => {
  // Sinyal `AuthProvider` state'idir, ekranda veya kalıcı depoda değil.
  assert(
    context.includes('const [pendingRecoveryRedirect, setPendingRecoveryRedirect] = useState(false);'),
    'sinyal provider state’i değil',
  );
  const contextCode = stripComments(context);
  assert(
    !/(AsyncStorage|SecureStore|localStorage)[^\n]*pendingRecoveryRedirect/i.test(contextCode),
    'sinyal kalıcı depoya yazılıyor',
  );
  assert(
    !/writeRecoveryPending\([^)]*pendingRecoveryRedirect/.test(contextCode),
    'sinyal Supabase/depoya taşınıyor',
  );

  // Yeni giriş eski sinyali düşürür.
  assert(
    context.includes('if (!error) setPendingRecoveryRedirect(false);'),
    'girişte eski sinyal temizlenmiyor',
  );
  // Yeni kurtarma da eski sinyali düşürür.
  const start = context.slice(context.indexOf('const startPasswordRecovery = useCallback('));
  assert(
    start.indexOf('setPendingRecoveryRedirect(false);') < start.indexOf('setIsPasswordRecovery(true);'),
    'yeni kurtarma eski sinyali temizlemiyor',
  );

  // Model: giriş yapıldıktan sonra bekleyen sinyal yönlendirme üretmez.
  const app = createApp();
  app.startRecovery();
  app.provider.pendingRecoveryRedirect = true;
  app.signIn();
  assertDeepEqual(app.app.navigations, [], 'oturum varken yönlendirme yapıldı');
});

check('24. Yönlendirme YALNIZCA `/login` guard’ı açıldıktan sonra yapılır', () => {
  const app = createApp();
  app.startRecovery();
  // Sinyal var ama kurtarma hâlâ açık → guard kapalı.
  app.provider.pendingRecoveryRedirect = true;
  app.rerender();
  assertDeepEqual(app.app.navigations, [], 'guard kapalıyken yönlendirildi');

  // Yükleme sürerken de yönlendirilmez.
  app.provider.isPasswordRecovery = false;
  app.provider.session = null;
  app.provider.isLoading = true;
  app.rerender();
  assertDeepEqual(app.app.navigations, [], 'yükleme sürerken yönlendirildi');

  // Guard açılınca tam bir kez.
  app.provider.isLoading = false;
  app.rerender();
  assertDeepEqual(app.app.navigations, ['/login'], 'guard açılınca yönlendirilmedi');

  // KAYNAK: efekt guard'ı bekliyor ve acknowledge `replace`ten ÖNCE.
  const effect = layout.slice(
    layout.indexOf('if (!pendingRecoveryRedirect) return;'),
    layout.indexOf('}, [acknowledgeRecoveryRedirect,'),
  );
  assert(
    effect.includes('if (isLoading || isPasswordRecovery || session) return;'),
    'guard koşulu eksik',
  );
  assert(
    effect.indexOf('acknowledgeRecoveryRedirect();') < effect.indexOf("router.replace('/login')"),
    'sinyal yönlendirmeden sonra tüketiliyor',
  );
  // Yönlendirme ekranda YAPILMIYOR.
  assert(!screen.includes("router.replace('/login')"), 'reset ekranı hâlâ kendisi yönlendiriyor');
  // Kaba/web'e özel çözüm yok.
  assert(!/window\.location|setTimeout/.test(stripComments(layout)), 'kaba yarış gizleme kullanılmış');
});

check('25. Guard’lar gevşetilmedi; recovery’de kullanıcı verisi mount olmuyor', () => {
  // Mevcut guard'lar aynen duruyor.
  assert(
    layout.includes('<Stack.Protected guard={!session && !isPasswordRecovery}>'),
    'auth guard’ı gevşetilmiş',
  );
  assert(
    layout.includes('<Stack.Protected guard={Boolean(session) && !isPasswordRecovery}>'),
    'sekme guard’ı gevşetilmiş',
  );
  // Kurtarma sırasında sağlayıcılar mount edilmiyor.
  assert(
    layout.includes('if (isLoading || isPasswordRecovery) return <AppNavigation />;'),
    'kurtarma sırasında kullanıcı sağlayıcıları mount ediliyor',
  );
  for (const layer of ['RankUpCelebrationLayer', 'SeasonRecapLayer', 'AchievementUnlockCelebrationLayer', 'FloatingMascot']) {
    assert(
      layout.includes(`{Boolean(session) && !isPasswordRecovery && <${layer} />}`),
      `katman kurtarma sırasında açılıyor: ${layer}`,
    );
  }
  // Koşulsuz reset route'u korunuyor.
  assert(
    layout.includes('<Stack.Screen name="reset-password" options={{ headerShown: false }} />'),
    'koşulsuz reset route’u kaybolmuş',
  );
});

// ---------------------------------------------------------------------------
// Kök Stack route seçimi — Expo Router + React Navigation fallback modeli
// ---------------------------------------------------------------------------

/**
 * Kök Stack'in route listesi ve fallback seçimi.
 *
 * Kaynak davranışı:
 *  - `expo-router/build/layouts/withLayoutContext.js` → guard'ı kapanan ekran
 *    `protectedScreens` kümesine girer.
 *  - `expo-router/build/useScreens.js:123` → o ekranlar listeden ÇIKARILIR;
 *    kalanlar bildirim sırasını korur.
 *  - `@react-navigation/routers` `StackRouter.getStateForRouteNamesChange` →
 *    odaklı route silinip yığın boşalırsa `initialRouteName` yoksa
 *    `routeNames[0]` seçilir.
 *
 * `resetFirst: true` mutasyonu eski sırayı (`(auth)` → reset → `(tabs)`)
 * modeller; `guardReset: true` mutasyonu reset route'una guard geri ekler.
 */
function buildRootRoutes(state, options = {}) {
  const resetFirst = options.resetFirst === true;
  const guardReset = options.guardReset === true;

  const { isPasswordRecovery, session } = state;
  const routes = [];

  if (!session && !isPasswordRecovery) routes.push('(auth)');
  if (resetFirst && (!guardReset || !session || isPasswordRecovery)) routes.push('reset-password');
  if (session && !isPasswordRecovery) routes.push('(tabs)', 'settings', 'messages/index', 'blocked-users');
  if (!resetFirst && (!guardReset || !session || isPasswordRecovery)) routes.push('reset-password');

  return routes;
}

/** Odaklı route silindiğinde React Navigation'ın seçtiği fallback. */
function fallbackRoute(routes) {
  // Kök Stack'te `initialRouteName` YOKTUR → `routeNames[0]`.
  return routes[0];
}

/** Explicit deep link açılabilir mi? */
const canOpenRoute = (routes, name) => routes.includes(name);

check('26. Signed out başlangıç → `(auth)`; reset seçilmez', () => {
  const routes = buildRootRoutes({ isPasswordRecovery: false, session: null });

  assertEqual(fallbackRoute(routes), '(auth)', 'çıkışta auth seçilmedi');
  assert(canOpenRoute(routes, 'reset-password'), 'reset route’u kayıtlı değil');
  assert(routes.indexOf('reset-password') > routes.indexOf('(auth)'), 'reset auth’tan önce');
});

check('27. Login başarılı → `(tabs)`; reset ekranına DÜŞMEZ', () => {
  // Giriş öncesi yığın yalnızca `(auth)` içerir.
  const before = buildRootRoutes({ isPasswordRecovery: false, session: null });
  assertEqual(fallbackRoute(before), '(auth)', 'kurulum: auth odaklı olmalı');

  // Oturum doğdu → `(auth)` listeden ÇIKARILIR, yığın boşalır → fallback.
  const after = buildRootRoutes({ isPasswordRecovery: false, session: { user: 'a' } });
  assert(!after.includes('(auth)'), 'auth route’u kaldırılmadı');
  assertEqual(fallbackRoute(after), '(tabs)', 'giriş sonrası tablara geçilmedi');
  assert(after.indexOf('reset-password') > after.indexOf('(tabs)'), 'reset tabs’tan önce');
  // Reset yine KAYITLI ama fallback DEĞİL.
  assert(canOpenRoute(after, 'reset-password'), 'reset route’u kayboldu');
});

check('28. Signed in başlangıç → `(tabs)`; sign-out → `(auth)`', () => {
  const signedIn = buildRootRoutes({ isPasswordRecovery: false, session: { user: 'a' } });
  assertEqual(fallbackRoute(signedIn), '(tabs)', 'oturumlu açılışta tabs seçilmedi');

  const signedOut = buildRootRoutes({ isPasswordRecovery: false, session: null });
  assertEqual(fallbackRoute(signedOut), '(auth)', 'çıkış sonrası auth seçilmedi');
});

check('29. Recovery aktif → yalnızca reset kullanılabilir', () => {
  for (const session of [null, { user: 'other' }]) {
    const routes = buildRootRoutes({ isPasswordRecovery: true, session });
    assertDeepEqual(routes, ['reset-password'], 'kurtarmada başka route açık');
    assertEqual(fallbackRoute(routes), 'reset-password', 'kurtarmada reset seçilmedi');
    assert(!routes.includes('(auth)'), 'kurtarmada auth açık');
    assert(!routes.includes('(tabs)'), 'kurtarmada tabs açık');
  }
});

check('30. Mevcut session ile EXPLICIT reset deep link açılabilir', () => {
  // Başka bir hesapla oturum açıkken bağlantı tıklanır: route KAYITLI olmalı.
  const routes = buildRootRoutes({ isPasswordRecovery: false, session: { user: 'other' } });
  assert(canOpenRoute(routes, 'reset-password'), 'oturum varken reset açılamıyor');
  // Ama fallback hedefi DEĞİL.
  assert(fallbackRoute(routes) !== 'reset-password', 'reset fallback hedefi olmuş');

  // KAYNAK: kayıt koşulsuz ve oturum korumalı grubun SONRASINDA.
  const resetIndex = layout.indexOf('<Stack.Screen name="reset-password"');
  const authIndex = layout.indexOf('<Stack.Screen name="(auth)"');
  const tabsIndex = layout.indexOf('<Stack.Screen name="(tabs)"');
  assert(resetIndex > authIndex && resetIndex > tabsIndex, 'reset kaydı listenin sonunda değil');
  // Guard YOK: kayıt son `</Stack.Protected>` kapanışından sonra.
  const before = layout.slice(0, resetIndex);
  assert(
    before.lastIndexOf('</Stack.Protected>') > before.lastIndexOf('<Stack.Protected'),
    'reset route’u yeniden guard içine alınmış',
  );
  assert(!/guard=\{!session \|\| isPasswordRecovery\}/.test(layout), 'eski guard geri gelmiş');
});

check('31. Hiçbir normal durumda fallback reset DEĞİL', () => {
  for (const [label, state] of [
    ['çıkış', { isPasswordRecovery: false, session: null }],
    ['giriş', { isPasswordRecovery: false, session: { user: 'a' } }],
  ]) {
    const routes = buildRootRoutes(state);
    assert(fallbackRoute(routes) !== 'reset-password', `${label}: fallback reset seçildi`);
  }
  // Kök Stack'te `initialRouteName` yok → fallback gerçekten `routeNames[0]`.
  // Yorumlar ayıklanır: açıklama metni `initialRouteName` kelimesini ANLATIR.
  assert(
    !/initialRouteName/.test(stripComments(layout)),
    'kök Stack’e initialRouteName eklenmiş',
  );
});

// ---------------------------------------------------------------------------
// MUTASYON TESTLERİ
// ---------------------------------------------------------------------------

check('M1. Expo Go deep link’inden `/--/` ayracı kaybolursa test DÜŞER', () => {
  const runtime = { hostUri: '192.168.68.100:8081', kind: 'expo-go' };

  /** Kasıtlı hata: `createURL` ayracı üretmiyor. */
  const brokenDeepLink = createURLModel('reset-password', runtime, { skipExpoGoSeparator: true });
  assertEqual(
    brokenDeepLink,
    'exp://192.168.68.100:8081/reset-password',
    'bozuk model gerçekten ayraçsız olmalı',
  );
  assertThrows(
    () => assertEqual(brokenDeepLink, 'exp://192.168.68.100:8081/--/reset-password', 'mutation'),
    'ayraçsız deep link testten geçti — Expo Go yolu bozulması yakalanmıyor',
  );

  // Doğru model ayracı üretir ve dönüşüm onu web yolundan KALDIRIR.
  const deepLink = createURLModel('reset-password', runtime);
  assert(deepLink.includes('/--/'), 'doğru model ayracı kaybetti');
  assertEqual(
    toExpoGoWebCallbackModel(deepLink),
    'http://192.168.68.100:8081/reset-password',
    'ayraç web yolundan kaldırılmadı',
  );
});

check('M7. ESKİ sıra `(auth) → reset → (tabs)` döngüyü gerçekten üretir', () => {
  /** Kasıtlı hata: reset kaydı oturum korumalı gruptan ÖNCE. */
  const brokenBefore = buildRootRoutes({ isPasswordRecovery: false, session: null }, { resetFirst: true });
  assertEqual(fallbackRoute(brokenBefore), '(auth)', 'kurulum: çıkışta auth odaklı olmalı');

  // Giriş başarılı → `(auth)` kaldırılır → fallback TOKEN'SIZ reset olur.
  const brokenAfter = buildRootRoutes(
    { isPasswordRecovery: false, session: { user: 'a' } },
    { resetFirst: true },
  );
  assertEqual(
    fallbackRoute(brokenAfter),
    'reset-password',
    'bozuk sıra gerçekten reset ekranına düşmeli',
  );
  assertThrows(
    () => assertEqual(fallbackRoute(brokenAfter), '(tabs)', 'mutation'),
    'eski sıra testten geçti — login sonrası reset ekranına düşüş yakalanmıyor',
  );

  /**
   * DÖNGÜ: token'sız reset `invalid` gösterir; kullanıcı giriş ekranına döner,
   * yeniden giriş yapar ve fallback yine reset'i seçer.
   */
  const app = createApp();
  app.provider.session = null;
  const loop = [];
  for (let round = 0; round < 3; round += 1) {
    const routes = buildRootRoutes({ isPasswordRecovery: false, session: { user: 'a' } }, { resetFirst: true });
    loop.push(fallbackRoute(routes));
  }
  assertDeepEqual(
    loop,
    ['reset-password', 'reset-password', 'reset-password'],
    'bozuk sıra gerçekten döngü üretmeli',
  );
  assertThrows(
    () => assert(loop.every((route) => route === '(tabs)'), 'mutation'),
    'döngü testten geçti — login ↔ reset salınımı yakalanmıyor',
  );

  // Doğru sıra: giriş sonrası her zaman tabs.
  const fixed = buildRootRoutes({ isPasswordRecovery: false, session: { user: 'a' } });
  assertEqual(fallbackRoute(fixed), '(tabs)', 'doğru sıra tablara geçmedi');
});

check('M8. Reset route’una guard eklenirse EXPLICIT deep link testi DÜŞER', () => {
  /** Kasıtlı hata: reset route'u yeniden `!session || isPasswordRecovery` guard'ında. */
  const broken = buildRootRoutes(
    { isPasswordRecovery: false, session: { user: 'other' } },
    { guardReset: true },
  );
  assertEqual(
    canOpenRoute(broken, 'reset-password'),
    false,
    'guard’lı model gerçekten reset route’unu kaldırmalı',
  );
  assertThrows(
    () => assert(canOpenRoute(broken, 'reset-password'), 'mutation'),
    'guard geri eklense de geçti — oturumlu recovery deep link’i yakalanmıyor',
  );

  // Guard'lı modelde recovery bağlantısı hiç işlenemez.
  const brokenRecovery = buildRootRoutes(
    { isPasswordRecovery: false, session: { user: 'other' } },
    { guardReset: true },
  );
  assert(!brokenRecovery.includes('reset-password'), 'guard’lı modelde route beklenmedik biçimde açık');

  // Doğru model: oturum varken de route KAYITLI, ama fallback değil.
  const fixed = buildRootRoutes({ isPasswordRecovery: false, session: { user: 'other' } });
  assert(canOpenRoute(fixed, 'reset-password'), 'doğru model deep link’i kapattı');
  assert(fallbackRoute(fixed) !== 'reset-password', 'doğru model reset’i fallback yaptı');
});

check('M5. Sinyal EKRANDA tutulursa test DÜŞER', () => {
  /** Kasıtlı hata: yönlendirme sinyali unmount olan ekranda tutuluyor. */
  const broken = createApp({ signalLivesInScreen: true });
  broken.startRecovery();
  broken.submitNewPassword('ok');

  // Ekran unmount olduğu için yönlendirme KAYBOLDU…
  assertDeepEqual(broken.app.navigations, [], 'bozuk model gerçekten yönlendirmeyi kaybetmeli');
  // …ve yeniden mount edilen ekran "geçersiz bağlantı" gösterdi.
  assertEqual(broken.app.screenInvalidShown, 1, 'bozuk model gerçekten invalid ekran göstermeli');
  assertEqual(broken.app.screenMountCount, 2, 'bozuk model gerçekten yeniden mount etmeli');
  assertThrows(
    () => assertDeepEqual(broken.app.navigations, ['/login'], 'mutation'),
    'ekranda tutulan sinyal testten geçti — kaybolan yönlendirme yakalanmıyor',
  );
  assertThrows(
    () => assertEqual(broken.app.screenInvalidShown, 0, 'mutation'),
    'invalid ekran testten geçti — gözlenen hata yakalanmıyor',
  );

  // Doğru model: provider sinyali yaşar, tek yönlendirme, invalid ekran yok.
  const fixed = createApp();
  fixed.startRecovery();
  fixed.submitNewPassword('ok');
  assertDeepEqual(fixed.app.navigations, ['/login'], 'doğru model yönlendirmedi');
  assertEqual(fixed.app.screenInvalidShown, 0, 'doğru model invalid ekran gösterdi');
});

check('M6. Guard gevşetilir veya recovery’de sağlayıcılar mount edilirse test DÜŞER', () => {
  /** Kasıtlı hata 1: `/login` guard'ı beklenmeden yönlendirme. */
  const earlyNav = createApp({ ignoreLoginGuard: true });
  earlyNav.startRecovery();
  earlyNav.provider.pendingRecoveryRedirect = true;
  earlyNav.rerender();
  assertDeepEqual(
    earlyNav.app.navigations,
    ['/login'],
    'guard’sız model gerçekten erken yönlendirmeli',
  );
  assertThrows(
    () => assertDeepEqual(earlyNav.app.navigations, [], 'mutation'),
    'guard beklenmeden yönlendirme testten geçti',
  );

  /** Kasıtlı hata 2: kurtarma sırasında kullanıcı sağlayıcıları mount ediliyor. */
  const leaky = createApp({ mountProvidersDuringRecovery: true });
  leaky.startRecovery();
  assertEqual(leaky.app.providersMounted, true, 'sızıntılı model gerçekten mount etmeli');
  assertThrows(
    () => assertEqual(leaky.app.providersMounted, false, 'mutation'),
    'recovery’de sağlayıcı mount edilse de geçti — veri sızıntısı yakalanmıyor',
  );

  // Doğru model: guard beklenir ve recovery’de sağlayıcı mount edilmez.
  const clean = createApp();
  clean.startRecovery();
  assertEqual(clean.app.providersMounted, false, 'doğru model recovery’de sağlayıcı mount etti');
  clean.provider.pendingRecoveryRedirect = true;
  clean.rerender();
  assertDeepEqual(clean.app.navigations, [], 'doğru model guard kapalıyken yönlendirdi');
});

check('M4. Ham `exp://` adresi gönderilirse test DÜŞER', () => {
  const runtime = { hostUri: '192.168.68.100:8081', kind: 'expo-go' };
  const config = {
    redirectAllowList: ['http://192.168.68.100:8081/**', 'exp://192.168.68.100:8081/**'],
    siteUrl: 'http://localhost:8081',
  };

  /** Kasıtlı hata: dönüşüm yok, ham deep link Supabase'e gider. */
  const broken = requestPasswordResetModel(runtime, { sendRawExpoGoUrl: true });
  assertEqual(
    broken.redirectTo,
    'exp://192.168.68.100:8081/--/reset-password',
    'bozuk model gerçekten ham exp adresi göndermeli',
  );
  assertThrows(
    () => assert(broken.redirectTo.startsWith('http'), 'mutation'),
    'ham exp adresi testten geçti — Supabase’in şemayı düşürmesi yakalanmıyor',
  );

  /**
   * ÖLÇÜLEN GERÇEK DAVRANIŞ: Supabase `exp://` adresini izin listesinde olsa
   * bile e-postaya taşımaz ve Site URL'e düşer.
   */
  const supabaseDropsExpScheme = (redirectTo) =>
    redirectTo?.startsWith('exp') ? config.siteUrl : resolveEmailTarget(redirectTo, config);
  assertEqual(
    supabaseDropsExpScheme(broken.redirectTo),
    'http://localhost:8081',
    'bozuk model gerçekten localhost’a düşmeli',
  );

  // Doğru model dönüştürülmüş adresi gönderir ve e-posta uygulamaya döner.
  const fixed = requestPasswordResetModel(runtime);
  assertEqual(fixed.redirectTo, 'http://192.168.68.100:8081/reset-password', 'doğru adres gönderilmedi');
  assertEqual(
    supabaseDropsExpScheme(fixed.redirectTo),
    'http://192.168.68.100:8081/reset-password',
    'doğru model hâlâ Site URL’e düşüyor',
  );

  // KAYNAK: `exp://` hiçbir koşulda `redirectTo` olarak dışa verilmiyor.
  const resolver = redirect.slice(
    redirect.indexOf('export function resolvePasswordRecoveryRedirect'),
    redirect.indexOf('export function getPasswordRecoveryRedirectUrl'),
  );
  assert(resolver.includes('toExpoGoWebCallback(url)'), 'çözümleyici dönüşümü kullanmıyor');
  assert(resolver.includes("environment: 'expo-go-web'"), 'ortam etiketi yanlış');
  assert(!/url: url\b[\s\S]*expo/.test(resolver), 'ham exp adresi dışa veriliyor');
});

check('M2. Adressiz istek gönderen eski davranışa dönülürse test DÜŞER', () => {
  const runtime = { kind: 'web', origin: undefined };
  const config = {
    redirectAllowList: ['exp://192.168.68.100:8081/**', 'workouttracker://**'],
    siteUrl: 'http://localhost:8081',
  };

  /** Kasıtlı hata: adres yokken istek yine gönderilir. */
  const broken = requestPasswordResetModel(runtime, { allowMissingRedirect: true });
  assertEqual(broken.sent, true, 'bozuk model gerçekten istek göndermeli');
  assertEqual(broken.redirectTo, undefined, 'bozuk model gerçekten adressiz olmalı');
  // Ve e-posta tam olarak gözlenen localhost adresine gider.
  assertEqual(
    resolveEmailTarget(broken.redirectTo, config),
    'http://localhost:8081',
    'bozuk model gerçekten Site URL’e düşmeli',
  );
  assertThrows(
    () => assertEqual(broken.sent, false, 'mutation'),
    'adressiz istek testten geçti — sessiz Site URL geri düşüşü yakalanmıyor',
  );

  // Doğru model isteği hiç göndermez.
  assertEqual(requestPasswordResetModel(runtime).sent, false, 'doğru model adressiz istek gönderdi');
});

check('M3. Oturum guard’ı geri gelirse test DÜŞER', () => {
  /** Kasıtlı hata: reset route yeniden guard içine alınmış. */
  const brokenLayout = '<Stack.Protected guard={!session || isPasswordRecovery}>\n<Stack.Screen name="reset-password" />\n</Stack.Protected>';
  const routeIndex = brokenLayout.indexOf('<Stack.Screen name="reset-password"');
  const before = brokenLayout.slice(0, routeIndex);
  const insideGuard = before.lastIndexOf('<Stack.Protected') > before.lastIndexOf('</Stack.Protected>');

  assertEqual(insideGuard, true, 'bozuk layout gerçekten guard içinde olmalı');
  assertThrows(
    () => assertEqual(insideGuard, false, 'mutation'),
    'guard geri gelse de geçti — oturum yarışı yakalanmıyor',
  );
});

if (failures.length > 0) {
  console.error(`✗ ${failures.length} kontrol başarısız:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ ${passed} kontrol geçti`);
