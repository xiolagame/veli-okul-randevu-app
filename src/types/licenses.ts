export type LicenseViewStatus = 'active' | 'expiring' | 'expired' | 'suspended' | 'revoked' | 'legacy';
export interface PlatformLicense {
  schoolId: string; schoolName: string; schoolCode: string; schoolDisabledAt: string | null;
  licenseId: string | null; licenseCode: string | null; status: 'active' | 'suspended' | 'revoked' | null;
  activatedAt: string | null; expiresAt: string | null; updatedAt: string | null;
  viewStatus: LicenseViewStatus; remainingDays: number | null; expired: boolean; revision: string;
}
export interface LicensePage {
  items: PlatformLicense[]; total: number; page: number; pageSize: number;
  summary: { total: number; active: number; expiring: number; expired: number; suspended: number };
}
export interface LicenseChange {
  action: 'expiry' | 'suspend' | 'resume'; expectedRevision: string; note: string;
  expiresAt?: string; confirmedShortening?: boolean;
}
