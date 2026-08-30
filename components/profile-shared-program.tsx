import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MotionCollapsible } from '@/components/motion-section';
import { Layout, ThemeColors } from '@/constants/theme';
import { getWeekdayLabel } from '@/constants/weekdays';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { SharedActiveProgram, SharedProgramExercise } from '@/types/friends';
import { formatMetersAsKilometers, splitSecondsIntoFields } from '@/utils/activity-input';
import { summarizeSharedProgram } from '@/utils/shared-program';

/**
 * PAYLAŞILAN AKTİF PROGRAM — kendi profil ve arkadaş profilinde AYNI bileşen.
 *
 * SALT SUNUM: kendi veriyi çekmez, mutation bağlamaz. `program` verilmezse hiç
 * render edilmez; böylece opt-out veya aktif program yok durumunda boş bir kart
 * asla görünmez. Kendi profilde DTO `useWorkout`tan, arkadaş profilinde RPC'den
 * gelir — ikisi de aynı `SharedActiveProgram` şeklindedir.
 *
 * TASARIM: tek kompakt, açılıp kapanabilir bölüm. Kart yığını/emoji/gradient
 * yoktur. Hiyerarşi büyük ada + ince ayırıcıya dayanır; sahibin accent rengi
 * yalnızca üst etiket ve chevron vurgusunda kullanılır. Dört yazı boyutu
 * (17/15/13/11), iki ağırlık (600/400).
 */
export function ProfileSharedProgram({
  accentColor,
  program,
}: {
  accentColor: string;
  program: SharedActiveProgram | undefined;
}) {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);

  if (!program) return null;

  const { dayCount, exerciseCount } = summarizeSharedProgram(program);
  const summary = `${t('sharedProgram.dayCount', { count: dayCount })} · ${t('sharedProgram.exerciseCount', { count: exerciseCount })}`;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityHint={t('sharedProgram.toggleHint')}
        accessibilityLabel={`${t('sharedProgram.title')}: ${program.name}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
        <View style={styles.headerText}>
          <Text style={[styles.eyebrow, { color: accentColor }]}>
            {t('sharedProgram.title').toLocaleUpperCase(locale)}
          </Text>
          <Text numberOfLines={1} style={styles.programName}>
            {program.name}
          </Text>
          <Text style={styles.summary}>{summary}</Text>
        </View>
        <Ionicons color={accentColor} name={expanded ? 'chevron-up' : 'chevron-down'} size={20} />
      </Pressable>

      {expanded && (
        <MotionCollapsible style={styles.body}>
          {program.days.map((day, dayIndex) => (
            <View key={`${day.scheduledWeekday}-${day.name}`} style={[styles.day, dayIndex > 0 && styles.dayDivider]}>
              <View style={styles.dayHeader}>
                <Text numberOfLines={1} style={styles.dayName}>
                  {day.name}
                </Text>
                <Text style={styles.dayWeekday}>{getWeekdayLabel(day.scheduledWeekday, locale)}</Text>
              </View>

              {day.isOffDay ? (
                <Text style={styles.restDay}>{t('sharedProgram.restDay')}</Text>
              ) : (
                day.exercises.map((exercise, exerciseIndex) => (
                  <View key={exerciseIndex} style={styles.exerciseRow}>
                    <Text numberOfLines={2} style={styles.exerciseName}>
                      {exercise.name}
                    </Text>
                    <Text style={styles.exerciseTarget}>{formatTarget(exercise, t)}</Text>
                  </View>
                ))
              )}
            </View>
          ))}
        </MotionCollapsible>
      )}
    </View>
  );
}

/**
 * Mode-aware kısa hedet. Kardiyo SAHTE bir `1 set` olarak GÖSTERİLMEZ; km/dk
 * biçimlendirmesi mevcut activity yardımcılarını ve lokalize birimleri kullanır.
 */
function formatTarget(
  exercise: SharedProgramExercise,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (exercise.trackingMode === 'sets_reps') {
    return `${exercise.targetSets} × ${exercise.targetReps}`;
  }

  if (exercise.trackingMode === 'duration') {
    const { minutes, seconds } = splitSecondsIntoFields(exercise.targetDurationSeconds);
    const minuteUnit = t('day.minutesUnit');
    const secondUnit = t('day.secondsUnit');
    if (seconds === '0') return `${minutes} ${minuteUnit}`;
    if (minutes === '0') return `${seconds} ${secondUnit}`;
    return `${minutes} ${minuteUnit} ${seconds} ${secondUnit}`;
  }

  return `${formatMetersAsKilometers(exercise.targetDistanceMeters)} ${t('day.kmUnit')}`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      borderColor: colors.border,
      borderRadius: Layout.radiusMedium,
      borderWidth: Layout.hairline,
      overflow: 'hidden',
    },
    header: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      minHeight: Layout.minTouchSize,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    headerText: { flex: 1, gap: 2, minWidth: 0 },
    eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1 },
    programName: { color: colors.text, fontSize: 17, fontWeight: '600' },
    summary: { color: colors.textSecondary, fontSize: 13, fontWeight: '400' },

    body: { paddingBottom: 6, paddingHorizontal: 14 },
    day: { paddingVertical: 12 },
    dayDivider: { borderTopColor: colors.border, borderTopWidth: Layout.hairline },
    dayHeader: { alignItems: 'baseline', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
    dayName: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '600' },
    dayWeekday: { color: colors.textSecondary, fontSize: 13, fontWeight: '400' },
    restDay: { color: colors.textSecondary, fontSize: 13, fontWeight: '400', paddingTop: 6 },

    exerciseRow: {
      alignItems: 'baseline',
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      paddingTop: 8,
    },
    exerciseName: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '400' },
    exerciseTarget: {
      color: colors.textSecondary,
      fontSize: 13,
      fontVariant: ['tabular-nums'],
      fontWeight: '600',
    },
    pressed: { opacity: 0.6 },
  });
}
