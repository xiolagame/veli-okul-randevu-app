-- ==============================================================================
-- VELİ - OKUL RANDEVU SİSTEMİ (PROD SUPABASE POSTGRESQL SCHEMA)
-- Multi-Tenant, Row-Level-Security, ACID Transactions, Double-Booking Protection
-- ==============================================================================

-- 1. USERS (Global User Identity across all schools)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT ('usr-' || substr(md5(random()::text), 1, 16)),
    phone VARCHAR(20) UNIQUE NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    is_phone_verified BOOLEAN DEFAULT FALSE NOT NULL,
    security_question VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;

-- 2. SCHOOLS (Multi-tenant Tenants)
CREATE TABLE IF NOT EXISTS schools (
    id TEXT PRIMARY KEY DEFAULT ('sch-' || substr(md5(random()::text), 1, 16)),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    city VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    settings JSONB DEFAULT '{
        "slotDuration": 15,
        "dailyQuotaPerParent": 2,
        "maxAdvanceBookingDays": 14,
        "securityCheckInWindowMinutes": 30,
        "parentCancelNoticeHours": 2
    }'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. SCHOOL MEMBERSHIPS (Scoped Role per School for Global Users)
CREATE TABLE IF NOT EXISTS school_memberships (
    id TEXT PRIMARY KEY DEFAULT ('mem-' || substr(md5(random()::text), 1, 16)),
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL CHECK (role IN ('parent', 'teacher', 'security', 'admin')),
    branch VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active' NOT NULL CHECK (status IN ('active', 'inactive', 'suspended')),
    joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_school_user_role UNIQUE (school_id, user_id, role)
);

-- 4. SCHOOL ROSTER (School Whitelist for Verified Parent-Student Registration)
CREATE TABLE IF NOT EXISTS school_roster (
    id TEXT PRIMARY KEY DEFAULT ('rost-' || substr(md5(random()::text), 1, 16)),
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    parent_phone VARCHAR(20) NOT NULL,
    parent_name VARCHAR(150) NOT NULL,
    student_name VARCHAR(150) NOT NULL,
    class_name VARCHAR(50) NOT NULL,
    student_number VARCHAR(50),
    is_claimed BOOLEAN DEFAULT FALSE NOT NULL,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 5. STUDENTS (Students officially enrolled in a school)
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY DEFAULT ('stu-' || substr(md5(random()::text), 1, 16)),
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    class_name VARCHAR(50) NOT NULL,
    student_number VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_students_school_id UNIQUE (school_id, id)
);

-- 6. STUDENT PARENT RELATIONS (Verified links between Parent User and School Student)
CREATE TABLE IF NOT EXISTS student_parent_relations (
    id TEXT PRIMARY KEY DEFAULT ('rel-' || substr(md5(random()::text), 1, 16)),
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL,
    parent_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    verified_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_school_student_parent UNIQUE (school_id, student_id, parent_user_id),
    CONSTRAINT fk_relations_student FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE
);

-- Trigger: Ensure Parent has active membership in NEW.school_id
CREATE OR REPLACE FUNCTION trg_check_student_parent_relation_tenant()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM school_memberships
        WHERE school_id = NEW.school_id
          AND user_id = NEW.parent_user_id
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Cross-Tenant Integrity Violation: Parent % does not have active membership in school %', NEW.parent_user_id, NEW.school_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_student_parent_tenant ON student_parent_relations;
CREATE TRIGGER trg_validate_student_parent_tenant
BEFORE INSERT OR UPDATE ON student_parent_relations
FOR EACH ROW EXECUTE FUNCTION trg_check_student_parent_relation_tenant();

-- 7. TEACHER PROFILES (Teacher Directory in School)
CREATE TABLE IF NOT EXISTS teacher_profiles (
    id TEXT PRIMARY KEY DEFAULT ('tch-' || substr(md5(random()::text), 1, 16)),
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    branch VARCHAR(100) NOT NULL,
    email VARCHAR(150),
    phone VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_teachers_school_id UNIQUE (school_id, id)
);

-- 8. AVAILABILITY SLOTS (Teacher appointment availability windows)
CREATE TABLE IF NOT EXISTS availability_slots (
    id TEXT PRIMARY KEY DEFAULT ('slot-' || substr(md5(random()::text), 1, 16)),
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time VARCHAR(10) NOT NULL,
    end_time VARCHAR(10) NOT NULL,
    slot_duration INT DEFAULT 15 NOT NULL,
    is_recurring BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT fk_slots_teacher FOREIGN KEY (school_id, teacher_id) REFERENCES teacher_profiles(school_id, id) ON DELETE CASCADE
);

-- 9. APPOINTMENTS (Booked parent-teacher meetings)
CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY DEFAULT ('apt-' || substr(md5(random()::text), 1, 16)),
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL,
    teacher_name VARCHAR(150) NOT NULL,
    teacher_branch VARCHAR(100) NOT NULL,
    parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_name VARCHAR(150) NOT NULL,
    parent_phone VARCHAR(20) NOT NULL,
    student_id TEXT,
    student_name VARCHAR(150) NOT NULL,
    class_name VARCHAR(50) NOT NULL,
    date VARCHAR(20) NOT NULL,
    start_time VARCHAR(10) NOT NULL,
    end_time VARCHAR(10) NOT NULL,
    status VARCHAR(30) DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'booked', 'completed', 'cancelled', 'checked_in', 'rejected', 'checked_out')),
    entry_code VARCHAR(10) NOT NULL,
    qr_token TEXT,
    notes TEXT,
    rejection_reason TEXT,
    approved_at TIMESTAMPTZ,
    approved_by TEXT REFERENCES users(id),
    check_in_time VARCHAR(30),
    checked_in_by TEXT REFERENCES users(id),
    checked_in_at TIMESTAMPTZ,
    check_out_time VARCHAR(30),
    checked_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_appointments_school_id UNIQUE (school_id, id),
    CONSTRAINT fk_appointments_teacher FOREIGN KEY (school_id, teacher_id) REFERENCES teacher_profiles(school_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_appointments_student FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE SET NULL (student_id)
);

-- FAZ 9: HARD DATABASE-LEVEL DOUBLE BOOKING PREVENTION
-- Partial unique index ensures no two active/booked appointments can collide for the same teacher on the same date and time.
-- Slots with status 'cancelled' or 'rejected' are freed and can be booked by other parents.
-- Slots with status 'pending', 'booked', 'checked_in', 'checked_out' hold the appointment window.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_no_double_booking 
ON appointments (school_id, teacher_id, date, start_time) 
WHERE status NOT IN ('cancelled', 'rejected');

-- 10. NOTIFICATIONS (User-targeted in-app notifications)
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY DEFAULT ('notif-' || substr(md5(random()::text), 1, 16)),
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    date VARCHAR(50) NOT NULL,
    read BOOLEAN DEFAULT FALSE NOT NULL,
    appointment_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT fk_notifications_appointment FOREIGN KEY (school_id, appointment_id) REFERENCES appointments(school_id, id) ON DELETE SET NULL (appointment_id)
);

-- 11. AUDIT LOGS (Security and administrative audit trail)
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY DEFAULT ('log-' || substr(md5(random()::text), 1, 16)),
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    timestamp VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    actor_name VARCHAR(150) NOT NULL,
    details TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 12. INVITATIONS (QR / Token Invitation Context)
CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY DEFAULT ('inv-' || substr(md5(random()::text), 1, 16)),
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    token VARCHAR(100) UNIQUE NOT NULL,
    description VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS qr_token TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES users(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checked_in_by TEXT REFERENCES users(id);

ALTER TABLE invitations ADD COLUMN IF NOT EXISTS purpose VARCHAR(32);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS target_phone VARCHAR(20);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS target_user_id TEXT REFERENCES users(id);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS target_role VARCHAR(20);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS code_hash TEXT;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0 NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invitations_auth_code_lookup
  ON invitations (school_id, target_phone, purpose)
  WHERE code_hash IS NOT NULL;

-- 13. OTP VERIFICATION STORE (Ephemerally stores phone verification OTPs)
CREATE TABLE IF NOT EXISTS otp_verifications (
    phone VARCHAR(20) PRIMARY KEY,
    code VARCHAR(10) NOT NULL,
    expires_at BIGINT NOT NULL,
    attempts INT DEFAULT 0 NOT NULL,
    is_consumed BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ==============================================================================
-- FAZ 14: PERFORMANCE AND TENANT QUERY INDEXES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_schools_code ON schools(code);
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON school_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_school_id ON school_memberships(school_id);
CREATE INDEX IF NOT EXISTS idx_roster_school_parent_phone ON school_roster(school_id, parent_phone);
CREATE INDEX IF NOT EXISTS idx_students_school_id ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_relations_school_id ON student_parent_relations(school_id);
CREATE INDEX IF NOT EXISTS idx_relations_parent ON student_parent_relations(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_relations_student ON student_parent_relations(student_id);
CREATE INDEX IF NOT EXISTS idx_teacher_school_user ON teacher_profiles(school_id, user_id);
CREATE INDEX IF NOT EXISTS idx_availability_school_teacher ON availability_slots(school_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_appointments_school_teacher ON appointments(school_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_appointments_school_parent ON appointments(school_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_appointments_school_entry_code ON appointments(school_id, entry_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_qr_token_unique
  ON appointments(qr_token)
  WHERE qr_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_school_qr_token ON appointments(school_id, qr_token);
CREATE INDEX IF NOT EXISTS idx_notifications_school_user ON notifications(school_id, user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_school ON audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);

-- ==============================================================================
-- FAZ 10: ROW LEVEL SECURITY (RLS) POLICIES
-- Service role key bypasses RLS for backend API operations;
-- Direct public/anon access is strictly locked down:
-- 1. invitations: No direct anon/public SELECT allowed (handled exclusively via Express API service_role).
-- 2. schools: Direct anon/public read is removed or restricted to service_role; if direct anon read is desired,
--    it must not expose backend internal settings. All public directory queries flow securely via Express API.
-- ==============================================================================
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
    END IF;
END $$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_parent_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_verifications ENABLE ROW LEVEL SECURITY;

-- Note on invitations: Direct public SELECT policy is REMOVED to prevent unauthorized token enumeration.
-- Resolving invitations is handled strictly through the backend Express API using service_role context.

-- Note on schools: Direct anon/public client access to schools table is closed to prevent exposure of internal school settings.
-- Public school directory (/api/public/schools) and context lookup (/api/public/school-context) flow exclusively via Express API service_role.

-- Default deny for direct client write/mutations; all operations flow via Express Backend (service_role)
CREATE POLICY "Express backend service full access users" 
ON users FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access schools" 
ON schools FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access school_memberships" 
ON school_memberships FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access school_roster" 
ON school_roster FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access students" 
ON students FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access student_parent_relations" 
ON student_parent_relations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access teacher_profiles" 
ON teacher_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access availability_slots" 
ON availability_slots FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access appointments" 
ON appointments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access notifications" 
ON notifications FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access audit_logs" 
ON audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access invitations" 
ON invitations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Express backend service full access otp_verifications" 
ON otp_verifications FOR ALL TO service_role USING (true) WITH CHECK (true);
