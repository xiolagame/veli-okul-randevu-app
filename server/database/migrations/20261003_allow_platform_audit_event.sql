DO $$
BEGIN
  ALTER TABLE public.audit_logs
    ALTER COLUMN school_id DROP NOT NULL;

  ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS audit_scope VARCHAR(16) NOT NULL DEFAULT 'SCHOOL';

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_logs'::regclass
      AND conname = 'chk_audit_logs_scope'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT chk_audit_logs_scope
      CHECK (audit_scope IN ('SCHOOL', 'PLATFORM'));
  END IF;

  CREATE INDEX IF NOT EXISTS idx_audit_logs_scope_created_at
    ON public.audit_logs (audit_scope, created_at DESC);
END $$;
