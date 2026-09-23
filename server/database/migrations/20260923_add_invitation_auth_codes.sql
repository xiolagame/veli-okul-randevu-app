ALTER TABLE invitations ADD COLUMN IF NOT EXISTS purpose VARCHAR(32);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS target_phone VARCHAR(20);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS target_user_id TEXT REFERENCES users(id);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS code_hash TEXT;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0 NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invitations_auth_code_lookup
  ON invitations (school_id, target_phone, purpose)
  WHERE code_hash IS NOT NULL;
