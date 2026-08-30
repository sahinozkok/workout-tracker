import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { TimePickerProps } from '@/components/time-picker.types';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * NATIVE saat seçici.
 *
 * `is24Hour` BİLİNÇLİ olarak zorlanmaz: iOS spinner cihazın 12/24 tercihini
 * kendiliğinden izler, Android ise cihaz yereline göre karar verir. Uygulama
 * diline bakıp 12 saat varsaymayız.
 */
export default function TimePicker({ hour, minute, onChange }: TimePickerProps) {
  const { colors } = useAppTheme();

  const value = useMemo(() => {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return date;
  }, [hour, minute]);

  function handleChange(_event: DateTimePickerEvent, selected?: Date) {
    if (!selected) return;
    onChange(selected.getHours(), selected.getMinutes());
  }

  return (
    <View style={styles.container}>
      <DateTimePicker
        accentColor={colors.primary}
        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
        mode="time"
        onChange={handleChange}
        textColor={colors.text}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', width: '100%' },
});
