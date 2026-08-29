#!/usr/bin/env node
/**
 * Arkadaş mesaj güvenliği istemci doğrulamaları.
 *
 * Canlı Supabase kullanmaz. İstemcinin yalnızca migration tarafından sunulan
 * RPC yüzeyine bağlandığını ve rapor/engel kaldırma akışlarının kapsamını
 * kaynak üzerinden denetler.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (path) => readFileSync(join(ROOT, path), 'utf8');

const service = source('services/safety.ts');
const chat = source('app/messages/[userId].tsx');
const blocked = source('app/blocked-users.tsx');
const sheet = source('components/friends/report-sheet.tsx');
const settings = source('app/settings.tsx');
const layout = source('app/_layout.tsx');
const messages = source('services/messages.ts');
const tr = source('locales/tr.ts');
const en = source('locales/en.ts');

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

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

check('1. Güvenlik servisi yalnızca RPC yüzeyini kullanıyor', () => {
  for (const rpc of [
    'block_user',
    'unblock_user',
    'list_blocked_users',
    'report_friend_message',
    'report_user',
  ]) {
    assert(service.includes(`supabase.rpc('${rpc}'`), `${rpc} bağlantısı eksik`);
  }
  assert(!/\.from\(['"](?:user_blocks|user_content_reports|message_blocked_terms)['"]\)/.test(service),
    'korunan tablolara doğrudan erişim var');
});

check('2. Servis kimlik ve cevap doğrulaması yapıyor', () => {
  assert(service.includes('UUID_PATTERN'), 'UUID doğrulaması eksik');
  assert(service.includes("throw new Error('invalid_report_response')"), 'rapor cevabı doğrulanmıyor');
  assert(service.includes('.filter((row): row is BlockedUser => row !== undefined)'),
    'engellenen kullanıcı satırları doğrulanmıyor');
});

check('3. Açıklama sınırı sunucuyla aynı: 1000 karakter', () => {
  assert(service.includes('SAFETY_REPORT_DETAILS_MAX_LENGTH = 1000'), 'servis sınırı 1000 değil');
  assert(sheet.includes('maxLength={SAFETY_REPORT_DETAILS_MAX_LENGTH}'), 'alan maxLength kullanmıyor');
  assert(sheet.includes('details.length}/{SAFETY_REPORT_DETAILS_MAX_LENGTH}'), 'sayaç eksik');
});

check('4. Altı rapor kategorisi eksiksiz', () => {
  for (const category of ['harassment', 'hate', 'sexual', 'violence', 'spam', 'other']) {
    assert(sheet.includes(`'${category}'`), `${category} kategorisi eksik`);
    assert(tr.includes(`${category}:`), `TR ${category} çevirisi eksik`);
    assert(en.includes(`${category}:`), `EN ${category} çevirisi eksik`);
  }
});

check('5. Kendi mesajı şikâyet edilemiyor', () => {
  assert(chat.includes('disabled={isOwn}'), 'kendi mesajının uzun basması kapalı değil');
  assert(chat.includes("onLongPress={() => setReportTarget({ kind: 'message'"),
    'mesaj uzun basma rapor yoluna bağlı değil');
});

check('6. Kullanıcı raporu sohbet güvenlik menüsünden açılıyor', () => {
  assert(chat.includes("setReportTarget({ kind: 'user' })"), 'kullanıcı raporu hedefi eksik');
  assert(chat.includes("reportUser(counterpartId, category, details)"), 'kullanıcı rapor RPC yolu eksik');
});

check('7. Rapor gönderimi senkron kilitle korunuyor', () => {
  assert(chat.includes('if (!counterpartId || !reportTarget || reportPendingRef.current) return;'),
    'çift gönderim kilidi eksik');
  assert(chat.includes('reportPendingRef.current = true;'), 'kilit açılmadan RPC başlıyor');
  assert(chat.includes('owner === conversationRef.current'), 'konuşma sahipliği denetlenmiyor');
});

check('8. Rapor formu gönderim sırasında kapanmıyor', () => {
  assert(sheet.includes('onRequestClose={isSubmitting ? undefined : onClose}'),
    'sistem kapatma hareketi gönderimde açık');
  assert(sheet.includes('disabled={isSubmitting}'), 'form eylemleri gönderimde kapanmıyor');
});

check('9. İçerik filtresi hatası ayrı kullanıcı mesajına çevriliyor', () => {
  assert(messages.includes('FRIEND_MESSAGE_REJECTED_CONTENT'), 'filtre hata sabiti eksik');
  assert(messages.includes('isFriendMessageRejectedContent'), 'filtre hata okuyucusu eksik');
  assert(chat.includes("? 'rejected-content'"), 'sohbet hata eşlemesi eksik');
  assert(tr.includes('rejectedContent:'), 'TR filtre açıklaması eksik');
  assert(en.includes('rejectedContent:'), 'EN filtre açıklaması eksik');
});

check('10. Engel varlığı arkadaşlık ayrıntısını sızdırmıyor', () => {
  assert(messages.includes('FRIEND_MESSAGE_RELATIONSHIP_UNAVAILABLE'), 'genel ilişki hatası eksik');
  assert(messages.includes('message.includes(FRIEND_MESSAGE_RELATIONSHIP_UNAVAILABLE)'),
    'genel ilişki hatası sohbet kapanışına bağlanmamış');
});

check('11. Engellenenler ekranı yalnızca listeleme ve engel kaldırma yapıyor', () => {
  assert(blocked.includes('listBlockedUsers'), 'listeleme eksik');
  assert(blocked.includes('await unblockUser(user.id)'), 'engel kaldırma eksik');
  assert(!/(?<!un)blockUser\(/.test(blocked), 'liste ekranı yeni engel oluşturmamalı');
});

check('12. Engel kaldırma, geri gelmeyen arkadaşlığı açıklıyor', () => {
  assert(tr.includes("Eski arkadaşlık geri gelmez"), 'TR geri döndürülemez ilişki açıklaması eksik');
  assert(en.includes("The previous friendship will not return"), 'EN geri döndürülemez ilişki açıklaması eksik');
});

check('13. Engellenenler rotası Ayarlar ve kök Stack içinde', () => {
  assert(settings.includes("router.push('/blocked-users')"), 'Ayarlar bağlantısı eksik');
  assert(layout.includes('<Stack.Screen name="blocked-users"'), 'kök Stack rotası eksik');
});

check('14. Engellenenler yüklemesi geç cevapları reddediyor', () => {
  assert(blocked.includes('const loadIdRef = useRef(0)'), 'yükleme nesli eksik');
  assert(count(blocked, 'loadIdRef.current !== loadId') >= 1, 'başarı sahipliği korunmuyor');
  assert(blocked.includes('loadIdRef.current === loadId'), 'hata sahipliği korunmuyor');
  assert(blocked.includes('loadIdRef.current += 1;'), 'ekran kapanışında yükleme geçersizleşmiyor');
});

check('15. Engelleme iki adımlı ve geri alınamaz sonucu açık', () => {
  assert(chat.includes("text: t('safety.blockUser'), onPress: confirmBlock, style: 'destructive'"),
    'güvenlik menüsündeki yıkıcı engelle eylemi eksik');
  assert(chat.includes("Alert.alert(t('safety.blockTitle'), t('safety.blockBody'"),
    'ikinci onay iletişim kutusu eksik');
  assert(chat.includes('await blockUser(counterpartId)'), 'engelleme RPC yolu bağlı değil');
  assert(chat.includes("router.replace('/messages')"), 'başarılı engelleme sohbetten çıkmıyor');
  assert(tr.includes('Bu işlem geri alınamaz'), 'TR geri alınamaz uyarısı eksik');
  assert(en.includes('This cannot be undone'), 'EN geri alınamaz uyarısı eksik');
});

check('16. Rapor metinleri iki dilde tamam', () => {
  for (const key of [
    'reportUserTitle',
    'reportMessageTitle',
    'reportPrivateNote',
    'submitReport',
    'reportSentTitle',
    'reportRateLimited',
    'messageUnavailable',
    'blockSuccessTitle',
    'blockedUsers',
    'unblockTitle',
  ]) {
    assert(tr.includes(`${key}:`), `TR ${key} eksik`);
    assert(en.includes(`${key}:`), `EN ${key} eksik`);
  }
});

if (failures.length > 0) {
  console.error(`✗ ${failures.length} kontrol başarısız:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ ${passed} kontrol geçti`);
