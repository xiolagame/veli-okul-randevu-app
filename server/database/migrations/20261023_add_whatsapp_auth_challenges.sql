CREATE TABLE IF NOT EXISTS public.whatsapp_auth_challenges (
    id TEXT PRIMARY KEY,
    school_id TEXT REFERENCES public.schools(id) ON DELETE CASCADE,
    target_phone VARCHAR(20) NOT NULL,
    target_user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    target_role VARCHAR(20) CHECK (target_role IS NULL OR target_role IN ('parent', 'teacher', 'security')),
    target_profile_id TEXT,
    purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('login', 'parent_registration', 'staff_activation', 'account_deletion')),
    code_hash CHAR(64) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    expires_at TIMESTAMPTZ NOT NULL,
    resend_available_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT whatsapp_auth_challenges_code_hash_format CHECK (code_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_challenges_lookup
ON public.whatsapp_auth_challenges (target_phone, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_challenges_active
ON public.whatsapp_auth_challenges (expires_at)
WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.whatsapp_auth_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Express backend service full access whatsapp_auth_challenges"
ON public.whatsapp_auth_challenges;

CREATE POLICY "Express backend service full access whatsapp_auth_challenges"
ON public.whatsapp_auth_challenges
FOR ALL TO service_role
USING (true)
WITH CHECK (true);
