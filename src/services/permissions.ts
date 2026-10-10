import { nativeBridge } from './nativeBridge';
import type { NativePermissionStatus } from '../types';

export type PermissionFeature = 'accessibility' | 'notifications';

export interface PermissionCheck {
  feature: PermissionFeature;
  granted: boolean;
  label: string;
  guidance: string;
}

export async function checkNativePermissions(): Promise<PermissionCheck[]> {
  let status: NativePermissionStatus;
  try {
    status = await nativeBridge.getStatus();
  } catch {
    return [
      { feature: 'accessibility', granted: false, label: 'Accessibility Service', guidance: 'နောက်ဆုံး Android APK ကို install လုပ်ပြီး ပြန်စစ်ပါ။' },
      { feature: 'notifications', granted: false, label: 'Notification Access', guidance: 'Native permission status ကို ဖတ်မရပါ။' },
    ];
  }

  return [
    {
      feature: 'accessibility',
      granted: status.accessibilityEnabled,
      label: 'Accessibility Service',
      guidance: status.accessibilityEnabled ? 'ဖွင့်ထားသည်။' : 'Android Settings > Accessibility မှ Myk ကို ကိုယ်တိုင်ဖွင့်ပါ။',
    },
    {
      feature: 'notifications',
      granted: status.notificationEnabled,
      label: 'Notification Access',
      guidance: status.notificationEnabled ? 'ဖွင့်ထားသည်။' : 'Android Notification Access settings မှ Myk ကို ကိုယ်တိုင်ဖွင့်ပါ။',
    },
  ];
}

export async function requestPermissionSettings(feature: PermissionFeature): Promise<void> {
  if (feature === 'accessibility') return nativeBridge.openAccessibilitySettings();
  return nativeBridge.openNotificationSettings();
}
