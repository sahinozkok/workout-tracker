import { FriendMessage } from '@/types/messages';
import { isMessageVisible } from '@/utils/friend-messages';

/**
 * Uygulama İÇİ mesaj farkındalığının SAF kararları ve aktif konuşma kaydı.
 *
 * KAPSAM: yalnızca uygulama ÖN PLANDAYKEN çalışan üst banner ve okunmamış
 * noktası. Uzaktan push, işletim sistemi bildirimi, mesaj sayısı ve "görüldü"
 * bilgisi YOKTUR.
 *
 * Bu dosya hiçbir Supabase, React veya depolama bağımlılığı taşımaz; banner
 * önizlemesi hiçbir yere loglanmaz ve kalıcı depoya yazılmaz.
 */

/** Banner önizlemesinin tek satırda kalması için karakter sınırı. */
export const ALERT_PREVIEW_MAX_LENGTH = 80;

/** Banner kendiliğinden kapanma süresi (ms). */
export const ALERT_VISIBLE_MS = 4000;

/** Aynı mesajın tekrar banner üretmemesi için akılda tutulan kimlik sayısı. */
export const ALERT_DEDUPE_LIMIT = 50;

// ---------------------------------------------------------------------------
// AKTİF KONUŞMA KAYDI
//
// Sohbet ekranı odaklandığında karşı tarafın kimliğini buraya yazar. Global
// dinleyici olayı işlerken bu değeri SENKRON okur: React state turu
// beklenmediği için "ekran açıkken banner çıktı" yarışı oluşmaz.
// ---------------------------------------------------------------------------

let activeConversationId: string | undefined;

/** Sohbet ekranı odaklandı/odağı bıraktı. `undefined` = açık sohbet yok. */
export function setActiveConversation(friendId: string | undefined): void {
  activeConversationId = friendId;
}

/** Şu an açık olan sohbetin karşı tarafı. */
export function getActiveConversation(): string | undefined {
  return activeConversationId;
}

/** Kullanıcı bu arkadaşın sohbetini AKTİF olarak görüntülüyor mu? */
export function isConversationActive(friendId: string): boolean {
  return activeConversationId !== undefined && activeConversationId === friendId;
}

// ---------------------------------------------------------------------------
// ÖN PLAN KARARI
// ---------------------------------------------------------------------------

/**
 * Uygulama ÖN PLANDA sayılır mı?
 *
 * `AppState.currentState` mount anında `null` veya `'unknown'` OLABİLİR:
 * React Native onu asenkron doldurur (bkz. `Libraries/AppState/AppState.js`,
 * `currentState: ?string = null` ve "terrible solution" notu). `=== 'active'`
 * karşılaştırması bu yüzden açılışta YANLIŞLIKLA `false` mühürler ve
 * `change` olayı yalnızca GEÇİŞLERDE tetiklendiği için uygulama hiç arka
 * plana gitmezse değer bir daha düzelmez — banner sonsuza kadar bastırılır.
 *
 * Bu yüzden karar TERSİNDEN verilir: yalnızca AÇIKÇA arka planda olduğu
 * bilinen durumlar ön plan dışıdır.
 */
export function isForegroundAppState(state: string | null | undefined): boolean {
  return state !== 'background' && state !== 'inactive';
}

// ---------------------------------------------------------------------------
// BANNER KARARLARI
// ---------------------------------------------------------------------------

/** Banner'da gösterilecek güvenli önizleme. */
export type MessageAlert = {
  /** Dedupe anahtarı. */
  id: string;
  /** Sohbeti açmak için kullanılan karşı taraf kimliği. */
  senderId: string;
  /** Gönderenin görünen adı; bilinmiyorsa `undefined`. */
  senderName?: string;
  /** Tek satıra sığdırılmış, kısaltılmış önizleme. */
  preview: string;
};

/**
 * Önizlemeyi tek satıra indirir ve kısaltır.
 *
 * Satır sonları boşluğa çevrilir; uzun mesaj sınırda kesilip tek bir ellipsis
 * ile biter. Ham içerik hiçbir yere yazılmaz.
 */
export function buildAlertPreview(content: string): string {
  const singleLine = content.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= ALERT_PREVIEW_MAX_LENGTH) return singleLine;
  return `${singleLine.slice(0, ALERT_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * Bu mesaj için üst banner gösterilmeli mi?
 *
 * Kurallar:
 *   - Uygulama ÖN PLANDA olmalı; arka planda banner çıkmaz.
 *   - Mesaj GÖRÜNTÜLEYEN kullanıcıya gelmiş olmalı; kendi gönderdiği mesaj
 *     banner üretmez.
 *   - Süresi dolmuş mesaj banner üretmez.
 *   - Kullanıcı o sohbeti ZATEN açık tutuyorsa banner gösterilmez; mesaj
 *     görünür sayılır ve okundu ilerletilir.
 *   - Aynı mesaj kimliği ikinci kez gelirse (iki abonelik veya yeniden
 *     bağlanma) banner tekrar gösterilmez.
 */
export function shouldShowAlert({
  activeConversation,
  isForeground,
  message,
  nowMs,
  seenIds,
  viewerId,
}: {
  activeConversation: string | undefined;
  isForeground: boolean;
  message: FriendMessage;
  nowMs: number;
  seenIds: ReadonlySet<string>;
  viewerId: string;
}): boolean {
  if (!isForeground) return false;
  // Yalnızca GELEN mesaj; kendi gönderdiğim banner üretmez.
  if (message.recipientId !== viewerId) return false;
  if (message.senderId === viewerId) return false;
  if (!isMessageVisible(message, nowMs)) return false;
  // Açık sohbetin mesajı banner üretmez.
  if (activeConversation !== undefined && activeConversation === message.senderId) return false;
  if (seenIds.has(message.id)) return false;
  return true;
}

/**
 * Dedupe kümesini sınırlı tutar.
 *
 * Sınırsız büyümemesi için en eski kimlikler düşer; sıralama ekleme sırasıdır
 * (`Set` bunu korur).
 */
export function rememberAlertId(seenIds: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(seenIds);
  next.add(id);
  if (next.size <= ALERT_DEDUPE_LIMIT) return next;

  const trimmed = new Set<string>();
  const overflow = next.size - ALERT_DEDUPE_LIMIT;
  let index = 0;
  for (const value of next) {
    index += 1;
    if (index <= overflow) continue;
    trimmed.add(value);
  }
  return trimmed;
}

/**
 * SON MESAJ POLİTİKASI — hızlı gelen mesajlarda deterministik davranış.
 *
 * Kuyruk BİRİKTİRİLMEZ: yeni mesaj mevcut banner'ın yerini alır ve görünürlük
 * süresi baştan başlar. Böylece banner asılı kalmaz ve kullanıcı her zaman EN
 * SON mesajı görür.
 */
export function nextAlert(_current: MessageAlert | undefined, incoming: MessageAlert): MessageAlert {
  return incoming;
}

/**
 * Realtime satırından banner içeriği üretir.
 *
 * `senderName` çağıranın ad haritasından gelir; Realtime yükü profil bilgisi
 * TAŞIMAZ ve bu katman ağdan veri çekmez.
 */
export function toMessageAlert(message: FriendMessage, senderName?: string): MessageAlert {
  return {
    id: message.id,
    preview: buildAlertPreview(message.content),
    senderId: message.senderId,
    senderName,
  };
}

/**
 * Okunmamış kimliklerini iyimser olarak günceller.
 *
 * Sohbet açıldığında nokta hemen kalkar; sunucu çağrısı başarısız olursa
 * sonraki güvenilir yenileme (odak, Realtime veya pull-to-refresh) doğru
 * durumu geri getirir.
 */
export function withoutUnread(unreadIds: ReadonlySet<string>, friendId: string): Set<string> {
  if (!unreadIds.has(friendId)) return new Set(unreadIds);
  const next = new Set(unreadIds);
  next.delete(friendId);
  return next;
}

/**
 * Gelen mesaj arkadaş listesindeki noktayı ANINDA açar.
 *
 * Kendi gönderdiği mesaj nokta üretmez; açık sohbetin mesajı da üretmez çünkü
 * o mesaj zaten okunmuş sayılır.
 */
export function withUnreadFromMessage(
  unreadIds: ReadonlySet<string>,
  message: FriendMessage,
  viewerId: string,
  activeConversation: string | undefined,
): Set<string> {
  if (message.recipientId !== viewerId || message.senderId === viewerId) return new Set(unreadIds);
  if (activeConversation !== undefined && activeConversation === message.senderId) {
    return new Set(unreadIds);
  }
  const next = new Set(unreadIds);
  next.add(message.senderId);
  return next;
}
