CREATE TABLE IF NOT EXISTS public.platform_requests (
  id TEXT PRIMARY KEY DEFAULT ('req-' || substr(md5(random()::text || clock_timestamp()::text), 1, 20)),
  idempotency_key UUID NOT NULL UNIQUE,
  school_id TEXT REFERENCES public.schools(id) ON DELETE SET NULL,
  created_by_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('PUBLIC', 'SCHOOL_ADMIN')),
  request_type VARCHAR(30) NOT NULL CHECK (request_type IN ('MONTHLY_LICENSE', 'YEARLY_LICENSE', 'CONTACT', 'SUPPORT')),
  school_name_snapshot VARCHAR(255) NOT NULL,
  contact_name_snapshot VARCHAR(150) NOT NULL,
  email_snapshot VARCHAR(254),
  phone_snapshot VARCHAR(20),
  teacher_count INTEGER CHECK (teacher_count IS NULL OR (teacher_count > 0 AND teacher_count <= 10000)),
  subject VARCHAR(120),
  message VARCHAR(2000) NOT NULL DEFAULT '',
  status VARCHAR(30) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'IN_PROGRESS', 'WAITING_PAYMENT', 'RESOLVED', 'ARCHIVED')),
  status_updated_by_user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  CONSTRAINT platform_requests_contact_required CHECK (email_snapshot IS NOT NULL OR phone_snapshot IS NOT NULL),
  CONSTRAINT platform_requests_source_scope CHECK (
    (source = 'PUBLIC' AND school_id IS NULL AND created_by_user_id IS NULL AND request_type <> 'SUPPORT')
    OR source = 'SCHOOL_ADMIN'
  ),
  CONSTRAINT platform_requests_payment_status_scope CHECK (status <> 'WAITING_PAYMENT' OR request_type IN ('MONTHLY_LICENSE', 'YEARLY_LICENSE'))
);

ALTER TABLE public.platform_requests
  DROP CONSTRAINT IF EXISTS platform_requests_source_scope;
ALTER TABLE public.platform_requests
  ADD CONSTRAINT platform_requests_source_scope CHECK (
    (source = 'PUBLIC' AND school_id IS NULL AND created_by_user_id IS NULL AND request_type <> 'SUPPORT')
    OR source = 'SCHOOL_ADMIN'
  );

CREATE INDEX IF NOT EXISTS idx_platform_requests_status_created_at
  ON public.platform_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_requests_type_created_at
  ON public.platform_requests (request_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_requests_school_created_at
  ON public.platform_requests (school_id, created_at DESC)
  WHERE school_id IS NOT NULL;

ALTER TABLE public.platform_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'platform_requests'
      AND policyname = 'Express backend service full access platform_requests'
  ) THEN
    CREATE POLICY "Express backend service full access platform_requests"
      ON public.platform_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
