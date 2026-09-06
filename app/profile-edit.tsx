import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MotionPressable } from '@/components/motion-pressable';
import { HeaderBackButton, useSafeBack } from '@/components/navigation/header-back-button';
import { getOnAccentColor } from '@/constants/color-presets';
import { Layout, ThemeColors } from '@/constants/theme';
import { useLanguage } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { useProfileEditor } from '@/hooks/use-profile-editor';
import { TrainingGoal } from '@/types/profile';

const PROFILE_ACCENT_DEFAULT = '#D5755B';

const GOAL_OPTIONS: { glyph: string; labelKey: string; value: TrainingGoal }[] = [
  { glyph: '📅', labelKey: 'profile.goalConsistency', value: 'consistency' },
  { glyph: '⚡', labelKey: 'profile.goalStrength', value: 'strength' },
  { glyph: '🏋️', labelKey: 'profile.goalMuscle', value: 'muscle' },
  { glyph: '♡', labelKey: 'profile.goalFitness', value: 'fitness' },
];

/**
 * PROFİLİ DÜZENLE — Ayarlar'dan açılan kök Stack ekranı.
 *
 * Eski açılır profil editörünün YERİNE gelir. Bütün mantık ortak
 * `useProfileEditor` hook'undadır (tek kayıt/doğrulama/medya kaynağı). Geri
 * düğmesi Ayarlar'a güvenle döner; kayıt başarılı olunca da aynı güvenli geri.
 */
export default function ProfileEditScreen() {
  const { colors, isDark } = useAppTheme();
  const { t } = useLanguage();
  const accent = useFeatureColor('profile', PROFILE_ACCENT_DEFAULT).color;
  const styles = useMemo(
    () => createStyles(colors, isDark, { accent, onAccent: getOnAccentColor(accent) }),
    [accent, colors, isDark],
  );
  const safeBack = useSafeBack('/settings');
  const {
    avatarLetter,
    canSaveProfile,
    draft,
    isSaving,
    pickImage,
    removeImage,
    save,
    updateDraft,
    uploadingKind,
  } = useProfileEditor();

  const onSave = async () => {
    const outcome = await save();
    if (outcome === 'saved') safeBack();
  };

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <Stack.Screen
        options={{
          headerLeft: () => <HeaderBackButton accessibilityLabel={t('common.back')} fallback="/settings" />,
          title: t('profile.editNavTitle'),
        }}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Text style={styles.introText}>{t('profile.intro')}</Text>

          <View style={styles.mediaEditorRow}>
            <View style={styles.avatarEditorPreview}>
              {draft.avatarUri ? (
                <Image autoplay contentFit="cover" source={{ uri: draft.avatarUri }} style={styles.mediaPreviewImage} />
              ) : (
                <Text style={styles.mediaPreviewLetter}>{avatarLetter}</Text>
              )}
              {uploadingKind === 'avatar' && (
                <View style={styles.mediaPreviewOverlay}>
                  <ActivityIndicator color="#F4F4F6" size="small" />
                </View>
              )}
            </View>
            <View style={styles.mediaEditorCopy}>
              <Pressable
                accessibilityRole="button"
                disabled={uploadingKind !== undefined || !canSaveProfile}
                onPress={() => void pickImage('avatar')}
                style={({ pressed }) => [styles.mediaChangeButton, pressed && styles.pressed]}>
                <Text style={styles.mediaChangeText}>
                  {uploadingKind === 'avatar'
                    ? t('profile.uploading')
                    : draft.avatarUri
                      ? t('profile.changePhoto')
                      : t('profile.choosePhoto')}
                </Text>
              </Pressable>
              {draft.avatarUri && (
                <Pressable
                  accessibilityRole="button"
                  disabled={uploadingKind !== undefined || !canSaveProfile}
                  onPress={() => void removeImage('avatar')}
                  style={({ pressed }) => [styles.mediaRemoveButton, pressed && styles.pressed]}>
                  <Text style={styles.mediaRemoveText}>{t('common.remove')}</Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={styles.mediaEditorRow}>
            <View style={styles.bannerEditorPreview}>
              {draft.bannerUri ? (
                <Image autoplay contentFit="cover" source={{ uri: draft.bannerUri }} style={styles.mediaPreviewImage} />
              ) : (
                <View style={styles.mediaPreviewPlaceholder} />
              )}
              {uploadingKind === 'banner' && (
                <View style={styles.mediaPreviewOverlay}>
                  <ActivityIndicator color="#F4F4F6" size="small" />
                </View>
              )}
            </View>
            <View style={styles.mediaEditorCopy}>
              <Pressable
                accessibilityRole="button"
                disabled={uploadingKind !== undefined || !canSaveProfile}
                onPress={() => void pickImage('banner')}
                style={({ pressed }) => [styles.mediaChangeButton, pressed && styles.pressed]}>
                <Text style={styles.mediaChangeText}>
                  {uploadingKind === 'banner'
                    ? t('profile.uploading')
                    : draft.bannerUri
                      ? t('profile.changeBanner')
                      : t('profile.addBanner')}
                </Text>
              </Pressable>
              {draft.bannerUri && (
                <Pressable
                  accessibilityRole="button"
                  disabled={uploadingKind !== undefined || !canSaveProfile}
                  onPress={() => void removeImage('banner')}
                  style={({ pressed }) => [styles.mediaRemoveButton, pressed && styles.pressed]}>
                  <Text style={styles.mediaRemoveText}>{t('profile.removeBanner')}</Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('profile.displayName')}</Text>
            <TextInput
              keyboardAppearance={isDark ? 'dark' : 'light'}
              maxLength={40}
              onChangeText={(value) => updateDraft('displayName', value)}
              placeholder={t('profile.displayNamePlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              style={styles.input}
              value={draft.displayName}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('profile.username')}</Text>
            <View style={styles.usernameRow}>
              <Text style={styles.atSign}>@</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                maxLength={24}
                onChangeText={(value) => updateDraft('username', value.replace(/^@/, ''))}
                placeholder={t('profile.usernamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                style={styles.usernameInput}
                value={draft.username}
              />
            </View>
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>{t('profile.bio')}</Text>
              <Text style={styles.counter}>{draft.bio.length}/140</Text>
            </View>
            <TextInput
              keyboardAppearance={isDark ? 'dark' : 'light'}
              maxLength={140}
              multiline
              onChangeText={(value) => updateDraft('bio', value)}
              placeholder={t('profile.bioPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              style={[styles.input, styles.bioInput]}
              textAlignVertical="top"
              value={draft.bio}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('profile.goal')}</Text>
            <View accessibilityRole="radiogroup" style={styles.goalOptions}>
              {GOAL_OPTIONS.map((option) => {
                const isSelected = draft.trainingGoal === option.value;
                return (
                  <Pressable
                    accessibilityLabel={t(option.labelKey)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    key={option.value}
                    onPress={() => updateDraft('trainingGoal', option.value)}
                    style={({ pressed }) => [
                      styles.goalOption,
                      isSelected && styles.goalOptionSelected,
                      pressed && styles.pressed,
                    ]}>
                    <Text style={styles.goalGlyph}>{option.glyph}</Text>
                    <Text style={[styles.goalText, isSelected && styles.goalTextSelected]}>{t(option.labelKey)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <MotionPressable
            accessibilityRole="button"
            disabled={isSaving || !canSaveProfile}
            onPress={() => void onSave()}
            style={[styles.saveButton, (isSaving || !canSaveProfile) && styles.pressed]}>
            <Text style={styles.saveButtonText}>{isSaving ? t('common.saving') : t('profile.save')}</Text>
          </MotionPressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors, isDark: boolean, profile: { accent: string; onAccent: string }) {
  const accent = profile.accent;
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    flex: { flex: 1 },
    content: { paddingBottom: 40, paddingTop: 20 },
    introText: {
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 21,
      marginBottom: 28,
      paddingHorizontal: 24,
    },
    mediaEditorRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 22,
      marginBottom: 28,
      paddingHorizontal: 24,
    },
    avatarEditorPreview: {
      alignItems: 'center',
      backgroundColor: isDark ? '#222225' : '#E5E5EA',
      borderRadius: 38,
      height: 76,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 76,
    },
    bannerEditorPreview: {
      backgroundColor: isDark ? '#222225' : '#E5E5EA',
      borderRadius: 12,
      height: 68,
      overflow: 'hidden',
      width: 116,
    },
    mediaPreviewImage: { height: '100%', width: '100%' },
    mediaPreviewPlaceholder: { backgroundColor: isDark ? '#222225' : '#E5E5EA', flex: 1 },
    mediaPreviewLetter: { color: accent, fontSize: 25, fontWeight: '600' },
    mediaPreviewOverlay: {
      alignItems: 'center',
      backgroundColor: '#00000099',
      bottom: 0,
      justifyContent: 'center',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    mediaEditorCopy: { alignItems: 'flex-start', flex: 1 },
    mediaChangeButton: { justifyContent: 'center', minHeight: Layout.minTouchSize },
    mediaChangeText: { color: accent, fontSize: 17, fontWeight: '700' },
    mediaRemoveButton: { justifyContent: 'center', minHeight: 30 },
    mediaRemoveText: { color: colors.textSecondary, fontSize: 15, textDecorationLine: 'underline' },
    field: { gap: 6, marginBottom: 26, paddingHorizontal: 24 },
    labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    label: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    counter: { color: colors.textTertiary, fontSize: 12 },
    input: {
      backgroundColor: 'transparent',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRadius: 0,
      color: colors.text,
      fontSize: 17,
      minHeight: 48,
      paddingHorizontal: 0,
      paddingVertical: 10,
    },
    usernameRow: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderBottomColor: colors.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      minHeight: 48,
      paddingHorizontal: 0,
    },
    atSign: { color: colors.text, fontSize: 17 },
    usernameInput: { color: colors.text, flex: 1, fontSize: 17, paddingHorizontal: 2, paddingVertical: 10 },
    bioInput: { minHeight: 48 },
    goalOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    goalOption: {
      alignItems: 'center',
      borderColor: colors.separator,
      borderRadius: Layout.radiusPill,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: 6,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 18,
    },
    goalOptionSelected: { backgroundColor: accent, borderColor: accent },
    goalGlyph: { fontSize: 13 },
    goalText: { color: colors.textSecondary, fontSize: 15, fontWeight: '400' },
    goalTextSelected: { color: profile.onAccent, fontWeight: '600' },
    saveButton: {
      alignItems: 'center',
      backgroundColor: accent,
      borderRadius: 20,
      justifyContent: 'center',
      marginHorizontal: 24,
      marginTop: 10,
      minHeight: 58,
    },
    saveButtonText: { color: profile.onAccent, fontSize: 17, fontWeight: '700' },
    pressed: { opacity: 0.6 },
  });
}
