import { normalizeTurkishPhone } from '../src/utils/phone';
import { getConfiguration } from './whatsapp-cloud';

export function licenseRemindersEnabled(): boolean {
  return process.env.WHATSAPP_LICENSE_REMINDERS_ENABLED?.trim().toLowerCase() === 'true';
}
export function licenseDeliveryEnabled(source: 'AUTO' | 'MANUAL'): boolean {
  const key = source === 'AUTO' ? 'WHATSAPP_LICENSE_REMINDERS_AUTO_ENABLED' : 'WHATSAPP_LICENSE_REMINDERS_MANUAL_ENABLED';
  return licenseRemindersEnabled() && process.env[key]?.trim().toLowerCase() === 'true';
}
export type LicenseDeliveryResult = {
  status: 'ACCEPTED' | 'REJECTED' | 'UNKNOWN' | 'CONFIG_UNAVAILABLE' | 'DISABLED';
  messageId?: string;
};
// API acceptance is NOT proof of delivery. Never retry UNKNOWN automatically.
export async function sendWhatsAppLicenseReminder(input: {
  phone: string; schoolName: string; days: number; expiryDate: string; source?: 'AUTO' | 'MANUAL';
}): Promise<LicenseDeliveryResult> {
  if (!licenseDeliveryEnabled(input.source || 'AUTO')) return { status: 'DISABLED' };
  const phone = normalizeTurkishPhone(input.phone);
  if (!phone || (!Number.isInteger(input.days) || input.days < 0 || input.days > 100000 || (input.source !== 'MANUAL' && ![7,3,1].includes(input.days))) || !/^\d{2}\.\d{2}\.\d{4}$/.test(input.expiryDate)
      || !input.schoolName.trim() || input.schoolName.length > 255) return { status: 'REJECTED' };
  let config: ReturnType<typeof getConfiguration>;
  try { config = getConfiguration(); } catch { return { status: 'CONFIG_UNAVAILABLE' }; }
  try {
    const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`, {
      method: 'POST', signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: phone.slice(1),
        type: 'template', template: { name: 'kolayokul_lisans_hatirlatma', language: { code: 'tr' },
          components: [{ type: 'body', parameters: [input.schoolName, String(input.days), input.expiryDate]
            .map(text => ({ type: 'text', text })) }] } }),
    });
    if (!response.ok) return { status: response.status >= 500 ? 'UNKNOWN' : 'REJECTED' };
    const body = await response.json() as { messages?: Array<{ id?: unknown }> };
    const id = body.messages?.[0]?.id;
    return typeof id === 'string' && /^wamid\.[A-Za-z0-9+/=_-]{1,500}$/.test(id)
      ? { status: 'ACCEPTED', messageId: id } : { status: 'UNKNOWN' };
  } catch { return { status: 'UNKNOWN' }; }
}
