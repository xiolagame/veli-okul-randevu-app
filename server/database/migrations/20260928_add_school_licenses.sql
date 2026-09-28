CREATE TABLE IF NOT EXISTS public.school_licenses (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL UNIQUE REFERENCES public.schools(id) ON DELETE CASCADE,
  license_code VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  activated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_licenses_code_canonical CHECK (
    license_code = UPPER(license_code)
    AND license_code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
  )
);

ALTER TABLE public.school_licenses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'school_licenses'
      AND policyname = 'Express backend service full access school_licenses'
  ) THEN
    CREATE POLICY "Express backend service full access school_licenses"
      ON public.school_licenses FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
