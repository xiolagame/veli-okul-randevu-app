// ==============================================================================
// VELİ - OKUL RANDEVU SİSTEMİ: REPOSITORY LAYER (SUPABASE POSTGRESQL)
// All database queries are strictly tenant-scoped with mandatory school_id.
// Unified live PostgreSQL data layer; no local file dependency during runtime requests.
// Supports both standalone queries and atomic multi-table transactions.
// ==============================================================================

import crypto from 'crypto';
import { getDb, TransactionClient } from '../database/postgres';
import {
  School,
  SchoolSettings,
  SchoolMembership,
  SchoolRosterRecord,
  Student,
  StudentParentRelation,
  User,
  TeacherProfile,
  AvailabilitySlot,
  Appointment,
  NotificationItem,
  AuditLogItem,
  UserRole,
  AppointmentStatus,
} from '../../src/types';
import { getTurkishPhoneLookupDigits, normalizeTurkishPhone } from '../../src/utils/phone';
import { normalizePersonName } from '../../src/utils/person-name';

// Helper: executes query on transaction client if provided, else on global db
async function execQuery<T = any>(
  sql: string,
  params: any[] = [],
  client?: TransactionClient
): Promise<{ rows: T[] }> {
  if (client) {
    return client.query<T>(sql, params);
  }
  const db = await getDb();
  return db.query<T>(sql, params);
}

function mapTeacherProfile(row: any): TeacherProfile {
  return {
    id: row.id,
    schoolId: row.school_id,
    userId: row.user_id || undefined,
    firstName: normalizePersonName(row.first_name),
    lastName: normalizePersonName(row.last_name),
    branch: row.branch,
    email: row.email || undefined,
    phone: row.phone || '',
  };
}

function mapAppointment(row: any): Appointment {
  return {
    id: row.id ?? row.appointment_id,
    schoolId: row.school_id,
    teacherId: row.teacher_id,
    teacherName: normalizePersonName(row.teacher_name),
    teacherBranch: row.teacher_branch,
    parentId: row.parent_id,
    parentName: normalizePersonName(row.parent_name),
    parentPhone: row.parent_phone,
    studentId: row.student_id || undefined,
    studentName: normalizePersonName(row.student_name),
    className: row.class_name,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status as AppointmentStatus,
    entryCode: row.entry_code || undefined,
    qrToken: row.qr_token || undefined,
    notes: row.notes || undefined,
    rejectionReason: row.rejection_reason || undefined,
    approvedAt: row.approved_at || undefined,
    approvedBy: row.approved_by || undefined,
    checkedInAt: row.checked_in_at || undefined,
    checkedInBy: row.checked_in_by || undefined,
    checkedOutAt: row.checked_out_at || undefined,
    createdAt: row.created_at,
  };
}

export type AuthCodePurpose =
  | 'ACCOUNT_ACTIVATION'
  | 'TEACHER_ACTIVATION'
  | 'SECURITY_ACTIVATION'
  | 'PASSWORD_RESET'
  | 'parent_self_registration'
  | 'parent_password_reset'
  | 'staff_activation'
  | 'staff_password_reset'
  | 'staff_activation_setup'
  | 'staff_password_setup'
  | 'school_admin_activation'
  | 'school_admin_activation_setup'
  | 'school_admin_password_reset'
  | 'school_admin_password_setup';

// ==============================================================================
// 1. SCHOOL REPOSITORY
// ==============================================================================
export const schoolRepository = {
  async getAll(): Promise<School[]> {
    const res = await execQuery<any>(
      `SELECT id, name, code, city, district, settings, created_at FROM schools WHERE disabled_at IS NULL ORDER BY name ASC;`
    );
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      city: r.city,
      district: r.district,
      settings: typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings,
      createdAt: r.created_at,
    }));
  },

  async getById(id: string): Promise<School | null> {
    const res = await execQuery<any>(
      `SELECT id, name, code, city, district, settings, created_at FROM schools WHERE id = $1 AND disabled_at IS NULL;`,
      [id]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      city: r.city,
      district: r.district,
      settings: typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings,
      createdAt: r.created_at,
    };
  },

  async getByCode(code: string): Promise<School | null> {
    const clean = code.trim().toUpperCase();
    const res = await execQuery<any>(
      `SELECT id, name, code, city, district, settings, created_at 
       FROM schools 
       WHERE (UPPER(code) = $1 OR id = $2) AND disabled_at IS NULL;`,
      [clean, code.toLowerCase()]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      code: r.code,
      city: r.city,
      district: r.district,
      settings: typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings,
      createdAt: r.created_at,
    };
  },

  async updateSettings(schoolId: string, settings: Partial<SchoolSettings>): Promise<SchoolSettings> {
    const current = await this.getById(schoolId);
    if (!current) throw new Error(`Okul bulunamadı: ${schoolId}`);

    const merged = { ...current.settings, ...settings };
    const res = await execQuery<any>(
      `UPDATE schools 
       SET settings = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING settings;`,
      [JSON.stringify(merged), schoolId]
    );
    const r = res.rows[0];
    return typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings;
  },
};

// ==============================================================================
// 2. USER REPOSITORY (Global Identities)
// ==============================================================================
export const userRepository = {
  async getSecurityUsers(schoolId: string): Promise<User[]> {
    const result = await execQuery<{
      id: string; first_name: string; last_name: string; phone: string;
      account_status: 'active' | 'pending';
    }>(
      `SELECT u.id, u.first_name, u.last_name, u.phone,
         CASE WHEN NULLIF(u.password_hash, '') IS NOT NULL THEN 'active' ELSE 'pending' END AS account_status
       FROM users u
       WHERE EXISTS (
         SELECT 1 FROM school_memberships sm
         WHERE sm.user_id = u.id AND sm.school_id = $1
           AND sm.role = 'security' AND sm.status = 'active'
       )
       ORDER BY u.first_name, u.last_name, u.id;`,
      [schoolId]
    );
    return result.rows.map((row) => ({
      id: row.id, firstName: normalizePersonName(row.first_name), lastName: normalizePersonName(row.last_name),
      phone: row.phone, role: 'security', accountStatus: row.account_status,
    }));
  },

  async getAuthByPhone(phone: string): Promise<(User & { passwordHash: string | null; authVersion: number }) | null> {
    const lookupDigits = getTurkishPhoneLookupDigits(phone);
    if (!lookupDigits) return null;
    const canonicalPhone = `+${lookupDigits[0]}`;
    const res = await execQuery<any>(
      `SELECT id, phone, first_name, last_name, is_phone_verified, security_question, password_hash, auth_version, created_at
       FROM users
       WHERE regexp_replace(phone, '[^0-9]', '', 'g') IN ($1, $2, $3)
       ORDER BY CASE WHEN phone = $4 THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1;`,
      [...lookupDigits, canonicalPhone]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      phone: r.phone,
      firstName: normalizePersonName(r.first_name || ''),
      lastName: normalizePersonName(r.last_name || ''),
      isPhoneVerified: r.is_phone_verified,
      securityQuestion: r.security_question,
      createdAt: r.created_at,
      passwordHash: r.password_hash,
      authVersion: Number(r.auth_version),
    };
  },

  async getById(id: string, client?: TransactionClient): Promise<(User & { authVersion: number }) | null> {
    const res = await execQuery<any>(
      `SELECT id, phone, first_name, last_name, is_phone_verified, security_question, auth_version, created_at
       FROM users 
       WHERE id = $1;`,
      [id],
      client
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      phone: r.phone,
      firstName: normalizePersonName(r.first_name || ''),
      lastName: normalizePersonName(r.last_name || ''),
      isPhoneVerified: r.is_phone_verified,
      securityQuestion: r.security_question,
      createdAt: r.created_at,
      authVersion: Number(r.auth_version),
    };
  },

  async getByPhone(phone: string, client?: TransactionClient): Promise<(User & { authVersion: number }) | null> {
    const lookupDigits = getTurkishPhoneLookupDigits(phone);
    if (!lookupDigits) return null;
    const canonicalPhone = `+${lookupDigits[0]}`;
    const res = await execQuery<any>(
      `SELECT id, phone, first_name, last_name, is_phone_verified, security_question, auth_version, created_at
       FROM users 
       WHERE regexp_replace(phone, '[^0-9]', '', 'g') IN ($1, $2, $3)
       ORDER BY CASE WHEN phone = $4 THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1;`,
      [...lookupDigits, canonicalPhone],
      client
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      phone: r.phone,
      firstName: normalizePersonName(r.first_name || ''),
      lastName: normalizePersonName(r.last_name || ''),
      isPhoneVerified: r.is_phone_verified,
      securityQuestion: r.security_question,
      createdAt: r.created_at,
      authVersion: Number(r.auth_version),
    };
  },

  async updatePasswordHash(id: string, passwordHash: string, client?: TransactionClient): Promise<boolean> {
    const res = await execQuery(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id;`,
      [passwordHash, id],
      client
    );
    return res.rows.length > 0;
  },

  async updatePasswordHashAndInvalidateSessions(
    id: string,
    passwordHash: string,
    client?: TransactionClient
  ): Promise<number | null> {
    const res = await execQuery<{ auth_version: number }>(
      `UPDATE users
       SET password_hash = $1, auth_version = auth_version + 1, updated_at = NOW()
       WHERE id = $2
       RETURNING auth_version;`,
      [passwordHash, id],
      client
    );
    return res.rows[0] ? Number(res.rows[0].auth_version) : null;
  },

  async create(
    user: {
      id?: string;
      phone: string;
      firstName?: string;
      lastName?: string;
      isPhoneVerified?: boolean;
      securityQuestion?: string;
      email?: string;
    },
    client?: TransactionClient
  ): Promise<User> {
    const id = user.id || 'usr-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const cleanPhone = normalizeTurkishPhone(user.phone);
    if (!cleanPhone) throw new Error('Invalid Turkish phone number');

    const res = await execQuery<any>(
      `INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (phone) DO UPDATE SET
         is_phone_verified = EXCLUDED.is_phone_verified,
         updated_at = NOW()
       RETURNING id, phone, first_name, last_name, is_phone_verified, security_question, created_at;`,
      [
        id,
        cleanPhone,
        normalizePersonName(user.firstName || ''),
        normalizePersonName(user.lastName || ''),
        user.isPhoneVerified ?? false,
        user.securityQuestion || null,
        user.email || null,
      ],
      client
    );
    const r = res.rows[0];
    return {
      id: r.id,
      phone: r.phone,
      firstName: normalizePersonName(r.first_name || ''),
      lastName: normalizePersonName(r.last_name || ''),
      isPhoneVerified: r.is_phone_verified,
      securityQuestion: r.security_question,
      createdAt: r.created_at,
    };
  },

  async update(id: string, fields: Partial<User>, client?: TransactionClient): Promise<User | null> {
    const current = await this.getById(id, client);
    if (!current) return null;

    const firstName = fields.firstName !== undefined ? fields.firstName : current.firstName;
    const lastName = fields.lastName !== undefined ? fields.lastName : current.lastName;
    const isVerified = fields.isPhoneVerified !== undefined ? fields.isPhoneVerified : current.isPhoneVerified;
    const securityQuestion = fields.securityQuestion !== undefined ? fields.securityQuestion : current.securityQuestion;

    const res = await execQuery<any>(
      `UPDATE users 
       SET first_name = $1, last_name = $2, is_phone_verified = $3, security_question = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING id, phone, first_name, last_name, is_phone_verified, security_question, created_at;`,
      [normalizePersonName(firstName), normalizePersonName(lastName), isVerified, securityQuestion, id],
      client
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      phone: r.phone,
      firstName: normalizePersonName(r.first_name || ''),
      lastName: normalizePersonName(r.last_name || ''),
      isPhoneVerified: r.is_phone_verified,
      securityQuestion: r.security_question,
      createdAt: r.created_at,
    };
  },

  async verifyPhone(id: string, client?: TransactionClient): Promise<boolean> {
    await execQuery(
      `UPDATE users SET is_phone_verified = TRUE, updated_at = NOW() WHERE id = $1;`,
      [id],
      client
    );
    return true;
  },
};

// ==============================================================================
// 3. SCHOOL MEMBERSHIP REPOSITORY (Multi-tenant Role Scoping)
// ==============================================================================
export const membershipRepository = {
  async getMembershipsByUserId(userId: string, client?: TransactionClient): Promise<SchoolMembership[]> {
    const res = await execQuery<any>(
      `SELECT sm.id, sm.school_id, sm.user_id, sm.role, sm.branch, sm.status, sm.joined_at,
              s.name as school_name, s.code as school_code, s.city, s.district
       FROM school_memberships sm
       JOIN schools s ON s.id = sm.school_id
       WHERE sm.user_id = $1 AND sm.status = 'active' AND s.disabled_at IS NULL
       ORDER BY sm.joined_at DESC;`,
      [userId],
      client
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      userId: r.user_id,
      role: r.role as UserRole,
      branch: r.branch || undefined,
      status: r.status,
      joinedAt: r.joined_at,
      schoolName: r.school_name,
      schoolCode: r.school_code,
      city: r.city,
      district: r.district,
    }));
  },

  async getActiveMembership(userId: string, schoolId: string, client?: TransactionClient): Promise<SchoolMembership | null> {
    const res = await execQuery<any>(
      `SELECT sm.id, sm.school_id, sm.user_id, sm.role, sm.branch, sm.status, sm.joined_at,
              s.name as school_name, s.code as school_code, s.city, s.district
       FROM school_memberships sm
       JOIN schools s ON s.id = sm.school_id
       WHERE sm.user_id = $1 AND sm.school_id = $2 AND sm.status = 'active' AND s.disabled_at IS NULL
       LIMIT 1;`,
      [userId, schoolId],
      client
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      userId: r.user_id,
      role: r.role as UserRole,
      branch: r.branch || undefined,
      status: r.status,
      joinedAt: r.joined_at,
      schoolName: r.school_name,
      schoolCode: r.school_code,
      city: r.city,
      district: r.district,
    };
  },

  async getMembershipByRole(role: UserRole): Promise<SchoolMembership | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, user_id, role, branch, status, joined_at
       FROM school_memberships
       WHERE role = $1 AND status = 'active'
         AND EXISTS (SELECT 1 FROM schools s WHERE s.id=school_memberships.school_id AND s.disabled_at IS NULL)
       LIMIT 1;`,
      [role]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      userId: r.user_id,
      role: r.role as UserRole,
      branch: r.branch || undefined,
      status: r.status,
      joinedAt: r.joined_at,
    };
  },

  async createOrActivate(
    data: {
      id?: string;
      schoolId: string;
      userId: string;
      role: UserRole;
      branch?: string;
    },
    client?: TransactionClient
  ): Promise<SchoolMembership> {
    const id = data.id || 'mem-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const res = await execQuery<any>(
      `INSERT INTO school_memberships (id, school_id, user_id, role, branch, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (school_id, user_id, role) DO UPDATE SET
         status = 'active',
         branch = COALESCE(EXCLUDED.branch, school_memberships.branch),
         updated_at = NOW()
       RETURNING id, school_id, user_id, role, branch, status, joined_at;`,
      [id, data.schoolId, data.userId, data.role, data.branch || null],
      client
    );
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      userId: r.user_id,
      role: r.role as UserRole,
      branch: r.branch || undefined,
      status: r.status,
      joinedAt: r.joined_at,
    };
  },

  async getAllBySchool(schoolId: string): Promise<SchoolMembership[]> {
    const res = await execQuery<any>(
      `SELECT id, school_id, user_id, role, branch, status, joined_at
       FROM school_memberships
       WHERE school_id = $1
       ORDER BY joined_at DESC;`,
      [schoolId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      userId: r.user_id,
      role: r.role as UserRole,
      branch: r.branch || undefined,
      status: r.status,
      joinedAt: r.joined_at,
    }));
  },
};

// ==============================================================================
// 4. STUDENT REPOSITORY (Strictly Tenant Scoped)
// ==============================================================================
export const studentRepository = {
  async getStudentsBySchool(schoolId: string): Promise<Student[]> {
    const res = await execQuery<any>(
      `SELECT id, school_id, name, class_name, student_number, birth_date::text AS birth_date
       FROM students
       WHERE school_id = $1
       ORDER BY class_name ASC, name ASC;`,
      [schoolId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      name: normalizePersonName(r.name),
      className: r.class_name,
      studentNumber: r.student_number || undefined,
      birthDate: r.birth_date ? String(r.birth_date).slice(0, 10) : undefined,
    }));
  },

  async getStudentById(schoolId: string, studentId: string, client?: TransactionClient): Promise<Student | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, name, class_name, student_number, birth_date::text AS birth_date
       FROM students
       WHERE school_id = $1 AND id = $2;`,
      [schoolId, studentId],
      client
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      name: normalizePersonName(r.name),
      className: r.class_name,
      studentNumber: r.student_number || undefined,
      birthDate: r.birth_date ? String(r.birth_date).slice(0, 10) : undefined,
    };
  },

  async getStudentsByParent(schoolId: string, parentUserId: string): Promise<Student[]> {
    const res = await execQuery<any>(
      `SELECT s.id, s.school_id, s.name, s.class_name, s.student_number, s.birth_date::text AS birth_date
       FROM students s
       JOIN student_parent_relations rel ON rel.student_id = s.id AND rel.school_id = s.school_id
       WHERE rel.school_id = $1 AND rel.parent_user_id = $2
       ORDER BY s.class_name ASC, s.name ASC;`,
      [schoolId, parentUserId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      name: normalizePersonName(r.name),
      className: r.class_name,
      studentNumber: r.student_number || undefined,
      birthDate: r.birth_date ? String(r.birth_date).slice(0, 10) : undefined,
    }));
  },

  async findOrCreateStudent(
    schoolId: string,
    data: { id?: string; name: string; className: string; studentNumber?: string; birthDate?: string },
    client?: TransactionClient
  ): Promise<Student> {
    const cleanName = normalizePersonName(data.name);
    const existing = await execQuery<any>(
      `SELECT id, school_id, name, class_name, student_number, birth_date::text AS birth_date
       FROM students
       WHERE school_id = $1 AND class_name = $2 AND name = $3
         AND student_number IS NOT DISTINCT FROM $4 LIMIT 1;`,
      [schoolId, data.className, cleanName, data.studentNumber || null],
      client
    );
    const legacy = existing.rows.length ? [] : (await execQuery<any>(
      `SELECT id, school_id, name, class_name, student_number, birth_date::text AS birth_date
       FROM students WHERE school_id = $1 AND class_name = $2;`, [schoolId, data.className], client)).rows;
    const existingStudent = existing.rows[0] || legacy.find((row) => normalizePersonName(row.name) === cleanName && (row.student_number || null) === (data.studentNumber || null));
    if (existingStudent) {
      const r = existingStudent;
      return {
        id: r.id,
        schoolId: r.school_id,
        name: normalizePersonName(r.name),
        className: r.class_name,
        studentNumber: r.student_number || undefined,
        birthDate: r.birth_date ? String(r.birth_date).slice(0, 10) : undefined,
      };
    }

    const id = data.id || 'stu-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const res = await execQuery<any>(
      `INSERT INTO students (id, school_id, name, class_name, student_number, birth_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, school_id, name, class_name, student_number, birth_date::text AS birth_date;`,
      [id, schoolId, cleanName, data.className, data.studentNumber || null, data.birthDate || null],
      client
    );
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      name: normalizePersonName(r.name),
      className: r.class_name,
      studentNumber: r.student_number || undefined,
      birthDate: r.birth_date ? String(r.birth_date).slice(0, 10) : undefined,
    };
  },
};

// ==============================================================================
// 5. STUDENT PARENT RELATION REPOSITORY (Strictly Tenant Scoped)
// ==============================================================================
export const relationRepository = {
  async getRelationsByParent(schoolId: string, parentUserId: string): Promise<StudentParentRelation[]> {
    const res = await execQuery<any>(
      `SELECT id, school_id, student_id, parent_user_id, verified_at
       FROM student_parent_relations
       WHERE school_id = $1 AND parent_user_id = $2;`,
      [schoolId, parentUserId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      studentId: r.student_id,
      parentUserId: r.parent_user_id,
      verifiedAt: r.verified_at,
    }));
  },

  async createRelation(
    data: { id?: string; schoolId: string; studentId: string; parentUserId: string },
    client?: TransactionClient
  ): Promise<StudentParentRelation> {
    // 1. Verify student strictly belongs to this school (cross-tenant barrier)
    const student = await studentRepository.getStudentById(data.schoolId, data.studentId, client);
    if (!student) {
      throw new Error(`Veri Bütünlüğü Hatası: Öğrenci (${data.studentId}) ${data.schoolId} okuluna ait değildir.`);
    }

    // 2. Verify parent strictly has active membership in this school
    const membership = await membershipRepository.getActiveMembership(data.parentUserId, data.schoolId, client);
    if (!membership) {
      throw new Error(`Veri Bütünlüğü Hatası: Veli (${data.parentUserId}) ${data.schoolId} okulunda aktif üyeliğe sahip değildir.`);
    }

    const id = data.id || 'rel-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const res = await execQuery<any>(
      `INSERT INTO student_parent_relations (id, school_id, student_id, parent_user_id, verified_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (school_id, student_id, parent_user_id) DO UPDATE SET
         verified_at = NOW()
       RETURNING id, school_id, student_id, parent_user_id, verified_at;`,
      [id, data.schoolId, data.studentId, data.parentUserId],
      client
    );
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      studentId: r.student_id,
      parentUserId: r.parent_user_id,
      verifiedAt: r.verified_at,
    };
  },
};

// ==============================================================================
// 6. SCHOOL ROSTER REPOSITORY (Anti-Enumeration Phone Lookup)
// ==============================================================================
export const rosterRepository = {
  async getRoster(schoolId: string): Promise<SchoolRosterRecord[]> {
    const res = await execQuery<any>(
      `SELECT id, school_id, parent_phone, parent_name, student_name, class_name, student_number, birth_date::text AS birth_date, is_claimed
       FROM school_roster
       WHERE school_id = $1
       ORDER BY class_name ASC, student_name ASC;`,
      [schoolId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      parentPhone: r.parent_phone,
      parentName: normalizePersonName(r.parent_name),
      studentName: normalizePersonName(r.student_name),
      className: r.class_name,
      studentNumber: r.student_number || undefined,
      birthDate: r.birth_date ? String(r.birth_date).slice(0,10) : undefined,
      isClaimed: r.is_claimed,
    }));
  },

  async checkPhone(schoolId: string, parentPhone: string, client?: TransactionClient): Promise<SchoolRosterRecord[]> {
    const lookupDigits = getTurkishPhoneLookupDigits(parentPhone);
    if (!lookupDigits) return [];
    const res = await execQuery<any>(
      `SELECT id, school_id, parent_phone, parent_name, student_name, class_name, student_number, birth_date::text AS birth_date, is_claimed
       FROM school_roster
       WHERE school_id = $1 AND regexp_replace(parent_phone, '[^0-9]', '', 'g') IN ($2, $3, $4);`,
      [schoolId, ...lookupDigits],
      client
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      parentPhone: r.parent_phone,
      parentName: normalizePersonName(r.parent_name),
      studentName: normalizePersonName(r.student_name),
      className: r.class_name,
      studentNumber: r.student_number || undefined,
      birthDate: r.birth_date ? String(r.birth_date).slice(0,10) : undefined,
      isClaimed: r.is_claimed,
    }));
  },

  async getById(schoolId: string, rosterId: string, client?: TransactionClient): Promise<SchoolRosterRecord | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, parent_phone, parent_name, student_name, class_name, student_number, birth_date::text AS birth_date, is_claimed
       FROM school_roster WHERE school_id = $1 AND id = $2;`,
      [schoolId, rosterId],
      client
    );
    if (res.rows.length === 0) return null;
    const roster = res.rows[0];
    return {
      id: roster.id,
      schoolId: roster.school_id,
      parentPhone: roster.parent_phone,
      parentName: normalizePersonName(roster.parent_name),
      studentName: normalizePersonName(roster.student_name),
      className: roster.class_name,
      studentNumber: roster.student_number || undefined,
      birthDate: roster.birth_date ? String(roster.birth_date).slice(0,10) : undefined,
      isClaimed: roster.is_claimed,
    };
  },

  async claimRosterRecord(schoolId: string, rosterId: string, client?: TransactionClient): Promise<boolean> {
    const res = await execQuery<any>(
      `UPDATE school_roster
       SET is_claimed = TRUE, claimed_at = NOW(), updated_at = NOW()
       WHERE school_id = $1 AND id = $2;`,
      [schoolId, rosterId],
      client
    );
    return (res as any).rowCount ? (res as any).rowCount > 0 : true;
  },

  async bulkUpload(
    schoolId: string,
    records: Array<{
      parentPhone: string;
      parentName?: string;
      studentName: string;
      className?: string;
      studentNumber?: string;
    }>,
    client?: TransactionClient
  ): Promise<number> {
    let count = 0;
    for (const item of records) {
      if (!item.parentPhone || !item.studentName) continue;
      const cleanPhone = normalizeTurkishPhone(item.parentPhone);
      const lookupDigits = getTurkishPhoneLookupDigits(item.parentPhone);
      if (!cleanPhone || !lookupDigits) throw new Error('Invalid Turkish phone number');
      const id = 'rost-' + Date.now() + '-' + Math.floor(Math.random() * 100000);

      // Check if already in roster
      const exists = await execQuery<any>(
        `SELECT id FROM school_roster 
         WHERE school_id = $1 AND regexp_replace(parent_phone, '[^0-9]', '', 'g') IN ($2, $3, $4) AND student_name = $5;`,
        [schoolId, ...lookupDigits, item.studentName],
        client
      );

      if (exists.rows.length === 0) {
        await execQuery(
          `INSERT INTO school_roster (id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE);`,
          [
            id,
            schoolId,
            cleanPhone,
            normalizePersonName(item.parentName || 'Veli'),
            normalizePersonName(item.studentName),
            item.className || 'Genel',
            item.studentNumber || null,
          ],
          client
        );
        count++;
      }
    }
    return count;
  },
};

// ==============================================================================
// 7. TEACHER PROFILES REPOSITORY (Strictly Tenant Scoped)
// ==============================================================================
export const teacherRepository = {
  async getTeachers(schoolId: string, includeAccountStatus = false): Promise<TeacherProfile[]> {
    const res = await execQuery<any>(
      `SELECT tp.id, tp.school_id, tp.user_id, tp.first_name, tp.last_name, tp.branch, tp.email, tp.phone,
         CASE
           WHEN NULLIF(u.password_hash, '') IS NULL THEN 'pending'
           WHEN EXISTS (
             SELECT 1 FROM school_memberships sm
             WHERE sm.user_id = tp.user_id AND sm.school_id = tp.school_id
               AND sm.role = 'teacher' AND sm.status = 'active'
           ) THEN 'active'
           ELSE 'inactive'
         END AS account_status
       FROM teacher_profiles tp
       LEFT JOIN users u ON u.id = tp.user_id
       WHERE tp.school_id = $1
       ORDER BY tp.first_name ASC, tp.last_name ASC;`,
      [schoolId]
    );
    return res.rows.filter((row) => row.account_status !== 'inactive' && (includeAccountStatus || row.account_status === 'active')).map((row) => ({
      ...mapTeacherProfile(row),
      ...(includeAccountStatus ? { accountStatus: row.account_status } : {}),
    }));
  },

  async createPending(
    schoolId: string,
    teacher: { firstName: string; lastName: string; branch: string; phone: string; email?: string },
    client?: TransactionClient
  ): Promise<TeacherProfile> {
    const id = `tch-${crypto.randomUUID()}`;
    const res = await execQuery<any>(
      `INSERT INTO teacher_profiles (id, school_id, first_name, last_name, branch, phone, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, school_id, user_id, first_name, last_name, branch, email, phone;`,
      [id, schoolId, normalizePersonName(teacher.firstName), normalizePersonName(teacher.lastName), teacher.branch, teacher.phone, teacher.email || null],
      client
    );
    return mapTeacherProfile(res.rows[0]);
  },

  async getTeacherById(schoolId: string, teacherId: string, client?: TransactionClient): Promise<TeacherProfile | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, user_id, first_name, last_name, branch, email, phone
       FROM teacher_profiles
       WHERE school_id = $1 AND (id = $2 OR user_id = $2);`,
      [schoolId, teacherId],
      client
    );
    if (res.rows.length === 0) return null;
    return mapTeacherProfile(res.rows[0]);
  },

  async getTeacherByUserId(schoolId: string, userId: string, client?: TransactionClient): Promise<TeacherProfile | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, user_id, first_name, last_name, branch, email, phone
       FROM teacher_profiles
       WHERE school_id = $1 AND user_id = $2
       LIMIT 1;`,
      [schoolId, userId],
      client
    );
    return res.rows[0] ? mapTeacherProfile(res.rows[0]) : null;
  },

  async getTeacherByPhone(schoolId: string, phone: string, client?: TransactionClient): Promise<TeacherProfile | null> {
    const lookupDigits = getTurkishPhoneLookupDigits(phone);
    if (!lookupDigits) return null;
    const res = await execQuery<any>(
      `SELECT id, school_id, user_id, first_name, last_name, branch, email, phone
       FROM teacher_profiles
       WHERE school_id = $1
         AND regexp_replace(phone, '[^0-9]', '', 'g') IN ($2, $3, $4)
       LIMIT 1;`,
      [schoolId, ...lookupDigits],
      client
    );
    return res.rows[0] ? mapTeacherProfile(res.rows[0]) : null;
  },

  async linkUser(schoolId: string, teacherId: string, userId: string, client?: TransactionClient): Promise<boolean> {
    const res = await execQuery<any>(
      `UPDATE teacher_profiles
       SET user_id = $3, updated_at = NOW()
       WHERE school_id = $1 AND id = $2 AND (user_id IS NULL OR user_id = $3)
       RETURNING id;`,
      [schoolId, teacherId, userId],
      client
    );
    return res.rows.length > 0;
  },
};

// ==============================================================================
// 8. AVAILABILITY SLOTS REPOSITORY (Strictly Tenant Scoped)
// ==============================================================================
export const availabilityRepository = {
  async getAvailability(schoolId: string, teacherId?: string): Promise<AvailabilitySlot[]> {
    let sql = `SELECT id, school_id, teacher_id, day_of_week, start_time, end_time, slot_duration, is_recurring
               FROM availability_slots
               WHERE school_id = $1`;
    const params: any[] = [schoolId];

    if (teacherId) {
      sql += ` AND teacher_id = $2`;
      params.push(teacherId);
    }
    sql += ` ORDER BY day_of_week ASC, start_time ASC;`;

    const res = await execQuery<any>(sql, params);
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      teacherId: r.teacher_id,
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      slotDurationMinutes: r.slot_duration,
      isBlocked: false,
    }));
  },

  async getSlotById(schoolId: string, slotId: string): Promise<AvailabilitySlot | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, teacher_id, day_of_week, start_time, end_time, slot_duration
       FROM availability_slots
       WHERE school_id = $1 AND id = $2;`,
      [schoolId, slotId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      teacherId: r.teacher_id,
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      slotDurationMinutes: r.slot_duration,
    };
  },

  async createSlot(
    slot: {
      id?: string;
      schoolId: string;
      teacherId: string;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      slotDurationMinutes?: number;
    },
    client?: TransactionClient
  ): Promise<AvailabilitySlot> {
    const id = slot.id || 'slot-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const duration = slot.slotDurationMinutes || 15;

    const res = await execQuery<any>(
      `INSERT INTO availability_slots (id, school_id, teacher_id, day_of_week, start_time, end_time, slot_duration)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, school_id, teacher_id, day_of_week, start_time, end_time, slot_duration;`,
      [id, slot.schoolId, slot.teacherId, slot.dayOfWeek, slot.startTime, slot.endTime, duration],
      client
    );
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      teacherId: r.teacher_id,
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      slotDurationMinutes: r.slot_duration,
    };
  },

  async deleteSlot(schoolId: string, slotId: string, teacherId?: string): Promise<boolean> {
    let sql = `DELETE FROM availability_slots WHERE school_id = $1 AND id = $2`;
    const params: any[] = [schoolId, slotId];
    if (teacherId) {
      sql += ` AND teacher_id = $3`;
      params.push(teacherId);
    }
    const res = await execQuery(sql, params);
    return typeof (res as any).rowCount === 'number' ? (res as any).rowCount > 0 : true;
  },
};

// ==============================================================================
// 9. APPOINTMENTS REPOSITORY (Concurreny & Partial Unique Index Guarded)
// ==============================================================================
export const appointmentRepository = {
  async getAppointments(
    schoolId: string,
    filter?: { role?: UserRole; userId?: string; teacherProfileId?: string }
  ): Promise<Appointment[]> {
    if (filter?.role === 'teacher' && !filter.teacherProfileId) {
      return [];
    }

    let sql = `SELECT id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
                      student_id, student_name, class_name, date, start_time, end_time, status, entry_code,
                      notes, rejection_reason, qr_token, approved_at, approved_by, check_in_time, checked_in_by, checked_in_at, check_out_time, checked_out_at, created_at
               FROM appointments
               WHERE school_id = $1`;
    const params: any[] = [schoolId];

    if (filter?.role === 'parent' && filter.userId) {
      sql += ` AND parent_id = $2 AND hidden_for_parent_at IS NULL`;
      params.push(filter.userId);
    } else if (filter?.role === 'teacher' && filter.teacherProfileId) {
      sql += ` AND teacher_id = $2`;
      params.push(filter.teacherProfileId);
    }

    sql += ` ORDER BY date DESC, start_time DESC;`;

    const res = await execQuery<any>(sql, params);
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      teacherId: r.teacher_id,
      teacherName: normalizePersonName(r.teacher_name),
      teacherBranch: r.teacher_branch,
      parentId: r.parent_id,
      parentName: normalizePersonName(r.parent_name),
      parentPhone: r.parent_phone,
      studentId: r.student_id || undefined,
      studentName: normalizePersonName(r.student_name),
      className: r.class_name,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status as AppointmentStatus,
      entryCode: r.entry_code,
      qrToken: r.qr_token || undefined,
      notes: r.notes || undefined,
      rejectionReason: r.rejection_reason || undefined,
      checkedInAt: r.checked_in_at || undefined,
      checkedOutAt: r.checked_out_at || undefined,
      createdAt: r.created_at,
    }));
  },

  async getAppointmentById(schoolId: string, appointmentId: string, client?: TransactionClient): Promise<Appointment | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
              student_id, student_name, class_name, date, start_time, end_time, status, entry_code,
              notes, rejection_reason, qr_token, approved_at, approved_by, check_in_time, checked_in_by, checked_in_at, check_out_time, checked_out_at, created_at
       FROM appointments
       WHERE school_id = $1 AND id = $2${client ? ' FOR UPDATE' : ''};`,
      [schoolId, appointmentId], client
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      teacherId: r.teacher_id,
      teacherName: normalizePersonName(r.teacher_name),
      teacherBranch: r.teacher_branch,
      parentId: r.parent_id,
      parentName: normalizePersonName(r.parent_name),
      parentPhone: r.parent_phone,
      studentId: r.student_id || undefined,
      studentName: normalizePersonName(r.student_name),
      className: r.class_name,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status as AppointmentStatus,
      entryCode: r.entry_code,
      qrToken: r.qr_token || undefined,
      notes: r.notes || undefined,
      rejectionReason: r.rejection_reason || undefined,
      checkedInAt: r.checked_in_at || undefined,
      checkedOutAt: r.checked_out_at || undefined,
      createdAt: r.created_at,
    };
  },

  async getAppointmentByEntryCode(schoolId: string, code: string): Promise<Appointment | null> {
    const clean = code.trim();
    const res = await execQuery<any>(
      `SELECT id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
              student_id, student_name, class_name, date, start_time, end_time, status, entry_code,
              notes, rejection_reason, qr_token, approved_at, approved_by, check_in_time, checked_in_by, checked_in_at, check_out_time, checked_out_at, created_at
       FROM appointments
       WHERE school_id = $1 AND (entry_code = $2 OR id = $2);`,
      [schoolId, clean]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      teacherId: r.teacher_id,
      teacherName: normalizePersonName(r.teacher_name),
      teacherBranch: r.teacher_branch,
      parentId: r.parent_id,
      parentName: normalizePersonName(r.parent_name),
      parentPhone: r.parent_phone,
      studentId: r.student_id || undefined,
      studentName: normalizePersonName(r.student_name),
      className: r.class_name,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status as AppointmentStatus,
      entryCode: r.entry_code,
      qrToken: r.qr_token || undefined,
      notes: r.notes || undefined,
      rejectionReason: r.rejection_reason || undefined,
      checkedInAt: r.checked_in_at || undefined,
      checkedOutAt: r.checked_out_at || undefined,
      createdAt: r.created_at,
    };
  },

  async getAppointmentByQrToken(schoolId: string, qrToken: string): Promise<Appointment | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
              student_id, student_name, class_name, date, start_time, end_time, status, entry_code,
              notes, rejection_reason, qr_token, approved_at, approved_by, check_in_time, checked_in_by, checked_in_at, check_out_time, checked_out_at, created_at
       FROM appointments WHERE school_id = $1 AND qr_token = $2;`,
      [schoolId, qrToken.trim()]
    );
    return res.rows[0] ? mapAppointment(res.rows[0]) : null;
  },

  async findByCodeAnySchool(code: string): Promise<Appointment | null> {
    const clean = code.trim();
    const res = await execQuery<any>(
      `SELECT id, school_id, teacher_name, entry_code, status
       FROM appointments
       WHERE entry_code = $1 OR id = $1
       LIMIT 1;`,
      [clean]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      teacherId: '',
      teacherName: normalizePersonName(r.teacher_name),
      teacherBranch: '',
      parentId: '',
      parentName: '',
      parentPhone: '',
      studentName: '',
      className: '',
      date: '',
      startTime: '',
      endTime: '',
      status: r.status,
      entryCode: r.entry_code,
      createdAt: '',
    };
  },

  async findConflictingAppointment(
    schoolId: string,
    teacherId: string,
    date: string,
    startTime: string,
    client?: TransactionClient
  ): Promise<Appointment | null> {
    const res = await execQuery<any>(
      `SELECT id, status
       FROM appointments
       WHERE school_id = $1 AND teacher_id = $2 AND date = $3 AND start_time = $4
         AND status NOT IN ('cancelled', 'rejected')
       LIMIT 1;`,
      [schoolId, teacherId, date, startTime],
      client
    );
    if (res.rows.length === 0) return null;
    return res.rows[0];
  },

  async createAppointment(apt: Appointment, client?: TransactionClient): Promise<Appointment> {
    const id = apt.id || 'apt-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const entryCode = apt.entryCode || Math.floor(100000 + Math.random() * 900000).toString();
    const qrToken = apt.qrToken || `VELIQR1:${crypto.randomBytes(24).toString('base64url')}`;

    const res = await execQuery<any>(
      `INSERT INTO appointments (
         id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
         student_id, student_name, class_name, date, start_time, end_time, status, entry_code, qr_token, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
                 student_id, student_name, class_name, date, start_time, end_time, status, entry_code, qr_token, notes, created_at;`,
      [
        id,
        apt.schoolId,
        apt.teacherId,
        normalizePersonName(apt.teacherName),
        apt.teacherBranch,
        apt.parentId,
        normalizePersonName(apt.parentName),
        apt.parentPhone,
        apt.studentId || null,
        normalizePersonName(apt.studentName),
        apt.className,
        apt.date,
        apt.startTime,
        apt.endTime,
        apt.status || 'pending',
        entryCode,
        qrToken,
        apt.notes || null,
      ],
      client
    );
    return mapAppointment({ ...res.rows[0], id: res.rows[0]?.id ?? id });
  },

  async updateStatus(
    schoolId: string,
    appointmentId: string,
    status: AppointmentStatus,
      extra?: { rejectionReason?: string; checkedInAt?: string; checkedOutAt?: string },
    client?: TransactionClient
  ): Promise<Appointment | null> {
    const res = await execQuery<any>(
      `UPDATE appointments
       SET status = $1,
           rejection_reason = COALESCE($2, rejection_reason),
           checked_in_at = COALESCE($3, checked_in_at),
           checked_out_at = COALESCE($4, checked_out_at),
           updated_at = NOW()
       WHERE school_id = $5 AND id = $6
       RETURNING id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
                 student_id, student_name, class_name, date, start_time, end_time, status, entry_code,
                 notes, rejection_reason, checked_in_at, checked_out_at, created_at;`,
      [
        status,
        extra?.rejectionReason || null,
        extra?.checkedInAt || null,
        extra?.checkedOutAt || null,
        schoolId,
        appointmentId,
      ],
      client
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      teacherId: r.teacher_id,
      teacherName: normalizePersonName(r.teacher_name),
      teacherBranch: r.teacher_branch,
      parentId: r.parent_id,
      parentName: normalizePersonName(r.parent_name),
      parentPhone: r.parent_phone,
      studentId: r.student_id || undefined,
      studentName: normalizePersonName(r.student_name),
      className: r.class_name,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status as AppointmentStatus,
      entryCode: r.entry_code,
      notes: r.notes || undefined,
      rejectionReason: r.rejection_reason || undefined,
      checkedInAt: r.checked_in_at || undefined,
      checkedOutAt: r.checked_out_at || undefined,
      createdAt: r.created_at,
    };
  },

// ==============================================================================
  async transitionStatus(
    schoolId: string,
    appointmentId: string,
    fromStatus: AppointmentStatus,
    toStatus: AppointmentStatus,
    extra?: { rejectionReason?: string; approvedBy?: string; approvedAt?: string },
    client?: TransactionClient
  ): Promise<Appointment | null> {
    const res = await execQuery<any>(
      `UPDATE appointments SET status = $1, rejection_reason = COALESCE($2, rejection_reason),
         approved_at = COALESCE($3, approved_at), approved_by = COALESCE($4, approved_by), updated_at = NOW()
       WHERE school_id = $5 AND id = $6 AND status = $7
       RETURNING id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
         student_id, student_name, class_name, date, start_time, end_time, status, entry_code, qr_token,
         notes, rejection_reason, approved_at, approved_by, checked_in_at, checked_in_by, checked_out_at, created_at;`,
      [toStatus, extra?.rejectionReason || null, extra?.approvedAt || null, extra?.approvedBy || null, schoolId, appointmentId, fromStatus],
      client
    );
    return res.rows[0] ? mapAppointment(res.rows[0]) : null;
  },

  async checkInAtomically(schoolId: string, appointmentId: string, checkedInBy: string): Promise<Appointment | null> {
    const res = await execQuery<any>(
      `UPDATE appointments SET status = 'checked_in', checked_in_at = NOW(), checked_in_by = $1, updated_at = NOW()
       WHERE school_id = $2 AND id = $3 AND status = 'booked'
       RETURNING id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
         student_id, student_name, class_name, date, start_time, end_time, status, entry_code, qr_token,
         notes, rejection_reason, approved_at, approved_by, checked_in_at, checked_in_by, checked_out_at, created_at;`,
      [checkedInBy, schoolId, appointmentId]
    );
    return res.rows[0] ? mapAppointment(res.rows[0]) : null;
  },
};

// 10. NOTIFICATION REPOSITORY (Tenant & User Scoped)
// ==============================================================================
export const notificationRepository = {
  async getNotifications(schoolId: string, userId: string): Promise<NotificationItem[]> {
    const res = await execQuery<any>(
      `SELECT id, school_id, user_id, title, message, date, read, appointment_id, created_at
       FROM notifications
        WHERE school_id = $1 AND user_id = $2 AND hidden_at IS NULL
       ORDER BY created_at DESC;`,
      [schoolId, userId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      userId: r.user_id,
      title: r.title,
      message: r.message,
      date: new Date(r.created_at).toISOString(),
      read: r.read,
      appointmentId: r.appointment_id || undefined,
    }));
  },

  async markAllRead(schoolId: string, userId: string): Promise<boolean> {
    await execQuery(
      `UPDATE notifications
       SET read = TRUE
       WHERE school_id = $1 AND user_id = $2 AND read = FALSE;`,
      [schoolId, userId]
    );
    return true;
  },

  async hideAllForParent(schoolId: string, userId: string): Promise<void> {
    await execQuery(`UPDATE notifications SET hidden_at=NOW() WHERE school_id=$1 AND user_id=$2 AND hidden_at IS NULL`, [schoolId, userId]);
  },

  async createNotification(
    notif: {
      id?: string;
      schoolId: string;
      userId: string;
      title: string;
      message: string;
      date?: string;
      appointmentId?: string;
    },
    client?: TransactionClient
  ): Promise<NotificationItem> {
    const id = notif.id || 'notif-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const dateStr = notif.date || new Date().toISOString();

    const res = await execQuery<any>(
      `INSERT INTO notifications (id, school_id, user_id, title, message, date, read, appointment_id)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7)
       RETURNING id, school_id, user_id, title, message, date, read, appointment_id;`,
      [id, notif.schoolId, notif.userId, notif.title, notif.message, dateStr, notif.appointmentId || null],
      client
    );
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      userId: r.user_id,
      title: r.title,
      message: r.message,
      date: r.date,
      read: r.read,
      appointmentId: r.appointment_id || undefined,
    };
  },
};

// ==============================================================================
// 11. AUDIT LOG REPOSITORY (Strictly Tenant Scoped)
// ==============================================================================
export const auditLogRepository = {
  async getAuditLogs(schoolId: string): Promise<AuditLogItem[]> {
    const res = await execQuery<any>(
      `SELECT id, school_id, timestamp, action, actor_name, details, created_at
       FROM audit_logs
       WHERE school_id = $1
       ORDER BY created_at DESC;`,
      [schoolId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      timestamp: new Date(r.created_at).toISOString(),
      action: r.action,
      actorName: r.actor_name,
      details: r.details,
    }));
  },

  async createAuditLog(
    log: {
      id?: string;
      schoolId: string;
      timestamp?: string;
      action: string;
      actorName: string;
      details: string;
    },
    client?: TransactionClient
  ): Promise<AuditLogItem> {
    const id = log.id || 'log-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const time =
      log.timestamp ||
      new Date().toISOString();

    const res = await execQuery<any>(
      `INSERT INTO audit_logs (id, school_id, timestamp, action, actor_name, details)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, school_id, timestamp, action, actor_name, details;`,
      [id, log.schoolId, time, log.action, log.actorName, log.details],
      client
    );
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      timestamp: r.timestamp,
      action: r.action,
      actorName: r.actor_name,
      details: r.details,
    };
  },
};

// ==============================================================================
// 12. INVITATION REPOSITORY
// ==============================================================================
export const invitationRepository = {
  async getByToken(token: string): Promise<{ id: string; schoolId: string; token: string; isActive: boolean; description?: string } | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, token, is_active, description
       FROM invitations
       WHERE token = $1 AND is_active = TRUE;`,
      [token]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      token: r.token,
      isActive: r.is_active,
      description: r.description || undefined,
    };
  },

  async createAuthCode(
    data: {
      schoolId: string;
      targetPhone: string;
      targetUserId?: string;
      targetRole?: UserRole;
      purpose: AuthCodePurpose;
      codeHash: string;
      createdBy?: string;
      expiresAt: string;
      token: string;
    },
    client?: TransactionClient
  ): Promise<{ id: string; expiresAt: string }> {
    const cleanPhone = normalizeTurkishPhone(data.targetPhone);
    if (!cleanPhone) throw new Error('Invalid Turkish phone number');
    await execQuery(
      `UPDATE invitations SET is_active = FALSE, revoked_at = NOW()
       WHERE school_id = $1 AND target_phone = $2 AND purpose = $3
         AND is_active = TRUE AND consumed_at IS NULL AND revoked_at IS NULL;`,
      [data.schoolId, cleanPhone, data.purpose],
      client
    );

    const id = `inv-auth-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const res = await execQuery<any>(
      `INSERT INTO invitations (
         id, school_id, token, is_active, expires_at, purpose, target_phone,
         target_user_id, target_role, code_hash, created_by, attempts
       ) VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8, $9, $10, 0)
       RETURNING id, expires_at;`,
      [id, data.schoolId, data.token, data.expiresAt, data.purpose, cleanPhone, data.targetUserId || null, data.targetRole || null, data.codeHash, data.createdBy || null],
      client
    );
    return { id: res.rows[0].id, expiresAt: res.rows[0].expires_at };
  },

  async consumeAuthCode(
    data: {
      schoolId: string;
      targetPhone: string;
      targetUserId?: string;
      targetRole?: UserRole;
      purpose: AuthCodePurpose;
      codeHash: string;
    },
    client?: TransactionClient
  ): Promise<{ id: string; targetRole?: UserRole; targetUserId?: string } | null> {
    const cleanPhone = normalizeTurkishPhone(data.targetPhone);
    if (!cleanPhone) return null;
    const res = await execQuery<any>(
      `UPDATE invitations SET consumed_at = NOW(), is_active = FALSE
       WHERE school_id = $1 AND target_phone = $2 AND purpose = $3 AND code_hash = $4
         AND is_active = TRUE AND consumed_at IS NULL AND revoked_at IS NULL
         AND attempts < 5 AND expires_at > NOW()
         AND ($6::varchar IS NULL OR target_role = $6)
         AND (target_user_id IS NULL OR target_user_id = $5)
       RETURNING id, target_role, target_user_id;`,
      [data.schoolId, cleanPhone, data.purpose, data.codeHash, data.targetUserId || null, data.targetRole || null],
      client
    );
    return res.rows[0] ? { id: res.rows[0].id, targetRole: res.rows[0].target_role || undefined, targetUserId: res.rows[0].target_user_id || undefined } : null;
  },

  async recordFailedAuthCodeAttempt(
    schoolId: string,
    targetPhone: string,
    purpose: AuthCodePurpose,
    client?: TransactionClient
  ): Promise<void> {
    const cleanPhone = normalizeTurkishPhone(targetPhone);
    if (!cleanPhone) return;
    await execQuery(
      `UPDATE invitations
       SET attempts = attempts + 1,
           revoked_at = CASE WHEN attempts + 1 >= 5 THEN NOW() ELSE revoked_at END,
           is_active = CASE WHEN attempts + 1 >= 5 THEN FALSE ELSE is_active END
       WHERE school_id = $1 AND target_phone = $2 AND purpose = $3
         AND is_active = TRUE AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW();`,
      [schoolId, cleanPhone, purpose],
      client
    );
  },
};

// ==============================================================================
// Legacy otp_verifications data is intentionally retained in the database until a separate cleanup migration.
// ==============================================================================
