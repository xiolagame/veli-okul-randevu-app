import type { Appointment } from '../types';

export const operationCategories = ['pending-parents', 'pending-staff', 'pending-appointments', 'today', 'missing', 'teachers', 'appointments'] as const;
export type OperationCategory = typeof operationCategories[number];
export interface OperationItem {
  id: string;
  kind: 'parent' | 'staff' | 'appointment' | 'missing';
  name: string;
  phone?: string;
  email?: string;
  role?: 'teacher' | 'security';
  branch?: string;
  status?: string;
  activationCreatedAt?: string;
  issues?: string[];
  editKind?: 'student' | 'roster' | 'teacher' | 'security';
  values?: Record<string, string>;
  students?: Array<{ id: string; name: string; className: string; studentNumber: string; birthDate?: string }>;
  appointment?: Pick<Appointment, 'id' | 'studentName' | 'parentName' | 'teacherName' | 'className' | 'date' | 'startTime' | 'endTime' | 'status' | 'notes'>;
}
export interface OperationSummary {
  counts: Record<OperationCategory, number>;
  statuses: Partial<Record<Appointment['status'], number>>;
}
export interface OperationPage { items: OperationItem[]; total: number; page: number; pageSize: number }
