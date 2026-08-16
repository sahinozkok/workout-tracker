import { MascotBlinkFrame } from '@/hooks/use-mascot-blink';
import { MascotReactionType, MascotState } from '@/types/mascot';
import { MascotDailyContext } from '@/utils/mascot-daily-context';

export type MascotExpression =
  | 'idle'
  | 'smug'
  | 'happy'
  | 'thinking'
  | 'celebrating'
  | 'sleepy'
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
  mischievous: require('../../assets/images/mascot/mascot-mischievous.png'),
};

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
 * Gösterilecek görseli tek noktadan çözer. Saf fonksiyondur.
 *
 * Göz kırpma **yalnızca** `happy` ifadesinin üzerine biner: uyku, düşünme,
 * sürükleme, mischievous, smug ve celebrating kareleri hiçbir koşulda blink
 * karesiyle değiştirilmez. Çağıran taraf zaten aynı koşulu uyguluyor; buradaki
 * kontrol ikinci bir güvenlik katmanıdır.
 */
export function resolveMascotImageSource(
  expression: MascotExpression,
  blinkFrame: MascotBlinkFrame,
): number {
  if (expression === 'happy' && blinkFrame !== 'open') return MASCOT_BLINK_SOURCES[blinkFrame];
  return MASCOT_EXPRESSION_SOURCES[expression];
}

/** Tek seferlik tepkilerin ifadeleri. */
const REACTION_EXPRESSION: Record<MascotReactionType, MascotExpression> = {
  loved: 'happy',
  'set-complete': 'mischievous',
  'workout-complete': 'celebrating',
};

/** Ana Sayfa günlük bağlamlarının ifadeleri. */
const DAILY_EXPRESSION: Record<MascotDailyContext['kind'], MascotExpression> = {
  'no-active-program': 'mischievous',
  paused: 'mischievous',
  partial: 'mischievous',
  'scheduled-single': 'mischievous',
  'scheduled-multiple': 'mischievous',
  running: 'smug',
  completed: 'happy',
  'completed-streak': 'happy',
  rest: 'sleepy',
  'no-schedule': 'sleepy',
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
  isDragging,
  isThinking,
  state,
}: ExpressionInput): MascotExpression {
  if (isDragging || state === 'dragging') return 'idle';
  if (activeReactionType) return REACTION_EXPRESSION[activeReactionType];
  if (isThinking) return 'thinking';
  if (bubbleExpression) return bubbleExpression;
  if (isAsleep) return 'sleepy';

  if (state === 'celebrating') return 'celebrating';
  if (state === 'thinking') return 'thinking';
  if (state === 'happy') return 'happy';
  // Normal boşta duruş sakin ve hafif gülümseyen yüzü kullanır.
  if (state === 'idle') return 'happy';

  return 'idle';
}
