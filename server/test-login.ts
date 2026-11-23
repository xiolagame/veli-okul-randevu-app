import { normalizeTurkishPhone } from '../src/utils/phone';

// Geçici test girişi: yalnızca TEST_LOGIN_PHONES listesindeki numaralar için, WhatsApp mesajı gönderilmeden,
// TEST_LOGIN_CODE ile giriş yapılabilir. Üç ayar da yoksa, geçersizse veya TEST_LOGIN_EXPIRES geçmişse
// bu yol tamamen kapalıdır ve davranış değişmez.
export function getTestLoginCode(phone: unknown, now: Date = new Date()): string | null {
  const code = process.env.TEST_LOGIN_CODE?.trim() || '';
  const list = process.env.TEST_LOGIN_PHONES?.trim() || '';
  const expires = Date.parse(process.env.TEST_LOGIN_EXPIRES?.trim() || '');
  if (!/^\d{6}$/.test(code) || !list || !Number.isFinite(expires) || now.getTime() >= expires) return null;
  const canonical = normalizeTurkishPhone(phone);
  if (!canonical) return null;
  const allowed = list.split(',').map((item) => normalizeTurkishPhone(item.trim())).filter(Boolean);
  return allowed.includes(canonical) ? code : null;
}
