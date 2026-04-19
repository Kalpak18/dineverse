import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:   'com.dineverse.customer',
  appName: 'DineVerse',
  webDir:  'dist',
  server: {
    androidScheme: 'https',
    // In dev, point at your local Vite server so hot-reload works on device:
    // url: 'http://192.168.x.x:5173',
    // cleartext: true,
  },
  plugins: {
    BarcodeScanner: {
      // No extra config needed — permissions declared in Info.plist / AndroidManifest
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor:    '#f97316',
      androidScaleType:   'CENTER_CROP',
      showSpinner:        false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  ios: {
    contentInset: 'automatic',
  },
  android: {
    backgroundColor: '#f97316',
  },
};

export default config;
