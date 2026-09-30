export interface ManagedSchool {
  id: string;
  name: string;
  code: string;
  city: string;
  district: string;
  disabledAt: string | null;
  licenseCode: string | null;
  licenseStatus: 'active' | 'suspended' | 'revoked' | 'legacy';
  licenseExpiresAt: string | null;
  adminStatus: 'unassigned' | 'pending' | 'active';
  adminName: string | null;
}

export type PlatformRequestSource = 'PUBLIC' | 'SCHOOL_ADMIN';
export type PlatformRequestType = 'MONTHLY_LICENSE' | 'YEARLY_LICENSE' | 'CONTACT' | 'SUPPORT';
export type PlatformRequestStatus = 'NEW' | 'IN_PROGRESS' | 'WAITING_PAYMENT' | 'RESOLVED' | 'ARCHIVED';

export interface PlatformRequestItem {
  id: string;
  schoolId: string | null;
  createdByUserId: string | null;
  source: PlatformRequestSource;
  requestType: PlatformRequestType;
  schoolName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  teacherCount: number | null;
  subject: string | null;
  message: string;
  status: PlatformRequestStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  archivedAt: string | null;
}
