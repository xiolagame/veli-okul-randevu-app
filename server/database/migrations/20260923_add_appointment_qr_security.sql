ALTER TABLE appointments ADD COLUMN IF NOT EXISTS qr_token TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES users(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checked_in_by TEXT REFERENCES users(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_qr_token_unique
  ON appointments (qr_token)
  WHERE qr_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_school_qr_token
  ON appointments (school_id, qr_token);
