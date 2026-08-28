#!/usr/bin/env node
/**
 * ARKADAŞ MESAJLAŞMASI (FAZ 1) — DOĞRULAMA HARNESS'I
 *
 * Kapsam: `friend_messages` tablosunun GÜVENLİK SINIRI, gönderme/okuma
 * RPC'lerinin davranışı, idempotency, spam sınırı, cursor sayfalama, 24
 * saatlik ömür ve fiziksel temizlik. Workout, rank, ödül, disiplin ve mevcut
 * arkadaşlık akışları BURADA TEST EDİLMEZ — onlar ayrı harness'lardadır ve o
 * dosyalara dokunulmamıştır.
 *
 * İki katman: (1) RPC'ler, RLS politikası, cron ve publication deterministik
 * bir modelle GERÇEKTEN çalıştırılır, (2) SQL ve servis kaynağı statik
 * denetlenir.
 *
 * Canlı Postgres YOKTUR: SQL çalıştırılmaz, modellenip statik denetlenir.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SQL_PATH = 'supabase/migrations/20260902120000_add_friend_messages.sql';

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

/** Belirli bir hata metniyle düşmeli. */
function assertRejects(fn, expectedMessage, message) {
  try {
    fn();
  } catch (error) {
    if (error.message !== expectedMessage) {
      throw new Error(`${message} — beklenen hata "${expectedMessage}", gelen "${error.message}"`);
    }
    return;
  }
  throw new Error(`${message} — hiç hata atılmadı`);
}

const source = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

const sql = source(SQL_PATH);
const sqlCode = sql.replace(/^\s*--.*$/gm, ' ');
const serviceSource = source('services/messages.ts');
const typesSource = source('types/messages.ts');
const friendsSql = source('supabase/migrations/20260814120000_add_friendships_and_shared_discipline.sql');

// ---------------------------------------------------------------------------
// Katman 1 — sunucu modeli
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const RATE_LIMIT = 60;
const MAX_LENGTH = 2000;
const CRON_JOB_NAME = 'cleanup-expired-friend-messages';
const CRON_SCHEDULE = '0 * * * *';
const CRON_COMMAND =
  "delete from public.friend_messages where expires_at <= timezone('utc', now());";

/** Sıralaması dizgi karşılaştırmasıyla uyumlu deterministik uuid. */
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function createServer(nowIso = '2026-09-02T12:00:00.000Z') {
  return {
    now: Date.parse(nowIso),
    profiles: new Map(),
    friendships: [],
    messages: [],
    nextMessageSeq: 1,
    /** `supabase_realtime` publication üyelikleri. */
    publication: [],
    /** Publication üyeliği için `alter publication` KAÇ KEZ çalıştı. */
    publicationAlterCount: 0,
    cronJobs: [],
    nextCronId: 1,
  };
}

function addUser(server, id, displayName, username) {
  server.profiles.set(id, {
    avatar_url: null,
    display_name: displayName,
    id,
    username: username ?? null,
  });
}

function addFriendship(server, a, b, status) {
  server.friendships.push({
    id: uuid(900 + server.friendships.length),
    receiver_id: b,
    requester_id: a,
    status,
  });
}

function removeFriendship(server, a, b) {
  server.friendships = server.friendships.filter(
    (f) =>
      !(
        (f.requester_id === a && f.receiver_id === b) ||
        (f.requester_id === b && f.receiver_id === a)
      ),
  );
}

/**
 * `public.are_friends` referansı.
 *
 * Oturum açmış kullanıcı iki taraftan biri DEĞİLSE `false` döner: üçüncü bir
 * kullanıcı başka iki kişinin arkadaş olup olmadığını öğrenemez.
 */
function areFriends(server, actor, a, b) {
  if (!actor) return false;
  if (actor !== a && actor !== b) return false;
  return server.friendships.some(
    (f) =>
      f.status === 'accepted' &&
      ((f.requester_id === a && f.receiver_id === b) ||
        (f.requester_id === b && f.receiver_id === a)),
  );
}

const findByClient = (server, sender, clientMessageId) =>
  server.messages.find(
    (m) => m.sender_id === sender && m.client_message_id === clientMessageId,
  );

/**
 * Satır ekleme.
 *
 * `enforceUnique` unique `(sender_id, client_message_id)` indeksinin
 * referansıdır: çakışmada yeni satır YAZILMAZ, mevcut satır okunur.
 */
function insertRow(server, actor, target, trimmed, clientMessageId, options = {}) {
  if (options.enforceUnique !== false) {
    const duplicate = findByClient(server, actor, clientMessageId);
    // `unique_violation` telafi yolu: yeni satır YAZILMAZ, mevcut satır okunur.
    if (duplicate) return { duplicate: true, row: duplicate };
  }

  const row = {
    client_message_id: clientMessageId,
    content: trimmed,
    created_at: server.now,
    // Ömür HER ZAMAN sunucudaki `created_at + 24 saat`.
    expires_at: server.now + DAY_MS,
    id: uuid(server.nextMessageSeq),
    recipient_id: target,
    sender_id: actor,
  };
  server.nextMessageSeq += 1;
  server.messages.push(row);
  return { duplicate: false, row };
}

/**
 * Bulunan kayıt GERÇEKTEN aynı isteğin retry'ı mı?
 *
 * Aynı istemci anahtarı yalnızca aynı alıcıya VE aynı normalize edilmiş
 * içeriğe aitse retry sayılır. Aksi hâlde istemci ikinci bir mesaj yazdığını
 * sanar, sunucu ise ilkini geri döndürürdü — bu sessiz kabul edilemez.
 */
function assertSameMessage(existing, target, trimmed, options = {}) {
  // Mutasyon: yalnızca alıcı karşılaştırılır, içerik göz ardı edilir.
  const compareContent = options.skipContentCheck !== true;
  const mismatch =
    existing.recipient_id !== target || (compareContent && existing.content.trim() !== trimmed);
  if (mismatch) throw new Error('client_message_id_conflict');
}

/**
 * `public.send_friend_message` referansı.
 *
 * Mutasyon seçenekleri:
 *  - `requireFriendship: false` → arkadaşlık kontrolü kaldırılmış model.
 *  - `enforceIdempotencyIndex: false` → unique indeks kaldırılmış model.
 *  - `recheckAfterLock: false` → kilit sonrası ikinci idempotency kontrolü yok.
 */
function sendMessage(server, actor, target, content, clientMessageId, options = {}) {
  const requireFriendship = options.requireFriendship !== false;
  const enforceUnique = options.enforceIdempotencyIndex !== false;
  const recheckAfterLock = options.recheckAfterLock !== false;
  /**
   * `true` → kilitten ÖNCEKİ hızlı yol okuması, diğer çağrı satırı yazmadan
   * ÖNCE yapılmıştır. Eşzamanlılığı dürüstçe modellemek için gereklidir:
   * ardışık çağrılarda ikinci istek zaten satırı görürdü.
   */
  const preLockSnapshotMiss = options.preLockSnapshotMiss === true;

  if (!actor) throw new Error('not_authenticated');
  if (!target || target === actor) throw new Error('invalid_target');
  if (!clientMessageId) throw new Error('invalid_client_message_id');
  if (requireFriendship && !areFriends(server, actor, actor, target)) {
    throw new Error('not_friends');
  }

  const trimmed = (content ?? '').trim();
  if (trimmed.length < 1 || trimmed.length > MAX_LENGTH) throw new Error('invalid_content');

  // YOL 1 — IDEMPOTENCY, kilitten önceki hızlı yol.
  const early = preLockSnapshotMiss ? undefined : findByClient(server, actor, clientMessageId);
  if (early) {
    assertSameMessage(early, target, trimmed, options);
    return early;
  }

  // YOL 2 — kilit alındı, doğru model burada TEKRAR bakar.
  if (recheckAfterLock) {
    const existing = findByClient(server, actor, clientMessageId);
    if (existing) {
      assertSameMessage(existing, target, trimmed, options);
      return existing;
    }
  }

  // SPAM KORUMASI — yalnızca YENİ mesajlar sayılır.
  const recentCount = server.messages.filter(
    (m) => m.sender_id === actor && m.created_at >= server.now - MINUTE_MS,
  ).length;
  if (recentCount >= RATE_LIMIT) throw new Error('message_rate_limited');

  // YOL 3 — `unique_violation` telafisi: okunan satıra AYNI kontrol uygulanır.
  const { duplicate, row } = insertRow(server, actor, target, trimmed, clientMessageId, {
    enforceUnique,
  });
  if (duplicate) assertSameMessage(row, target, trimmed, options);
  return row;
}

/** Eşzamanlı aynı anahtar, FARKLI içerik. Her çağrının sonucu ayrı raporlanır. */
function sendConcurrentWithContents(server, actor, target, contents, clientMessageId, options = {}) {
  assert(
    findByClient(server, actor, clientMessageId) === undefined,
    'senaryo kurulumu: çağrılar başlarken satır olmamalı',
  );

  return contents.map((content) => {
    try {
      return {
        ok: true,
        value: sendMessage(server, actor, target, content, clientMessageId, {
          ...options,
          preLockSnapshotMiss: true,
        }),
      };
    } catch (error) {
      return { error: error.message, ok: false };
    }
  });
}

/**
 * Aynı `client_message_id` ile EŞZAMANLI iki çağrı.
 *
 * İkisi de kilitten önce boş anlık görüntü görür; kilit çağrıları sıraya alır
 * ve her biri kilitten sonra tekrar bakar.
 */
function sendConcurrent(server, actor, target, content, clientMessageId, options = {}) {
  const preLockMiss = findByClient(server, actor, clientMessageId) === undefined;
  assert(preLockMiss, 'senaryo kurulumu: çağrılar başlarken satır olmamalı');

  return [
    sendMessage(server, actor, target, content, clientMessageId, {
      ...options,
      preLockSnapshotMiss: true,
    }),
    sendMessage(server, actor, target, content, clientMessageId, {
      ...options,
      preLockSnapshotMiss: true,
    }),
  ];
}

/** `public.get_friend_messages` referansı — keyset sayfalama. */
function getMessages(server, actor, target, cursor = {}, options = {}) {
  const requireFriendship = options.requireFriendship !== false;
  /**
   * Mutasyon: KALDIRILAN timestamp-only fallback'i geri getirir — yarım cursor
   * reddedilmez ve yalnızca zaman damgasıyla filtrelenir.
   */
  const legacyTimestampOnlyCursor = options.legacyTimestampOnlyCursor === true;

  const hasBeforeCreatedAt = cursor.beforeCreatedAt != null;
  const hasBeforeId = cursor.beforeId != null;
  // CURSOR ATOMİKTİR: ya ikisi de dolu ya ikisi de boş.
  if (!legacyTimestampOnlyCursor && hasBeforeCreatedAt !== hasBeforeId) {
    throw new Error('invalid_cursor');
  }

  if (!actor || !target || target === actor) return [];
  if (requireFriendship && !areFriends(server, actor, actor, target)) return [];

  const limit = Math.min(Math.max(cursor.pageSize ?? 30, 1), 50);

  let rows = server.messages.filter(
    (m) =>
      // Süresi dolmuş mesaj HİÇBİR koşulda dönmez.
      m.expires_at > server.now &&
      ((m.sender_id === actor && m.recipient_id === target) ||
        (m.sender_id === target && m.recipient_id === actor)),
  );

  rows.sort(
    (left, right) =>
      right.created_at - left.created_at || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0),
  );

  if (hasBeforeCreatedAt) {
    rows = rows.filter((m) => {
      // Yalnızca mutasyonda ulaşılabilen eski yol: `id` ayracı yok.
      if (legacyTimestampOnlyCursor && !hasBeforeId) return m.created_at < cursor.beforeCreatedAt;
      if (m.created_at !== cursor.beforeCreatedAt) return m.created_at < cursor.beforeCreatedAt;
      return m.id < cursor.beforeId;
    });
  }

  return rows.slice(0, limit);
}

/** `public.list_friend_conversations` referansı. */
function listConversations(server, actor) {
  if (!actor) return [];

  const friendIds = server.friendships
    .filter((f) => f.status === 'accepted' && [f.requester_id, f.receiver_id].includes(actor))
    .map((f) => (f.requester_id === actor ? f.receiver_id : f.requester_id));

  const rows = friendIds.map((friendId) => {
    const profile = server.profiles.get(friendId);
    const conversation = server.messages
      .filter(
        (m) =>
          // Süresi dolmuş mesaj SON MESAJ olarak görünmez.
          m.expires_at > server.now &&
          ((m.sender_id === actor && m.recipient_id === friendId) ||
            (m.sender_id === friendId && m.recipient_id === actor)),
      )
      .sort(
        (left, right) =>
          right.created_at - left.created_at ||
          (left.id < right.id ? 1 : left.id > right.id ? -1 : 0),
      );
    const last = conversation[0];

    return {
      avatar_url: profile?.avatar_url ?? null,
      display_name: profile?.display_name ?? '',
      last_message_at: last?.created_at,
      last_message_content: last?.content,
      last_message_sender_id: last?.sender_id,
      user_id: friendId,
      username: profile?.username ?? null,
    };
  });

  rows.sort((left, right) => {
    const leftAt = left.last_message_at;
    const rightAt = right.last_message_at;
    if (leftAt !== undefined && rightAt !== undefined && leftAt !== rightAt) return rightAt - leftAt;
    // Mesajı olmayanlar en sonda, kendi aralarında deterministik.
    if (leftAt !== undefined && rightAt === undefined) return -1;
    if (leftAt === undefined && rightAt !== undefined) return 1;
    if (left.display_name !== right.display_name) {
      return left.display_name < right.display_name ? -1 : 1;
    }
    return left.user_id < right.user_id ? -1 : 1;
  });

  return rows.slice(0, 100);
}

/** RLS SELECT politikasının referansı — doğrudan tablo okuması. */
function selectDirect(server, actor, options = {}) {
  const requireFriendship = options.requireFriendship !== false;
  return server.messages.filter(
    (m) =>
      [m.sender_id, m.recipient_id].includes(actor) &&
      m.expires_at > server.now &&
      (!requireFriendship || areFriends(server, actor, m.sender_id, m.recipient_id)),
  );
}

/** Saatlik temizlik işinin referansı — YALNIZCA süresi dolmuşları siler. */
function runCleanupCron(server) {
  const before = server.messages.length;
  server.messages = server.messages.filter((m) => !(m.expires_at <= server.now));
  return before - server.messages.length;
}

/** Migration'daki cron DO bloğunun referansı: ada göre kaldır, sonra kur. */
function installCronJob(server, options = {}) {
  if (options.unscheduleByName !== false) {
    server.cronJobs = server.cronJobs.filter((job) => job.jobname !== CRON_JOB_NAME);
  }
  server.cronJobs.push({
    command: CRON_COMMAND,
    jobid: server.nextCronId,
    jobname: CRON_JOB_NAME,
    schedule: CRON_SCHEDULE,
  });
  server.nextCronId += 1;
}

/** Migration'daki publication DO bloğunun referansı. */
function installPublication(server, options = {}) {
  const checkMembership = options.checkMembership !== false;
  if (checkMembership && server.publication.includes('friend_messages')) return 'skipped';
  // Zaten üyeyken çalıştırılırsa Postgres "already member of publication" der.
  if (server.publication.includes('friend_messages')) throw new Error('already_member');
  server.publication.push('friend_messages');
  server.publicationAlterCount += 1;
  return 'added';
}

const SERVICE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `services/messages.ts` içindeki RPC ÖNCESİ cursor doğrulamasının referansı.
 *
 * Bozuk veya yarım cursor Supabase'e HİÇ gönderilmez.
 */
function validateServiceCursor(cursor) {
  if (cursor === undefined) return;
  const timestampOk =
    typeof cursor.beforeCreatedAt === 'string' &&
    cursor.beforeCreatedAt.trim().length > 0 &&
    Number.isFinite(Date.parse(cursor.beforeCreatedAt));
  const idOk = typeof cursor.beforeId === 'string' && SERVICE_UUID_PATTERN.test(cursor.beforeId);
  if (!timestampOk || !idOk) throw new Error('invalid_cursor');
}

const ALICE = uuid(1001);
const BOB = uuid(1002);
const CAROL = uuid(1003);
const DAVE = uuid(1004);

function seed(server) {
  addUser(server, ALICE, 'Alice', 'alice');
  addUser(server, BOB, 'Bob', 'bob');
  addUser(server, CAROL, 'Carol', 'carol');
  addUser(server, DAVE, 'Dave', 'dave');
  addFriendship(server, ALICE, BOB, 'accepted');
}

let clientSeq = 0;
const clientId = () => uuid(500000 + (clientSeq += 1));

// ---------------------------------------------------------------------------
// 1 · Gönderme yetkisi
// ---------------------------------------------------------------------------

check('1. Yalnızca KABUL EDİLMİŞ arkadaş mesaj gönderebilir', () => {
  const server = createServer();
  seed(server);

  const message = sendMessage(server, ALICE, BOB, 'selam', clientId());
  assertEqual(message.sender_id, ALICE, 'gönderen sunucu tarafından belirlenmedi');
  assertEqual(message.recipient_id, BOB, 'alıcı yanlış');
  assertEqual(server.messages.length, 1, 'mesaj yazılmadı');
});

check('2. BEKLEYEN istek mesajlaşamaz', () => {
  const server = createServer();
  seed(server);
  addFriendship(server, ALICE, CAROL, 'pending');

  assertRejects(
    () => sendMessage(server, ALICE, CAROL, 'selam', clientId()),
    'not_friends',
    'bekleyen istekle mesaj gönderilebildi',
  );
  assertRejects(
    () => sendMessage(server, CAROL, ALICE, 'selam', clientId()),
    'not_friends',
    'bekleyen istekte ters yön mesaj gönderebildi',
  );
  assertEqual(server.messages.length, 0, 'bekleyen istekte satır yazıldı');
});

check('3. ARKADAŞ OLMAYAN kullanıcı mesajlaşamaz', () => {
  const server = createServer();
  seed(server);

  assertRejects(
    () => sendMessage(server, ALICE, DAVE, 'selam', clientId()),
    'not_friends',
    'arkadaş olmayana mesaj gönderilebildi',
  );
  assertEqual(server.messages.length, 0, 'arkadaş olmayana satır yazıldı');
});

check('4. Kullanıcı KENDİNE mesaj gönderemez', () => {
  const server = createServer();
  seed(server);

  assertRejects(
    () => sendMessage(server, ALICE, ALICE, 'selam', clientId()),
    'invalid_target',
    'kullanıcı kendine mesaj gönderebildi',
  );
  // Tablo kısıtı da aynı kuralı taşır.
  assert(
    sqlCode.includes('check (sender_id <> recipient_id)'),
    'kendine mesaj kısıtı tabloda yok',
  );
});

check('5. BOŞ ve yalnızca BOŞLUK mesaj reddedilir', () => {
  const server = createServer();
  seed(server);

  for (const content of ['', '   ', '\n\t  \n']) {
    assertRejects(
      () => sendMessage(server, ALICE, BOB, content, clientId()),
      'invalid_content',
      `boş içerik kabul edildi: ${JSON.stringify(content)}`,
    );
  }
  assertEqual(server.messages.length, 0, 'boş içerikte satır yazıldı');

  // Kenardaki boşluklar kırpılır; içerik trimlenmiş saklanır.
  const message = sendMessage(server, ALICE, BOB, '  selam  ', clientId());
  assertEqual(message.content, 'selam', 'içerik trimlenmedi');
});

check('6. 2000 karakter KABUL, 2001 karakter RED', () => {
  const server = createServer();
  seed(server);

  const limit = sendMessage(server, ALICE, BOB, 'a'.repeat(MAX_LENGTH), clientId());
  assertEqual(limit.content.length, MAX_LENGTH, '2000 karakter kabul edilmedi');

  assertRejects(
    () => sendMessage(server, ALICE, BOB, 'a'.repeat(MAX_LENGTH + 1), clientId()),
    'invalid_content',
    '2001 karakter kabul edildi',
  );
  // Kırpma SONRASI ölçülür: kenar boşlukları sınırı aşmaz.
  const padded = sendMessage(server, ALICE, BOB, `   ${'b'.repeat(MAX_LENGTH)}   `, clientId());
  assertEqual(padded.content.length, MAX_LENGTH, 'kırpma sonrası sınır yanlış ölçüldü');
  assertEqual(server.messages.length, 2, 'reddedilen mesaj yazıldı');
});

// ---------------------------------------------------------------------------
// 2 · Idempotency ve spam koruması
// ---------------------------------------------------------------------------

check('7. Aynı `client_message_id` tekrarında TEK kayıt oluşur', () => {
  const server = createServer();
  seed(server);
  const cid = clientId();

  const first = sendMessage(server, ALICE, BOB, 'selam', cid);
  const retry = sendMessage(server, ALICE, BOB, 'selam', cid);

  assertEqual(server.messages.length, 1, 'retry ikinci satır oluşturdu');
  assertEqual(retry.id, first.id, 'retry farklı mesaj döndürdü');
  assertEqual(retry.created_at, first.created_at, 'retry oluşturulma anını değiştirdi');

  // Aynı anahtar BAŞKA arkadaşa yeniden kullanılamaz.
  addFriendship(server, ALICE, CAROL, 'accepted');
  assertRejects(
    () => sendMessage(server, ALICE, CAROL, 'selam', cid),
    'client_message_id_conflict',
    'aynı istemci kimliği başka konuşmada sessizce kabul edildi',
  );
});

check('8. EŞZAMANLI retry TEK kayıt üretir', () => {
  const server = createServer();
  seed(server);
  const cid = clientId();

  const [first, second] = sendConcurrent(server, ALICE, BOB, 'selam', cid);

  assertEqual(server.messages.length, 1, 'eşzamanlı retry iki satır oluşturdu');
  assertEqual(first.id, second.id, 'eşzamanlı çağrılar farklı mesaj döndürdü');

  // Kilit sonrası kontrol kaldırılsa bile unique indeks ikinci satırı engeller.
  const withoutRecheck = createServer();
  seed(withoutRecheck);
  sendConcurrent(withoutRecheck, ALICE, BOB, 'selam', clientId(), { recheckAfterLock: false });
  assertEqual(withoutRecheck.messages.length, 1, 'unique indeks ikinci katman olarak tutmadı');
});

check('9. Rate limit IDEMPOTENT retry’ı cezalandırmaz', () => {
  const server = createServer();
  seed(server);

  // Sınırın hemen altına kadar doldur.
  const sent = [];
  for (let index = 0; index < RATE_LIMIT - 1; index += 1) {
    const cid = clientId();
    const content = `mesaj-${index}`;
    sent.push({ cid, content });
    sendMessage(server, ALICE, BOB, content, cid);
  }
  assertEqual(server.messages.length, RATE_LIMIT - 1, 'kurulum: mesaj sayısı yanlış');

  // Yüzlerce GERÇEK retry (aynı anahtar + aynı içerik): hiçbiri yeni sayılmaz.
  for (let round = 0; round < 5; round += 1) {
    for (const { cid, content } of sent) sendMessage(server, ALICE, BOB, content, cid);
  }
  assertEqual(server.messages.length, RATE_LIMIT - 1, 'retry yeni satır oluşturdu');

  // Sınır hâlâ dolmadığı için yeni bir mesaj geçer.
  sendMessage(server, ALICE, BOB, 'son', clientId());
  assertEqual(server.messages.length, RATE_LIMIT, 'retry sonrası yeni mesaj engellendi');
});

check('10. Aynı dakikada 61. YENİ mesaj reddedilir', () => {
  const server = createServer();
  seed(server);

  for (let index = 0; index < RATE_LIMIT; index += 1) {
    sendMessage(server, ALICE, BOB, `mesaj-${index}`, clientId());
  }
  assertEqual(server.messages.length, RATE_LIMIT, 'kurulum: 60 mesaj yazılmadı');

  assertRejects(
    () => sendMessage(server, ALICE, BOB, 'fazladan', clientId()),
    'message_rate_limited',
    '61. mesaj kabul edildi',
  );
  assertEqual(server.messages.length, RATE_LIMIT, 'reddedilen mesaj yazıldı');

  // Sınır KULLANICI başınadır: başka kullanıcı etkilenmez.
  addFriendship(server, CAROL, BOB, 'accepted');
  sendMessage(server, CAROL, BOB, 'selam', clientId());
  assertEqual(server.messages.length, RATE_LIMIT + 1, 'sınır başka kullanıcıyı da durdurdu');

  // Pencere kayınca yeniden gönderilebilir.
  server.now += MINUTE_MS + 1;
  sendMessage(server, ALICE, BOB, 'yeni dakika', clientId());
  assertEqual(server.messages.length, RATE_LIMIT + 2, 'pencere kaydıktan sonra da engellendi');
});

// ---------------------------------------------------------------------------
// 3 · Okuma sınırı
// ---------------------------------------------------------------------------

check('11. Yalnızca konuşmanın İKİ TARAFI mesajları okuyabilir', () => {
  const server = createServer();
  seed(server);
  sendMessage(server, ALICE, BOB, 'gizli', clientId());

  assertEqual(getMessages(server, ALICE, BOB).length, 1, 'gönderen kendi mesajını okuyamadı');
  assertEqual(getMessages(server, BOB, ALICE).length, 1, 'alıcı mesajı okuyamadı');

  // Üçüncü kişi hiçbir yoldan göremez.
  assertEqual(getMessages(server, CAROL, ALICE).length, 0, 'üçüncü kişi RPC ile okudu');
  assertEqual(getMessages(server, CAROL, BOB).length, 0, 'üçüncü kişi RPC ile okudu');
  assertEqual(selectDirect(server, CAROL).length, 0, 'üçüncü kişi doğrudan SELECT ile okudu');

  // Üçüncü kişi iki kişinin ARKADAŞ olduğunu bile öğrenemez.
  assertEqual(areFriends(server, CAROL, ALICE, BOB), false, 'sosyal grafik sızdı');
});

check('12. Arkadaşlık KALDIRILDIĞINDA okuma ve gönderme kapanır', () => {
  const server = createServer();
  seed(server);
  sendMessage(server, ALICE, BOB, 'eski mesaj', clientId());
  assertEqual(getMessages(server, ALICE, BOB).length, 1, 'kurulum: mesaj okunmalı');

  removeFriendship(server, ALICE, BOB);

  assertEqual(getMessages(server, ALICE, BOB).length, 0, 'arkadaşlık bitince okuma açık kaldı');
  assertEqual(getMessages(server, BOB, ALICE).length, 0, 'arkadaşlık bitince okuma açık kaldı');
  assertEqual(selectDirect(server, ALICE).length, 0, 'doğrudan SELECT açık kaldı');
  assertDeepEqual(listConversations(server, ALICE), [], 'konuşma listesinde kaldı');
  assertRejects(
    () => sendMessage(server, ALICE, BOB, 'yeni', clientId()),
    'not_friends',
    'arkadaşlık bitince gönderme açık kaldı',
  );

  // Geçmiş FİZİKSEL olarak silinmez.
  assertEqual(server.messages.length, 1, 'arkadaşlık kaldırılınca mesaj fiziksel olarak silindi');

  // Yeniden arkadaş olurlarsa (süresi dolmamış) geçmiş yeniden görünür.
  addFriendship(server, ALICE, BOB, 'accepted');
  assertEqual(getMessages(server, ALICE, BOB).length, 1, 'yeniden arkadaşlıkta geçmiş dönmedi');
});

// ---------------------------------------------------------------------------
// 4 · Sayfalama
// ---------------------------------------------------------------------------

check('13. Cursor sayfalama aynı timestamp’te atlamaz ve çoğaltmaz', () => {
  const server = createServer();
  seed(server);

  // BEŞ mesaj, HEPSİ aynı `created_at` değerinde: ayraç yalnızca `id`.
  for (let index = 0; index < 5; index += 1) {
    sendMessage(server, ALICE, BOB, `es-zamanli-${index}`, clientId());
  }
  const stamps = new Set(server.messages.map((m) => m.created_at));
  assertEqual(stamps.size, 1, 'senaryo kurulumu: bütün mesajlar aynı anda olmalı');

  const seen = [];
  let cursor = { pageSize: 2 };
  for (let page = 0; page < 5; page += 1) {
    const rows = getMessages(server, ALICE, BOB, cursor);
    if (rows.length === 0) break;
    seen.push(...rows.map((row) => row.id));
    const last = rows[rows.length - 1];
    cursor = { beforeCreatedAt: last.created_at, beforeId: last.id, pageSize: 2 };
  }

  assertEqual(seen.length, 5, 'sayfalama satır atladı veya erken bitti');
  assertEqual(new Set(seen).size, 5, 'sayfalama aynı satırı çoğalttı');

  // Sıra kararlı: id azalan.
  const expected = [...server.messages].map((m) => m.id).sort().reverse();
  assertDeepEqual(seen, expected, 'sayfa içi sıra kararlı değil');
});

check('14. Sayfa boyutu en fazla 50, en az 1', () => {
  const server = createServer();
  seed(server);
  for (let index = 0; index < 60; index += 1) {
    server.now += 1000;
    sendMessage(server, ALICE, BOB, `mesaj-${index}`, clientId());
  }

  assertEqual(getMessages(server, ALICE, BOB, { pageSize: 200 }).length, 50, 'sayfa 50’yi aştı');
  assertEqual(getMessages(server, ALICE, BOB, { pageSize: 50 }).length, 50, '50 kabul edilmedi');
  assertEqual(getMessages(server, ALICE, BOB, { pageSize: 0 }).length, 1, 'alt sınır 1 değil');
  assertEqual(getMessages(server, ALICE, BOB, { pageSize: -5 }).length, 1, 'negatif sayfa boyutu');
  assertEqual(getMessages(server, ALICE, BOB, {}).length, 30, 'varsayılan sayfa boyutu 30 değil');

  // Sunucu OFFSET kullanmaz.
  assert(!/\boffset\b/i.test(sqlCode), 'SQL offset sayfalama kullanıyor');
});

// ---------------------------------------------------------------------------
// 5 · Konuşma listesi
// ---------------------------------------------------------------------------

check('15. Konuşma listesinde YALNIZCA kabul edilmiş arkadaşlar vardır', () => {
  const server = createServer();
  seed(server);
  addFriendship(server, ALICE, CAROL, 'pending');

  const rows = listConversations(server, ALICE);
  assertDeepEqual(
    rows.map((row) => row.user_id),
    [BOB],
    'liste bekleyen istek veya yabancı içeriyor',
  );

  // Mesajı olmayan arkadaş listede KALIR, önizleme boştur.
  assertEqual(rows[0].last_message_content, undefined, 'mesajsız arkadaşta önizleme üretildi');

  // Yalnızca güvenli profil alanları döner.
  assertDeepEqual(
    Object.keys(rows[0]).sort(),
    [
      'avatar_url',
      'display_name',
      'last_message_at',
      'last_message_content',
      'last_message_sender_id',
      'user_id',
      'username',
    ],
    'konuşma satırında beklenmeyen alan var',
  );
});

check('16. Son mesaj sıralaması KARARLIDIR', () => {
  const server = createServer();
  seed(server);
  addFriendship(server, ALICE, CAROL, 'accepted');
  addFriendship(server, ALICE, DAVE, 'accepted');

  sendMessage(server, ALICE, BOB, 'bob-eski', clientId());
  server.now += 60 * 1000;
  sendMessage(server, CAROL, ALICE, 'carol-yeni', clientId());

  const rows = listConversations(server, ALICE);
  assertDeepEqual(
    rows.map((row) => row.user_id),
    [CAROL, BOB, DAVE],
    'mesajı olanlar en yeni önce sıralanmadı',
  );
  assertEqual(rows[0].last_message_sender_id, CAROL, 'son mesaj göndericisi yanlış');

  // Mesajı olmayanlar deterministik: ad, sonra kimlik.
  addFriendship(server, ALICE, uuid(1005), 'accepted');
  addUser(server, uuid(1005), 'Aaron', 'aaron');
  const withoutMessages = listConversations(server, ALICE)
    .filter((row) => row.last_message_at === undefined)
    .map((row) => row.display_name);
  assertDeepEqual(withoutMessages, ['Aaron', 'Dave'], 'mesajsız arkadaşlar deterministik değil');

  // En fazla 100 konuşma.
  assert(sqlCode.includes('limit 100'), 'konuşma listesinde 100 sınırı yok');
});

// ---------------------------------------------------------------------------
// 6 · 24 saatlik ömür
// ---------------------------------------------------------------------------

check('17. Mesaj 24 saat DOLMADAN okunabilir', () => {
  const server = createServer();
  seed(server);
  const message = sendMessage(server, ALICE, BOB, 'gecici', clientId());
  assertEqual(message.expires_at, message.created_at + DAY_MS, 'ömür tam 24 saat değil');

  server.now = message.created_at + DAY_MS - 1;
  assertEqual(getMessages(server, ALICE, BOB).length, 1, 'sınırdan hemen önce okunamadı');
  assertEqual(selectDirect(server, BOB).length, 1, 'sınırdan hemen önce doğrudan okunamadı');
});

check('18. TAM 24 saat sınırında artık okunamaz', () => {
  const server = createServer();
  seed(server);
  const message = sendMessage(server, ALICE, BOB, 'gecici', clientId());

  server.now = message.created_at + DAY_MS;

  assertEqual(getMessages(server, ALICE, BOB).length, 0, 'tam sınırda geçmiş RPC’si döndürdü');
  assertEqual(selectDirect(server, ALICE).length, 0, 'tam sınırda doğrudan SELECT döndürdü');
  assertEqual(selectDirect(server, BOB).length, 0, 'tam sınırda alıcı okuyabildi');
  // Satır henüz FİZİKSEL olarak duruyor ama erişilemez.
  assertEqual(server.messages.length, 1, 'senaryo kurulumu: satır henüz silinmemiş olmalı');
});

check('19. Süresi dolmuş mesaj SON MESAJ olarak görünmez', () => {
  const server = createServer();
  seed(server);
  const message = sendMessage(server, ALICE, BOB, 'eski', clientId());

  server.now = message.created_at + DAY_MS;
  const rows = listConversations(server, ALICE);

  assertDeepEqual(rows.map((row) => row.user_id), [BOB], 'arkadaş listeden düştü');
  assertEqual(rows[0].last_message_content, undefined, 'süresi dolmuş mesaj önizlemede kaldı');
  assertEqual(rows[0].last_message_at, undefined, 'süresi dolmuş mesaj zamanı gösterildi');

  // Süresi dolmamış daha eski bir mesaj varsa O gösterilir.
  const fresh = sendMessage(server, BOB, ALICE, 'yeni', clientId());
  assertEqual(
    listConversations(server, ALICE)[0].last_message_content,
    fresh.content,
    'geçerli son mesaj seçilmedi',
  );
});

check('20. Cron YALNIZCA süresi dolmuş mesajları siler', () => {
  const server = createServer();
  seed(server);
  const old = sendMessage(server, ALICE, BOB, 'eski', clientId());
  server.now += 2 * 60 * 60 * 1000;
  const recent = sendMessage(server, ALICE, BOB, 'yeni', clientId());

  server.now = old.expires_at;
  const deleted = runCleanupCron(server);

  assertEqual(deleted, 1, 'cron yanlış sayıda satır sildi');
  assertDeepEqual(server.messages.map((m) => m.id), [recent.id], 'cron geçerli mesajı sildi');

  // Arkadaşlık ve profil verisi ETKİLENMEZ.
  assertEqual(server.friendships.length, 1, 'cron arkadaşlık kaydını etkiledi');
  assertEqual(server.profiles.size, 4, 'cron profil verisini etkiledi');

  // Cron komutu yalnızca bu tabloya dokunur.
  assert(CRON_COMMAND.startsWith('delete from public.friend_messages'), 'cron komutu beklenmedik');
  assertEqual(
    (CRON_COMMAND.match(/\bfrom\s+\S+/g) ?? []).length,
    1,
    'cron komutu birden fazla tabloya dokunuyor',
  );
});

check('21. Cron yeniden kurulunca aynı adlı İKİNCİ görev oluşmaz', () => {
  const server = createServer();

  installCronJob(server);
  installCronJob(server);
  installCronJob(server);

  assertEqual(server.cronJobs.length, 1, 'aynı adlı ikinci cron görevi oluştu');
  assertEqual(server.cronJobs[0].jobname, CRON_JOB_NAME, 'cron iş adı sabit değil');
  assertEqual(server.cronJobs[0].schedule, CRON_SCHEDULE, 'cron saatlik değil');

  // Ada göre kaldırma olmasaydı kopya oluşurdu.
  const broken = createServer();
  installCronJob(broken, { unscheduleByName: false });
  installCronJob(broken, { unscheduleByName: false });
  assertEqual(broken.cronJobs.length, 2, 'bozuk model gerçekten kopya üretmeli');
  assertThrows(
    () => assertEqual(broken.cronJobs.length, 1, 'mutation'),
    'kopya cron görevi testten geçti',
  );
});

check('22. İstemci sahte `expires_at` veya `created_at` gönderemez', () => {
  const server = createServer();
  seed(server);

  // Model, RPC'nin imzasını yansıtır: zaman alanı PARAMETRE DEĞİLDİR.
  const message = sendMessage(server, ALICE, BOB, 'selam', clientId());
  assertEqual(message.created_at, server.now, 'oluşturulma anı sunucudan gelmedi');
  assertEqual(message.expires_at, server.now + DAY_MS, 'sona erme anı sunucudan gelmedi');

  // İmzada yalnızca üç parametre var.
  assert(
    sqlCode.includes(
      'create or replace function public.send_friend_message(\n  target_user_id uuid,\n  message_content text,\n  client_message_id uuid\n)',
    ),
    'gönderme RPC imzası beklenenden farklı',
  );
  assert(
    !/create or replace function public\.send_friend_message[\s\S]*?\)\s*returns/.exec(sqlCode)?.[0]
      .match(/expires_at|created_at/),
    'gönderme RPC imzası zaman parametresi taşıyor',
  );
  // INSERT ifadesi zaman sütunlarını YAZMAZ; varsayılan kullanılır.
  const insertStatement = /insert into public\.friend_messages \(([^)]*)\)/.exec(sqlCode)?.[1] ?? '';
  assert(insertStatement.length > 0, 'INSERT ifadesi bulunamadı');
  assert(
    !insertStatement.includes('created_at') && !insertStatement.includes('expires_at'),
    'INSERT zaman sütunlarını açıkça yazıyor',
  );
  // Kısıt, tam 24 saati yapısal olarak zorunlu kılar.
  assert(
    sqlCode.includes("check (expires_at = created_at + interval '24 hours')"),
    '24 saatlik ömür kısıtı yok',
  );
  // Servis de zaman göndermez.
  assert(
    !/expires_at|created_at/.test(
      serviceSource.slice(
        serviceSource.indexOf("supabase.rpc('send_friend_message'"),
        serviceSource.indexOf('if (error) throw error;', serviceSource.indexOf('send_friend_message')),
      ),
    ),
    'servis gönderirken zaman alanı yolluyor',
  );
});

check('23. Idempotent retry ve rate-limit reddi ömrü DEĞİŞTİRMEZ', () => {
  const server = createServer();
  seed(server);
  const cid = clientId();
  const first = sendMessage(server, ALICE, BOB, 'selam', cid);

  // Saatler sonra yapılan retry ilk mesajın ömrünü yeniden başlatmaz.
  server.now += 6 * 60 * 60 * 1000;
  const retry = sendMessage(server, ALICE, BOB, 'selam', cid);
  assertEqual(retry.expires_at, first.expires_at, 'retry mesaj ömrünü yeniden başlattı');
  assertEqual(retry.created_at, first.created_at, 'retry oluşturulma anını değiştirdi');

  // Rate limit reddi de mevcut mesajların ömrünü değiştirmez.
  for (let index = 0; index < RATE_LIMIT; index += 1) {
    sendMessage(server, ALICE, BOB, `dolgu-${index}`, clientId());
  }
  const snapshot = server.messages.map((m) => `${m.id}:${m.expires_at}`);
  assertRejects(
    () => sendMessage(server, ALICE, BOB, 'fazladan', clientId()),
    'message_rate_limited',
    'kurulum: sınır dolmalıydı',
  );
  assertDeepEqual(
    server.messages.map((m) => `${m.id}:${m.expires_at}`),
    snapshot,
    'rate limit reddi mesaj ömürlerini değiştirdi',
  );

  // İlk mesaj hâlâ KENDİ 24 saatinde sona erer.
  server.now = first.expires_at;
  assertEqual(
    getMessages(server, ALICE, BOB).some((m) => m.id === first.id),
    false,
    'retry sonrası ilk mesaj 24 saatten uzun yaşadı',
  );
});

check('24. Realtime publication eklemesi IDEMPOTENTTİR', () => {
  const server = createServer();

  assertEqual(installPublication(server), 'added', 'ilk kurulumda tabloya eklenmedi');
  assertEqual(installPublication(server), 'skipped', 'ikinci kurulumda tekrar eklendi');
  assertEqual(installPublication(server), 'skipped', 'üçüncü kurulumda tekrar eklendi');
  assertEqual(server.publicationAlterCount, 1, 'alter publication birden fazla kez çalıştı');
  assertDeepEqual(server.publication, ['friend_messages'], 'publication üyeliği beklenmedik');

  // Üyelik kontrolü olmasaydı "already member of publication" hatası gelirdi.
  const broken = createServer();
  installPublication(broken, { checkMembership: false });
  assertRejects(
    () => installPublication(broken, { checkMembership: false }),
    'already_member',
    'kontrolsüz model gerçekten hata vermeli',
  );

  /**
   * Abonelik YALNIZCA servis katmanında yaşar.
   *
   * Faz 1'de hiç istemci kodu yoktu; Faz 2 aboneliği `services/messages.ts`
   * içine ekledi. Değişmez aynı kaldı: UI Supabase'e dokunmaz ve yalnızca
   * INSERT dinlenir. (İstemci yaşam döngüsünün tamamı ayrı harness'tadır:
   * `scripts/verify-friend-messaging-client.mjs`.)
   */
  const uiSources = ['app/messages/index.tsx', 'app/messages/[userId].tsx']
    .filter((path) => existsSync(join(ROOT, path)))
    .map((path) => source(path));
  for (const ui of uiSources) {
    assert(!/\.channel\(|postgres_changes/.test(ui), 'UI doğrudan realtime kanalı kuruyor');
    assert(!/@\/lib\/supabase/.test(ui), 'UI doğrudan Supabase istemcisini kullanıyor');
  }
  if (/\.channel\(/.test(serviceSource)) {
    const handler = serviceSource.slice(serviceSource.indexOf('.channel('));
    assert(handler.includes("event: 'INSERT'"), 'servis yalnızca INSERT dinlemiyor');
    assert(
      !/event: 'UPDATE'|event: 'DELETE'|event: '\*'/.test(handler),
      'servis fazladan realtime olayı dinliyor',
    );
  }
});

// ---------------------------------------------------------------------------
// 7 · SQL güvenlik denetimi
// ---------------------------------------------------------------------------

check('25. RLS açıktır ve politika üç koşulu birden taşır', () => {
  assert(
    sqlCode.includes('alter table public.friend_messages enable row level security;'),
    'RLS açılmamış',
  );

  const policy = sqlCode.slice(
    sqlCode.indexOf('create policy "friend_messages_select_involved_friends"'),
    sqlCode.indexOf('-- ', sqlCode.indexOf('create policy "friend_messages_select_involved_friends"')),
  );
  assert(policy.includes('for select'), 'politika yalnızca SELECT değil');
  assert(policy.includes('(select auth.uid()) in (sender_id, recipient_id)'), 'taraf kontrolü yok');
  assert(policy.includes("expires_at > timezone('utc', now())"), 'politikada süre kontrolü yok');
  assert(policy.includes('public.are_friends(sender_id, recipient_id)'), 'arkadaşlık kontrolü yok');

  // Yalnızca SELECT politikası vardır; INSERT/UPDATE/DELETE politikası YOK.
  const policyCount = (sqlCode.match(/create policy/g) ?? []).length;
  assertEqual(policyCount, 1, 'beklenmeyen ek politika var');
  assert(!/for (insert|update|delete)/.test(sqlCode), 'yazma politikası eklenmiş');

  // Mevcut yardımcı yeniden kullanılır, kopyalanmaz.
  assert(
    friendsSql.includes('create or replace function public.are_friends'),
    'are_friends mevcut migration’da tanımlı değil',
  );
  assert(
    !sqlCode.includes('create or replace function public.are_friends'),
    'are_friends yeniden tanımlanmış',
  );
});

check('26. `anon` hiçbir yetki almaz; `authenticated` doğrudan YAZAMAZ', () => {
  assert(
    sqlCode.includes('revoke all on table public.friend_messages from anon;'),
    'anon yetkileri geri alınmamış',
  );
  assert(
    sqlCode.includes('revoke all on table public.friend_messages from authenticated;'),
    'authenticated yetkileri geri alınmamış',
  );
  assert(
    sqlCode.includes('grant select on table public.friend_messages to authenticated;'),
    'authenticated SELECT yetkisi yok',
  );

  // Hiçbir yerde anon’a grant verilmez.
  assert(!/grant[^;]*to anon/i.test(sqlCode), 'anon’a yetki verilmiş');
  // Tabloya INSERT/UPDATE/DELETE grant’i YOKTUR.
  assert(
    !/grant[^;]*\b(insert|update|delete)\b[^;]*on table public\.friend_messages/i.test(sqlCode),
    'istemciye doğrudan yazma yetkisi verilmiş',
  );

  // Append-only: UPDATE yapısal olarak engellenir.
  assert(
    sqlCode.includes('create trigger friend_messages_no_update') &&
      sqlCode.includes("raise exception 'friend_messages_append_only'"),
    'append-only koruması yok',
  );
});

check('27. SECURITY DEFINER fonksiyonlarında boş `search_path` vardır', () => {
  const definers = [...sqlCode.matchAll(/create or replace function (public\.\w+)/g)].map(
    (match) => match[1],
  );
  assertDeepEqual(
    definers.sort(),
    [
      'public.friend_messages_block_update',
      'public.get_friend_messages',
      'public.list_friend_conversations',
      'public.send_friend_message',
    ],
    'beklenmeyen fonksiyon kümesi',
  );

  for (const name of definers) {
    const body = sqlCode.slice(sqlCode.indexOf(`create or replace function ${name}`));
    const head = body.slice(0, body.indexOf('as $$'));
    assert(head.includes("set search_path = ''"), `boş search_path yok: ${name}`);
  }

  // Üç RPC de security definer ve yalnızca authenticated’a açık.
  for (const signature of [
    'public.send_friend_message(uuid, text, uuid)',
    'public.get_friend_messages(uuid, timestamptz, uuid, integer)',
    'public.list_friend_conversations()',
  ]) {
    assert(sqlCode.includes(`revoke all on function ${signature} from public;`), `revoke yok: ${signature}`);
    assert(
      sqlCode.includes(`grant execute on function ${signature} to authenticated;`),
      `grant yok: ${signature}`,
    );
  }
  assertEqual(
    (sqlCode.match(/security definer/g) ?? []).length,
    3,
    'security definer sayısı beklenenden farklı',
  );
});

check('28. Mesaj tablosu BAŞKA alanlara erişim açmaz', () => {
  const forbidden = [
    'workout_sessions',
    'workout_sets',
    'program_days',
    'program_exercises',
    'manual_discipline_statuses',
    'shared_discipline_days',
    'discipline_day_history',
    'rank_seasons',
    'rank_events',
    'season_achievements',
    'rewards',
    'reward_ledger',
    'roses',
    'ai_requests',
    'ai_coach_messages',
    'summary_requests',
  ];
  for (const table of forbidden) {
    assert(!sqlCode.includes(table), `migration kapsam dışı tabloya dokunuyor: ${table}`);
  }

  // Yalnızca beklenen tablolara referans verilir.
  const referenced = new Set(
    [...sqlCode.matchAll(/\b(?:from|join|into|update|table)\s+(public\.\w+)/g)].map(
      (match) => match[1],
    ),
  );
  assertDeepEqual(
    [...referenced].sort(),
    ['public.friend_messages', 'public.friendships', 'public.profiles'],
    'beklenmeyen tablo referansı',
  );

  // `profiles` yalnızca GÜVENLİ özet alanları için okunur.
  for (const field of ['bio', 'banner_url', 'training_goal', 'email', 'level', 'xp']) {
    assert(!new RegExp(`p\\.${field}\\b`).test(sqlCode), `özel profil alanı dönüyor: ${field}`);
  }
  // auth.users yalnızca FK olarak kullanılır; hiçbir sorgu ondan okumaz.
  assertEqual(
    (sqlCode.match(/auth\.users/g) ?? []).length,
    2,
    'auth.users yalnızca iki foreign key’de kullanılmalı',
  );
  assert(!/from auth\.users/i.test(sqlCode), 'auth.users tablosundan okuma yapılıyor');

  // Mevcut `list_friends` davranışı değişmez.
  assert(!sqlCode.includes('list_friends'), 'mevcut list_friends fonksiyonuna dokunulmuş');
});

check('29. Migration yeniden çalıştırılabilir', () => {
  assert(sqlCode.includes('create table if not exists public.friend_messages'), 'tablo idempotent değil');
  const indexes = [...sqlCode.matchAll(/create (?:unique )?index (\w+)/g)].map((match) => match[1]);
  assert(indexes.length >= 4, 'beklenen indeksler eksik');
  for (const statement of sqlCode.match(/create (?:unique )?index[^;]*/g) ?? []) {
    assert(statement.includes('if not exists'), `indeks idempotent değil: ${statement.slice(0, 60)}`);
  }
  assert(
    sqlCode.includes('drop policy if exists "friend_messages_select_involved_friends"'),
    'politika idempotent değil',
  );
  assert(
    sqlCode.includes('drop trigger if exists friend_messages_no_update'),
    'trigger idempotent değil',
  );
  // Fonksiyonların hepsi create or replace.
  assertEqual(
    (sqlCode.match(/create function/g) ?? []).length,
    0,
    'replace edilmeyen fonksiyon var',
  );
  // Publication ve cron üyelik/ad kontrollü.
  assert(sqlCode.includes('from pg_catalog.pg_publication_tables'), 'publication üyeliği kontrol edilmiyor');
  assert(sqlCode.includes("where jobname = 'cleanup-expired-friend-messages'"), 'cron ada göre temizlenmiyor');
  // Tek transaction.
  assert(sqlCode.trimStart().startsWith('begin;'), 'migration transaction içinde değil');
  assert(sqlCode.trimEnd().endsWith('commit;'), 'migration commit ile bitmiyor');
});

check('30. Servis ve tipler güvenli sözleşmeyi taşır', () => {
  // Bütün Supabase çağrıları servis katmanında.
  for (const rpc of ['send_friend_message', 'get_friend_messages', 'list_friend_conversations']) {
    assert(serviceSource.includes(`supabase.rpc('${rpc}'`), `servis ${rpc} çağırmıyor`);
  }
  assert(!/\.from\(/.test(serviceSource), 'servis tabloya doğrudan erişiyor');

  // Bozuk satırlar güvenilir veri sayılmaz.
  assert(serviceSource.includes('UUID_PATTERN'), 'UUID doğrulaması yok');
  assert(serviceSource.includes('Number.isFinite(Date.parse(value))'), 'zaman damgası doğrulaması yok');
  assert(
    serviceSource.includes("throw new Error('invalid_send_response')"),
    'okunamayan gönderme cevabı başarı sayılıyor',
  );

  // camelCase dönüşüm ve `expiresAt` sözleşmesi.
  assert(typesSource.includes('expiresAt: string;'), 'FriendMessage tipinde expiresAt yok');
  for (const field of ['senderId', 'recipientId', 'clientMessageId', 'createdAt']) {
    assert(typesSource.includes(`${field}:`), `FriendMessage tipinde ${field} yok`);
  }
  assert(typesSource.includes('FriendConversationSummary'), 'konuşma özeti tipi yok');
  assert(typesSource.includes('FriendMessagePage'), 'sayfa tipi yok');
  assert(typesSource.includes('FriendMessageSendResult'), 'gönderme sonucu tipi yok');

  // Mevcut arkadaşlık servisi bozulmadı ve mesajlaşma oraya sıkıştırılmadı.
  const friendsService = source('services/friends.ts');
  assert(!friendsService.includes('friend_message'), 'mesajlaşma arkadaşlık servisine sıkıştırılmış');

  // Yeni paket eklenmedi.
  const pkg = JSON.parse(source('package.json'));
  assert(!('uuid' in pkg.dependencies), 'yeni paket eklenmiş');
  const imported = [...serviceSource.matchAll(/from '([^']+)';/g)].map((match) => match[1]);
  assertDeepEqual(
    imported.sort(),
    ['@/lib/supabase', '@/types/messages'],
    'servis beklenmeyen bir modül import ediyor',
  );
});

// ---------------------------------------------------------------------------
// 9 · Idempotency anahtarı uyuşmazlığı ve atomik cursor
// ---------------------------------------------------------------------------

check('31. Aynı anahtar + aynı alıcı + AYNI içerik → tek kayıt, mevcut mesaj', () => {
  const server = createServer();
  seed(server);
  const cid = clientId();

  const first = sendMessage(server, ALICE, BOB, 'selam', cid);
  const retry = sendMessage(server, ALICE, BOB, 'selam', cid);

  assertEqual(server.messages.length, 1, 'gerçek retry ikinci satır oluşturdu');
  assertEqual(retry.id, first.id, 'retry mevcut mesajı döndürmedi');
  assertEqual(retry.created_at, first.created_at, 'retry oluşturulma anını değiştirdi');
  assertEqual(retry.expires_at, first.expires_at, 'retry mesaj ömrünü değiştirdi');
});

check('32. BOŞLUK farkıyla aynı normalize içerik retry sayılır', () => {
  const server = createServer();
  seed(server);
  const cid = clientId();

  const first = sendMessage(server, ALICE, BOB, 'selam', cid);
  // Sunucu içeriği kırpılmış sakladığı için " selam " aynı içeriktir.
  for (const variant of [' selam ', '  selam', 'selam\n', '\t selam \n']) {
    const retry = sendMessage(server, ALICE, BOB, variant, cid);
    assertEqual(retry.id, first.id, `boşluk farkı conflict üretti: ${JSON.stringify(variant)}`);
  }
  assertEqual(server.messages.length, 1, 'boşluk farkı yeni satır oluşturdu');
  assertEqual(first.expires_at, server.messages[0].expires_at, 'ömür değişti');
});

check('33. Aynı anahtar + aynı alıcı + FARKLI içerik → conflict, ilk kayıt kalır', () => {
  const server = createServer();
  seed(server);
  const cid = clientId();

  const first = sendMessage(server, ALICE, BOB, 'ilk mesaj', cid);
  assertRejects(
    () => sendMessage(server, ALICE, BOB, 'ikinci mesaj', cid),
    'client_message_id_conflict',
    'farklı içerik sessizce kabul edildi',
  );

  assertEqual(server.messages.length, 1, 'conflict sonrası ikinci satır yazıldı');
  assertEqual(server.messages[0].id, first.id, 'ilk kayıt korunmadı');
  assertEqual(server.messages[0].content, 'ilk mesaj', 'ilk kaydın içeriği değişti');
  assertEqual(server.messages[0].expires_at, first.expires_at, 'conflict ömrü değiştirdi');

  // Farklı ALICI da aynı biçimde reddedilir.
  addFriendship(server, ALICE, CAROL, 'accepted');
  assertRejects(
    () => sendMessage(server, ALICE, CAROL, 'ilk mesaj', cid),
    'client_message_id_conflict',
    'farklı alıcı sessizce kabul edildi',
  );
  assertEqual(server.messages.length, 1, 'farklı alıcı ikinci satır yazdı');
});

check('34. EŞZAMANLI aynı anahtar + farklı içerik → biri yazılır, diğeri conflict', () => {
  const server = createServer();
  seed(server);
  const cid = clientId();

  const results = sendConcurrentWithContents(server, ALICE, BOB, ['a icerigi', 'b icerigi'], cid);

  const written = results.filter((result) => result.ok);
  const rejected = results.filter((result) => !result.ok);
  assertEqual(written.length, 1, 'eşzamanlı farklı içerikte tek yazma olmalı');
  assertEqual(rejected.length, 1, 'ikinci çağrı conflict almalı');
  assertEqual(rejected[0].error, 'client_message_id_conflict', 'beklenen hata gelmedi');
  assertEqual(server.messages.length, 1, 'eşzamanlı farklı içerik iki satır yazdı');
  assertEqual(server.messages[0].content, written[0].value.content, 'yazılan içerik tutarsız');

  // Eşzamanlı AYNI içerik ise iki tarafa da mevcut mesajı döndürür.
  const same = createServer();
  seed(same);
  const sameCid = clientId();
  const sameResults = sendConcurrentWithContents(same, ALICE, BOB, ['ayni', 'ayni'], sameCid);
  assert(sameResults.every((result) => result.ok), 'aynı içerikte conflict üretildi');
  assertEqual(same.messages.length, 1, 'aynı içerikte iki satır yazıldı');
});

check('35. `unique_violation` telafi yolunda farklı içerik kabul EDİLMEZ', () => {
  const server = createServer();
  seed(server);
  const cid = clientId();
  const first = sendMessage(server, ALICE, BOB, 'ilk', cid);

  /**
   * Kilit sonrası kontrolü atlayan çağrı doğrudan INSERT dener ve unique
   * indekse takılır; telafi yolunda okunan satır AYNI kontrolden geçer.
   */
  assertRejects(
    () =>
      sendMessage(server, ALICE, BOB, 'baska', cid, {
        preLockSnapshotMiss: true,
        recheckAfterLock: false,
      }),
    'client_message_id_conflict',
    'telafi yolunda farklı içerik sessizce kabul edildi',
  );
  assertEqual(server.messages.length, 1, 'telafi yolu ikinci satır yazdı');

  // Aynı içerik telafi yolunda da retry sayılır.
  const retry = sendMessage(server, ALICE, BOB, 'ilk', cid, {
    preLockSnapshotMiss: true,
    recheckAfterLock: false,
  });
  assertEqual(retry.id, first.id, 'telafi yolunda gerçek retry reddedildi');

  // SQL: satır bulunamazsa boş satır dönmez, özgün hata yeniden fırlatılır.
  const handler = sqlCode.slice(sqlCode.indexOf('when unique_violation then'));
  assert(handler.includes('if not found then\n        raise;'), 'özgün hata yeniden fırlatılmıyor');
  assert(
    handler.indexOf('raise;') < handler.indexOf('client_message_id_conflict'),
    'telafi yolunda bulunamayan satır kontrolü uyuşmazlık kontrolünden sonra',
  );
  // Üç yolda da uyuşmazlık kontrolü var.
  assertEqual(
    (sqlCode.match(/btrim\(\w+\.content\) is distinct from trimmed/g) ?? []).length,
    3,
    'içerik uyuşmazlığı kontrolü üç yolun tamamında değil',
  );
  assertEqual(
    (sqlCode.match(/client_message_id_conflict/g) ?? []).length,
    3,
    'conflict hatası üç yolda birden fırlatılmıyor',
  );
});

check('36. YARIM cursor reddedilir, TAM cursor çalışır', () => {
  const server = createServer();
  seed(server);
  for (let index = 0; index < 3; index += 1) {
    sendMessage(server, ALICE, BOB, `mesaj-${index}`, clientId());
  }
  const anchorRow = server.messages[2];

  // Yalnızca timestamp.
  assertRejects(
    () => getMessages(server, ALICE, BOB, { beforeCreatedAt: anchorRow.created_at }),
    'invalid_cursor',
    'yalnızca timestamp içeren cursor kabul edildi',
  );
  // Yalnızca id.
  assertRejects(
    () => getMessages(server, ALICE, BOB, { beforeId: anchorRow.id }),
    'invalid_cursor',
    'yalnızca id içeren cursor kabul edildi',
  );
  // İkisi de null → ilk sayfa.
  assertEqual(getMessages(server, ALICE, BOB, {}).length, 3, 'ilk sayfa dönmedi');
  // İkisi de dolu → keyset.
  const page = getMessages(server, ALICE, BOB, {
    beforeCreatedAt: anchorRow.created_at,
    beforeId: anchorRow.id,
  });
  assert(page.every((row) => row.id < anchorRow.id), 'keyset cursor yanlış filtreledi');

  // SQLSTATE 22023 ile kontrollü hata.
  const body = sqlCode.slice(sqlCode.indexOf('create or replace function public.get_friend_messages'));
  assert(
    body.includes("raise exception 'invalid_cursor' using errcode = '22023'"),
    'invalid_cursor kontrollü SQLSTATE ile fırlatılmıyor',
  );
});

check('37. Servis bozuk cursor’ı RPC’den ÖNCE reddeder', () => {
  const valid = { beforeCreatedAt: '2026-09-02T12:00:00.000Z', beforeId: uuid(7) };
  validateServiceCursor(valid);
  validateServiceCursor(undefined);

  for (const [label, cursor] of [
    ['yalnızca timestamp', { beforeCreatedAt: valid.beforeCreatedAt }],
    ['yalnızca id', { beforeId: valid.beforeId }],
    ['bozuk timestamp', { beforeCreatedAt: 'dun-aksam', beforeId: valid.beforeId }],
    ['boş timestamp', { beforeCreatedAt: '   ', beforeId: valid.beforeId }],
    ['bozuk uuid', { beforeCreatedAt: valid.beforeCreatedAt, beforeId: 'not-a-uuid' }],
    ['sayısal id', { beforeCreatedAt: valid.beforeCreatedAt, beforeId: 42 }],
    ['boş nesne', {}],
  ]) {
    assertRejects(
      () => validateServiceCursor(cursor),
      'invalid_cursor',
      `servis bozuk cursor’ı kabul etti: ${label}`,
    );
  }

  // Doğrulama gerçekten RPC ÇAĞRISINDAN ÖNCE yapılır.
  const fn = serviceSource.slice(
    serviceSource.indexOf('export async function getFriendMessages('),
    serviceSource.indexOf('export async function listFriendConversations('),
  );
  const throwAt = fn.indexOf("throw new Error('invalid_cursor')");
  const rpcAt = fn.indexOf("supabase.rpc('get_friend_messages'");
  assert(throwAt > 0 && rpcAt > 0, 'servis fonksiyonu beklenen yapıda değil');
  assert(throwAt < rpcAt, 'cursor doğrulaması RPC çağrısından sonra yapılıyor');
  assert(
    fn.includes('parseTimestamp(cursor.beforeCreatedAt)') && fn.includes('parseUuid(cursor.beforeId)'),
    'servis cursor alanlarını doğrulamıyor',
  );
});

check('38. TAM cursor aynı timestamp’te hiçbir kaydı atlamaz', () => {
  const server = createServer();
  seed(server);
  // ALTI mesaj, hepsi AYNI `created_at` değerinde.
  for (let index = 0; index < 6; index += 1) {
    sendMessage(server, ALICE, BOB, `es-zamanli-${index}`, clientId());
  }
  assertEqual(
    new Set(server.messages.map((m) => m.created_at)).size,
    1,
    'senaryo kurulumu: bütün mesajlar aynı anda olmalı',
  );

  const seen = [];
  let cursor = { pageSize: 2 };
  for (let page = 0; page < 10; page += 1) {
    const rows = getMessages(server, ALICE, BOB, cursor);
    if (rows.length === 0) break;
    seen.push(...rows.map((row) => row.id));
    const last = rows[rows.length - 1];
    // Sayfa sonu HER ZAMAN tam bir cursor üretir.
    cursor = { beforeCreatedAt: last.created_at, beforeId: last.id, pageSize: 2 };
    validateServiceCursor({ beforeCreatedAt: '2026-09-02T12:00:00.000Z', beforeId: last.id });
  }

  assertEqual(seen.length, 6, 'sayfalama satır atladı');
  assertEqual(new Set(seen).size, 6, 'sayfalama satır çoğalttı');
  assertDeepEqual(
    seen,
    server.messages.map((m) => m.id).sort().reverse(),
    'sayfa sırası kararlı değil',
  );
});

// ---------------------------------------------------------------------------
// 8 · MUTASYON TESTLERİ
// ---------------------------------------------------------------------------

check('M1. ARKADAŞLIK kontrolü kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  seed(server);

  // Kontrolsüz model yabancıya mesaj yazar.
  const leaked = sendMessage(server, ALICE, DAVE, 'sizinti', clientId(), {
    requireFriendship: false,
  });
  assertEqual(leaked.recipient_id, DAVE, 'kontrolsüz model gerçekten yazmalı');
  assertEqual(server.messages.length, 1, 'kontrolsüz model gerçekten satır yazmalı');
  assertThrows(
    () => assertEqual(server.messages.length, 0, 'mutation'),
    'arkadaşlık guard’ı olmadan da geçti — gönderme sızıntısı yakalanmıyor',
  );

  // Okuma tarafı da aynı guard’a bağlıdır.
  const readable = getMessages(server, ALICE, DAVE, {}, { requireFriendship: false });
  assertEqual(readable.length, 1, 'kontrolsüz model gerçekten okumalı');
  assertThrows(
    () => assertEqual(readable.length, 0, 'mutation'),
    'arkadaşlık guard’ı olmadan okuma da geçti',
  );

  // Doğru model her iki yolu da kapatır.
  const clean = createServer();
  seed(clean);
  assertRejects(
    () => sendMessage(clean, ALICE, DAVE, 'x', clientId()),
    'not_friends',
    'doğru model yabancıya yazdı',
  );
  assertEqual(getMessages(clean, ALICE, DAVE).length, 0, 'doğru model yabancıyı okuttu');
});

check('M2. Doğrudan INSERT grant’i verilirse test DÜŞER', () => {
  /** Kasıtlı hata: tabloya doğrudan yazma yetkisi verilmiş migration. */
  const brokenSql = `${sqlCode}\ngrant insert on table public.friend_messages to authenticated;`;

  const hasWriteGrant = (text) =>
    /grant[^;]*\b(insert|update|delete)\b[^;]*on table public\.friend_messages/i.test(text);

  assertEqual(hasWriteGrant(brokenSql), true, 'bozuk model gerçekten yazma yetkisi vermeli');
  assertThrows(
    () => assert(!hasWriteGrant(brokenSql), 'mutation'),
    'doğrudan INSERT grant’i testten geçti',
  );
  assertEqual(hasWriteGrant(sqlCode), false, 'gerçek migration yazma yetkisi veriyor');

  // Doğrudan yazma açılsaydı gönderen kimliği istemciden gelebilirdi.
  assert(
    sqlCode.includes('actor uuid := (select auth.uid());') &&
      sqlCode.includes('values (actor, target_user_id, trimmed, send_friend_message.client_message_id)'),
    'gönderen kimliği auth.uid() üzerinden belirlenmiyor',
  );
});

check('M3. Cursor’da yalnızca timestamp kullanılırsa test DÜŞER', () => {
  const server = createServer();
  seed(server);
  for (let index = 0; index < 4; index += 1) {
    sendMessage(server, ALICE, BOB, `es-zamanli-${index}`, clientId());
  }

  /** Kasıtlı hata: KALDIRILAN timestamp-only fallback geri gelmiş. */
  const brokenSeen = [];
  let brokenCursor = { pageSize: 2 };
  for (let page = 0; page < 4; page += 1) {
    const rows = getMessages(server, ALICE, BOB, brokenCursor, {
      legacyTimestampOnlyCursor: true,
    });
    if (rows.length === 0) break;
    brokenSeen.push(...rows.map((row) => row.id));
    const last = rows[rows.length - 1];
    // Eski yol `id` taşımayan yarım bir cursor üretirdi.
    brokenCursor = { beforeCreatedAt: last.created_at, pageSize: 2 };
  }

  // Aynı zaman damgasındaki kalan mesajlar TAMAMEN atlandı.
  assertEqual(brokenSeen.length, 2, 'bozuk cursor gerçekten satır atlamalı');
  assertThrows(
    () => assertEqual(brokenSeen.length, 4, 'mutation'),
    'yalnızca timestamp kullanan cursor testten geçti — atlanan satır yakalanmıyor',
  );

  // Doğru model dört satırın hepsini tam bir kez döndürür.
  const seen = [];
  let cursor = { pageSize: 2 };
  for (let page = 0; page < 4; page += 1) {
    const rows = getMessages(server, ALICE, BOB, cursor);
    if (rows.length === 0) break;
    seen.push(...rows.map((row) => row.id));
    const last = rows[rows.length - 1];
    cursor = { beforeCreatedAt: last.created_at, beforeId: last.id, pageSize: 2 };
  }
  assertEqual(seen.length, 4, 'doğru model satır atladı');
  assertEqual(new Set(seen).size, 4, 'doğru model satır çoğalttı');

  // SQL gerçekten ikili karşılaştırma kullanır ve fallback KALDIRILMIŞTIR.
  assert(
    sqlCode.includes('(m.created_at, m.id) < (before_created_at, before_id)'),
    'SQL cursor ikili karşılaştırma kullanmıyor',
  );
  assert(sqlCode.includes('order by m.created_at desc, m.id desc'), 'kararlı sıra yok');
  assert(
    !/when before_id is null then m\.created_at </.test(sqlCode),
    'timestamp-only cursor fallback’i hâlâ duruyor',
  );
  assert(
    sqlCode.includes('if (before_created_at is null) <> (before_id is null) then'),
    'SQL yarım cursor’ı reddetmiyor',
  );
});

check('M5. İÇERİK uyuşmazlığı kontrolü kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  seed(server);
  const cid = clientId();
  const first = sendMessage(server, ALICE, BOB, 'ilk icerik', cid);

  /** Kasıtlı hata: yalnızca alıcı karşılaştırılıyor, içerik göz ardı ediliyor. */
  const brokenResult = sendMessage(server, ALICE, BOB, 'TAMAMEN BASKA icerik', cid, {
    skipContentCheck: true,
  });
  assertEqual(brokenResult.id, first.id, 'kontrolsüz model gerçekten ilk mesajı döndürmeli');
  assertEqual(
    brokenResult.content,
    'ilk icerik',
    'kontrolsüz model gerçekten yanlış içeriği başarı sayar',
  );
  assertThrows(
    () => assertRejects(
      () => sendMessage(server, ALICE, BOB, 'TAMAMEN BASKA icerik', cid, { skipContentCheck: true }),
      'client_message_id_conflict',
      'mutation',
    ),
    'içerik kontrolü olmadan da geçti — sessiz kabul yakalanmıyor',
  );

  // Doğru model üç yolun da uyuşmazlığı reddettiğini gösterir.
  for (const pathOptions of [
    {},
    { preLockSnapshotMiss: true },
    { preLockSnapshotMiss: true, recheckAfterLock: false },
  ]) {
    assertRejects(
      () => sendMessage(server, ALICE, BOB, 'farkli', cid, pathOptions),
      'client_message_id_conflict',
      `doğru model uyuşmazlığı kabul etti: ${JSON.stringify(pathOptions)}`,
    );
  }
  assertEqual(server.messages.length, 1, 'uyuşmazlık ikinci satır yazdı');
});

check('M4. Idempotency unique indeksi kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  seed(server);
  const cid = clientId();

  /** Kasıtlı hata: unique indeks YOK ve kilit sonrası kontrol de yok. */
  sendConcurrent(server, ALICE, BOB, 'selam', cid, {
    enforceIdempotencyIndex: false,
    recheckAfterLock: false,
  });
  assertEqual(server.messages.length, 2, 'indekssiz model gerçekten kopya üretmeli');
  assertThrows(
    () => assertEqual(server.messages.length, 1, 'mutation'),
    'unique indeks olmadan da geçti — kopya mesaj yakalanmıyor',
  );

  // Doğru model tek satır üretir.
  const clean = createServer();
  seed(clean);
  sendConcurrent(clean, ALICE, BOB, 'selam', clientId());
  assertEqual(clean.messages.length, 1, 'doğru model kopya üretti');

  // İndeks migration’da gerçekten var.
  assert(
    sqlCode.includes(
      'create unique index if not exists friend_messages_sender_client_idx\non public.friend_messages (sender_id, client_message_id);',
    ),
    'idempotency unique indeksi migration’da yok',
  );
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Arkadaş mesajlaşması harness: ${passed} kontrol geçti.`);
console.log('  (Canlı Postgres yok — SQL çalıştırılmadı, modellendi ve statik denetlendi.)');
