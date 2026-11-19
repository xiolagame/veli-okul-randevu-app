import { schedule } from '@netlify/functions';
import { ensureDatabase } from '../../server/app';
import { runAppointmentReminderJob } from '../../server/appointment-reminders';
import { dispatchPushDeliveries } from '../../server/push-notifications';
import { runScheduledAppointmentJobs } from '../../server/scheduled-appointment-jobs';

export const handler = schedule('*/5 * * * *', async () => {
  await ensureDatabase();
  const result = await runScheduledAppointmentJobs({
    runReminders: runAppointmentReminderJob,
    dispatchPush: () => dispatchPushDeliveries(),
  });
  return { statusCode: 200, body: JSON.stringify(result) };
});
