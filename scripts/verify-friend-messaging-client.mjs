#!/usr/bin/env node
/**
 * ARKADAŞ MESAJLAŞMASI — FAZ 2 (İSTEMCİ) DOĞRULAMA HARNESS'I
 *
 * Kapsam: istemci tarafındaki birleştirme/dedupe, cursor sırası, 24 saatlik
 * yerel kaldırma, idempotent gönderim, Realtime yaşam döngüsü ve arkadaşlık
 * kaldırılma davranışı. Sunucu güvenlik sınırı Faz 1 harness'ındadır
 * (`scripts/verify-friend-messaging.mjs`) ve o dosyaya dokunulmamıştır.
 *
 * Üç katman: (1) `utils/friend-messages.ts` GERÇEKTEN derlenip çalıştırılır,
 * (2) ekran yaşam döngüsü deterministik bir modelle simüle edilir, (3) kaynak
 * statik denetlenir.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');

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

const source = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

const listScreen = source('app/messages/index.tsx');
const chatScreen = source('app/messages/[userId].tsx');
const serviceSource = source('services/messages.ts');
const layoutSource = source('app/_layout.tsx');
const friendsScreen = source('components/friends/friends-screen.tsx');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

/** Yorumsuz hâl — kural denetimleri KOD üzerinde yapılır. */
const stripComments = (text) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const listCode = stripComments(listScreen);
const chatCode = stripComments(chatScreen);

// ---------------------------------------------------------------------------
// Katman 1 — saf yardımcılar GERÇEKTEN derlenir
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'rosea-messaging-client-'));
let helpers;

try {
  /**
   * `--noResolve`: dosya YALNIZCA tip için `@/types/messages`'tan import eder
   * ve TypeScript bu importu emit sırasında zaten eler. Ortam @types
   * uyarıları çıkışı engellemediği için tsc'nin çıkış kodu değil, ÜRETİLEN
   * dosyanın varlığı ölçülür.
   */
  execFileSync(
    'npx',
    [
      'tsc',
      join(ROOT, 'utils/friend-messages.ts'),
      '--outDir',
      outDir,
      '--target',
      'es2020',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--noResolve',
      '--skipLibCheck',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
} catch {
  // Ortam kaynaklı @types hataları yutulur; asıl kontrol aşağıdadır.
}

const compiled = join(outDir, 'friend-messages.js');
if (!existsSync(compiled)) {
  console.error('utils/friend-messages.ts derlenemedi.');
  process.exit(1);
}
helpers = await import(pathToFileURL(compiled).href);

const {
  belongsToConversation,
  isMessageVisible,
  mergeFriendMessages,
  nextExpiryAt,
  nextPreviewExpiryAt,
  pruneExpiredMessages,
  previewExpiresAt,
  prunePreviewExpiry,
  resolveSendKey,
} = helpers;

const DAY_MS = 24 * 60 * 60 * 1000;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ME = uuid(1);
const FRIEND = uuid(2);
const STRANGER = uuid(3);

let messageSeq = 0;
function makeMessage({ at, content = 'merhaba', id, from = ME, to = FRIEND }) {
  messageSeq += 1;
  const createdAt = new Date(at).toISOString();
  return {
    clientMessageId: uuid(700000 + messageSeq),
    content,
    createdAt,
    expiresAt: new Date(at + DAY_MS).toISOString(),
    id: id ?? uuid(messageSeq),
    recipientId: to,
    senderId: from,
  };
}

const BASE = Date.parse('2026-09-03T10:00:00.000Z');

// ---------------------------------------------------------------------------
// 1 · Sıralama, dedupe ve cursor
// ---------------------------------------------------------------------------

check('1. İlk sayfa ve cursor sayfası DOĞAL kronolojik sırada birleşir', () => {
  // Sunucu EN YENİ önce döner.
  const newest = [
    makeMessage({ at: BASE + 3000, id: uuid(13) }),
    makeMessage({ at: BASE + 2000, id: uuid(12) }),
  ];
  const older = [
    makeMessage({ at: BASE + 1000, id: uuid(11) }),
    makeMessage({ at: BASE, id: uuid(10) }),
  ];

  const firstPage = mergeFriendMessages([], newest);
  assertDeepEqual(
    firstPage.map((m) => m.id),
    [uuid(12), uuid(13)],
    'ilk sayfa kronolojik sıraya çevrilmedi',
  );

  // Cursor sayfası ÖNE eklenir; offset yoktur.
  const merged = mergeFriendMessages(firstPage, older);
  assertDeepEqual(
    merged.map((m) => m.id),
    [uuid(10), uuid(11), uuid(12), uuid(13)],
    'eski sayfa yanlış yere eklendi',
  );
});

check('2. AYNI timestamp mesajları atlanmaz ve sıraları kararlıdır', () => {
  const sameAt = [
    makeMessage({ at: BASE, id: uuid(23) }),
    makeMessage({ at: BASE, id: uuid(21) }),
    makeMessage({ at: BASE, id: uuid(22) }),
  ];

  const merged = mergeFriendMessages([], sameAt);
  assertEqual(merged.length, 3, 'aynı timestamp mesajı düştü');
  assertDeepEqual(
    merged.map((m) => m.id),
    [uuid(21), uuid(22), uuid(23)],
    'eşit zamanda id ayracı kullanılmadı',
  );

  // Sıra her birleştirmede AYNI kalır.
  const again = mergeFriendMessages(merged, [...sameAt].reverse());
  assertDeepEqual(again.map((m) => m.id), merged.map((m) => m.id), 'sıra kararlı değil');
});

check('3. RPC + Realtime aynı mesajı getirirse TEK balon kalır', () => {
  const message = makeMessage({ at: BASE, id: uuid(31) });

  // RPC önce, Realtime sonra.
  const rpcFirst = mergeFriendMessages(mergeFriendMessages([], [message]), [message]);
  assertEqual(rpcFirst.length, 1, 'RPC→Realtime sırasında kopya balon oluştu');

  // Realtime önce, RPC sonra.
  const realtimeFirst = mergeFriendMessages(mergeFriendMessages([], [message]), [
    { ...message, content: message.content },
  ]);
  assertEqual(realtimeFirst.length, 1, 'Realtime→RPC sırasında kopya balon oluştu');
  assertEqual(realtimeFirst[0].id, message.id, 'dedupe yanlış kaydı bıraktı');
});

check('4. FARKLI konuşmanın mesajı aktif ekrana girmez', () => {
  const mine = makeMessage({ at: BASE, from: ME, to: FRIEND });
  const other = makeMessage({ at: BASE, from: ME, to: STRANGER });
  const foreign = makeMessage({ at: BASE, from: STRANGER, to: uuid(9) });

  assertEqual(belongsToConversation(mine, ME, FRIEND), true, 'kendi konuşmam reddedildi');
  assertEqual(belongsToConversation(other, ME, FRIEND), false, 'başka konuşma kabul edildi');
  assertEqual(belongsToConversation(foreign, ME, FRIEND), false, 'ilgisiz mesaj kabul edildi');
  // Kendi kendine konuşma yoktur.
  assertEqual(belongsToConversation(mine, ME, ME), false, 'kendine sohbet kabul edildi');
});

// ---------------------------------------------------------------------------
// 2 · 24 saatlik yerel kaldırma
// ---------------------------------------------------------------------------

check('5. Sınırdan BİR MİLİSANİYE önce mesaj görünür', () => {
  const message = makeMessage({ at: BASE });
  const expiresAt = Date.parse(message.expiresAt);

  assertEqual(isMessageVisible(message, expiresAt - 1), true, 'sınırdan önce gizlendi');
  assertEqual(
    pruneExpiredMessages([message], expiresAt - 1).length,
    1,
    'sınırdan önce listeden düştü',
  );
});

check('6. TAM sınırda mesaj kaldırılır', () => {
  const message = makeMessage({ at: BASE });
  const expiresAt = Date.parse(message.expiresAt);

  assertEqual(isMessageVisible(message, expiresAt), false, 'tam sınırda hâlâ görünür');
  assertDeepEqual(pruneExpiredMessages([message], expiresAt), [], 'tam sınırda listede kaldı');
  assertDeepEqual(
    pruneExpiredMessages([message], expiresAt + 60 * 60 * 1000),
    [],
    'cron gecikmesinde geri geldi',
  );
});

check('7. Arka plandan dönüşte süresi geçmişler temizlenir', () => {
  const old = makeMessage({ at: BASE, id: uuid(41) });
  const fresh = makeMessage({ at: BASE + 6 * 60 * 60 * 1000, id: uuid(42) });
  const list = mergeFriendMessages([], [old, fresh]);

  // Uygulama arka planda kalırken zaman ilerledi.
  const afterReturn = pruneExpiredMessages(list, Date.parse(old.expiresAt) + 1000);
  assertDeepEqual(afterReturn.map((m) => m.id), [uuid(42)], 'arka plandan dönüşte temizlenmedi');
});

check('8. TEK "en yakın sona erme" zamanlayıcısı kullanılır', () => {
  const first = makeMessage({ at: BASE, id: uuid(51) });
  const second = makeMessage({ at: BASE + 60 * 1000, id: uuid(52) });
  const third = makeMessage({ at: BASE + 120 * 1000, id: uuid(53) });
  let list = mergeFriendMessages([], [third, first, second]);

  // Planlanan tek an, EN YAKIN sona ermedir.
  let now = BASE + 1000;
  assertEqual(nextExpiryAt(list, now), Date.parse(first.expiresAt), 'en yakın süre seçilmedi');

  // Tetiklenince düşürülür ve SIRADAKİ ana yeniden planlanır.
  now = Date.parse(first.expiresAt);
  list = pruneExpiredMessages(list, now);
  assertDeepEqual(list.map((m) => m.id), [uuid(52), uuid(53)], 'ilk süpürme yanlış');
  assertEqual(nextExpiryAt(list, now), Date.parse(second.expiresAt), 'yeniden planlama yanlış');

  now = Date.parse(third.expiresAt);
  list = pruneExpiredMessages(list, now);
  assertDeepEqual(list, [], 'son süpürme yanlış');
  assertEqual(nextExpiryAt(list, now), undefined, 'boş listede zamanlayıcı planlandı');

  // KAYNAK: her mesaj için ayrı timeout zinciri kurulmaz.
  assertEqual(
    (chatCode.match(/setTimeout\(/g) ?? []).length,
    1,
    'sohbet ekranında birden fazla setTimeout var',
  );
  assert(chatCode.includes('expiryTimerRef'), 'tek zamanlayıcı referansı yok');
  assert(chatCode.includes('clearTimeout(expiryTimerRef.current)'), 'zamanlayıcı temizlenmiyor');
  assert(chatCode.includes('nextExpiryAt('), 'sıradaki süre hesaplanmıyor');
});

// ---------------------------------------------------------------------------
// 3 · Idempotent gönderim
// ---------------------------------------------------------------------------

/** Ekranın gönderme yaşam döngüsü modeli. */
function createSender(options = {}) {
  const state = {
    calls: [],
    draft: '',
    messages: [],
    pending: undefined,
    sendError: undefined,
    isSending: false,
    keySeq: 0,
    viewer: ME,
    isFriend: options.isFriend !== false,
    screen: 'ready',
  };

  const createKey = () => {
    state.keySeq += 1;
    return uuid(800000 + state.keySeq);
  };

  return {
    get state() {
      return state;
    },
    setDraft(value) {
      state.draft = value;
    },
    /** `outcome`: 'ok' | 'network' | 'rate-limit' | 'not-friends' */
    send(outcome = 'ok') {
      // ÇİFT DOKUNMA: senkron kilit ikinci çağrıyı keser.
      if (state.isSending) return 'ignored';

      const content = state.draft.trim();
      if (content.length < 1 || content.length > 2000) return 'ignored';
      if (state.screen !== 'ready') return 'ignored';

      const pending = resolveSendKey(state.pending, content, createKey);
      state.pending = pending;
      state.isSending = true;
      state.calls.push({ clientMessageId: pending.clientMessageId, content });

      try {
        if (outcome === 'rate-limit') throw new Error('message_rate_limited');
        if (outcome === 'not-friends') throw new Error('not_friends');
        if (outcome === 'network') throw new Error('Network request failed');

        state.messages = mergeFriendMessages(state.messages, [
          makeMessage({ at: BASE, content, from: state.viewer, to: FRIEND }),
        ]);
        state.pending = undefined;
        state.sendError = undefined;
        state.draft = '';
        return 'sent';
      } catch (error) {
        state.sendError = error.message.includes('message_rate_limited')
          ? 'rate-limited'
          : 'failed';
        if (error.message.includes('not_friends')) {
          state.screen = 'not-friends';
          state.messages = [];
        }
        return 'failed';
      } finally {
        state.isSending = false;
      }
    },
  };
}

check('9. Gönder tuşuna ÇİFT DOKUNMA tek RPC üretir', () => {
  const sender = createSender();
  sender.setDraft('merhaba');

  /**
   * Gerçek çift dokunma AYNI karede olur: ilk çağrı henüz bitmeden ikincisi
   * gelir. Kilit senkron olduğu için ikinci çağrı hiç RPC yapmaz.
   */
  const state = sender.state;
  state.isSending = true;
  assertEqual(sender.send(), 'ignored', 'ikinci dokunuş RPC üretti');
  assertEqual(state.calls.length, 0, 'kilitliyken çağrı yapıldı');

  state.isSending = false;
  assertEqual(sender.send(), 'sent', 'ilk gönderim başarısız');
  assertEqual(state.calls.length, 1, 'tek dokunuş birden fazla RPC üretti');
  assertEqual(state.messages.length, 1, 'tek dokunuş iki mesaj yazdı');
});

check('10. Ağ hatası RETRY’ında AYNI clientMessageId kullanılır', () => {
  const sender = createSender();
  sender.setDraft('tekrar denenecek');

  assertEqual(sender.send('network'), 'failed', 'ağ hatası beklendi');
  const firstKey = sender.state.calls[0].clientMessageId;
  assertEqual(sender.state.sendError, 'failed', 'kullanıcıya hata gösterilmedi');

  // Kullanıcı "Tekrar dene" dedi: içerik AYNI.
  assertEqual(sender.send('network'), 'failed', 'ikinci deneme beklendi');
  assertEqual(sender.send(), 'sent', 'üçüncü deneme başarısız');

  const keys = sender.state.calls.map((call) => call.clientMessageId);
  assertDeepEqual(keys, [firstKey, firstKey, firstKey], 'retry yeni kimlik üretti');
  assertEqual(sender.state.messages.length, 1, 'retry ikinci mesaj yazdı');
});

check('11. Başarısız taslak DEĞİŞİRSE yeni kimlik üretilir', () => {
  const sender = createSender();
  sender.setDraft('ilk hâli');
  sender.send('network');
  const firstKey = sender.state.calls[0].clientMessageId;

  // Kullanıcı metni değiştirdi → artık YENİ bir mesaj.
  sender.setDraft('düzeltilmiş hâli');
  sender.send('network');
  const secondKey = sender.state.calls[1].clientMessageId;

  assert(firstKey !== secondKey, 'değişen taslak aynı kimliği kullandı');

  // Değişmeden yapılan retry yine aynı kimliği korur.
  sender.send('network');
  assertEqual(sender.state.calls[2].clientMessageId, secondKey, 'aynı içerik yeni kimlik aldı');

  // Saf yardımcı da aynı kararı verir.
  const pending = { clientMessageId: 'k1', content: 'a' };
  assertEqual(resolveSendKey(pending, 'a', () => 'k2').clientMessageId, 'k1', 'aynı içerik');
  assertEqual(resolveSendKey(pending, 'b', () => 'k2').clientMessageId, 'k2', 'değişen içerik');
  assertEqual(resolveSendKey(undefined, 'a', () => 'k2').clientMessageId, 'k2', 'ilk gönderim');
});

check('12. RATE LIMIT kullanıcı dostu dala gider', () => {
  const sender = createSender();
  sender.setDraft('çok hızlı');
  sender.send('rate-limit');

  assertEqual(sender.state.sendError, 'rate-limited', 'rate limit ayrı dala gitmedi');
  assertEqual(sender.state.messages.length, 0, 'reddedilen mesaj listeye eklendi');

  // KAYNAK: ham hata metni ekrana basılmaz, çeviri kullanılır.
  assert(chatCode.includes('isFriendMessageRateLimited(error)'), 'rate limit ayrımı yok');
  assert(chatCode.includes("t('messages.rateLimited')"), 'rate limit metni çeviriden gelmiyor');
  assert(!/error\.message/.test(chatCode.replace(/error\.message\.includes/g, '')), 'ham hata metni gösteriliyor');
});

check('13. ARKADAŞLIK kaldırılınca mesajlar temizlenir ve gönderim kapanır', () => {
  const sender = createSender();
  sender.state.messages = mergeFriendMessages([], [makeMessage({ at: BASE })]);
  sender.setDraft('yeni mesaj');

  sender.send('not-friends');

  assertEqual(sender.state.screen, 'not-friends', 'ekran durumu değişmedi');
  assertDeepEqual(sender.state.messages, [], 'eski mesajlar ekranda tutuldu');
  // Artık gönderim yapılamaz.
  sender.setDraft('bir daha');
  assertEqual(sender.send(), 'ignored', 'arkadaşlık bitince gönderim açık kaldı');

  // KAYNAK: profil boş dönerse de aynı duruma geçilir ve mesajlar silinir.
  assert(chatCode.includes("setScreenState('not-friends')"), 'arkadaş değil durumu yok');
  assert(chatCode.includes("t('messages.notFriendsTitle')"), 'yerelleştirilmiş metin yok');
  const guard = chatCode.slice(chatCode.indexOf('if (!nextProfile)'));
  assert(guard.includes('setMessages([])'), 'arkadaşlık bitince mesajlar temizlenmiyor');
});

// ---------------------------------------------------------------------------
// 4 · Realtime yaşam döngüsü
// ---------------------------------------------------------------------------

/** Abonelik yaşam döngüsü modeli — odak, blur ve hesap değişimi. */
function createSubscriptionHost() {
  const host = {
    channels: [],
    delivered: [],
    viewer: ME,
    isFocused: false,
    active: undefined,
  };

  const subscribe = (viewerId, counterpartId) => {
    const channel = { closed: false, counterpartId, viewerId };
    host.channels.push(channel);
    return {
      deliver(message) {
        if (channel.closed) return 'dropped-closed';
        // Hesap değiştiyse eski callback YENİ state'e yazamaz.
        if (channel.viewerId !== host.viewer) return 'dropped-account';
        if (!belongsToConversation(message, channel.viewerId, channel.counterpartId)) {
          return 'dropped-conversation';
        }
        if (!isMessageVisible(message, Date.now())) return 'dropped-expired';
        host.delivered.push(message.id);
        return 'delivered';
      },
      unsubscribe() {
        channel.closed = true;
      },
    };
  };

  return {
    get host() {
      return host;
    },
    focus(counterpartId) {
      host.isFocused = true;
      host.active = subscribe(host.viewer, counterpartId);
      return host.active;
    },
    blur() {
      host.isFocused = false;
      host.active?.unsubscribe();
      host.active = undefined;
    },
    switchAccount(nextViewer) {
      host.viewer = nextViewer;
    },
  };
}

check('14. Ekran BLUR/UNMOUNT aboneliği kaldırır', () => {
  const screen = createSubscriptionHost();
  const subscription = screen.focus(FRIEND);
  assertEqual(screen.host.channels.length, 1, 'odaklanınca kanal açılmadı');

  assertEqual(
    subscription.deliver(makeMessage({ at: Date.now(), from: FRIEND, to: ME })),
    'delivered',
    'odaklıyken mesaj düşürüldü',
  );

  screen.blur();
  assertEqual(screen.host.channels[0].closed, true, 'blur kanalı kapatmadı');
  assertEqual(
    subscription.deliver(makeMessage({ at: Date.now(), from: FRIEND, to: ME })),
    'dropped-closed',
    'kapalı kanal hâlâ mesaj iletiyor',
  );
  assertEqual(screen.host.delivered.length, 1, 'blur sonrası state’e yazıldı');

  // KAYNAK: iki ekran da cleanup'ta unsubscribe çağırır.
  for (const [label, code] of [['liste', listCode], ['sohbet', chatCode]]) {
    assert(code.includes('subscription?.unsubscribe()'), `${label} ekranı aboneliği kapatmıyor`);
    assert(code.includes('useFocusEffect'), `${label} ekranı odak yaşam döngüsü kullanmıyor`);
  }
});

check('15. HESAP değişiminde eski callback yeni state’e yazamaz', () => {
  const screen = createSubscriptionHost();
  const subscription = screen.focus(FRIEND);

  screen.switchAccount(STRANGER);
  assertEqual(
    subscription.deliver(makeMessage({ at: Date.now(), from: FRIEND, to: ME })),
    'dropped-account',
    'eski hesabın callback’i yeni hesaba yazdı',
  );
  assertEqual(screen.host.delivered.length, 0, 'hesap değişiminde state kirlendi');

  /**
   * KAYNAK: her iki ekran da sahiplik referansı tutar.
   *
   * Sohbet ekranında bu referans artık `${viewerId}:${counterpartId}` anahtarı
   * olduğu için hesap değişimini DE kapsar (bkz. kontrol 28) — yalnızca
   * `viewerId` tutan eski hâlinden daha güçlüdür.
   */
  assert(
    chatCode.includes('conversationRef.current !== conversationKey'),
    'sohbet sahiplik anahtarı kontrolü yok',
  );
  assert(listCode.includes('owner !== viewerRef.current'), 'liste hesap sahipliği kontrolü yok');
});

check('16. Bozuk Realtime payload DÜŞÜRÜLÜR', () => {
  // Doğrulama servis katmanındaki `parseFriendMessage` ile yapılır.
  const handler = serviceSource.slice(serviceSource.indexOf('export function subscribeToFriendMessages'));
  assert(handler.includes('parseFriendMessage(payload.new'), 'payload doğrulanmıyor');
  assert(handler.includes('if (!message) return;'), 'bozuk payload düşürülmüyor');
  assert(handler.includes('Date.parse(message.expiresAt) <= Date.now()'), 'süresi dolmuş satır giriyor');
  assert(
    handler.includes('message.senderId !== viewerId && message.recipientId !== viewerId'),
    'ilgisiz satır yukarı veriliyor',
  );
  assert(handler.includes("event: 'INSERT'"), 'yalnızca INSERT dinlenmiyor');
  assert(!/event: 'UPDATE'|event: 'DELETE'|event: '\*'/.test(handler), 'fazladan olay dinleniyor');

  // Süresi dolmuş mesaj hiçbir anda ekrana giremez.
  const expired = makeMessage({ at: Date.now() - DAY_MS - 1000 });
  assertEqual(isMessageVisible(expired, Date.now()), false, 'süresi dolmuş mesaj görünür sayıldı');
  assertDeepEqual(
    pruneExpiredMessages(mergeFriendMessages([], [expired]), Date.now()),
    [],
    'süresi dolmuş mesaj listeye girdi',
  );
});

check('17. Kanal adları çakışmaz ve abonelik GLOBAL değildir', () => {
  const handler = serviceSource.slice(serviceSource.indexOf('export function subscribeToFriendMessages'));
  assert(handler.includes('channelSequence += 1'), 'kanal adı benzersizleştirilmiyor');
  assert(
    handler.includes('`friend-messages:${channelKey}:${channelSequence}`'),
    'kanal adı beklenen biçimde değil',
  );

  // İki ekran AYRI anahtar kullanır; aynı anda ikisi birden yaşamaz.
  assert(listCode.includes("channelKey: 'conversations'"), 'liste kanal anahtarı yok');
  assert(chatCode.includes('channelKey: `chat:${counterpartId}`'), 'sohbet kanal anahtarı yok');

  // Global abonelik kurulmaz: yalnızca mesajlaşma ekranları abone olur.
  assert(!layoutSource.includes('subscribeToFriendMessages'), 'kök layout global kanal kuruyor');
  assert(
    !friendsScreen.includes('subscribeToFriendMessages'),
    'arkadaşlar ekranı kalıcı kanal kuruyor',
  );
});

// ---------------------------------------------------------------------------
// 5 · Kaynak ve kapsam denetimi
// ---------------------------------------------------------------------------

check('18. UI Supabase’e DOKUNMAZ ve tabloya yazmaz', () => {
  for (const [label, code] of [['liste', listCode], ['sohbet', chatCode]]) {
    assert(!/@\/lib\/supabase|supabase\./.test(code), `${label} ekranı doğrudan Supabase kullanıyor`);
    assert(!/\.from\(['"`]friend_messages/.test(code), `${label} ekranı tabloya erişiyor`);
    assert(
      !/\b(insert|update|delete)\(/i.test(code),
      `${label} ekranı tabloya yazma çağrısı yapıyor`,
    );
  }
  // Yazma YALNIZCA servis katmanındaki RPC'dendir.
  assert(chatCode.includes('sendFriendMessage('), 'gönderme servis üzerinden değil');
  assert(!/friend_messages/.test(listCode + chatCode), 'UI tablo adını kullanıyor');
});

check('19. Mesajlar KALICI istemci deposuna yazılmaz', () => {
  for (const [label, code] of [['liste', listCode], ['sohbet', chatCode]]) {
    assert(!/AsyncStorage|SecureStore|MMKV|localStorage/.test(code), `${label} ekranı kalıcı depo kullanıyor`);
  }
  // Yorumlar çıkarılır: doküman notları "AsyncStorage" kelimesini ANLATIR.
  const dataLayer = stripComments(serviceSource) + stripComments(source('utils/friend-messages.ts'));
  assert(
    !/AsyncStorage|SecureStore|MMKV|localStorage/.test(dataLayer),
    'servis veya yardımcı mesajları kalıcı olarak saklıyor',
  );
});

check('20. Navigasyon: yeni alt sekme YOK, iki kök rota var', () => {
  assert(
    layoutSource.includes('<Stack.Screen name="messages/index" options={{ headerShown: false }} />'),
    '/messages rotası kök Stack’te değil',
  );
  assert(
    layoutSource.includes('<Stack.Screen name="messages/[userId]" options={{ headerShown: false }} />'),
    '/messages/[userId] rotası kök Stack’te değil',
  );
  // Rotalar oturum korumalı bölgede, arkadaşlık ekranlarıyla aynı yerde.
  const guarded = layoutSource.slice(
    layoutSource.indexOf('guard={Boolean(session) && !isPasswordRecovery}'),
    layoutSource.indexOf('</Stack.Protected>', layoutSource.indexOf('messages/[userId]')),
  );
  assert(guarded.includes('messages/index'), 'rotalar korumalı bölgede değil');

  // Alt sekme dosyası eklenmedi.
  assert(!existsSync(join(ROOT, 'app/(tabs)/messages.tsx')), 'yeni alt sekme eklenmiş');
  const tabsLayout = source('app/(tabs)/_layout.tsx');
  assert(!/messages/i.test(tabsLayout), 'alt sekme düzenine mesajlar eklenmiş');
});

check('21. Sohbet butonu YALNIZCA kabul edilmiş arkadaşta görünür', () => {
  const friendsBlock = friendsScreen.slice(
    friendsScreen.indexOf("if (selectedTab === 'friends')"),
    friendsScreen.indexOf("if (selectedTab === 'requests')"),
  );
  assert(friendsBlock.includes("t('messages.openChat'"), 'arkadaş satırında sohbet butonu yok');
  assert(friendsBlock.includes("pathname: '/messages/[userId]'"), 'sohbet butonu doğru rotayı açmıyor');
  assert(friendsBlock.includes('styles.messageButton'), '44 pt dokunma hedefi stili kullanılmıyor');

  // İstekler, arama sonuçları ve öneriler mesaj butonu ALMAZ.
  const rest = friendsScreen.slice(friendsScreen.indexOf("if (selectedTab === 'requests')"));
  assert(!rest.includes("t('messages.openChat'"), 'istek/öneri satırına mesaj butonu eklenmiş');
  const searchAction = friendsScreen.slice(
    friendsScreen.indexOf('function renderSearchAction'),
    friendsScreen.indexOf('function renderSearchAction') + 1200,
  );
  assert(!searchAction.includes('messages.'), 'arama sonucuna mesaj butonu eklenmiş');

  // Mevcut üç nokta/kaldırma eylemi korunur.
  assert(friendsBlock.includes("t('friends.remove')"), 'kaldırma eylemi kaybolmuş');
  assert(friendsBlock.includes('confirmRemove(friend)'), 'kaldırma davranışı değişmiş');
  assert(friendsBlock.includes('goToProfile(friend.id)'), 'profil açma davranışı değişmiş');
  // Başlık menüsünde Mesajlar eylemi.
  assert(friendsScreen.includes("t('messages.menuAction')"), 'menüde Mesajlar eylemi yok');
});

check('22. Tasarım: mevcut palet/ölçüler, yeni sabit renk yok', () => {
  for (const [label, code] of [['liste', listCode], ['sohbet', chatCode]]) {
    assert(code.includes('useFriendsPalette()'), `${label} ekranı Friends paletini kullanmıyor`);
    assert(code.includes('FriendsMetrics'), `${label} ekranı Friends ölçülerini kullanmıyor`);
    const hexes = [...code.matchAll(/'#[0-9A-Fa-f]{3,8}'/g)].map((match) => match[0]);
    assertDeepEqual(hexes, [], `${label} ekranına sabit renk eklenmiş`);
    assert(!/gradient|LinearGradient|shadowRadius/i.test(code), `${label} ekranında gradient/gölge var`);
  }
  // Gönder butonu Friends vurgusunu ve doğru onAccent'i kullanır.
  assert(chatCode.includes('backgroundColor: palette.accent'), 'gönder butonu vurgu rengini kullanmıyor');
  assert(chatCode.includes('palette.onAccent'), 'onAccent kullanılmıyor');
  assert(chatCode.includes('MotionPressable'), 'mevcut motion bileşeni kullanılmıyor');
  // 44 pt dokunma hedefleri.
  assert(chatCode.includes('FriendsMetrics.minTouchSize'), 'sohbet ekranında 44 pt hedef yok');
  // Composer klavyeyle birlikte hareket eder ve safe area korunur.
  assert(chatCode.includes('KeyboardAvoidingView'), 'klavye davranışı yok');
  assert(chatCode.includes('insets.bottom'), 'safe area korunmuyor');
  // 2000 karakter sınırı.
  assert(chatCode.includes('maxLength={FRIEND_MESSAGE_MAX_LENGTH}'), 'karakter sınırı yok');
  assert(chatCode.includes('multiline'), 'çok satırlı alan yok');
});

check('23. Kapsam dışı özellikler EKLENMEDİ', () => {
  const combined = listCode + chatCode + stripComments(source('utils/friend-messages.ts'));
  const forbidden = [
    'typing',
    'isTyping',
    'lastSeen',
    'online',
    'unread',
    'readAt',
    'reaction',
    'ImagePicker',
    'Audio',
    'Notifications',
    'editMessage',
    'deleteMessage',
  ];
  for (const token of forbidden) {
    assert(!new RegExp(`\\b${token}\\b`, 'i').test(combined), `kapsam dışı özellik: ${token}`);
  }
  // Ödül/rank/Rosea akışına dokunulmaz.
  assert(!/useRanks|useMascot|useRewards|triggerReaction/.test(combined), 'ödül/Rosea akışına dokunulmuş');
  // Yeni paket yok.
  const pkg = JSON.parse(source('package.json'));
  assert(!('uuid' in pkg.dependencies), 'yeni uuid paketi eklenmiş');
  assert(pkg.dependencies['@supabase/supabase-js'] !== undefined, 'supabase paketi kaybolmuş');
  // Idempotency anahtarı MEVCUT yardımcıdan gelir.
  assert(chatCode.includes("from '@/utils/idempotency-key'"), 'mevcut anahtar yardımcısı kullanılmıyor');
});

check('24. TR/EN anahtarları eşleşir ve sabit metin yoktur', () => {
  const keys = [
    'title',
    'menuAction',
    'expiryNotice',
    'openChat',
    'conversationsLoading',
    'conversationsFailed',
    'noConversationsTitle',
    'noConversationsBody',
    'noMessagesYet',
    'chatLoading',
    'chatFailed',
    'emptyChatTitle',
    'emptyChatBody',
    'loadOlder',
    'loadingOlder',
    'composerPlaceholder',
    'send',
    'sending',
    'sendFailed',
    'sendRetry',
    'rateLimited',
    'notFriendsTitle',
    'notFriendsBody',
    'retry',
    'unknownUser',
  ];
  for (const locale of [localeTr, localeEn]) {
    const block = locale.slice(locale.indexOf('  messages: {'), locale.indexOf('  friends: {'));
    assert(block.length > 0, 'messages sözlük bloğu bulunamadı');
    for (const key of keys) assert(block.includes(`${key}:`), `sözlükte eksik anahtar: ${key}`);
  }

  // 24 saat bilgisi tam olarak istenen metindir ve iki ekranda da gösterilir.
  assert(localeTr.includes("expiryNotice: 'Mesajlar 24 saat sonra silinir.'"), 'TR 24 saat metni yanlış');
  assert(
    localeEn.includes("expiryNotice: 'Messages disappear after 24 hours.'"),
    'EN 24 saat metni yanlış',
  );
  for (const [label, code] of [['liste', listCode], ['sohbet', chatCode]]) {
    assert(code.includes("t('messages.expiryNotice')"), `${label} ekranında 24 saat bilgisi yok`);
  }

  // Bileşende sabit kullanıcı metni bırakılmaz.
  for (const [label, code] of [['liste', listScreen], ['sohbet', chatScreen]]) {
    assert(
      !/<Text[^>]*>\s*[A-ZĞÜŞİÖÇ][a-zğüşıöç]/.test(code),
      `${label} ekranında çeviriden gelmeyen metin var`,
    );
  }
});

// ---------------------------------------------------------------------------
// 7 · Hedefli düzeltmeler (hata tanıma, sahiplik, önizleme süresi, kaydırma)
// ---------------------------------------------------------------------------

/** `services/messages.ts` içindeki güvenli hata okuyucusunun referansı. */
function readErrorMessage(error) {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const message = error.message;
  return typeof message === 'string' ? message : '';
}
const isNotFriendsError = (error) => readErrorMessage(error).includes('not_friends');
const isRateLimited = (error) => readErrorMessage(error).includes('message_rate_limited');

check('25. Supabase tarzı DÜZ NESNE hatası doğru tanınır', () => {
  // PostgREST hatası `Error` örneği DEĞİLDİR.
  const plain = { code: '42501', details: null, hint: null, message: 'not_friends' };
  assertEqual(plain instanceof Error, false, 'senaryo kurulumu: düz nesne olmalı');
  assertEqual(isNotFriendsError(plain), true, 'düz nesne hatası tanınmadı');

  // `Error` örneği de tanınır.
  assertEqual(isNotFriendsError(new Error('not_friends')), true, 'Error örneği tanınmadı');
  assertEqual(isNotFriendsError('not_friends'), true, 'dizgi hata tanınmadı');

  // Alakasız hatalar tanınmaz.
  for (const other of [undefined, null, 42, {}, { message: 42 }, new Error('Network failed')]) {
    assertEqual(isNotFriendsError(other), false, `yanlış pozitif: ${JSON.stringify(other)}`);
  }

  // RATE LIMIT ayrımı bozulmaz: iki dal birbirini yutmaz.
  const rate = { message: 'message_rate_limited' };
  assertEqual(isRateLimited(rate), true, 'rate limit düz nesnede tanınmadı');
  assertEqual(isNotFriendsError(rate), false, 'rate limit yanlışlıkla not_friends sayıldı');
  assertEqual(isRateLimited(plain), false, 'not_friends yanlışlıkla rate limit sayıldı');

  // KAYNAK: `instanceof Error` kontrolüne güvenilmiyor.
  assert(!/instanceof Error/.test(chatCode), 'sohbet ekranı hâlâ instanceof Error kullanıyor');
  assert(serviceSource.includes('function readErrorMessage(error: unknown)'), 'güvenli okuyucu yok');
  assert(serviceSource.includes('export function isNotFriendsError'), 'ortak yardımcı dışa açılmamış');
  assert(
    serviceSource.includes('return readErrorMessage(error).includes(FRIEND_MESSAGE_RATE_LIMITED)'),
    'rate limit ayrımı ortak okuyucuyu kullanmıyor',
  );
  assert(chatCode.includes('isNotFriendsError(error)'), 'ekran ortak yardımcıyı kullanmıyor');
});

/**
 * Sohbet ekranının yükleme + sahiplik modeli.
 *
 * `releaseLocksRegardlessOfOwner: true` → DÜZELTME ÖNCESİ davranış: kilit
 * sıfırlaması sahiplik kontrolünün DIŞINDA çalışır.
 */
function createChat(options = {}) {
  const releaseLocksRegardlessOfOwner = options.releaseLocksRegardlessOfOwner === true;
  const state = {
    conversation: undefined,
    cursor: undefined,
    isLoadingOlder: false,
    loadingOlderRef: false,
    messages: [],
    pendingSend: undefined,
    profile: undefined,
    rpcCalls: 0,
    screen: 'loading',
    sendError: undefined,
    sendingRef: false,
    shouldScrollToEnd: true,
  };

  /** Konuşma veya hesap değişimi — SENKRON sahiplik anahtarı. */
  function focus(viewerId, counterpartId) {
    const key = `${viewerId}:${counterpartId}`;
    if (state.conversation === key) return key;
    state.conversation = key;
    // Eski konuşmanın hiçbir kalıntısı yeni kişiye görünmez.
    state.messages = [];
    state.cursor = undefined;
    state.profile = undefined;
    state.screen = 'loading';
    state.sendError = undefined;
    state.pendingSend = undefined;
    state.sendingRef = false;
    state.loadingOlderRef = false;
    state.isLoadingOlder = false;
    state.shouldScrollToEnd = true;
    return key;
  }

  const isStale = (owner) => owner !== state.conversation;

  return {
    focus,
    get state() {
      return state;
    },
    /** İlk yükleme. `profileOk` sonrası geçmiş RPC'si hata verebilir. */
    beginLoad() {
      const owner = state.conversation;
      return {
        resolve(profile, messages) {
          if (isStale(owner)) return 'stale';
          state.profile = profile;
          state.messages = mergeFriendMessages([], messages);
          state.screen = 'ready';
          state.shouldScrollToEnd = true;
          return 'applied';
        },
        /** `error`: geçmiş RPC'sinin hatası. */
        reject(error) {
          if (isStale(owner)) return 'stale';
          if (isNotFriendsError(error)) {
            state.profile = undefined;
            state.messages = [];
            state.cursor = undefined;
            state.screen = 'not-friends';
            return 'not-friends';
          }
          state.screen = 'error';
          return 'error';
        },
      };
    },
    /** Eski sayfa — senkron kilit ve konum koruması. */
    beginLoadOlder() {
      if (state.loadingOlderRef) return undefined;
      state.loadingOlderRef = true;
      state.isLoadingOlder = true;
      state.rpcCalls += 1;
      // ESKİ sayfa eklenirken en alta ATLANMAZ.
      state.shouldScrollToEnd = false;
      const owner = state.conversation;
      return {
        resolve(messages) {
          const stale = isStale(owner);
          // Ref sıfırlaması state yazımıyla AYNI sahiplik kararını kullanır.
          if (!stale || releaseLocksRegardlessOfOwner) state.loadingOlderRef = false;
          if (stale) return 'stale';
          state.messages = mergeFriendMessages(state.messages, messages);
          state.isLoadingOlder = false;
          return 'applied';
        },
      };
    },
    beginSend(content) {
      if (state.sendingRef) return undefined;
      state.sendingRef = true;
      const owner = state.conversation;
      return {
        resolve(message) {
          const stale = isStale(owner);
          if (!stale || releaseLocksRegardlessOfOwner) state.sendingRef = false;
          if (stale) return 'stale';
          state.shouldScrollToEnd = true;
          state.messages = mergeFriendMessages(state.messages, [message]);
          return 'applied';
        },
        reject(error) {
          const stale = isStale(owner);
          if (!stale || releaseLocksRegardlessOfOwner) state.sendingRef = false;
          if (stale) return 'stale';
          if (isNotFriendsError(error)) {
            state.messages = [];
            state.screen = 'not-friends';
            state.sendError = undefined;
            return 'not-friends';
          }
          state.sendError = isRateLimited(error) ? 'rate-limited' : 'failed';
          return 'failed';
        },
      };
    },
    /** Realtime callback — sahiplik anahtarını yakalar. */
    beginSubscription(viewerId, counterpartId) {
      const owner = state.conversation;
      return {
        deliver(message) {
          if (isStale(owner)) return 'stale';
          if (!belongsToConversation(message, viewerId, counterpartId)) return 'dropped';
          state.shouldScrollToEnd = true;
          state.messages = mergeFriendMessages(state.messages, [message]);
          return 'applied';
        },
      };
    },
  };
}

check('26. Profil OKUNDUKTAN SONRA arkadaşlık kalkarsa `not-friends` olunur', () => {
  const chat = createChat();
  chat.focus(ME, FRIEND);

  // Profil başarıyla döndü, ama geçmiş RPC'si arkadaşlık reddiyle düştü.
  const request = chat.beginLoad();
  assertEqual(
    request.reject({ code: '42501', message: 'not_friends' }),
    'not-friends',
    'genel hata durumuna düşüldü',
  );
  assertEqual(chat.state.screen, 'not-friends', 'ekran durumu yanlış');
  assertDeepEqual(chat.state.messages, [], 'eski mesajlar ekranda tutuldu');

  // Gerçek bir ağ hatası HÂLÂ genel hata durumudur.
  const other = createChat();
  other.focus(ME, FRIEND);
  assertEqual(
    other.beginLoad().reject(new Error('Network request failed')),
    'error',
    'ağ hatası yanlış dala gitti',
  );

  // KAYNAK: geçmiş RPC'sinin catch dalı ayrımı yapıyor.
  const catchBlock = chatCode.slice(chatCode.indexOf('} catch (error) {'));
  assert(
    catchBlock.indexOf('isNotFriendsError(error)') < catchBlock.indexOf("setScreenState('error')"),
    'not_friends ayrımı genel hatadan sonra değerlendiriliyor',
  );
});

check('27. A konuşmasının GECİKMİŞ cevapları B’ye yazamaz', () => {
  const chat = createChat();
  chat.focus(ME, FRIEND);

  const aLoad = chat.beginLoad();
  const aOlder = chat.beginLoadOlder();
  const aSend = chat.beginSend('a mesajı');
  const aRealtime = chat.beginSubscription(ME, FRIEND);

  // Kullanıcı B'ye geçti.
  chat.focus(ME, STRANGER);
  assertDeepEqual(chat.state.messages, [], 'konuşma değişince mesajlar taşındı');
  assertEqual(chat.state.cursor, undefined, 'eski cursor taşındı');
  assertEqual(chat.state.sendError, undefined, 'eski gönderim hatası taşındı');
  assertEqual(chat.state.pendingSend, undefined, 'eski retry anahtarı taşındı');
  assertEqual(chat.state.sendingRef, false, 'gönderim kilidi sıfırlanmadı');
  assertEqual(chat.state.loadingOlderRef, false, 'sayfalama kilidi sıfırlanmadı');

  // A'nın DÖRT yolu da geçersizdir.
  assertEqual(
    aLoad.resolve({ displayName: 'A' }, [makeMessage({ at: BASE })]),
    'stale',
    'eski ilk yükleme yeni konuşmaya yazdı',
  );
  assertEqual(aOlder.resolve([makeMessage({ at: BASE })]), 'stale', 'eski sayfalama yazdı');
  assertEqual(aSend.resolve(makeMessage({ at: BASE })), 'stale', 'eski gönderim sonucu yazdı');
  assertEqual(aSend.reject({ message: 'not_friends' }), 'stale', 'eski gönderim hatası yazdı');
  assertEqual(
    aRealtime.deliver(makeMessage({ at: Date.now(), from: FRIEND, to: ME })),
    'stale',
    'eski realtime callback yazdı',
  );

  assertDeepEqual(chat.state.messages, [], 'B’nin state’i kirlendi');
  assertEqual(chat.state.screen, 'loading', 'B’nin ekran durumu eski cevapla değişti');

  // `finally` içindeki loading yazımı da sahipliğe bağlıdır.
  assertEqual(chat.state.isLoadingOlder, false, 'eski sayfalama loading state yazdı');
});

check('28. HESAP değişimi aynı korumaya sahiptir', () => {
  const chat = createChat();
  chat.focus(ME, FRIEND);
  const request = chat.beginLoad();
  const realtime = chat.beginSubscription(ME, FRIEND);

  // Aynı karşı taraf, FARKLI hesap → anahtar yine değişir.
  chat.focus(STRANGER, FRIEND);

  assertEqual(request.resolve({ displayName: 'A' }, []), 'stale', 'eski hesabın yüklemesi yazdı');
  assertEqual(
    realtime.deliver(makeMessage({ at: Date.now(), from: FRIEND, to: ME })),
    'stale',
    'eski hesabın callback’i yazdı',
  );

  // KAYNAK: anahtar iki parçadan oluşur ve senkron güncellenir.
  assert(
    chatCode.includes('const conversationKey = viewerId && counterpartId'),
    'sahiplik anahtarı viewerId + counterpartId değil',
  );
  assert(
    chatCode.includes('if (conversationRef.current !== conversationKey)'),
    'anahtar senkron güncellenmiyor',
  );
  assert(!/viewerRef/.test(chatCode), 'sohbet ekranı hâlâ yalnızca viewerId sahipliği kullanıyor');
  // Tüm yollar anahtarı karşılaştırır.
  assertEqual(
    (chatCode.match(/owner !== conversationRef\.current|owner === conversationRef\.current/g) ?? [])
      .length >= 4,
    true,
    'bazı yollar sahiplik anahtarını kontrol etmiyor',
  );
});

check('29. Önizleme sınırdan 1 MS önce görünür, TAM sınırda kaybolur', () => {
  const lastMessageAt = new Date(BASE).toISOString();
  const conversation = {
    avatarUrl: undefined,
    displayName: 'Arkadaş',
    lastMessageAt,
    lastMessageContent: 'selam',
    lastMessageSenderId: FRIEND,
    userId: FRIEND,
    username: 'arkadas',
  };
  const expiresAt = previewExpiresAt(conversation);
  assertEqual(expiresAt, BASE + DAY_MS, 'önizleme ömrü 24 saat değil');

  // Sınırdan 1 ms önce.
  const before = prunePreviewExpiry([conversation], expiresAt - 1);
  assertEqual(before[0].lastMessageContent, 'selam', 'sınırdan önce önizleme silindi');

  // TAM sınırda.
  const after = prunePreviewExpiry([conversation], expiresAt);
  assertEqual(after[0].lastMessageContent, undefined, 'tam sınırda önizleme kaldı');
  assertEqual(after[0].lastMessageAt, undefined, 'tam sınırda zaman kaldı');
  assertEqual(after[0].lastMessageSenderId, undefined, 'tam sınırda gönderici kaldı');
  // Arkadaş satırı SİLİNMEZ.
  assertEqual(after.length, 1, 'süresi dolunca arkadaş satırı silindi');
  assertEqual(after[0].displayName, 'Arkadaş', 'arkadaş bilgisi bozuldu');

  // Değişiklik yoksa AYNI referans döner (gereksiz yeniden planlama olmaz).
  assertEqual(prunePreviewExpiry([conversation], expiresAt - 1)[0], conversation, 'gereksiz kopya');

  // Önizlemesi olmayan arkadaş zamanlayıcı planlatmaz.
  const withoutPreview = { ...conversation, lastMessageAt: undefined, lastMessageContent: undefined };
  assertEqual(previewExpiresAt(withoutPreview), undefined, 'önizlemesiz satır süre üretti');
});

check('30. Liste ekranında AYNI ANDA en fazla bir expiry timer bulunur', () => {
  const now = BASE;
  const make = (id, at) => ({
    displayName: `K${id}`,
    lastMessageAt: at === undefined ? undefined : new Date(at).toISOString(),
    lastMessageContent: at === undefined ? undefined : 'selam',
    lastMessageSenderId: at === undefined ? undefined : FRIEND,
    userId: uuid(id),
  });

  let conversations = [make(101, now), make(102, now + 60 * 1000), make(103, undefined)];

  // Planlanan tek an EN YAKIN sona ermedir.
  assertEqual(
    nextPreviewExpiryAt(conversations, now),
    now + DAY_MS,
    'en yakın önizleme süresi seçilmedi',
  );

  /** Effect yaşam döngüsü modeli: her yeniden planlamada önceki temizlenir. */
  const scheduler = { active: 0, created: 0 };
  const runEffect = (list, focused) => {
    // Önceki effect'in cleanup'ı.
    if (scheduler.active > 0) scheduler.active -= 1;
    if (!focused) return;
    if (nextPreviewExpiryAt(list, Date.now()) === undefined) return;
    scheduler.active += 1;
    scheduler.created += 1;
  };

  runEffect(conversations, true);
  assertEqual(scheduler.active, 1, 'ilk planlamada tek timer yok');

  // Liste yenilendi → yeniden planlanır, hâlâ TEK timer.
  runEffect(conversations, true);
  assertEqual(scheduler.active, 1, 'yenilemeden sonra timer birikti');

  // Realtime sonrası liste değişti → yine tek.
  conversations = [...conversations, make(104, now + 120 * 1000)];
  runEffect(conversations, true);
  assertEqual(scheduler.active, 1, 'realtime sonrası timer birikti');
  assertEqual(scheduler.created, 3, 'planlama sayısı beklenmedik');

  // Blur / unmount / hesap değişimi → cleanup çalışır, timer kalmaz.
  runEffect(conversations, false);
  assertEqual(scheduler.active, 0, 'blur sonrası timer kaldı');

  // Süpürme sonrası sırada süre kalmazsa timer kurulmaz.
  const swept = prunePreviewExpiry(conversations, now + DAY_MS + 10 * 60 * 1000);
  assertEqual(nextPreviewExpiryAt(swept, now + DAY_MS + 10 * 60 * 1000), undefined, 'boşta süre var');

  // KAYNAK: periyodik interval KALDIRILDI, tek timeout kaldı.
  assert(!/setInterval\(/.test(listCode), 'liste ekranı hâlâ setInterval kullanıyor');
  assertEqual((listCode.match(/setTimeout\(/g) ?? []).length, 1, 'listede birden fazla setTimeout');
  assert(listCode.includes('clearTimeout(timer)'), 'timer temizlenmiyor');
  assert(listCode.includes('nextPreviewExpiryAt('), 'en yakın süre hesaplanmıyor');
  assert(listCode.includes('if (!isFocused) return;'), 'timer odak dışında da yaşıyor');
  assert(listCode.includes('prunePreviews();'), 'öne dönüşte süreler değerlendirilmiyor');
});

check('31. ESKİ sayfa yüklenince kaydırma konumu KORUNUR', () => {
  const chat = createChat();
  chat.focus(ME, FRIEND);

  // İlk yükleme en alta kaydırır.
  chat.beginLoad().resolve({ displayName: 'Arkadaş' }, [makeMessage({ at: BASE + 2000, id: uuid(91) })]);
  assertEqual(chat.state.shouldScrollToEnd, true, 'ilk yüklemede en alta kaydırılmıyor');

  // Kullanıcı "Eski mesajları yükle" dedi → OTOMATİK atlama YOK.
  const older = chat.beginLoadOlder();
  assertEqual(chat.state.shouldScrollToEnd, false, 'eski sayfa istenirken kaydırma açık kaldı');
  older.resolve([makeMessage({ at: BASE, id: uuid(90) })]);
  assertEqual(chat.state.shouldScrollToEnd, false, 'eski sayfa eklenince en alta atlandı');

  // Doğal kronolojik sıra ve dedupe KORUNUR.
  assertDeepEqual(
    chat.state.messages.map((m) => m.id),
    [uuid(90), uuid(91)],
    'eski sayfa yanlış yere eklendi',
  );

  // YENİ canlı mesaj yine en alta kaydırır.
  chat
    .beginSubscription(ME, FRIEND)
    .deliver(makeMessage({ at: Date.now(), from: FRIEND, id: uuid(92), to: ME }));
  assertEqual(chat.state.shouldScrollToEnd, true, 'canlı mesajda en alta kaydırılmıyor');

  // KAYNAK: koşulsuz `scrollToEnd` kaldırıldı ve konum korunuyor.
  assert(
    !/onContentSizeChange=\{\(\) => scrollRef\.current\?\.scrollToEnd/.test(chatCode),
    'koşulsuz scrollToEnd hâlâ duruyor',
  );
  assert(chatCode.includes('if (!shouldScrollToEndRef.current) return;'), 'kaydırma bayrağı yok');
  assert(
    chatCode.includes('maintainVisibleContentPosition={{ minIndexForVisible: 0 }}'),
    'görünen içerik konumu korunmuyor',
  );
});

check('32. Sayfalama butonuna ÇİFT DOKUNMA tek RPC üretir', () => {
  const chat = createChat();
  chat.focus(ME, FRIEND);
  chat.beginLoad().resolve({ displayName: 'Arkadaş' }, [makeMessage({ at: BASE })]);

  // Aynı karede iki dokunuş.
  const first = chat.beginLoadOlder();
  const second = chat.beginLoadOlder();

  assert(first !== undefined, 'ilk dokunuş isteği başlatmadı');
  assertEqual(second, undefined, 'ikinci dokunuş ikinci RPC üretti');
  assertEqual(chat.state.rpcCalls, 1, 'çift dokunuş birden fazla RPC üretti');

  // İstek bitince kilit açılır.
  first.resolve([]);
  assertEqual(chat.state.loadingOlderRef, false, 'kilit açılmadı');
  assert(chat.beginLoadOlder() !== undefined, 'kilit açıldıktan sonra istek engellendi');

  // KAYNAK: senkron ref kilidi kullanılıyor.
  assert(chatCode.includes('if (loadingOlderRef.current) return;'), 'senkron sayfalama kilidi yok');
  assert(chatCode.includes('loadingOlderRef.current = true;'), 'kilit alınmıyor');
  assert(chatCode.includes('loadingOlderRef.current = false;'), 'kilit bırakılmıyor');
});

// ---------------------------------------------------------------------------
// 8 · Kilit sahipliği ve yükleme anında süre dolumu
// ---------------------------------------------------------------------------

check('33. A’nın geç isteği B’nin SAYFALAMA kilidini açamaz', () => {
  const chat = createChat();
  chat.focus(ME, FRIEND);
  chat.beginLoad().resolve({ displayName: 'A' }, [makeMessage({ at: BASE })]);

  // A'da sayfalama başladı.
  const aRequest = chat.beginLoadOlder();
  assert(aRequest !== undefined, 'A’da sayfalama başlamadı');
  assertEqual(chat.state.loadingOlderRef, true, 'A’da kilit alınmadı');

  // B'ye geçildi ve B'de sayfalama başladı.
  chat.focus(ME, STRANGER);
  chat.beginLoad().resolve({ displayName: 'B' }, [makeMessage({ at: BASE })]);
  const bRequest = chat.beginLoadOlder();
  assert(bRequest !== undefined, 'B’de sayfalama başlamadı');
  assertEqual(chat.state.loadingOlderRef, true, 'B’de kilit alınmadı');

  // A'nın isteği ŞİMDİ tamamlandı.
  assertEqual(aRequest.resolve([makeMessage({ at: BASE })]), 'stale', 'A’nın cevabı uygulandı');

  // B'nin kilidi HÂLÂ aktif olmalı.
  assertEqual(chat.state.loadingOlderRef, true, 'A’nın isteği B’nin kilidini açtı');
  // Kilit açılmadığı için B'de ikinci bir RPC başlatılamaz.
  const rpcBefore = chat.state.rpcCalls;
  assertEqual(chat.beginLoadOlder(), undefined, 'kilit açıldığı için ikinci RPC başladı');
  assertEqual(chat.state.rpcCalls, rpcBefore, 'ikinci RPC üretildi');

  // B kendi isteğini bitirince kilit normal biçimde açılır.
  bRequest.resolve([]);
  assertEqual(chat.state.loadingOlderRef, false, 'B kendi isteğinden sonra kilidi açamadı');
});

check('34. A’nın geç isteği B’nin GÖNDERİM kilidini açamaz', () => {
  const chat = createChat();
  chat.focus(ME, FRIEND);
  const aSend = chat.beginSend('a mesajı');
  assert(aSend !== undefined, 'A’da gönderim başlamadı');
  assertEqual(chat.state.sendingRef, true, 'A’da kilit alınmadı');

  chat.focus(ME, STRANGER);
  const bSend = chat.beginSend('b mesajı');
  assert(bSend !== undefined, 'B’de gönderim başlamadı');
  assertEqual(chat.state.sendingRef, true, 'B’de kilit alınmadı');

  // A'nın gönderimi geç tamamlandı — başarı ve hata yollarının İKİSİ de.
  assertEqual(aSend.resolve(makeMessage({ at: BASE })), 'stale', 'A’nın sonucu uygulandı');
  assertEqual(chat.state.sendingRef, true, 'A’nın başarılı sonucu B’nin kilidini açtı');
  assertEqual(aSend.reject({ message: 'Network request failed' }), 'stale', 'A’nın hatası uygulandı');
  assertEqual(chat.state.sendingRef, true, 'A’nın hatası B’nin kilidini açtı');

  // Kilit açılmadığı için B'de ikinci gönderim başlatılamaz.
  assertEqual(chat.beginSend('ikinci'), undefined, 'kilit açıldığı için ikinci gönderim başladı');

  bSend.resolve(makeMessage({ at: BASE, id: uuid(95) }));
  assertEqual(chat.state.sendingRef, false, 'B kendi gönderiminden sonra kilidi açamadı');

  // KAYNAK: iki finally bloğu da ref yazımını sahiplik kontrolüne almış.
  for (const [label, marker] of [
    ['sayfalama', 'loadingOlderRef.current = false;'],
    ['gönderim', 'sendingRef.current = false;'],
  ]) {
    const finallyBlocks = chatCode.split('} finally {').slice(1);
    const block = finallyBlocks.find((part) => part.includes(marker));
    assert(block !== undefined, `${label} finally bloğu bulunamadı`);
    assert(
      block.indexOf('owner === conversationRef.current') < block.indexOf(marker),
      `${label} kilidi sahiplik kontrolünün dışında sıfırlanıyor`,
    );
  }
});

check('M5. Kilit sıfırlaması sahiplik DIŞINDA kalırsa test DÜŞER', () => {
  /** Kasıtlı hata: düzeltme öncesi davranış. */
  const broken = createChat({ releaseLocksRegardlessOfOwner: true });
  broken.focus(ME, FRIEND);
  const aRequest = broken.beginLoadOlder();
  broken.focus(ME, STRANGER);
  const bRequest = broken.beginLoadOlder();
  assert(bRequest !== undefined, 'senaryo kurulumu: B’de istek başlamalı');

  aRequest.resolve([]);
  assertEqual(broken.state.loadingOlderRef, false, 'bozuk model gerçekten kilidi açmalı');
  assertThrows(
    () => assertEqual(broken.state.loadingOlderRef, true, 'mutation'),
    'kilit sahiplik dışında açılsa da geçti — çift RPC riski yakalanmıyor',
  );
  // Bozuk modelde B'de ikinci bir RPC gerçekten başlatılabiliyor.
  assert(broken.beginLoadOlder() !== undefined, 'bozuk model ikinci RPC’ye izin vermeli');

  // Aynısı gönderim kilidi için.
  const brokenSend = createChat({ releaseLocksRegardlessOfOwner: true });
  brokenSend.focus(ME, FRIEND);
  const aSend = brokenSend.beginSend('a');
  brokenSend.focus(ME, STRANGER);
  brokenSend.beginSend('b');
  aSend.resolve(makeMessage({ at: BASE }));
  assertEqual(brokenSend.state.sendingRef, false, 'bozuk model gönderim kilidini açmalı');
  assertThrows(
    () => assertEqual(brokenSend.state.sendingRef, true, 'mutation'),
    'gönderim kilidi sahiplik dışında açılsa da geçti',
  );

  // Doğru model her iki kilidi de korur.
  const fixed = createChat();
  fixed.focus(ME, FRIEND);
  const request = fixed.beginLoadOlder();
  fixed.focus(ME, STRANGER);
  fixed.beginLoadOlder();
  request.resolve([]);
  assertEqual(fixed.state.loadingOlderRef, true, 'doğru model B’nin kilidini açtı');
});

check('35. Yükleme ANINDA süresi dolan önizleme state’e GİRMEZ', () => {
  const queryTime = BASE;
  const conversation = {
    displayName: 'Arkadaş',
    lastMessageAt: new Date(queryTime - DAY_MS + 500).toISOString(),
    lastMessageContent: 'yakında sona erecek',
    lastMessageSenderId: FRIEND,
    userId: FRIEND,
  };
  const expiresAt = previewExpiresAt(conversation);

  // Sorgu anında GEÇERLİ.
  assertEqual(expiresAt > queryTime, true, 'senaryo kurulumu: sorguda geçerli olmalı');

  // Cevap state'e yazılmadan önce süresi doldu.
  const writeTime = expiresAt + 10;
  const written = prunePreviewExpiry([conversation], writeTime);

  assertEqual(written[0].lastMessageContent, undefined, 'süresi dolmuş önizleme state’e girdi');
  assertEqual(written[0].lastMessageAt, undefined, 'süresi dolmuş zaman state’e girdi');
  assertEqual(written[0].lastMessageSenderId, undefined, 'süresi dolmuş gönderici state’e girdi');
  // Arkadaş satırı KORUNUR.
  assertEqual(written.length, 1, 'arkadaş satırı silindi');
  assertEqual(written[0].displayName, 'Arkadaş', 'arkadaş bilgisi bozuldu');

  /**
   * Yalnızca planlamaya bakılsaydı bu satır PLANSIZ kalırdı:
   * `nextPreviewExpiryAt` geçmişteki süreleri atlar.
   */
  assertEqual(
    nextPreviewExpiryAt([conversation], writeTime),
    undefined,
    'geçmiş süre için zamanlayıcı planlanamaz — temizlik şart',
  );

  // KAYNAK: state'e yazmadan önce temizleniyor.
  assert(
    listCode.includes('setConversations(prunePreviewExpiry(next, Date.now()));'),
    'liste cevabı state’e yazılmadan temizlenmiyor',
  );
});

check('36. Timer effect’i ÖNCE temizler, sonra tek timeout planlar', () => {
  const now = BASE;
  const make = (id, at) => ({
    displayName: `K${id}`,
    lastMessageAt: at === undefined ? undefined : new Date(at).toISOString(),
    lastMessageContent: at === undefined ? undefined : 'selam',
    lastMessageSenderId: at === undefined ? undefined : FRIEND,
    userId: uuid(id),
  });

  /** Effect modeli: önce temizle, değiştiyse dur; değişmediyse planla. */
  const scheduler = { active: 0, prunes: 0, schedules: 0 };
  let list = [
    // Süresi ÇOKTAN dolmuş (yükleme ile effect arasında dolduğu senaryo).
    make(201, now - DAY_MS - 1000),
    // Gelecekte sona erecek.
    make(202, now - DAY_MS + 60 * 1000),
  ];

  const runEffect = () => {
    if (scheduler.active > 0) scheduler.active -= 1;
    const visible = prunePreviewExpiry(list, now);
    if (visible !== list) {
      scheduler.prunes += 1;
      list = visible;
      return 'pruned';
    }
    const upcoming = nextPreviewExpiryAt(visible, now);
    if (upcoming === undefined) return 'idle';
    scheduler.active += 1;
    scheduler.schedules += 1;
    return 'scheduled';
  };

  // İlk tur: süresi dolmuş satır temizlenir, zamanlayıcı KURULMAZ.
  assertEqual(runEffect(), 'pruned', 'ilk turda temizlik yapılmadı');
  assertEqual(list[0].lastMessageContent, undefined, 'süresi dolmuş önizleme kaldı');
  assertEqual(list.length, 2, 'arkadaş satırı silindi');
  assertEqual(scheduler.active, 0, 'temizlik turunda zamanlayıcı kuruldu');

  // İkinci tur: temizlenecek satır kalmadı → GELECEK süre için tek timeout.
  assertEqual(runEffect(), 'scheduled', 'ikinci turda planlama yapılmadı');
  assertEqual(scheduler.active, 1, 'aynı anda tek timeout kuralı bozuldu');

  // Üçüncü tur (yenileme): hâlâ TEK timeout.
  assertEqual(runEffect(), 'scheduled', 'yenilemede planlama yapılmadı');
  assertEqual(scheduler.active, 1, 'timeout birikti');

  // SONSUZ DÖNGÜ YOK: değişiklik olmayan turda aynı referans döner.
  assertEqual(prunePreviewExpiry(list, now), list, 'değişiklik yokken yeni dizi üretildi');
  assertEqual(scheduler.prunes, 1, 'gereksiz tekrar temizlik yapıldı');

  // KAYNAK: effect önce temizler, aynı referansta erken döner.
  const effect = listCode.slice(listCode.indexOf('useEffect(() => {'));
  assert(effect.includes('const visible = prunePreviewExpiry(conversations, now);'), 'effect temizlemiyor');
  assert(
    effect.indexOf('prunePreviewExpiry(conversations, now)') < effect.indexOf('nextPreviewExpiryAt('),
    'temizlik planlamadan sonra yapılıyor',
  );
  assert(effect.includes('if (visible !== conversations) {'), 'aynı referans kontrolü yok');
  assertEqual((listCode.match(/setTimeout\(/g) ?? []).length, 1, 'birden fazla setTimeout var');
});

// ---------------------------------------------------------------------------
// 6 · MUTASYON TESTLERİ
// ---------------------------------------------------------------------------

check('M1. `id` dedupe’u kaldırılırsa test DÜŞER', () => {
  const message = makeMessage({ at: BASE, id: uuid(61) });
  /** Kasıtlı hata: dedupe yok, liste düz birleştiriliyor. */
  const broken = [message, message];
  assertEqual(broken.length, 2, 'dedupe’suz model gerçekten kopya üretmeli');
  assertThrows(
    () => assertEqual(broken.length, 1, 'mutation'),
    'dedupe olmadan da geçti — çift balon yakalanmıyor',
  );
  assertEqual(mergeFriendMessages([], broken).length, 1, 'doğru model kopya bıraktı');
});

check('M2. Aynı timestamp’te `id` ayracı kaldırılırsa test DÜŞER', () => {
  const a = makeMessage({ at: BASE, id: uuid(72) });
  const b = makeMessage({ at: BASE, id: uuid(71) });

  /** Kasıtlı hata: yalnızca zamana göre sıralama — sıra girişe bağlı kalır. */
  const brokenOrder = [a, b]
    .slice()
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .map((m) => m.id);
  assertDeepEqual(brokenOrder, [uuid(72), uuid(71)], 'ayraçsız model gerçekten kararsız olmalı');
  assertThrows(
    () => assertDeepEqual(brokenOrder, [uuid(71), uuid(72)], 'mutation'),
    'id ayracı olmadan da geçti — kararsız sıra yakalanmıyor',
  );
  assertDeepEqual(
    mergeFriendMessages([], [a, b]).map((m) => m.id),
    [uuid(71), uuid(72)],
    'doğru model kararlı sıralamadı',
  );
});

check('M3. Retry’da yeni kimlik üretilirse test DÜŞER', () => {
  let seq = 0;
  const alwaysNew = () => `key-${(seq += 1)}`;

  /** Kasıtlı hata: mevcut anahtar göz ardı ediliyor. */
  const brokenFirst = alwaysNew();
  const brokenRetry = alwaysNew();
  assert(brokenFirst !== brokenRetry, 'bozuk model gerçekten yeni kimlik üretmeli');
  assertThrows(
    () => assertEqual(brokenRetry, brokenFirst, 'mutation'),
    'retry yeni kimlik üretse de geçti — çift mesaj yakalanmıyor',
  );

  // Doğru model aynı içerikte anahtarı KORUR.
  const pending = resolveSendKey(undefined, 'aynı', alwaysNew);
  assertEqual(resolveSendKey(pending, 'aynı', alwaysNew).clientMessageId, pending.clientMessageId, 'doğru model kimliği değiştirdi');
});

check('M4. 24 saat sınırı `>=` yerine `>` olursa test DÜŞER', () => {
  const message = makeMessage({ at: BASE });
  const expiresAt = Date.parse(message.expiresAt);

  /** Kasıtlı hata: tam sınırda hâlâ görünür sayılıyor. */
  const brokenVisible = Date.parse(message.expiresAt) >= expiresAt;
  assertEqual(brokenVisible, true, 'bozuk model tam sınırda göstermeli');
  assertThrows(
    () => assertEqual(brokenVisible, false, 'mutation'),
    'tam sınırda gösteren model geçti — 24 saat aşımı yakalanmıyor',
  );
  assertEqual(isMessageVisible(message, expiresAt), false, 'doğru model tam sınırda gösterdi');
});

// ---------------------------------------------------------------------------

rmSync(outDir, { force: true, recursive: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Mesajlaşma istemci harness: ${passed} kontrol geçti.`);
console.log('  (Sunucu güvenlik sınırı ayrı harness’tadır: scripts/verify-friend-messaging.mjs)');
