import type { PlatformRequestType } from '../types/platform';

export const PUBLIC_REQUEST_PATH = '/lisans-iletisim';
export const HELP_PATH = '/yardim';
export const PUBLIC_CONTACT_PATH = `${PUBLIC_REQUEST_PATH}?request=contact`;
export const LEGACY_HELP_SUPPORT_PATH = `${HELP_PATH}/destek`;
export type PublicRequestKind = Extract<PlatformRequestType, 'YEARLY_LICENSE' | 'FREE_TRIAL' | 'CONTACT'>;

const requestPresets: Record<string, PublicRequestKind> = {
  monthly: 'YEARLY_LICENSE',
  yearly: 'YEARLY_LICENSE',
  contact: 'CONTACT',
};

// Sayfa açılınca seçili gelen talep türü. Ücretsiz deneme yalnız web'de sunulduğu için mobilde yıllık lisans kalır.
export function getDefaultPublicRequestKind(nativeApp: boolean): PublicRequestKind {
  return nativeApp ? 'YEARLY_LICENSE' : 'FREE_TRIAL';
}

export function getPublicRequestPreset(search: string, fallback: PublicRequestKind = getDefaultPublicRequestKind(false)): PublicRequestKind {
  const value = new URLSearchParams(search).get('request')?.toLowerCase();
  return value && requestPresets[value] ? requestPresets[value] : fallback;
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
