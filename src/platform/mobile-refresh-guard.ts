export interface MobileRefreshIdentity {
  sequence: number;
  revision: number;
  notificationRevision: number;
  schoolId: string;
}

export function isCurrentMobileRefresh(expected: MobileRefreshIdentity, current: MobileRefreshIdentity): boolean {
  return expected.sequence === current.sequence
    && expected.revision === current.revision
    && expected.notificationRevision === current.notificationRevision
    && expected.schoolId === current.schoolId;
}
