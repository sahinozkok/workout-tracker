#!/usr/bin/env node
/**
 * MIGRATION SÜRÜM BENZERSİZLİĞİ — REGRESYON HARNESS'I
 *
 * Supabase migrationları sürüm (timestamp) sırasına göre TAM BİR KEZ uygulanır.
 * İki dosya AYNI 14 haneli sürümü paylaşırsa uygulama sırası belirsizleşir ve
 * ortam başına farklı sonuç doğabilir. Bu tur, bütün migration dosyalarının
 * sürüm önekinin BENZERSİZ ve biçimce geçerli olduğunu kilitler.
 *
 * (Codex denetiminde `20260902120000` sürümü `add_friend_messages` ile
 * `rename_rank_tiers_emerald_diamond` arasında çakışmıştı; sürümlü rank
 * sözleşmesi `20260909120000`'e taşındı. Bu harness çakışmanın geri gelmesini
 * engeller.)
 */

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'supabase/migrations');

let passed = 0;
function check(condition, message) {
  assert.ok(condition, message);
  passed += 1;
}

const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

check(files.length > 0, 'en az bir migration bulunmalı');

// 1) Biçim: <14 haneli sürüm>_<slug>.sql
const NAME = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
for (const name of files) {
  check(NAME.test(name), `migration adı biçime uymuyor: ${name}`);
}

// 2) Sürüm önekleri BENZERSİZ.
const byVersion = new Map();
for (const name of files) {
  const version = name.slice(0, 14);
  const list = byVersion.get(version) ?? [];
  list.push(name);
  byVersion.set(version, list);
}
const duplicates = [...byVersion.entries()].filter(([, names]) => names.length > 1);
check(
  duplicates.length === 0,
  `çakışan migration sürümleri:\n${duplicates
    .map(([version, names]) => `  ${version}: ${names.join(', ')}`)
    .join('\n')}`,
);

// 3) Sözlük sırası = sürüm sırası (timestamp öneki bunu doğal olarak sağlar,
//    ama bozuk bir önek burada yakalanır).
const versions = files.map((name) => name.slice(0, 14));
const sorted = [...versions].sort();
check(
  JSON.stringify(versions) === JSON.stringify(sorted),
  'migration dosyaları sürüm sırasında değil',
);

// 4) Sürümlü rank sözleşmesi migration'ı mevcut ve BENZERSİZ.
const contract = files.filter((name) => name.endsWith('_add_versioned_rank_contract.sql'));
check(contract.length === 1, 'surumlu rank sozlesmesi migration dosyasi tam bir kez bulunmali');
check(
  !byVersion.get(contract[0].slice(0, 14)).some((name) => name !== contract[0]),
  'surumlu rank sozlesmesi migration dosyasi baska bir dosyayla surum paylasmamali',
);

console.log(`✓ Migration sürümleri: ${passed} kontrol geçti (${files.length} dosya, hepsi benzersiz).`);
