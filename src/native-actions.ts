import { registerPlugin } from '@capacitor/core';

type NativeResult = { success: boolean; message?: string };
type AgentNative = {
  launchApp(options: { app: string }): Promise<NativeResult>;
  performAction(options: { action: string }): Promise<NativeResult>;
};
const Native = registerPlugin<AgentNative>('MykAccessibility');

export async function tryNativeCommand(command: string): Promise<string | null> {
  const text = command.toLowerCase().trim();

  // Media commands are checked before generic "skip/open" wording.
  const nextTrackIntent = /နောက်တစ်ပုဒ်|သီချင်းကျော်|သီချင်း.*ကျော်|နောက်သီချင်း|next (song|track)|skip (this )?(song|track)|media next/.test(text);
  if (nextTrackIntent) {
    const result = await Native.performAction({ action: 'mediaNext' });
    if (!result.success) throw new Error(result.message || 'နောက်သီချင်းကျော်မရပါ။');
    return result.message || 'နောက်သီချင်းကျော်ရန် အမိန့်ပို့ပြီးပါပြီ။';
  }

  const backIntent = /\b(back|go back|press back|back button)\b|နောက်ပြန်|နောက်သို့ပြန်|ပြန်သွား/.test(text);
  if (backIntent) {
    // Back applies to whichever screen is currently in front. Do not forcibly
    // background Myk: that caused the test button to close Myk unexpectedly.
    const result = await Native.performAction({ action: 'back' });
    if (!result.success) throw new Error(result.message || 'Back Action မအောင်မြင်ပါ။');
    return result.message || 'Android Back action ပို့ပြီးပါပြီ။';
  }

  const englishOpen = text.match(/^\s*open\s+(.+?)\s*$/);
  const burmeseOpen = text.match(/^\s*(.+?)\s*(?:ကို\s*)?(?:ဖွင့်ပေး|ဖွင့်ပါ|ဖွင့်လိုက်|ဖွင့်)\s*$/);
  const target = (englishOpen?.[1] || burmeseOpen?.[1] || '').trim()
    .replace(/\s*ကို\s*$/,'')
    .replace(/^(ကျေးဇူးပြု၍|please)\s*/,'')
    .trim();
  if (!target) return null;

  // Pass the requested app name to Android. Native code resolves it against
  // installed launcher apps rather than a short hard-coded list.
  const result = await Native.launchApp({ app: target });
  if (!result.success) throw new Error(result.message || 'တောင်းဆိုထားတဲ့ App ကို ဖွင့်မရပါ။');
  return result.message || target + ' ကို ဖွင့်လိုက်ပါပြီ။';
}
