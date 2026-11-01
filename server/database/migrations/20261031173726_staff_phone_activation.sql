-- Additive, data-preserving change. No identity, teacher email or relation rewrite.
ALTER TABLE public.pending_staff ALTER COLUMN email DROP NOT NULL;
COMMENT ON COLUMN public.pending_staff.email IS 'Legacy contact data, optional for security; never a login identifier.';
