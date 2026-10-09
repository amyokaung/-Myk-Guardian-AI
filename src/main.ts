import './style.css';
import { registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

type Message = { role: 'user' | 'assistant'; content: string };
type MykNativePlugin = { getStatus(): Promise<{ accessibilityEnabled: boolean; notificationEnabled: boolean }>; openAccessibilitySettings(): Promise<void>; openNotificationSettings(): Promise<void>; performAction(options: { action: string }): Promise<{ success: boolean; message?: string }> };
const MykNative = registerPlugin<MykNativePlugin>('MykAccessibility');
const KEY_NAME = 'myk.openrouter.key';
const MODEL_NAME = 'myk.openrouter.model';
const PERM_NAME = 'myk.agent.permissions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const app = document.querySelector<HTMLDivElement>('#app')!;

const readPerms = (): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem(PERM_NAME) || '{}'); } catch { return {}; }
};
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let messages: Message[] = [
  { role: 'assistant', content: 'မင်္ဂလာပါ။ ကျွန်တော် Myk Guardian AI ပါ။ မင်းခွင့်ပြုထားတဲ့ လုပ်ဆောင်ချက်တွေအတွင်းမှာ ကူညီပေးမယ်။ အရင်ဆုံး Settings မှာ OpenRouter API Key ထည့်ပါ။' }
];
let activeTab = 'chat';
let busy = false;

function render() {
  const perms = readPerms();
  app.innerHTML = `
    <div class="ambient ambient-a"></div><div class="ambient ambient-b"></div>
    <header class="topbar">
      <div class="brandmark">M<span>✦</span></div>
      <div class="brand"><b>MYK <span>GUARDIAN</span></b><small>PERSONAL INTELLIGENCE SYSTEM</small></div>
      <button class="iconbtn" id="settingsShortcut" aria-label="Settings">⚙</button>
    </header>
    <main>
      <section class="hero">
        <div class="eyebrow"><i></i> SYSTEM READY · USER CONTROLLED</div>
        <h1>Your world.<br><span>Your command.</span></h1>
        <p>ကိုယ်ပိုင် AI လက်ထောက် · မင်းထိန်းချုပ်မှုအောက်မှာ</p>
        <div class="orb-wrap"><div class="orb"><div class="orb-core">M</div></div><div class="orb-label">MYK CORE <span>● STANDBY</span></div></div>
      </section>
      <nav class="tabs">
        <button data-tab="chat" class="${activeTab==='chat'?'active':''}">◈ စကားပြော</button>
        <button data-tab="agent" class="${activeTab==='agent'?'active':''}">⌘ Agent</button>
        <button data-tab="permissions" class="${activeTab==='permissions'?'active':''}">⛨ ခွင့်ပြုချက်</button>
        <button data-tab="settings" class="${activeTab==='settings'?'active':''}">⚙ ဆက်တင်</button>
      </nav>
      <section id="view"></section>
    </main>
    <footer><span>MYK GUARDIAN AI</span><span>PRIVACY BY DESIGN · BUILD 0.1.0</span></footer>`;
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.addEventListener('click', () => { activeTab = b.dataset.tab!; render(); }));
  document.querySelector('#settingsShortcut')?.addEventListener('click', () => { activeTab = 'settings'; render(); });
  const view = document.querySelector<HTMLElement>('#view')!;
  if (activeTab === 'chat') renderChat(view);
  if (activeTab === 'agent') renderAgent(view, perms);
  if (activeTab === 'permissions') renderPermissions(view, perms);
  if (activeTab === 'settings') renderSettings(view);
}

function renderChat(view: HTMLElement) {
  view.innerHTML = `
    <div class="section-head"><div><span class="eyebrow">NEURAL INTERFACE</span><h2>AI စကားဝိုင်း</h2></div><span class="pill"><i></i> ${busy?'PROCESSING':'READY'}</span></div>
    <div class="chatbox"><div class="messages">${messages.map(m => `<article class="message ${m.role}"><div class="msg-label">${m.role==='user'?'YOU':'MYK AI'}</div><div>${esc(m.content).replace(/\n/g,'<br>')}</div></article>`).join('')}${busy?'<article class="message assistant"><div class="msg-label">MYK AI</div><div class="typing">စဉ်းစားနေသည် <i></i><i></i><i></i></div></article>':''}</div></div>
    <div class="voice-actions"><button class="secondary" id="voiceInput" type="button">🎙 အသံဖြင့် ရိုက်ရန်</button></div><form id="chatForm" class="composer"><textarea id="prompt" rows="2" placeholder="Myk ကို မြန်မာလို အမိန့်ပေးပါ…" required ${busy?'disabled':''}></textarea><button class="send" type="submit" ${busy?'disabled':''}>➤</button></form>
    <p class="hint">AI က ဖုန်းအလုပ်တွေကို ကိုယ်တိုင်မလုပ်နိုင်သေးပါ။ ခွင့်ပြုထားပြီး ပံ့ပိုးထားတဲ့ Action များကိုသာ အတည်ပြုချက်နဲ့ လုပ်ဆောင်မယ်။</p>`;
  view.querySelector<HTMLButtonElement>('#voiceInput')!.addEventListener('click', async () => {
    const button = view.querySelector<HTMLButtonElement>('#voiceInput')!;
    const input = view.querySelector<HTMLTextAreaElement>('#prompt')!;
    button.disabled = true; button.textContent = 'နားထောင်နေသည်…';
    try {
      const available = await SpeechRecognition.available();
      if (!available.available) throw new Error('ဒီဖုန်းမှာ Speech Recognition မရပါ။ Google Speech Services ကို စစ်ပါ။');
      const permission = await SpeechRecognition.requestPermissions();
      if (permission.speechRecognition !== 'granted') throw new Error('Microphone permission ကို Allow လုပ်ပါ။');
      const result = await SpeechRecognition.start({ language: 'my-MM', maxResults: 1, prompt: 'မြန်မာလို ပြောပါ', partialResults: false, popup: true });
      const transcript = result.matches?.[0]?.trim();
      if (transcript) { input.value = transcript; input.focus(); }
      else alert('အသံကို စာသားအဖြစ် မရရှိပါ။ ဖုန်းတွင် မြန်မာ Speech Recognition ပံ့ပိုးမှုကို စစ်ပါ။');
    } catch (err) { alert('အသံဖြင့် ရိုက်မရပါ။ ' + (err instanceof Error ? err.message : 'Speech recognition error')); }
    finally { button.disabled = false; button.textContent = '🎙 အသံဖြင့် ရိုက်ရန်'; }
  });
  view.querySelector<HTMLFormElement>('#chatForm')!.addEventListener('submit', async e => {
    e.preventDefault();
    const input = view.querySelector<HTMLTextAreaElement>('#prompt')!;
    const text = input.value.trim();
    if (!text || busy) return;
    messages.push({ role: 'user', content: text }); busy = true; render();
    await askAI();
  });
}
async function askAI() {
  const key = localStorage.getItem(KEY_NAME)?.trim();
  if (!key) {
    messages.push({ role: 'assistant', content: 'OpenRouter API Key မထည့်ရသေးပါ။ ဆက်တင် (Settings) ကိုဖွင့်ပြီး Key ထည့်ပါ။' });
    busy = false; render(); return;
  }
  const model = localStorage.getItem(MODEL_NAME) || DEFAULT_MODEL;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Myk Guardian AI' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are Myk Guardian AI, a careful Burmese-first Android personal assistant. Answer directly and clearly, preferably in Burmese when the user writes Burmese. You cannot directly control the phone unless a supported native action is explicitly provided by the app. Never claim an action was completed unless the app reports success. For sensitive actions, ask the user to confirm.' },
          ...messages.slice(-20).map(m => ({ role: m.role, content: m.content }))
        ],
        temperature: 0.6,
        max_tokens: 1200
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
    const answer = data?.choices?.[0]?.message?.content;
    messages.push({ role: 'assistant', content: typeof answer === 'string' && answer.trim() ? answer.trim() : 'Model က စာသားအဖြေမပြန်ပေးခဲ့ပါ။ အခြား Model ကိုရွေးပြီး ထပ်စမ်းပါ။' });
  } catch (err) {
    messages.push({ role: 'assistant', content: `OpenRouter ချိတ်ဆက်မှု မအောင်မြင်ပါ။ ${err instanceof Error ? err.message : 'Unknown error'}\nAPI Key၊ Model ID နဲ့ အင်တာနက်ကို စစ်ဆေးပါ။` });
  }
  busy = false; render();
}

const capabilities = [
  { id:'openApps', title:'App ဖွင့်ခြင်း', desc:'Android က ပံ့ပိုးတဲ့ app launch action များ', level:'NATIVE INTEGRATION လိုအပ်' },
  { id:'accessibility', title:'Screen automation', desc:'Accessibility Service ဖြင့် screen အလုပ်များ', level:'Android Settings မှ ကိုယ်တိုင်ဖွင့်ရန်' },
  { id:'notifications', title:'Notification ဖတ်ခြင်း', desc:'Notification access ရှိမှသာ', level:'SENSITIVE PERMISSION' },
  { id:'microphone', title:'အသံအမိန့်ပေးခြင်း', desc:'မိုက်ခရိုဖုန်းသုံးပြီး voice input', level:'MICROPHONE PERMISSION' },
  { id:'location', title:'တည်နေရာ', desc:'လိုအပ်တဲ့အချိန်မှာသာ location access', level:'LOCATION PERMISSION' },
  { id:'files', title:'ဖိုင်အသုံးပြုမှု', desc:'Android file picker မှတစ်ဆင့် ရွေးချယ်ထားသောဖိုင်', level:'USER-SELECTED FILES' }
];
function renderAgent(view: HTMLElement, perms: Record<string, boolean>) {
  view.innerHTML = `<div class="section-head"><div><span class="eyebrow">TASK ORCHESTRATOR</span><h2>Agent Control</h2></div><span class="pill">USER GATED</span></div>
    <div class="notice"><b>⚠ အရေးကြီး</b><p>ဒီ build က အခြေခံ Agent UI ဖြစ်ပါတယ်။ Switch ဖွင့်ရုံနဲ့ Android permission တကယ်ရသွားတာမဟုတ်ပါ။ Native integration နဲ့ OS permission လိုအပ်ပါတယ်။</p></div>
    <div class="action-grid">
      <button class="action-card" id="openSettings"><span>⚙</span><b>Android Settings</b><small>ဖုန်းဆက်တင်ကို ဖွင့်ရန်</small></button>
      <button class="action-card" id="testConfirm"><span>✓</span><b>Permission စမ်းသပ်ရန်</b><small>အတည်ပြုချက်စမ်းသပ်မှု</small></button>
    </div>
    <div class="card"><div class="card-title">အလုပ်လုပ်ခွင့်အခြေအနေ</div>${capabilities.map(c=>`<div class="status-row"><div><b>${c.title}</b><small>${c.level}</small></div><span class="state ${perms[c.id]?'enabled':''}">${perms[c.id]?'ENABLED':'DISABLED'}</span></div>`).join('')}</div>`;
  view.querySelector('#openSettings')?.addEventListener('click', async () => {
    if (!confirm('Android Accessibility Settings ကို ဖွင့်မလား? Myk Guardian AI ကို ကိုယ်တိုင်ရွေးပြီး Enable လုပ်နိုင်ပါတယ်။')) return;
    try { await MykNative.openAccessibilitySettings(); }
    catch (err) { alert('Android Settings မဖွင့်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error')); }
  });
  view.querySelector('#testConfirm')?.addEventListener('click', () => {
    if (confirm('ဒီအရာက အတည်ပြုချက် dialog စမ်းသပ်မှုသာဖြစ်ပါတယ်။ ဆက်လုပ်မလား?')) alert('အတည်ပြုချက်ကို လက်ခံရရှိပါတယ်။ စမ်းသပ်မှုသာဖြစ်ပြီး ဖုန်းမှာ ဘာမှမပြောင်းလဲခဲ့ပါ။');
  });
}
function renderPermissions(view: HTMLElement, perms: Record<string, boolean>) {
  view.innerHTML = `<div class="section-head"><div><span class="eyebrow">OWNER AUTHORITY</span><h2>Permission Center</h2></div><span class="pill">REAL PERMISSION TESTS</span></div>
    <div class="notice"><b>ဖုန်းခွင့်ပြုချက်များ</b><p>ခွင့်ပြုချက်တိုင်းကို Android Settings မှာ ကိုယ်တိုင်ဖွင့်/ပိတ်နိုင်ပါတယ်။ Myk က ခွင့်ပြုချက်မရထားတဲ့ action ကို အောင်မြင်တယ်လို့ မပြပါ။ Notification အကြောင်းအရာများကို ဒီ build က သိမ်းဆည်း/အင်တာနက်သို့ မပို့ပါ။</p></div>
    <div class="card permission-tools">
      <div class="status-row"><div><b>📍 တည်နေရာ (Location)</b><small id="locationStatus">Permission အခြေအနေ စစ်ဆေးနေသည်…</small></div><button class="secondary" id="requestLocation">စမ်းသပ်ရန်</button></div>
      <div class="status-row"><div><b>🎙 မိုက်ခရိုဖုန်း (Microphone)</b><small id="micStatus">ခွင့်ပြုချက် မစမ်းရသေးပါ</small></div><button class="secondary" id="requestMic">စမ်းသပ်ရန်</button></div>
      <div class="status-row"><div><b>📁 ဖိုင်ရွေးချယ်ခြင်း</b><small id="fileStatus">ဖိုင်ကို ဖုန်းထဲတွင်သာ ရွေးချယ်မည်</small></div><button class="secondary" id="chooseFile">ဖိုင်ရွေးရန်</button></div>
      <div class="status-row"><div><b>⌘ Accessibility Service</b><small id="accessibilityStatus">အခြေအနေ စစ်ဆေးနေသည်…</small></div><button class="secondary" id="enableAccessibility">Settings ဖွင့်ရန်</button></div>
      <div class="status-row"><div><b>🔔 Notification Access</b><small id="notificationAccessStatus">အခြေအနေ စစ်ဆေးနေသည်…</small></div><button class="secondary" id="enableNotifications">Settings ဖွင့်ရန်</button></div>
      <div class="status-row"><div><b>↩ Back Action စမ်းသပ်ရန်</b><small>Accessibility ကို Enable လုပ်ပြီးမှ အသုံးပြုနိုင်သည်</small></div><button class="secondary" id="testBack">စမ်းသပ်ရန်</button></div>
      <input id="filePicker" type="file" hidden>
    </div>
    <p class="hint">Location စမ်းသပ်ရာတွင် တည်နေရာကို ရယူပြီး screen ပေါ်တွင်သာ ပြမည်။ Microphone စမ်းသပ်ရာတွင် အသံကို မှတ်တမ်းမတင်ဘဲ ချက်ချင်းရပ်မည်။</p>`;
  const locationStatus = view.querySelector<HTMLElement>('#locationStatus')!;
  const requestLocation = view.querySelector<HTMLButtonElement>('#requestLocation')!;
  const showLocationPermission = async () => {
    try {
      const status = await Geolocation.checkPermissions();
      locationStatus.textContent = `Location permission: ${status.location}`;
    } catch {
      locationStatus.textContent = 'Permission အခြေအနေကို စစ်မရပါ။ Android app permissions ကို စစ်ပါ။';
    }
  };
  void showLocationPermission();
  requestLocation.addEventListener('click', async () => {
    requestLocation.disabled = true;
    locationStatus.textContent = 'Android permission ကို စစ်ဆေး/တောင်းဆိုနေသည်…';
    try {
      let status = await Geolocation.checkPermissions();
      if (status.location !== 'granted') status = await Geolocation.requestPermissions();
      if (status.location !== 'granted') {
        locationStatus.textContent = `ခွင့်မပြုထားပါ: ${status.location}. Android Settings ထဲမှာ Location permission ကို Allow လုပ်ပါ။`;
      } else {
        const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 });
        locationStatus.textContent = `ခွင့်ပြုပြီး။ စမ်းသပ်ရလဒ်: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
      }
    } catch (err) {
      locationStatus.textContent = `Location စမ်းသပ်မှု မအောင်မြင်ပါ: ${err instanceof Error ? err.message : 'unknown error'}`;
    } finally {
      requestLocation.disabled = false;
    }
  });
  view.querySelector<HTMLButtonElement>('#requestMic')!.addEventListener('click', async () => {
    const status = view.querySelector<HTMLElement>('#micStatus')!;
    const button = view.querySelector<HTMLButtonElement>('#requestMic')!;
    button.disabled = true;
    try {
      const permission = await VoiceRecorder.requestAudioRecordingPermission();
      if (!permission.value) throw new Error('Android က microphone permission ကို ခွင့်မပြုပါ။ ဖုန်း Settings > Apps > Myk Guardian AI > Permissions > Microphone ကို Allow လုပ်ပြီး ထပ်စမ်းပါ။');
      await VoiceRecorder.startRecording();
      await new Promise(resolve => window.setTimeout(resolve, 500));
      await VoiceRecorder.stopRecording();
      status.textContent = 'Microphone permission ရရှိပြီး native recording test အောင်မြင်ပါပြီ။ စမ်းသပ်ပြီးချင်း အသံဖမ်းခြင်းကို ရပ်ထားသည်။';
    } catch (err) {
      status.textContent = `Microphone မရပါ: ${err instanceof Error ? err.message : 'permission denied'}`;
    } finally {
      button.disabled = false;
    }
  });
  const accessibilityStatus = view.querySelector<HTMLElement>('#accessibilityStatus')!;
  const notificationStatus = view.querySelector<HTMLElement>('#notificationAccessStatus')!;
  const refreshNativeStatus = async () => {
    try {
      const status = await MykNative.getStatus();
      accessibilityStatus.textContent = status.accessibilityEnabled ? 'ဖွင့်ထားသည် — Accessibility Service Enabled' : 'မဖွင့်ရသေးပါ — Android Settings မှ ဖွင့်ပါ';
      notificationStatus.textContent = status.notificationEnabled ? 'ဖွင့်ထားသည် — Notification Access Enabled' : 'မဖွင့်ရသေးပါ — Android Settings မှ ဖွင့်ပါ';
    } catch (err) {
      accessibilityStatus.textContent = 'Native plugin မရပါ။ နောက်ဆုံး APK ကို install လုပ်ထားကြောင်း စစ်ပါ။';
      notificationStatus.textContent = 'Native plugin မရပါ။ နောက်ဆုံး APK ကို install လုပ်ထားကြောင်း စစ်ပါ။';
    }
  };
  void refreshNativeStatus();
  view.querySelector<HTMLButtonElement>('#enableAccessibility')!.addEventListener('click', async () => {
    try { await MykNative.openAccessibilitySettings(); alert('Android Accessibility Settings ပွင့်လာပါမယ်။ Myk Guardian AI ကို ရွေးပြီး Enable လုပ်ပါ။'); }
    catch (err) { alert('Accessibility Settings မဖွင့်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error')); }
  });
  view.querySelector<HTMLButtonElement>('#enableNotifications')!.addEventListener('click', async () => {
    try { await MykNative.openNotificationSettings(); alert('Notification Access စာမျက်နှာမှာ Myk Guardian AI ကို ဖွင့်ပေးပါ။'); }
    catch (err) { alert('Notification Settings မဖွင့်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error')); }
  });
  view.querySelector<HTMLButtonElement>('#testBack')!.addEventListener('click', async () => {
    if (!confirm('Back action ကို အခုလုပ်မလား? လက်ရှိစာမျက်နှာကနေ ထွက်သွားနိုင်ပါတယ်။')) return;
    try {
      const status = await MykNative.getStatus();
      if (!status.accessibilityEnabled) { alert('အရင် Accessibility Service ကို Android Settings မှ Enable လုပ်ပါ။'); return; }
      const result = await MykNative.performAction({ action: 'back' });
      if (!result.success) {
        alert('Back Action မအောင်မြင်ပါ။\\n\\nအကြောင်းရင်း: ' + (result.message || 'Android က Back action ကို မလုပ်နိုင်ခဲ့ပါ။'));
      }
      // Do not show a success alert here: the modal JavaScript alert can keep
      // the WebView in front and make a successful Android Back action appear ineffective.
    } catch (err) { alert('Action မအောင်မြင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error')); }
  });
  const picker = view.querySelector<HTMLInputElement>('#filePicker')!;
  view.querySelector<HTMLButtonElement>('#chooseFile')!.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    view.querySelector<HTMLElement>('#fileStatus')!.textContent = file ? `ရွေးထားသည်: ${file.name} (${Math.ceil(file.size / 1024)} KB) — ဖိုင်ကို upload မလုပ်ပါ။` : 'ဖိုင်မရွေးထားပါ။';
  });
}
function renderSettings(view: HTMLElement) {
  const key = localStorage.getItem(KEY_NAME) || '';
  const model = localStorage.getItem(MODEL_NAME) || DEFAULT_MODEL;
  view.innerHTML = `<div class="section-head"><div><span class="eyebrow">SYSTEM CONFIGURATION</span><h2>ဆက်တင်</h2></div><span class="pill">LOCAL CONFIG</span></div>
    <div class="card settings-card"><label for="apiKey">OpenRouter API Key</label><input id="apiKey" type="password" autocomplete="off" placeholder="sk-or-v1-…" value="${esc(key)}"><small>Key ကို source code ထဲ မထည့်ပါနဲ့။ ဒီ starter မှာ browser localStorage ထဲ သိမ်းထားတာဖြစ်လို့ public release အတွက် encrypted native storage သို့မဟုတ် backend proxy ထပ်တည်ဆောက်ဖို့လိုပါတယ်။</small>
    <label for="modelId">Model ID</label><input id="modelId" value="${esc(model)}" placeholder="openai/gpt-4o-mini"><small>Model ID ကို OpenRouter model catalog မှာ စစ်ပြီး ထည့်ပါ။ Model အားလုံး အခမဲ့မဟုတ်ပါ။</small>
    <button class="primary wide" id="saveSettings">Save settings</button><button class="secondary wide" id="showKey">${key?'Show OpenRouter Key':'OpenRouter Key မထည့်ရသေးပါ'}</button><button class="danger wide" id="deleteKey">OpenRouter Key ဖျက်မယ်</button></div>
    <div class="card"><div class="card-title">About Myk Guardian</div><p class="muted">Capacitor · TypeScript · OpenRouter API · Android native permissions</p><p class="muted">အသံဖြင့် စာရိုက်သွင်းမှုကို ပံ့ပိုးထားသည်။ Android ခွင့်ပြုချက်များကို ဖုန်း၏ Settings မှာ ကိုယ်တိုင်ထိန်းချုပ်နိုင်သည်။</p></div>`;
  view.querySelector('#saveSettings')!.addEventListener('click', () => {
    const k = view.querySelector<HTMLInputElement>('#apiKey')!.value.trim();
    const m = view.querySelector<HTMLInputElement>('#modelId')!.value.trim();
    if (k && !k.startsWith('sk-or-')) { if (!confirm('OpenRouter Key ပုံစံက sk-or- နဲ့ မစပါ။ ဒီအတိုင်း သိမ်းမလား?')) return; }
    if (k) localStorage.setItem(KEY_NAME, k); else localStorage.removeItem(KEY_NAME);
    if (m) localStorage.setItem(MODEL_NAME, m); else localStorage.setItem(MODEL_NAME, DEFAULT_MODEL);
    alert('Settings ကို သိမ်းပြီးပါပြီ။'); render();
  });
  view.querySelector('#showKey')!.addEventListener('click', () => {
    const i = view.querySelector<HTMLInputElement>('#apiKey')!;
    i.type = i.type === 'password' ? 'text' : 'password';
    view.querySelector<HTMLButtonElement>('#showKey')!.textContent = i.type === 'password' ? 'Show OpenRouter Key' : 'Hide OpenRouter Key';
  });
  view.querySelector('#deleteKey')!.addEventListener('click', () => {
    if (!confirm('ဒီဖုန်းထဲက OpenRouter API Key ကို ဖျက်မှာ သေချာပါသလား?')) return;
    localStorage.removeItem(KEY_NAME); view.querySelector<HTMLInputElement>('#apiKey')!.value = ''; alert('OpenRouter Key ဖျက်ပြီးပါပြီ။');
  });
}
render();
