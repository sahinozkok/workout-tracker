/**
 * Add Exercise ekranındaki "son kullanılan dinlenme süresi" tercihinin
 * doğrulama harness'ı.
 *
 * SINIR: React render edilmez. İki katman:
 *   A. YAPISAL — ekran dosyasında güvenilirlik kurallarının (odakta yükleme,
 *      `await` ile yazma, elle düzenleme koruması, kullanıcı bazlı anahtar)
 *      gerçekten bulunduğunu iddia eder.
 *   B. DAVRANIŞSAL — ekrandaki saf yardımcıların ve yükleme/yazma sırasının
 *      satır satır karşılığı olan model üzerinde senaryoları çalıştırır.
 *
 * Çalıştırma:  node supabase/tests/rest-preference.harness.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const screen = readFileSync(join(root, 'app/program/[id]/day/[dayId]/add-exercise.tsx'), 'utf8');
const programList = readFileSync(join(root, 'components/program-list.tsx'), 'utf8');

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` +
      (ok ? '' : `  (beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)})`),
  );
}

const contains = (name, haystack, needle) => check(name, haystack.includes(needle), true);

// ---------------------------------------------------------------------------
console.log('=== A. Sürüklenen satır ölçeği ===');
contains('program listesi ölçek üretmiyor', programList, '<ScaleDecorator activeScale={1}>');
check(
  'ölçeksiz decorator yalnızca program listesinde',
  readFileSync(join(root, 'components/program-exercise-list.tsx'), 'utf8').includes('<ScaleDecorator>'),
  true,
);
check(
  'satırı kesen keyfî negatif margin / sabit genişlik yok',
  /margin(Left|Right|Horizontal)?:\s*-|width:\s*Dimensions/.test(programList),
  false,
);

console.log('\n=== A2. Dinlenme tercihi kuralları ===');
contains('varsayılan 180 sn', screen, "const DEFAULT_REST_SECONDS = '180';");
contains('anahtar kullanıcı kimliğine bağlı', screen, '`${LAST_REST_SECONDS_KEY_PREFIX}:${userId}`');
contains('her odaklanmada yeniden okunuyor', screen, 'useFocusEffect(');
contains('elle düzenleme izleniyor', screen, 'hasEditedRestRef');
contains('geç dönen okuma elle yazılanı ezmiyor', screen, 'if (!isActive || hasEditedRestRef.current) return;');
contains('düzenleme bayrağı her odaklanmada sıfırlanıyor', screen, 'hasEditedRestRef.current = false;');
check(
  'sıfırlama AsyncStorage okumasından ÖNCE',
  screen.indexOf('hasEditedRestRef.current = false;') <
    screen.indexOf('AsyncStorage.getItem(getLastRestSecondsKey(userId))'),
  true,
);
contains('unmount sonrası state yazılmıyor', screen, 'isActive = false;');
contains('yazma await ediliyor', screen, 'await AsyncStorage.setItem(getLastRestSecondsKey(userId)');
contains('yalnızca en az bir ekleme başarılıysa yazılıyor', screen, 'failed.length < pending.length');
check(
  'storage hatası egzersiz eklemeyi geri almıyor (yutulan catch)',
  /await AsyncStorage\.setItem\([\s\S]{0,120}\n\s*\} catch \{/.test(screen),
  true,
);
check('fire-and-forget setItem kalmadı', /AsyncStorage\.setItem\([^;]*\)\.catch\(/.test(screen), false);
contains('değişiklik sarmalayıcıdan geçiyor', screen, 'onChangeText={handleRestSecondsChange}');

// ---------------------------------------------------------------------------
// B. DAVRANIŞSAL MODEL
// ---------------------------------------------------------------------------
const DEFAULT_REST_SECONDS = '180';

/** Ekrandaki `parseStoredRestSeconds` ile aynı kural. */
function parseStoredRestSeconds(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 600) return undefined;
  return String(parsed);
}

const key = (userId) => `workout-last-rest-seconds:${userId}`;

/** Ekranın yükleme + yazma davranışının modeli. */
function createScreen(store, userId) {
  const state = { restSeconds: DEFAULT_REST_SECONDS, hasEdited: false, mounted: true, focused: false };

  return {
    state,
    /**
     * `useFocusEffect` içindeki okuma turu. Ekranla AYNI sıra:
     *   1. `hasEditedRestRef.current = false` (yeni tur),
     *   2. AsyncStorage okuması başlar,
     *   3. cevap döndüğünde `isActive` ve düzenleme bayrağı kontrol edilir.
     * Dönen fonksiyon "geç gelen cevabı uygula" adımıdır.
     */
    focus(rawValue) {
      state.hasEdited = false;
      state.focused = true;
      const isActive = () => state.mounted && state.focused;
      return () => {
        if (!isActive() || state.hasEdited) return;
        const parsed = parseStoredRestSeconds(rawValue);
        if (parsed) state.restSeconds = parsed;
      };
    },
    /** Odak kaybı: bekleyen okuma artık state yazamaz. */
    blur() {
      state.focused = false;
    },
    edit(value) {
      state.hasEdited = true;
      state.restSeconds = value;
    },
    unmount() {
      state.mounted = false;
    },
    /** Başarılı ekleme sonrası yazma. */
    async save({ addedCount, pendingCount }) {
      if (!userId || addedCount === 0 || addedCount > pendingCount) return;
      if (!(pendingCount - addedCount < pendingCount)) return;
      store.set(key(userId), state.restSeconds);
    },
  };
}

console.log('\n=== B. Senaryolar ===');
const store = new Map();

// 1) Kayıt yok → 180
const first = createScreen(store, 'userA');
first.focus(store.get(key('userA')) ?? null)();
check('kayıt yok → 180', first.state.restSeconds, '180');

// 2) 90 yazıp başarıyla ekleme → sonraki açılışta 90
first.edit('90');
await first.save({ addedCount: 1, pendingCount: 1 });
const second = createScreen(store, 'userA');
second.focus(store.get(key('userA')) ?? null)();
check('başarılı 90 sn ekleme → sonraki açılışta 90', second.state.restSeconds, '90');

// 3) Başarısız ekleme → önceki değer korunur
const third = createScreen(store, 'userA');
third.focus(store.get(key('userA')) ?? null)();
third.edit('300');
await third.save({ addedCount: 0, pendingCount: 2 }); // hiçbiri eklenemedi
const fourth = createScreen(store, 'userA');
fourth.focus(store.get(key('userA')) ?? null)();
check('tamamen başarısız ekleme tercihi değiştirmiyor', fourth.state.restSeconds, '90');

// 3b) Çoklu eklemede en az biri başarılıysa yazılır
const partial = createScreen(store, 'userA');
partial.edit('120');
await partial.save({ addedCount: 1, pendingCount: 3 });
check('kısmi başarı tercihi kaydediyor', store.get(key('userA')), '120');

// 4) Geç dönen okuma, elle yazılanı ezmez
const racing = createScreen(store, 'userA');
const lateRead = racing.focus('120'); // okuma başladı
racing.edit('45'); // kullanıcı bu sırada yazdı
lateRead(); // cevap şimdi döndü
check('geç dönen okuma elle yazılanı EZMİYOR', racing.state.restSeconds, '45');

// 4b) Unmount sonrası state yazılmaz
const unmounted = createScreen(store, 'userA');
const pendingRead = unmounted.focus('120');
unmounted.unmount();
pendingRead();
check('unmount sonrası state güncellenmiyor', unmounted.state.restSeconds, '180');

// 4c) AYNI component örneğinin blur → focus yaşam döngüsü
console.log('\n--- aynı component örneği: blur/focus turu ---');
const lifecycleStore = new Map([[key('userA'), '90']]);
const life = createScreen(lifecycleStore, 'userA');

// 1) Ekran odaklanır, kayıtlı 90 yüklenir.
life.focus(lifecycleStore.get(key('userA')))();
check('1) ilk odakta kayıtlı 90 yükleniyor', life.state.restSeconds, '90');

// 2) Kullanıcı 120 girip başarıyla egzersiz ekler.
life.edit('120');
await life.save({ addedCount: 1, pendingCount: 1 });
check('2) 120 başarıyla kaydedildi', lifecycleStore.get(key('userA')), '120');

// 3) Ekran blur olur.
life.blur();

// 4-5) Aynı örnek tekrar focus olur → güncel 120 yüklenebilmeli.
const secondRead = life.focus(lifecycleStore.get(key('userA')));
secondRead();
check('5) ikinci odakta güncel 120 yükleniyor', life.state.restSeconds, '120');

// 6) İkinci okuma sürerken kullanıcı 45 yazarsa geç gelen 120 EZMEMELİ.
life.blur();
const thirdRead = life.focus(lifecycleStore.get(key('userA'))); // okuma başladı
life.edit('45'); // kullanıcı bu sırada yazdı
thirdRead(); // geç gelen cevap
check('6) geç gelen 120, elle yazılan 45\'i EZMİYOR', life.state.restSeconds, '45');

// Blur sonrası bekleyen okuma state yazamaz.
const blurred = createScreen(lifecycleStore, 'userA');
const pendingAfterBlur = blurred.focus('120');
blurred.blur();
pendingAfterBlur();
check('blur sonrası bekleyen okuma state yazmıyor', blurred.state.restSeconds, '180');

// 5) Farklı kullanıcı diğerinin değerini görmez
const otherUser = createScreen(store, 'userB');
otherUser.focus(store.get(key('userB')) ?? null)();
check('farklı hesap diğerinin tercihini almıyor', otherUser.state.restSeconds, '180');
check('userA tercihi bozulmadı', store.get(key('userA')), '120');

// 6) Geçersiz kayıt → varsayılan
for (const [label, raw] of [['boş', ''], ['sayı değil', 'abc'], ['negatif', '-5'], ['sınır üstü', '900'], ['ondalık', '90.5']]) {
  const invalid = createScreen(store, 'userC');
  invalid.focus(raw)();
  check(`geçersiz kayıt (${label}) → 180`, invalid.state.restSeconds, '180');
}
check('sınır değeri 600 kabul ediliyor', parseStoredRestSeconds('600'), '600');
check('sınır değeri 0 kabul ediliyor', parseStoredRestSeconds('0'), '0');

console.log(`\n${fail === 0 ? 'TÜMÜ GEÇTİ' : 'BAŞARISIZ VAR'} — ${pass} geçti, ${fail} kaldı`);
process.exit(fail === 0 ? 0 : 1);
