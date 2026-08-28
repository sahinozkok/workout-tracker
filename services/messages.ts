import { supabase } from '@/lib/supabase';
import {
  FriendConversationSummary,
  FriendMessage,
  FriendMessageCursor,
  FriendMessagePage,
  FriendMessageSendResult,
} from '@/types/messages';

/**
 * Arkadaş mesajlaşması servis katmanı. Bütün Supabase çağrıları burada
 * toplanır; ekranlar ve context'ler doğrudan `supabase` istemcisine dokunmaz.
 *
 * Bilinçli sınırlar:
 *  - İstemci `friend_messages` tablosuna DOĞRUDAN YAZAMAZ; gönderme yalnızca
 *    doğrulanmış `send_friend_message` RPC'sinden geçer. Bu katman gönderen
 *    kimliği, oluşturulma zamanı, sona erme zamanı veya mesaj kimliği
 *    GÖNDERMEZ — hepsini sunucu belirler.
 *  - Arkadaşlık servisi (`services/friends.ts`) DEĞİŞTİRİLMEZ; mesajlaşma
 *    oraya sıkıştırılmaz.
 *  - Sunucudan gelen satırlar doğrulanır: bozuk UUID, bozuk zaman damgası veya
 *    boş içerik taşıyan satır güvenilir veri gibi KABUL EDİLMEZ.
 */

/** Sunucu da aynı sınırı doğrular. */
export const FRIEND_MESSAGE_MAX_LENGTH = 2000;
/** Varsayılan sayfa boyutu. */
export const FRIEND_MESSAGES_PAGE_SIZE = 30;
/** Sunucunun sıkıştırdığı üst sınır; istemci daha büyüğünü isteyemez. */
export const FRIEND_MESSAGES_MAX_PAGE_SIZE = 50;
/** Kullanıcı başına dakikalık yeni mesaj sınırı (sunucu zorlar). */
export const FRIEND_MESSAGE_RATE_LIMIT_PER_MINUTE = 60;

/**
 * Sunucunun spam koruması için ürettiği KARARLI hata metni.
 *
 * Faz 2'de kullanıcıya gösterilecek mesaj bu ayrıma göre seçilir; ham hata
 * metni ekrana basılmaz.
 */
export const FRIEND_MESSAGE_RATE_LIMITED = 'message_rate_limited';

/**
 * Sunucunun arkadaşlık reddi için ürettiği KARARLI hata metni.
 *
 * Gönderme RPC'si ve geçmiş RPC'si arkadaşlık kalkmışsa bu metinle düşer.
 */
export const FRIEND_MESSAGE_NOT_FRIENDS = 'not_friends';

/**
 * Bilinmeyen bir hata nesnesinden `message` alanını GÜVENLİ okur.
 *
 * Supabase hataları HER ZAMAN `Error` örneği değildir: PostgREST düz bir
 * nesne (`{ message, code, details }`) döndürebilir. `instanceof Error`
 * kontrolüne güvenmek bu durumda hatayı tanınmaz hâle getirirdi.
 */
function readErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FriendMessageRow = {
  id?: unknown;
  sender_id?: unknown;
  recipient_id?: unknown;
  content?: unknown;
  client_message_id?: unknown;
  created_at?: unknown;
  expires_at?: unknown;
};

type ConversationRow = {
  user_id?: unknown;
  display_name?: unknown;
  username?: unknown;
  avatar_url?: unknown;
  last_message_content?: unknown;
  last_message_at?: unknown;
  last_message_sender_id?: unknown;
};

function parseUuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined;
}

/** Okunabilir bir ana çözülmeyen zaman damgası KULLANILMAZ. */
function parseTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function parseText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : undefined;
}

function toOptional(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Tek satırı daraltır.
 *
 * Zorunlu alanlardan biri bile okunamıyorsa `undefined` döner: yarım bir mesaj
 * uydurulmaz ve bozuk satır güvenilir veri gibi taşınmaz.
 */
function parseFriendMessage(row: FriendMessageRow | null | undefined): FriendMessage | undefined {
  if (!row) return undefined;

  const id = parseUuid(row.id);
  const senderId = parseUuid(row.sender_id);
  const recipientId = parseUuid(row.recipient_id);
  const clientMessageId = parseUuid(row.client_message_id);
  const content = parseText(row.content);
  const createdAt = parseTimestamp(row.created_at);
  const expiresAt = parseTimestamp(row.expires_at);

  if (!id || !senderId || !recipientId || !clientMessageId) return undefined;
  if (!content || !createdAt || !expiresAt) return undefined;
  // Gönderici ile alıcı aynı olamaz; sunucu kısıtı bunu zaten engeller.
  if (senderId === recipientId) return undefined;

  return { clientMessageId, content, createdAt, expiresAt, id, recipientId, senderId };
}

/**
 * Mesaj gönderir.
 *
 * `clientMessageId` ÇAĞIRANDAN gelir ve gönderimi idempotent yapar: ağ hatası
 * sonrası aynı anahtarla yapılan retry ikinci mesaj oluşturmaz, mevcut mesajı
 * geri döndürür ve mesajın 24 saatlik ömrünü YENİDEN BAŞLATMAZ.
 *
 * Sunucu spam sınırını aşarsa hata fırlatılır; `isFriendMessageRateLimited`
 * ile ayırt edilebilir.
 */
export async function sendFriendMessage(
  targetUserId: string,
  content: string,
  clientMessageId: string,
): Promise<FriendMessageSendResult> {
  if (!parseUuid(targetUserId)) throw new Error('invalid_target');
  if (!parseUuid(clientMessageId)) throw new Error('invalid_client_message_id');

  // Sunucu da aynı kuralı doğrular; bu yalnızca gereksiz gidiş-dönüşü keser.
  const trimmed = content.trim();
  if (trimmed.length < 1 || trimmed.length > FRIEND_MESSAGE_MAX_LENGTH) {
    throw new Error('invalid_content');
  }

  const { data, error } = await supabase.rpc('send_friend_message', {
    client_message_id: clientMessageId,
    message_content: trimmed,
    target_user_id: targetUserId,
  });
  if (error) throw error;

  const rows = (data ?? []) as FriendMessageRow[];
  const message = parseFriendMessage(rows[0]);
  // Gönderim sonucunda okunabilir bir mesaj yoksa sessizce başarı sayılmaz.
  if (!message) throw new Error('invalid_send_response');

  return message;
}

/**
 * Konuşma geçmişi — en yeni önce, cursor sayfalama.
 *
 * Süresi dolmuş mesajlar sunucu tarafından zaten filtrelenir; istemci saatine
 * hiçbir aşamada güvenilmez.
 */
export async function getFriendMessages(
  targetUserId: string,
  cursor?: FriendMessageCursor,
  pageSize: number = FRIEND_MESSAGES_PAGE_SIZE,
): Promise<FriendMessagePage> {
  if (!parseUuid(targetUserId)) throw new Error('invalid_target');

  /**
   * CURSOR ATOMİKTİR — doğrulama Supabase ÇAĞRISINDAN ÖNCE yapılır.
   *
   * Yarım veya bozuk bir cursor sunucuya hiç gönderilmez: sunucu da aynı
   * kuralı `invalid_cursor` ile zorlar, bu katman yalnızca gereksiz gidiş
   * dönüşü keser ve hatayı çağırana aynı adla bildirir.
   */
  if (cursor !== undefined) {
    if (!parseTimestamp(cursor.beforeCreatedAt) || !parseUuid(cursor.beforeId)) {
      throw new Error('invalid_cursor');
    }
  }

  const limit = Math.min(Math.max(Math.trunc(pageSize) || 1, 1), FRIEND_MESSAGES_MAX_PAGE_SIZE);

  const { data, error } = await supabase.rpc('get_friend_messages', {
    before_created_at: cursor?.beforeCreatedAt ?? null,
    before_id: cursor?.beforeId ?? null,
    page_size: limit,
    target_user_id: targetUserId,
  });
  if (error) throw error;

  // Bozuk satırlar DÜŞÜRÜLÜR; kalanlar sunucu sırasını korur.
  const messages = ((data ?? []) as FriendMessageRow[])
    .map(parseFriendMessage)
    .filter((message): message is FriendMessage => message !== undefined);

  const hasMore = messages.length === limit;
  const last = messages[messages.length - 1];

  return {
    hasMore,
    messages,
    nextCursor:
      hasMore && last ? { beforeCreatedAt: last.createdAt, beforeId: last.id } : undefined,
  };
}

/**
 * Konuşma listesi — yalnızca kabul edilmiş arkadaşlar.
 *
 * Son mesajı olmayan arkadaş da listede kalır; süresi dolmuş mesaj son mesaj
 * olarak GÖRÜNMEZ.
 */
export async function listFriendConversations(): Promise<FriendConversationSummary[]> {
  const { data, error } = await supabase.rpc('list_friend_conversations');
  if (error) throw error;

  return ((data ?? []) as ConversationRow[])
    .map((row): FriendConversationSummary | undefined => {
      const userId = parseUuid(row.user_id);
      const displayName = parseText(row.display_name);
      if (!userId || !displayName) return undefined;

      // Son mesaj ancak ÜÇ alanı da okunabiliyorsa gösterilir; yarım bir
      // önizleme (zamansız içerik veya içeriksiz zaman) taşınmaz.
      const lastMessageContent = parseText(row.last_message_content);
      const lastMessageAt = parseTimestamp(row.last_message_at);
      const lastMessageSenderId = parseUuid(row.last_message_sender_id);
      const hasLastMessage =
        lastMessageContent !== undefined &&
        lastMessageAt !== undefined &&
        lastMessageSenderId !== undefined;

      return {
        avatarUrl: toOptional(row.avatar_url),
        displayName,
        lastMessageAt: hasLastMessage ? lastMessageAt : undefined,
        lastMessageContent: hasLastMessage ? lastMessageContent : undefined,
        lastMessageSenderId: hasLastMessage ? lastMessageSenderId : undefined,
        userId,
        username: toOptional(row.username),
      };
    })
    .filter((row): row is FriendConversationSummary => row !== undefined);
}

/**
 * REALTIME ABONELİĞİ — `friend_messages`, yalnızca INSERT.
 *
 * Ekranlar `supabase` istemcisine DOKUNMAZ: kanal burada kurulur, gelen satır
 * aynı `parseFriendMessage` doğrulamasından geçer ve bozuk payload SESSİZCE
 * DÜŞÜRÜLÜR.
 *
 * Bilinçli sınırlar:
 *  - Abonelik GLOBAL DEĞİLDİR: yalnızca çağıran ekran yaşarken açık kalır ve
 *    dönen `unsubscribe` ile kesin olarak kapatılır. Uygulamanın her ekranında
 *    açık duran bir kanal Free Tier kullanımını gereksiz artırırdı.
 *  - Kanal adı her abonelikte benzersizdir: aynı anda açılan iki ekran (veya
 *    hızlı bir remount) aynı kanal adını paylaşıp birbirini kapatamaz.
 *  - Yalnızca görüntüleyen kullanıcıyı ilgilendiren ve süresi DOLMAMIŞ satırlar
 *    yukarı verilir. Sunucu RLS'i zaten bunu zorlar; bu ikinci katmandır.
 *  - Güncelleme/silme olayları DİNLENMEZ: tablo append-only'dir ve süre dolumu
 *    istemcide `expiresAt` ile yönetilir, cron DELETE olayı BEKLENMEZ.
 */
export type FriendMessageSubscription = {
  /** Kanalı kesin olarak kaldırır. İkinci çağrı işlemsizdir. */
  unsubscribe: () => void;
};

/** Kanal adlarının çakışmasını önleyen süreç içi sayaç. */
let channelSequence = 0;

export function subscribeToFriendMessages({
  channelKey,
  onMessage,
  viewerId,
}: {
  /** Ekranı ayırt eden kısa etiket (ör. `conversations`, `chat`). */
  channelKey: string;
  onMessage: (message: FriendMessage) => void;
  /** Oturumdaki kullanıcı; ilgisiz satırlar yukarı verilmez. */
  viewerId: string;
}): FriendMessageSubscription {
  channelSequence += 1;
  const channel = supabase
    .channel(`friend-messages:${channelKey}:${channelSequence}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'friend_messages' },
      (payload) => {
        const message = parseFriendMessage(payload.new as FriendMessageRow);
        // Bozuk payload güvenilir veri gibi taşınmaz.
        if (!message) return;
        if (message.senderId !== viewerId && message.recipientId !== viewerId) return;
        // Süresi dolmuş satır hiçbir anda ekrana giremez.
        if (Date.parse(message.expiresAt) <= Date.now()) return;
        onMessage(message);
      },
    )
    .subscribe();

  let isRemoved = false;
  return {
    unsubscribe: () => {
      if (isRemoved) return;
      isRemoved = true;
      void supabase.removeChannel(channel);
    },
  };
}

/** Sunucunun spam sınırı reddi mi? Ham hata metni ekrana basılmaz. */
export function isFriendMessageRateLimited(error: unknown): boolean {
  return readErrorMessage(error).includes(FRIEND_MESSAGE_RATE_LIMITED);
}

/**
 * Arkadaşlık kalkmış mı?
 *
 * `Error` örneği olmayan düz Supabase hataları da tanınır. İki ayrım
 * BİRBİRİNDEN bağımsızdır: metinler farklı olduğu için rate-limit reddi
 * yanlışlıkla "arkadaş değil" sayılamaz.
 */
export function isNotFriendsError(error: unknown): boolean {
  return readErrorMessage(error).includes(FRIEND_MESSAGE_NOT_FRIENDS);
}
