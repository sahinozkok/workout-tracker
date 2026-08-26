import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  CalendarPeriod,

  getPeriodDates,
  getStatusColor,
  groupIntoWeeks,
  startOfDay,
  useDisciplineDayPress,
} from '@/components/discipline-calendar';
import { DisciplineYearGrid, DisciplineYearMetrics } from '@/components/discipline-year-grid';
import { MotionCollapsible, MotionSwap } from '@/components/motion-section';
import { ThemeColors } from '@/constants/theme';
import { getWeekdayShortLabel, WEEKDAY_VALUES } from '@/constants/weekdays';
import { useTranslation } from '@/context/language-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useFeatureColor } from '@/hooks/use-feature-colors';
import { DisciplineStatus } from '@/types/workout';
import { toDateKey } from '@/utils/discipline';

const PERIOD_VALUES: CalendarPeriod[] = ['week', 'month', 'year'];

/**
 * Profil kartının yıl ölçüleri. Ana Sayfa'nınkinden bağımsızdır ve sabittir:
 * hücre boyu ekran genişliğine göre KÜÇÜLTÜLMEZ, şerit yatay kaydırılır.
 */
const PROFILE_YEAR_METRICS: DisciplineYearMetrics = {
  cellGap: 3,
  cellHitSlop: 3,
  cellSize: 10,
  labelWidth: 16,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export type ProfileDisciplineCardProps = {
  /**
   * Seçili dönem (Hafta/Ay/Yıl) vurgusunun rengi. Kendi profilde kullanıcının
   * `profile` preseti, arkadaş profilinde ARKADAŞIN Supabase'de saklı rengi
   * geçirilir. Verilmezse bugünkü `colors.primary` görünümü korunur.
   *
   * Takvimin durum renkleri (yeşil/turuncu/gri) ve bugün çerçevesi bundan
   * ETKİLENMEZ; Ana Sayfa takvimi ayrı bir bileşendir ve hiç dokunulmaz.
   */
  accentColor?: string;
  /**
   * Gösterilecek disiplin verisi. **Verilmezse** kart mevcut kullanıcının
   * context verisini ve mevcut gün basma davranışını kullanır (kendi profili).
   * Verilirse kart tamamen sunumsaldır ve hiçbir context okumaz.
   */
  statuses?: Record<string, DisciplineStatus>;
  /** `true` → günler basılamaz; hiçbir mutation veya menü tetiklenmez. */
  readOnly?: boolean;
  onDayPress?: (dateKey: string) => void;
  /** `true` → başlık satırı takvimi açıp kapatır; başlangıçta kapalıdır. */
  collapsible?: boolean;
};

/**
 * Profil ekranlarına **özel** kompakt disiplin kartı.
 *
 * Ana Sayfa takvimiyle hiçbir stil, ölçü veya yoğunluk ayarı paylaşmaz — o
 * yüzden burada yapılan hiçbir değişiklik Ana Sayfa'yı etkileyemez.
 *
 * İki kullanım biçimi vardır ve **hook'lar hiçbir zaman koşullu çağrılmaz**:
 * veri dışarıdan geldiğinde saf sunum bileşeni, gelmediğinde context okuyan
 * adapter render edilir. İkisi de aynı görünümü paylaşır.
 */
export function ProfileDisciplineCard({
  accentColor,
  collapsible = false,
  statuses,
  readOnly,
  onDayPress,
}: ProfileDisciplineCardProps = {}) {
  if (statuses) {
    return (
      <ProfileDisciplineCardView
        accentColor={accentColor}
        collapsible={collapsible}
        onDayPress={readOnly ? undefined : onDayPress}
        statuses={statuses}
      />
    );
  }

  return <CurrentUserProfileDisciplineCard accentColor={accentColor} collapsible={collapsible} />;
}

/**
 * Kendi profili: `WorkoutContext` verisini ve mevcut gün ayrıntısı/durum
 * değiştirme davranışını kullanan adapter.
 */
function CurrentUserProfileDisciplineCard({
  accentColor,
  collapsible,
}: {
  accentColor?: string;
  collapsible: boolean;
}) {
  const { handleDayPress, statuses } = useDisciplineDayPress();

  return (
    <ProfileDisciplineCardView
      accentColor={accentColor}
      collapsible={collapsible}
      onDayPress={handleDayPress}
      statuses={statuses}
    />
  );
}

/**
 * Saf sunum katmanı. Hiçbir context okumaz, hiçbir veri yazmaz — bu sayede
 * arkadaş profilinde de aynı tasarım salt okunur olarak kullanılabilir.
 */
function ProfileDisciplineCardView({
  accentColor,
  collapsible,
  onDayPress,
  statuses,
}: {
  accentColor?: string;
  collapsible: boolean;
  /** Verilmezse günler basılamaz (salt okunur kart). */
  onDayPress?: (dateKey: string) => void;
  statuses: Record<string, DisciplineStatus>;
}) {
  const { colors } = useAppTheme();
  const { locale, t } = useTranslation();

  const [period, setPeriod] = useState<CalendarPeriod>('week');
  const [isExpanded, setIsExpanded] = useState(!collapsible);
  // Ölçüler kapsayıcının GERÇEK genişliğinden türetilir; sabit ekran varsayımı
  // yoktur, bu yüzden dar iPhone'larda da taşma olmaz.
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    setMeasuredWidth((current) => (current === next ? current : next));
  }, []);

  const todayColor = useFeatureColor('todayHighlight', colors.primary).color;
  const periodAccent = accentColor ?? colors.primary;
  const styles = useMemo(
    () => createStyles(colors, todayColor, periodAccent),
    [colors, periodAccent, todayColor],
  );
  const today = useMemo(() => startOfDay(new Date()), []);
  const weekdayLabels = useMemo(
    () => WEEKDAY_VALUES.map((value) => getWeekdayShortLabel(value, locale)),
    [locale],
  );
  /** Yıl şeridinde satırlar dar olduğu için etiketler bir atlanarak yazılır. */
  const yearWeekdayLabels = useMemo(
    () => weekdayLabels.map((label, index) => (index % 2 === 0 ? label : '')),
    [weekdayLabels],
  );

  const statusLabels = useMemo<Record<DisciplineStatus, string>>(
    () => ({
      completed: t('calendar.completed'),
      partial: t('calendar.partialFull'),
      skipped: t('calendar.skipped'),
    }),
    [t],
  );
  const accessibilityDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
    [locale],
  );

  const getLabel = useCallback(
    (date: Date, status: DisciplineStatus | undefined, isFuture: boolean) => {
      const dateLabel = accessibilityDateFormatter.format(date);
      if (isFuture) return `${dateLabel}, ${t('calendar.futureDay')}`;
      return `${dateLabel}, ${status ? statusLabels[status] : t('calendar.unmarked')}`;
    },
    [accessibilityDateFormatter, statusLabels, t],
  );

  const subtitle = useMemo(() => {
    if (period === 'year') return t('calendar.lastTwelveMonths');
    if (period === 'month') {
      return today.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    }
    const dates = getPeriodDates('week', today);
    const first = dates[0].toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    const last = dates[dates.length - 1].toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return `${first} – ${last}`;
  }, [locale, period, t, today]);

  return (
    <View onLayout={handleLayout} style={styles.card}>
      <Pressable
        accessibilityRole={collapsible ? 'button' : undefined}
        accessibilityState={collapsible ? { expanded: isExpanded } : undefined}
        disabled={!collapsible}
        onPress={collapsible ? () => setIsExpanded((current) => !current) : undefined}
        style={({ pressed }) => [styles.titleRow, pressed && collapsible && styles.pressed]}>
        <Text style={styles.title}>{t('calendar.shortTitle')}</Text>
        {collapsible && (
          <Ionicons
            color={colors.textSecondary}
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
          />
        )}
      </Pressable>

      {isExpanded && (
      <MotionCollapsible>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <View accessibilityRole="tablist" style={styles.tabs}>
        {PERIOD_VALUES.map((option) => {
          const isSelected = option === period;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              // Görsel olarak kompakt kalır ama dokunma alanı 32 + 2×6 = 44 pt.
              hitSlop={{ bottom: 6, left: 8, right: 8, top: 6 }}
              key={option}
              onPress={() => setPeriod(option)}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
              <Text style={[styles.tabText, isSelected && styles.tabTextSelected]}>
                {t(`calendar.${option}`)}
              </Text>
              <View style={[styles.tabUnderline, isSelected && styles.tabUnderlineSelected]} />
            </Pressable>
          );
        })}
      </View>

      <MotionSwap
        contentWeight={period === 'year' ? 'heavy' : 'regular'}
        emphasis="clear"
        transitionKey={period}>
      {period === 'week' ? (
        <WeekRow
          colors={colors}
          getLabel={getLabel}
          onDayPress={onDayPress}
          statuses={statuses}
          styles={styles}
          today={today}
          weekdayLabels={weekdayLabels}
          width={measuredWidth}
        />
      ) : period === 'month' ? (
        <MonthGrid
          colors={colors}
          getLabel={getLabel}
          onDayPress={onDayPress}
          statuses={statuses}
          styles={styles}
          today={today}
          weekdayLabels={weekdayLabels}
          width={measuredWidth}
        />
      ) : (
        /* Ana Sayfa ile **aynı** yıl bileşeni; yalnızca ölçüler kompakt.
           53 hafta ekran genişliğine zorlanmaz — kareler okunabilir kalır ve
           şerit yatay kaydırılır. */
        <View style={styles.yearWrapper}>
          <DisciplineYearGrid
            colors={colors}
            dates={getPeriodDates('year', today)}
            getLabel={getLabel}
            locale={locale}
            emptyCellColor={colors.profileCalendarEmpty}
            futureCellColor={colors.profileCalendarFuture}
            metrics={PROFILE_YEAR_METRICS}
            onDayPress={onDayPress}
            statuses={statuses}
            today={today}
            weekdayLabels={yearWeekdayLabels}
          />
        </View>
      )}
      </MotionSwap>
      </MotionCollapsible>
      )}
    </View>
  );
}

type GridProps = {
  colors: ThemeColors;
  getLabel: (date: Date, status: DisciplineStatus | undefined, isFuture: boolean) => string;
  /** Verilmezse günler basılamaz (salt okunur kart). */
  onDayPress?: (dateKey: string) => void;
  statuses: Record<string, DisciplineStatus>;
  styles: ReturnType<typeof createStyles>;
  today: Date;
  /** Kartın iç genişliği; 0 ise henüz ölçülmemiştir. */
  width: number;
};

/** Hafta ve ay görünümlerinin ortak gün dairesi. */
function DayCircle({
  colors,
  date,
  getLabel,
  onDayPress,
  size,
  statuses,
  styles,
  today,
}: Omit<GridProps, 'width'> & { date: Date; size: number }) {
  const dateKey = toDateKey(date);
  const status = statuses[dateKey];
  const isFuture = date.getTime() > today.getTime();
  const isToday = date.getTime() === today.getTime();
  const filled = !isFuture && status !== undefined;

  return (
    <Pressable
      accessibilityLabel={getLabel(date, status, isFuture)}
      accessibilityRole="button"
      disabled={isFuture || !onDayPress}
      hitSlop={Math.max(0, Math.ceil((44 - size) / 2))}
      onPress={onDayPress ? () => onDayPress(dateKey) : undefined}
      style={({ pressed }) => [
        {
          alignItems: 'center',
          backgroundColor: filled ? getStatusColor(colors, status, isFuture) : 'transparent',
          borderRadius: size / 2,
          height: size,
          justifyContent: 'center',
          width: size,
        },
        !filled && styles.dayCircleOutlined,
        isToday && styles.dayCircleToday,
        pressed && styles.pressed,
      ]}>
      <Text
        style={[
          styles.dayNumber,
          { fontSize: size >= 28 ? 12 : 11 },
          filled && styles.dayNumberFilled,
          // Bugün DOLUYSA numara mavi olmaz: dolgu zaten durum rengindedir ve
          // mavi yazı yeşil/turuncu üzerinde okunmuyordu. Bugünlük vurgusunu
          // yalnızca dış çember taşır. Durumu olmayan bugünde mavi yazı korunur.
          isToday && !filled && styles.dayNumberToday,
          isFuture && styles.dayNumberFuture,
        ]}>
        {date.getDate()}
      </Text>
    </Pressable>
  );
}

function WeekRow({ styles, weekdayLabels, width, ...rest }: GridProps & { weekdayLabels: string[] }) {
  const dates = getPeriodDates('week', rest.today);
  const cell = width > 0 ? width / 7 : 44;
  const size = clamp(Math.floor(cell) - 10, 26, 32);

  return (
    <View style={styles.weekRow}>
      {dates.map((date, index) => (
        <View key={toDateKey(date)} style={styles.weekCell}>
          <Text style={styles.weekdayLabel}>{weekdayLabels[index] ?? ''}</Text>
          <DayCircle date={date} size={size} styles={styles} {...rest} />
        </View>
      ))}
    </View>
  );
}

function MonthGrid({ styles, weekdayLabels, width, ...rest }: GridProps & { weekdayLabels: string[] }) {
  const month = rest.today.getMonth();
  const weeks = groupIntoWeeks(getPeriodDates('month', rest.today));
  const cell = width > 0 ? width / 7 : 44;
  const size = clamp(Math.floor(cell) - 12, 24, 30);

  return (
    <View style={styles.monthGrid}>
      <View style={styles.monthRow}>
        {weekdayLabels.map((label) => (
          <Text key={label} style={styles.monthWeekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      {weeks.map((week) => (
        <View key={toDateKey(week[0])} style={styles.monthRow}>
          {week.map((date) => (
            <View key={toDateKey(date)} style={styles.monthCell}>
              {date.getMonth() === month ? (
                <DayCircle date={date} size={size} styles={styles} {...rest} />
              ) : (
                <View style={{ height: size, width: size }} />
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Yıl görünümü: satırlar son 12 ay, sütunlar ayın günleri.
 *
 * Klasik "53 hafta × 7 gün" yerleşimi telefon genişliğine 7–9 pt hücreyle
 * sığmıyor (53 sütun ≈ 480 pt eder), bu yüzden ızgara devriktir. Hücre boyutu
 * gerçek genişlikten hesaplanır; yatay kaydırma ve kırpma yoktur.
 */
function createStyles(colors: ThemeColors, todayColor: string, periodAccent: string) {
  return StyleSheet.create({
    card: {
      backgroundColor: 'transparent',
      borderColor: colors.separator,
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 2,
      padding: 18,
    },
    titleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'space-between',
      minHeight: 28,
    },
    title: { color: colors.text, fontSize: 17, fontWeight: '700' },
    subtitle: { color: colors.textSecondary, fontSize: 12 },
    tabs: { flexDirection: 'row', gap: 18, marginTop: 10 },
    tab: { alignItems: 'center', justifyContent: 'center', minHeight: 32 },
    tabText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
    tabTextSelected: { color: colors.text, fontWeight: '700' },
    tabUnderline: {
      backgroundColor: 'transparent',
      borderRadius: 1,
      height: 2,
      marginTop: 4,
      width: 16,
    },
    tabUnderlineSelected: { backgroundColor: periodAccent },
    weekRow: { flexDirection: 'row', marginTop: 12 },
    weekCell: { alignItems: 'center', flex: 1, gap: 6 },
    weekdayLabel: { color: colors.textTertiary, fontSize: 10, fontWeight: '500' },
    monthGrid: { gap: 4, marginTop: 12 },
    monthRow: { flexDirection: 'row' },
    monthCell: { alignItems: 'center', flex: 1, paddingVertical: 2 },
    monthWeekdayLabel: {
      color: colors.textTertiary,
      flex: 1,
      fontSize: 10,
      fontWeight: '500',
      textAlign: 'center',
    },
    dayCircleOutlined: { borderColor: colors.separator, borderWidth: StyleSheet.hairlineWidth },
    // Yalnızca dış çember; durum dolgusu değişmez.
    dayCircleToday: { borderColor: todayColor, borderWidth: 1.5 },
    dayNumber: { color: colors.textSecondary, fontWeight: '500' },
    dayNumberFilled: { color: colors.background, fontWeight: '700' },
    dayNumberToday: { color: todayColor, fontWeight: '700' },
    dayNumberFuture: { color: colors.textTertiary },
    yearWrapper: { marginTop: 12 },
    pressed: { opacity: 0.6 },
  });
}
