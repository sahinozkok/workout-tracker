/**
 * Arkadaş mesajlaşması — Faz 1 veri sözleşmesi.
 *
 * Bilinçli sınırlar:
 *  - Bu tipler YALNIZCA sunucunun döndürdüğü güvenli gösterim alanlarını
 *    taşır: e-posta, auth metadata, token, özel profil alanı, workout, rank,
 *    ödül veya disiplin verisi YOKTUR.
 *  - Mesajlar bu fazda append-only'dir: düzenleme/silme, okundu bilgisi,
 *    yazıyor göstergesi ve çevrimiçi durumu tipi YOKTUR.
 *  - Mesaj ömrü 24 saattir ve SUNUCU zamanından türer; `expiresAt` istemci
 *    tarafından belirlenemez, yalnızca okunur.
 */

/**
 * Tek mesaj.
 *
 * `clientMessageId` gönderimi idempotent yapan istemci anahtarıdır: aynı
 * anahtarla yapılan retry yeni satır üretmez ve `expiresAt` değerini yeniden
 * başlatmaz.
 */
export type FriendMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  clientMessageId: string;
  /** Sunucunun yazdığı oluşturulma anı (ISO 8601). */
  createdAt: string;
  /**
   * Sunucunun yazdığı sona erme anı — her zaman `createdAt + 24 saat`.
   *
   * Faz 2'de istemci bu ana ulaşan mesajı YERELDEN kaldırır; cron'un DELETE
   * olayını beklemez. Süre kontrolü sunucuda da yapılır, bu alan yalnızca
   * görüntüleme içindir.
   */
  expiresAt: string;
};

/**
 * Sayfalama imleci — `created_at`, eşit zamanlarda `id`.
 *
 * Offset KULLANILMAZ: yeni mesaj geldiğinde offset sayfaları kaydırır ve satır
 * atlanır veya çoğaltılırdı.
 *
 * İKİ ALAN DA ZORUNLUDUR ve birlikte anlam taşır: yalnızca zaman damgası
 * taşıyan bir imleç, aynı ana yazılmış mesajların kalanını sessizce atlardı.
 * Sunucu da yarım imleci `invalid_cursor` ile reddeder.
 */
export type FriendMessageCursor = {
  beforeCreatedAt: string;
  beforeId: string;
};

/** Tek sayfa mesaj — en yeni önce. */
export type FriendMessagePage = {
  /** `createdAt` azalan, eşitlikte `id` azalan sırada. */
  messages: FriendMessage[];
  /**
   * Sonraki sayfanın imleci.
   *
   * `undefined` = bu sayfa doludur ama sunucu daha eski mesaj döndürmedi ya da
   * konuşma bitti. `hasMore` ile birlikte yorumlanır.
   */
  nextCursor?: FriendMessageCursor;
  /** Sayfa tam dolduysa `true`; daha eski mesaj OLABİLİR. */
  hasMore: boolean;
};

/**
 * Konuşma listesindeki tek satır.
 *
 * Yalnızca güvenli profil özeti taşır. Son mesaj alanları, süresi dolmamış bir
 * mesaj yoksa `undefined` olur — arkadaş yine listede kalır.
 */
export type FriendConversationSummary = {
  userId: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  lastMessageContent?: string;
  lastMessageAt?: string;
  lastMessageSenderId?: string;
  /**
   * Bu arkadaştan OKUNMAMIŞ mesaj var mı?
   *
   * Yalnızca boolean: sayı taşınmaz. Kullanıcının kendi gönderdiği mesajlar,
   * süresi dolmuş mesajlar ve artık arkadaş olunmayan kişiler `true` üretmez.
   * Karşı tarafa "görüldü" bilgisi HİÇBİR yoldan sızmaz.
   */
  hasUnread: boolean;
};

/**
 * Gönderme sonucu.
 *
 * Sunucu, yeni yazılan veya idempotent retry'da ZATEN VAR OLAN mesajı döner;
 * her iki durumda da sözleşme aynıdır ve `expiresAt` ilk gönderimin anına
 * göredir.
 */
export type FriendMessageSendResult = FriendMessage;
