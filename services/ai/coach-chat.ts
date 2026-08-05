import { supabase } from '@/lib/supabase';
import { ChatRole, CoachChatMessage } from '@/types/ai';

type CoachMessageRow = {
  id: string;
  role: ChatRole;
  content: string;
  client_message_id: string;
  reply_to_message_id: string | null;
  created_at: string;
};

type ChatResponse = {
  message?: {
    id?: unknown;
    role?: unknown;
    content?: unknown;
    createdAt?: unknown;
  };
};

// Idempotency anahtarı olarak kullanılan v4 biçimli kimlik. Kriptografik
// güç değil, benzersizlik hedeflenir; sunucu yalnızca uuid biçimini doğrular.
export function createClientMessageId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function mapRow(row: CoachMessageRow, status: CoachChatMessage['status']): CoachChatMessage {
  return {
    clientMessageId: row.client_message_id,
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    role: row.role,
    status,
  };
}

export async function loadCoachMessages(limit = 50): Promise<CoachChatMessage[]> {
  const { data, error } = await supabase
    .from('ai_coach_messages')
    .select('id, role, content, client_message_id, reply_to_message_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error('Sohbet geçmişi yüklenemedi.');

  const rows = ((data ?? []) as CoachMessageRow[]).slice().reverse();
  // Cevabı olan kullanıcı mesajlarını, bağlı assistant satırlarının
  // reply_to_message_id değerlerinden belirle.
  const answeredUserIds = new Set(
    rows
      .filter((row) => row.role === 'assistant' && row.reply_to_message_id)
      .map((row) => row.reply_to_message_id as string),
  );

  return rows.map((row) => {
    if (row.role === 'assistant') return mapRow(row, 'sent');
    // Cevabı olmayan kullanıcı mesajı 'failed' işaretlenir; böylece uygulama
    // yeniden açıldığında "Yeniden dene" düğmesi görünür.
    return mapRow(row, answeredUserIds.has(row.id) ? 'sent' : 'failed');
  });
}

export async function clearCoachMessages(userId: string): Promise<void> {
  const { error } = await supabase.from('ai_coach_messages').delete().eq('user_id', userId);
  if (error) throw new Error('Sohbet temizlenemedi. Lütfen tekrar dene.');
}

export async function sendCoachMessage(
  message: string,
  clientMessageId: string,
): Promise<CoachChatMessage> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error('AI Koç için oturumun yenilenemedi. Çıkış yapıp tekrar giriş yapmayı dene.');
  }

  const { data, error } = await supabase.functions.invoke('workout-coach', {
    body: { clientMessageId, feature: 'chat', message },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    let messageText = 'AI Koç yanıtına ulaşılamadı.';
    const context = 'context' in error ? error.context : undefined;

    if (context instanceof Response) {
      try {
        const payload = (await context.clone().json()) as { error?: unknown; message?: unknown };
        const serverMessage = typeof payload.error === 'string' ? payload.error : payload.message;
        if (typeof serverMessage === 'string' && serverMessage.trim()) messageText = serverMessage;
      } catch {
        // Sunucu JSON döndürmediyse güvenli genel mesaj gösterilir.
      }
    }

    throw new Error(messageText);
  }

  const reply = (data as ChatResponse)?.message;
  if (
    !reply ||
    typeof reply.id !== 'string' ||
    typeof reply.content !== 'string' ||
    typeof reply.createdAt !== 'string'
  ) {
    throw new Error('AI yanıtı beklenen biçimde gelmedi.');
  }

  return {
    clientMessageId,
    content: reply.content,
    createdAt: reply.createdAt,
    id: reply.id,
    role: 'assistant',
    status: 'sent',
  };
}
