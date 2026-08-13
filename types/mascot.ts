/** Aşama 1 maskot durumları. Evcil hayvan/ilerleme sistemi bilerek yok. */
export type MascotState = 'idle' | 'dragging' | 'happy';

/** Maskotun yaslandığı ekran kenarı. */
export type MascotSide = 'left' | 'right';

/**
 * Konum çözünürlükten bağımsız saklanır: ham piksel koordinatı kaydedilirse
 * farklı ekran boyutunda maskot güvenli alanın dışına düşerdi.
 */
export type MascotPosition = {
  side: MascotSide;
  /** Kullanılabilir dikey alan içindeki oran; her zaman 0–1 arasına sıkıştırılır. */
  verticalRatio: number;
};

export const DEFAULT_MASCOT_POSITION: MascotPosition = {
  side: 'right',
  verticalRatio: 0.72,
};

export function clampVerticalRatio(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MASCOT_POSITION.verticalRatio;
  return Math.min(1, Math.max(0, value));
}

/** Bilinmeyen/bozuk AsyncStorage içeriğini güvenli bir konuma indirger. */
export function normalizeMascotPosition(value: unknown): MascotPosition {
  if (!value || typeof value !== 'object') return DEFAULT_MASCOT_POSITION;

  const candidate = value as Partial<MascotPosition>;
  const side: MascotSide = candidate.side === 'left' ? 'left' : 'right';

  return {
    side,
    verticalRatio: clampVerticalRatio(
      typeof candidate.verticalRatio === 'number'
        ? candidate.verticalRatio
        : DEFAULT_MASCOT_POSITION.verticalRatio,
    ),
  };
}
