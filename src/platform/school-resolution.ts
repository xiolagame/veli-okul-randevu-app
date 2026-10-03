import type { School, SchoolMembership } from '../types';
import type { ManagedSchool } from '../types/platform';

export type SchoolResolution =
  | { kind: 'MEMBERSHIP'; school: School; membership: SchoolMembership; schoolId: string }
  | { kind: 'PLATFORM_TARGET'; school: ManagedSchool; membership: null; schoolId: string }
  | { kind: 'NO_ACCESS'; school: null; membership: null; schoolId: null };

export function resolveSchoolContext(options: {
  memberships: SchoolMembership[];
  accessibleSchools: School[];
  managedSchools: ManagedSchool[];
  isPlatformAdmin: boolean;
  preferredSchoolId?: string | null;
  preferredPlatformTargetId?: string | null;
}): SchoolResolution {
  const activeManagedSchools = options.isPlatformAdmin
    ? options.managedSchools.filter((school) => !school.disabledAt)
    : [];
  if (options.isPlatformAdmin) {
    const platformTarget = activeManagedSchools.find((school) => school.id === options.preferredPlatformTargetId)
      ?? activeManagedSchools.find((school) => school.id === options.preferredSchoolId)
      ?? activeManagedSchools[0];
    return platformTarget
      ? { kind: 'PLATFORM_TARGET', school: platformTarget, membership: null, schoolId: platformTarget.id }
      : { kind: 'NO_ACCESS', school: null, membership: null, schoolId: null };
  }

  const accessibleMemberships = options.memberships.filter((membership) =>
    membership.status === 'active' && options.accessibleSchools.some((school) => school.id === membership.schoolId));
  const membership = accessibleMemberships.find((entry) => entry.schoolId === options.preferredSchoolId)
    ?? accessibleMemberships[0];
  if (membership) {
    const school = options.accessibleSchools.find((entry) => entry.id === membership.schoolId)!;
    return { kind: 'MEMBERSHIP', school, membership, schoolId: school.id };
  }

  return { kind: 'NO_ACCESS', school: null, membership: null, schoolId: null };
}
