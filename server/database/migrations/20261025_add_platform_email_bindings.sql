CREATE TABLE IF NOT EXISTS public.platform_email_bindings (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    candidate_email VARCHAR(150) NOT NULL,
    auth_version_at_start INTEGER NOT NULL CHECK (auth_version_at_start >= 0),
    code_hash CHAR(64) NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    status VARCHAR(32) NOT NULL DEFAULT 'EMAIL_CHALLENGE_ISSUED' CHECK (status IN (
        'EMAIL_CHALLENGE_ISSUED',
        'COMPLETED',
        'REVOKED'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT platform_email_bindings_terminal_timestamps CHECK (
        (status <> 'COMPLETED' OR consumed_at IS NOT NULL)
        AND (status <> 'REVOKED' OR revoked_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_email_bindings_active_user
ON public.platform_email_bindings (user_id)
WHERE consumed_at IS NULL AND revoked_at IS NULL
  AND status NOT IN ('COMPLETED', 'REVOKED');

CREATE INDEX IF NOT EXISTS idx_platform_email_bindings_expiry
ON public.platform_email_bindings (expires_at)
WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.platform_email_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Express backend service full access platform_email_bindings"
ON public.platform_email_bindings;

CREATE POLICY "Express backend service full access platform_email_bindings"
ON public.platform_email_bindings
FOR ALL TO service_role
USING (true)
WITH CHECK (true);
