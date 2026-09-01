#!/usr/bin/env node
/** Sıcak açık ve yumuşak koyu tema seçeneklerinin dar kaynak sözleşmesi. */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (path) => readFileSync(join(ROOT, path), 'utf8');
const theme = source('constants/theme.ts');
const context = source('context/theme-context.tsx');
const settings = source('app/settings.tsx');
const tr = source('locales/tr.ts');
const en = source('locales/en.ts');

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
function assert(value, message) {
  if (!value) throw new Error(message);
}

check('İstenen iki ana zemin rengi birebir tanımlı', () => {
  assert(/warmLight:[\s\S]*?background: '#FCE5CD'/.test(theme), 'sıcak açık zemin yanlış');
  assert(/softDark:[\s\S]*?background: '#1B1B1B'/.test(theme), 'yumuşak koyu zemin yanlış');
});

check('Alternatifler tek renk değil, uyumlu yüzey paletidir', () => {
  for (const token of ['surface:', 'surfaceMuted:', 'card:', 'border:', 'separator:', 'inputBorder:']) {
    assert((theme.match(new RegExp(token, 'g')) ?? []).length >= 4, `${token} alternatiflerde eksik`);
  }
});

check('Tema tercih tipi ve kalıcı depolama iki seçeneği kabul eder', () => {
  assert(/'warmLight' \| 'softDark'/.test(context), 'tercih tipleri yok');
  assert(/savedPreference === 'warmLight'/.test(context), 'sıcak açık depodan yüklenmiyor');
  assert(/savedPreference === 'softDark'/.test(context), 'yumuşak koyu depodan yüklenmiyor');
});

check('Alternatifler doğru açık/koyu sistem davranışını kullanır', () => {
  assert(/preference === 'dark' \|\| preference === 'softDark'/.test(context), 'soft dark koyu sayılmıyor');
  assert(/preference === 'warmLight'[\s\S]*?Colors\.warmLight/.test(context), 'warm palette çözülmüyor');
  assert(/preference === 'softDark'[\s\S]*?Colors\.softDark/.test(context), 'soft palette çözülmüyor');
});

check('Ayarlar ekranında beş erişilebilir sembol seçeneği bulunur', () => {
  for (const value of ['light', 'warmLight', 'system', 'softDark', 'dark']) {
    assert(new RegExp(`value="${value}"`).test(settings), `${value} seçeneği yok`);
  }
  assert((settings.match(/accessibilityLabel=\{label\}/g) ?? []).length === 1, 'sembol adları erişilebilir değil');
});

check('Seçenekler referanstaki tek yuvarlak çubukta ve 44 pt üstüdür', () => {
  assert(/themeToggle:[\s\S]*?borderRadius: Layout\.radiusPill[\s\S]*?flexDirection: 'row'/.test(settings), 'tek yatay pill yok');
  assert(/themeButton:[\s\S]*?minHeight: 56/.test(settings), 'dokunma hedefi küçük');
  assert(/themeButtonSelected: \{ backgroundColor: settingsAccent \}/.test(settings), 'seçili dolgu yok');
});

check('Appearance başlığı ve açıklaması referanstaki belirgin hiyerarşidedir', () => {
  assert(/appearanceTitle:[\s\S]*?fontSize: 30[\s\S]*?fontWeight: '700'/.test(settings), 'başlık hiyerarşisi yok');
  assert(/appearanceCaption:[\s\S]*?fontSize: 15/.test(settings), 'açıklama ölçüsü yanlış');
});

check('Saf siyah tema dolunay, yumuşak koyu tema hilaldir', () => {
  assert(/icon="moon-outline"[\s\S]*?value="softDark"/.test(settings), 'yumuşak koyu hilal değil');
  assert(/icon="ellipse"[\s\S]*?value="dark"/.test(settings), 'saf siyah tema dolunay değil');
});

check('Türkçe ve İngilizce adlar eksiksizdir', () => {
  assert(/themeWarmLight: 'Sıcak açık'/.test(tr) && /themeSoftDark: 'Yumuşak koyu'/.test(tr), 'TR adlar eksik');
  assert(/themeWarmLight: 'Warm light'/.test(en) && /themeSoftDark: 'Soft dark'/.test(en), 'EN adlar eksik');
});

if (failures.length) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  failures.forEach((failure) => console.error(`  · ${failure}`));
  process.exit(1);
}

console.log(`✓ Alternatif tema harness: ${passed} kontrol geçti.`);
