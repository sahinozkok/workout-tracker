import { Image } from 'react-native';

/**
 * PROFİL KATALOG İKONU — profilin en altındaki katalog satırlarının paylaşılan
 * ikon bileşeni (Disiplin miğferi + Arkadaşlar çoklu Rosea'sı).
 *
 * `AchievementSymbol` ile AYNI sözleşme: düz beyaz RGBA PNG bir ALFA MASKE gibi
 * kullanılır ve `tintColor` sembolü satırın mevcut tema tokenıyla yeniden boyar.
 * Böylece ikon light / warm light / dark / soft dark temalarında otomatik uyum
 * sağlar; sabit coral/siyah/beyaz renk YOKTUR.
 *
 * ÖLÇÜ: Disiplin miğferi KARE'dir (`size` → width=height). Arkadaşlar ise
 * kullanıcının orijinal ÇOKLU ROSEA çizimi — YATAY (geniş) bir kompozisyon;
 * kare kutuya sıkıştırılırsa karakterler küçülür, o yüzden ayrı `width`/`height`
 * ile dikdörtgen çizilir. `resizeMode="contain"` oranı korur, kırpmaz.
 *
 * SINIRLAR: kendi arka planı YOK; daire/disk/çerçeve/kart/gölge/glow/gradient
 * YOK. Sembol DEKORATİF'tir ve erişilebilirlikten gizlenir — kapsayan satır
 * zaten tam lokalize etiketini (başlık + açıklama) ve dokunma davranışını sağlar.
 */
const PROFILE_CATALOG_ICONS = {
  discipline: require('@/assets/profile-catalog/profile-discipline-helmet.png'),
  friends: require('@/assets/profile-catalog/profile-friends-rosea.png'),
} as const;

export type ProfileCatalogIconName = keyof typeof PROFILE_CATALOG_ICONS;

export type ProfileCatalogIconProps = {
  name: ProfileCatalogIconName;
  /** Satırın mevcut ikon tokenı (Disiplin → colors.text, Arkadaşlar → colors.textSecondary). */
  color: string;
  /** Kare ikon kenarı (pt) — Disiplin. `width`/`height` verilmezse kullanılır. */
  size?: number;
  /** Dikdörtgen ikon genişliği (pt) — yatay Arkadaşlar kompozisyonu için. */
  width?: number;
  /** Dikdörtgen ikon yüksekliği (pt) — yatay Arkadaşlar kompozisyonu için. */
  height?: number;
};

export function ProfileCatalogIcon({ color, name, size, width, height }: ProfileCatalogIconProps) {
  const w = width ?? size ?? 24;
  const h = height ?? size ?? 24;
  return (
    <Image
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      resizeMode="contain"
      source={PROFILE_CATALOG_ICONS[name]}
      style={{ height: h, tintColor: color, width: w }}
    />
  );
}
