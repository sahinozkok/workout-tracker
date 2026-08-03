import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemeColors } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useProfile } from '@/context/profile-context';
import { ThemePreference } from '@/context/theme-context';
import { useWorkout } from '@/context/workout-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { TrainingGoal, UserProfile } from '@/types/profile';
import { calculateDisciplineStreak } from '@/utils/discipline';
import { cancelRestNotification } from '@/utils/rest-notifications';

const GOAL_OPTIONS: { icon: keyof typeof Ionicons.glyphMap; label: string; value: TrainingGoal }[] = [
  { icon: 'calendar-outline', label: 'Düzen', value: 'consistency' },
  { icon: 'flash-outline', label: 'Güç', value: 'strength' },
  { icon: 'barbell-outline', label: 'Kas', value: 'muscle' },
  { icon: 'heart-outline', label: 'Form', value: 'fitness' },
];

export default function ProfileScreen() {
  const { signOut, user } = useAuth();
  const { profile, restTimerEnabled, saveProfile, setRestTimerEnabled } = useProfile();
  const { disciplineStatuses, programs } = useWorkout();
  const { colors, isDark, preference, setPreference } = useAppTheme();
  const styles = createStyles(colors);
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [isSaving, setIsSaving] = useState(false);
  const disciplineStreak = calculateDisciplineStreak(disciplineStatuses);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  function updateDraft<Key extends keyof UserProfile>(key: Key, value: UserProfile[Key]) {
    setDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
  }

  async function pickProfilePhoto() {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Galeri izni gerekli', 'Profil fotoğrafı seçebilmek için galeri erişimine izin vermelisin.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      updateDraft('avatarUri', result.assets[0].uri);
    }
  }

  async function handleSave() {
    const displayName = draft.displayName.trim();
    const username = draft.username.trim().replace(/^@/, '').toLocaleLowerCase('tr-TR');

    if (!displayName) {
      Alert.alert('Ad gerekli', 'Profilinde görünecek bir ad yazmalısın.');
      return;
    }

    if (username && !/^[a-z0-9_]{3,24}$/.test(username)) {
      Alert.alert(
        'Kullanıcı adını kontrol et',
        'Kullanıcı adı 3-24 karakter olmalı; yalnızca küçük harf, sayı ve alt çizgi içerebilir.',
      );
      return;
    }

    const nextProfile: UserProfile = {
      ...draft,
      displayName,
      username,
      bio: draft.bio.trim(),
    };

    setIsSaving(true);
    try {
      await saveProfile(nextProfile);
      Alert.alert('Profil kaydedildi', 'Değişikliklerin bu cihazda saklandı.');
    } catch {
      Alert.alert('Profil kaydedilemedi', 'Lütfen tekrar dene.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRestTimerToggle(enabled: boolean) {
    try {
      await setRestTimerEnabled(enabled);
      if (!enabled) await cancelRestNotification();
    } catch {
      Alert.alert('Ayar kaydedilemedi', 'Mola sayacı ayarını tekrar değiştirmeyi dene.');
    }
  }

  function handleSignOut() {
    Alert.alert('Çıkış yap', 'Bu cihazdaki Supabase oturumun kapatılacak. Devam etmek istiyor musun?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Çıkış yap',
        style: 'destructive',
        onPress: async () => {
          const result = await signOut();
          if (result.error) Alert.alert('Çıkış yapılamadı', result.error);
        },
      },
    ]);
  }

  const avatarLetter = draft.displayName.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'S';

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              {draft.avatarUri ? (
                <Image contentFit="cover" source={{ uri: draft.avatarUri }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarLetter}>{avatarLetter}</Text>
              )}
            </View>
            <View style={styles.profileText}>
              <Text style={styles.name}>{draft.displayName || 'Sporcu'}</Text>
              <Text style={styles.username}>{draft.username ? `@${draft.username}` : 'Kullanıcı adı eklenmedi'}</Text>
              {!!draft.bio && <Text style={styles.bio}>{draft.bio}</Text>}
            </View>
          </View>

          <View style={styles.statsRow}>
            <ProfileStat icon="barbell-outline" label="Program" value={String(programs.length)} />
            <ProfileStat icon="flame-outline" label="Seri" value={`${disciplineStreak} gün`} accent />
          </View>

          <View style={styles.settingsCard}>
            <SectionHeader
              caption="Profilinde görünecek bilgileri düzenle."
              icon="person-circle-outline"
              title="Profil bilgileri"
            />

            <View style={styles.photoEditor}>
              <View style={styles.photoPreview}>
                {draft.avatarUri ? (
                  <Image contentFit="cover" source={{ uri: draft.avatarUri }} style={styles.photoPreviewImage} />
                ) : (
                  <Text style={styles.photoPreviewLetter}>{avatarLetter}</Text>
                )}
              </View>
              <View style={styles.photoEditorText}>
                <Text style={styles.label}>Profil fotoğrafı</Text>
                <Text style={styles.caption}>Galeriden kare bir fotoğraf seçebilirsin.</Text>
                <View style={styles.photoActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={pickProfilePhoto}
                    style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}>
                    <Ionicons name="images-outline" size={17} color={colors.primaryIcon} />
                    <Text style={styles.photoButtonText}>{draft.avatarUri ? 'Değiştir' : 'Fotoğraf seç'}</Text>
                  </Pressable>
                  {draft.avatarUri && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => updateDraft('avatarUri', undefined)}
                      style={({ pressed }) => [styles.removePhotoButton, pressed && styles.pressed]}>
                      <Text style={styles.removePhotoButtonText}>Kaldır</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Görünen ad</Text>
              <TextInput
                keyboardAppearance={isDark ? 'dark' : 'light'}
                maxLength={40}
                onChangeText={(value) => updateDraft('displayName', value)}
                placeholder="Adın"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                style={styles.input}
                value={draft.displayName}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Kullanıcı adı</Text>
              <View style={styles.usernameInputRow}>
                <Text style={styles.atSign}>@</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                  maxLength={24}
                  onChangeText={(value) => updateDraft('username', value.replace(/^@/, ''))}
                  placeholder="kullanici_adi"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  style={styles.usernameInput}
                  value={draft.username}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Kısa biyografi</Text>
                <Text style={styles.counter}>{draft.bio.length}/140</Text>
              </View>
              <TextInput
                keyboardAppearance={isDark ? 'dark' : 'light'}
                maxLength={140}
                multiline
                onChangeText={(value) => updateDraft('bio', value)}
                placeholder="Antrenman hedeflerinden kısaca bahset."
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.primary}
                style={[styles.input, styles.bioInput]}
                textAlignVertical="top"
                value={draft.bio}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Ana hedefin</Text>
              <View style={styles.goalOptions}>
                {GOAL_OPTIONS.map((option) => {
                  const isSelected = draft.trainingGoal === option.value;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: isSelected }}
                      key={option.value}
                      onPress={() => updateDraft('trainingGoal', option.value)}
                      style={({ pressed }) => [
                        styles.goalOption,
                        isSelected && styles.goalOptionSelected,
                        pressed && styles.pressed,
                      ]}>
                      <Ionicons
                        name={option.icon}
                        size={20}
                        color={isSelected ? colors.onPrimary : colors.primaryIcon}
                      />
                      <Text style={[styles.goalOptionText, isSelected && styles.goalOptionTextSelected]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={handleSave}
              style={({ pressed }) => [styles.saveButton, (pressed || isSaving) && styles.pressed]}>
              <Ionicons name="checkmark-circle-outline" size={21} color={colors.onPrimary} />
              <Text style={styles.saveButtonText}>{isSaving ? 'Kaydediliyor…' : 'Profili kaydet'}</Text>
            </Pressable>
          </View>

          <View style={[styles.settingsCard, styles.appearanceCard]}>
            <View style={styles.appearanceText}>
              <Text style={styles.settingTitle}>Görünüm</Text>
              <Text style={styles.caption}>Uygulamanın renk temasını seç.</Text>
            </View>

            <View accessibilityRole="radiogroup" style={styles.compactThemeToggle}>
              <CompactThemeButton
                icon="sunny-outline"
                label="Açık tema"
                selected={preference === 'light'}
                value="light"
                onSelect={setPreference}
              />
              <CompactThemeButton
                icon="phone-portrait-outline"
                label="Telefonun temasını kullan"
                selected={preference === 'system'}
                value="system"
                onSelect={setPreference}
              />
              <CompactThemeButton
                icon="moon-outline"
                label="Koyu tema"
                selected={preference === 'dark'}
                value="dark"
                onSelect={setPreference}
              />
            </View>
          </View>

          <View style={[styles.settingsCard, styles.appearanceCard]}>
            <View style={styles.settingIconCircle}>
              <Ionicons name="timer-outline" size={20} color={colors.accentText} />
            </View>
            <View style={styles.appearanceText}>
              <Text style={styles.settingTitle}>Mola sayacı</Text>
              <Text style={styles.caption}>Setten sonra dinlenme süresini sayar ve telefonda hatırlatır.</Text>
            </View>
            <Switch
              accessibilityLabel="Mola sayacını aç veya kapat"
              onValueChange={(enabled) => void handleRestTimerToggle(enabled)}
              thumbColor={restTimerEnabled ? colors.onPrimary : colors.textTertiary}
              trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
              value={restTimerEnabled}
            />
          </View>

          <View style={styles.accountCard}>
            <View style={styles.accountInfo}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.disciplineCompleted} />
              <View style={styles.accountText}>
                <Text style={styles.accountTitle}>Supabase hesabı bağlı</Text>
                <Text numberOfLines={1} style={styles.accountEmail}>{user?.email}</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={handleSignOut}
              style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}>
              <Ionicons name="log-out-outline" size={18} color={colors.danger} />
              <Text style={styles.signOutText}>Çıkış yap</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ProfileStat({
  accent = false,
  icon,
  label,
  value,
}: {
  accent?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);

  return (
    <View style={styles.statCard}>
      <Ionicons name={icon} size={20} color={accent ? colors.accent : colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({
  caption,
  icon,
  title,
}: {
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);

  return (
    <View style={styles.settingHeader}>
      <Ionicons name={icon} size={23} color={colors.accent} />
      <View style={styles.settingHeaderText}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
    </View>
  );
}

type CompactThemeButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onSelect: (preference: ThemePreference) => void;
  selected: boolean;
  value: ThemePreference;
};

function CompactThemeButton({ icon, label, onSelect, selected, value }: CompactThemeButtonProps) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={() => onSelect(value)}
      style={({ pressed }) => [
        styles.compactThemeButton,
        selected && styles.compactThemeButtonSelected,
        pressed && styles.pressed,
      ]}>
      <Ionicons name={icon} size={19} color={selected ? colors.onPrimary : colors.icon} />
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { backgroundColor: colors.background, flex: 1 },
    container: { flex: 1 },
    content: { gap: 16, padding: 20, paddingBottom: 36 },
    profileCard: {
      alignItems: 'center',
      backgroundColor: colors.primaryStrong,
      borderRadius: 22,
      flexDirection: 'row',
      gap: 14,
      padding: 20,
    },
    avatar: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 34,
      height: 68,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 68,
    },
    avatarImage: { height: '100%', width: '100%' },
    avatarLetter: { color: colors.onPrimary, fontSize: 28, fontWeight: '900' },
    profileText: { flex: 1, gap: 3 },
    name: { color: colors.onPrimary, fontSize: 21, fontWeight: '800' },
    username: { color: colors.heroText, fontSize: 13 },
    bio: { color: colors.heroText, fontSize: 13, lineHeight: 18, marginTop: 4 },
    statsRow: { flexDirection: 'row', gap: 10 },
    statCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 15,
      borderWidth: 1,
      flex: 1,
      gap: 3,
      padding: 14,
    },
    statValue: { color: colors.text, fontSize: 19, fontWeight: '800' },
    statLabel: { color: colors.textSecondary, fontSize: 12 },
    settingsCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 20,
      borderWidth: 1,
      gap: 16,
      padding: 18,
    },
    settingHeader: { alignItems: 'center', flexDirection: 'row', gap: 12 },
    settingHeaderText: { flex: 1 },
    settingTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
    caption: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
    photoEditor: { alignItems: 'center', flexDirection: 'row', gap: 13 },
    photoPreview: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderRadius: 28,
      height: 56,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 56,
    },
    photoPreviewImage: { height: '100%', width: '100%' },
    photoPreviewLetter: { color: colors.primarySoftText, fontSize: 21, fontWeight: '900' },
    photoEditorText: { flex: 1 },
    photoActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
    photoButton: {
      alignItems: 'center',
      backgroundColor: colors.primarySoft,
      borderColor: colors.primarySoftBorder,
      borderRadius: 9,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    photoButtonText: { color: colors.primarySoftText, fontSize: 11, fontWeight: '800' },
    removePhotoButton: { justifyContent: 'center', paddingHorizontal: 6 },
    removePhotoButtonText: { color: colors.danger, fontSize: 11, fontWeight: '800' },
    fieldGroup: { gap: 7 },
    labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    label: { color: colors.text, fontSize: 13, fontWeight: '700' },
    counter: { color: colors.textTertiary, fontSize: 11 },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: 13,
      borderWidth: 1,
      color: colors.text,
      fontSize: 15,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    usernameInputRow: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.inputBorder,
      borderRadius: 13,
      borderWidth: 1,
      flexDirection: 'row',
      paddingLeft: 14,
    },
    atSign: { color: colors.textSecondary, fontSize: 15, fontWeight: '700' },
    usernameInput: { color: colors.text, flex: 1, fontSize: 15, paddingHorizontal: 6, paddingVertical: 13 },
    bioInput: { minHeight: 92 },
    goalOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    goalOption: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderRadius: 11,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    goalOptionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    goalOptionText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
    goalOptionTextSelected: { color: colors.onPrimary },
    saveButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 13,
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      paddingVertical: 13,
    },
    saveButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '800' },
    appearanceCard: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      paddingVertical: 14,
    },
    appearanceText: { flex: 1 },
    settingIconCircle: {
      alignItems: 'center',
      backgroundColor: colors.accentSoft,
      borderRadius: 10,
      height: 38,
      justifyContent: 'center',
      width: 38,
    },
    compactThemeToggle: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 3,
      padding: 3,
    },
    compactThemeButton: {
      alignItems: 'center',
      borderRadius: 8,
      height: 34,
      justifyContent: 'center',
      width: 34,
    },
    compactThemeButtonSelected: { backgroundColor: colors.primary },
    accountCard: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      gap: 13,
      padding: 15,
    },
    accountInfo: { alignItems: 'center', flexDirection: 'row', gap: 10 },
    accountText: { flex: 1 },
    accountTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
    accountEmail: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    signOutButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexDirection: 'row',
      gap: 6,
      paddingVertical: 4,
    },
    signOutText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
    pressed: { opacity: 0.72 },
  });
}
