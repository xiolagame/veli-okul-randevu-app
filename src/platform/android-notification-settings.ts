import { registerPlugin } from '@capacitor/core';

export interface AndroidNotificationSettings {
  getPushAvailability(): Promise<{ configured: boolean }>;
  areNotificationsEnabled(): Promise<{ enabled: boolean }>;
  openNotificationSettings(): Promise<void>;
}

export const androidNotificationSettings = registerPlugin<AndroidNotificationSettings>('NotificationSettings');
