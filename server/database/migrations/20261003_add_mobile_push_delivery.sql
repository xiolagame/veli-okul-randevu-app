CREATE TABLE IF NOT EXISTS public.mobile_push_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL DEFAULT 0,
  installation_id UUID NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform = 'ANDROID'),
  provider TEXT NOT NULL CHECK (provider = 'FCM'),
  target_kind TEXT NOT NULL CHECK (target_kind = 'REGISTRATION_TOKEN'),
  provider_target TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  app_id TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ
);

ALTER TABLE public.mobile_push_devices ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_user_active
  ON public.mobile_push_devices(user_id) WHERE active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mobile_push_active_target
  ON public.mobile_push_devices(target_hash) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES public.mobile_push_devices(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel = 'FCM'),
  event_type TEXT NOT NULL CHECK (event_type IN ('APPOINTMENT_REQUESTED', 'APPOINTMENT_APPROVED', 'APPOINTMENT_REJECTED')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'INVALID_TARGET', 'CANCELLED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error_code TEXT,
  claimed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (notification_id, device_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due
  ON public.notification_deliveries(next_attempt_at) WHERE status IN ('PENDING', 'FAILED', 'SENDING');

ALTER TABLE public.mobile_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mobile_push_devices' AND policyname='Express backend service full access mobile_push_devices') THEN
    CREATE POLICY "Express backend service full access mobile_push_devices" ON public.mobile_push_devices FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notification_deliveries' AND policyname='Express backend service full access notification_deliveries') THEN
    CREATE POLICY "Express backend service full access notification_deliveries" ON public.notification_deliveries FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
