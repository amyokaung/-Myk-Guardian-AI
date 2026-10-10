import { registerPlugin } from '@capacitor/core';
import type { NativeAction, NativeActionResult, NativePermissionStatus } from '../types';

interface MykNativePlugin {
  getStatus(): Promise<NativePermissionStatus>;
  openAccessibilitySettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  performAction(options: { action: string; app?: string }): Promise<{ success: boolean; message?: string }>;
  launchApp(options: { app: string }): Promise<{ success: boolean; message?: string }>;
}
const NativePlugin = registerPlugin<MykNativePlugin>('MykAccessibility');
const ALLOWED_ACTIONS = new Set<NativeAction>(['open_app','back','home','media_next','media_previous','media_play_pause','volume_up','volume_down','open_settings']);
const ACTION_MAP: Record<Exclude<NativeAction, 'open_app'>, string> = {
  back:'back', home:'home', media_next:'mediaNext', media_previous:'mediaPrevious',
  media_play_pause:'mediaPlayPause', volume_up:'volumeUp', volume_down:'volumeDown', open_settings:'openSettings',
};
export const nativeBridge = {
  getStatus(): Promise<NativePermissionStatus> { return NativePlugin.getStatus(); },
  openAccessibilitySettings(): Promise<void> { return NativePlugin.openAccessibilitySettings(); },
  openNotificationSettings(): Promise<void> { return NativePlugin.openNotificationSettings(); },
  async performAction(action: NativeAction, app?: string): Promise<NativeActionResult> {
    if (!ALLOWED_ACTIONS.has(action)) return {success:false, action, message:'ဒီလုပ်ဆောင်ချက်ကို လုံခြုံရေးအတွက် ခွင့်မပြုထားပါ။'};
    try {
      let result: {success:boolean; message?:string};
      if (action === 'open_app') {
        if (!app?.trim()) return {success:false, action, message:'ဖွင့်လိုသော app အမည်ကို ပြောပေးပါ။'};
        result = await NativePlugin.launchApp({app:app.trim()});
      } else {
        result = await NativePlugin.performAction({action:ACTION_MAP[action]});
      }
      return {success:result.success === true, action, message:result.message || (result.success ? 'Android က လုပ်ဆောင်ချက်ကို လက်ခံခဲ့သည်။' : 'Android က လုပ်ဆောင်ချက်ကို မအောင်မြင်ကြောင်း ပြန်ပေးခဲ့သည်။')};
    } catch (error) {
      return {success:false, action, message:error instanceof Error ? error.message : 'Native Android bridge ကို ဆက်သွယ်မရပါ။'};
    }
  },
};
