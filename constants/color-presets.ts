/**
 * ÖZELLİK BAZLI RENK ÖN AYARLARI
 *
 * Bu dosya global temadan (`constants/theme.ts`) BAĞIMSIZDIR ve onu asla
 * değiştirmez. Amaç, uygulamanın belirli bölümlerindeki *vurgu* rengini
 * kullanıcının seçebilmesidir; yüzeyler, arka planlar, metin renkleri ve
 * disiplin/semantik renkler global temadan gelmeye devam eder.
 *
 * TASARIM KARARI — "seçilmemiş" durumu:
 *   Her özellik tercihi `undefined` olabilir ve varsayılan budur. `undefined`
 *   iken ekranlar BUGÜNKÜ renklerini birebir kullanmaya devam eder; hiçbir
 *   piksel değişmez. Renk yalnızca kullanıcı açıkça bir ön ayar seçtiğinde
 *   uygulanır. Böylece "varsayılan görünüm korunmalı" şartı tahmine değil,
 *   yapısal garantiye dayanır.
 */

/** Sabit allowlist. Kullanıcı serbest hex yazamaz; yalnızca bu ID'ler geçerlidir. */
export const COLOR_PRESETS = {
  // --- Orange
  orange: '#FFA500',
  orangeDeep: '#EE9A00',
  orangeDark: '#CD8500',
  darkOrange: '#FF8C00',
  darkOrangeVivid: '#FF7F00',
  workoutOrange: '#FF9138',
  // --- Red
  softCoral: '#E58370',
  coral: '#FF7F50',
  salmon: '#FF8C69',
  tomato: '#FF6347',
  red: '#FF0000',
  crimson: '#DC143C',
  brickRed: '#CD3333',
  // --- Pink
  deepPink: '#FF1493',
  hotPink: '#FF69B4',
  pink: '#FFC0CB',
  paleVioletRed: '#DB7093',
  // --- Purple
  mediumOrchid: '#BA55D3',
  darkOrchid: '#9932CC',
  blueViolet: '#8A2BE2',
  mediumPurple: '#9370DB',
  purple: '#A020F0',
  socialPurple: '#A472F0',
  // --- Blue
  systemBlue: '#007AFF',
  dodgerBlue: '#1E90FF',
  royalBlue: '#4169E1',
  cornflowerBlue: '#6495ED',
  steelBlue: '#4682B4',
  skyBlue: '#87CEEB',
  // --- Cyan / Teal
  darkTurquoise: '#00CED1',
  turquoise: '#40E0D0',
  mediumTurquoise: '#48D1CC',
  teal: '#008080',
  // --- Green
  springGreen: '#00CD66',
  mediumSeaGreen: '#3CB371',
  forestGreen: '#228B22',
  seaGreenLight: '#54FF9F',
  disciplineGreen: '#30D158',
  // --- Gold
  gold: '#FFD700',
  goldDeep: '#FFC125',
  goldenRod: '#DAA520',
  // --- Brown / Neutral
  brown: '#A52A2A',
  saddleBrown: '#8B4513',
  rosyBrown: '#BC8F8F',
  slateGray: '#708090',
  /**
   * Profil ekranının BUGÜNKÜ vurgu tonu (seviye rozeti ve ilerleme halkası).
   * Havuzda bulunmadığı için audit sonucunda eklendi; profilin sunucuda
   * saklanan varsayılanı budur.
   */
  profileClay: '#D5755B',
} as const;

export type ColorPresetId = keyof typeof COLOR_PRESETS;

export type ColorPresetFamily =
  | 'orange'
  | 'red'
  | 'pink'
  | 'purple'
  | 'blue'
  | 'cyan'
  | 'green'
  | 'gold'
  | 'neutral';

/** Modal ızgarasının sırası. Aile başlıkları çeviri anahtarlarından gelir. */
export const COLOR_PRESET_FAMILIES: { family: ColorPresetFamily; presets: ColorPresetId[] }[] = [
  { family: 'orange', presets: ['orange', 'orangeDeep', 'orangeDark', 'darkOrange', 'darkOrangeVivid', 'workoutOrange'] },
  { family: 'red', presets: ['softCoral', 'coral', 'salmon', 'tomato', 'red', 'crimson', 'brickRed'] },
  { family: 'pink', presets: ['deepPink', 'hotPink', 'pink', 'paleVioletRed'] },
  { family: 'purple', presets: ['mediumOrchid', 'darkOrchid', 'blueViolet', 'mediumPurple', 'purple', 'socialPurple'] },
  { family: 'blue', presets: ['systemBlue', 'dodgerBlue', 'royalBlue', 'cornflowerBlue', 'steelBlue', 'skyBlue'] },
  { family: 'cyan', presets: ['darkTurquoise', 'turquoise', 'mediumTurquoise', 'teal'] },
  { family: 'green', presets: ['springGreen', 'mediumSeaGreen', 'forestGreen', 'seaGreenLight', 'disciplineGreen'] },
  { family: 'gold', presets: ['gold', 'goldDeep', 'goldenRod'] },
  { family: 'neutral', presets: ['brown', 'saddleBrown', 'rosyBrown', 'slateGray', 'profileClay'] },
];

/** Ayarlanabilir yedi alan. */
export const COLOR_FEATURES = [
  'workoutDays',
  'activeWorkoutPrimary',
  'activeWorkoutSecondary',
  'historyProgress',
  'roseaChat',
  'profile',
  'friends',
  /** Yalnızca "bugün" göstergeleri: takvim çemberi, bugün etiketi, seçili sekme. */
  'todayHighlight',
  /** Geçmiş → Antrenmanlar görünümündeki üç istatistik çemberi (ayrı ayrı). */
  'historyWorkoutsRing',
  'historyExercisesRing',
  'historyDurationRing',
  /** Ayarlar ekranının olumlu/aktif kontrolleri (dil, tema, switch'ler). */
  'settings',
] as const;

export type ColorFeature = (typeof COLOR_FEATURES)[number];

/**
 * Profil rengi sunucuda saklanır ve arkadaşlara gösterilir; bu yüzden
 * `undefined` olamaz, gerçek bir varsayılana sahiptir (bugünkü profil tonu).
 */
export const DEFAULT_PROFILE_COLOR_PRESET: ColorPresetId = 'profileClay';

/** Bilinmeyen/eski ID'ler sessizce düşürülür — çökme veya rastgele renk yok. */
export function isColorPresetId(value: unknown): value is ColorPresetId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COLOR_PRESETS, value);
}

export function parseColorPresetId(value: unknown): ColorPresetId | undefined {
  return isColorPresetId(value) ? value : undefined;
}

/** Profil için: geçersizse bugünkü varsayılana döner. */
export function parseProfileColorPresetId(value: unknown): ColorPresetId {
  return parseColorPresetId(value) ?? DEFAULT_PROFILE_COLOR_PRESET;
}

export function getColorPresetHex(presetId: ColorPresetId) {
  return COLOR_PRESETS[presetId];
}

/**
 * Renk üzerindeki metin/ikon rengi.
 *
 * WCAG'ın göreli parlaklık (relative luminance) formülü kullanılır; sabit
 * beyaz/siyah YAZILMAZ. Açık sarı/turuncuda siyah, koyu tonlarda beyaz çıkar.
 * Eşik 0.5 yerine 0.42: orta tonlarda beyaz metin daha güvenli okunur.
 */
export function getOnAccentColor(hex: string) {
  return getRelativeLuminance(hex) > 0.42 ? '#000000' : '#FFFFFF';
}

export function getRelativeLuminance(hex: string) {
  const [red, green, blue] = hexToRgb(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((character) => character + character)
          .join('')
      : normalized;

  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

/**
 * Bir özelliğin BUGÜNKÜ (kullanıcı seçim yapmadığındaki) rengi.
 *
 * Audit ile kaynak dosyalardan tespit edildi; tahmin YOKTUR:
 *   * workoutDays              → `WORKOUT_ORANGE` (#FF9138)
 *   * activeWorkoutPrimary     → `colors.text` — "Seti tamamla" düğmesi bugün
 *     tek renk (siyah/beyaz) zeminlidir, mavi DEĞİLDİR.
 *   * activeWorkoutSecondary   → `colors.primary` (sistem mavisi)
 *   * historyProgress          → `colors.disciplineCompleted` (yeşil)
 *   * roseaChat                → `colors.primary` (mavi)
 *   * profile                  → #D5755B (seviye rozeti / ilerleme halkası)
 *   * friends                  → friends-theme accent (koyu #A472F0, açık #7A3FE0)
 *   * todayHighlight           → `colors.primary` (bugün çemberi/etiketi, seçili sekme)
 *   * historyWorkoutsRing      → `colors.primary`
 *   * historyExercisesRing     → `colors.disciplineCompleted`
 *   * historyDurationRing      → `colors.accent`
 *   * settings                 → Ayarlar moru (koyu #CBB4F2, açık #60458A)
 *
 * Tema bağımlı olanlar `colors` üzerinden gelir; böylece açık/koyu tema
 * davranışı hiçbir şekilde değişmez.
 */
export function getFeatureFallbackColor(
  feature: ColorFeature,
  colors: { text: string; primary: string; disciplineCompleted: string; accent: string },
  isDark: boolean,
) {
  switch (feature) {
    case 'workoutDays':
      return COLOR_PRESETS.workoutOrange;
    case 'activeWorkoutPrimary':
      return colors.text;
    case 'activeWorkoutSecondary':
      return colors.primary;
    case 'historyProgress':
      return colors.disciplineCompleted;
    case 'roseaChat':
      return colors.primary;
    case 'profile':
      return COLOR_PRESETS.profileClay;
    case 'friends':
      return isDark ? FRIENDS_ACCENT_DARK : FRIENDS_ACCENT_LIGHT;
    /** Bugün göstergesi bugüne kadar sistem mavisiydi. */
    case 'todayHighlight':
      return colors.primary;
    /** Üç çemberin bugünkü renkleri; seçim yapılmazsa görünüm değişmez. */
    case 'historyWorkoutsRing':
      return colors.primary;
    case 'historyExercisesRing':
      return colors.disciplineCompleted;
    case 'historyDurationRing':
      return colors.accent;
    /** Ayarlar ekranının bugünkü moru; seçim yapılmazsa görünüm değişmez. */
    case 'settings':
      return isDark ? SETTINGS_ACCENT_DARK : SETTINGS_ACCENT_LIGHT;
  }
}

/** `components/friends/friends-theme.ts` içindeki mevcut değerlerin aynısı. */
/**
 * Ayarlar ekranının bugünkü mor vurgusu. Değerler `app/settings.tsx` içinden
 * BİREBİR taşındı; kullanıcı preset seçmezse ekran aynen eskisi gibi görünür.
 */
export const SETTINGS_ACCENT_DARK = '#CBB4F2';
export const SETTINGS_ACCENT_LIGHT = '#60458A';

export const FRIENDS_ACCENT_DARK = '#A472F0';
export const FRIENDS_ACCENT_LIGHT = '#7A3FE0';

/**
 * Bir hex rengin düşük opaklıklı tonu.
 *
 * Profil rozeti gibi "hafif arka plan / ince çerçeve" alanlarında kullanılır;
 * sabit mercan tonları yerine seçilen profil renginden türetilir. Global tema
 * renklerine dokunmaz.
 */
export function withAlpha(hex: string, alpha: number) {
  const [red, green, blue] = hexToRgb(hex);
  const safeAlpha = Math.min(1, Math.max(0, alpha));
  return `rgba(${red}, ${green}, ${blue}, ${safeAlpha})`;
}
