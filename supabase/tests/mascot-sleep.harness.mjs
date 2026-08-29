/**
 * Rosea uyku durum makinesi teşhis harness'ı.
 *
 * SINIR: React render edilmez. İki katman:
 *   A. YAPISAL — `hooks/use-mascot-sleep.ts` ve `floating-mascot.tsx` içindeki
 *      kuralların gerçekten bulunduğunu iddia eder.
 *   B. DAVRANIŞSAL — hook'un effect grafiğinin satır satır karşılığı olan
 *      model, SAHTE SAAT üzerinde çalıştırılır; süreler gerçek sabitlerden
 *      okunur.
 *
 * Çalıştırma:  node supabase/tests/mascot-sleep.harness.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

/**
 * `utils/mascot-app-state.ts` GERÇEKTEN derlenir ve GERÇEK fonksiyon
 * çalıştırılır — ön plan kararı burada taklit edilmez.
 */
const outDir = mkdtempSync(join(tmpdir(), 'rosea-mascot-app-state-'));
let isMascotForegroundState;
try {
  execFileSync(
    'npx',
    [
      'tsc',
      join(root, 'utils/mascot-app-state.ts'),
      '--outDir',
      outDir,
      '--target',
      'es2020',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--strict',
    ],
    { cwd: root, stdio: 'pipe' },
  );
  ({ isMascotForegroundState } = await import(
    pathToFileURL(join(outDir, 'mascot-app-state.js')).href
  ));
} catch (error) {
  console.error(
    'utils/mascot-app-state.ts derlenemedi:\n' + (error.stdout?.toString() ?? error.message),
  );
  process.exit(1);
}

const sleepHook = read('hooks/use-mascot-sleep.ts');
const mascot = read('components/mascot/floating-mascot.tsx');

/** Süreler kaynak dosyadan okunur; harness kendi sayı uydurmaz. */
const readConst = (name) => Number(sleepHook.match(new RegExp(`export const ${name} = (\\d+)`))[1]);
const SLEEP_MIN_DELAY = readConst('SLEEP_MIN_DELAY');
const SLEEP_DELAY_RANGE = readConst('SLEEP_DELAY_RANGE');
const SLEEP_DROWSY_DURATION = readConst('SLEEP_DROWSY_DURATION');
const SLEEP_SETTLE_DURATION = readConst('SLEEP_SETTLE_DURATION');

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` +
      (ok ? '' : `  (beklenen ${JSON.stringify(expected)}, gelen ${JSON.stringify(actual)})`),
  );
}
const contains = (name, haystack, needle) => check(name, haystack.includes(needle), true);

// ---------------------------------------------------------------------------
console.log('=== A. Kaynak kuralları ===');
check('bekleme aralığı 45–75 sn', [SLEEP_MIN_DELAY, SLEEP_MIN_DELAY + SLEEP_DELAY_RANGE], [45000, 75000]);
check('drowsy 3 sn', SLEEP_DROWSY_DURATION, 3000);
check('settling 2 sn', SLEEP_SETTLE_DURATION, 2000);
contains('dört fazlı tek state', sleepHook, "'awake' | 'drowsy' | 'settling' | 'asleep'");
contains('faz yalnızca gerçek değişimde yazılıyor', sleepHook, 'if (!isMountedRef.current || phaseRef.current === next) return;');
contains('geçiş zamanlayıcısı AYRI effect\'te', sleepHook, 'const nextPhase: MascotSleepPhase = isDrowsy ? \'settling\' : \'asleep\';');
contains('ateşlenme anında koşullar yeniden doğrulanıyor', sleepHook, 'if (!canSleepRef.current || !isAppActiveRef.current || !isMountedRef.current)');
contains('unmount cleanup var', sleepHook, 'isMountedRef.current = false;');
contains('AppState aboneliği kaldırılıyor', sleepHook, 'return () => subscription.remove();');
contains(
  'AppState ilk değeri senkron okunuyor',
  sleepHook,
  'useRef(isMascotForegroundState(AppState.currentState))',
);
check(
  'eski `=== \'active\'` başlangıç kalıbı KALMADI',
  /useRef\(AppState\.currentState === 'active'\)/.test(sleepHook),
  false,
);
contains('geçiş kararı da aynı yardımcıdan geçiyor', sleepHook, 'const nextIsActive = isMascotForegroundState(next);');
contains(
  'yardımcı maskot kapsamlı modülden geliyor (banner modülüne bağımlılık yok)',
  sleepHook,
  "import { isMascotForegroundState } from '@/utils/mascot-app-state';",
);
check(
  'uyku hook\'u mesaj banner\'ı yardımcısını İÇE AKTARMIYOR',
  /friend-message-alerts/.test(sleepHook),
  false,
);
contains('canSleep aktif workout\'u içeriyor', mascot, '!hasActiveWorkout');
contains('aktif workout yalnızca BUGÜN + running/paused', mascot, "session.status === 'running' || session.status === 'paused'");
contains('isHidden klavyeye bağlı (uykuyu engelleyen üçüncü koşul)', mascot, 'const isHidden = !enabled || !isReady || isKeyboardVisible;');
check(
  'isHidden ROTA bağımlı DEĞİL (sekme değişimi uykuyu bozmaz)',
  /const isHidden = [^;]*pathname/.test(mascot),
  false,
);
check(
  'FloatingMascot tabs ağacının içinde DEĞİL (sekme geçişi remount etmez)',
  read('app/(tabs)/_layout.tsx').includes('FloatingMascot'),
  false,
);
contains('FloatingMascot kök layout\'ta Stack kardeşi', read('app/_layout.tsx'), '</Stack>');
contains('balon zaman aşımıyla kapanıyor', mascot, 'bubbleVariantRef.current = undefined;\n        setBubbleVariant(undefined);');

// ---------------------------------------------------------------------------
// B. Effect grafiğinin sahte saatli modeli
// ---------------------------------------------------------------------------

/** Hook'un iki effect'ini ve iki zamanlayıcısını birebir yansıtan model. */
function createMachine({ canSleep = true, isAppActive = true, delay = SLEEP_MIN_DELAY } = {}) {
  const machine = {
    phase: 'awake',
    canSleep,
    isAppActive,
    mounted: true,
    delay,
    /** Kurulan ana zamanlayıcı sayısı — gereksiz yeniden kurulum tespiti. */
    mainTimerArmCount: 0,
    mainTimer: undefined,
    transitionTimer: undefined,
    now: 0,
  };

  const setPhase = (next) => {
    if (!machine.mounted || machine.phase === next) return;
    machine.phase = next;
    runEffects();
  };

  const clearMain = () => {
    machine.mainTimer = undefined;
  };
  const clearTransition = () => {
    machine.transitionTimer = undefined;
  };

  /** Ana effect (deps: canSleep, isAppActive, phase). */
  function mainEffect() {
    if (!machine.canSleep || !machine.isAppActive) {
      clearMain();
      clearTransition();
      setPhase('awake');
      return;
    }
    if (machine.phase !== 'awake') {
      clearMain();
      return;
    }
    // Zaten kurulu bir zamanlayıcı varsa yeniden kurulmaz (deps değişmediyse
    // effect hiç çalışmaz; model bunu "aynı deps → tekrar çalıştırma" ile
    // taklit eder).
    clearMain();
    machine.mainTimerArmCount += 1;
    machine.mainTimer = {
      fireAt: machine.now + machine.delay,
      run: () => {
        machine.mainTimer = undefined;
        if (!machine.canSleep || !machine.isAppActive || !machine.mounted) return;
        setPhase('drowsy');
      },
    };
  }

  /** Geçiş effect'i (deps: isDrowsy, isSettling). */
  function transitionEffect() {
    const isDrowsy = machine.phase === 'drowsy';
    const isSettling = machine.phase === 'settling';
    if (!isDrowsy && !isSettling) {
      clearTransition();
      return;
    }
    clearTransition();
    const nextPhase = isDrowsy ? 'settling' : 'asleep';
    const duration = isDrowsy ? SLEEP_DROWSY_DURATION : SLEEP_SETTLE_DURATION;
    machine.transitionTimer = {
      fireAt: machine.now + duration,
      run: () => {
        machine.transitionTimer = undefined;
        if (!machine.canSleep || !machine.isAppActive || !machine.mounted) {
          setPhase('awake');
          return;
        }
        setPhase(nextPhase);
      },
    };
  }

  /** Deps değişimini taklit eder: her ikisi de yeniden değerlendirilir. */
  let lastMainDeps = '';
  let lastTransitionDeps = '';
  function runEffects() {
    const mainDeps = `${machine.canSleep}|${machine.isAppActive}|${machine.phase}`;
    if (mainDeps !== lastMainDeps) {
      lastMainDeps = mainDeps;
      mainEffect();
    }
    const transitionDeps = `${machine.phase === 'drowsy'}|${machine.phase === 'settling'}`;
    if (transitionDeps !== lastTransitionDeps) {
      lastTransitionDeps = transitionDeps;
      transitionEffect();
    }
  }

  machine.start = () => runEffects();
  /** Sahte saati ilerletir. */
  machine.advance = (ms) => {
    const target = machine.now + ms;
    for (;;) {
      const timers = [machine.mainTimer, machine.transitionTimer].filter(
        (timer) => timer && timer.fireAt <= target,
      );
      if (timers.length === 0) break;
      timers.sort((a, b) => a.fireAt - b.fireAt);
      const next = timers[0];
      machine.now = next.fireAt;
      next.run();
    }
    machine.now = target;
  };
  /** Bir render'ı yeniden değerlendirir (deps değişmediyse effect çalışmaz). */
  machine.rerender = () => runEffects();
  machine.set = (patch) => {
    Object.assign(machine, patch);
    runEffects();
  };
  machine.unmount = () => {
    machine.mounted = false;
    clearMain();
    clearTransition();
  };
  /** Dokunma: `wake()` — geçiş iptal edilir, faz uyanığa döner. */
  machine.wake = () => {
    clearTransition();
    setPhase('awake');
  };

  return machine;
}

console.log('\n=== B1. Minimum beklemede tam akış ===');
{
  const m = createMachine({ delay: SLEEP_MIN_DELAY });
  m.start();
  m.advance(SLEEP_MIN_DELAY - 1);
  check('B1) bekleme dolmadan uyanık', m.phase, 'awake');
  m.advance(1);
  check('B1) minimum bekleme sonunda drowsy', m.phase, 'drowsy');
  m.advance(SLEEP_DROWSY_DURATION);
  check('B1) 3 sn sonra settling', m.phase, 'settling');
  m.advance(SLEEP_SETTLE_DURATION);
  check('B1) 2 sn sonra asleep', m.phase, 'asleep');
}

console.log('\n=== B2. Maksimum beklemede aynı akış ===');
{
  const m = createMachine({ delay: SLEEP_MIN_DELAY + SLEEP_DELAY_RANGE });
  m.start();
  m.advance(SLEEP_MIN_DELAY + SLEEP_DELAY_RANGE);
  check('B2) 75 sn sonunda drowsy', m.phase, 'drowsy');
  m.advance(SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION);
  check('B2) toplam 80 sn\'de asleep', m.phase, 'asleep');
  check('B2) uykuya kadar geçen toplam süre', m.now, 80000);
}

console.log('\n=== B3. Zamanlayıcı gereksiz yeniden kurulmuyor ===');
{
  const m = createMachine();
  m.start();
  check('B3) ilk kurulumda bir kez kuruldu', m.mainTimerArmCount, 1);
  for (let i = 0; i < 20; i += 1) m.rerender();
  check('B3) 20 render sonrası hâlâ bir kez', m.mainTimerArmCount, 1);
  m.advance(SLEEP_MIN_DELAY);
  check('B3) süre dolunca drowsy', m.phase, 'drowsy');
  check('B3) drowsy\'ye geçerken yeni ana zamanlayıcı kurulmadı', m.mainTimerArmCount, 1);
}

console.log('\n=== B4. canSleep dalgalanması sayacı sıfırlar (gerçek risk) ===');
{
  const m = createMachine();
  m.start();
  m.advance(SLEEP_MIN_DELAY - 5000);
  m.set({ canSleep: false });
  m.set({ canSleep: true });
  check('B4) dalgalanma sonrası uyanık', m.phase, 'awake');
  check('B4) zamanlayıcı yeniden kuruldu', m.mainTimerArmCount, 2);
  m.advance(SLEEP_MIN_DELAY - 1);
  check('B4) sayaç BAŞTAN başladı (henüz drowsy değil)', m.phase, 'awake');
  m.advance(1);
  check('B4) tam süre sonunda drowsy', m.phase, 'drowsy');
}

console.log('\n=== B5. Aktif workout uykuyu engelliyor ===');
{
  const todayKey = '2026-08-25';
  /** `floating-mascot.tsx` içindeki `hasActiveWorkout` ile aynı kural. */
  const hasActiveWorkout = (sessions) =>
    sessions.some(
      (session) =>
        session.dateKey === todayKey &&
        (session.status === 'running' || session.status === 'paused'),
    );

  check('B5) bugün running → aktif', hasActiveWorkout([{ dateKey: todayKey, status: 'running' }]), true);
  check('B5) bugün paused → aktif', hasActiveWorkout([{ dateKey: todayKey, status: 'paused' }]), true);
  check('B5) bugün completed → aktif DEĞİL', hasActiveWorkout([{ dateKey: todayKey, status: 'completed' }]), false);
  check('B5) dünkü running → aktif DEĞİL (bayat sayılmıyor)', hasActiveWorkout([{ dateKey: '2026-08-24', status: 'running' }]), false);

  const m = createMachine({ canSleep: !hasActiveWorkout([{ dateKey: todayKey, status: 'running' }]) });
  m.start();
  m.advance(SLEEP_MIN_DELAY + SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION + 60000);
  check('B5) aktif workout varken HİÇ uyumuyor', m.phase, 'awake');
  check('B5) ana zamanlayıcı hiç kurulmadı', m.mainTimerArmCount, 0);

  // Antrenman tamamlanınca tekrar uyuyabilmeli.
  m.set({ canSleep: true });
  m.advance(SLEEP_MIN_DELAY + SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION);
  check('B5) workout tamamlanınca tekrar uyuyor', m.phase, 'asleep');
}

console.log('\n=== B6. Dokunma / balon sonrası sıfırlanma ===');
{
  const m = createMachine();
  m.start();
  m.advance(SLEEP_MIN_DELAY + SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION);
  check('B6) uyudu', m.phase, 'asleep');

  m.wake();
  check('B6) dokunma anında uyandı', m.phase, 'awake');
  m.advance(SLEEP_MIN_DELAY + SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION);
  check('B6) sayaç yeniden başlayıp tekrar uyudu', m.phase, 'asleep');

  // Balon açılırsa (canSleep=false) drowsy iptal olur.
  const b = createMachine();
  b.start();
  b.advance(SLEEP_MIN_DELAY);
  check('B6) drowsy başladı', b.phase, 'drowsy');
  b.set({ canSleep: false });
  check('B6) balon açılınca drowsy iptal', b.phase, 'awake');
  b.set({ canSleep: true });
  b.advance(SLEEP_MIN_DELAY + SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION);
  check('B6) balon kapanınca yeniden uyuyabiliyor', b.phase, 'asleep');
}

console.log('\n=== B7. AppState ve unmount ===');
{
  const m = createMachine();
  m.start();
  m.advance(SLEEP_MIN_DELAY + SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION);
  check('B7) uyudu', m.phase, 'asleep');
  m.set({ isAppActive: false });
  check('B7) arka planda uyanık', m.phase, 'awake');
  m.set({ isAppActive: true });
  m.advance(SLEEP_MIN_DELAY + SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION);
  check('B7) öne dönünce yeniden uyudu', m.phase, 'asleep');

  // KANITLANMIŞ arka planda (background/inactive) zamanlayıcı hiç kurulmaz.
  // Soğuk açılışın BİLİNMEYEN başlangıç değeri ayrı bir durumdur → B9.
  const background = createMachine({ isAppActive: false });
  background.start();
  background.advance(SLEEP_MIN_DELAY * 3);
  check('B7) kanıtlanmış arka planda zamanlayıcı kurulmuyor', background.mainTimerArmCount, 0);
  background.set({ isAppActive: true });
  check('B7) aktif olunca kuruluyor', background.mainTimerArmCount, 1);

  const u = createMachine();
  u.start();
  u.advance(SLEEP_MIN_DELAY - 1000);
  u.unmount();
  u.advance(SLEEP_MIN_DELAY * 2);
  check('B7) unmount sonrası faz yazılmıyor', u.phase, 'awake');
  check('B7) unmount bekleyen zamanlayıcıları temizledi', [u.mainTimer, u.transitionTimer], [undefined, undefined]);
}

console.log('\n=== B8. Drowsy/settling cleanup kendi zamanlayıcısını iptal etmiyor ===');
{
  const m = createMachine();
  m.start();
  m.advance(SLEEP_MIN_DELAY);
  check('B8) drowsy', m.phase, 'drowsy');
  check('B8) geçiş zamanlayıcısı kuruldu', Boolean(m.transitionTimer), true);
  m.advance(SLEEP_DROWSY_DURATION);
  check('B8) settling\'e geçildi', m.phase, 'settling');
  check('B8) settling zamanlayıcısı YENİDEN kuruldu', Boolean(m.transitionTimer), true);
  m.advance(SLEEP_SETTLE_DURATION);
  check('B8) asleep', m.phase, 'asleep');
  check('B8) asleep sonrası geçiş zamanlayıcısı yok', m.transitionTimer, undefined);
}

// ---------------------------------------------------------------------------
// B9. SOĞUK AÇILIŞ — AppState başlangıç değeri kilidi
// ---------------------------------------------------------------------------
//
// KÖK NEDEN: `AppState.currentState` modül singleton'ı import anında kurulur;
// asenkron düzeltme yayını Rosea listener'ını kurmadan önce geçer ve `change`
// yalnızca GERÇEK geçişlerde ateşlenir. Başlangıç değeri `active` değilse eski
// `=== 'active'` karşılaştırması `false`'a KİLİTLENİYORDU.
console.log('\n=== B9. Soğuk açılış AppState başlangıç değeri ===');
{
  /** Hook'un başlangıç satırının birebir karşılığı. */
  const bootMachine = (rawAppState, derive) =>
    createMachine({ isAppActive: derive(rawAppState) });

  /** Gerçek yardımcı: yalnızca KANITLANMIŞ arka plan ön plan dışıdır. */
  const fixed = isMascotForegroundState;
  /** Düzeltmeden önceki model. Mutation testi bunu kullanır. */
  const broken = (state) => state === 'active';

  // --- Saf yardımcının kendisi ---
  check('B9) null → ön plan', fixed(null), true);
  check('B9) undefined → ön plan', fixed(undefined), true);
  check('B9) unknown → ön plan', fixed('unknown'), true);
  check('B9) active → ön plan', fixed('active'), true);
  check('B9) extension → ön plan', fixed('extension'), true);
  check('B9) background → ön plan DEĞİL', fixed('background'), false);
  check('B9) inactive → ön plan DEĞİL', fixed('inactive'), false);

  // --- Uyku zamanlayıcısı gerçekten kuruluyor mu ---
  for (const boot of [null, undefined, 'unknown', 'active']) {
    const m = bootMachine(boot, fixed);
    m.start();
    m.advance(SLEEP_MIN_DELAY + SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION);
    check(`B9) ${String(boot)} açılışında Rosea uyuyabiliyor`, m.phase, 'asleep');
    check(`B9) ${String(boot)} açılışında zamanlayıcı kuruldu`, m.mainTimerArmCount, 1);
  }

  // --- Kanıtlanmış arka planda çalışmamalı ---
  for (const boot of ['background', 'inactive']) {
    const m = bootMachine(boot, fixed);
    m.start();
    m.advance(SLEEP_MIN_DELAY * 3);
    check(`B9) ${boot} açılışında zamanlayıcı kurulmuyor`, m.mainTimerArmCount, 0);
    check(`B9) ${boot} açılışında uyanık kalıyor`, m.phase, 'awake');
  }

  // --- Gerçek geçiş davranışı KORUNUYOR ---
  {
    const m = bootMachine('unknown', fixed);
    m.start();
    m.advance(SLEEP_MIN_DELAY + SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION);
    check('B9) geçiş öncesi uyudu', m.phase, 'asleep');
    m.set({ isAppActive: fixed('background') });
    check('B9) background geçişi uyandırıyor', m.phase, 'awake');
    m.set({ isAppActive: fixed('inactive') });
    check('B9) inactive geçişi de uyanık tutuyor', m.phase, 'awake');
    m.set({ isAppActive: fixed('active') });
    m.advance(SLEEP_MIN_DELAY + SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION);
    check('B9) active geçişi yeniden planlıyor', m.phase, 'asleep');
  }

  // --- MUTATION: eski modele dönülürse soğuk açılış GERÇEKTEN düşer ---
  for (const boot of [null, undefined, 'unknown']) {
    const m = bootMachine(boot, broken);
    m.start();
    m.advance(SLEEP_MIN_DELAY * 3);
    check(
      `B9-MUT) eski \`=== 'active'\` modeli ${String(boot)} açılışında uyuyamıyor`,
      m.phase,
      'awake',
    );
    check(
      `B9-MUT) eski model ${String(boot)} açılışında zamanlayıcı kurmuyor`,
      m.mainTimerArmCount,
      0,
    );
  }
  // Eski model yalnızca 'active' başlangıcında doğru davranıyordu — bu yüzden
  // geliştirmede (Metro sıcak yeniden yükleme) hata hiç görünmedi.
  {
    const m = bootMachine('active', broken);
    m.start();
    m.advance(SLEEP_MIN_DELAY + SLEEP_DROWSY_DURATION + SLEEP_SETTLE_DURATION);
    check("B9-MUT) eski model yalnızca 'active' açılışında çalışıyordu", m.phase, 'asleep');
  }
}

rmSync(outDir, { recursive: true, force: true });

console.log(`\n${fail === 0 ? 'TÜMÜ GEÇTİ' : 'BAŞARISIZ VAR'} — ${pass} geçti, ${fail} kaldı`);
process.exit(fail === 0 ? 0 : 1);
