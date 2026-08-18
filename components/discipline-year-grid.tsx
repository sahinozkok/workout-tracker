import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ThemeColors } from '@/constants/theme';
import { DisciplineStatus } from '@/types/workout';
import { toDateKey } from '@/utils/discipline';

/**
 * Yıl ızgarasının ölçüleri. Çağıran taraf kendi yoğunluğuna göre verir:
 * Ana Sayfa mevcut `comfortable` değerlerini, profil kartı kendi kompakt
 * değerlerini geçer. Bileşenin kendisi hiçbir ölçüyü varsaymaz.
 */
export type DisciplineYearMetrics = {
  cellGap: number;
  cellHitSlop: number;
  cellSize: number;
  labelWidth: number;
};

export type DisciplineYearGridProps = {
  colors: ThemeColors;
  /**
   * İşaretlenmemiş gün rengini geçersiz kılar. Verilmezse tema varsayılanı
   * (`disciplineEmpty`) kullanılır — Ana Sayfa bunu **vermez**, dolayısıyla
   * mevcut görünümü değişmez. Profil kartı ise kendi zeminine göre daha
   * ayırt edilebilir bir gri geçer.
   */
  emptyCellColor?: string;
  /** Gelecek gün rengini geçersiz kılar; aynı mantık. */
  futureCellColor?: string;
  /** Gösterilecek tam gün listesi; hafta sütunlarına burada bölünür. */
  dates: Date[];
  getLabel: (date: Date, status: DisciplineStatus | undefined, isFuture: boolean) => string;
  locale: string;
  metrics: DisciplineYearMetrics;
  /** Verilmezse günler basılamaz (salt okunur takvim). */
  onDayPress?: (dateKey: string) => void;
  statuses: Record<string, DisciplineStatus>;
  today: Date;
  weekdayLabels: string[];
};

function groupIntoWeeks(dates: Date[]) {
  const weeks: Date[][] = [];

  for (let index = 0; index < dates.length; index += 7) {
    weeks.push(dates.slice(index, index + 7));
  }

  return weeks;
}

/**
 * Hücre rengi. Tamamlandı/kısmi/atlandı renkleri **her zaman** temadan gelir;
 * yalnızca boş ve gelecek hücreler çağıran tarafından geçersiz kılınabilir.
 */
function getCellColor(
  colors: ThemeColors,
  status: DisciplineStatus | undefined,
  isFuture: boolean,
  emptyCellColor: string | undefined,
  futureCellColor: string | undefined,
) {
  if (isFuture) return futureCellColor ?? colors.disciplineFuture;
  if (status === 'completed') return colors.disciplineCompleted;
  if (status === 'partial') return colors.disciplinePartial;
  if (status === 'skipped') return colors.disciplineSkipped;
  return emptyCellColor ?? colors.disciplineEmpty;
}

/**
 * Yıl (contribution) ızgarası: sütunlar haftalar, satırlar haftanın günleri.
 *
 * Bu bileşen Ana Sayfa takviminin **çalışan** yıl görünümünden birebir
 * çıkarılmıştır; render mantığı ve stil değerleri aynen taşındı. Amaç tek bir
 * doğru uygulamayı hem Ana Sayfa'nın hem profil kartının paylaşması.
 *
 * 53 hafta ekran genişliğine **zorla sığdırılmaz** — okunabilir kare boyu
 * korunur ve şerit yatay olarak kaydırılır.
 */
export function DisciplineYearGrid({
  colors,
  dates,
  emptyCellColor,
  futureCellColor,
  getLabel,
  locale,
  metrics,
  onDayPress,
  statuses,
  today,
  weekdayLabels,
}: DisciplineYearGridProps) {
  const styles = useMemo(() => createStyles(colors, metrics), [colors, metrics]);
  const weeks = groupIntoWeeks(dates);

  return (
    <View style={styles.yearGridRow}>
      <View style={styles.yearWeekdayLabels}>
        <View style={styles.yearMonthLabelSpacer} />
        {weekdayLabels.map((label, index) => (
          <Text key={`${label}-${index}`} style={styles.yearWeekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.yearScrollContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.yearScroll}>
        {weeks.map((week) => {
          const monthStart = week.find((date) => date.getDate() === 1);

          return (
            <View key={toDateKey(week[0])} style={styles.yearWeek}>
              <View style={styles.yearMonthLabelContainer}>
                {monthStart && (
                  <Text numberOfLines={1} style={styles.yearMonthLabel}>
                    {monthStart.toLocaleDateString(locale, { month: 'short' }).replace('.', '')}
                  </Text>
                )}
              </View>

              {week.map((date) => {
                const dateKey = toDateKey(date);
                const status = statuses[dateKey];
                const isFuture = date.getTime() > today.getTime();

                return (
                  <Pressable
                    accessibilityLabel={getLabel(date, status, isFuture)}
                    accessibilityRole="button"
                    disabled={isFuture || !onDayPress}
                    hitSlop={metrics.cellHitSlop}
                    key={dateKey}
                    onPress={onDayPress ? () => onDayPress(dateKey) : undefined}
                    style={({ pressed }) => [
                      styles.yearDayCell,
                      {
                        backgroundColor: getCellColor(
                          colors,
                          status,
                          isFuture,
                          emptyCellColor,
                          futureCellColor,
                        ),
                      },
                      date.getTime() === today.getTime() && styles.todayYearCell,
                      pressed && styles.pressed,
                    ]}
                  />
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Değerler Ana Sayfa takviminden birebir taşındı; görünüm değişmez. */
function createStyles(colors: ThemeColors, metrics: DisciplineYearMetrics) {
  const { cellGap, cellSize, labelWidth } = metrics;

  return StyleSheet.create({
    // Yıl şeridi yatay kaydırılır. ScrollView'a `flex: 1` + `minWidth: 0`
    // verilir: içerik ne kadar geniş olursa olsun satırın dışına taşamaz,
    // kapsayıcıyı büyütemez ve kenardan kesilmez.
    yearGridRow: { flexDirection: 'row' },
    yearScroll: { flex: 1, minWidth: 0 },
    yearWeekdayLabels: { marginRight: 7 },
    yearMonthLabelSpacer: { height: 20 },
    yearWeekdayLabel: {
      color: colors.textTertiary,
      fontSize: 8,
      height: cellSize + cellGap - 1,
      lineHeight: 13,
      width: labelWidth,
    },
    yearScrollContent: { paddingRight: 2 },
    yearWeek: { gap: cellGap, marginRight: cellGap, width: cellSize },
    yearMonthLabelContainer: { height: 17, overflow: 'visible' },
    yearMonthLabel: { color: colors.textTertiary, fontSize: 9, overflow: 'visible', width: 34 },
    yearDayCell: { borderRadius: 3, height: cellSize, width: cellSize },
    todayYearCell: { borderColor: colors.primary, borderWidth: 1.5 },
    pressed: { opacity: 0.6 },
  });
}
