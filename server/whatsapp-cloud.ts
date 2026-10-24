import { normalizeTurkishPhone } from '../src/utils/phone';

const DEFAULT_GRAPH_VERSION = 'v25.0';
const TEMPLATE_NAME = 'kolayokul_onay';
const TEMPLATE_LANGUAGE = 'tr';

export class WhatsAppConfigurationError extends Error {}
export class WhatsAppDeliveryError extends Error {}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export function isWhatsAppAuthEnabled(): boolean {
  return isEnabled(process.env.WHATSAPP_AUTH_ENABLED) && isWhatsAppPilotModeEnabled();
}

export function isUnifiedWhatsAppLoginEnabled(): boolean {
  return isWhatsAppAuthEnabled() && isEnabled(process.env.WHATSAPP_UNIFIED_LOGIN_ENABLED);
}

export function isWhatsAppPilotModeEnabled(): boolean {
  return isEnabled(process.env.WHATSAPP_PILOT_ENABLED);
}

export function isWhatsAppPilotPhoneAllowed(phone: unknown): boolean {
  if (!isWhatsAppPilotModeEnabled()) return false;
  const canonicalPhone = normalizeTurkishPhone(phone);
  if (!canonicalPhone) return false;
  const entries = (process.env.WHATSAPP_PILOT_ALLOWED_PHONES || '').split(',');
  const allowedPhones = entries.map((entry) => normalizeTurkishPhone(entry));
  if (!allowedPhones.length || allowedPhones.some((entry) => !entry)) return false;
  return new Set(allowedPhones).has(canonicalPhone);
}

function getConfiguration(): { phoneNumberId: string; accessToken: string; graphVersion: string } {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() || '';
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
  if (!/^\d+$/.test(phoneNumberId) || !accessToken || !/^v\d+\.\d+$/.test(graphVersion)) {
    throw new WhatsAppConfigurationError('WhatsApp doğrulama servisi yapılandırılmamış.');
  }
  return { phoneNumberId, accessToken, graphVersion };
}

export function assertWhatsAppDeliveryConfigured(): void {
  if (!isWhatsAppAuthEnabled()) throw new WhatsAppConfigurationError('WhatsApp doğrulama özelliği kapalı.');
  getConfiguration();
}

export async function sendWhatsAppAuthenticationCode(phone: string, code: string): Promise<void> {
  if (!/^\d{6}$/.test(code)) throw new WhatsAppDeliveryError('Geçersiz doğrulama kodu.');
  const canonicalPhone = normalizeTurkishPhone(phone);
  if (!canonicalPhone) throw new WhatsAppDeliveryError('Geçersiz telefon numarası.');
  assertWhatsAppDeliveryConfigured();
  const { phoneNumberId, accessToken, graphVersion } = getConfiguration();
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: canonicalPhone.slice(1),
      type: 'template',
      template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANGUAGE },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  });
  if (!response.ok) throw new WhatsAppDeliveryError('WhatsApp doğrulama mesajı gönderilemedi.');
}
