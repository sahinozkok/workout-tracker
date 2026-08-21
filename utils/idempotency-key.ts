/**
 * Tek seferlik olay anahtarı (UUID v4 biçimi).
 *
 * Ödül RPC'lerinde **idempotency anahtarı** olarak kullanılır: aynı gerçek
 * olayın ağ tekrarı aynı anahtarı taşır ve sunucuda ikinci kez ödüllendirilmez;
 * yeni ve gerçek bir olay yeni anahtar alır ve ayrı bir ödüldür.
 *
 * Yeni paket eklenmez: platformda `crypto.randomUUID` varsa o kullanılır,
 * yoksa aynı biçimde bir yedek üretilir. Yedek kriptografik olarak güçlü
 * değildir ama burada gizlilik değil **tekillik** gerekir; çakışma pratikte
 * imkânsızdır ve olsa bile sonucu yalnızca tek bir ödülün yazılmamasıdır.
 */
export function createIdempotencyKey(): string {
  const platformCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof platformCrypto?.randomUUID === 'function') return platformCrypto.randomUUID();

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
