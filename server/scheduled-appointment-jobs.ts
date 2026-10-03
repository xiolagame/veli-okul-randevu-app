import type { ReminderJobResult } from './appointment-reminders';
import type { dispatchPushDeliveries } from './push-notifications';

type PushJobResult = Awaited<ReturnType<typeof dispatchPushDeliveries>>;

export async function runScheduledAppointmentJobs(options: {
  runReminders: () => Promise<ReminderJobResult>;
  dispatchPush: () => Promise<PushJobResult>;
  log?: (message: string) => void;
}): Promise<ReminderJobResult> {
  const log = options.log || console.log;
  const [reminder, push] = await Promise.allSettled([
    options.runReminders(),
    options.dispatchPush(),
  ]);

  if (reminder.status === 'fulfilled') {
    const result = reminder.value;
    log(`[Appointment reminders] eligible=${result.eligible} sent=${result.sent} failed=${result.failed} skipped=${result.skipped}`);
  } else {
    log('[Appointment reminders] failed');
  }

  if (push.status === 'fulfilled') {
    const result = push.value;
    log(`[Push deliveries] claimed=${result.claimed} sent=${result.sent} failed=${result.failed} invalid=${result.invalid} unavailable=${result.unavailable}`);
  } else {
    log('[Push deliveries] failed');
  }

  if (reminder.status === 'rejected') throw new Error('Appointment reminder job failed');
  return reminder.value;
}
