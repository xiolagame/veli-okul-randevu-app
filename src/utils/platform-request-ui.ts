import type { PlatformRequestItem, PlatformRequestStatus, PlatformRequestType } from '../types/platform';

export type PlatformRequestStatusFilter = '' | 'ALL' | PlatformRequestStatus;
export type PlatformRequestTypeFilter = '' | PlatformRequestType;

const allowedTransitions: Record<PlatformRequestStatus, PlatformRequestStatus[]> = {
  NEW: ['NEW', 'IN_PROGRESS', 'WAITING_PAYMENT', 'RESOLVED', 'ARCHIVED'],
  IN_PROGRESS: ['IN_PROGRESS', 'WAITING_PAYMENT', 'RESOLVED', 'ARCHIVED'],
  WAITING_PAYMENT: ['WAITING_PAYMENT', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED'],
  RESOLVED: ['RESOLVED', 'IN_PROGRESS', 'ARCHIVED'],
  ARCHIVED: ['ARCHIVED', 'IN_PROGRESS'],
};

export function filterPlatformRequests(
  requests: PlatformRequestItem[],
  status: PlatformRequestStatusFilter,
  requestType: PlatformRequestTypeFilter,
): PlatformRequestItem[] {
  return requests.filter((request) => {
    const matchesStatus = status === ''
      ? request.status !== 'ARCHIVED'
      : status === 'ALL' || request.status === status;
    const matchesType = requestType === '' || request.requestType === requestType;
    return matchesStatus && matchesType;
  });
}

export function getPlatformRequestStatusOptions(
  status: PlatformRequestStatus,
  requestType: PlatformRequestType,
): PlatformRequestStatus[] {
  return allowedTransitions[status].filter((option) => (
    option !== 'WAITING_PAYMENT' || requestType === 'MONTHLY_LICENSE' || requestType === 'YEARLY_LICENSE'
  ));
}

export function isBasicEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
