import { normalizeClassName } from './class-name';
import { normalizeTurkishPhone } from './phone';

export interface SchoolStudentRecord {
  id: string;
  kind: 'student' | 'roster';
  name: string;
  className: string;
  studentNumber: string;
  birthDate: string;
  parents: Array<{ id?: string; rosterId?: string; fullName: string; phone: string; status: string }>;
}
export const ALL_CLASSES = '__ALL__';
export function studentRecordIssues(record: SchoolStudentRecord): string[] {
  const issues: string[] = [];
  if (!record.name.trim()) issues.push('Öğrenci adı eksik');
  if (!record.className.trim()) issues.push('Sınıf eksik');
  if (!record.parents.length) issues.push('Veli bağlantısı yok');
  for (const parent of record.parents.filter((p) => p.status !== 'deleted')) {
    if (!parent.fullName.trim()) issues.push('Veli adı eksik');
    if (!normalizeTurkishPhone(parent.phone)) issues.push('Telefon eksik veya geçersiz');
    if (parent.status === 'unlinked') issues.push('Mevcut hesapla öğrenci bağlantısı tamamlanmamış');
  }
  return [...new Set(issues)];
}
export function classSummaries(records: SchoolStudentRecord[]) {
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.className, (counts.get(record.className) || 0) + 1);
  return [...counts].map(([className, count]) => ({ className, count })).sort((a, b) => a.className.localeCompare(b.className, 'tr', { numeric: true }));
}
export function classTone(className: string): string {
  const grade = Number(/^(\d+)/.exec(className)?.[1]);
  return ({ 5: 'green', 6: 'blue', 7: 'orange', 8: 'red' } as Record<number, string>)[grade] || 'blue';
}
export function studentIdentity(name: string, className: string, number: string | null): string {
  return JSON.stringify([name.trim().toLocaleUpperCase('tr-TR'), normalizeClassName(className), number || '']);
}
