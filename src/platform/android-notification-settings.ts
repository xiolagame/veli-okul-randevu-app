import { registerPlugin } from '@capacitor/core';

export interface AndroidNotificationSettings {
  areNotificationsEnabled(): Promise<{ enabled: boolean }>;
}

export const androidNotificationSettings = registerPlugin<AndroidNotificationSettings>('NotificationSettings');
