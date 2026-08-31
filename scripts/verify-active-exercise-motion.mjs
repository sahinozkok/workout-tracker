#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const raw = readFileSync(join(ROOT, 'app/program/[id]/day/[dayId]/index.tsx'), 'utf8');
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
};

const panelStart = code.indexOf('{activePanelExercise && (');
const panelEnd = code.indexOf('{averageDurationSeconds !== undefined', panelStart);
assert.ok(panelStart >= 0 && panelEnd > panelStart, 'aktif egzersiz geçiş bölgesi bulunamadı');
const panel = code.slice(panelStart, panelEnd);
const outerOpenStart = panel.indexOf('<MotionSwap');
const outerOpen = panel.slice(outerOpenStart, panel.indexOf('>', outerOpenStart) + 1);

check('aktif panel kardiyo önceliğiyle tek kaynaktan seçiliyor', () => {
  assert.match(code, /const activePanelExercise = activeCardioExercise \?\? activeExercise;/);
});

check('geçiş anahtarı yalnız egzersiz kimliği ve takip türünden oluşuyor', () => {
  const keyDeclaration = /const activeExerciseTransitionKey =([\s\S]*?): 'none';/.exec(code);
  assert.ok(keyDeclaration, 'activeExerciseTransitionKey bulunamadı');
  assert.match(keyDeclaration[1], /activePanelExercise\.id/);
  assert.match(keyDeclaration[1], /activePanelExercise\.trackingMode/);
  assert.doesNotMatch(
    keyDeclaration[1],
    /status|activityPhase|clockNow|Date\.now|weightInput|repetitionsInput|activityTimer/,
  );
});

check('dış panel geçişi mevcut sakin MotionSwap kullanıyor', () => {
  assert.match(outerOpen, /pace="calm"/);
  assert.match(outerOpen, /style=\{styles\.activeExerciseSwap\}/);
  assert.match(outerOpen, /transitionKey=\{activeExerciseTransitionKey\}/);
});

check('kardiyo ve güç panelleri aynı dış sınır altında kalıyor', () => {
  assert.match(panel, /activeCardioExercise && \(/);
  assert.match(panel, /!activeCardioExercise && activeExercise && \(/);
  assert.ok(
    panel.indexOf('activeCardioExercise && (') < panel.indexOf('!activeCardioExercise && activeExercise && ('),
    'panel dallarının sırası değişmiş',
  );
});

check('iç kardiyo phase animasyonu bağımsız kalıyor', () => {
  assert.equal((panel.match(/<MotionSwap[\s>]/g) ?? []).length, 2);
  assert.equal((panel.match(/<\/MotionSwap>/g) ?? []).length, 2);
  assert.equal((panel.match(/transitionKey=\{activityPhase\}/g) ?? []).length, 1);
});

check('dış wrapper yalnız yerleşim taşıyor', () => {
  assert.match(code, /activeExerciseSwap:\s*\{\s*alignSelf: 'stretch'\s*\}/);
  assert.doesNotMatch(code, /activeExerciseSwap:\s*\{[^}]*backgroundColor/);
});

check('tüm egzersizler seçim davranışı korunuyor', () => {
  assert.match(
    code,
    /onPress=\{\(\) => \{[\s\S]*?handleExerciseSelection\([\s\S]*?exercise\.id,[\s\S]*?isComplete,[\s\S]*?isCardioExercise\(exercise\)/,
  );
  assert.match(code, /allDayExercises\.map\(\(exercise\) =>/);
});

check('ekranda yeni ham animasyon altyapısı yok', () => {
  assert.doesNotMatch(code, /from 'react-native-reanimated'|LayoutAnimation|withTiming|withSpring/);
  assert.match(
    code,
    /import \{ MotionCollapsible, MotionSwap \} from '@\/components\/motion-section'/,
  );
});

console.log(`\n✓ Aktif egzersiz panel motion harness: ${passed} kontrol geçti.`);
