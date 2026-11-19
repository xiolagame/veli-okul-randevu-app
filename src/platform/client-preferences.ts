const ACTIVE_SCHOOL_STORAGE_KEY = 'veli_active_school_id';
const PLATFORM_TARGET_SCHOOL_STORAGE_KEY = 'veli_platform_target_school_id';

function getBrowserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

let currentSchoolId: string | null = getBrowserStorage()?.getItem(ACTIVE_SCHOOL_STORAGE_KEY) ?? null;
let platformTargetSchoolId: string | null = getBrowserStorage()?.getItem(PLATFORM_TARGET_SCHOOL_STORAGE_KEY) ?? null;

export function setActiveSchoolId(schoolId: string | null): void {
  currentSchoolId = schoolId;
  const storage = getBrowserStorage();
  if (schoolId) storage?.setItem(ACTIVE_SCHOOL_STORAGE_KEY, schoolId);
  else storage?.removeItem(ACTIVE_SCHOOL_STORAGE_KEY);
}

export function getActiveSchoolId(): string | null {
  return currentSchoolId;
}

export function setPlatformTargetSchoolId(schoolId: string | null): void {
  platformTargetSchoolId = schoolId;
  const storage = getBrowserStorage();
  if (schoolId) storage?.setItem(PLATFORM_TARGET_SCHOOL_STORAGE_KEY, schoolId);
  else storage?.removeItem(PLATFORM_TARGET_SCHOOL_STORAGE_KEY);
}

export function getPlatformTargetSchoolId(): string | null {
  return platformTargetSchoolId;
}

export function clearAuthSensitivePreferences(): void {
  setActiveSchoolId(null);
  setPlatformTargetSchoolId(null);
}
