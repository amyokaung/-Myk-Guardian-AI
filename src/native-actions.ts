import { registerPlugin } from '@capacitor/core';

type NativeResult = { success: boolean; message?: string };
type AgentNative = { launchApp(options: { app: string }): Promise<NativeResult>; performAction(options: { action: string }): Promise<NativeResult> };
const Native = registerPlugin<AgentNative>('MykAccessibility');

export async function tryNativeCommand(command: string): Promise<string | null> {
  const text = command.toLowerCase();
  const backIntent = /\b(back|go back|press back|back button)\b|နောက်ပြန်|နောက်သို့ပြန်|ပြန်သွား/.test(text);
  if (backIntent) {
    const result = await Native.performAction({ action: 'backAgent' });
    if (!result.success) throw new Error(result.message || 'Back Action မအောင်မြင်ပါ။');
    return result.message || 'Back Action ကို Android ထံ ပို့ပြီးပါပြီ။';
  }
  const openIntent = /ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|open /.test(text);
  if (!openIntent) return null;
  const apps: Array<[RegExp, string]> = [
    [/youtube|ယူကျူ့|ယူတူး/i, 'youtube'],
    [/facebook|ဖေ့စ်ဘွတ်/i, 'facebook'],
    [/messenger|မက်ဆင်ဂျာ/i, 'messenger'],
    [/chrome|ခရုမ်း/i, 'chrome'],
    [/settings|ဆက်တင်/i, 'settings']
  ];
  const found = apps.find(([pattern]) => pattern.test(text));
  if (!found) return null;
  const result = await Native.launchApp({ app: found[1] });
  if (!result.success) throw new Error(result.message || 'App ကို ဖွင့်မရပါ။');
  return result.message || 'App ဖွင့်လိုက်ပါပြီ။';
}
