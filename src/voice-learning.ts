import { VoiceRecorder } from 'capacitor-voice-recorder';

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
async function recordAndExtract(seconds = 3): Promise<number[]> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('ဒီ Android WebView မှာ microphone capture API မရပါ။ App ကို update လုပ်ပြီး Microphone permission ကို စစ်ပါ။');
  }
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let silentGain: GainNode | null = null;
  const chunks: Float32Array[] = [];
  let capturedSamples = 0;
  let peak = 0;
  let sumSquares = 0;
  try {
    // Capacitor Android permission should already be granted in app settings;
    // getUserMedia itself prompts/validates WebView microphone permission.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false
    });
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error('ဒီ WebView မှာ audio capture မရပါ။');
    context = new AudioContextClass();
    if (context.state === 'suspended') await context.resume();
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    silentGain = context.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      chunks.push(copy);
      capturedSamples += copy.length;
      for (let i = 0; i < input.length; i++) {
        const v = input[i];
        const abs = Math.abs(v);
        if (abs > peak) peak = abs;
        sumSquares += v * v;
      }
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    // Wait for live PCM from the microphone. The UI tells the user to speak.
    await new Promise<void>(resolve => window.setTimeout(resolve, seconds * 1000));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|denied|notallowed/i.test(message)) {
      throw new Error('Microphone permission မရပါ။ Android Settings > Apps > Myk Guardian AI > Permissions > Microphone ကို Allow လုပ်ပါ။');
    }
    throw new Error('Microphone အသံဖမ်းယူမှု မအောင်မြင်ပါ: ' + message);
  } finally {
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch {} }
    try { source?.disconnect(); } catch {}
    try { silentGain?.disconnect(); } catch {}
    stream?.getTracks().forEach(track => track.stop());
    if (context) { try { await context.close(); } catch {} }
  }
  if (capturedSamples < 12000 || chunks.length < 3) {
    throw new Error('Microphone က အသံဒေတာ မပို့ပေးပါ။ Permission ကိုစစ်ပြီး ထပ်စမ်းပါ။');
  }
  const rms = Math.sqrt(sumSquares / capturedSamples);
  if (peak < 0.008 || rms < 0.0018) {
    throw new Error('အသံဖမ်းယူပြီးပါပြီ၊ ဒါပေမဲ့ အသံအလွန်တိုး/တိတ်ဆိတ်နေပါတယ်။ ဖုန်းကို ပါးစပ်နားထားပြီး ပုံမှန်အသံနဲ့ ပြောပါ။');
  }
  const samples = new Float32Array(capturedSamples);
  let offset = 0;
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
  return extractAcousticFeatures(samples, context?.sampleRate || 48000);
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

export async function enrollVoiceProfile(onProgress?: (message: string) => void): Promise<void> {
  const vectors: number[][] = [];
  for (let i = 1; i <= 3; i++) {
    onProgress?.('အသံနမူနာ ' + i + '/3 — ပုံမှန်အသံနဲ့ ၃ စက္ကန့်ခန့် ပြောပါ။');
    vectors.push(await recordAndExtract(3));
    if (i < 3) await new Promise(resolve => window.setTimeout(resolve, 500));
  }
  const vector = vectors[0].map((_, i) => vectors.reduce((sum, v) => sum + v[i], 0) / vectors.length);
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ version: 1, createdAt: Date.now(), samples: vectors.length, vector } satisfies VoiceProfile));
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
