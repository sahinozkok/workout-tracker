#!/usr/bin/env node
/**
 * PROFİL DÜZENLEYİCİ — İLK `ready` SEED VERİ DOĞRULUĞU
 *
 * `hooks/use-profile-editor.ts` içindeki iki effect'in (tam-seed + seed-sonrası
 * yalnız-medya eşitleme) DAVRANIŞINI birebir modelleyip çalıştırır ve gerçek
 * dosyanın bu mekanizmayı (hasSeededReadyProfileRef, owner guard, doğru deps ve
 * yalnız-ready seed) gerçekten uyguladığını statik olarak doğrular.
 *
 * Kanıtlanan senaryolar:
 *   1. loading → ready: altı alanın tamamı gerçek profille seed edilir.
 *   2. ready sonrası kullanıcı bio/ad değiştirir; yalnız avatar güncellenince
 *      yazdığı metin KORUNUR.
 *   3. unavailable → retry → ready: tam seed gerçekleşir.
 *   4. hesap A → B: A taslağı B'ye SIZMAZ.
 *   5. profil ready değilken save/media KAPALI.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const source = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — beklenen ${JSON.stringify(b)}, gelen ${JSON.stringify(a)}`);

const DEFAULT_PROFILE = {
  avatarUri: undefined,
  bannerUri: undefined,
  displayName: 'Sporcu',
  username: '',
  bio: '',
  trainingGoal: 'consistency',
};
const SIX = ['displayName', 'username', 'bio', 'trainingGoal', 'avatarUri', 'bannerUri'];

/**
 * `useProfileEditor` seed/media effect mantığının birebir modeli. `apply` bir
 * "profil/durum güncelleme + effect turu"nu temsil eder (React'ın render sonrası
 * her iki effect'i sırayla çalıştırması gibi). `type` kullanıcı girdisidir
 * (profil effect'lerini tetiklemez).
 */
function makeEditor(initialProfile, initialUserId) {
  let draft = { ...initialProfile }; // useState(profile)
  let hasSeeded = false; // hasSeededReadyProfileRef
  let seededUserId = initialUserId; // seededUserIdRef = useRef(user?.id)
  let prevAvatar = initialProfile.avatarUri;
  let prevBanner = initialProfile.bannerUri;

  return {
    draft: () => draft,
    type(field, value) {
      // updateDraft — yalnız kullanıcı girdisi (effect tetiklemez).
      draft = { ...draft, [field]: value };
    },
    saveEnabled: (status) => status === 'ready',
    mediaEnabled: (status) => status === 'ready',
    apply(profile, status, userId) {
      // --- seed effect: deps [profile, status, userId] ---
      if (seededUserId !== userId) {
        seededUserId = userId;
        hasSeeded = false;
        draft = { ...profile }; // hesap değişimi: eski taslağı temizle
      }
      if (status === 'ready' && !hasSeeded) {
        hasSeeded = true;
        draft = { ...profile }; // TAM seed
      }
      // --- media effect: deps [profile.avatarUri, profile.bannerUri] ---
      if (prevAvatar !== profile.avatarUri || prevBanner !== profile.bannerUri) {
        if (hasSeeded) draft = { ...draft, avatarUri: profile.avatarUri, bannerUri: profile.bannerUri };
      }
      prevAvatar = profile.avatarUri;
      prevBanner = profile.bannerUri;
    },
  };
}

const REAL = {
  avatarUri: 'https://x/a.png',
  bannerUri: 'https://x/b.png',
  displayName: 'Gerçek Ad',
  username: 'gercek_kullanici',
  bio: 'Gerçek bio',
  trainingGoal: 'strength',
};

check('1. loading → ready: altı alanın tamamı gerçek profille seed edilir', () => {
  const ed = makeEditor(DEFAULT_PROFILE, 'A');
  ed.apply(DEFAULT_PROFILE, 'loading', 'A');
  // Seed yok: ready değil → taslak varsayılan; save/media kapalı.
  eq(ed.draft().displayName, 'Sporcu', 'loading sırasında seed olmamalı');
  ed.apply(REAL, 'ready', 'A');
  for (const f of SIX) eq(ed.draft()[f], REAL[f], `seed alanı ${f}`);
});

check('2. ready sonrası kullanıcı yazar; yalnız avatar güncellenince metin korunur', () => {
  const ed = makeEditor(DEFAULT_PROFILE, 'A');
  ed.apply(REAL, 'ready', 'A'); // tam seed
  ed.type('bio', 'benim yeni biom');
  ed.type('displayName', 'Yeni Ad');
  // Arka planda avatar güncellenir (anında kalıcılaşan medya).
  ed.apply({ ...REAL, avatarUri: 'https://x/new-avatar.png' }, 'ready', 'A');
  eq(ed.draft().bio, 'benim yeni biom', 'yazılan bio korunmadı');
  eq(ed.draft().displayName, 'Yeni Ad', 'yazılan ad korunmadı');
  eq(ed.draft().avatarUri, 'https://x/new-avatar.png', 'avatar güncellenmedi');
  eq(ed.draft().username, REAL.username, 'kullanıcı adı bozuldu');
  eq(ed.draft().trainingGoal, REAL.trainingGoal, 'hedef bozuldu');
});

check('3. unavailable → retry → ready: tam seed gerçekleşir', () => {
  const ed = makeEditor(DEFAULT_PROFILE, 'A');
  ed.apply(DEFAULT_PROFILE, 'unavailable', 'A');
  ed.apply(DEFAULT_PROFILE, 'loading', 'A'); // retry
  eq(ed.draft().displayName, 'Sporcu', 'ready öncesi seed olmamalı');
  ed.apply(REAL, 'ready', 'A');
  for (const f of SIX) eq(ed.draft()[f], REAL[f], `retry sonrası seed alanı ${f}`);
});

check('4. hesap A → B: A taslağı B\'ye SIZMAZ', () => {
  const ed = makeEditor(DEFAULT_PROFILE, 'A');
  ed.apply(REAL, 'ready', 'A'); // A seed
  ed.type('bio', 'A kullanıcısının biosu');
  const PROFILE_B = { ...DEFAULT_PROFILE, displayName: 'B Kullanıcı', username: 'b_user', bio: 'B bio', trainingGoal: 'muscle' };
  // Hesap B'ye geçer, B profili ready.
  ed.apply(PROFILE_B, 'ready', 'B');
  eq(ed.draft().bio, 'B bio', 'A taslağı B\'ye sızdı');
  for (const f of SIX) eq(ed.draft()[f], PROFILE_B[f], `B seed alanı ${f}`);
});

check('5. profil ready değilken save/media KAPALI, ready olunca AÇIK', () => {
  const ed = makeEditor(DEFAULT_PROFILE, 'A');
  for (const status of ['idle', 'loading', 'unavailable', 'error']) {
    assert(!ed.saveEnabled(status), `save ${status} durumunda açık olmamalı`);
    assert(!ed.mediaEnabled(status), `media ${status} durumunda açık olmamalı`);
  }
  assert(ed.saveEnabled('ready') && ed.mediaEnabled('ready'), 'ready durumunda save/media açık olmalı');
});

// --- Gerçek hook mekanizmayı uyguluyor mu? (statik) ---
check('6. Gerçek hook: hasSeededReadyProfileRef + owner guard + doğru deps + yalnız-medya', () => {
  const hook = source('hooks/use-profile-editor.ts');
  assert(/hasSeededReadyProfileRef/.test(hook), 'hasSeededReadyProfileRef yok');
  assert(/seededUserIdRef/.test(hook), 'owner guard (seededUserIdRef) yok');
  // İlk ready'de bir kez tam seed.
  assert(/profileLoadStatus === 'ready' && !hasSeededReadyProfileRef\.current/.test(hook), 'yalnız-ilk-ready tam seed koşulu yok');
  assert(/hasSeededReadyProfileRef\.current = true;\s*setDraft\(profile\)/.test(hook), 'tam seed setDraft(profile) yok');
  // Hesap değişiminde sıfırlama.
  assert(/seededUserIdRef\.current !== user\?\.id/.test(hook), 'hesap değişimi owner guard koşulu yok');
  // Seed effect deps: profile + status + userId.
  assert(/\}, \[profile, profileLoadStatus, user\?\.id\]\)/.test(hook), 'seed effect bağımlılıkları [profile, profileLoadStatus, user?.id] değil');
  // Medya effect seed'den önce hiç yazmaz; seed sonrası yalnız avatar/banner.
  assert(/if \(!hasSeededReadyProfileRef\.current\) return;\s*setDraft\(\(current\) => \(\{ \.\.\.current, avatarUri: profile\.avatarUri, bannerUri: profile\.bannerUri \}\)\)/.test(hook),
    'medya effect seed guard\'ı veya yalnız-avatar/banner eşitlemesi yok');
  // Save/media kapısı ready'ye bağlı; değiştirilmedi.
  assert(/const canSaveProfile = profileLoadStatus === 'ready';/.test(hook), 'canSaveProfile ready kapısı değişmiş');
  assert(/if \(!canSaveProfile\) \{[\s\S]{0,120}return;/.test(hook), 'pickImage canSaveProfile kapısı yok');
});

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ Profil düzenleyici seed harness: ${passed} kontrol geçti.`);
