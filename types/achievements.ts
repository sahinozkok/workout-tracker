import { AchievementCategory, AchievementKey } from '@/constants/achievements';

/**
 * KARİYER BAŞARIMI — sunucu `sync_my_achievements` satırının güvenli tipi.
 * İlerleme/hedef/kilit SUNUCUDAN gelir; istemci hesaplamaz. Ham birimler
 * (mesafe metre, süre saniye, hacim kg) sunucuda tutulur; gösterim biçimlemesi
 * istemcide `formatAchievementValue` ile yapılır.
 */
export type CareerAchievement = {
  key: AchievementKey;
  category: AchievementCategory;
  isUnlocked: boolean;
  /** Açılma anı (kalıcı). Açık değilse undefined. */
  unlockedAt?: string;
  /** Sunucunun `least(metrik, hedef)` değeri (ham birim). */
  currentProgress: number;
  targetProgress: number;
};

/** Profil vitrini seçimi (en fazla 3, açılmış başarımlardan). */
export type AchievementShowcaseSelection = AchievementKey[];

/** Arkadaş vitrininde gösterilen açık başarım (yalnız kimlik + tarih). */
export type FriendAchievementShowcaseEntry = {
  key: AchievementKey;
  unlockedAt?: string;
};
