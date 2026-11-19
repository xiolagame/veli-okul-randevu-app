import { randomUUID } from 'node:crypto';
import { getDb, TransactionClient } from './database/postgres';
import { auditLogRepository } from './repositories';
import { RosterDraft, RosterPreview, validateRosterRow } from '../src/utils/roster-import';
import { normalizeTurkishPhone } from '../src/utils/phone';

export class RosterImportError extends Error {}

async function inspect(tx: TransactionClient, schoolId: string, records: unknown[]): Promise<RosterPreview[]> {
  const existing = await tx.query<{student_name: string; student_number: string | null; class_name: string; parent_name: string; parent_phone: string; birth_date: string | null}>(`
    SELECT student_name,student_number,class_name,parent_name,parent_phone,birth_date::text FROM school_roster WHERE school_id=$1
    UNION ALL
    SELECT s.name,s.student_number,s.class_name,concat_ws(' ',u.first_name,u.last_name),u.phone,s.birth_date::text
    FROM students s JOIN student_parent_relations rel ON rel.school_id=s.school_id AND rel.student_id=s.id
    JOIN users u ON u.id=rel.parent_user_id WHERE s.school_id=$1`, [schoolId]);
  const seen: RosterDraft[] = existing.rows.map((row) => ({ studentName: row.student_name, studentNumber: row.student_number || '', className: row.class_name, parentName: row.parent_name, parentPhone: normalizeTurkishPhone(row.parent_phone) || '', birthDate: row.birth_date || '' }));
  const numbered = new Map<string,RosterDraft>(), names = new Map<string,RosterDraft>(), emptyNumbers = new Map<string,RosterDraft>();
  const prefix = (r: RosterDraft) => JSON.stringify([r.className,r.parentPhone]);
  const byName = (r: RosterDraft) => prefix(r)+':'+r.studentName.toLocaleLowerCase('tr-TR');
  const remember = (r: RosterDraft) => { if(r.studentNumber) { const k=prefix(r)+':'+r.studentNumber;if(!numbered.has(k))numbered.set(k,r); } else if(!emptyNumbers.has(byName(r)))emptyNumbers.set(byName(r),r);if(!names.has(byName(r)))names.set(byName(r),r); };
  seen.forEach(remember);
  return records.map((value, index) => {
    const result = validateRosterRow(value);
    if (result.status === 'invalid') return { ...result, errors: result.errors.map((error) => `Satır ${index + 2}: ${error}`) };
    const match = result.record.studentNumber ? numbered.get(prefix(result.record)+':'+result.record.studentNumber) || emptyNumbers.get(byName(result.record)) : names.get(byName(result.record));
    if (match) {
      if (match.studentName.toLocaleLowerCase('tr-TR') !== result.record.studentName.toLocaleLowerCase('tr-TR')) return { ...result, status: 'invalid', errors: ['Öğrenci numarası mevcut öğrenci adıyla uyuşmuyor.'] };
      if (match.birthDate && result.record.birthDate && match.birthDate !== result.record.birthDate) return { ...result, status: 'invalid', errors: ['Mevcut öğrenci kaydıyla doğum tarihi uyuşmuyor.'] };
      return { ...result, status: 'duplicate', errors: ['Aynı kayıt zaten mevcut.'] };
    }
    remember(result.record);
    return result;
  });
}


export async function processRosterImport(schoolId: string, records: unknown, preview: boolean, actorName: string, actorUserId?: string) {
  if (!Array.isArray(records) || records.length === 0) throw new RosterImportError('En az bir kayıt yükleyin.');
  const db = await getDb();
  return db.transaction(tx => processRosterImportTransaction(tx,schoolId,records,preview,actorName,actorUserId));
}

export async function processRosterImportTransaction(tx: TransactionClient, schoolId: string, records: unknown[], preview: boolean, actorName: string, actorUserId?: string, skipInvalid = false) {
    const school = await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [schoolId]);
    if (!school.rows.length) throw new RosterImportError('Okula erişilemiyor.');
    const rows = await inspect(tx, schoolId, records);
    if (!preview && !skipInvalid && rows.some((row) => row.status === 'invalid')) throw new RosterImportError('Hatalı satırları düzeltip yeniden önizleyin.');
    let addedCount = 0;
    if (!preview) {
      const valid = rows.filter(row => row.status === 'valid').map(({record}) => ({id:'rost-'+randomUUID(),...record}));
      if(valid.length) await tx.query(`INSERT INTO school_roster(id,school_id,student_name,student_number,parent_name,parent_phone,birth_date,class_name)
        SELECT x.id,$1,x."studentName",NULLIF(x."studentNumber",''),x."parentName",x."parentPhone",NULLIF(x."birthDate",'')::date,x."className"
        FROM jsonb_to_recordset($2::jsonb) AS x(id text,"studentName" text,"studentNumber" text,"parentName" text,"parentPhone" text,"birthDate" text,"className" text)`,[schoolId,JSON.stringify(valid)]);
      addedCount=valid.length;
      const classNames = [...new Set(rows.filter((row) => row.status === 'valid').map((row) => row.record.className))];
      await auditLogRepository.createAuditLog({ schoolId, action: 'roster.bulk_imported', actorName, actorUserId, details: JSON.stringify({ classNames, addedCount }) }, tx);
    }
    return { success: true, rows, addedCount, skippedCount: rows.filter((row) => row.status === 'duplicate').length };
}
