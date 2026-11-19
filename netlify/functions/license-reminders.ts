import type { Config } from '@netlify/functions';
import { licenseDeliveryEnabled } from '../../server/whatsapp-license-delivery';
import { createLicenseWorkerRequest } from '../../server/license-reminder-runner';

export default async function handler() {
  if ((!licenseDeliveryEnabled('AUTO') && !licenseDeliveryEnabled('MANUAL')) || process.env.CONTEXT !== 'production') return;
  try {
    const response = await fetch(createLicenseWorkerRequest());
    if (response.status !== 202) console.error('LICENSE_REMINDER_WORKER_NOT_ACCEPTED');
  } catch { console.error('LICENSE_REMINDER_WORKER_UNAVAILABLE'); }
}
// Netlify cron is UTC; 06:00 UTC = 09:00 Europe/Istanbul.
export const config: Config = { schedule: '0 6 * * *' };
