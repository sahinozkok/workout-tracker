/**
 * Rosea tepki önceliği ve tepki tipi ayrımı harness'ı.
 *
 * SINIR: React render edilmez. Üç katman:
 *   A. SAF MANTIK — `types/mascot.ts` GERÇEKTEN `tsc` ile derlenir ve gerçek
 *      `MASCOT_REACTION_PRIORITY` tablosu çalıştırılır.
 *   B. KAYNAK KURALLARI — devralma kuralının ve tetikleyicilerin gerçekten
 *      kaynakta olduğu iddia edilir.
 *   C. DAVRANIŞSAL — `floating-mascot.tsx` tepki tüketen effect'inin satır
 *      satır karşılığı olan model çalıştırılır; mutation testleri düzeltme
 *      öncesi modellerin GERÇEKTEN düştüğünü kanıtlar.
 *
 * Çalıştırma:  node scripts/verify-mascot-reactions.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} (beklenen ${expected}, gelen ${actual})`);
}
function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} (beklenen ${e}, gelen ${a})`);
}
/** Mutation testi: verilen iddia GERÇEKTEN düşmeli. */
function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

// ---------------------------------------------------------------------------
// A · `types/mascot.ts` gerçekten derlenir
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'rosea-mascot-reactions-'));
let mascotTypes;
try {
  execFileSync(
    'npx',
    [
      'tsc',
      join(ROOT, 'types/mascot.ts'),
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
  mascotTypes = await import(pathToFileURL(join(outDir, 'mascot.js')).href);
} catch (error) {
  console.error('types/mascot.ts derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}

const PRIORITY = mascotTypes.MASCOT_REACTION_PRIORITY;

const mascotSource = source('components/mascot/floating-mascot.tsx');
const expressionSource = source('components/mascot/mascot-expressions.ts');
const typesSource = source('types/mascot.ts');
const achievementSource = source('components/ranks/achievement-unlock-celebration.tsx');
const rankUpSource = source('components/ranks/rank-up-celebration.tsx');
const workoutSource = source('app/program/[id]/day/[dayId]/index.tsx');

console.log('=== A. Öncelik tablosu (gerçek derlenmiş modül) ===');

check('A1. Beş tepki tipinin hepsi tabloda', () => {
  assertDeepEqual(
    Object.keys(PRIORITY).sort(),
    ['achievement-unlock', 'loved', 'rank-up', 'set-complete', 'workout-complete'],
    'tepki tipi kümesi beklenenden farklı',
  );
});

check('A2. Kesin sıralama rank-up > achievement-unlock > workout-complete > set-complete > loved', () => {
  assert(PRIORITY['rank-up'] > PRIORITY['achievement-unlock'], 'rank-up rozetten yüksek değil');
  assert(
    PRIORITY['achievement-unlock'] > PRIORITY['workout-complete'],
    'rozet workout-complete’ten yüksek değil',
  );
  assert(
    PRIORITY['workout-complete'] > PRIORITY['set-complete'],
    'workout-complete set-complete’ten yüksek değil',
  );
  assert(PRIORITY['set-complete'] > PRIORITY.loved, 'set-complete loved’dan yüksek değil');
});

check('A3. Hiçbir iki tepki EŞİT öncelikte değil (eşitlik sessiz düşmeye yol açar)', () => {
  const values = Object.values(PRIORITY);
  assertEqual(new Set(values).size, values.length, 'eşit öncelikli tepki çifti var');
});

check('A4. `loved` en düşük öncelik olarak korunuyor', () => {
  assertEqual(PRIORITY.loved, Math.min(...Object.values(PRIORITY)), 'loved en düşük değil');
});

check('A5. MUTATION — eski EŞİT öncelik modeli (rank-up = workout-complete) düşer', () => {
  const legacy = { 'workout-complete': 2, 'rank-up': 2, 'set-complete': 1, loved: 0 };
  assertThrows(
    () => assert(legacy['rank-up'] > legacy['workout-complete'], 'mutation'),
    'eski eşit öncelik modeli hâlâ geçiyor — test vacuous',
  );
  assertThrows(
    () =>
      assertEqual(
        new Set(Object.values(legacy)).size,
        Object.values(legacy).length,
        'mutation',
      ),
    'eski modelde eşitlik yakalanmadı — test vacuous',
  );
});

// ---------------------------------------------------------------------------
// B · Kaynak kuralları
// ---------------------------------------------------------------------------

console.log('\n=== B. Kaynak kuralları ===');

check('B1. Devralma kuralı KESİN OLARAK "yalnızca daha yüksek" (<=  düşürür)', () => {
  assert(
    mascotSource.includes(
      'if (current && MASCOT_REACTION_PRIORITY[reaction.type] <= MASCOT_REACTION_PRIORITY[current.type]) {',
    ),
    'devralma karşılaştırması kaynakta bulunamadı',
  );
});

check('B2. Sürükleme sırasında gelen olay DÜŞÜRÜLÜR, kuyruğa alınmaz', () => {
  assert(mascotSource.includes('if (isDraggingRef.current) return;'), 'drag reddi kaldırılmış');
  assert(
    !/reactionQueue|pendingReaction|queue\.push/.test(mascotSource),
    'tepki kuyruğu eklenmiş — düşürme sözleşmesi bozuldu',
  );
});

check('B3. Tepki süresi timeout cleanup’ı korunuyor', () => {
  assert(mascotSource.includes('return () => clearTimeout(timer);'), 'timeout cleanup yok');
  assert(
    mascotSource.includes('activeReactionRef.current = undefined;'),
    'tepki bitince ref temizlenmiyor',
  );
});

check('B4. Rozet katmanı KENDİ tipini tetikliyor, kutlama başına bir kez', () => {
  assert(
    achievementSource.includes("triggerReaction('achievement-unlock')"),
    'rozet katmanı yeni tepki tipini kullanmıyor',
  );
  assertEqual(
    (achievementSource.match(/triggerReaction\('/g) ?? []).length,
    1,
    'rozet Rosea tepkisi birden fazla yerden tetikleniyor',
  );
});

check('B5. MUTATION — rozet katmanı artık `rank-up` YENİDEN KULLANMIYOR', () => {
  assert(
    !achievementSource.includes("triggerReaction('rank-up')"),
    'rozet katmanı hâlâ rank-up tetikliyor',
  );
  // Eski model üzerinde aynı iddia gerçekten düşmeli.
  const legacy = "    triggerReaction('rank-up');";
  assertThrows(
    () => assert(!legacy.includes("triggerReaction('rank-up')"), 'mutation'),
    'eski rank-up yeniden kullanım modeli yakalanmıyor — test vacuous',
  );
});

check('B6. Rank katmanı kendi tipini korumaya devam ediyor, kutlama başına bir kez', () => {
  assert(rankUpSource.includes("triggerReaction('rank-up')"), 'rank katmanı tipini kaybetmiş');
  assertEqual(
    (rankUpSource.match(/triggerReaction\('/g) ?? []).length,
    1,
    'rank Rosea tepkisi birden fazla yerden tetikleniyor',
  );
});

check('B7. Rank ve rozet AYIRT EDİLEBİLİR (farklı tip, farklı öncelik)', () => {
  assert(
    rankUpSource.includes("triggerReaction('rank-up')") &&
      achievementSource.includes("triggerReaction('achievement-unlock')"),
    'iki katman aynı tipi kullanıyor',
  );
  assert(PRIORITY['rank-up'] !== PRIORITY['achievement-unlock'], 'öncelikleri ayrışmamış');
});

check('B8. Mevcut workout tepkileri KORUNUYOR', () => {
  assertEqual(
    (workoutSource.match(/triggerReaction\('workout-complete'\)/g) ?? []).length,
    2,
    'workout-complete tetikleyicileri değişmiş',
  );
  assertEqual(
    (workoutSource.match(/triggerReaction\('set-complete'\)/g) ?? []).length,
    1,
    'set-complete tetikleyicisi değişmiş',
  );
});

check('B9. Süre/animasyon/partikül davranışı değişmedi', () => {
  // Kutlama süresi paylaşılıyor, yeni sabit üretilmedi.
  assert(mascotSource.includes('const WORKOUT_REACTION_DURATION = 1220;'), 'kutlama süresi değişmiş');
  assert(mascotSource.includes('const SET_REACTION_DURATION = 560;'), 'set süresi değişmiş');
  assert(
    mascotSource.includes('const REDUCED_REACTION_DURATION = 420;'),
    'Reduce Motion süresi değişmiş',
  );
  // Partikül ve kutlama balonu YALNIZCA workout-complete dalında üretilir;
  // rank ve rozet kendi balonlarını AÇMAZ — bu tur bunu değiştirmedi.
  assert(
    mascotSource.includes("const opensOwnBubble = type === 'workout-complete';"),
    'kendi balonunu açan tip kümesi değişmiş',
  );
  assertEqual(
    (mascotSource.match(/setParticleRun\(particleRunRef\.current\)/g) ?? []).length,
    1,
    'partikül birden fazla yerden üretiliyor',
  );
  assertEqual(
    (mascotSource.match(/showBubble\('celebration'\)/g) ?? []).length,
    1,
    'kutlama balonu birden fazla yerden açılıyor',
  );
});

check('B10. Rozet kutlaması `celebrating` ifadesini kullanıyor, yeni asset yok', () => {
  assert(
    expressionSource.includes("'achievement-unlock': 'celebrating',"),
    'rozet ifadesi eşlenmemiş',
  );
  assertEqual(
    (expressionSource.match(/require\('\.\.\/\.\.\/assets\/images\/mascot\//g) ?? []).length,
    26,
    'asset require sayısı değişmiş — bu turda yeni/silinmiş asset olmamalı',
  );
});

check('B11. Reduce Motion dalı korunuyor', () => {
  assert(mascotSource.includes('if (reduceMotion) {'), 'Reduce Motion dalı kaldırılmış');
  assert(
    mascotSource.includes("const peak = isCelebration ? 1.08 : 1.04;"),
    'Reduce Motion nabzı değişmiş',
  );
  // Kutlama sınıflandırması üç tipi de kapsıyor.
  assert(
    mascotSource.includes(
      "type === 'workout-complete' || type === 'rank-up' || type === 'achievement-unlock'",
    ),
    'rozet kutlama sınıfına dahil değil',
  );
});

// ---------------------------------------------------------------------------
// C · Tepki tüketen effect'in davranışsal modeli
// ---------------------------------------------------------------------------

console.log('\n=== C. Devralma davranışı ===');

/**
 * `floating-mascot.tsx` tepki effect'inin birebir modeli.
 * Yalnızca devralma kararını modeller; animasyon değerleri kapsam dışıdır.
 */
function createReactor({ priority = PRIORITY, isHidden = false } = {}) {
  const state = {
    active: undefined,
    lastReactionId: 0,
    isDragging: false,
    playLog: [],
    droppedLog: [],
    timers: 0,
  };

  /** Context'in `triggerReaction`'ı: artan kimlikli tek seferlik olay. */
  let nextId = 0;

  state.trigger = (type) => {
    nextId += 1;
    const reaction = { id: nextId, type };

    // --- effect gövdesinin birebir karşılığı ---
    if (reaction.id === state.lastReactionId) return;
    state.lastReactionId = reaction.id;
    if (isHidden) {
      state.droppedLog.push([type, 'hidden']);
      return;
    }
    if (state.isDragging) {
      state.droppedLog.push([type, 'dragging']);
      return;
    }
    const current = state.active;
    if (current && priority[type] <= priority[current]) {
      state.droppedLog.push([type, 'lower-or-equal']);
      return;
    }
    // playReaction: yeni runId, eski süre zamanlayıcısı cleanup ile silinir.
    if (current) state.timers -= 1;
    state.active = type;
    state.timers += 1;
    state.playLog.push(type);
  };

  /** Süre dolunca tepki biter. */
  state.expire = () => {
    if (!state.active) return;
    state.active = undefined;
    state.timers -= 1;
  };

  return state;
}

check('C1. Rank yükselmesi SÜREN workout kutlamasını DEVRALIR', () => {
  const r = createReactor();
  r.trigger('workout-complete');
  assertEqual(r.active, 'workout-complete', 'workout tepkisi başlamadı');
  r.trigger('rank-up');
  assertEqual(r.active, 'rank-up', 'rank tepkisi workout’u devralmadı');
  assertDeepEqual(r.playLog, ['workout-complete', 'rank-up'], 'oynatma sırası yanlış');
  assertDeepEqual(r.droppedLog, [], 'rank tepkisi düşürüldü');
});

check('C2. workout-complete SÜREN rank tepkisini DEVRALAMAZ', () => {
  const r = createReactor();
  r.trigger('rank-up');
  r.trigger('workout-complete');
  assertEqual(r.active, 'rank-up', 'düşük öncelikli olay yüksek tepkiyi kesti');
  assertDeepEqual(r.playLog, ['rank-up'], 'workout tepkisi yanlışlıkla oynadı');
  assertDeepEqual(r.droppedLog, [['workout-complete', 'lower-or-equal']], 'düşürme kaydı yanlış');
});

check('C3. Rozet workout kutlamasını devralır, rank’i devralamaz', () => {
  const a = createReactor();
  a.trigger('workout-complete');
  a.trigger('achievement-unlock');
  assertEqual(a.active, 'achievement-unlock', 'rozet workout’u devralmadı');

  const b = createReactor();
  b.trigger('rank-up');
  b.trigger('achievement-unlock');
  assertEqual(b.active, 'rank-up', 'rozet rank’i kesti');
});

check('C4. Rank rozeti devralır (ters yön mümkün değil)', () => {
  const r = createReactor();
  r.trigger('achievement-unlock');
  r.trigger('rank-up');
  assertEqual(r.active, 'rank-up', 'rank rozeti devralmadı');
  assertDeepEqual(r.playLog, ['achievement-unlock', 'rank-up'], 'oynatma sırası yanlış');
});

check('C5. Gerçek akış: set → workout → rank → rozet', () => {
  const r = createReactor();
  r.trigger('set-complete');
  assertEqual(r.active, 'set-complete', 'set tepkisi oynamadı');
  r.trigger('workout-complete');
  assertEqual(r.active, 'workout-complete', 'workout set’i devralmadı');
  r.trigger('rank-up');
  assertEqual(r.active, 'rank-up', 'rank workout’u devralmadı');
  r.trigger('achievement-unlock');
  assertEqual(r.active, 'rank-up', 'rozet rank’i kesti');
  r.expire();
  r.trigger('achievement-unlock');
  assertEqual(r.active, 'achievement-unlock', 'rank bitince rozet oynayamadı');
});

check('C6. `loved` hiçbir kutlamayı bölemez', () => {
  for (const type of ['workout-complete', 'rank-up', 'achievement-unlock', 'set-complete']) {
    const r = createReactor();
    r.trigger(type);
    r.trigger('loved');
    assertEqual(r.active, type, `loved ${type} tepkisini böldü`);
  }
});

check('C7. Sürükleme sırasında her tepki düşürülür ve kuyruğa alınmaz', () => {
  const r = createReactor();
  r.isDragging = true;
  r.trigger('rank-up');
  r.trigger('workout-complete');
  assertEqual(r.active, undefined, 'sürüklerken tepki oynadı');
  r.isDragging = false;
  assertEqual(r.active, undefined, 'düşürülen tepki sonradan kuyruktan oynadı');
  assertDeepEqual(
    r.droppedLog,
    [
      ['rank-up', 'dragging'],
      ['workout-complete', 'dragging'],
    ],
    'düşürme gerekçesi yanlış',
  );
});

check('C8. Maskot gizliyken tepki düşürülür', () => {
  const r = createReactor({ isHidden: true });
  r.trigger('rank-up');
  assertEqual(r.active, undefined, 'gizliyken tepki oynadı');
});

check('C9. Devralmada eski süre zamanlayıcısı sızmıyor', () => {
  const r = createReactor();
  r.trigger('workout-complete');
  r.trigger('rank-up');
  assertEqual(r.timers, 1, 'devralma sonrası birden fazla süre zamanlayıcısı var');
  r.expire();
  assertEqual(r.timers, 0, 'tepki bitince zamanlayıcı temizlenmedi');
});

check('C10. MUTATION — eski EŞİT öncelik tablosunda rank tepkisi GERÇEKTEN düşüyordu', () => {
  const legacy = { 'workout-complete': 2, 'rank-up': 2, 'set-complete': 1, loved: 0 };
  const r = createReactor({ priority: legacy });
  r.trigger('workout-complete');
  r.trigger('rank-up');
  // Düzeltme öncesi davranışın kanıtı: rank tepkisi yutuluyordu.
  assertEqual(r.active, 'workout-complete', 'eski model artık rank’i düşürmüyor — test vacuous');
  assertDeepEqual(r.playLog, ['workout-complete'], 'eski modelde rank oynamış');
  // Ve yeni tabloda aynı senaryo GEÇMELİ.
  assertThrows(() => {
    const fixed = createReactor();
    fixed.trigger('workout-complete');
    fixed.trigger('rank-up');
    assertEqual(fixed.active, 'workout-complete', 'mutation');
  }, 'yeni tablo hâlâ eski davranışı üretiyor');
});

check('C11. MUTATION — rozet `rank-up` tipini yeniden kullansaydı rank’i düşürürdü', () => {
  // Eski model: rozet de 'rank-up' tetikliyordu → eşit öncelik → düşme.
  const r = createReactor();
  r.trigger('rank-up');
  r.trigger('rank-up'); // rozetin eski davranışı
  assertDeepEqual(r.playLog, ['rank-up'], 'eski modelde ikinci kutlama oynamış');
  assertDeepEqual(r.droppedLog, [['rank-up', 'lower-or-equal']], 'eski model düşürmemiş');
  // Yeni tipiyle rozet de kendi hakkını alır (rank bittikten sonra).
  const fixed = createReactor();
  fixed.trigger('rank-up');
  fixed.expire();
  fixed.trigger('achievement-unlock');
  assertDeepEqual(fixed.playLog, ['rank-up', 'achievement-unlock'], 'rozet ayrı oynayamadı');
});

check('C12. Tabloda tanımlı her tip modelde oynatılabiliyor', () => {
  for (const type of Object.keys(PRIORITY)) {
    const r = createReactor();
    r.trigger(type);
    assertEqual(r.active, type, `${type} hiç oynamadı`);
  }
});

// ---------------------------------------------------------------------------

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Rosea tepki harness: ${pass} kontrol geçti.`);
