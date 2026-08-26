import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  COLOR_PRESET_FAMILIES,
  ColorFeature,
  ColorPresetFamily,
  ColorPresetId,
  getColorPresetHex,
  getOnAccentColor,
} from '@/constants/color-presets';
import { Form, Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

const FAMILY_LABEL_KEYS: Record<ColorPresetFamily, string> = {
  orange: 'profile.colorFamilyOrange',
  red: 'profile.colorFamilyRed',
  pink: 'profile.colorFamilyPink',
  purple: 'profile.colorFamilyPurple',
  blue: 'profile.colorFamilyBlue',
  cyan: 'profile.colorFamilyCyan',
  green: 'profile.colorFamilyGreen',
  gold: 'profile.colorFamilyGold',
  neutral: 'profile.colorFamilyNeutral',
};

export type ColorPresetRowProps = {
  /** Ayarlar satırında gösterilen GEÇERLİ renk (özel seçim varsa onun hex'i). */
  currentColor: string;
  /**
   * Bölümün VARSAYILAN rengi. Modaldaki "Varsayılanı kullan" satırı bunu
   * gösterir; özel bir renk seçiliyken `currentColor` gösterilseydi kullanıcı
   * varsayılana dönünce hangi rengin geleceğini yanlış görürdü.
   */
  defaultColor: string;
  feature: ColorFeature;
  labelKey: string;
  onSelect: (presetId: ColorPresetId | undefined) => void;
  selectedPresetId?: ColorPresetId;
};

/**
 * Ayarlar'daki kompakt renk satırı: özellik adı + dairesel örnek + chevron.
 * Dokununca ön ayar ızgarası bir alt sayfada açılır.
 *
 * Ayarların mevcut tasarım dili korunur: yüzey, ayırıcı ve metin renkleri
 * global temadan gelir; yalnızca örnek dairesi seçilen rengi gösterir.
 */
export function ColorPresetRow({
  currentColor,
  defaultColor,
  feature,
  labelKey,
  onSelect,
  selectedPresetId,
}: ColorPresetRowProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityHint={t('profile.colorPresetsCaption')}
        accessibilityRole="button"
        accessibilityLabel={t(labelKey)}
        onPress={() => setIsPickerOpen(true)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <Text style={styles.rowLabel}>{t(labelKey)}</Text>
        <View style={[styles.swatchDot, { backgroundColor: currentColor }]} />
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsPickerOpen(false)}
        presentationStyle="overFullScreen"
        transparent
        visible={isPickerOpen}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel={t('common.close')}
            accessibilityRole="button"
            onPress={() => setIsPickerOpen(false)}
            style={styles.backdrop}
          />
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.handle} />
            <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>{t(labelKey)}</Text>

              {/* Varsayılana dönüş: bu özellik bugünkü rengine geri döner. */}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: !selectedPresetId }}
                onPress={() => {
                  onSelect(undefined);
                  setIsPickerOpen(false);
                }}
                style={({ pressed }) => [styles.defaultRow, pressed && styles.pressed]}>
                <View style={[styles.swatchDot, { backgroundColor: defaultColor }]} />
                <Text style={styles.defaultRowText}>{t('profile.colorUseDefault')}</Text>
                {!selectedPresetId && (
                  <Ionicons name="checkmark" size={18} color={colors.text} />
                )}
              </Pressable>

              {COLOR_PRESET_FAMILIES.map(({ family, presets }) => (
                <View key={family} style={styles.familyBlock}>
                  <Text style={styles.familyLabel}>{t(FAMILY_LABEL_KEYS[family])}</Text>
                  <View style={styles.swatchGrid}>
                    {presets.map((presetId) => {
                      const hex = getColorPresetHex(presetId);
                      const isSelected = presetId === selectedPresetId;

                      return (
                        <Pressable
                          accessibilityLabel={`${t(labelKey)} — ${hex}`}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          key={presetId}
                          onPress={() => {
                            onSelect(presetId);
                            setIsPickerOpen(false);
                          }}
                          style={({ pressed }) => [styles.swatchTouchable, pressed && styles.pressed]}>
                          <View
                            style={[
                              styles.swatch,
                              { backgroundColor: hex },
                              isSelected && styles.swatchSelected,
                            ]}>
                            {isSelected && (
                              <Ionicons name="checkmark" size={18} color={getOnAccentColor(hex)} />
                            )}
                          </View>
                          <Text numberOfLines={1} style={styles.swatchHex}>
                            {hex}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      minHeight: Layout.minTouchSize,
      paddingVertical: 10,
    },
    rowLabel: { color: colors.text, flex: 1, ...Type.body },
    swatchDot: {
      borderColor: colors.separator,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      height: 22,
      width: 22,
    },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.58)' },
    sheet: {
      alignSelf: 'center',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      maxHeight: '88%',
      overflow: 'hidden',
      width: '100%',
    },
    handle: {
      alignSelf: 'center',
      backgroundColor: colors.textTertiary,
      borderRadius: 3,
      height: 5,
      marginTop: 14,
      opacity: 0.48,
      width: 52,
    },
    sheetContent: {
      gap: Form.sectionGap,
      paddingBottom: 24,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 20,
    },
    sheetTitle: { color: colors.text, ...Form.title },
    defaultRow: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Form.controlRadius,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 12,
      minHeight: Form.controlHeight,
      paddingHorizontal: 14,
    },
    defaultRowText: { color: colors.text, flex: 1, ...Type.body },
    familyBlock: { gap: 10 },
    familyLabel: { color: colors.textSecondary, ...Type.eyebrow },
    swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    // Dokunma alanı en az 44×44.
    swatchTouchable: { alignItems: 'center', gap: 4, minWidth: Layout.minTouchSize },
    swatch: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Form.controlRadius,
      borderWidth: StyleSheet.hairlineWidth,
      height: Layout.minTouchSize,
      justifyContent: 'center',
      width: Layout.minTouchSize,
    },
    swatchSelected: { borderColor: colors.text, borderWidth: 3 },
    swatchHex: { color: colors.textTertiary, ...Type.footnote },
    pressed: { opacity: 0.6 },
  });
}
