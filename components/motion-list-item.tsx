import { PropsWithChildren, useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';

import {
  MotionDistance,
  MotionDuration,
  MotionEasing,
  MotionStagger,
} from '@/constants/motion';

type MotionListItemProps = PropsWithChildren<{
  /** Stagger gecikmesi (ms). `MotionStagger.max` ile sınırlanır. */
  delay?: number;
  /** Satır listeye eklendiğinde giriş oynatılmasın. */
  disableEntering?: boolean;
  /** Satır listeden çıkarken çıkış oynatılmasın. */
  disableExiting?: boolean;
  /** Satırın yeni konumuna kayması animasyonlanmasın. */
  disableLayout?: boolean;
  style?: StyleProp<ViewStyle>;
}>;

/**
 * Liste satırı için ortak hareket sarmalayıcısı.
 *
 * Üç davranış BİRBİRİNDEN BAĞIMSIZ açılıp kapatılabilir; çünkü her liste aynı
 * şeye izin vermiyor:
 *
 *   * `entering` — satır ağaca eklendiğinde oynar. React satırı yeniden mount
 *     etmediği sürece TEKRAR OYNAMAZ, bu yüzden stabil `key` şart.
 *   * `exiting` — satır ağaçtan çıkarken oynar.
 *   * `layout` — satır yeni konumuna kayarken oynar. Düz `View` listelerinde
 *     güvenlidir; `react-native-draggable-flatlist` hücrelerinde DEĞİLDİR
 *     (aşağıdaki `useListCellExiting` açıklamasına bakın).
 *
 * Reduce Motion açıkken üçü de kapanır: ne translate ne opaklık geçişi kalır,
 * satırlar doğrudan son hâllerinde görünür.
 *
 * Sarmalayıcı ek stil TAŞIMAZ; `style` verilmezse dikey listede yerleşim
 * birebir korunur (kolon yönünde tam genişlik, içerik kadar yükseklik).
 */
export function MotionListItem({
  children,
  delay = 0,
  disableEntering = false,
  disableExiting = false,
  disableLayout = false,
  style,
}: MotionListItemProps) {
  const reduceMotion = useReducedMotion();
  const safeDelay = Math.min(Math.max(delay, 0), MotionStagger.max);

  return (
    <Animated.View
      entering={
        reduceMotion || disableEntering
          ? undefined
          : FadeInDown.duration(MotionDuration.standard)
              .delay(safeDelay)
              .easing(MotionEasing.standard)
              .withInitialValues({
                opacity: 0,
                transform: [{ translateY: MotionDistance.listItem }],
              })
      }
      exiting={
        reduceMotion || disableExiting
          ? undefined
          : FadeOut.duration(MotionDuration.fast).easing(MotionEasing.standard)
      }
      layout={
        reduceMotion || disableLayout
          ? undefined
          : LinearTransition.duration(MotionDuration.standard).easing(MotionEasing.standard)
      }
      style={style}>
      {children}
    </Animated.View>
  );
}

/**
 * "İlk gerçek yükleme" ile "sonradan gelen satır" ayrımı.
 *
 * Liste İLK KEZ dolduğunda satırlar küçük bir stagger ile gelir. Ondan sonra
 * eklenen tek satır beklemeden görünür — aksi hâlde altıncı sıraya eklenen bir
 * program 160 ms geç açılırdı. Supabase verisi tazelenince satırlar zaten
 * unmount olmadığı için hiçbir giriş TEKRAR oynamaz; bu kancanın işi sadece
 * gecikmeyi seçmek ve arama gibi listelerde girişi tamamen kapatabilmek.
 */
export function useListEntrance(itemCount: number) {
  const hasEnteredRef = useRef(false);

  useEffect(() => {
    if (itemCount > 0) hasEnteredRef.current = true;
  }, [itemCount]);

  const isFirstBatch = !hasEnteredRef.current;

  const getDelay = useCallback(
    (index: number) =>
      isFirstBatch ? Math.min(Math.max(index, 0) * MotionStagger.step, MotionStagger.max) : 0,
    [isFirstBatch],
  );

  return { getDelay, isFirstBatch };
}

/**
 * `react-native-draggable-flatlist` hücresine verilecek çıkış animasyonu.
 *
 * NEDEN AYRI: sürüklenebilir listede satır bir FlatList hücresinin İÇİNDE
 * yaşar. Hücrenin kendisi kütüphaneye ait olduğu için çıkış animasyonu ancak
 * kütüphanenin `itemExitingAnimation` propuyla verilebilir; hücre içine
 * konulan bir `exiting` satırın kapladığı yeri koruyamaz.
 *
 * `itemLayoutAnimation` BİLİNÇLİ OLARAK KULLANILMIYOR: kütüphane onu yalnızca
 * `enableLayoutAnimationExperimental` ile uyguluyor ve o kod yolu UI thread'de
 * `global.LayoutAnimationRepository`'ye erişiyor. Bu global Reanimated 4'te
 * kaldırıldı, yani bayrağı açmak animasyon değil hata üretir.
 */
export function useListCellExiting() {
  const reduceMotion = useReducedMotion();

  return useMemo(
    () =>
      reduceMotion
        ? undefined
        : FadeOut.duration(MotionDuration.fast).easing(MotionEasing.standard),
    [reduceMotion],
  );
}
