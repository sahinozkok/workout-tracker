/**
 * Native ve web saat seçicinin PAYLAŞTIĞI prop sözleşmesi.
 *
 * `time-picker.native.tsx` `@react-native-community/datetimepicker` kullanır;
 * `time-picker.web.tsx` aynı sözleşmeye sahip güvenli saat/dakika fallback'idir.
 * İki dosya da bu tipi uygular; metro platforma göre doğru dosyayı seçer.
 */
export type TimePickerProps = {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
};
