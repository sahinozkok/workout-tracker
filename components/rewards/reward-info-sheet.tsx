import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getOnAccentColor } from '@/constants/color-presets';
import { Layout, ThemeColors, Type } from '@/constants/theme';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';

export type RewardInfoKind = 'level' | 'roses';

type RewardInfoSheetProps = {
  accentColor: string;
  kind?: RewardInfoKind;
  onClose: () => void;
};

const REWARD_ROWS: { icon: keyof typeof Ionicons.glyphMap; key: string }[] = [
  { icon: 'barbell-outline', key: 'set' },
  { icon: 'timer-outline', key: 'activity' },
  { icon: 'calendar-outline', key: 'day' },
  { icon: 'repeat-outline', key: 'consistency' },
  { icon: 'heart-outline', key: 'rosea' },
];

/** Level ve gül kurallarını profil akışını terk etmeden açıklayan alt sayfa. */
export function RewardInfoSheet({ accentColor, kind, onClose }: RewardInfoSheetProps) {
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const isLevel = kind === 'level';
  const rewardColor = isLevel ? accentColor : '#C86E61';

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={kind !== undefined}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <SafeAreaView
          accessibilityViewIsModal
          edges={['bottom']}
          style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
              <View style={[styles.headerIcon, { borderColor: rewardColor }]}>
                <Ionicons
                  color={rewardColor}
                  name={isLevel ? 'star' : 'heart'}
                  size={22}
                />
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>
                  {t(isLevel ? 'rewards.info.levelTitle' : 'rewards.info.rosesTitle')}
                </Text>
                <Text style={styles.intro}>
                  {t(isLevel ? 'rewards.info.levelIntro' : 'rewards.info.rosesIntro')}
                </Text>
              </View>
            </View>

            <View style={styles.rules}>
              {REWARD_ROWS.map((row, index) => (
                <View
                  key={row.key}
                  style={[styles.rule, index > 0 && styles.ruleDivider]}>
                  <Ionicons color={rewardColor} name={row.icon} size={18} />
                  <View style={styles.ruleCopy}>
                    <Text style={styles.ruleTitle}>
                      {t(`rewards.info.${row.key}Title`)}
                    </Text>
                    <Text style={styles.ruleBody}>
                      {t(`rewards.info.${row.key}${isLevel ? 'Xp' : 'Roses'}`)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            {isLevel && (
              <View style={styles.levelBlock}>
                <Text
                  style={[styles.levelEyebrow, { color: rewardColor }]}>
                  {t('rewards.info.levelCurveTitle')}
                </Text>
                <Text style={styles.levelBody}>{t('rewards.info.levelCurveBody')}</Text>
                <Text style={styles.levelNote}>{t('rewards.info.levelProgressNote')}</Text>
              </View>
            )}

            <Text style={styles.footerNote}>{t('rewards.info.onceNote')}</Text>

            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: rewardColor },
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.closeButtonText, { color: getOnAccentColor(rewardColor) }]}>
                {t('rewards.info.gotIt')}
              </Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.58)' },
    sheet: {
      alignSelf: 'center',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      maxHeight: '78%',
      overflow: 'hidden',
      width: '100%',
    },
    handle: {
      alignSelf: 'center',
      backgroundColor: colors.textTertiary,
      borderRadius: 3,
      height: 5,
      marginTop: 12,
      opacity: 0.48,
      width: 48,
    },
    content: {
      gap: 20,
      paddingBottom: 22,
      paddingHorizontal: Layout.screenPadding,
      paddingTop: 18,
    },
    header: { alignItems: 'center', flexDirection: 'row', gap: 14 },
    headerIcon: {
      alignItems: 'center',
      borderRadius: 24,
      borderWidth: StyleSheet.hairlineWidth,
      height: 48,
      justifyContent: 'center',
      width: 48,
    },
    headerCopy: { flex: 1, gap: 3 },
    title: { color: colors.text, ...Type.sectionTitle },
    intro: { color: colors.textSecondary, ...Type.caption, lineHeight: 18 },
    rules: { borderBottomColor: colors.separator, borderBottomWidth: StyleSheet.hairlineWidth },
    rule: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, paddingVertical: 13 },
    ruleDivider: { borderTopColor: colors.separator, borderTopWidth: StyleSheet.hairlineWidth },
    ruleCopy: { flex: 1, gap: 2 },
    ruleTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    ruleBody: { color: colors.textSecondary, ...Type.caption, lineHeight: 18 },
    levelBlock: { gap: 7 },
    levelEyebrow: { ...Type.eyebrow, textTransform: 'uppercase' },
    levelBody: { color: colors.text, ...Type.caption, lineHeight: 19 },
    levelNote: { color: colors.textSecondary, ...Type.footnote, lineHeight: 16 },
    footerNote: { color: colors.textTertiary, ...Type.footnote, lineHeight: 16 },
    closeButton: {
      alignItems: 'center',
      borderRadius: Layout.radiusPill,
      justifyContent: 'center',
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 20,
    },
    closeButtonText: { fontSize: 15, fontWeight: '700' },
    pressed: { opacity: 0.72 },
  });
}
