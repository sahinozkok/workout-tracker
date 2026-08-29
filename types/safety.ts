/** Sunucunun kabul ettiği içerik şikâyeti kategorileri. */
export type SafetyReportCategory =
  | 'harassment'
  | 'hate'
  | 'sexual'
  | 'violence'
  | 'spam'
  | 'other';

/** Kullanıcının kendi engellediği hesap için güvenli profil özeti. */
export type BlockedUser = {
  avatarUrl?: string;
  blockedAt: string;
  displayName: string;
  id: string;
  username?: string;
};
