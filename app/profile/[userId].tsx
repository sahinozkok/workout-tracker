import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSafeBack } from '@/components/navigation/header-back-button';
import { resolveProfileColor } from '@/hooks/use-feature-colors';
import { ProfileCareerShowcase } from '@/components/ranks/profile-career-showcase';
import { ProfileProgressSummary } from '@/components/rewards/profile-progress-summary';
import { ProfileDisciplineCard } from '@/components/profile-discipline-card';
import { ProfileSharedProgram } from '@/components/profile-shared-program';
import { FriendRoseState } from '@/constants/level-roses';
import { Layout, ThemeColors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { fetchFriendAchievementShowcase } from '@/services/achievements';
import { fetchFriendRank } from '@/services/ranks';
import {
  getFriendActiveProgram,
  getFriendDisciplineDays,
  getFriendLevelRose,
  getFriendProfile,
} from '@/services/friends';
import { FriendProfile, SharedActiveProgram } from '@/types/friends';
import { FriendAchievementShowcaseEntry } from '@/types/achievements';
import { FriendRankSummary } from '@/types/ranks';
import { DisciplineStatus } from '@/types/workout';
import { toDateKey } from '@/utils/discipline';

/** Arkadaş takviminde gösterilen aralık: son bir yıl. */
const VISIBLE_DAYS = 366;

/** Hedef değerleri mevcut profil çevirileriyle eşleşir. */
const GOAL_LABEL_KEYS: Record<string, string> = {
  consistency: 'profile.goalConsistency',
  fitness: 'profile.goalFitness',
  muscle: 'profile.goalMuscle',
  strength: 'profile.goalStrength',
};

/** Arkadaş profilinin bugünkü vurgu tonu. */
const FRIEND_PROFILE_ACCENT_DEFAULT = '#D5755B';

export default function FriendProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { user } = useAuth();
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const isOwnProfile = Boolean(userId) && userId === user?.id;

  // Kendi kimliğiyle açılırsa "erişim yok" göstermek yerine Profil sekmesine
  // yönlendirilir. Yalnızca auth kullanıcı kimliği okunur.
  useEffect(() => {
    if (isOwnProfile) router.replace('/profile');
  }, [isOwnProfile]);

  const [profile, setProfile] = useState<FriendProfile>();  /**
   * Profil rengi SAHİBİNDEN gelir; görüntüleyenin kendi tercihi kullanılmaz.
   * Alan yoksa (migration uygulanmadıysa) bugünkü ton uygulanır.
   */
  const ownerAccent = resolveProfileColor(profile?.colorPresetId, FRIEND_PROFILE_ACCENT_DEFAULT);
  const styles = createStyles(colors, ownerAccent.color, isDark);
  const insets = useSafeAreaInsets();
  // Güvenli geri: geçmiş varsa geri, yoksa Arkadaşlar ekranına. Native başlık
  // kapalı olduğundan kapağın üzerine çentiğin altında ÖZEL geri düğmesi çizilir.
  const safeBack = useSafeBack('/friends');
  const backButton = (
    <Pressable
      accessibilityLabel={t('common.back')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={safeBack}
      style={({ pressed }) => [styles.backButton, { top: insets.top + 6 }, pressed && styles.pressed]}>
      <Ionicons color="#FFFFFF" name="chevron-back" size={24} />
    </Pressable>
  );

  const [statuses, setStatuses] = useState<Record<string, DisciplineStatus>>({});
  /** Arkadaşın sezon rank özeti. Arkadaş değilse RPC boş döner ve rozet çizilmez. */
  const [friendRank, setFriendRank] = useState<FriendRankSummary>();
  /**
   * Rank OKUMASI hatası — "bu sezon sıralanmadı" (veri yok) ile "okunamadı"
   * (ağ/hata) AYRILIR: hata durumunda ortak özet sahte "rank yok" göstermez.
   */
  const [hasFriendRankError, setHasFriendRankError] = useState(false);
  /**
   * Arkadaşın gül tercihinin AYRIK durumu — üç sonuç GERÇEKTEN ayrılır:
   *   * `loading`     → tercih henüz okunmadı; hiçbir gül varsayılmaz.
   *   * `unavailable` → RPC eksik / ağ / erişim reddi / geçersiz yanıt; NULL
   *     tercihe DÖNÜŞTÜRÜLMEZ ve arkadaşın SEÇMEDİĞİ bir gül sembol olarak
   *     çizilmez (placeholder gösterilir, gerçek level metni korunur).
   *   * `ready`       → başarılı okuma; `selectedId` string=açık seçim, null=
   *     arkadaşın açık otomatik tercihi (seviyesine göre en yüksek açık gül).
   * Kendi istek nesliyle A→B geçişinde eski cevap yeni profile yazamaz.
   */
  const [friendRose, setFriendRose] = useState<FriendRoseState>({ kind: 'loading' });
  const friendRoseRequestIdRef = useRef(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const isMountedRef = useRef(true);

  /**
   * Arkadaşın sezon rozet vitrini.
   *
   * Mevcut profil / disiplin / rank akışından TAMAMEN AYRI ve toleranslı
   * okunur: RPC hatası profili hata ekranına düşürmez, yalnızca vitrin
   * gizlenir. Arkadaş değilse RPC hiç satır döndürmez ve vitrin çizilmez.
   */
  const [showcase, setShowcase] = useState<FriendAchievementShowcaseEntry[]>([]);
  const [hasShowcaseError, setHasShowcaseError] = useState(false);
  /**
   * Vitrin isteği DEVAM EDERKEN boş liste "başarım yok" gibi görünmesin diye
   * AYRI bir yükleme durumu. Yeni arkadaş/route için istek başlarken `true`,
   * güncel istek başarı ya da hatayla bittiğinde `false` olur. Eski request
   * generation cevapları (nesil guard'ı) bu değeri değiştiremez.
   */
  const [isShowcaseLoading, setIsShowcaseLoading] = useState(true);
  /**
   * İstek nesli: hesap veya route (`userId`) değişirse eski isteğin cevabı
   * YENİ profilin state'ine yazamaz.
   */
  const showcaseRequestIdRef = useRef(0);

  /**
   * Paylaşılan aktif program AYRI ve TOLERANSLI okunur: opt-out / aktif program
   * yok / arkadaş değil / engel durumlarında RPC sıfır satır döner ve bölüm hiç
   * çizilmez. RPC HATASI da profili/takvimi/rank'ı düşürmez — yalnızca program
   * bölümü gizlenir. Kendi istek nesliyle route/hesap değişiminde eski cevap yeni
   * profile yazamaz.
   */
  const [sharedProgram, setSharedProgram] = useState<SharedActiveProgram>();
  const sharedProgramRequestIdRef = useRef(0);
  /**
   * ANA yükleme nesli. Route (`userId`) veya hesap değişince artar; A→B hızlı
   * geçişinde A'nın GECİKMİŞ yanıtı B'nin state'ine YAZAMAZ. (isMountedRef tek
   * başına yetmez: dinamik route aynı bileşen örneğini yeniden kullanabilir.)
   */
  const loadRequestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!userId || isOwnProfile) return;

    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    const isCurrent = () => isMountedRef.current && loadRequestIdRef.current === requestId;

    setIsLoading(true);
    setHasError(false);
    setHasFriendRankError(false);
    setFriendRank(undefined);
    try {
      // Arkadaş değilse RPC boş döner; takvim isteği hiç yapılmaz.
      const nextProfile = await getFriendProfile(userId);
      if (!isCurrent()) return;
      setProfile(nextProfile);

      if (!nextProfile) return;

      const today = new Date();
      const from = new Date(today);
      // Bugün dahil VISIBLE_DAYS gün → bugünden (VISIBLE_DAYS - 1) geriye.
      from.setDate(from.getDate() - (VISIBLE_DAYS - 1));
      const days = await getFriendDisciplineDays(userId, toDateKey(from), toDateKey(today));
      if (!isCurrent()) return;

      const next: Record<string, DisciplineStatus> = {};
      for (const day of days) next[day.dateKey] = day.status;
      setStatuses(next);

      /**
       * Rank özeti AYRI ve TOLERANSLI okunur: `sync_my_rank` başka bir
       * kullanıcı için çalıştırılamaz, bu yüzden arkadaşın rank satırı henüz
       * hiç oluşmamış olabilir. Veri yoksa rozet çizilmez; OKUMA HATASI ise
       * `hasFriendRankError` ile işaretlenir (ortak özet sahte "rank yok"
       * göstermez). Hiçbiri profili düşürmez.
       */
      try {
        const rank = await fetchFriendRank(userId);
        if (isCurrent()) setFriendRank(rank);
      } catch {
        if (isCurrent()) setHasFriendRankError(true);
      }
    } catch {
      if (isCurrent()) setHasError(true);
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [isOwnProfile, userId]);

  useEffect(() => {
    isMountedRef.current = true;
    void load();

    return () => {
      isMountedRef.current = false;
    };
  }, [load]);

  useEffect(() => {
    // Nesil, uzunluk kontrolünden ÖNCE artar: route değişince uçuştaki eski
    // cevap da geçersizleşir ve yeni profile yazamaz.
    const requestId = showcaseRequestIdRef.current + 1;
    showcaseRequestIdRef.current = requestId;

    setShowcase([]);
    setHasShowcaseError(false);

    if (!userId || isOwnProfile) {
      // İstek başlatılmadı → yükleme durumu da kapalı (yanlış spinner olmasın).
      setIsShowcaseLoading(false);
      return;
    }

    // İstek başlıyor: boş liste "başarım yok" gibi görünmesin diye loading açılır.
    setIsShowcaseLoading(true);

    let isActive = true;

    fetchFriendAchievementShowcase(userId)
      .then((entries) => {
        // Unmount sonrası ve eski nesil cevabı state'e YAZILMAZ.
        if (!isActive || showcaseRequestIdRef.current !== requestId) return;
        setShowcase(entries);
        setIsShowcaseLoading(false);
      })
      .catch(() => {
        if (!isActive || showcaseRequestIdRef.current !== requestId) return;
        // Vitrin sessizce gizlenir; profil ekranı düşmez.
        setHasShowcaseError(true);
        setIsShowcaseLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [isOwnProfile, userId]);

  useEffect(() => {
    // Nesil uzunluk kontrolünden ÖNCE artar: route değişince uçuştaki eski cevap
    // geçersizleşir ve yeni profile yazamaz.
    const requestId = sharedProgramRequestIdRef.current + 1;
    sharedProgramRequestIdRef.current = requestId;

    setSharedProgram(undefined);

    if (!userId || isOwnProfile) return;

    let isActive = true;

    getFriendActiveProgram(userId)
      .then((program) => {
        if (!isActive || sharedProgramRequestIdRef.current !== requestId) return;
        setSharedProgram(program);
      })
      .catch(() => {
        // Program bölümü sessizce gizlenir; profil ekranı düşmez.
        if (!isActive || sharedProgramRequestIdRef.current !== requestId) return;
        setSharedProgram(undefined);
      });

    return () => {
      isActive = false;
    };
  }, [isOwnProfile, userId]);

  /**
   * Arkadaşın gül tercihi — AYRI ve TOLERANSLI okunur (profil gövdesini
   * ENGELLEMEZ). Nesil, uzunluk kontrolünden ÖNCE artar: route/hesap değişince
   * A'nın gecikmiş cevabı B'nin gülünü DEĞİŞTİREMEZ ve erişim reddinde önceki
   * kullanıcının sembolü kalmaz. Hata → `unavailable` (null tercihe DÖNÜŞMEZ).
   *
   * YENİDEN DENENEBİLİR: aynı okuma `load()` ile birlikte Retry'dan da
   * çağrılır, böylece `unavailable` durumu ekranı terk etmeden düzelebilir —
   * tek seferlik bir efekte kilitlenip kalıcı takılmaz. Her çağrı nesli
   * artırdığı için uçuştaki eski cevap yeni sonucun üzerine YAZAMAZ.
   */
  const loadFriendRose = useCallback(async () => {
    const requestId = friendRoseRequestIdRef.current + 1;
    friendRoseRequestIdRef.current = requestId;
    const isCurrent = () => isMountedRef.current && friendRoseRequestIdRef.current === requestId;

    setFriendRose({ kind: 'loading' });

    if (!userId || isOwnProfile) return;

    try {
      const result = await getFriendLevelRose(userId);
      if (!isCurrent()) return;
      // ERİŞİM REDDİ (`denied`) OTOMATİK sayılmaz: arkadaşın SEÇMEDİĞİ bir gül
      // çizilmez, nötr `unavailable` placeholder gösterilir. Yalnız `ready`
      // (erişim var) durumunda selectedId anlamlıdır (null=otomatik).
      setFriendRose(
        result.kind === 'ready'
          ? { kind: 'ready', selectedId: result.selectedId }
          : { kind: 'unavailable' },
      );
    } catch {
      // RPC eksik / ağ / geçersiz → OTOMATİK sayılmaz; placeholder.
      if (!isCurrent()) return;
      setFriendRose({ kind: 'unavailable' });
    }
  }, [isOwnProfile, userId]);

  useEffect(() => {
    void loadFriendRose();
  }, [loadFriendRose]);

  if (isOwnProfile || isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        {backButton}
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // Arkadaşlık kaldırılmışsa veya istek henüz kabul edilmemişse erişim kapalıdır.
  if (hasError || !profile) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        {backButton}
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>{t('friends.profileUnavailable')}</Text>
          <Text style={styles.emptyBody}>{t('friends.profileUnavailableBody')}</Text>
          {hasError && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void load();
                // Gül okuması AYRI bir istektir; Retry onu da yeniden dener,
                // aksi hâlde `unavailable` ekran terk edilene kadar takılırdı.
                void loadFriendRose();
              }}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryText}>{t('friends.retry')}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const initial = profile.displayName.trim().charAt(0).toLocaleUpperCase('tr-TR') || '?';

  return (
    // edges={[]}: üst safe-area uygulanmaz → kapak fiziksel en üstten, çentiğin
    // arkasından başlar (kendi profil hero'suyla aynı). Alt güvenli alan da
    // ScrollView içeriğine bırakılır.
    <SafeAreaView style={styles.safeArea} edges={[]}>
      {backButton}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* KAPAK — kendi profille AYNI: tam genişlik, aspectRatio 2.25, üstte boşluk yok. */}
        <View style={styles.bannerSection}>
          <View style={styles.banner}>
            {profile.bannerUrl ? (
              <Image autoplay contentFit="cover" source={{ uri: profile.bannerUrl }} style={styles.bannerImage} />
            ) : (
              <View style={styles.bannerPlaceholder} />
            )}
          </View>

          {/* Avatar kapağın alt sınırına taşar (kendi profildeki gibi: 80 pt,
              4 pt kenar, -36 negatif üst margin, sol hizalı). */}
          <View style={styles.heroRow}>
            <View style={styles.avatarWrapper}>
              <View style={styles.avatar}>
                {profile.avatarUrl ? (
                  <Image autoplay contentFit="cover" source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarLetter}>{initial}</Text>
                )}
              </View>
            </View>
          </View>
        </View>

        {/* KİMLİK — kendi profilimizle AYNI görsel dil: @kullanıcı, ana ad ve
            ikincil bio (ortalı). Düzenle/Ayarlar gibi SAHİBİNE ÖZEL eylemler
            BURADA YOKTUR (arkadaş profili salt okunur). */}
        <View style={styles.summary}>
          <Text numberOfLines={1} style={styles.summaryUsername}>
            {profile.username ? `@${profile.username}` : t('friends.noUsername')}
          </Text>
          <Text numberOfLines={2} style={styles.summaryName}>
            {profile.displayName}
          </Text>
          {profile.bio.trim() ? (
            <Text style={styles.summaryBio}>{profile.bio.trim()}</Text>
          ) : null}
        </View>

        {/* İLERLEME — kendi profilimizle AYNI ortak bileşen. Bütün değerler
            ARKADAŞIN verisidir (kendi reward/rank context'imiz KULLANILMAZ).
            SALT OKUNUR: `onLevelPress`/`onRankPress` VERİLMEZ → seçim penceresi
            açılmaz, gül değiştirilemez, /rank navigasyonu olmaz. Gül bakiyesi ve
            ProfileProofStats gibi özel istatistikler GÖSTERİLMEZ. Level metni
            arkadaşın GERÇEK seviyesidir; gülün açılma seviyesiyle karışmaz. */}
        <View style={styles.progressSection}>
          <ProfileProgressSummary
            accentColor={ownerAccent.color}
            level={profile.level}
            levelRoseState={friendRose.kind === 'ready' ? undefined : friendRose.kind}
            selectedRoseId={friendRose.kind === 'ready' ? friendRose.selectedId : undefined}
            xpForNextLevel={profile.xpForNextLevel}
            xpIntoLevel={profile.xpIntoLevel}
          />
          {/* BAĞIMSIZ TEKRAR DENEME — profil gövdesi BAŞARIYLA açıkken YALNIZ gül
              okuması başarısız olduğunda (unavailable) görünür. Ana profil hata
              retry'ından ayrıdır: gül tek başına yeniden okunur ve placeholder
              ekranı terk etmeden düzelebilir. Her çağrı istek neslini artırdığı
              için gecikmiş eski cevap yeni sonucun üzerine yazamaz. `loading`
              ve `ready` durumlarında hiç gösterilmez. */}
          {friendRose.kind === 'unavailable' && (
            <Pressable
              accessibilityHint={t('friends.roseRetry')}
              accessibilityLabel={t('friends.roseUnavailable')}
              accessibilityRole="button"
              onPress={() => void loadFriendRose()}
              style={({ pressed }) => [styles.roseRetryRow, pressed && styles.pressed]}>
              <Ionicons color={colors.primary} name="refresh" size={13} />
              <Text style={styles.roseRetryText}>{t('friends.roseRetry')}</Text>
            </Pressable>
          )}
        </View>

        {/* Sezon rozetleri ve hedef — kimlik satırının altında. Season Badges
            tasarımı/çalışma mantığı DEĞİŞMEZ; salt okunur (`onPress` verilmez) ve
            arkadaşın KENDİ vurgu rengini kullanır. RPC hata verirse gizlenir. */}
        <View style={styles.metaSection}>
          {/* Arkadaşın KALICI vitrini — yalnız seçtiği başarımlar, salt okunur.
              Erişim yok/hata nötr gösterilir; kendi context'imiz bağlanmaz. */}
          <ProfileCareerShowcase
            accentColor={ownerAccent.color}
            entries={showcase.map((entry) => ({ key: entry.key }))}
            hasError={hasShowcaseError}
            hasRankError={hasFriendRankError}
            isLoading={isShowcaseLoading}
            rank={friendRank ? { id: friendRank.currentRank, rp: friendRank.currentRp } : undefined}
          />
          <View style={styles.goalChip}>
            <Text style={styles.goalText}>
              {GOAL_LABEL_KEYS[profile.trainingGoal]
                ? t(GOAL_LABEL_KEYS[profile.trainingGoal])
                : t('profile.goal')}
            </Text>
          </View>
        </View>

        {/* Paylaşılan aktif program: SEVİYE bölümünden sonra, disiplin kartından
            ÖNCE. Kendi profildekiyle AYNI ortak bileşen; salt okunur — hiçbir
            edit/start callback'i bağlanmaz. RPC veri döndürmezse (opt-out / aktif
            program yok / engel) `sharedProgram` undefined kalır ve hiç çizilmez. */}
        {sharedProgram && (
          <View style={styles.sharedProgramSection}>
            <ProfileSharedProgram accentColor={ownerAccent.color} program={sharedProgram} />
          </View>
        )}

        {/* Kendi profiliyle **aynı** kart tasarımı, ancak salt okunur:
            `readOnly` verildiği için `onDayPress` hiç bağlanmaz — gün ayrıntısı
            penceresi açılmaz ve hiçbir mutation tetiklenemez. Kart arkadaşın
            yüklenmiş durum verisini prop olarak alır; hiçbir context okumaz,
            dolayısıyla RLS/friendship kontrolleri ve Supabase sorguları
            değişmez. */}
        <View style={styles.calendarSection}>
          <ProfileDisciplineCard accentColor={ownerAccent.color} readOnly statuses={statuses} />
        </View>
        <Text style={styles.readOnlyNote}>{t('friends.calendarReadOnly')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors, ownerAccent: string, isDark: boolean) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 40 },
    centerState: { alignItems: 'center', flex: 1, gap: 10, justifyContent: 'center', paddingHorizontal: 32 },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
    emptyBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    // Kendi profille AYNI kapak geometrisi: tam genişlik, aspectRatio 2.25,
    // fiziksel en üstten (üst boşluk yok). Kapak çentiğin arkasına uzanır.
    bannerSection: { marginBottom: 12 },
    banner: { aspectRatio: 2.25, backgroundColor: colors.surfaceMuted, overflow: 'hidden', width: '100%' },
    bannerImage: { height: '100%', width: '100%' },
    bannerPlaceholder: { backgroundColor: colors.surfaceMuted, flex: 1 },
    heroRow: { alignItems: 'flex-start', flexDirection: 'row', paddingHorizontal: Layout.screenPadding },
    avatarWrapper: { marginTop: -36 },
    // Kimlik metni ortalı (kendi profildeki gibi).
    summary: { alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: Layout.screenPadding },
    avatar: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.background,
      borderRadius: 40,
      borderWidth: 4,
      height: 80,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 80,
    },
    avatarImage: { height: '100%', width: '100%' },
    avatarLetter: { color: colors.textSecondary, fontSize: 28, fontWeight: '600' },
    // Kapağın üzerine çizilen ÖZEL geri düğmesi — çentiğin altında (top inline).
    // Ölçülü yarı saydam koyu zemin her kapakta okunur kalmasını sağlar; ≥44 pt.
    backButton: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.35)',
      borderRadius: Layout.minTouchSize / 2,
      height: Layout.minTouchSize,
      justifyContent: 'center',
      left: Layout.screenPadding,
      position: 'absolute',
      width: Layout.minTouchSize,
      zIndex: 10,
    },
    // Kendi profilimizin kimlik tipografisiyle AYNI: @kullanıcı (accent),
    // ana ad ve ikincil bio.
    summaryUsername: { color: ownerAccent, fontSize: 12, fontWeight: '500' },
    summaryName: {
      color: isDark ? colors.text : '#42283A',
      fontSize: 27,
      fontWeight: '500',
      lineHeight: 33,
      textAlign: 'center',
    },
    summaryBio: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '400',
      lineHeight: 19,
      marginTop: 2,
      paddingHorizontal: 8,
      textAlign: 'center',
    },
    // İlerleme (ortak ProfileProgressSummary) ve alt meta (rozet + hedef).
    progressSection: { alignItems: 'center', marginTop: 16, paddingHorizontal: Layout.screenPadding },
    metaSection: { alignItems: 'center', gap: 8, marginTop: 14, paddingHorizontal: Layout.screenPadding },
    sharedProgramSection: { marginTop: 18, paddingHorizontal: Layout.screenPadding },
    calendarSection: { marginTop: 18, paddingHorizontal: Layout.screenPadding },
    readOnlyNote: {
      color: colors.textTertiary,
      fontSize: 12,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 4,
    },
    goalChip: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Layout.radiusPill,
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 5,
    },
    goalText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
    retryButton: { justifyContent: 'center', minHeight: Layout.minTouchSize },
    retryText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    // Gül okuması için BAĞIMSIZ, kompakt tekrar-deneme (büyük panel/arka plan
    // YOK): level/rank/XP özetinin DOĞAL bir hata durumu gibi hemen altına,
    // yakın konumlanır. 44 pt dokunma alanı korunur; yalnız görünür boşluk
    // küçültülür. Gül başarıyla gelince bu satır HİÇ render edilmez → boşluk
    // tamamen kaybolur (koşullu render).
    roseRetryRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'center',
      marginTop: 2,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 8,
    },
    roseRetryText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
}
