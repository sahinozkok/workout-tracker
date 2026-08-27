import { Easing as NavigationEasing } from 'react-native';
import { Easing } from 'react-native-reanimated';

/**
 * ORTAK HAREKET (MOTION) TOKENLARI
 *
 * Ekranlarda rastgele süre yazılmaz; bütün geçişler buradan okunur. Bu dosya
 * yalnızca ZAMANLAMA ve ÖLÇEK tanımlar — renk, boyut, tipografi veya yerleşim
 * değerleri içermez ve `constants/theme.ts` ile çakışmaz.
 */

/** Geçiş süreleri (ms). */
export const MotionDuration = {
  /** Anlık geri bildirim: buton basma. */
  instant: 110,
  /** Kısa geçiş: sekme içeriği, ikon geri bildirimi, buton bırakma. */
  fast: 170,
  /** Standart giriş/çıkış geçişi. */
  standard: 240,
  /** Uzun, sakin geçiş. */
  slow: 420,
} as const;

/** Ölçek değerleri. */
export const MotionScale = {
  /** Buton basılı hâli. */
  pressed: 0.95,
  /**
   * Sekme ikonu SEÇİLDİĞİ ANDA bu değerden 1'e büyür. Seçili olmayan ikonlar
   * 1 ölçekte kalır; ikon boyutları hiçbir durumda kalıcı olarak değişmez.
   */
  tabIconSelect: 0.92,
} as const;

/** Opaklık değerleri. */
export const MotionOpacity = {
  /** Buton basılı hâli. */
  pressed: 0.92,
} as const;

/** Ekran içindeki küçük yer değiştirmeler (pt). */
export const MotionDistance = {
  section: 10,
  swap: 6,
  /**
   * Liste satırının giriş mesafesi. Bölüm girişinden (10) bilinçli olarak daha
   * kısadır: bir ekranda çok sayıda satır aynı anda gelir ve büyük mesafe
   * listeyi dalgalandırır.
   */
  listItem: 8,
  /**
   * "Sakin" (calm) geçişin dikey mesafesi. Disiplin takvimi gibi GENİŞ bir
   * blok 10 pt kayınca ızgaranın tamamı sıçrıyormuş gibi görünüyor; bu yüzden
   * bilinçli olarak neredeyse hissedilmeyecek kadar küçük tutuldu.
   */
  calmSwap: 5,
} as const;

/**
 * "Sakin" (calm) geçiş süreleri (ms).
 *
 * Disiplin takvimleri gibi GENİŞ içerik blokları içindir. Week/Month/Year
 * geçişi standart sürelerle oynatılınca ızgara "çat diye" yer değiştirmiş gibi
 * hissettiriyordu. Bu değerler AYRI tutulur; `MotionDuration.instant`,
 * `fast` veya `standard` büyütülseydi uygulamanın geri kalanı da yavaşlardı.
 */
export const MotionCalmDuration = {
  /** Yeni içeriğin girişi. */
  enter: 300,
  /** Eski içeriğin çıkışı. */
  exit: 220,
  /** Yükseklik/konum değişiminin yumuşatılması. */
  layout: 300,
  /**
   * Ağır içerik (yıl ızgarası) sade bir fade ile gelir/gider. Bu ikisi
   * `enter`/`exit`ten ayrıdır çünkü yıl görünümünde dikey hareket ve layout
   * animasyonu YOKTUR — geriye yalnızca opaklık kaldığı için biraz daha uzun
   * bir süre daha doğal duruyor.
   */
  heavyEnter: 260,
  heavyExit: 240,
} as const;

/** Bölümlerin art arda görünmesi için ortak gecikme değerleri (ms). */
export const MotionStagger = {
  step: 40,
  max: 160,
} as const;

/**
 * Easing eğrileri. `standard` iOS'un doğal "ease-out" hissine yakındır:
 * hızlı başlar, yumuşak durur.
 */
export const MotionEasing = {
  standard: Easing.bezier(0.22, 1, 0.36, 1),
  /** Basma anı — kısa ve kararlı. */
  press: Easing.bezier(0.4, 0, 0.2, 1),
} as const;

/** Yay (spring) ayarı; ölçek geri dönüşünde zıplama istenmez. */
export const MotionSpring = {
  gentle: { damping: 18, mass: 0.6, stiffness: 220 },
} as const;

/**
 * Alt sekme içerik geçişi için React Navigation `transitionSpec` değeri.
 *
 * React Navigation, Reanimated'in `EasingFunctionFactory` tipini değil RN
 * çekirdeğinin `(value: number) => number` easing'ini bekler; bu yüzden burada
 * ayrı bir easing kullanılır. Süre yine ortak `MotionDuration` tokenındandır.
 */
export const TAB_TRANSITION_SPEC = {
  animation: 'timing',
  config: {
    duration: MotionDuration.fast,
    easing: NavigationEasing.out(NavigationEasing.quad),
  },
} as const;
