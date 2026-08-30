/**
 * Seri verileri ve seri geçmişi — SAF çekirdek doğrulaması.
 *
 * SINIR: React render edilmez, Supabase/AsyncStorage'a bağlanılmaz. GERÇEK saf
 * çekirdek (`utils/discipline.ts`) `tsc` ile derlenip ÇAĞRILIR — kopya algoritma
 * test EDİLMEZ. `todayKey` daima dışarıdan enjekte edilir; hiçbir kontrol sistem
 * saatine bağlı değildir.
 *
 * Ayrıca UI SÖZLEŞMESİ kaynak taramasıyla doğrulanır: profil seri alanının
 * `/streaks` route'una erişilebilir bağlanması ve seri ekranının rank sezonu /
 * Supabase kullanMAMASI.
 *
 * Çalıştırma:  node scripts/verify-discipline-streak-insights.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const codeOf = (relative) => stripComments(source(relative));

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

// ---------------------------------------------------------------------------
// GERÇEK çekirdeği derle ve içe aktar
// ---------------------------------------------------------------------------

const outDir = mkdtempSync(join(tmpdir(), 'rosea-streak-insights-'));
let discipline;

try {
  const shim = join(outDir, 'types-workout-shim.ts');
  writeFileSync(shim, "export type DisciplineStatus = 'completed' | 'partial' | 'skipped';\n");

  const patched = source('utils/discipline.ts').replace(
    /from '@\/types\/workout'/g,
    "from './types-workout-shim'",
  );
  const copy = join(outDir, 'discipline.ts');
  writeFileSync(copy, patched);
  execFileSync(
    'npx',
    ['tsc', copy, shim, '--outDir', outDir, '--target', 'es2020', '--module', 'esnext',
     '--moduleResolution', 'bundler', '--strict', '--skipLibCheck'],
    { cwd: ROOT, stdio: 'pipe' },
  );

  discipline = await import(pathToFileURL(join(outDir, 'discipline.js')).href);
} catch (error) {
  console.error('Saf çekirdek derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}

const { analyzeDisciplineStreaks, calculateDisciplineStreak, shiftDateKey, toDateKey } = discipline;

const TODAY = '2026-08-30';
/** `TODAY`'den `offset` gün ÖNCESİ (offset>0 geçmiş, <0 gelecek). */
const dayBefore = (offset, base = TODAY) => shiftDateKey(base, -offset);
/** Ardışık günlere aynı durumu ver. `startOffset` en eski, `count` gün. */
function runOf(status, startOffset, count, base = TODAY) {
  const out = {};
  for (let i = 0; i < count; i += 1) out[dayBefore(startOffset - i, base)] = status;
  return out;
}

// ===========================================================================
console.log('=== A. Tarih yardımcıları (DST / sınır güvenli) ===');
// ===========================================================================

check('A1. shiftDateKey ileri/geri', () => {
  assertEqual(shiftDateKey('2026-08-30', 1), '2026-08-31', 'ileri');
  assertEqual(shiftDateKey('2026-08-30', -1), '2026-08-29', 'geri');
});

check('A2. Ay sınırı', () => {
  assertEqual(shiftDateKey('2026-03-01', -1), '2026-02-28', 'mart→şubat');
  assertEqual(shiftDateKey('2026-02-28', 1), '2026-03-01', 'şubat→mart (artık yıl değil)');
});

check('A3. Yıl sınırı', () => {
  assertEqual(shiftDateKey('2026-01-01', -1), '2025-12-31', 'ocak→aralık');
  assertEqual(shiftDateKey('2025-12-31', 1), '2026-01-01', 'aralık→ocak');
});

check('A4. DST geçiş günleri gün ATLAMAZ (öğle demirlemesi)', () => {
  // Avrupa ileri-saat 2026-03-29, geri-saat 2026-10-25; ABD ileri 2026-03-08.
  for (const [d, next] of [
    ['2026-03-08', '2026-03-09'],
    ['2026-03-29', '2026-03-30'],
    ['2026-10-25', '2026-10-26'],
  ]) {
    assertEqual(shiftDateKey(d, 1), next, `ileri ${d}`);
    assertEqual(shiftDateKey(next, -1), d, `geri ${next}`);
  }
});

// ===========================================================================
console.log('\n=== B. Temel seri analizi ===');
// ===========================================================================

check('B1. Boş veri → her şey 0, dönem yok', () => {
  const r = analyzeDisciplineStreaks({}, TODAY);
  assertEqual(r.currentStreak, 0, 'current');
  assertEqual(r.longestStreak, 0, 'longest');
  assertEqual(r.averageStreak, 0, 'average');
  assertEqual(r.totalStreaks, 0, 'total');
  assertDeepEqual(r.periods, [], 'periods');
});

check('B2. Tek günlük seri geçerlidir ve güncel sayılır', () => {
  const r = analyzeDisciplineStreaks({ [TODAY]: 'completed' }, TODAY);
  assertEqual(r.currentStreak, 1, 'current');
  assertEqual(r.longestStreak, 1, 'longest');
  assertEqual(r.averageStreak, 1, 'average');
  assertEqual(r.totalStreaks, 1, 'total');
  assertEqual(r.periods.length, 1, 'dönem sayısı');
  assertEqual(r.periods[0].isCurrent, true, 'isCurrent');
  assertEqual(r.periods[0].startDateKey, TODAY, 'start');
  assertEqual(r.periods[0].endDateKey, TODAY, 'end (tek gün, aynı tarih)');
  assertEqual(r.periods[0].length, 1, 'uzunluk');
});

check('B3. completed + partial BİRLİKTE seriyi sürdürür', () => {
  const statuses = {
    [dayBefore(2)]: 'completed',
    [dayBefore(1)]: 'partial',
    [TODAY]: 'completed',
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.currentStreak, 3, 'partial seriyi kırmamalı');
  assertEqual(r.totalStreaks, 1, 'tek dönem');
  assertEqual(r.longestStreak, 3, 'longest');
});

check('B4. MUT — `skipped` seriyi KIRAR', () => {
  const statuses = {
    [dayBefore(3)]: 'completed',
    [dayBefore(2)]: 'completed',
    [dayBefore(1)]: 'skipped',
    [TODAY]: 'completed',
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.totalStreaks, 2, 'skipped iki dönem üretmeli');
  assertEqual(r.currentStreak, 1, 'bugün tek başına güncel');
  assertEqual(r.longestStreak, 2, 'en uzun geçmiş dönem');
});

check('B5. MUT — EKSİK gün de seriyi kırar (skipped ile aynı)', () => {
  const statuses = {
    [dayBefore(3)]: 'completed',
    [dayBefore(2)]: 'completed',
    // dayBefore(1) YOK — eksik gün
    [TODAY]: 'completed',
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.totalStreaks, 2, 'eksik gün iki dönem üretmeli');
  assertEqual(r.currentStreak, 1, 'bugün tek başına güncel');
  assertEqual(r.longestStreak, 2, 'en uzun geçmiş dönem');
});

// ===========================================================================
console.log('\n=== C. Güncel seri (grace-aware) ===');
// ===========================================================================

check('C1. Bugün tamamlanınca bugüne kadar sayar', () => {
  const r = analyzeDisciplineStreaks(runOf('completed', 4, 5), TODAY);
  assertEqual(r.currentStreak, 5, 'bugün dahil 5');
  assertEqual(r.periods[0].isCurrent, true, 'güncel dönem işaretli');
});

check('C2. GRACE — bugün işaretsiz ama dün sürdürüyorsa seri korunur', () => {
  // Bugün YOK (henüz antrenman yapılmadı), dün ve öncesi completed.
  const statuses = {
    [dayBefore(3)]: 'completed',
    [dayBefore(2)]: 'completed',
    [dayBefore(1)]: 'completed',
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.currentStreak, 3, 'gün içi koruma: dünden geriye 3');
  const current = r.periods.find((p) => p.isCurrent);
  assert(current !== undefined, 'güncel dönem işaretli olmalı');
  assertEqual(current.endDateKey, dayBefore(1), 'güncel dönem dün biter');
});

check('C3. Bugün `skipped` ise güncel seri 0', () => {
  const statuses = {
    [dayBefore(2)]: 'completed',
    [dayBefore(1)]: 'completed',
    [TODAY]: 'skipped',
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.currentStreak, 0, 'bugün kaçırıldı → 0');
  assertEqual(r.totalStreaks, 1, 'dünde biten dönem hâlâ geçmişte var');
  assert(r.periods.every((p) => !p.isCurrent), 'hiçbir dönem güncel değil');
});

check('C4. MUT — GEÇMİŞTE biten (dünden eski) seri GÜNCEL sayılmaz', () => {
  // Son başarı 2 gün önce; bugün ve dün işaretsiz.
  const statuses = {
    [dayBefore(3)]: 'completed',
    [dayBefore(2)]: 'completed',
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.currentStreak, 0, 'son başarı dünden eski → 0');
  assert(r.periods.every((p) => !p.isCurrent), 'güncel dönem olmamalı');
  assertEqual(r.totalStreaks, 1, 'dönem geçmişte durur');
});

// ===========================================================================
console.log('\n=== D. Toplulaştırma ===');
// ===========================================================================

check('D1. En uzun seri DOĞRU seçilir', () => {
  const statuses = {
    ...runOf('completed', 12, 2), // uzunluk 2 (eski)
    ...runOf('completed', 8, 4), // uzunluk 4 (en uzun)
    ...runOf('completed', 1, 2), // uzunluk 2, bugün dahil (güncel)
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.longestStreak, 4, 'longest = 4');
  assertEqual(r.totalStreaks, 3, 'üç ayrı dönem');
  assertEqual(r.currentStreak, 2, 'güncel = 2');
});

check('D2. MUT — Ortalama BÜTÜN dönemlerden, yalnız en uzundan DEĞİL', () => {
  // Dönemler: 2 (geçmiş) + 1 (bugün). Ortalama 1.5, en uzun 2.
  const statuses = {
    [dayBefore(4)]: 'completed',
    [dayBefore(3)]: 'completed',
    // dayBefore(2), dayBefore(1) eksik → kırılma
    [TODAY]: 'completed',
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.totalStreaks, 2, 'iki dönem');
  assertEqual(r.longestStreak, 2, 'longest 2');
  assertEqual(r.averageStreak, 1.5, 'ortalama (2+1)/2 = 1.5, longest değil');
});

check('D3. Ortalama ondalık üretebilir', () => {
  // Uzunluklar 3 ve 2 → 2.5.
  const statuses = {
    ...runOf('completed', 6, 3),
    ...runOf('completed', 1, 2),
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.averageStreak, 2.5, '(3+2)/2');
});

// ===========================================================================
console.log('\n=== E. Gelecek, sıralama, sınır, mutasyonsuzluk ===');
// ===========================================================================

check('E1. MUT — GELECEK tarihler tamamen yok sayılır', () => {
  const statuses = {
    [dayBefore(1)]: 'completed',
    [TODAY]: 'completed',
    [dayBefore(-1)]: 'completed', // yarın
    [dayBefore(-5)]: 'completed', // gelecek
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.currentStreak, 2, 'yarın seriyi uzatmamalı');
  assertEqual(r.longestStreak, 2, 'gelecek en uzunu şişirmemeli');
  assertEqual(r.totalStreaks, 1, 'gelecek ek dönem üretmemeli');
  assertEqual(r.periods[0].endDateKey, TODAY, 'dönem bugünde biter');
});

check('E2. Ay/yıl sınırını AŞAN seri tek dönemdir', () => {
  // 2025-12-31 ve 2026-01-01 ardışık.
  const base = '2026-01-02';
  const statuses = {
    '2025-12-31': 'completed',
    '2026-01-01': 'completed',
    '2026-01-02': 'completed',
  };
  const r = analyzeDisciplineStreaks(statuses, base);
  assertEqual(r.totalStreaks, 1, 'sınır tek dönemi bölmemeli');
  assertEqual(r.currentStreak, 3, 'yıl sınırı boyunca 3');
  assertEqual(r.periods[0].startDateKey, '2025-12-31', 'start');
  assertEqual(r.periods[0].endDateKey, '2026-01-02', 'end');
});

check('E3. DST geçişini kapsayan seri tek dönemdir', () => {
  const base = '2026-03-30';
  const statuses = {
    '2026-03-28': 'completed',
    '2026-03-29': 'partial', // Avrupa ileri-saat günü
    '2026-03-30': 'completed',
  };
  const r = analyzeDisciplineStreaks(statuses, base);
  assertEqual(r.totalStreaks, 1, 'DST günü seriyi bölmemeli');
  assertEqual(r.currentStreak, 3, 'DST boyunca 3');
});

check('E4. Dönemler YENİ → ESKİ sıralı', () => {
  const statuses = {
    ...runOf('completed', 12, 2),
    ...runOf('completed', 6, 2),
    ...runOf('completed', 1, 2),
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.periods.length, 3, 'üç dönem');
  assert(
    r.periods[0].endDateKey > r.periods[1].endDateKey &&
      r.periods[1].endDateKey > r.periods[2].endDateKey,
    'endDateKey azalan sırada olmalı',
  );
  assertEqual(r.periods[0].isCurrent, true, 'en yeni dönem güncel');
});

check('E5. Girdi nesnesi MUTATE EDİLMEZ', () => {
  const statuses = Object.freeze({
    [dayBefore(2)]: 'completed',
    [dayBefore(1)]: 'partial',
    [TODAY]: 'completed',
  });
  const snapshot = JSON.stringify(statuses);
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  // Sonucu değiştirmek girdiye sızmamalı.
  r.periods[0].length = 999;
  assertEqual(JSON.stringify(statuses), snapshot, 'girdi değişti');
});

check('E6. Geçersiz durum seriyi kırar (skipped gibi)', () => {
  const statuses = {
    [dayBefore(2)]: 'completed',
    [dayBefore(1)]: 'bogus', // şema dışı
    [TODAY]: 'completed',
  };
  const r = analyzeDisciplineStreaks(statuses, TODAY);
  assertEqual(r.currentStreak, 1, 'geçersiz gün sürdürmemeli');
  assertEqual(r.totalStreaks, 2, 'geçersiz gün kırmalı');
});

// ===========================================================================
console.log('\n=== F. Wrapper geriye uyumluluğu ===');
// ===========================================================================

check('F1. calculateDisciplineStreak grace-aware currentStreak döndürür', () => {
  // Sistem-saati tabanlı; yalnız YAPI doğrulanır: sayı ve >= 0.
  const value = calculateDisciplineStreak({});
  assertEqual(value, 0, 'boş → 0');
  assertEqual(typeof calculateDisciplineStreak({ [toDateKey(new Date())]: 'completed' }), 'number', 'sayı döner');
});

// ===========================================================================
console.log('\n=== G. UI sözleşmesi (kaynak taraması) ===');
// ===========================================================================

check('G1. Profil seri alanı `/streaks` route\'una ERİŞİLEBİLİR bağlı', () => {
  const profile = source('app/(tabs)/profile.tsx');
  assert(/onDayStreakPress=\{\(\) => router\.push\('\/streaks'\)\}/.test(profile),
    'profil onDayStreakPress ile /streaks push etmiyor');

  const proof = source('components/rewards/profile-proof-stats.tsx');
  assert(/onDayStreakPress\?: \(\) => void/.test(proof), 'opsiyonel onDayStreakPress prop yok');
  assert(/accessibilityRole="button"/.test(proof), 'seri alanı buton rolü almıyor');
  assert(/proofDayStreakOpenA11y/.test(proof), 'aç erişilebilirlik metni kullanılmıyor');
  // Yalnız seri alanı buton olmalı: tek bir Pressable/onPress dalı.
  assert(/if \(onPress\)/.test(proof), 'yalnız seri alanı koşullu buton değil');
  // Dokunma alanı >= 44 pt (hitSlop görsel yüksekliği korur).
  assert(/hitSlop=/.test(proof), '44 pt dokunma alanı için hitSlop yok');
});

check('G2. `/streaks` ekranı RANK SEZONU veya Supabase KULLANMAZ', () => {
  const code = stripComments(source('app/streaks.tsx'));
  for (const forbidden of ['useRanks', 'rank-context', 'rankSeason', 'supabase', 'createClient']) {
    assert(!new RegExp(forbidden).test(code), `seri ekranı yasak bağımlılık içeriyor: ${forbidden}`);
  }
  // Yalnız context'ten okur; yeni veri isteği açmaz. Analiz saf çekirdekten gelir.
  assert(/useWorkout\(\)/.test(code), 'WorkoutContext kullanılmıyor');
  assert(/analyzeDisciplineStreaks/.test(code), 'saf çekirdek kullanılmıyor');
});

check('G3. Seri ekranı emoji/gradient/yeni asset İÇERMEZ', () => {
  const screen = source('app/streaks.tsx');
  assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(screen), 'emoji var');
  assert(!/LinearGradient|expo-linear-gradient|require\(/.test(screen), 'gradient/asset var');
});

check('G4. Yeni metinler TR ve EN\'de LOKALİZE', () => {
  const tr = source('locales/tr.ts');
  const en = source('locales/en.ts');
  const keys = [
    'navTitle', 'currentStreak', 'longestStreak', 'averageStreak', 'totalStreaks',
    'historyTitle', 'inProgress', 'dayCount', 'dayCountOne', 'emptyTitle', 'emptyBody',
  ];
  for (const key of keys) {
    assert(new RegExp(`\\n    ${key}:`).test(tr), `tr.ts eksik: ${key}`);
    assert(new RegExp(`\\n    ${key}:`).test(en), `en.ts eksik: ${key}`);
  }
  assert(/proofDayStreakOpenA11y:/.test(tr) && /proofDayStreakOpenA11y:/.test(en),
    'aç erişilebilirlik anahtarı eksik');
});

// ---------------------------------------------------------------------------

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü:`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`\n✓ Seri verileri ve seri geçmişi harness: ${pass} kontrol geçti.`);
console.log('  (GERÇEK saf çekirdek derlenip çalıştırıldı; kopya algoritma test edilmedi.)');
