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
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MascotCelebrationParticles } from '@/components/mascot/mascot-celebration-particles';
import { MascotSpeechBubble } from '@/components/mascot/mascot-speech-bubble';
import { Layout } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useMascot } from '@/context/mascot-context';
import {
  clampVerticalRatio,
  MASCOT_REACTION_PRIORITY,
  MascotReactionType,
  MascotSide,
  MascotState,
} from '@/types/mascot';

const mascotSource = require('../../assets/images/mascot/mascot-idle.png');

/** Görünür karakter ölçüsü. Kare kutu + `contain` → oran bozulmadan sığar. */
const MASCOT_SIZE = 88;
/** Aktif antrenman ekranında set kontrollerini kapatmayan küçük mod. */
const COMPACT_MASCOT_SIZE = 64;
/**
 * Dokunma hedefi ekran değişse de sabit kalır: sınır hesabı sabit kaldığı için
 * maskot sekmeler ve program sayfaları arasında yerinden oynamaz.
 */
const TOUCH_SIZE = 100;
/** Kenarlardan bırakılan güvenli boşluk. */
const EDGE_MARGIN = 12;

const IDLE_TRAVEL = 3;
const IDLE_HALF_CYCLE = 1000; // tam döngü ≈ 2000 ms
const TAP_LIFT = -9;
const BUBBLE_TIMEOUT = 4000;
const CELEBRATION_BUBBLE_TIMEOUT = 3800;
const DRAG_SCALE = 1.05;
/** Bu mesafeden kısa hareketler sürükleme sayılmaz; tap olarak geçer. */
const DRAG_MIN_DISTANCE = 8;

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

/** `app/program/[id]/day/[dayId]/index.tsx` — aktif antrenman ekranı. */
const ACTIVE_WORKOUT_PATTERN = /^\/program\/[^/]+\/day\/[^/]+$/;

type Bounds = { maxX: number; maxY: number; minX: number; minY: number };

type BubbleVariant = 'tap' | 'celebration';

/** `runId` sayesinde aynı tür tepki tekrarlansa bile süre efekti yeniden kurulur. */
type ActiveReaction = { runId: number; type: MascotReactionType };

function resolveX(side: MascotSide, bounds: Bounds) {
  return side === 'left' ? bounds.minX : bounds.maxX;
}

function resolveY(verticalRatio: number, bounds: Bounds) {
  return bounds.minY + clampVerticalRatio(verticalRatio) * Math.max(0, bounds.maxY - bounds.minY);
}

/**
 * Ekranda yaşayan maskot (Aşama 1).
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

  // Konum katmanı
  const positionX = useSharedValue(0);
  const positionY = useSharedValue(0);
  // Idle katmanı (süzülme)
  const idleProgress = useSharedValue(0);
  // İfade katmanı (sürekli düşünme eğilimi) — yalnızca rotation'a dokunur.
  const thinkingProgress = useSharedValue(0);
  // Tepki katmanı (tap/set/kutlama) — yalnızca translateY, scale ve rotation'a dokunur.
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

  const bounds = useMemo<Bounds>(() => {
    // Alt navigasyon + home indicator alanı her ekranda korunur.
    const bottomReserve = Layout.tabBarHeight + insets.bottom;
    const minX = insets.left + EDGE_MARGIN;
    const minY = insets.top + EDGE_MARGIN;

    return {
      minX,
      minY,
      maxX: Math.max(minX, width - insets.right - EDGE_MARGIN - TOUCH_SIZE),
      maxY: Math.max(minY, height - bottomReserve - EDGE_MARGIN - TOUCH_SIZE),
    };
  }, [height, insets.bottom, insets.left, insets.right, insets.top, width]);

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
    const x = resolveX(target.side, bounds);
    const y = resolveY(target.verticalRatio, bounds);

    if (hasPositionedRef.current) {
      // Ekran boyutu / güvenli alan değişti: kayıtlı oran yeniden hesaplanıp
      // yeni güvenli sınırların içine yaylanarak taşınır.
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

      const timeout = variant === 'celebration' ? CELEBRATION_BUBBLE_TIMEOUT : BUBBLE_TIMEOUT;
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
    setState((current) =>
      current === 'happy' ? (isThinkingRef.current ? 'thinking' : 'idle') : current,
    );
  }, [bubbleVariant]);

  // Sakin süzülme. Sürükleme sırasında, Reduce Motion açıkken veya maskot
  // gizliyken çalışmaz; interval kullanılmadığı için sürekli render üretmez.
  useEffect(() => {
    if (isHidden || reduceMotion || state === 'dragging' || activeReaction) {
      cancelAnimation(idleProgress);
      idleProgress.value = withTiming(0, { duration: 180 });
      return;
    }

    idleProgress.value = 0;
    idleProgress.value = withRepeat(
      withTiming(1, { duration: IDLE_HALF_CYCLE, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );

    return () => cancelAnimation(idleProgress);
  }, [activeReaction, idleProgress, isHidden, reduceMotion, state]);

  // Unmount olurken süren tüm animasyonlar durdurulur.
  useEffect(
    () => () => {
      cancelAnimation(positionX);
      cancelAnimation(positionY);
      cancelAnimation(idleProgress);
      cancelAnimation(thinkingProgress);
      cancelAnimation(reactionY);
      cancelAnimation(reactionScale);
      cancelAnimation(reactionRotation);
      cancelAnimation(reactionOpacity);
    },
    [
      idleProgress,
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
   * değerler normale döner, partikül ve kutlama balonu kaldırılır. `runId`
   * temizlendiği için süre efektinin cleanup'ı eski zamanlayıcıyı da siler.
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
    (side: MascotSide, verticalRatio: number) => {
      isDraggingRef.current = false;
      // Sürükleme bitince AI hâlâ yazıyorsa düşünme durumuna dönülür.
      setState(isThinkingRef.current ? 'thinking' : 'idle');
      void savePosition({ side, verticalRatio });
    },
    [savePosition],
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
   * `rotation`'ı yalnızca burada sürer; konum ve idle katmanlarına dokunmaz,
   * bu yüzden maskotun kayıtlı konumu değişmez.
   */
  const playReaction = useCallback(
    (type: MascotReactionType) => {
      cancelAnimation(reactionY);
      cancelAnimation(reactionScale);
      cancelAnimation(reactionRotation);
      cancelAnimation(reactionOpacity);

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

    const duration = reduceMotion
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
     * en yakın kenara yerleş, ölçeği normale döndür, konumu kaydet.
     */
    const settleToEdge = () => {
      'worklet';
      const side: MascotSide = positionX.value + TOUCH_SIZE / 2 < width / 2 ? 'left' : 'right';
      const span = bounds.maxY - bounds.minY;
      const rawRatio = span > 0 ? (positionY.value - bounds.minY) / span : 0;
      // Oran her koşulda güvenli sınırlar içinde kalır.
      const verticalRatio = Math.min(1, Math.max(0, rawRatio));

      positionX.value = withSpring(side === 'left' ? bounds.minX : bounds.maxX, SPRING);
      reactionScale.value = withSpring(1, SPRING);
      runOnJS(handleDragEnd)(side, verticalRatio);
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

    const tap = Gesture.Tap()
      .maxDuration(400)
      .onEnd((_event, success) => {
        if (success) runOnJS(handleTap)();
      });

    // Exclusive: pan etkinleşirse tap çalışmaz, yani sürükleme sonrası
    // yanlışlıkla balon açılmaz.
    return Gesture.Exclusive(pan, tap);
  }, [
    bounds,
    gestureStartX,
    gestureStartY,
    handleDragEnd,
    handleDragStart,
    handleTap,
    isPanActive,
    positionX,
    positionY,
    reactionScale,
    width,
  ]);

  const positionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: positionX.value }, { translateY: positionY.value }],
  }));

  const idleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(idleProgress.value, [0, 1], [IDLE_TRAVEL, -IDLE_TRAVEL]) },
    ],
  }));

  /** İfade katmanı: yalnızca düşünme eğilimi. Tepki katmanını ezmez. */
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

  if (isHidden) return null;

  const isCelebrationBubble = bubbleVariant === 'celebration';

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View pointerEvents="box-none" style={[styles.positionLayer, positionStyle]}>
        {bubbleVariant && (
          <MascotSpeechBubble
            message={isCelebrationBubble ? t('mascot.celebrationMessage') : undefined}
            onPressCta={handleOpenCoach}
            showCta={!isCelebrationBubble}
            side={position.side}
          />
        )}

        {particleRun > 0 && (
          <MascotCelebrationParticles
            key={particleRun}
            reduceMotion={reduceMotion}
            size={TOUCH_SIZE}
          />
        )}

        {/* Katmanlar: Konum → Idle → İfade(düşünme) → Tepki → Görsel.
            Her katman yalnızca kendi transform'unu sürer, hiçbiri diğerini ezmez. */}
        <GestureDetector gesture={gesture}>
          <Animated.View
            accessible
            accessibilityHint={t('mascot.accessibilityHint')}
            accessibilityLabel={t('mascot.accessibilityLabel')}
            accessibilityRole="button"
            onAccessibilityTap={handleTap}
            style={[styles.touchTarget, idleStyle]}>
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
        </GestureDetector>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  positionLayer: {
    height: TOUCH_SIZE,
    left: 0,
    position: 'absolute',
    top: 0,
    width: TOUCH_SIZE,
  },
  touchTarget: {
    alignItems: 'center',
    height: TOUCH_SIZE,
    justifyContent: 'center',
    width: TOUCH_SIZE,
  },
});
