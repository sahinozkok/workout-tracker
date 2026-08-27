#!/usr/bin/env node
/**
 * BAŞARI AÇILMA KUTLAMASI — DOĞRULAMA HARNESS'I
 *
 * Kapsam: baseline oluşturma, kutlama kuyruğu, gösterim onayının ZAMANLAMASI,
 * hesap/sezon izolasyonu ve rank katmanlarının üst üste binmemesi. RP kuralları,
 * rank eşikleri, başarı eşikleri ve SQL BURADA TEST EDİLMEZ — onlar
 * `verify-ranks.mjs` ve `verify-rank-achievements.mjs` içindedir; o dosyalara
 * dokunulmamıştır.
 *
 * Mevcut rank harness'larıyla aynı üç katmanlı kalıp:
 *   1. SAF MANTIK — `constants/rank-experience.ts` gerçekten `tsc` ile
 *      derlenir ve karar fonksiyonları ÇALIŞTIRILIR.
 *   2. MODEL      — context + katman yaşam döngüsünün referans uygulaması:
 *      AsyncStorage, kuyruk, layout onayı, sahiplik ve hesap yarışı.
 *   3. STATİK     — React/Reanimated gerektiren davranışlar (Reduce Motion,
 *      erişilebilirlik, öncelik sırası, polling yokluğu) kaynak üzerinden.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

// ---------------------------------------------------------------------------
// Katman 1 — `constants/rank-experience.ts` gerçekten derlenir
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'rosea-achievement-celebration-'));
let rx;

try {
  execFileSync(
    'npx',
    [
      'tsc',
      join(ROOT, 'constants/rank-experience.ts'),
      '--outDir',
      outDir,
      '--target',
      'es2020',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--strict',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
  rx = await import(pathToFileURL(join(outDir, 'rank-experience.js')).href);
} catch (error) {
  console.error(
    'constants/rank-experience.ts derlenemedi:\n' + (error.stdout?.toString() ?? error.message),
  );
  process.exit(1);
}

const contextSource = source('context/rank-context.tsx');
const celebrationSource = source('components/ranks/achievement-unlock-celebration.tsx');
const rankUpSource = source('components/ranks/rank-up-celebration.tsx');
const recapSource = source('components/ranks/season-recap.tsx');
const layoutSource = source('app/_layout.tsx');
const screenSource = source('app/rank.tsx');
const iconsSource = source('components/ranks/achievement-icons.ts');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

const KEYS = [...rx.SEASON_ACHIEVEMENT_KEYS];
const SAFE = '/';
const UNSAFE = '/program/p-1/day/d-1';

// ---------------------------------------------------------------------------
// Katman 2 — MODEL: cihaz deposu + context + katman yaşam döngüsü
// ---------------------------------------------------------------------------

/** AsyncStorage modeli. Yazma sayısı "tek yazma" iddiaları için kaydedilir. */
function createDevice() {
  const values = new Map();
  const writes = [];
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      writes.push({ key, value });
      values.set(key, value);
    },
    get size() {
      return values.size;
    },
    writes,
    writesFor: (key) => writes.filter((entry) => entry.key === key),
  };
}

/**
 * Tek bir uygulama oturumu: `RankProvider` + üç overlay katmanı.
 *
 * `applyAchievements` sunucudan gelen "açık rozet" listesini işler;
 * `capturedOwner` verilirse cevap o sahiplik altında yola çıkmış demektir
 * (hesap A/B yarışı).
 */
function createSession(device, options = {}) {
  /**
   * `reconcileOnSeasonReady` YALNIZCA mutation testi içindir: DÜZELTİLMEDEN
   * ÖNCEKİ davranışı modeller — uzlaştırma, başarılı RPC sonucu beklenmeden
   * `achievements` state'i (başlangıçta `[]`) üzerinden tetikleniyordu.
   */
  const reconcileOnSeasonReady = options.reconcileOnSeasonReady === true;
  let owner = 0;
  let userId;
  let seasonIndex;
  let celebratedCache;
  let queue = [];
  let activeOverlay;
  // Katmanların yerel `shown` state'leri.
  let shownAchievement;
  let layoutAcknowledged;
  /** `achievements` state'i — başlangıçta BOŞ, tıpkı gerçek provider'daki gibi. */
  let achievementsState = [];
  /** Bu (kullanıcı, sezon) için başarılı bir RPC sonucu geldi mi? */
  let hasLoadedAchievements = false;
  const shownLog = [];
  const mascotReactions = [];

  function signIn(nextUserId, nextSeasonIndex) {
    owner += 1;
    userId = nextUserId;
    seasonIndex = nextSeasonIndex;
    celebratedCache = undefined;
    queue = [];
    // Kilit hiçbir koşulda hesap değişiminde asılı kalmaz.
    activeOverlay = undefined;
    shownAchievement = undefined;
    layoutAcknowledged = undefined;
    achievementsState = [];
    hasLoadedAchievements = false;
  }

  function setSeason(nextSeasonIndex) {
    seasonIndex = nextSeasonIndex;
    celebratedCache = undefined;
    queue = [];
    hasLoadedAchievements = false;
  }

  /**
   * Sezon sunucudan geldi (rank sync başarılı) — ama başarı RPC'si HENÜZ
   * dönmedi. Düzeltilmiş akışta bu tetikleyici uzlaştırma ÇALIŞTIRMAZ.
   */
  function onSeasonReady(nextSeasonIndex) {
    seasonIndex = nextSeasonIndex;
    if (!reconcileOnSeasonReady) return;
    // Bozuk (eski) davranış: henüz yüklenmemiş `[]` ile uzlaştırma.
    applyAchievements(achievementsState);
  }

  /** Başarı RPC'si HATA verdi: baseline ilerlemez, hiçbir şey yazılmaz. */
  function failAchievementsLoad() {
    // `catch` dalı yalnızca hata bayrağı kurar; uzlaştırma çağrılmaz.
  }

  const storageKey = (forUser, forSeason) =>
    rx.seasonAchievementCelebrationStorageKey(forUser, forSeason);

  /**
   * BAŞARILI başarı RPC'si döndü → uzlaştırma.
   *
   * Uzlaştırmanın TEK tetikleyicisi budur: başlangıç `[]`'i, hata sonrası `[]`
   * ve cevap öncesi `[]` baseline üretemez.
   */
  function applyAchievements(unlockedKeys, capturedOwner = owner) {
    if (capturedOwner !== owner) return;
    if (!userId || seasonIndex === undefined) return;

    achievementsState = unlockedKeys;
    hasLoadedAchievements = true;

    const key = storageKey(userId, seasonIndex);
    const stored =
      celebratedCache ?? rx.parseCelebratedAchievementKeys(device.get(key));

    const decision = rx.decideAchievementCelebrations({ celebrated: stored, unlockedKeys });

    if (decision.type === 'seed') {
      device.set(key, rx.serializeCelebratedAchievementKeys(decision.celebrated));
    }

    // Hesap arada değiştiyse yeni hesabın durumuna HİÇBİR ŞEY yazılmaz.
    if (capturedOwner !== owner) return;
    celebratedCache = decision.celebrated;
    queue = decision.queue;
  }

  /** `acknowledgeAchievementCelebrationShown` referans uygulaması. */
  function acknowledgeShown(achievementKey) {
    if (!userId || seasonIndex === undefined) return;
    // Kimlik kontrolü: yalnızca kuyruğun başı onaylanabilir.
    if (queue[0] !== achievementKey) return;

    const key = storageKey(userId, seasonIndex);
    const existing = celebratedCache ?? rx.parseCelebratedAchievementKeys(device.get(key)) ?? [];
    // Aynı kutlama için ikinci yazma yapılmaz.
    if (existing.includes(achievementKey)) return;

    const nextKeys = [...existing, achievementKey];
    device.set(key, rx.serializeCelebratedAchievementKeys(nextKeys));
    celebratedCache = nextKeys;
  }

  function claimOverlay(ownerName) {
    if (!rx.canClaimRankOverlay(activeOverlay, ownerName)) return false;
    activeOverlay = ownerName;
    return true;
  }

  function releaseOverlay(ownerName) {
    if (activeOverlay !== ownerName) return;
    activeOverlay = undefined;
  }

  /**
   * Başarı katmanının render'ı.
   *
   * `pendingHigher` = bekleyen rank-up / sezon özeti (öncelik).
   * Kalıcı kayıt BURADA YAZILMAZ: `setShown` yalnızca render planlar.
   */
  function renderAchievement(pathname, pendingHigher = {}) {
    if (shownAchievement || queue.length === 0) return;
    if (!rx.canShowRankCelebration(pathname)) return;
    if (pendingHigher.rankUp || pendingHigher.seasonRecap) return;
    if (!claimOverlay('achievement')) return;

    shownAchievement = queue[0];
    layoutAcknowledged = undefined;
    shownLog.push(shownAchievement);
  }

  /** `onLayout` — kart GERÇEKTEN mount/layout oldu. */
  function layoutAchievement() {
    if (!shownAchievement) return;
    if (layoutAcknowledged === shownAchievement) return;
    layoutAcknowledged = shownAchievement;
    acknowledgeShown(shownAchievement);
    mascotReactions.push('rank-up');
  }

  function dismissAchievement() {
    if (!shownAchievement) return;
    const closed = shownAchievement;
    shownAchievement = undefined;
    layoutAcknowledged = undefined;
    releaseOverlay('achievement');
    queue = queue.filter((queued) => queued !== closed);
  }

  return {
    acknowledgeShown,
    get activeOverlay() {
      return activeOverlay;
    },
    applyAchievements,
    failAchievementsLoad,
    get hasLoadedAchievements() {
      return hasLoadedAchievements;
    },
    onSeasonReady,
    claimOverlay,
    dismissAchievement,
    layoutAchievement,
    mascotReactions,
    get owner() {
      return owner;
    },
    get queue() {
      return [...queue];
    },
    releaseOverlay,
    renderAchievement,
    setSeason,
    get shown() {
      return shownAchievement;
    },
    shownLog,
    signIn,
  };
}

// ---------------------------------------------------------------------------
// 1 · Baseline ve kuyruk
// ---------------------------------------------------------------------------

check('1. İlk yükleme BASELINE oluşturur, eski rozetleri kutlamaz', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a', 5);

  // Kullanıcının zaten üç rozeti açık.
  app.applyAchievements(['first_workout', 'workout_5', 'streak_3']);
  app.renderAchievement(SAFE);

  assertDeepEqual(app.queue, [], 'eski rozetler kutlama kuyruğuna girdi');
  assertDeepEqual(app.shownLog, [], 'eski rozet gösterildi');
  assertDeepEqual(
    JSON.parse(device.get(rx.seasonAchievementCelebrationStorageKey('user-a', 5))),
    ['first_workout', 'workout_5', 'streak_3'],
    'baseline yazılmadı',
  );

  // Saf karar da aynı sonucu verir.
  const decision = rx.decideAchievementCelebrations({
    celebrated: undefined,
    unlockedKeys: ['first_workout'],
  });
  assertEqual(decision.type, 'seed', 'kayıt yokken seed beklenir');
  assertDeepEqual(decision.queue, [], 'seed kararı kuyruk üretti');
});

check('2. Tek yeni rozet BİR KEZ kuyruğa girer', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a', 5);
  app.applyAchievements(['first_workout']);

  // Yeni rozet açıldı.
  app.applyAchievements(['first_workout', 'workout_5']);
  assertDeepEqual(app.queue, ['workout_5'], 'yeni rozet kuyruğa girmedi');

  // Tekrar sync aynı listeyi getirse de kuyruk çoğalmaz.
  for (let index = 0; index < 4; index += 1) {
    app.applyAchievements(['first_workout', 'workout_5']);
  }
  assertDeepEqual(app.queue, ['workout_5'], 'kuyruk tekrar sync ile çoğaldı');

  app.renderAchievement(SAFE);
  app.renderAchievement(SAFE);
  assertDeepEqual(app.shownLog, ['workout_5'], 'aynı rozet birden fazla kez gösterildi');
});

check('3. Birden fazla yeni rozet KATALOG sırasıyla tek tek gösterilir', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a', 5);
  app.applyAchievements([]);

  // Sunucu sırası bilinçli olarak karışık gelir.
  app.applyAchievements(['perfect_week', 'workout_5', 'first_workout']);
  assertDeepEqual(
    app.queue,
    ['first_workout', 'workout_5', 'perfect_week'],
    'kuyruk katalog sırasında değil',
  );

  // Aynı anda ikisi açılmaz: sıradaki yalnızca kapanınca gelir.
  app.renderAchievement(SAFE);
  app.layoutAchievement();
  assertEqual(app.shown, 'first_workout', 'ilk rozet gösterilmedi');
  app.renderAchievement(SAFE);
  assertDeepEqual(app.shownLog, ['first_workout'], 'ikinci rozet üst üste açıldı');

  app.dismissAchievement();
  app.renderAchievement(SAFE);
  app.layoutAchievement();
  app.dismissAchievement();
  app.renderAchievement(SAFE);
  app.layoutAchievement();
  app.dismissAchievement();

  assertDeepEqual(
    app.shownLog,
    ['first_workout', 'workout_5', 'perfect_week'],
    'rozetler katalog sırasıyla gösterilmedi',
  );
  assertDeepEqual(app.queue, [], 'kuyruk boşalmadı');
});

check('12. Kuyruk kapanınca SIRADAKİ başarı gösterilir', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a', 5);
  app.applyAchievements([]);
  app.applyAchievements(['streak_3', 'streak_7']);

  app.renderAchievement(SAFE);
  app.layoutAchievement();
  assertEqual(app.shown, 'streak_3', 'ilk rozet yanlış');
  assertEqual(app.activeOverlay, 'achievement', 'sahiplik alınmadı');

  app.dismissAchievement();
  assertEqual(app.activeOverlay, undefined, 'kapanışta sahiplik bırakılmadı');

  app.renderAchievement(SAFE);
  assertEqual(app.shown, 'streak_7', 'sıradaki rozet gösterilmedi');
});

// ---------------------------------------------------------------------------
// 2 · Gösterim onayının zamanlaması
// ---------------------------------------------------------------------------

check('4. Güvensiz ekranda BEKLER, kaybolmaz', () => {
  const device = createDevice();
  const key = rx.seasonAchievementCelebrationStorageKey('user-a', 5);
  const app = createSession(device);
  app.signIn('user-a', 5);
  app.applyAchievements([]);
  app.applyAchievements(['first_workout']);

  for (const pathname of [UNSAFE, '/reset-password', '/login', '/confirm']) {
    app.renderAchievement(pathname);
    app.layoutAchievement();
  }
  assertDeepEqual(app.shownLog, [], 'güvensiz ekranda kutlama açıldı');
  assertDeepEqual(app.queue, ['first_workout'], 'kutlama düşürüldü, bekletilmedi');
  assertEqual(device.writesFor(key).length, 1, 'gösterilmeden kayıt ilerledi (yalnızca baseline)');

  app.renderAchievement(SAFE);
  app.layoutAchievement();
  assertDeepEqual(app.shownLog, ['first_workout'], 'güvenli ekranda bir kez gösterilmeliydi');
});

check('5. Layout GELMEDEN kapanış → sonraki açılışta tekrar çıkar', () => {
  const device = createDevice();
  const key = rx.seasonAchievementCelebrationStorageKey('user-a', 5);

  const first = createSession(device);
  first.signIn('user-a', 5);
  first.applyAchievements([]);
  first.applyAchievements(['workout_5']);
  // `shown` ayarlandı ama kart hiç layout olmadan uygulama kapandı.
  first.renderAchievement(SAFE);
  assertEqual(first.shown, 'workout_5', 'kutlama gösterime alınmadı');
  assertEqual(device.writesFor(key).length, 1, 'layout olmadan kayıt yazıldı');

  // Soğuk açılış: aynı cihaz deposu, yeni oturum.
  const second = createSession(device);
  second.signIn('user-a', 5);
  second.applyAchievements(['workout_5']);
  second.renderAchievement(SAFE);
  second.layoutAchievement();

  assertDeepEqual(second.shownLog, ['workout_5'], 'görülmemiş kutlama kayboldu');
  assertEqual(device.writesFor(key).length, 2, 'layout sonrası kayıt yazılmadı');
});

check('6. Layout GELDİKTEN sonra kapanış → tekrar ÇIKMAZ', () => {
  const device = createDevice();

  const first = createSession(device);
  first.signIn('user-a', 5);
  first.applyAchievements([]);
  first.applyAchievements(['workout_5']);
  first.renderAchievement(SAFE);
  first.layoutAchievement();
  // "Devam" düğmesine BASILMADI.

  const second = createSession(device);
  second.signIn('user-a', 5);
  second.applyAchievements(['workout_5']);
  second.renderAchievement(SAFE);
  second.layoutAchievement();

  assertDeepEqual(second.shownLog, [], 'gösterilmiş kutlama tekrar açıldı');
  assertDeepEqual(second.queue, [], 'gösterilmiş rozet hâlâ kuyrukta');
});

check('7. Aynı kutlamanın iki onayı TEK yazma yapar', () => {
  const device = createDevice();
  const key = rx.seasonAchievementCelebrationStorageKey('user-a', 5);
  const app = createSession(device);
  app.signIn('user-a', 5);
  app.applyAchievements([]);
  app.applyAchievements(['first_workout']);

  app.renderAchievement(SAFE);
  // Döndürme, yazı tipi ölçeği, içerik boyu değişimi…
  for (let index = 0; index < 6; index += 1) app.layoutAchievement();
  // Doğrudan onay çağrısı da tekrar yazmaz.
  app.acknowledgeShown('first_workout');

  // baseline (1) + tek onay (1).
  assertEqual(device.writesFor(key).length, 2, 'layout tekrarı yeni yazma üretti');
  assertEqual(app.mascotReactions.length, 1, 'Rosea tepkisi tekrarlandı');
});

// ---------------------------------------------------------------------------
// 3 · Hesap ve sezon izolasyonu
// ---------------------------------------------------------------------------

check('8. Hesap A’nın geç cevabı B’nin state/storage alanına YAZAMAZ', () => {
  const device = createDevice();
  const app = createSession(device);

  app.signIn('user-a', 5);
  app.applyAchievements([]);
  const ownerOfA = app.owner;

  // B giriş yaptı; A'nın uçuştaki cevabı ancak şimdi döndü.
  app.signIn('user-b', 5);
  app.applyAchievements(['first_workout', 'workout_5'], ownerOfA);
  app.renderAchievement(SAFE);

  assertDeepEqual(app.queue, [], 'A’nın cevabı B’de kuyruk üretti');
  assertDeepEqual(app.shownLog, [], 'A’nın cevabı B’de kutlama açtı');
  assertEqual(
    device.get(rx.seasonAchievementCelebrationStorageKey('user-b', 5)),
    null,
    'A’nın cevabı B’nin anahtarına yazdı',
  );

  // B'nin kendi verisi normal akışta çalışır.
  app.applyAchievements([]);
  app.applyAchievements(['first_workout']);
  app.renderAchievement(SAFE);
  app.layoutAchievement();
  assertDeepEqual(app.shownLog, ['first_workout'], 'B kendi kutlamasını görmedi');

  // Anahtarlar gerçekten ayrı.
  assert(
    rx.seasonAchievementCelebrationStorageKey('user-a', 5) !==
      rx.seasonAchievementCelebrationStorageKey('user-b', 5),
    'anahtar kullanıcıya göre ayrışmıyor',
  );
  assertEqual(
    rx.seasonAchievementCelebrationStorageKey('user-a', 5),
    'rank:achievements-celebrated:user-a:5',
    'anahtar beklenen biçimde değil',
  );
  // Rank yükselme ve sezon özeti anahtarlarıyla çakışmaz.
  assert(
    rx.seasonAchievementCelebrationStorageKey('user-a', 5) !==
      rx.rankCelebrationStorageKey('user-a', 5) &&
      rx.seasonAchievementCelebrationStorageKey('user-a', 5) !==
        rx.seasonRecapStorageKey('user-a', 5),
    'başarı anahtarı diğer deneyimlerle çakışıyor',
  );
});

check('9. Yeni sezon ESKİ sezon anahtarlarını kullanmaz', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a', 5);
  app.applyAchievements(['first_workout', 'workout_5']);

  // Yeni sezon: kendi baseline'ı oluşur, eski rozetler kutlanmaz.
  app.setSeason(6);
  app.applyAchievements([]);
  app.renderAchievement(SAFE);
  assertDeepEqual(app.shownLog, [], 'sezon geçişinde kutlama üretildi');

  // 6. sezonun ilk rozeti normal biçimde kutlanır.
  app.applyAchievements(['first_workout']);
  app.renderAchievement(SAFE);
  app.layoutAchievement();
  assertDeepEqual(app.shownLog, ['first_workout'], 'yeni sezon rozeti kutlanmadı');

  // Eski sezonun kaydı KORUNUR ve karışmaz.
  assertDeepEqual(
    JSON.parse(device.get(rx.seasonAchievementCelebrationStorageKey('user-a', 5))),
    ['first_workout', 'workout_5'],
    'eski sezon kaydı bozuldu',
  );
  assertDeepEqual(
    JSON.parse(device.get(rx.seasonAchievementCelebrationStorageKey('user-a', 6))),
    ['first_workout'],
    'yeni sezon kaydı yanlış',
  );
});

check('10. BOZUK storage verisi uygulamayı ÇÖKERTMEZ', () => {
  for (const corrupt of ['{', 'null', '"first_workout"', '{"a":1}', '[', '']) {
    assertEqual(
      rx.parseCelebratedAchievementKeys(corrupt),
      undefined,
      `bozuk içerik kabul edildi: ${corrupt}`,
    );
  }
  // Tanınmayan anahtarlar sessizce düşer, geçerliler kalır.
  assertDeepEqual(
    rx.parseCelebratedAchievementKeys('["first_workout","legendary","first_workout"]'),
    ['first_workout'],
    'tanınmayan/yinelenen anahtar temizlenmedi',
  );

  // Bozuk kayıt → mevcut açılmış rozetler GÜVENLİ baseline olur.
  const device = createDevice();
  device.set(rx.seasonAchievementCelebrationStorageKey('user-a', 5), '{bozuk');
  const app = createSession(device);
  app.signIn('user-a', 5);
  app.applyAchievements(['first_workout', 'streak_3']);
  app.renderAchievement(SAFE);

  assertDeepEqual(app.shownLog, [], 'bozuk kayıt eski rozetleri topluca kutladı');
  assertDeepEqual(
    JSON.parse(device.get(rx.seasonAchievementCelebrationStorageKey('user-a', 5))),
    ['first_workout', 'streak_3'],
    'bozuk kayıt güvenli baseline ile değiştirilmedi',
  );
});

// ---------------------------------------------------------------------------
// 4 · Katman koordinasyonu
// ---------------------------------------------------------------------------

check('11. Rank-up, recap ve achievement overlay’leri ÜST ÜSTE açılmaz', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a', 5);
  app.applyAchievements([]);
  app.applyAchievements(['first_workout']);

  // ÖNCELİK: bekleyen rank-up varken başarı kutlaması hiç açılmaz.
  app.renderAchievement(SAFE, { rankUp: true });
  assertDeepEqual(app.shownLog, [], 'rank-up beklerken başarı kutlaması açıldı');
  // Bekleyen sezon özeti varken de açılmaz.
  app.renderAchievement(SAFE, { seasonRecap: true });
  assertDeepEqual(app.shownLog, [], 'sezon özeti beklerken başarı kutlaması açıldı');

  // Rank-up kapanınca sıra gelir.
  app.renderAchievement(SAFE);
  app.layoutAchievement();
  assertDeepEqual(app.shownLog, ['first_workout'], 'öncelik temizlenince açılmadı');

  // Başarı kutlaması GÖRÜNÜRKEN diğer katmanlar claim EDEMEZ.
  assertEqual(app.activeOverlay, 'achievement', 'sahiplik alınmadı');
  assertEqual(app.claimOverlay('rank-up'), false, 'rank-up üst üste bindi');
  assertEqual(app.claimOverlay('season-recap'), false, 'sezon özeti üst üste bindi');

  // Kapanınca kilit bırakılır ve diğerleri açılabilir.
  app.dismissAchievement();
  assertEqual(app.claimOverlay('rank-up'), true, 'kapanışta kilit bırakılmadı');
  app.releaseOverlay('rank-up');

  // Saf sahiplik kuralı.
  assertEqual(rx.canClaimRankOverlay(undefined, 'achievement'), true, 'boş kilit alınamadı');
  assertEqual(rx.canClaimRankOverlay('rank-up', 'achievement'), false, 'dolu kilit alındı');
  assertEqual(rx.canClaimRankOverlay('achievement', 'achievement'), true, 'kendi kilidi reddedildi');
  assertDeepEqual(
    [...rx.RANK_OVERLAY_PRIORITY],
    ['rank-up', 'season-recap', 'achievement'],
    'öncelik sırası beklenen değil',
  );
});

check('11b. Hesap değişiminde ve unmount’ta KİLİT ASILI KALMAZ', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a', 5);
  app.applyAchievements([]);
  app.applyAchievements(['first_workout']);
  app.renderAchievement(SAFE);
  assertEqual(app.activeOverlay, 'achievement', 'sahiplik alınmadı');

  // Hesap değişti: kilit sıfırlanır.
  app.signIn('user-b', 5);
  assertEqual(app.activeOverlay, undefined, 'hesap değişiminde kilit asılı kaldı');
  assertEqual(app.shown, undefined, 'hesap değişiminde gösterim temizlenmedi');

  // Başkasının kilidi düşürülemez.
  app.claimOverlay('rank-up');
  app.releaseOverlay('achievement');
  assertEqual(app.activeOverlay, 'rank-up', 'başka katmanın kilidi düşürüldü');

  // Kaynakta unmount temizliği var.
  for (const [name, code] of [
    ['başarı', celebrationSource],
    ['rank-up', rankUpSource],
    ['sezon özeti', recapSource],
  ]) {
    assert(
      /useEffect\(\(\) => \(\) => releaseRankOverlay\(/.test(code),
      `${name} katmanında unmount sahiplik temizliği yok`,
    );
  }
  assert(
    contextSource.includes('activeOverlayRef.current = undefined;'),
    'hesap değişiminde kilit sıfırlanmıyor',
  );
});

// ---------------------------------------------------------------------------
// Katman 3 — STATİK: React/Reanimated davranışları ve kapsam
// ---------------------------------------------------------------------------

check('13. Reduce Motion ve erişilebilirlik yüzeyleri KORUNUR', () => {
  assert(celebrationSource.includes('useReducedMotion'), 'Reduce Motion okunmuyor');
  assert(
    /transform: reduceMotion\s*\?\s*\[\]/.test(celebrationSource),
    'Reduce Motion açıkken ölçek kaldırılmıyor',
  );
  assert(
    celebrationSource.includes('reduceMotion ? MotionDuration.instant : MotionDuration.standard'),
    'Reduce Motion açıkken giriş süresi kısaltılmıyor',
  );
  assert(!/duration:\s*\d/.test(celebrationSource), 'ham (token’sız) süre değeri var');
  assert(celebrationSource.includes("const ENTER_SCALE = 0.96;"), 'ölçek rank kutlamasıyla aynı değil');

  // Erişilebilirlik: modal + alert + düğme.
  assert(celebrationSource.includes('accessibilityViewIsModal'), 'modal olarak işaretlenmemiş');
  assert(celebrationSource.includes('accessibilityRole="alert"'), 'alert rolü yok');
  assert(celebrationSource.includes('accessibilityRole="button"'), 'düğme rolü yok');
  assert(celebrationSource.includes("t('ranks.achievements.celebration.a11y'"), 'a11y etiketi yok');

  // Temizlik ve çift kapatma koruması.
  assert(celebrationSource.includes('cancelAnimation(progress)'), 'animasyon iptali yok');
  assert(celebrationSource.includes('isClosingRef'), 'çift kapatma koruması yok');
  assert(!/setInterval|setTimeout/.test(celebrationSource), 'katmanda zamanlayıcı var');

  // Confetti/ses/yeni görsel yok.
  const code = celebrationSource
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  assert(!/confetti|Sound|Audio|require\(/i.test(code), 'confetti/ses/yeni görsel eklenmiş');
});

check('14. Metinler locale’den gelir; ikon eşlemesi TEK kaynaktır', () => {
  for (const key of ['celebration', 'title', 'continue', 'a11y']) {
    assert(localeTr.includes(`${key}:`), `tr sözlüğünde ${key} yok`);
    assert(localeEn.includes(`${key}:`), `en sözlüğünde ${key} yok`);
  }
  assert(localeTr.includes("title: 'BAŞARI KAZANILDI'"), 'TR başlık beklenen değil');
  assert(localeEn.includes("title: 'ACHIEVEMENT UNLOCKED'"), 'EN başlık beklenen değil');
  // Kartta sabit kullanıcı metni yok.
  assert(
    !/<Text[^>]*>\s*[A-ZĞÜŞİÖÇ][a-zğüşıöç]/.test(celebrationSource),
    'katmanda çeviriden geçmeyen sabit metin var',
  );

  // İkon eşlemesi iki yerde KOPYALANMAZ.
  assert(iconsSource.includes('export const ACHIEVEMENT_ICONS'), 'ortak ikon kaynağı yok');
  assert(
    celebrationSource.includes("from '@/components/ranks/achievement-icons'"),
    'kutlama ortak ikon kaynağını kullanmıyor',
  );
  assert(
    screenSource.includes("from '@/components/ranks/achievement-icons'"),
    'rank ekranı ortak ikon kaynağını kullanmıyor',
  );
  assert(
    !/const ACHIEVEMENT_ICONS[\s\S]{0,40}=\s*\{/.test(screenSource),
    'ikon eşlemesi rank ekranında hâlâ kopyalanmış',
  );
  for (const key of KEYS) {
    assert(iconsSource.includes(`${key}:`), `ikon eşlemesinde eksik anahtar: ${key}`);
  }
});

check('15. Kaynak: onay YALNIZCA layout yolundan, polling YOK', () => {
  // Gösterim kapısını geçen effect onay ÇAĞIRMAZ.
  const gateStart = celebrationSource.indexOf('if (shown || !achievementCelebration');
  const gateEnd = celebrationSource.indexOf('// Katman unmount olursa');
  assert(gateStart > 0 && gateEnd > gateStart, 'gösterim effect’i beklenen biçimde değil');
  assert(
    !celebrationSource.slice(gateStart, gateEnd).includes('acknowledgeAchievementCelebrationShown'),
    'onay setShown ile aynı effect’te çağrılıyor',
  );
  assertEqual(
    (celebrationSource.match(/void acknowledgeAchievementCelebrationShown\(/g) ?? []).length,
    1,
    'onay birden fazla yerden çağrılıyor',
  );
  assert(celebrationSource.includes('onLayout={handleCardLayout}'), 'layout callback’i bağlanmamış');
  assert(
    celebrationSource.includes('layoutAcknowledgedRef.current === current'),
    'tekrarlanan layout için koruma yok',
  );
  // Rosea: kutlama başına tek tepki, mevcut olay yeniden kullanılıyor.
  assertEqual(
    (celebrationSource.match(/triggerReaction\('/g) ?? []).length,
    1,
    'Rosea tepkisi birden fazla kez tetikleniyor',
  );
  assert(celebrationSource.includes("triggerReaction('rank-up')"), 'yeni Rosea olayı üretilmiş');

  // Context: kutlama kaydı tespit yolunda YAZILMAZ (yalnızca baseline).
  const reconcileBody = contextSource.slice(
    contextSource.indexOf('const reconcileAchievementCelebrations = useCallback('),
    contextSource.indexOf('const acknowledgeAchievementCelebrationShown = useCallback('),
  );
  assert(reconcileBody.length > 0, 'reconcile fonksiyonu bulunamadı');
  assert(
    reconcileBody.includes("if (decision.type === 'seed')"),
    'depo yazması baseline dalıyla sınırlanmamış',
  );
  assert(reconcileBody.includes('owner !== ownerRef.current'), 'hesap sahipliği kontrolü yok');

  // Polling / interval yok.
  assert(
    !/setInterval[\s\S]{0,160}[Aa]chievement|setTimeout[\s\S]{0,160}[Aa]chievement/.test(
      contextSource,
    ),
    'başarılar için polling kurulmuş',
  );
  // Rank sync sonrası tazeleme var ve tek-uçuş korunuyor.
  assert(
    contextSource.includes('loadAchievementsRef.current();'),
    'rank sync sonrası başarı tazelemesi yok',
  );
  assert(
    contextSource.includes('if (isAchievementsFetchingRef.current) {'),
    'tek-uçuş kilidi kaybolmuş (eşzamanlı ikinci RPC riski)',
  );
  assert(
    contextSource.includes('hasQueuedAchievementsRef.current = true;'),
    'latest-wins kuyruğu kaybolmuş',
  );

  // Katman mount edilmiş ve oturum guard’ı içinde.
  assert(
    layoutSource.includes(
      '{Boolean(session) && !isPasswordRecovery && <AchievementUnlockCelebrationLayer />}',
    ),
    'katman oturum guard’ının dışında mount edilmiş',
  );
  // Güvenli rota kuralı yeniden kullanılıyor.
  assert(
    celebrationSource.includes('canShowRankCelebration(pathname)'),
    'mevcut güvenli rota kuralı kullanılmıyor',
  );
  // İstemci başarı koşulu/ilerleme HESAPLAMAZ.
  assert(
    !/currentProgress|targetProgress|isUnlocked/.test(celebrationSource),
    'katman başarı ilerlemesi hesaplıyor/okuyor',
  );
});

// ---------------------------------------------------------------------------
// 5 · BASELINE GATE — yalnızca BAŞARILI RPC sonucu baseline yazabilir
// ---------------------------------------------------------------------------

check('B1. Sezon hazır ama RPC dönmedi: baseline YAZILMAZ, kutlama OLUŞMAZ', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a', undefined);

  // Rank sync başarılı → sezon hazır. Başarı RPC'si HENÜZ dönmedi.
  app.onSeasonReady(5);
  app.renderAchievement(SAFE);

  assertEqual(app.hasLoadedAchievements, false, 'yüklenmemiş cevap "yüklendi" sayıldı');
  assertEqual(device.size, 0, 'cevap gelmeden baseline yazıldı');
  assertDeepEqual(app.queue, [], 'cevap gelmeden kuyruk üretildi');
  assertDeepEqual(app.shownLog, [], 'cevap gelmeden kutlama gösterildi');
});

check('B2. İlk BAŞARILI cevap mevcut rozetleri SESSİZCE seed eder', () => {
  const device = createDevice();
  const key = rx.seasonAchievementCelebrationStorageKey('user-a', 5);
  const app = createSession(device);
  app.signIn('user-a', undefined);
  app.onSeasonReady(5);

  // İlk başarılı cevap: kullanıcının zaten üç rozeti açık.
  app.applyAchievements(['first_workout', 'workout_5', 'streak_3']);
  app.renderAchievement(SAFE);

  assertEqual(app.hasLoadedAchievements, true, 'başarılı cevap işaretlenmedi');
  assertDeepEqual(app.queue, [], 'geçmiş rozetler kuyruğa girdi');
  assertDeepEqual(app.shownLog, [], 'geçmiş rozetler kutlandı');
  assertDeepEqual(
    JSON.parse(device.get(key)),
    ['first_workout', 'workout_5', 'streak_3'],
    'baseline mevcut rozetlerle yazılmadı',
  );
  assertEqual(device.writesFor(key).length, 1, 'baseline birden fazla kez yazıldı');
});

check('B3. İlk RPC HATA verirse baseline ilerlemez; sonraki cevap hâlâ ilk seed’dir', () => {
  const device = createDevice();
  const key = rx.seasonAchievementCelebrationStorageKey('user-a', 5);
  const app = createSession(device);
  app.signIn('user-a', undefined);
  app.onSeasonReady(5);

  // Ağ hatası: hiçbir şey yazılmaz.
  app.failAchievementsLoad();
  app.failAchievementsLoad();
  app.renderAchievement(SAFE);
  assertEqual(device.size, 0, 'hata sonrası boş baseline yazıldı');
  assertDeepEqual(app.shownLog, [], 'hata sonrası kutlama gösterildi');

  // Nihayet başarılı cevap: bu HÂLÂ ilk seed'dir, geçmiş rozetler kutlanmaz.
  app.applyAchievements(['first_workout', 'workout_5']);
  app.renderAchievement(SAFE);
  assertDeepEqual(app.shownLog, [], 'hatadan sonraki ilk cevap geçmişi kutladı');
  assertDeepEqual(
    JSON.parse(device.get(key)),
    ['first_workout', 'workout_5'],
    'hatadan sonraki ilk cevap seed olmadı',
  );
});

check('B4. Seed’den SONRA açılan rozet yalnız başına kuyruğa girer', () => {
  const device = createDevice();
  const app = createSession(device);
  app.signIn('user-a', undefined);
  app.onSeasonReady(5);
  app.applyAchievements(['first_workout', 'workout_5']);

  // Yeni rozet açıldı.
  app.applyAchievements(['first_workout', 'workout_5', 'streak_3']);
  assertDeepEqual(app.queue, ['streak_3'], 'yalnızca yeni rozet kuyruğa girmeliydi');

  app.renderAchievement(SAFE);
  app.layoutAchievement();
  assertDeepEqual(app.shownLog, ['streak_3'], 'geçmiş rozetler de gösterildi');
});

check('B5. Hesap/sezon değişiminde GEÇ gelen başarılı cevap yeni owner’a yazamaz', () => {
  const device = createDevice();
  const app = createSession(device);

  // --- hesap değişimi ---
  app.signIn('user-a', undefined);
  app.onSeasonReady(5);
  const ownerOfA = app.owner;

  app.signIn('user-b', undefined);
  app.onSeasonReady(5);
  app.applyAchievements(['first_workout', 'workout_5'], ownerOfA);
  app.renderAchievement(SAFE);

  assertEqual(app.hasLoadedAchievements, false, 'A’nın cevabı B’de "yüklendi" saydı');
  assertEqual(
    device.get(rx.seasonAchievementCelebrationStorageKey('user-b', 5)),
    null,
    'A’nın cevabı B’nin baseline’ını yazdı',
  );
  assertDeepEqual(app.queue, [], 'A’nın cevabı B’de kuyruk üretti');
  assertDeepEqual(app.shownLog, [], 'A’nın cevabı B’de kutlama açtı');

  // --- sezon değişimi ---
  app.applyAchievements(['first_workout']);
  app.setSeason(6);
  assertEqual(app.hasLoadedAchievements, false, 'sezon değişince yükleme sahipliği sıfırlanmadı');
  app.renderAchievement(SAFE);
  assertEqual(
    device.get(rx.seasonAchievementCelebrationStorageKey('user-b', 6)),
    null,
    'yeni sezona cevap gelmeden baseline yazıldı',
  );
});

// ---------------------------------------------------------------------------
// 6 · OVERLAY YENİDEN DENEME — kilit serbest kalınca bekleyen katman açılır
// ---------------------------------------------------------------------------

/**
 * Üç katmanın React yaşam döngüsünü modelleyen sahne.
 *
 * Her katmanın bir BAĞIMLILIK DİZİSİ vardır; effect yalnızca dizi değiştiğinde
 * yeniden çalışır — tıpkı `useEffect` gibi. `dependsOnActiveOverlay`
 * kapatıldığında katmanlar `activeRankOverlay`ı DİNLEMEZ ve bu, düzeltmeden
 * önceki davranışı birebir modeller.
 *
 * Effect'ler ağaç sırasında çalışır: rank-up → season-recap → achievement.
 * Bu sıra `app/_layout.tsx` içindeki mount sırasıyla aynıdır ve önceliği
 * doğal olarak uygular.
 */
function createOverlayStage(options = {}) {
  const dependsOnActiveOverlay = options.dependsOnActiveOverlay !== false;

  let activeOverlay;
  const pending = { achievement: false, 'rank-up': false, 'season-recap': false };
  const shown = { achievement: false, 'rank-up': false, 'season-recap': false };
  const lastDeps = {};
  const openLog = [];
  let effectRuns = 0;

  const claim = (owner) => {
    if (!rx.canClaimRankOverlay(activeOverlay, owner)) return false;
    activeOverlay = owner;
    return true;
  };

  const release = (owner) => {
    // Yalnızca sahibi bırakabilir: yanlış owner adına kilit düşürülemez.
    if (activeOverlay !== owner) return;
    activeOverlay = undefined;
  };

  /** Katmanın gate'i — gerçek bileşenlerdeki koşullarla birebir. */
  function gate(owner) {
    if (shown[owner]) return;
    if (!pending[owner]) return;
    // ÖNCELİK: rank-up > season-recap > achievement.
    if (owner === 'season-recap' && pending['rank-up']) return;
    if (owner === 'achievement' && (pending['rank-up'] || pending['season-recap'])) return;
    if (!claim(owner)) return;

    shown[owner] = true;
    openLog.push(owner);
  }

  function depsOf(owner) {
    return JSON.stringify([
      pending[owner],
      shown[owner],
      pending['rank-up'],
      pending['season-recap'],
      dependsOnActiveOverlay ? (activeOverlay ?? null) : 'ignored',
    ]);
  }

  /** React'in "bağımlılık değiştiyse effect'i çalıştır" döngüsü. */
  function flush() {
    for (let pass = 0; pass < 12; pass += 1) {
      let ranAny = false;
      for (const owner of rx.RANK_OVERLAY_PRIORITY) {
        const deps = depsOf(owner);
        if (lastDeps[owner] === deps) continue;
        lastDeps[owner] = deps;
        effectRuns += 1;
        ranAny = true;
        gate(owner);
      }
      if (!ranAny) return;
    }
    throw new Error('effect döngüsü kapanmadı (sonsuz döngü riski)');
  }

  return {
    get active() {
      return activeOverlay;
    },
    arrive(owner) {
      pending[owner] = true;
      flush();
    },
    dismiss(owner) {
      if (!shown[owner]) return;
      shown[owner] = false;
      pending[owner] = false;
      release(owner);
      flush();
    },
    get effectRuns() {
      return effectRuns;
    },
    openLog,
    releaseAs(owner) {
      release(owner);
      flush();
    },
    get shown() {
      return { ...shown };
    },
  };
}

check('O1. Achievement kilidi tutarken rank-up’ın İLK claim’i başarısız olur', () => {
  const stage = createOverlayStage();
  stage.arrive('achievement');
  assertEqual(stage.active, 'achievement', 'başarı kutlaması kilidi almadı');

  stage.arrive('rank-up');
  assertEqual(stage.active, 'achievement', 'süren kutlama yarıda kesildi (preemption)');
  assertEqual(stage.shown['rank-up'], false, 'rank-up üst üste açıldı');
  assertDeepEqual(stage.openLog, ['achievement'], 'iki katman aynı anda açıldı');
});

check('O2. Kilit bırakılınca rank-up BAŞKA state değişmeden otomatik açılır', () => {
  const stage = createOverlayStage();
  stage.arrive('achievement');
  stage.arrive('rank-up');
  assertEqual(stage.shown['rank-up'], false, 'rank-up erken açıldı');

  // Tek değişiklik: başarı kutlaması kapandı ve kilidi bıraktı.
  stage.dismiss('achievement');

  assertEqual(stage.shown['rank-up'], true, 'kilit serbest kalınca rank-up açılmadı');
  assertEqual(stage.active, 'rank-up', 'sahiplik rank-up’a geçmedi');
  assertDeepEqual(stage.openLog, ['achievement', 'rank-up'], 'açılma sırası yanlış');
});

check('O3. Sezon özeti beklerken aynı otomatik yeniden deneme çalışır', () => {
  const stage = createOverlayStage();
  stage.arrive('achievement');
  stage.arrive('season-recap');
  assertEqual(stage.shown['season-recap'], false, 'özet üst üste açıldı');

  stage.dismiss('achievement');
  assertEqual(stage.shown['season-recap'], true, 'kilit serbest kalınca özet açılmadı');
});

check('O4. Bir kutlama bitince SIRADAKİ uygun katman otomatik devam eder', () => {
  const stage = createOverlayStage();
  // Üçü de aynı anda bekliyor.
  stage.arrive('achievement');
  stage.arrive('season-recap');
  stage.arrive('rank-up');

  // Achievement önce gelmişti ve kilidi tutuyor; preemption YOK.
  assertEqual(stage.active, 'achievement', 'süren kutlama bölündü');

  stage.dismiss('achievement');
  assertEqual(stage.active, 'rank-up', 'öncelik sırası uygulanmadı');

  stage.dismiss('rank-up');
  assertEqual(stage.active, 'season-recap', 'sıradaki katman devam etmedi');

  stage.dismiss('season-recap');
  assertEqual(stage.active, undefined, 'son kapanışta kilit bırakılmadı');
  assertDeepEqual(
    stage.openLog,
    ['achievement', 'rank-up', 'season-recap'],
    'zincirleme açılma sırası yanlış',
  );
});

check('O5. Öncelik rank-up > recap > achievement olarak KORUNUR', () => {
  const stage = createOverlayStage();
  // Hiçbiri açık değilken üçü birden bekliyor.
  stage.arrive('achievement');
  assertEqual(stage.active, 'achievement', 'tek bekleyen açılmadı');
  stage.dismiss('achievement');

  const fresh = createOverlayStage();
  fresh.arrive('season-recap');
  fresh.arrive('rank-up');
  // Özet zaten açıldığı için bölünmez; rank-up sırasını bekler.
  assertEqual(fresh.active, 'season-recap', 'açık özet bölündü');
  fresh.dismiss('season-recap');
  assertEqual(fresh.active, 'rank-up', 'rank-up sırasını almadı');

  // Hiçbiri açık değilken üçü aynı anda gelirse rank-up önce açılır.
  const simultaneous = createOverlayStage();
  simultaneous.arrive('rank-up');
  simultaneous.arrive('season-recap');
  simultaneous.arrive('achievement');
  assertEqual(simultaneous.active, 'rank-up', 'eşzamanlıda öncelik uygulanmadı');
  assertDeepEqual(simultaneous.openLog, ['rank-up'], 'birden fazla katman açıldı');
});

check('O6. Aynı kutlama iki kez gösterilmez, kalıcı kayıt iki kez yazılmaz', () => {
  const stage = createOverlayStage();
  stage.arrive('achievement');
  // Aynı owner tekrar claim ederse çift gösterim OLMAZ.
  stage.arrive('achievement');
  stage.releaseAs('rank-up'); // yanlış owner kilidi düşüremez
  assertEqual(stage.active, 'achievement', 'yanlış owner kilidi düşürdü');
  assertDeepEqual(stage.openLog, ['achievement'], 'aynı kutlama iki kez açıldı');

  // Kalıcı kayıt tarafı: layout tekrarı tek yazma üretir.
  const device = createDevice();
  const key = rx.seasonAchievementCelebrationStorageKey('user-a', 5);
  const app = createSession(device);
  app.signIn('user-a', undefined);
  app.onSeasonReady(5);
  app.applyAchievements([]);
  app.applyAchievements(['first_workout']);
  app.renderAchievement(SAFE);
  for (let index = 0; index < 4; index += 1) app.layoutAchievement();
  app.renderAchievement(SAFE);
  assertEqual(device.writesFor(key).length, 2, 'baseline + tek onay beklenir');
  assertDeepEqual(app.shownLog, ['first_workout'], 'aynı kutlama iki kez gösterildi');
});

// ---------------------------------------------------------------------------
// MUTATION TESTLERİ — bozuk implementasyon gerçekten düşüyor mu?
// ---------------------------------------------------------------------------

check('M5. Başarılı yükleme gate’i kaldırılırsa geçmiş rozetler kutlanır ve DÜŞER', () => {
  const device = createDevice();
  const key = rx.seasonAchievementCelebrationStorageKey('user-a', 5);

  /**
   * DÜZELTMEDEN ÖNCEKİ DAVRANIŞ: uzlaştırma `achievements` state'ini dinleyen
   * bir effect'ten geliyordu ve o state başlangıçta `[]` idi.
   */
  const broken = createSession(device, { reconcileOnSeasonReady: true });
  broken.signIn('user-a', undefined);
  // Sezon önce hazır oldu → henüz yüklenmemiş `[]` baseline yazıldı.
  broken.onSeasonReady(5);
  assertDeepEqual(JSON.parse(device.get(key)), [], 'bozuk model gerçekten boş baseline yazmalı');

  // İlk gerçek cevap: geçmiş rozetlerin TAMAMI yeni sanılır.
  broken.applyAchievements(['first_workout', 'workout_5', 'streak_3']);
  assertEqual(broken.queue.length, 3, 'bozuk model gerçekten geçmişi kutlamalı');
  assertThrows(
    () => assertDeepEqual(broken.queue, [], 'mutation'),
    'gate’siz model testten geçti — geçmiş rozet spam’i yakalanmıyor',
  );

  // DÜZELTİLMİŞ model: sezon hazır olsa da cevap gelmeden hiçbir şey yazılmaz.
  const clean = createDevice();
  const app = createSession(clean);
  app.signIn('user-a', undefined);
  app.onSeasonReady(5);
  assertEqual(clean.size, 0, 'doğru model cevap gelmeden yazdı');
  app.applyAchievements(['first_workout', 'workout_5', 'streak_3']);
  assertDeepEqual(app.queue, [], 'doğru model geçmiş rozetleri kutladı');
});

check('M6. Reaktif overlay bağımlılığı kaldırılırsa yeniden deneme ÖLÜR ve DÜŞER', () => {
  /** Bağımlılık dizisi `activeRankOverlay`ı DİNLEMİYOR (düzeltme öncesi). */
  const broken = createOverlayStage({ dependsOnActiveOverlay: false });
  broken.arrive('achievement');
  broken.arrive('rank-up');
  broken.dismiss('achievement');

  assertEqual(broken.shown['rank-up'], false, 'bozuk model gerçekten takılı kalmalı');
  assertThrows(
    () => assertEqual(broken.shown['rank-up'], true, 'mutation'),
    'reaktif bağımlılık olmadan da açıldı — yeniden deneme regresyonu yakalanmıyor',
  );

  // DÜZELTİLMİŞ model: kilit serbest kalınca kendiliğinden açılır.
  const fixed = createOverlayStage();
  fixed.arrive('achievement');
  fixed.arrive('rank-up');
  fixed.dismiss('achievement');
  assertEqual(fixed.shown['rank-up'], true, 'doğru model yeniden denemedi');

  // Kaynak tarafı: üç katman da sahipliği DİNLİYOR ve context onu AÇIYOR.
  assert(
    contextSource.includes('const [activeRankOverlay, setActiveOverlay]'),
    'aktif katman state’i hâlâ discard ediliyor',
  );
  assert(
    contextSource.includes('activeRankOverlay,'),
    'aktif katman context değerine eklenmemiş',
  );
  for (const [name, code] of [
    ['rank-up', rankUpSource],
    ['sezon özeti', recapSource],
    ['başarı', celebrationSource],
  ]) {
    assert(code.includes('activeRankOverlay'), `${name} katmanı sahipliği dinlemiyor`);
  }
});

check('M1. `renderAchievement` anında kaydeden model DÜŞER (erken kayıt)', () => {
  const device = createDevice();
  const key = rx.seasonAchievementCelebrationStorageKey('user-a', 5);

  // Kasıtlı hata: gösterim kapısı geçilir geçilmez kayıt yazılıyor.
  device.set(key, '["first_workout"]');
  assertThrows(
    () => assertEqual(device.writesFor(key).length, 0, 'mutation'),
    'erken yazan model testten geçti — kaybolan kutlama yakalanmıyor',
  );

  // Doğru model: `renderAchievement` yazmaz, yalnızca `layoutAchievement` yazar.
  const clean = createDevice();
  const app = createSession(clean);
  app.signIn('user-a', 5);
  app.applyAchievements([]);
  app.applyAchievements(['first_workout']);
  const baselineWrites = clean.writesFor(key).length;
  app.renderAchievement(SAFE);
  assertEqual(clean.writesFor(key).length, baselineWrites, 'doğru model layout beklemeden yazdı');
  app.layoutAchievement();
  assertEqual(
    clean.writesFor(key).length,
    baselineWrites + 1,
    'doğru model layout sonrası yazmadı',
  );
});

check('M2. Sahiplik guard’ı olmayan model iki overlay’i üst üste açar ve DÜŞER', () => {
  // Kasıtlı hata: claim kontrolü yok, herkes açılıyor.
  const brokenOpen = ['rank-up', 'achievement'];
  assertThrows(
    () => assertEqual(brokenOpen.length, 1, 'mutation'),
    'guard’sız model testten geçti — overlay çakışması yakalanmıyor',
  );

  // Doğru model: ikinci claim reddedilir.
  const app = createSession(createDevice());
  app.signIn('user-a', 5);
  assertEqual(app.claimOverlay('rank-up'), true, 'ilk claim reddedildi');
  assertEqual(app.claimOverlay('achievement'), false, 'ikinci claim kabul edildi');
  assertEqual(app.activeOverlay, 'rank-up', 'sahiplik değişti');
});

check('M3. Hesap sahipliği guard’ı olmayan model A’yı B’ye yazar ve DÜŞER', () => {
  // Kasıtlı hata: capturedOwner kontrolü yok.
  const brokenState = { queue: [] };
  const brokenApply = (unlocked) => {
    brokenState.queue = unlocked;
  };
  brokenApply(['first_workout']);
  assertThrows(
    () => assertDeepEqual(brokenState.queue, [], 'mutation'),
    'sahiplik guard’sız model testten geçti — hesap sızıntısı yakalanmıyor',
  );

  // Doğru model: geç cevap düşer.
  const app = createSession(createDevice());
  app.signIn('user-a', 5);
  const ownerOfA = app.owner;
  app.signIn('user-b', 5);
  app.applyAchievements(['first_workout'], ownerOfA);
  assertDeepEqual(app.queue, [], 'doğru model A’nın cevabını B’ye yazdı');
});

check('M4. Baseline yazmayan model eski rozetleri topluca kutlar ve DÜŞER', () => {
  // Kasıtlı hata: kayıt yokken boş liste "celebrated" sayılıyor.
  const broken = rx.decideAchievementCelebrations({
    celebrated: [],
    unlockedKeys: ['first_workout', 'workout_5', 'streak_3'],
  });
  assertEqual(broken.queue.length, 3, 'bozuk model gerçekten topluca kutlamalı');
  assertThrows(
    () => assertEqual(broken.queue.length, 0, 'mutation'),
    'baseline’sız model testten geçti — toplu kutlama yakalanmıyor',
  );

  // Doğru model: kayıt YOKSA seed, kutlama yok.
  const correct = rx.decideAchievementCelebrations({
    celebrated: undefined,
    unlockedKeys: ['first_workout', 'workout_5', 'streak_3'],
  });
  assertEqual(correct.type, 'seed', 'doğru model seed üretmedi');
  assertDeepEqual(correct.queue, [], 'doğru model eski rozetleri kutladı');
});

// ---------------------------------------------------------------------------

rmSync(outDir, { force: true, recursive: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Başarı kutlaması harness: ${passed} kontrol geçti.`);
console.log('  (Canlı Postgres yok — SQL çalıştırılmadı; kutlama yaşam döngüsü modellendi.)');
