import { Image } from 'expo-image';
import { useMemo } from 'react';

import { RankId } from '@/constants/ranks';

/**
 * Rank sembolü — kademeye özgü, YEREL RESİM ASSET'i.
 *
 * TEK GÖRSEL KAYNAK — bütün rank görselleri buradan eşlenir. Aynı doğru asset
 * üç yerde kullanılır: rank özetindeki büyük hero, `RankBadge` içindeki kompakt
 * işaret ve rank rehberi satırlarındaki orta boy işaret. Profil özeti de artık
 * doğrudan Ionicons yerine bu bileşeni kullanır.
 *
 * RENK KURALI — asset'e TINT UYGULANMAZ. Rozetin metalik/gül renkleri görselin
 * kendisindedir; color preset veya rank rengiyle yeniden boyanmaz. `contain`
 * ile rozetin tamamı her varyantta görünür kalır. Görselin etrafına balon,
 * daire veya çerçeve EKLENMEZ; asset zaten şeffaf kenar boşluğu taşır.
 *
 * ERİŞİLEBİLİRLİK — üç kullanım da rank adını zaten metinle sunar; bu yüzden
 * sembol varsayılan olarak DEKORATİFTİR ve VoiceOver'a rank adını ikinci kez
 * okutmaz. Tek başına anlam taşıması gerekirse `accessibilityLabel` verilir.
 */

/**
 * Kademe → yerel rozet asset'i. TEK kaynak; kopyalanmaz. Bütün `require`
 * çağrıları statik ve açıktır (Metro dinamik yol çözemez); değer, asset modül
 * kimliğidir (`number`) ve `expo-image` `source` prop'una doğrudan verilir.
 */
export const RANK_EMBLEM_SOURCES: Record<RankId, number> = {
  bronze: require('@/assets/images/ranks/rank-bronze.png'),
  silver: require('@/assets/images/ranks/rank-silver.png'),
  gold: require('@/assets/images/ranks/rank-gold.png'),
  platinum: require('@/assets/images/ranks/rank-platinum.png'),
  emerald: require('@/assets/images/ranks/rank-emerald.png'),
  diamond: require('@/assets/images/ranks/rank-diamond.png'),
  rosea: require('@/assets/images/ranks/rank-rosea.png'),
};

export type RankEmblemVariant = 'hero' | 'medium' | 'compact';

/**
 * Her varyantın ölçüsü. Detaylı rozet, eski 14–16 pt Ionicons alanına
 * sıkıştırılmaz: hero tasarımı okunacak kadar büyük, kompakt ise metni ezmeden
 * gereken en küçük boyuttadır. Değerler kutunun kenar uzunluğudur; `contain`
 * asset'in portre oranını (≈0.76) koruyarak yüksekliğe göre yerleştirir.
 */
const VARIANT_SIZE: Record<RankEmblemVariant, number> = {
  hero: 84,
  medium: 40,
  compact: 22,
};

type RankEmblemProps = {
  /** Yalnızca sunucudan gelen rank kimliği. */
  rankId: RankId;
  variant?: RankEmblemVariant;
  /** Varyant boyutunu geçersiz kılar (ör. profil özetindeki kimlik hücresi). */
  size?: number;
  /** Verilirse sembol tek başına anlam taşır; verilmezse dekoratiftir. */
  accessibilityLabel?: string;
  /**
   * Geriye dönük uyum için kabul edilir ama KULLANILMAZ: asset'e tint
   * uygulanmadığından çağıranların semantik rengi geçmeye devam etmesi bir
   * sorun değildir, renk yalnızca yok sayılır.
   */
  color?: string;
};

export function RankEmblem({ accessibilityLabel, rankId, size, variant = 'medium' }: RankEmblemProps) {
  const box = size ?? VARIANT_SIZE[variant];

  const a11y = useMemo(
    () =>
      accessibilityLabel
        ? { accessibilityLabel, accessibilityRole: 'image' as const, accessible: true }
        : {
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants' as const,
          },
    [accessibilityLabel],
  );

  return (
    <Image
      contentFit="contain"
      source={RANK_EMBLEM_SOURCES[rankId]}
      style={{ height: box, width: box }}
      {...a11y}
    />
  );
}
