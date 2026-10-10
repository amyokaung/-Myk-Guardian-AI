import type { NativeAction } from './types';
import { nativeBridge } from './services/nativeBridge';
import { parseDirectAction } from './services/agent';

const ACTION_NAMES = new Set<NativeAction>([
  'open_app','back','home','media_next','media_previous',
  'media_play_pause','volume_up','volume_down','open_settings',
]);

export async function executeAgentAction(name: string, args: Record<string, unknown> = {}): Promise<string> {
  if (!ACTION_NAMES.has(name as NativeAction)) {
    throw new Error('လုံခြုံရေးအတွက် မပံ့ပိုးထားသော action ကို ပိတ်ထားပါတယ်။');
  }
  const action = name as NativeAction;
  const app = typeof args.app === 'string' ? args.app.trim() : undefined;
  const result = await nativeBridge.performAction(action, app);
  if (!result.success) throw new Error(result.message || 'Android action မအောင်မြင်ပါ။');
  return result.message;
}

export async function tryNativeCommand(command: string): Promise<string | null> {
  const text = command.toLocaleLowerCase().trim();

  // More natural Burmese media commands than exact keyword matching alone.
  if (/နောက်တစ်ပုဒ်|သီချင်းကျော်|သီချင်း.*ကျော်|နောက်သီချင်း|next (song|track)|skip (this )?(song|track)|media next/.test(text)) {
    return executeAgentAction('media_next');
  }
  if (/အရင်သီချင်း|ရှေ့သီချင်း|previous (song|track)|last track|နောက်ပြန်သီချင်း/.test(text)) {
    return executeAgentAction('media_previous');
  }
  if (/ခဏရပ်|ဆက်ဖွင့်|သီချင်း.*ရပ်|သီချင်း.*ဆက်|play pause|pause music|resume music/.test(text)) {
    return executeAgentAction('media_play_pause');
  }
  if (/အသံတိုး|အသံမြှင့်|volume up|increase volume|louder/.test(text)) return executeAgentAction('volume_up');
  if (/အသံလျှော့|အသံချ|volume down|decrease volume|quieter/.test(text)) return executeAgentAction('volume_down');

  const direct = parseDirectAction(command);
  if (direct) return executeAgentAction(direct.action, direct.app ? { app: direct.app } : {});

  const englishOpen = text.match(/^\s*open\s+(.+?)\s*$/);
  const burmeseOpen = text.match(/^\s*(.+?)\s*(?:ကို\s*)?(?:ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|ဖွင့်)\s*$/);
  const target = (englishOpen?.[1] || burmeseOpen?.[1] || '')
    .trim()
    .replace(/\s*ကို\s*$/, '')
    .replace(/^(ကျေးဇူးပြု၍|please)\s*/, '')
    .trim();
  if (target) return executeAgentAction('open_app', { app: target });
  return null;
}
