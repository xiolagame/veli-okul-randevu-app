CREATE TABLE IF NOT EXISTS public.identity_auth_attempts (
    id UUID PRIMARY KEY,
    canonical_phone VARCHAR(20) NOT NULL,
    target_user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
    flow_type VARCHAR(40) NOT NULL CHECK (flow_type IN (
        'USER_LOGIN',
        'PARENT_REGISTRATION',
        'STAFF_ACTIVATION',
        'SCHOOL_ADMIN_LOGIN',
        'SCHOOL_ADMIN_ACTIVATION',
        'PLATFORM_LOGIN',
        'ACCOUNT_RECOVERY'
    )),
    status VARCHAR(40) NOT NULL DEFAULT 'CREATED' CHECK (status IN (
        'CREATED',
        'PHONE_CHALLENGE_ISSUED',
        'PHONE_VERIFIED',
        'EMAIL_CHALLENGE_ISSUED',
        'EMAIL_VERIFIED',
        'AUTHENTICATED',
        'EXPIRED',
        'REVOKED'
    )),
    whatsapp_challenge_id TEXT UNIQUE REFERENCES public.whatsapp_auth_challenges(id) ON DELETE SET NULL,
    phone_verified_at TIMESTAMPTZ,
    email_challenge_id UUID UNIQUE,
    email_recipient_fingerprint CHAR(64),
    email_code_hash CHAR(64),
    email_attempts INTEGER NOT NULL DEFAULT 0 CHECK (email_attempts >= 0),
    email_max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (email_max_attempts BETWEEN 1 AND 10),
    email_verified_at TIMESTAMPTZ,
    auth_version_at_start INTEGER CHECK (auth_version_at_start IS NULL OR auth_version_at_start >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT identity_auth_attempts_phone_canonical CHECK (canonical_phone ~ '^\+905[0-9]{9}$'),
    CONSTRAINT identity_auth_attempts_email_hash_pair CHECK (
        (email_code_hash IS NULL AND email_recipient_fingerprint IS NULL AND email_challenge_id IS NULL)
        OR
        (email_code_hash ~ '^[0-9a-f]{64}$' AND email_recipient_fingerprint ~ '^[0-9a-f]{64}$' AND email_challenge_id IS NOT NULL)
    ),
    CONSTRAINT identity_auth_attempts_terminal_timestamps CHECK (
        (status <> 'AUTHENTICATED' OR consumed_at IS NOT NULL)
        AND (status <> 'REVOKED' OR revoked_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_identity_auth_attempts_phone_created
ON public.identity_auth_attempts (canonical_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_identity_auth_attempts_user_created
ON public.identity_auth_attempts (target_user_id, created_at DESC)
WHERE target_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_identity_auth_attempts_active_expiry
ON public.identity_auth_attempts (expires_at)
WHERE consumed_at IS NULL AND revoked_at IS NULL
  AND status NOT IN ('AUTHENTICATED', 'EXPIRED', 'REVOKED');

ALTER TABLE public.identity_auth_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Express backend service full access identity_auth_attempts"
ON public.identity_auth_attempts;

CREATE POLICY "Express backend service full access identity_auth_attempts"
ON public.identity_auth_attempts
FOR ALL TO service_role
USING (true)
WITH CHECK (true);
