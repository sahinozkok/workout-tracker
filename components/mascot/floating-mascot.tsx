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

import { MascotSpeechBubble } from '@/components/mascot/mascot-speech-bubble';
import { Layout } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useMascot } from '@/context/mascot-context';
import { clampVerticalRatio, MascotSide, MascotState } from '@/types/mascot';

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
const DRAG_SCALE = 1.05;
/** Bu mesafeden kısa hareketler sürükleme sayılmaz; tap olarak geçer. */
const DRAG_MIN_DISTANCE = 8;

const SPRING = { damping: 18, mass: 0.9, stiffness: 170 };

/** `app/program/[id]/day/[dayId]/index.tsx` — aktif antrenman ekranı. */
const ACTIVE_WORKOUT_PATTERN = /^\/program\/[^/]+\/day\/[^/]+$/;

type Bounds = { maxX: number; maxY: number; minX: number; minY: number };

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
  const { enabled, isReady, position, savePosition } = useMascot();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [state, setState] = useState<MascotState>('idle');
  const [isBubbleVisible, setIsBubbleVisible] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  const isCompact = ACTIVE_WORKOUT_PATTERN.test(pathname ?? '');
  const mascotSize = isCompact ? COMPACT_MASCOT_SIZE : MASCOT_SIZE;

  // Konum katmanı
  const positionX = useSharedValue(0);
  const positionY = useSharedValue(0);
  // Idle katmanı (süzülme)
  const idleProgress = useSharedValue(0);
  // Tepki katmanı (tap zıplaması + sürükleme büyümesi)
  const reactionY = useSharedValue(0);
  const reactionScale = useSharedValue(1);

  const gestureStartX = useSharedValue(0);
  const gestureStartY = useSharedValue(0);

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
  // Görünürlük ref'te de tutulur: tap handler'ı state updater içinde yan etki
  // üretmeden mevcut değeri okur ve kimliği sabit kalır.
  const bubbleVisibleRef = useRef(false);

  const clearBubbleTimer = useCallback(() => {
    if (bubbleTimerRef.current) {
      clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = undefined;
    }
  }, []);

  const setBubbleVisible = useCallback(
    (visible: boolean) => {
      clearBubbleTimer();
      bubbleVisibleRef.current = visible;
      setIsBubbleVisible(visible);

      if (!visible) return;
      // Balon yaklaşık 4 saniye sonra kendiliğinden kapanır.
      bubbleTimerRef.current = setTimeout(() => {
        bubbleVisibleRef.current = false;
        setIsBubbleVisible(false);
      }, BUBBLE_TIMEOUT);
    },
    [clearBubbleTimer],
  );

  useEffect(() => clearBubbleTimer, [clearBubbleTimer]);

  useEffect(() => {
    // Gizlenirken açık balon kapatılır.
    if (isHidden) setBubbleVisible(false);
  }, [isHidden, setBubbleVisible]);

  // Balon kapandığında "happy" durumu boşta durumuna döner.
  useEffect(() => {
    if (isBubbleVisible) return;
    setState((current) => (current === 'happy' ? 'idle' : current));
  }, [isBubbleVisible]);

  // Sakin süzülme. Sürükleme sırasında, Reduce Motion açıkken veya maskot
  // gizliyken çalışmaz; interval kullanılmadığı için sürekli render üretmez.
  useEffect(() => {
    if (isHidden || reduceMotion || state === 'dragging') {
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
  }, [idleProgress, isHidden, reduceMotion, state]);

  // Unmount olurken süren tüm animasyonlar durdurulur.
  useEffect(
    () => () => {
      cancelAnimation(positionX);
      cancelAnimation(positionY);
      cancelAnimation(idleProgress);
      cancelAnimation(reactionY);
      cancelAnimation(reactionScale);
    },
    [idleProgress, positionX, positionY, reactionScale, reactionY],
  );

  const handleDragStart = useCallback(() => {
    setState('dragging');
    setBubbleVisible(false);
  }, [setBubbleVisible]);

  /** AsyncStorage'a yalnızca sürükleme bittiğinde yazılır, her frame'de değil. */
  const handleDragEnd = useCallback(
    (side: MascotSide, verticalRatio: number) => {
      setState('idle');
      void savePosition({ side, verticalRatio });
    },
    [savePosition],
  );

  const handleTap = useCallback(() => {
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
    // Tekrar dokunulunca açılıp kapanır.
    setBubbleVisible(!bubbleVisibleRef.current);
  }, [reactionScale, reactionY, reduceMotion, setBubbleVisible]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      // Küçük dokunuşlar sürükleme sayılmaz, tap'e yol verir.
      .minDistance(DRAG_MIN_DISTANCE)
      .onStart(() => {
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
        const side: MascotSide = positionX.value + TOUCH_SIZE / 2 < width / 2 ? 'left' : 'right';
        const span = bounds.maxY - bounds.minY;
        const verticalRatio = span > 0 ? (positionY.value - bounds.minY) / span : 0;

        positionX.value = withSpring(side === 'left' ? bounds.minX : bounds.maxX, SPRING);
        reactionScale.value = withSpring(1, SPRING);
        runOnJS(handleDragEnd)(side, verticalRatio);
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

  const reactionStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reactionY.value }, { scale: reactionScale.value }],
  }));

  const handleOpenCoach = useCallback(() => {
    setBubbleVisible(false);
    // Yalnızca ekranı açar; hiçbir AI isteği tetiklemez.
    router.navigate('/coach');
  }, [router, setBubbleVisible]);

  if (isHidden) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View pointerEvents="box-none" style={[styles.positionLayer, positionStyle]}>
        {isBubbleVisible && <MascotSpeechBubble onPressCta={handleOpenCoach} side={position.side} />}

        <GestureDetector gesture={gesture}>
          <Animated.View
            accessible
            accessibilityHint={t('mascot.accessibilityHint')}
            accessibilityLabel={t('mascot.accessibilityLabel')}
            accessibilityRole="button"
            onAccessibilityTap={handleTap}
            style={[styles.touchTarget, idleStyle]}>
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
