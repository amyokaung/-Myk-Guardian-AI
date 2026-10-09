import { registerPlugin } from '@capacitor/core';

type NativeResult = { success: boolean; message?: string };
type AgentNative = { launchApp(options: { app: string }): Promise<NativeResult>; performAction(options: { action: string }): Promise<NativeResult> };
const Native = registerPlugin<AgentNative>('MykAccessibility');

export async function executeAgentAction(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const allowed = new Set(['open_app', 'back', 'home', 'media_next', 'media_previous', 'media_play_pause', 'volume_up', 'volume_down', 'open_settings']);
  if (!allowed.has(name)) throw new Error('လုံခြုံရေးအတွက် မပံ့ပိုးထားသော action ကို ပိတ်ထားပါတယ်။');
  let result: NativeResult;
  if (name === 'open_app') {
    const app = typeof args.app === 'string' ? args.app.trim() : '';
    if (!app) throw new Error('ဖွင့်မည့် App အမည် မပါပါ။');
    result = await Native.launchApp({ app });
  } else {
    const actionMap: Record<string, string> = { back: 'back', home: 'home', media_next: 'mediaNext', media_previous: 'mediaPrevious', media_play_pause: 'mediaPlayPause', volume_up: 'volumeUp', volume_down: 'volumeDown', open_settings: 'openSettings' };
    result = await Native.performAction({ action: actionMap[name] });
  }
  if (!result.success) throw new Error(result.message || 'Android action မအောင်မြင်ပါ။');
  return result.message || 'Android က action ကို လက်ခံပြီးပါပြီ။';
}

export async function tryNativeCommand(command: string): Promise<string | null> {
  const text = command.toLowerCase().trim();
  if (/နောက်တစ်ပုဒ်|သီချင်းကျော်|သီချင်း.*ကျော်|နောက်သီချင်း|next (song|track)|skip (this )?(song|track)|media next/.test(text)) return executeAgentAction('media_next');
  if (/အရင်သီချင်း|ရှေ့သီချင်း|previous (song|track)|last track|နောက်ပြန်သီချင်း/.test(text)) return executeAgentAction('media_previous');
  if (/pause|play|ခဏရပ်|ဆက်ဖွင့်|သီချင်း.*ရပ်|သီချင်း.*ဆက်/.test(text)) return executeAgentAction('media_play_pause');
  if (/အသံတိုး|အသံမြှင့်|volume up|increase volume|louder/.test(text)) return executeAgentAction('volume_up');
  if (/အသံလျှော့|အသံချ|volume down|decrease volume|quieter/.test(text)) return executeAgentAction('volume_down');
  if (/^\s*(home|go home|home button)\s*$|ပင်မစာမျက်နှာ|home ကိုသွား/.test(text)) return executeAgentAction('home');
  if (/\b(back|go back|press back|back button)\b|နောက်ပြန်|နောက်သို့ပြန်|ပြန်သွား/.test(text)) return executeAgentAction('back');
  if (/settings|ဆက်တင်/.test(text) && /ဖွင့်|open|သွား/.test(text)) return executeAgentAction('open_settings');
  const englishOpen = text.match(/^\s*open\s+(.+?)\s*$/);
  const burmeseOpen = text.match(/^\s*(.+?)\s*(?:ကို\s*)?(?:ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|ဖွင့်)\s*$/);
  const target = (englishOpen?.[1] || burmeseOpen?.[1] || '').trim().replace(/\s*ကို\s*$/,'').replace(/^(ကျေးဇူးပြု၍|please)\s*/,'').trim();
  if (!target) return null;
  return executeAgentAction('open_app', { app: target });
}
