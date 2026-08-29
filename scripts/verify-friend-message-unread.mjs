#!/usr/bin/env node
/**
 * UYGULAMA İÇİ MESAJ FARKINDALIĞI — DOĞRULAMA HARNESS'I
 *
 * Kapsam: `last_read_at` modeli, `has_unread` kuralları, ön plan banner'ı ve
 * okunmamış noktası. Mesajlaşmanın kendi güvenlik sınırı, engelleme/şikâyet ve
 * şifre kurtarma AYRI harness'lardadır ve o dosyalara dokunulmamıştır.
 *
 * Üç katman: (1) `utils/friend-message-alerts.ts` GERÇEKTEN derlenip
 * çalıştırılır, (2) sunucu kuralları ve ekran yaşam döngüsü deterministik bir
 * modelle simüle edilir, (3) migration ve kaynak statik denetlenir.
 *
 * CANLI POSTGRESQL YOKTUR: hiçbir SQL çalıştırılmaz.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const READS_SQL_PATH = 'supabase/migrations/20260904120000_add_friend_message_reads.sql';
const MESSAGES_SQL_PATH = 'supabase/migrations/20260902120000_add_friend_messages.sql';
const SAFETY_SQL_PATH = 'supabase/migrations/20260903120000_add_friend_message_safety.sql';

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

function assertRejects(fn, expectedMessage, message) {
  try {
    fn();
  } catch (error) {
    if (error.message !== expectedMessage) {
      throw new Error(`${message} — beklenen "${expectedMessage}", gelen "${error.message}"`);
    }
    return;
  }
  throw new Error(`${message} — hiç hata atılmadı`);
}

const source = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

const sql = source(READS_SQL_PATH);
const sqlCode = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, ' ');
const stripComments = (text) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const banner = source('components/friends/message-alert-banner.tsx');
const bannerCode = stripComments(banner);
const chat = source('app/messages/[userId].tsx');
const chatCode = stripComments(chat);
const friendsScreen = source('components/friends/friends-screen.tsx');
const service = source('services/messages.ts');
const layout = source('app/_layout.tsx');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

// ---------------------------------------------------------------------------
// Katman 1 — saf yardımcılar GERÇEKTEN derlenir
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'rosea-unread-'));

for (const file of ['utils/friend-messages.ts', 'utils/friend-message-alerts.ts']) {
  try {
    execFileSync(
      'npx',
      [
        'tsc',
        join(ROOT, file),
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
    // Ortam @types hataları yutulur; asıl kontrol çıktının varlığıdır.
  }
}

const compiled = join(outDir, 'friend-message-alerts.js');
if (!existsSync(compiled)) {
  console.error('utils/friend-message-alerts.ts derlenemedi.');
  process.exit(1);
}

/**
 * `friend-message-alerts.ts` yalnızca `isMessageVisible`i içe aktarır ve o da
 * `--noResolve` altında elenmez (değer importu). Derlenmiş dosyada import
 * satırı kalır; testte gerçek uygulamayla aynı davranışı vermek için modül
 * yolunu yerel derlenmiş kopyaya çeviriyoruz.
 */
const patched = join(outDir, 'alerts.mjs');
const compiledSource = readFileSync(compiled, 'utf8').replace(
  /from ['"]@\/utils\/friend-messages['"]/g,
  "from './friend-messages.js'",
);
readFileSync(join(outDir, 'friend-messages.js'), 'utf8');
const { writeFileSync } = await import('node:fs');
writeFileSync(patched, compiledSource, 'utf8');

const alerts = await import(pathToFileURL(patched).href);

const {
  isForegroundAppState,
  ALERT_DEDUPE_LIMIT,
  ALERT_PREVIEW_MAX_LENGTH,
  ALERT_VISIBLE_MS,
  buildAlertPreview,
  getActiveConversation,
  isConversationActive,
  nextAlert,
  rememberAlertId,
  setActiveConversation,
  shouldShowAlert,
  toMessageAlert,
  withoutUnread,
  withUnreadFromMessage,
} = alerts;

const DAY_MS = 24 * 60 * 60 * 1000;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = uuid(1);
const FRIEND = uuid(2);
const OTHER = uuid(3);
const STRANGER = uuid(4);

let seq = 0;
function makeMessage({ at, content = 'selam', from = FRIEND, id, to = ME }) {
  seq += 1;
  return {
    clientMessageId: uuid(900000 + seq),
    content,
    createdAt: new Date(at).toISOString(),
    expiresAt: new Date(at + DAY_MS).toISOString(),
    id: id ?? uuid(500 + seq),
    recipientId: to,
    senderId: from,
  };
}

const NOW = Date.parse('2026-09-04T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Katman 2 — sunucu kurallarının modeli
// ---------------------------------------------------------------------------

function createServer(nowMs = NOW) {
  return {
    now: nowMs,
    friendships: [],
    blocks: [],
    messages: [],
    reads: [],
    seq: 0,
  };
}

const addFriendship = (server, a, b) =>
  server.friendships.push({ receiverId: b, requesterId: a, status: 'accepted' });

const areFriends = (server, a, b) =>
  server.friendships.some(
    (f) =>
      f.status === 'accepted' &&
      ((f.requesterId === a && f.receiverId === b) || (f.requesterId === b && f.receiverId === a)),
  );

const hasBlockBetween = (server, a, b) =>
  server.blocks.some(
    (x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a),
  );

function addMessage(server, from, to, atOffset = 0) {
  server.seq += 1;
  const createdAt = server.now + atOffset;
  const row = {
    createdAt,
    expiresAt: createdAt + DAY_MS,
    id: uuid(700 + server.seq),
    recipientId: to,
    senderId: from,
  };
  server.messages.push(row);
  return row;
}

/** `public.mark_friend_messages_read` referansı. */
function markRead(server, actor, friendId, options = {}) {
  const requireOwnRow = options.requireOwnRow !== false;

  if (!actor) throw new Error('not_authenticated');
  if (!friendId || friendId === actor) throw new Error('invalid_target');
  if (!areFriends(server, actor, friendId)) throw new Error('not_friends');
  if (hasBlockBetween(server, actor, friendId)) throw new Error('relationship_unavailable');

  // Satır YALNIZCA `auth.uid()` adına yazılır.
  const owner = requireOwnRow ? actor : (options.forcedUserId ?? actor);
  const existing = server.reads.find((r) => r.userId === owner && r.friendId === friendId);

  if (existing) {
    // Zaman yalnızca İLERİ gider.
    existing.lastReadAt = Math.max(existing.lastReadAt, server.now);
    existing.updatedAt = server.now;
    return existing.lastReadAt;
  }

  server.reads.push({ friendId, lastReadAt: server.now, updatedAt: server.now, userId: owner });
  return server.now;
}

/** `public.list_friend_unread` referansı. */
function listUnread(server, actor, options = {}) {
  /** Mutasyon: kendi gönderdiği mesajlar da okunmamış sayılır. */
  const countOwnMessages = options.countOwnMessages === true;
  /** Mutasyon: `last_read_at` karşılaştırması yok. */
  const ignoreLastRead = options.ignoreLastRead === true;
  /** Mutasyon: süresi dolmuş mesajlar da sayılır. */
  const ignoreExpiry = options.ignoreExpiry === true;

  const ids = new Set();
  for (const m of server.messages) {
    const isIncoming = m.recipientId === actor && m.senderId !== actor;
    if (!countOwnMessages && !isIncoming) continue;
    if (countOwnMessages && m.recipientId !== actor && m.senderId !== actor) continue;

    const friendId = m.senderId === actor ? m.recipientId : m.senderId;
    if (!ignoreExpiry && m.expiresAt <= server.now) continue;
    if (!areFriends(server, actor, friendId)) continue;
    if (hasBlockBetween(server, actor, friendId)) continue;

    const read = server.reads.find((r) => r.userId === actor && r.friendId === friendId);
    if (!ignoreLastRead && read && m.createdAt <= read.lastReadAt) continue;

    ids.add(friendId);
  }
  return [...ids].sort();
}

/** Doğrudan tablo okuması — RLS politikasının referansı. */
const selectReadsDirect = (server, actor) => server.reads.filter((r) => r.userId === actor);

// ---------------------------------------------------------------------------
// 1 · Sunucu kuralları
// ---------------------------------------------------------------------------

check('1. Gelen yeni mesaj `has_unread = true`', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  addMessage(server, FRIEND, ME);

  assertDeepEqual(listUnread(server, ME), [FRIEND], 'gelen mesaj okunmamış üretmedi');
});

check('2. Kullanıcının KENDİ gönderdiği mesaj okunmamış üretmez', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  addMessage(server, ME, FRIEND);

  assertDeepEqual(listUnread(server, ME), [], 'kendi mesajı okunmamış üretti');
  // Karşı taraf için ise okunmamıştır.
  assertDeepEqual(listUnread(server, FRIEND), [ME], 'alıcıda okunmamış oluşmadı');
});

check('3. `last_read_at` SONRASI eski mesaj okunmamış değil', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  addMessage(server, FRIEND, ME, -60 * 1000);

  markRead(server, ME, FRIEND);
  assertDeepEqual(listUnread(server, ME), [], 'okunduktan sonra hâlâ okunmamış');
});

check('4. Okuma anından YENİ mesaj okunmamış olur', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  addMessage(server, FRIEND, ME, -60 * 1000);
  markRead(server, ME, FRIEND);
  assertDeepEqual(listUnread(server, ME), [], 'kurulum: okunmuş olmalı');

  // Okumadan SONRA gelen mesaj.
  server.now += 10 * 1000;
  addMessage(server, FRIEND, ME);
  assertDeepEqual(listUnread(server, ME), [FRIEND], 'yeni mesaj okunmamış üretmedi');
});

check('5. Süresi DOLMUŞ mesaj okunmamış değil', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  const message = addMessage(server, FRIEND, ME);
  assertDeepEqual(listUnread(server, ME), [FRIEND], 'kurulum: okunmamış olmalı');

  server.now = message.expiresAt;
  assertDeepEqual(listUnread(server, ME), [], 'süresi dolmuş mesaj okunmamış saydı');

  // KAYNAK: sorgu süre koşulunu taşıyor.
  assert(
    sqlCode.includes("m.expires_at > timezone('utc', now())"),
    'okunmamış sorgusunda süre filtresi yok',
  );
});

check('6. ENGELLİ veya arkadaş OLMAYAN kullanıcı okunmamış üretmez', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  addMessage(server, FRIEND, ME);
  // Arkadaş olmayan yabancıdan gelen (teorik) mesaj.
  addMessage(server, STRANGER, ME);
  assertDeepEqual(listUnread(server, ME), [FRIEND], 'arkadaş olmayan okunmamış üretti');

  // Engel sonrası düşer.
  server.blocks.push({ blockedId: FRIEND, blockerId: ME });
  assertDeepEqual(listUnread(server, ME), [], 'engelli kullanıcı okunmamış üretti');

  // Okundu işaretleme de engelli/arkadaş olmayan çiftte reddedilir.
  assertRejects(
    () => markRead(server, ME, FRIEND),
    'relationship_unavailable',
    'engelli çiftte okundu yazıldı',
  );
  assertRejects(
    () => markRead(server, ME, STRANGER),
    'not_friends',
    'arkadaş olmayan çiftte okundu yazıldı',
  );

  assert(sqlCode.includes('public.are_friends(me.actor, m.sender_id)'), 'arkadaşlık koşulu yok');
  assert(
    sqlCode.includes('not public.has_block_between(me.actor, m.sender_id)'),
    'engel koşulu yok',
  );
});

check('7. Konuşma açılınca read state GÜNCELLENİYOR', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  addMessage(server, FRIEND, ME, -60 * 1000);

  const applied = markRead(server, ME, FRIEND);
  assertEqual(applied, server.now, 'okuma anı sunucu zamanı değil');
  assertEqual(server.reads.length, 1, 'okuma satırı oluşmadı');
  assertDeepEqual(listUnread(server, ME), [], 'okundu sonrası nokta kalktı sayılmadı');

  // KAYNAK: sohbet ekranı yükleme sonrası ve canlı mesajda okundu çağırıyor.
  assert(chatCode.includes('void markRead();'), 'sohbet ekranı okundu çağırmıyor');
  assert(
    chatCode.includes('markFriendMessagesRead(counterpartId)'),
    'okundu servis çağrısı yok',
  );
});

check('8. Tekrar çağrı IDEMPOTENT; satır sayısı mesajla BÜYÜMEZ', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  addFriendship(server, ME, OTHER);

  for (let index = 0; index < 50; index += 1) addMessage(server, FRIEND, ME, index);
  for (let index = 0; index < 50; index += 1) addMessage(server, OTHER, ME, index);
  assertEqual(server.messages.length, 100, 'kurulum: 100 mesaj olmalı');

  for (let index = 0; index < 25; index += 1) {
    markRead(server, ME, FRIEND);
    markRead(server, ME, OTHER);
  }

  // 100 mesaja karşılık YALNIZCA iki okuma satırı.
  assertEqual(server.reads.length, 2, 'okuma satırı mesaj sayısıyla büyüdü');
  assertDeepEqual(
    server.reads.map((r) => r.friendId).sort(),
    [FRIEND, OTHER].sort(),
    'okuma satırları beklenmedik',
  );

  // KAYNAK: birleşik birincil anahtar ve upsert.
  assert(
    sqlCode.includes('constraint friend_message_reads_pkey primary key (user_id, friend_id)'),
    'birleşik PK yok',
  );
  assert(
    sqlCode.includes('on conflict on constraint friend_message_reads_pkey do update'),
    'upsert yok',
  );
});

check('9. Okuma zamanı GERİ ALINMAZ', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);

  markRead(server, ME, FRIEND);
  const later = server.now;

  // Geç tamamlanan eski bir çağrı zamanı geriye çekemez.
  server.now = later - 60 * 1000;
  const applied = markRead(server, ME, FRIEND);
  assertEqual(applied, later, 'okuma anı geriye alındı');

  assert(
    sqlCode.includes('greatest(public.friend_message_reads.last_read_at, excluded.last_read_at)'),
    'zaman ileri-only değil',
  );
});

// ---------------------------------------------------------------------------
// 2 · Banner yaşam döngüsü
// ---------------------------------------------------------------------------

/** Global banner dinleyicisinin modeli. */
function createBanner(options = {}) {
  /** Mutasyon: aktif sohbet kontrolü yok. */
  const ignoreActiveConversation = options.ignoreActiveConversation === true;
  /** Mutasyon: dedupe yok. */
  const skipDedupe = options.skipDedupe === true;

  const state = {
    alert: undefined,
    channelClosed: false,
    isForeground: true,
    navigations: [],
    seenIds: new Set(),
    shown: [],
    timerActive: false,
    viewer: ME,
  };

  return {
    get state() {
      return state;
    },
    setForeground(value) {
      state.isForeground = value;
      if (!value) {
        state.alert = undefined;
        state.timerActive = false;
      }
    },
    deliver(message, owner = state.viewer) {
      if (state.channelClosed) return 'dropped-closed';
      // Hesap değiştiyse eski callback YENİ state'e yazamaz.
      if (owner !== state.viewer) return 'dropped-account';

      const decision = shouldShowAlert({
        activeConversation: ignoreActiveConversation ? undefined : getActiveConversation(),
        isForeground: state.isForeground,
        message,
        nowMs: NOW,
        seenIds: skipDedupe ? new Set() : state.seenIds,
        viewerId: state.viewer,
      });
      if (!decision) return 'suppressed';

      if (!skipDedupe) state.seenIds = rememberAlertId(state.seenIds, message.id);
      state.alert = nextAlert(state.alert, toMessageAlert(message, 'Arkadaş'));
      state.shown.push(message.id);
      // TEK zamanlayıcı: her yeni banner'da baştan kurulur.
      state.timerActive = true;
      return 'shown';
    },
    tap() {
      if (!state.alert) return undefined;
      const target = state.alert.senderId;
      state.alert = undefined;
      state.timerActive = false;
      state.navigations.push(`/messages/${target}`);
      return target;
    },
    expireTimer() {
      state.alert = undefined;
      state.timerActive = false;
    },
    switchAccount(next) {
      state.viewer = next;
      state.alert = undefined;
      state.seenIds = new Set();
      state.timerActive = false;
    },
    unmount() {
      state.channelClosed = true;
      state.alert = undefined;
      state.timerActive = false;
    },
  };
}

check('10. Başka konuşmadan gelen mesaj TEK banner gösterir', () => {
  setActiveConversation(undefined);
  const app = createBanner();

  assertEqual(app.deliver(makeMessage({ at: NOW })), 'shown', 'banner gösterilmedi');
  assertEqual(app.state.shown.length, 1, 'birden fazla banner gösterildi');
  assert(app.state.alert !== undefined, 'banner state’i boş');
  assertEqual(app.state.timerActive, true, 'görünürlük zamanlayıcısı kurulmadı');
});

check('11. AYNI realtime olayı iki kez gelirse DEDUPE edilir', () => {
  setActiveConversation(undefined);
  const app = createBanner();
  const message = makeMessage({ at: NOW, id: uuid(601) });

  assertEqual(app.deliver(message), 'shown', 'ilk teslim gösterilmedi');
  assertEqual(app.deliver(message), 'suppressed', 'aynı mesaj ikinci kez gösterildi');
  assertDeepEqual(app.state.shown, [uuid(601)], 'dedupe çalışmadı');

  // Dedupe kümesi sınırsız BÜYÜMEZ.
  let seen = new Set();
  for (let index = 0; index < ALERT_DEDUPE_LIMIT + 20; index += 1) {
    seen = rememberAlertId(seen, `id-${index}`);
  }
  assertEqual(seen.size, ALERT_DEDUPE_LIMIT, 'dedupe kümesi sınırlanmadı');
  assert(seen.has(`id-${ALERT_DEDUPE_LIMIT + 19}`), 'en yeni kimlik düştü');
  assert(!seen.has('id-0'), 'en eski kimlik korundu');
});

check('12. AÇIK sohbetin mesajı banner GÖSTERMEZ, okunmuş sayılır', () => {
  setActiveConversation(FRIEND);
  const app = createBanner();

  assertEqual(app.deliver(makeMessage({ at: NOW, from: FRIEND })), 'suppressed', 'banner gösterildi');
  assertEqual(app.state.shown.length, 0, 'açık sohbette banner çıktı');
  assertEqual(isConversationActive(FRIEND), true, 'aktif sohbet kaydı yanlış');

  // Başka bir arkadaştan gelen mesaj YİNE banner gösterir.
  assertEqual(app.deliver(makeMessage({ at: NOW, from: OTHER })), 'shown', 'diğer sohbet bastırıldı');

  // Nokta da açılmaz: mesaj görünür sayılır.
  const unread = withUnreadFromMessage(
    new Set(),
    makeMessage({ at: NOW, from: FRIEND }),
    ME,
    FRIEND,
  );
  assertEqual(unread.has(FRIEND), false, 'açık sohbette nokta açıldı');

  setActiveConversation(undefined);
  assertEqual(getActiveConversation(), undefined, 'aktif sohbet temizlenmedi');
});

check('13. Hızlı çoklu mesajda SON MESAJ politikası deterministik', () => {
  setActiveConversation(undefined);
  const app = createBanner();

  const first = makeMessage({ at: NOW, content: 'birinci', id: uuid(611) });
  const second = makeMessage({ at: NOW + 1, content: 'ikinci', id: uuid(612) });
  const third = makeMessage({ at: NOW + 2, content: 'üçüncü', id: uuid(613) });

  app.deliver(first);
  app.deliver(second);
  app.deliver(third);

  // Kuyruk birikmez: her zaman EN SON mesaj görünür.
  assertEqual(app.state.alert.id, uuid(613), 'son mesaj politikası uygulanmadı');
  assertEqual(app.state.alert.preview, 'üçüncü', 'banner içeriği yanlış');
  assertEqual(app.state.timerActive, true, 'zamanlayıcı yeniden kurulmadı');

  // Zamanlayıcı bitince banner ASILI KALMAZ.
  app.expireTimer();
  assertEqual(app.state.alert, undefined, 'banner asılı kaldı');
  assertEqual(app.state.timerActive, false, 'zamanlayıcı temizlenmedi');

  // Saf yardımcı da aynı kararı verir.
  const kept = nextAlert(toMessageAlert(first), toMessageAlert(second));
  assertEqual(kept.id, second.id, 'nextAlert son mesajı seçmedi');
});

check('14. Banner’a dokunma DOĞRU konuşmayı açar', () => {
  setActiveConversation(undefined);
  const app = createBanner();
  app.deliver(makeMessage({ at: NOW, from: OTHER }));

  const target = app.tap();
  assertEqual(target, OTHER, 'yanlış konuşma açıldı');
  assertDeepEqual(app.state.navigations, [`/messages/${OTHER}`], 'yönlendirme yapılmadı');
  assertEqual(app.state.alert, undefined, 'dokunuştan sonra banner kapanmadı');

  // KAYNAK: doğru rota ve kapanış.
  assert(
    bannerCode.includes("pathname: '/messages/[userId]', params: { userId: senderId }"),
    'banner doğru rotayı açmıyor',
  );
  assert(bannerCode.includes('dismiss();'), 'dokunuşta banner kapatılmıyor');
});

check('15. Ön planda DEĞİLKEN banner gösterilmez', () => {
  setActiveConversation(undefined);
  const app = createBanner();
  app.setForeground(false);

  assertEqual(app.deliver(makeMessage({ at: NOW })), 'suppressed', 'arka planda banner gösterildi');
  assertEqual(app.state.shown.length, 0, 'arka planda banner çıktı');

  // Öne dönünce yeniden çalışır.
  app.setForeground(true);
  assertEqual(app.deliver(makeMessage({ at: NOW })), 'shown', 'öne dönüşte banner çıkmadı');

  // Süresi dolmuş mesaj hiçbir zaman banner üretmez.
  const expired = makeMessage({ at: NOW - DAY_MS - 1000 });
  assertEqual(app.deliver(expired), 'suppressed', 'süresi dolmuş mesaj banner üretti');
});

check('16. Timer/unmount/sign-out CLEANUP', () => {
  setActiveConversation(undefined);
  const app = createBanner();
  app.deliver(makeMessage({ at: NOW }));
  assertEqual(app.state.timerActive, true, 'kurulum: zamanlayıcı olmalı');

  app.unmount();
  assertEqual(app.state.alert, undefined, 'unmount banner’ı bırakmadı');
  assertEqual(app.state.timerActive, false, 'unmount zamanlayıcıyı bırakmadı');
  assertEqual(app.deliver(makeMessage({ at: NOW })), 'dropped-closed', 'kapalı kanal iletti');

  // KAYNAK: kanal ve zamanlayıcı cleanup'ta kesin temizleniyor.
  assert(bannerCode.includes('subscription?.unsubscribe();'), 'kanal kapatılmıyor');
  assert(bannerCode.includes('clearHideTimer();'), 'zamanlayıcı temizlenmiyor');
  assertEqual(
    (bannerCode.match(/setTimeout\(/g) ?? []).length,
    1,
    'banner’da birden fazla setTimeout var',
  );
  assert(bannerCode.includes('appState.remove();'), 'AppState dinleyicisi kaldırılmıyor');
});

check('17. A hesabının GEÇ eventi B hesabına geçmez', () => {
  setActiveConversation(undefined);
  const app = createBanner();
  const ownerA = app.state.viewer;

  app.switchAccount(STRANGER);
  assertEqual(
    app.deliver(makeMessage({ at: NOW }), ownerA),
    'dropped-account',
    'eski hesabın eventi yeni hesaba yazdı',
  );
  assertEqual(app.state.shown.length, 0, 'hesap değişiminde banner çıktı');
  assertEqual(app.state.seenIds.size, 0, 'dedupe geçmişi hesap değişiminde kalmış');

  // KAYNAK: sahiplik kontrolü ve hesap sıfırlaması.
  assert(bannerCode.includes('viewerRef.current !== viewerId'), 'sahiplik kontrolü yok');
  assert(bannerCode.includes('seenIdsRef.current = new Set();'), 'hesapta dedupe sıfırlanmıyor');
});

// ---------------------------------------------------------------------------
// 3 · Okunmamış noktası ve okuma yarışları
// ---------------------------------------------------------------------------

check('18. Nokta iyimser kalkar, gelen mesajla anında açılır', () => {
  // Sohbet açılınca nokta hemen kalkar.
  const afterOpen = withoutUnread(new Set([FRIEND, OTHER]), FRIEND);
  assertEqual(afterOpen.has(FRIEND), false, 'nokta iyimser kalkmadı');
  assertEqual(afterOpen.has(OTHER), true, 'diğer arkadaşın noktası silindi');

  // Liste açıkken gelen mesaj noktayı anında açar.
  const afterMessage = withUnreadFromMessage(new Set(), makeMessage({ at: NOW, from: OTHER }), ME, undefined);
  assertEqual(afterMessage.has(OTHER), true, 'gelen mesaj noktayı açmadı');

  // Kendi gönderdiği mesaj nokta üretmez.
  const own = withUnreadFromMessage(new Set(), makeMessage({ at: NOW, from: ME, to: OTHER }), ME, undefined);
  assertEqual(own.size, 0, 'kendi mesajı nokta üretti');

  // KAYNAK: arkadaş listesi noktayı bu yardımcılarla yönetiyor.
  assert(friendsScreen.includes('withoutUnread(current, friend.id)'), 'iyimser temizleme yok');
  assert(friendsScreen.includes('withUnreadFromMessage('), 'realtime nokta güncellemesi yok');
  assert(friendsScreen.includes('unreadIds.has(friend.id) && <View style={styles.unreadDot} />'), 'nokta render edilmiyor');
  // SAYI gösterilmiyor.
  assert(!/unreadCount|badgeCount/i.test(friendsScreen), 'okunmamış sayısı gösteriliyor');

  // Servis katmanı okunmamış yüzeyini RPC üzerinden sunuyor; UI tabloya
  // dokunmuyor.
  assert(service.includes("supabase.rpc('list_friend_unread')"), 'okunmamış RPC’si servis dışında');
  assert(
    service.includes("supabase.rpc('mark_friend_messages_read', { friend_id: friendId })"),
    'okundu RPC’si servis dışında',
  );
  assert(service.includes('hasUnread: row.has_unread === true'), 'has_unread güvenli okunmuyor');
});

check('19. ESKİ konuşmanın geç read cevabı yeni konuşmaya yazmaz', () => {
  /** Sohbet ekranının sahiplik modeli. */
  const state = { conversation: `${ME}:${FRIEND}`, applied: [] };
  const beginMarkRead = (friendId) => {
    const owner = state.conversation;
    return {
      resolve() {
        if (owner !== state.conversation) return 'stale';
        state.applied.push(friendId);
        return 'applied';
      },
    };
  };

  const request = beginMarkRead(FRIEND);
  // Kullanıcı başka bir sohbete geçti.
  state.conversation = `${ME}:${OTHER}`;
  assertEqual(request.resolve(), 'stale', 'eski konuşmanın cevabı uygulandı');
  assertDeepEqual(state.applied, [], 'yeni konuşmanın read state’i kirlendi');

  // KAYNAK: okundu çağrısı sahiplik anahtarını yakalıyor.
  const markBody = chatCode.slice(chatCode.indexOf('const markRead = useCallback('));
  assert(markBody.includes('const owner = conversationRef.current;'), 'sahiplik yakalanmıyor');
  assert(markBody.includes('owner !== conversationRef.current'), 'sahiplik karşılaştırılmıyor');
});

check('20. RPC YALNIZCA `auth.uid()` adına yazar; doğrudan erişim kapalı', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  markRead(server, ME, FRIEND);

  // Kullanıcı yalnızca KENDİ satırını görür.
  assertDeepEqual(selectReadsDirect(server, ME).map((r) => r.friendId), [FRIEND], 'kendi satırı yok');
  assertDeepEqual(selectReadsDirect(server, FRIEND), [], 'başkasının satırı görünüyor');

  // Kendine okundu yazılamaz.
  assertRejects(() => markRead(server, ME, ME), 'invalid_target', 'kendine okundu yazıldı');

  // KAYNAK: RPC `user_id` parametresi ALMAZ ve `auth.uid()` kullanır.
  const rpc = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.mark_friend_messages_read'),
    sqlCode.indexOf('revoke all on function public.mark_friend_messages_read'),
  );
  assert(rpc.includes('actor uuid := (select auth.uid());'), 'auth.uid() kullanılmıyor');
  assert(rpc.includes("raise exception 'not_authenticated'"), 'oturum reddi yok');
  assert(!/user_id\s+uuid[,)]/.test(rpc), 'RPC user_id parametresi alıyor');
  assert(
    rpc.includes('values (actor, mark_friend_messages_read.friend_id'),
    'satır auth.uid() adına yazılmıyor',
  );
  assert(rpc.includes("set search_path = ''"), 'boş search_path yok');

  // Tablo: RLS açık, istemciye YAZMA yetkisi yok.
  assert(
    sqlCode.includes('alter table public.friend_message_reads enable row level security;'),
    'RLS açık değil',
  );
  assert(
    sqlCode.includes('grant select on table public.friend_message_reads to authenticated;'),
    'SELECT yetkisi yok',
  );
  assert(
    !/grant[^;]*\b(insert|update|delete)\b[^;]*on table public\.friend_message_reads/i.test(sqlCode),
    'istemciye doğrudan yazma yetkisi verilmiş',
  );
  assert(
    sqlCode.includes('using (user_id = (select auth.uid()))'),
    'RLS politikası kendi satırına sınırlı değil',
  );
  assert(
    sqlCode.includes('revoke all on table public.friend_message_reads from anon;'),
    'anon revoke yok',
  );
});

// ---------------------------------------------------------------------------
// 4 · Kapsam ve mevcut davranışların korunması
// ---------------------------------------------------------------------------

check('21. Block/unfriend ve 24 saat temizliği KORUNUYOR', () => {
  // Engelleme okuma satırlarını da temizler.
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  markRead(server, ME, FRIEND);
  assertEqual(server.reads.length, 1, 'kurulum: okuma satırı olmalı');

  const blockBody = sqlCode.slice(sqlCode.indexOf('create or replace function public.block_user'));
  assert(
    blockBody.includes('delete from public.friend_message_reads as r'),
    'engelleme okuma satırlarını temizlemiyor',
  );
  // Mevcut engelleme davranışları BİREBİR duruyor.
  for (const marker of [
    'delete from public.friendships as f',
    'delete from public.friend_messages as m',
    'public.lock_user_pair(actor, target_user_id)',
    'on conflict (blocker_id, blocked_id) do nothing',
  ]) {
    assert(blockBody.includes(marker), `engelleme davranışı kaybolmuş: ${marker}`);
  }

  // 24 saatlik expiry ve cron'a DOKUNULMADI.
  const messagesSql = source(MESSAGES_SQL_PATH);
  assert(
    messagesSql.includes("check (expires_at = created_at + interval '24 hours')"),
    '24 saatlik ömür kısıtı değişmiş',
  );
  assert(messagesSql.includes('cleanup-expired-friend-messages'), 'mesaj cron’u değişmiş');
  assert(!sqlCode.includes('cleanup-expired-friend-messages'), 'mesaj cron’una dokunulmuş');
  assert(!/cron\.(schedule|unschedule)/.test(sqlCode), 'bu migration cron kuruyor');

  // Güvenlik migration'ı da değişmedi.
  const safetySql = source(SAFETY_SQL_PATH);
  assert(safetySql.includes('create table if not exists public.user_blocks'), 'güvenlik migration’ı bozulmuş');
});

check('22. Migration IDEMPOTENT; kapsam dışına çıkmıyor', () => {
  assert(
    sqlCode.includes('create table if not exists public.friend_message_reads'),
    'tablo idempotent değil',
  );
  for (const statement of sqlCode.match(/create (?:unique )?index[^;]*/g) ?? []) {
    assert(statement.includes('if not exists'), `indeks idempotent değil: ${statement.slice(0, 50)}`);
  }
  assert(
    sqlCode.includes('drop policy if exists "friend_message_reads_select_own"'),
    'politika idempotent değil',
  );
  assert(
    sqlCode.includes('drop function if exists public.list_friend_conversations();'),
    'dönüş tipi değişen fonksiyon düşürülmüyor',
  );
  assertEqual((sqlCode.match(/create function/g) ?? []).length, 0, 'replace edilmeyen fonksiyon var');
  assert(sqlCode.trimStart().startsWith('begin;'), 'tek transaction değil');
  assert(sqlCode.trimEnd().endsWith('commit;'), 'commit ile bitmiyor');

  // Kapsam dışı tablo veya push altyapısı YOK.
  for (const token of ['expo_push', 'push_token', 'device_token', 'notification']) {
    assert(!new RegExp(token, 'i').test(sqlCode), `kapsam dışı push altyapısı: ${token}`);
  }
  assert(!/unread_count|count\(\*\)/.test(sqlCode), 'okunmamış SAYISI hesaplanıyor');
});

check('23. UI Supabase’e dokunmuyor; push/OS bildirimi eklenmedi', () => {
  for (const [label, code] of [['banner', bannerCode], ['arkadaşlar', stripComments(friendsScreen)]]) {
    assert(!/@\/lib\/supabase|supabase\./.test(code), `${label}: doğrudan Supabase kullanıyor`);
  }
  // Uzaktan push, OS bildirimi ve token altyapısı YOK.
  const combined = bannerCode + stripComments(friendsScreen) + chatCode + stripComments(source('utils/friend-message-alerts.ts'));
  for (const token of ['expo-notifications', 'getExpoPushToken', 'scheduleNotificationAsync', 'setNotificationHandler', 'registerForPushNotifications']) {
    assert(!combined.includes(token), `kapsam dışı push API’si: ${token}`);
  }
  // Önizleme kalıcı depoya yazılmıyor ve loglanmıyor.
  assert(!/AsyncStorage|SecureStore|localStorage/.test(bannerCode), 'banner kalıcı depo kullanıyor');
  assert(!/console\.(log|warn|info|debug)/.test(bannerCode), 'banner log bırakıyor');

  // Banner rank/Rosea katmanlarından ÖNCE çizilir (z-index çatışması yok).
  const alertsIndex = layout.indexOf('<FriendMessageAlerts />');
  const rankIndex = layout.indexOf('<RankUpCelebrationLayer />');
  const mascotIndex = layout.indexOf('<FloatingMascot />');
  assert(alertsIndex > 0 && rankIndex > 0 && mascotIndex > 0, 'katmanlar bulunamadı');
  assert(alertsIndex < rankIndex && alertsIndex < mascotIndex, 'banner kutlamaların üstünde çiziliyor');
  // Yalnızca gerçek oturumda ve kurtarma dışında mount ediliyor.
  assert(
    layout.includes('{Boolean(session) && !isPasswordRecovery && <FriendMessageAlerts />}'),
    'banner oturum guard’ı olmadan mount ediliyor',
  );
});

check('24. Çeviriler TR/EN eksiksiz; ham hata metni yok', () => {
  for (const key of ['alertPreview', 'alertFallback', 'alertOpenA11y', 'unreadDotA11y']) {
    assert(localeTr.includes(`${key}:`), `TR anahtarı eksik: ${key}`);
    assert(localeEn.includes(`${key}:`), `EN anahtarı eksik: ${key}`);
  }
  assert(localeTr.includes("alertPreview: '{name}: {preview}'"), 'TR banner biçimi yanlış');
  assert(localeEn.includes("alertPreview: '{name}: {preview}'"), 'EN banner biçimi yanlış');
  // Banner metinleri çeviriden geliyor.
  assert(bannerCode.includes("t('messages.alertPreview'"), 'banner metni çeviriden gelmiyor');
  assert(bannerCode.includes("t('messages.alertFallback')"), 'fallback metni yok');
  assert(friendsScreen.includes("t('messages.unreadDotA11y')"), 'nokta a11y metni yok');
  // Sabit kullanıcı metni bırakılmadı.
  assert(!/<Text[^>]*>\s*[A-ZĞÜŞİÖÇ][a-zğüşıöç]/.test(banner), 'banner’da sabit metin var');
});

check('25. Önizleme tek satır ve kısaltılıyor', () => {
  assertEqual(buildAlertPreview('  selam   dünya  '), 'selam dünya', 'boşluklar sadeleşmedi');
  assertEqual(buildAlertPreview('bir\niki\tüç'), 'bir iki üç', 'satır sonu tek satıra inmedi');

  const long = 'a'.repeat(ALERT_PREVIEW_MAX_LENGTH + 40);
  const preview = buildAlertPreview(long);
  assertEqual(preview.length, ALERT_PREVIEW_MAX_LENGTH, 'uzun mesaj kısaltılmadı');
  assert(preview.endsWith('…'), 'kısaltma işareti yok');

  assertEqual(ALERT_VISIBLE_MS, 4000, 'görünürlük süresi ~4 saniye değil');
  // Tek satır render ediliyor.
  assert(bannerCode.includes('numberOfLines={1}'), 'banner tek satır değil');
});

// ---------------------------------------------------------------------------
// 4b · PL/pgSQL parametre ↔ sütun BELİRSİZLİĞİ (42702)
// ---------------------------------------------------------------------------

/**
 * Bir fonksiyonun parametre ve `returns table` çıktı adlarını çıkarır.
 *
 * Bunlar PL/pgSQL ve SQL gövdelerinde DEĞİŞKEN olarak görünür; aynı adlı bir
 * sütuna niteliksiz atıfta bulunulursa PostgreSQL çalışma anında
 * `42702 ambiguous column reference` üretir.
 */
function readFunctionVariables(body) {
  const names = new Set();

  const signature = body.slice(body.indexOf('('), body.indexOf(')') + 1);
  for (const match of signature.matchAll(/(\w+)\s+(uuid|text|timestamptz|boolean|integer)/g)) {
    names.add(match[1]);
  }

  const returnsTable = /returns table \(([\s\S]*?)\)/.exec(body);
  if (returnsTable) {
    for (const match of returnsTable[1].matchAll(/(\w+)\s+(uuid|text|timestamptz|boolean|integer)/g)) {
      names.add(match[1]);
    }
  }

  const declareBlock = /declare([\s\S]*?)begin/.exec(body);
  if (declareBlock) {
    for (const match of declareBlock[1].matchAll(/^\s*(\w+)\s+\w/gm)) names.add(match[1]);
  }

  return names;
}

/** Dosyadaki her fonksiyonun gövdesini ve değişken adlarını çıkarır. */
function readFunctions(text) {
  const starts = [...text.matchAll(/create or replace function (public\.\w+)/g)];
  return starts.map((match, index) => {
    const start = match.index;
    const end = index + 1 < starts.length ? starts[index + 1].index : text.length;
    const body = text.slice(start, end);
    return { body, name: match[1], variables: readFunctionVariables(body) };
  });
}

check('26. Okuma tablosunun birincil anahtarı AÇIKÇA adlandırılmış', () => {
  assert(
    sqlCode.includes('constraint friend_message_reads_pkey primary key (user_id, friend_id)'),
    'birincil anahtar adlandırılmamış',
  );
  // Adsız `primary key (...)` biçimi KULLANILMAZ.
  assert(
    !/^\s*primary key \(user_id, friend_id\)/m.test(sqlCode),
    'adsız birincil anahtar hâlâ duruyor',
  );
});

check('27. Upsert sütun listesi değil CONSTRAINT ADI kullanıyor', () => {
  const rpc = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.mark_friend_messages_read'),
    sqlCode.indexOf('revoke all on function public.mark_friend_messages_read'),
  );

  assert(
    rpc.includes('on conflict on constraint friend_message_reads_pkey do update'),
    'upsert constraint adıyla yapılmıyor',
  );
  /**
   * ESKİ BİÇİM REDDEDİLİR: `on conflict (user_id, friend_id)` içindeki
   * `friend_id` ifade olarak çözümlenir ve fonksiyonun `friend_id`
   * parametresiyle çakışıp 42702 üretebilir.
   */
  assert(
    !/on conflict \(user_id, friend_id\)/.test(rpc),
    'sütun listeli eski upsert biçimi hâlâ duruyor',
  );
  assert(!/on conflict \([^)]*friend_id/.test(rpc), 'on conflict listesinde friend_id geçiyor');

  // Davranışlar AYNEN korunuyor.
  assert(
    rpc.includes('greatest(public.friend_message_reads.last_read_at, excluded.last_read_at)'),
    'zaman ileri-only davranışı kaybolmuş',
  );
  assert(rpc.includes("now_utc timestamptz := timezone('utc', now());"), 'sunucu zamanı kaybolmuş');
  assert(rpc.includes('updated_at = excluded.updated_at'), 'updated_at güncellemesi kaybolmuş');
  assert(rpc.includes('returning last_read_at into applied;'), 'dönüş değeri kaybolmuş');
});

check('28. Hiçbir `on conflict` listesi parametre/çıktı adıyla ÇAKIŞMIYOR', () => {
  const functions = readFunctions(sqlCode);
  assert(functions.length >= 4, 'fonksiyonlar okunamadı');

  for (const fn of functions) {
    for (const clause of fn.body.match(/on conflict \(([^)]*)\)/g) ?? []) {
      const columns = clause
        .replace(/on conflict \(|\)/g, '')
        .split(',')
        .map((column) => column.trim());
      for (const column of columns) {
        assert(
          !fn.variables.has(column),
          `${fn.name}: on conflict listesi '${column}' parametre/çıktı adıyla çakışıyor (42702 riski)`,
        );
      }
    }
  }

  // `mark_friend_messages_read` özelinde: parametre adı gerçekten sütunla aynı,
  // bu yüzden liste biçimi kullanılamaz.
  const markFn = functions.find((fn) => fn.name === 'public.mark_friend_messages_read');
  assert(markFn !== undefined, 'okundu fonksiyonu bulunamadı');
  assert(markFn.variables.has('friend_id'), 'parametre adı beklenen gibi değil');
  assert(
    !/on conflict \(/.test(markFn.body),
    'çakışan parametreye rağmen sütun listeli upsert kullanılıyor',
  );
});

/**
 * Bu migration'da tanımlanan ve atıf yapılan SÜTUN adları.
 *
 * Belirsizlik YALNIZCA bir değişken adı gerçek bir sütun adıyla çakıştığında
 * oluşur; `actor` gibi sütun karşılığı olmayan değişkenler risksizdir.
 */
function readColumnNames(text) {
  const columns = new Set();

  // Bu migration'ın kendi tablo tanımları.
  for (const table of text.match(/create table if not exists[\s\S]*?\n\);/g) ?? []) {
    for (const match of table.matchAll(/^\s{2}(\w+)\s+(uuid|text|timestamptz|boolean|integer)/gm)) {
      columns.add(match[1]);
    }
  }

  /**
   * Bu migration'ın DOKUNDUĞU mevcut tabloların sütunları.
   *
   * CTE takma adları (`me.actor` gibi) BİLİNÇLİ olarak dışarıda bırakılır:
   * onlar gerçek tablo sütunu değildir ve belirsizlik üretmezler.
   */
  for (const column of [
    'sender_id',
    'recipient_id',
    'created_at',
    'expires_at',
    'blocker_id',
    'blocked_id',
    'requester_id',
    'receiver_id',
    'status',
  ]) {
    columns.add(column);
  }

  return columns;
}

check('29. Sütun adıyla çakışan değişkenler gövdede NİTELİKLİ kullanılıyor', () => {
  const functions = readFunctions(sqlCode);
  const columns = readColumnNames(sqlCode);
  assert(columns.has('friend_id'), 'sütun adları okunamadı');

  let inspected = 0;

  for (const fn of functions) {
    const bodyStart = fn.body.indexOf('as $$');
    assert(bodyStart > 0, `${fn.name}: gövde bulunamadı`);

    /**
     * Sütun ATIFI olmayan konumlar ayıklanır: `returns table (...)`,
     * `insert into t (...)` hedef sütun listesi, `on conflict (...)` listesi
     * ve `set <col> =` atama hedefleri sütun adını doğrudan tablodan çözer,
     * ifade olarak değerlendirilmez.
     */
    const body = fn.body
      .slice(bodyStart)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*--.*$/gm, ' ')
      .replace(/insert into [\w.]+ \([^)]*\)/g, ' ')
      .replace(/on conflict \([^)]*\)/g, ' ')
      .replace(/^\s*\w+ = /gm, ' ');

    // Yalnızca SÜTUN adıyla çakışan değişkenler risklidir.
    for (const variable of fn.variables) {
      if (!columns.has(variable)) continue;
      inspected += 1;

      const pattern = new RegExp(`(^|[^.\\w])${variable}\\b`, 'g');
      for (const match of body.matchAll(pattern)) {
        const index = match.index + match[0].length - variable.length;
        const before = body.slice(Math.max(0, index - 80), index);
        // `as <ad>` takma adı ve `declare` bildirimi atıf değildir.
        const isAlias = /\bas\s+$/.test(before);
        assert(
          isAlias,
          `${fn.name}: '${variable}' gövdede niteliksiz geçiyor — 42702 riski`,
        );
      }
    }
  }

  // En az bir riskli değişken gerçekten incelenmiş olmalı (test boş geçmesin).
  assert(inspected > 0, 'sütunla çakışan hiçbir değişken incelenmedi');
});

// ---------------------------------------------------------------------------
// 4c · Cihaz regresyonu: ön plan kilidi, kanal durumu, RPC hatası, katman
// ---------------------------------------------------------------------------

check('30. `AppState` başlangıç değeri ön planı YANLIŞLIKLA kapatmaz', () => {
  /**
   * KÖK NEDEN: React Native `AppState.currentState`i ASENKRON doldurur; mount
   * anında `null` veya `'unknown'` olabilir. `=== 'active'` karşılaştırması bu
   * yüzden açılışta `false` mühürlerdi ve `change` yalnızca GEÇİŞLERDE
   * tetiklendiği için uygulama hiç arka plana gitmezse banner sonsuza kadar
   * bastırılırdı.
   */
  for (const state of [null, undefined, 'unknown', 'active']) {
    assertEqual(
      isForegroundAppState(state),
      true,
      `başlangıç/aktif durum ön plan sayılmadı: ${String(state)}`,
    );
  }
  for (const state of ['background', 'inactive']) {
    assertEqual(isForegroundAppState(state), false, `arka plan durumu ön plan sayıldı: ${state}`);
  }

  // Mount anında `unknown` gelen bir cihazda banner GERÇEKTEN çıkar.
  setActiveConversation(undefined);
  const app = createBanner();
  app.setForeground(isForegroundAppState('unknown'));
  assertEqual(app.deliver(makeMessage({ at: NOW })), 'shown', 'unknown durumda banner bastırıldı');

  // KAYNAK: eski `=== 'active'` karşılaştırması kaldırıldı.
  assert(
    bannerCode.includes('isForegroundAppState(AppState.currentState)'),
    'banner ön plan kararını yardımcıdan almıyor',
  );
  assert(
    !/AppState\.currentState === 'active'/.test(bannerCode),
    'eski `=== active` kilidi hâlâ duruyor',
  );
  assert(
    !/isForegroundRef\.current = state === 'active'/.test(bannerCode),
    'dinleyici hâlâ eski karşılaştırmayı kullanıyor',
  );
});

check('31. Kanal `SUBSCRIBED` olmazsa SESSİZCE başarı sayılmaz', () => {
  // Servis durumu yukarı veriyor.
  const helper = service.slice(service.indexOf('export function subscribeToFriendMessages'));
  assert(helper.includes('onStatus?: (status: FriendMessageChannelStatus) => void;'), 'durum geri çağrısı yok');
  assert(helper.includes('.subscribe((status) =>'), 'subscribe durum almıyor');
  assert(!/\.subscribe\(\);/.test(helper), 'durumsuz `subscribe()` hâlâ duruyor');
  assert(
    service.includes("| 'CHANNEL_ERROR'") && service.includes("| 'TIMED_OUT'"),
    'hata durumları tipte yok',
  );

  // Banner durumu izliyor ve `SUBSCRIBED` dışını görünür kılıyor.
  assert(bannerCode.includes('onStatus: (status) =>'), 'banner durumu dinlemiyor');
  assert(bannerCode.includes('setChannelStatus(status);'), 'banner durumu state’e almıyor');
  assert(
    bannerCode.includes("channelStatus === 'SUBSCRIBED'"),
    'banner bağlanamayan kanalı ayırt etmiyor',
  );
  // Durum geri çağrısı da hesap sahipliğine bağlı.
  const statusBlock = bannerCode.slice(bannerCode.indexOf('onStatus: (status) =>'));
  assert(
    statusBlock.slice(0, 200).includes('viewerRef.current !== viewerId'),
    'durum geri çağrısı sahiplik kontrolü yapmıyor',
  );
});

check('32. Geç gelen ESKİ kanal durumu yeni hesabın kanalını kapatmaz', () => {
  const app = createBanner();
  const ownerA = app.state.viewer;
  app.switchAccount(STRANGER);

  // Eski hesabın geç durumu/olayı yeni hesabın state’ine yazamaz.
  assertEqual(
    app.deliver(makeMessage({ at: NOW }), ownerA),
    'dropped-account',
    'eski kanal olayı yeni hesaba yazdı',
  );

  // Yeni hesabın kanalı hâlâ ÇALIŞIR (mesaj YENİ hesaba gelmiş olmalı).
  assertEqual(
    app.deliver(makeMessage({ at: NOW, from: FRIEND, to: STRANGER })),
    'shown',
    'yeni hesabın kanalı kapanmış',
  );

  // KAYNAK: kanal adları benzersiz, `removeChannel` yalnızca kendi nesnesini kapatır.
  assert(service.includes('channelSequence += 1'), 'kanal adı benzersizleştirilmiyor');
  assert(service.includes('void supabase.removeChannel(channel);'), 'kanal nesnesi hedeflenmiyor');
  assert(!/removeAllChannels/.test(service), 'tüm kanalları kapatan çağrı var');
});

check('33. GEÇERLİ Realtime payload’ı parser’dan geçip karara ulaşıyor', () => {
  /** Sunucudan gelecek ham satırın birebir karşılığı. */
  const row = {
    client_message_id: uuid(910),
    content: 'merhaba',
    created_at: new Date(NOW).toISOString(),
    expires_at: new Date(NOW + DAY_MS).toISOString(),
    id: uuid(911),
    recipient_id: ME,
    sender_id: FRIEND,
  };

  // Servis parser'ının zorunlu alan kümesi.
  const required = ['id', 'sender_id', 'recipient_id', 'client_message_id', 'content', 'created_at', 'expires_at'];
  for (const field of required) {
    assert(field in row, `payload zorunlu alanı taşımıyor: ${field}`);
    assert(service.includes(`row.${field}`), `parser ${field} alanını okumuyor`);
  }

  // camelCase karşılığı banner ve nokta kararlarına ulaşır.
  const message = {
    clientMessageId: row.client_message_id,
    content: row.content,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    recipientId: row.recipient_id,
    senderId: row.sender_id,
  };

  setActiveConversation(undefined);
  const app = createBanner();
  assertEqual(app.deliver(message), 'shown', 'geçerli payload banner’a ulaşmadı');
  assertEqual(
    withUnreadFromMessage(new Set(), message, ME, undefined).has(FRIEND),
    true,
    'geçerli payload noktayı açmadı',
  );

  /**
   * `parseFriendMessage` referansı — zorunlu alanlardan biri bile eksikse satır
   * DÜŞER ve banner/nokta kararına hiç ulaşmaz.
   */
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const parsePayload = (raw) => {
    const id = uuidPattern.test(String(raw.id ?? '')) ? raw.id : undefined;
    const senderId = uuidPattern.test(String(raw.sender_id ?? '')) ? raw.sender_id : undefined;
    const recipientId = uuidPattern.test(String(raw.recipient_id ?? '')) ? raw.recipient_id : undefined;
    const clientMessageId = uuidPattern.test(String(raw.client_message_id ?? ''))
      ? raw.client_message_id
      : undefined;
    const content = typeof raw.content === 'string' && raw.content.trim() ? raw.content : undefined;
    const createdAt = Number.isFinite(Date.parse(raw.created_at ?? '')) ? raw.created_at : undefined;
    const expiresAt = Number.isFinite(Date.parse(raw.expires_at ?? '')) ? raw.expires_at : undefined;
    if (!id || !senderId || !recipientId || !clientMessageId) return undefined;
    if (!content || !createdAt || !expiresAt) return undefined;
    if (senderId === recipientId) return undefined;
    return { clientMessageId, content, createdAt, expiresAt, id, recipientId, senderId };
  };

  // Tam payload parser'dan GEÇER.
  assert(parsePayload(row) !== undefined, 'geçerli payload parser’dan geçmedi');

  // Eksik alan güvenli biçimde DÜŞER (sessiz kabul yok).
  for (const missing of required) {
    const broken = { ...row };
    delete broken[missing];
    assertEqual(
      parsePayload(broken),
      undefined,
      `eksik alanlı payload parser’dan geçti: ${missing}`,
    );
  }
});

check('34. Unread RPC hatası BOŞ LİSTE gibi modellenmiyor', () => {
  /** Yükleme modelinin referansı: hata ile "okunmamış yok" AYRI sonuçlardır. */
  const loadUnread = (outcome) => {
    if (outcome === 'ok') return { ids: [FRIEND], ok: true };
    if (outcome === 'empty') return { ids: [], ok: true };
    return { error: 'PGRST202', ok: false };
  };

  let unread = new Set([FRIEND]);
  let hasError = false;
  const apply = (result) => {
    if (result.ok) {
      unread = new Set(result.ids);
      hasError = false;
    } else {
      // Nokta durumu KORUNUR; hata ayırt edilir.
      hasError = true;
    }
  };

  apply(loadUnread('failed'));
  assertEqual(hasError, true, 'hata ayırt edilmedi');
  assertEqual(unread.has(FRIEND), true, 'hata mevcut noktayı sildi');

  apply(loadUnread('empty'));
  assertEqual(hasError, false, 'başarılı boş liste hata sayıldı');
  assertEqual(unread.size, 0, 'gerçek boş liste uygulanmadı');

  // KAYNAK: sessiz `catch(() => [])` KALDIRILDI.
  assert(
    !/listFriendUnread\(\)\.catch\(\(\) => \[\]/.test(friendsScreen),
    'sessiz boş-liste dönüşümü hâlâ duruyor',
  );
  assert(friendsScreen.includes('setHasUnreadError(true);'), 'hata durumu tutulmuyor');
  assert(friendsScreen.includes('ok: false as const'), 'hata ayırt edilebilir taşınmıyor');
});

check('35. Banner Stack ÜZERİNDE görünür katmana sahip', () => {
  // Mutlak konum + z-index + Android elevation.
  assert(bannerCode.includes("position: 'absolute'"), 'katman mutlak konumlu değil');
  assert(/zIndex: \d+/.test(bannerCode), 'zIndex yok');
  assert(/elevation: \d+/.test(bannerCode), 'Android elevation yok');
  // Alttaki dokunmaları engellemez ama banner dokunulabilir.
  assert(bannerCode.includes('pointerEvents="box-none"'), 'katman box-none değil');

  // `</Stack>` SONRASINDA ve kutlama katmanlarından ÖNCE çizilir.
  const stackEnd = layout.indexOf('</Stack>');
  const alertsIndex = layout.indexOf('<FriendMessageAlerts />');
  const rankIndex = layout.indexOf('<RankUpCelebrationLayer />');
  assert(stackEnd > 0 && alertsIndex > stackEnd, 'banner Stack’in üstünde çizilmiyor');
  assert(alertsIndex < rankIndex, 'banner kutlamaların üstünde çiziliyor');

  // Ekran dışı bileşende `useFocusEffect` KULLANILMAZ.
  assert(
    !bannerCode.includes('useFocusEffect'),
    'ekran dışı bileşende useFocusEffect kullanılıyor — zamanlayıcı yanlış anda iptal olabilir',
  );
});

// ---------------------------------------------------------------------------
// 5 · MUTASYON TESTLERİ
// ---------------------------------------------------------------------------

check('M0. ESKİ sütun-listeli upsert biçimine dönülürse test DÜŞER', () => {
  /**
   * Kasıtlı hata: `on conflict` yeniden sütun listesi kullanıyor ve birincil
   * anahtar adsız. Bu, `friend_id` parametresiyle çakışıp çalışma anında
   * `42702 ambiguous column reference` üretebilen ESKİ biçimdir.
   */
  const brokenSql = sqlCode
    .replace(
      'constraint friend_message_reads_pkey primary key (user_id, friend_id)',
      'primary key (user_id, friend_id)',
    )
    .replace(
      'on conflict on constraint friend_message_reads_pkey do update',
      'on conflict (user_id, friend_id) do update',
    );

  // Bozuk metin gerçekten eski biçimi taşımalı.
  assert(/on conflict \(user_id, friend_id\)/.test(brokenSql), 'mutasyon gerçekten uygulanmalı');
  assert(
    !brokenSql.includes('constraint friend_message_reads_pkey primary key'),
    'mutasyon adlandırılmış anahtarı gerçekten kaldırmalı',
  );

  // Kontrol 27'nin iki temel iddiası bozuk metinde DÜŞER.
  assertThrows(
    () =>
      assert(
        brokenSql.includes('on conflict on constraint friend_message_reads_pkey do update'),
        'mutation',
      ),
    'constraint adı iddiası eski biçimde de geçti',
  );
  assertThrows(
    () => assert(!/on conflict \(user_id, friend_id\)/.test(brokenSql), 'mutation'),
    'eski sütun listesi reddedilmedi',
  );

  // Kontrol 28'in genel taraması da bozuk metinde ÇAKIŞMA bulur.
  const brokenFunctions = readFunctions(brokenSql);
  const markFn = brokenFunctions.find((fn) => fn.name === 'public.mark_friend_messages_read');
  assert(markFn !== undefined, 'bozuk metinde fonksiyon bulunamadı');
  const clause = /on conflict \(([^)]*)\)/.exec(markFn.body);
  assert(clause !== null, 'bozuk metinde on conflict listesi yok');
  const collides = clause[1]
    .split(',')
    .map((column) => column.trim())
    .some((column) => markFn.variables.has(column));
  assertEqual(collides, true, 'bozuk model gerçekten parametre çakışması üretmeli');
  assertThrows(
    () => assertEqual(collides, false, 'mutation'),
    'parametre çakışması testten geçti — 42702 sınıfı yakalanmıyor',
  );

  // Gerçek dosyada çakışma YOK.
  const realFn = readFunctions(sqlCode).find(
    (fn) => fn.name === 'public.mark_friend_messages_read',
  );
  assert(!/on conflict \(/.test(realFn.body), 'gerçek dosyada sütun listeli upsert var');
});

check('M7. `AppState.currentState === active` kilidine dönülürse test DÜŞER', () => {
  /** Kasıtlı hata: mount anındaki `unknown` değeri ön planı kapatır. */
  const brokenForeground = (state) => state === 'active';

  assertEqual(brokenForeground('unknown'), false, 'bozuk model gerçekten kapatmalı');
  assertEqual(brokenForeground(null), false, 'bozuk model null’da da kapatmalı');
  assertThrows(
    () => assertEqual(brokenForeground('unknown'), true, 'mutation'),
    'eski ön plan kilidi testten geçti — banner’ın hiç çıkmaması yakalanmıyor',
  );

  // Bozuk kilitle banner GERÇEKTEN hiç çıkmaz.
  setActiveConversation(undefined);
  const broken = createBanner();
  broken.setForeground(brokenForeground('unknown'));
  assertEqual(broken.deliver(makeMessage({ at: NOW })), 'suppressed', 'bozuk model banner gösterdi');
  assertEqual(broken.state.shown.length, 0, 'bozuk modelde banner çıktı');

  // Doğru model aynı durumda banner gösterir.
  const fixed = createBanner();
  fixed.setForeground(isForegroundAppState('unknown'));
  assertEqual(fixed.deliver(makeMessage({ at: NOW })), 'shown', 'doğru model banner göstermedi');
});

check('M8. Kanal durumu ve unread hatası yutulursa test DÜŞER', () => {
  /** Kasıtlı hata: durumsuz `subscribe()` — bağlanamayan kanal sessiz başarı. */
  const brokenHelper = "  .subscribe();";
  assert(!/\.subscribe\(\);/.test(service), 'gerçek serviste durumsuz subscribe var');
  assertThrows(
    () => assert(!/\.subscribe\(\);/.test(brokenHelper), 'mutation'),
    'durumsuz subscribe testten geçti — sessiz kanal hatası yakalanmıyor',
  );

  /** Kasıtlı hata: unread hatası boş listeye çevriliyor. */
  const brokenLoad = 'listFriendUnread().catch(() => [] as string[])';
  assert(
    /listFriendUnread\(\)\.catch\(\(\) => \[\]/.test(brokenLoad),
    'bozuk model gerçekten yutmalı',
  );
  assertThrows(
    () => assert(!/listFriendUnread\(\)\.catch\(\(\) => \[\]/.test(brokenLoad), 'mutation'),
    'sessiz boş liste testten geçti — noktanın neden çıkmadığı gizli kalıyor',
  );
  // Gerçek dosyada yok.
  assert(
    !/listFriendUnread\(\)\.catch\(\(\) => \[\]/.test(friendsScreen),
    'gerçek dosyada sessiz yutma var',
  );
});

check('M1. Kendi mesajı okunmamış sayılırsa test DÜŞER', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  addMessage(server, ME, FRIEND);

  const broken = listUnread(server, ME, { countOwnMessages: true });
  assertDeepEqual(broken, [FRIEND], 'bozuk model gerçekten kendi mesajını saymalı');
  assertThrows(
    () => assertDeepEqual(broken, [], 'mutation'),
    'kendi mesajı sayılsa da geçti — yanlış nokta yakalanmıyor',
  );
  assertDeepEqual(listUnread(server, ME), [], 'doğru model kendi mesajını saydı');
});

check('M2. `last_read_at` karşılaştırması kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  addMessage(server, FRIEND, ME, -60 * 1000);
  markRead(server, ME, FRIEND);

  const broken = listUnread(server, ME, { ignoreLastRead: true });
  assertDeepEqual(broken, [FRIEND], 'karşılaştırmasız model gerçekten okunmamış saymalı');
  assertThrows(
    () => assertDeepEqual(broken, [], 'mutation'),
    'okuma zamanı yok sayılsa da geçti — kalıcı nokta yakalanmıyor',
  );
  assertDeepEqual(listUnread(server, ME), [], 'doğru model okunmuş mesajı saydı');
});

check('M3. Süre filtresi kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);
  const message = addMessage(server, FRIEND, ME);
  server.now = message.expiresAt;

  const broken = listUnread(server, ME, { ignoreExpiry: true });
  assertDeepEqual(broken, [FRIEND], 'süresiz model gerçekten saymalı');
  assertThrows(
    () => assertDeepEqual(broken, [], 'mutation'),
    'süresi dolmuş mesaj sayılsa da geçti',
  );
  assertDeepEqual(listUnread(server, ME), [], 'doğru model süresi dolmuşu saydı');
});

check('M4. Aktif sohbet kontrolü kaldırılırsa test DÜŞER', () => {
  setActiveConversation(FRIEND);
  const broken = createBanner({ ignoreActiveConversation: true });
  assertEqual(
    broken.deliver(makeMessage({ at: NOW, from: FRIEND })),
    'shown',
    'kontrolsüz model gerçekten banner göstermeli',
  );
  assertThrows(
    () => assertEqual(broken.state.shown.length, 0, 'mutation'),
    'açık sohbette banner çıksa da geçti',
  );

  const fixed = createBanner();
  assertEqual(
    fixed.deliver(makeMessage({ at: NOW, from: FRIEND })),
    'suppressed',
    'doğru model açık sohbette banner gösterdi',
  );
  setActiveConversation(undefined);
});

check('M5. Dedupe kaldırılırsa test DÜŞER', () => {
  setActiveConversation(undefined);
  const message = makeMessage({ at: NOW, id: uuid(650) });

  const broken = createBanner({ skipDedupe: true });
  broken.deliver(message);
  broken.deliver(message);
  assertEqual(broken.state.shown.length, 2, 'dedupe’suz model gerçekten iki kez göstermeli');
  assertThrows(
    () => assertEqual(broken.state.shown.length, 1, 'mutation'),
    'aynı mesaj iki kez gösterilse de geçti',
  );

  const fixed = createBanner();
  fixed.deliver(message);
  fixed.deliver(message);
  assertEqual(fixed.state.shown.length, 1, 'doğru model iki kez gösterdi');
});

check('M6. Okuma satırı başkası adına yazılırsa test DÜŞER', () => {
  const server = createServer();
  addFriendship(server, ME, FRIEND);

  /** Kasıtlı hata: satır `auth.uid()` yerine başka kimlik adına yazılıyor. */
  markRead(server, ME, FRIEND, { forcedUserId: STRANGER, requireOwnRow: false });
  assertEqual(server.reads[0].userId, STRANGER, 'bozuk model gerçekten başkası adına yazmalı');
  assertThrows(
    () => assertEqual(server.reads[0].userId, ME, 'mutation'),
    'başkası adına yazma testten geçti',
  );

  const clean = createServer();
  addFriendship(clean, ME, FRIEND);
  markRead(clean, ME, FRIEND);
  assertEqual(clean.reads[0].userId, ME, 'doğru model auth.uid() adına yazmadı');
});

// ---------------------------------------------------------------------------

rmSync(outDir, { force: true, recursive: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Mesaj farkındalığı harness: ${passed} kontrol geçti.`);
console.log('  (CANLI POSTGRESQL YOK — SQL çalıştırılmadı; uzaktan push bu fazda yoktur.)');
