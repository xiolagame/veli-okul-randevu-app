import { AndroidPushManager, androidPush, PushStatus } from './android-push';
import { IosPushManager, iosPush } from './ios-push';
import { canUseMobilePush } from './push-eligibility';
import { getRuntimePlatform } from './runtime-platform';

type MobilePushManager = AndroidPushManager | IosPushManager;

function getManager(): MobilePushManager | null {
  const platform = getRuntimePlatform();
  if (platform === 'ANDROID') return androidPush;
  if (platform === 'IOS') return iosPush;
  return null;
}

export { canUseMobilePush };
export { IosPushActivationError } from './ios-push';
export type { PushStatus };

export const mobilePush = {
  start(userId: string, role: string | undefined, onForeground: () => void, onStatus: (status: PushStatus) => void): Promise<void> {
    return getManager()?.start(userId, role, onForeground, onStatus) ?? Promise.resolve();
  },
  refreshPermission(): Promise<void> {
    return getManager()?.refreshPermission() ?? Promise.resolve();
  },
  enable(): Promise<PushStatus> {
    return getManager()?.enable() ?? Promise.resolve('unavailable');
  },
  openNotificationSettings(): Promise<void> {
    return getManager()?.openNotificationSettings() ?? Promise.resolve();
  },
  beforeLogout(): Promise<void> {
    return getManager()?.beforeLogout() ?? Promise.resolve();
  },
  afterSessionInvalidated(): Promise<void> {
    return getManager()?.afterSessionInvalidated() ?? Promise.resolve();
  },
  startNavigationCapture(getSessionIdentity: () => Promise<string | null>): Promise<void> {
    return getManager()?.startNavigationCapture(getSessionIdentity) ?? Promise.resolve();
  },
  stopNavigationCapture(): Promise<void> {
    return getManager()?.stopNavigationCapture() ?? Promise.resolve();
  },
};
