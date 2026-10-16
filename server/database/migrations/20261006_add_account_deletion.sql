BEGIN;

-- A short-lived, non-identifying receipt makes concurrent deletion retries idempotent.
-- subject_hash is an HMAC and is never the former user id.
CREATE TABLE IF NOT EXISTS public.account_deletion_receipts (
  request_id UUID PRIMARY KEY,
  subject_hash CHAR(64) NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  CONSTRAINT account_deletion_receipts_subject_hash_format CHECK (subject_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_receipts_expires_at
  ON public.account_deletion_receipts(expires_at);

ALTER TABLE public.account_deletion_receipts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='account_deletion_receipts'
      AND policyname='Express backend service full access account_deletion_receipts'
  ) THEN
    CREATE POLICY "Express backend service full access account_deletion_receipts"
      ON public.account_deletion_receipts FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.teacher_profiles
  ADD COLUMN IF NOT EXISTS account_deleted_at TIMESTAMPTZ;

ALTER TABLE public.school_roster
  ADD COLUMN IF NOT EXISTS parent_account_deleted_at TIMESTAMPTZ;

ALTER TABLE public.platform_requests
  ADD COLUMN IF NOT EXISTS privacy_anonymized_at TIMESTAMPTZ;

ALTER TABLE public.platform_requests
  DROP CONSTRAINT IF EXISTS platform_requests_contact_required;
ALTER TABLE public.platform_requests
  ADD CONSTRAINT platform_requests_contact_required CHECK (
    privacy_anonymized_at IS NOT NULL OR email_snapshot IS NOT NULL OR phone_snapshot IS NOT NULL
  );

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_user_id TEXT;
ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_fkey;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- Backfill only unambiguous historical actors. Same-name accounts are deliberately
-- left unlinked so a later deletion cannot modify another person's audit history.
WITH unique_actor AS (
  SELECT target.id AS audit_id, MIN(user_row.id) AS user_id
  FROM public.audit_logs target
  JOIN public.school_memberships membership ON membership.school_id=target.school_id
  JOIN public.users user_row ON user_row.id=membership.user_id
  WHERE target.actor_user_id IS NULL
    AND btrim(concat_ws(' ',user_row.first_name,user_row.last_name))=target.actor_name
  GROUP BY target.id
  HAVING COUNT(DISTINCT user_row.id)=1
)
UPDATE public.audit_logs AS target
SET actor_user_id=unique_actor.user_id
FROM unique_actor
WHERE target.id=unique_actor.audit_id;

-- These nullable historical actor references must never prevent account deletion.
ALTER TABLE public.teacher_profiles DROP CONSTRAINT IF EXISTS teacher_profiles_user_id_fkey;
ALTER TABLE public.teacher_profiles
  ADD CONSTRAINT teacher_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_parent_id_fkey;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_approved_by_fkey;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_checked_in_by_fkey;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_checked_in_by_fkey FOREIGN KEY (checked_in_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_target_user_id_fkey;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_created_by_fkey;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.pending_staff DROP CONSTRAINT IF EXISTS pending_staff_created_by_fkey;
ALTER TABLE public.pending_staff
  ADD CONSTRAINT pending_staff_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

COMMIT;

-- Rollback, if ever required before the feature is used:
-- BEGIN;
-- DROP TABLE IF EXISTS public.account_deletion_receipts;
-- ALTER TABLE public.teacher_profiles DROP COLUMN IF EXISTS account_deleted_at;
-- ALTER TABLE public.school_roster DROP COLUMN IF EXISTS parent_account_deleted_at;
-- ALTER TABLE public.platform_requests DROP COLUMN IF EXISTS privacy_anonymized_at;
-- ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS actor_user_id;
-- COMMIT;
