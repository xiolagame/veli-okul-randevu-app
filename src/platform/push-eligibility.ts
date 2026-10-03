import { getRuntimePlatform, RuntimePlatform } from './runtime-platform';

export function canUseAndroidPush(role: string | undefined, platform: RuntimePlatform = getRuntimePlatform()): boolean {
  return platform === 'ANDROID' && (role === 'parent' || role === 'teacher');
}
