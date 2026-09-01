#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (path) => readFileSync(join(ROOT, path), 'utf8');
const code = (path) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const createProgram = code('app/program/create.tsx');
const addExercise = code('app/program/[id]/day/[dayId]/add-exercise.tsx');
const workoutDay = code('app/program/[id]/day/[dayId]/index.tsx');
const programDetail = code('app/program/[id].tsx');
const settings = code('app/settings.tsx');
const selector = code('components/tracking-mode-selector.tsx');
const picker = code('components/workout-visual-picker.tsx');
const tr = code('locales/tr.ts');
const en = code('locales/en.ts');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

check('program simgesi oluşturma formunda tercihe bağlı', () => {
  assert.match(createProgram, /const \{ showProgramIcons \} = useProfile\(\)/);
  assert.match(createProgram, /\{showProgramIcons && \([\s\S]*?variant="programCreate"/);
});

check('program simgesi düzenleme formunda tercihe bağlı', () => {
  assert.match(programDetail, /\{showProgramIcons && \([\s\S]*?variant="programEdit"/);
});

check('egzersiz simgesi ekleme ve düzenleme formlarında tercihe bağlı', () => {
  assert.match(addExercise, /const \{ showExerciseIcons \} = useProfile\(\)/);
  assert.match(addExercise, /\{showExerciseIcons && \([\s\S]*?variant="programEdit"/);
  assert.match(workoutDay, /\{showExerciseIcons && \([\s\S]*?variant="exerciseEdit"/);
});

check('aktif tüm egzersizler listesi simge tercihini kullanıyor', () => {
  assert.match(workoutDay, /showExerciseIcons && \([\s\S]*?<WorkoutVisualDisplay[\s\S]*?getExerciseVisual\(exercise\.visual\)/);
});

check('program oluşturma rengi Workout Days özelliğinden geliyor', () => {
  assert.match(createProgram, /useFeatureColor\('workoutDays', workoutDaysDefault\)/);
  assert.match(createProgram, /const programAccent = workoutDays\.color/);
  assert.match(createProgram, /createStyles\(colors, programAccent, onProgramAccent\)/);
  assert.doesNotMatch(createProgram, /PROGRAM_CREATE_ACCENT|A56BEF/);
});

check('program picker sabit mora bağlı değil', () => {
  assert.doesNotMatch(picker, /PROGRAM_CREATE_ACCENT|A56BEF/);
  assert.match(picker, /resolvedAccent/);
  assert.match(picker, /resolvedOnAccent/);
});

check('takip türü seçicisi ekranın vurgu rengini kabul ediyor', () => {
  assert.match(selector, /accentColor\?: string/);
  assert.match(selector, /segmentSelected: \{ borderColor: accentColor/);
  assert.match(addExercise, /accentColor=\{workoutDays\.color\}/);
});

check('kaldırılan galeri metni egzersiz ekleme ekranında yok', () => {
  assert.doesNotMatch(addExercise, /visualPicker\.choosePhoto/);
  assert.match(addExercise, /visualPicker\.chooseSymbol/);
  assert.match(tr, /chooseSymbol: 'Hazır simge, emoji veya kısa metin seç\.'/);
  assert.match(en, /chooseSymbol: 'Choose a preset icon, emoji or short text\.'/);
});

check('başarılı egzersiz ekleme sayfada kalıyor', () => {
  const successTail = addExercise.slice(addExercise.indexOf("if (duplicates.length > 0)"));
  assert.match(successTail, /setSelectedExerciseIds\(\[\]\)/);
  assert.match(successTail, /setSearch\(''\)/);
  assert.doesNotMatch(successTail, /router\.back\(\)/);
  assert.match(addExercise, /addSelectedAndContinue/);
  assert.match(addExercise, /addCustomAndContinue/);
});

check('tekrar sayacı klavyesiz eksi ve artı düğmelerine sahip', () => {
  assert.match(workoutDay, /onPress=\{\(\) => adjustRepetitions\(-1\)\}/);
  assert.match(workoutDay, /onPress=\{\(\) => adjustRepetitions\(1\)\}/);
  assert.match(workoutDay, /name="remove"/);
  assert.match(workoutDay, /name="add"/);
});

check('tekrar adımları güvenli sınırlarda ve 44 pt dokunma alanında', () => {
  assert.match(workoutDay, /Math\.min\(1000, Math\.max\(0, current \+ delta\)\)/);
  assert.match(workoutDay, /height: Layout\.minTouchSize/);
  assert.match(workoutDay, /width: Layout\.minTouchSize/);
  assert.match(workoutDay, /day\.decreaseReps/);
  assert.match(workoutDay, /day\.increaseReps/);
});

check('kardiyoya geçiş set molasını tamamen temizliyor', () => {
  const selection = workoutDay.slice(
    workoutDay.indexOf('async function handleExerciseSelection'),
    workoutDay.indexOf('function handleFinishWorkout'),
  );
  assert.match(selection, /isCardioExercise\(selectedExercise\) && restTimer/);
  assert.match(selection, /await clearRestTimer\(restTimer\)/);
});

check('ayarlar geri düğmesi gerçek geri ve güvenli profil dönüşü sunuyor', () => {
  assert.match(settings, /headerBackVisible: false/);
  assert.match(settings, /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/\(tabs\)\/profile'\)/);
  assert.match(settings, /minHeight: Layout\.minTouchSize/);
});

console.log(`\n${passed} workout UX kontrolü geçti.`);
