import { randomUUID } from 'node:crypto';
import { getDb, TransactionClient } from './database/postgres';
import { auditLogRepository } from './repositories';
import { MAX_ROSTER_ROWS, RosterDraft, RosterPreview, sameRosterIdentity, validateRosterRow } from '../src/utils/roster-import';
import { normalizeTurkishPhone } from '../src/utils/phone';

export class RosterImportError extends Error {}

async function inspect(tx: TransactionClient, schoolId: string, className: string, records: unknown[]): Promise<RosterPreview[]> {
  const existing = await tx.query<{student_name: string; student_number: string | null; parent_name: string; parent_phone: string; birth_date: string | null}>(`
    SELECT student_name,student_number,parent_name,parent_phone,birth_date::text FROM school_roster WHERE school_id=$1 AND class_name=$2
    UNION ALL
    SELECT s.name,s.student_number,concat_ws(' ',u.first_name,u.last_name),u.phone,s.birth_date::text
    FROM students s JOIN student_parent_relations rel ON rel.school_id=s.school_id AND rel.student_id=s.id
    JOIN users u ON u.id=rel.parent_user_id WHERE s.school_id=$1 AND s.class_name=$2`, [schoolId, className]);
  const seen: RosterDraft[] = existing.rows.map((row) => ({ studentName: row.student_name, studentNumber: row.student_number || '', parentName: row.parent_name, parentPhone: normalizeTurkishPhone(row.parent_phone) || '', birthDate: row.birth_date || '' }));
  return records.map((value) => {
    const result = validateRosterRow(value);
    if (result.status === 'invalid') return result;
    const match = seen.find((entry) => sameRosterIdentity(entry, result.record));
    if (match) {
      if (match.studentName.toLocaleLowerCase('tr-TR') !== result.record.studentName.toLocaleLowerCase('tr-TR')) return { ...result, status: 'invalid', errors: ['Öğrenci numarası mevcut öğrenci adıyla uyuşmuyor.'] };
      if (match.birthDate && match.birthDate !== result.record.birthDate) return { ...result, status: 'invalid', errors: ['Mevcut öğrenci kaydıyla doğum tarihi uyuşmuyor.'] };
      return { ...result, status: 'duplicate', errors: ['Aynı kayıt zaten mevcut.'] };
    }
    seen.push(result.record);
    return result;
  });
}

export async function processRosterImport(schoolId: string, selectedClass: unknown, records: unknown, preview: boolean, actorName: string) {
  if (typeof selectedClass !== 'string' || !selectedClass.trim() || selectedClass.trim().length > 50 || /[\x00-\x1f]/.test(selectedClass)) throw new RosterImportError('Önce geçerli bir sınıf seçin.');
  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_ROSTER_ROWS) throw new RosterImportError('1–500 kayıt yükleyin.');
  const className = selectedClass.trim();
  const db = await getDb();
  return db.transaction(async (tx) => {
    const school = await tx.query('SELECT id FROM schools WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [schoolId]);
    if (!school.rows.length) throw new RosterImportError('Okula erişilemiyor.');
    const rows = await inspect(tx, schoolId, className, records);
    if (!preview && rows.some((row) => row.status === 'invalid')) throw new RosterImportError('Hatalı satırları düzeltip yeniden önizleyin.');
    let addedCount = 0;
    if (!preview) {
      for (const { record, status } of rows) {
        if (status !== 'valid') continue;
        await tx.query(`INSERT INTO school_roster(id,school_id,student_name,student_number,parent_name,parent_phone,birth_date,class_name)
          VALUES($1,$2,$3,$4,$5,$6,$7::date,$8)`, ['rost-' + randomUUID(),schoolId,record.studentName,record.studentNumber || null,record.parentName,record.parentPhone,record.birthDate,className]);
        addedCount++;
      }
      await auditLogRepository.createAuditLog({ schoolId, action: 'roster.bulk_imported', actorName, details: JSON.stringify({ className, addedCount }) }, tx);
    }
    return { success: true, rows, addedCount, skippedCount: rows.filter((row) => row.status === 'duplicate').length };
  });
}
