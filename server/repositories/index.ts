// ==============================================================================
// VELİ - OKUL RANDEVU SİSTEMİ: REPOSITORY LAYER (SUPABASE POSTGRESQL)
// All database queries are strictly tenant-scoped with mandatory school_id.
// Unified live PostgreSQL data layer; no local file dependency during runtime requests.
// Supports both standalone queries and atomic multi-table transactions.
// ==============================================================================

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

// ==============================================================================
// 1. SCHOOL REPOSITORY
// ==============================================================================
export const schoolRepository = {
  async getAll(): Promise<School[]> {
    const res = await execQuery<any>(
      `SELECT id, name, code, city, district, settings, created_at FROM schools ORDER BY name ASC;`
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
      `SELECT id, name, code, city, district, settings, created_at FROM schools WHERE id = $1;`,
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
       WHERE UPPER(code) = $1 OR id = $2;`,
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
  async getAuthByPhone(phone: string): Promise<(User & { passwordHash: string | null }) | null> {
    const lookupDigits = getTurkishPhoneLookupDigits(phone);
    if (!lookupDigits) return null;
    const canonicalPhone = `+${lookupDigits[0]}`;
    const res = await execQuery<any>(
      `SELECT id, phone, first_name, last_name, is_phone_verified, security_question, password_hash, created_at
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
      firstName: r.first_name || '',
      lastName: r.last_name || '',
      isPhoneVerified: r.is_phone_verified,
      securityQuestion: r.security_question,
      createdAt: r.created_at,
      passwordHash: r.password_hash,
    };
  },

  async getById(id: string, client?: TransactionClient): Promise<User | null> {
    const res = await execQuery<any>(
      `SELECT id, phone, first_name, last_name, is_phone_verified, security_question, created_at 
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
      firstName: r.first_name || '',
      lastName: r.last_name || '',
      isPhoneVerified: r.is_phone_verified,
      securityQuestion: r.security_question,
      createdAt: r.created_at,
    };
  },

  async getByPhone(phone: string, client?: TransactionClient): Promise<User | null> {
    const lookupDigits = getTurkishPhoneLookupDigits(phone);
    if (!lookupDigits) return null;
    const canonicalPhone = `+${lookupDigits[0]}`;
    const res = await execQuery<any>(
      `SELECT id, phone, first_name, last_name, is_phone_verified, security_question, created_at 
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
      firstName: r.first_name || '',
      lastName: r.last_name || '',
      isPhoneVerified: r.is_phone_verified,
      securityQuestion: r.security_question,
      createdAt: r.created_at,
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

  async create(
    user: {
      id?: string;
      phone: string;
      firstName?: string;
      lastName?: string;
      isPhoneVerified?: boolean;
      securityQuestion?: string;
    },
    client?: TransactionClient
  ): Promise<User> {
    const id = user.id || 'usr-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const cleanPhone = normalizeTurkishPhone(user.phone);
    if (!cleanPhone) throw new Error('Invalid Turkish phone number');

    const res = await execQuery<any>(
      `INSERT INTO users (id, phone, first_name, last_name, is_phone_verified, security_question)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (phone) DO UPDATE SET
         is_phone_verified = EXCLUDED.is_phone_verified,
         updated_at = NOW()
       RETURNING id, phone, first_name, last_name, is_phone_verified, security_question, created_at;`,
      [
        id,
        cleanPhone,
        user.firstName || '',
        user.lastName || '',
        user.isPhoneVerified ?? false,
        user.securityQuestion || null,
      ],
      client
    );
    const r = res.rows[0];
    return {
      id: r.id,
      phone: r.phone,
      firstName: r.first_name || '',
      lastName: r.last_name || '',
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
      [firstName, lastName, isVerified, securityQuestion, id],
      client
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      phone: r.phone,
      firstName: r.first_name || '',
      lastName: r.last_name || '',
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
  async getMembershipsByUserId(userId: string): Promise<SchoolMembership[]> {
    const res = await execQuery<any>(
      `SELECT sm.id, sm.school_id, sm.user_id, sm.role, sm.branch, sm.status, sm.joined_at,
              s.name as school_name, s.code as school_code, s.city, s.district
       FROM school_memberships sm
       JOIN schools s ON s.id = sm.school_id
       WHERE sm.user_id = $1 AND sm.status = 'active'
       ORDER BY sm.joined_at DESC;`,
      [userId]
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
       WHERE sm.user_id = $1 AND sm.school_id = $2 AND sm.status = 'active'
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
      `SELECT id, school_id, name, class_name, student_number
       FROM students
       WHERE school_id = $1
       ORDER BY class_name ASC, name ASC;`,
      [schoolId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      name: r.name,
      className: r.class_name,
      studentNumber: r.student_number || undefined,
    }));
  },

  async getStudentById(schoolId: string, studentId: string, client?: TransactionClient): Promise<Student | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, name, class_name, student_number
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
      name: r.name,
      className: r.class_name,
      studentNumber: r.student_number || undefined,
    };
  },

  async getStudentsByParent(schoolId: string, parentUserId: string): Promise<Student[]> {
    const res = await execQuery<any>(
      `SELECT s.id, s.school_id, s.name, s.class_name, s.student_number
       FROM students s
       JOIN student_parent_relations rel ON rel.student_id = s.id AND rel.school_id = s.school_id
       WHERE rel.school_id = $1 AND rel.parent_user_id = $2
       ORDER BY s.class_name ASC, s.name ASC;`,
      [schoolId, parentUserId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      name: r.name,
      className: r.class_name,
      studentNumber: r.student_number || undefined,
    }));
  },

  async findOrCreateStudent(
    schoolId: string,
    data: { id?: string; name: string; className: string; studentNumber?: string },
    client?: TransactionClient
  ): Promise<Student> {
    // Check if matching student exists in this school
    const existing = await execQuery<any>(
      `SELECT id, school_id, name, class_name, student_number
       FROM students
       WHERE school_id = $1 AND name = $2 AND class_name = $3
       LIMIT 1;`,
      [schoolId, data.name, data.className],
      client
    );
    if (existing.rows.length > 0) {
      const r = existing.rows[0];
      return {
        id: r.id,
        schoolId: r.school_id,
        name: r.name,
        className: r.class_name,
        studentNumber: r.student_number || undefined,
      };
    }

    const id = data.id || 'stu-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const res = await execQuery<any>(
      `INSERT INTO students (id, school_id, name, class_name, student_number)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, school_id, name, class_name, student_number;`,
      [id, schoolId, data.name, data.className, data.studentNumber || null],
      client
    );
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      name: r.name,
      className: r.class_name,
      studentNumber: r.student_number || undefined,
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
      `SELECT id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed
       FROM school_roster
       WHERE school_id = $1
       ORDER BY class_name ASC, student_name ASC;`,
      [schoolId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      parentPhone: r.parent_phone,
      parentName: r.parent_name,
      studentName: r.student_name,
      className: r.class_name,
      studentNumber: r.student_number || undefined,
      isClaimed: r.is_claimed,
    }));
  },

  async checkPhone(schoolId: string, parentPhone: string, client?: TransactionClient): Promise<SchoolRosterRecord[]> {
    const lookupDigits = getTurkishPhoneLookupDigits(parentPhone);
    if (!lookupDigits) return [];
    const res = await execQuery<any>(
      `SELECT id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed
       FROM school_roster
       WHERE school_id = $1 AND regexp_replace(parent_phone, '[^0-9]', '', 'g') IN ($2, $3, $4);`,
      [schoolId, ...lookupDigits],
      client
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      parentPhone: r.parent_phone,
      parentName: r.parent_name,
      studentName: r.student_name,
      className: r.class_name,
      studentNumber: r.student_number || undefined,
      isClaimed: r.is_claimed,
    }));
  },

  async getById(schoolId: string, rosterId: string, client?: TransactionClient): Promise<SchoolRosterRecord | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, parent_phone, parent_name, student_name, class_name, student_number, is_claimed
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
      parentName: roster.parent_name,
      studentName: roster.student_name,
      className: roster.class_name,
      studentNumber: roster.student_number || undefined,
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
            item.parentName || 'Veli',
            item.studentName,
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
  async getTeachers(schoolId: string): Promise<TeacherProfile[]> {
    const res = await execQuery<any>(
      `SELECT id, school_id, user_id, first_name, last_name, branch, email, phone
       FROM teacher_profiles
       WHERE school_id = $1
       ORDER BY first_name ASC, last_name ASC;`,
      [schoolId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      firstName: r.first_name,
      lastName: r.last_name,
      branch: r.branch,
      email: r.email || undefined,
      phone: r.phone || '',
    }));
  },

  async getTeacherById(schoolId: string, teacherId: string): Promise<TeacherProfile | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, user_id, first_name, last_name, branch, email, phone
       FROM teacher_profiles
       WHERE school_id = $1 AND (id = $2 OR user_id = $2);`,
      [schoolId, teacherId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      firstName: r.first_name,
      lastName: r.last_name,
      branch: r.branch,
      email: r.email || undefined,
      phone: r.phone || '',
    };
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
    filter?: { role?: UserRole; userId?: string }
  ): Promise<Appointment[]> {
    let sql = `SELECT id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
                      student_id, student_name, class_name, date, start_time, end_time, status, entry_code,
                      notes, rejection_reason, check_in_time, check_out_time, created_at
               FROM appointments
               WHERE school_id = $1`;
    const params: any[] = [schoolId];

    if (filter?.role === 'parent' && filter.userId) {
      sql += ` AND parent_id = $2`;
      params.push(filter.userId);
    } else if (filter?.role === 'teacher' && filter.userId) {
      sql += ` AND teacher_id = $2`;
      params.push(filter.userId);
    }

    sql += ` ORDER BY date DESC, start_time DESC;`;

    const res = await execQuery<any>(sql, params);
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      teacherBranch: r.teacher_branch,
      parentId: r.parent_id,
      parentName: r.parent_name,
      parentPhone: r.parent_phone,
      studentId: r.student_id || undefined,
      studentName: r.student_name,
      className: r.class_name,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status as AppointmentStatus,
      entryCode: r.entry_code,
      notes: r.notes || undefined,
      rejectionReason: r.rejection_reason || undefined,
      checkedInAt: r.check_in_time || undefined,
      checkedOutAt: r.check_out_time || undefined,
      createdAt: r.created_at,
    }));
  },

  async getAppointmentById(schoolId: string, appointmentId: string): Promise<Appointment | null> {
    const res = await execQuery<any>(
      `SELECT id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
              student_id, student_name, class_name, date, start_time, end_time, status, entry_code,
              notes, rejection_reason, check_in_time, check_out_time, created_at
       FROM appointments
       WHERE school_id = $1 AND id = $2;`,
      [schoolId, appointmentId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      teacherBranch: r.teacher_branch,
      parentId: r.parent_id,
      parentName: r.parent_name,
      parentPhone: r.parent_phone,
      studentId: r.student_id || undefined,
      studentName: r.student_name,
      className: r.class_name,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status as AppointmentStatus,
      entryCode: r.entry_code,
      notes: r.notes || undefined,
      rejectionReason: r.rejection_reason || undefined,
      checkedInAt: r.check_in_time || undefined,
      checkedOutAt: r.check_out_time || undefined,
      createdAt: r.created_at,
    };
  },

  async getAppointmentByEntryCode(schoolId: string, code: string): Promise<Appointment | null> {
    const clean = code.trim();
    const res = await execQuery<any>(
      `SELECT id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
              student_id, student_name, class_name, date, start_time, end_time, status, entry_code,
              notes, rejection_reason, check_in_time, check_out_time, created_at
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
      teacherName: r.teacher_name,
      teacherBranch: r.teacher_branch,
      parentId: r.parent_id,
      parentName: r.parent_name,
      parentPhone: r.parent_phone,
      studentId: r.student_id || undefined,
      studentName: r.student_name,
      className: r.class_name,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status as AppointmentStatus,
      entryCode: r.entry_code,
      notes: r.notes || undefined,
      rejectionReason: r.rejection_reason || undefined,
      checkedInAt: r.check_in_time || undefined,
      checkedOutAt: r.check_out_time || undefined,
      createdAt: r.created_at,
    };
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
      teacherName: r.teacher_name,
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

    const res = await execQuery<any>(
      `INSERT INTO appointments (
         id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
         student_id, student_name, class_name, date, start_time, end_time, status, entry_code, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
                 student_id, student_name, class_name, date, start_time, end_time, status, entry_code, notes, created_at;`,
      [
        id,
        apt.schoolId,
        apt.teacherId,
        apt.teacherName,
        apt.teacherBranch,
        apt.parentId,
        apt.parentName,
        apt.parentPhone,
        apt.studentId || null,
        apt.studentName,
        apt.className,
        apt.date,
        apt.startTime,
        apt.endTime,
        apt.status || 'pending',
        entryCode,
        apt.notes || null,
      ],
      client
    );
    const r = res.rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      teacherBranch: r.teacher_branch,
      parentId: r.parent_id,
      parentName: r.parent_name,
      parentPhone: r.parent_phone,
      studentId: r.student_id || undefined,
      studentName: r.student_name,
      className: r.class_name,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status as AppointmentStatus,
      entryCode: r.entry_code,
      notes: r.notes || undefined,
      createdAt: r.created_at,
    };
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
           check_in_time = COALESCE($3, check_in_time),
           check_out_time = COALESCE($4, check_out_time),
           updated_at = NOW()
       WHERE school_id = $5 AND id = $6
       RETURNING id, school_id, teacher_id, teacher_name, teacher_branch, parent_id, parent_name, parent_phone,
                 student_id, student_name, class_name, date, start_time, end_time, status, entry_code,
                 notes, rejection_reason, check_in_time, check_out_time, created_at;`,
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
      teacherName: r.teacher_name,
      teacherBranch: r.teacher_branch,
      parentId: r.parent_id,
      parentName: r.parent_name,
      parentPhone: r.parent_phone,
      studentId: r.student_id || undefined,
      studentName: r.student_name,
      className: r.class_name,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      status: r.status as AppointmentStatus,
      entryCode: r.entry_code,
      notes: r.notes || undefined,
      rejectionReason: r.rejection_reason || undefined,
      checkedInAt: r.check_in_time || undefined,
      checkedOutAt: r.check_out_time || undefined,
      createdAt: r.created_at,
    };
  },
};

// ==============================================================================
// 10. NOTIFICATION REPOSITORY (Tenant & User Scoped)
// ==============================================================================
export const notificationRepository = {
  async getNotifications(schoolId: string, userId: string): Promise<NotificationItem[]> {
    const res = await execQuery<any>(
      `SELECT id, school_id, user_id, title, message, date, read, appointment_id, created_at
       FROM notifications
       WHERE school_id = $1 AND user_id = $2
       ORDER BY created_at DESC;`,
      [schoolId, userId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      userId: r.user_id,
      title: r.title,
      message: r.message,
      date: r.date,
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
    const dateStr = notif.date || 'Şimdi';

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
      timestamp: r.timestamp,
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
      new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

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
      purpose: 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET';
      codeHash: string;
      createdBy: string;
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
         target_user_id, code_hash, created_by, attempts
       ) VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8, $9, 0)
       RETURNING id, expires_at;`,
      [id, data.schoolId, data.token, data.expiresAt, data.purpose, cleanPhone, data.targetUserId || null, data.codeHash, data.createdBy],
      client
    );
    return { id: res.rows[0].id, expiresAt: res.rows[0].expires_at };
  },

  async consumeAuthCode(
    data: {
      schoolId: string;
      targetPhone: string;
      targetUserId?: string;
      purpose: 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET';
      codeHash: string;
    },
    client?: TransactionClient
  ): Promise<{ id: string } | null> {
    const cleanPhone = normalizeTurkishPhone(data.targetPhone);
    if (!cleanPhone) return null;
    const res = await execQuery<any>(
      `UPDATE invitations SET consumed_at = NOW(), is_active = FALSE
       WHERE school_id = $1 AND target_phone = $2 AND purpose = $3 AND code_hash = $4
         AND is_active = TRUE AND consumed_at IS NULL AND revoked_at IS NULL
         AND attempts < 5 AND expires_at > NOW()
         AND (target_user_id IS NULL OR target_user_id = $5)
       RETURNING id;`,
      [data.schoolId, cleanPhone, data.purpose, data.codeHash, data.targetUserId || null],
      client
    );
    return res.rows[0] ? { id: res.rows[0].id } : null;
  },

  async recordFailedAuthCodeAttempt(
    schoolId: string,
    targetPhone: string,
    purpose: 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET',
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
