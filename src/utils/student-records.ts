import { normalizeClassName } from './class-name';

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
