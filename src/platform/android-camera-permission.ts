import { registerPlugin } from '@capacitor/core';
import { getRuntimePlatform } from './runtime-platform';

export type CameraPermissionState = 'granted' | 'prompt' | 'rationale' | 'denied' | 'permanently-denied';

export interface CameraPermissionResult {
  state: CameraPermissionState;
}

interface NativeCameraPermissionPlugin {
  checkCameraPermission(): Promise<CameraPermissionResult>;
  requestCameraPermission(): Promise<CameraPermissionResult>;
  openAppSettings(): Promise<void>;
}

export interface CameraPermissionAdapter {
  requiresNativePermission(): boolean;
  check(): Promise<CameraPermissionResult>;
  request(): Promise<CameraPermissionResult>;
  openSettings(): Promise<void>;
}

const nativeCameraPermission = registerPlugin<NativeCameraPermissionPlugin>('CameraPermission');

export function createAndroidCameraPermissionAdapter(
  plugin: NativeCameraPermissionPlugin = nativeCameraPermission,
  runtimePlatform = getRuntimePlatform,
): CameraPermissionAdapter {
  const requiresNativePermission = () => runtimePlatform() === 'ANDROID';
  return {
    requiresNativePermission,
    check: () => requiresNativePermission() ? plugin.checkCameraPermission() : Promise.resolve({ state: 'granted' }),
    request: () => requiresNativePermission() ? plugin.requestCameraPermission() : Promise.resolve({ state: 'granted' }),
    openSettings: () => requiresNativePermission() ? plugin.openAppSettings() : Promise.resolve(),
  };
}

export const androidCameraPermission = createAndroidCameraPermissionAdapter();
