import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BUBBLE_MAX_WIDTH, MascotSpeechBubble } from '@/components/mascot/mascot-speech-bubble';
import { MascotCelebrationParticles } from '@/components/mascot/mascot-celebration-particles';
import { MascotLoveParticles } from '@/components/mascot/mascot-love-particles';
import { Layout } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useMascot } from '@/context/mascot-context';
import {
  clampEdgeRatio,
  isVerticalEdge,
  MASCOT_EDGE_ROTATION,
  MASCOT_REACTION_PRIORITY,
  MascotEdge,
  MascotReactionType,
  MascotState,
} from '@/types/mascot';

const mascotSource = require('../../assets/images/mascot/mascot-idle.png');

/** Görünür karakter ölçüsü. Kare kutu + `contain` → oran bozulmadan sığar. */
const MASCOT_SIZE = 88;
/** Aktif antrenman ekranında set kontrollerini kapatmayan küçük mod. */
const COMPACT_MASCOT_SIZE = 64;
/** Görsel kutu. Dokunma hedefi bundan küçüktür (aşağıya bakınız). */
const TOUCH_SIZE = 100;
/** Kenarlardan bırakılan güvenli boşluk. */
const EDGE_MARGIN = 12;

/**
 * Kaynak görselin en-boy oranı (584 × 512). `contentFit="contain"` kare kutuya
 * genişlikten sığdırdığı için karakterin **baş-kuyruk ekseni** boyunca gerçek
 * uzunluğu `size / ASPECT` olur. Peek mesafesi bu uzunluktan hesaplanır.
 */
const MASCOT_ASPECT = 584 / 512;

/**
 * Kenardan bakma. Karakterin baş-kuyruk ekseninin bu kadarı ekranda kalır,
 * gerisi yüzeyin arkasına gizlenir. Görünür kısım hiçbir koşulda
 * `PEEK_MIN_VISIBLE` altına inmez.
 */
const PEEK_VISIBLE_FRACTION = 0.55;
const PEEK_MIN_VISIBLE = 44;
/** AI düşünürken maskot biraz daha fazla görünür. */
const THINKING_PEEK_FACTOR = 0.7;
const PEEK_SPRING = { damping: 20, mass: 0.9, stiffness: 200 };
/** Reduce Motion: kenara girip çıkma ve dönüş neredeyse anlık olur. */
const REDUCED_PEEK_DURATION = 120;

/**
 * Maskot boşta beklerken arada sırada kenardan biraz daha fazla görünür.
 * Seyrek ve düzensiz aralıklar hareketin mekanik bir döngü gibi görünmesini
 * engeller.
 */
const AMBIENT_PEEK_MIN_DELAY = 9000;
const AMBIENT_PEEK_DELAY_RANGE = 7000;
const AMBIENT_PEEK_REVEAL_FRACTION = 0.32;
const AMBIENT_PEEK_IN_DURATION = 360;
const AMBIENT_PEEK_HOLD_DURATION = 700;
const AMBIENT_PEEK_OUT_DURATION = 480;

const TAP_LIFT = -9;
const BUBBLE_TIMEOUT = 4000;
const CELEBRATION_BUBBLE_TIMEOUT = 3800;
const DRAG_SCALE = 1.05;
/** Bu mesafeden kısa hareketler sürükleme sayılmaz; tap olarak geçer. */
const DRAG_MIN_DISTANCE = 8;

/**
 * Çift dokunma "sevme" tepkisi. Tepki ve balon aynı süreyi paylaşır, böylece
 * maskot ikisi de bitince tek seferde kenardaki peek durumuna döner.
 */
const LOVE_REACTION_DURATION = 1700;
/**
 * Ard arda çok hızlı çift dokunmalarda üst üste animasyon, zamanlayıcı veya
 * partikül oluşmasını engelleyen yerel bekleme.
 */
const LOVE_COOLDOWN = 1500;
/** Kalpler tepkiden biraz önce sönerek kaybolur. */
const LOVE_PARTICLE_LIFETIME = 1400;

/** Küçük sevinme: iki zıplama, toplam 560 ms. */
const SET_REACTION_DURATION = 560;
/** Büyük kutlama: üç zıplama, toplam 1220 ms. */
const WORKOUT_REACTION_DURATION = 1220;
/** Reduce Motion açıkken tepkiler kısa bir opacity/scale değişimine iner. */
const REDUCED_REACTION_DURATION = 420;
/** Parçacıklar kutlamadan biraz sonra sönerek kaybolur. */
const PARTICLE_LIFETIME = 1400;

/** Düşünme: yavaş sağ-sol eğilme, tam döngü ≈ 1400 ms. */
const THINKING_TILT_DEGREES = 2.5;
const THINKING_HALF_CYCLE = 700;

const SPRING = { damping: 18, mass: 0.9, stiffness: 170 };

/**
 * Köşede iki kenara uzaklık neredeyse eşitken kenarın sürekli değişmemesi için
 * mevcut kenara verilen avantaj. Titremeyi (edge flapping) önler.
 */
const EDGE_HYSTERESIS = 16;

/** `app/program/[id]/day/[dayId]/index.tsx` — aktif antrenman ekranı. */
const ACTIVE_WORKOUT_PATTERN = /^\/program\/[^/]+\/day\/[^/]+$/;
/**
 * Alt sekme çubuğu yalnızca `(tabs)` route'larında görünür. Kök Stack'e
 * push edilen ekranlar (program, gün, egzersiz ekleme, ayarlar) sekmeleri
 * tamamen kaplar; oralarda alt yüzey cihazın güvenli alt sınırıdır.
 */
const ROOT_STACK_PATTERN = /^\/(program|settings)(\/|$)/;

type Bounds = { maxX: number; maxY: number; minX: number; minY: number };

type BubbleVariant = 'tap' | 'celebration' | 'love';

/** `runId` sayesinde aynı tür tepki tekrarlansa bile süre efekti yeniden kurulur. */
type ActiveReaction = { runId: number; type: MascotReactionType };

/** Kenar + oran → konteyner içindeki kutu koordinatı. */
function resolveEdgePosition(edge: MascotEdge, edgeRatio: number, bounds: Bounds) {
  const ratio = clampEdgeRatio(edgeRatio);

  if (isVerticalEdge(edge)) {
    return {
      x: edge === 'left' ? bounds.minX : bounds.maxX,
      y: bounds.minY + ratio * Math.max(0, bounds.maxY - bounds.minY),
    };
  }

  return {
    x: bounds.minX + ratio * Math.max(0, bounds.maxX - bounds.minX),
    y: edge === 'top' ? bounds.minY : bounds.maxY,
  };
}

/** Kenara göre peek vektörü (birim yön). */
function edgeVector(edge: MascotEdge) {
  'worklet';
  if (edge === 'left') return { x: -1, y: 0 };
  if (edge === 'right') return { x: 1, y: 0 };
  if (edge === 'top') return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

/**
 * Hedef açıyı mevcut açıya **en yakın** eşdeğerine taşır. Böylece örneğin
 * sağ kenardan (−90°) üst kenara (180°) geçerken 270° tam tur atılmaz,
 * 90° kısa yol kullanılır. Deterministiktir.
 */
function nearestAngle(current: number, target: number) {
  let delta = (target - current) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return current + delta;
}

/**
 * Ekranda yaşayan maskot.
 *
 * Ağ isteği, AI çağrısı veya Supabase sorgusu yapmaz; kullanıcı mesajlarını ve
 * antrenman verisini okumaz. Dış kapsayıcı `box-none` olduğu için yalnızca
 * karakterin ve açık balonun kendi alanı dokunma yakalar.
 */
export function FloatingMascot() {
  const { enabled, isReady, isThinking, position, reaction, savePosition } = useMascot();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [state, setState] = useState<MascotState>('idle');
  /** Açık balonun türü. Kutlama balonu normal balonu devralır. */
  const [bubbleVariant, setBubbleVariant] = useState<BubbleVariant>();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  /**
   * Oynamakta olan tek seferlik tepki. `runId` her oynatmada artar; süre
   * efekti buna bağlı olduğu için aynı tür tekrar oynatılsa bile eski
   * zamanlayıcı temizlenip yenisi tam süreyle başlar.
   */
  const [activeReaction, setActiveReaction] = useState<ActiveReaction>();
  /** Öncelik ve tap kontrolü için senkron okuma. */
  const activeReactionRef = useRef<ActiveReaction>(undefined);
  const reactionRunRef = useRef(0);
  /**
   * Sürükleme en yüksek önceliktir. React state'i asenkron olduğu için
   * gelen olaylar bu senkron bayrağa göre düşürülür.
   */
  const isDraggingRef = useRef(false);
  /** 0 = parçacık yok. Her kutlama yeni bir kimlik alır, böylece yeniden başlar. */
  const [particleRun, setParticleRun] = useState(0);
  const particleRunRef = useRef(0);
  /** Aynı mantık kalpler için; kutlama partikülleriyle karışmaz. */
  const [loveRun, setLoveRun] = useState(0);
  const loveRunRef = useRef(0);
  /** Son sevme tepkisinin zamanı; cooldown bunun üzerinden ölçülür. */
  const loveCooldownRef = useRef(0);
  // AI durumu ref'te de tutulur: sürükleme/tepki bittiğinde hangi duruma
  // dönüleceğine stale closure olmadan karar verilir.
  const isThinkingRef = useRef(isThinking);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    activeReactionRef.current = activeReaction;
  }, [activeReaction]);

  const isCompact = ACTIVE_WORKOUT_PATTERN.test(pathname ?? '');
  const mascotSize = isCompact ? COMPACT_MASCOT_SIZE : MASCOT_SIZE;

  /**
   * Sekme çubuğu bu route'ta görünüyor mu? Alt kenarın "yüzeyi" buna göre
   * değişir: sekme çubuğunun üstü veya cihazın güvenli alt sınırı.
   */
  const hasTabBar = !ROOT_STACK_PATTERN.test(pathname ?? '');
  const bottomReserve = (hasTabBar ? Layout.tabBarHeight : 0) + insets.bottom;

  /**
   * Sunum konteyneri. Maskot bunun **içinde** yaşar ve `overflow: 'hidden'`
   * ile buranın sınırında kırpılır.
   *
   * Bu, alt kenar için zorunlu: `FloatingMascot` navigasyonun üstünde bir
   * overlay olarak çizildiği için gövdeyi gerçekten sekme çubuğunun arkasına
   * çizmek mümkün değil (z-sırası buna izin vermiyor). Konteynerin alt sınırı
   * sekme çubuğunun üst çizgisinde bittiği için gövde tam o çizgide kırpılır
   * ve "yüzeyin arkasından bakma" görüntüsü sekme butonlarının üstüne hiç
   * çizim yapmadan elde edilir.
   *
   * Aynı sınır dokunmayı da çözer: konteynerin kendi çerçevesi orada bittiği
   * için sekme çubuğu üzerindeki dokunuşlar maskota hiç ulaşmaz.
   */
  const container = useMemo(
    () => ({
      top: insets.top,
      left: insets.left,
      right: insets.right,
      bottom: bottomReserve,
      innerWidth: Math.max(0, width - insets.left - insets.right),
      innerHeight: Math.max(0, height - insets.top - bottomReserve),
    }),
    [bottomReserve, height, insets.left, insets.right, insets.top, width],
  );

  /** Kutu koordinatları konteynere görelidir. */
  const bounds = useMemo<Bounds>(
    () => ({
      minX: EDGE_MARGIN,
      minY: EDGE_MARGIN,
      maxX: Math.max(EDGE_MARGIN, container.innerWidth - EDGE_MARGIN - TOUCH_SIZE),
      maxY: Math.max(EDGE_MARGIN, container.innerHeight - EDGE_MARGIN - TOUCH_SIZE),
    }),
    [container.innerHeight, container.innerWidth],
  );

  // Kalıcı konum katmanı — kaydedilen konum yalnızca burada tutulur.
  const positionX = useSharedValue(0);
  const positionY = useSharedValue(0);
  /**
   * Kenardan bakma katmanı. **İşaretli** vektör tutar (0,0 = tamamen görünür).
   *
   * İşaretin değerin kendisinde taşınması bilinçli: yön her karede konumdan
   * türetilseydi maskot orta çizgiyi veya köşeyi geçtiği anda işaret ters
   * döner ve offset henüz sıfırlanmamışsa parmağın altında sıçrama olurdu.
   * Animasyonlar her zaman mevcut değerden hedefe geçtiği için bu vektör
   * hiçbir koşulda süreksizlik yaşamaz.
   *
   * `positionX/Y` içine yazılmaz ve AsyncStorage'a gitmez.
   */
  const peekOffsetX = useSharedValue(0);
  const peekOffsetY = useSharedValue(0);
  /**
   * Kenar yönü katmanı — yalnızca peek duruşunun temel açısı. Tepki katmanının
   * `reactionRotation` değerinden ayrıdır, böylece set/kutlama dönüşleriyle
   * birbirlerini ezmezler.
   */
  const edgeRotation = useSharedValue(0);
  /** 0 = normal peek, 1 = boşta biraz daha görünür. Kalıcı konuma yazılmaz. */
  const ambientPeekProgress = useSharedValue(0);
  // İfade katmanı (sürekli düşünme eğilimi) — temel açının üzerine eklenir.
  const thinkingProgress = useSharedValue(0);
  // Tepki katmanı (tap/set/kutlama).
  const reactionY = useSharedValue(0);
  const reactionScale = useSharedValue(1);
  const reactionRotation = useSharedValue(0);
  const reactionOpacity = useSharedValue(1);

  const gestureStartX = useSharedValue(0);
  const gestureStartY = useSharedValue(0);
  /**
   * Pan gerçekten ACTIVE hâle geldi mi? UI thread'de tutulur. `.onEnd`
   * çalışmadan iptal edilen sürüklemeyi `.onFinalize` içinde ayırt etmek ve
   * pan hiç etkinleşmeden tap kazandığında temizlik yapmamak için gerekir.
   */
  const isPanActive = useSharedValue(false);

  // Kayıtlı konum ref'te tutulur: sürükleme sonrası state güncellemesi
  // yeniden yerleştirme efektini tetiklemesin, maskot zıplamasın.
  const positionRef = useRef(position);
  const hasPositionedRef = useRef(false);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    if (!isReady) return;

    const target = positionRef.current;
    const { x, y } = resolveEdgePosition(target.edge, target.edgeRatio, bounds);

    if (hasPositionedRef.current) {
      // Ekran boyutu / güvenli alan / sekme çubuğu değişti: kayıtlı oran
      // yeniden hesaplanıp yeni güvenli sınırların içine yaylanarak taşınır.
      positionX.value = withSpring(x, SPRING);
      positionY.value = withSpring(y, SPRING);
      return;
    }

    // İlk yerleşim animasyonsuzdur; maskot ekranda kayarak doğmaz.
    positionX.value = x;
    positionY.value = y;
    hasPositionedRef.current = true;
  }, [bounds, isReady, positionX, positionY]);

  const isHidden = !enabled || !isReady || isKeyboardVisible;

  // Klavye açıkken maskot ve balon geçici olarak gizlenir; bu `enabled`
  // tercihini değiştirmez.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setIsKeyboardVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Açık varyant ref'te de tutulur: tap handler'ı state updater içinde yan etki
  // üretmeden mevcut değeri okur ve kimliği sabit kalır.
  const bubbleVariantRef = useRef<BubbleVariant>(undefined);

  const clearBubbleTimer = useCallback(() => {
    if (bubbleTimerRef.current) {
      clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = undefined;
    }
  }, []);

  /** Balonu açar/kapatır. Kutlama balonu açık normal balonu devralır. */
  const showBubble = useCallback(
    (variant: BubbleVariant | undefined) => {
      clearBubbleTimer();
      bubbleVariantRef.current = variant;
      setBubbleVariant(variant);

      if (!variant) return;

      const timeout =
        variant === 'celebration'
          ? CELEBRATION_BUBBLE_TIMEOUT
          : variant === 'love'
            ? LOVE_REACTION_DURATION
            : BUBBLE_TIMEOUT;
      bubbleTimerRef.current = setTimeout(() => {
        bubbleVariantRef.current = undefined;
        setBubbleVariant(undefined);
      }, timeout);
    },
    [clearBubbleTimer],
  );

  useEffect(() => clearBubbleTimer, [clearBubbleTimer]);

  useEffect(() => {
    // Gizlenirken açık balon kapatılır.
    if (isHidden) showBubble(undefined);
  }, [isHidden, showBubble]);

  // Balon kapandığında "happy" durumu sona erer. AI hâlâ yazıyorsa düşünme
  // durumuna dönülür, aksi hâlde boşta durumuna.
  useEffect(() => {
    if (bubbleVariant) return;
    // Aktif bir tepki sürerken balonun kapanması durumu sıfırlamamalı: örneğin
    // `set-complete`, `loved` tepkisini devralırken sevme balonunu kapatır ve
    // bu efekt yeni tepkinin 'happy' durumunu yanlışlıkla 'idle' yapardı.
    // Tepki kendi bitiş efektinde zaten doğru duruma dönüyor.
    if (activeReactionRef.current) return;
    setState((current) =>
      current === 'happy' ? (isThinkingRef.current ? 'thinking' : 'idle') : current,
    );
  }, [bubbleVariant]);

  /**
   * Karakterin baş-kuyruk ekseni boyunca kenarın dışına kaydırılacağı mesafe.
   * Kutunun kenarı ile konteyner sınırı arasındaki boşluk + gizlenecek uzunluk.
   */
  const peekDistance = useMemo(() => {
    const axisLength = mascotSize / MASCOT_ASPECT;
    const gapToBoundary = EDGE_MARGIN + (TOUCH_SIZE - axisLength) / 2;
    const visible = Math.max(PEEK_MIN_VISIBLE, axisLength * PEEK_VISIBLE_FRACTION);
    return gapToBoundary + Math.max(0, axisLength - visible);
  }, [mascotSize]);

  /**
   * Sunum hedefi tek kaynaktan türetilir; peek/full için ayrı boolean state
   * tutulmaz. Tamamen görünür durumlarda maskot dik (0°) durur, çünkü zıplama
   * ve kutlama hareketleri yalnızca dik duruşta doğru okunur.
   */
  const isFullyVisible =
    state === 'dragging' || Boolean(activeReaction) || Boolean(bubbleVariant);

  /**
   * Yalnızca gerçekten boşta ve kısmen gizliyken ambient peek oynar. Her yeni
   * tur için farklı bekleme süresi seçilir; düzenli bir metronom hissi vermez.
   */
  useEffect(() => {
    cancelAnimation(ambientPeekProgress);
    ambientPeekProgress.value = 0;

    const canPlay =
      !isHidden &&
      !isFullyVisible &&
      !isThinking &&
      !reduceMotion &&
      state === 'idle';

    if (!canPlay) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNextPeek = () => {
      const delay = AMBIENT_PEEK_MIN_DELAY + Math.random() * AMBIENT_PEEK_DELAY_RANGE;
      timer = setTimeout(() => {
        ambientPeekProgress.value = withSequence(
          withTiming(1, {
            duration: AMBIENT_PEEK_IN_DURATION,
            easing: Easing.out(Easing.quad),
          }),
          withDelay(
            AMBIENT_PEEK_HOLD_DURATION,
            withTiming(0, {
              duration: AMBIENT_PEEK_OUT_DURATION,
              easing: Easing.inOut(Easing.quad),
            }),
          ),
        );
        scheduleNextPeek();
      }, delay);
    };

    scheduleNextPeek();

    return () => {
      if (timer) clearTimeout(timer);
      cancelAnimation(ambientPeekProgress);
      ambientPeekProgress.value = 0;
    };
  }, [ambientPeekProgress, isFullyVisible, isHidden, isThinking, reduceMotion, state]);

  const peekMagnitude = useMemo(() => {
    if (isFullyVisible) return 0;
    return isThinking ? peekDistance * THINKING_PEEK_FACTOR : peekDistance;
  }, [isFullyVisible, isThinking, peekDistance]);

  /**
   * Peek yönü. Sürükleme boyunca sabit kalır; yalnızca iki güvenli noktada
   * güncellenir: kayıtlı kenar değiştiğinde ve sürükleme bittiğinde yeni kenar
   * kesinleştiğinde.
   */
  const peekEdgeRef = useRef<MascotEdge>(position.edge);
  /**
   * Aynı kenarın UI thread kopyası. `settleToEdge` bir worklet olduğu için
   * JS ref'ini okuyamaz (ref closure'a snapshot olarak yakalanır); hysteresis
   * kararının güncel kenarı görmesi buna bağlıdır.
   */
  const peekEdgeShared = useSharedValue<MascotEdge>(position.edge);

  useEffect(() => {
    if (isDraggingRef.current) return;
    peekEdgeRef.current = position.edge;
    peekEdgeShared.value = position.edge;
  }, [peekEdgeShared, position.edge]);

  /** İlk yerleşim animasyonsuz olmalı: maskot tam görünür doğup kenara kaymaz. */
  const hasPeekInitRef = useRef(false);

  useEffect(() => {
    if (!isReady) return;

    const edge = peekEdgeRef.current;
    const vector = edgeVector(edge);
    const targetX = vector.x * peekMagnitude;
    const targetY = vector.y * peekMagnitude;
    // Tamamen görünürken dik dur; aksi hâlde bulunduğu kenarın temel açısı.
    const rawRotation = isFullyVisible ? 0 : MASCOT_EDGE_ROTATION[edge];
    const targetRotation = nearestAngle(edgeRotation.value, rawRotation);

    if (!hasPeekInitRef.current) {
      peekOffsetX.value = targetX;
      peekOffsetY.value = targetY;
      edgeRotation.value = rawRotation;
      hasPeekInitRef.current = true;
      return;
    }

    if (reduceMotion) {
      peekOffsetX.value = withTiming(targetX, { duration: REDUCED_PEEK_DURATION });
      peekOffsetY.value = withTiming(targetY, { duration: REDUCED_PEEK_DURATION });
      edgeRotation.value = withTiming(targetRotation, { duration: REDUCED_PEEK_DURATION });
      return;
    }

    peekOffsetX.value = withSpring(targetX, PEEK_SPRING);
    peekOffsetY.value = withSpring(targetY, PEEK_SPRING);
    edgeRotation.value = withSpring(targetRotation, PEEK_SPRING);
    // `position.edge` bağımlılığı, kayıtlı kenar değiştiğinde hedefin yeni
    // yönle yeniden hesaplanmasını sağlar.
  }, [
    edgeRotation,
    isFullyVisible,
    isReady,
    peekMagnitude,
    peekOffsetX,
    peekOffsetY,
    position.edge,
    reduceMotion,
  ]);

  // Unmount olurken süren tüm animasyonlar durdurulur.
  useEffect(
    () => () => {
      cancelAnimation(positionX);
      cancelAnimation(positionY);
      cancelAnimation(peekOffsetX);
      cancelAnimation(peekOffsetY);
      cancelAnimation(edgeRotation);
      cancelAnimation(ambientPeekProgress);
      cancelAnimation(thinkingProgress);
      cancelAnimation(reactionY);
      cancelAnimation(reactionScale);
      cancelAnimation(reactionRotation);
      cancelAnimation(reactionOpacity);
    },
    [
      ambientPeekProgress,
      edgeRotation,
      peekOffsetX,
      peekOffsetY,
      positionX,
      positionY,
      reactionOpacity,
      reactionRotation,
      reactionScale,
      reactionY,
      thinkingProgress,
    ],
  );

  /**
   * Süren tek seferlik tepkiyi tamamen sonlandırır: animasyonlar iptal edilir,
   * değerler normale döner, partikül ve kutlama balonu kaldırılır.
   *
   * `resetScale` sürükleme yolunda `false` gelir: o sırada `reactionScale`
   * sürükleme ölçeğine (%5) aittir ve ezilmemelidir.
   */
  const cancelActiveReaction = useCallback(
    ({ resetScale }: { resetScale: boolean }) => {
      cancelAnimation(reactionY);
      cancelAnimation(reactionRotation);
      cancelAnimation(reactionOpacity);
      reactionY.value = 0;
      reactionRotation.value = 0;
      reactionOpacity.value = 1;

      if (resetScale) {
        cancelAnimation(reactionScale);
        reactionScale.value = 1;
      }

      activeReactionRef.current = undefined;
      setActiveReaction(undefined);
      setParticleRun(0);
      setLoveRun(0);
    },
    [reactionOpacity, reactionRotation, reactionScale, reactionY],
  );

  const handleDragStart = useCallback(() => {
    // Sürükleme en yüksek önceliktir: süren kutlama/tepki tamamen sonlandırılır.
    isDraggingRef.current = true;
    setState('dragging');
    // Kutlama balonu dahil açık balon kapanır.
    showBubble(undefined);
    // reactionScale sürükleme ölçeğine ait olduğu için burada sıfırlanmaz.
    cancelActiveReaction({ resetScale: false });
  }, [cancelActiveReaction, showBubble]);

  /** AsyncStorage'a yalnızca sürükleme bittiğinde yazılır, her frame'de değil. */
  const handleDragEnd = useCallback(
    (edge: MascotEdge, edgeRatio: number) => {
      isDraggingRef.current = false;
      // Kenar, yeni değeri kesinleştiği anda ve `setState`'ten ÖNCE güncellenir:
      // aşağıdaki setState peek efektini tetiklediğinde hedef doğrudan yeni
      // kenara göre hesaplanır, önce eski kenara doğru yanlış bir animasyon
      // başlayıp sonra düzeltilmez. Normal `onEnd` ve iptal yolundaki
      // `onFinalize` aynı `settleToEdge` → `handleDragEnd` akışını kullandığı
      // için ikisi de aynı sonucu verir.
      peekEdgeRef.current = edge;
      peekEdgeShared.value = edge;
      // Sürükleme bitince AI hâlâ yazıyorsa düşünme durumuna dönülür.
      setState(isThinkingRef.current ? 'thinking' : 'idle');
      void savePosition({ edge, edgeRatio });
    },
    [peekEdgeShared, savePosition],
  );

  const handleTap = useCallback(() => {
    // Aktif bir set/kutlama tepkisi varken dokunma tamamen yok sayılır:
    // haptic üretmez, balonu değiştirmez, tepki shared value'larına dokunmaz.
    if (activeReactionRef.current) return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

    if (!reduceMotion) {
      reactionScale.value = withSequence(
        withTiming(1.08, { duration: 110, easing: Easing.out(Easing.quad) }),
        withSpring(1, SPRING),
      );
      reactionY.value = withSequence(
        withTiming(TAP_LIFT, { duration: 140, easing: Easing.out(Easing.quad) }),
        withSpring(0, SPRING),
      );
    }

    setState('happy');
    // Tekrar dokunulunca açılıp kapanır. Kutlama balonu açıksa normal
    // balona geçilmez; kutlama mesajı kendi süresini tamamlar.
    showBubble(bubbleVariantRef.current ? undefined : 'tap');
  }, [reactionScale, reactionY, reduceMotion, showBubble]);

  /**
   * Tek seferlik tepkiyi oynatır. Tepki katmanı `translateY`, `scale` ve
   * `rotation`'ı yalnızca burada sürer; konum, peek ve kenar yönü katmanlarına
   * dokunmaz, bu yüzden maskotun kayıtlı konumu değişmez.
   */
  const playReaction = useCallback(
    (type: MascotReactionType) => {
      cancelAnimation(reactionY);
      cancelAnimation(reactionScale);
      cancelAnimation(reactionRotation);
      cancelAnimation(reactionOpacity);

      /**
       * Devralınan `loved` tepkisinin sunumu anında temizlenir. Aksi hâlde
       * kalpler ve sevme balonu yeni tepkinin altında görünmeye devam eder;
       * `workout-complete` durumunda kalpler kutlama partikülleriyle üst üste
       * biner.
       *
       * `loveRunRef` bir kimlik sayacıdır, sıfırlanmaz — yalnızca görünürlük
       * state'i kapatılır.
       */
      const previous = activeReactionRef.current;
      if (previous?.type === 'loved' && type !== 'loved') {
        setLoveRun(0);
        // `workout-complete` aşağıda kendi balonunu açıp devraldığı için
        // burada ayrıca kapatılmasına gerek yok; `set-complete` ise hiç balon
        // açmadığından sevme balonu burada kapatılmalı.
        if (type !== 'workout-complete' && bubbleVariantRef.current === 'love') {
          showBubble(undefined);
        }
      }

      // Her oynatma yeni bir runId alır: süre efekti yeniden kurulur ve
      // devralınan tepkinin eski zamanlayıcısı cleanup ile silinir.
      reactionRunRef.current += 1;
      const next: ActiveReaction = { runId: reactionRunRef.current, type };
      activeReactionRef.current = next;
      setActiveReaction(next);
      setState(type === 'workout-complete' ? 'celebrating' : 'happy');

      if (type === 'workout-complete') {
        // Kutlama açık normal balonu devralır.
        showBubble('celebration');
        particleRunRef.current += 1;
        setParticleRun(particleRunRef.current);
      } else if (type === 'loved') {
        // Kısa, CTA'sız sevme balonu + kalpler.
        showBubble('love');
        loveRunRef.current += 1;
        setLoveRun(loveRunRef.current);
      }

      if (reduceMotion) {
        // Reduce Motion: yoğun zıplama/dönüş yerine kısa opacity + scale nabzı.
        const peak = type === 'workout-complete' ? 1.08 : 1.04;
        reactionScale.value = withSequence(
          withTiming(peak, { duration: REDUCED_REACTION_DURATION / 2 }),
          withTiming(1, { duration: REDUCED_REACTION_DURATION / 2 }),
        );
        reactionOpacity.value = withSequence(
          withTiming(0.72, { duration: REDUCED_REACTION_DURATION / 2 }),
          withTiming(1, { duration: REDUCED_REACTION_DURATION / 2 }),
        );
        return;
      }

      if (type === 'loved') {
        // Küçük, doğal bir sevinme: iki yumuşak zıplama ve çok hafif eğilme.
        reactionY.value = withSequence(
          withTiming(-8, { duration: 150, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }),
          withTiming(-5, { duration: 140, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }),
        );
        reactionScale.value = withSequence(
          withTiming(1.08, { duration: 150 }),
          withTiming(1, { duration: 160 }),
          withTiming(1.04, { duration: 140 }),
          withTiming(1, { duration: 160 }),
        );
        reactionRotation.value = withSequence(
          withTiming(-3, { duration: 150 }),
          withTiming(3, { duration: 160 }),
          withTiming(-2, { duration: 140 }),
          withTiming(0, { duration: 160 }),
        );
        return;
      }

      if (type === 'set-complete') {
        // İki küçük zıplama (7 px ve 6 px), en fazla %7 büyüme, hafif eğilme.
        reactionY.value = withSequence(
          withTiming(-7, { duration: 140, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 140, easing: Easing.in(Easing.quad) }),
          withTiming(-6, { duration: 130, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 150, easing: Easing.in(Easing.quad) }),
        );
        reactionScale.value = withSequence(
          withTiming(1.07, { duration: 140 }),
          withTiming(1, { duration: 140 }),
          withTiming(1.05, { duration: 130 }),
          withTiming(1, { duration: 150 }),
        );
        reactionRotation.value = withSequence(
          withTiming(-4, { duration: 140 }),
          withTiming(4, { duration: 140 }),
          withTiming(-3, { duration: 130 }),
          withTiming(0, { duration: 150 }),
        );
        return;
      }

      // Büyük kutlama: üç belirgin zıplama, %14 büyüme, hafif sağ-sol dönüş.
      reactionY.value = withSequence(
        withTiming(-14, { duration: 210, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 210, easing: Easing.in(Easing.quad) }),
        withTiming(-11, { duration: 200, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) }),
        withTiming(-8, { duration: 190, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 210, easing: Easing.in(Easing.quad) }),
      );
      reactionScale.value = withSequence(
        withTiming(1.14, { duration: 210 }),
        withTiming(1, { duration: 210 }),
        withTiming(1.1, { duration: 200 }),
        withTiming(1, { duration: 200 }),
        withTiming(1.06, { duration: 190 }),
        withTiming(1, { duration: 210 }),
      );
      reactionRotation.value = withSequence(
        withTiming(-6, { duration: 210 }),
        withTiming(6, { duration: 210 }),
        withTiming(-5, { duration: 200 }),
        withTiming(5, { duration: 200 }),
        withTiming(-3, { duration: 190 }),
        withTiming(0, { duration: 210 }),
      );
    },
    [reactionOpacity, reactionRotation, reactionScale, reactionY, reduceMotion, showBubble],
  );

  /**
   * Çift dokunma = "sevme". Tek dokunma ve sürükleme davranışına dokunmaz.
   *
   * Üç guard sırayla uygulanır:
   *  1. Sürükleme sırasında hiç çalışmaz (pan en yüksek önceliktir).
   *  2. Süren bir tepki varsa hiç çalışmaz — özellikle workout-complete
   *     kutlaması bölünmez. (`loved` zaten en düşük öncelikli olduğu için
   *     tepki tüketen efekt de bunu ayrıca engeller.)
   *  3. Cooldown: ard arda çok hızlı çift dokunmalar üst üste animasyon,
   *     zamanlayıcı veya partikül üretmez.
   */
  const handleDoubleTap = useCallback(() => {
    if (isDraggingRef.current) return;
    if (activeReactionRef.current) return;

    const now = Date.now();
    if (now - loveCooldownRef.current < LOVE_COOLDOWN) return;
    loveCooldownRef.current = now;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    playReaction('loved');
  }, [playReaction]);

  // Aynı tepki React yeniden render olduğunda tekrar oynatılmaz: artan kimlik
  // bir kez tüketilir. Maskot görünmüyorsa olay düşürülür, kuyrukta beklemez.
  const lastReactionIdRef = useRef(0);

  useEffect(() => {
    if (!reaction || reaction.id === lastReactionIdRef.current) return;
    lastReactionIdRef.current = reaction.id;

    // Maskot görünmüyorsa olay düşürülür; sonradan oynamak üzere beklemez.
    if (isHidden) return;

    // Sürükleme en yüksek önceliktir: o sırada gelen olay düşürülür,
    // sonradan oynatılmak üzere kuyruğa alınmaz.
    if (isDraggingRef.current) return;

    // Yalnızca DAHA YÜKSEK öncelikli bir olay süren tepkiyi devralabilir.
    // Eşit öncelik de düşürülür; böylece kutlama sürerken ikinci bir
    // animasyon/balon/partikül oluşmaz.
    const current = activeReactionRef.current;
    if (current && MASCOT_REACTION_PRIORITY[reaction.type] <= MASCOT_REACTION_PRIORITY[current.type]) {
      return;
    }

    playReaction(reaction.type);
  }, [isHidden, playReaction, reaction]);

  // Tepki bitince değerler kesin olarak normale döner; AI hâlâ yazıyorsa
  // düşünme durumuna geri dönülür.
  useEffect(() => {
    if (!activeReaction) return;

    // Sevme tepkisi Reduce Motion'da da aynı süreyi kullanır: hareket kısalır
    // ama maskotun "sevildim" hâlinde kalma süresi tutarlı olur.
    const duration =
      activeReaction.type === 'loved'
        ? LOVE_REACTION_DURATION
        : reduceMotion
          ? REDUCED_REACTION_DURATION
          : activeReaction.type === 'workout-complete'
            ? WORKOUT_REACTION_DURATION
            : SET_REACTION_DURATION;

    const timer = setTimeout(() => {
      reactionY.value = 0;
      reactionScale.value = 1;
      reactionRotation.value = 0;
      reactionOpacity.value = 1;
      activeReactionRef.current = undefined;
      setActiveReaction(undefined);
      setState(isThinkingRef.current ? 'thinking' : 'idle');
    }, duration);

    return () => clearTimeout(timer);
  }, [activeReaction, reactionOpacity, reactionRotation, reactionScale, reactionY, reduceMotion]);

  // Parçacıklar kısa ömürlüdür; süre dolunca bileşen unmount edilir ve
  // içindeki animasyonlar da temizlenir.
  useEffect(() => {
    if (!particleRun) return;

    const timer = setTimeout(() => setParticleRun(0), PARTICLE_LIFETIME);
    return () => clearTimeout(timer);
  }, [particleRun]);

  // Kalpler de kısa ömürlüdür; süre dolunca bileşen unmount edilir.
  useEffect(() => {
    if (!loveRun) return;

    const timer = setTimeout(() => setLoveRun(0), LOVE_PARTICLE_LIFETIME);
    return () => clearTimeout(timer);
  }, [loveRun]);

  // Maskot gizlenirse/kapatılırsa süren kutlama da temizlenir.
  useEffect(() => {
    if (!isHidden) return;
    cancelActiveReaction({ resetScale: true });
  }, [cancelActiveReaction, isHidden]);

  // Görsel durum: sürükleme ve tek seferlik tepkiler daha yüksek öncelikli
  // olduğu için onların durumu ezilmez.
  useEffect(() => {
    setState((current) =>
      current === 'dragging' || current === 'celebrating' || current === 'happy'
        ? current
        : isThinking
          ? 'thinking'
          : 'idle',
    );
  }, [isThinking]);

  /**
   * Düşünme: yavaş sağ-sol eğilme. Öncelik sırası gereği sürükleme veya tek
   * seferlik bir tepki varken durur; onlar bitince AI hâlâ yazıyorsa devam eder.
   * Kenarın temel açısının **üzerine** ayrı katmanda eklenir.
   */
  useEffect(() => {
    const shouldThink =
      isThinking && !isHidden && !reduceMotion && !activeReaction && state !== 'dragging';

    if (!shouldThink) {
      cancelAnimation(thinkingProgress);
      thinkingProgress.value = withTiming(0, { duration: 200 });
      return;
    }

    thinkingProgress.value = 0;
    thinkingProgress.value = withRepeat(
      withTiming(1, { duration: THINKING_HALF_CYCLE, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );

    return () => cancelAnimation(thinkingProgress);
  }, [activeReaction, isHidden, isThinking, reduceMotion, state, thinkingProgress]);

  const gesture = useMemo(() => {
    /**
     * Sürüklemenin bitiş temizliği. Normal `.onEnd` ve iptal yolundaki
     * `.onFinalize` aynı davranışı paylaşsın diye tek yerde tutulur:
     * en yakın **dört** kenardan birine yerleş, ölçeği normale döndür,
     * konumu bir kez kaydet.
     */
    const settleToEdge = () => {
      'worklet';
      const centerX = positionX.value + TOUCH_SIZE / 2;
      const centerY = positionY.value + TOUCH_SIZE / 2;
      const spanX = bounds.maxX - bounds.minX;
      const spanY = bounds.maxY - bounds.minY;

      // Merkezin dört sınıra uzaklığı.
      let bestEdge: MascotEdge = 'right';
      let bestDistance = Infinity;
      const distances: { edge: MascotEdge; distance: number }[] = [
        { edge: 'left', distance: centerX - bounds.minX },
        { edge: 'right', distance: bounds.maxX + TOUCH_SIZE - centerX },
        { edge: 'top', distance: centerY - bounds.minY },
        { edge: 'bottom', distance: bounds.maxY + TOUCH_SIZE - centerY },
      ];

      for (let i = 0; i < distances.length; i += 1) {
        // Hysteresis: mevcut kenar küçük bir avantajla korunur, böylece
        // köşede uzaklıklar neredeyse eşitken kenar sürekli değişip titremez.
        const bias = distances[i].edge === peekEdgeShared.value ? EDGE_HYSTERESIS : 0;
        const effective = distances[i].distance - bias;
        if (effective < bestDistance) {
          bestDistance = effective;
          bestEdge = distances[i].edge;
        }
      }

      const isVertical = bestEdge === 'left' || bestEdge === 'right';
      const rawRatio = isVertical
        ? spanY > 0
          ? (positionY.value - bounds.minY) / spanY
          : 0
        : spanX > 0
          ? (positionX.value - bounds.minX) / spanX
          : 0;
      const edgeRatio = Math.min(1, Math.max(0, rawRatio));

      const targetX = isVertical
        ? bestEdge === 'left'
          ? bounds.minX
          : bounds.maxX
        : bounds.minX + edgeRatio * spanX;
      const targetY = isVertical
        ? bounds.minY + edgeRatio * spanY
        : bestEdge === 'top'
          ? bounds.minY
          : bounds.maxY;

      positionX.value = withSpring(targetX, SPRING);
      positionY.value = withSpring(targetY, SPRING);
      reactionScale.value = withSpring(1, SPRING);
      runOnJS(handleDragEnd)(bestEdge, edgeRatio);
    };

    const pan = Gesture.Pan()
      // Küçük dokunuşlar sürükleme sayılmaz, tap'e yol verir.
      .minDistance(DRAG_MIN_DISTANCE)
      .onStart(() => {
        isPanActive.value = true;
        gestureStartX.value = positionX.value;
        gestureStartY.value = positionY.value;
        reactionScale.value = withSpring(DRAG_SCALE, SPRING);
        runOnJS(handleDragStart)();
      })
      .onUpdate((event) => {
        // Sürükleme UI thread üzerinde; güvenli sınırların dışına çıkamaz.
        const nextX = gestureStartX.value + event.translationX;
        const nextY = gestureStartY.value + event.translationY;
        positionX.value = Math.min(bounds.maxX, Math.max(bounds.minX, nextX));
        positionY.value = Math.min(bounds.maxY, Math.max(bounds.minY, nextY));
      })
      .onEnd(() => {
        // Bayrak önce düşürülür: `.onFinalize` bunu görüp ikinci kez
        // temizlik yapmaz, `handleDragEnd` yalnızca bir kez çalışır.
        isPanActive.value = false;
        settleToEdge();
      })
      .onFinalize(() => {
        // Buraya iki şekilde gelinir:
        //  1) `.onEnd` çalıştı → bayrak zaten false, hiçbir şey yapılmaz.
        //  2) Pan hiç ACTIVE olmadı (tap kazandı) → bayrak hiç true olmadı,
        //     dolayısıyla konum kaydedilmez ve tap davranışı etkilenmez.
        // Yalnızca ACTIVE olup `.onEnd`'e ulaşamayan (iOS'un iptal ettiği)
        // sürüklemede bayrak hâlâ true'dur ve temizlik burada yapılır.
        if (!isPanActive.value) return;

        isPanActive.value = false;
        settleToEdge();
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(400)
      // İki dokunuş arasındaki en uzun bekleme; bundan uzunsa tek dokunma sayılır.
      .maxDelay(260)
      .onEnd((_event, success) => {
        if (success) runOnJS(handleDoubleTap)();
      });

    const tap = Gesture.Tap()
      .maxDuration(400)
      .onEnd((_event, success) => {
        if (success) runOnJS(handleTap)();
      });

    /**
     * Öncelik sırası: pan > çift dokunma > tek dokunma.
     *
     * `Gesture.Exclusive` sonraki gesture'ı öncekinin başarısız olmasını
     * bekletir:
     *  - Pan etkinleşirse hiçbir tap çalışmaz → sürükleme sonrası yanlışlıkla
     *    balon açılmaz ve sevme tepkisi tetiklenmez.
     *  - Tek dokunma, çift dokunmanın başarısız olmasını bekler → çift
     *    dokunmanın ilk dokunuşu balonu açmaz.
     */
    return Gesture.Exclusive(pan, doubleTap, tap);
  }, [
    bounds,
    gestureStartX,
    gestureStartY,
    handleDragEnd,
    handleDoubleTap,
    handleDragStart,
    handleTap,
    isPanActive,
    peekEdgeShared,
    positionX,
    positionY,
    reactionScale,
  ]);

  const positionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: positionX.value }, { translateY: positionY.value }],
  }));

  /**
   * Kenardan bakma katmanı. İşaret vektörün içinde taşındığı için burada
   * hiçbir yön hesabı yapılmaz — orta çizgi veya köşe geçilse bile sıçrama
   * oluşamaz.
   */
  const peekStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          peekOffsetX.value *
          (1 - AMBIENT_PEEK_REVEAL_FRACTION * ambientPeekProgress.value),
      },
      {
        translateY:
          peekOffsetY.value *
          (1 - AMBIENT_PEEK_REVEAL_FRACTION * ambientPeekProgress.value),
      },
    ],
  }));

  /** Kenar yönü katmanı: yalnızca peek duruşunun temel açısı. */
  const edgeRotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${edgeRotation.value}deg` }],
  }));

  /** İfade katmanı: düşünme eğilimi temel açının üzerine eklenir. */
  const thinkingStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${interpolate(
          thinkingProgress.value,
          [0, 1],
          [-THINKING_TILT_DEGREES, THINKING_TILT_DEGREES],
        )}deg`,
      },
    ],
  }));

  const reactionStyle = useAnimatedStyle(() => ({
    opacity: reactionOpacity.value,
    transform: [
      { translateY: reactionY.value },
      { rotate: `${reactionRotation.value}deg` },
      { scale: reactionScale.value },
    ],
  }));

  const handleOpenCoach = useCallback(() => {
    showBubble(undefined);
    // Yalnızca ekranı açar; hiçbir AI isteği tetiklemez.
    router.navigate('/coach');
  }, [router, showBubble]);

  /**
   * Üst/alt kenarda balonun yatay kayması. Balon maskot kutusunun merkezine
   * hizalanır, ancak konteynerin içinde kalacak biçimde sıkıştırılır; böylece
   * maskot kenarın ucuna yakınken bile balon ekran dışına taşmaz.
   */
  const bubbleHorizontalOffset = useMemo(() => {
    if (isVerticalEdge(position.edge)) return 0;

    const boxX = bounds.minX + clampEdgeRatio(position.edgeRatio) * (bounds.maxX - bounds.minX);
    const centered = boxX + TOUCH_SIZE / 2 - BUBBLE_MAX_WIDTH / 2;
    const clamped = Math.min(
      Math.max(EDGE_MARGIN, container.innerWidth - BUBBLE_MAX_WIDTH - EDGE_MARGIN),
      Math.max(EDGE_MARGIN, centered),
    );
    return clamped - boxX;
  }, [bounds, container.innerWidth, position.edge, position.edgeRatio]);

  if (isHidden) return null;

  // Yalnızca normal dokunma balonunda AI Koç CTA'sı bulunur.
  const bubbleMessage =
    bubbleVariant === 'celebration'
      ? t('mascot.celebrationMessage')
      : bubbleVariant === 'love'
        ? t('mascot.lovedMessage')
        : undefined;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.clipContainer,
        {
          bottom: container.bottom,
          left: container.left,
          right: container.right,
          top: container.top,
        },
      ]}>
      <Animated.View pointerEvents="box-none" style={[styles.positionLayer, positionStyle]}>
        {bubbleVariant && (
          <MascotSpeechBubble
            edge={position.edge}
            horizontalOffset={bubbleHorizontalOffset}
            message={bubbleMessage}
            onPressCta={handleOpenCoach}
            showCta={bubbleVariant === 'tap'}
          />
        )}

        {particleRun > 0 && (
          <MascotCelebrationParticles
            key={particleRun}
            reduceMotion={reduceMotion}
            size={TOUCH_SIZE}
          />
        )}

        {loveRun > 0 && (
          <MascotLoveParticles key={loveRun} reduceMotion={reduceMotion} size={TOUCH_SIZE} />
        )}

        {/* Katmanlar:
            Kalıcı konum → Kenardan bakma → Kenar yönü → Düşünme → Tepki → Görsel.
            Her katman yalnızca kendi transform'unu sürer, hiçbiri diğerini ezmez.
            Balon ve partiküller dönüş katmanlarının dışındadır: hiç dönmezler.
            Dokunma hedefi peek katmanının içindedir, yani karakterle birlikte
            hareket eder ve gizlenen kısmı konteynerin dışında kalır. */}
        <Animated.View pointerEvents="box-none" style={[styles.peekLayer, peekStyle]}>
          <GestureDetector gesture={gesture}>
            <Animated.View
              accessible
              accessibilityHint={t('mascot.accessibilityHint')}
              accessibilityLabel={t('mascot.accessibilityLabel')}
              accessibilityRole="button"
              onAccessibilityTap={handleTap}
              style={styles.touchTarget}>
              <Animated.View style={edgeRotationStyle}>
                <Animated.View style={thinkingStyle}>
                  <Animated.View style={reactionStyle}>
                    <Image
                      accessibilityElementsHidden
                      contentFit="contain"
                      importantForAccessibility="no"
                      source={mascotSource}
                      style={{ height: mascotSize, width: mascotSize }}
                      transition={0}
                    />
                  </Animated.View>
                </Animated.View>
              </Animated.View>
            </Animated.View>
          </GestureDetector>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * Maskotun yaşadığı alan. `overflow: 'hidden'` gövdeyi konteyner sınırında
   * kırpar; konteynerin kendi çerçevesi de dokunmayı orada durdurur.
   */
  clipContainer: { overflow: 'hidden', position: 'absolute' },
  positionLayer: {
    height: TOUCH_SIZE,
    left: 0,
    position: 'absolute',
    top: 0,
    width: TOUCH_SIZE,
  },
  peekLayer: { height: TOUCH_SIZE, width: TOUCH_SIZE },
  touchTarget: {
    alignItems: 'center',
    height: TOUCH_SIZE,
    justifyContent: 'center',
    width: TOUCH_SIZE,
  },
});
