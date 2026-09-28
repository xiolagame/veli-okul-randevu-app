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
