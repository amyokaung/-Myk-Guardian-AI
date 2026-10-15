const PHRASES_KEY = 'vedari.phrase.map.v1';
// Delete the obsolete local speaker profile left by older Voice ID builds.
try { localStorage.removeItem('vedari.voice.profile.v1'); } catch { /* storage may be unavailable */ }
type PhraseMap = Record<string, string>;

export function normalizePhrase(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('my-MM')
    .replace(/[၊,။.!?！？]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
export function getPhraseMap(): PhraseMap {
  try {
    const value = JSON.parse(localStorage.getItem(PHRASES_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as PhraseMap : {};
  } catch { return {}; }
}
export function savePhraseCorrection(heard: string, intended: string): void {
  const from = normalizePhrase(heard), to = intended.trim();
  if (!from || !to) throw new Error('ကြားမိတဲ့စကားနဲ့ မှန်ကန်တဲ့အမိန့် နှစ်ခုလုံးထည့်ပါ။');
  const map = getPhraseMap(); map[from] = to;
  localStorage.setItem(PHRASES_KEY, JSON.stringify(map));
}
export function removePhraseCorrection(heard: string): void {
  const map = getPhraseMap(); delete map[normalizePhrase(heard)];
  localStorage.setItem(PHRASES_KEY, JSON.stringify(map));
}
export function applyLearnedPhrase(heard: string): string {
  return getPhraseMap()[normalizePhrase(heard)] || heard;
}
/** Normalize common colloquial Burmese speech for local command matching. */
export function normalizeBurmeseCommand(value: string): string {
  let text = value.normalize('NFC').toLocaleLowerCase('my-MM').trim();
  text = text.replace(/[၀-၉]/g, d => String('၀၁၂၃၄၅၆၇၈၉'.indexOf(d)));
  text = text.replace(/[၊,။.!?！？]+/g, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(/ဖွင့်|ဖွင့္|ဖွင့္/g, 'ဖွင့်')
    .replace(/ကျော်လိုက်ပါ|ကျော်ပေးပါနော်|ကျော်ပေးနော်/g, 'ကျော်ပေးပါ');
  text = text.replace(/ယူကျု့?|ယူကျူး|ယူကျူ|ယူကျူဘ်|ယူကျူ့|ယူတူးဘ်|ယူတျုဘ်/g, 'youtube')
    .replace(/ဖေ့စ်ဘွတ်ခ်?|ဖေ့ဘွတ်/g, 'facebook')
    .replace(/ဂူဂဲလ်မြေပုံ|ဂူဂယ်မြေပုံ|google map(?!s)/g, 'google maps')
    .replace(/ဂူဂဲလ်/g, 'google');
  return text;
}
