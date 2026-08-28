import { FriendConversationSummary, FriendMessage } from '@/types/messages';

/**
 * Mesaj listesinin SAF yardımcıları.
 *
 * Ekranlar durum tutar, bu dosya karar verir: birleştirme, dedupe, sıralama,
 * süre dolumu ve gönderim anahtarı seçimi burada test edilebilir biçimde
 * yaşar. Hiçbir Supabase, React veya depolama bağımlılığı YOKTUR — mesajlar
 * AsyncStorage'a veya başka kalıcı istemci deposuna hiçbir yerde yazılmaz.
 */

/**
 * Kronolojik (eskiden yeniye) karşılaştırma.
 *
 * Zaman damgaları EŞİTSE `id` kararlı ayraçtır — sunucudaki keyset sırasının
 * (created_at, id) aynısıdır. Böylece aynı ana yazılmış mesajlar ekranda da
 * her render'da aynı sırada kalır.
 */
function compareAscending(left: FriendMessage, right: FriendMessage): number {
  const leftAt = Date.parse(left.createdAt);
  const rightAt = Date.parse(right.createdAt);
  if (leftAt !== rightAt) return leftAt - rightAt;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/**
 * Mesajları birleştirir: `id` ile DEDUPE eder ve kronolojik sıraya dizer.
 *
 * Aynı mesaj hem gönderme RPC'sinin cevabından hem Realtime INSERT olayından
 * gelebilir; hangisi önce gelirse gelsin ekranda TEK balon kalır. Sonradan
 * gelen kopya mevcut kaydı EZMEZ: sunucudan ilk okunan sürüm korunur, çünkü
 * append-only tabloda içerik değişmez ve gereksiz yeniden render üretilmez.
 */
export function mergeFriendMessages(
  current: readonly FriendMessage[],
  incoming: readonly FriendMessage[],
): FriendMessage[] {
  const byId = new Map<string, FriendMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) {
    if (byId.has(message.id)) continue;
    byId.set(message.id, message);
  }
  return [...byId.values()].sort(compareAscending);
}

/**
 * Süresi dolmuş mesajları düşürür.
 *
 * Cihaz saati yalnızca yerel GÖRÜNÜRLÜĞÜ hızlandırmak içindir; gerçek erişim
 * otoritesi sunucudaki RLS ve RPC filtreleridir. Saatlik cron beklenmez.
 */
export function pruneExpiredMessages(
  messages: readonly FriendMessage[],
  nowMs: number,
): FriendMessage[] {
  return messages.filter((message) => Date.parse(message.expiresAt) > nowMs);
}

/** Mesaj şu an görünür mü? Tam sınırda (`expiresAt === now`) görünmez. */
export function isMessageVisible(message: FriendMessage, nowMs: number): boolean {
  return Date.parse(message.expiresAt) > nowMs;
}

/**
 * SIRADAKİ sona erme anı (ms) — yoksa `undefined`.
 *
 * Her mesaj için ayrı timeout zinciri kurulmaz: ekran yalnızca bu tek ana bir
 * zamanlayıcı kurar, tetiklenince süresi dolanları düşürür ve bir sonraki en
 * yakın ana yeniden planlar.
 */
export function nextExpiryAt(
  messages: readonly FriendMessage[],
  nowMs: number,
): number | undefined {
  let earliest: number | undefined;
  for (const message of messages) {
    const expiresAt = Date.parse(message.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) continue;
    if (earliest === undefined || expiresAt < earliest) earliest = expiresAt;
  }
  return earliest;
}

/** Sunucu her mesajı `created_at + 24 saat` ömrüyle yazar. */
export const MESSAGE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Konuşma listesindeki SON MESAJ ÖNİZLEMESİNİN sona erme anı (ms).
 *
 * Liste RPC'si `expiresAt` döndürmez; ömür sunucudaki `lastMessageAt` üzerine
 * sabit 24 saattir. Önizlemesi olmayan satır `undefined` döner.
 */
export function previewExpiresAt(conversation: FriendConversationSummary): number | undefined {
  if (!conversation.lastMessageAt) return undefined;
  const createdAt = Date.parse(conversation.lastMessageAt);
  return Number.isFinite(createdAt) ? createdAt + MESSAGE_LIFETIME_MS : undefined;
}

/**
 * Süresi dolan ÖNİZLEMELERİ temizler — arkadaş satırı SİLİNMEZ.
 *
 * Hiçbir satır değişmediyse aynı dizi referansı döner: gereksiz yeniden
 * render ve gereksiz zamanlayıcı yeniden planlaması oluşmaz.
 */
export function prunePreviewExpiry(
  conversations: FriendConversationSummary[],
  nowMs: number,
): FriendConversationSummary[] {
  let changed = false;
  const next = conversations.map((conversation) => {
    const expiresAt = previewExpiresAt(conversation);
    if (expiresAt === undefined || expiresAt > nowMs) return conversation;
    changed = true;
    return {
      ...conversation,
      lastMessageAt: undefined,
      lastMessageContent: undefined,
      lastMessageSenderId: undefined,
    };
  });
  return changed ? next : conversations;
}

/**
 * SIRADAKİ önizleme sona erme anı — yoksa `undefined`.
 *
 * Her konuşma için ayrı zamanlayıcı kurulmaz: ekran yalnızca bu tek ana bir
 * timeout planlar, tetiklenince süresi dolan önizlemeleri temizler ve sonraki
 * en yakın ana yeniden planlar.
 */
export function nextPreviewExpiryAt(
  conversations: readonly FriendConversationSummary[],
  nowMs: number,
): number | undefined {
  let earliest: number | undefined;
  for (const conversation of conversations) {
    const expiresAt = previewExpiresAt(conversation);
    if (expiresAt === undefined || expiresAt <= nowMs) continue;
    if (earliest === undefined || expiresAt < earliest) earliest = expiresAt;
  }
  return earliest;
}

/** Ekrandaki taslağın gönderim kimliği. */
export type PendingSend = {
  clientMessageId: string;
  /** Anahtarın bağlı olduğu KIRPILMIŞ içerik. */
  content: string;
};

/**
 * Gönderim anahtarını seçer.
 *
 * Ağ hatasından sonra AYNI içerik yeniden denenirse aynı `clientMessageId`
 * korunur — sunucu bunu idempotent retry sayar ve ikinci mesaj yazılmaz.
 * Kullanıcı başarısız taslağı DEĞİŞTİRİRSE bu artık yeni bir mesajdır ve yeni
 * anahtar üretilir.
 */
export function resolveSendKey(
  pending: PendingSend | undefined,
  content: string,
  createKey: () => string,
): PendingSend {
  if (pending && pending.content === content) return pending;
  return { clientMessageId: createKey(), content };
}

/**
 * Realtime olayı AÇIK konuşmaya ait mi?
 *
 * Başka bir konuşmanın mesajı aktif sohbete GİRMEZ; ayrıca mesaj mutlaka
 * görüntüleyen kullanıcıyı içermelidir.
 */
export function belongsToConversation(
  message: FriendMessage,
  viewerId: string,
  counterpartId: string,
): boolean {
  if (viewerId === counterpartId) return false;
  const participants = [message.senderId, message.recipientId];
  return participants.includes(viewerId) && participants.includes(counterpartId);
}
