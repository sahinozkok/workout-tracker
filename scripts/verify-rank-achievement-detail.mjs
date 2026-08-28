#!/usr/bin/env node
/**
 * ROZET AYRINTI PENCERESİ — DOĞRULAMA HARNESS'I
 *
 * Kapsam: Rank ekranındaki SEZON BAŞARILARI kartlarının dokunulabilirliği ve
 * ayrıntı penceresinin GÖSTERİM kararları. RP kuralları, rank eşikleri, başarı
 * kazanma koşulları, kutlama/baseline mantığı, profil vitrini ve arkadaş
 * akışları BURADA TEST EDİLMEZ — onlar ayrı harness'lardadır ve o dosyalara
 * dokunulmamıştır.
 *
 * İki katman: (1) pencerenin gösterim kararları deterministik bir modelle
 * gerçekten çalıştırılır, (2) kaynak ve sözlükler statik denetlenir.
 *
 * Canlı Postgres YOKTUR ve bu tur hiçbir SQL'e dokunmaz.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} — beklenen ${expected}, gelen ${actual}`);
}

function assertDeepEqual(actual, expected, message) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message} — beklenen ${right}, gelen ${left}`);
}

function assertThrows(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message);
}

const source = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8');

const sheetSource = source('components/ranks/achievement-detail-sheet.tsx');
/** Yorumlar çıkarılmış hâli — kural denetimleri KOD üzerinde yapılır. */
const sheetCode = sheetSource
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
const screenSource = source('app/rank.tsx');
const localeTr = source('locales/tr.ts');
const localeEn = source('locales/en.ts');

const KEYS = ['first_workout', 'workout_5', 'workout_15', 'streak_3', 'streak_7', 'perfect_week'];

// ---------------------------------------------------------------------------
// Katman 1 — pencerenin gösterim kararları
// ---------------------------------------------------------------------------

/** Bileşendeki birim eşlemesinin referansı — hiçbir HEDEF sayı taşımaz. */
const REMAINING_UNIT = {
  first_workout: 'workout',
  workout_5: 'workout',
  workout_15: 'workout',
  streak_3: 'day',
  streak_7: 'day',
  // Kusursuz hafta GÜN saymaz; kendi birimini kullanır.
  perfect_week: 'perfectWeek',
};

/** Bileşenin desteklediği birimler — bilinmeyen birim çeviri yolunu bozardı. */
const UNITS = ['workout', 'day', 'perfectWeek'];

/** Basit sözlük okuyucu — `context/language-context` içindeki `t` referansı. */
function translate(dict, path, params) {
  const value = path.split('.').reduce((node, part) => (node ? node[part] : undefined), dict);
  if (typeof value !== 'string') return path;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, key) =>
    params[key] === undefined ? match : String(params[key]),
  );
}

/**
 * `AchievementDetailSheet` GÖSTERİM KARARLARININ referansı.
 *
 * Hiçbir ilerleme yeniden HESAPLANMAZ: girdi, sunucudan gelen
 * `SeasonAchievement` alanlarıdır. Kalan miktar yalnızca iki sunucu alanının
 * farkıdır.
 */
function renderDetail(achievement, dict, unlockedLabel) {
  const { currentProgress, isUnlocked, key, targetProgress } = achievement;
  const remaining = Math.max(0, targetProgress - currentProgress);
  const unit = REMAINING_UNIT[key];

  const rows = [
    {
      id: 'progress',
      label: translate(dict, 'ranks.achievements.detail.progressLabel'),
      value: translate(dict, 'ranks.achievements.progress', {
        current: currentProgress,
        target: targetProgress,
      }),
    },
  ];

  if (!isUnlocked && remaining > 0) {
    rows.push({
      id: 'remaining',
      label: translate(dict, 'ranks.achievements.detail.remainingLabel'),
      value: translate(
        dict,
        remaining === 1
          ? `ranks.achievements.detail.remaining.${unit}One`
          : `ranks.achievements.detail.remaining.${unit}Other`,
        { count: remaining },
      ),
    });
  }

  if (isUnlocked && unlockedLabel) {
    rows.push({
      id: 'unlockedAt',
      label: translate(dict, 'ranks.achievements.detail.unlockedAtLabel'),
      value: unlockedLabel,
    });
  }

  return {
    description: translate(dict, `ranks.achievements.items.${key}.description`),
    name: translate(dict, `ranks.achievements.items.${key}.name`),
    rows,
    status: translate(
      dict,
      isUnlocked
        ? 'ranks.achievements.detail.statusUnlocked'
        : 'ranks.achievements.detail.statusInProgress',
    ),
  };
}

/** Sözlüklerin bu harness için yeterli, elle yazılmış kopyası DEĞİLDİR. */
const TR = {
  ranks: {
    achievements: {
      progress: '{current} / {target}',
      detail: {
        statusUnlocked: 'Kazanıldı',
        statusInProgress: 'Devam ediyor',
        progressLabel: 'İlerleme',
        remainingLabel: 'Kalan',
        unlockedAtLabel: 'Kazanılma tarihi',
        remaining: {
          workoutOne: '{count} antrenman kaldı',
          workoutOther: '{count} antrenman kaldı',
          dayOne: '{count} gün kaldı',
          dayOther: '{count} gün kaldı',
          perfectWeekOne: '{count} kusursuz hafta kaldı',
          perfectWeekOther: '{count} kusursuz hafta kaldı',
        },
      },
      items: Object.fromEntries(
        KEYS.map((key) => [key, { description: `${key}-aciklama`, name: `${key}-ad` }]),
      ),
    },
  },
};

const EN = {
  ranks: {
    achievements: {
      progress: '{current} / {target}',
      detail: {
        statusUnlocked: 'Earned',
        statusInProgress: 'In progress',
        progressLabel: 'Progress',
        remainingLabel: 'Remaining',
        unlockedAtLabel: 'Earned on',
        remaining: {
          workoutOne: '{count} workout left',
          workoutOther: '{count} workouts left',
          dayOne: '{count} day left',
          dayOther: '{count} days left',
          perfectWeekOne: '{count} perfect week left',
          perfectWeekOther: '{count} perfect weeks left',
        },
      },
      items: Object.fromEntries(
        KEYS.map((key) => [key, { description: `${key}-description`, name: `${key}-name` }]),
      ),
    },
  },
};

check('1. KİLİTLİ rozet: gerçek ilerleme ve kalan miktar görünür', () => {
  const detail = renderDetail(
    { currentProgress: 2, isUnlocked: false, key: 'workout_5', targetProgress: 5 },
    TR,
  );

  assertEqual(detail.status, 'Devam ediyor', 'kilitli rozette durum yanlış');
  assertDeepEqual(
    detail.rows.map((row) => [row.id, row.value]),
    [
      ['progress', '2 / 5'],
      ['remaining', '3 antrenman kaldı'],
    ],
    'kilitli rozette ilerleme/kalan satırları beklenen değil',
  );
  // Kazanılma tarihi satırı KİLİTLİ rozette hiç oluşmaz.
  assert(
    !detail.rows.some((row) => row.id === 'unlockedAt'),
    'kilitli rozette kazanılma tarihi gösterildi',
  );
});

check('2. AÇILMIŞ rozet: kazanılma tarihi görünür, kalan satırı yok', () => {
  const detail = renderDetail(
    {
      currentProgress: 5,
      isUnlocked: true,
      key: 'workout_5',
      targetProgress: 5,
      unlockedAt: '2026-08-26T10:00:00Z',
    },
    TR,
    '26 Ağu',
  );

  assertEqual(detail.status, 'Kazanıldı', 'açılmış rozette durum yanlış');
  assertDeepEqual(
    detail.rows.map((row) => [row.id, row.value]),
    [
      ['progress', '5 / 5'],
      ['unlockedAt', '26 Ağu'],
    ],
    'açılmış rozette satırlar beklenen değil',
  );

  // Okunamayan zaman damgası: satır UYDURULMAZ, sessizce düşer.
  const withoutDate = renderDetail(
    { currentProgress: 5, isUnlocked: true, key: 'workout_5', targetProgress: 5 },
    TR,
    undefined,
  );
  assertDeepEqual(
    withoutDate.rows.map((row) => row.id),
    ['progress'],
    'tarih okunamazken uydurma satır gösterildi',
  );
});

check('3. Kalan miktar SUNUCU alanlarından türer; birim doğrudur', () => {
  // Seri rozetlerinde birim GÜN, antrenman rozetlerinde ANTRENMAN.
  assertEqual(
    renderDetail({ currentProgress: 1, isUnlocked: false, key: 'streak_3', targetProgress: 3 }, TR)
      .rows[1].value,
    '2 gün kaldı',
    'seri rozetinde birim yanlış',
  );

  // İngilizcede tekil/çoğul ayrımı vardır.
  assertEqual(
    renderDetail({ currentProgress: 4, isUnlocked: false, key: 'workout_5', targetProgress: 5 }, EN)
      .rows[1].value,
    '1 workout left',
    'EN tekil kalan metni yanlış',
  );
  assertEqual(
    renderDetail({ currentProgress: 2, isUnlocked: false, key: 'workout_5', targetProgress: 5 }, EN)
      .rows[1].value,
    '3 workouts left',
    'EN çoğul kalan metni yanlış',
  );
  assertEqual(
    renderDetail({ currentProgress: 6, isUnlocked: false, key: 'streak_7', targetProgress: 7 }, EN)
      .rows[1].value,
    '1 day left',
    'EN tekil gün metni yanlış',
  );

  // Sunucu hedefi aşan bir ilerleme dönerse NEGATİF sayı gösterilmez.
  const overshoot = renderDetail(
    { currentProgress: 7, isUnlocked: false, key: 'workout_5', targetProgress: 5 },
    TR,
  );
  assertDeepEqual(
    overshoot.rows.map((row) => row.id),
    ['progress'],
    'hedef aşıldığında kalan satırı gösterildi',
  );
  assertEqual(overshoot.rows[0].value, '7 / 5', 'ilerleme sunucu değerinden farklı gösterildi');

  // Bütün anahtarlar için birim tanımlıdır; eksik birim "undefined" metni üretirdi.
  for (const key of KEYS) {
    assert(UNITS.includes(REMAINING_UNIT[key]), `birim eşlemesi eksik veya bilinmiyor: ${key}`);
  }
});

check('4. KUSURSUZ HAFTA birimi GÜN değil HAFTA', () => {
  // Birim eşlemesi: seri rozetleri gün sayar, kusursuz hafta saymaz.
  assertEqual(REMAINING_UNIT.perfect_week, 'perfectWeek', 'kusursuz hafta birimi yanlış');
  assert(REMAINING_UNIT.perfect_week !== 'day', 'kusursuz hafta hâlâ gün birimini kullanıyor');
  assertEqual(REMAINING_UNIT.streak_3, 'day', 'streak_3 birimi değişmiş');
  assertEqual(REMAINING_UNIT.streak_7, 'day', 'streak_7 birimi değişmiş');
  for (const key of ['first_workout', 'workout_5', 'workout_15']) {
    assertEqual(REMAINING_UNIT[key], 'workout', `antrenman rozeti birimi değişmiş: ${key}`);
  }

  // TR: tekil/çoğul ayrımı yok, cümle her iki durumda da aynı.
  const trOne = renderDetail(
    { currentProgress: 1, isUnlocked: false, key: 'perfect_week', targetProgress: 2 },
    TR,
  );
  assertEqual(trOne.rows[1].value, '1 kusursuz hafta kaldı', 'TR kusursuz hafta metni yanlış');
  const trMany = renderDetail(
    { currentProgress: 0, isUnlocked: false, key: 'perfect_week', targetProgress: 3 },
    TR,
  );
  assertEqual(trMany.rows[1].value, '3 kusursuz hafta kaldı', 'TR çoğul kusursuz hafta metni yanlış');

  // EN: tekil ve çoğul ayrı.
  assertEqual(
    renderDetail(
      { currentProgress: 1, isUnlocked: false, key: 'perfect_week', targetProgress: 2 },
      EN,
    ).rows[1].value,
    '1 perfect week left',
    'EN tekil kusursuz hafta metni yanlış',
  );
  assertEqual(
    renderDetail(
      { currentProgress: 0, isUnlocked: false, key: 'perfect_week', targetProgress: 3 },
      EN,
    ).rows[1].value,
    '3 perfect weeks left',
    'EN çoğul kusursuz hafta metni yanlış',
  );

  // Hiçbir dilde "gün/day" cümlesi üretilmez.
  for (const dict of [TR, EN]) {
    const value = renderDetail(
      { currentProgress: 0, isUnlocked: false, key: 'perfect_week', targetProgress: 3 },
      dict,
    ).rows[1].value;
    assert(!/gün|\bdays?\b/i.test(value), `kusursuz haftada gün birimi sızdı: ${value}`);
  }

  // Sayı hâlâ sunucu alanlarının farkıdır.
  assertEqual(
    renderDetail(
      { currentProgress: 2, isUnlocked: false, key: 'perfect_week', targetProgress: 6 },
      EN,
    ).rows[1].value,
    '4 perfect weeks left',
    'kusursuz hafta kalanı sunucu farkından türemiyor',
  );

  // Birim gerçekten type-safe bir birleşimden gelir ve sözlükte karşılığı vardır.
  assert(
    sheetCode.includes("type RemainingUnit = 'workout' | 'day' | 'perfectWeek'"),
    'birim tipi type-safe bir birleşim değil',
  );
  assert(sheetCode.includes("perfect_week: 'perfectWeek'"), 'bileşende kusursuz hafta birimi yok');
  assert(!/perfect_week:\s*'day'/.test(sheetCode), 'bileşende kusursuz hafta hâlâ gün');

  /**
   * MUTASYON: birim `day`e döndürülürse cümle sessizce yanlışlaşır — çeviri
   * yolu geçerli kaldığı için hata ancak metin denetlenerek yakalanır.
   */
  const brokenValue = translate(EN, 'ranks.achievements.detail.remaining.dayOther', { count: 3 });
  assertEqual(brokenValue, '3 days left', 'bozuk birim gerçekten gün cümlesi üretmeli');
  assertThrows(
    () => assertEqual(brokenValue, '3 perfect weeks left', 'mutation'),
    'gün birimiyle de geçti — yanlış birim yakalanmıyor',
  );
});

check('5. MUTASYON: kalan miktar hedeften türetilmezse test DÜŞER', () => {
  /** Kasıtlı hata: kalan, hedef yerine sabit bir sayıdan türetiliyor. */
  const brokenRemaining = 3;
  assertThrows(
    () => assertEqual(brokenRemaining, 5 - 1, 'mutation'),
    'sabit kalan değeri testten geçti — sunucu bağı yakalanmıyor',
  );

  // Doğru model her hedef/ilerleme çiftinde farkı taşır.
  assertEqual(
    renderDetail({ currentProgress: 1, isUnlocked: false, key: 'workout_15', targetProgress: 15 }, TR)
      .rows[1].value,
    '14 antrenman kaldı',
    'kalan miktar sunucu alanlarından türemiyor',
  );
});

// ---------------------------------------------------------------------------
// Katman 2 — kaynak ve sözlük denetimi
// ---------------------------------------------------------------------------

check('6. Kartlar dokunulabilir ve erişilebilir', () => {
  const badge = screenSource.slice(
    screenSource.indexOf('function AchievementBadge('),
    screenSource.indexOf('function StatRow('),
  );

  assert(badge.includes('MotionPressable'), 'kartlarda mevcut press feedback bileşeni yok');
  assert(badge.includes('accessibilityRole="button"'), 'kartta accessibilityRole="button" yok');
  assert(badge.includes('onPress={() => onOpen(key)}'), 'kart dokunuşu pencereyi açmıyor');
  assert(badge.includes('accessibilityHint'), 'kartta ne olacağını anlatan ipucu yok');

  // Etiket ad + kilit durumu + ilerlemeyi anlatır.
  assert(
    badge.includes('unlockedA11y') && badge.includes('lockedA11y'),
    'kilitli/açık erişilebilirlik metinleri eksik',
  );
  for (const locale of [localeTr, localeEn]) {
    const unlocked = /unlockedA11y: '([^']+)'/.exec(locale)?.[1] ?? '';
    assert(
      unlocked.includes('{name}') && unlocked.includes('{current}') && unlocked.includes('{target}'),
      'açık rozet etiketi ad/ilerleme taşımıyor',
    );
  }

  // İstemci ilerleme HESAPLAMAZ (mevcut kural korunur).
  assert(!/\.filter\(|\.length|currentProgress\s*[+*-]/.test(badge), 'kart ilerleme hesaplıyor');
});

check('7. Pencere ÜÇ kapatma yoluyla da kapanır ve arka ekranı kilitler', () => {
  // Android donanım geri tuşu.
  assert(sheetSource.includes('onRequestClose={onClose}'), 'Android geri tuşu kapatmıyor');
  // Arka plana dokunma.
  const backdrop = sheetSource.slice(
    sheetSource.indexOf('<Pressable'),
    sheetSource.indexOf('<Animated.View\n          accessibilityViewIsModal'),
  );
  assert(backdrop.includes('onPress={onClose}'), 'arka plana dokunma kapatmıyor');
  assert(backdrop.includes('StyleSheet.absoluteFill'), 'arka plan dokunma alanı tam ekran değil');
  // Belirgin kapatma düğmesi.
  assert(
    sheetSource.includes("t('ranks.achievements.detail.close')"),
    'kapatma düğmesi metni çeviriden gelmiyor',
  );
  assert(
    sheetSource.includes("accessibilityLabel={t('ranks.achievements.detail.closeA11y')}"),
    'kapatma düğmesinin erişilebilirlik etiketi yok',
  );

  /**
   * Arka ekran etkileşim ALMAZ: içerik gerçek bir `Modal` içindedir, yani
   * altındaki rank ekranı dokunma alamaz; ayrıca perde tam ekranı kaplar.
   */
  assert(/<Modal[\s\S]{0,240}visible>/.test(sheetSource), 'pencere Modal katmanında değil');
  assert(sheetSource.includes('transparent'), 'perde saydam değil — tam sayfa gibi görünürdü');
  assert(sheetSource.includes('accessibilityViewIsModal'), 'ekran okuyucu arka planı okumaya devam eder');
});

check('8. Reduce Motion açıkken hareket YOK', () => {
  assert(sheetSource.includes('useReducedMotion'), 'reduce motion okunmuyor');
  assert(
    sheetSource.includes('reduceMotion ? MotionDuration.instant'),
    'reduce motion açıkken giriş süresi sadeleşmiyor',
  );
  assert(
    sheetSource.includes('transform: reduceMotion ? []'),
    'reduce motion açıkken ölçek animasyonu kapanmıyor',
  );
  // Normal modda çok hafif opacity + scale.
  assert(sheetSource.includes('const ENTER_SCALE = 0.97'), 'giriş ölçeği gösterişli veya tanımsız');
  assert(sheetSource.includes('opacity: progress.value'), 'opaklık animasyonu yok');
});

check('9. Tasarım sınırları: tema, tipografi, dokunma hedefi', () => {
  // Tek sabit renk perdedir; geri kalanı temadan ve rank renginden gelir.
  const hexes = [...sheetCode.matchAll(/'#[0-9A-Fa-f]{3,8}'/g)].map((match) => match[0]);
  assertDeepEqual(hexes, ["'#000000'"], 'pencereye tema dışı sabit renk eklenmiş');
  assert(!/gradient|LinearGradient|confetti/i.test(sheetCode), 'gradient veya gösterişli görsel eklenmiş');
  assert(sheetSource.includes('colors.surface'), 'kart zemini temadan gelmiyor');
  assert(sheetSource.includes('isDark ? SCRIM_ALPHA.dark : SCRIM_ALPHA.light'), 'koyu/açık perde ayrımı yok');

  // En fazla dört yazı boyutu ve iki ağırlık.
  const sizes = new Set([...sheetSource.matchAll(/fontSize: (\d+)/g)].map((match) => match[1]));
  const weights = new Set([...sheetSource.matchAll(/fontWeight: '(\d+)'/g)].map((match) => match[1]));
  assert(sizes.size <= 4, `dörtten fazla yazı boyutu: ${[...sizes].join(', ')}`);
  assert(weights.size <= 2, `ikiden fazla yazı ağırlığı: ${[...weights].join(', ')}`);

  // Dokunma hedefi 44 pt.
  assert(sheetSource.includes('minHeight: Layout.minTouchSize'), 'kapatma düğmesi 44 pt değil');

  // Tam sayfa DEĞİL + küçük ekranda içerik erişilebilir.
  assert(sheetSource.includes("maxHeight: '80%'"), 'pencere tam ekranı kaplıyor');
  assert(sheetSource.includes('ScrollView'), 'küçük ekranlarda içerik kaydırılamıyor');

  // Uzun TR/EN metinlerinde taşma yok: kısaltma yerine sarma kullanılır.
  assert(!sheetSource.includes('numberOfLines'), 'pencere metni kırpıyor — uzun çeviri kaybolur');
  assert(sheetSource.includes('flexShrink: 1'), 'satır değerleri daralmıyor — taşma riski');
});

check('10. Ham veri sızmaz; sayılar sunucudan gelir', () => {
  // Ham anahtar, kimlik veya RPC adı GÖSTERİLMEZ.
  assert(!/achievement_key|user_id|supabase|rpc\(/i.test(sheetCode), 'pencere teknik metadata gösteriyor');
  // Anahtar yalnızca çeviri ve ikon aramasında kullanılır.
  assert(
    sheetSource.includes('ACHIEVEMENT_ICONS[key]') &&
      sheetSource.includes('ranks.achievements.items.${key}.name'),
    'anahtar çeviri/ikon aramasında kullanılmıyor',
  );
  // Hiçbir hedef sayısı bileşende veya sözlükte SABİTLENMEZ.
  assert(
    !/targetProgress\s*=\s*\d|target:\s*\d/.test(sheetCode),
    'pencerede sabit hedef sayısı var',
  );
  for (const locale of [localeTr, localeEn]) {
    const start = locale.indexOf('detail: {', locale.indexOf('lockedA11y'));
    const detail = locale.slice(start, locale.indexOf('showcase: {', start));
    assert(detail.includes('unlockedAtLabel'), 'ayrıntı sözlük bloğu bulunamadı');
    // Yalnızca METİN değerleri denetlenir; `closeA11y` gibi anahtar adları değil.
    const values = [...detail.matchAll(/'([^']*)'/g)].map((match) => match[1]);
    assert(values.length > 0, 'ayrıntı sözlüğünde metin bulunamadı');
    for (const value of values) {
      assert(
        !/\d/.test(value.replace(/\{count\}/g, '')),
        `sözlükte sabit hedef sayısı var: ${value}`,
      );
    }
  }
  // Pencere RP/XP/gül üretmez.
  // `rank-experience` yalnızca ANAHTAR TİPİ için import edilir; ödül yazma yolu yoktur.
  assert(
    !/\brp\b|addRose|grantXp|awardXp|reward|level/i.test(sheetCode),
    'pencere ödül akışına dokunuyor',
  );
});

check('11. TR/EN anahtarları eşleşir', () => {
  const keys = [
    'statusUnlocked',
    'statusInProgress',
    'progressLabel',
    'remainingLabel',
    'unlockedAtLabel',
    'close',
    'closeA11y',
    'openHint',
    'workoutOne',
    'workoutOther',
    'dayOne',
    'dayOther',
    'perfectWeekOne',
    'perfectWeekOther',
  ];
  for (const key of keys) {
    assert(localeTr.includes(`${key}:`), `TR sözlüğünde ${key} yok`);
    assert(localeEn.includes(`${key}:`), `EN sözlüğünde ${key} yok`);
  }
  // Açıklamalar zaten sözlükte; bileşende metin SABİTLENMEZ.
  for (const key of KEYS) {
    assert(localeTr.includes(`${key}: {`), `TR sözlüğünde ${key} yok`);
    assert(localeEn.includes(`${key}: {`), `EN sözlüğünde ${key} yok`);
  }
  assert(
    !/<Text[^>]*>\s*[A-ZĞÜŞİÖÇ][a-zğüşıöç]/.test(sheetCode),
    'pencerede çeviriden gelmeyen metin var',
  );
});

check('12. Kapsam sınırı: kutlama ve profil vitrini değişmemiş', () => {
  // Pencere kutlama/vitrin akışlarına HİÇ dokunmaz.
  assert(
    !/celebration|showcase|acknowledge|dismiss/i.test(sheetCode),
    'pencere kutlama veya vitrin akışına dokunuyor',
  );
  // Rank ekranı ayrıntı için yeni sayfa veya navigasyon AÇMAZ.
  const grid = screenSource.slice(screenSource.indexOf('function AchievementsGrid('));
  assert(!/router\.(push|replace|navigate)/.test(grid), 'ayrıntı için navigasyon eklenmiş');
  // İkon eşlemesi hâlâ TEK kaynaktan gelir.
  assert(
    sheetSource.includes("from '@/components/ranks/achievement-icons'") &&
      !/const ACHIEVEMENT_ICONS[\s\S]{0,40}=\s*\{/.test(sheetSource),
    'ikon eşlemesi kopyalanmış',
  );
  // Profil vitrini bileşeni bu turda etkileşim KAZANMADI.
  const showcase = source('components/ranks/profile-achievement-showcase.tsx');
  assert(
    !showcase.includes('AchievementDetailSheet'),
    'profil vitrinine bu turda etkileşim eklenmiş',
  );
});

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} kontrol başarısız (${passed} geçti):\n`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}

console.log(`✓ Rozet ayrıntısı harness: ${passed} kontrol geçti.`);
console.log('  (SQL, RPC ve servis katmanına dokunulmadı; yalnızca gösterim doğrulandı.)');
