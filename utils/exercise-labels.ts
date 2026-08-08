/** Kütüphane verisindeki Türkçe değerleri çeviri anahtarına eşler. */
const MUSCLE_GROUP_KEYS: Record<string, string> = {
  'Göğüs': 'chest',
  'Sırt': 'back',
  'Omuz': 'shoulders',
  'Biceps': 'biceps',
  'Triceps': 'triceps',
  'Ön kol / Kavrama': 'forearms',
  'Karın / Core': 'core',
  'Quadriceps / Bacak': 'quads',
  'Arka bacak': 'hamstrings',
  'Kalça': 'glutes',
  'Baldır': 'calves',
  'Tüm vücut / Güç': 'fullBody',
  'Kardiyo': 'cardio',
};

const EQUIPMENT_KEYS: Record<string, string> = {
  'Kardiyo makinesi': 'cardioMachine',
  'Dumbbell': 'dumbbell',
  'Barbell': 'barbell',
  'Kettlebell': 'kettlebell',
  'Kablo': 'cable',
  'Landmine': 'landmine',
  'Direnç bandı': 'band',
  'Askı sistemi': 'suspension',
  'Sağlık topu': 'medicineBall',
  'Makine': 'machine',
  'Vücut ağırlığı': 'bodyweight',
  'Diğer': 'other',
};

type Translate = (key: string) => string;

/** Değer eşlenemezse ham veri gösterilir (özel/yeni kategoriler için güvenli). */
export function getMuscleGroupLabel(value: string, t: Translate) {
  const key = MUSCLE_GROUP_KEYS[value];
  return key ? t(`exerciseLibrary.muscleGroups.${key}`) : value;
}

export function getEquipmentLabel(value: string, t: Translate) {
  const key = EQUIPMENT_KEYS[value];
  return key ? t(`exerciseLibrary.equipment.${key}`) : value;
}
