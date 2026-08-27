import { MascotBlinkFrame } from '@/hooks/use-mascot-blink';
import { MascotEdge, MascotReactionType, MascotState } from '@/types/mascot';
import { MascotDailyContext } from '@/utils/mascot-daily-context';

export type MascotExpression =
  | 'idle'
  | 'smug'
  | 'happy'
  | 'thinking'
  | 'celebrating'
  | 'sleepy'
  | 'yawning'
  | 'mischievous';

/**
 * Bütün `require` çağrıları statik ve açıktır; Metro dinamik yol çözemediği
 * için hiçbir koşulda yol birleştirmesi yapılmaz. Görsellerin hepsi aynı
 * 584 × 512 şeffaf tuvale sahip olduğu için kaynak değişimi layout'u oynatmaz.
 */
export const MASCOT_EXPRESSION_SOURCES: Record<MascotExpression, number> = {
  idle: require('../../assets/images/mascot/mascot-idle.png'),
  smug: require('../../assets/images/mascot/mascot-smug.png'),
  happy: require('../../assets/images/mascot/mascot-happy.png'),
  thinking: require('../../assets/images/mascot/mascot-thinking.png'),
  celebrating: require('../../assets/images/mascot/mascot-celebrating.png'),
  sleepy: require('../../assets/images/mascot/mascot-sleepy.png'),
  yawning: require('../../assets/images/mascot/mascot-yawning.png'),
  mischievous: require('../../assets/images/mascot/mascot-mischievous.png'),
};

/**
 * NOT — eski locomotion kareleri **runtime'da kullanılmaz.**
 *
 * `rosea-back-run-*`, `rosea-back-mid-*`, `rosea-back-pass-*`,
 * `rosea-body-sway-*`, `rosea-reach-*` ve `rosea-tail-kick-*` PNG'leri ayrı ayrı
 * üretildiği için kareler arasında kafa büyüklüğü, gövde uzunluğu, kuyruk
 * biçimi, silüet ve renk tonu birebir tutmuyordu; kare animasyonu teknik olarak
 * çalışsa bile Rosea hareket ederken biçim değiştiriyordu.
 *
 * Aşağıdaki **yedi dönüş karesi** bu sorundan bağımsızdır: hepsi 584 × 512
 * tuvalde, canonical `mascot-idle.png` ile **aynı üst hizasında (26 px) ve aynı
 * görünür yükseklikte (459 px)** üretildi. Ölçüldü ve doğrulandı — bu yüzden
 * ölçek/offset telafisi uygulanmaz. Genişliğin dönüşle daralması (yandan
 * görünüşte 286 px) hizalama hatası değil, gövdenin gerçekten dönmesidir.
 *
 * Sağdaki kareler soldakilerin **piksel-tam aynasıdır** (ölçülen alpha farkı 0,0),
 * bu yüzden runtime'da `scaleX: -1` gibi bir yansıtma da yapılmaz.
 */
export type MascotTurnFrame =
  // Yaw dönüşü ve yolculuk duruşları
  | 'turn-front-left'
  | 'side-left'
  | 'turn-back-left'
  | 'turn-front-right'
  | 'side-right'
  | 'turn-back-right'
  | 'back'
  // Öne/arkaya (pitch) dönüşün ara kareleri. Yalnızca üst/alt hedefin dönüş
  // aşamasında, `front → edge-on → back` sırasıyla gösterilirler; yolculuk
  // duruşu asla bunlardan biri olmaz.
  | 'pitch-front-mid'
  | 'pitch-edge'
  | 'pitch-back-mid'
  // Yalnızca yolculuk sırasında solungaç kıpırdaması. Bunlar ayrı bir duruş
  // DEĞİL, yolculuk duruşunun solungaçları oynayan varyantıdır; bu yüzden
  // ifade/blink/uyku/tepki yollarında hiçbir koşulda kullanılmazlar.
  | 'side-left-gills'
  | 'side-right-gills'
  | 'back-gills-a'
  | 'back-gills-b';

/** Statik `require` — Metro dinamik yol çözemez. */
export const MASCOT_TURN_SOURCES: Record<MascotTurnFrame, number> = {
  'turn-front-left': require('../../assets/images/mascot/rosea-turn-front-left.png'),
  'side-left': require('../../assets/images/mascot/rosea-side-left.png'),
  'turn-back-left': require('../../assets/images/mascot/rosea-turn-back-left.png'),
  'turn-front-right': require('../../assets/images/mascot/rosea-turn-front-right.png'),
  'side-right': require('../../assets/images/mascot/rosea-side-right.png'),
  'turn-back-right': require('../../assets/images/mascot/rosea-turn-back-right.png'),
  back: require('../../assets/images/mascot/rosea-back-consistent.png'),
  'pitch-front-mid': require('../../assets/images/mascot/rosea-pitch-front-mid.png'),
  'pitch-edge': require('../../assets/images/mascot/rosea-pitch-edge.png'),
  'pitch-back-mid': require('../../assets/images/mascot/rosea-pitch-back-mid.png'),
  'side-left-gills': require('../../assets/images/mascot/rosea-side-left-gills-active.png'),
  'side-right-gills': require('../../assets/images/mascot/rosea-side-right-gills-active.png'),
  'back-gills-a': require('../../assets/images/mascot/rosea-back-gills-a.png'),
  'back-gills-b': require('../../assets/images/mascot/rosea-back-gills-b.png'),
};

/**
 * Yolculuk sırasında oynayan solungaç döngüsü.
 *
 * Döngü **yalnızca** `leaving` aşamasında ve yalnızca yolculuk karesinin
 * üzerinde çalışır; karakterin duruşu, boyutu ve konumu değişmez — ölçüldü:
 * dört solungaç karesi de canonical tuvalle aynı üst hizayı (26 px) ve aynı
 * görünür yüksekliği (459 px) paylaşıyor, yalnızca solungaç genişliği 1–6 px
 * oynuyor.
 *
 * Arkadan görünüşte iki ayrı kare (`a` / `b`) dönüşümlü kullanılır: solungaç
 * grupları aynı anda değil, sırayla kıpırdar. Yan görünüşte zaten tek taraf
 * görünür olduğu için tek varyant yeterlidir.
 *
 * Yolculuk karesi bu haritada yoksa (`undefined`) döngü hiç çalışmaz.
 */
const MASCOT_GILL_CYCLES: Partial<Record<MascotTurnFrame, readonly MascotTurnFrame[]>> = {
  'side-left': ['side-left', 'side-left-gills', 'side-left'],
  'side-right': ['side-right', 'side-right-gills', 'side-right'],
  back: ['back', 'back-gills-a', 'back', 'back-gills-b'],
};

/** Verilen yolculuk karesinin solungaç döngüsü; yoksa `undefined`. */
export function resolveMascotGillCycle(
  travelFrame: MascotTurnFrame,
): readonly MascotTurnFrame[] | undefined {
  return MASCOT_GILL_CYCLES[travelFrame];
}

/**
 * Bir kenara gitmek için oynatılacak dönüş planı.
 *
 * `frames` sırayla gösterilecek karelerdir; **sonuncusu aynı zamanda yolculuk
 * karesidir** ve yolculuk boyunca hiç değişmez. `rotation` ise o kareyle
 * birlikte uygulanacak ek travel açısıdır.
 */
export type MascotTurnPlan = {
  frames: readonly MascotTurnFrame[];
  rotation: number;
  /**
   * `true` → gövde dönüşü **yan profil kareleriyle değil**, öne/arkaya (pitch)
   * ara kareleriyle anlatılır. Bu planda `rotation` kareler ilerlerken
   * animasyonlanmaz: `pitch-edge` karesi ekrandayken **atomik** uygulanır,
   * yani yön değişimi yalnızca yatay, edge-on silüet sırasında olur.
   */
  pitch?: boolean;
};

/** Pitch dönüşünün ara kareleri; yolculuk duruşu asla bunlardan biri olmaz. */
const MASCOT_PITCH_FRAMES: readonly MascotTurnFrame[] = [
  'pitch-front-mid',
  'pitch-edge',
  'pitch-back-mid',
];

/** Kare bir pitch ara karesi mi? Yalnızca crossfade süresini seçmek için. */
export function isMascotPitchFrame(frame: MascotTurnFrame): boolean {
  return MASCOT_PITCH_FRAMES.includes(frame);
}

/**
 * Hedef kenar için kaynak ve rotasyonu **birlikte** çözer. Saf fonksiyondur.
 *
 * Dört kenarın üç ayrı dönüş dili vardır:
 *   sol/sağ → yan kare + 45° eğim (havada başı önde süzülme)
 *   üst     → saf **yaw** arkı; gövde dikey eksende döner, pitch karesi YOK
 *   alt     → **pitch** arkı; gövde yatay eksende döner ve yön 180°'ye çevrilir
 */
export function resolveMascotTurnPlan(edge: MascotEdge): MascotTurnPlan {
  // Sol/sağ hedef: yana dön ve başı önde, 45° eğimle süzül. Sırt hiç görünmez.
  //
  // İşaretler görsel sonuca göre belirlendi. Yedi dönüş karesinin hepsi
  // canonical ile aynı üst hizasını (26 px) ve aynı görünür yüksekliği (459 px)
  // paylaşıyor; yani hepsi **dik duran** aynı karakterin farklı yaw açılarından
  // görünüşü — kafa her karede yukarıda. React Native'de pozitif açı saat
  // yönündedir, dolayısıyla dik bir figürü:
  //   −45° döndürmek kafayı sol-yukarı, kuyruğu sağ-aşağı taşır → sol hedef
  //   +45° döndürmek kafayı sağ-yukarı, kuyruğu sol-aşağı taşır → sağ hedef
  // Sonuç: her iki yönde de baş gidilen kenara yakın, kuyruk geride kalır.
  if (edge === 'left') return { frames: ['turn-front-left', 'side-left'], rotation: -45 };
  if (edge === 'right') return { frames: ['turn-front-right', 'side-right'], rotation: 45 };

  /**
   * Üst hedef: **saf yaw dönüşü.** Pitch kareleri burada kullanılmaz.
   *
   *   ön görünüş → `turn-front-right` → `side-right` → `turn-back-right`
   *   → `back`
   *
   * Gerekçe: pitch dizisi gövdeyi **yatay** eksende çevirir. Alt kenarda bu
   * doğru okunur, çünkü orada kafanın gerçekten aşağı dönmesi gerekir. Üst
   * kenarda ise kafa zaten hareket yönüne (yukarı) bakıyor; yatay eksende bir
   * dönüş görsel olarak gereksiz bir takla üretiyordu. Rosea'nın yalnızca
   * arkasını dönmesi gerekiyor, bu da dikey eksen (yaw) arkıdır.
   *
   * Dizi mevcut yedi dönüş karesinden seçildi ve tam bir 180° yaw arkı çizer:
   * ön → ¾ ön → tam yan profil → ¾ sırt → sırt. Ara kare atlanmadığı için
   * hiçbir noktada açı sıçraması olmaz. Sağ taraf **sabit ve deterministik**
   * seçildi; sol kareler bu karelerin piksel-tam aynası olduğu için seçim
   * tamamen estetiktir ve her üst yolculukta aynı kalması tercih edilir.
   *
   * `rotation: 0` — bütün dizi boyunca ve yolculuğun tamamında travel açısı
   * sıfırdır: Rosea ters dönmez, takla atmaz, sırtı ekrana dönük ve kafası
   * yukarı bakar hâlde üst kenara ilerler. `pitch` işareti **yoktur**, bu
   * yüzden çağıran taraf bunu normal (yaw) dönüş zinciri olarak oynatır.
   */
  if (edge === 'top') {
    return {
      frames: ['turn-front-right', 'side-right', 'turn-back-right', 'back'],
      rotation: 0,
    };
  }

  /**
   * Alt hedef: gerçek pitch dizisi. **Değişmedi.**
   *
   *   ön görünüş → `pitch-front-mid` → `pitch-edge` → `pitch-back-mid` → `back`
   *
   * Yan profil, `turn-front-*` ve `turn-back-*` kareleri **kullanılmaz** —
   * kullanıcı alt yolculukta Rosea'yı hiçbir anda yandan görmemeli. Eski
   * `scaleY` ezme illüzyonu da kaldırıldı: dönüşü yalnızca sprite kareleri
   * anlatır, karakterin boyutu ve konumu hiç değişmez.
   *
   * Üç ara kare de canonical 584 × 512 tuvali ve **aynı karakter merkezini**
   * (x = 292) paylaşır; yükseklik farkı hizalama hatası değil, gövdenin
   * gerçekten öne/arkaya dönmesidir. Bu yüzden ölçek/offset telafisi yapılmaz.
   *
   * Kafa gidilen kenara bakar: `back` karesi kafası yukarı çizili olduğu için
   * alt kenarda yarım tur gerekir. O yarım tur kullanıcıya **animasyon olarak
   * gösterilmez**; gövde `pitch-edge` karesinde yatay bir silüetken atomik
   * olarak uygulanır, yani ekranda takla görünmez.
   */
  return { frames: [...MASCOT_PITCH_FRAMES, 'back'], rotation: 180, pitch: true };
}

/**
 * Göz kırpma kareleri. Aynı 584 × 512 şeffaf tuvali kullanırlar ve karakterin
 * baş/kanat hizası `mascot-happy.png` ile eşleşecek biçimde mekanik olarak
 * hizalanmıştır; bu yüzden kare değişimi layout'u oynatmaz.
 *
 * `require` çağrıları burada da statiktir — Metro dinamik yol çözemez.
 */
const MASCOT_BLINK_SOURCES: Record<Exclude<MascotBlinkFrame, 'open'>, number> = {
  half: require('../../assets/images/mascot/rosea-blink-half.png'),
  closed: require('../../assets/images/mascot/rosea-blink-closed.png'),
};

/**
 * Uyku pozları.
 *
 * İkisi de 1339 × 1174 tuvaldedir ve bu tuval canonical 584 × 512 ile **aynı
 * en-boy oranını** (1,1406) paylaşır. `contentFit="contain"` kare kutuya
 * genişlikten sığdırdığı için ölçek/offset telafisi GEREKMEZ: dış maskot
 * çerçevesi, dokunma kutusu ve kayıtlı konum hiç değişmez.
 *
 * Uyku baloncuğu `bubble` pozunun İÇİNDE çizilidir; runtime'da ikinci bir
 * baloncuk çizilmez.
 */
export type MascotSleepPose = 'curled' | 'bubble';

/** Statik `require` — Metro dinamik yol çözemez. */
export const MASCOT_SLEEP_SOURCES: Record<MascotSleepPose, number> = {
  curled: require('../../assets/images/mascot/rosea-sleep-curled.png'),
  bubble: require('../../assets/images/mascot/rosea-sleep-bubble.png'),
};

const MASCOT_SLEEP_POSES: readonly MascotSleepPose[] = ['curled', 'bubble'];

/**
 * Uykuya GİRİŞTE bir kez çağrılır; render sırasında değil.
 *
 * Bir önceki poz havuzdan çıkarılır, böylece aynı poz arka arkaya gelmez.
 * Havuz boşalırsa (tek poz kalırsa) güvenle tam listeye dönülür.
 */
export function pickNextSleepPose(previous?: MascotSleepPose): MascotSleepPose {
  const options = MASCOT_SLEEP_POSES.filter((pose) => pose !== previous);
  const pool = options.length > 0 ? options : MASCOT_SLEEP_POSES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Gösterilecek görseli tek noktadan çözer. Saf fonksiyondur.
 *
 * Kaynak **yalnızca** ifadeden ve göz kırpma karesinden türetilir; hareket
 * (sürükleme, kenara yerleşme) hiçbir koşulda görseli değiştirmez.
 *
 * Göz kırpma **yalnızca** `happy` ifadesinin üzerine biner: uyku, düşünme,
 * sürükleme, mischievous, smug ve celebrating kareleri hiçbir koşulda blink
 * karesiyle değiştirilmez. Çağıran taraf zaten aynı koşulu uyguluyor; buradaki
 * kontrol ikinci bir güvenlik katmanıdır.
 */
export function resolveMascotImageSource(
  expression: MascotExpression,
  blinkFrame: MascotBlinkFrame,
  sleepPose?: MascotSleepPose,
): number {
  if (expression === 'happy' && blinkFrame !== 'open') return MASCOT_BLINK_SOURCES[blinkFrame];
  // Uyku pozu YALNIZCA `sleepy` ifadesinde devreye girer; esneme (`yawning`),
  // düşünme ve diğer ifadeler kendi karelerinde kalır.
  if (expression === 'sleepy' && sleepPose) return MASCOT_SLEEP_SOURCES[sleepPose];
  return MASCOT_EXPRESSION_SOURCES[expression];
}

/** Tek seferlik tepkilerin ifadeleri. */
const REACTION_EXPRESSION: Record<MascotReactionType, MascotExpression> = {
  loved: 'happy',
  'set-complete': 'mischievous',
  'workout-complete': 'celebrating',
  // Rank yükselmesi de bir kutlamadır; mevcut kutlama karesi yeniden kullanılır.
  'rank-up': 'celebrating',
};

/**
 * Ana Sayfa günlük bağlamlarının ifadeleri.
 *
 * Burada bilinçli olarak **yalnızca sakin yüzler** kullanılır: `mischievous`
 * ve `smug` kaşları çatık/sinsi okunduğu için normal bir tek dokunmada
 * kullanıcıya kızgın görünüyordu. Diğer sekmeler zaten
 * `DEFAULT_MESSAGE_EXPRESSION` (happy) kullandığından bu değişiklik onları
 * etkilemez; `mischievous` hâlâ `set-complete` tepkisinde bilinçli olarak
 * kullanılır.
 */
const DAILY_EXPRESSION: Record<MascotDailyContext['kind'], MascotExpression> = {
  'no-active-program': 'happy',
  paused: 'happy',
  partial: 'happy',
  'scheduled-single': 'happy',
  'scheduled-multiple': 'happy',
  running: 'happy',
  completed: 'happy',
  'completed-streak': 'happy',
  // Dinlenme/plansız günlerde sakin, nötr yüz.
  rest: 'idle',
  'no-schedule': 'idle',
};

/**
 * Genel route mesajlarında ve günlük bağlam üretilemediğinde kullanılır.
 * `smug` görselinin ağzı açık olduğu için burada kapalı ağızlı, hafif
 * gülümseyen `happy` tercih edilir; bilinçli seçilmiş diğer ifadeler
 * (mischievous / celebrating / thinking / sleepy) etkilenmez.
 */
export const DEFAULT_MESSAGE_EXPRESSION: MascotExpression = 'happy';

export function getDailyContextExpression(context: MascotDailyContext): MascotExpression {
  return DAILY_EXPRESSION[context.kind];
}

/**
 * Balonla birlikte seçilen sunum. Mesaj ve ifade **aynı anda, aynı nesnede**
 * belirlenir; böylece render sırasında yeniden seçim veya rastgelelik olmaz.
 */
export type MascotPresentation = {
  expression: MascotExpression;
  message?: string;
};

type ExpressionInput = {
  /** Oynamakta olan tek seferlik tepkinin türü. */
  activeReactionType?: MascotReactionType;
  /**
   * Açık balonun ifadesi. Çağıran taraf bunu balon türünden çözer:
   * `tap`/`auto` → mesajla birlikte seçilen sunum ifadesi, `love` → happy,
   * `celebration` → celebrating. Balon yoksa verilmez.
   */
  bubbleExpression?: MascotExpression;
  /**
   * Yerel uyku durumu. Uyku yalnızca sürükleme, reaction, balon, AI thinking
   * ve aktif antrenman yokken mümkün olduğu için bu bayrak onlardan sonra,
   * normal state'ten önce değerlendirilir.
   */
  isAsleep: boolean;
  /**
   * Uykuya hazırlanma (esneme) aşaması. Ayrı `yawning` görselini kullanır;
   * geçiş tamamlanınca normal `sleepy` ifadesi devralır.
   */
  isDrowsy?: boolean;
  /** Esneme bittikten sonraki iki saniyelik sakin, yarı uykulu bekleme. */
  isSettling?: boolean;
  isDragging: boolean;
  isThinking: boolean;
  state: MascotState;
};

/**
 * Görsel ifadeyi tek noktadan çözer. Saf fonksiyondur.
 *
 * Öncelik:
 *   1. Sürükleme
 *   2. Aktif reaction
 *   3. AI thinking
 *   4. Açık balonun ifadesi (tap/auto sunumu, love → happy,
 *      celebration → celebrating)
 *   5. Uyku
 *   6. Normal state
 *   7. Varsayılan idle
 *
 * Reaction balondan, sürükleme ise her şeyden yüksek önceliklidir; balon
 * kapandığında ifade normal state'e döner.
 */
export function resolveMascotExpression({
  activeReactionType,
  bubbleExpression,
  isAsleep,
  isDrowsy,
  isSettling,
  isDragging,
  isThinking,
  state,
}: ExpressionInput): MascotExpression {
  if (isDragging || state === 'dragging') return 'idle';
  if (activeReactionType) return REACTION_EXPRESSION[activeReactionType];
  if (isThinking) return 'thinking';
  if (bubbleExpression) return bubbleExpression;
  if (isDrowsy) return 'yawning';
  if (isSettling) return 'idle';
  if (isAsleep) return 'sleepy';

  if (state === 'celebrating') return 'celebrating';
  if (state === 'thinking') return 'thinking';
  if (state === 'happy') return 'happy';
  // Normal boşta duruş sakin ve hafif gülümseyen yüzü kullanır.
  if (state === 'idle') return 'happy';

  return 'idle';
}
