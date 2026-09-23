ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS target_role VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_invitations_auth_code_role_lookup
  ON public.invitations (school_id, target_phone, purpose, target_role)
  WHERE code_hash IS NOT NULL;
