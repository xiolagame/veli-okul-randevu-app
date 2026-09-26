import { getDb, type TransactionClient } from '../server/database/postgres';
import { normalizePersonName } from '../src/utils/person-name';

const fields = [
  ['users', ['first_name', 'last_name']],
  ['teacher_profiles', ['first_name', 'last_name']],
  ['students', ['name']],
  ['school_roster', ['parent_name', 'student_name']],
  ['pending_staff', ['first_name', 'last_name']],
  ['appointments', ['teacher_name', 'parent_name', 'student_name']],
] as const;

export async function normalizePersonNames(transaction: TransactionClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [table, columns] of fields) {
    const result = await transaction.query<Record<string, string | null>>(`SELECT id,${columns.join(',')} FROM ${table}`);
    let changed = 0;
    for (const row of result.rows) {
      const normalized = columns.map((column) => row[column] === null ? null : normalizePersonName(row[column] || ''));
      if (columns.every((column, index) => row[column] === normalized[index])) continue;
      await transaction.query(`UPDATE ${table} SET ${columns.map((column, index) => `${column}=$${index + 2}`).join(',')} WHERE id=$1`, [row.id, ...normalized]);
      changed++;
    }
    counts[table] = changed;
  }
  const users = await transaction.query<{ first_name: string | null; last_name: string | null }>('SELECT first_name,last_name FROM users');
  const knownNames = new Set(users.rows.map((user) => normalizePersonName(`${user.first_name || ''} ${user.last_name || ''}`)).filter(Boolean));
  const audit = await transaction.query<{ id: string; actor_name: string }>('SELECT id,actor_name FROM audit_logs');
  let auditChanged = 0;
  for (const row of audit.rows) {
    const suffixStart = row.actor_name.indexOf(' (');
    const name = suffixStart < 0 ? row.actor_name : row.actor_name.slice(0, suffixStart);
    const normalized = normalizePersonName(name);
    if (!knownNames.has(normalized)) continue;
    const value = normalized + (suffixStart < 0 ? '' : row.actor_name.slice(suffixStart));
    if (value === row.actor_name) continue;
    await transaction.query('UPDATE audit_logs SET actor_name=$2 WHERE id=$1', [row.id, value]);
    auditChanged++;
  }
  counts.audit_logs = auditChanged;
  return counts;
}

async function main() {
  if (!process.argv.includes('--apply')) throw new Error('Backfill requires explicit --apply. Production execution is a separate deployment decision.');
  const db = await getDb();
  const counts = await db.transaction(normalizePersonNames);
  for (const [table, count] of Object.entries(counts)) console.log(`${table}: ${count} rows normalized`);
}

if (process.argv[1]?.endsWith('normalize-person-names.ts')) {
  main().catch(() => { console.error('Person-name backfill failed. No personal data logged.'); process.exitCode = 1; });
}
