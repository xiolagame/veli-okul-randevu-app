import { Router } from 'express';
import crypto from 'node:crypto';
import { AuthenticatedRequest, canUsePlatformAuthority, isPlatformAdmin } from './auth';
import { getDb, TransactionClient } from './database/postgres';
import { hashSetupToken, generateStaffCode } from './activation-codes';
import { isWhatsAppAuthEnabled, isWhatsAppPhoneEnabled, sendWhatsAppAuthenticationCode } from './whatsapp-cloud';
import { normalizeTurkishPhone } from '../src/utils/phone';
import { normalizeClassName } from '../src/utils/class-name';
import { MULTI_CLASS_CONFIRMATION, SchoolStudentRecord, studentIdentity } from '../src/utils/student-records';
import { auditLogRepository, schoolLicenseRepository } from './repositories';
import { canonicalOperationPhoneSql } from './operations';

export class StudentRecordError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type StudentRow = { id: string; name: string; class_name: string; student_number: string | null; birth_date: string | null; updated_at: string };
type RosterRow = { id: string; student_name: string; class_name: string; student_number: string | null; birth_date: string | null; parent_name: string; parent_phone: string; is_claimed: boolean; has_account: boolean; parent_account_deleted_at: string | null; updated_at: string };
type ParentRow = { id: string; student_id: string; parent_user_id: string; full_name: string; phone: string; status: string };
type SchoolState = { students: StudentRow[]; roster: RosterRow[]; parents: ParentRow[]; records: SchoolStudentRecord[] };
const purpose = 'CLASS_BULK_DELETE';
export const classBulkDeleteEnabled = () => process.env.CLASS_BULK_DELETE_ENABLED?.trim().toLowerCase() === 'true';
export const classMultiDeleteEnabled = () => classBulkDeleteEnabled() && process.env.CLASS_MULTI_DELETE_ENABLED?.trim().toLowerCase() === 'true';
const multiPurpose = 'CLASS_MULTI_DELETE';
const multiPolicy = 'PERMANENT_CLASSES_V1';
const multiConfirmation = MULTI_CLASS_CONFIRMATION;

async function readState(tx: TransactionClient, schoolId: string): Promise<SchoolState> {
  const students = (await tx.query<StudentRow>('SELECT id,name,class_name,student_number,birth_date::text,updated_at FROM students WHERE school_id=$1 ORDER BY id', [schoolId])).rows;
  const roster = (await tx.query<RosterRow>(`SELECT sr.id,sr.student_name,sr.class_name,sr.student_number,sr.birth_date::text,sr.parent_name,sr.parent_phone,sr.is_claimed,sr.parent_account_deleted_at,sr.updated_at,
    EXISTS(SELECT 1 FROM users u WHERE ${canonicalOperationPhoneSql('u.phone')}=${canonicalOperationPhoneSql('sr.parent_phone')}) AS has_account
    FROM school_roster sr WHERE sr.school_id=$1 ORDER BY sr.id`, [schoolId])).rows;
  const parents = (await tx.query<ParentRow>(`SELECT r.id,r.student_id,r.parent_user_id,concat_ws(' ',u.first_name,u.last_name) AS full_name,u.phone,sm.status
    FROM student_parent_relations r JOIN users u ON u.id=r.parent_user_id
    LEFT JOIN school_memberships sm ON sm.school_id=r.school_id AND sm.user_id=u.id AND sm.role='parent'
    WHERE r.school_id=$1 ORDER BY r.id`, [schoolId])).rows;
  const parentsByStudent = new Map<string, ParentRow[]>();
  for (const parent of parents) { const group = parentsByStudent.get(parent.student_id); if (group) group.push(parent); else parentsByStudent.set(parent.student_id, [parent]); }
  const records: SchoolStudentRecord[] = students.map((s) => ({ id: s.id, kind: 'student', name: s.name, className: normalizeClassName(s.class_name) || s.class_name,
    studentNumber: s.student_number || '', birthDate: s.birth_date || '', parents: (parentsByStudent.get(s.id) || []).map((p) => ({ id: p.parent_user_id, fullName: p.full_name, phone: p.phone, status: p.status || 'inactive' })) }));
  const identities = new Map(records.map((s) => [studentIdentity(s.name, s.className, s.studentNumber), s]));
  for (const r of roster) {
    const identity = studentIdentity(r.student_name, r.class_name, r.student_number);
    let record = identities.get(identity);
    if (!record) {
      record = { id: r.id, kind: 'roster', name: r.student_name, className: normalizeClassName(r.class_name) || r.class_name,
        studentNumber: r.student_number || '', birthDate: r.birth_date || '', parents: [] };
      records.push(record); identities.set(identity, record);
    }
    if (!record.parents.some((p) => normalizeTurkishPhone(p.phone) === normalizeTurkishPhone(r.parent_phone))) record.parents.push({ rosterId: r.id, fullName: r.parent_account_deleted_at ? 'Silinmiş Veli' : r.parent_name,
      phone: r.parent_account_deleted_at ? '' : r.parent_phone, status: r.parent_account_deleted_at ? 'deleted' : r.has_account ? 'unlinked' : 'pending' });
  }
  return { students, roster, parents, records };
}

async function lockSchool(tx: TransactionClient, schoolId: string) {
  const school = await tx.query<{ name: string }>('SELECT name FROM schools WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [schoolId]);
  if (!school.rows[0] || !await schoolLicenseRepository.isAccessAllowed(schoolId, tx)) throw new StudentRecordError(403, 'Okula erişilemiyor.');
  return school.rows[0];
}
async function lockRecords(tx: TransactionClient) {
  // Block inserts as well as edits between snapshot comparison and removal.
  await tx.query('LOCK TABLE students,school_roster,student_parent_relations,appointments IN SHARE ROW EXCLUSIVE MODE');
}
function classState(state: SchoolState, className: string): SchoolState {
  const students = state.students.filter((s) => normalizeClassName(s.class_name) === className);
  const ids = new Set(students.map((s) => s.id));
  return { students, roster: state.roster.filter((r) => normalizeClassName(r.class_name) === className),
    parents: state.parents.filter((p) => ids.has(p.student_id)), records: state.records.filter((r) => r.className === className) };
}
async function snapshot(tx: TransactionClient, schoolId: string, state: SchoolState) {
  const appointments = await relatedAppointments(tx, schoolId, state);
  return hashSetupToken(JSON.stringify({ ...state, appointments }));
}

async function relatedAppointments(tx: TransactionClient, schoolId: string, state: SchoolState) {
  return (await tx.query<{ id: string; status: string }>(`SELECT a.* FROM appointments a
    WHERE a.school_id=$1 AND (a.student_id=ANY($2::text[]) OR (a.student_id IS NULL AND (
      EXISTS(SELECT 1 FROM students s JOIN student_parent_relations r ON r.school_id=s.school_id AND r.student_id=s.id
        WHERE s.school_id=$1 AND s.id=ANY($2::text[]) AND s.name=a.student_name AND s.class_name=a.class_name AND r.parent_user_id=a.parent_id)
      OR EXISTS(SELECT 1 FROM school_roster sr WHERE sr.school_id=$1 AND sr.id=ANY($3::text[])
        AND sr.student_name=a.student_name AND sr.class_name=a.class_name
        AND right(regexp_replace(sr.parent_phone,'[^0-9]','','g'),10)=right(regexp_replace(a.parent_phone,'[^0-9]','','g'),10)))))
    ORDER BY a.id`, [schoolId, state.students.map((s) => s.id), state.roster.map((r) => r.id)])).rows;
}

async function removeRecords(tx: TransactionClient, schoolId: string, state: SchoolState, actorId: string) {
  const ids = state.students.map((s) => s.id);
  const schema = await tx.query<{ safe: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conrelid='public.appointments'::regclass AND conname='fk_appointments_student' AND confdeltype='n') AS safe`);
  if (!schema.rows[0]?.safe) throw new StudentRecordError(503, 'Geçmiş randevu koruması için veritabanı şeması kontrol edilmeli.');
  const appointments = await relatedAppointments(tx, schoolId, state);
  if (appointments.some((a) => a.status === 'checked_in')) throw new StudentRecordError(409, 'Devam eden ziyaret tamamlanmadan kayıt kaldırılamaz.');
  const cancelled = await tx.query(`UPDATE appointments SET status='cancelled',updated_at=NOW()
    WHERE school_id=$1 AND id=ANY($2::text[]) AND status IN ('pending','booked')
      AND (date || ' ' || start_time) >= to_char(NOW() AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD HH24:MI') RETURNING id`,
    [schoolId, appointments.map((a) => a.id)]);
  await tx.query('DELETE FROM school_roster WHERE school_id=$1 AND id=ANY($2::text[])', [schoolId, state.roster.map((r) => r.id)]);
  await tx.query('DELETE FROM student_parent_relations WHERE school_id=$1 AND student_id=ANY($2::text[])', [schoolId, ids]);
  await tx.query('DELETE FROM students WHERE school_id=$1 AND id=ANY($2::text[])', [schoolId, ids]);
  await auditLogRepository.createAuditLog({ schoolId, action: 'student.records_removed', actorName: 'Yetkili yönetici', actorUserId: actorId,
    details: JSON.stringify({ studentsRemoved: state.records.length, appointmentsCancelled: cancelled.rows.length, parentAccountsPreserved: true }) }, tx);
  return { removedCount: state.records.length, cancelledAppointments: cancelled.rows.length,
    preservedAccounts: new Set(state.parents.map((parent) => parent.parent_user_id)).size };
}

// Permanent class removal is separate from single-student removal, which retains history.
async function lockPermanentRecords(tx: TransactionClient) {
  await tx.query('LOCK TABLE users,school_memberships,teacher_profiles,pending_staff,students,school_roster,student_parent_relations,appointments,notifications,invitations IN SHARE ROW EXCLUSIVE MODE');
}
const quoteIdentifier = (value: string) => '"' + value.replace(/"/g, '""') + '"';
type PermanentPlan = {
  appointmentIds: string[]; notificationIds: string[]; deliveryIds: string[];
  parentIds: string[]; removableParentIds: string[]; detachableParentIds: string[];
  studentCount: number; relationCount: number; preservedAccounts: number; removableAccounts: number; appointmentCount: number; qrCount: number;
};
async function permanentPlan(tx: TransactionClient, schoolId: string, state: SchoolState): Promise<PermanentPlan> {
  const studentIds = state.students.map(student => student.id), rosterIds = state.roster.map(row => row.id);
  // ID-less historical appointments cannot safely be assigned using a phone or a name alone.
  const schoolAppointments = (await tx.query<{ id: string; student_id: string | null; class_name: string; student_name: string; status: string; qr_token: string | null }>('SELECT id,student_id,class_name,student_name,status,qr_token FROM appointments WHERE school_id=$1 ORDER BY id', [schoolId])).rows;
  const classes = new Set(state.records.map(record => record.className));
  if (schoolAppointments.some(appointment => !appointment.student_id && classes.has(normalizeClassName(appointment.class_name) || appointment.class_name))) {
    throw new StudentRecordError(409, 'Bu sınıfta öğrenci kimliğiyle kesin eşleştirilemeyen eski randevular var. Kalıcı silmeden önce kayıt ilişkileri incelenmeli.');
  }
  const appointments = schoolAppointments.filter(appointment => !!appointment.student_id && studentIds.includes(appointment.student_id));
  if (appointments.some(appointment => appointment.status === 'checked_in')) throw new StudentRecordError(409, 'Devam eden ziyaret tamamlanmadan sınıf silinemez.');
  const appointmentIds = appointments.map(appointment => appointment.id);
  const notificationIds = (await tx.query<{ id: string }>('SELECT id FROM notifications WHERE school_id=$1 AND appointment_id=ANY($2::text[]) ORDER BY id', [schoolId, appointmentIds])).rows.map(row => row.id);
  const deliveryIds = (await tx.query<{ id: string }>('SELECT id FROM notification_deliveries WHERE notification_id=ANY($1::text[]) ORDER BY id', [notificationIds])).rows.map(row => row.id);
  const parentIds = [...new Set(state.parents.map(parent => parent.parent_user_id))].sort();
  if (parentIds.length) await tx.query('SELECT id FROM users WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [parentIds]);
  const detachableParentIds: string[] = [], removableParentIds: string[] = [];
  const references = (await tx.query<{ table_name: string; column_name: string }>(
    `SELECT cl.relname AS table_name,a.attname AS column_name FROM pg_constraint c
     JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace
     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
     WHERE c.contype='f' AND c.confrelid='public.users'::regclass AND n.nspname='public' ORDER BY cl.relname,a.attname`)).rows;
  const sessionTables = new Set(['whatsapp_auth_challenges','identity_auth_attempts','mobile_push_devices','platform_phone_bindings','platform_email_bindings','audit_logs']);
  for (const userId of parentIds) {
    if (isPlatformAdmin(userId)) continue;
    const remainingSchoolLinks = await tx.query(
      `SELECT 1 FROM student_parent_relations WHERE parent_user_id=$1 AND school_id=$2 AND NOT(student_id=ANY($3::text[]))
       UNION ALL SELECT 1 FROM school_roster sr JOIN users u ON u.id=$1
       WHERE sr.school_id=$2 AND NOT(sr.id=ANY($4::text[])) AND ${canonicalOperationPhoneSql('sr.parent_phone')}=${canonicalOperationPhoneSql('u.phone')} LIMIT 1`,
      [userId, schoolId, studentIds, rosterIds]);
    if (remainingSchoolLinks.rows.length) continue;
    detachableParentIds.push(userId);
    let protectedAccount = false;
    for (const ref of references) {
      if (sessionTables.has(ref.table_name)) continue;
      let exclusion = '';
      const params: unknown[] = [userId];
      if (ref.table_name === 'school_memberships') { exclusion = " AND NOT(school_id=$2 AND role='parent')"; params.push(schoolId); }
      if (ref.table_name === 'student_parent_relations') { exclusion = ' AND NOT(school_id=$2 AND student_id=ANY($3::text[]))'; params.push(schoolId, studentIds); }
      if (ref.table_name === 'appointments') { exclusion = ' AND NOT(school_id=$2 AND id=ANY($3::text[]))'; params.push(schoolId, appointmentIds); }
      if (ref.table_name === 'notifications') { exclusion = ' AND NOT(id=ANY($2::text[]))'; params.push(notificationIds); }
      if (ref.table_name === 'invitations' && ref.column_name === 'target_user_id') { exclusion = " AND NOT(school_id=$2 AND target_role='parent')"; params.push(schoolId); }
      const found = await tx.query('SELECT 1 FROM public.' + quoteIdentifier(ref.table_name) + ' WHERE ' + quoteIdentifier(ref.column_name) + '=$1' + exclusion + ' LIMIT 1', params);
      if (found.rows.length) { protectedAccount = true; break; }
    }
    // Unlinked legacy roster/staff records veto deletion; phones never select deletion candidates.
    const legacyLinks = await tx.query(
      `SELECT 1 FROM school_roster sr JOIN users u ON u.id=$1 WHERE NOT(sr.school_id=$2 AND sr.id=ANY($3::text[]))
         AND ${canonicalOperationPhoneSql('sr.parent_phone')}=${canonicalOperationPhoneSql('u.phone')}
       UNION ALL SELECT 1 FROM teacher_profiles tp JOIN users u ON u.id=$1 WHERE ${canonicalOperationPhoneSql('tp.phone')}=${canonicalOperationPhoneSql('u.phone')}
       UNION ALL SELECT 1 FROM pending_staff ps JOIN users u ON u.id=$1 WHERE ${canonicalOperationPhoneSql('ps.phone')}=${canonicalOperationPhoneSql('u.phone')} LIMIT 1`,
      [userId, schoolId, rosterIds]);
    if (!protectedAccount && !legacyLinks.rows.length) removableParentIds.push(userId);
  }
  return { appointmentIds, notificationIds, deliveryIds, parentIds, removableParentIds, detachableParentIds,
    studentCount: state.records.length, relationCount: state.parents.length,
    preservedAccounts: parentIds.length - removableParentIds.length, removableAccounts: removableParentIds.length,
    appointmentCount: appointments.length, qrCount: appointments.filter(appointment => appointment.qr_token).length };
}
async function permanentSnapshot(tx: TransactionClient, schoolId: string, state: SchoolState, plan: PermanentPlan) {
  return hashSetupToken(JSON.stringify({ policy: 'PERMANENT_CLASS_V1', records: await snapshot(tx, schoolId, state), plan }));
}
async function permanentlyRemoveClass(tx: TransactionClient, schoolId: string, state: SchoolState, plan: PermanentPlan, actorId: string, classNames?: string[]) {
  const studentIds = state.students.map(student => student.id);
  await tx.query('DELETE FROM notification_deliveries WHERE notification_id=ANY($1::text[])', [plan.notificationIds]);
  await tx.query('DELETE FROM notifications WHERE school_id=$1 AND id=ANY($2::text[])', [schoolId, plan.notificationIds]);
  await tx.query('DELETE FROM appointments WHERE school_id=$1 AND id=ANY($2::text[])', [schoolId, plan.appointmentIds]);
  await tx.query('DELETE FROM school_roster WHERE school_id=$1 AND id=ANY($2::text[])', [schoolId, state.roster.map(row => row.id)]);
  await tx.query('DELETE FROM student_parent_relations WHERE school_id=$1 AND student_id=ANY($2::text[])', [schoolId, studentIds]);
  await tx.query('DELETE FROM students WHERE school_id=$1 AND id=ANY($2::text[])', [schoolId, studentIds]);
  await tx.query("DELETE FROM school_memberships WHERE school_id=$1 AND role='parent' AND user_id=ANY($2::text[])", [schoolId, plan.detachableParentIds]);
  await tx.query("DELETE FROM invitations WHERE school_id=$1 AND target_role='parent' AND target_user_id=ANY($2::text[])", [schoolId, plan.detachableParentIds]);
  const removed = await tx.query('DELETE FROM users WHERE id=ANY($1::text[]) RETURNING id', [plan.removableParentIds]);
  if (removed.rows.length !== plan.removableParentIds.length) throw new StudentRecordError(409, 'Veli hesap ilişkileri değişti. İşlem yeniden incelenmeli.');
  await auditLogRepository.createAuditLog({ schoolId, action: classNames ? 'class.multi_permanently_deleted' : 'class.permanently_deleted', actorName: 'Yetkili yönetici', actorUserId: actorId,
    details: JSON.stringify({ classReference: hashSetupToken(state.records[0].className), studentsRemoved: state.records.length, relationsRemoved: state.parents.length,
      appointmentsRemoved: plan.appointmentIds.length, preservedAccounts: plan.preservedAccounts, removedAccounts: removed.rows.length,
      ...(classNames ? { classCount: classNames.length, classReferences: classNames.map(name => hashSetupToken(name)), notificationsRemoved: plan.notificationIds.length, qrRemoved: plan.qrCount } : {}) }) }, tx);
  return { removedCount: state.records.length, preservedAccounts: plan.preservedAccounts, removedAccounts: removed.rows.length,
    removedAppointments: plan.appointmentIds.length, removedRelations: state.parents.length, removedQrPermissions: plan.qrCount };
}

export async function removeSingleStudent(tx: TransactionClient, schoolId: string, id: string, actorId: string) {
  await lockSchool(tx, schoolId); await lockRecords(tx);
  const state = await readState(tx, schoolId);
  const target = state.students.find((s) => s.id === id);
  if (!target) throw new StudentRecordError(404, 'Öğrenci bulunamadı.');
  const identity = studentIdentity(target.name, target.class_name, target.student_number);
  if (state.students.filter((s) => studentIdentity(s.name, s.class_name, s.student_number) === identity).length !== 1) throw new StudentRecordError(409, 'Öğrenci eşleştirmesi belirsiz.');
  const selected = { students: [target], roster: state.roster.filter((r) => studentIdentity(r.student_name, r.class_name, r.student_number) === identity),
    parents: state.parents.filter((p) => p.student_id === id), records: state.records.filter((s) => s.kind === 'student' && s.id === id) };
  return removeRecords(tx, schoolId, selected, actorId);
}

async function actor(tx: TransactionClient, req: AuthenticatedRequest) {
  const schoolId = req.membership!.schoolId;
  await lockSchool(tx, schoolId);
  if (isPlatformAdmin(req.user!.id)) {
    if (!canUsePlatformAuthority(req.user) || req.platformTargetSchoolId !== schoolId) throw new StudentRecordError(403, 'Bu işlem için yetkiniz yok.');
  } else {
    const membership = await tx.query("SELECT id FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND role='admin' AND status='active' FOR SHARE", [schoolId, req.user!.id]);
    if (!membership.rows.length) throw new StudentRecordError(403, 'Bu işlem için yetkiniz yok.');
  }
  const user = (await tx.query<{ phone: string; auth_version: number; is_phone_verified: boolean }>('SELECT phone,auth_version,is_phone_verified FROM users WHERE id=$1 FOR SHARE', [req.user!.id])).rows[0];
  if (!user || !user.is_phone_verified || !normalizeTurkishPhone(user.phone)) throw new StudentRecordError(403, 'Yöneticinin doğrulanmış WhatsApp telefonu gerekli.');
  if (isPlatformAdmin(req.user!.id)) {
    const binding = await tx.query("SELECT id FROM platform_phone_bindings WHERE user_id=$1 AND candidate_phone=$2 AND status='COMPLETED' AND consumed_at IS NOT NULL LIMIT 1", [req.user!.id, normalizeTurkishPhone(user.phone)]);
    if (!binding.rows.length) throw new StudentRecordError(403, 'Platform WhatsApp telefonu güvenli bağlama akışıyla doğrulanmalı.');
  }
  return { ...user, phone: normalizeTurkishPhone(user.phone)! };
}
async function audit(tx: TransactionClient, req: AuthenticatedRequest, outcome: string) {
  await auditLogRepository.createAuditLog({ schoolId: req.membership!.schoolId, action: 'class.bulk_delete', actorName: 'Yetkili yönetici', actorUserId: req.user!.id,
    details: JSON.stringify({ outcome }) }, tx);
}
export const studentRecordsRouter = Router({ mergeParams: true });
studentRecordsRouter.get('/', async (req: AuthenticatedRequest, res) => {
  try { const state = await readState(await getDb(), req.membership!.schoolId); res.json({ records: state.records, classBulkDeleteEnabled: classBulkDeleteEnabled(), classMultiDeleteEnabled: classMultiDeleteEnabled() }); }
  catch { res.status(500).json({ error: 'Öğrenci kayıtları alınamadı.' }); }
});
studentRecordsRouter.delete('/roster/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await (await getDb()).transaction(async (tx) => {
      const schoolId = req.membership!.schoolId;
      await lockSchool(tx, schoolId); await lockRecords(tx);
      const state = await readState(tx, schoolId);
      const target = state.roster.find((r) => r.id === req.params.id);
      if (!target || target.is_claimed) throw new StudentRecordError(404, 'Bekleyen kayıt bulunamadı.');
      const identity = studentIdentity(target.student_name, target.class_name, target.student_number);
      if (state.students.some((s) => studentIdentity(s.name, s.class_name, s.student_number) === identity)) throw new StudentRecordError(409, 'Öğrenciyi aktif listesinden kaldırın.');
      return removeRecords(tx, schoolId, { students: [], roster: state.roster.filter((r) => studentIdentity(r.student_name, r.class_name, r.student_number) === identity), parents: [], records: state.records.filter((r) => r.kind === 'roster' && studentIdentity(r.name, r.className, r.studentNumber) === identity) }, req.user!.id);
    });
    res.json({ success: true, ...result });
  } catch (error) { respond(error, res); }
});
studentRecordsRouter.use('/class-removal', (_req, res, next) => {
  if (!classBulkDeleteEnabled()) return res.status(404).json({ error: 'Toplu sınıf silme etkin değil.' });
  next();
});
studentRecordsRouter.post('/class-removal/preview', async (req: AuthenticatedRequest, res) => {
  try {
    const className = normalizeClassName(req.body?.className);
    if (!className) throw new StudentRecordError(400, 'Sınıf seçin.');
    const result = await (await getDb()).transaction(async (tx) => {
      await actor(tx, req); await lockPermanentRecords(tx);
      const state = classState(await readState(tx, req.membership!.schoolId), className);
      if (!state.records.length) throw new StudentRecordError(404, 'Sınıf bulunamadı.');
      const plan = await permanentPlan(tx, req.membership!.schoolId, state);
      return { className, studentCount: plan.studentCount, relationCount: plan.relationCount, preservedAccounts: plan.preservedAccounts, removableAccounts: plan.removableAccounts, appointmentCount: plan.appointmentCount, qrCount: plan.qrCount, snapshot: await permanentSnapshot(tx, req.membership!.schoolId, state, plan) };
    });
    res.json(result);
  } catch (error) { respond(error, res); }
});
studentRecordsRouter.post('/class-removal/request-code', async (req: AuthenticatedRequest, res) => {
  try {
    const className = normalizeClassName(req.body?.className);
    if (!className || typeof req.body?.snapshot !== 'string' || req.body?.deletionPolicy !== 'PERMANENT_CLASS_V1' || normalizeClassName(req.body?.confirmation) !== className) throw new StudentRecordError(400, 'Önizlemeyi yenileyin.');
    const code = generateStaffCode(), token = crypto.randomUUID();
    const result = await (await getDb()).transaction(async (tx) => {
      const user = await actor(tx, req);
      if (!isWhatsAppAuthEnabled() || !isWhatsAppPhoneEnabled(user.phone)) throw new StudentRecordError(403, 'WhatsApp doğrulaması şu anda kullanılamıyor.');
      const limits = await tx.query<{ attempts: number }>(`INSERT INTO auth_rate_limits(scope_hash,attempts,window_started_at)
        VALUES($1,1,NOW()) ON CONFLICT(scope_hash) DO UPDATE SET
        attempts=CASE WHEN auth_rate_limits.window_started_at<NOW()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END,
        window_started_at=CASE WHEN auth_rate_limits.window_started_at<NOW()-interval '15 minutes' THEN NOW() ELSE auth_rate_limits.window_started_at END RETURNING attempts`,
        [hashSetupToken('class-delete-rate:' + req.user!.id)]);
      if (limits.rows[0].attempts > 3) { await audit(tx, req, 'RATE_LIMITED'); return { denied: true as const }; }
      await lockPermanentRecords(tx);
      const state = classState(await readState(tx, req.membership!.schoolId), className);
      const plan = await permanentPlan(tx, req.membership!.schoolId, state);
      const digest = await permanentSnapshot(tx, req.membership!.schoolId, state, plan);
      if (!state.records.length || digest !== req.body.snapshot) throw new StudentRecordError(409, 'Sınıf kayıtları değişti. Önizlemeyi yenileyin.');
      const recent = await tx.query(`SELECT id FROM invitations WHERE school_id=$1 AND target_user_id=$2 AND purpose=$3 AND created_at>NOW()-INTERVAL '60 seconds' LIMIT 1`, [req.membership!.schoolId, req.user!.id, purpose]);
      if (recent.rows.length) throw new StudentRecordError(429, 'Yeni kod istemeden önce 60 saniye bekleyin.');
      await tx.query(`UPDATE invitations SET is_active=FALSE,revoked_at=NOW() WHERE school_id=$1 AND target_user_id=$2 AND purpose=$3 AND consumed_at IS NULL AND revoked_at IS NULL`, [req.membership!.schoolId, req.user!.id, purpose]);
      await tx.query(`INSERT INTO invitations(id,school_id,token,description,is_active,expires_at,purpose,target_phone,target_user_id,target_role,code_hash,created_by,attempts)
        VALUES($1::text,$2,$1::text,$3,TRUE,NOW()+interval '5 minutes',$4,$5,$6,'admin',$7,$6,0)`,
        [token, req.membership!.schoolId, JSON.stringify({ policy: 'PERMANENT_CLASS_V1', className, snapshot: digest, authVersion: user.auth_version }), purpose, user.phone, req.user!.id,
          hashSetupToken(`class-delete:${token}:${req.user!.id}:${digest}:${code}`)]);
      await audit(tx, req, 'REQUESTED');
      return { denied: false as const, phone: user.phone };
    });
    if (result.denied) throw new StudentRecordError(429, 'Çok fazla kod isteği. Lütfen daha sonra tekrar deneyin.');
    try { await sendWhatsAppAuthenticationCode(result.phone, code); }
    catch {
      await (await getDb()).query('UPDATE invitations SET is_active=FALSE,revoked_at=NOW() WHERE id=$1', [token]);
      await (await getDb()).transaction((tx) => audit(tx, req, 'DELIVERY_FAILED'));
      throw new StudentRecordError(503, 'Doğrulama kodu gönderilemedi.');
    }
    res.json({ challengeId: token, expiresInSeconds: 300 });
  } catch (error) { respond(error, res); }
});
studentRecordsRouter.post('/class-removal/complete', async (req: AuthenticatedRequest, res) => {
  try {
    const className = normalizeClassName(req.body?.className);
    if (!className || req.body?.deletionPolicy !== 'PERMANENT_CLASS_V1' || typeof req.body?.challengeId !== 'string' || !/^\d{6}$/.test(req.body?.code || '') || req.body?.confirmation !== className) throw new StudentRecordError(400, 'Sınıfı ve doğrulama kodunu kontrol edin.');
    const result = await (await getDb()).transaction(async (tx) => {
      const user = await actor(tx, req);
      if (!isWhatsAppAuthEnabled() || !isWhatsAppPhoneEnabled(user.phone)) throw new StudentRecordError(403, 'WhatsApp doğrulaması kullanılamıyor.');
      const challenge = (await tx.query<{ id: string; description: string; code_hash: string; attempts: number; valid: boolean; target_phone: string }>(`SELECT id,description,code_hash,attempts,target_phone,
        (is_active AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() AND attempts<5) AS valid
        FROM invitations WHERE id=$1 AND school_id=$2 AND target_user_id=$3 AND purpose=$4 FOR UPDATE`, [req.body.challengeId, req.membership!.schoolId, req.user!.id, purpose])).rows[0];
      if (!challenge || !challenge.valid) { await audit(tx, req, 'REJECTED'); return { denied: true as const }; }
      const context = JSON.parse(challenge.description) as { policy?: string; className: string; snapshot: string; authVersion: number };
      const expected = hashSetupToken(`class-delete:${challenge.id}:${req.user!.id}:${context.snapshot}:${req.body.code}`);
      if (context.policy !== 'PERMANENT_CLASS_V1' || context.className !== className || context.authVersion !== user.auth_version || challenge.target_phone !== user.phone ||
          !crypto.timingSafeEqual(Buffer.from(challenge.code_hash), Buffer.from(expected))) {
        await tx.query('UPDATE invitations SET attempts=attempts+1,is_active=(attempts+1<5),revoked_at=CASE WHEN attempts+1>=5 THEN NOW() ELSE revoked_at END WHERE id=$1', [challenge.id]);
        await audit(tx, req, 'INVALID_CODE'); return { denied: true as const };
      }
      await lockPermanentRecords(tx);
      const state = classState(await readState(tx, req.membership!.schoolId), className);
      const plan = await permanentPlan(tx, req.membership!.schoolId, state);
      if (!state.records.length || await permanentSnapshot(tx, req.membership!.schoolId, state, plan) !== context.snapshot) {
        await tx.query('UPDATE invitations SET is_active=FALSE,revoked_at=NOW() WHERE id=$1', [challenge.id]);
        await audit(tx, req, 'SNAPSHOT_CHANGED'); return { changed: true as const };
      }
      const removal = await permanentlyRemoveClass(tx, req.membership!.schoolId, state, plan, req.user!.id);
      await tx.query('UPDATE invitations SET consumed_at=NOW(),is_active=FALSE WHERE id=$1', [challenge.id]);
      await audit(tx, req, 'COMPLETED'); return { success: true as const, ...removal };
    });
    if ('denied' in result) return res.status(400).json({ error: 'Kod geçersiz veya süresi dolmuş.' });
    if ('changed' in result) return res.status(409).json({ error: 'Sınıf kayıtları değişti. Yeniden önizleyip onaylayın.' });
    res.json(result);
  } catch (error) { respond(error, res); }
});
// Separate contract and purpose: legacy single-class clients cannot authorize this operation.
function multiClasses(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 100) throw new StudentRecordError(400, 'En az iki, en fazla 100 ayrı sınıf seçin.');
  const names = value.map(name => typeof name === 'string' ? normalizeClassName(name) : null);
  if (names.some(name => !name || name === '__ALL__') || new Set(names).size !== names.length) throw new StudentRecordError(400, 'Ayrı ve geçerli sınıflar seçin.');
  return (names as string[]).sort();
}
function multiState(state: SchoolState, names: string[]): SchoolState {
  const parts = names.map(name => classState(state, name));
  if (parts.some(part => !part.records.length)) throw new StudentRecordError(409, 'Seçili sınıflar değişti veya bulunamadı. Önizlemeyi yenileyin.');
  return { students: parts.flatMap(part => part.students), roster: parts.flatMap(part => part.roster), parents: parts.flatMap(part => part.parents), records: parts.flatMap(part => part.records) };
}
async function multiSnapshot(tx: TransactionClient, schoolId: string, state: SchoolState, plan: PermanentPlan, names: string[]) {
  return hashSetupToken(JSON.stringify({ policy: multiPolicy, classNames: names, snapshot: await permanentSnapshot(tx, schoolId, state, plan) }));
}
async function multiAudit(tx: TransactionClient, req: AuthenticatedRequest, outcome: string, names: string[]) {
  await auditLogRepository.createAuditLog({ schoolId: req.membership!.schoolId, action: 'class.multi_delete', actorName: 'Yetkili yönetici', actorUserId: req.user!.id,
    details: JSON.stringify({ outcome, classCount: names.length, selectionHash: hashSetupToken(JSON.stringify(names)) }) }, tx);
}
studentRecordsRouter.use('/multi-class-removal', (_req, res, next) => {
  if (!classMultiDeleteEnabled()) return res.status(404).json({ error: 'Çoklu sınıf silme etkin değil.' });
  next();
});
studentRecordsRouter.post('/multi-class-removal/preview', async (req: AuthenticatedRequest, res) => {
  try {
    const names = multiClasses(req.body?.classNames);
    const result = await (await getDb()).transaction(async tx => {
      await actor(tx, req); await lockPermanentRecords(tx);
      const schoolId = req.membership!.schoolId, state = multiState(await readState(tx, schoolId), names);
      const plan = await permanentPlan(tx, schoolId, state);
      await tx.query(`UPDATE invitations SET is_active=FALSE,revoked_at=NOW() WHERE school_id=$1 AND target_user_id=$2 AND purpose=$3
        AND consumed_at IS NULL AND revoked_at IS NULL AND (description::jsonb->>'selectionHash') IS DISTINCT FROM $4`,
        [schoolId, req.user!.id, multiPurpose, hashSetupToken(JSON.stringify(names))]);
      return { classNames: names, studentCount: plan.studentCount, relationCount: plan.relationCount, preservedAccounts: plan.preservedAccounts,
        removableAccounts: plan.removableAccounts, appointmentCount: plan.appointmentCount, qrCount: plan.qrCount,
        notificationCount: plan.notificationIds.length, deliveryCount: plan.deliveryIds.length, snapshot: await multiSnapshot(tx, schoolId, state, plan, names) };
    });
    res.json(result);
  } catch (error) { respond(error, res); }
});
studentRecordsRouter.post('/multi-class-removal/cancel', async (req: AuthenticatedRequest, res) => {
  try {
    if (typeof req.body?.challengeId !== 'string') throw new StudentRecordError(400, 'Doğrulama işlemini kontrol edin.');
    await (await getDb()).transaction(async tx => {
      await actor(tx, req);
      await tx.query(`UPDATE invitations SET is_active=FALSE,revoked_at=NOW() WHERE id=$1 AND school_id=$2 AND target_user_id=$3 AND purpose=$4 AND consumed_at IS NULL`,
        [req.body.challengeId, req.membership!.schoolId, req.user!.id, multiPurpose]);
      await multiAudit(tx, req, 'CANCELLED', []);
    });
    res.json({ success: true });
  } catch (error) { respond(error, res); }
});
studentRecordsRouter.post('/multi-class-removal/request-code', async (req: AuthenticatedRequest, res) => {
  try {
    const names = multiClasses(req.body?.classNames);
    if (req.body?.deletionPolicy !== multiPolicy || req.body?.confirmation !== multiConfirmation || typeof req.body?.snapshot !== 'string') throw new StudentRecordError(400, 'Silme kapsamını açıkça onaylayın.');
    const code = generateStaffCode(), token = crypto.randomUUID();
    const result = await (await getDb()).transaction(async tx => {
      const user = await actor(tx, req), schoolId = req.membership!.schoolId;
      if (!isWhatsAppAuthEnabled() || !isWhatsAppPhoneEnabled(user.phone)) throw new StudentRecordError(403, 'WhatsApp doğrulaması kullanılamıyor.');
      const limits = await tx.query<{ attempts: number }>(`INSERT INTO auth_rate_limits(scope_hash,attempts,window_started_at) VALUES($1,1,NOW())
        ON CONFLICT(scope_hash) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.window_started_at<NOW()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END,
        window_started_at=CASE WHEN auth_rate_limits.window_started_at<NOW()-interval '15 minutes' THEN NOW() ELSE auth_rate_limits.window_started_at END RETURNING attempts`, [hashSetupToken('class-delete-rate:' + req.user!.id)]);
      if (limits.rows[0].attempts > 3) { await multiAudit(tx, req, 'RATE_LIMITED', names); return { denied: true as const }; }
      await lockPermanentRecords(tx);
      const state = multiState(await readState(tx, schoolId), names), plan = await permanentPlan(tx, schoolId, state);
      const digest = await multiSnapshot(tx, schoolId, state, plan, names);
      if (digest !== req.body.snapshot) throw new StudentRecordError(409, 'Kayıtlar değişti. Önizlemeyi yenileyin.');
      const recent = await tx.query(`SELECT id FROM invitations WHERE school_id=$1 AND target_user_id=$2 AND purpose=$3 AND created_at>NOW()-interval '60 seconds' LIMIT 1`, [schoolId, req.user!.id, multiPurpose]);
      if (recent.rows.length) throw new StudentRecordError(429, 'Yeni kod istemeden önce 60 saniye bekleyin.');
      await tx.query(`UPDATE invitations SET is_active=FALSE,revoked_at=NOW() WHERE school_id=$1 AND target_user_id=$2 AND purpose=$3 AND consumed_at IS NULL AND revoked_at IS NULL`, [schoolId, req.user!.id, multiPurpose]);
      // Store only fixed-size digests; invitations.description is VARCHAR(255), even for 100 classes.
      await tx.query(`INSERT INTO invitations(id,school_id,token,description,is_active,expires_at,purpose,target_phone,target_user_id,target_role,code_hash,created_by,attempts)
        VALUES($1::text,$2,$1::text,$3,TRUE,NOW()+interval '5 minutes',$4,$5,$6,'admin',$7,$6,0)`, [token, schoolId,
        JSON.stringify({ policy: multiPolicy, selectionHash: hashSetupToken(JSON.stringify(names)), snapshot: digest, authVersion: user.auth_version }),
        multiPurpose, user.phone, req.user!.id, hashSetupToken(`multi-class-delete:${token}:${req.user!.id}:${digest}:${code}`)]);
      await multiAudit(tx, req, 'REQUESTED', names);
      return { denied: false as const, phone: user.phone };
    });
    if (result.denied) throw new StudentRecordError(429, 'Çok fazla kod isteği. Lütfen daha sonra tekrar deneyin.');
    try { await sendWhatsAppAuthenticationCode(result.phone, code); }
    catch {
      await (await getDb()).query('UPDATE invitations SET is_active=FALSE,revoked_at=NOW() WHERE id=$1', [token]);
      await (await getDb()).transaction(tx => multiAudit(tx, req, 'DELIVERY_FAILED', names));
      throw new StudentRecordError(503, 'Doğrulama kodu gönderilemedi.');
    }
    res.json({ challengeId: token, expiresInSeconds: 300, resendAfterSeconds: 60 });
  } catch (error) { respond(error, res); }
});
studentRecordsRouter.post('/multi-class-removal/complete', async (req: AuthenticatedRequest, res) => {
  try {
    const names = multiClasses(req.body?.classNames);
    if (req.body?.deletionPolicy !== multiPolicy || req.body?.confirmation !== multiConfirmation || typeof req.body?.challengeId !== 'string' || !/^\d{6}$/.test(req.body?.code || '')) throw new StudentRecordError(400, 'Silme kapsamını ve kodu kontrol edin.');
    const result = await (await getDb()).transaction(async tx => {
      const user = await actor(tx, req), schoolId = req.membership!.schoolId;
      if (!isWhatsAppAuthEnabled() || !isWhatsAppPhoneEnabled(user.phone)) throw new StudentRecordError(403, 'WhatsApp doğrulaması kullanılamıyor.');
      const challenge = (await tx.query<{ id: string; description: string; code_hash: string; target_phone: string; valid: boolean }>(`SELECT id,description,code_hash,target_phone,
        (is_active AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() AND attempts<5) AS valid FROM invitations
        WHERE id=$1 AND school_id=$2 AND target_user_id=$3 AND purpose=$4 FOR UPDATE`, [req.body.challengeId, schoolId, req.user!.id, multiPurpose])).rows[0];
      if (!challenge?.valid) { await multiAudit(tx, req, 'REJECTED', names); return { denied: true as const }; }
      const context = JSON.parse(challenge.description) as { policy: string; selectionHash: string; snapshot: string; authVersion: number };
      if (context.policy !== multiPolicy || context.selectionHash !== hashSetupToken(JSON.stringify(names)) || context.authVersion !== user.auth_version || challenge.target_phone !== user.phone) {
        await tx.query('UPDATE invitations SET is_active=FALSE,revoked_at=NOW() WHERE id=$1', [challenge.id]);
        await multiAudit(tx, req, 'SCOPE_CHANGED', names); return { denied: true as const };
      }
      const expected = hashSetupToken(`multi-class-delete:${challenge.id}:${req.user!.id}:${context.snapshot}:${req.body.code}`);
      if (challenge.code_hash.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(challenge.code_hash), Buffer.from(expected))) {
        await tx.query('UPDATE invitations SET attempts=attempts+1,is_active=(attempts+1<5),revoked_at=CASE WHEN attempts+1>=5 THEN NOW() ELSE revoked_at END WHERE id=$1', [challenge.id]);
        await multiAudit(tx, req, 'INVALID_CODE', names); return { denied: true as const };
      }
      await lockPermanentRecords(tx);
      const fullState = await readState(tx, schoolId);
      if (names.some(name => !fullState.records.some(record => record.className === name))) {
        await tx.query('UPDATE invitations SET is_active=FALSE,revoked_at=NOW() WHERE id=$1', [challenge.id]);
        await multiAudit(tx, req, 'SNAPSHOT_CHANGED', names); return { changed: true as const };
      }
      const state = multiState(fullState, names), plan = await permanentPlan(tx, schoolId, state);
      if (await multiSnapshot(tx, schoolId, state, plan, names) !== context.snapshot) {
        await tx.query('UPDATE invitations SET is_active=FALSE,revoked_at=NOW() WHERE id=$1', [challenge.id]);
        await multiAudit(tx, req, 'SNAPSHOT_CHANGED', names); return { changed: true as const };
      }
      const removal = await permanentlyRemoveClass(tx, schoolId, state, plan, req.user!.id, names);
      await tx.query('UPDATE invitations SET consumed_at=NOW(),is_active=FALSE WHERE id=$1', [challenge.id]);
      await multiAudit(tx, req, 'COMPLETED', names); return { success: true as const, ...removal };
    });
    if ('denied' in result) return res.status(400).json({ error: 'Kod geçersiz veya süresi dolmuş.' });
    if ('changed' in result) return res.status(409).json({ error: 'Kayıtlar değişti. Yeniden önizleyip onaylayın.' });
    res.json(result);
  } catch (error) {
    // The destructive transaction rolls back, but its failure should still be auditable.
    try {
      const names = multiClasses(req.body?.classNames);
      await (await getDb()).transaction(async tx => { await actor(tx, req); await multiAudit(tx, req, 'FAILED', names); });
    } catch { /* An unavailable database may also prevent auditing; retain the original failure. */ }
    respond(error, res);
  }
});
function respond(error: unknown, res: import('express').Response) {
  res.status(error instanceof StudentRecordError ? error.status : 500).json({ error: error instanceof StudentRecordError ? error.message : 'Öğrenci işlemi tamamlanamadı.' });
}
