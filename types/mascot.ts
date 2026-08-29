/** Maskotun görsel durumu. Evcil hayvan/ilerleme sistemi bilerek yok. */
export type MascotState = 'idle' | 'dragging' | 'happy' | 'thinking' | 'celebrating';

/**
 * Tek seferlik maskot olayları. `set-complete` ve `workout-complete` ekranlardan
 * gelir; `loved` yalnızca maskota çift dokunulduğunda yerel olarak tetiklenir.
 * `rank-up`, sezon rankı yükseldiğinde kutlama katmanından **bir kez** gelir.
 * `achievement-unlock` ise başarı rozeti açıldığında rozet katmanından **bir
 * kez** gelir; rank yükselmesinden AYRI bir olaydır, böylece ikisi bağımsız
 * tetiklenebilir ve bağımsız test edilebilir.
 */
export type MascotReactionType =
  | 'set-complete'
  | 'workout-complete'
  | 'loved'
  | 'rank-up'
  | 'achievement-unlock';

/**
 * Tek seferlik tepki. `id` artan olduğu için React yeniden render olduğunda
 * aynı tepki tekrar oynatılmaz; kalıcı olarak hiçbir yere yazılmaz.
 */
export type MascotReaction = {
  id: number;
  type: MascotReactionType;
};

/**
 * Çakışma önceliği (büyükten küçüğe):
 * dragging > rank-up > achievement-unlock > workout-complete > set-complete >
 * loved > thinking > idle
 *
 * Devralma kuralı KESİN OLARAK "yalnızca daha yüksek": eşit öncelikli bir olay
 * süren tepkiyi bölemez, daha düşük öncelikli olay ise hiçbir koşulda kesemez.
 *
 * NEDEN ARTIK EŞİT DEĞİLLER — `rank-up` ve `workout-complete` daha önce ikisi
 * de 2'ydi. Antrenmanı bitirmek puan kazandırdığı için rank yükselmesi tipik
 * olarak antrenman kutlaması SÜRERKEN (1220 ms içinde) gelir; eşit öncelik
 * devralmadığından rank tepkisi sessizce düşüyordu. Tam ekran kutlama katmanı
 * yine açıldığı için hata görünmüyordu, ama Rosea uygulamanın en büyük anına
 * hiç tepki vermiyordu. Sıralama artık ayrık: rank yükselmesi antrenman
 * kutlamasını devralır, tersi olmaz.
 *
 * `achievement-unlock` rank ile antrenman arasındadır: rozet, antrenman
 * kutlamasını devralabilir ama bir rank yükselmesini bölemez. Bu, tam ekran
 * katmanların `RANK_OVERLAY_PRIORITY` sırasıyla (rank-up > season-recap >
 * achievement) tutarlıdır.
 *
 * `loved` en düşük tepki önceliğidir: süren bir kutlamayı veya set sevinmesini
 * asla bölemez, buna karşılık antrenman olayları sevme tepkisini devralabilir.
 */
export const MASCOT_REACTION_PRIORITY: Record<MascotReactionType, number> = {
  'rank-up': 4,
  'achievement-unlock': 3,
  'workout-complete': 2,
  'set-complete': 1,
  loved: 0,
};

/** Maskotun yaslanabileceği dört ekran kenarı. */
export type MascotEdge = 'left' | 'right' | 'top' | 'bottom';

const MASCOT_EDGES: MascotEdge[] = ['left', 'right', 'top', 'bottom'];

/**
 * Konum çözünürlükten bağımsız saklanır: ham piksel koordinatı kaydedilirse
 * farklı ekran boyutunda maskot güvenli alanın dışına düşerdi.
 */
export type MascotPosition = {
  edge: MascotEdge;
  /**
   * Kenar boyunca kullanılabilir alandaki oran; her zaman 0–1.
   * left/right için dikey, top/bottom için yatay konumu belirler.
   */
  edgeRatio: number;
};

export const DEFAULT_MASCOT_POSITION: MascotPosition = {
  edge: 'right',
  edgeRatio: 0.72,
};

/**
 * Peek durumunda kenara göre temel dönüş (derece, saat yönü pozitif).
 * Kaynak görselde karakter dik durur: kafa üstte, gövdenin altı aşağıda.
 * Hedef her kenarda gövdenin altını yüzeyin arkasına, kafayı ekranın içine
 * bakacak biçimde çevirmektir.
 */
export const MASCOT_EDGE_ROTATION: Record<MascotEdge, number> = {
  left: 90, // gövde altı solda gizli, kafa sağa (içeri) bakar
  right: -90, // gövde altı sağda gizli, kafa sola (içeri) bakar
  top: 180, // ters durur; gövde altı yukarıda gizli, kafa aşağı bakar
  bottom: 0, // normal dik; gövde altı aşağıda gizli, kafa yukarı bakar
};

/** left/right dikey eksende, top/bottom yatay eksende konumlanır. */
export function isVerticalEdge(edge: MascotEdge) {
  return edge === 'left' || edge === 'right';
}

export function clampEdgeRatio(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MASCOT_POSITION.edgeRatio;
  return Math.min(1, Math.max(0, value));
}

/**
 * Bilinmeyen/bozuk AsyncStorage içeriğini güvenli bir konuma indirger ve
 * **eski iki kenarlı biçimi** yeni dört kenarlı biçime taşır.
 *
 * Eski kayıt: `{ side: 'left' | 'right', verticalRatio: number }`
 * Yeni kayıt: `{ edge: MascotEdge, edgeRatio: number }`
 *
 * Aynı AsyncStorage anahtarı kullanılmaya devam eder; mevcut kullanıcının
 * konumu güncelleme sonrası kaybolmaz ve bir kez yeni biçimde kaydedildikten
 * sonra yeni biçimden okunur.
 */
export function normalizeMascotPosition(value: unknown): MascotPosition {
  if (!value || typeof value !== 'object') return DEFAULT_MASCOT_POSITION;

  const candidate = value as Record<string, unknown>;

  // Yeni biçim önceliklidir; yoksa eski `side` alanı kenara çevrilir.
  const edge = MASCOT_EDGES.includes(candidate.edge as MascotEdge)
    ? (candidate.edge as MascotEdge)
    : candidate.side === 'left'
      ? 'left'
      : candidate.side === 'right'
        ? 'right'
        : DEFAULT_MASCOT_POSITION.edge;

  // Yeni `edgeRatio` yoksa eski `verticalRatio` aynı anlamda kullanılır.
  const rawRatio =
    typeof candidate.edgeRatio === 'number'
      ? candidate.edgeRatio
      : typeof candidate.verticalRatio === 'number'
        ? candidate.verticalRatio
        : DEFAULT_MASCOT_POSITION.edgeRatio;

  return { edge, edgeRatio: clampEdgeRatio(rawRatio) };
}
