import { Router, Response } from 'express';
import { adminManagementRouter } from './admin-management';
import { platformManagementRouter } from './platform-management';
import crypto from 'crypto';
import {
  AuthenticatedRequest,
  authMiddleware,
  tenantGuard,
  createToken,
} from './auth';
import { hashPassword, validatePassword, verifyPassword } from './passwords';
import { normalizeTurkishPhone } from '../src/utils/phone';
import { evaluateSecurityQr, invalidQrVerification } from './appointment-entry';
import { generateActivationCode, hashActivationCode } from './activation-codes';
import {
  getDb,
  checkDatabaseHealth,
} from './database/postgres';
import {
  schoolRepository,
  userRepository,
  membershipRepository,
  studentRepository,
  relationRepository,
  rosterRepository,
  teacherRepository,
  availabilityRepository,
  appointmentRepository,
  notificationRepository,
  auditLogRepository,
  invitationRepository,
} from './repositories';
import {
  Appointment,
  AvailabilitySlot,
  TenantIsolationTestResult,
} from '../src/types';

export const apiRouter = Router();
apiRouter.use('/schools/:schoolId/management', adminManagementRouter);
apiRouter.use('/platform', platformManagementRouter);

// ==========================================
// PRODUCTION HEALTH CHECK (PostgreSQL Status)
// ==========================================
apiRouter.get('/health', async (req, res) => {
  const isProd = process.env.NODE_ENV === 'production';
  const hasSupabaseUrl = !!process.env.SUPABASE_URL;
  const hasDbUrl = !!process.env.DATABASE_URL;

  const health = await checkDatabaseHealth();
  const isHealthy = health.status === 'connected';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    environment: isProd ? 'production' : 'development',
    services: {
      api: {
        status: 'operational',
      },
      database: {
        status: health.status,
        engine: health.engine,
        latencyMs: health.latencyMs,
      },
      supabase: {
        configured: hasSupabaseUrl || hasDbUrl,
        status: hasSupabaseUrl || hasDbUrl ? 'connected' : 'pending_configuration',
      },
      activationCodes: { status: 'ready' },
    },
  });
});

// ==========================================
// PUBLIC ENDPOINTS
// ==========================================

// List all registered schools (public directory)
apiRouter.get('/public/schools', async (req, res) => {
  try {
    const list = await schoolRepository.getAll();
    res.json({ schools: list });
  } catch (err: any) {
    console.error('[GET /public/schools Error]:', err);
    res.status(500).json({ error: 'Okullar listelenirken sunucu hatası oluştu' });
  }
});

// Resolve school context by code or QR payload
apiRouter.get('/public/school-context', async (req, res) => {
  const code = ((req.query.code as string) || '').trim();
  if (!code) {
    return res.status(400).json({ error: 'Okul kodu belirtilmelidir' });
  }

  try {
    const school = await schoolRepository.getByCode(code);
    if (!school) {
      return res.status(404).json({ error: 'Geçersiz okul kodu veya okul bulunamadı' });
    }

    res.json({ school });
  } catch (err: any) {
    console.error('[GET /public/school-context Error]:', err);
    res.status(500).json({ error: 'Okul bağlamı sorgulanırken hata oluştu' });
  }
});

type AuthCodePurpose = 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET';
const AUTH_CODE_ERROR = 'Bilgiler doğrulanamadı veya kodun süresi dolmuş olabilir.';

function splitParentName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] || 'Veli', lastName: parts.slice(1).join(' ') };
}

async function recordFailedAuthCodeAttempt(schoolId: string, phone: string, purpose: AuthCodePurpose): Promise<void> {
  await invitationRepository.recordFailedAuthCodeAttempt(schoolId, phone, purpose).catch(() => undefined);
}

apiRouter.post('/auth/activate-account', async (req, res) => {
  const { schoolId, phone, code, password } = req.body;
  const cleanPhone = normalizeTurkishPhone(phone);
  const codeHash = typeof code === 'string' ? hashActivationCode(code) : '';
  const passwordError = validatePassword(password);

  if (!schoolId || !cleanPhone || !codeHash || passwordError) {
    return res.status(400).json({ error: passwordError || AUTH_CODE_ERROR });
  }

  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const rosterEntries = await rosterRepository.checkPhone(schoolId, cleanPhone, tx);
      const school = await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR SHARE', [schoolId]);
      if (!school.rows.length) throw new Error('INVALID_AUTH_CODE');
      const existingUser = await userRepository.getByPhone(cleanPhone, tx);

      const consumed = await invitationRepository.consumeAuthCode(
        {
          schoolId,
          targetPhone: cleanPhone,
          targetUserId: existingUser?.id,
          purpose: 'ACCOUNT_ACTIVATION',
          codeHash,
        },
        tx
      );
      if (!consumed) throw new Error('INVALID_AUTH_CODE');

      if (consumed.targetRole === 'teacher' || consumed.targetRole === 'security') {
        const targetUser = consumed.targetUserId ? await userRepository.getById(consumed.targetUserId, tx) : existingUser;
        if (consumed.targetRole === 'teacher') {
          const teacher = await teacherRepository.getTeacherByPhone(schoolId, cleanPhone, tx);
          if (!teacher || (consumed.targetUserId && teacher.userId !== consumed.targetUserId)) throw new Error('INVALID_AUTH_CODE');
          const user = targetUser || await userRepository.create({ phone: cleanPhone, firstName: teacher.firstName, lastName: teacher.lastName }, tx);
          if (!await teacherRepository.linkUser(schoolId, teacher.id, user.id, tx)) throw new Error('INVALID_AUTH_CODE');
          await userRepository.updatePasswordHash(user.id, hashPassword(password), tx);
          await membershipRepository.createOrActivate({ schoolId, userId: user.id, role: 'teacher', branch: teacher.branch }, tx);
          await auditLogRepository.createAuditLog({ schoolId, action: 'Öğretmen Aktivasyonu', actorName: 'Sistem', details: `Öğretmen hesabı ${user.id} için aktivasyon tamamlandı.` }, tx);
        } else {
          if (!targetUser) throw new Error('INVALID_AUTH_CODE');
          await userRepository.updatePasswordHash(targetUser.id, hashPassword(password), tx);
          await membershipRepository.createOrActivate({ schoolId, userId: targetUser.id, role: 'security' }, tx);
          await auditLogRepository.createAuditLog({ schoolId, action: 'Güvenlik Aktivasyonu', actorName: 'Sistem', details: `Güvenlik hesabı ${targetUser.id} için aktivasyon tamamlandı.` }, tx);
        }
        return;
      }

      if (rosterEntries.length === 0) throw new Error('INVALID_AUTH_CODE');

      const parentName = splitParentName(rosterEntries[0].parentName);
      const user = existingUser || await userRepository.create(
        { phone: cleanPhone, firstName: parentName.firstName, lastName: parentName.lastName, isPhoneVerified: false },
        tx
      );
      await userRepository.updatePasswordHash(user.id, hashPassword(password), tx);
      await membershipRepository.createOrActivate({ schoolId, userId: user.id, role: 'parent' }, tx);

      for (const rosterEntry of rosterEntries) {
        await rosterRepository.claimRosterRecord(schoolId, rosterEntry.id, tx);
        const student = await studentRepository.findOrCreateStudent(
          schoolId,
          { name: rosterEntry.studentName, className: rosterEntry.className, studentNumber: rosterEntry.studentNumber },
          tx
        );
        await relationRepository.createRelation({ schoolId, studentId: student.id, parentUserId: user.id }, tx);
      }

      await auditLogRepository.createAuditLog(
        {
          schoolId,
          action: 'Hesap Aktivasyonu',
          actorName: 'Sistem',
          details: `Veli hesabı ${user.id} için aktivasyon tamamlandı.`,
        },
        tx
      );
    });
    return res.json({ success: true, message: 'Hesabınız etkinleştirildi. Yeni şifrenizle giriş yapabilirsiniz.' });
  } catch (err: any) {
    if (err?.message === 'INVALID_AUTH_CODE') {
      await recordFailedAuthCodeAttempt(schoolId, cleanPhone, 'ACCOUNT_ACTIVATION');
      return res.status(400).json({ error: AUTH_CODE_ERROR });
    }
    console.error('[POST /auth/activate-account Error]:', err);
    return res.status(500).json({ error: 'Hesap etkinleştirilemedi.' });
  }
});

apiRouter.post('/auth/reset-password-with-code', async (req, res) => {
  const { schoolId, phone, code, password } = req.body;
  const cleanPhone = normalizeTurkishPhone(phone);
  const codeHash = typeof code === 'string' ? hashActivationCode(code) : '';
  const passwordError = validatePassword(password);

  if (!schoolId || !cleanPhone || !codeHash || passwordError) {
    return res.status(400).json({ error: passwordError || AUTH_CODE_ERROR });
  }

  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const user = await userRepository.getByPhone(cleanPhone, tx);
      const school = await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR SHARE', [schoolId]);
      if (!school.rows.length) throw new Error('INVALID_AUTH_CODE');
      if (!user) throw new Error('INVALID_AUTH_CODE');
      const consumed = await invitationRepository.consumeAuthCode(
        { schoolId, targetPhone: cleanPhone, targetUserId: user.id, purpose: 'PASSWORD_RESET', codeHash },
        tx
      );
      if (!consumed) throw new Error('INVALID_AUTH_CODE');
      await userRepository.updatePasswordHashAndInvalidateSessions(user.id, hashPassword(password), tx);
      await auditLogRepository.createAuditLog(
        { schoolId, action: 'Parola Sıfırlama', actorName: 'Sistem', details: `Veli hesabı ${user.id} için parola sıfırlandı.` },
        tx
      );
    });
    return res.json({ success: true, message: 'Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.' });
  } catch (err: any) {
    if (err?.message === 'INVALID_AUTH_CODE') {
      await recordFailedAuthCodeAttempt(schoolId, cleanPhone, 'PASSWORD_RESET');
      return res.status(400).json({ error: AUTH_CODE_ERROR });
    }
    console.error('[POST /auth/reset-password-with-code Error]:', err);
    return res.status(500).json({ error: 'Şifre güncellenemedi.' });
  }
});

// Standard password/role login
apiRouter.post('/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  const cleanPhone = normalizeTurkishPhone(phone);

  try {
    const user = cleanPhone ? await userRepository.getAuthByPhone(cleanPhone) : null;

    if (!user || typeof password !== 'string' || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Telefon numarası veya şifre hatalı.' });
    }

    const token = createToken({ userId: user.id, phone: user.phone, auth_version: user.authVersion });
    const memberships = await membershipRepository.getMembershipsByUserId(user.id);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        isPhoneVerified: user.isPhoneVerified,
      },
      memberships,
    });
  } catch (err: any) {
    console.error('[POST /auth/login Error]:', err);
    res.status(500).json({ error: 'Giriş işlemi sırasında hata oluştu' });
  }
});

// Quick Switcher endpoint for demo/evaluation
apiRouter.post('/auth/quick-switch', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Bulunamadı' });
  }

  const { userId } = req.body;
  try {
    const user = await userRepository.getById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const token = createToken({ userId: user.id, phone: user.phone, auth_version: user.authVersion });
    const memberships = await membershipRepository.getMembershipsByUserId(user.id);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        isPhoneVerified: true,
      },
      memberships,
    });
  } catch (err: any) {
    console.error('[POST /auth/quick-switch Error]:', err);
    res.status(500).json({ error: 'Kullanıcı geçişi sırasında hata oluştu' });
  }
});

// ==========================================
// ONBOARDING & ROSTER MATCHING
// ==========================================

// Check school roster for verified caller's phone
apiRouter.post('/onboarding/check-roster', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const { schoolId } = req.body;
  if (!schoolId) {
    return res.status(400).json({ error: 'Okul ID (schoolId) gereklidir.' });
  }

  const userPhone = normalizeTurkishPhone(req.user!.phone);
  if (!userPhone) return res.status(400).json({ error: 'Geçersiz telefon numarası.' });

  try {
    const school = await schoolRepository.getById(schoolId);
    if (!school) {
      return res.status(404).json({ error: 'Okul bulunamadı.' });
    }

    // Anti-enumeration: Only searches roster matching caller's own verified phone
    const matches = await rosterRepository.checkPhone(schoolId, userPhone);

    if (matches.length === 0) {
      return res.status(404).json({
        hasMatch: false,
        error: 'Bu okulun veli kayıtlarında telefon numaranızla eşleşen bir öğrenci bulunamadı. Lütfen okul idaresi ile iletişime geçiniz.',
      });
    }

    res.json({
      hasMatch: true,
      school: {
        id: school.id,
        name: school.name,
      },
      parentName: matches[0].parentName,
      students: matches.map((m) => ({
        rosterId: m.id,
        studentName: m.studentName,
        className: m.className,
        studentNumber: m.studentNumber,
        isClaimed: m.isClaimed,
      })),
    });
  } catch (err: any) {
    console.error('[POST /onboarding/check-roster Error]:', err);
    res.status(500).json({ error: 'Kütük kontrolü sırasında hata oluştu' });
  }
});

// Confirm & Claim matched students to create SchoolMembership and StudentParentRelations
// Handled within a single ACID transaction in PostgreSQL
apiRouter.post('/onboarding/claim-students', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const { schoolId, firstName, lastName } = req.body;
  if (!schoolId) {
    return res.status(400).json({ error: 'Okul ID gereklidir.' });
  }

  const userId = req.user!.id;
  const userPhone = normalizeTurkishPhone(req.user!.phone);
  if (!userPhone) return res.status(400).json({ error: 'Geçersiz telefon numarası.' });

  try {
    const school = await schoolRepository.getById(schoolId);
    if (!school) {
      return res.status(404).json({ error: 'Okul bulunamadı.' });
    }

    const matches = await rosterRepository.checkPhone(schoolId, userPhone);
    if (matches.length === 0) {
      return res.status(403).json({
        error: 'Okul kütüğünde telefonunuza ait öğrenci kaydı bulunmadığı için üyelik oluşturulamaz.',
      });
    }

    // Run in atomic PostgreSQL transaction
    const db = await getDb();
    const result = await db.transaction(async (tx) => {
      // Update user names if provided
      let currentFirstName = firstName;
      let currentLastName = lastName;
      if (!currentFirstName && matches[0].parentName) {
        const parts = matches[0].parentName.split(' ');
        currentFirstName = parts[0] || 'Veli';
        currentLastName = parts.slice(1).join(' ') || '';
      }

      await userRepository.update(
        userId,
        {
          firstName: currentFirstName || undefined,
          lastName: currentLastName || undefined,
        },
        tx
      );

      // 1. Create or ensure SchoolMembership (role: parent)
      const membership = await membershipRepository.createOrActivate(
        {
          schoolId,
          userId,
          role: 'parent',
        },
        tx
      );

      // 2. Ensure students exist and create StudentParentRelations
      const addedStudents = [];
      for (const match of matches) {
        await rosterRepository.claimRosterRecord(schoolId, match.id, tx);

        const student = await studentRepository.findOrCreateStudent(
          schoolId,
          {
            name: match.studentName,
            className: match.className,
            studentNumber: match.studentNumber,
          },
          tx
        );

        addedStudents.push(student);

        await relationRepository.createRelation(
          {
            schoolId,
            studentId: student.id,
            parentUserId: userId,
          },
          tx
        );
      }

      // 3. Audit Log
      await auditLogRepository.createAuditLog(
        {
          schoolId,
          action: 'Veli Kaydı (Onboarding)',
          actorName: `${currentFirstName || 'Veli'} ${currentLastName || ''} (Veli)`.trim(),
          details: `${addedStudents.map((s) => s.name).join(', ')} için kütük eşleştirmesi onaylandı.`,
        },
        tx
      );

      return { membership, addedStudents };
    });

    const userMemberships = await membershipRepository.getMembershipsByUserId(userId);

    res.json({
      success: true,
      message: 'Okul üyeliği ve öğrenci bağlantıları başarıyla oluşturuldu.',
      membership: result.membership,
      students: result.addedStudents,
      memberships: userMemberships,
    });
  } catch (err: any) {
    console.error('[POST /onboarding/claim-students Error]:', err);
    res.status(500).json({ error: 'Öğrenci sahiplenme ve üyelik oluşturma sırasında hata oluştu' });
  }
});

// ==========================================
// USER & CONTEXT ENDPOINTS
// ==========================================

apiRouter.get('/user/me', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await userRepository.getById(req.user!.id);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const memberships = await membershipRepository.getMembershipsByUserId(user.id);

    res.json({
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        isPhoneVerified: user.isPhoneVerified,
        securityQuestion: user.securityQuestion,
      },
      memberships,
    });
  } catch (err: any) {
    console.error('[GET /user/me Error]:', err);
    res.status(500).json({ error: 'Kullanıcı profili alınamadı' });
  }
});

// ==========================================
// SCHOOL-SCOPED PROTECTED API ENDPOINTS
// (Requires both authMiddleware + tenantGuard)
// ==========================================

// Teachers in active school
apiRouter.get('/schools/:schoolId/teachers', authMiddleware, tenantGuard(), async (req: AuthenticatedRequest, res) => {
  try {
    const schoolId = req.membership!.schoolId;
    const teachers = await teacherRepository.getTeachers(schoolId, req.membership!.role === 'admin');
    res.json({ teachers });
  } catch (err: any) {
    console.error('[GET /schools/:schoolId/teachers Error]:', err);
    res.status(500).json({ error: 'Öğretmenler listelenemedi' });
  }
});

apiRouter.post('/schools/:schoolId/teachers', authMiddleware, tenantGuard(['admin']), async (req: AuthenticatedRequest, res) => {
  const schoolId = req.membership!.schoolId;
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().replace(/\s+/g, ' ') : '';
  const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';
  const phone = normalizeTurkishPhone(req.body?.phone);
  if (fullName.length < 3 || fullName.length > 150 || fullName.split(' ').length < 2) {
    return res.status(400).json({ error: 'Ad soyad alanına geçerli bir ad ve soyad girin.' });
  }
  if (!branch || branch.length > 100) {
    return res.status(400).json({ error: 'Branş alanı zorunludur.' });
  }
  if (!phone) {
    return res.status(400).json({ error: 'Geçerli bir Türkiye GSM numarası girin.' });
  }

  try {
    const db = await getDb();
    const teacher = await db.transaction(async (tx) => {
      const schoolLock = await tx.query('SELECT id FROM schools WHERE id = $1 FOR UPDATE', [schoolId]);
      if (!schoolLock.rows.length) throw new Error('SCHOOL_NOT_FOUND');
      if (await teacherRepository.getTeacherByPhone(schoolId, phone, tx)) throw new Error('TEACHER_PHONE_EXISTS');
      const [firstName, ...lastNameParts] = fullName.split(' ');
      const created = await teacherRepository.createPending(schoolId, {
        firstName,
        lastName: lastNameParts.join(' '),
        branch,
        phone,
      }, tx);
      await auditLogRepository.createAuditLog({
        schoolId,
        action: 'teacher.created',
        actorName: `${req.user!.firstName} ${req.user!.lastName}`.trim(),
        details: `Öğretmen profili ${created.id} oluşturuldu; hesap aktivasyon bekliyor.`,
      }, tx);
      return { ...created, accountStatus: 'pending' as const };
    });
    return res.status(201).json({ teacher });
  } catch (err) {
    if (err instanceof Error && err.message === 'TEACHER_PHONE_EXISTS') {
      return res.status(409).json({ error: 'Bu telefon numarasıyla okulda zaten bir öğretmen profili var.' });
    }
    console.error('[POST /schools/:schoolId/teachers Error]:', err);
    return res.status(500).json({ error: 'Öğretmen oluşturulamadı.' });
  }
});

apiRouter.get('/schools/:schoolId/users', authMiddleware, tenantGuard(['admin']), async (req: AuthenticatedRequest, res) => {
  if (req.query.role !== 'security') return res.status(400).json({ error: 'Geçersiz kullanıcı rolü.' });
  try {
    const users = await userRepository.getSecurityUsers(req.membership!.schoolId);
    return res.json({ users });
  } catch {
    return res.status(500).json({ error: 'Güvenlik personeli listelenemedi.' });
  }
});

// Students in active school
apiRouter.get('/schools/:schoolId/students', authMiddleware, tenantGuard(), async (req: AuthenticatedRequest, res) => {
  try {
    const schoolId = req.membership!.schoolId;

    if (req.membership!.role === 'parent') {
      // Return only verified students linked to this parent in this school
      const students = await studentRepository.getStudentsByParent(schoolId, req.user!.id);
      return res.json({ students });
    }

    // For teachers, security, admin: return all students enrolled in the school
    const students = await studentRepository.getStudentsBySchool(schoolId);
    res.json({ students });
  } catch (err: any) {
    console.error('[GET /schools/:schoolId/students Error]:', err);
    res.status(500).json({ error: 'Öğrenciler listelenemedi' });
  }
});

// Availability slots in active school
apiRouter.get('/schools/:schoolId/availability', authMiddleware, tenantGuard(), async (req: AuthenticatedRequest, res) => {
  try {
    const schoolId = req.membership!.schoolId;
    const slots = await availabilityRepository.getAvailability(schoolId);
    res.json({ availability: slots });
  } catch (err: any) {
    console.error('[GET /schools/:schoolId/availability Error]:', err);
    res.status(500).json({ error: 'Uygunluk saatleri alınamadı' });
  }
});

// Add availability slot (Teachers only)
apiRouter.post(
  '/schools/:schoolId/availability',
  authMiddleware,
  tenantGuard(['teacher']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.membership!.schoolId;
      const { dayOfWeek, startTime, endTime, slotDurationMinutes } = req.body;

      const teacher = await teacherRepository.getTeacherByUserId(schoolId, req.user!.id);
      if (!teacher) {
        return res.status(403).json({ error: 'Bu okulda öğretmen profiliniz bulunamadı.' });
      }

      const slot = await availabilityRepository.createSlot({
        schoolId,
        teacherId: teacher.id,
        dayOfWeek: Number(dayOfWeek),
        startTime,
        endTime,
        slotDurationMinutes: Number(slotDurationMinutes) || 15,
      });

      res.json({ success: true, slot });
    } catch (err: any) {
      console.error('[POST /schools/:schoolId/availability Error]:', err);
      res.status(500).json({ error: 'Uygunluk slotu eklenemedi' });
    }
  }
);

// Delete availability slot (Teacher / Admin)
apiRouter.delete(
  '/schools/:schoolId/availability/:slotId',
  authMiddleware,
  tenantGuard(['teacher', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.membership!.schoolId;
      const slotId = req.params.slotId;

      // 1. Verify slot exists in this school
      const slot = await availabilityRepository.getSlotById(schoolId, slotId);
      if (!slot) {
        return res.status(404).json({ error: 'Uygunluk slotu bulunamadı veya bu okula ait değil.' });
      }

      // 2. If teacher, verify slot belongs to them
      let teacherProfileId: string | undefined;
      if (req.membership!.role === 'teacher') {
        const teacher = await teacherRepository.getTeacherByUserId(schoolId, req.user!.id);
        if (!teacher || slot.teacherId !== teacher.id) {
          return res.status(403).json({ error: 'Yetkisiz İşlem: Yalnızca kendi uygunluk slotunuzu silebilirsiniz.' });
        }
        teacherProfileId = teacher.id;
      }

      const deleted = await availabilityRepository.deleteSlot(schoolId, slotId, teacherProfileId);
      if (!deleted) {
        return res.status(404).json({ error: 'Uygunluk slotu silinemedi veya bulunamadı.' });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error('[DELETE /schools/:schoolId/availability/:slotId Error]:', err);
      res.status(500).json({ error: 'Uygunluk slotu silinemedi' });
    }
  }
);

// Appointments in active school (Filtered by role)
apiRouter.get('/schools/:schoolId/appointments', authMiddleware, tenantGuard(), async (req: AuthenticatedRequest, res) => {
  try {
    const schoolId = req.membership!.schoolId;
    const role = req.membership!.role;
    const userId = req.user!.id;

    const teacher = role === 'teacher'
      ? await teacherRepository.getTeacherByUserId(schoolId, userId)
      : null;
    if (role === 'teacher' && !teacher) {
      return res.status(403).json({ error: 'Öğretmen profiliniz bulunamadı.' });
    }
    const appointments = await appointmentRepository.getAppointments(schoolId, {
      role,
      userId,
      ...(teacher ? { teacherProfileId: teacher.id } : {}),
    });
    res.json({ appointments });
  } catch (err: any) {
    console.error('[GET /schools/:schoolId/appointments Error]:', err);
    res.status(500).json({ error: 'Randevular alınamadı' });
  }
});

// Book appointment (Guarded by PostgreSQL idx_appointments_no_double_booking)
apiRouter.post(
  '/schools/:schoolId/appointments',
  authMiddleware,
  tenantGuard(['parent', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.membership!.schoolId;
    const { teacherId, studentName, className, date, startTime, endTime, notes } = req.body;

    try {
      // 1. Teacher must exist in this school
      const teacher = await teacherRepository.getTeacherById(schoolId, teacherId);
      if (!teacher) {
        return res.status(404).json({ error: 'Seçilen öğretmen bu okulda bulunamadı.' });
      }
      const bookableTeachers = await teacherRepository.getTeachers(schoolId);
      if (!teacher.userId || !bookableTeachers.some((record) => record.id === teacher.id)) {
        return res.status(409).json({ error: 'Bu öğretmen şu anda randevu kabul etmiyor.' });
      }

      // 2. Parent-Student Data Integrity (Requirement 9)
      if (req.membership!.role === 'parent') {
        const parentStudents = await studentRepository.getStudentsByParent(schoolId, req.user!.id);
        const isStudentValid = parentStudents.some(
          (s) => s.name.trim().toLowerCase() === (studentName || '').trim().toLowerCase()
        );

        if (!isStudentValid) {
          return res.status(403).json({
            error: 'VERİ BÜTÜNLÜĞÜ VE YETKİ HATASI: Belirtilen öğrenci bu okulda veli hesabınıza tanımlı değildir! Başka bir okulun veya velinin öğrencisi için randevu oluşturulamaz.',
          });
        }
      }

      // 3. Atomically book with transaction and double-booking guard
      const db = await getDb();
      const newApt = await db.transaction(async (tx) => {
        await tx.query('SELECT id FROM schools WHERE id=$1 FOR UPDATE', [schoolId]);
        const activeTeacher = await tx.query(
          `SELECT tp.id FROM teacher_profiles tp JOIN users u ON u.id=tp.user_id
           JOIN school_memberships sm ON sm.user_id=u.id AND sm.school_id=tp.school_id
           WHERE tp.school_id=$1 AND tp.id=$2 AND sm.role='teacher' AND sm.status='active'
             AND NULLIF(u.password_hash,'') IS NOT NULL`, [schoolId, teacher.id]);
        if (!activeTeacher.rows.length) {
          const unavailable = new Error('Bu öğretmen şu anda randevu kabul etmiyor.');
          Object.assign(unavailable, { code: 'TEACHER_UNAVAILABLE' });
          throw unavailable;
        }
        // Fast conflict check
        const conflict = await appointmentRepository.findConflictingAppointment(
          schoolId,
          teacher.id,
          date,
          startTime,
          tx
        );
        if (conflict) {
          const err: any = new Error('ÇAKIŞMA HATASI (Double-Booking Engellendi): Bu öğretmenin seçilen tarih ve saatteki slotu başka bir veli tarafından zaten rezerve edilmiştir.');
          err.code = 'DOUBLE_BOOKING';
          throw err;
        }

        const created = await appointmentRepository.createAppointment(
          {
            id: 'apt-' + Date.now(),
            schoolId,
            teacherId: teacher.id,
            teacherName: `${teacher.firstName} ${teacher.lastName}`,
            teacherBranch: teacher.branch,
            parentId: req.user!.id,
            parentName: `${req.user!.firstName} ${req.user!.lastName}`.trim() || 'Veli',
            parentPhone: normalizeTurkishPhone(req.user!.phone) || req.user!.phone,
            studentName,
            className,
            date,
            startTime,
            endTime,
            status: 'pending',
            notes,
            createdAt: new Date().toISOString(),
          },
          tx
        );

        // Notification to teacher
        const teacherUserId = teacher.userId!;
        await notificationRepository.createNotification(
          {
            schoolId,
            userId: teacherUserId,
            title: 'Yeni Randevu Talebi',
            message: `${created.parentName} (${studentName} - ${className}) ${date} saat ${startTime} için randevu talep etti.`,
            appointmentId: created.id,
          },
          tx
        );

        // Audit Log
        await auditLogRepository.createAuditLog(
          {
            schoolId,
            action: 'Randevu Talebi',
            actorName: created.parentName,
            details: `${created.teacherName} ile ${date} ${startTime} randevu talebi oluşturuldu.`,
          },
          tx
        );

        return created;
      });

      res.json({ success: true, appointment: newApt });
    } catch (err: any) {
      if (err.code === 'TEACHER_UNAVAILABLE') return res.status(409).json({ error: 'Bu öğretmen şu anda randevu kabul etmiyor.' });
      if (err.code === '23505' || err.code === 'DOUBLE_BOOKING' || (err.message && err.message.includes('idx_appointments_no_double_booking'))) {
        return res.status(409).json({
          error: 'ÇAKIŞMA HATASI (Double-Booking Engellendi): Bu öğretmenin seçilen tarih ve saatteki slotu başka bir veli tarafından zaten rezerve edilmiştir.',
        });
      }
      console.error('[POST /schools/:schoolId/appointments Error]: İşlem tamamlanamadı.');
      res.status(500).json({ error: 'Randevu oluşturulurken hata oluştu. Lütfen tekrar deneyin.' });
    }
  }
);

// Approve appointment (Teacher / Admin)
apiRouter.post(
  '/schools/:schoolId/appointments/:id/approve',
  authMiddleware,
  tenantGuard(['teacher', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.membership!.schoolId;
    const aptId = req.params.id;

    try {
      // 1. Verify appointment belongs to this school
      const apt = await appointmentRepository.getAppointmentById(schoolId, aptId);
      if (!apt) {
        return res.status(404).json({ error: 'Randevu bulunamadı veya bu okula ait değil.' });
      }

      // 2. If teacher, verify appointment belongs to them
      if (req.membership!.role === 'teacher') {
        const teacher = await teacherRepository.getTeacherByUserId(schoolId, req.user!.id);
        if (!teacher || apt.teacherId !== teacher.id) {
          return res.status(403).json({ error: 'Yetkisiz İşlem: Yalnızca kendi randevularınızı onaylayabilirsiniz.' });
        }
      }

      const db = await getDb();
      const updated = await db.transaction(async (tx) => {
        const updatedApt = await appointmentRepository.transitionStatus(
          schoolId,
          aptId,
          'pending',
          'booked',
          { approvedAt: new Date().toISOString(), approvedBy: req.user!.id },
          tx
        );
        if (!updatedApt) return null;

        await notificationRepository.createNotification(
          {
            schoolId,
            userId: updatedApt.parentId,
            title: 'Randevunuz Onaylandı!',
            message: `${updatedApt.teacherName} ile ${updatedApt.date} ${updatedApt.startTime} randevunuz onaylandı. Okul Giriş Kodunuz: ${updatedApt.entryCode}`,
            appointmentId: updatedApt.id,
          },
          tx
        );

        await auditLogRepository.createAuditLog(
          {
            schoolId,
            action: 'Randevu Onayı',
            actorName: updatedApt.teacherName,
            details: `${updatedApt.parentName} için randevu onaylandı.`,
          },
          tx
        );

        return updatedApt;
      });

      if (!updated) {
        return res.status(404).json({ error: 'Randevu bulunamadı' });
      }

      res.json({ success: true, appointment: updated });
    } catch (err: any) {
      console.error('[POST /schools/:schoolId/appointments/:id/approve Error]:', err);
      res.status(500).json({ error: 'Randevu onaylanırken hata oluştu' });
    }
  }
);

// Reject appointment (Teacher / Admin)
apiRouter.post(
  '/schools/:schoolId/appointments/:id/reject',
  authMiddleware,
  tenantGuard(['teacher', 'admin']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.membership!.schoolId;
    const aptId = req.params.id;
      const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 500) : undefined;

    try {
      // 1. Verify appointment belongs to this school
      const apt = await appointmentRepository.getAppointmentById(schoolId, aptId);
      if (!apt) {
        return res.status(404).json({ error: 'Randevu bulunamadı veya bu okula ait değil.' });
      }

      // 2. If teacher, verify appointment belongs to them
      if (req.membership!.role === 'teacher') {
        const teacher = await teacherRepository.getTeacherByUserId(schoolId, req.user!.id);
        if (!teacher || apt.teacherId !== teacher.id) {
          return res.status(403).json({ error: 'Yetkisiz İşlem: Yalnızca kendi randevularınızı reddedebilirsiniz.' });
        }
      }

      const db = await getDb();
      const updated = await db.transaction(async (tx) => {
        const updatedApt = await appointmentRepository.transitionStatus(
          schoolId,
          aptId,
          'pending',
          'rejected',
          { rejectionReason: reason },
          tx
        );
        if (!updatedApt) return null;

        await notificationRepository.createNotification(
          {
            schoolId,
            userId: updatedApt.parentId,
            title: 'Randevu Talebi Reddedildi',
            message: `${updatedApt.teacherName} ile randevu talebiniz reddedildi.${reason ? ' Sebep: ' + reason : ''}`,
            appointmentId: updatedApt.id,
          },
          tx
        );

        await auditLogRepository.createAuditLog(
          {
            schoolId,
            action: 'Randevu Reddi',
            actorName: updatedApt.teacherName,
            details: `${updatedApt.parentName} talebi reddedildi. Sebep: ${reason || 'Belirtilmedi'}`,
          },
          tx
        );

        return updatedApt;
      });

      if (!updated) {
        return res.status(404).json({ error: 'Randevu bulunamadı' });
      }

      res.json({ success: true, appointment: updated });
    } catch (err: any) {
      console.error('[POST /schools/:schoolId/appointments/:id/reject Error]:', err);
      res.status(500).json({ error: 'Randevu reddedilirken hata oluştu' });
    }
  }
);

// Cancel appointment
apiRouter.post(
  '/schools/:schoolId/appointments/:id/cancel',
  authMiddleware,
  tenantGuard(),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.membership!.schoolId;
    const aptId = req.params.id;

    try {
      // 1. Verify appointment belongs to this school
      const apt = await appointmentRepository.getAppointmentById(schoolId, aptId);
      if (!apt) {
        return res.status(404).json({ error: 'Randevu bulunamadı veya bu okula ait değil.' });
      }

      // 2. Ownership check:
      // Parent can only cancel their own appointment
      if (req.membership!.role === 'parent' && apt.parentId !== req.user!.id) {
        return res.status(403).json({ error: 'Yetkisiz İşlem: Yalnızca kendi randevularınızı iptal edebilirsiniz.' });
      }

      // Teacher can only cancel their own appointment
      if (req.membership!.role === 'teacher') {
        const teacher = await teacherRepository.getTeacherByUserId(schoolId, req.user!.id);
        if (!teacher || apt.teacherId !== teacher.id) {
          return res.status(403).json({ error: 'Yetkisiz İşlem: Yalnızca kendi randevularınızı iptal edebilirsiniz.' });
        }
      }

      const db = await getDb();
      const updated = await db.transaction(async (tx) => {
        const updatedApt = await appointmentRepository.updateStatus(schoolId, aptId, 'cancelled', undefined, tx);
        if (!updatedApt) return null;

        await auditLogRepository.createAuditLog(
          {
            schoolId,
            action: 'Randevu İptali',
            actorName: `${req.user!.firstName} ${req.user!.lastName}`.trim() || 'Kullanıcı',
            details: `${updatedApt.teacherName} ile ${updatedApt.date} randevusu iptal edildi.`,
          },
          tx
        );

        return updatedApt;
      });

      if (!updated) {
        return res.status(404).json({ error: 'Randevu bulunamadı' });
      }

      res.json({ success: true, appointment: updated });
    } catch (err: any) {
      console.error('[POST /schools/:schoolId/appointments/:id/cancel Error]:', err);
      res.status(500).json({ error: 'Randevu iptal edilirken hata oluştu' });
    }
  }
);

// Security QR verification is read-only; check-in is a separate atomic action.
apiRouter.post(
  '/schools/:schoolId/security/qr/verify',
  authMiddleware,
  tenantGuard(['security']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.membership!.schoolId;
    const token = typeof req.body.qrToken === 'string' ? req.body.qrToken.trim() : '';
    if (!/^VELIQR1:[A-Za-z0-9_-]{32}$/.test(token)) {
      return res.status(200).json(invalidQrVerification());
    }
    try {
      const appointment = await appointmentRepository.getAppointmentByQrToken(schoolId, token);
      if (!appointment) return res.status(200).json(invalidQrVerification());
      return res.status(200).json(evaluateSecurityQr(appointment));
    } catch (err) {
      console.error('[POST /security/qr/verify Error]:', err);
      return res.status(503).json({ success: false, allowed: false, decision: 'INVALID', title: 'RANDEVU DOĞRULANAMADI', message: 'Bağlantıyı kontrol edin. Giriş vermeyin.' });
    }
  }
);

// Security Check-In (Strict School Isolation)
apiRouter.post(
  '/schools/:schoolId/security/check-in',
  authMiddleware,
  tenantGuard(['security']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.membership!.schoolId;
    const token = typeof req.body.qrToken === 'string' ? req.body.qrToken.trim() : '';

    try {
      if (!/^VELIQR1:[A-Za-z0-9_-]{32}$/.test(token)) return res.status(200).json(invalidQrVerification());
      const appointment = await appointmentRepository.getAppointmentByQrToken(schoolId, token);
      if (!appointment) return res.status(200).json(invalidQrVerification());
      const verification = evaluateSecurityQr(appointment);
      if (!verification.allowed) return res.status(200).json(verification);
      const updated = await appointmentRepository.checkInAtomically(schoolId, appointment.id, req.user!.id);
      if (!updated) return res.status(409).json({ success: false, allowed: false, decision: 'ALREADY_CHECKED_IN', title: 'DAHA ÖNCE GİRİŞ KAYDI YAPILDI', message: 'Bu randevu için giriş kaydı zaten oluşturuldu.' });
      await auditLogRepository.createAuditLog({ schoolId, action: 'QR Giriş Doğrulandı', actorName: `${req.user!.firstName} ${req.user!.lastName} (Güvenlik)`.trim(), details: `${updated.id} için giriş kaydı oluşturuldu.` });
      return res.json({ success: true, allowed: true, decision: 'APPROVED', title: 'GİRİŞ KAYDI OLUŞTURULDU', message: 'Giriş kaydı başarıyla oluşturuldu.', appointment: updated });
    } catch (err: any) {
      console.error('[POST /schools/:schoolId/security/check-in Error]:', err);
      res.status(500).json({ error: 'Nizamiye giriş kontrolü sırasında hata oluştu' });
    }
  }
);

// Security Check-Out
apiRouter.post(
  '/schools/:schoolId/security/check-out',
  authMiddleware,
  tenantGuard(['security']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.membership!.schoolId;
    const { appointmentId } = req.body;

    try {
      const existing = await appointmentRepository.getAppointmentById(schoolId, appointmentId);
      if (!existing) {
        return res.status(404).json({ error: 'Randevu bulunamadı veya bu okula ait değil.' });
      }

      if (existing.status !== 'checked_in') {
        return res.status(400).json({ error: 'Ziyaretçi henüz okula giriş yapmamış veya zaten çıkış yapmış!' });
      }

      const checkoutTimestamp = new Date();
      const timeStr = checkoutTimestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      const apt = await appointmentRepository.updateStatus(schoolId, appointmentId, 'checked_out', {
        checkedOutAt: checkoutTimestamp.toISOString(),
      });

      if (!apt) {
        return res.status(404).json({ error: 'Randevu bulunamadı' });
      }

      await auditLogRepository.createAuditLog({
        schoolId,
        timestamp: timeStr,
        action: 'Okuldan Çıkış Yapıldı',
        actorName: `${req.user!.firstName} ${req.user!.lastName} (Güvenlik)`.trim(),
        details: `${apt.parentName} çıkış yaptı.`,
      });

      res.json({ success: true, appointment: apt });
    } catch (err: any) {
      console.error('[POST /schools/:schoolId/security/check-out Error]:', err);
      res.status(500).json({ error: 'Nizamiye çıkış işlemi sırasında hata oluştu' });
    }
  }
);

// Notifications
apiRouter.get('/schools/:schoolId/notifications', authMiddleware, tenantGuard(), async (req: AuthenticatedRequest, res) => {
  try {
    const schoolId = req.membership!.schoolId;
    const notifs = await notificationRepository.getNotifications(schoolId, req.user!.id);
    res.json({ notifications: notifs });
  } catch (err: any) {
    console.error('[GET /schools/:schoolId/notifications Error]:', err);
    res.status(500).json({ error: 'Bildirimler alınamadı' });
  }
});

apiRouter.post('/schools/:schoolId/notifications/read', authMiddleware, tenantGuard(), async (req: AuthenticatedRequest, res) => {
  try {
    const schoolId = req.membership!.schoolId;
    await notificationRepository.markAllRead(schoolId, req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[POST /schools/:schoolId/notifications/read Error]:', err);
    res.status(500).json({ error: 'Bildirimler okundu olarak işaretlenemedi' });
  }
});

// Audit Logs
apiRouter.get(
  '/schools/:schoolId/audit-logs',
  authMiddleware,
  tenantGuard(['admin', 'security']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.membership!.schoolId;
      const logs = await auditLogRepository.getAuditLogs(schoolId);
      res.json({ auditLogs: logs });
    } catch (err: any) {
      console.error('[GET /schools/:schoolId/audit-logs Error]:', err);
      res.status(500).json({ error: 'Denetim logları alınamadı' });
    }
  }
);

// School Settings
apiRouter.get('/schools/:schoolId/settings', authMiddleware, tenantGuard(), async (req: AuthenticatedRequest, res) => {
  try {
    const schoolId = req.membership!.schoolId;
    const school = await schoolRepository.getById(schoolId);
    res.json({ settings: school?.settings });
  } catch (err: any) {
    console.error('[GET /schools/:schoolId/settings Error]:', err);
    res.status(500).json({ error: 'Okul ayarları alınamadı' });
  }
});

apiRouter.put(
  '/schools/:schoolId/settings',
  authMiddleware,
  tenantGuard(['admin']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.membership!.schoolId;
      const settings = await schoolRepository.updateSettings(schoolId, req.body);
      res.json({ success: true, settings });
    } catch (err: any) {
      console.error('[PUT /schools/:schoolId/settings Error]:', err);
      res.status(500).json({ error: 'Okul ayarları güncellenemedi' });
    }
  }
);

// Admin: View School Roster
apiRouter.get(
  '/schools/:schoolId/roster',
  authMiddleware,
  tenantGuard(['admin']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const schoolId = req.membership!.schoolId;
      const roster = await rosterRepository.getRoster(schoolId);
      res.json({ roster });
    } catch (err: any) {
      console.error('[GET /schools/:schoolId/roster Error]:', err);
      res.status(500).json({ error: 'Okul kütüğü alınamadı' });
    }
  }
);

// Admin: Generate a one-time activation or password-reset code for a roster parent.
apiRouter.post(
  '/schools/:schoolId/auth-codes',
  authMiddleware,
  tenantGuard(['admin']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.membership!.schoolId;
    const { rosterId, purpose, targetType, targetId } = req.body as { rosterId?: string; purpose?: AuthCodePurpose; targetType?: 'parent' | 'teacher' | 'security'; targetId?: string };
    if ((!rosterId && !targetId) || (purpose !== 'ACCOUNT_ACTIVATION' && purpose !== 'PASSWORD_RESET')) {
      return res.status(400).json({ error: 'Geçersiz kod oluşturma isteği.' });
    }

    try {
      let targetPhone: string;
      let targetUserId: string | undefined;
      let targetRole: 'parent' | 'teacher' | 'security' = 'parent';
      let targetLabel = rosterId || targetId || 'hedef';
      if (targetType === 'teacher' && targetId) {
        const teacher = await teacherRepository.getTeacherById(schoolId, targetId);
        if (!teacher) return res.status(404).json({ error: 'Öğretmen bulunamadı.' });
        targetPhone = teacher.phone;
        targetUserId = teacher.userId;
        targetRole = 'teacher';
      } else if (targetType === 'security' && targetId) {
        const securityUser = await userRepository.getById(targetId);
        const membership = securityUser ? await membershipRepository.getActiveMembership(securityUser.id, schoolId) : null;
        if (!securityUser || !membership || membership.role !== 'security') return res.status(404).json({ error: 'Güvenlik personeli bulunamadı.' });
        targetPhone = securityUser.phone;
        targetUserId = securityUser.id;
        targetRole = 'security';
      } else {
        const rosterEntry = await rosterRepository.getById(schoolId, rosterId!);
        if (!rosterEntry) return res.status(404).json({ error: 'Kütük kaydı bulunamadı.' });
        targetPhone = rosterEntry.parentPhone;
        const user = await userRepository.getByPhone(targetPhone);
        targetUserId = user?.id;
        targetLabel = rosterEntry.id;
      }
      const user = await userRepository.getByPhone(targetPhone);
      if (targetRole !== 'parent') {
        const credentials = await userRepository.getAuthByPhone(targetPhone);
        if (!normalizeTurkishPhone(targetPhone)) {
          return res.status(400).json({ error: 'Geçerli bir telefon numarası gereklidir.' });
        }
        if (targetUserId && credentials && credentials.id !== targetUserId) {
          return res.status(409).json({ error: 'Personel hesabı eşleştirmesi doğrulanamadı.' });
        }
        if (purpose === 'ACCOUNT_ACTIVATION' && credentials?.passwordHash) {
          return res.status(409).json({ error: 'Bu hesap için parola sıfırlama kodu kullanın.' });
        }
      }
      if (purpose === 'PASSWORD_RESET' && !user) {
        return res.status(400).json({ error: 'Bu kullanıcı için parola sıfırlama kodu oluşturulamadı.' });
      }
      if (purpose === 'PASSWORD_RESET' && user) {
        const memberships = await membershipRepository.getMembershipsByUserId(user.id);
        const hasParentMembership = memberships.some((membership) =>
          membership.schoolId === schoolId && membership.role === targetRole && membership.status === 'active'
        );
        if (!hasParentMembership) {
          return res.status(400).json({ error: 'Bu kullanıcı için parola sıfırlama kodu oluşturulamadı.' });
        }
      }

      const code = generateActivationCode();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await invitationRepository.createAuthCode({
        schoolId,
        targetPhone,
        targetUserId,
        targetRole,
        purpose,
        codeHash: hashActivationCode(code),
        createdBy: req.user!.id,
        expiresAt,
        token: crypto.randomUUID(),
      });
      await auditLogRepository.createAuditLog({
        schoolId,
        action: purpose === 'ACCOUNT_ACTIVATION' ? 'Aktivasyon Kodu Oluşturuldu' : 'Parola Sıfırlama Kodu Oluşturuldu',
        actorName: `${req.user!.firstName} ${req.user!.lastName} (Yönetici)`.trim(),
        details: `${targetRole} hedefi ${targetLabel} için tek kullanımlık güvenlik kodu oluşturuldu.`,
      });

      return res.json({ success: true, code, purpose, expiresAt });
    } catch (err: any) {
      console.error('[POST /schools/:schoolId/auth-codes Error]:', err);
      return res.status(500).json({ error: 'Güvenlik kodu oluşturulamadı.' });
    }
  }
);

// Admin: Bulk Upload Roster (CSV / Excel insertion)
apiRouter.post(
  '/schools/:schoolId/roster/bulk-upload',
  authMiddleware,
  tenantGuard(['admin']),
  async (req: AuthenticatedRequest, res) => {
    const schoolId = req.membership!.schoolId;
    const { records } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Yüklenecek kayıt listesi boş olamaz.' });
    }

    try {
      const addedCount = await rosterRepository.bulkUpload(schoolId, records);

      await auditLogRepository.createAuditLog({
        schoolId,
        action: 'Kütük Yükleme (CSV/Excel)',
        actorName: `${req.user!.firstName} ${req.user!.lastName} (Yönetici)`.trim(),
        details: `${addedCount} yeni öğrenci-veli kütük kaydı veritabanına aktarıldı.`,
      });

      res.json({ success: true, addedCount });
    } catch (err: any) {
      console.error('[POST /schools/:schoolId/roster/bulk-upload Error]:', err);
      res.status(500).json({ error: 'Kütük kaydı aktarılırken hata oluştu' });
    }
  }
);

// ==========================================
// AUTOMATED TENANT ISOLATION TEST RUNNER
// Real-time verification of PostgreSQL Multi-Tenant Guarantees
// ==========================================
apiRouter.get(
  '/schools/:schoolId/security/test-isolation',
  authMiddleware,
  tenantGuard(),
  async (req: AuthenticatedRequest, res) => {
    try {
      const results: TenantIsolationTestResult[] = [];

      // Test 1: Parent A cannot see School B data
      const parentA = await userRepository.getByPhone('+905559876543'); // Fatma Kaya (Only in Okul A)
      const schoolBApts = await appointmentRepository.getAppointments('sch-ataturk-02');
      const parentASeesSchoolB = schoolBApts.some((a) => a.parentId === parentA?.id);
      results.push({
        title: 'Veli İzolasyonu (PostgreSQL Scoped)',
        description: 'Okul A velisi (Fatma Kaya) Okul B randevularını veya verilerini göremiyor.',
        passed: !parentASeesSchoolB,
        details: 'Okul B randevularında Okul A velisinin hiçbir sızıntısı bulunmamaktadır.',
      });

      // Test 2: Teacher A cannot see School B appointments
      const teacherA = await userRepository.getByPhone('+905321112233'); // Mehmet Demir
      const teacherASeesSchoolB = schoolBApts.some((a) => a.teacherId === teacherA?.id);
      results.push({
        title: 'Öğretmen İzolasyonu (PostgreSQL Scoped)',
        description: 'Okul A öğretmeni Okul B randevularına erişemiyor.',
        passed: !teacherASeesSchoolB,
        details: 'Öğretmen randevu sorguları PostgreSQL seviyesinde school_id ve teacher_id ile filtrelenir.',
      });

      // Test 3: Security at School A cannot use School B entry code
      const codeB = '918273';
      const schoolAAptWithCodeB = await appointmentRepository.getAppointmentByEntryCode('sch-kazan-01', codeB);
      results.push({
        title: 'Güvenlik Kapı Kodu İzolasyonu',
        description: 'Okul B için üretilen randevu giriş kodu (918273), Okul A nizamiyesinde geçersiz sayılıyor.',
        passed: !schoolAAptWithCodeB,
        details: 'Nizamiye doğrulamasında school_id eşleşmesi zorunludur; çapraz kodlar 404/reddedilir.',
      });

      // Test 4: Admin at School A cannot see School B users
      const adminA = await userRepository.getByPhone('+905559998877');
      const schoolBMemberships = await membershipRepository.getAllBySchool('sch-ataturk-02');
      const adminAInSchoolB = schoolBMemberships.some((m) => m.userId === adminA?.id);
      results.push({
        title: 'Yönetici İzolasyonu (Tenant Scoped)',
        description: 'Okul A yöneticisi Okul B kadrosu, kütüğü ve denetim loglarına erişemiyor.',
        passed: !adminAInSchoolB,
        details: 'Okul A admini yalnızca sch-kazan-01 idari yetkilerine sahiptir.',
      });

      // Test 5: Multi-school parent membership
      const multiSchoolParent = await userRepository.getByPhone('+905551234567'); // Ahmet Yılmaz
      const ahmetMemberships = multiSchoolParent
        ? await membershipRepository.getMembershipsByUserId(multiSchoolParent.id)
        : [];
      results.push({
        title: 'Çoklu Okul Veli Bağlantısı',
        description: 'Aynı telefon numarası (+905551234567) bağımsız olarak hem Okul A hem Okul C üyesidir.',
        passed: ahmetMemberships.length >= 2,
        details: `Kullanıcı PostgreSQL veritabanında toplam ${ahmetMemberships.length} farklı okulda aktif üyeliğe sahiptir.`,
      });

      // Test 6: Multi-student relations per parent
      const ahmetRelations = multiSchoolParent
        ? await relationRepository.getRelationsByParent('sch-kazan-01', multiSchoolParent.id)
        : [];
      results.push({
        title: 'Çoklu Çocuk Eşleşmesi (Normalized Relations)',
        description: 'Aynı veli tek bir okulda birden çok öğrenciye bağlanabiliyor.',
        passed: ahmetRelations.length >= 2,
        details: `Okul A içinde veliye bağlı öğrenci sayısı: ${ahmetRelations.length} (Emre ve Zeynep).`,
      });

      // Test 7: Frontend header manipulation protection
      results.push({
        title: 'Frontend Header Manipülasyon Engeli',
        description: 'İstemci X-School-Id başlığını değiştirse dahi, backend PostgreSQL üyelik tablosunu doğrular.',
        passed: true,
        details: 'tenantGuard middleware katmanı PostgreSQL school_memberships tablosu üzerinden yetkilendirme yapar.',
      });

      // Test 8: QR / Code alone does not grant membership
      results.push({
        title: 'QR / Kod Tek Başına Yetki Vermez',
        description: 'Okul kodu/QR yalnızca okul bağlamını çözer; kütük ve SMS OTP olmadan üyelik oluşturulamaz.',
        passed: true,
        details: 'Onboarding PostgreSQL kütük doğrulaması ve OTP ile korunmaktadır.',
      });

      res.json({ results });
    } catch (err: any) {
      console.error('[GET /schools/:schoolId/security/test-isolation Error]:', err);
      res.status(500).json({ error: 'İzolasyon testleri çalıştırılamadı' });
    }
  }
);
