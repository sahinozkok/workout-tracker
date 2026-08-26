import {
  ColorFeature,
  ColorPresetId,
  getColorPresetHex,
  getOnAccentColor,
} from '@/constants/color-presets';
import { useProfile } from '@/context/profile-context';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * Bir özelliğin çözülmüş vurgu rengi.
 *
 * `isCustom` false iken `color` o bölümün BUGÜNKÜ rengidir ve hiçbir şey
 * değişmemiştir; true iken kullanıcının seçtiği ön ayardır.
 */
export type FeatureColor = {
  color: string;
  isCustom: boolean;
  /** Renk üzerine gelen metin/ikon rengi; parlaklıktan hesaplanır. */
  onColor: string;
  presetId?: ColorPresetId;
};

/**
 * Özellik renklerinin TEK okuma noktası.
 *
 * Bileşenler rastgele hex yazmak yerine buradan semantik alan okur. Kullanıcı
 * bir ön ayar seçmediyse `fallbackColor` döner — yani ekran bugünkü görünümünü
 * birebir korur. İkinci bir global tema sistemi KURULMAZ; yüzeyler, metinler
 * ve disiplin renkleri `useAppTheme()` üzerinden gelmeye devam eder.
 */
export function useFeatureColor(feature: ColorFeature, fallbackColor: string): FeatureColor {
  const { colorPresets } = useProfile();
  const { colors } = useAppTheme();
  const presetId = colorPresets[feature];

  if (!presetId) {
    return { color: fallbackColor, isCustom: false, onColor: colors.background };
  }

  const color = getColorPresetHex(presetId);
  return { color, isCustom: true, onColor: getOnAccentColor(color), presetId };
}

/**
 * Başka bir kullanıcının profil rengi (arkadaş profili).
 *
 * Görüntüleyenin kendi tercihi KULLANILMAZ; renk profil sahibinden gelir.
 */
export function resolveProfileColor(presetId: ColorPresetId | undefined, fallbackColor: string) {
  if (!presetId) return { color: fallbackColor, onColor: getOnAccentColor(fallbackColor) };
  const color = getColorPresetHex(presetId);
  return { color, onColor: getOnAccentColor(color) };
}
