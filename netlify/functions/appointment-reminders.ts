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
}

export const config: Config = {
  schedule: '*/5 * * * *',
};
