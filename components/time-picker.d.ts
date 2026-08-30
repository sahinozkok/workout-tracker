import type { FC } from 'react';

import type { TimePickerProps } from '@/components/time-picker.types';

/**
 * `@/components/time-picker` TİP çözümlemesi.
 *
 * Metro çalışma zamanında platforma göre `time-picker.native.tsx` veya
 * `time-picker.web.tsx` dosyasını seçer; TypeScript ise bu bildirimi görür.
 * Böylece native picker importu web paketine girmez ama tip güvenliği korunur.
 */
declare const TimePicker: FC<TimePickerProps>;
export default TimePicker;
