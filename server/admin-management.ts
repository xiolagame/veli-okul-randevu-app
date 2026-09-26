import { Router } from 'express';
import { authMiddleware, tenantGuard, AuthenticatedRequest } from './auth';
import { getDb, TransactionClient } from './database/postgres';
import { auditLogRepository } from './repositories';
import { getTurkishPhoneLookupDigits, normalizeTurkishPhone } from '../src/utils/phone';
import { normalizePersonName } from '../src/utils/person-name';

class ManagementError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function textField(value: unknown, max: number): string {
  if (typeof value !== 'string') throw new ManagementError(400, 'Zorunlu alanları doldurun.');
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > max) throw new ManagementError(400, 'Alan uzunluğunu kontrol edin.');
  return text;
}

async function revokeCodes(tx: TransactionClient, schoolId: string, phone: string, role: string) {
  const digits = getTurkishPhoneLookupDigits(phone);
  if (!digits) return;
  await tx.query(`UPDATE invitations SET is_active = FALSE, revoked_at = NOW()
    WHERE school_id = $1 AND target_role = $2
      AND regexp_replace(target_phone, '[^0-9]', '', 'g') IN ($3,$4,$5)
      AND consumed_at IS NULL AND revoked_at IS NULL`, [schoolId, role, ...digits]);
}

export const adminManagementRouter = Router({ mergeParams: true });
adminManagementRouter.use(authMiddleware, tenantGuard(['admin']));

adminManagementRouter.get('/parents', async (req: AuthenticatedRequest, res) => {
  try {
    const db = await getDb();
    const result = await db.query<{ id: string; fullName: string; phone: string; status: string }>(
      `SELECT u.id, concat_ws(' ',u.first_name,u.last_name) AS "fullName", u.phone, sm.status
       FROM users u JOIN school_memberships sm ON sm.user_id = u.id
       WHERE sm.school_id = $1 AND sm.role = 'parent' ORDER BY u.id`, [req.membership!.schoolId]);
    const students = await db.query<{ id: string; parentId: string; name: string; className: string; studentNumber: string; birthDate?: string }>(
      `SELECT s.id, r.parent_user_id AS "parentId", s.name, s.class_name AS "className",
         COALESCE(s.student_number,'') AS "studentNumber", s.birth_date::text AS "birthDate"
       FROM students s JOIN student_parent_relations r ON r.school_id = s.school_id AND r.student_id = s.id
       WHERE s.school_id = $1 ORDER BY s.id`, [req.membership!.schoolId]);
    res.json({ parents: result.rows.map((parent) => ({ ...parent, fullName: normalizePersonName(parent.fullName), students: students.rows.filter((student) => student.parentId === parent.id).map((student) => ({ ...student, name: normalizePersonName(student.name) })) })) });
  } catch { res.status(500).json({ error: 'Veli bilgileri alınamadı.' }); }
});

adminManagementRouter.delete('/audit-logs', async (req: AuthenticatedRequest, res) => {
  try {
    const db = await getDb();
    await db.query('DELETE FROM audit_logs WHERE school_id = $1', [req.membership!.schoolId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'İşlem günlüğü temizlenemedi.' }); }
});

adminManagementRouter.route('/:kind/:id').patch(mutate).delete(mutate);

async function mutate(req: AuthenticatedRequest, res: import('express').Response) {
  const schoolId = req.membership!.schoolId;
  const kind = String(req.params.kind);
  const id = String(req.params.id);
  const removing = req.method === 'DELETE';
  if (!['teacher', 'parent', 'security', 'student', 'roster'].includes(kind) || (removing && ['student','roster'].includes(kind))) {
    return res.status(400).json({ error: 'Geçersiz işlem.' });
  }
  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      let cancelledAppointments = 0;
      await tx.query('SELECT id FROM schools WHERE id = $1 FOR UPDATE', [schoolId]);
      if (kind === 'teacher') await tx.query('LOCK TABLE teacher_profiles IN SHARE ROW EXCLUSIVE MODE');
      if (kind === 'roster') {
        const parentName = normalizePersonName(textField(req.body.parentName, 150));
        const studentName = normalizePersonName(textField(req.body.studentName, 150));
        const className = textField(req.body.className, 50);
        const number = typeof req.body.studentNumber === 'string' ? req.body.studentNumber.trim() : '';
        const birthDate = typeof req.body.birthDate === 'string' && req.body.birthDate ? req.body.birthDate : null;
        if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new ManagementError(400, 'Doğum tarihini kontrol edin.');
        const phone = normalizeTurkishPhone(req.body.parentPhone);
        if (!phone || number.length > 50) throw new ManagementError(400, 'Telefon veya okul numarası geçersiz.');
        const found = await tx.query<{ parent_phone: string; is_claimed: boolean }>(
          'SELECT parent_phone,is_claimed FROM school_roster WHERE school_id=$1 AND id=$2 FOR UPDATE', [schoolId,id]);
        const record = found.rows[0];
        if (!record) throw new ManagementError(404, 'Kayıt bulunamadı.');
        if (record.is_claimed) throw new ManagementError(409, 'Aktif hesabı veli listesinden düzenleyin.');
        const oldDigits = getTurkishPhoneLookupDigits(record.parent_phone);
        if (!oldDigits) throw new ManagementError(409, 'Eski telefon eşleştirmesi doğrulanamadı.');
        const identity = await tx.query(
          `SELECT id FROM users WHERE regexp_replace(phone,'[^0-9]','','g') IN ($1,$2,$3,$4,$5,$6) LIMIT 1`,
          [...oldDigits,...getTurkishPhoneLookupDigits(phone)!]);
        if (identity.rows.length) throw new ManagementError(409, 'Mevcut hesabı veli listesinden düzenleyin.');
        await tx.query(`UPDATE school_roster SET parent_name=$2,parent_phone=$3,updated_at=NOW()
          WHERE school_id=$1 AND is_claimed=FALSE AND regexp_replace(parent_phone,'[^0-9]','','g') IN ($4,$5,$6)`,
          [schoolId,parentName,phone,...oldDigits]);
        await tx.query(`UPDATE school_roster SET student_name=$3,class_name=$4,student_number=$5,birth_date=$6::date,updated_at=NOW()
          WHERE school_id=$1 AND id=$2 AND is_claimed=FALSE`, [schoolId,id,studentName,className,number || null,birthDate]);
        if (normalizeTurkishPhone(record.parent_phone) !== phone) await revokeCodes(tx,schoolId,record.parent_phone,'parent');
      } else if (kind === 'student') {
        const name = normalizePersonName(textField(req.body.name, 150));
        const className = textField(req.body.className, 50);
        const number = typeof req.body.studentNumber === 'string' ? req.body.studentNumber.trim() : '';
        const birthDate = typeof req.body.birthDate === 'string' && req.body.birthDate ? req.body.birthDate : null;
        if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new ManagementError(400, 'Doğum tarihini kontrol edin.');
        if (number.length > 50) throw new ManagementError(400, 'Okul numarası çok uzun.');
        const previous = await tx.query<{ name: string; class_name: string; student_number: string | null }>(
          'SELECT name,class_name,student_number FROM students WHERE school_id=$1 AND id=$2 FOR UPDATE', [schoolId, id]);
        if (!previous.rows[0]) throw new ManagementError(404, 'Kayıt bulunamadı.');
        const old = previous.rows[0];
        const ambiguous = await tx.query(`SELECT id FROM students WHERE school_id=$1 AND id<>$2 AND name=$3
          AND class_name=$4 AND student_number IS NOT DISTINCT FROM $5 LIMIT 1`, [schoolId, id, old.name, old.class_name, old.student_number]);
        if (ambiguous.rows.length) throw new ManagementError(409, 'Kütük eşleştirmesi belirsiz. Okul kayıtlarını kontrol edin.');
        await tx.query(`UPDATE school_roster sr SET student_name=$6,class_name=$7,student_number=$8,birth_date=$9::date,updated_at=NOW()
          WHERE sr.school_id=$1 AND sr.student_name=$3 AND sr.class_name=$4
            AND sr.student_number IS NOT DISTINCT FROM $5
            AND EXISTS (SELECT 1 FROM student_parent_relations rel JOIN users u ON u.id=rel.parent_user_id
              WHERE rel.school_id=sr.school_id AND rel.student_id=$2
                AND regexp_replace(sr.parent_phone,'[^0-9]','','g') IN
                  (regexp_replace(u.phone,'[^0-9]','','g'), '0' || right(regexp_replace(u.phone,'[^0-9]','','g'),10),
                   right(regexp_replace(u.phone,'[^0-9]','','g'),10)))`,
          [schoolId, id, old.name, old.class_name, old.student_number, name, className, number || null,birthDate]);
        const result = await tx.query<{ id: string }>(
          `UPDATE students SET name=$3, class_name=$4, student_number=$5, birth_date=$6::date, updated_at=NOW()
           WHERE school_id=$1 AND id=$2 RETURNING id`, [schoolId, id, name, className, number || null,birthDate]);
        if (!result.rows.length) throw new ManagementError(404, 'Kayıt bulunamadı.');
      } else {
        let userId: string | null = id;
        let oldPhone: string;
        let oldName: string;
        if (kind === 'teacher') {
          const profiles = await tx.query<{ user_id: string | null; phone: string; full_name: string }>(
            `SELECT user_id, phone, concat_ws(' ',first_name,last_name) AS full_name
             FROM teacher_profiles WHERE school_id=$1 AND id=$2 FOR UPDATE`, [schoolId, id]);
          const profile = profiles.rows[0];
          if (!profile) throw new ManagementError(404, 'Kayıt bulunamadı.');
          userId = profile.user_id;
          oldPhone = profile.phone;
          oldName = profile.full_name;
        } else {
          const users = await tx.query<{ phone: string; full_name: string }>(
            `SELECT u.phone, concat_ws(' ',u.first_name,u.last_name) AS full_name
             FROM users u JOIN school_memberships sm ON sm.user_id=u.id
             WHERE sm.school_id=$1 AND u.id=$2 AND sm.role=$3 FOR UPDATE OF u`, [schoolId, id, kind]);
          if (!users.rows[0]) throw new ManagementError(404, 'Kayıt bulunamadı.');
          oldPhone = users.rows[0].phone;
          oldName = users.rows[0].full_name;
        }
        if (removing) {
          if (kind === 'teacher') {
            const appointments = await tx.query<{id:string}>(`SELECT id FROM appointments WHERE school_id=$1 AND teacher_id=$2`,[schoolId,id]);
            cancelledAppointments = appointments.rows.length;
            const appointmentIds = appointments.rows.map((row) => row.id);
            if (appointmentIds.length) await tx.query('DELETE FROM notifications WHERE school_id=$1 AND appointment_id = ANY($2::text[])',[schoolId,appointmentIds]);
            await tx.query('DELETE FROM appointments WHERE school_id=$1 AND teacher_id=$2',[schoolId,id]);
            await tx.query('DELETE FROM availability_slots WHERE school_id=$1 AND teacher_id=$2',[schoolId,id]);
            await tx.query(`UPDATE invitations SET is_active=FALSE,revoked_at=COALESCE(revoked_at,NOW()),target_user_id=NULL
              WHERE school_id=$1 AND target_role='teacher' AND (target_user_id=$2 OR regexp_replace(target_phone,'[^0-9]','','g') IN ($3,$4,$5))
                AND consumed_at IS NULL`,[schoolId,userId,...(getTurkishPhoneLookupDigits(oldPhone) || ['', '', ''])]);
            if (userId) {
              await tx.query('DELETE FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role=\'teacher\'',[schoolId,userId]);
              await tx.query('DELETE FROM teacher_profiles WHERE school_id=$1 AND id=$2',[schoolId,id]);
              const independent = await tx.query(`SELECT
                  EXISTS(SELECT 1 FROM school_memberships WHERE user_id=$1) OR
                  EXISTS(SELECT 1 FROM student_parent_relations WHERE parent_user_id=$1) OR
                  EXISTS(SELECT 1 FROM appointments WHERE parent_id=$1) OR
                  EXISTS(SELECT 1 FROM teacher_profiles WHERE user_id=$1) OR
                  EXISTS(SELECT 1 FROM pending_staff ps JOIN users u ON u.phone=ps.phone WHERE u.id=$1) AS has_refs`,[userId]);
              if (!independent.rows[0]?.has_refs) {
                await tx.query('DELETE FROM notifications WHERE user_id=$1',[userId]);
                await tx.query('UPDATE invitations SET target_user_id=NULL WHERE target_user_id=$1',[userId]);
                await tx.query('UPDATE invitations SET created_by=NULL WHERE created_by=$1',[userId]);
                await tx.query('UPDATE appointments SET approved_by=NULL WHERE approved_by=$1',[userId]);
                await tx.query('UPDATE appointments SET checked_in_by=NULL WHERE checked_in_by=$1',[userId]);
                await tx.query('DELETE FROM users WHERE id=$1',[userId]);
              }
            } else {
              await tx.query('DELETE FROM teacher_profiles WHERE school_id=$1 AND id=$2 AND user_id IS NULL',[schoolId,id]);
            }
          } else {
            if (userId) await tx.query(`UPDATE school_memberships SET status='inactive', updated_at=NOW()
              WHERE school_id=$1 AND user_id=$2 AND role=$3`, [schoolId, userId, kind]);
          }
          await revokeCodes(tx, schoolId, oldPhone, kind);
        } else {
          const fullName = normalizePersonName(textField(req.body.fullName, 150));
          const phone = normalizeTurkishPhone(req.body.phone);
          if (!phone) throw new ManagementError(400, 'Geçerli bir Türkiye GSM numarası girin.');
          const names = fullName.split(' ');
          if (names.length < 2) throw new ManagementError(400, 'Ad ve soyad girin.');
          const firstName = names.shift()!;
          const lastName = names.join(' ');
          if (firstName.length > 100 || lastName.length > 100) throw new ManagementError(400, 'Ad veya soyad çok uzun.');
          const branch = kind === 'teacher' ? textField(req.body.branch, 100) : null;
          const phoneChanged = normalizeTurkishPhone(oldPhone) !== phone;
          if (userId) {
            const identity = await tx.query<{ phone: string; full_name: string }>(
              "SELECT phone, concat_ws(' ',first_name,last_name) AS full_name FROM users WHERE id=$1 FOR UPDATE", [userId]);
            const otherSchools = await tx.query(
              'SELECT id FROM school_memberships WHERE user_id=$1 AND school_id<>$2 LIMIT 1', [userId, schoolId]);
            if (otherSchools.rows.length && (identity.rows[0]?.phone !== phone || normalizePersonName(identity.rows[0]?.full_name || '') !== fullName)) {
              throw new ManagementError(409, 'Birden fazla okula bağlı hesabın kimlik bilgileri bu ekrandan değiştirilemez.');
            }
            const duplicate = await tx.query(
              `SELECT id FROM users WHERE id<>$1 AND regexp_replace(phone,'[^0-9]','','g') IN ($2,$3,$4) LIMIT 1`,
              [userId, ...getTurkishPhoneLookupDigits(phone)!]);
            if (duplicate.rows.length) throw new ManagementError(409, 'Telefon başka bir hesaba bağlı.');
            const otherRoles = await tx.query(
              'SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role<>$3 LIMIT 1', [schoolId, userId, kind]);
            if (otherRoles.rows.length && (phoneChanged || fullName !== normalizePersonName(oldName))) {
              throw new ManagementError(409, 'Birden fazla rolü olan hesabın kimlik bilgileri bu ekrandan değiştirilemez.');
            }
            await tx.query(`UPDATE users SET first_name=$2,last_name=$3,phone=$4::varchar(20),
              auth_version=auth_version + CASE WHEN phone<>$4::varchar(20) THEN 1 ELSE 0 END,updated_at=NOW() WHERE id=$1`,
              [userId, firstName, lastName, phone]);
          } else if (phoneChanged) {
            const duplicate = await tx.query(
              `SELECT id FROM users WHERE regexp_replace(phone,'[^0-9]','','g') IN ($1,$2,$3) LIMIT 1`,
              getTurkishPhoneLookupDigits(phone)!);
            if (duplicate.rows.length) throw new ManagementError(409, 'Telefon başka bir hesaba bağlı.');
          }
          if (kind === 'teacher') {
            if (phoneChanged) {
              const phoneDigits = getTurkishPhoneLookupDigits(phone)!;
              const duplicateAcrossSchools = await tx.query(`SELECT id FROM teacher_profiles WHERE school_id<>$1 AND id<>$2
                AND regexp_replace(phone,'[^0-9]','','g') IN ($3,$4,$5) LIMIT 1`, [schoolId, id, ...phoneDigits]);
              const activeTeacherAccount = await tx.query(`SELECT sm.user_id FROM school_memberships sm
                JOIN users u ON u.id=sm.user_id
                WHERE sm.role='teacher' AND sm.status='active' AND sm.school_id<>$1
                  AND sm.user_id IS DISTINCT FROM $2
                  AND regexp_replace(u.phone,'[^0-9]','','g') IN ($3,$4,$5) LIMIT 1`, [schoolId, userId, ...phoneDigits]);
              if (duplicateAcrossSchools.rows.length || activeTeacherAccount.rows.length) {
                throw new ManagementError(409, 'Bu öğretmen başka bir okulda kayıtlı.');
              }
              const duplicate = await tx.query(`SELECT id FROM teacher_profiles WHERE school_id=$1 AND id<>$2
                AND regexp_replace(phone,'[^0-9]','','g') IN ($3,$4,$5) LIMIT 1`, [schoolId, id, ...phoneDigits]);
              if (duplicate.rows.length) throw new ManagementError(409, 'Bu telefon okulda başka bir öğretmene bağlı.');
            }
            await tx.query(`UPDATE teacher_profiles SET first_name=$3,last_name=$4,phone=$5,branch=$6,updated_at=NOW()
              WHERE school_id=$1 AND id=$2`, [schoolId, id, firstName, lastName, phone, branch]);
            if (userId) await tx.query(`UPDATE school_memberships SET branch=$3,updated_at=NOW()
              WHERE school_id=$1 AND user_id=$2 AND role='teacher'`, [schoolId, userId, branch]);
          }
          if (kind === 'parent') {
            const digits = getTurkishPhoneLookupDigits(oldPhone);
            if (digits) await tx.query(`UPDATE school_roster SET parent_name=$2,parent_phone=$3,updated_at=NOW()
              WHERE school_id=$1 AND regexp_replace(parent_phone,'[^0-9]','','g') IN ($4,$5,$6)`,
              [schoolId, fullName, phone, ...digits]);
          }
          if (phoneChanged) await revokeCodes(tx, schoolId, oldPhone, kind);
        }
      }
      await auditLogRepository.createAuditLog({
        schoolId, action: kind === 'teacher' && removing ? 'teacher_deleted' : `${kind}.${removing ? 'removed' : 'updated'}`,
        actorName: 'Okul yönetimi', details: JSON.stringify({ id, ...(kind === 'teacher' && removing
          ? { deletedAppointments: cancelledAppointments, reason: 'Öğretmen ve ilişkili kayıtlar silindi.' } : {}) }),
      }, tx);
    });
    return res.json({ success: true });
  } catch (cause) {
    if (cause instanceof ManagementError) return res.status(cause.status).json({ error: cause.message });
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505') {
      return res.status(409).json({ error: 'Bu bilgilerle başka bir kayıt mevcut.' });
    }
    return res.status(500).json({ error: 'İşlem tamamlanamadı.' });
  }
}
