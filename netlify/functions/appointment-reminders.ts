import type { Config } from '@netlify/functions';
import { ensureDatabase } from '../../server/app';
import { runAppointmentReminderJob } from '../../server/appointment-reminders';
import { dispatchPushDeliveries } from '../../server/push-notifications';
import { runScheduledAppointmentJobs } from '../../server/scheduled-appointment-jobs';

export default async function handler() {
  await ensureDatabase();
  const result = await runScheduledAppointmentJobs({
    runReminders: runAppointmentReminderJob,
    dispatchPush: () => dispatchPushDeliveries(),
  });
  void result;
  // Uyanık tutma: bir süre istek gelmeyen API fonksiyonu "soğur" ve ilk giriş 3-5 sn sürer.
  // Her 5 dakikada bir sağlık adresini çağırmak API'yi ve veritabanı bağlantısını sıcak tutar. Hata olursa sessizce geçilir.
  const origin = (process.env.URL || 'https://velirandevu.com').replace(/\/$/, '');
  await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(8000) }).catch(() => undefined);
}

export const config: Config = {
  schedule: '*/5 * * * *',
};
