import type { PlatformRequestType } from '../types/platform';

export const PUBLIC_REQUEST_PATH = '/lisans-iletisim';
export type PublicRequestKind = Extract<PlatformRequestType, 'YEARLY_LICENSE' | 'CONTACT'>;

const requestPresets: Record<string, PublicRequestKind> = {
  yearly: 'YEARLY_LICENSE',
  contact: 'CONTACT',
};

export function getPublicRequestPreset(search: string): PublicRequestKind {
  const value = new URLSearchParams(search).get('request')?.toLowerCase();
  return value && requestPresets[value] ? requestPresets[value] : 'YEARLY_LICENSE';
}
