import type { PlatformRequestType } from '../types/platform';

export const PUBLIC_REQUEST_PATH = '/lisans-iletisim';
export const HELP_PATH = '/yardim';
export const PUBLIC_CONTACT_PATH = `${PUBLIC_REQUEST_PATH}?request=contact`;
export const LEGACY_HELP_SUPPORT_PATH = `${HELP_PATH}/destek`;
export type PublicRequestKind = Extract<PlatformRequestType, 'YEARLY_LICENSE' | 'CONTACT'>;

const requestPresets: Record<string, PublicRequestKind> = {
  yearly: 'YEARLY_LICENSE',
  contact: 'CONTACT',
};

export function getPublicRequestPreset(search: string): PublicRequestKind {
  const value = new URLSearchParams(search).get('request')?.toLowerCase();
  return value && requestPresets[value] ? requestPresets[value] : 'YEARLY_LICENSE';
}

export function isHelpPath(pathname: string): boolean {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return normalizedPath === HELP_PATH || normalizedPath.startsWith(`${HELP_PATH}/`);
}

export function getHelpSlug(pathname: string): string | null {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (normalizedPath === HELP_PATH) return null;
  if (!normalizedPath.startsWith(`${HELP_PATH}/`)) return null;
  try {
    return decodeURIComponent(normalizedPath.slice(HELP_PATH.length + 1));
  } catch {
    return '__invalid__';
  }
}
