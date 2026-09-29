import { schedule } from '@netlify/functions';
import { ensureDatabase } from '../../server/app';
import { runAppointmentReminderJob } from '../../server/appointment-reminders';

export const handler = schedule('*/5 * * * *', async () => {
  await ensureDatabase();
  const result = await runAppointmentReminderJob();
  console.log(`[Appointment reminders] eligible=${result.eligible} sent=${result.sent} failed=${result.failed} skipped=${result.skipped}`);
  return { statusCode: 200, body: JSON.stringify(result) };
});
