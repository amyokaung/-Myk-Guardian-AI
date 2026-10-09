import { registerPlugin } from '@capacitor/core';

type NativeResult = { success: boolean; message?: string };
type Contact = { name?: string; phone?: string; cancelled?: boolean };
type AgentNative = {
  runAgentAction(options: { action: string; app?: string; phone?: string; message?: string }): Promise<NativeResult>;
  pickContact(): Promise<Contact>;
};
const Native = registerPlugin<AgentNative>('MykAccessibility');

const digits = (value: string) => value
  .replace(/[၀-၉]/g, d => String('၀၁၂၃၄၅၆၇၈၉'.indexOf(d)))
  .replace(/[\s()-]/g, '');

const apps: Array<[RegExp, string]> = [
  [/youtube|ယူကျူ့|ယူတူး/i, 'youtube'],
  [/facebook|ဖေ့စ်ဘွတ်/i, 'facebook'],
  [/messenger|မက်ဆင်ဂျာ/i, 'messenger'],
  [/chrome|ခရုမ်း/i, 'chrome'],
  [/maps|map|မြေပုံ/i, 'maps'],
  [/settings|ဆက်တင်/i, 'settings'],
  [/messages|message app|စာတို app/i, 'messages'],
  [/phone app|ဖုန်း app|ဖုန်းခေါ်တဲ့ app/i, 'phone']
];

export async function tryNativeCommand(raw: string): Promise<string | null> {
  const text = raw.trim();
  const normalized = text.toLowerCase();
  const run = async (options: Parameters<AgentNative['runAgentAction']>[0]) => {
    const result = await Native.runAgentAction(options);
    if (!result.success) throw new Error(result.message || 'လုပ်ဆောင်ချက် မအောင်မြင်ပါ။');
    return result.message || 'လုပ်ဆောင်ချက်ကို Android ထံ ပို့ပြီးပါပြီ။';
  };

  if (/(နောက်တစ်ပုဒ်|နောက်တပုဒ်|သီချင်းကျော်|skip (the )?song|next track|next song)/i.test(normalized)) {
    return await run({ action: 'mediaNext' });
  }
  if (/(သီချင်း.*(ခဏရပ်|ရပ်ထား|ရပ်ပေး)|သီချင်းဖွင့်|play/pause|pause music|resume music|ခဏရပ်ထား)/i.test(normalized)) {
    return await run({ action: 'mediaToggle' });
  }

  const wantsCall = /(ဖုန်းခေါ်|ခေါ်ပေး|ဖုန်းဆက်|call )/i.test(text);
  const wantsSms = /(စာပို့|မက်ဆေ့ချ်ပို့|sms|text message)/i.test(text);
  if (wantsCall || wantsSms) {
    const match = text.match(/(?:\+?\d[\d\s()-]{5,}\d)/);
    let phone = match ? digits(match[0]) : '';
    let message = '';
    if (wantsSms) {
      const marker = text.match(/(?:လို့|ဆိုပြီး|စာသားက|message[:：]?)\s*[“"‘']?(.+?)[”"’']?\s*(?:လို့)?\s*(?:စာပို့|မက်ဆေ့ချ်ပို့|sms|text message)?$/i);
      if (marker && marker[1]) message = marker[1].trim();
      if (!message) message = text.replace(/စာပို့|မက်ဆေ့ချ်ပို့|sms|text message/ig, '').trim();
    }
    if (!phone) {
      const contact = await Native.pickContact();
      if (contact.cancelled) return 'Contact မရွေးထားလို့ လုပ်ဆောင်ချက်ကို ရပ်ထားပါတယ်။';
      phone = digits(contact.phone || '');
      if (!phone) throw new Error('ရွေးထားတဲ့ Contact မှာ ဖုန်းနံပါတ် မရှိပါ။');
      if (wantsSms && !message) message = 'မင်္ဂလာပါ။';
    }
    return await run(wantsCall
      ? { action: 'dial', phone }
      : { action: 'sms', phone, message });
  }

  if (/(ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|ဖွင့်ပေးပါ|open )/i.test(text)) {
    const found = apps.find(([pattern]) => pattern.test(text));
    if (found) return await run({ action: 'launchApp', app: found[1] });
  }
  return null;
}
