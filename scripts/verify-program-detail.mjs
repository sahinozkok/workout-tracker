#!/usr/bin/env node
/**
 * PROGRAM DETAYI EKRANININ YENİDEN DÜZENİ — dar kapsamlı UI sözleşme harness'ı.
 *
 * SINIR: React render EDİLMEZ; bu tarama yalnızca kaynak metnin görsel/yapısal
 * sözleşmesini ölçer. Veri, disiplin ve güvenlik davranışları kendi
 * harness'larında test edilir; burada program/[id] ekranının sunum kararları
 * korunur:
 *
 *   * Genel "Program Detayı" native başlığı normal durumda YOK.
 *   * Üst program kimliği: ad + gerçek gün/egzersiz meta + düzenle.
 *   * Gün başlığı takvim/bugün/sıra + ada; egzersizler gerçek liste.
 *   * Üç tracking mode ayrı ve lokalize; kardiyo "1 set" değil.
 *   * Dinlenme/boş gün empty-state; değişken yükseklikte sağlam timeline.
 *
 * Çalıştırma:  node scripts/verify-program-detail.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const detailRaw = source('app/program/[id].tsx');
const detail = stripComments(detailRaw);
const tracking = stripComments(source('utils/program-target-format.ts'));
const shared = stripComments(source('components/profile-shared-program.tsx'));
const tr = stripComments(source('locales/tr.ts'));
const en = stripComments(source('locales/en.ts'));

let pass = 0;
function check(name, fn) {
  fn();
  pass += 1;
  console.log(`PASS  ${name}`);
}

// 1. Genel "Program Details" başlığı normal program durumunda yok.
check('1. Yüklü programda native başlık kapatılıyor, nav.programDetail render edilmiyor', () => {
  assert.match(detail, /<Stack\.Screen options=\{\{ headerShown: false \}\} \/>/);
  assert.doesNotMatch(detail, /title:\s*t\('nav\.programDetail'\)/);
});

// 2. Üst alanda ad + gerçek gün/egzersiz sayısı + edit düğmesi.
check('2. Üst kimlik program adı, gün/egzersiz meta ve düzenleme düğmesi içeriyor', () => {
  const topBar = detail.slice(detail.indexOf('styles.topBar'), detail.indexOf('<ScrollView'));
  assert.match(topBar, /styles\.programName[\s\S]*\{program\.name\}/);
  assert.match(
    topBar,
    /programDetail\.summary',\s*\{\s*days:\s*program\.days\.length,\s*exercises:\s*exerciseCount/,
  );
  assert.match(topBar, /programDetail\.editProgramLabel'[\s\S]*onPress=\{openProgramEditor\}/);
});

// 3. ScrollView içinde ikinci bir program özeti yok.
check('3. ScrollView içinde ikinci program özeti yok', () => {
  assert.doesNotMatch(detail, /styles\.summaryRow/);
  assert.equal((detail.match(/programDetail\.summary'/g) ?? []).length, 1);
});

// 4. Geri düğmesi back + /programs fallback.
check('4. Geri düğmesi router.back ve /programs fallback sunuyor', () => {
  assert.match(
    detail,
    /router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/programs'\)/,
  );
});

// 5. Geri ve düzenleme dokunma alanları en az 44 pt.
check('5. Üst çubuk düğmeleri 44×44 pt', () => {
  assert.match(detail, /topBarButton:\s*\{[^}]*height:\s*44[^}]*width:\s*44|topBarButton:\s*\{[^}]*width:\s*44[^}]*height:\s*44/);
});

// 6. Gün başlığı weekday/today/fallback + day.name kullanıyor.
check('6. Gün başlığı takvim/bugün/sıra numarası ile day.name birleştiriyor', () => {
  assert.match(detail, /const schedule = isToday\s*\?\s*t\('day\.today'\)/);
  assert.match(detail, /t\('programDetail\.dayNumberLabel',\s*\{ number: dayIndex \+ 1 \}\)/);
  assert.match(detail, /getWeekdayLabel\(day\.scheduledWeekday, locale\)/);
  assert.match(detail, /t\('programDetail\.dayTitle',\s*\{ name: day\.name, schedule \}\)/);
});

// 7. Eski yalnız {exerciseCount} görsel alt başlığı kaldırılmış.
check('7. Eski dayWeekday alt başlığı ve görünür exerciseCount satırı kaldırılmış', () => {
  assert.doesNotMatch(detail, /styles\.dayWeekday/);
  // exerciseCount yalnızca a11y etiketinde kalır, görünür alt metin olarak değil.
  assert.doesNotMatch(detail, /·\s*\$\{t\('programDetail\.exerciseCount'/);
});

// 8. Bütün egzersizler sıralı liste; key olarak exercise.id.
check('8. Egzersizler sıralı liste hâlinde, exercise.id key ile render ediliyor', () => {
  assert.match(
    detail,
    /day\.exercises\.map\(\(exercise\) => \([\s\S]*?key=\{exercise\.id\}/,
  );
  // Tek Text içinde virgülle birleştirme yok.
  assert.doesNotMatch(detail, /\.map\([^)]*\)\.join\(', '\)/);
});

// 9. Built-in ve custom egzersiz adları çözülüyor.
check('9. Egzersiz adı getProgramExerciseName ile çözülüyor', () => {
  assert.match(
    detail,
    /getProgramExerciseName\(exercise\.exerciseId, exercise\.customExerciseName\)/,
  );
});

// 10 + 11. Üç tracking mode ayrı biçimlendiriliyor; kardiyo "1 set" değil.
check('10+11. formatProgramExerciseTarget üç modu ayrı ve lokalize biçimliyor, kardiyo 1 set değil', () => {
  const fn = tracking.slice(
    tracking.indexOf('export function formatProgramExerciseTarget'),
    tracking.length,
  );
  assert.match(fn, /trackingMode === 'sets_reps'/);
  assert.match(fn, /trackingMode === 'duration'/);
  assert.match(fn, /programDetail\.targetSetsReps'/);
  assert.match(fn, /splitSecondsIntoFields\(exercise\.targetDurationSeconds\)/);
  assert.match(fn, /formatMetersAsKilometers\(exercise\.targetDistanceMeters\)/);
  // Kardiyo dallarında sahte "1 set" veya targetSets üretimi YOK.
  const cardio = fn.slice(fn.indexOf("trackingMode === 'duration'"));
  assert.doesNotMatch(cardio, /targetSets/);
  assert.doesNotMatch(fn, /1 set/);
  assert.match(detail, /formatProgramExerciseTarget\(exercise, t\)/);
});

// 12. Dinlenme ve boş gün empty-state gösteriyor.
check('12. Dinlenme ve boş gün için lokalize empty-state', () => {
  assert.match(detail, /day\.isOffDay \?[\s\S]*t\('programDetail\.restDay'\)/);
  assert.match(detail, /day\.exercises\.length === 0 \?[\s\S]*t\('programDetail\.emptyDay'\)/);
});

// 13. Değişken yükseklikte timeline; sabit 64 pt varsayımı kaldırılmış.
check('13. Sabit 64 pt kaldırılmış; stretch + negatif padding ile timeline', () => {
  assert.doesNotMatch(detail, /TIMELINE_COLUMN_HEIGHT|DAY_NUMBER_INSET/);
  const dayRow = detail.slice(detail.indexOf('dayRow: {'), detail.indexOf('timelineColumn: {'));
  assert.match(dayRow, /alignItems:\s*'stretch'/);
  assert.match(detail, /bottom:\s*-DAY_ROW_VERTICAL_PADDING/);
  assert.match(detail, /top:\s*-DAY_ROW_VERTICAL_PADDING/);
});

// 14. MotionListItem, gün navigasyonu ve edit modalı korunuyor.
check('14. MotionListItem, gün navigasyonu ve edit modalı korunuyor', () => {
  assert.match(detail, /<MotionListItem delay=\{getDelay\(dayIndex\)\} key=\{day\.id\}>/);
  assert.match(detail, /pathname: '\/program\/\[id\]\/day\/\[dayId\]'/);
  assert.match(detail, /<Modal[\s\S]*visible=\{isProgramEditorOpen\}/);
  assert.match(detail, /updateProgram\(currentProgram\.id, \{ name: trimmedName, visual: programVisualDraft \}\)/);
});

// 15. 375 pt ve uzun isimler için taşma korumaları.
check('15. Uzun ad/hedef taşma korumaları (numberOfLines + flex)', () => {
  assert.match(detail, /numberOfLines=\{2\}\s*style=\{styles\.programName\}/);
  assert.match(detail, /topBarText:\s*\{ flex: 1, gap: 2, minWidth: 0 \}/);
  assert.match(detail, /numberOfLines=\{2\}\s*style=\{styles\.exerciseName\}/);
  assert.match(detail, /exerciseName:\s*\{[^}]*flex:\s*1/);
});

// 16. TR/EN anahtarları eşleşiyor.
check('16. Yeni TR/EN programDetail anahtarları eşleşiyor', () => {
  for (const key of ['dayTitle', 'dayNumberLabel', 'targetSetsReps', 'restDay', 'emptyDay']) {
    assert.match(tr, new RegExp(`${key}:`), `TR ${key} eksik`);
    assert.match(en, new RegExp(`${key}:`), `EN ${key} eksik`);
  }
});

// 17. Program/discipline veri işlemleri değişmemiş.
check('17. Disiplin/veri hesapları ve renk mantığı korunuyor', () => {
  assert.match(
    detail,
    /const status = isActiveProgram && dayDateKey && !isFuture \? disciplineStatuses\[dayDateKey\] : undefined;/,
  );
  assert.match(detail, /getWeekdayDateInCurrentWeek\(day\.scheduledWeekday, today\)/);
  assert.match(detail, /function getDayStatusColor\(colors: ThemeColors, status: DisciplineStatus \| undefined\)/);
});

// 18. Görsel hiyerarşi: egzersiz adı gün başlığıyla YARIŞMAZ.
check('18. Egzersiz adı ikincil katmanda (textSecondary, 13 pt/400) ve gün başlığından küçük/hafif', () => {
  const nameStyle = detail.match(/exerciseName:\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(nameStyle, /color:\s*colors\.textSecondary/, 'egzersiz adı colors.text kullanıyor');
  assert.doesNotMatch(nameStyle, /colors\.text\b/, 'egzersiz adı hâlâ baskın colors.text kullanıyor');
  const nameSize = Number(nameStyle.match(/fontSize:\s*(\d+)/)?.[1]);
  const nameWeight = nameStyle.match(/fontWeight:\s*'(\d+)'/)?.[1];
  assert.equal(nameSize, 13, 'egzersiz adı ~13 pt değil');
  assert.equal(nameWeight, '400', 'egzersiz adı regular/hafif (400) değil');

  // Gün başlığı DEĞİŞMEDEN daha büyük ve daha güçlü kalır.
  const dayNameStyle = detail.match(/dayName:\s*\{([^}]*)\}/)?.[1] ?? '';
  const daySize = Number(dayNameStyle.match(/fontSize:\s*(\d+)/)?.[1]);
  const dayWeight = dayNameStyle.match(/fontWeight:\s*'(\d+)'/)?.[1];
  assert.match(dayNameStyle, /color:\s*colors\.text\b/, 'gün başlığı rengi değişmiş');
  assert.ok(daySize > nameSize, 'gün başlığı egzersiz adından büyük değil');
  assert.ok(Number(dayWeight) > Number(nameWeight), 'gün başlığı egzersiz adından güçlü değil');

  // Hedef metni de aynı ikincil katmanda (mevcut hafif görünüm korunur).
  const targetStyle = detail.match(/exerciseTarget:\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(targetStyle, /color:\s*colors\.textSecondary/, 'hedef metni ikincil değil');
});

// Arkadaş profilindeki paylaşılan program görünümü İSTEMEDEN değişmemeli.
check('Bonus. Arkadaş paylaşılan program formatı dokunulmadan kalıyor', () => {
  assert.match(shared, /function formatTarget\(/);
  assert.match(shared, /`\$\{exercise\.targetSets\} × \$\{exercise\.targetReps\}`/);
});

console.log(`\n${pass} program detayı kontrolü geçti.`);
