import { registerPlugin } from '@capacitor/core';
import type { NativeAction, NativeActionResult, NativePermissionStatus } from '../types';

interface MykNativePlugin {
  getStatus(): Promise<NativePermissionStatus>;
  openAccessibilitySettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  performAction(options: { action: string; app?: string }): Promise<{ success: boolean; message?: string }>;
}

const NativePlugin = registerPlugin<MykNativePlugin>('MykAccessibility');

const ALLOWED_ACTIONS = new Set<NativeAction>([
  'open_app', 'back', 'home', 'media_next', 'media_previous',
  'media_play_pause', 'volume_up', 'volume_down', 'open_settings',
]);

export const nativeBridge = {
  async getStatus(): Promise<NativePermissionStatus> {
    return NativePlugin.getStatus();
  },

  async openAccessibilitySettings(): Promise<void> {
    return NativePlugin.openAccessibilitySettings();
  },

  async openNotificationSettings(): Promise<void> {
    return NativePlugin.openNotificationSettings();
  },

  async performAction(action: NativeAction, app?: string): Promise<NativeActionResult> {
    if (!ALLOWED_ACTIONS.has(action)) {
      return { success: false, action, message: 'ဒီလုပ်ဆောင်ချက်ကို လုံခြုံရေးအတွက် ခွင့်မပြုထားပါ။' };
    }
    if (action === 'open_app' && !app?.trim()) {
      return { success: false, action, message: 'ဖွင့်လိုသော app အမည်ကို ပြောပေးပါ။' };
    }
    try {
      const result = await NativePlugin.performAction({ action, ...(app ? { app: app.trim() } : {}) });
      return {
        success: result.success === true,
        action,
        message: result.message || (result.success ? 'Android က လုပ်ဆောင်ချက်ကို လက်ခံခဲ့သည်။' : 'Android က လုပ်ဆောင်ချက်ကို မအောင်မြင်ကြောင်း ပြန်ပေးခဲ့သည်။'),
      };
    } catch (error) {
      return {
        success: false,
        action,
        message: error instanceof Error ? error.message : 'Native Android bridge ကို ဆက်သွယ်မရပါ။',
      };
    }
  },
};
