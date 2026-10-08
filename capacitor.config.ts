import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.myk.guardianai',
  appName: 'Myk Guardian AI',
  webDir: 'dist',
  bundledWebRuntime: false,
  plugins: {
    StatusBar: { overlaysWebView: true, backgroundColor: '#080b14' }
  }
};

export default config;