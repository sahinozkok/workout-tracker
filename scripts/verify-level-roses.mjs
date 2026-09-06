#!/usr/bin/env node
/**
 * SEVİYE GÜLLERİ — KATALOG + AÇILMA/SEÇİM KURALLARI + ASSET DOĞRULAMA HARNESS'I
 *
 * `constants/level-roses.ts` GERÇEKTEN derlenip çalıştırılır (kaynak-metin
 * taraması değil): açılma, varsayılan, gösterim ve seçim kuralları saf
 * fonksiyonlarla sınanır. Ayrıca 25 asset dosyasının gerçekten var olduğu,
 * PNG + alfa taşıdığı ve emblem kaynak haritasının doğru eşlediği doğrulanır.
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const source = (p) => readFileSync(join(ROOT, p), 'utf8');

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

// --- compile + import the pure catalog ---
const outDir = mkdtempSync(join(tmpdir(), 'rosea-levelroses-'));
let cat;
try {
  execFileSync(
    'npx',
    ['tsc', join(ROOT, 'constants/level-roses.ts'), '--outDir', outDir, '--target', 'es2020',
      '--module', 'esnext', '--moduleResolution', 'bundler', '--strict'],
    { cwd: ROOT, stdio: 'pipe' },
  );
  cat = await import(pathToFileURL(join(outDir, 'level-roses.js')).href);
} catch (error) {
  console.error('constants/level-roses.ts derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}

const EXPECTED_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 20, 25, 30, 35, 40, 50, 65, 80, 100, 150, 200];

// 1. Tam 25 benzersiz sembol; kimlik/seviye eşlemesi kaynak dosyalarla birebir.
check('1. 25 benzersiz sembol; rose_<n> → unlockLevel n', () => {
  assert.equal(cat.LEVEL_ROSES.length, 25, '25 sembol olmalı');
  const ids = new Set(cat.LEVEL_ROSES.map((r) => r.id));
  assert.equal(ids.size, 25, 'kimlikler benzersiz olmalı');
  const levels = cat.LEVEL_ROSES.map((r) => r.unlockLevel);
  assert.deepEqual(levels, EXPECTED_LEVELS, 'açılma seviyeleri kaynak eşlemesiyle aynı olmalı');
  for (const lv of EXPECTED_LEVELS) {
    assert.equal(cat.roseUnlockLevel(`rose_${lv}`), lv, `rose_${lv} açılma seviyesi ${lv}`);
  }
  // Sıra açılma seviyesine göre artan.
  for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i] > levels[i - 1], 'sıra artan olmalı');
});

// 2. Sınır seviyeler: açılmış gül SAYILARI.
check('2. Sınır seviyeler doğru sayıda gül açar', () => {
  const count = (lv) => cat.unlockedRoses(lv).length;
  assert.equal(count(1), 1, 'L1 → 1');
  assert.equal(count(5), 5, 'L5 → 5');
  assert.equal(count(10), 10, 'L10 → 10');
  assert.equal(count(13), 13, 'L13 → 13');
  assert.equal(count(14), 13, 'L14 → yine 13 (sonraki L15)');
  assert.equal(count(15), 14, 'L15 → 14');
  assert.equal(count(199), 24, 'L199 → 24');
  assert.equal(count(200), 25, 'L200 → 25');
  assert.equal(count(999), 25, 'L999 → 25');
  // Geçersiz seviye en az rose_1 açar (liste boş kalmaz).
  assert.equal(count(0), 0, 'L0 → 0');
  assert.equal(cat.highestUnlockedRose(0).id, 'rose_1', 'L0 varsayılanı rose_1');
});

// 3. Varsayılan = en yüksek açılmış; otomatik mod seviyeyle yükselir.
check('3. Seçim yoksa varsayılan en yüksek açılmış güldür', () => {
  assert.equal(cat.resolveDisplayedRose(13, null).id, 'rose_13', 'L13 otomatik → rose_13');
  assert.equal(cat.resolveDisplayedRose(14, null).id, 'rose_13', 'L14 otomatik → hâlâ rose_13');
  assert.equal(cat.resolveDisplayedRose(15, null).id, 'rose_15', 'L15 otomatik → rose_15');
  assert.equal(cat.resolveDisplayedRose(200, null).id, 'rose_200', 'L200 otomatik → rose_200');
  assert.equal(cat.resolveDisplayedRose(999, null).id, 'rose_200', 'L999 otomatik → rose_200');
});

// 4. Eski gülü seçmek GÖSTERİMİ değiştirir ama seviyeyi/bilgiyi değiştirmez.
check('4. Kazanılmış eski gül seçilebilir; seviye ayrı kalır', () => {
  // L13 kullanıcısı L1 gülünü seçer → gösterilen rose_1 olur.
  assert.equal(cat.resolveDisplayedRose(13, 'rose_1').id, 'rose_1', 'eski gül gösterilmeli');
  // resolveDisplayedRose seviyeyi DÖNDÜRMEZ/DEĞİŞTİRMEZ — yalnız gül döner.
  assert.equal(cat.canSelectRose('rose_1', 13), true, 'L13 kullanıcısı rose_1 seçebilir');
  assert.equal(cat.canSelectRose('rose_5', 13), true, 'kazanılmış rose_5 seçilebilir');
});

// 5. Yeni seviyede MANUEL tercih korunur; kendiliğinden değişmez.
check('5. Manuel tercih seviye atlayınca korunur', () => {
  const sel = 'rose_5';
  assert.equal(cat.resolveDisplayedRose(13, sel).id, 'rose_5', 'L13 manuel rose_5');
  assert.equal(cat.resolveDisplayedRose(50, sel).id, 'rose_5', 'L50 manuel HÂLÂ rose_5 (otomatik yükselmez)');
  // Aynı anda otomatik mod (null) en yükseğe taşınır — ayrım korunur.
  assert.equal(cat.resolveDisplayedRose(50, null).id, 'rose_50', 'otomatik mod L50 → rose_50');
});

// 6. Kilitli / bilinmeyen seçim REDDEDİLİR (istemci ön kontrolü).
check('6. Kilitli ve bilinmeyen seçim reddedilir', () => {
  assert.equal(cat.isRoseUnlocked('rose_200', 199), false, 'L199 rose_200 kilitli');
  assert.equal(cat.canSelectRose('rose_200', 199), false, 'L199 rose_200 seçemez');
  assert.equal(cat.canSelectRose('rose_999', 999), false, 'bilinmeyen kimlik reddedilir');
  assert.equal(cat.isKnownRoseId('rose_42'), false, 'katalogda olmayan kimlik geçersiz');
  assert.equal(cat.canSelectRose(null, 1), true, 'null (otomatik) her zaman geçerli');
  // Kilitli seçim GÖSTERİMDE otomatik varsayılana (en yüksek açık) düşer.
  assert.equal(cat.resolveDisplayedRose(199, 'rose_200').id, 'rose_150', 'L199 kilitli rose_200 → rose_150');
});

// 7. 25 asset dosyası var; PNG + alfa (renk tipi 6); makul çözünürlük.
function readPng(rel) {
  const buf = readFileSync(join(ROOT, rel));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(buf.subarray(0, 8).equals(sig), `${rel} geçerli PNG olmalı`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}
check('7. 25 asset gerçek alfa + makul çözünürlük', () => {
  for (const lv of EXPECTED_LEVELS) {
    const rel = `assets/images/level-roses/rose-${lv}.png`;
    const png = readPng(rel);
    assert.equal(png.colorType, 6, `${rel} alfa kanalı taşımalı (renk tipi 6)`);
    assert.ok(png.width >= 128 && png.height >= 128 && png.width <= 1024 && png.height <= 1024,
      `${rel} makul çözünürlükte (${png.width}×${png.height})`);
  }
});

// 8. Emblem kaynak haritası 25 kimliği doğru dosyalara eşler; tint/glow yok.
check('8. Emblem kaynak haritasi 25 kimligi dogru assete esler', () => {
  const emblem = source('components/rewards/level-rose-emblem.tsx');
  const pairs = [...emblem.matchAll(/(rose_\d+):\s*require\('([^']+)'\)/g)];
  const map = Object.fromEntries(pairs.map(([, id, path]) => [id, path]));
  assert.equal(Object.keys(map).length, 25, 'emblem 25 asset eşlemesi içermeli');
  for (const lv of EXPECTED_LEVELS) {
    assert.equal(map[`rose_${lv}`], `@/assets/images/level-roses/rose-${lv}.png`,
      `rose_${lv} → rose-${lv}.png`);
  }
  assert.ok(emblem.includes("from 'expo-image'"), 'emblem expo-image kullanmalı');
  assert.ok(emblem.includes('contentFit="contain"'), 'emblem contain kullanmalı');
  assert.ok(!/tintColor/.test(emblem), 'emblem tint uygulamamalı');
});

// 9. ARKADAŞ gül gösterim durumları GERÇEKTEN ayrılır (yürütülebilir).
check('9. resolveFriendRoseDisplay: loading/unavailable/ready ayrı sonuç', () => {
  // ready + null → arkadaşın seviyesine göre OTOMATİK (en yüksek açık).
  const autoAt13 = cat.resolveFriendRoseDisplay({ kind: 'ready', selectedId: null }, 13);
  assert.deepEqual(autoAt13, { mode: 'rose', roseId: 'rose_13' }, 'ready+null → otomatik rose_13');
  // ready + açık seçim → o gül (manuel doğru asset).
  const manual = cat.resolveFriendRoseDisplay({ kind: 'ready', selectedId: 'rose_5' }, 13);
  assert.deepEqual(manual, { mode: 'rose', roseId: 'rose_5' }, 'ready+rose_5 → rose_5');
  // BAŞARILI null ile BAŞARISIZ istek FARKLI sonuç üretir.
  const unavailable = cat.resolveFriendRoseDisplay({ kind: 'unavailable' }, 13);
  assert.deepEqual(unavailable, { mode: 'placeholder', reason: 'unavailable' }, 'unavailable → placeholder');
  assert.notDeepEqual(autoAt13, unavailable, 'başarılı null ile başarısız istek aynı olmamalı');
  // loading ile unavailable de FARKLI (biri "henüz bilmiyoruz").
  const loading = cat.resolveFriendRoseDisplay({ kind: 'loading' }, 13);
  assert.deepEqual(loading, { mode: 'placeholder', reason: 'loading' }, 'loading → placeholder(loading)');
  assert.notDeepEqual(loading, unavailable, 'loading ile unavailable ayrı olmalı');
  // Hata/yükleme HİÇBİR gül döndürmez (tahmini sembol yok).
  assert.equal(unavailable.mode, 'placeholder', 'unavailable gül döndürmemeli');
  assert.equal(loading.mode, 'placeholder', 'loading gül döndürmemeli');
  // LEVEL, gülün açılma seviyesiyle DEĞİŞMEZ: L13 kullanıcı rose_1 (açılma 1)
  // seçse bile karar yalnız gül kimliğidir; seviye bu fonksiyonda hiç geçmez.
  const oldPick = cat.resolveFriendRoseDisplay({ kind: 'ready', selectedId: 'rose_1' }, 13);
  assert.deepEqual(oldPick, { mode: 'rose', roseId: 'rose_1' }, 'eski gül seçimi gül kimliğini verir');
  assert.ok(!('level' in oldPick) && !('unlockLevel' in oldPick), 'karar seviye taşımaz');
});

// 10. GEÇERSİZ sunucu yanıtı sessizce OTOMATİK'e çevrilmez (yürütülebilir).
check('10. parseLevelRoseResponse: null=otomatik, string=seçim, geçersiz=throw', () => {
  assert.equal(cat.parseLevelRoseResponse(null), null, 'null → otomatik (null)');
  assert.equal(cat.parseLevelRoseResponse('rose_15'), 'rose_15', 'string → seçim');
  assert.equal(cat.parseLevelRoseResponse(''), null, 'boş string → otomatik (null)');
  // Geçersiz yanıtlar OTOMATİK'e (null) çevrilmez → hata fırlatır.
  for (const bad of [42, undefined, {}, [], true]) {
    assert.throws(() => cat.parseLevelRoseResponse(bad), /invalid_level_rose_response/,
      `geçersiz yanıt (${JSON.stringify(bad)}) null yerine hata olmalı`);
  }
});

rmSync(outDir, { force: true, recursive: true });

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Seviye gülleri harness: ${passed} kontrol geçti (25 sembol, kurallar + assetler).`);
