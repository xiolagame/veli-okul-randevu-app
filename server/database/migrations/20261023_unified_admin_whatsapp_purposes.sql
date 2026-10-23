-- Extend WhatsApp authentication purposes for the unified school-admin flow.
-- Additive/idempotent for databases that already applied the base WhatsApp migration.
ALTER TABLE public.whatsapp_auth_challenges
  DROP CONSTRAINT IF EXISTS whatsapp_auth_challenges_target_role_check;
ALTER TABLE public.whatsapp_auth_challenges
  ADD CONSTRAINT whatsapp_auth_challenges_target_role_check
  CHECK (target_role IS NULL OR target_role IN ('parent','teacher','security','admin'));

ALTER TABLE public.whatsapp_auth_challenges
  DROP CONSTRAINT IF EXISTS whatsapp_auth_challenges_purpose_check;
ALTER TABLE public.whatsapp_auth_challenges
  ADD CONSTRAINT whatsapp_auth_challenges_purpose_check
  CHECK (purpose IN ('login','parent_registration','staff_activation','account_deletion','school_admin_login','school_admin_activation'));
