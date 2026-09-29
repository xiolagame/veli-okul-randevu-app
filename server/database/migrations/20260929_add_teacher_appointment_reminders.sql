ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS teacher_reminder_30m_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS teacher_reminder_30m_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS teacher_reminder_30m_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_appointments_teacher_reminder_due
  ON public.appointments (date, start_time)
  WHERE status = 'booked' AND teacher_reminder_30m_sent_at IS NULL;
