#!/usr/bin/env node
/**
 * ACHIEVEMENT SENKRON TETİKLEME SÖZLEŞMESİ — DAR KAPSAMLI HARNESS
 *
 * Coach (wise_counsel) ve ilk mesaj (first_message) başarımlarının senkronu:
 *   * kullanıcı eyleminin BAŞARILI sonucundan sonra TEK kez tetiklenir,
 *   * FIRE-AND-FORGET'tir (await EDİLMEZ) → senkron hatası/gecikmesi ana coach/
 *     mesaj işlemini bozmaz veya başarısız göstermez,
 *   * optional chaining ile çağrılır (provider yoksa güvenli no-op),
 *   * effect/callback bağımlılığında `achievementSync` bulunur → oturum
 *     değişiminde eski closure kullanılmaz ve ESLint uyarısı kalmaz,
 *   * context tarafında `requestSync` DEBOUNCE + COALESCE + TEK-UÇUŞ olduğundan
 *     hızlı çok sayıda tetik TEK sync'te birleşir (çift gönderim yok).
 *
 * Canlı render YOKTUR: kaynak dosyalar statik denetlenir.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const coach = source('app/(tabs)/coach.tsx');
const messages = source('app/messages/[userId].tsx');
const context = source('context/achievement-context.tsx');

/** Bir `const <name> = useCallback(... )` gövdesini deps dizisine kadar ayıklar. */
function callbackBlock(code, declStart) {
  const start = code.indexOf(declStart);
  assert(start >= 0, `${declStart} bulunamadı`);
  // Callback gövdesinin kapanışı: `}, [ ... ]);`
  const depsIdx = code.indexOf('}, [', start);
  assert(depsIdx >= 0, `${declStart} deps dizisi bulunamadı`);
  const depsEnd = code.indexOf(']);', depsIdx);
  return { body: code.slice(start, depsIdx), deps: code.slice(depsIdx, depsEnd + 3) };
}

// ---------------------------------------------------------------------------
// 1 · Context: requestSync stabil + debounce/coalesce/tek-uçuş
// ---------------------------------------------------------------------------
check('1. Context requestSync stabil useCallback + debounce/coalesce/tek-uçuş', () => {
  assert(/const requestSync = useCallback\(/.test(context), 'requestSync useCallback değil (stabil değil)');
  // Debounce: setTimeout + debounceTimerRef temizliği.
  assert(/debounceTimerRef\.current\)\s*clearTimeout\(debounceTimerRef\.current\)/.test(context), 'requestSync debounce temizliği yok');
  assert(/setTimeout\(\(\) => \{[\s\S]*?void runSync\(\)/.test(context), 'requestSync debounce ile runSync çağırmıyor');
  // Coalesce + tek-uçuş: uçuştaki sync varken kuyruğa alınır, biter bitmez tek tekrar.
  assert(/if \(syncInFlightRef\.current\) \{[\s\S]*?syncQueuedRef\.current = true;[\s\S]*?return;/.test(context), 'runSync tek-uçuş/coalesce kilidi yok');
  // Değer memoize; requestSync context value'sunda AYNEN taşınır (stabil referans).
  assert(/value = useMemo<AchievementContextValue>\([\s\S]*?requestSync,/.test(context), 'requestSync context value içinde taşınmıyor');
  // Senkron hatası ana akışı bozmaz: catch yalnız durumu unavailable yapar.
  assert(/catch \{[\s\S]*?setStatus\(\(prev\) => \(prev === 'ready' \? 'ready' : 'unavailable'\)\)/.test(context), 'runSync hatası nötr durum yerine akışı bozuyor olabilir');
});

// ---------------------------------------------------------------------------
// 2 · Coach: wise_counsel senkronu — tek, fire-and-forget, deps'te
// ---------------------------------------------------------------------------
check('2. Coach deliverMessage: tek fire-and-forget achievementSync, deps eksiksiz', () => {
  assert(/const achievementSync = useOptionalAchievements\(\)\?\.requestSync/.test(coach), 'coach achievementSync opsiyonel (failsafe) alınmıyor');
  const { body, deps } = callbackBlock(coach, 'const deliverMessage = useCallback(');
  // TEK çağrı, optional chaining ile.
  assert((body.match(/achievementSync\?\.\(\)/g) ?? []).length === 1, 'coach achievementSync tam bir kez çağrılmıyor');
  // FIRE-AND-FORGET: await edilmez.
  assert(!/await\s+achievementSync/.test(body), 'coach achievementSync await ediliyor (ana işlemi bloke edebilir)');
  // BAŞARI yolunda: sendCoachMessage'dan SONRA, catch'ten ÖNCE.
  const okIdx = body.indexOf('await sendCoachMessage(');
  const syncIdx = body.indexOf('achievementSync?.()');
  const catchIdx = body.indexOf('} catch (');
  assert(okIdx >= 0 && syncIdx > okIdx, 'coach senkronu başarılı yanıttan sonra tetiklenmiyor');
  assert(catchIdx >= 0 && syncIdx < catchIdx, 'coach senkronu hata (catch) yolunda tetikleniyor');
  // Deps'te achievementSync var (eski closure yok, ESLint temiz).
  assert(/achievementSync/.test(deps), 'coach deliverMessage deps achievementSync içermiyor (stale closure / lint uyarısı)');
});

// ---------------------------------------------------------------------------
// 3 · Mesaj: first_message senkronu — tek, fire-and-forget, owner-guard'lı, deps'te
// ---------------------------------------------------------------------------
check('3. Mesaj send: tek fire-and-forget achievementSync, owner-guard, deps eksiksiz', () => {
  assert(/const achievementSync = useOptionalAchievements\(\)\?\.requestSync/.test(messages), 'mesaj achievementSync opsiyonel (failsafe) alınmıyor');
  const { body, deps } = callbackBlock(messages, 'const send = useCallback(');
  assert((body.match(/achievementSync\?\.\(\)/g) ?? []).length === 1, 'mesaj achievementSync tam bir kez çağrılmıyor');
  assert(!/await\s+achievementSync/.test(body), 'mesaj achievementSync await ediliyor (ana işlemi bloke edebilir)');
  const okIdx = body.indexOf('await sendFriendMessage(');
  const guardIdx = body.indexOf('owner !== conversationRef.current) return;');
  const syncIdx = body.indexOf('achievementSync?.()');
  const catchIdx = body.indexOf('} catch (');
  assert(okIdx >= 0 && syncIdx > okIdx, 'mesaj senkronu başarılı gönderimden sonra tetiklenmiyor');
  assert(guardIdx >= 0 && syncIdx > guardIdx, 'mesaj senkronu owner-guard sonrası tetiklenmiyor (stale sonuç riski)');
  assert(catchIdx >= 0 && syncIdx < catchIdx, 'mesaj senkronu hata (catch) yolunda tetikleniyor');
  assert(/achievementSync/.test(deps), 'mesaj send deps achievementSync içermiyor (stale closure / lint uyarısı)');
});

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Achievement senkron tetikleme harness: ${passed} kontrol geçti.`);
console.log('  (Canlı render yok — kaynak dosyalar statik olarak denetlendi.)');
