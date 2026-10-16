import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.velirandevu.app',
  appName: 'Veli Randevu',
  webDir: 'dist/client',
  loggingBehavior: 'debug',
  backgroundColor: '#f6f8f7',
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#f6f8f7',
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 500,
      launchFadeOutDuration: 200,
      backgroundColor: '#f6f8f7',
      showSpinner: false,
    },
  },
};

export default config;
