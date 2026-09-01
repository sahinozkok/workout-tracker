/**
 * Profil rengi allowlist'ine Ayarlar renk havuzundaki yumuşak mercan
 * (`softCoral`, #E58370) ön ayarını ekler. Başka tablo, politika veya yetki
 * değişmez.
 */

begin;

alter table public.profiles
drop constraint if exists profiles_color_preset_allowlist;

alter table public.profiles
add constraint profiles_color_preset_allowlist
check (color_preset in (
  'orange', 'orangeDeep', 'orangeDark', 'darkOrange', 'darkOrangeVivid', 'workoutOrange',
  'softCoral', 'coral', 'salmon', 'tomato', 'red', 'crimson', 'brickRed',
  'deepPink', 'hotPink', 'pink', 'paleVioletRed',
  'mediumOrchid', 'darkOrchid', 'blueViolet', 'mediumPurple', 'purple', 'socialPurple',
  'systemBlue', 'dodgerBlue', 'royalBlue', 'cornflowerBlue', 'steelBlue', 'skyBlue',
  'darkTurquoise', 'turquoise', 'mediumTurquoise', 'teal',
  'springGreen', 'mediumSeaGreen', 'forestGreen', 'seaGreenLight', 'disciplineGreen',
  'gold', 'goldDeep', 'goldenRod',
  'brown', 'saddleBrown', 'rosyBrown', 'slateGray', 'profileClay'
));

commit;
