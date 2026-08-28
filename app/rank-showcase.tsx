import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { MotionSection } from '@/components/motion-section';
import { ACHIEVEMENT_ICONS } from '@/components/ranks/achievement-icons';
import { PROFILE_SHOWCASE_LIMIT } from '@/components/ranks/profile-achievement-showcase';
import { getOnAccentColor, withAlpha } from '@/constants/color-presets';
import { SeasonAchievementKey } from '@/constants/rank-experience';
import { Layout, ThemeColors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTranslation } from '@/context/language-context';
import { useRanks } from '@/context/rank-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';

/**
 * ROZET VİTRİNİ SEÇİM EKRANI.
 *
 * Kök Stack'te açılır → alt sekme çubuğuna YENİ SEKME EKLENMEZ; native geri
 * düğmesi ve iOS geri kaydırma hareketi olduğu gibi çalışır.
 *
 * Bilinçli sınırlar:
 *  - Bu ekran hiçbir başarı koşulu HESAPLAMAZ ve doğrudan Supabase'e
 *    dokunmaz: kazanılmış rozetler ve seçim `RankContext`ten gelir, kaydetme
 *    de context üzerinden yapılır.
 *  - Seçim tamamen KOZMETİKTİR: RP, XP, level veya gül üretmez, başarı
 *    koşullarını ve kutlama/baseline mantığını etkilemez.
 *  - Yalnızca GÜNCEL sezonda kazanılmış rozetler listelenir.
 *  - Kaydetme başarısız olursa ekran seçimi KAYBETMEZ.
 *  - Yeni animasyon, emoji, gradient, görsel veya paket eklenmez; yalnızca
 *    mevcut `MotionPressable` ve motion tokenları kullanılır.
 */

/** Profil vurgusunun varsayılanı — profil ekranıyla aynı. */
const PROFILE_ACCENT_DEFAULT = '#D5755B';

export default function RankShowcaseScreen() {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id;
  const {
    achievements,
    hasAchievementsError,
    hasShowcaseSelectionError,
    isAchievementsLoading,
    isShowcaseSelectionLoading,
    isShowcaseSelectionReady,
    loadAchievements,
    loadShowcaseSelection,
    saveShowcaseSelection,
    showcaseSelection,
    showcaseSelectionSeasonIndex,
  } = useRanks();
  const accent = useFeatureColor('profile', PROFILE_ACCENT_DEFAULT).color;
  const styles = useMemo(() => createStyles(colors), [colors]);

  /** Ekrandaki taslak seçim; kaydedilene kadar sunucuya yazılmaz. */
  const [draft, setDraft] = useState<SeasonAchievementKey[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaveError, setHasSaveError] = useState(false);
  const isMountedRef = useRef(true);
  /**
   * Taslağın hazırlandığı `${userId}:${seasonIndex}` anahtarı.
   *
   * Ömürlük bir boolean YETMEZ: hesap veya sezon değişince taslak YENİ
   * seçimle yeniden hazırlanmalıdır. `undefined` = henüz hazırlanmadı.
   */
  const seededDraftKeyRef = useRef<string>(undefined);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void loadShowcaseSelection();
  }, [loadShowcaseSelection]);

  /**
   * TASLAK YALNIZCA SEÇİM GERÇEKTEN YÜKLENDİKTEN SONRA HAZIRLANIR.
   *
   * `isShowcaseSelectionLoading === false` tek başına YETMEZ: ilk render'da
   * istek daha başlamamışken de `false`tur ve taslak boş listeyle mühürlenip
   * kullanıcının kayıtlı seçimini ezerdi. `isShowcaseSelectionReady` ise
   * ancak GÜNCEL sezona ait başarılı bir cevap geldiğinde doğrudur —
   * otomatik mod cevabı da "hazır" sayılır ve taslak bilinçli olarak boş
   * hazırlanır.
   *
   * Anahtar `${userId}:${seasonIndex}` olduğu için hesap veya sezon değişince
   * taslak yeni seçimle yeniden hazırlanır; kullanıcı seçim yaptıktan sonra
   * gelen arka plan cevabı ise aynı anahtarda olduğu için taslağı EZMEZ.
   */
  useEffect(() => {
    if (!isShowcaseSelectionReady) return;
    if (!userId || showcaseSelectionSeasonIndex === undefined) return;

    const seedKey = `${userId}:${showcaseSelectionSeasonIndex}`;
    if (seededDraftKeyRef.current === seedKey) return;

    seededDraftKeyRef.current = seedKey;
    setDraft([...showcaseSelection]);
  }, [isShowcaseSelectionReady, showcaseSelection, showcaseSelectionSeasonIndex, userId]);

  /** Yalnızca GÜNCEL sezonda kazanılmış rozetler seçilebilir. */
  const unlocked = achievements.filter((achievement) => achievement.isUnlocked);
  const hasLoadError = hasAchievementsError || hasShowcaseSelectionError;
  /**
   * SEÇİM CEVABI HENÜZ ELDE DEĞİL.
   *
   * İstek uçuşta olabilir (`isShowcaseSelectionLoading`) veya güncel sezona
   * ait başarılı bir cevap hiç gelmemiş olabilir (`!isShowcaseSelectionReady`).
   * İkisi de "seçim bilinmiyor" demektir ve rozet ızgarası bu durumda
   * RENDER EDİLEMEZ.
   */
  const isSelectionPending = isShowcaseSelectionLoading || !isShowcaseSelectionReady;
  /**
   * Seçim hazır değilken kaydetmek boş taslağı sunucuya yazardı; yükleme
   * HATASINDA da kaydetme kapalıdır (`isShowcaseSelectionReady` zaten `false`
   * kalır, `hasLoadError` bunu AÇIKÇA da garanti eder).
   */
  const canSave = isShowcaseSelectionReady && !hasLoadError && !isSaving;

  /**
   * GÖVDE DURUMU — HATA, YÜKLENİYOR'DAN ÖNCE değerlendirilir.
   *
   * `isSelectionPending` içindeki `!isShowcaseSelectionReady`, seçim isteği
   * hata verdiğinde KALICI OLARAK `true` kalır. Loading dalı önce çalışırsa
   * kullanıcı sonsuz spinner'da kalır ve "Tekrar dene" düğmesine hiç ulaşamaz.
   * Hata dalı ayrıca kazanılmış rozet sayısından BAĞIMSIZDIR: rozetler
   * yüklenmiş olsa bile seçim yüklenemediyse pasif bir Kaydet düğmesi
   * göstermek yerine hata + yeniden deneme gösterilir.
   *
   * SEÇİM PENDING'KEN IZGARA RENDER EDİLMEZ — rozet sayısına BAKILMAKSIZIN.
   * Kazanılmış rozetler context'te önceden bulunabilir; ızgara yalnızca bu
   * veriye bakarak açılırsa kullanıcı seçim cevabı gelmeden kartlara dokunur
   * ve gelen cevabın seed'i onun taslağını EZERDİ. Yükleniyor durumu bu yarışı
   * baştan kapatır: kart da, kaydetme eylemleri de hiç render edilmez.
   *
   * Başarılar YALNIZCA arka planda tazeleniyorsa (`isAchievementsLoading` ama
   * elde güncel rozet verisi VAR) ızgara korunur; spinner'a düşülmez.
   */
  const bodyState: 'error' | 'loading' | 'empty' | 'grid' = hasLoadError
    ? 'error'
    : isSelectionPending || (isAchievementsLoading && unlocked.length === 0)
      ? 'loading'
      : unlocked.length === 0
        ? 'empty'
        : 'grid';

  /** Yeniden deneme HER İKİ yüklemeyi de baştan başlatır. */
  const retry = useCallback(() => {
    void loadAchievements();
    void loadShowcaseSelection();
  }, [loadAchievements, loadShowcaseSelection]);

  const toggle = useCallback((key: SeasonAchievementKey) => {
    setHasSaveError(false);
    setDraft((current) => {
      if (current.includes(key)) return current.filter((entry) => entry !== key);
      // En fazla üç rozet; dördüncü dokunuş sessizce yok sayılır.
      if (current.length >= PROFILE_SHOWCASE_LIMIT) return current;
      return [...current, key];
    });
  }, []);

  const save = useCallback(
    async (keys: SeasonAchievementKey[]) => {
      if (isSaving) return;
      setIsSaving(true);
      setHasSaveError(false);
      try {
        const outcome = await saveShowcaseSelection(keys);
        if (!isMountedRef.current) return;

        /**
         * SUNUCU ÇAĞRISININ BAŞARILI OLMASI YETMEZ: cevap eski sezona veya
         * artık sahip olunmayan bir hesaba aitse seçim GÜNCEL sezona
         * uygulanmamıştır. Böyle bir durumda ekran KAPANMAZ, taslak korunur ve
         * kullanıcı mevcut kaydetme hatası / yeniden deneme davranışını görür.
         */
        if (outcome.status !== 'applied') {
          setHasSaveError(true);
          return;
        }

        // Kaydedilen sonuç context'e yazıldı; profil vitrini anında güncellenir.
        if (router.canGoBack()) router.back();
      } catch {
        // Taslak KORUNUR: kullanıcı seçimini kaybetmez ve tekrar deneyebilir.
        if (isMountedRef.current) setHasSaveError(true);
      } finally {
        if (isMountedRef.current) setIsSaving(false);
      }
    },
    [isSaving, saveShowcaseSelection],
  );

  function renderBody() {
    if (bodyState === 'error') {
      return (
        <View style={styles.centerState}>
          <Text style={styles.stateText}>{t('ranks.achievements.showcase.loadFailed')}</Text>
          <MotionPressable accessibilityRole="button" onPress={retry} style={styles.retry}>
            <Text style={[styles.retryText, { color: accent }]}>
              {t('ranks.achievements.showcase.retry')}
            </Text>
          </MotionPressable>
        </View>
      );
    }

    if (bodyState === 'loading') {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }

    if (bodyState === 'empty') {
      return (
        <View style={styles.centerState}>
          <Text style={styles.stateText}>{t('ranks.achievements.showcase.empty')}</Text>
        </View>
      );
    }

    return (
      <View style={styles.grid}>
        {unlocked.map((achievement) => {
          const position = draft.indexOf(achievement.key);
          const isSelected = position >= 0;
          const name = t(`ranks.achievements.items.${achievement.key}.name`);

          return (
            <MotionPressable
              accessibilityHint={t('ranks.achievements.showcase.toggleHint')}
              accessibilityLabel={
                isSelected
                  ? t('ranks.achievements.showcase.selectedA11y', {
                      name,
                      position: position + 1,
                    })
                  : t('ranks.achievements.showcase.unselectedA11y', { name })
              }
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              disabled={isSaving}
              key={achievement.key}
              onPress={() => toggle(achievement.key)}
              style={[
                styles.card,
                isSelected && {
                  backgroundColor: withAlpha(accent, isDark ? 0.16 : 0.1),
                  borderColor: accent,
                },
              ]}>
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: withAlpha(accent, isDark ? 0.2 : 0.13) },
                  ]}>
                  <Ionicons
                    color={isSelected ? accent : colors.textTertiary}
                    name={ACHIEVEMENT_ICONS[achievement.key]}
                    size={20}
                  />
                </View>
                {isSelected && (
                  <View style={[styles.order, { backgroundColor: accent }]}>
                    <Text style={[styles.orderText, { color: getOnAccentColor(accent) }]}>
                      {position + 1}
                    </Text>
                  </View>
                )}
              </View>
              <Text numberOfLines={2} style={[styles.cardName, isSelected && { color: colors.text }]}>
                {name}
              </Text>
            </MotionPressable>
          );
        })}
      </View>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MotionSection style={styles.header}>
          <Text style={styles.lead}>
            {t('ranks.achievements.showcase.editLead', { count: PROFILE_SHOWCASE_LIMIT })}
          </Text>
        </MotionSection>

        <MotionSection delay={40}>{renderBody()}</MotionSection>

        {hasSaveError && (
          <Text style={styles.saveError}>{t('ranks.achievements.showcase.saveFailed')}</Text>
        )}
      </ScrollView>

      {/* Kaydetme eylemleri YALNIZCA rozet ızgarası render edildiğinde görünür:
          hata durumunda gövde "Tekrar dene"yi gösterir ve pasif bir Kaydet
          düğmesi bırakılmaz. */}
      {bodyState === 'grid' && (
        <View style={[styles.footer, { borderTopColor: colors.separator }]}>
          <MotionPressable
            accessibilityRole="button"
            accessibilityState={{ busy: isSaving, disabled: !canSave }}
            disabled={!canSave}
            onPress={() => void save(draft)}
            style={[styles.primaryButton, { backgroundColor: accent }, !canSave && styles.disabled]}>
            {isSaving ? (
              <ActivityIndicator color={getOnAccentColor(accent)} size="small" />
            ) : (
              <Text style={[styles.primaryButtonText, { color: getOnAccentColor(accent) }]}>
                {t('ranks.achievements.showcase.save')}
              </Text>
            )}
          </MotionPressable>

          {/* Özel seçim varken nötr, ikincil eylem: otomatik moda dön. */}
          {(showcaseSelection.length > 0 || draft.length > 0) && (
            <MotionPressable
              accessibilityRole="button"
              disabled={!canSave}
              onPress={() => {
                setDraft([]);
                void save([]);
              }}
              style={[styles.secondaryButton, !canSave && styles.disabled]}>
              <Text style={styles.secondaryButtonText}>
                {t('ranks.achievements.showcase.useAutomatic')}
              </Text>
            </MotionPressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    content: { paddingBottom: 24, paddingHorizontal: Layout.screenPadding, paddingTop: 8 },

    header: { marginBottom: 16 },
    lead: { color: colors.textSecondary, fontSize: 13, fontWeight: '400', lineHeight: 19 },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    /** İki sütun; dokunma hedefi 44 pt'nin çok üstünde kalır. */
    card: {
      backgroundColor: colors.card,
      borderColor: colors.separator,
      borderRadius: Layout.radiusMedium,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 8,
      minHeight: 88,
      padding: 12,
      width: '48%',
    },
    cardTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    iconWrap: {
      alignItems: 'center',
      borderRadius: 16,
      height: 32,
      justifyContent: 'center',
      width: 32,
    },
    order: {
      alignItems: 'center',
      borderRadius: 10,
      height: 20,
      justifyContent: 'center',
      width: 20,
    },
    orderText: { fontSize: 11, fontWeight: '600' },
    cardName: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', lineHeight: 17 },

    centerState: { alignItems: 'center', gap: 12, paddingVertical: 40 },
    stateText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
    retry: { justifyContent: 'center', minHeight: Layout.minTouchSize },
    retryText: { fontSize: 13, fontWeight: '600' },
    saveError: { color: colors.danger, fontSize: 13, marginTop: 16 },

    footer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 8,
      paddingBottom: 8,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 12,
    },
    primaryButton: {
      alignItems: 'center',
      borderRadius: Layout.radiusMedium,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      width: '100%',
    },
    primaryButtonText: { fontSize: 15, fontWeight: '600' },
    secondaryButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      width: '100%',
    },
    secondaryButtonText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    disabled: { opacity: 0.6 },
  });
}
