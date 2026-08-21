/**
 * `/friends` — arkadaşlık ana ekranı.
 *
 * Ekranın tamamı `components/friends/friends-screen.tsx` içindedir; bu dosya
 * yalnızca rota girişidir. Arama, sekmeler ve listeler aynı ekranda yaşar.
 */
import { FriendsScreen } from '@/components/friends/friends-screen';

export default function FriendsRoute() {
  return <FriendsScreen />;
}
