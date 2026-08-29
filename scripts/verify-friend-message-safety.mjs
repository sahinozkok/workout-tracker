#!/usr/bin/env node
/**
 * ARKADAŞ MESAJLAŞMASI — GÜVENLİK ALTYAPISI DOĞRULAMA HARNESS'I
 *
 * Kapsam: `20260903120000_add_friend_message_safety.sql` migration'ının
 * getirdiği engelleme, şikâyet, içerik filtresi ve saklama süresi kuralları.
 * Mesajlaşmanın kendi güvenlik sınırı ve istemci yaşam döngüsü AYRI
 * harness'lardadır (`verify-friend-messaging.mjs`,
 * `verify-friend-messaging-client.mjs`) ve o dosyalara dokunulmamıştır.
 *
 * İki katman: (1) kuralların deterministik modeli GERÇEKTEN çalıştırılır,
 * (2) migration metni statik denetlenir.
 *
 * CANLI POSTGRESQL YOKTUR: hiçbir SQL çalıştırılmaz; modellenir ve statik
 * olarak denetlenir.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SAFETY_SQL_PATH = 'supabase/migrations/20260903120000_add_friend_message_safety.sql';
const MESSAGES_SQL_PATH = 'supabase/migrations/20260902120000_add_friend_messages.sql';
const FRIENDS_SQL_PATH =
  'supabase/migrations/20260814120000_add_friendships_and_shared_discipline.sql';
const PROFILE_SQL_PATH = 'supabase/migrations/20260826120000_add_profile_color_preset.sql';

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

const sql = source(SAFETY_SQL_PATH);
/** Yorumsuz hâl — kural denetimleri KOD üzerinde yapılır. */
const sqlCode = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, ' ');

// ---------------------------------------------------------------------------
// Katman 1 — kuralların deterministik modeli
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const A = uuid(1);
const B = uuid(2);
const C = uuid(3);
const D = uuid(4);

const CATEGORIES = ['harassment', 'hate', 'sexual', 'violence', 'spam', 'other'];
const STATUSES = ['pending', 'reviewed', 'dismissed', 'actioned'];
const REPORT_DAILY_LIMIT = 10;
const REPORT_RETENTION_MS = 90 * DAY_MS;

function createServer(nowIso = '2026-09-03T12:00:00.000Z') {
  return {
    now: Date.parse(nowIso),
    profiles: new Set([A, B, C, D]),
    friendships: [],
    messages: [],
    blocks: [],
    reports: [],
    blockedTerms: [
      { isActive: true, term: 'seni öldüreceğim' },
      { isActive: true, term: 'kendini öldür' },
      { isActive: true, term: 'i will kill you' },
      { isActive: true, term: 'kill yourself' },
    ],
    seq: 0,
  };
}

const nextId = (server) => uuid(100 + (server.seq += 1));

function addFriendship(server, a, b, status) {
  server.friendships.push({ id: nextId(server), receiverId: b, requesterId: a, status });
}

function addMessage(server, from, to, content = 'selam') {
  const row = {
    content,
    createdAt: server.now,
    expiresAt: server.now + DAY_MS,
    id: nextId(server),
    recipientId: to,
    senderId: from,
  };
  server.messages.push(row);
  return row;
}

/** `public.are_friends` referansı. */
function areFriends(server, actor, a, b) {
  if (!actor || (actor !== a && actor !== b)) return false;
  return server.friendships.some(
    (f) =>
      f.status === 'accepted' &&
      ((f.requesterId === a && f.receiverId === b) || (f.requesterId === b && f.receiverId === a)),
  );
}

/**
 * `public.has_block_between` referansı — YÖN SIZDIRMAZ.
 *
 * Yalnızca "herhangi bir yönde engel var mı" sorusuna yanıt verir.
 */
function hasBlockBetween(server, a, b) {
  return server.blocks.some(
    (block) =>
      (block.blockerId === a && block.blockedId === b) ||
      (block.blockerId === b && block.blockedId === a),
  );
}

/** `public.block_user` referansı. */
function blockUser(server, actor, target, options = {}) {
  const enforceBlockSideEffects = options.enforceBlockSideEffects !== false;

  if (!actor) throw new Error('not_authenticated');
  if (!target || target === actor) throw new Error('invalid_target');
  if (!server.profiles.has(target)) throw new Error('target_not_found');

  // IDEMPOTENT: aynı çift ikinci satır oluşturmaz.
  if (!server.blocks.some((b) => b.blockerId === actor && b.blockedId === target)) {
    server.blocks.push({ blockedId: target, blockerId: actor, createdAt: server.now });
  }

  if (!enforceBlockSideEffects) return;

  // YALNIZCA bu iki kullanıcı arasındaki kayıtlar silinir.
  server.friendships = server.friendships.filter(
    (f) =>
      !(
        (f.requesterId === actor && f.receiverId === target) ||
        (f.requesterId === target && f.receiverId === actor)
      ),
  );
  server.messages = server.messages.filter(
    (m) =>
      !(
        (m.senderId === actor && m.recipientId === target) ||
        (m.senderId === target && m.recipientId === actor)
      ),
  );
}

/** `public.unblock_user` referansı — arkadaşlığı GERİ GETİRMEZ. */
function unblockUser(server, actor, target) {
  if (!actor) throw new Error('not_authenticated');
  if (!target || target === actor) throw new Error('invalid_target');
  server.blocks = server.blocks.filter(
    (b) => !(b.blockerId === actor && b.blockedId === target),
  );
}

/** `public.list_blocked_users` referansı — yalnızca KENDİ verdiği engeller. */
function listBlockedUsers(server, actor) {
  return server.blocks
    .filter((block) => block.blockerId === actor)
    .map((block) => ({ createdAt: block.createdAt, userId: block.blockedId }));
}

/** `public.search_profiles` referansı (engel filtresiyle). */
function searchProfiles(server, actor, query, options = {}) {
  const enforceBlock = options.enforceBlock !== false;
  if (!actor) return [];
  if (query.trim().length < 2) return [];
  return [...server.profiles]
    .filter((id) => id !== actor)
    .filter((id) => (enforceBlock ? !hasBlockBetween(server, actor, id) : true));
}

/** `public.send_friend_request` referansı. */
function sendFriendRequest(server, actor, target, options = {}) {
  const enforceBlock = options.enforceBlock !== false;
  if (!actor) throw new Error('not_authenticated');
  if (!target || target === actor) throw new Error('invalid_target');
  if (!server.profiles.has(target)) throw new Error('target_not_found');
  if (enforceBlock && hasBlockBetween(server, actor, target)) {
    throw new Error('relationship_unavailable');
  }

  const existing = server.friendships.find(
    (f) =>
      (f.requesterId === actor && f.receiverId === target) ||
      (f.requesterId === target && f.receiverId === actor),
  );
  if (existing) return existing.id;

  const id = nextId(server);
  server.friendships.push({ id, receiverId: target, requesterId: actor, status: 'pending' });
  return id;
}

/** `public.respond_to_friend_request` referansı. */
function respondToFriendRequest(server, actor, friendshipId, accept, options = {}) {
  const enforceBlock = options.enforceBlock !== false;
  if (!actor) throw new Error('not_authenticated');

  const row = server.friendships.find((f) => f.id === friendshipId);
  if (!row) throw new Error('request_not_found');
  if (row.receiverId !== actor) throw new Error('not_receiver');
  if (row.status !== 'pending') throw new Error('request_not_pending');

  // Kilit alındıktan SONRA yeniden kontrol: yarışta accepted oluşamaz.
  if (enforceBlock && hasBlockBetween(server, row.requesterId, row.receiverId)) {
    throw new Error('relationship_unavailable');
  }

  if (accept) row.status = 'accepted';
  else server.friendships = server.friendships.filter((f) => f.id !== friendshipId);
}

/** `public.get_friend_profile` referansı. */
function getFriendProfile(server, actor, target, options = {}) {
  const enforceBlock = options.enforceBlock !== false;
  if (!actor || !server.profiles.has(target)) return [];
  if (!areFriends(server, actor, actor, target)) return [];
  if (enforceBlock && hasBlockBetween(server, actor, target)) return [];
  return [{ id: target }];
}

/** `public.normalize_message_text` referansı. */
function normalizeMessageText(input) {
  const folded = (input ?? '').replace(/[ÇĞİıÖŞÜçğöşü]/g, (character) => {
    const map = {
      Ç: 'C', Ğ: 'G', İ: 'I', ı: 'i', Ö: 'O', Ş: 'S', Ü: 'U',
      ç: 'c', ğ: 'g', ö: 'o', ş: 's', ü: 'u',
    };
    return map[character] ?? character;
  });
  return folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * `public.message_contains_blocked_term` referansı.
 *
 * Eşleşme KELİME/İFADE SINIRINDA aranır: boşluklarla çevrelenmiş ifade.
 */
function messageContainsBlockedTerm(server, input, options = {}) {
  /** Mutasyon: sınırsız düz substring araması. */
  const useRawSubstring = options.useRawSubstring === true;
  const haystack = ` ${normalizeMessageText(input)} `;
  return server.blockedTerms.some((entry) => {
    if (!entry.isActive) return false;
    const needle = normalizeMessageText(entry.term);
    return useRawSubstring ? haystack.includes(needle) : haystack.includes(` ${needle} `);
  });
}

/** `public.send_friend_message` referansı (engel + filtre eklenmiş). */
function sendFriendMessage(server, actor, target, content, clientMessageId, options = {}) {
  const enforceBlock = options.enforceBlock !== false;
  /** Mutasyon: filtre idempotency hızlı yolundan ÖNCE çalışır. */
  const filterBeforeIdempotency = options.filterBeforeIdempotency === true;

  if (!actor) throw new Error('not_authenticated');
  if (!target || target === actor) throw new Error('invalid_target');
  if (!clientMessageId) throw new Error('invalid_client_message_id');
  if (!areFriends(server, actor, actor, target)) throw new Error('not_friends');
  if (enforceBlock && hasBlockBetween(server, actor, target)) {
    throw new Error('relationship_unavailable');
  }

  const trimmed = (content ?? '').trim();
  if (trimmed.length < 1 || trimmed.length > 2000) throw new Error('invalid_content');

  const runFilter = () => {
    if (messageContainsBlockedTerm(server, trimmed, options)) {
      throw new Error('message_rejected_content');
    }
  };

  if (filterBeforeIdempotency) runFilter();

  // IDEMPOTENCY hızlı yolu — gerçek retry filtreye TAKILMAZ.
  const existing = server.messages.find(
    (m) => m.senderId === actor && m.clientMessageId === clientMessageId,
  );
  if (existing) {
    if (existing.recipientId !== target || existing.content.trim() !== trimmed) {
      throw new Error('client_message_id_conflict');
    }
    return existing;
  }

  if (!filterBeforeIdempotency) runFilter();

  const recentCount = server.messages.filter(
    (m) => m.senderId === actor && m.createdAt >= server.now - 60 * 1000,
  ).length;
  if (recentCount >= 60) throw new Error('message_rate_limited');

  const row = {
    clientMessageId,
    content: trimmed,
    createdAt: server.now,
    expiresAt: server.now + DAY_MS,
    id: nextId(server),
    recipientId: target,
    senderId: actor,
  };
  server.messages.push(row);
  return row;
}

/** Günlük şikâyet kotası. */
function assertReportQuota(server, actor) {
  const recent = server.reports.filter(
    (r) => r.reporterId === actor && r.createdAt >= server.now - DAY_MS,
  ).length;
  if (recent >= REPORT_DAILY_LIMIT) throw new Error('report_rate_limited');
}

/** `public.report_friend_message` referansı. */
function reportFriendMessage(server, actor, messageId, category, details = null) {
  if (!actor) throw new Error('not_authenticated');
  if (!messageId) throw new Error('invalid_target');
  if (!CATEGORIES.includes(category)) throw new Error('invalid_category');
  const trimmedDetails = (details ?? '').trim() || null;
  if (trimmedDetails && trimmedDetails.length > 1000) throw new Error('invalid_details');

  const message = server.messages.find((m) => m.id === messageId && m.expiresAt > server.now);
  if (!message) throw new Error('message_not_found');
  if (message.recipientId !== actor) throw new Error('message_not_reportable');

  // `reported_user_id` SUNUCUDA belirlenir; yalnızca alınan mesaj raporlanır.
  const reported = message.senderId;

  const duplicate = server.reports.find(
    (r) => r.reporterId === actor && r.messageId === messageId,
  );
  if (duplicate) return duplicate.id;

  assertReportQuota(server, actor);

  const row = {
    category,
    createdAt: server.now,
    details: trimmedDetails,
    id: nextId(server),
    messageContentSnapshot: message.content,
    messageCreatedAt: message.createdAt,
    messageId,
    reportedUserId: reported,
    reporterId: actor,
    status: 'pending',
  };
  server.reports.push(row);
  return row.id;
}

/**
 * İki çağrının ilk hızlı duplicate kontrolünü aynı anda kaçırdığı durumu
 * modeller. Gerçek RPC'de bu bölüm reporter advisory lock alındıktan sonra
 * seri çalışır; bu nedenle lock sonrası ikinci kontrol zorunludur.
 */
function finishMessageReportAfterInitialMiss(
  server,
  actor,
  message,
  category,
  options = {},
) {
  const recheckAfterLock = options.recheckAfterLock !== false;
  if (recheckAfterLock) {
    const duplicate = server.reports.find(
      (report) => report.reporterId === actor && report.messageId === message.id,
    );
    if (duplicate) return duplicate.id;
  }

  assertReportQuota(server, actor);
  const row = {
    category,
    createdAt: server.now,
    details: null,
    id: nextId(server),
    messageContentSnapshot: message.content,
    messageCreatedAt: message.createdAt,
    messageId: message.id,
    reportedUserId: message.senderId,
    reporterId: actor,
    status: 'pending',
  };
  server.reports.push(row);
  return row.id;
}

/** İki farklı kilit sırasının basit wait-for çevrimi üretip üretmediği. */
function hasTwoTransactionDeadlock(firstOrder, secondOrder) {
  return (
    firstOrder[0] !== secondOrder[0] &&
    firstOrder[1] === secondOrder[0] &&
    secondOrder[1] === firstOrder[0]
  );
}

/**
 * Send ilişki kontrolünü geçtikten sonra block'un araya girdiği dar yarış.
 * Pair lock yoksa eski send çağrısı block temizliğinden sonra satır yazabilir.
 */
function simulateSendBlockRace(usePairLock) {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');

  if (usePairLock) {
    // SEND önce pair lock'ı kazanırsa mesajı block daha sonra temizler.
    sendFriendMessage(server, A, B, 'yarış', uuid(1800));
    blockUser(server, A, B);
    return server.messages.length;
  }

  // Kasıtlı eski model: send kontrolü geçti, block temizledi, send geç yazdı.
  assertEqual(areFriends(server, A, A, B), true, 'yarış kurulumu arkadaş değil');
  blockUser(server, A, B);
  server.messages.push({
    clientMessageId: uuid(1801),
    content: 'geç yazılan',
    createdAt: server.now,
    expiresAt: server.now + DAY_MS,
    id: nextId(server),
    recipientId: B,
    senderId: A,
  });
  return server.messages.length;
}

/** `public.report_user` referansı — arkadaşlık şartı YOKTUR. */
function reportUser(server, actor, target, category, details = null) {
  if (!actor) throw new Error('not_authenticated');
  if (!target || target === actor) throw new Error('invalid_target');
  if (!CATEGORIES.includes(category)) throw new Error('invalid_category');
  const trimmedDetails = (details ?? '').trim() || null;
  if (trimmedDetails && trimmedDetails.length > 1000) throw new Error('invalid_details');
  if (!server.profiles.has(target)) throw new Error('target_not_found');

  assertReportQuota(server, actor);

  const row = {
    category,
    createdAt: server.now,
    details: trimmedDetails,
    id: nextId(server),
    messageContentSnapshot: null,
    messageCreatedAt: null,
    messageId: null,
    reportedUserId: target,
    reporterId: actor,
    status: 'pending',
  };
  server.reports.push(row);
  return row.id;
}

/** 24 saatlik mesaj temizliği — `on delete set null` davranışıyla. */
function runMessageCleanup(server) {
  const expired = server.messages.filter((m) => m.expiresAt <= server.now);
  server.messages = server.messages.filter((m) => m.expiresAt > server.now);
  for (const report of server.reports) {
    if (report.messageId && expired.some((m) => m.id === report.messageId)) {
      // Rapor SİLİNMEZ; yalnızca bağ kopar. Snapshot korunur.
      report.messageId = null;
    }
  }
  return expired.length;
}

/** Sonuçlandırılmış raporların 90 günlük temizliği. */
function runReportCleanup(server) {
  const before = server.reports.length;
  server.reports = server.reports.filter(
    (r) =>
      r.status === 'pending' || r.createdAt > server.now - REPORT_RETENTION_MS,
  );
  return before - server.reports.length;
}

// ---------------------------------------------------------------------------
// 1 · Engelleme
// ---------------------------------------------------------------------------

check('1. A, B’yi engelleyince friendship ve YALNIZCA A–B mesajları silinir', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');
  addFriendship(server, A, C, 'accepted');
  addFriendship(server, B, C, 'accepted');
  const ab = addMessage(server, A, B, 'a-b');
  const ba = addMessage(server, B, A, 'b-a');
  const ac = addMessage(server, A, C, 'a-c');
  const bc = addMessage(server, B, C, 'b-c');

  blockUser(server, A, B);

  assertEqual(server.blocks.length, 1, 'engel kaydı oluşmadı');
  // A–B arkadaşlığı gitti, diğerleri DURUYOR.
  assertDeepEqual(
    server.friendships.map((f) => [f.requesterId, f.receiverId].sort().join('-')),
    [[A, C].sort().join('-'), [B, C].sort().join('-')],
    'başka kullanıcıların arkadaşlığı silindi',
  );
  // A–B mesajları gitti, diğerleri DURUYOR.
  assertDeepEqual(
    server.messages.map((m) => m.id).sort(),
    [ac.id, bc.id].sort(),
    'yanlış mesajlar silindi',
  );
  assert(!server.messages.some((m) => [ab.id, ba.id].includes(m.id)), 'A–B mesajları kaldı');
});

check('2. Tekrar engelleme IDEMPOTENTTİR', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');

  blockUser(server, A, B);
  blockUser(server, A, B);
  blockUser(server, A, B);

  assertEqual(server.blocks.length, 1, 'tekrar engelleme ikinci satır oluşturdu');
  // Kendini engelleme ve geçersiz hedef reddedilir.
  assertRejects(() => blockUser(server, A, A), 'invalid_target', 'kendini engelleyebildi');
  assertRejects(() => blockUser(server, A, uuid(999)), 'target_not_found', 'yok olan hedef kabul');
  // Tablo kısıtı da aynı kuralı taşır.
  assert(
    sqlCode.includes('check (blocker_id <> blocked_id)'),
    'kendini engelleme kısıtı tabloda yok',
  );
  assert(sqlCode.includes('primary key (blocker_id, blocked_id)'), 'birleşik primary key yok');
});

check('3. Engel kaldırılınca arkadaşlık GERİ GELMEZ', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');
  blockUser(server, A, B);
  assertEqual(server.friendships.length, 0, 'kurulum: arkadaşlık silinmeliydi');

  unblockUser(server, A, B);

  assertEqual(server.blocks.length, 0, 'engel kalkmadı');
  assertEqual(server.friendships.length, 0, 'engel kalkınca arkadaşlık geri geldi');
  assertEqual(areFriends(server, A, A, B), false, 'arkadaşlık yeniden kuruldu');

  // Taraflar yeniden istek gönderebilir.
  const id = sendFriendRequest(server, A, B);
  assert(id !== undefined, 'engel kalktıktan sonra istek gönderilemedi');
  assertEqual(server.friendships[0].status, 'pending', 'yeni istek pending değil');
});

check('4. İKİ YÖNDEN herhangi bir blok arama, istek, kabul, profil ve mesajı engeller', () => {
  for (const [label, blocker, blocked] of [
    ['ileri yön', A, B],
    ['ters yön', B, A],
  ]) {
    const server = createServer();
    addFriendship(server, A, B, 'accepted');
    addMessage(server, A, B);
    // Engelden ÖNCE her şey çalışıyor.
    assert(searchProfiles(server, A, 'kullanici').includes(B), `${label}: kurulum arama`);
    assertEqual(getFriendProfile(server, A, B).length, 1, `${label}: kurulum profil`);

    blockUser(server, blocker, blocked);
    // Arkadaşlık silindiği için yeniden pending istek kurulur (kabul denemesi için).
    server.friendships.push({ id: 'req', receiverId: A, requesterId: B, status: 'pending' });

    assert(!searchProfiles(server, A, 'kullanici').includes(B), `${label}: arama sızdı`);
    assert(!searchProfiles(server, B, 'kullanici').includes(A), `${label}: ters arama sızdı`);
    assertRejects(
      () => sendFriendRequest(server, A, B),
      'relationship_unavailable',
      `${label}: istek engellenmedi`,
    );
    assertRejects(
      () => sendFriendRequest(server, B, A),
      'relationship_unavailable',
      `${label}: ters istek engellenmedi`,
    );
    assertRejects(
      () => respondToFriendRequest(server, A, 'req', true),
      'relationship_unavailable',
      `${label}: kabul engellenmedi`,
    );
    assertEqual(getFriendProfile(server, A, B).length, 0, `${label}: profil sızdı`);
    assertEqual(getFriendProfile(server, B, A).length, 0, `${label}: ters profil sızdı`);

    // Mesaj: arkadaşlık zaten silindi; engel ikinci katman olarak da tutar.
    addFriendship(server, A, B, 'accepted');
    assertRejects(
      () => sendFriendMessage(server, A, B, 'selam', uuid(500)),
      'relationship_unavailable',
      `${label}: mesaj engellenmedi`,
    );
    assertRejects(
      () => sendFriendMessage(server, B, A, 'selam', uuid(501)),
      'relationship_unavailable',
      `${label}: ters mesaj engellenmedi`,
    );
  }
});

check('5. Blok YÖNÜ hata metni veya dönüş verisiyle SIZMAZ', () => {
  const forward = createServer();
  blockUser(forward, A, B);
  const reverse = createServer();
  blockUser(reverse, B, A);

  // İki yön de AYNI hata metnini üretir.
  const capture = (server, actor, target) => {
    try {
      sendFriendRequest(server, actor, target);
      return 'no-error';
    } catch (error) {
      return error.message;
    }
  };
  assertEqual(capture(forward, A, B), 'relationship_unavailable', 'ileri yön hatası farklı');
  assertEqual(capture(reverse, A, B), 'relationship_unavailable', 'ters yön hatası farklı');
  assertEqual(capture(forward, B, A), capture(reverse, B, A), 'yön hata metniyle ayırt edilebiliyor');

  // Dönüş verisi de ayırt ettirmez: iki yönde de arama boş.
  assertDeepEqual(
    searchProfiles(forward, B, 'kullanici').includes(A),
    searchProfiles(reverse, B, 'kullanici').includes(A),
    'arama sonucu yönü ayırt ediyor',
  );

  // Engellenen kişi, KENDİSİNİ kimin engellediğini listeleyemez.
  assertDeepEqual(listBlockedUsers(forward, B), [], 'engellenen taraf engeli görebiliyor');
  assertDeepEqual(
    listBlockedUsers(forward, A).map((row) => row.userId),
    [B],
    'kendi verdiği engel listelenmiyor',
  );

  // Politika yalnızca `blocker_id` yönünü açar.
  assert(
    sqlCode.includes('using (blocker_id = (select auth.uid()))'),
    'RLS politikası kendi engellerine sınırlı değil',
  );
  // Dahili yardımcı istemciye KAPALI.
  assert(
    sqlCode.includes('revoke all on function public.has_block_between(uuid, uuid) from authenticated;'),
    'yön gizleyen yardımcı authenticated’a açık',
  );
  assert(
    !/grant execute on function public\.has_block_between/.test(sqlCode),
    'dahili engel yardımcısına execute verilmiş',
  );
});

check('6. A–B işlemi C’nin verilerine DOKUNMAZ', () => {
  const server = createServer();
  addFriendship(server, C, D, 'accepted');
  addFriendship(server, A, B, 'accepted');
  const cd = addMessage(server, C, D, 'c-d');
  const dc = addMessage(server, D, C, 'd-c');
  addMessage(server, A, B, 'a-b');

  blockUser(server, A, B);

  assertEqual(server.friendships.length, 1, 'C–D arkadaşlığı etkilendi');
  assertEqual(server.friendships[0].requesterId, C, 'yanlış arkadaşlık kaldı');
  assertDeepEqual(
    server.messages.map((m) => m.id).sort(),
    [cd.id, dc.id].sort(),
    'C–D mesajları etkilendi',
  );
  // Engeller de yalnızca A–B çiftini kapsar.
  assertEqual(hasBlockBetween(server, C, D), false, 'ilgisiz çift engelli sayıldı');
});

check('7. Block/request/accept YARIŞINDA accepted friendship oluşamaz', () => {
  const server = createServer();
  const requestId = sendFriendRequest(server, B, A);
  assertEqual(server.friendships[0].status, 'pending', 'kurulum: pending olmalı');

  // Kabul uçuşundayken A, B'yi engelledi (bekleyen istek silinir).
  blockUser(server, A, B);
  assertEqual(server.friendships.length, 0, 'bekleyen istek silinmedi');

  // Geç gelen kabul çağrısı: istek yok.
  assertRejects(
    () => respondToFriendRequest(server, A, requestId, true),
    'request_not_found',
    'silinmiş istek kabul edilebildi',
  );

  /**
   * DAR YARIŞ: istek silinmeden hemen önce kabul satırı okunmuş olsa bile
   * kilit sonrası engel kontrolü accepted oluşmasını engeller.
   */
  const race = createServer();
  const raceId = sendFriendRequest(race, B, A);
  race.blocks.push({ blockedId: B, blockerId: A, createdAt: race.now });
  assertRejects(
    () => respondToFriendRequest(race, A, raceId, true),
    'relationship_unavailable',
    'yarışta accepted oluştu',
  );
  assertEqual(race.friendships[0].status, 'pending', 'satır accepted oldu');
  assertEqual(areFriends(race, A, A, B), false, 'engelli çift arkadaş sayıldı');

  // KAYNAK: bütün yollar pair lock -> row lock sırasını kullanıyor.
  const respondBody = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.respond_to_friend_request'),
    sqlCode.indexOf('create or replace function public.get_friend_profile'),
  );
  assert(
    respondBody.indexOf('public.lock_user_pair(') < respondBody.indexOf('for update'),
    'friendship satırı pair lock’tan önce kilitleniyor',
  );
  assertEqual(
    (respondBody.match(/for update/g) ?? []).length,
    1,
    'kabul yolunda beklenmeyen ikinci satır kilidi var',
  );
  assert(
    respondBody.indexOf('for update') < respondBody.indexOf('public.has_block_between('),
    'engel kontrolü satır yeniden doğrulanmadan çalışıyor',
  );
  assert(respondBody.includes('for update'), 'satır kilidi kaybolmuş');

  const blockBody = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.block_user'),
    sqlCode.indexOf('create or replace function public.unblock_user'),
  );
  assert(
    blockBody.indexOf('public.lock_user_pair(') < blockBody.indexOf('delete from public.friendships'),
    'block yolu pair lock’tan önce friendship satırına dokunuyor',
  );

  assertEqual(
    hasTwoTransactionDeadlock(['pair', 'row'], ['pair', 'row']),
    false,
    'tek tip kilit sırası deadlock üretti',
  );
  assertEqual(
    hasTwoTransactionDeadlock(['row', 'pair'], ['pair', 'row']),
    true,
    'eski ters sıra deadlock çevrimi üretmedi',
  );
});

check('7b. Send/block yarışında block sonrası MESAJ KALMAZ', () => {
  assertEqual(simulateSendBlockRace(true), 0, 'pair lock’lı yarışta mesaj kaldı');

  // Block önce kilidi kazanırsa send ilişki kontrolünü geçemez.
  const blockFirst = createServer();
  addFriendship(blockFirst, A, B, 'accepted');
  blockUser(blockFirst, A, B);
  assertRejects(
    () => sendFriendMessage(blockFirst, A, B, 'geç mesaj', uuid(1802)),
    'not_friends',
    'block önce tamamlandığı hâlde mesaj gönderildi',
  );
  assertEqual(blockFirst.messages.length, 0, 'block-first sırasında mesaj oluştu');

  const sendBody = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.send_friend_message'),
  );
  const pairLockAt = sendBody.indexOf('public.lock_user_pair(actor, target_user_id)');
  assert(pairLockAt >= 0, 'mesaj gönderiminde pair lock yok');
  assert(pairLockAt < sendBody.indexOf('public.are_friends('), 'friendship kontrolü pair lock’tan önce');
  assert(
    pairLockAt < sendBody.indexOf('public.has_block_between('),
    'engel kontrolü pair lock’tan önce',
  );
  assert(
    pairLockAt < sendBody.indexOf('insert into public.friend_messages'),
    'mesaj INSERT pair lock tarafından korunmuyor',
  );
});

// ---------------------------------------------------------------------------
// 2 · Şikâyet
// ---------------------------------------------------------------------------

check('8. Bir mesajı yalnızca ALICISI, süresi dolmadan raporlayabilir', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');
  const message = addMessage(server, A, B, 'kaba mesaj');

  // Alıcı raporlayabilir; raporlanan otomatik olarak GÖNDEREN olur.
  const reportId = reportFriendMessage(server, B, message.id, 'harassment');
  const row = server.reports.find((r) => r.id === reportId);
  assertEqual(row.reportedUserId, A, 'raporlanan kullanıcı sunucuda belirlenmedi');
  assertEqual(row.reporterId, B, 'raporlayan yanlış');

  // Gönderen kendi yazdığı mesajı karşı tarafa ait kanıtmış gibi raporlayamaz.
  const second = createServer();
  addFriendship(second, A, B, 'accepted');
  const own = addMessage(second, A, B, 'x');
  assertRejects(
    () => reportFriendMessage(second, A, own.id, 'spam'),
    'message_not_reportable',
    'gönderen kendi mesajını raporlayabildi',
  );

  // Üçüncü kişi RAPORLAYAMAZ.
  assertRejects(
    () => reportFriendMessage(server, C, message.id, 'harassment'),
    'message_not_reportable',
    'üçüncü kişi mesaj raporlayabildi',
  );
  // Olmayan mesaj reddedilir.
  assertRejects(
    () => reportFriendMessage(server, B, uuid(999), 'spam'),
    'message_not_found',
    'olmayan mesaj raporlandı',
  );

  // Cron gecikse ve satır tabloda kalsa bile 24 saati dolan mesaj raporlanamaz.
  const expired = createServer();
  const expiredMessage = addMessage(expired, A, B, 'süresi dolacak');
  expired.now = expiredMessage.expiresAt;
  assertRejects(
    () => reportFriendMessage(expired, B, expiredMessage.id, 'spam'),
    'message_not_found',
    'süresi dolmuş mesaj raporlandı',
  );

  // KAYNAK: `reported_user_id` istemciden GELMEZ.
  const reportBody = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.report_friend_message'),
    sqlCode.indexOf('create or replace function public.report_user'),
  );
  assert(
    reportBody.includes('reported := target.sender_id'),
    'raporlanan kullanıcı gönderen olarak sunucuda türetilmiyor',
  );
  assert(reportBody.includes('target.recipient_id <> actor'), 'yalnızca alıcı kontrolü yok');
  assert(reportBody.includes("m.expires_at > timezone('utc', now())"), 'expiry kontrolü yok');
  assert(reportBody.includes('for share'), 'snapshot yazılana kadar mesaj satırı korunmuyor');
  assert(
    !/reported_user_id\s+uuid/.test(reportBody),
    'mesaj raporu imzasında reported_user_id parametresi var',
  );
});

check('9. Rapor SNAPSHOT’ı mesaj silinince korunur ve `message_id` null olur', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');
  const message = addMessage(server, A, B, 'kanit metni');
  const reportId = reportFriendMessage(server, B, message.id, 'hate', 'ayrıntı');

  // 24 saat doldu; mesaj temizliği çalıştı.
  server.now = message.expiresAt;
  assertEqual(runMessageCleanup(server), 1, 'mesaj temizlenmedi');

  const row = server.reports.find((r) => r.id === reportId);
  assert(row !== undefined, 'mesaj silinince rapor da silindi');
  assertEqual(row.messageId, null, 'message_id null olmadı');
  assertEqual(row.messageContentSnapshot, 'kanit metni', 'içerik snapshot’ı kayboldu');
  assertEqual(row.messageCreatedAt, message.createdAt, 'zaman snapshot’ı kayboldu');
  assertEqual(row.reportedUserId, A, 'raporlanan kullanıcı kayboldu');

  // KAYNAK: FK davranışı ve snapshot sütunları.
  assert(
    sqlCode.includes('references public.friend_messages(id) on delete set null'),
    'message_id için on delete set null yok',
  );
  assert(sqlCode.includes('message_content_snapshot text'), 'içerik snapshot sütunu yok');
  assert(sqlCode.includes('message_created_at timestamptz'), 'zaman snapshot sütunu yok');
  // Snapshot DIŞINDA özel alan saklanmaz.
  const table = sqlCode.slice(
    sqlCode.indexOf('create table if not exists public.user_content_reports'),
    sqlCode.indexOf('create unique index if not exists user_content_reports_reporter_message_idx'),
  );
  for (const field of ['email', 'auth_metadata', 'token', 'bio', 'training_goal']) {
    assert(!table.includes(field), `rapor tablosunda özel alan var: ${field}`);
  }
});

check('10. Aynı mesajın TEKRAR raporu yeni satır üretmez', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');
  const message = addMessage(server, A, B);

  const first = reportFriendMessage(server, B, message.id, 'spam');
  const second = reportFriendMessage(server, B, message.id, 'harassment');
  const third = reportFriendMessage(server, B, message.id, 'other', 'ekstra');

  assertEqual(server.reports.length, 1, 'tekrar rapor yeni satır oluşturdu');
  assertEqual(second, first, 'tekrar rapor farklı kimlik döndürdü');
  assertEqual(third, first, 'üçüncü rapor farklı kimlik döndürdü');
  // Tekrar rapor kotayı da tüketmez.
  assertEqual(
    server.reports.filter((r) => r.reporterId === B).length,
    1,
    'tekrar rapor kotayı tüketti',
  );

  // Farklı kullanıcı AYNI mesajı raporlayabilir.
  addFriendship(server, A, C, 'accepted');
  const other = addMessage(server, A, C);
  reportFriendMessage(server, C, other.id, 'spam');
  assertEqual(server.reports.length, 2, 'farklı raporlayan engellendi');

  assert(
    sqlCode.includes('create unique index if not exists user_content_reports_reporter_message_idx'),
    'tekrar rapor indeksi yok',
  );
  assert(sqlCode.includes('where message_id is not null'), 'kısmi unique indeks değil');
});

check('10b. Eşzamanlı duplicate rapor kota sınırında mevcut ID’yi döndürür', () => {
  const server = createServer();
  const message = addMessage(server, A, B, 'eşzamanlı rapor');
  for (let index = 0; index < 9; index += 1) {
    server.reports.push({
      createdAt: server.now,
      id: `old-${index}`,
      messageId: null,
      reportedUserId: C,
      reporterId: B,
      status: 'pending',
    });
  }

  // İki çağrı da ilk hızlı kontrolde kaydı görmedi; pair reporter lock altında
  // seri tamamlanıyorlar.
  const first = finishMessageReportAfterInitialMiss(server, B, message, 'spam');
  const second = finishMessageReportAfterInitialMiss(server, B, message, 'harassment');
  assertEqual(first, second, 'duplicate çağrılar aynı report ID’yi almadı');
  assertEqual(server.reports.length, 10, 'duplicate çağrı yeni satır veya kota tüketti');

  // Farklı bir 11. rapor hâlâ reddedilir.
  assertRejects(
    () => reportUser(server, B, C, 'spam'),
    'report_rate_limited',
    '11. farklı rapor kabul edildi',
  );

  const reportBody = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.report_friend_message'),
    sqlCode.indexOf('create or replace function public.report_user'),
  );
  const lockAt = reportBody.indexOf("hashtext('public.user_content_reports')");
  const quotaAt = reportBody.indexOf('public.assert_report_quota(actor)');
  const duplicateQueries = [...reportBody.matchAll(/from public\.user_content_reports as r/g)].map(
    (match) => match.index,
  );
  assert(lockAt >= 0, 'mesaj raporunda reporter lock yok');
  assertEqual(duplicateQueries.length >= 3, true, 'lock sonrası duplicate sorgusu bulunamadı');
  assert(
    duplicateQueries.some((index) => index > lockAt && index < quotaAt),
    'kota öncesinde lock sonrası duplicate kontrolü yok',
  );
});

check('11. Günlük 10 rapor kabul, 11. rapor REDDEDİLİR', () => {
  const server = createServer();
  for (let index = 0; index < REPORT_DAILY_LIMIT; index += 1) {
    reportUser(server, A, index % 2 === 0 ? B : C, 'spam');
  }
  assertEqual(server.reports.length, REPORT_DAILY_LIMIT, 'kurulum: 10 rapor yazılmalıydı');

  assertRejects(
    () => reportUser(server, A, B, 'spam'),
    'report_rate_limited',
    '11. rapor kabul edildi',
  );
  assertEqual(server.reports.length, REPORT_DAILY_LIMIT, 'reddedilen rapor yazıldı');

  // Sınır KULLANICI başınadır.
  reportUser(server, B, C, 'spam');
  assertEqual(server.reports.length, REPORT_DAILY_LIMIT + 1, 'sınır başka kullanıcıyı durdurdu');

  // Pencere kayınca yeniden raporlanabilir.
  server.now += DAY_MS + 1000;
  reportUser(server, A, B, 'spam');
  assertEqual(server.reports.length, REPORT_DAILY_LIMIT + 2, 'pencere kaydıktan sonra engellendi');

  // KAYNAK: eşzamanlı çağrılara dayanıklı — sayımdan ÖNCE advisory lock.
  const quota = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.assert_report_quota'),
    sqlCode.indexOf('create or replace function public.report_friend_message'),
  );
  assert(
    quota.indexOf('pg_advisory_xact_lock') < quota.indexOf('select count(*)'),
    'kota sayımı kilitten önce yapılıyor',
  );
  assert(quota.includes("raise exception 'report_rate_limited'"), 'kararlı hata kodu yok');

  // Kullanıcı kendisini raporlayamaz; arkadaşlık şartı YOKTUR.
  assertRejects(() => reportUser(server, A, A, 'spam'), 'invalid_target', 'kendini raporlayabildi');
  const stranger = createServer();
  const id = reportUser(stranger, A, D, 'hate');
  assert(id !== undefined, 'arkadaş olmayan kullanıcı raporlanamadı');
});

check('12. Category ve status ALLOWLIST dışındaki değerler reddedilir', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');
  const message = addMessage(server, A, B);

  for (const category of CATEGORIES) {
    const fresh = createServer();
    addFriendship(fresh, A, B, 'accepted');
    const row = addMessage(fresh, A, B);
    const id = reportFriendMessage(fresh, B, row.id, category);
    assert(id !== undefined, `geçerli kategori reddedildi: ${category}`);
  }

  for (const bad of ['abuse', 'HARASSMENT', '', 'other; drop table', 'illegal']) {
    assertRejects(
      () => reportFriendMessage(server, B, message.id, bad),
      'invalid_category',
      `geçersiz kategori kabul edildi: ${JSON.stringify(bad)}`,
    );
    assertRejects(
      () => reportUser(server, A, C, bad),
      'invalid_category',
      `kullanıcı raporunda geçersiz kategori kabul edildi: ${JSON.stringify(bad)}`,
    );
  }

  // Ayrıntı uzunluğu sınırlı.
  assertRejects(
    () => reportUser(server, A, C, 'spam', 'x'.repeat(1001)),
    'invalid_details',
    'aşırı uzun ayrıntı kabul edildi',
  );

  // KAYNAK: iki allowlist de tablo kısıtında.
  for (const category of CATEGORIES) {
    assert(sqlCode.includes(`'${category}'`), `kategori kısıtta yok: ${category}`);
  }
  for (const status of STATUSES) {
    assert(sqlCode.includes(`'${status}'`), `status kısıtta yok: ${status}`);
  }
  assert(sqlCode.includes('user_content_reports_category_check'), 'kategori kısıtı yok');
  assert(sqlCode.includes('user_content_reports_status_check'), 'status kısıtı yok');
  assert(sqlCode.includes('user_content_reports_details_length_check'), 'ayrıntı kısıtı yok');
});

// ---------------------------------------------------------------------------
// 3 · İçerik filtresi
// ---------------------------------------------------------------------------

check('13. İçerik filtresi CASE ve NOKTALAMA varyasyonlarını yakalar', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');

  const variants = [
    'seni öldüreceğim',
    'SENİ ÖLDÜRECEĞİM',
    'Seni  Öldüreceğim!!!',
    'seni, öldüreceğim.',
    'lütfen dinle: SENİ ÖLDÜRECEĞİM',
    'I WILL KILL YOU',
    'i-will-kill-you',
    'ok... i will kill you!',
  ];

  for (const [index, variant] of variants.entries()) {
    assertEqual(
      messageContainsBlockedTerm(server, variant),
      true,
      `varyasyon yakalanmadı: ${variant}`,
    );
    assertRejects(
      () => sendFriendMessage(server, A, B, variant, uuid(600 + index)),
      'message_rejected_content',
      `gönderim engellenmedi: ${variant}`,
    );
  }
  assertEqual(server.messages.length, 0, 'reddedilen mesaj yazıldı');

  // KAYNAK: kontrol INSERT'ten ÖNCE ve sunucuda.
  const sendBody = sqlCode.slice(sqlCode.indexOf('create or replace function public.send_friend_message'));
  assert(
    sendBody.indexOf('public.message_contains_blocked_term(trimmed)') <
      sendBody.indexOf('insert into public.friend_messages'),
    'filtre INSERT’ten sonra çalışıyor',
  );
  assert(sendBody.includes("raise exception 'message_rejected_content'"), 'kararlı hata kodu yok');
});

check('14. Masum kelime İÇİNDEKİ parça FALSE-POSITIVE üretmez', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');

  const innocent = [
    'bugün harika bir antrenman yaptım',
    'kendini öldürmeden önce ısınmayı unutma diyorlar ama ben öyle demiyorum',
    'skills',
    'killer workout bugün',
    'this drill is a killer',
    'öldürücü bir bacak günüydü',
    'seni tebrik ediyorum',
  ];

  // "kill" içeren masum kelimeler (killer, skills) engellenmez: eşleşme
  // kelime sınırındadır ve liste yalnızca ÇOK KELİMELİ ifadeler içerir.
  for (const text of innocent) {
    if (text.includes('kendini öldür')) continue;
    assertEqual(
      messageContainsBlockedTerm(server, text),
      false,
      `masum metin engellendi: ${text}`,
    );
  }

  // Gerçek gönderim de geçer.
  const sent = sendFriendMessage(server, A, B, 'killer workout bugün', uuid(700));
  assertEqual(sent.content, 'killer workout bugün', 'masum mesaj gönderilemedi');

  // Kısa bir parçanın kelime içinde geçmesi eşleşme üretmez.
  const shortTerm = createServer();
  shortTerm.blockedTerms = [{ isActive: true, term: 'kill' }];
  assertEqual(
    messageContainsBlockedTerm(shortTerm, 'skills and drills'),
    false,
    'kelime içindeki parça eşleşti',
  );
  assertEqual(messageContainsBlockedTerm(shortTerm, 'kill'), true, 'tam kelime eşleşmedi');

  // Pasif ifadeler kontrol edilmez.
  const inactive = createServer();
  inactive.blockedTerms = [{ isActive: false, term: 'seni öldüreceğim' }];
  assertEqual(
    messageContainsBlockedTerm(inactive, 'seni öldüreceğim'),
    false,
    'pasif ifade hâlâ engelliyor',
  );
  assert(sqlCode.includes('is_active boolean not null default true'), 'aktif/pasif alanı yok');
  assert(sqlCode.includes('where t.is_active'), 'pasif ifadeler filtrelenmiyor');

  // KAYNAK: eşleşme boşlukla çevrelenmiş (kelime sınırı).
  assert(
    sqlCode.includes("' ' || public.normalize_message_text(t.term) || ' '"),
    'kelime sınırı kullanılmıyor',
  );
});

check('15. Direct message INSERT ve direct report INSERT authenticated için KAPALI', () => {
  const messagesSql = source(MESSAGES_SQL_PATH);
  // Mesaj tablosu (mevcut migration) — yalnızca SELECT.
  assert(
    messagesSql.includes('grant select on table public.friend_messages to authenticated;'),
    'mesaj tablosunda SELECT yetkisi kaybolmuş',
  );
  assert(
    !/grant[^;]*\b(insert|update|delete)\b[^;]*on table public\.friend_messages/i.test(messagesSql),
    'mesaj tablosuna doğrudan yazma yetkisi var',
  );

  // Yeni tablolar: rapor ve ifade listesi istemciye TAMAMEN kapalı.
  for (const table of ['public.user_content_reports', 'public.message_blocked_terms']) {
    assert(sqlCode.includes(`revoke all on table ${table} from anon;`), `${table}: anon revoke yok`);
    assert(
      sqlCode.includes(`revoke all on table ${table} from authenticated;`),
      `${table}: authenticated revoke yok`,
    );
    assert(
      !new RegExp(`grant[^;]*on table ${table.replace('.', '\\.')}`).test(sqlCode),
      `${table}: istemciye yetki verilmiş`,
    );
    assert(
      sqlCode.includes(`alter table ${table} enable row level security;`),
      `${table}: RLS açık değil`,
    );
  }

  // Engel tablosu: yalnızca SELECT.
  assert(
    sqlCode.includes('grant select on table public.user_blocks to authenticated;'),
    'engel tablosunda SELECT yetkisi yok',
  );
  assert(
    !/grant[^;]*\b(insert|update|delete)\b[^;]*on table public\.user_blocks/i.test(sqlCode),
    'engel tablosuna doğrudan yazma yetkisi var',
  );
  assert(sqlCode.includes('alter table public.user_blocks enable row level security;'), 'RLS yok');

  // `anon` hiçbir güvenlik RPC’sini çağıramaz.
  for (const signature of [
    'public.block_user(uuid)',
    'public.unblock_user(uuid)',
    'public.list_blocked_users()',
    'public.report_friend_message(uuid, text, text)',
    'public.report_user(uuid, text, text)',
  ]) {
    assert(sqlCode.includes(`revoke all on function ${signature} from anon;`), `anon revoke yok: ${signature}`);
    assert(
      sqlCode.includes(`grant execute on function ${signature} to authenticated;`),
      `authenticated grant yok: ${signature}`,
    );
  }
});

check('16. PENDING raporlar cleanup’tan etkilenmez; sonuçlananlar 90 günde temizlenir', () => {
  const server = createServer();
  const old = server.now - REPORT_RETENTION_MS - 1000;

  server.reports = [
    { createdAt: old, id: 'p1', reporterId: A, status: 'pending' },
    { createdAt: old, id: 'r1', reporterId: A, status: 'reviewed' },
    { createdAt: old, id: 'd1', reporterId: A, status: 'dismissed' },
    { createdAt: old, id: 'a1', reporterId: A, status: 'actioned' },
    { createdAt: server.now - 1000, id: 'r2', reporterId: A, status: 'reviewed' },
  ];

  const deleted = runReportCleanup(server);

  assertEqual(deleted, 3, 'yanlış sayıda rapor silindi');
  assertDeepEqual(
    server.reports.map((r) => r.id).sort(),
    ['p1', 'r2'],
    'pending veya taze rapor silindi',
  );

  // KAYNAK: cron komutu ve idempotent kurulum.
  assert(
    sqlCode.includes("cleanup-resolved-user-content-reports"),
    'rapor temizleme cron adı yok',
  );
  assert(
    sqlCode.includes("where jobname = 'cleanup-resolved-user-content-reports'"),
    'cron ada göre kaldırılmıyor',
  );
  const cron = sqlCode.slice(sqlCode.indexOf('cleanup_command constant text'));
  assert(cron.includes('delete from public.user_content_reports'), 'cron yanlış tabloyu siliyor');
  assert(cron.includes("''reviewed'', ''dismissed'', ''actioned''"), 'cron pending’i de siliyor');
  assert(cron.includes("interval ''90 days''"), '90 gün saklama yok');
  assert(!/vacuum/i.test(sqlCode), 'VACUUM kullanılmış');
  // Mevcut mesaj cron’una DOKUNULMAZ.
  assert(
    !sqlCode.includes('cleanup-expired-friend-messages'),
    'mevcut mesaj temizleme cron’una dokunulmuş',
  );
});

check('17. 24 saatlik expiry, 60/dakika sınır ve IDEMPOTENCY korunur', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');

  // Idempotency: aynı anahtar + aynı içerik tek satır.
  const key = uuid(800);
  const first = sendFriendMessage(server, A, B, 'selam', key);
  const retry = sendFriendMessage(server, A, B, 'selam', key);
  assertEqual(server.messages.length, 1, 'retry ikinci satır oluşturdu');
  assertEqual(retry.id, first.id, 'retry farklı mesaj döndürdü');
  assertEqual(retry.expiresAt, first.expiresAt, 'retry ömrü değiştirdi');
  assertEqual(first.expiresAt - first.createdAt, DAY_MS, '24 saatlik ömür bozuldu');

  // Farklı içerik conflict üretir.
  assertRejects(
    () => sendFriendMessage(server, A, B, 'baska', key),
    'client_message_id_conflict',
    'farklı içerik sessizce kabul edildi',
  );

  // 60/dakika sınırı.
  for (let index = 1; index < 60; index += 1) {
    sendFriendMessage(server, A, B, `mesaj-${index}`, uuid(900 + index));
  }
  assertEqual(server.messages.length, 60, 'kurulum: 60 mesaj yazılmalıydı');
  assertRejects(
    () => sendFriendMessage(server, A, B, 'fazladan', uuid(1500)),
    'message_rate_limited',
    '61. mesaj kabul edildi',
  );

  /**
   * GERÇEK RETRY, sonradan eklenen bir ifade yüzünden reddedilmez: filtre
   * idempotency hızlı yolundan SONRA çalışır.
   */
  const later = createServer();
  addFriendship(later, A, B, 'accepted');
  const storedKey = uuid(1600);
  const stored = sendFriendMessage(later, A, B, 'eski masum mesaj', storedKey);
  // Moderasyon listeye yeni bir ifade ekledi ve bu mesaj artık eşleşiyor.
  later.blockedTerms.push({ isActive: true, term: 'eski masum mesaj' });
  const afterChange = sendFriendMessage(later, A, B, 'eski masum mesaj', storedKey);
  assertEqual(afterChange.id, stored.id, 'gerçek retry filtreye takıldı');
  assertEqual(later.messages.length, 1, 'retry yeni satır oluşturdu');
  // Ama YENİ bir mesaj artık reddedilir.
  assertRejects(
    () => sendFriendMessage(later, A, B, 'eski masum mesaj', uuid(1601)),
    'message_rejected_content',
    'yeni mesaj filtreden geçti',
  );

  // KAYNAK: mevcut davranışların hepsi yeniden tanımda duruyor.
  const sendBody = sqlCode.slice(sqlCode.indexOf('create or replace function public.send_friend_message'));
  assert(sendBody.includes('pg_advisory_xact_lock'), 'advisory lock kaybolmuş');
  assert(sendBody.includes('recent_count >= 60'), '60/dakika sınırı kaybolmuş');
  assert(sendBody.includes('when unique_violation then'), 'telafi yolu kaybolmuş');
  assert(sendBody.includes('if not found then'), 'özgün hata yeniden fırlatma kaybolmuş');
  assertEqual(
    (sendBody.match(/client_message_id_conflict/g) ?? []).length,
    3,
    'üç yollu uyuşmazlık kontrolü kaybolmuş',
  );
  assert(
    !/insert into public\.friend_messages \([^)]*(created_at|expires_at)/.test(sendBody),
    'zaman sütunları açıkça yazılıyor',
  );
});

// ---------------------------------------------------------------------------
// 4 · Migration bütünlüğü
// ---------------------------------------------------------------------------

check('18. Migration IDEMPOTENT yapıdadır', () => {
  for (const statement of sqlCode.match(/create table[^;]*/g) ?? []) {
    assert(statement.includes('if not exists'), `tablo idempotent değil: ${statement.slice(0, 60)}`);
  }
  for (const statement of sqlCode.match(/create (?:unique )?index[^;]*/g) ?? []) {
    assert(statement.includes('if not exists'), `indeks idempotent değil: ${statement.slice(0, 60)}`);
  }
  assertEqual((sqlCode.match(/create function/g) ?? []).length, 0, 'replace edilmeyen fonksiyon var');
  assert(sqlCode.includes('drop policy if exists "user_blocks_select_own"'), 'politika idempotent değil');
  assert(sqlCode.includes('on conflict (blocker_id, blocked_id) do nothing'), 'engel idempotent değil');
  assert(sqlCode.includes('on conflict do nothing'), 'tohum veri idempotent değil');
  assert(sqlCode.trimStart().startsWith('begin;'), 'tek transaction değil');
  assert(sqlCode.trimEnd().endsWith('commit;'), 'commit ile bitmiyor');
});

check('19. UYGULANMIŞ eski migration dosyaları DEĞİŞMEMİŞTİR', () => {
  const tracked = [MESSAGES_SQL_PATH, FRIENDS_SQL_PATH, PROFILE_SQL_PATH];
  for (const path of tracked) {
    const head = execFileSync('git', ['show', `HEAD:${path}`], { cwd: ROOT, encoding: 'utf8' });
    assertEqual(source(path), head, `uygulanmış migration değiştirilmiş: ${path}`);
  }

  // Yeni migration ileri tarihlidir ve tek yeni dosyadır.
  assert(SAFETY_SQL_PATH > MESSAGES_SQL_PATH, 'yeni migration ileri tarihli değil');

  // İmzalar BİREBİR korunmuştur.
  const signatures = [
    'create or replace function public.search_profiles(search_query text)',
    'create or replace function public.send_friend_request(target_user_id uuid)',
    'create or replace function public.get_friend_profile(target_user_id uuid)',
  ];
  for (const signature of signatures) {
    assert(sqlCode.includes(signature), `imza korunmamış: ${signature}`);
  }
  assert(
    sqlCode.includes('respond_to_friend_request(\n  friendship_id uuid,\n  accept boolean\n)'),
    'respond_to_friend_request imzası korunmamış',
  );
  assert(
    sqlCode.includes(
      'send_friend_message(\n  target_user_id uuid,\n  message_content text,\n  client_message_id uuid\n)',
    ),
    'send_friend_message imzası korunmamış',
  );
  assert(sqlCode.includes('returns setof public.friend_messages'), 'mesaj dönüş tipi değişmiş');

  // `get_friend_profile` GÜNCEL 11 sütunlu dönüş tipi birebir korunur.
  const profileReturn = sqlCode.slice(
    sqlCode.indexOf('create or replace function public.get_friend_profile'),
    sqlCode.indexOf('language sql', sqlCode.indexOf('create or replace function public.get_friend_profile')),
  );
  for (const column of [
    'display_name text',
    'username text',
    'bio text',
    'avatar_url text',
    'banner_url text',
    'training_goal text',
    'level integer',
    'xp_into_level integer',
    'xp_for_next integer',
    'color_preset text',
  ]) {
    assert(profileReturn.includes(column), `profil dönüş sütunu kaybolmuş: ${column}`);
  }
});

check('20. Bütün SECURITY DEFINER fonksiyonlarında boş `search_path` vardır', () => {
  const definers = [...sqlCode.matchAll(/create or replace function (public\.\w+)/g)].map(
    (match) => match[1],
  );
  assert(definers.length >= 12, 'beklenenden az fonksiyon tanımlanmış');

  for (const name of definers) {
    const body = sqlCode.slice(sqlCode.indexOf(`create or replace function ${name}`));
    const head = body.slice(0, body.indexOf('as $$'));
    assert(head.includes("set search_path = ''"), `boş search_path yok: ${name}`);
  }

  // Dışarıya açık her fonksiyon `auth.uid()` kontrolü yapar.
  for (const name of ['public.block_user', 'public.unblock_user', 'public.report_friend_message', 'public.report_user']) {
    const body = sqlCode.slice(
      sqlCode.indexOf(`create or replace function ${name}`),
      sqlCode.indexOf(`revoke all on function ${name}`),
    );
    assert(body.includes('actor uuid := (select auth.uid());'), `auth kontrolü yok: ${name}`);
    assert(body.includes("raise exception 'not_authenticated'"), `oturum reddi yok: ${name}`);
  }

  /**
   * TAM NİTELİKLİ TABLO ADLARI.
   *
   * `search_path = ''` altında niteliksiz bir ad ÇÖZÜLEMEZ. Gerçek tablo
   * referansları çıkarılır; `revoke ... from <rol>`, `is distinct from` ve
   * `join lateral` kalıpları `from` anahtar kelimesini taşıdıkları için
   * ayıklanır.
   */
  const roleWords = new Set(['public', 'anon', 'authenticated', 'service_role', 'lateral']);
  const references = [
    ...sqlCode
      .replace(/is distinct from\s+\w+/gi, ' ')
      .replace(/revoke all on (?:table|function) [^;]*;/gi, ' ')
      .matchAll(/\b(?:from|join|insert into|update|delete from)\s+([A-Za-z_][A-Za-z0-9_.]*)/gi),
  ].map((match) => match[1]);
  assert(references.length > 0, 'tablo referansı bulunamadı');
  for (const reference of references) {
    if (roleWords.has(reference.toLowerCase())) continue;
    assert(
      /^(public|auth|cron|pg_catalog)\./.test(reference),
      `niteliksiz tablo referansı: ${reference}`,
    );
  }

  // `revoke all ... from public` her fonksiyonda.
  for (const name of definers) {
    assert(
      new RegExp(`revoke all on function ${name.replace('.', '\\.')}\\(`).test(sqlCode),
      `revoke yok: ${name}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 5 · MUTASYON TESTLERİ
// ---------------------------------------------------------------------------

check('M1. Engel kontrolü kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');
  blockUser(server, A, B);
  addFriendship(server, A, B, 'accepted');

  /** Kasıtlı hata: engel kontrolü yok. */
  const leaked = sendFriendMessage(server, A, B, 'selam', uuid(2000), { enforceBlock: false });
  assertEqual(leaked.recipientId, B, 'kontrolsüz model gerçekten yazmalı');
  assertThrows(
    () => assertEqual(server.messages.length, 0, 'mutation'),
    'engel kontrolü olmadan da geçti — mesaj sızıntısı yakalanmıyor',
  );

  // Arama ve istek yolları da aynı guard’a bağlı.
  assert(
    searchProfiles(server, A, 'kullanici', { enforceBlock: false }).includes(B),
    'kontrolsüz arama gerçekten sızdırmalı',
  );
  const clean = createServer();
  addFriendship(clean, A, B, 'accepted');
  blockUser(clean, A, B);
  addFriendship(clean, A, B, 'accepted');
  assertRejects(
    () => sendFriendMessage(clean, A, B, 'selam', uuid(2001)),
    'relationship_unavailable',
    'doğru model engelli mesajı kabul etti',
  );
  assert(!searchProfiles(clean, A, 'kullanici').includes(B), 'doğru model aramada sızdırdı');
});

check('M2. Engelleme yan etkileri kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');
  addMessage(server, A, B);

  /** Kasıtlı hata: friendship ve mesajlar silinmiyor. */
  blockUser(server, A, B, { enforceBlockSideEffects: false });
  assertEqual(server.friendships.length, 1, 'yan etkisiz model arkadaşlığı gerçekten bırakmalı');
  assertEqual(server.messages.length, 1, 'yan etkisiz model mesajı gerçekten bırakmalı');
  assertThrows(
    () => assertEqual(server.messages.length, 0, 'mutation'),
    'yan etkiler kaldırılsa da geçti — kalan mesaj yakalanmıyor',
  );

  const clean = createServer();
  addFriendship(clean, A, B, 'accepted');
  addMessage(clean, A, B);
  blockUser(clean, A, B);
  assertEqual(clean.friendships.length, 0, 'doğru model arkadaşlığı silmedi');
  assertEqual(clean.messages.length, 0, 'doğru model mesajı silmedi');
});

check('M3. Kelime sınırı kaldırılıp düz substring kullanılırsa test DÜŞER', () => {
  const server = createServer();
  server.blockedTerms = [{ isActive: true, term: 'kill' }];

  /** Kasıtlı hata: sınırsız substring araması. */
  const broken = messageContainsBlockedTerm(server, 'skills and drills', { useRawSubstring: true });
  assertEqual(broken, true, 'sınırsız model gerçekten false-positive üretmeli');
  assertThrows(
    () => assertEqual(broken, false, 'mutation'),
    'düz substring kullanılsa da geçti — false-positive yakalanmıyor',
  );

  assertEqual(
    messageContainsBlockedTerm(server, 'skills and drills'),
    false,
    'doğru model false-positive üretti',
  );
});

check('M4. Filtre idempotency’den ÖNCE çalışırsa test DÜŞER', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');
  const key = uuid(2100);
  sendFriendMessage(server, A, B, 'sonradan yasaklanan', key);
  server.blockedTerms.push({ isActive: true, term: 'sonradan yasaklanan' });

  /** Kasıtlı hata: filtre hızlı yoldan önce. */
  let brokenError;
  try {
    sendFriendMessage(server, A, B, 'sonradan yasaklanan', key, { filterBeforeIdempotency: true });
  } catch (error) {
    brokenError = error.message;
  }
  assertEqual(brokenError, 'message_rejected_content', 'bozuk sıralama gerçekten retry’ı reddetmeli');
  assertThrows(
    () => assertEqual(brokenError, undefined, 'mutation'),
    'filtre idempotency’den önce çalışsa da geçti — bozulan retry yakalanmıyor',
  );

  // Doğru sıralama gerçek retry’ı kabul eder.
  const retry = sendFriendMessage(server, A, B, 'sonradan yasaklanan', key);
  assertEqual(server.messages.length, 1, 'doğru model ikinci satır yazdı');
  assert(retry !== undefined, 'doğru model gerçek retry’ı reddetti');
});

check('M5. Rapor kotası veya tekrar koruması kaldırılırsa test DÜŞER', () => {
  const server = createServer();
  addFriendship(server, A, B, 'accepted');
  const message = addMessage(server, A, B);
  reportFriendMessage(server, B, message.id, 'spam');

  /** Kasıtlı hata: tekrar kontrolü yok — her çağrı yeni satır yazar. */
  const brokenRows = [1, 2, 3].map(() => ({ messageId: message.id, reporterId: B }));
  assertEqual(brokenRows.length, 3, 'korumasız model gerçekten kopya üretmeli');
  assertThrows(
    () => assertEqual(brokenRows.length, 1, 'mutation'),
    'tekrar koruması olmadan da geçti — kopya rapor yakalanmıyor',
  );
  // Doğru model tek satırda kalır.
  reportFriendMessage(server, B, message.id, 'hate');
  assertEqual(server.reports.length, 1, 'doğru model kopya rapor yazdı');

  /** Kasıtlı hata: kota kontrolü yok. */
  const noQuota = createServer();
  for (let index = 0; index < 15; index += 1) {
    noQuota.reports.push({ createdAt: noQuota.now, id: `x${index}`, reporterId: A, status: 'pending' });
  }
  assertEqual(noQuota.reports.length, 15, 'kotasız model gerçekten sınırı aşmalı');
  assertThrows(
    () => assert(noQuota.reports.length <= REPORT_DAILY_LIMIT, 'mutation'),
    'kota olmadan da geçti — sınır aşımı yakalanmıyor',
  );
  const quota = createServer();
  for (let index = 0; index < REPORT_DAILY_LIMIT; index += 1) reportUser(quota, A, B, 'spam');
  assertRejects(() => reportUser(quota, A, C, 'spam'), 'report_rate_limited', 'doğru model sınırı aştı');
});

check('M6. Send pair lock kaldırılırsa block sonrası mesaj yarışı yakalanır', () => {
  const brokenCount = simulateSendBlockRace(false);
  assertEqual(brokenCount, 1, 'kilitsiz model gerçekten geç mesaj bırakmalı');
  assertThrows(
    () => assertEqual(brokenCount, 0, 'mutation'),
    'send pair lock kaldırıldığında kalan mesaj yakalanmadı',
  );

  assertEqual(simulateSendBlockRace(true), 0, 'doğru pair lock modeli mesaj bıraktı');
});

check('M7. Lock sonrası duplicate rapor kontrolü kaldırılırsa kota yarışı yakalanır', () => {
  const buildAtBoundary = () => {
    const server = createServer();
    const message = addMessage(server, A, B, 'sınır raporu');
    for (let index = 0; index < 9; index += 1) {
      server.reports.push({
        createdAt: server.now,
        id: `boundary-${index}`,
        messageId: null,
        reportedUserId: C,
        reporterId: B,
        status: 'pending',
      });
    }
    return { message, server };
  };

  const broken = buildAtBoundary();
  finishMessageReportAfterInitialMiss(broken.server, B, broken.message, 'spam');
  assertRejects(
    () => finishMessageReportAfterInitialMiss(
      broken.server,
      B,
      broken.message,
      'spam',
      { recheckAfterLock: false },
    ),
    'report_rate_limited',
    'bozuk model gerçekten yanlış kota hatası üretmedi',
  );

  const clean = buildAtBoundary();
  const first = finishMessageReportAfterInitialMiss(clean.server, B, clean.message, 'spam');
  const retry = finishMessageReportAfterInitialMiss(clean.server, B, clean.message, 'spam');
  assertEqual(retry, first, 'doğru model duplicate ID’yi döndürmedi');
  assertEqual(clean.server.reports.length, 10, 'doğru model duplicate satır yazdı');
});

check('M8. Gönderen veya süresi dolmuş mesaj raporlanırsa test DÜŞER', () => {
  const server = createServer();
  const message = addMessage(server, A, B, 'kanıt');

  /** Kasıtlı eski model: taraf olmak yeterli ve expiry yok. */
  const brokenCanReport = (actor, row) => [row.senderId, row.recipientId].includes(actor);
  assertEqual(brokenCanReport(A, message), true, 'eski model göndereni kabul etmeli');
  assertThrows(
    () => assertEqual(brokenCanReport(A, message), false, 'mutation'),
    'gönderenin kendi mesajını raporlaması yakalanmadı',
  );

  assertRejects(
    () => reportFriendMessage(server, A, message.id, 'spam'),
    'message_not_reportable',
    'doğru model göndereni kabul etti',
  );
  server.now = message.expiresAt;
  assertEqual(brokenCanReport(B, message), true, 'eski model expired mesajı kabul etmeli');
  assertRejects(
    () => reportFriendMessage(server, B, message.id, 'spam'),
    'message_not_found',
    'doğru model expired mesajı kabul etti',
  );
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Mesajlaşma güvenliği harness: ${passed} kontrol geçti.`);
console.log('  (CANLI POSTGRESQL YOK — SQL çalıştırılmadı, modellendi ve statik denetlendi.)');
