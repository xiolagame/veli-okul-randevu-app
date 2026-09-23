export type UserRole = 'parent' | 'teacher' | 'security' | 'admin';

export type AppointmentStatus =
  | 'pending'
  | 'booked'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'rejected';

export interface SchoolSettings {
  schoolName: string;
  appName: string;
  defaultSlotMinutes: number;
  minSlotMinutes: number;
  maxBookingDaysAhead: number;
  allowParentCancel: boolean;
}

export interface School {
  id: string;
  name: string;
  code: string; // Context code, e.g. KAZAN2025 (does not grant membership alone)
  city: string;
  district: string;
  logoUrl?: string;
  settings: SchoolSettings;
  createdAt?: string;
}

export interface SchoolMembership {
  id: string;
  schoolId: string;
  userId: string;
  role: UserRole;
  branch?: string; // For teachers
  status: 'active' | 'suspended' | 'pending';
  joinedAt: string;
}

export interface SchoolRosterRecord {
  id: string;
  schoolId: string;
  parentPhone: string;
  parentName: string;
  studentName: string;
  className: string;
  studentNumber?: string;
  isClaimed: boolean;
}

export interface Student {
  id: string;
  schoolId?: string;
  name: string;
  className: string;
  studentNumber?: string;
}

export interface StudentParentRelation {
  id: string;
  schoolId: string;
  studentId: string;
  parentUserId: string;
  verifiedAt: string;
}

export interface User {
  id: string;
  role?: UserRole; // Current active role in active school context
  firstName: string;
  lastName: string;
  phone: string;
  branch?: string; // For teachers
  students?: Student[]; // For parents (in current active school)
  securityQuestion?: string;
  isPhoneVerified?: boolean;
  disabled?: boolean;
  createdAt?: string;
}

export interface TeacherProfile {
  id: string;
  schoolId?: string;
  userId?: string;
  firstName: string;
  lastName: string;
  phone: string;
  branch: string;
  avatarUrl?: string;
  bio?: string;
}

export interface AvailabilitySlot {
  id: string;
  schoolId?: string;
  teacherId: string;
  dayOfWeek: number; // 1 = Pazartesi, 5 = Cuma
  startTime: string; // "09:00"
  endTime: string;   // "11:30"
  slotDurationMinutes: number; // 15
  isBlocked?: boolean;
}

export interface Appointment {
  id: string;
  schoolId?: string;
  teacherId: string;
  teacherName: string;
  teacherBranch: string;
  parentId: string;
  parentName: string;
  parentPhone: string;
  studentId?: string;
  studentName: string;
  className: string;
  date: string; // YYYY-MM-DD
  startTime: string; // "09:00"
  endTime: string;   // "09:15"
  status: AppointmentStatus;
  entryCode?: string;
  notes?: string;
  rejectionReason?: string;
  createdAt: string;
  approvedAt?: string;
  checkedInAt?: string;
  checkedOutAt?: string;
  qrToken?: string;
  approvedBy?: string;
  checkedInBy?: string;
}

export type SecurityQrDecision =
  | 'APPROVED'
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'CANCELLED'
  | 'ALREADY_CHECKED_IN'
  | 'EXPIRED'
  | 'TOO_EARLY'
  | 'INVALID';

export interface SecurityQrAppointment {
  id: string;
  parentName: string;
  studentName: string;
  className: string;
  teacherName: string;
  teacherBranch: string;
  date: string;
  startTime: string;
  endTime: string;
  checkedInAt?: string;
}

export interface SecurityQrVerification {
  success: boolean;
  allowed: boolean;
  decision: SecurityQrDecision;
  title: string;
  message: string;
  appointment?: SecurityQrAppointment;
}

export interface NotificationItem {
  id: string;
  schoolId?: string;
  userId: string;
  title: string;
  message: string;
  date: string;
  read: boolean;
  appointmentId?: string;
}

export interface AuditLogItem {
  id: string;
  schoolId?: string;
  timestamp: string;
  action: string;
  actorName: string;
  details: string;
}

export interface TenantIsolationTestResult {
  title: string;
  description: string;
  passed: boolean;
  details: string;
}
