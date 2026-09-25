ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE school_roster ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(150);

CREATE TABLE IF NOT EXISTS pending_staff (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role = 'security'),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(150) NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pending_staff_school_id UNIQUE (school_id, id)
);

CREATE INDEX IF NOT EXISTS idx_pending_staff_school_phone ON pending_staff (school_id, phone);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  scope_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ
);

ALTER TABLE pending_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Express backend service full access pending_staff" ON pending_staff;
CREATE POLICY "Express backend service full access pending_staff" ON pending_staff FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Express backend service full access auth_rate_limits" ON auth_rate_limits;
CREATE POLICY "Express backend service full access auth_rate_limits" ON auth_rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);
