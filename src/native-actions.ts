import { registerPlugin } from '@capacitor/core';

type Result = { success: boolean; message?: string };
type NativeActions = { runAgentAction(options: { action: string; app?: string }): Promise<Result> };
const Native = registerPlugin<NativeActions>('MykAccessibility');

export async function tryNativeCommand(command: string): Promise<string | null> {
  const text = command.toLowerCase();
  let action = '';
  let app = '';
  if (/နောက်တစ်ပုဒ်|နောက်တပုဒ်|သီချင်းကျော်|next track|next song|skip song/.test(text)) action = 'mediaNext';
  else if (/သီချင်း.*(ခဏရပ်|ရပ်ထား)|pause music|resume music|သီချင်းဖွင့်/.test(text)) action = 'mediaToggle';
  else if (/youtube|ယူကျူ့|ယူတူး/.test(text) && /ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|open /.test(text)) { action = 'launchApp'; app = 'youtube'; }
  else if (/facebook|ဖေ့စ်ဘွတ်/.test(text) && /ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|open /.test(text)) { action = 'launchApp'; app = 'facebook'; }
  else if (/messenger|မက်ဆင်ဂျာ/.test(text) && /ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|open /.test(text)) { action = 'launchApp'; app = 'messenger'; }
  else if (/chrome|ခရုမ်း/.test(text) && /ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|open /.test(text)) { action = 'launchApp'; app = 'chrome'; }
  else if (/settings|ဆက်တင်/.test(text) && /ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|open /.test(text)) { action = 'launchApp'; app = 'settings'; }
  else return null;
  const result = await Native.runAgentAction({ action, app });
  if (!result.success) throw new Error(result.message || 'လုပ်ဆောင်ချက် မအောင်မြင်ပါ။');
  return result.message || 'Android လုပ်ဆောင်ချက်ကို ပို့ပြီးပါပြီ။';
}
