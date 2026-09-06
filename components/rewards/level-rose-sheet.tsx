import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LevelRoseEmblem } from '@/components/rewards/level-rose-emblem';
import { LEVEL_ROSES, isRoseUnlocked, resolveDisplayedRose } from '@/constants/level-roses';
import { Layout, ThemeColors } from '@/constants/theme';
import { LevelRoseSaveStatus } from '@/context/reward-context';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

type LevelRoseSheetProps = {
  visible: boolean;
  /** Gerçek (sunucu) seviye — açılma ve gösterim buna göredir; DEĞİŞMEZ. */
  level: number;
  /** Ham seçim (null = otomatik). */
  selectedRoseId: string | null;
  accentColor: string;
  onClose: () => void;
  /** Seçimi kaydeder (null = otomatik). Sonuç sheet davranışını belirler. */
  onSelect: (roseId: string | null) => Promise<LevelRoseSaveStatus>;
  /** "XP nasıl kazanılır / nasıl level atlanır?" bilgisini açar. */
  onInfo: () => void;
};

/**
 * Seviye gülü SEÇİM penceresi — ekranın tamamını kaplamayan, kaydırılabilir alt
 * sayfa. 25 gül, açılma seviyeleri, kilit ve seçim durumlarıyla gösterilir.
 *
 * KURALLAR:
 *   * Güller KART/DAİRE/ÇERÇEVE içine ALINMAZ; asset olduğu gibi durur.
 *   * Seçili durum küçük bir işaretle (rozet + "Seçili" etiketi) belirtilir.
 *   * Kilitli gül SEÇİLEMEZ (soluk + kilit simgesi + açılma seviyesi).
 *   * Eski bir gülü seçmek gerçek LEVEL değerini DEĞİŞTİRMEZ (yalnız gösterim).
 *   * Kaydetme sırasında yinelenen işlemler engellenir; hatada seçim korunur ve
 *     tekrar deneme sunulur ("kaydedilmiş gibi" gösterilmez).
 *   * XP/level bilgisi görünür bir eylemle (ⓘ) buradan erişilir.
 */
export function LevelRoseSheet({
  accentColor,
  level,
  onClose,
  onInfo,
  onSelect,
  selectedRoseId,
  visible,
}: LevelRoseSheetProps) {
  const { colors, isDark } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors, accentColor);
  /**
   * Kilitli gül opaklığı TEMA BAZLIDIR: açık temada (light/warm) beyaz/inci
   * güller 0.35'te neredeyse kayboluyordu → 0.6 ile şekil/renk seçilebilir ama
   * yine soluk kalır. Koyu temada (dark/soft) fazla parlaklaştırmamak için 0.4.
   * Asset rengi korunur; yalnız opaklık değişir (tint/sabit renk yok).
   */
  const lockedDimOpacity = isDark ? 0.4 : 0.6;

  const [savingId, setSavingId] = useState<string | null | undefined>(undefined);
  const [errorId, setErrorId] = useState<string | null | undefined>(undefined);

  const displayed = resolveDisplayedRose(level, selectedRoseId);
  const isAuto = selectedRoseId === null || selectedRoseId === undefined;

  /**
   * Kaydetme hatası göstergesi — anlamı YALNIZ renge bağlı değildir: okunabilir
   * `dangerText` tonunun yanında bir "yeniden dene" ikonu ve metin etiketi de
   * bulunur (renk körlüğünde de ayırt edilir). Metin tonu bütün tema
   * varyantlarında ≥4.5:1 kontrast sağlar.
   */
  const retryTag = (
    <View style={styles.retryTag}>
      <Ionicons color={colors.dangerText} name="refresh" size={11} />
      <Text style={styles.retryText}>{t('rewards.roseSheet.retry')}</Text>
    </View>
  );

  const handleSelect = async (roseId: string | null) => {
    setErrorId(undefined);
    setSavingId(roseId);
    const status = await onSelect(roseId);
    setSavingId(undefined);
    if (status === 'error') setErrorId(roseId);
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <SafeAreaView accessibilityViewIsModal edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title}>{t('rewards.roseSheet.title')}</Text>
            <View style={styles.headerActions}>
              <Pressable
                accessibilityHint={t('rewards.roseSheet.infoHint')}
                accessibilityLabel={t('rewards.roseSheet.infoLabel')}
                accessibilityRole="button"
                hitSlop={8}
                onPress={onInfo}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                <Ionicons color={colors.textSecondary} name="information-circle-outline" size={24} />
              </Pressable>
              <Pressable
                accessibilityLabel={t('common.close')}
                accessibilityRole="button"
                hitSlop={8}
                onPress={onClose}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                <Ionicons color={colors.textSecondary} name="close" size={24} />
              </Pressable>
            </View>
          </View>

          <Text style={styles.subtitle}>{t('rewards.roseSheet.subtitle')}</Text>

          <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
            {/* Otomatik mod: en yüksek açık gülü gösterir; manuel seçimi temizler. */}
            <Pressable
              accessibilityHint={t('rewards.roseSheet.autoHint')}
              accessibilityLabel={t('rewards.roseSheet.autoLabel')}
              accessibilityRole="button"
              accessibilityState={{ selected: isAuto }}
              disabled={savingId !== undefined}
              onPress={() => void handleSelect(null)}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
              <View style={styles.emblemSlot}>
                <LevelRoseEmblem roseId={displayed.id} size={56} />
                {savingId === null ? (
                  <View style={styles.savingOverlay}>
                    <ActivityIndicator color={accentColor} size="small" />
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={[styles.itemLabel, isAuto && styles.itemLabelActive]}>
                {t('rewards.roseSheet.auto')}
              </Text>
              {isAuto ? (
                <View style={styles.selectedTag}>
                  <Ionicons color={accentColor} name="checkmark-circle" size={13} />
                  <Text style={styles.selectedTagText}>{t('rewards.roseSheet.selected')}</Text>
                </View>
              ) : errorId === null ? (
                retryTag
              ) : null}
            </Pressable>

            {LEVEL_ROSES.map((rose) => {
              const unlocked = isRoseUnlocked(rose.id, level);
              const isSelected = !isAuto && selectedRoseId === rose.id;
              // GÖRÜNÜR etiket 5 sütunlu dar düzende (375 pt) taşmasın diye HER
              // ZAMAN kısa "Lv N" formudur (kilitlide de). Kilit durumu görselde
              // kilit simgesi + soluk gülle taşınır. ERİŞİLEBİLİRLİK etiketi ise
              // tam kalır ("Locked · Lv N") — ekran okuyucu kilidi duyurur.
              const visualLabel = t('rewards.roseSheet.levelLabel', { level: rose.unlockLevel });
              const a11yLabel = unlocked
                ? visualLabel
                : t('rewards.roseSheet.lockedLabel', { level: rose.unlockLevel });
              return (
                <Pressable
                  accessibilityHint={unlocked ? t('rewards.roseSheet.selectHint') : undefined}
                  accessibilityLabel={a11yLabel}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !unlocked, selected: isSelected }}
                  disabled={!unlocked || savingId !== undefined}
                  key={rose.id}
                  onPress={() => void handleSelect(rose.id)}
                  style={({ pressed }) => [styles.item, pressed && unlocked && styles.pressed]}>
                  <View style={styles.emblemSlot}>
                    <LevelRoseEmblem
                      dimOpacity={lockedDimOpacity}
                      dimmed={!unlocked}
                      roseId={rose.id}
                      size={56}
                    />
                    {!unlocked ? (
                      <View style={styles.lockBadge}>
                        <Ionicons color={colors.textTertiary} name="lock-closed" size={12} />
                      </View>
                    ) : null}
                    {savingId === rose.id ? (
                      <View style={styles.savingOverlay}>
                        <ActivityIndicator color={accentColor} size="small" />
                      </View>
                    ) : null}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.itemLabel,
                      isSelected && styles.itemLabelActive,
                      !unlocked && styles.itemLabelLocked,
                    ]}>
                    {visualLabel}
                  </Text>
                  {isSelected ? (
                    <View style={styles.selectedTag}>
                      <Ionicons color={accentColor} name="checkmark-circle" size={13} />
                      <Text style={styles.selectedTagText}>{t('rewards.roseSheet.selected')}</Text>
                    </View>
                  ) : errorId === rose.id ? (
                    retryTag
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.4)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: Layout.radiusLarge,
      borderTopRightRadius: Layout.radiusLarge,
      maxHeight: '82%',
      paddingHorizontal: Layout.screenPadding,
    },
    handle: {
      alignSelf: 'center',
      backgroundColor: colors.separator,
      borderRadius: 3,
      height: 5,
      marginTop: 10,
      width: 40,
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 12,
    },
    title: { color: colors.text, flexShrink: 1, fontSize: 20, fontWeight: '700' },
    headerActions: { alignItems: 'center', flexDirection: 'row', gap: 4 },
    iconButton: {
      alignItems: 'center',
      height: Layout.minTouchSize,
      justifyContent: 'center',
      width: Layout.minTouchSize,
    },
    subtitle: { color: colors.textSecondary, fontSize: 13, marginBottom: 8, marginTop: 2 },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      justifyContent: 'flex-start',
      paddingBottom: 16,
      paddingTop: 4,
    },
    // 5 sütun: her hücre yaklaşık %20; kart/çerçeve YOK.
    item: {
      alignItems: 'center',
      gap: 4,
      minHeight: Layout.minTouchSize + 40,
      paddingVertical: 8,
      width: '19%',
    },
    emblemSlot: { alignItems: 'center', height: 56, justifyContent: 'center', width: 56 },
    lockBadge: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 9,
      bottom: 0,
      height: 18,
      justifyContent: 'center',
      position: 'absolute',
      right: 0,
      width: 18,
    },
    savingOverlay: {
      alignItems: 'center',
      bottom: 0,
      justifyContent: 'center',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    itemLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500', textAlign: 'center' },
    itemLabelActive: { color: accentColor, fontWeight: '700' },
    itemLabelLocked: { color: colors.textTertiary },
    selectedTag: { alignItems: 'center', flexDirection: 'row', gap: 2 },
    selectedTagText: { color: accentColor, fontSize: 10, fontWeight: '700' },
    retryTag: { alignItems: 'center', flexDirection: 'row', gap: 2 },
    /**
     * Okunabilir hata metni tonu. `danger` (doygun kırmızı) açık temada ~3.5:1
     * ile normal metin için yetersizdi; `dangerText` bütün tema varyantlarında
     * (light/warmLight/dark/softDark) `surface` üzerinde ≥4.5:1 sağlar. Anlam
     * ayrıca ikon + metinle taşınır, yalnız renge bağlı değildir.
     */
    retryText: { color: colors.dangerText, fontSize: 10, fontWeight: '700' },
    pressed: { opacity: 0.55 },
  });
}
