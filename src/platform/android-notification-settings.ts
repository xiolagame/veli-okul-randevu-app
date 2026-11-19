import { registerPlugin } from '@capacitor/core';

export interface AndroidNotificationSettings {
  areNotificationsEnabled(): Promise<{ enabled: boolean }>;
  openNotificationSettings(): Promise<void>;
}

export const androidNotificationSettings = registerPlugin<AndroidNotificationSettings>('NotificationSettings');
