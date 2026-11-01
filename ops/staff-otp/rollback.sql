-- Operator-approved rollback only. Prefer leaving the additive nullable column in place.
-- Never invent emails, delete rows, reduce auth_version or reopen retired staff credential endpoints.
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.pending_staff WHERE email IS NULL) THEN
    RAISE EXCEPTION 'Rollback refused: new security records have no email; retain nullable column';
  END IF;
END $$;
ALTER TABLE public.pending_staff ALTER COLUMN email SET NOT NULL;
COMMIT;
