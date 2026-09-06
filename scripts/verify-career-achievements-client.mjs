#!/usr/bin/env node
/**
 * KARİYER BAŞARIMLARI — İSTEMCİ HARNESS'I (statik + YÜRÜTÜLEBİLİR)
 *
 * (1) Gerçek `reconcileCelebrations` (kutlama baseline mantığı) DERLENİP
 *     ÇALIŞTIRILIR: backfill yağmuru yok, bir kez kutlama, kuyruk sırası.
 * (2) Locale kapsamı (30 ad+açıklama, TR/EN + ekran/birim metinleri).
 * (3) İstemci geçişi: profil/arkadaş kariyer vitrinini kullanır, yeni ekranlar
 *     eski `SeasonAchievementKey`'e sızmaz, "SEASON BADGES" → "BAŞARIMLAR".
 * (4) Birim biçimleme (km/dk/kg) katalog atamaları.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed += 1; } catch (e) { failures.push(`${name}: ${e.message}`); } };

// --- Gerçek reconcileCelebrations'ı derleyip çalıştır ---
const out = mkdtempSync(join(tmpdir(), 'career-cel-'));
writeFileSync(
  join(out, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      baseUrl: ROOT, paths: { '@/*': ['*'] }, module: 'esnext', moduleResolution: 'bundler',
      target: 'es2020', strict: true, skipLibCheck: true, outDir: out,
    },
    files: ['utils/achievement-celebration.ts', 'constants/achievement-order.ts'].map((p) => join(ROOT, p)),
  }),
);
let cel;
try {
  execFileSync('npx', ['tsc', '-p', join(out, 'tsconfig.json')], { cwd: ROOT, stdio: 'pipe' });
  // Emitted import specifier '@/constants/achievement-order' → relative.
  const celPath = join(out, 'utils', 'achievement-celebration.js');
  writeFileSync(celPath, readFileSync(celPath, 'utf8').replace(/'@\/constants\/achievement-order'/g, "'../constants/achievement-order.js'"));
  cel = await import(pathToFileURL(celPath).href);
} catch (error) {
  console.error('reconcileCelebrations derlenemedi:\n' + (error.stdout?.toString() ?? error.message));
  process.exit(1);
}

check('1. Baseline: ilk yükleme backfill YAĞMURU üretmez', () => {
  const r = cel.reconcileCelebrations(['first_step', 'warmup_done', 'perfect_week'], undefined, new Set());
  assert.deepEqual(r.toEnqueue, [], 'ilk yüklemede kutlama olmamalı');
  assert.deepEqual([...r.baseline].sort(), ['first_step', 'perfect_week', 'warmup_done'], 'baseline tüm açıkları onaylamalı');
});

check('2. Yeni unlock kuyruğa tek girer; katalog sırasında; kuyruktaki tekrar girmez', () => {
  const base = new Set(['first_step']);
  // iki yeni açılış (sıra karışık) → katalog sırasında kuyruğa
  const r = cel.reconcileCelebrations(['warmup_done', 'first_step', 'three_day_spark'], base, new Set());
  assert.deepEqual(r.toEnqueue, ['warmup_done', 'three_day_spark'], 'yeni açılışlar katalog sırasında kuyruğa');
  assert.equal(r.baseline, undefined, 'baseline değişmemeli (ilk yükleme değil)');
  // Refresh sırasında zaten KUYRUKTAKİ başarım tekrar EKLENMEZ (duplicate yok).
  const r2 = cel.reconcileCelebrations(['warmup_done', 'first_step', 'three_day_spark'], base, new Set(['warmup_done', 'three_day_spark']));
  assert.deepEqual(r2.toEnqueue, [], 'kuyruktaki başarım tekrar eklenmez');
});

check('3. ACK-ON-SHOWN: gösterilmeden kapanınca sonraki açılışta yeniden bulunur', () => {
  let acknowledged = new Set(['first_step']); // baseline: first_step onaylı
  // Yeni unlock 'warmup_done' → kuyruğa girer AMA onaylanmaz (henüz gösterilmedi).
  const r = cel.reconcileCelebrations(['first_step', 'warmup_done'], acknowledged, new Set());
  assert.deepEqual(r.toEnqueue, ['warmup_done'], 'yeni unlock kuyruğa');
  // reconcile ONAYLI'yı BÜYÜTMEZ (gösterilmeden tüketmez).
  assert(!acknowledged.has('warmup_done'), 'reconcile gösterilmeden onaylamamalı');
  // Uygulama overlay gösterilmeden kapandı → sonraki açılış: yine bulunur.
  const rAgain = cel.reconcileCelebrations(['first_step', 'warmup_done'], acknowledged, new Set());
  assert.deepEqual(rAgain.toEnqueue, ['warmup_done'], 'kapanınca yeniden bulunmalı');
  // Overlay gösterildi ve ONAYLANDI (context ack): şimdi onaylı kümeye eklenir.
  acknowledged = new Set([...acknowledged, 'warmup_done']);
  const rAcked = cel.reconcileCelebrations(['first_step', 'warmup_done'], acknowledged, new Set());
  assert.deepEqual(rAcked.toEnqueue, [], 'onay sonrası tekrar gösterilmez');
});

check('3b. Sezon değişimi/veri düşüşü kutlama kaydını sıfırlamaz', () => {
  const ack = new Set(['first_step', 'warmup_done']);
  const r = cel.reconcileCelebrations(['first_step'], ack, new Set());
  assert.deepEqual(r.toEnqueue, [], 'düşüşte kutlama yok');
  assert(ack.has('warmup_done'), 'onaylı kayıt korunur');
});

// --- Context sözleşmesi: debounce/coalesce/single-flight/owner + ack persistence ---
check('3c. Context: debounce/coalesce/tek-uçuş, owner guard, ack-on-shown persistence', () => {
  const ctx = src('context/achievement-context.tsx');
  assert(/SYNC_DEBOUNCE_MS/.test(ctx) && /setTimeout\(/.test(ctx), 'debounce yok');
  assert(/syncInFlightRef/.test(ctx) && /syncQueuedRef/.test(ctx), 'tek-uçuş/coalesce yok');
  assert(/owner !== ownerRef\.current/.test(ctx), 'owner guard yok');
  // ack YALNIZCA acknowledgeCelebration'da (gösterim sonrası) kalıcılaşır.
  assert(/const acknowledgeCelebration =[\s\S]*?persistAck/.test(ctx), 'ack gösterim sonrası kalıcılaşmıyor');
  // reconcile çağrısı baseline dışında ack'i BÜYÜTMEZ (yalnız baseline persist).
  assert(/reconcileCelebrations\(unlocked, acknowledgedRef\.current, queuedRef\.current\)/.test(ctx), 'reconcile 3-arg çağrısı yok');
  // Kullanıcı başına, sürümlü AsyncStorage anahtarı (hesap izolasyonu).
  assert(/career-ach-ack\/v1\//.test(ctx), 'sürümlü kullanıcı-başı anahtar yok');
  // Foreground yenilemesi (interval/polling yok).
  assert(/AppState\.addEventListener\('change'/.test(ctx) && /requestSync\(\)/.test(ctx), 'foreground yenilemesi yok');
});

check('3d. Mutation noktaları ve ekran focus\'u senkron İSTER (fire-and-forget)', () => {
  const workout = src('context/workout-context.tsx');
  assert(/achievementSync\?\.\(\)/.test(workout), 'workout tamamlanma/program senkron istemiyor');
  const profile = src('app/(tabs)/profile.tsx');
  assert(/requestAchievementSync\(\)/.test(profile), 'profil (rose/renk) senkron istemiyor');
  assert(/useFocusEffect/.test(profile), 'profil focus yenilemesi yok');
  assert(/useFocusEffect/.test(src('app/achievements.tsx')), 'Başarımlar ekranı focus yenilemesi yok');
  assert(/achievementSync\?\.\(\)/.test(src('components/friends/friends-screen.tsx')), 'arkadaş kabul senkronu yok');
  assert(/achievementSync\?\.\(\)/.test(src('app/messages/[userId].tsx')), 'mesaj gönderme senkronu yok');
  assert(/achievementSync\?\.\(\)/.test(src('app/(tabs)/coach.tsx')), 'AI yanıt senkronu yok');
  // Koç analizi CTA gerçek AI akışını çağırır ve başarıda senkron ister.
  const history = src('app/(tabs)/history.tsx');
  assert(/WorkoutAnalysisSheet/.test(history) && /onAnalyzed=\{\(\) => achievementSync\?\.\(\)\}/.test(history), 'koç analizi CTA/senkron yok');
  assert(/generateWorkoutAnalysis/.test(src('components/workout-analysis-sheet.tsx')), 'analiz sheet gerçek AI çağırmıyor');
});

check('3e. Koç analizi — eşzamanlılık/hata durumları (Blocker 6)', () => {
  const service = src('services/ai/workout-insights.ts');
  // Servis hata türlerini AYIRIR ve in_progress sonucunu döner (paralel Gemini yok).
  assert(/class WorkoutAnalysisError/.test(service), 'WorkoutAnalysisError türü yok');
  assert(/'quota' \| 'connection' \| 'generic'/.test(service), 'hata türleri (quota/connection/generic) yok');
  assert(/status: 'in_progress'/.test(service), 'in_progress sonucu yok');
  assert(/context\.status === 429/.test(service), 'kota (429) ayrımı yok');
  assert(/feature: 'workout_analysis'/.test(service), 'analiz feature workout_analysis değil');

  const sheet = src('components/workout-analysis-sheet.tsx');
  // Reduce Motion → slide DEĞİL (fade/none). 44pt dokunma. in_progress + hata-türü metni.
  assert(/useReducedMotion/.test(sheet), 'sheet Reduce Motion algılamıyor');
  assert(/animationType=\{reduceMotion \? 'fade' : 'slide'\}/.test(sheet), 'Reduce Motion\'da slide kapatılmıyor');
  assert(/state === 'in_progress'/.test(sheet), 'sheet in_progress durumunu göstermiyor');
  assert(/coachAnalysis\.inProgress/.test(sheet), 'in_progress metni yok');
  assert(/errorKind === 'quota'/.test(sheet) && /errorKind === 'connection'/.test(sheet), 'hata türüne göre metin ayrımı yok');
  assert(/coachAnalysis\.errorQuota/.test(sheet) && /coachAnalysis\.errorConnection/.test(sheet), 'kota/bağlantı hata metinleri yok');
  // Stale-promise koruması (oturum değişince eski sonuç yok sayılır) + tek senkron.
  assert(/requestRef\.current !== requestId/.test(sheet), 'stale-promise koruması yok');
  assert(/analyzedRef\.current/.test(sheet), 'onAnalyzed tek-sefer koruması yok');
  // Locale: yeni durum metinleri TR ve EN\'de var.
  for (const loc of [['en', src('locales/en.ts')], ['tr', src('locales/tr.ts')]]) {
    for (const k of ['inProgress', 'errorQuota', 'errorConnection']) {
      assert(new RegExp(`${k}: '[^']+'`).test(loc[1]), `${loc[0]}: coachAnalysis.${k} yok`);
    }
  }
});

check('3f. Koç analizi sheet — stale-close/generation guard (Blocker 5)', () => {
  const sheet = src('components/workout-analysis-sheet.tsx');
  // STATİK: kapanışta (!sessionId) ve cleanup'ta jenerasyon geçersizlenir; tek senkron.
  assert(/if \(!sessionId\) \{[\s\S]*?requestRef\.current \+= 1;[\s\S]*?return;/.test(sheet), 'kapanışta (!sessionId) jenerasyon geçersizlenmiyor');
  assert(/return \(\) => \{[\s\S]*?requestRef\.current \+= 1;/.test(sheet), 'effect cleanup jenerasyonu geçersizlemiyor (unmount/session değişimi)');
  assert(/requestRef\.current !== requestId/.test(sheet), 'stale-promise guard yok');
  assert(/analyzedRef\.current/.test(sheet), 'onAnalyzed tek-sefer guard yok');

  // DAVRANIŞ MODELİ: bileşenin generation-guard mantığının birebir aynısı çalıştırılır.
  function makeSheet(onAnalyzed) {
    let requestRef = 0;
    let analyzed = false;
    const s = { state: 'idle', insight: null, syncCount: 0 };
    const settle = (id) => ({
      ready(insight) {
        if (requestRef !== id) return; // stale guard
        s.insight = insight; s.state = 'ready';
        if (!analyzed) { analyzed = true; s.syncCount += 1; onAnalyzed(); }
      },
      inProgress() { if (requestRef !== id) return; s.state = 'in_progress'; },
      error() { if (requestRef !== id) return; s.state = 'error'; },
    });
    const run = () => { const id = ++requestRef; s.state = 'loading'; return settle(id); };
    return {
      s,
      start() { s.insight = null; analyzed = false; return run(); }, // effect body (yeni session)
      changeTo() { requestRef += 1; s.insight = null; analyzed = false; return run(); }, // cleanup + body
      close() { requestRef += 1; }, // cleanup + (!sessionId) dalı
      unmount() { requestRef += 1; },
      retry() { return run(); }, // analyzed sıfırlanmaz
    };
  }

  // 1) İstek başlat → sheet kapat → promise resolve → state/onAnalyzed DEĞİŞMEZ.
  let calls = 0;
  let sh = makeSheet(() => { calls += 1; });
  let p = sh.start();
  sh.close();
  p.ready({ headline: 'x' });
  assert(sh.s.state === 'loading' && calls === 0, 'kapanıştan sonra eski promise state/onAnalyzed değiştirdi');

  // 2) Session A başlat → Session B aç → A geç döner → B ETKİLENMEZ.
  calls = 0;
  sh = makeSheet(() => { calls += 1; });
  const pA = sh.start();
  const pB = sh.changeTo();
  pA.ready({ headline: 'A' });
  assert(sh.s.insight === null && sh.s.state === 'loading', 'eski session cevabı yeni ekranı etkiledi');
  pB.ready({ headline: 'B' });
  assert(sh.s.insight?.headline === 'B' && sh.s.state === 'ready', 'yeni session sonucu uygulanmadı');

  // 3) B başarılı → onAnalyzed YALNIZ bir kez (tekrar resolve etkisiz).
  assert(calls === 1, 'onAnalyzed bir kez çağrılmadı');
  pB.ready({ headline: 'B2' });
  assert(calls === 1, 'onAnalyzed birden fazla çağrıldı');

  // 4) In-progress → retry → completed → YALNIZ bir başarı senkronu.
  calls = 0;
  sh = makeSheet(() => { calls += 1; });
  const p1 = sh.start();
  p1.inProgress();
  assert(sh.s.state === 'in_progress' && calls === 0, 'in_progress yanlış işlendi');
  const p2 = sh.retry();
  p2.ready({ headline: 'done' });
  assert(sh.s.state === 'ready' && calls === 1, 'retry sonrası tek senkron değil');
  const p3 = sh.retry();
  p3.ready({ headline: 'again' });
  assert(calls === 1, 'retry başarı senkronu birden fazla');
});

// --- Locale kapsamı ---
const en = src('locales/en.ts');
const tr = src('locales/tr.ts');
const KEYS = [...src('constants/achievement-order.ts').matchAll(/'([a-z0-9_]+)'/g)]
  .map((m) => m[1]).filter((k) => k.includes('_'));
const KEY_SET = [...new Set(KEYS)];

check('4. Locale: 30 başarımın ad+açıklaması TR ve EN\'de var', () => {
  assert.equal(KEY_SET.length, 30, `anahtar sayısı 30 değil: ${KEY_SET.length}`);
  for (const loc of [['en', en], ['tr', tr]]) {
    const block = /careerAchievements: \{([\s\S]*?)\n  \},/.exec(loc[1]);
    assert(block, `${loc[0]}: careerAchievements bloğu yok`);
    const items = /items: \{([\s\S]*?)\n    \},/.exec(block[1]);
    assert(items, `${loc[0]}: items bloğu yok`);
    for (const key of KEY_SET) {
      assert(new RegExp(`${key}: \\{ name: '[^']+', description: '[^']+' \\}`).test(items[1]), `${loc[0]}: ${key} ad/açıklama eksik`);
    }
    // ekran/birim/showcase metinleri
    for (const token of ['sections:', 'units:', 'showcase:', 'profileTitle:', 'unlockedOn:', 'detail:']) {
      assert(block[1].includes(token), `${loc[0]}: careerAchievements.${token} eksik`);
    }
  }
  // Yeniden adlandırma: yeni vitrin başlığı BAŞARIMLAR/ACHIEVEMENTS.
  assert(/profileTitle: 'ACHIEVEMENTS'/.test(en), 'EN vitrin başlığı ACHIEVEMENTS değil');
  assert(/profileTitle: 'BAŞARIMLAR'/.test(tr), 'TR vitrin başlığı BAŞARIMLAR değil');
});

// --- İstemci geçişi ---
check('5. Profil ve arkadaş KARİYER vitrinini kullanır (sezon değil)', () => {
  const profile = src('app/(tabs)/profile.tsx');
  const friend = src('app/profile/[userId].tsx');
  assert(/<ProfileCareerShowcase/.test(profile), 'profil kariyer vitrini kullanmıyor');
  assert(!/ProfileAchievementShowcase/.test(profile), 'profilde eski sezon vitrini kalmış');
  assert(/useAchievements\(\)/.test(profile), 'profil kariyer context\'i kullanmıyor');
  assert(/<ProfileCareerShowcase/.test(friend), 'arkadaş profili kariyer vitrini kullanmıyor');
  assert(!/ProfileAchievementShowcase/.test(friend), 'arkadaşta eski sezon vitrini kalmış');
  // arkadaş kariyer servisini kullanır
  assert(/from '@\/services\/achievements'/.test(friend), 'arkadaş kariyer servisini kullanmıyor');
});

check('6. Yeni ekranlar SeasonAchievementKey\'e SIZMAZ; görsel tek kaynaktan', () => {
  for (const p of [
    'app/achievements.tsx',
    'app/achievements-showcase.tsx',
    'context/achievement-context.tsx',
    'components/ranks/profile-career-showcase.tsx',
    'components/achievements/career-achievements-view.tsx',
  ]) {
    const s = src(p);
    assert(!/SeasonAchievementKey/.test(s), `${p} eski sezon anahtarına sızıyor`);
  }
  // Sunum ORTAK bileşende: görsel tek kaynaktan gelir — paylaşılan
  // `AchievementSymbol` bileşeni `AchievementKey` ile çağrılır (bileşen içinde
  // ACHIEVEMENT_VISUALS PNG kaynak haritasını okur). Kariyer locale'i ve
  // Kolay/Orta/Zor bölümleri burada. Tam ekran + Rank sekmesi bunu paylaşır.
  const view = src('components/achievements/career-achievements-view.tsx');
  assert(/<AchievementSymbol[\s\S]*?achievementKey=\{a\.key\}/.test(view), 'ortak bileşen görseli paylaşılan AchievementSymbol ile çizmiyor');
  assert(/careerAchievements\./.test(view), 'ortak bileşen kariyer locale\'ini kullanmıyor');
  assert(/sections\.\$\{category\}/.test(view), 'ortak bileşen Kolay/Orta/Zor bölümlerini kullanmıyor');
  // Tam ekran host da kariyer locale'inde kalır (screenLead vb.).
  assert(/careerAchievements\./.test(src('app/achievements.tsx')), 'tam ekran kariyer locale\'ini kullanmıyor');
});

// --- Birim biçimleme (katalog atamaları) ---
check('7. Birim atamaları: mesafe km, süre dk, hacim kg', () => {
  const cat = src('constants/achievements.ts');
  assert(/cardio_traveler'.*unit: 'distance_km'/.test(cat.replace(/\n/g, ' ')), 'cardio_traveler distance_km değil');
  assert(/against_time'.*unit: 'duration_min'/.test(cat.replace(/\n/g, ' ')), 'against_time duration_min değil');
  for (const k of ['ten_ton_club', 'quarter_million']) {
    assert(new RegExp(`${k}'.*unit: 'volume_kg'`).test(cat.replace(/\n/g, ' ')), `${k} volume_kg değil`);
  }
  // formatAchievementValue 3 birimi de işler
  assert(/distance_km'[\s\S]*?\/ 1000[\s\S]*?km/.test(cat), 'km biçimlemesi yok');
  assert(/duration_min'[\s\S]*?\/ 60/.test(cat), 'dakika biçimlemesi yok');
  assert(/volume_kg'[\s\S]*?kg/.test(cat), 'kg biçimlemesi yok');
});

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Kariyer başarımları İSTEMCİ harness: ${passed} kontrol geçti (gerçek baseline + locale + geçiş + birim).`);
