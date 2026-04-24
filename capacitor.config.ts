import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.stupidlist.ios',
  appName: 'stupidlist',
  webDir: 'public',
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#ffffff',
    },
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '734939820769-c5sbso4le8e5ok5ilq1q99tngku97uus.apps.googleusercontent.com',
      forceCodeForRefreshToken: true,
    },
  },
};

export default config;
