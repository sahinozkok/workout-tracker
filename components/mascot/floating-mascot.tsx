import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
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
import {
  DEFAULT_MESSAGE_EXPRESSION,
  getDailyContextExpression,
  isMascotPitchFrame,
  MASCOT_TURN_SOURCES,
  MascotTurnFrame,
  MascotTurnPlan,
  resolveMascotGillCycle,
  resolveMascotTurnPlan,
  MascotExpression,
  MascotPresentation,
  resolveMascotExpression,
  MascotSleepPose,
  pickNextSleepPose,
  resolveMascotImageSource,
} from '@/components/mascot/mascot-expressions';
import { MascotLoveParticles } from '@/components/mascot/mascot-love-particles';
import { MASCOT_NAME } from '@/constants/mascot';
import { Layout } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useOptionalRewards } from '@/context/reward-context';
import { useMascot } from '@/context/mascot-context';
import { useWorkout } from '@/context/workout-context';
import { useMascotAutoGreeting } from '@/hooks/use-mascot-auto-greeting';
import { useMascotBlink } from '@/hooks/use-mascot-blink';
import { SLEEP_DROWSY_DURATION, useMascotSleep } from '@/hooks/use-mascot-sleep';
import {
  clampEdgeRatio,
  isVerticalEdge,
  MASCOT_EDGE_ROTATION,
  MASCOT_REACTION_PRIORITY,
  MascotEdge,
  MascotReactionType,
  MascotState,
} from '@/types/mascot';
import { toDateKey } from '@/utils/discipline';
import { createIdempotencyKey } from '@/utils/idempotency-key';
import {
  getMascotDailyMessage,
  MascotDailyInput,
  resolveMascotDailyContext,
} from '@/utils/mascot-daily-context';

/** Görsel kaynak değişse de tuval aynı olduğu için layout ölçüleri sabit kalır. */
const EXPRESSION_CROSSFADE_MS = 100;
/** Sohbet avatarına geçerken Rosea'nın kenarın dışına kayma süresi. */
const COACH_HANDOFF_EXIT_MS = 420;
/** Sohbetten dönünce aynı kenardan geri gelme süresi. */
const COACH_HANDOFF_RETURN_MS = 320;
/** 100 pt'lik dokunma kutusunu her kenarda tamamen görünmez yapan mesafe. */
const COACH_HANDOFF_DISTANCE = 132;

/**
 * Uyku "nefesi": yalnızca çok hafif bir ölçek değişimi. Yerinden süzülme yok,
 * bu yüzden peek konumu ve kenar rotasyonu etkilenmez.
 */
const SLEEP_BREATH_SCALE = 1.025;
const SLEEP_BREATH_HALF_CYCLE = 2200; // tam döngü ≈ 4400 ms

/**
 * Uyanık nefesi: uyku nefesinden çok daha küçük ve **ayrı** bir katman.
 *
 * Yalnızca ölçek kullanılır — `translateX/Y` yoktur, bu yüzden kayıtlı konum,
 * kenardan bakma mesafesi ve kenar rotasyonu hiç etkilenmez. Gövde nefes
 * alırken hafifçe uzayıp incelir: dikeyde büyürken yatayda çok az daralır.
 */
const AWAKE_BREATH_SCALE_Y = 1.014;
const AWAKE_BREATH_SCALE_X = 0.994;
const AWAKE_BREATH_HALF_CYCLE = 1650; // tam döngü ≈ 3300 ms
/** Koşul bozulduğunda ölçeğin tam 1'e döndüğü kısa, yumuşak geçiş. */
const AWAKE_BREATH_RELEASE_DURATION = 260;

/**
 * Uykuya hazırlanma: tek seferlik sakin bir esneme. Uyanık ve uyku
 * nefeslerinden **ayrı** bir katman ve ayrı shared value kullanır.
 *
 * Toplam süre `SLEEP_DROWSY_DURATION` ile birebir aynıdır; dizi bittiğinde
 * değer tam 0'a (ölçek 1) döner, böylece uyku nefesi temiz devralır.
 */
const DROWSY_SCALE_Y = 1.02;
const DROWSY_SCALE_X = 0.99;
/** Esnemeye yumuşak giriş ve çıkış. Görsel hareketin kendisini açıkça anlatır. */
const DROWSY_STRETCH_IN = 650;
const DROWSY_STRETCH_OUT = 650;
/** Açık ağızlı esneme karesinin okunabilmesi için ortadaki sakin bekleme. */
const DROWSY_HOLD =
  SLEEP_DROWSY_DURATION - DROWSY_STRETCH_IN - DROWSY_STRETCH_OUT; // 1700 ms
/** Geçiş iptal edilirse ölçek bu sürede tam 1'e döner. */
const DROWSY_RELEASE_DURATION = 220;

/** Görünür karakter ölçüsü. Kare kutu + `contain` → oran bozulmadan sığar. */
/**
 * Rosea'nın görsel boyutu — oturum açılmış BÜTÜN ekranlarda aynıdır.
 *
 * Aktif antrenman ekranındaki eski 64 pt'lik "kompakt mod" kaldırıldı: boyut
 * küçültmek Rosea'yı ekranlar arasında tutarsız gösteriyordu. Route farkları
 * artık boyutla değil, doğru safe-area / sekme çubuğu rezerviyle çözülür
 * (bkz. `hasTabBarForRoute`).
 */
const MASCOT_SIZE = 88;
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
 * Uyanma toparlanması. Bu süre boyunca yalnızca uyanma hareketi oynar; normal
 * tap zıplaması ve mesaj balonu ancak bittikten sonra devreye girer.
 */
const WAKE_DURATION = 760; // 600–900 ms aralığında
/** Reduce Motion: aşamalı hareket yerine yalnızca kısa bir ifade geçişi. */
const WAKE_REDUCED_DURATION = 220;

const TAP_LIFT = -9;
const BUBBLE_TIMEOUT = 4000;
/** Otomatik selamlama balonu kısa kalır ve kendiliğinden kapanır. */
const AUTO_GREETING_BUBBLE_TIMEOUT = 3000;
const CELEBRATION_BUBBLE_TIMEOUT = 3800;
const DRAG_SCALE = 1.05;
/**
 * Sürükleme fiziği — yalnızca **sunum** katmanı. Konum verisi (positionX/Y),
 * kayıtlı `edgeRatio` ve snap hesabı bu değerlerden hiç etkilenmez; dokunma
 * hedefi parmağı birebir takip etmeye devam eder.
 */
/** Hızın normalize edileceği referans (pt/sn). Üstü clamp'lenir. */
const DRAG_VELOCITY_REFERENCE = 900;
/**
 * Normalize hız doğrudan kullanılmaz; önce bu katsayıyla alçak geçiren
 * filtreden geçirilir. Ham `velocityX/Y` kare kare çok gürültülü olduğu için
 * filtresiz kullanım titreme ve ani yön sıçraması üretiyordu. 0,22 ≈ 4–5
 * karelik yumuşatma: gövde "süzülür" ama parmaktan kopmaz.
 */
const DRAG_VELOCITY_SMOOTHING = 0.28;
/**
 * Gövdenin hareket yönünün tersine kalma mesafesi. `mascotSize` oranı olarak
 * saklanır: normal (88) ve kompakt (64) boyutta aynı görünür.
 *
 * Yatay ve dikey ayrı tutulur — sarkaç etkisi yanlarda okunur, dikeyde ise
 * kafanın yerinde kalması için belirgin biçimde daha küçüktür.
 * 88 pt referansında ≈ 13 pt yatay, ≈ 8 pt dikey.
 */
const DRAG_LAG_X_FRACTION = 13 / 88;
const DRAG_LAG_Y_FRACTION = 8 / 88;
/**
 * Görsel eğim sınırı (derece). Açı ölçekten bağımsızdır, bu yüzden oranlanmaz.
 * Dönüş merkezi kafa bölgesi olduğu için bu eğim alt gövdeyi pivotun altında
 * belirgin biçimde yana savurur; asıl "sarkaç" hissini üreten budur.
 *
 * Eğri ve yay aynen korunarak yalnızca bu tavan yükseltildi; ölçülen sonuç
 * (uçtan uca simülasyon, yay aşımı dahil):
 *   yavaş (280 pt/sn) → 10,0°   belirgin (700) → 19,9°
 *   hızlı (1800)      → 23,5°   doygun tavan  → 24,0°
 */
const DRAG_TILT_MAX = 24;
/**
 * Eğimin hız duyarlılık eğrisi (üs). 1 = doğrusal.
 *
 * Doğrusal eşleme istenen his eğrisini vermiyordu: ya yavaş sürükleme ölü
 * kalıyor ya da orta hızda tavana yapışıyordu. 0,75'lik hafif sıkıştırma orta
 * bandı yukarı çekerken tepeyi korur. Ölçülen sonuç (yay ve filtre gecikmesi
 * dahil, uçtan uca simülasyon):
 *
 *   deadzone altı → 0,0°     yavaş (280 pt/sn) → 10,0°
 *   belirgin savurma (700)   → 19,9°
 *   çok hızlı (1800)         → 23,5°     doygun → 24,0°
 *
 * Eğri **yalnızca eğime** uygulanır; gecikme, yön ve duruş tespiti doğrusal
 * hızı kullanmaya devam eder, böylece o davranışlar değişmez.
 */
const DRAG_TILT_CURVE = 0.75;
/**
 * Gecikmeyi ve eğimi yumuşatan yay; ataleti de bu üretir. Sönüm oranı ≈ 0,72
 * (hafif underdamped): parmak yavaşlayınca gövde ona doğru yetişir, küçük bir
 * overshoot yapar ve dengelenir.
 *
 * Genlik aynı kalırken **tepki hızı** artırıldı (ω₀ 12,8 → 19,5 rad/sn). Eski
 * yay o kadar yavaştı ki tipik bir savurma bitmeden hedefe yaklaşamıyordu:
 * ölçüldüğünde eğim, sabit 12° tavanına rağmen hiçbir hızda 11,9°'yi
 * geçemiyordu. Sönüm oranı bilinçli olarak korundu, yani his değişmedi —
 * yalnızca gövde parmağa gerçekten yetişiyor.
 */
const DRAG_PHYSICS_SPRING = { damping: 14, mass: 0.5, stiffness: 190 };
/**
 * Kafa pivotunun kutu üstünden uzaklığı, karakterin baş-kuyruk ekseninin
 * oranı olarak. Eksenin üst ~%20'si kafa bölgesidir; dönüş oraya oturunca
 * kafa neredeyse yerinde kalır ve alt gövde sarkaç gibi savrulur.
 */
const HEAD_PIVOT_AXIS_FRACTION = 0.2;
/**
 * Hız bu eşiğin altındaysa fizik nötre çekilir: parmak sabit tutulduğunda
 * gövde kendi kendine hareket etmez, sakinleşir.
 */
const DRAG_VELOCITY_DEADZONE = 40;
/**
 * Hareket durduğunda gövdenin parmağa **yetişmesi**: alt gövde son hareket
 * yönüne doğru nötrü biraz aşar, sonra sakinleşir. Sabit bir döngü değildir —
 * yalnızca ölü bölgeye GİRİŞTE bir kez oynar.
 *
 * Eğim ve gecikme birlikte hareket eder; ikisi aynı diziyi paylaşınca
 * "gövde savruldu ve yerine oturdu" hissi tek bir okunur harekete dönüşür.
 */
const DRAG_RECOIL_TILT = 10;
const DRAG_RECOIL_LAG_FRACTION = 5 / 88;
const DRAG_RECOIL_IN = 130;
const DRAG_RECOIL_OUT = 260;
/**
 * Bu normalize hızın altındaki hareket "duruyor" sayılır. Yalnızca bu
 * ikili durum değiştiğinde JS'e atlanır; pan karesi başına asla.
 */
const DRAG_STILL_THRESHOLD = 0.22;

/**
 * Havada kafasından tutulurken **kurtulmaya çalışma**. Sürekli bir animasyon
 * döngüsü DEĞİLDİR: parmak sabit kaldıkça planlanan, aralarında Rosea'nın
 * sakin durduğu tek seferlik kısa dizilerdir.
 *
 * Hareketin tamamı kafa pivotu etrafındaki **saf dönüştür**: kafa ve dokunma
 * noktası yerinde kalır, savrulan yalnızca alt gövde ve kuyruktur. Görsel
 * kaynak değişmez — hızlı sprite değişiminin ürettiği biçim bozulması yok.
 */
const IDLE_WIGGLE_FIRST_DELAY = 1250; // ~1–1,5 sn sabit tutunca ilk deneme
const IDLE_WIGGLE_MIN_GAP = 2000;
const IDLE_WIGGLE_GAP_RANGE = 2000; // sonraki deneme 2–4 sn sonra
/**
 * Dört vuruşlu dizi (toplam 780 ms):
 *   gövde bir yana belirgin yatar → ters yöne DAHA güçlü geçer
 *   → küçük karşı salınım → sakince hizalanır.
 * Asimetri bilinçli: eşit genlikli gidiş-geliş metronom gibi okunuyordu.
 */
const IDLE_WIGGLE_LEAN = 9;
const IDLE_WIGGLE_SWING = 13;
const IDLE_WIGGLE_COUNTER = 5;
const IDLE_WIGGLE_LEAN_MS = 180;
const IDLE_WIGGLE_SWING_MS = 240;
const IDLE_WIGGLE_COUNTER_MS = 160;
const IDLE_WIGGLE_SETTLE_MS = 200;
const IDLE_WIGGLE_TOTAL =
  IDLE_WIGGLE_LEAN_MS + IDLE_WIGGLE_SWING_MS + IDLE_WIGGLE_COUNTER_MS + IDLE_WIGGLE_SETTLE_MS;
/** Parmak yeniden hareket ederse dizi bu kısa sürede nötre çekilir. */
const IDLE_WIGGLE_RELEASE = 140;

/**
 * Bırakınca **dört aşamalı** kenara yerleşme.
 *
 * `waiting`  — bırakıldığı yerde, ön görünüşte, kıpırdamadan bekler.
 * `turning`  — hedefe göre gövdesini döner (ara karelerle).
 * `leaving`  — bulunduğu noktadan hedef kenarın tamamen dışına **tek
 *              kesintisiz hareketle** ve sabit hızla yürür.
 * `emerging` — görünmezken ön görünüşe ve doğru kenar açısına geçer, ardından
 *              hedef kenardan yüzü ekrana dönük belirir.
 *
 * Dışarı gidiş bilinçli olarak **tek** `withTiming` çağrısıdır. Daha önce bu
 * yol `travel` (kenara kadar) + `exiting` (kenardan dışarı) diye ikiye
 * bölünmüştü; iki ayrı animasyon arasında hız zorunlu olarak sıfırlandığı için
 * Rosea kenarın yakınında durup yeniden hızlanıyordu.
 *
 * Yolculuk boyunca **tek** kare kullanılır (dönüş planının son karesi); yürüme
 * hissi kare değişimiyle değil, o tek görsel üzerinde ritmik bob + salınım
 * transformlarıyla üretilir.
 */

/**
 * Bırakıldıktan sonra hedefe yönelmeden önceki sakin bekleme. Bu süre boyunca
 * konum, görsel ve ritim tamamen sabittir — Rosea bırakıldığı yerde durur.
 */
const SETTLE_WAIT_DURATION = 500;
/**
 * Yaw (dikey eksen) dönüş karelerinin her birinin ekranda kalma süresi. Son
 * kare de bu kadar tutulur, böylece yolculuk başlamadan önce yeni duruş okunur.
 *
 * Toplam dönüş = kare sayısı × bu süre:
 *   sol/sağ (2 kare: ¾ ön → yan)                        = 174 ms
 *   üst     (4 kare: ¾ ön → yan → ¾ sırt → sırt)        = 348 ms
 * Alt (pitch) dönüş kendi sürelerini kullanır: `PITCH_FRAME_MS`.
 *
 * Değer 130 ms iken dönüş 1/1.5 oranında hızlandırıldı (130 / 1.5 ≈ 87).
 * Yolculuk hızı (`SETTLE_TRAVEL_SPEED`) ve diğer animasyonlar değişmedi.
 */
const TURN_FRAME_MS = 87;
/**
 * Yolculuk sırasında solungaç karesinin değişme aralığı. Dönüş karelerinden
 * bilinçli olarak daha yavaş: bu bir duruş değişimi değil, sakin bir nefes
 * ritmidir. Kareler arası geçiş `<Image>`'ın mevcut crossfade'ini kullanır.
 */
const GILL_FRAME_MS = 180;
/**
 * Üst/alt hedefte gövdenin **öne/arkaya** dönüşü (pitch).
 *
 * Dönüş tamamen sprite kareleriyle anlatılır: `pitch-front-mid` → `pitch-edge`
 * → `pitch-back-mid` → `back`. Hiçbir `scaleX`/`scaleY` ezmesi uygulanmaz;
 * Rosea'nın boyutu ve konumu dönüş boyunca değişmez.
 *
 * Toplam dönüş = 3 × `PITCH_FRAME_MS` + `PITCH_SETTLE_MS` = 281 ms. Son kare
 * biraz daha uzun tutulur, böylece yolculuk başlamadan önce yeni duruş okunur.
 *
 * Yaw dönüşüyle AYNI oranda hızlandırıldı (100 / 1.5 ≈ 67, 120 / 1.5 = 80).
 */
const PITCH_FRAME_MS = 67;
const PITCH_SETTLE_MS = 80;
/**
 * Pitch kareleri arasındaki crossfade. Normal ifade geçişinden bilinçli olarak
 * kısadır: 67 ms'lik karelerde daha uzun bir geçiş ara kareleri birbirine
 * bulandırır ve dönüşü yine yumuşak bir morph gibi gösterirdi.
 *
 * Kare süresiyle AYNI oranda kısaltıldı (60 / 1.5 = 40); aksi hâlde crossfade
 * kare süresine yaklaşıp hızlanan dönüşü bulanıklaştırırdı.
 */
const PITCH_CROSSFADE_MS = 40;

/**
 * Sabit yürüyüş hızı (pt/sn). Süre mesafeden türetilir — böylece yakın da olsa
 * uzak da olsa Rosea hep aynı tempoda yürür.
 *
 * 190 → 235: yolculuk cihazda ağır görünüyordu. Tek başına bu sabiti artırmak
 * YETMEZ — aşağıdaki alt sınır kısa mesafelerde süreyi belirlediği için
 * 190 pt altındaki bütün yolculuklar hızlanmadan kalırdı. Bu yüzden ikisi
 * birlikte, aynı oranda (≈ %20) düşürüldü.
 *
 * Oran ölçülerek seçildi: dönüş süresi artık tek parça hareketin içinde
 * olduğu için kullanıcının hissettiği süre `yol + dönüş`tür. Yalnızca yol
 * bileşenini %15 kısaltmak toplamı ancak %11–13 hızlandırıyordu; %20'lik
 * kısalma toplamı hedeflenen ≈ %14–16 bandına taşıyor.
 */
const SETTLE_TRAVEL_SPEED = 235;
/**
 * Süre sınırları yalnızca güvenlik içindir; belirleyici olan `mesafe / hız`
 * hesabıdır. Alt sınır çok kısa mesafede hareketin "seğirme" gibi görünmesini,
 * üst sınır beklenmedik biçimde büyük bir mesafede yolculuğun aşırı uzamasını
 * engeller.
 *
 * Ölçüldü: en yakın kenar seçildiği ve `edgeRatio` mevcut konumdan türediği
 * için gerçek yolculuk mesafesi dar bir aralıkta kalıyor (typ. 145–280 pt).
 * 190 pt/sn'de bu ≈ 760–1460 ms eder; üst sınır hiç devreye girmez — yani uzun
 * yolculuklar asla hızlandırılmaz. Alt sınır bilinçli olarak aralığın en altında tutuldu:
 * daha yüksek bir taban, kısa yolculukları gereksizce yavaşlatıp yolculuklar
 * arasındaki tempo farkını büyütüyordu.
 */
/**
 * 1000 → 800. Ölçüldü: gerçek yolculuk mesafesi 145–280 pt aralığında ve
 * `mesafe / hız` bu aralığın alt yarısında (≈ 188 pt'nin altında) alt sınıra
 * takılıyor. Yani kısa yolculukların süresini hız değil **bu taban**
 * belirliyordu; hızla aynı oranda düşürülmeseydi yakın mesafelerde hiçbir
 * hızlanma hissedilmezdi.
 *
 * Taban aynı zamanda `hareket süresi > dönüş süresi` güvenliğini taşır:
 * 800 ms, en uzun dönüş dizisinden (pitch, 420 ms) hâlâ belirgin biçimde
 * büyüktür, yani dönüş her koşulda Rosea ekrandayken biter.
 *
 * Üst sınır pratikte hiç devreye girmez (en uzun yolculuk ≈ 1192 ms); yine de
 * güvenlik tavanının anlamı bozulmasın diye aynı oranda ölçeklendi.
 */
const SETTLE_TRAVEL_MIN_DURATION = 800;
const SETTLE_TRAVEL_MAX_DURATION = 2720;
/** Reduce Motion: aynı tek parça hareket, belirgin biçimde kısa. */
const SETTLE_TRAVEL_REDUCED_DURATION = 260;
/**
 * Yürüyüş ritmi. Bob ve salınım **tek** bir ilerleme değerinden türetilir,
 * böylece ikisi hiçbir koşulda faz kaymaz.
 */
const TRAVEL_GAIT_HALF_CYCLE = 300;
const TRAVEL_BOB = 1.6; // pt
const TRAVEL_SWAY = 1.5; // derece
/** Kenardan yeniden belirme. Bu aşama dışarı gidişten ayrı kalır. */
const EMERGE_MIN_DURATION = 650;
const EMERGE_MAX_DURATION = 900;
const EMERGE_DURATION_PER_PT = 14;
/**
 * Reduce Motion: bütün aşamalar korunur (işlevsellik aynı) ama kısa ve sade
 * olur — yürüyüş ritmi ve ara dönüş kareleri hiç oynamaz.
 */
const EMERGE_REDUCED_DURATION = 180;

/**
 * NOT — yolculuk açısı için kör bir kenar → derece haritası **yoktur.**
 *
 * Yeni yan kareler zaten baktıkları yöne dönük çizildiği için sol/sağ hedefte
 * ek rotasyon gerekmez; arka kare kafası yukarı çizili olduğu için yalnızca alt
 * kenarda yarım tur gerekir. Bu yüzden kaynak ve rotasyon tek noktada, birlikte
 * çözülür: `resolveMascotTurnPlan`.
 */

/**
 * Dışarı gidişin bitiş noktasında kutunun konteyner sınırını aşması gereken
 * pay. Kutunun tamamı zaten dışarı çıkıyor; bu pay, yolculuk açısında dönmüş
 * silüetin kutu dışına taşan kısmı (≈8,5 pt), henüz nötre dönmemiş olabilen
 * sürükleme gecikmesi ve bob için ek güvenlik bırakır — Rosea hiçbir koşulda
 * "yarı görünür" hâlde taşınmaz.
 */
const EXIT_CLEARANCE = 32;
/**
 * Aşama B'nin başlangıcı için pay. Burada sürükleme fiziği çoktan nötrdür,
 * bu yüzden görünür kısmın üzerine küçük bir pay yeter.
 */
const EMERGE_CLEARANCE = 8;
/**
 * Bu mesafeden kısa hareketler sürükleme sayılmaz; tap olarak geçer.
 *
 * Kenara yerleşme artık bilinçli bir ``ekrandan çık → geri belirme`` akışı
 * başlattığı için telefon üzerindeki doğal parmak titremesinin pan olarak
 * kabul edilmemesi özellikle önemlidir. 8 pt iOS'ta normal bir dokunuşta bile
 * aşılabiliyordu; 14 pt gerçek sürüklemeyi hâlâ rahat bırakırken yanlış çıkış
 * animasyonlarını engeller.
 */
const DRAG_MIN_DISTANCE = 14;

/**
 * Okşama hareketi tanıma.
 *
 * Sevme tepkisi artık çift dokunmayla DEĞİL, Rosea'nın üzerinde parmakla
 * ileri-geri sürtmeyle tetiklenir. Tanıma **mevcut pan gesture'ının içinde**
 * yapılır; ayrı bir gesture eklenmez, böylece pan / tek dokunma / okşama
 * arasında yeni bir yarış (race) oluşmaz.
 *
 * Tek yönlü normal bir sürükleme bu eşiklerin hiçbirini karşılamaz: gerçek bir
 * ileri-geri hareket gerekir ve parmak başladığı noktanın yakınında kalmalıdır.
 */
/**
 * Hareketin üç modu. Karar verilene kadar (`undecided`) Rosea'ya **hiç
 * dokunulmaz**: ne konumu değişir, ne fizik başlar, ne `handleDragStart`
 * çağrılır. Mod bir kez `petting` veya `dragging` olduktan sonra aynı hareket
 * içinde bir daha değişmez.
 */
const MODE_UNDECIDED = 0;
const MODE_PETTING = 1;
const MODE_DRAGGING = 2;

/** Aynı eksende en az bu kadar yön dönüşü. Tek bir ileri-geri yeter. */
const PET_MIN_REVERSALS = 1;
/** Parmağın kat ettiği toplam yol (pt). */
const PET_MIN_PATH = 40;
/** Tanıma anında başlangıca net uzaklık en fazla (pt). */
const PET_MAX_NET = 28;
/** Hareket boyunca başlangıçtan en fazla uzaklaşma (pt). */
const PET_MAX_EXCURSION = 36;
/** Yön sayımına katılması için bir adımın en küçük uzunluğu (pt); gürültü elenir. */
const PET_MIN_STEP = 2;
const PET_MIN_DURATION = 180;
const PET_MAX_DURATION = 1800;
/**
 * Henüz **hiç yön dönüşü yokken** net uzaklık bunu aşarsa hareket açıkça tek
 * yönlüdür ve sürüklemeye geçilir.
 */
const DRAG_COMMIT_NET = 48;
/**
 * En az bir anlamlı yön dönüşü başladıysa kullanıcıya okşamayı tamamlaması için
 * alan tanınır; ancak parmak bu kadar uzağa çıkarsa niyet artık sürüklemedir.
 */
const DRAG_COMMIT_NET_AFTER_REVERSAL = 58;

/**
 * Sevme tepkisi. Tepki ve balon aynı süreyi paylaşır, böylece maskot ikisi de
 * bitince tek seferde kenardaki peek durumuna döner.
 */
const LOVE_REACTION_DURATION = 1700;
/**
 * İki kalp burst'ü arasındaki en kısa süre.
 *
 * Kullanıcı parmağını kaldırmadan okşamaya devam ettiği sürece bu aralıkta bir
 * yeni burst üretilir; aynı pencerede ikinci bir burst **hiçbir koşulda**
 * oluşmaz. Bu sınırın tek otoritesi JS tarafındaki `loveCooldownRef`'tir;
 * UI thread'deki `petLastBurstAt` yalnızca gereksiz köprü atlayışlarını keser.
 *
 * Aynı değer okşama **hareket penceresi** olarak da kullanılır (bkz.
 * `PET_CONTINUE_PATH`), böylece "son pencerede gerçekten okşandı mı" sorusu
 * burst aralığıyla birebir aynı süreyi ölçer.
 */
const PET_BURST_INTERVAL = 890;
/**
 * Yeni bir burst için son burst'ten bu yana kat edilmesi gereken gerçek okşama
 * yolu (pt). Parmağı hareketsiz tutmak yol üretmediği için sonsuza kadar kalp
 * çıkmaz; biriken yol, iki adım arası `PET_BURST_INTERVAL`'i aşarsa sıfırlanır,
 * yani yalnızca **son 890 ms içindeki** gerçek hareket sayılır.
 */
const PET_CONTINUE_PATH = 24;
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
 * Alt sekme çubuğunu barındıran route'ların TAM listesi — `app/(tabs)/_layout`
 * ile birebir aynı beş ekran.
 *
 * Bilinçli olarak **allowlist**: eski `ROOT_STACK_PATTERN` bir blocklist'ti ve
 * yalnızca `/program` ile `/settings` öneklerini tanıyordu. Kök Stack'e push
 * edilen `/friends`, `/friends/search` ve `/profile/:userId` ekranları
 * yanlışlıkla "sekme çubuğu var" sayılıyor, bu yüzden Rosea o ekranlarda
 * olmayan bir çubuk için 56 pt rezerv bırakıp yukarıda duruyordu. Allowlist'te
 * tanınmayan her route doğal olarak kök Stack sayılır.
 */
const TAB_BAR_ROUTES: ReadonlySet<string> = new Set([
  '/',
  '/programs',
  '/history',
  '/coach',
  '/profile',
]);

/**
 * Route'un alt sekme çubuğu barındırıp barındırmadığını çözen TEK nokta.
 * Saf ve deterministiktir; dağınık regex'lerle ikinci bir karar verilmez.
 */
export function hasTabBarForRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  // Sondaki eğik çizgi normalize edilir: '/programs/' de bir sekme route'udur.
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return TAB_BAR_ROUTES.has(trimmed === '' ? '/' : trimmed);
}

/** `locales/*.ts` içindeki `mascot.contextMessages` grup anahtarları. */
type MascotMessageGroup = 'home' | 'programs' | 'workout' | 'history' | 'coach' | 'profile';

/**
 * Route → mesaj grubu. Deterministiktir; hiçbir kullanıcı veya antrenman
 * verisi okumaz, yalnızca `pathname` değerine bakar.
 *
 * Sıra önemli: aktif antrenman ekranı (`/program/x/day/y`) genel program
 * route'undan **önce** kontrol edilir, aksi hâlde program grubuna düşerdi.
 * Bilinmeyen route `undefined` döner ve çağıran taraf `mascot.bubbleMessage`
 * fallback'ini kullanır.
 */
function resolveMessageGroup(pathname: string): MascotMessageGroup | undefined {
  if (ACTIVE_WORKOUT_PATTERN.test(pathname)) return 'workout';
  if (pathname === '/') return 'home';
  if (pathname === '/programs' || pathname === '/program' || pathname.startsWith('/program/')) {
    return 'programs';
  }
  if (pathname === '/history') return 'history';
  if (pathname === '/coach') return 'coach';
  if (pathname === '/profile' || pathname === '/settings') return 'profile';
  return undefined;
}

type Bounds = { maxX: number; maxY: number; minX: number; minY: number };

/**
 * Kenara yerleşmenin aşamaları. Tek bir değer olarak tutulur: iki aşama aynı
 * anda etkin olamaz ve geçişler atomiktir.
 *
 * `leaving` bulunduğu noktadan **tamamen ekran dışına çıkana kadar** olan tek
 * kesintisiz harekettir. Bilinçli olarak bölünmez: ayrı bir "kenara git" ve
 * "kenardan çık" aşaması, aralarında hızın sıfırlandığı görünür bir duraklama
 * üretiyordu.
 */
type SettlePhase = 'waiting' | 'turning' | 'leaving' | 'emerging';

/** `auto` = kullanıcı dokunmadan gösterilen tek seferlik selamlama. */
type BubbleVariant = 'tap' | 'celebration' | 'love' | 'auto';

/** `runId` sayesinde aynı tür tepki tekrarlansa bile süre efekti yeniden kurulur. */
type ActiveReaction = { runId: number; type: MascotReactionType };

/**
 * Açık balonun ifadesi.
 *
 * `tap` ve `auto` balonları mesajla birlikte seçilen sunum ifadesini kullanır.
 * `love` ve `celebration` balonları ise kendi reaction'larından **daha uzun**
 * açık kalabildiği için (kutlama balonu 3800 ms, kutlama animasyonu 1220 ms)
 * sabit ifadelerini korur; aksi hâlde balon hâlâ ekrandayken görsel normal
 * duruşa dönerdi. Balon yoksa `undefined` döner ve ifade normal state'e düşer.
 */
function resolveBubbleExpression(
  variant: BubbleVariant | undefined,
  presentation: MascotPresentation | undefined,
): MascotExpression | undefined {
  if (!variant) return undefined;
  if (variant === 'love') return 'happy';
  if (variant === 'celebration') return 'celebrating';
  // Geriye yalnızca `tap` ve `auto` kalır.
  return presentation?.expression;
}

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
 * Dönüş kare dizisinin toplam süresi (ms). Zamanlayıcı zincirinin gerçekten
 * harcadığı süreyle **birebir** aynı hesaplanır, tahmin edilmez:
 *
 *   yaw (sol/sağ/üst) → her kare `TURN_FRAME_MS`, son kare de dâhil
 *   pitch (alt)       → ara kareler `PITCH_FRAME_MS`, son `PITCH_SETTLE_MS`
 *   Reduce Motion     → dizi hiç oynamaz, 0
 *
 * Çıkış hareketinin süresi bunun üstüne eklenir; böylece hem toplam tempo
 * bugünküyle aynı kalır hem de "hareket, dönüş bitmeden asla bitmez" değişmezi
 * matematiksel olarak garanti edilir.
 */
function resolveTurnSequenceMs(plan: MascotTurnPlan, reduceMotion: boolean) {
  if (reduceMotion) return 0;
  if (plan.pitch) return (plan.frames.length - 1) * PITCH_FRAME_MS + PITCH_SETTLE_MS;
  return plan.frames.length * TURN_FRAME_MS;
}

/**
 * Ekranda yaşayan maskot.
 *
 * Ağ isteği, AI çağrısı veya Supabase sorgusu yapmaz; kullanıcı mesajlarını ve
 * antrenman verisini okumaz. Dış kapsayıcı `box-none` olduğu için yalnızca
 * karakterin ve açık balonun kendi alanı dokunma yakalar.
 */
export function FloatingMascot() {
  const {
    coachHandoffPhase,
    enabled,
    isReady,
    isThinking,
    position,
    reaction,
    savePosition,
    setCoachHandoffPhase,
  } = useMascot();
  const { t, tList } = useTranslation();
  // Yalnızca `WorkoutContext`'in zaten bellekte tuttuğu değerler okunur:
  // yeni sorgu, refresh veya ağ isteği yapılmaz.
  const {
    activeProgramId,
    disciplineStatuses,
    isProgramsLoading,
    programs,
    programsError,
    workoutSessions,
  } = useWorkout();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  // Sağlayıcı henüz mount edilmemişse ödül sessizce atlanır (bkz. hook).
  const rewards = useOptionalRewards();

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
  /**
   * Uyanma zinciri. Ref'te tutulur: kare bazlı bir değer değildir ve React
   * state'e yazılsaydı uyanma boyunca gereksiz render üretirdi.
   */
  const isWakingRef = useRef(false);
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Unmount sonrası state yazılmaması için. */
  const isMountedRef = useRef(true);
  /**
   * Kenara yerleşme durum makinesi:
   *   idle/dragging → 'waiting' → 'turning' → 'leaving'
   *                 → (görünmezken taşıma) → 'emerging' → settled
   *
   * Tek bir **düşük frekanslı** React state'idir; aşama geçişleri dışında hiç
   * yazılmaz. Konum ve rotasyon animasyonlarının tamamı shared value üzerinde
   * yürür.
   */
  const [settlePhase, setSettlePhase] = useState<SettlePhase>();
  /** Aynı bilginin senkron kopyası (effect/callback guard'ları için). */
  const settlePhaseRef = useRef<SettlePhase | undefined>(undefined);
  /**
   * O an gösterilen dönüş/yolculuk karesi. **Düşük frekanslı** React state'idir:
   * bir yerleşme boyunca en fazla dört kez yazılır. `undefined` ise canonical ön
   * görünüş gösterilir.
   */
  const [turnFrame, setTurnFrame] = useState<MascotTurnFrame>();
  /** Bırakma sonrası kısa beklemenin zamanlayıcısı. */
  const settleWaitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Dönüş kare zincirinin tek zamanlayıcısı; ikinci bir zincir oluşamaz. */
  const turnFrameTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Solungaç döngüsünün tek zamanlayıcısı; ikinci bir döngü oluşamaz. */
  const gillTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Havada kurtulma dizisinin tek zamanlayıcısı (dizi + sonraki planlama). */
  const idleWiggleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Kurtulma denemesinin yönü; kontrollü biçimde dönüşümlü değişir. */
  const idleWiggleSideRef = useRef<1 | -1>(1);
  /**
   * Yerleşme geçiş kimliği: iptal edilen geçişin geç gelen callback'i ne
   * aşama ilerletir ne de kayıt yapar.
   */
  const transitionIdRef = useRef(0);
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
  const coachHandoffPhaseRef = useRef(coachHandoffPhase);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    coachHandoffPhaseRef.current = coachHandoffPhase;
  }, [coachHandoffPhase]);


  useEffect(() => {
    activeReactionRef.current = activeReaction;
  }, [activeReaction]);

  useEffect(() => {
    settlePhaseRef.current = settlePhase;
  }, [settlePhase]);

  // Boyut route'a göre DEĞİŞMEZ; dokunma kutusu da sabit kalır.
  const mascotSize = MASCOT_SIZE;

  /**
   * Sekme çubuğu bu route'ta görünüyor mu? Alt kenarın "yüzeyi" buna göre
   * değişir: sekme çubuğunun üstü veya cihazın güvenli alt sınırı.
   */
  const hasTabBar = hasTabBarForRoute(pathname);
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
  // İfade katmanı (sürekli düşünme eğilimi) — temel açının üzerine eklenir.
  const thinkingProgress = useSharedValue(0);
  /**
   * Uyku katmanı — yalnızca ölçek. Tepki katmanının `reactionScale` değerinden
   * ayrıdır; ikisi birbirini ezmez.
   */
  const sleepScale = useSharedValue(1);
  /**
   * Uyanık nefes katmanı — 0 = nötr, 1 = nefesin tepesi. Uyku nefesinin
   * `sleepScale` değerinden **ayrıdır**: ikisi asla aynı değeri yazmaz ve
   * `!isAsleep` koşulu sayesinde aynı anda çalışamazlar.
   */
  const awakeBreathProgress = useSharedValue(0);
  /**
   * Uykuya hazırlanma katmanı — 0 = nötr, 1 = esnemenin tepesi. Uyku ve uyanık
   * nefesinin değerlerinden ayrıdır; üçü aynı anda çalışamaz.
   */
  const drowsyProgress = useSharedValue(0);
  // Tepki katmanı (tap/set/kutlama).
  const reactionY = useSharedValue(0);
  const reactionScale = useSharedValue(1);
  const reactionRotation = useSharedValue(0);
  const reactionOpacity = useSharedValue(1);
  /** Dünya Rosea'sı ile sohbet avatarı arasındaki bağımsız geçiş katmanı. */
  const coachHandoffProgress = useSharedValue(0);

  const gestureStartX = useSharedValue(0);
  const gestureStartY = useSharedValue(0);
  /**
   * Pan gerçekten ACTIVE hâle geldi mi? UI thread'de tutulur. `.onEnd`
   * çalışmadan iptal edilen sürüklemeyi `.onFinalize` içinde ayırt etmek ve
   * pan hiç etkinleşmeden tap kazandığında temizlik yapmamak için gerekir.
   */
  const isPanActive = useSharedValue(false);

  /**
   * Sürükleme fiziği hedefleri. Pan worklet'inden UI thread üzerinde yazılır;
   * hiçbir React state güncellemesi üretmez.
   */
  const dragTargetLagX = useSharedValue(0);
  const dragTargetLagY = useSharedValue(0);
  const dragTargetTilt = useSharedValue(0);
  /** Son yatay yön işareti (UI thread kopyası); geri savrulmanın yönü budur. */
  const dragDirectionShared = useSharedValue(0);
  /** Hareket ediyor mu (1) yoksa duruyor mu (0)? Yalnızca değişimde JS'e atlar. */
  const dragMovingShared = useSharedValue(0);
  /**
   * Okşama tanıma durumu — tamamı UI thread'de tutulur, pan karesi başına
   * hiçbir React state güncellemesi üretmez. `petRecognized` bir kez true
   * olduğunda tekrar değerlendirilmez: her harekette en fazla bir sevme tepkisi.
   */
  const petPath = useSharedValue(0);
  const petReversals = useSharedValue(0);
  const petAxisSign = useSharedValue(0);
  const petLastX = useSharedValue(0);
  const petLastY = useSharedValue(0);
  const petMaxExcursion = useSharedValue(0);
  const petStartedAt = useSharedValue(0);
  /** Son kalp burst'ünden bu yana kat edilen okşama yolu (pt). */
  const petStrokeSinceBurst = useSharedValue(0);
  /** Son burst'ün zamanı (UI thread kopyası; köprü atlayışını kısar). */
  const petLastBurstAt = useSharedValue(0);
  /** Son anlamlı okşama adımının zamanı; duran parmakta yol birikmez. */
  const petLastStepAt = useSharedValue(0);
  /** `MODE_UNDECIDED` / `MODE_PETTING` / `MODE_DRAGGING`. */
  const petMode = useSharedValue(MODE_UNDECIDED);
  /**
   * Sürüklemeye geçildiği andaki parmak ötelemesi. Sonraki hareket bu noktadan
   * itibaren uygulanır, böylece Rosea karar anında parmağa **sıçramaz**.
   */
  const dragOffsetX = useSharedValue(0);
  const dragOffsetY = useSharedValue(0);
  /**
   * Havada kurtulma gerilmesi (derece). Sürükleme eğiminden **ayrı** bir
   * katmandır: ikisi aynı değeri yazmaz, eğim stilinde toplanırlar.
   */
  const idleWiggle = useSharedValue(0);
  /** Dizi şu anda oynuyor mu? Parmak kımıldayınca UI thread'de anında iptal. */
  const idleWiggleActive = useSharedValue(false);
  /**
   * Alçak geçiren filtreden geçmiş normalize hız. Ham `velocityX/Y` doğrudan
   * kullanılmaz; fizik hedefleri **yalnızca** bu yumuşatılmış değerden türetilir.
   */
  const dragSmoothVx = useSharedValue(0);
  const dragSmoothVy = useSharedValue(0);
  /**
   * `mascotSize`'a göre ölçeklenmiş fizik sınırları. Shared value olarak
   * tutulur: pan worklet'i React değerini okuyamaz ve gesture nesnesi ekran
   * değişiminde yeniden kurulmak zorunda kalmaz.
   */
  const dragLagXMax = useSharedValue(DRAG_LAG_X_FRACTION * MASCOT_SIZE);
  const dragLagYMax = useSharedValue(DRAG_LAG_Y_FRACTION * MASCOT_SIZE);
  const dragRecoilLag = useSharedValue(DRAG_RECOIL_LAG_FRACTION * MASCOT_SIZE);
  /**
   * Kenara yürüyüş katmanı. Kenar rotasyonundan (`edgeRotation`) **ayrıdır** ve
   * yalnızca yolculuk sırasında açı alır; yolculuk bitince 0'a döner ve sahneyi
   * kenar rotasyonuna bırakır. İkisi hiçbir koşulda aynı değeri yazmaz.
   */
  const travelRotation = useSharedValue(0);
  /**
   * Yürüyüş ritmi: 0 ↔ 1 arasında salınır. Bob ve gövde salınımı **tek** bu
   * değerden türetilir, bu yüzden asla faz kayması olmaz.
   */
  const travelGait = useSharedValue(0);
  /**
   * `reduceMotion`'ın UI thread kopyası. Pan worklet'i React değerini
   * okuyamaz; bu kopya sayesinde gesture nesnesi de her tercih değişiminde
   * yeniden kurulmaz.
   */
  const reduceMotionShared = useSharedValue(false);

  useEffect(() => {
    reduceMotionShared.value = reduceMotion;
  }, [reduceMotion, reduceMotionShared]);

  useEffect(() => {
    dragLagXMax.value = DRAG_LAG_X_FRACTION * mascotSize;
    dragLagYMax.value = DRAG_LAG_Y_FRACTION * mascotSize;
    dragRecoilLag.value = DRAG_RECOIL_LAG_FRACTION * mascotSize;
  }, [dragLagXMax, dragLagYMax, dragRecoilLag, mascotSize]);

  // Kayıtlı konum ref'te tutulur: sürükleme sonrası state güncellemesi
  // yeniden yerleştirme efektini tetiklemesin, maskot zıplamasın.
  const positionRef = useRef(position);
  const hasPositionedRef = useRef(false);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  /**
   * Sürükleme sahipliğini bırakır.
   *
   * KÖK NEDEN: `handleDragEnd` — `isDraggingRef`'i ve `state`'i temizleyen tek
   * yer — YALNIZCA `finishSettleToEdge` üzerinden, yani dört aşamalı yerleşme
   * (bekleme → dönüş → ekran dışına yürüyüş → belirme) TAM olarak bittiğinde
   * çalışır. İptal edilen her yerleşmede (klavye açılması, uygulamanın arka
   * plana alınması, maskotun gizlenmesi, ekran ölçüsü/sekme rezervi değişimi)
   * geçiş kimliği artırılıp aşama temizleniyor ama sahiplik bırakılmıyordu.
   * Sonuç: `state` kalıcı olarak `'dragging'` kalıyor, `canSleep` bu yüzden
   * sürekli `false` oluyor ve Rosea oturum boyunca bir daha uyuyamıyordu.
   *
   * Bu yüzden iptal yolları sahipliği AÇIKÇA bırakır. `handleDragStart`
   * bilinçli olarak bu yardımcıyı çağırmaz: orada sahiplik yeni pan'e geçer.
   */
  const releaseDragOwnership = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setState((current) =>
      current === 'dragging' ? (isThinkingRef.current ? 'thinking' : 'idle') : current,
    );
  }, []);

  useEffect(() => {
    if (!isReady) return;

    const target = positionRef.current;
    const { x, y } = resolveEdgePosition(target.edge, target.edgeRatio, bounds);

    if (hasPositionedRef.current) {
      // Ekran boyutu / güvenli alan / sekme çubuğu değişti: kayıtlı oran
      // yeniden hesaplanıp yeni güvenli sınırların içine yaylanarak taşınır.
      // Süren bir yerleşme geçişi varsa hedefleri eski ölçüye göre hesaplanmış
      // olur; kimlik artırılarak geçersizleştirilir ve geç callback'i kayıt
      // yapamaz. Geçiş boyunca hiçbir kayıt yapılmadığı için kayıtlı konuma
      // dönmek tutarlıdır.
      if (settlePhaseRef.current) {
        transitionIdRef.current += 1;
        settlePhaseRef.current = undefined;
        setSettlePhase(undefined);
        cancelAnimation(positionX);
        cancelAnimation(positionY);
        // Yerleşme tamamlanmadığı için `handleDragEnd` çalışmayacak; sahiplik
        // burada bırakılmazsa `state` kalıcı olarak `'dragging'` kalırdı.
        releaseDragOwnership();
      }
      positionX.value = withSpring(x, SPRING);
      positionY.value = withSpring(y, SPRING);
      return;
    }

    // İlk yerleşim animasyonsuzdur; maskot ekranda kayarak doğmaz.
    positionX.value = x;
    positionY.value = y;
    hasPositionedRef.current = true;
  }, [bounds, isReady, positionX, positionY, releaseDragOwnership]);

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
  /**
   * Dokunma anında seçilen mesaj. State'te tutulur, böylece balon açık kaldığı
   * sürece her render'da aynı kalır. `undefined` ise balon varsayılan
   * `mascot.bubbleMessage` metnine düşer.
   */
  const [tapPresentation, setTapPresentation] = useState<MascotPresentation>();
  /** Grup başına en son gösterilen mesaj; arka arkaya tekrarı engeller. */
  const lastTapMessageRef = useRef<Partial<Record<MascotMessageGroup, string>>>({});
  /**
   * Route ref'ten okunur: `handleTap` kimliği sabit kalır, gesture her ekran
   * değişiminde yeniden kurulmaz.
   */
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const finishCoachDeparture = useCallback(() => {
    if (!isMountedRef.current || pathnameRef.current !== '/coach') return;
    setCoachHandoffPhase('chat');
  }, [setCoachHandoffPhase]);

  const finishCoachReturn = useCallback(() => {
    if (!isMountedRef.current || pathnameRef.current === '/coach') return;
    setCoachHandoffPhase('world');
  }, [setCoachHandoffPhase]);

  /**
   * AI sohbetine görsel teslim.
   *
   * Ayrı bir dış transform katmanı kullanılır; kayıtlı konum, sürükleme,
   * peek ve kenara yerleşme değerleri değişmez. Rosea hareket hâlindeyken
   * sohbet sekmesine geçilse bile bulunduğu hareketten kenarın dışına akar,
   * kayıtlı konuma ışınlanmaz.
   */
  useEffect(() => {
    if (!isReady || !enabled) {
      cancelAnimation(coachHandoffProgress);
      coachHandoffProgress.value = 0;
      if (coachHandoffPhaseRef.current !== 'world') setCoachHandoffPhase('world');
      return;
    }

    if (pathname === '/coach') {
      if (coachHandoffPhaseRef.current === 'departing') return;
      if (coachHandoffPhaseRef.current === 'chat') {
        coachHandoffProgress.value = 1;
        return;
      }

      setCoachHandoffPhase('departing');
      cancelAnimation(coachHandoffProgress);
      coachHandoffProgress.value = withTiming(
        1,
        {
          duration: reduceMotion ? 0 : COACH_HANDOFF_EXIT_MS,
          easing: Easing.in(Easing.cubic),
        },
        (finished) => {
          if (finished) runOnJS(finishCoachDeparture)();
        },
      );
      return () => cancelAnimation(coachHandoffProgress);
    }

    if (
      coachHandoffPhaseRef.current === 'world' ||
      coachHandoffPhaseRef.current === 'returning'
    ) {
      return;
    }

    setCoachHandoffPhase('returning');
    cancelAnimation(coachHandoffProgress);
    coachHandoffProgress.value = withTiming(
      0,
      {
        duration: reduceMotion ? 0 : COACH_HANDOFF_RETURN_MS,
        easing: Easing.out(Easing.cubic),
      },
      (finished) => {
        if (finished) runOnJS(finishCoachReturn)();
      },
    );
    return () => cancelAnimation(coachHandoffProgress);
  }, [
    coachHandoffProgress,
    enabled,
    finishCoachDeparture,
    finishCoachReturn,
    isReady,
    pathname,
    reduceMotion,
    setCoachHandoffPhase,
  ]);

  /**
   * Workout verisi her set tamamlandığında değişir. Ref üzerinden okunduğu
   * için `pickTapMessage` → `handleTap` → gesture zinciri yeniden kurulmaz;
   * pan/double-tap/single-tap nesnesi bu değişimlerden etkilenmez.
   */
  const workoutDataRef = useRef<Omit<MascotDailyInput, 'today'>>({
    activeProgramId,
    disciplineStatuses,
    isProgramsLoading,
    programs,
    programsError,
    workoutSessions,
  });

  useEffect(() => {
    workoutDataRef.current = {
      activeProgramId,
      disciplineStatuses,
      isProgramsLoading,
      programs,
      programsError,
      workoutSessions,
    };
  }, [
    activeProgramId,
    disciplineStatuses,
    isProgramsLoading,
    programs,
    programsError,
    workoutSessions,
  ]);

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
            : variant === 'auto'
              ? AUTO_GREETING_BUBBLE_TIMEOUT
              : BUBBLE_TIMEOUT;
      bubbleTimerRef.current = setTimeout(() => {
        bubbleVariantRef.current = undefined;
        setBubbleVariant(undefined);
      }, timeout);
    },
    [clearBubbleTimer],
  );

  useEffect(() => clearBubbleTimer, [clearBubbleTimer]);

  // Unmount: bekleyen bütün maskot zamanlayıcıları temizlenir, state yazılmaz.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Geç gelen yerleşme callback'i de bu artışla geçersizleşir: unmount
      // sonrası ne aşama ilerler ne de konum kaydedilir.
      transitionIdRef.current += 1;
      for (const timer of [
        wakeTimerRef,
        idleWiggleTimerRef,
        settleWaitTimerRef,
        turnFrameTimerRef,
        gillTimerRef,
      ]) {
        if (!timer.current) continue;
        clearTimeout(timer.current);
        timer.current = undefined;
      }
    };
  }, []);

  useEffect(() => {
    // Gizlenirken açık balon kapatılır.
    if (isHidden) showBubble(undefined);
  }, [isHidden, showBubble]);

  useEffect(() => {
    // Ekran değişince mesaj artık bulunulan ekrana ait olmadığı için yalnızca
    // ekrana bağlı balonlar (`tap` ve `auto`) kapatılır. `love` ve
    // `celebration` balonları kendi sürelerini tamamlar; route değişimi
    // onları bozmaz.
    const variant = bubbleVariantRef.current;
    if (variant === 'tap' || variant === 'auto') showBubble(undefined);
  }, [pathname, showBubble]);

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
  const { emergeTravel, peekDistance } = useMemo(() => {
    const axisLength = mascotSize / MASCOT_ASPECT;
    const gapToBoundary = EDGE_MARGIN + (TOUCH_SIZE - axisLength) / 2;
    const visible = Math.max(PEEK_MIN_VISIBLE, axisLength * PEEK_VISIBLE_FRACTION);
    return {
      peekDistance: gapToBoundary + Math.max(0, axisLength - visible),
      /**
       * Peek duruşundan **tamamen görünmez** olana kadar kenar normali boyunca
       * gereken ek mesafe: ekranda kalan görünür kısım + küçük bir pay.
       * Aşama B tam bu noktadan başlar, böylece Rosea yoktan belirmez.
       */
      emergeTravel: visible + EMERGE_CLEARANCE,
    };
  }, [mascotSize]);

  /**
   * Kafa pivotunun kutu içindeki dikey konumu. Görsel `contain` ile kare kutuya
   * genişlikten sığdığı için çizimin üst kenarı kutunun tam ortasından
   * `axisLength / 2` yukarıdadır; kafa oradan biraz aşağıda başlar.
   *
   * **Dizi biçimi zorunludur, metin biçimi KULLANILMAZ.** React Native'in
   * `processTransformOrigin` çözümleyicisi metin değerleri
   * `/(top|bottom|left|right|center|\d+(?:%|px)|0)/gi` ile tarar; bu kalıp
   * ondalık nokta kabul etmez. `"50% 26.8547...px"` gibi bir metin, tam kısım
   * atlanarak **kesirli basamaklardan** eşleşir ve pivot 26,85 px yerine
   * 854794520547948 px olur. Değer bu kadar uzaktayken katman kimlik
   * dönüşümündeyken (ölçek/dönüş tam olarak nötrken) zararsız görünür, fakat
   * sürükleme fiziği ilk kez sıfırdan farklı bir eğim/gecikme yazdığı anda
   * karakter astronomik bir mesafeye taşınır ve tamamen kaybolur.
   *
   * Dizi biçimi çözümleyiciye hiç girmez, doğrudan doğrulamadan geçer. Değer
   * ayrıca tam sayıya yuvarlanır: ileride yanlışlıkla metne çevrilse bile aynı
   * çözümleme hatasına düşmez. Yuvarlama görsel olarak fark edilmez.
   *
   * Not: `react-native-web` bu metni doğrudan CSS'e geçirdiği için hata yalnızca
   * gerçek cihazda (iOS/Android) görülüyordu; web'de sorun görünmüyordu.
   */
  const dragPivotStyle = useMemo<ViewStyle>(() => {
    const axisLength = mascotSize / MASCOT_ASPECT;
    const artTop = (TOUCH_SIZE - axisLength) / 2;
    return {
      transformOrigin: ['50%', Math.round(artTop + axisLength * HEAD_PIVOT_AXIS_FRACTION), 0],
    };
    // Stil nesnesi de memo'lanır: her render'da yeni nesne üretmek native
    // tarafta gereksiz transform yeniden çözümlemesi tetikliyordu.
  }, [mascotSize]);

  /** Worklet ve geç callback'lerin güncel ölçüyü okuması için senkron kopyalar. */
  const peekDistanceRef = useRef(peekDistance);
  const emergeTravelRef = useRef(emergeTravel);
  const containerRef = useRef(container);
  const boundsRef = useRef(bounds);

  useEffect(() => {
    peekDistanceRef.current = peekDistance;
    emergeTravelRef.current = emergeTravel;
    containerRef.current = container;
    boundsRef.current = bounds;
  }, [bounds, container, emergeTravel, peekDistance]);

  /**
   * Sunum hedefi tek kaynaktan türetilir; peek/full için ayrı boolean state
   * tutulmaz. Tamamen görünür durumlarda maskot dik (0°) durur, çünkü zıplama
   * ve kutlama hareketleri yalnızca dik duruşta doğru okunur.
   */
  /**
   * Yerleşme aşamaları her şeyden baskındır ve deterministiktir:
   *  - `waiting` / `turning` / `leaving`: Rosea tam görünür. Kenar rotasyonu ve
   *    peek devrede DEĞİLDİR; duruşu tamamen ayrı `travelRotation` katmanı
   *    sürer, böylece iki dönüş kaynağı birbirini ezmez.
   *  - `emerging`: hedef kenarın duruşu **zaten** uygulanmıştır; Rosea dışarıdan
   *    doğru açıyla belirir.
   */
  const isFullyVisible =
    settlePhase === 'emerging'
      ? false
      : settlePhase !== undefined
        ? true
        : state === 'dragging' ||
          // `loved` bilinçli olarak HARİÇ: çift dokunma yalnızca kalp üretir,
          // maskotu kenardan içeri çekmez ve peek duruşunu değiştirmez.
          Boolean(activeReaction && activeReaction.type !== 'loved');

  /**
   * Bugün süren veya duraklatılmış bir antrenman varken maskot uyumaz; uyuyorsa
   * `canSleep` yanlışa döndüğü için hemen uyanır. Yalnızca `WorkoutContext`'in
   * zaten bellekteki oturumları okunur, yeni sorgu yapılmaz.
   */
  const hasActiveWorkout = useMemo(() => {
    const todayKey = toDateKey(new Date());
    return workoutSessions.some(
      (session) =>
        session.dateKey === todayKey &&
        (session.status === 'running' || session.status === 'paused'),
    );
  }, [workoutSessions]);

  const canSleep =
    !isHidden &&
    !bubbleVariant &&
    !activeReaction &&
    !isThinking &&
    state !== 'dragging' &&
    !hasActiveWorkout;

  // Ambient peek effect'i `isAsleep` değerini okuduğu için uyku bloğu ondan
  // önce durur.
  const { isAppActive, isAsleep, isDrowsy, isSettling, wake } = useMascotSleep({ canSleep });

  /**
   * Uyku pozu. **Düşük frekanslı** React state'idir: bir uyku döngüsünde en
   * fazla iki kez yazılır (girişte seçilir, uyanınca temizlenir).
   */
  const [sleepPose, setSleepPose] = useState<MascotSleepPose>();
  /** Bir önceki poz; aynı poz arka arkaya seçilmesin diye saklanır. */
  const lastSleepPoseRef = useRef<MascotSleepPose>(undefined);

  /**
   * Poz YALNIZCA uykuya GİRİŞTE seçilir.
   *
   * Etki `isAsleep` dışında hiçbir şeye bağlı değildir, bu yüzden uyku
   * boyunca yeniden çalışmaz ve poz ortada değişemez. `Math.random()` render
   * içinde değil, bu etkinin gövdesinde çağrılır. Uyanınca poz temizlenir ve
   * normal sprite devralır.
   */
  useEffect(() => {
    if (!isAsleep) {
      setSleepPose(undefined);
      return;
    }

    const nextPose = pickNextSleepPose(lastSleepPoseRef.current);
    lastSleepPoseRef.current = nextPose;
    setSleepPose(nextPose);
  }, [isAsleep]);

  /**
   * Uykuya hazırlanma esnemesi. Tek seferliktir: yukarı doğru hafifçe uzayıp
   * tam 1'e yerleşir, böylece `isAsleep` başladığında uyku nefesi ölçek 1'den
   * devralır. Reduce Motion açıkken hareket hiç oynatılmaz — zamanlayıcı akışı
   * ve `yawning` ifadesi aynen çalışmaya devam eder.
   */
  useEffect(() => {
    if (!isDrowsy || reduceMotion || isHidden) {
      cancelAnimation(drowsyProgress);
      drowsyProgress.value = withTiming(0, {
        duration: DROWSY_RELEASE_DURATION,
        easing: Easing.out(Easing.quad),
      });
      return;
    }

    drowsyProgress.value = 0;
    drowsyProgress.value = withSequence(
      withTiming(1, { duration: DROWSY_STRETCH_IN, easing: Easing.inOut(Easing.sin) }),
      withDelay(
        DROWSY_HOLD,
        withTiming(0, { duration: DROWSY_STRETCH_OUT, easing: Easing.inOut(Easing.sin) }),
      ),
    );

    return () => cancelAnimation(drowsyProgress);
  }, [drowsyProgress, isDrowsy, isHidden, reduceMotion]);

  /**
   * Uyku nefesi. Reduce Motion açıkken yalnızca `sleepy` görseline geçilir,
   * tekrar eden animasyon çalışmaz.
   */
  useEffect(() => {
    if (!isAsleep || reduceMotion || isHidden) {
      cancelAnimation(sleepScale);
      sleepScale.value = withTiming(1, { duration: 200 });
      return;
    }

    sleepScale.value = 1;
    sleepScale.value = withRepeat(
      withTiming(SLEEP_BREATH_SCALE, {
        duration: SLEEP_BREATH_HALF_CYCLE,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );

    return () => cancelAnimation(sleepScale);
  }, [isAsleep, isHidden, reduceMotion, sleepScale]);

  /**
   * Uyanık nefesi. Uyku nefesinin **tam karşılığı ama ayrı** bir katmandır:
   * kendi shared value'sunu kullanır ve `!isAsleep` koşulu yüzünden ikisi
   * aynı anda çalışamaz.
   *
   * Yalnızca ölçek animasyonudur; `translateX/Y` yoktur, bu yüzden kayıtlı
   * konum, peek mesafesi ve kenar rotasyonu hiç değişmez. Göz kırpma farklı
   * bir katmanda (görsel kaynağı) çalıştığı için ikisi birbirini kesmez.
   *
   * Koşullardan biri bozulduğu anda tekrar eden animasyon iptal edilir ve
   * ölçek kısa, yumuşak bir geçişle tam 1'e döner.
   */
  const canBreathe =
    !isHidden &&
    isAppActive &&
    !isAsleep &&
    // Uykuya hazırlanma başladığı anda uyanık nefesi durur; esneme onun
    // yerini alır.
    !isDrowsy &&
    !isSettling &&
    !reduceMotion &&
    !activeReaction &&
    !bubbleVariant &&
    !isThinking &&
    state !== 'dragging';

  useEffect(() => {
    if (!canBreathe) {
      cancelAnimation(awakeBreathProgress);
      awakeBreathProgress.value = withTiming(0, {
        duration: AWAKE_BREATH_RELEASE_DURATION,
        easing: Easing.out(Easing.quad),
      });
      return;
    }

    awakeBreathProgress.value = 0;
    awakeBreathProgress.value = withRepeat(
      withTiming(1, {
        duration: AWAKE_BREATH_HALF_CYCLE,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );

    return () => cancelAnimation(awakeBreathProgress);
  }, [awakeBreathProgress, canBreathe]);

  /**
   * Kenarda dururkenki peek mesafesi — `isFullyVisible` koşulundan bağımsızdır.
   * Aşama B, görünmezken nihai duruşu **anında** uygulayabilmek için tam bu
   * değeri kullanır; böylece Rosea belirirken dönmez veya kayarak yerleşmez.
   */
  const restingPeekMagnitude = isThinking ? peekDistance * THINKING_PEEK_FACTOR : peekDistance;
  const restingPeekRef = useRef(restingPeekMagnitude);

  useEffect(() => {
    restingPeekRef.current = restingPeekMagnitude;
  }, [restingPeekMagnitude]);

  const peekMagnitude = isFullyVisible ? 0 : restingPeekMagnitude;

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
      cancelAnimation(sleepScale);
      cancelAnimation(awakeBreathProgress);
      cancelAnimation(dragTargetLagX);
      cancelAnimation(dragTargetLagY);
      cancelAnimation(dragTargetTilt);
      cancelAnimation(idleWiggle);
      cancelAnimation(travelRotation);
      cancelAnimation(travelGait);
      cancelAnimation(drowsyProgress);
      cancelAnimation(thinkingProgress);
      cancelAnimation(reactionY);
      cancelAnimation(reactionScale);
      cancelAnimation(reactionRotation);
      cancelAnimation(reactionOpacity);
    },
    [
      awakeBreathProgress,
      dragTargetLagX,
      dragTargetLagY,
      dragTargetTilt,
      drowsyProgress,
      edgeRotation,
      idleWiggle,
      travelGait,
      travelRotation,
      peekOffsetX,
      peekOffsetY,
      positionX,
      positionY,
      reactionOpacity,
      reactionRotation,
      reactionScale,
      reactionY,
      sleepScale,
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

  /** Havada kurtulma dizisinin bekleyen zamanlayıcısını temizler. */
  const clearIdleWiggleTimer = useCallback(() => {
    if (!idleWiggleTimerRef.current) return;
    clearTimeout(idleWiggleTimerRef.current);
    idleWiggleTimerRef.current = undefined;
  }, []);

  /** Diziyi hem zamanlayıcı hem animasyon tarafında kesin olarak durdurur. */
  const stopIdleWiggle = useCallback(() => {
    clearIdleWiggleTimer();
    idleWiggleActive.value = false;
    cancelAnimation(idleWiggle);
    idleWiggle.value = 0;
  }, [clearIdleWiggleTimer, idleWiggle, idleWiggleActive]);

  /**
   * Havada kafasından tutulurken tek seferlik **kurtulma denemesi**:
   *
   *   gövde bir yana belirgin yatar (9°)
   *   → ters yöne daha güçlü geçer (13°)
   *   → küçük bir karşı salınım yapar (5°)
   *   → sakince hizalanır (0°)                            toplam 780 ms
   *
   * Sürekli bir döngü DEĞİLDİR; her oynatma bittikten sonra sıradaki deneme
   * 2–4 sn'lik düzensiz bir aralıkla planlanır ve arada Rosea sakin durur.
   * Görsel kaynak değişmez; dizi kafa pivotu etrafında saf dönüş olduğu için
   * dokunma noktası yerinde kalır, savrulan yalnızca alt gövdedir.
   *
   * Yön dönüşümlüdür: art arda gelen denemeler aynı tarafa yatmaz.
   */
  const playIdleWiggle = useCallback(() => {
    if (!isMountedRef.current || !isDraggingRef.current) return;

    // Rastgelelik render'da değil, yalnızca planlama anında.
    idleWiggleSideRef.current = idleWiggleSideRef.current === 1 ? -1 : 1;
    const side = idleWiggleSideRef.current;

    idleWiggleActive.value = true;
    idleWiggle.value = withSequence(
      withTiming(side * IDLE_WIGGLE_LEAN, {
        duration: IDLE_WIGGLE_LEAN_MS,
        easing: Easing.out(Easing.quad),
      }),
      withTiming(-side * IDLE_WIGGLE_SWING, {
        duration: IDLE_WIGGLE_SWING_MS,
        easing: Easing.inOut(Easing.quad),
      }),
      withTiming(side * IDLE_WIGGLE_COUNTER, {
        duration: IDLE_WIGGLE_COUNTER_MS,
        easing: Easing.inOut(Easing.sin),
      }),
      withTiming(0, { duration: IDLE_WIGGLE_SETTLE_MS, easing: Easing.out(Easing.quad) }),
    );

    // Tek zamanlayıcı zinciri: aynı anda ikinci bir dizi oluşamaz.
    idleWiggleTimerRef.current = setTimeout(() => {
      idleWiggleTimerRef.current = undefined;
      idleWiggleActive.value = false;
      if (!isMountedRef.current || !isDraggingRef.current) return;
      idleWiggleTimerRef.current = setTimeout(
        playIdleWiggle,
        IDLE_WIGGLE_MIN_GAP + Math.random() * IDLE_WIGGLE_GAP_RANGE,
      );
    }, IDLE_WIGGLE_TOTAL);
  }, [idleWiggle, idleWiggleActive]);

  /**
   * Pan worklet'i yalnızca **hareket ediyor / duruyor** ikili durumu gerçekten
   * değiştiğinde buraya atlar; pan karesi başına asla. Tek işi kurtulma
   * denemesinin planını yönetmektir — hiçbir görsel kare değiştirmez.
   */
  const handleDragMotionChange = useCallback(
    (isMoving: boolean) => {
      if (!isMountedRef.current || !isDraggingRef.current) return;

      clearIdleWiggleTimer();
      if (isMoving || reduceMotion) return;

      // Parmak sabitlendi: kurtulma denemesi planlanabilir.
      idleWiggleTimerRef.current = setTimeout(playIdleWiggle, IDLE_WIGGLE_FIRST_DELAY);
    },
    [clearIdleWiggleTimer, playIdleWiggle, reduceMotion],
  );

  /**
   * Yolculuk ritmini başlatır: tek bir ilerleme değeri 0 ↔ 1 arasında salınır,
   * bob ve gövde salınımı bundan türetilir. Reduce Motion'da hiç çağrılmaz.
   */
  const startTravelGait = useCallback(() => {
    cancelAnimation(travelGait);
    travelGait.value = 0;
    travelGait.value = withRepeat(
      withTiming(1, { duration: TRAVEL_GAIT_HALF_CYCLE, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [travelGait]);

  /** Ritmi durdurur ve tam nötre alır; yolculuk bitince/iptalde çağrılır. */
  const stopTravelGait = useCallback(() => {
    cancelAnimation(travelGait);
    travelGait.value = 0;
  }, [travelGait]);

  /**
   * Yolculuk sırasında solungaç döngüsünü oynatır.
   *
   * Ayrı bir animasyon sistemi DEĞİLDİR: mevcut `turnFrame` state'ini ve
   * `<Image>`'ın mevcut crossfade'ini kullanır, yani kaynak çözümü tek noktada
   * kalır. Yalnızca `leaving` aşamasında çağrılır; Reduce Motion'da hiç
   * çağrılmaz ve tek zamanlayıcı zinciri olduğu için ikinci bir döngü oluşamaz.
   */
  const startGillCycle = useCallback((transitionId: number, travelFrame: MascotTurnFrame) => {
    const cycle = resolveMascotGillCycle(travelFrame);
    if (!cycle) return;

    const step = (index: number) => {
      // Geçiş iptal edildiyse (yeniden tutma, gizlenme, unmount) hiçbir kare
      // yazılmaz; aşama `leaving` değilse de döngü kendiliğinden durur.
      if (
        !isMountedRef.current ||
        transitionId !== transitionIdRef.current ||
        settlePhaseRef.current !== 'leaving'
      ) {
        return;
      }

      setTurnFrame(cycle[index % cycle.length]);
      gillTimerRef.current = setTimeout(() => {
        gillTimerRef.current = undefined;
        step(index + 1);
      }, GILL_FRAME_MS);
    };

    // Döngünün ilk karesi zaten ekrandaki yolculuk karesidir; ikinciden başla.
    step(1);
  }, []);

  /**
   * Yerleşmeye ait bekleme ve dönüş zamanlayıcılarını temizler. Her ikisi de
   * tek ref üzerinden yürür, bu yüzden aynı anda iki bekleme veya iki dönüş
   * zinciri oluşamaz.
   */
  const clearSettleTimers = useCallback(() => {
    if (settleWaitTimerRef.current) {
      clearTimeout(settleWaitTimerRef.current);
      settleWaitTimerRef.current = undefined;
    }
    if (turnFrameTimerRef.current) {
      clearTimeout(turnFrameTimerRef.current);
      turnFrameTimerRef.current = undefined;
    }
    if (gillTimerRef.current) {
      clearTimeout(gillTimerRef.current);
      gillTimerRef.current = undefined;
    }
  }, []);

  /**
   * Süren kenara yerleşmeyi iptal eder.
   *
   * Kimlik artırıldığı için hem aşama ilerletme hem kayıt yapan geç callback'ler
   * guard'a takılır ve **hiçbir şey yapmaz**.
   *
   * `restore` yalnızca kullanıcı maskotu yeniden tutmadığında (gizlenme, klavye,
   * arka plan, ekran ölçüsü değişimi) `true` gelir: geçiş ekran dışındayken
   * kesilmiş olabileceği için konum son kaydedilmiş geçerli duruşa geri alınır.
   * Yeniden tutmada `false` gelir; orada pan konumu zaten devralır.
   */
  /**
   * Rosea'yı KAYITLI kenar konumuna atomik olarak geri yerleştirir.
   *
   * Tek kaynak: hem `cancelSettleToEdge`'in restore dalı hem route değişimi
   * bu yolu kullanır, böylece "geçerli konum" tanımı iki yerde ayrışmaz.
   *
   * `positionRef` yerleşme boyunca HİÇ yazılmadığı için son kaydedilmiş
   * `edge`/`edgeRatio` her zaman geçerlidir; konum bu değerlerden **güncel**
   * `boundsRef.current` ile yeniden hesaplanır. `boundsRef` senkron efekti bu
   * efektten önce çalıştığı için route değişiminde yeni ekranın sınırları
   * okunur, eski ekranınki değil — yeni ekranda taşma oluşmaz.
   *
   * Kayıtlı konum burada YAZILMAZ, yalnızca okunur: gereksiz ikinci bir kayıt
   * oluşmaz.
   */
  const restoreSavedEdgePosition = useCallback(() => {
    const saved = positionRef.current;
    const { x, y } = resolveEdgePosition(saved.edge, saved.edgeRatio, boundsRef.current);
    const vector = edgeVector(saved.edge);
    const peekMagnitude = restingPeekRef.current;

    cancelAnimation(positionX);
    cancelAnimation(positionY);
    cancelAnimation(peekOffsetX);
    cancelAnimation(peekOffsetY);
    cancelAnimation(edgeRotation);
    positionX.value = x;
    positionY.value = y;
    peekEdgeRef.current = saved.edge;
    peekEdgeShared.value = saved.edge;
    // Konum ile kenar sunumu aynı anda geri kurulur. Özellikle sağ kenarda
    // konumu geri getirip offset/rotasyonu eski yolculuk karesinde bırakmak,
    // Rosea'nın ekran dışında kalmasına veya havada görünmesine yol açıyordu.
    peekOffsetX.value = vector.x * peekMagnitude;
    peekOffsetY.value = vector.y * peekMagnitude;
    edgeRotation.value = MASCOT_EDGE_ROTATION[saved.edge];
  }, [edgeRotation, peekEdgeShared, peekOffsetX, peekOffsetY, positionX, positionY]);

  const cancelSettleToEdge = useCallback(
    ({ restore }: { restore: boolean }) => {
      // Normal bir dokunma/sürükleme başlangıcında aktif yerleşme yoksa konum
      // animasyonlarına dokunma. Özellikle ilk layout yayı veya peek geçişini
      // gereksiz yere kesmek Rosea'yı ara bir konumda bırakabiliyordu.
      if (!settlePhaseRef.current) return;

      transitionIdRef.current += 1;
      cancelAnimation(positionX);
      cancelAnimation(positionY);
      // Bekleme ve dönüş zamanlayıcıları kesin olarak durur: iptal edilmiş bir
      // yerleşmenin geç kalan karesi yeni duruma sızamaz.
      clearSettleTimers();
      // Yürüyüş katmanı da kesin olarak durur. Kare ve aşama bayrağı aynı anda
      // temizlendiği için görsel de ön görünüşe döner; hepsi anlık yapılır ki
      // arada "ön görsel yolculuk açısında duruyor" karesi oluşmasın.
      stopTravelGait();
      cancelAnimation(travelRotation);
      travelRotation.value = 0;
      settlePhaseRef.current = undefined;
      setSettlePhase(undefined);
      setTurnFrame(undefined);

      if (!restore) return;

      // Kayıtlı konum tek geçerli gerçektir: geçiş sırasında hiçbir şey
      // kaydedilmediği için buraya dönmek her zaman güvenlidir.
      restoreSavedEdgePosition();
    },
    [
      clearSettleTimers,
      positionX,
      positionY,
      restoreSavedEdgePosition,
      stopTravelGait,
      travelRotation,
    ],
  );

  /**
   * ROUTE DEĞİŞİMİ GÜVENLİĞİ.
   *
   * KÖK NEDEN: eski sürüm zamanlayıcıları, ritmi, `travelRotation`,
   * `turnFrame` ve `settlePhase` bayrağını temizliyor ama **konuma hiç
   * dokunmuyordu**. Konumu yalnızca sınırlara duyarlı efekt geri yaylıyordu ve
   * o efekt `bounds` gerçekten DEĞİŞTİĞİNDE çalışır. İki sekme route'u aynı
   * güvenli alanı ve aynı sekme rezervini paylaştığında (`/` → `/programs`
   * gibi) `bounds` memo'su aynı nesneyi döndürüyor, efekt hiç çalışmıyor ve
   * Rosea yolculuğun yarısında — ekranın ortasında ya da tamamen ekran
   * dışında — donup kalıyordu.
   *
   * Normal bir sekme değişimi no-op'tur. Yalnızca route değiştiği render'da
   * aktif bir yerleşme/sürükleme görülürse geçiş iptal edilip kayıtlı kenar
   * duruşu geri kurulur. `settlePhase` React state'i de kontrol edilir: bounds
   * effect'i aynı effect flush'ında ref'i bizden önce temizlese bile render
   * anındaki aşama bilgisi kaybolmaz ve artıklar güvenle temizlenir.
   */
  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;

    // İlk mount veya aynı route içindeki sıradan render: hiçbir sunum ya da
    // konum değeri sıfırlanmaz. Sekme değişiminde görülen gereksiz "reset"
    // hissinin kaynağı eski effect'in her pathname değişiminde koşulsuz restore
    // yapmasıydı.
    if (previousPathname === pathname) return;

    // Alt sekmeler tek bir navigator yüzeyini, aynı overlay'i ve aynı güvenli
    // sınırları paylaşır. Bu geçişte süren yerleşmeyi iptal etmek Rosea'yı
    // kayıtlı kenara ışınlıyordu. Sekmeler arasında hareket ve animasyon aynen
    // devam eder; yalnızca pathname'e bağlı konuşma bağlamı ayrıca güncellenir.
    if (hasTabBarForRoute(previousPathname) && hasTabBarForRoute(pathname)) return;

    const hasActiveSettle = Boolean(settlePhaseRef.current);
    const hadSettleAtRender = Boolean(settlePhase);
    const hasDragOwnership = isDraggingRef.current;

    // Rosea zaten kenarında dinleniyorsa route değişimi tamamen no-op'tur.
    // Nefes, uyku, bakış ve mevcut ifade kesilmez.
    if (!hasActiveSettle && !hadSettleAtRender && !hasDragOwnership) return;

    if (hasActiveSettle) {
      // Ortak iptal yolu bütün zamanlayıcıları/geç callback'leri durdurur ve
      // kayıtlı konum + kenar sunumunu atomik biçimde geri kurar.
      cancelSettleToEdge({ restore: true });
    } else {
      // Bounds effect'i aynı turda ref'i daha önce temizlemiş olabilir veya
      // çoklu dokunmada route pan-finalize'dan önce değişmiş olabilir. Her iki
      // durumda da kalan sunumu durdurup kayıtlı kenarı geri kur.
      transitionIdRef.current += 1;
      clearSettleTimers();
      stopTravelGait();
      cancelAnimation(travelRotation);
      travelRotation.value = 0;
      setTurnFrame(undefined);
      restoreSavedEdgePosition();
    }

    releaseDragOwnership();
  }, [
    cancelSettleToEdge,
    clearSettleTimers,
    pathname,
    releaseDragOwnership,
    restoreSavedEdgePosition,
    settlePhase,
    stopTravelGait,
    travelRotation,
  ]);

  /** Bekleyen uyanma zincirini iptal eder (sürükleme, tepki, unmount). */
  const cancelWakeSequence = useCallback(() => {
    if (wakeTimerRef.current) {
      clearTimeout(wakeTimerRef.current);
      wakeTimerRef.current = undefined;
    }
    isWakingRef.current = false;
  }, []);

  const handleDragStart = useCallback(() => {
    // Sürükleme en yüksek önceliktir: süren kutlama/tepki tamamen sonlandırılır.
    isDraggingRef.current = true;
    // Uyanma sürüyorsa güvenle iptal edilir; bekleyen tap sunumu açılmaz.
    cancelWakeSequence();
    // Yerleşme sürüyorsa (exit veya emerge) anında iptal: konum animasyonu
    // durur ve eski geçişin geç callback'i ne aşama ilerletir ne kayıt yapar.
    // `restore: false` — konumu pan zaten devralıyor.
    cancelSettleToEdge({ restore: false });
    // Yerleşme aktif değilse `cancelSettleToEdge` erken döner ve yolculuk
    // açısına dokunmaz; bu yüzden taban burada da açıkça kurulur. Rosea
    // tutulduğu anda yolculuk katmanı her koşulda nötrdür.
    cancelAnimation(travelRotation);
    travelRotation.value = 0;
    stopIdleWiggle();
    // Kullanıcı tutup hiç hareket ettirmese bile (hareket durumu değişimi
    // olmaz) kurtulma denemesi planlanır.
    if (!reduceMotion) {
      idleWiggleTimerRef.current = setTimeout(playIdleWiggle, IDLE_WIGGLE_FIRST_DELAY);
    }
    setState('dragging');
    // Kutlama balonu dahil açık balon kapanır.
    showBubble(undefined);
    // reactionScale sürükleme ölçeğine ait olduğu için burada sıfırlanmaz.
    cancelActiveReaction({ resetScale: false });
  }, [
    cancelActiveReaction,
    cancelSettleToEdge,
    cancelWakeSequence,
    playIdleWiggle,
    reduceMotion,
    showBubble,
    stopIdleWiggle,
    travelRotation,
  ]);

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

  /**
   * Yerleşmenin **tek otoriter tamamlanma noktası**: konum yalnızca burada,
   * yalnızca bir kez ve yalnızca Aşama B gerçekten bittiğinde kaydedilir.
   *
   * `transitionId` iptal edilen bir geçişin geç gelen callback'ini eler;
   * yeniden tutma, gizlenme veya unmount sonrası kayıt oluşmaz.
   */
  const finishSettleToEdge = useCallback(
    (transitionId: number, edge: MascotEdge, edgeRatio: number) => {
      if (!isMountedRef.current || transitionId !== transitionIdRef.current) return;
      // Kimlik hemen tüketilir: aynı geçişin callback'i ikinci kez gelse bile
      // (çift completion, tekrar tetiklenen animasyon) ikinci kayıt oluşmaz.
      transitionIdRef.current += 1;

      settlePhaseRef.current = undefined;
      setSettlePhase(undefined);
      // Kayıt yalnızca emergence animasyonu gerçekten tamamlandığında.
      handleDragEnd(edge, edgeRatio);
    },
    [handleDragEnd],
  );

  /**
   * Aşama C — Rosea **tamamen görünmezken** çalışır.
   *
   * Sırasıyla: yürüyüş katmanı (sırt açısı + ritim) kapatılır, hedef kenarın
   * nihai duruşu (rotasyon + peek) animasyonsuz uygulanır, konum hedef kenarın
   * hemen dışındaki belirme noktasına ışınlanır, ardından yalnızca konum normal
   * peek noktasına doğru animasyonla çıkar.
   *
   * Sırt görselinden ön görsele geçiş de tam burada, görünmezken olur. Duruş
   * baştan doğru olduğu için Rosea görünür hâle geldiği ilk karede zaten yüzü
   * ekranın içine dönüktür: hiçbir kenarda sırt görünüşü ya da görünürken
   * dönme oluşmaz.
   */
  const startEmergePhase = useCallback(
    (transitionId: number, edge: MascotEdge, edgeRatio: number, targetX: number, targetY: number) => {
      if (!isMountedRef.current || transitionId !== transitionIdRef.current) return;

      const vector = edgeVector(edge);
      const magnitude = restingPeekRef.current;

      // Yürüyüş katmanı ve solungaç döngüsü görünmezken kapanır, dönüş karesi
      // bırakılır: ön görsele dönüş kullanıcıya hiç yakalanmaz. Zamanlayıcı
      // açıkça temizlenir; bekleyen bir solungaç adımı ön görselin üzerine
      // yazamaz.
      clearSettleTimers();
      stopTravelGait();
      cancelAnimation(travelRotation);
      travelRotation.value = 0;
      setTurnFrame(undefined);

      // Nihai duruş görünmezken, animasyonsuz uygulanır.
      peekEdgeRef.current = edge;
      peekEdgeShared.value = edge;
      cancelAnimation(edgeRotation);
      cancelAnimation(peekOffsetX);
      cancelAnimation(peekOffsetY);
      edgeRotation.value = MASCOT_EDGE_ROTATION[edge];
      peekOffsetX.value = vector.x * magnitude;
      peekOffsetY.value = vector.y * magnitude;

      // Belirme başlangıcı: peek noktasının kenar normali boyunca tamamen
      // dışarısı. Işınlama da görünmezken yapılır.
      const travel = emergeTravelRef.current;
      positionX.value = targetX + vector.x * travel;
      positionY.value = targetY + vector.y * travel;

      settlePhaseRef.current = 'emerging';
      setSettlePhase('emerging');

      const duration = reduceMotion
        ? EMERGE_REDUCED_DURATION
        : Math.min(
            EMERGE_MAX_DURATION,
            Math.max(EMERGE_MIN_DURATION, travel * EMERGE_DURATION_PER_PT),
          );

      const onDone = (finished?: boolean) => {
        'worklet';
        // Animasyon iptal edildiyse (yeniden tutma) kayıt yapılmaz.
        if (!finished) return;
        runOnJS(finishSettleToEdge)(transitionId, edge, edgeRatio);
      };

      // Yalnızca kenar normali ekseni hareket eder; diğer eksen zaten hedefte.
      // Tamamlanma callback'i tek eksende olduğu için çift kayıt imkânsızdır.
      if (isVerticalEdge(edge)) {
        positionX.value = withTiming(
          targetX,
          { duration, easing: Easing.out(Easing.cubic) },
          onDone,
        );
      } else {
        positionY.value = withTiming(
          targetY,
          { duration, easing: Easing.out(Easing.cubic) },
          onDone,
        );
      }
    },
    [
      clearSettleTimers,
      edgeRotation,
      finishSettleToEdge,
      peekEdgeShared,
      peekOffsetX,
      peekOffsetY,
      positionX,
      positionY,
      reduceMotion,
      stopTravelGait,
      travelRotation,
    ],
  );

  /**
   * Aşama C-1 — **çıkış hareketi**. Dönüş kareleriyle *aynı anda* başlar.
   *
   * Bu, hareketin başından Rosea görünmez olana kadar **tek** `withTiming`
   * çağrısıdır. Dönüş bittiğinde yeniden başlatılmaz, sıfırlanmaz veya
   * yeniden hedeflenmez: dönüş ve konum aynı zaman aralığında, tek bir hız
   * eğrisi üzerinde ilerler. Ne arada duraklama, ne yeniden hızlanma, ne de
   * hedef yakınında yavaşlama olur.
   *
   * **Eğri — `Easing.in(Easing.quad)`**
   *   • t = 0'da hız tam sıfırdır (türev 2t), yani hareket duruştan doğar;
   *     dönüşün üzerine binen ani bir hız sıçraması oluşmaz.
   *   • Hız boyunca **monoton** artar (ivme pozitif ve sabit): hiçbir noktada
   *     plato, duraklama veya ikinci bir hareket parçası hissedilmez.
   *   • Tepe hız ortalamanın **iki** katıdır. `Easing.in(Easing.cubic)` de
   *     değerlendirildi: t³ eğrisi sürenin ilk %20'sinde mesafenin yalnızca
   *     %0,8'ini kat ediyor — tipik 145–280 pt'lik yolculukta dönüş penceresi
   *     boyunca ≈1 pt yol alınıyor, yani "dönüşle birlikte hareket" gözle hiç
   *     görülmüyor, buna karşılık tepe hız ortalamanın 3 katına çıkıyordu.
   *     Quad aynı pencerede ≈6–8 pt yol alır: başlangıç hâlâ neredeyse
   *     duruştur ama örtüşme gerçekten görünür ve çıkış aşırı hızlanmaz.
   *   • Reduce Motion tek istisnadır ve `Easing.linear` ile mevcut sade
   *     davranışında bırakılır: oraya gösterişli bir ivmelenme eklenmez.
   *
   * **Süre** mevcut mesafe tabanlı hesaptır (`mesafe / SETTLE_TRAVEL_SPEED`,
   * aynı sınırlarla) **artı** dönüş dizisinin süresi. Dönüş artık hareketin
   * içine gömüldüğü için toplam süre bugünküyle birebir aynı kalır — eskiden
   * dönüş ve yolculuk arka arkaya oynuyordu — yani hareket ne hızlanır ne
   * yavaşlar, yalnızca zamana dağılımı değişir. Bu toplama aynı zamanda
   * `süre > dönüş süresi` değişmezini garanti eder: dönüş dizisi Rosea daha
   * ekrandayken kesin olarak biter ve `emerging` asla çıkış tamamlanmadan
   * başlamaz.
   */
  const startExitTranslation = useCallback(
    (
      transitionId: number,
      edge: MascotEdge,
      edgeRatio: number,
      targetX: number,
      targetY: number,
      turnSequenceMs: number,
    ) => {
      /**
       * Bitiş noktası doğrudan **ekranın tamamen dışıdır** — kenardaki peek
       * noktası bir ara durak DEĞİLDİR. Kenar ekseninde hedef orana hizalanır,
       * kenar normalinde ise sınırın ötesine geçilir; ikisi tek doğru üzerinde
       * birleşir.
       */
      const { innerHeight, innerWidth } = containerRef.current;
      const vertical = isVerticalEdge(edge);
      const outX = vertical
        ? edge === 'left'
          ? -(TOUCH_SIZE + EXIT_CLEARANCE)
          : innerWidth + EXIT_CLEARANCE
        : targetX;
      const outY = vertical
        ? targetY
        : edge === 'top'
          ? -(TOUCH_SIZE + EXIT_CLEARANCE)
          : innerHeight + EXIT_CLEARANCE;

      const dx = outX - positionX.value;
      const dy = outY - positionY.value;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // Süre mesafeden türer: tempo her mesafede aynı kalır. Sınırlar yalnızca
      // güvenlik içindir, normal mesafelerde devreye girmezler.
      const travelDuration = reduceMotion
        ? SETTLE_TRAVEL_REDUCED_DURATION
        : Math.min(
            SETTLE_TRAVEL_MAX_DURATION,
            Math.max(SETTLE_TRAVEL_MIN_DURATION, (distance / SETTLE_TRAVEL_SPEED) * 1000),
          );
      // Dönüş süresi artık ayrı bir aşama değil, bu hareketin ilk (en yavaş)
      // bölümüdür; bu yüzden süreye eklenir.
      const duration = travelDuration + turnSequenceMs;

      const onDone = (finished?: boolean) => {
        'worklet';
        // Animasyon iptal edildiyse (yeniden tutma, gizlenme) hiçbir şey olmaz.
        if (!finished) return;
        runOnJS(startEmergePhase)(transitionId, edge, edgeRatio, targetX, targetY);
      };

      /**
       * İki eksen de **aynı süreyi ve aynı easing'i** paylaşır, bu yüzden
       * hareket düz bir çizgi üzerinde ilerler ve iki eksen faz kaymaz.
       *
       * Pratikte hareket zaten tek eksenlidir: `settleToEdge` kenar oranını
       * mevcut konumdan türettiği için dikey kenarlarda `targetY === positionY`,
       * yatay kenarlarda `targetX === positionX` olur ve diğer eksenin farkı
       * tam sıfırdır. Yine de iki eksen birlikte animasyonlanır — böylece bu
       * değişmez ileride bozulsa bile hareket doğru kalır.
       *
       * Tamamlanma callback'i **yalnızca daha uzun yol alan eksene** bağlanır:
       * iki eksen birlikte bittiği için `emerging` tek bir kez başlar — çift
       * callback imkânsızdır.
       */
      const timing = {
        duration,
        easing: reduceMotion ? Easing.linear : Easing.in(Easing.quad),
      } as const;
      const useX = Math.abs(dx) >= Math.abs(dy);
      positionX.value = useX ? withTiming(outX, timing, onDone) : withTiming(outX, timing);
      positionY.value = useX ? withTiming(outY, timing) : withTiming(outY, timing, onDone);
    },
    [positionX, positionY, reduceMotion, startEmergePhase],
  );

  /**
   * Aşama C-2 — dönüş dizisi bittiğinde yolculuk **görünümüne** geçiş.
   *
   * Bu fonksiyon konuma HİÇ dokunmaz: hareket dönüşle birlikte çoktan başladı
   * ve tek parça olarak sürüyor. Burada yalnızca aşama bayrağı ilerler ve
   * yürüyüş ritmi + solungaç döngüsü devreye girer — ikisi de dönüş kareleri
   * oynarken çalışamaz, çünkü solungaç döngüsü de `turnFrame` state'ini yazar
   * ve dönüş zincirinin kareleriyle çakışırdı.
   *
   * **Yalnızca** dönüş zamanlayıcı zincirinin son adımından çağrılır; konum
   * animasyonunun tamamlanma callback'i buraya hiç uğramaz. Böylece aynı hedef
   * için iki farklı callback'in bu geçişi tetiklemesi yapısal olarak imkânsız
   * hâle gelir.
   *
   * Görsel kare bu aşamada dönüş planının son karesidir ve yolculuk boyunca
   * (solungaç varyantları dışında) değişmez. Bu aşamada hiçbir kayıt yapılmaz.
   */
  const startCruisePhase = useCallback(
    (transitionId: number, travelFrame: MascotTurnFrame) => {
      if (!isMountedRef.current || transitionId !== transitionIdRef.current) return;

      settlePhaseRef.current = 'leaving';
      setSettlePhase('leaving');

      // Reduce Motion'da ritim de solungaç döngüsü de hiç oynamaz; yolculuk
      // karesi tek ve sabit kalır.
      if (reduceMotion) return;
      startTravelGait();
      startGillCycle(transitionId, travelFrame);
    },
    [reduceMotion, startGillCycle, startTravelGait],
  );

  /**
   * Aşama B — gövdeyi hedefe göre döndürme.
   *
   * Kaynak ve rotasyon **birlikte** çözülür (`resolveMascotTurnPlan`): yeni yan
   * kareler zaten baktıkları yöne dönük çizildiği için sol/sağ hedefte ek açı
   * gerekmez; arka kare kafası yukarı çizili olduğu için yalnızca alt kenarda
   * yarım tur gerekir.
   *
   * **Çıkış hareketi tam burada, dönüş kareleriyle aynı anda başlar.** Dönüş
   * ve konum artık arka arkaya değil, örtüşerek ilerler: `startExitTranslation`
   * ilk kare ekrana yazılmadan önce çağrılır ve ekran dışına kadar giden tek
   * parça hareketi kurar. Dönüş bittiğinde hareket yeniden başlatılmaz;
   * `startCruisePhase` yalnızca yürüyüş ritmini ve solungaç döngüsünü devralır.
   *
   * Sol/sağ hedefte rotasyon ara karelerle birlikte yumuşakça ilerler ve tam
   * olarak son kare göründüğünde tamamlanır. Üst/alt (pitch) hedefte ise
   * rotasyon hiç animasyonlanmaz: yön, gövde `pitch-edge` karesinde yatay bir
   * silüetken **atomik** değişir — ekranda görünür bir takla oluşmaz. Kareler
   * arası geçiş her iki yolda da `<Image>`'ın kendi crossfade'ini kullanır;
   * paralel bir geçiş sistemi kurulmaz.
   *
   * Bu aşamada yürüyüş ritmi ve solungaç döngüsü henüz başlamaz — konum ise
   * ivmelenerek çoktan yola çıkmıştır.
   */
  const startTurningPhase = useCallback(
    (transitionId: number, edge: MascotEdge, edgeRatio: number, targetX: number, targetY: number) => {
      if (!isMountedRef.current || transitionId !== transitionIdRef.current) return;

      settlePhaseRef.current = 'turning';
      setSettlePhase('turning');

      const plan = resolveMascotTurnPlan(edge);
      const travelFrame = plan.frames[plan.frames.length - 1];
      const turnSequenceMs = resolveTurnSequenceMs(plan, reduceMotion);

      /**
       * Konum hareketi **ilk dönüş karesinden önce** kurulur: aşağıdaki üç
       * yolun (Reduce Motion / pitch / yaw) hepsi bu tek çağrının üstüne biner,
       * yani dört kenarın hiçbirinde dönüş ile hareket arasında sıra farkı
       * kalmaz. Hareket duruştan başladığı için bu ilk anlarda Rosea neredeyse
       * yerinde durur ve dönüşü yapar; hız dönüş ilerledikçe artar.
       */
      startExitTranslation(transitionId, edge, edgeRatio, targetX, targetY, turnSequenceMs);

      // Reduce Motion: bütün ara kare dizisi atlanır, doğrudan doğru yolculuk
      // karesi (`back`) ve açısı (üst 0°, alt 180°) uygulanır. Hareket yukarıda
      // zaten başladı; burada yalnızca yolculuk görünümüne geçilir.
      if (reduceMotion) {
        cancelAnimation(travelRotation);
        travelRotation.value = plan.rotation;
        setTurnFrame(travelFrame);
        startCruisePhase(transitionId, travelFrame);
        return;
      }

      /**
       * Üst/alt hedef — öne/arkaya (pitch) dönüş.
       *
       *   ön görünüş → `pitch-front-mid` → `pitch-edge` → `pitch-back-mid`
       *   → `back`
       *
       * Dönüşü yalnızca sprite kareleri anlatır: ölçek, konum ve boyut hiç
       * değişmez, yan profil hiçbir anda gösterilmez. Alt hedefin 180°'lik
       * yönü **yalnızca** `pitch-edge` karesinde, gövde yatay bir silüetken
       * atomik olarak uygulanır; kullanıcı ne ön ne de arka tam gövdeyi
       * dönerken görür. Üst hedefte `plan.rotation` zaten 0'dır ve aynı yazma
       * etkisizdir.
       *
       * Dizi oynarken Rosea **hedef kenara doğru ivmelenerek** ilerler; yön
       * değişimi de bu ilerlemenin ortasında, edge-on karede olur. Yalnızca
       * yürüyüş ritmi ve solungaç döngüsü son kare okunana kadar bekler.
       */
      if (plan.pitch) {
        // Tek zamanlayıcı zinciri: aynı anda ikinci bir dönüş dizisi oluşamaz.
        const pitchStep = (index: number) => {
          if (!isMountedRef.current || transitionId !== transitionIdRef.current) return;

          const frame = plan.frames[index];
          /**
           * Yön yaşam döngüsü — taban `startSettleToEdge`'de 0'a sabitlendi:
           *
           *   üst  (`plan.rotation === 0`)   → dizinin tamamı 0°'da kalır.
           *     Buradaki yazma da 0'dır, yani üst kenar alt kenarın 180°
           *     dalına hiçbir karede giremez; kafa hareket yönünde (yukarı)
           *     bakarak ekran dışına çıkar.
           *   alt  (`plan.rotation === 180`) → 180° YALNIZCA `pitch-edge`
           *     karesinde, gövde yatay bir silüetken atomik uygulanır;
           *     `pitch-back-mid` ve `back` aynı yönde devam eder.
           */
          if (frame === 'pitch-edge') {
            cancelAnimation(travelRotation);
            travelRotation.value = plan.rotation;
          }
          setTurnFrame(frame);

          const isLast = index === plan.frames.length - 1;
          turnFrameTimerRef.current = setTimeout(
            () => {
              turnFrameTimerRef.current = undefined;
              if (isLast) {
                startCruisePhase(transitionId, travelFrame);
                return;
              }
              pitchStep(index + 1);
            },
            isLast ? PITCH_SETTLE_MS : PITCH_FRAME_MS,
          );
        };

        pitchStep(0);
        return;
      }

      /**
       * Yaw (dikey eksen) dönüş zinciri — sol, sağ **ve üst** hedef.
       *
       * Rotasyon ara karelerle birlikte yumuşakça ilerler ve dönüş dizisiyle
       * aynı anda tamamlanır; hiçbir noktada ani sıçrama olmaz.
       *
       * Sol/sağ (iki kare): baş önde ≈45°'lik süzülme açısı, `side-*` karesi
       * ekrandayken gözle takip edilebilir biçimde oturur.
       *
       * Üst (dört kare): `plan.rotation` sıfırdır ve taban da sıfıra
       * sabitlendiği için buradaki `withTiming` etkisiz bir 0 → 0 geçişidir —
       * Rosea üst yolculukta hiçbir karede dönmez, yalnızca sprite arkıyla
       * arkasını döner ve kafası yukarı bakarak ilerler.
       *
       * Her iki durumda da Rosea bu sırada hedef kenara doğru çoktan, çok
       * yavaş biçimde süzülmeye başlamıştır.
       */
      const rotationDuration = Math.max(2, plan.frames.length - 1) * TURN_FRAME_MS;
      travelRotation.value = withTiming(nearestAngle(travelRotation.value, plan.rotation), {
        duration: rotationDuration,
        easing: Easing.inOut(Easing.quad),
      });

      // Tek zamanlayıcı zinciri: aynı anda ikinci bir dönüş dizisi oluşamaz.
      const step = (index: number) => {
        if (!isMountedRef.current || transitionId !== transitionIdRef.current) return;
        setTurnFrame(plan.frames[index]);

        turnFrameTimerRef.current = setTimeout(() => {
          turnFrameTimerRef.current = undefined;
          if (index === plan.frames.length - 1) {
            startCruisePhase(transitionId, travelFrame);
            return;
          }
          step(index + 1);
        }, TURN_FRAME_MS);
      };

      step(0);
    },
    [reduceMotion, startCruisePhase, startExitTranslation, travelRotation],
  );

  /**
   * Aşama A — pan bırakıldığında çağrılır (worklet'ten `runOnJS`).
   *
   * Rosea hemen yola koyulmaz: bırakıldığı yerde kısa süre sakin bekler. Bu
   * süre boyunca konum, canonical ön görünüş ve nötr duruş korunur; yürüyüş
   * ritmi başlamaz ve hiçbir yan/arka kareye geçilmez.
   *
   * Geçiş kimliği **burada** alınır, böylece beklemenin herhangi bir anında
   * yeniden tutulursa bütün zincir (bekleme → dönüş → yolculuk) geçersizleşir.
   */
  const startSettleToEdge = useCallback(
    (edge: MascotEdge, edgeRatio: number, targetX: number, targetY: number) => {
      if (!isMountedRef.current) return;

      stopIdleWiggle();
      clearSettleTimers();

      transitionIdRef.current += 1;
      const transitionId = transitionIdRef.current;
      settlePhaseRef.current = 'waiting';
      setSettlePhase('waiting');
      // Bekleme canonical ön görünüşte geçer.
      setTurnFrame(undefined);
      /**
       * **Yön tabanı burada kesinleşir.** Yolculuk katmanı, yerleşmenin ilk
       * karesinden itibaren bilinen 0°'dır.
       *
       * Daha önce bu değer yalnızca *başka* yolların yan etkisi olarak
       * sıfırlanıyordu (`cancelSettleToEdge` ve `startEmergePhase`). İkisi de
       * çalışmadığında — örneğin aktif yerleşme yokken yapılan bir dokunuşta
       * `cancelSettleToEdge` erken döndüğü için — önceki yerleşmenin açısı
       * ayakta kalabiliyordu. Üst kenar planı `rotation: 0` olduğu ve pitch
       * dalı yönü yalnızca `pitch-edge` karesinde yazdığı için, kalıntı bir
       * 180° üst yolculuğun ilk karelerinde Rosea'yı ters gösterip edge
       * karesinde 0'a çarparak "takla" olarak okunuyordu. Taban artık
       * miras alınamaz.
       */
      cancelAnimation(travelRotation);
      travelRotation.value = 0;

      settleWaitTimerRef.current = setTimeout(() => {
        settleWaitTimerRef.current = undefined;
        startTurningPhase(transitionId, edge, edgeRatio, targetX, targetY);
      }, SETTLE_WAIT_DURATION);
    },
    [clearSettleTimers, startTurningPhase, stopIdleWiggle, travelRotation],
  );

  /**
   * Bulunulan ekrana uygun kısa mesajı seçer. Yalnızca dokunma anında
   * çağrılır — render sırasında değil. Aynı grupta aynı mesaj arka arkaya
   * seçilmez; grupta tek mesaj kalırsa güvenle o kullanılır. Grup veya liste
   * yoksa `undefined` döner ve balon `mascot.bubbleMessage` fallback'ine düşer.
   */
  const pickTapPresentation = useCallback((): MascotPresentation | undefined => {
    const group = resolveMessageGroup(pathnameRef.current ?? '');
    if (!group) return undefined;

    if (group === 'home') {
      // Ana Sayfa'da bugünkü program/disiplin durumundan deterministik mesaj.
      // Rastgelelik yok: aynı durum her zaman aynı mesajı verir. Bağlam
      // üretilemezse (yükleniyor/hata) aşağıdaki home havuzuna düşülür ve o
      // havuzun tekrarsız rastgele sistemi bozulmadan çalışmaya devam eder.
      const daily = resolveMascotDailyContext({ ...workoutDataRef.current, today: new Date() });
      if (daily) {
        const { key, params } = getMascotDailyMessage(daily);
        // Mesaj ve ifade aynı anda, aynı nesnede seçilir.
        return { expression: getDailyContextExpression(daily), message: t(key, params) };
      }
    }

    const messages = tList(`mascot.contextMessages.${group}`);
    if (messages.length === 0) return undefined;

    const previous = lastTapMessageRef.current[group];
    // Bir önceki mesaj havuzdan çıkarılır; tek mesaj kalırsa havuz boşalır ve
    // güvenli biçimde tam listeye dönülür.
    const pool = messages.filter((message) => message !== previous);
    const source = pool.length > 0 ? pool : messages;
    const chosen = source[Math.floor(Math.random() * source.length)];

    lastTapMessageRef.current[group] = chosen;
    // Genel route mesajlarında kendinden emin duruş kullanılır.
    return { expression: DEFAULT_MESSAGE_EXPRESSION, message: chosen };
    // `t` ve `tList` yalnızca dil değişince kimlik değiştirir; workout verisi
    // ref'ten okunduğu için burası her set tamamlandığında yeniden kurulmaz.
  }, [t, tList]);

  /**
   * Otomatik selamlama mesajı. Ana Sayfa'nın mevcut günlük farkındalık
   * sistemini yeniden kullanır; bağlam hazır değilse çevrilmiş fallback'e
   * düşer. Route havuzlarının tekrarsız rastgele sistemine hiç dokunmaz.
   */
  const pickAutoGreetingPresentation = useCallback((): MascotPresentation => {
    const daily = resolveMascotDailyContext({ ...workoutDataRef.current, today: new Date() });
    if (!daily) {
      return { expression: DEFAULT_MESSAGE_EXPRESSION, message: t('mascot.autoGreeting') };
    }

    const { key, params } = getMascotDailyMessage(daily);
    return { expression: getDailyContextExpression(daily), message: t(key, params) };
  }, [t]);

  /**
   * Kullanıcı dokunmadan çalışır: haptic üretmez, maskotun konumunu
   * değiştirmez, AsyncStorage'a yazmaz, hiçbir AI/Supabase isteği göndermez.
   * Yalnızca kısa bir balon açar.
   */
  const handleAutoGreeting = useCallback(() => {
    setTapPresentation(pickAutoGreetingPresentation());
    showBubble('auto');
  }, [pickAutoGreetingPresentation, showBubble]);

  /**
   * Otomatik selamlama yalnızca Ana Sayfa'da ve maskot gerçekten boştayken
   * planlanır. Bu koşullardan biri bozulursa hook bekleyen zamanlayıcıyı
   * iptal eder; aktif hiçbir tepki kesilmez.
   */
  const canAutoGreet =
    !isHidden &&
    resolveMessageGroup(pathname ?? '') === 'home' &&
    !bubbleVariant &&
    !activeReaction &&
    !isThinking &&
    state !== 'dragging';

  useMascotAutoGreeting({ canGreet: canAutoGreet, onGreet: handleAutoGreeting });


  /**
   * Normal tek dokunma sunumu: kısa zıplama + mesaj balonu.
   *
   * Uykudan gelen dokunuşta bu **hemen** çalışmaz; önce uyanma hareketi biter.
   * Normal balon Rosea'nın peek mesafesini veya kenar rotasyonunu değiştirmez.
   * Böylece basit bir dokunma yalnızca sunumu açar; karakter aynı anda kırpma
   * sınırına doğru ikinci bir konum/dönüş animasyonu başlatmaz.
   */
  const playTapPresentation = useCallback(() => {
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
    // Otomatik selamlama balonu açıksa yalnızca kapanmaz: normal tek-dokunma
    // mesajı doğrudan onun yerini alır.
    const currentVariant = bubbleVariantRef.current;
    const nextVariant =
      currentVariant === undefined || currentVariant === 'auto' ? 'tap' : undefined;
    // Mesaj yalnızca balon açılırken, yani dokunma anında seçilir. Render
    // sırasında hiçbir rastgelelik çalışmaz ve seçilen mesaj state'te
    // tutulduğu için balon kapanana kadar değişmez.
    if (nextVariant === 'tap') setTapPresentation(pickTapPresentation());
    showBubble(nextVariant);
  }, [pickTapPresentation, reactionScale, reactionY, reduceMotion, showBubble]);

  /**
   * Tek dokunma. Uykudan gelen dokunuş **sıralı** bir yaşam döngüsüdür:
   *
   *   dokunma → uyku nefesi durur → gözler açılır + kısa toparlanma
   *   → uyanma biter → normal tap zıplaması → mesaj balonu
   *
   * Uyanma ile normal tap aynı karede başlamaz; balon da ancak uyanma
   * tamamlandıktan sonra açılır.
   */
  const handleTap = useCallback(() => {
    // Aktif bir set/kutlama tepkisi varken dokunma tamamen yok sayılır:
    // haptic üretmez, balonu değiştirmez, tepki shared value'larına dokunmaz.
    if (activeReactionRef.current) return;
    // Uyanma sürerken gelen ikinci dokunma tamamen yok sayılır: ikinci
    // animasyon, ikinci balon veya ikinci zamanlayıcı oluşmaz.
    if (isWakingRef.current) return;

    // Uykudan/esnemeden/sakinleşmeden gelen dokunma normal dokunmadan ayrılır.
    // Faz bilgisi `wake()` çağrısından ÖNCE okunmalıdır.
    const isWakingUp = isAsleep || isDrowsy || isSettling;
    // Uyku nefesi, esneme ve sakinleşme burada durur.
    wake();

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

    if (!isWakingUp) {
      playTapPresentation();
      return;
    }

    // --- Uyanma aşaması: yalnızca toparlanma. Balon ve normal zıplama YOK ---
    isWakingRef.current = true;

    if (!reduceMotion) {
      // Hafifçe çöker, sonra doğrulup yerine oturur.
      reactionScale.value = withSequence(
        withTiming(0.965, { duration: 170, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.045, { duration: 260, easing: Easing.out(Easing.quad) }),
        withSpring(1, SPRING),
      );
      reactionY.value = withSequence(
        withTiming(4, { duration: 170, easing: Easing.inOut(Easing.quad) }),
        withTiming(-6, { duration: 260, easing: Easing.out(Easing.quad) }),
        withSpring(0, SPRING),
      );
    }

    // Reduce Motion: aşamalı yoğun hareket yerine yalnızca kısa bir ifade
    // geçişi süresi beklenir.
    const duration = reduceMotion ? WAKE_REDUCED_DURATION : WAKE_DURATION;

    wakeTimerRef.current = setTimeout(() => {
      wakeTimerRef.current = undefined;
      isWakingRef.current = false;

      // Uyanma sırasında sürükleme başladıysa veya bir tepki devraldıysa
      // normal dokunma sunumu hiç açılmaz.
      if (!isMountedRef.current || isDraggingRef.current || activeReactionRef.current) return;

      playTapPresentation();
    }, duration);
  }, [
    isAsleep,
    isDrowsy,
    isSettling,
    playTapPresentation,
    reactionScale,
    reactionY,
    reduceMotion,
    wake,
  ]);

  /**
   * Tek seferlik tepkiyi oynatır. Tepki katmanı `translateY`, `scale` ve
   * `rotation`'ı yalnızca burada sürer; konum, peek ve kenar yönü katmanlarına
   * dokunmaz, bu yüzden maskotun kayıtlı konumu değişmez.
   */
  const playReaction = useCallback(
    (type: MascotReactionType) => {
      // Tepki devraldığında bekleyen uyanma sunumu açılmaz.
      cancelWakeSequence();
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
      }

      /**
       * Ekrana bağlı balonlar (`tap` ve otomatik selamlama `auto`) yeni bir
       * tepki başlarken kapatılır; aksi hâlde animasyonun üzerinde asılı kalır.
       *
       * `workout-complete` aşağıda kendi balonunu açıyor ve `showBubble` zaten
       * eski balonu tek işlemde devraldığı için onda ayrıca kapatma yapılmaz.
       * `loved` ise hiç balon açmaz; açık ekran balonu kapatılır.
       */
      const opensOwnBubble = type === 'workout-complete';
      const currentBubble = bubbleVariantRef.current;
      if (!opensOwnBubble && (currentBubble === 'tap' || currentBubble === 'auto')) {
        showBubble(undefined);
      }

      // Her oynatma yeni bir runId alır: süre efekti yeniden kurulur ve
      // devralınan tepkinin eski zamanlayıcısı cleanup ile silinir.
      reactionRunRef.current += 1;
      const next: ActiveReaction = { runId: reactionRunRef.current, type };
      activeReactionRef.current = next;
      setActiveReaction(next);
      // `rank-up` de bir kutlamadır: aynı kutlama duruşunu ve hareket dizisini
      // kullanır, ama kendi balonunu AÇMAZ (metni kutlama katmanı gösterir).
      const isCelebration = type === 'workout-complete' || type === 'rank-up';
      setState(isCelebration ? 'celebrating' : 'happy');

      if (type === 'workout-complete') {
        // Kutlama açık normal balonu devralır.
        showBubble('celebration');
        particleRunRef.current += 1;
        setParticleRun(particleRunRef.current);
      } else if (type === 'loved') {
        // Yalnızca kalpler. Balon açılmaz, mesaj seçilmez, CTA gösterilmez.
        loveRunRef.current += 1;
        setLoveRun(loveRunRef.current);
        // Hiçbir hareket oynatılmaz: zıplama, ölçek ve dönüş dallarına girilmez.
        return;
      }

      if (reduceMotion) {
        // Reduce Motion: yoğun zıplama/dönüş yerine kısa opacity + scale nabzı.
        const peak = isCelebration ? 1.08 : 1.04;
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
    [
      cancelWakeSequence,
      reactionOpacity,
      reactionRotation,
      reactionScale,
      reactionY,
      reduceMotion,
      showBubble,
    ],
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
  /**
   * Bir kalp burst'ü üretir — parmak **hâlâ ekranda**.
   *
   * Hem okşamanın tanındığı ilk anda hem de aynı dokunma oturumu boyunca
   * okşama sürerken (her `PET_BURST_INTERVAL`'de en çok bir kez) çağrılır.
   * Tek giriş noktası olduğu için hız sınırının tek otoritesi de burasıdır:
   * `loveCooldownRef`. Worklet tarafındaki zaman damgası yalnızca köprü
   * atlayışlarını kısar, karar vermez.
   *
   * **İfade titremesi bilinçli olarak engellenir.** Süren tepki zaten `loved`
   * ise `playReaction` YENİDEN çağrılmaz — o yol `cancelAnimation` çağırır ve
   * yüz ifadesini yeniden kurardı. Onun yerine yalnızca:
   *   • yeni bir kalp burst'ü açılır (`loveRunRef` kimliği artar — eski
   *     partikül ağacı `key` değiştiği için unmount olur, üst üste birikmez),
   *   • tepkinin süresi yeni bir `runId` ile tazelenir, böylece okşama
   *     sürerken mutlu ifade kararlı kalır.
   *
   * `loved` dalı hiçbir zıplama/ölçek animasyonu oynatmaz, balon açmaz ve
   * `isFullyVisible` hesabında hariç tutulur; Rosea kenardaki duruşundan
   * çıkmaz, sıçramaz ve konumu değişmez.
   */
  const handlePetLove = useCallback(() => {
    if (!isMountedRef.current) return;

    // Daha yüksek öncelikli bir tepki (set/workout kutlaması) sürüyorsa
    // bölünmez. Süren tepki zaten `loved` ise okşama devam ediyor demektir.
    const current = activeReactionRef.current;
    if (current && current.type !== 'loved') return;

    const now = Date.now();
    if (now - loveCooldownRef.current < PET_BURST_INTERVAL) return;
    loveCooldownRef.current = now;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

    /**
     * Ödül tam olarak burada, cooldown kapısını geçen HER gerçek burst için
     * bir kez istenir — görsel dala bakılmaksızın, çünkü ilk burst de devam
     * burst'ü de aynı derecede gerçek bir okşamadır.
     *
     * Günlük/haftalık/toplam sınır YOKTUR (bilinçli ürün kararı). Anahtar
     * burst başına üretilir: aynı isteğin ağ tekrarı aynı anahtarı taşıdığı
     * için sunucuda tek `+1` yazılır, yeni burst'ler ise ayrı ödüllerdir.
     * Çağrı beklenmez; okşama akışı ağ cevabına hiçbir koşulda bağlı değildir.
     */
    void rewards?.awardPetBurst(createIdempotencyKey());

    if (!current) {
      // Oturumun ilk burst'ü: ifade + kalpler birlikte açılır.
      playReaction('loved');
      return;
    }

    // Devam eden okşama: ifadeye dokunulmaz, yalnızca kalpler tazelenir.
    loveRunRef.current += 1;
    setLoveRun(loveRunRef.current);
    reactionRunRef.current += 1;
    const next: ActiveReaction = { runId: reactionRunRef.current, type: 'loved' };
    activeReactionRef.current = next;
    setActiveReaction(next);
  }, [playReaction, rewards]);

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
          : activeReaction.type === 'workout-complete' || activeReaction.type === 'rank-up'
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

  /**
   * Maskot gizlenirse (klavye, ayarlardan kapatma) veya uygulama arka plana
   * alınırsa süren kutlama, kurtulma dizisi ve kenara yerleşme geçişi kesin
   * olarak temizlenir.
   *
   * Yerleşme `restore: true` ile iptal edilir: geçiş Rosea ekran dışındayken
   * kesilmiş olabilir ve konum ekran dışında donup kalmamalıdır. Hiçbir aşamada
   * kayıt yapılmadığı için kayıtlı konuma dönmek her zaman tutarlıdır.
   */
  useEffect(() => {
    if (!isHidden && isAppActive) return;
    cancelActiveReaction({ resetScale: true });
    stopIdleWiggle();
    // Konuma yalnızca gerçekten süren bir geçiş varken dokunulur.
    if (settlePhaseRef.current) cancelSettleToEdge({ restore: true });
    // Klavye açılması veya arka plana geçiş de yerleşmeyi yarıda kesiyor;
    // sahiplik bırakılmazsa Rosea bir daha uyuyamaz.
    releaseDragOwnership();
  }, [
    cancelActiveReaction,
    cancelSettleToEdge,
    isAppActive,
    isHidden,
    releaseDragOwnership,
    stopIdleWiggle,
  ]);

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

      reactionScale.value = withSpring(1, SPRING);
      // Bütün geçici fizik değerleri deterministik olarak nötre döner.
      dragTargetLagX.value = 0;
      dragTargetLagY.value = 0;
      dragTargetTilt.value = 0;

      // Kurtulma gerilmesi de nötre çekilir.
      idleWiggleActive.value = false;
      cancelAnimation(idleWiggle);
      idleWiggle.value = withTiming(0, { duration: IDLE_WIGGLE_RELEASE });

      // Konum burada yaylanmaz ve kayıt burada YAPILMAZ: dört aşamalı
      // (bekleme → dönüş → ekran dışına yürüyüş → görünmezken taşınıp kenardan
      // belirme) geçiş JS tarafında başlar ve kayıt yalnızca son aşama
      // tamamlanınca tek noktadan yapılır.
      runOnJS(startSettleToEdge)(bestEdge, edgeRatio, targetX, targetY);
    };

    /**
     * Okşama oturumunu kapatır. Parmak kalktığı (veya sistem hareketi iptal
     * ettiği) anda mod ve devam sayaçları temizlenir: geç bir güncelleme yeni
     * oturuma kalp yazamaz, bir sonraki dokunuş her şeye sıfırdan başlar.
     * Zamanlayıcı kurulmadığı için temizlenecek bekleyen timer da yoktur.
     */
    const endPetSession = () => {
      'worklet';
      petMode.value = MODE_UNDECIDED;
      petStrokeSinceBurst.value = 0;
      petLastBurstAt.value = 0;
      petLastStepAt.value = 0;
    };

    const pan = Gesture.Pan()
      // Küçük dokunuşlar sürükleme sayılmaz, tap'e yol verir.
      .minDistance(DRAG_MIN_DISTANCE)
      .onStart(() => {
        isPanActive.value = true;
        gestureStartX.value = positionX.value;
        gestureStartY.value = positionY.value;
        // Mod kararı verilene kadar Rosea'ya HİÇ dokunulmaz: ne ölçek, ne
        // fizik, ne `handleDragStart`. Bu yüzden okşama onu yerinden oynatmaz.
        petMode.value = MODE_UNDECIDED;
        dragOffsetX.value = 0;
        dragOffsetY.value = 0;
        dragDirectionShared.value = 0;
        dragMovingShared.value = 0;
        // Filtre her yeni harekette temiz başlar; önceki sürüklemenin son hızı
        // yeni tutuşa sızmaz.
        dragSmoothVx.value = 0;
        dragSmoothVy.value = 0;
        // Okşama tanıma durumu her yeni harekette tamamen sıfırlanır.
        petPath.value = 0;
        petReversals.value = 0;
        petAxisSign.value = 0;
        petLastX.value = 0;
        petLastY.value = 0;
        petMaxExcursion.value = 0;
        petStartedAt.value = Date.now();
        // Kesintisiz okşama sayaçları da her yeni oturumda temiz başlar:
        // önceki dokunuşun birikmiş yolu yeni oturuma kalp yazamaz.
        petStrokeSinceBurst.value = 0;
        petLastBurstAt.value = 0;
        petLastStepAt.value = 0;
      })
      .onUpdate((event) => {
        /**
         * Okşama modunda Rosea tamamen sabittir: konum, ölçek ve fizik
         * **hiç** yazılmaz — bu blok hiçbir koşulda aşağıdaki sürükleme
         * koduna düşmez, bu yüzden okşama Rosea'yı yerinden oynatamaz.
         *
         * Fark şu: parmak artık takip edilmeye devam eder. Kullanıcı aynı
         * dokunuşu sürdürdükçe her `PET_BURST_INTERVAL`'de bir yeni kalp
         * burst'ü istenir; parmağı kaldırıp yeniden dokunmak gerekmez.
         *
         * İki koşul birlikte aranır:
         *   • son burst'ten bu yana en az `PET_BURST_INTERVAL` (890 ms)
         *     geçmiş olmalı,
         *   • o süre içinde en az `PET_CONTINUE_PATH` kadar **gerçek** okşama
         *     yolu kat edilmiş olmalı.
         * İkincisi sayesinde parmağı hareketsiz tutmak sonsuza kadar kalp
         * üretmez; birikmiş yol, adımlar arası boşluk 890 ms'yi aşarsa
         * sıfırlanır, yani yalnızca son pencerede yapılan hareket sayılır.
         * Yön dönüşü aranmaz — küçük doğal yön değişimleri de okşamadır.
         */
        if (petMode.value === MODE_PETTING) {
          const now = Date.now();
          const stepX = event.translationX - petLastX.value;
          const stepY = event.translationY - petLastY.value;
          petLastX.value = event.translationX;
          petLastY.value = event.translationY;

          const stepLength = Math.sqrt(stepX * stepX + stepY * stepY);
          if (stepLength >= PET_MIN_STEP) {
            if (now - petLastStepAt.value > PET_BURST_INTERVAL) petStrokeSinceBurst.value = 0;
            petStrokeSinceBurst.value += stepLength;
            petLastStepAt.value = now;
          }

          if (
            now - petLastBurstAt.value >= PET_BURST_INTERVAL &&
            petStrokeSinceBurst.value >= PET_CONTINUE_PATH
          ) {
            petLastBurstAt.value = now;
            petStrokeSinceBurst.value = 0;
            runOnJS(handlePetLove)();
          }
          return;
        }

        /**
         * Karar aşaması. Yalnızca shared value okur/yazar; JS'e ancak mod
         * kesinleştiğinde **bir kez** atlar. Bu blok boyunca Rosea kıpırdamaz.
         */
        if (petMode.value === MODE_UNDECIDED) {
          const tx = event.translationX;
          const ty = event.translationY;
          const stepX = tx - petLastX.value;
          const stepY = ty - petLastY.value;
          petLastX.value = tx;
          petLastY.value = ty;

          const stepLength = Math.sqrt(stepX * stepX + stepY * stepY);
          petPath.value += stepLength;

          const net = Math.sqrt(tx * tx + ty * ty);
          if (net > petMaxExcursion.value) petMaxExcursion.value = net;

          // Yön yalnızca anlamlı büyüklükteki adımlarda güncellenir; küçük
          // parmak titremesi sahte dönüş üretmez. Yatay ±1, dikey ±2 olarak
          // kodlanır, böylece dönüş yalnızca AYNI eksende sayılır.
          if (stepLength >= PET_MIN_STEP) {
            const sign =
              Math.abs(stepX) >= Math.abs(stepY) ? (stepX > 0 ? 1 : -1) : stepY > 0 ? 2 : -2;
            if (petAxisSign.value !== 0 && petAxisSign.value === -sign) {
              petReversals.value += 1;
            }
            petAxisSign.value = sign;
          }

          const elapsed = Date.now() - petStartedAt.value;
          if (
            petReversals.value >= PET_MIN_REVERSALS &&
            petPath.value >= PET_MIN_PATH &&
            net <= PET_MAX_NET &&
            petMaxExcursion.value <= PET_MAX_EXCURSION &&
            elapsed >= PET_MIN_DURATION &&
            elapsed <= PET_MAX_DURATION
          ) {
            // Okşama: kalpler parmak HÂLÂ ekrandayken başlar.
            petMode.value = MODE_PETTING;
            // İlk burst'ün penceresi buradan açılır; devam eden okşama bir
            // sonraki burst'ü en erken `PET_BURST_INTERVAL` sonra isteyebilir.
            petLastBurstAt.value = Date.now();
            petLastStepAt.value = petLastBurstAt.value;
            petStrokeSinceBurst.value = 0;
            runOnJS(handlePetLove)();
            return;
          }

          /**
           * Sürüklemeye geçiş eşiği yön dönüşüne göre değişir:
           *  - Henüz dönüş yoksa hareket zaten tek yönlü → erken eşik.
           *  - Bir dönüş başladıysa kullanıcı okşuyor olabilir → daha geniş
           *    eşik, yani okşamayı tamamlaması için alan tanınır.
           */
          const commitNet =
            petReversals.value > 0 ? DRAG_COMMIT_NET_AFTER_REVERSAL : DRAG_COMMIT_NET;
          if (net <= commitNet) return; // karar yok → Rosea kıpırdamaz

          /**
           * Hareket açıkça tek yönlü: sürüklemeye geçilir. Karar anındaki
           * öteleme saklanır, böylece Rosea parmağa sıçramaz — hareketine
           * bulunduğu yerden devam eder.
           */
          petMode.value = MODE_DRAGGING;
          dragOffsetX.value = tx;
          dragOffsetY.value = ty;
          reactionScale.value = withSpring(DRAG_SCALE, SPRING);
          runOnJS(handleDragStart)();
        }

        // --- Buradan sonrası yalnızca sürükleme modunda çalışır ---
        const nextX = gestureStartX.value + (event.translationX - dragOffsetX.value);
        const nextY = gestureStartY.value + (event.translationY - dragOffsetY.value);
        positionX.value = Math.min(bounds.maxX, Math.max(bounds.minX, nextX));
        positionY.value = Math.min(bounds.maxY, Math.max(bounds.minY, nextY));

        if (reduceMotionShared.value) return;

        // Hız normalize edilip clamp'lenir: ani yön değişiminde bile sınır aşılmaz.
        // Ölü bölge altındaki hızlar sıfır sayılır: parmak yavaşlayıp durunca
        // gövde nötre döner, sabit bir animasyon döngüsü yoktur.
        const rawX = Math.abs(event.velocityX) < DRAG_VELOCITY_DEADZONE ? 0 : event.velocityX;
        const rawY = Math.abs(event.velocityY) < DRAG_VELOCITY_DEADZONE ? 0 : event.velocityY;
        const clampedX = Math.min(1, Math.max(-1, rawX / DRAG_VELOCITY_REFERENCE));
        const clampedY = Math.min(1, Math.max(-1, rawY / DRAG_VELOCITY_REFERENCE));
        // Ham hız DOĞRUDAN kullanılmaz: normalize edilip clamp'lendikten sonra
        // alçak geçiren filtreden geçer. Ani yön değişiminde sert sıçrama
        // olmamasının ve gövdenin titrememesinin nedeni budur.
        dragSmoothVx.value += (clampedX - dragSmoothVx.value) * DRAG_VELOCITY_SMOOTHING;
        dragSmoothVy.value += (clampedY - dragSmoothVy.value) * DRAG_VELOCITY_SMOOTHING;
        const vx = dragSmoothVx.value;
        const vy = dragSmoothVy.value;
        // Gövde hareketin TERSİNE geride kalır. Dönüş merkezi kafa bölgesinde
        // olduğu için asıl sarkaç etkisini eğim üretir; gecikme ona ağırlık
        // katar ve dikeyde bilinçli olarak daha küçüktür. Sınırlar `mascotSize`
        // ile ölçeklendiği için kompakt modda da aynı oranda okunur.
        dragTargetLagX.value = -vx * dragLagXMax.value;
        dragTargetLagY.value = -vy * dragLagYMax.value;
        /**
         * Sağa sürüklerken gövdenin altı sola kalır (saat yönü pozitif).
         *
         * Eğim, gecikmeden **ayrı** bir duyarlılık eğrisi kullanır: hafif
         * sıkıştırma orta hızlardaki açıyı görünür kılarken tepeyi korur.
         * Gecikme, yön ve duruş tespiti doğrusal `vx`'i kullanmaya devam eder.
         */
        const tiltInput =
          vx < 0 ? -Math.pow(-vx, DRAG_TILT_CURVE) : Math.pow(vx, DRAG_TILT_CURVE);
        dragTargetTilt.value = tiltInput * DRAG_TILT_MAX;

        // Parmak yeniden hareket ettiyse kurtulma gerilmesi anında iptal olur.
        if (idleWiggleActive.value) {
          idleWiggleActive.value = false;
          cancelAnimation(idleWiggle);
          idleWiggle.value = withTiming(0, { duration: IDLE_WIGGLE_RELEASE });
        }

        // Hareket ediyor/duruyor: yalnızca bu ikili durum gerçekten
        // DEĞİŞTİĞİNDE JS'e atlanır, her karede değil. Böylece pan boyunca
        // React state fırtınası olmaz.
        const nextDirection = vx > DRAG_STILL_THRESHOLD ? 1 : vx < -DRAG_STILL_THRESHOLD ? -1 : 0;
        if (nextDirection !== dragDirectionShared.value) {
          const previous = dragDirectionShared.value;
          dragDirectionShared.value = nextDirection;
          if (nextDirection === 0 && previous !== 0) {
            // Hareket durdu: gövde parmağa YETİŞİR — nötrü son hareket yönünde
            // biraz aşar, sonra sakinleşir. Eğim ve gecikme aynı diziyi
            // paylaşır, böylece tek ve okunur bir savrulma olur. Bu bir döngü
            // değildir; yalnızca duruşa geçişte bir kez oynar.
            dragTargetTilt.value = withSequence(
              withTiming(-previous * DRAG_RECOIL_TILT, { duration: DRAG_RECOIL_IN }),
              withTiming(0, { duration: DRAG_RECOIL_OUT }),
            );
            dragTargetLagX.value = withSequence(
              withTiming(previous * dragRecoilLag.value, { duration: DRAG_RECOIL_IN }),
              withTiming(0, { duration: DRAG_RECOIL_OUT }),
            );
            // Filtre de sıfırlanır: aksi hâlde bir sonraki karede eski hız
            // savrulmanın üzerine yazardı.
            dragSmoothVx.value = 0;
            dragSmoothVy.value = 0;
          }
        }

        const nextMoving =
          Math.abs(vx) > DRAG_STILL_THRESHOLD || Math.abs(vy) > DRAG_STILL_THRESHOLD ? 1 : 0;
        if (nextMoving !== dragMovingShared.value) {
          dragMovingShared.value = nextMoving;
          runOnJS(handleDragMotionChange)(nextMoving === 1);
        }
      })
      .onEnd(() => {
        // Bayrak önce düşürülür: `.onFinalize` bunu görüp ikinci kez
        // temizlik yapmaz, `handleDragEnd` yalnızca bir kez çalışır.
        isPanActive.value = false;
        // Kenara yerleşme YALNIZCA gerçek sürüklemede olur. Okşamada ve karar
        // verilmemiş harekette Rosea hiç kıpırdamadığı için yerleştirilecek
        // bir şey yoktur; bırakma da hiçbir tepki üretmez.
        if (petMode.value === MODE_DRAGGING) settleToEdge();
        endPetSession();
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
        if (petMode.value === MODE_DRAGGING) settleToEdge();
        endPetSession();
      });

    /**
     * Çift dokunma artık **hiçbir tepki üretmez.** Sevme tepkisi okşama
     * hareketine taşındı.
     *
     * Buna rağmen tanıyıcı kaldırılmadı, çünkü tek işlevi kalmaya devam ediyor:
     * çift dokunmayı **tüketmek**. Kaldırılsaydı iki hızlı dokunuş tek dokunma
     * olarak iki kez çalışır ve arka arkaya iki mesaj balonu açardı. Şimdi çift
     * dokunma ne kalp, ne balon, ne sıçrama üretir — sessizce yutulur.
     */
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(400)
      // İki dokunuş arasındaki en uzun bekleme; bundan uzunsa tek dokunma sayılır.
      .maxDelay(260)
      .onEnd(() => {
        // Bilinçli olarak boş.
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
    dragDirectionShared,
    dragLagXMax,
    dragLagYMax,
    dragMovingShared,
    dragRecoilLag,
    dragSmoothVx,
    dragSmoothVy,
    dragTargetLagX,
    dragTargetLagY,
    dragTargetTilt,
    gestureStartX,
    gestureStartY,
    handleDragMotionChange,
    idleWiggle,
    idleWiggleActive,
    reduceMotionShared,
    handleDragStart,
    handleTap,
    isPanActive,
    peekEdgeShared,
    dragOffsetX,
    dragOffsetY,
    handlePetLove,
    petAxisSign,
    petLastBurstAt,
    petLastStepAt,
    petStrokeSinceBurst,
    petLastX,
    petLastY,
    petMaxExcursion,
    petMode,
    petPath,
    petReversals,
    petStartedAt,
    positionX,
    positionY,
    reactionScale,
    startSettleToEdge,
  ]);

  const positionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: positionX.value }, { translateY: positionY.value }],
  }));

  /** Rosea'yı mevcut kenar yönünde dışarı taşıyan, konumdan bağımsız katman. */
  const coachHandoffStyle = useAnimatedStyle(() => {
    const edge = peekEdgeShared.value;
    const distance = coachHandoffProgress.value * COACH_HANDOFF_DISTANCE;
    return {
      opacity: interpolate(coachHandoffProgress.value, [0, 0.88, 1], [1, 1, 0]),
      transform: [
        { translateX: edge === 'left' ? -distance : edge === 'right' ? distance : 0 },
        { translateY: edge === 'top' ? -distance : edge === 'bottom' ? distance : 0 },
      ],
    };
  });

  /**
   * Kenardan bakma katmanı. İşaret vektörün içinde taşındığı için burada
   * hiçbir yön hesabı yapılmaz — orta çizgi veya köşe geçilse bile sıçrama
   * oluşamaz.
   */
  /**
   * Hedef değerler yaya bağlanır: hareket dururken gövde son yöne doğru küçük
   * bir atalet yapıp merkeze döner. Tamamı UI thread'de çalışır.
   */
  const dragLagX = useDerivedValue(() => withSpring(dragTargetLagX.value, DRAG_PHYSICS_SPRING));
  const dragLagY = useDerivedValue(() => withSpring(dragTargetLagY.value, DRAG_PHYSICS_SPRING));
  const dragTilt = useDerivedValue(() => withSpring(dragTargetTilt.value, DRAG_PHYSICS_SPRING));

  /**
   * Sürükleme fiziği katmanı: görsel gecikme + eğim + havada kıpırdanma.
   * Kenar rotasyonunun DIŞINDADIR, bu yüzden değerler ekran uzayındadır
   * (sürükleme sırasında maskot zaten dik durur). Konum ve peek katmanlarına
   * hiç yazmaz.
   */
  const dragPhysicsStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragLagX.value },
      { translateY: dragLagY.value },
      // Sürükleme eğimi ve havada kurtulma gerilmesi **ayrı** shared value'lar
      // olduğu için birbirlerini ezmezler; yalnızca burada toplanırlar.
      { rotate: `${dragTilt.value + idleWiggle.value}deg` },
    ],
  }));

  /**
   * Kenara yürüyüş katmanı. Kenar rotasyonunun DIŞINDA durur; yolculuk sırasında
   * `edgeRotation` zaten 0'dır (tam görünürlük), yolculuk bitince bu katman 0'a
   * dönüp sahneyi kenar rotasyonuna bırakır. İkisi asla aynı değeri yazmaz.
   *
   * Dönüş ÖNCE yazılır, bu yüzden `translateY` karakterin kendi ekseninde
   * uygulanır: bob, hangi kenara gidiyor olursa olsun gövdenin baş-kuyruk
   * yönünde bir adım salınımı gibi okunur. Bob ve salınım tek `travelGait`
   * değerinden türediği için faz kayması imkânsızdır.
   */
  const travelStyle = useAnimatedStyle(() => {
    const gait = travelGait.value;
    return {
      transform: [
        {
          rotate: `${
            travelRotation.value + interpolate(gait, [0, 1], [-TRAVEL_SWAY, TRAVEL_SWAY])
          }deg`,
        },
        { translateY: interpolate(gait, [0, 1], [TRAVEL_BOB, -TRAVEL_BOB]) },
      ],
    };
  });

  const peekStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: peekOffsetX.value }, { translateY: peekOffsetY.value }],
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

  /** Uyku katmanı: yalnızca nefes ölçeği. Konum ve rotasyona dokunmaz. */
  const sleepStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sleepScale.value }],
  }));

  /**
   * Uyanık nefes katmanı: yalnızca küçük `scaleX`/`scaleY`. Konum, peek ve
   * rotasyon değerlerine hiç dokunmaz; diğer katmanların transform dizilerini
   * ezmez.
   *
   * Ölçek merkezi kutunun **alt kenarındadır** (`styles.breathOrigin`). Bu
   * katman kenar rotasyonunun içinde olduğu için "alt", maskot hangi kenarda
   * olursa olsun karakterin yüzeyin arkasında kalan kuyruk ucudur: nefes
   * gövdeyi ekranın içine doğru genişletir, kenardan kopuyormuş gibi
   * görünmez.
   */
  const awakeBreathStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: interpolate(awakeBreathProgress.value, [0, 1], [1, AWAKE_BREATH_SCALE_X]) },
      { scaleY: interpolate(awakeBreathProgress.value, [0, 1], [1, AWAKE_BREATH_SCALE_Y]) },
    ],
  }));

  /**
   * Uykuya hazırlanma katmanı: yalnızca `scaleX`/`scaleY`. Uyanık ve uyku
   * nefeslerinin değerlerine dokunmaz; ölçek merkezi aynı biçimde gizli kuyruk
   * ucundadır, bu yüzden esneme gövdeyi ekranın içine doğru uzatır.
   */
  const drowsyStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: interpolate(drowsyProgress.value, [0, 1], [1, DROWSY_SCALE_X]) },
      { scaleY: interpolate(drowsyProgress.value, [0, 1], [1, DROWSY_SCALE_Y]) },
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

  // İfade tek noktadan, saf bir seçiciyle çözülür. Burada rastgelelik yoktur:
  // mesajın ifadesi zaten dokunma anında `tapPresentation` içinde seçilmiştir.
  // Erken `return`'den ÖNCE hesaplanır, çünkü göz kırpma koşulu buna bakar ve
  // hook'lar koşullu dönüşün üstünde kalmalıdır.
  const expression = resolveMascotExpression({
    activeReactionType: activeReaction?.type,
    bubbleExpression: resolveBubbleExpression(bubbleVariant, tapPresentation),
    isAsleep,
    isDrowsy,
    isSettling,
    isDragging: isDraggingRef.current,
    isThinking,
    state,
  });

  /**
   * Göz kırpma yalnızca maskot gerçekten uyanık ve boşta beklerken çalışır.
   * Tek bir yerde toplanan bu koşul bozulduğu anda hook animasyonu iptal eder
   * ve görsel mevcut gerçek ifadeye döner.
   *
   * `state === 'idle'` sürükleme, kutlama, tek dokunma ve düşünme durumlarını
   * birlikte eler; `expression === 'happy'` ise uyku, thinking, mischievous,
   * smug ve celebrating karelerinin üzerine blink binmesini engeller. Aktif
   * balonun ifadesi `happy` dışında bir şeyse yine devre dışı kalır.
   */
  const canBlink =
    !isHidden &&
    !reduceMotion &&
    !isAsleep &&
    // Uykuya hazırlanırken göz kırpma durur; ifade zaten `sleepy` olduğu için
    // `expression === 'happy'` koşulu da bunu ayrıca kapatır.
    !isDrowsy &&
    !isSettling &&
    !isThinking &&
    !activeReaction &&
    state === 'idle' &&
    expression === 'happy';

  const { frame: blinkFrame, isInstant: isBlinkInstant } = useMascotBlink({ canBlink });

  /**
   * Kısa crossfade yalnızca **pitch ara kareleri** için kullanılır: onlar
   * 100 ms ekranda kalır ve daha uzun bir geçiş kareleri birbirine bulandırır.
   *
   * `back` karesi bilinçli olarak bunun dışındadır. Artık iki ayrı arkın sonu
   * olabiliyor (üst kenarın yaw arkı ve alt kenarın pitch arkı) ve her iki
   * durumda da yolculuk boyunca ekranda kaldığı için normal ifade geçişi
   * yeterlidir — bulanma riski yoktur, ayrıca ayrım için ekstra state
   * tutulması gerekmez.
   */
  const isPitchTurnFrame = turnFrame !== undefined && isMascotPitchFrame(turnFrame);

  const isLivingInCoachAvatar =
    enabled && pathname === '/coach' && coachHandoffPhase === 'chat';

  if (isHidden || isLivingInCoachAvatar) return null;

  // Yalnızca normal dokunma balonunda AI Koç CTA'sı bulunur.
  // Normal dokunma balonunda ekrana özel mesaj gösterilir. `tapMessage`
  // dokunma anında seçilir; `undefined` ise balon `mascot.bubbleMessage`
  // fallback'ini kullanır.
  const bubbleMessage =
    bubbleVariant === 'celebration'
      ? t('mascot.celebrationMessage')
      : bubbleVariant === 'love'
        ? t('mascot.lovedMessage')
        : tapPresentation?.message;

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
        <Animated.View
          pointerEvents="box-none"
          style={[styles.coachHandoffLayer, coachHandoffStyle]}>
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
            Kalıcı konum → Kenardan bakma → Sürükleme fiziği (kafa pivotu)
            → Kenara yürüyüş → Kenar yönü → Düşünme → Uyku nefesi
            → Uykuya hazırlanma → Uyanık nefesi → Tepki → Görsel.
            Her katman yalnızca kendi transform'unu sürer, hiçbiri diğerini ezmez.
            Balon ve partiküller dönüş katmanlarının dışındadır: hiç dönmezler.
            Dokunma hedefi peek katmanının içindedir, yani karakterle birlikte
            hareket eder ve gizlenen kısmı konteynerin dışında kalır. */}
          <Animated.View pointerEvents="box-none" style={[styles.peekLayer, peekStyle]}>
            <GestureDetector gesture={gesture}>
              <Animated.View
                accessible
                accessibilityHint={t('mascot.accessibilityHint')}
                accessibilityLabel={t('mascot.accessibilityLabel', { name: MASCOT_NAME })}
                accessibilityRole="button"
                onAccessibilityTap={handleTap}
                style={styles.touchTarget}>
              {/* Sürükleme fiziği kenar rotasyonunun dışındadır: değerler
                  ekran uzayındadır ve dokunma hedefini etkilemez. Dönüş
                  merkezi karakterin kafa bölgesindedir. */}
              <Animated.View style={[dragPivotStyle, dragPhysicsStyle]}>
                {/* Kenara yürüyüş katmanı: yalnızca yolculuk sırasında açı ve
                    ritim alır, diğer zamanlarda tam nötrdür. */}
                <Animated.View style={travelStyle}>
                  <Animated.View style={edgeRotationStyle}>
                    <Animated.View style={thinkingStyle}>
                      <Animated.View style={sleepStyle}>
                        <Animated.View style={[styles.breathOrigin, drowsyStyle]}>
                          <Animated.View style={[styles.breathOrigin, awakeBreathStyle]}>
                            <Animated.View style={reactionStyle}>
                              <Image
                                accessibilityElementsHidden
                                contentFit="contain"
                                importantForAccessibility="no"
                                // Kaynak yalnızca İKİ yoldan birine düşer: aktif
                                // dönüş/yolculuk karesi veya canonical ön görünüş
                                // (ifade + blink). Yolculuk boyunca kare sabit
                                // kalır — frame cycling yoktur.
                                // Sürükleme sırasında `resolveMascotExpression`
                                // zaten `idle` döndürür: yarı kısık gözlü, kapalı
                                // ağızlı, gülümsemeyen kare. Zorlama yapılmaz.
                                source={
                                  turnFrame
                                    ? MASCOT_TURN_SOURCES[turnFrame]
                                    : resolveMascotImageSource(expression, blinkFrame, sleepPose)
                                }
                                // Dönüş kareleri canonical ile aynı tuvale, aynı
                                // üst hizasına ve aynı görünür yüksekliğe
                                // yerleştirildiği (ölçüldü) için hiçbir ölçek
                                // veya offset telafisi uygulanmaz.
                                style={{ height: mascotSize, width: mascotSize }}
                                // Reduce Motion açıkken geçiş yok; kapalıyken yalnızca
                                // çok kısa bir crossfade. Ölçek/konum animasyonu
                                // eklenmez. Blink kareleri anlık geçer; normal ifade
                                // değişimleri ve dönüş kareleri aynı crossfade'i
                                // paylaşır — ikinci bir geçiş sistemi kurulmaz.
                                transition={
                                  reduceMotion || isBlinkInstant
                                    ? 0
                                    : isPitchTurnFrame
                                      ? PITCH_CROSSFADE_MS
                                      : EXPRESSION_CROSSFADE_MS
                                }
                              />
                            </Animated.View>
                          </Animated.View>
                        </Animated.View>
                      </Animated.View>
                    </Animated.View>
                  </Animated.View>
                </Animated.View>
              </Animated.View>
              </Animated.View>
            </GestureDetector>
          </Animated.View>
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
  coachHandoffLayer: { height: TOUCH_SIZE, width: TOUCH_SIZE },
  positionLayer: {
    height: TOUCH_SIZE,
    left: 0,
    position: 'absolute',
    top: 0,
    width: TOUCH_SIZE,
  },
  peekLayer: { height: TOUCH_SIZE, width: TOUCH_SIZE },
  /**
   * Uyanık nefesinin ölçek merkezi: kutunun alt orta noktası. Kenar
   * rotasyonunun içinde olduğu için bu nokta her zaman karakterin gizli kuyruk
   * ucudur; nefes hareketi görünen baş tarafında toplanır.
   */
  breathOrigin: { transformOrigin: 'center bottom' },
  touchTarget: {
    alignItems: 'center',
    height: TOUCH_SIZE,
    justifyContent: 'center',
    width: TOUCH_SIZE,
  },
});
