CREATE TABLE IF NOT EXISTS public.platform_phone_bindings (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    candidate_phone VARCHAR(20) NOT NULL,
    auth_version_at_start INTEGER NOT NULL CHECK (auth_version_at_start >= 0),
    email_recipient_fingerprint CHAR(64) NOT NULL CHECK (email_recipient_fingerprint ~ '^[0-9a-f]{64}$'),
    email_code_hash CHAR(64) NOT NULL CHECK (email_code_hash ~ '^[0-9a-f]{64}$'),
    email_attempts INTEGER NOT NULL DEFAULT 0 CHECK (email_attempts >= 0),
    email_max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (email_max_attempts BETWEEN 1 AND 10),
    email_verified_at TIMESTAMPTZ,
    whatsapp_code_hash CHAR(64) CHECK (whatsapp_code_hash IS NULL OR whatsapp_code_hash ~ '^[0-9a-f]{64}$'),
    whatsapp_attempts INTEGER NOT NULL DEFAULT 0 CHECK (whatsapp_attempts >= 0),
    whatsapp_max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (whatsapp_max_attempts BETWEEN 1 AND 10),
    whatsapp_expires_at TIMESTAMPTZ,
    status VARCHAR(40) NOT NULL DEFAULT 'EMAIL_CHALLENGE_ISSUED' CHECK (status IN (
        'EMAIL_CHALLENGE_ISSUED',
        'EMAIL_VERIFIED',
        'WHATSAPP_CHALLENGE_ISSUED',
        'COMPLETED',
        'REVOKED'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT platform_phone_bindings_phone_canonical CHECK (candidate_phone ~ '^\+905[0-9]{9}$'),
    CONSTRAINT platform_phone_bindings_terminal_timestamps CHECK (
        (status <> 'COMPLETED' OR consumed_at IS NOT NULL)
        AND (status <> 'REVOKED' OR revoked_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_phone_bindings_active_user
ON public.platform_phone_bindings (user_id)
WHERE consumed_at IS NULL AND revoked_at IS NULL
  AND status NOT IN ('COMPLETED', 'REVOKED');

CREATE INDEX IF NOT EXISTS idx_platform_phone_bindings_expiry
ON public.platform_phone_bindings (expires_at)
WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.platform_phone_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Express backend service full access platform_phone_bindings"
ON public.platform_phone_bindings;

CREATE POLICY "Express backend service full access platform_phone_bindings"
ON public.platform_phone_bindings
FOR ALL TO service_role
USING (true)
WITH CHECK (true);
