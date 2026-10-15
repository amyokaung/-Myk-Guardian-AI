import { registerPlugin } from '@capacitor/core';

type VoiceCapturePlugin = { captureVoiceFeatures(): Promise<{ features: number[]; sampleRate: number; capturedSamples: number }> };
const VoiceCapture = registerPlugin<VoiceCapturePlugin>('MykAccessibility');

const PROFILE_KEY = 'vedari.voice.profile.v1';
const PHRASES_KEY = 'vedari.phrase.map.v1';

type VoiceProfile = { version: 1; createdAt: number; samples: number; vector: number[] };
type PhraseMap = Record<string, string>;

function normalizePhrase(value: string): string {
  return value.toLocaleLowerCase('my-MM').replace(/[၊,။.!?]/g, ' ').replace(/\\s+/g, ' ').trim();
}

export function getPhraseMap(): PhraseMap {
  try {
    const value = JSON.parse(localStorage.getItem(PHRASES_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as PhraseMap : {};
  } catch { return {}; }
}

export function savePhraseCorrection(heard: string, intended: string): void {
  const from = normalizePhrase(heard);
  const to = intended.trim();
  if (!from || !to) throw new Error('ကြားမိတဲ့စကားနဲ့ မှန်ကန်တဲ့အမိန့် နှစ်ခုလုံးထည့်ပါ။');
  const map = getPhraseMap();
  map[from] = to;
  localStorage.setItem(PHRASES_KEY, JSON.stringify(map));
}

export function removePhraseCorrection(heard: string): void {
  const map = getPhraseMap();
  delete map[normalizePhrase(heard)];
  localStorage.setItem(PHRASES_KEY, JSON.stringify(map));
}

export function applyLearnedPhrase(heard: string): string {
  const map = getPhraseMap();
  return map[normalizePhrase(heard)] || heard;
}

export function getVoiceProfileStatus(): { enrolled: boolean; samples: number } {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') as VoiceProfile | null;
    return { enrolled: !!profile?.vector?.length, samples: profile?.samples || 0 };
  } catch { return { enrolled: false, samples: 0 }; }
}

/**
 * Captures raw PCM directly from the device microphone through WebView getUserMedia.
 * This avoids depending on decoding the recorder plugin's encoded MP4/AAC output,
 * which is not consistently decodable in Android WebView. Nothing is uploaded.
 */
async function recordAndExtract(_seconds = 3): Promise<number[]> {
  // Capture is performed by Android AudioRecord through the registered native plugin,
  // so WebView getUserMedia/WebChromeClient behavior cannot silently block the microphone.
  try {
    const result = await VoiceCapture.captureVoiceFeatures();
    if (!result || !Array.isArray(result.features) || result.features.length < 18 ||
        !Number.isFinite(result.capturedSamples) || result.capturedSamples < 12000) {
      throw new Error('Android microphone က မှန်ကန်တဲ့ အသံဒေတာ မပေးပါ။');
    }
    return result.features.map(value => Number(value));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|denied|microphone|record_audio/i.test(message)) {
      throw new Error('မိုက်ခရိုဖုန်း မဖွင့်နိုင်ပါ။ ခွင့်ပြုချက်မေးလာရင် Allow နှိပ်ပါ။ မမေးလာရင် Android Settings > Apps > Myk Guardian AI > Permissions > Microphone ကို Allow လုပ်ပါ။ အသေးစိတ်: ' + message);
    }
    throw new Error('အသံဖမ်းယူမှု မအောင်မြင်ပါ: ' + message);
  }
}

// Lightweight local acoustic descriptor used only for a best-effort prototype match.
// It is not a neural speaker embedding and must not be used as security authentication.
function extractAcousticFeatures(samples: Float32Array, sampleRate: number): number[] {
  const frameSize = 1024;
  const hop = 2048;
  const bands = 16;
  const energy = new Array<number>(bands).fill(0);
  let frames = 0;
  let totalRms = 0;
  let totalZcr = 0;
  let pitchMean = 0;
  let pitchCount = 0;
  for (let start = 0; start + frameSize < samples.length; start += hop) {
    let square = 0, crossings = 0;
    for (let i = 1; i < frameSize; i++) {
      const v = samples[start + i];
      square += v * v;
      if ((v >= 0) !== (samples[start + i - 1] >= 0)) crossings++;
    }
    const rms = Math.sqrt(square / frameSize);
    if (rms < 0.008) continue;
    totalRms += rms;
    totalZcr += crossings / frameSize;
    // Coarse frequency-band energy from zero-crossing-rate partitioning.
    for (let b = 0; b < bands; b++) {
      const frequency = 90 + (b * 230);
      let re = 0, im = 0;
      const omega = 2 * Math.PI * frequency / sampleRate;
      for (let i = 0; i < frameSize; i += 2) {
        const sample = samples[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frameSize - 1)));
        re += sample * Math.cos(omega * i);
        im -= sample * Math.sin(omega * i);
      }
      energy[b] += Math.log(1e-9 + re * re + im * im);
    }
    // Autocorrelation pitch estimate in the typical speech range.
    let bestLag = 0, best = 0;
    const minLag = Math.max(1, Math.floor(sampleRate / 320));
    const maxLag = Math.min(Math.floor(sampleRate / 75), frameSize - 1);
    for (let lag = minLag; lag <= maxLag; lag += 2) {
      let corr = 0;
      for (let i = 0; i < frameSize - lag; i += 4) corr += samples[start + i] * samples[start + i + lag];
      if (corr > best) { best = corr; bestLag = lag; }
    }
    if (bestLag > 0) { pitchMean += sampleRate / bestLag; pitchCount++; }
    frames++;
  }
  if (frames < 8) throw new Error('အသံမရှင်းလင်းပါ။ ပတ်ဝန်းကျင်ဆူညံသံနည်းတဲ့နေရာမှာ ထပ်ပြောပါ။');
  const averageEnergy = energy.map(v => v / frames);
  const mean = averageEnergy.reduce((a, b) => a + b, 0) / bands;
  const variance = Math.sqrt(averageEnergy.reduce((a, b) => a + (b - mean) ** 2, 0) / bands) || 1;
  return [
    ...averageEnergy.map(v => (v - mean) / variance),
    totalRms / frames,
    totalZcr / frames,
    pitchCount ? pitchMean / pitchCount / 300 : 0
  ];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export async function recordVoiceSample(): Promise<number[]> {
  return recordAndExtract(3);
}

export function saveVoiceProfile(samples: number[][]): void {
  if (samples.length !== 3 || [0, 1, 2].some(i => !Array.isArray(samples[i]) || samples[i].length < 18)) {
    throw new Error('အသံနမူနာ ၃ ခုလုံးကို အရင်ဖမ်းယူပါ။');
  }
  const vector = samples[0].map((_, i) => samples.reduce((sum, sample) => sum + sample[i], 0) / samples.length);
  localStorage.setItem(PROFILE_KEY, JSON.stringify({
    version: 1, createdAt: Date.now(), samples: samples.length, vector
  } satisfies VoiceProfile));
}

export async function verifyVoiceProfile(): Promise<{ matched: boolean; similarity: number }> {
  let profile: VoiceProfile | null = null;
  try { profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') as VoiceProfile | null; } catch {}
  if (!profile?.vector?.length) throw new Error('အရင်ဆုံး ကိုယ့်အသံကို မှတ်ပုံတင်ပါ။');
  const sample = await recordAndExtract(3);
  const similarity = cosineSimilarity(profile.vector, sample);
  // Conservative demo threshold; not calibrated and not suitable for unlocking or sensitive actions.
  return { matched: similarity >= 0.88, similarity };
}

export function clearVoiceProfile(): void {
  localStorage.removeItem(PROFILE_KEY);
}
