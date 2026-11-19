import { licenseDeliveryEnabled } from '../../server/whatsapp-license-delivery';
import { authorizeLicenseWorker } from '../../server/license-reminder-runner';

// The -background suffix selects Netlify's 15-minute background execution.
// No user-provided school/phone/template is accepted by this handler.
export default async function handler(request: Request) {
  if (!licenseDeliveryEnabled('AUTO') && !licenseDeliveryEnabled('MANUAL')) return new Response(null, { status: 204 });
  if (process.env.CONTEXT !== 'production') return new Response(null, { status: 403 });
  if (!authorizeLicenseWorker(request)) return new Response(null, { status: 401 });
  try {
    const { runLicenseReminderJob } = await import('../../server/license-reminders');
    const result = await runLicenseReminderJob();
    console.log(JSON.stringify({ event: 'LICENSE_REMINDER_SUMMARY', ...result }));
    return new Response(null, { status: 204 });
  } catch {
    console.error('LICENSE_REMINDER_JOB_FAILED');
    return new Response(null, { status: 503 });
  }
}
