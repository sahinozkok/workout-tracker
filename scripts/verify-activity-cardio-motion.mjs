#!/usr/bin/env node
/**
 * KARDİYO DURUM GEÇİŞLERİ — MOTION SÖZLEŞMESİ HARNESS'I
 *
 * Kapsam: `app/program/[id]/day/[dayId]/index.tsx` kardiyo panelinin GÖRSEL
 * durum geçişleri. Başlat → Duraklat/Devam Et + Bitir → bitirme formu değişimi
 * tek sakin `MotionSwap` ile; küçük koşullu satırlar (duraklatıldı, hata, RPE
 * bandı, tempo) `MotionCollapsible` ile yumuşatılır.
 *
 * Bu harness YALNIZCA motion sözleşmesini kilitler. Timer matematiği, bildirim
 * planlama/iptal sırası, AsyncStorage/DB kaydı ve doğrulama AYRI harness'lardadır
 * (`verify-activity-timer-and-history`, `verify-activity-tracking-client-write`,
 * `supabase/tests/active-workout.harness`) ve bu tur onlara dokunmaz.
 *
 * React render EDİLMEZ; kaynak metni statik denetlenir. Harness gerçek
 * SÖZLEŞMEYİ ölçer; yorum/boşluk değişikliğine bağlı değildir.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const raw = read('app/program/[id]/day/[dayId]/index.tsx');
/** Yorumlar sıyrılmış kaynak — kural denetimleri KODU ölçer, açıklamayı değil. */
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');
const motionSection = read('components/motion-section.tsx');

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

// ---------------------------------------------------------------------------
// Kardiyo aşamalarına ait MotionSwap sınırını doğrudan kararlı phase key'inden
// çıkar. Ekranda ayrıca egzersiz türü/kimliği değişimini yumuşatan dış sınır
// bulunabilir; bu harness yalnız iç kardiyo aşamasını ölçer.
// ---------------------------------------------------------------------------
const swapOpenTags = code.match(/<MotionSwap[\s>]/g) ?? [];
const phaseKeyIndex = code.indexOf('transitionKey={activityPhase}');
const swapStart = phaseKeyIndex === -1 ? -1 : code.lastIndexOf('<MotionSwap', phaseKeyIndex);
const swapOpen = swapStart === -1 ? '' : code.slice(swapStart, code.indexOf('>', swapStart) + 1);
const swapBody =
  swapStart === -1
    ? ''
    : code.slice(code.indexOf('>', swapStart) + 1, code.indexOf('</MotionSwap>', phaseKeyIndex));

// ---------------------------------------------------------------------------
// 1. Aşama anahtarı YALNIZ idle/tracking/finishing'ten türetilir.
// ---------------------------------------------------------------------------
check('1. activityPhase yalnız idle/tracking/finishing türetir', () => {
  const decl = /const activityPhase:\s*'idle' \| 'tracking' \| 'finishing' =([\s\S]*?);/.exec(code);
  assert.ok(decl, 'activityPhase türetmesi bulunamadı');
  const body = decl[1];
  assert.ok(/isFinishingActivity/.test(body), 'finishing durumu isFinishingActivity’den gelmeli');
  assert.ok(/activityTimer\b/.test(body), 'tracking/idle ayrımı activityTimer’den gelmeli');
  for (const literal of ["'finishing'", "'tracking'", "'idle'"]) {
    assert.ok(body.includes(literal), `aşama literali eksik: ${literal}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Timer status (running/paused) aşama anahtarına GİRMEZ.
// ---------------------------------------------------------------------------
check('2. activityTimer.status phase key’e girmiyor', () => {
  const decl = /const activityPhase:\s*'idle' \| 'tracking' \| 'finishing' =([\s\S]*?);/.exec(code);
  assert.ok(decl, 'activityPhase türetmesi bulunamadı');
  assert.ok(!/\.status/.test(decl[1]), 'aşama anahtarı timer status’a bağlanmış (gereksiz remount riski)');
  // transitionKey de doğrudan kararlı activityPhase; timer değeri/status değil.
  assert.ok(/transitionKey=\{activityPhase\}/.test(swapOpen), 'transitionKey doğrudan activityPhase olmalı');
  assert.ok(
    !/transitionKey=\{[^}]*(status|elapsed|activityProgress|Date\.now|clockNow)/.test(swapOpen),
    'transitionKey her saniye/duruma göre değişen bir değere bağlı',
  );
});

// ---------------------------------------------------------------------------
// 3. Tek SAKİN MotionSwap kontrol aşamalarını sarıyor.
// ---------------------------------------------------------------------------
check('3. Tek kardiyo phase MotionSwap + pace="calm" kontrol aşamalarını sarıyor', () => {
  assert.ok(phaseKeyIndex >= 0, 'activityPhase geçiş anahtarı bulunamadı');
  assert.equal(
    (code.match(/transitionKey=\{activityPhase\}/g) ?? []).length,
    1,
    'activityPhase için tek MotionSwap beklenir',
  );
  assert.ok(/pace="calm"/.test(swapOpen), 'MotionSwap pace="calm" kullanmalı');
  // Üç kontrol aşaması da bu sınırın ALTINDA: bitirme formu ve kontroller.
  assert.ok(/isFinishingActivity && \(/.test(swapBody), 'bitirme adımı MotionSwap altında olmalı');
  assert.ok(/!isFinishingActivity && \(/.test(swapBody), 'kronometre kontrolleri MotionSwap altında olmalı');
  for (const handler of ['startActivityMeasurement', 'finishActivityMeasurement', 'submitActivity']) {
    assert.ok(swapBody.includes(handler), `${handler} kontrolü MotionSwap altında değil`);
  }
  // Dış egzersiz geçişi olsa da kardiyo aşamasının kendi sınırı tektir.
  assert.ok(swapOpenTags.length >= 1, 'MotionSwap sınırı bulunamadı');
});

// ---------------------------------------------------------------------------
// 4. Küçük koşullu satırlar MotionCollapsible kullanıyor.
// ---------------------------------------------------------------------------
check('4. Duraklatıldı/hata/RPE bandı/tempo satırları MotionCollapsible ile', () => {
  assert.ok(
    /<MotionCollapsible>\s*<Text style=\{styles\.activityTimerState\}>/.test(code),
    'duraklatıldı satırı MotionCollapsible ile sarılmamış',
  );
  assert.ok(
    /<MotionCollapsible>\s*<Text style=\{styles\.activityRpeBand\}>/.test(code),
    'RPE bandı MotionCollapsible ile sarılmamış',
  );
  assert.ok(
    /<MotionCollapsible>\s*<Text style=\{styles\.activityPace\}>/.test(code),
    'türetilen tempo MotionCollapsible ile sarılmamış',
  );
  assert.ok(
    /<MotionCollapsible>\s*<Text style=\{styles\.validationError\}>/.test(code),
    'hata satırı MotionCollapsible ile sarılmamış',
  );
  // Bu küçük satırlar için ayrıca MotionSection/gecikmeli ikinci katman yok.
  assert.ok(!/<MotionSection\b/.test(code), 'kardiyo panelinde çift animasyon (MotionSection) katmanı var');
});

// ---------------------------------------------------------------------------
// 5. Kronometre değeri her saniye animasyon key'i YAPMAZ.
// ---------------------------------------------------------------------------
check('5. Kronometre değeri animasyon almıyor (swap/collapsible dışında)', () => {
  // Timer değeri MotionSwap gövdesinin DIŞINDA kalır → her saniye remount/enter yok.
  assert.ok(!swapBody.includes('activityTimerValue'), 'kronometre değeri MotionSwap içine alınmış (her saniye animasyon riski)');
  // Timer değeri sade bir <Text>; Motion sarmalı veya entering/key almıyor.
  const valueIdx = code.indexOf('styles.activityTimerValue');
  assert.ok(valueIdx !== -1, 'kronometre değeri stili bulunamadı');
  const around = code.slice(valueIdx - 160, valueIdx + 160);
  assert.ok(!/entering=|exiting=|transitionKey=|<MotionSwap|<MotionCollapsible/.test(around), 'kronometre değeri animasyon sarmalı almış');
  assert.ok(/formatActivityTimerValue\(activityProgress\?\.elapsedSeconds \?\? 0\)/.test(code), 'kronometre değeri kaynağı değişmiş');
  // Süre rakamlarında scale/bounce/glow/pulse yok.
  const valueStyle = /activityTimerValue:\s*\{[^}]*\}/.exec(code);
  assert.ok(valueStyle, 'activityTimerValue stili bulunamadı');
  assert.ok(!/scale|transform|shadow|opacity/i.test(valueStyle[0]), 'süre değerine scale/glow/pulse eklenmiş');
});

// ---------------------------------------------------------------------------
// 6. Handler gövdeleri ve bildirim/kayıt sırası KORUNUYOR (motion rewire yok).
// ---------------------------------------------------------------------------
check('6. Handlerlar aynı işlevlere bağlı; bildirim/kayıt akışı korunuyor', () => {
  const bindings = [
    /onPress=\{\(\) => void startActivityMeasurement\(\)\}/,
    /onPress=\{\(\) => void finishActivityMeasurement\(\)\}/,
    /onPress=\{\(\) => void submitActivity\(\)\}/,
    /onPress=\{confirmCancelMeasurement\}/,
    /onPress=\{confirmClearActivity\}/,
    /onPress=\{\(\) => setIsFinishingActivity\(false\)\}/,
  ];
  for (const binding of bindings) {
    assert.ok(binding.test(code), `handler bağlaması değişmiş: ${binding}`);
  }
  // Duraklat/Devam Et aynı koşullu handler; status yalnız burada okunur.
  assert.ok(
    /activityTimer\.status === 'running'\s*\?\s*pauseActivityMeasurement\(\)\s*:\s*resumeActivityMeasurement\(\)/.test(code),
    'duraklat/devam et handler koşulu değişmiş',
  );
  // Bildirim iptali ve DB kaydı yardımcıları hâlâ dosyada (motion turu bunlara dokunmadı).
  for (const call of ['cancelActivityTargetNotification', 'saveActivityRecord', 'scheduleActivityTargetNotification']) {
    assert.ok(code.includes(call), `beklenen akış yardımcısı kaybolmuş: ${call}`);
  }
});

// ---------------------------------------------------------------------------
// 7. Düğme hizalama sözleşmesi KORUNUYOR.
// ---------------------------------------------------------------------------
check('7. Yan yana Duraklat/Devam + Bitir hizalaması korunuyor', () => {
  // Tracking dalında iki düğme aynı satırda: activityControls + primary/secondary.
  const controls = /<View style=\{styles\.activityControls\}>([\s\S]*?)<\/View>/.exec(code);
  assert.ok(controls, 'activityControls satırı bulunamadı');
  assert.ok(/styles\.activitySecondaryButton/.test(controls[1]), 'Duraklat/Devam ikincil düğmesi hizadan çıkmış');
  assert.ok(/styles\.completeSetPill, styles\.activityPrimaryButton/.test(controls[1]), 'Bitir birincil düğmesi hizadan çıkmış');
  assert.ok((controls[1].match(/styles\.activityButtonText/g) ?? []).length === 2, 'yan yana düğme metin hizası korunmamış');
  // Hizalama stilleri StyleSheet’te duruyor.
  for (const style of ['activityControls:', 'activityPrimaryButton:', 'activityButtonText:', 'activitySecondaryButton:', 'completeSetPill:']) {
    assert.ok(code.includes(style), `hizalama stili kaybolmuş: ${style}`);
  }
  // Geçiş sınırı yalnız YERLEŞİM taşır (stretch + mevcut gap), yeni kart değil.
  assert.ok(/activityPhaseSwap:\s*\{[^}]*alignSelf: 'stretch'[^}]*gap: 10/.test(code), 'aşama geçiş sınırı yerleşim sözleşmesi (stretch + gap 10) değişmiş');
});

// ---------------------------------------------------------------------------
// 8. Reduce Motion helper İÇİNDE kalıyor; ekranda yeni kapı yok.
// ---------------------------------------------------------------------------
check('8. Reduce Motion helper içinde; ekranda yeni kapı kurulmuyor', () => {
  assert.ok(!/useReducedMotion/.test(code), 'ekran kendi Reduce Motion kapısını kurmuş');
  // Helper Reduce Motion’u gerçekten ele alıyor (MotionSwap + MotionCollapsible).
  assert.ok(/useReducedMotion/.test(motionSection), 'helper Reduce Motion kapısını kaybetmiş');
  assert.ok(/reduceMotion \? undefined : motion\.entering/.test(motionSection), 'MotionSwap Reduce Motion sözleşmesi bozulmuş');
});

// ---------------------------------------------------------------------------
// 9. Ham animasyon değeri / yeni motion altyapısı YOK.
// ---------------------------------------------------------------------------
check('9. Ekranda ham animasyon veya yeni motion altyapısı yok', () => {
  assert.ok(!/from 'react-native-reanimated'/.test(code), 'ekran Reanimated’ı doğrudan import etmiş');
  assert.ok(!/LayoutAnimation/.test(code), 'LayoutAnimation eklenmiş');
  assert.ok(!/\.duration\(|\.easing\(|withTiming|withSpring|withInitialValues/.test(code), 'ekrana ham süre/easing/mesafe yazılmış');
  // Motion yalnız MEVCUT helperlardan gelir.
  assert.ok(
    /import \{ MotionCollapsible, MotionSwap \} from '@\/components\/motion-section'/.test(code),
    'MotionSwap/MotionCollapsible mevcut helperdan import edilmemiş',
  );
  assert.ok(/from '@\/components\/motion-pressable'/.test(code), 'MotionPressable helperı kaybolmuş');
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol düştü (${passed} geçti):`);
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log(`✓ Kardiyo durum motion harness: ${passed} kontrol geçti.`);
console.log('  (Timer matematiği/bildirim/kayıt AYRI harness’lardadır; yalnız görsel geçiş doğrulandı.)');
