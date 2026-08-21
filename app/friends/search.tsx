/**
 * `/friends/search` — mevcut rota korunur.
 *
 * Arama artık ayrı bir tasarım değildir: bu yol da arkadaşlık ana ekranını
 * render eder, tek fark arama alanının hazır odaklanmasıdır. Böylece başka bir
 * yerden bu yola yapılan yönlendirme kırılmaz ve kullanıcı görsel olarak
 * farklı bir sayfaya düşmez.
 */
import { FriendsScreen } from '@/components/friends/friends-screen';

export default function FriendsSearchRoute() {
  return <FriendsScreen autoFocusSearch />;
}
