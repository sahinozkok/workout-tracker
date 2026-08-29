/**
 * Rosea sistemleri için ön plan kararı. Saf fonksiyondur.
 *
 * KÖK NEDEN — neden `=== 'active'` YETMEZ:
 *
 * `AppState.currentState` modül singleton'ı import anında kurulur. Değer önce
 * `getConstants().initialAppState` ile senkron doldurulur, sonra asenkron
 * `getCurrentAppState` callback'iyle düzeltilir ve düzeltme yalnızca değer
 * farklıysa `appStateDidChange` yayar. AppState modülü Rosea mount olmadan çok
 * önce kurulduğu için o tek düzeltme yayını dinleyici kurulmadan geçer.
 *
 * Soğuk açılışta `initialAppState` `'unknown'` (ya da tip olarak `null`)
 * gelebilir. `=== 'active'` karşılaştırması bu durumda `false`'a kilitlenir ve
 * `change` olayı yalnızca GERÇEK geçişlerde ateşlendiği için kullanıcı
 * uygulamayı arka plana atıp geri dönene kadar öyle kalır: uyku zamanlayıcısı
 * hiç kurulmaz, otomatik selamlama planlanmaz, uyanık nefesi çalışmaz.
 *
 * Bu yüzden karar TERSİNE çevrilir: yalnızca AÇIKÇA arka planda olduğunu
 * bildiğimiz iki durum ön plan dışı sayılır. Bilinmeyen başlangıç değeri
 * (`null` / `'unknown'`) ön plan kabul edilir — Rosea'nın çalışması için
 * kanıtlanmış bir arka plan sinyali aranır, kanıtlanmış bir ön plan sinyali
 * değil.
 *
 * GERÇEK GEÇİŞ DAVRANIŞI DEĞİŞMEZ: iOS ve Android yalnızca `'active'`,
 * `'inactive'` ve `'background'` yayar; bu üçü için sonuç `=== 'active'` ile
 * birebir aynıdır. Fark yalnızca kimsenin geçiş olarak yaymadığı bilinmeyen
 * BAŞLANGIÇ değerinde ortaya çıkar.
 *
 * Not: mesaj banner'ının kendi yardımcısı vardır ve bilinçli olarak ondan
 * bağımsızdır — banner akışı bu değişiklikten etkilenmez.
 *
 * İmza `string` alır (react-native tipine bağlanmaz): `AppStateStatus` zaten
 * `string`'e atanabilir, ve bağımsızlık sayesinde bu modül testte tek başına
 * derlenip GERÇEK fonksiyon olarak çalıştırılabilir.
 */
export function isMascotForegroundState(status: string | null | undefined): boolean {
  return status !== 'background' && status !== 'inactive';
}
