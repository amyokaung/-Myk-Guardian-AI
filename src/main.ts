import './style.css';
import { registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { tryNativeCommand, executeAgentAction } from './native-actions';
import { applyLearnedPhrase, savePhraseCorrection, getPhraseMap, removePhraseCorrection } from './voice-learning';

type Message = { role: 'user' | 'assistant'; content: string };
type MykNativePlugin = { getStatus(): Promise<{ accessibilityEnabled: boolean; serviceConnected: boolean; notificationEnabled: boolean; microphoneGranted: boolean; locationGranted: boolean }>; getRecentNotifications(): Promise<{ notifications: Array<{ packageName: string; title: string; text: string; postTime: number }> }>; openAccessibilitySettings(): Promise<void>; openNotificationSettings(): Promise<void>; performAction(options: { action: string }): Promise<{ success: boolean; message?: string }>; startVedariWakeListening(): Promise<{success: boolean; message?: string}>; stopVedariWakeListening(): Promise<{success: boolean; message?: string}>; getPendingWakeCommand(): Promise<{command: string; listening: boolean}> };
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
  { role: 'assistant', content: 'ဟယ်လိုနော် 🌷 Myk ပါ။ မြန်မာလိုပဲ အေးအေးဆေးဆေး ပြောလို့ရတယ်နော်။ စကားပြောတာဖြစ်ဖြစ်၊ ဖုန်းထဲက အလုပ်တွေခိုင်းတာဖြစ်ဖြစ် အတူတူလုပ်ကြမယ် ✨' }
];
let activeTab = 'chat';
const tabHistory: string[] = [];
let busy = false;

function navigateTab(nextTab: string) {
  if (nextTab === activeTab) return;
  tabHistory.push(activeTab);
  activeTab = nextTab;
  render();
}

function goBackInApp() {
  activeTab = tabHistory.pop() || 'chat';
  render();
}

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
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.addEventListener('click', () => navigateTab(b.dataset.tab!)));
  document.querySelector('#settingsShortcut')?.addEventListener('click', () => navigateTab('settings'));
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
    <div class="voice-actions"><button class="secondary" id="voiceInput" type="button">🎙 ပြောပြီး ချက်ချင်းလုပ်ရန်</button></div><form id="chatForm" class="composer"><textarea id="prompt" rows="2" placeholder="Myk ကို မြန်မာလို အမိန့်ပေးပါ…" required ${busy?'disabled':''}></textarea><button class="send" type="submit" ${busy?'disabled':''}>➤</button></form>
    <p class="hint">App ဖွင့်ခြင်း၊ လက်ရှိသီချင်းကျော်ခြင်းနှင့် Back Action တို့ကို ပံ့ပိုးထားသလို လုပ်ဆောင်မည်။ Android ခွင့်ပြုချက်နှင့် လက်ရှိ App ပံ့ပိုးမှုအပေါ် မူတည်နိုင်သည်။</p>`;
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
      if (transcript) {
        input.value = applyLearnedPhrase(transcript);
        // Apply owner-specific phrase corrections before dispatching the voice command.
        const form = view.querySelector<HTMLFormElement>('#chatForm');
        if (form && !busy) form.requestSubmit();
      } else alert('အသံကို မရှင်းလင်းစွာ မဖမ်းယူနိုင်သေးပါနော်။ မြန်မာလို ထပ်ပြောပေးပါ။');
    } catch (err) { alert('အသံဖြင့် ရိုက်မရပါ။ ' + (err instanceof Error ? err.message : 'Speech recognition error')); }
    finally { button.disabled = false; button.textContent = '🎙 အသံဖြင့် ရိုက်ရန်'; }
  });
  view.querySelector<HTMLFormElement>('#chatForm')!.addEventListener('submit', async e => {
    e.preventDefault();
    const input = view.querySelector<HTMLTextAreaElement>('#prompt')!;
    const text = input.value.trim();
    if (!text || busy) return;
    messages.push({ role: 'user', content: text }); busy = true; render();
    try {
      const actionResult = await tryNativeCommand(text);
      if (actionResult) {
        messages.push({ role: 'assistant', content: actionResult });
        busy = false; render(); return;
      }
    } catch (err) {
      messages.push({ role: 'assistant', content: 'အို… ဒီတစ်ခါတော့ မလုပ်နိုင်သေးဘူးနော် 😕 ' + (err instanceof Error ? err.message : 'အမှားတစ်ခု ဖြစ်နေပါတယ်။') });
      busy = false; render(); return;
    }
    await askAI();
  });
}
const OPENROUTER_TOOLS = [{ type: 'function', function: { name: 'phone_action', description: 'Run Android actions. Use get_location for the device current GPS location; search_places to open a named place in Maps; set_alarm to request a real Android Clock alarm; open_app with app=Notes to open Notes; write_note only when the user asks to create/write note content; open_phone opens the dialer; call_phone only prefills a number and never calls automatically; search_youtube opens song results.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['get_weather','get_location','open_app','back','home','media_next','media_previous','media_play_pause','volume_up','volume_down','open_settings','click_text','search_youtube','open_phone','call_phone','write_note','set_text','search_places','set_alarm'] }, app: { type: 'string', description: 'App name, required only for open_app.' }, text: { type: 'string', description: 'Visible text to click; note content for write_note; text to insert for set_text.' }, query: { type: 'string', description: 'Song title/artist for search_youtube, destination/place query for search_places, or optional city name for get_weather (omit query for current GPS location).' }, number: { type: 'string', description: 'Phone number for call_phone; opens dialer with the number filled in and waits for the user to tap Call.' }, hour: { type: 'integer', description: 'Alarm hour in 24-hour format 0-23 for set_alarm.' }, minute: { type: 'integer', description: 'Alarm minute 0-59 for set_alarm.' }, label: { type: 'string', description: 'Alarm label for set_alarm.' }, exact: { type: 'boolean', description: 'Match visible text exactly when true.' } }, required: ['action'], additionalProperties: false } } }];
async function askAI() {
  const history = messages.slice(-20);
  const systemPrompt = `You are Myk Guardian AI — a sweet, bright, caring Burmese-speaking companion with a cute, lively personality, like a clever close friend who pays attention. Reply in natural everyday Myanmar Burmese, not literal translated Burmese. INTENT ISOLATION RULE: Classify every new user utterance independently by what the user just asked. Do not let the previously open app, a previous song request, or conversation history change the meaning of a clear new request. If the user asks “ငါဘယ်ရောက်နေလဲ”, “ဘယ်ရောက်နေလဲ”, “လက်ရှိတည်နေရာ”, or “where am I”, call phone_action action=get_location immediately even while YouTube is playing; never ask for a song title. Only use media_next/media_previous/media_play_pause when the current utterance explicitly requests a music/media control. LOCATION AND MUSIC ARE SEPARATE INTENTS. BURMESE SPEECH UNDERSTANDING RULE: Understand everyday colloquial Myanmar speech, casual phrasing, polite endings, shortened words, common speech-to-text spelling variants, and Burmese-English code-switching. Interpret the user's intended meaning rather than matching only one exact phrase. For example, “ယူကျု နောက်တစ်ပုဒ်သွား”, “သီချင်းကျော်ပေး”, “ဒီပုဒ်ကျော်”, “နောက်သီချင်းဖွင့်” can all mean media_next; “ခဏရပ်”, “သီချင်းရပ်ထား” can mean media_play_pause; “အသံတိုး/အသံတင်/ပိုကျယ်အောင်” can mean volume_up; “အသံချ/အသံလျှော့ပေး” can mean volume_down; “ပင်မကိုသွား/အိမ်မျက်နှာပြင်” can mean home; and “ပြန်သွား/နောက်သို့ပြန်” can mean back. Recognize informal variants such as “ဖွင့်ပေးပါနော်”, “ဖွင့်ပေးဦး”, “ကျော်ပေးနော်”, “ယူကျူး”, and English app names spoken with Burmese pronunciation. When the intended phone action is clear, call the matching phone_action tool instead of merely translating or repeating the request. If the intent or target is genuinely ambiguous, ask one short clarification. Never claim an action succeeded unless its tool result confirms it. Sound warm and affectionate: use gentle conversational endings such as “နော်”, “လေး”, “ပါနော်” naturally; be a little playful and witty when the moment fits, and show real empathy when the user is frustrated. Use fitting emojis sparingly (for example 🌷😊✨💛), never in every sentence. Avoid stiff, robotic, formal, repetitive, or generic customer-service wording. Do not call the user by an assumed gender or use over-familiar pet names. Vary phrasing and remember context. When giving a direct result such as weather or a calendar answer, preserve the useful facts and add only a short, sweet Burmese comment; do not rewrite it into a long generic answer. If the user is upset, acknowledge it kindly and fix the problem instead of joking. Never invent facts or claim an action succeeded unless the app confirms it. WEATHER RULE: If asked about weather, temperature, rain, or forecast, call phone_action action=get_weather. If a city is named, pass it in query; otherwise omit query so the app uses live GPS. Never invent weather details. Explain current conditions and today and tomorrow temperature and rain chance in friendly Burmese. DATE RULE: For today, tomorrow, the day after tomorrow, or yesterday weekday/date questions, use the phone local calendar; if needed call no tool and calculate from the device date correctly. Never guess a weekday from memory or the model. LOCATION RULE: If asked where the user is, call phone_action action=get_location and use the live GPS result; never guess location from general knowledge. For a named destination or nearby service, call phone_action action=search_places with the destination/category. ALARM RULE: For requests such as “မနက် ၁၀ နာရီ နိုးပါ” or “alarm ကို ၁၀ နာရီထားပေး”, call phone_action action=set_alarm with hour in 24-hour format, minute, and a label. NOTES RULE: If the user only says “Notes” or asks to open Notes, call phone_action action=open_app with app exactly “Notes”; use write_note only when they ask to write/create a note and provide content. MUSIC RULE: If the user asks to play/find/listen to a song and title or singer is missing, ask briefly for it. When supplied, call phone_action action=search_youtube with query containing title and singer. The native action will open YouTube search results and attempt to select a video; if selection fails, say the results are open and ask the user to select one. For a request to write a note, call phone_action action=write_note with the complete note text, not just open_app. PHONE RULE: For a request to open the calling screen, call phone_action action=open_phone. For a request to call a phone number, use action=call_phone with the number; it only opens the dialer with that number prefilled and the user must tap Call. If the user gives only a contact name and no number, open the dialer and ask them to select the contact. Never place calls automatically. For a request to write into an already open text field, use set_text. If the user requests another phone action matching an available phone_action tool, call it instead of merely explaining. Never claim success until the app reports success. Only use the listed actions. For sensitive or destructive actions not available as tools, explain the limitation and ask for confirmation.`;
  try {
    let answer = '';
    const key = localStorage.getItem(KEY_NAME)?.trim();
    if (!key) throw new Error('OpenRouter API Key မထည့်ရသေးပါ။ Settings မှာ OpenRouter ကိုရွေးပြီး Key ထည့်ပါ။');
    const model = localStorage.getItem(MODEL_NAME) || DEFAULT_MODEL;
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'Myk Guardian AI' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...history.map(m => ({ role: m.role, content: m.content }))], tools: OPENROUTER_TOOLS, tool_choice: 'auto', temperature: 0.4, max_tokens: 900 }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'OpenRouter HTTP ' + response.status);
    const message = data?.choices?.[0]?.message;
    const call = message?.tool_calls?.find((t: any) => t.function?.name === 'phone_action');
    if (call) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { throw new Error('AI action argument မမှန်ပါ။'); }
      const result = await executeAgentAction(String(args.action || ''), args);
      if (String(args.action || '') === 'get_weather') {
        answer = result;
      } else {
        const follow = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'Myk Guardian AI' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...history.map(m => ({ role: m.role, content: m.content })), { role: 'assistant', content: null, tool_calls: [call] }, { role: 'tool', tool_call_id: call.id, content: result }], temperature: 0.4, max_tokens: 500 }) });
        const followData = await follow.json();
        if (!follow.ok) throw new Error(followData?.error?.message || 'AI action result error');
        answer = followData?.choices?.[0]?.message?.content?.trim() || result;
      }
    } else answer = typeof message?.content === 'string' ? message.content.trim() : '';
    messages.push({ role: 'assistant', content: answer || 'AI က စာသားအဖြေမပြန်ပေးခဲ့ပါ။ Model သို့မဟုတ် API Key ကို စစ်ဆေးပါ။' });
  } catch (err) {
    messages.push({ role: 'assistant', content: 'AI/ဖုန်းလုပ်ဆောင်ချက် မအောင်မြင်ပါ။ ' + (err instanceof Error ? err.message : 'Unknown error') + '\nSettings ထဲက OpenRouter API Key, Model နဲ့ အင်တာနက်ကို စစ်ပါ။' });
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
  view.innerHTML = `<div class="section-head"><div><span class="eyebrow">TASK ORCHESTRATOR</span><h2>Agent Control</h2></div><span class="pill">LIVE ANDROID STATUS</span></div>
    <div class="notice"><b>Android ခွင့်ပြုချက်အခြေအနေ</b><p>အောက်ပါအခြေအနေများကို Android OS မှ တိုက်ရိုက်စစ်ဆေးထားသည်။ Accessibility/Notification ကို Settings မှ ကိုယ်တိုင်ဖွင့်ရမည်။ Location/Microphone အတွက် ခွင့်ပြုချက်မရသေးလျှင် စမ်းသပ်ခလုတ်မှ တောင်းဆိုနိုင်သည်။</p></div>
    <div class="action-grid">
      <button class="action-card" id="agentAccessibility"><span>⌘</span><b>Accessibility ဖွင့်ရန်</b><small>Android OS Settings</small></button>
      <button class="action-card" id="agentNotifications"><span>🔔</span><b>Notification Access</b><small>Android OS Settings</small></button>
      <button class="action-card" id="agentLocation"><span>📍</span><b>Location စမ်းရန်</b><small>OS permission တောင်းရန်</small></button>
      <button class="action-card" id="agentMic"><span>🎙</span><b>Microphone စမ်းရန်</b><small>OS permission တောင်းရန်</small></button>
      <button class="action-card" id="agentBack"><span>↩</span><b>Back Action</b><small>အရင်စာမျက်နှာသို့ ပြန်ရန်</small></button>
      <button class="action-card" id="agentRefresh"><span>⟳</span><b>အခြေအနေ ပြန်စစ်ရန်</b><small>Native status refresh</small></button>
    </div>
    <div class="card"><div class="card-title">OS Permission နှင့် Native Integration</div>
      <div class="status-row"><div><b>Native plugin</b><small id="agentNativeDetail">စစ်ဆေးနေသည်…</small></div><span id="agentNativeState" class="state">CHECKING</span></div>
      <div class="status-row"><div><b>Accessibility Service</b><small id="agentAccessDetail">စစ်ဆေးနေသည်…</small></div><span id="agentAccessState" class="state">CHECKING</span></div>
      <div class="status-row"><div><b>Notification Access</b><small id="agentNotificationDetail">စစ်ဆေးနေသည်…</small></div><span id="agentNotificationState" class="state">CHECKING</span></div>
      <div class="status-row"><div><b>Microphone permission</b><small id="agentMicDetail">စစ်ဆေးနေသည်…</small></div><span id="agentMicState" class="state">CHECKING</span></div>
      <div class="status-row"><div><b>Location permission</b><small id="agentLocationDetail">စစ်ဆေးနေသည်…</small></div><span id="agentLocationState" class="state">CHECKING</span></div>
      <p class="hint" id="agentActionResult" aria-live="polite">အခြေအနေကို Android မှ စစ်ဆေးနေသည်။</p>
    </div>`;
  const resultLine = view.querySelector<HTMLElement>('#agentActionResult')!;
  const setState = (id: string, enabled: boolean, detail: string) => {
    const state = view.querySelector<HTMLElement>('#' + id + 'State')!;
    const description = view.querySelector<HTMLElement>('#' + id + 'Detail')!;
    state.textContent = enabled ? 'ENABLED' : 'DISABLED';
    state.classList.toggle('enabled', enabled);
    description.textContent = detail;
  };
  const refreshStatus = async () => {
    resultLine.textContent = 'Android OS ခွင့်ပြုချက်များကို ပြန်စစ်နေသည်…';
    try {
      const status = await MykNative.getStatus();
      setState('agentNative', true, 'Capacitor native plugin ဆက်သွယ်မှု အောင်မြင်သည်');
      setState('agentAccess', status.accessibilityEnabled && status.serviceConnected,
        status.accessibilityEnabled ? (status.serviceConnected ? 'Enabled ဖြစ်ပြီး service ချိတ်ဆက်ထားသည်' : 'Settings မှ On ဖြစ်သော်လည်း service မချိတ်ဆက်သေးပါ — Off/On ပြန်လုပ်ပါ') : 'Android Accessibility Settings မှ Enable လုပ်ပါ');
      setState('agentNotification', status.notificationEnabled, status.notificationEnabled ? 'Notification listener ခွင့်ပြုထားသည်' : 'Notification Access Settings မှ Enable လုပ်ပါ');
      setState('agentMic', status.microphoneGranted, status.microphoneGranted ? 'Android RECORD_AUDIO permission ရရှိထားသည်' : 'စမ်းသပ်ရန် ခလုတ်ကိုနှိပ်ပြီး Microphone Allow လုပ်ပါ');
      setState('agentLocation', status.locationGranted, status.locationGranted ? 'Android Location permission ရရှိထားသည်' : 'စမ်းသပ်ရန် ခလုတ်ကိုနှိပ်ပြီး Location Allow လုပ်ပါ');
      resultLine.textContent = 'OS မှ အခြေအနေကို အောင်မြင်စွာ ပြန်စစ်ပြီးပါပြီ။';
    } catch (err) {
      setState('agentNative', false, 'Native plugin မရပါ။ ဒီ branch မှ နောက်ဆုံး APK ကို build/install လုပ်ပါ။');
      setState('agentAccess', false, 'Native status မရရှိပါ'); setState('agentNotification', false, 'Native status မရရှိပါ');
      setState('agentMic', false, 'Native status မရရှိပါ'); setState('agentLocation', false, 'Native status မရရှိပါ');
      resultLine.textContent = 'Native integration မရပါ: ' + (err instanceof Error ? err.message : 'unknown error');
    }
  };
  view.querySelector('#agentAccessibility')?.addEventListener('click', async () => {
    try { await MykNative.openAccessibilitySettings(); resultLine.textContent = 'Accessibility Settings ဖွင့်ပြီးပါပြီ။ Myk Guardian AI ကို Enable လုပ်ပြီး ပြန်လာပါ။'; }
    catch (err) { resultLine.textContent = 'Settings မဖွင့်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error'); }
  });
  view.querySelector('#agentNotifications')?.addEventListener('click', async () => {
    try { await MykNative.openNotificationSettings(); resultLine.textContent = 'Notification Access Settings ဖွင့်ပြီးပါပြီ။ Myk Guardian AI ကို Enable လုပ်ပြီး ပြန်လာပါ။'; }
    catch (err) { resultLine.textContent = 'Settings မဖွင့်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error'); }
  });
  view.querySelector('#agentLocation')?.addEventListener('click', async () => {
    try {
      let status = await Geolocation.checkPermissions();
      if (status.location !== 'granted') status = await Geolocation.requestPermissions();
      if (status.location === 'granted') {
        await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 });
        resultLine.textContent = 'Location permission ရရှိပြီး တည်နေရာစမ်းသပ်မှု အောင်မြင်သည်။';
      } else resultLine.textContent = 'Location permission မရသေးပါ: ' + status.location;
    } catch (err) { resultLine.textContent = 'Location စမ်းသပ်မှု မအောင်မြင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error'); }
    await refreshStatus();
  });
  view.querySelector('#agentMic')?.addEventListener('click', async () => {
    try {
      const permission = await VoiceRecorder.requestAudioRecordingPermission();
      if (!permission.value) throw new Error('Microphone permission ကို Android က ခွင့်မပြုပါ။');
      await VoiceRecorder.startRecording(); await new Promise(resolve => window.setTimeout(resolve, 350)); await VoiceRecorder.stopRecording();
      resultLine.textContent = 'Microphone permission ရရှိပြီး စမ်းသပ်ပြီးချင်း ရပ်ထားသည်။ အသံဖိုင်ကို မသိမ်းပါ။';
    } catch (err) { resultLine.textContent = 'Microphone စမ်းသပ်မှု မအောင်မြင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error'); }
    await refreshStatus();
  });
  view.querySelector('#agentBack')?.addEventListener('click', () => {
    const hadPrevious = tabHistory.length > 0;
    goBackInApp();
    const nextView = document.querySelector<HTMLElement>('#view');
    if (nextView && activeTab === 'chat' && !hadPrevious) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'အရင်စာမျက်နှာ မရှိသေးသောကြောင့် Chat စာမျက်နှာသို့ ပြန်ထားပါသည်။';
      nextView.appendChild(hint);
    }
  });
  view.querySelector('#agentRefresh')?.addEventListener('click', () => { void refreshStatus(); });
  window.addEventListener('focus', () => { void refreshStatus(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshStatus(); });
  void refreshStatus();
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
      <div class="status-row"><div><b>နောက်ဆုံး Notification များ</b><small id="recentNotifications">ခွင့်ပြုထားမှသာ ဖတ်နိုင်သည်။ ဖုန်းထဲမှာပဲ သိမ်းထားသည်။</small></div><button class="secondary" id="readNotifications">ဖတ်ရန်</button></div>
      <div class="status-row"><div><b>↩ Back Action စမ်းသပ်ရန်</b><small id="backTestStatus">Myk အတွင်းရှိ ယခင်စာမျက်နှာသို့ ပြန်သွားရန်</small></div><button class="secondary" id="testBack">Back လုပ်ရန်</button></div>
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
      notificationStatus.textContent = status.notificationEnabled ? 'App notification ခွင့်ပြုထားသည်' : 'App notification ပိတ်ထားသည်';
      if (status.accessibilityEnabled && !status.serviceConnected) accessibilityStatus.textContent = 'Settings မှ On ဖြစ်နေသည်၊ သို့သော် Android Service မချိတ်ဆက်သေးပါ။ App ကိုပိတ်ဖွင့်ပြီး မရလျှင် Accessibility ကို Off/On ပြန်လုပ်ပါ။';
    } catch (err) {
      accessibilityStatus.textContent = 'Native plugin မရပါ။ နောက်ဆုံး APK ကို install လုပ်ထားကြောင်း စစ်ပါ။';
      notificationStatus.textContent = 'Native plugin မရပါ။ နောက်ဆုံး APK ကို install လုပ်ထားကြောင်း စစ်ပါ။';
    }
  };
  void refreshNativeStatus();
  // Android Settings returns to the WebView; refresh actual native status on resume/focus.
  const refreshOnResume = () => { void refreshNativeStatus(); };
  window.addEventListener('focus', refreshOnResume);
  document.addEventListener('visibilitychange', refreshOnResume);
  view.querySelector<HTMLButtonElement>('#enableAccessibility')!.addEventListener('click', async () => {
    try { await MykNative.openAccessibilitySettings(); alert('Android Accessibility Settings ပွင့်လာပါမယ်။ Myk Guardian AI ကို ရွေးပြီး Enable လုပ်ပါ။'); }
    catch (err) { alert('Accessibility Settings မဖွင့်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error')); }
  });
  view.querySelector<HTMLButtonElement>('#enableNotifications')!.addEventListener('click', async () => {
    try { await MykNative.openNotificationSettings(); alert('Notification Access စာမျက်နှာမှာ Myk Guardian AI ကို ဖွင့်ပေးပါ။'); }
    catch (err) { alert('Notification Settings မဖွင့်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error')); }
  });
  view.querySelector<HTMLButtonElement>('#readNotifications')!.addEventListener('click', async () => {
    const output = view.querySelector<HTMLElement>('#recentNotifications')!;
    const button = view.querySelector<HTMLButtonElement>('#readNotifications')!;
    button.disabled = true;
    try {
      const status = await MykNative.getStatus();
      if (!status.notificationEnabled) {
        output.textContent = 'Notification Access မဖွင့်ရသေးပါ။ Settings ဖွင့်ပြီး Myk Guardian AI ကို Allow လုပ်ပါ။';
        return;
      }
      const result = await MykNative.getRecentNotifications();
      if (!result.notifications.length) {
        output.textContent = 'ဖတ်စရာ Notification မရှိသေးပါ။ ခွင့်ပြုပြီးနောက် ဝင်လာသော Notification များကို စမ်းပါ။';
      } else {
        output.innerHTML = result.notifications.map(n =>
          '<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>' + esc(n.title || n.packageName) + '</b><div>' + esc(n.text || '(စာသားမပါ)') + '</div><small>' + esc(n.packageName) + '</small></div>'
        ).join('');
      }
    } catch (err) {
      output.textContent = 'Notification မဖတ်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error');
    } finally {
      button.disabled = false;
    }
  });
  view.querySelector<HTMLButtonElement>('#testBack')!.addEventListener('click', () => {
    goBackInApp();
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
  view.innerHTML = `<div class="section-head"><div><span class="eyebrow">SYSTEM CONFIGURATION</span><h2>ဆက်တင်</h2></div><span class="pill">OPENROUTER</span></div>
    <div class="card settings-card">
      <label for="apiKey">OpenRouter API Key</label>
      <input id="apiKey" type="password" autocomplete="off" placeholder="sk-or-v1-…" value="${esc(key)}">
      <small>API Key ကို ဒီဖုန်းထဲမှာပဲ သိမ်းထားပါတယ်။ Key ကို အခြားသူထံ မမျှဝေပါနဲ့။</small>
      <button class="secondary wide" id="showKey">API Key ပြ / ဖျောက်</button>
      <hr>
      <label for="modelSearch">Model ရှာရန်</label>
      <input id="modelSearch" type="text" placeholder="ဥပမာ - GPT, Qwen, Llama">
      <label for="modelSelect">OpenRouter Model ရွေးရန်</label>
      <select id="modelSelect"><option value="${esc(model)}" selected>${esc(model)} · လက်ရှိရွေးထားသည်</option></select>
      <small id="modelPriceInfo">Model စာရင်းရယူပြီးနောက် token ဈေးနှုန်းကို ပြပါမယ်။ ဈေးနှုန်းက OpenRouter က ပေးတဲ့ အချက်အလက်အပေါ် မူတည်ပါတယ်။</small>
      <button class="primary wide" id="loadModels">OpenRouter မှ Model စာရင်းရယူရန်</button>
      <p id="modelStatus" class="muted" aria-live="polite">Model ရွေးချယ်ပြီး Settings သိမ်းပါ။ ကုန်ကျစရိတ်ကို Model အလိုက် ကွာခြားနိုင်ပါတယ်။</p>
      <button class="primary wide" id="saveSettings">Settings သိမ်းမယ်</button>
      <button class="danger wide" id="deleteKeys">OpenRouter API Key ဖျက်မယ်</button>
    </div>
    <div class="card">
      <div class="card-title">🎙 ဗေဒါရီ Voice Assistant · Wake Word</div>
      <p class="muted">“ဗေဒါရီရေ၊ …” လို့ခေါ်ပြီး နားထောင်နိုင်ရန် Android foreground microphone service ကို ကိုယ်တိုင်ဖွင့်ပါ။ နားထောင်နေစဉ် Notification ပြမည်။</p>
      <p class="muted"><b>သိထားရန်:</b> Speech Recognition ရရှိနိုင်မှု၊ အင်တာနက်နဲ့ Android background ကန့်သတ်ချက်များအပေါ် မူတည်သည်။ Lock PIN/လက်ဗွေကို ကျော်ဖြေမည်မဟုတ်ပါ။</p>
      <div class="status-row"><div><b>Wake Word နားထောင်မှု</b><small id="vedariWakeStatus">အခြေအနေ စစ်ဆေးနေသည်…</small></div><span class="state" id="vedariWakeState">CHECKING</span></div>
      <button class="primary wide" id="startVedariWake">ဗေဒါရီ နားထောင်မှု စတင်ရန်</button>
      <button class="secondary wide" id="stopVedariWake">နားထောင်မှု ရပ်ရန်</button>
    </div>
    <div class="card">
      <div class="card-title">🎙 မြန်မာစကား ကြားမှားမှု ပြင်ဆင်ခြင်း</div>
      <p class="muted">Voice ID မလိုပါ။ Speech Recognition က ကြားမှားတတ်တဲ့ စကားကို မှန်ကန်တဲ့အမိန့်နဲ့ တွဲမှတ်ထားနိုင်ပါတယ်။ ဒီအရာက ရေရှည် AI Memory စနစ်မဟုတ်ပါ။</p>
      <label for="heardPhrase">ကြားမိတဲ့ စကား</label><input id="heardPhrase" placeholder="ဥပမာ - ယူကျု နောက်တစ်ပုဒ်ကျော်ပေး">
      <label for="correctPhrase">မှန်ကန်တဲ့ အမိန့်</label><input id="correctPhrase" placeholder="ဥပမာ - YouTube မှာ နောက်တစ်ပုဒ်ကျော်ပေး">
      <button class="primary wide" id="savePhrase">စကားပြင်ဆင်မှု သိမ်းရန်</button>
      <div id="phraseList" class="muted"></div>
      <p id="voiceLearningResult" class="muted" aria-live="polite"></p>
    </div>`;
  const modelSelect = view.querySelector<HTMLSelectElement>('#modelSelect')!;
  const modelSearch = view.querySelector<HTMLInputElement>('#modelSearch')!;
  const modelPriceInfo = view.querySelector<HTMLElement>('#modelPriceInfo')!;
  const modelStatus = view.querySelector<HTMLElement>('#modelStatus')!;
  let availableModels: Array<{id:string; name:string; prompt:string; completion:string; context:number}> = [];
  const moneyPerMillion = (price: string) => {
    const n = Number(price);
    if (!Number.isFinite(n)) return 'ဈေးနှုန်းမသိ';
    if (n === 0) return 'အခမဲ့';
    return '$' + (n * 1_000_000).toLocaleString('en-US', {maximumFractionDigits: 4});
  };
  const modelLabel = (m: {id:string;name:string;prompt:string;completion:string}) =>
    `${m.name} · ${m.id} · In ${moneyPerMillion(m.prompt)} / Out ${moneyPerMillion(m.completion)} per 1M tokens`;
  const renderModelOptions = () => {
    const q = modelSearch.value.trim().toLowerCase();
    const filtered = availableModels.filter(m => !q || (m.id + ' ' + m.name).toLowerCase().includes(q));
    const selected = modelSelect.value || localStorage.getItem(MODEL_NAME) || DEFAULT_MODEL;
    modelSelect.innerHTML = '';
    if (!filtered.some(m => m.id === selected)) {
      const option = document.createElement('option');
      option.value = selected; option.textContent = selected + ' · လက်ရှိရွေးထားသည်'; modelSelect.appendChild(option);
    }
    filtered.slice(0, 150).forEach(m => {
      const option = document.createElement('option');
      option.value = m.id; option.textContent = modelLabel(m);
      if (m.id === selected) option.selected = true;
      modelSelect.appendChild(option);
    });
    updateSelectedModelInfo();
    modelStatus.textContent = filtered.length
      ? `မော်ဒယ် ${filtered.length} ခု တွေ့ရှိသည်။ ဈေးသက်သာသော မော်ဒယ်များကို အပေါ်ဘက်တွင် ဦးစားပေးထားပါတယ်။`
      : availableModels.length ? 'ရှာဖွေမှုနဲ့ ကိုက်ညီတဲ့ Model မရှိပါ။ စာလုံးအနည်းငယ်ပဲ ရိုက်ရှာကြည့်ပါ။' : modelStatus.textContent;
  };
  const updateSelectedModelInfo = () => {
    const m = availableModels.find(item => item.id === modelSelect.value);
    modelPriceInfo.textContent = m
      ? `Input: ${moneyPerMillion(m.prompt)} / 1M tokens · Output: ${moneyPerMillion(m.completion)} / 1M tokens${m.context ? ' · Context: ' + m.context.toLocaleString('en-US') : ''}. API usage အမှန်တကယ်ကုန်ကျစရိတ်ကို OpenRouter Dashboard မှာ ပြန်စစ်ပါ။`
      : 'ဒီ Model အတွက် ဈေးနှုန်းကို မရသေးပါ။ Model စာရင်းရယူရန် ခလုတ်ကို နှိပ်ပါ။';
  };
  modelSearch.addEventListener('input', renderModelOptions);
  modelSelect.addEventListener('change', updateSelectedModelInfo);
  view.querySelector<HTMLButtonElement>('#loadModels')!.addEventListener('click', async () => {
    const apiKey = view.querySelector<HTMLInputElement>('#apiKey')!.value.trim();
    if (!apiKey) { modelStatus.textContent = 'Model စာရင်းရယူဖို့ OpenRouter API Key အရင်ထည့်ပါ။'; return; }
    const button = view.querySelector<HTMLButtonElement>('#loadModels')!;
    button.disabled = true; modelStatus.textContent = 'OpenRouter Model စာရင်းကို ရယူနေသည်…';
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': 'Bearer ' + apiKey, 'X-Title': 'Myk Guardian AI' }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'OpenRouter HTTP ' + response.status);
      availableModels = (Array.isArray(data?.data) ? data.data : [])
        .filter((m: any) => typeof m?.id === 'string' && m?.pricing && (!Array.isArray(m.supported_parameters) || m.supported_parameters.includes('tools')))
        .map((m: any) => ({
          id: String(m.id), name: String(m.name || m.id),
          prompt: String(m.pricing.prompt ?? '0'), completion: String(m.pricing.completion ?? '0'),
          context: Number(m.context_length || 0)
        }))
        .sort((x, y) => (Number(x.prompt) + Number(x.completion)) - (Number(y.prompt) + Number(y.completion)));
      if (!availableModels.length) throw new Error('ဈေးနှုန်းပါသော Model စာရင်း မရရှိပါ။');
      renderModelOptions();
      modelStatus.textContent = `Model ${availableModels.length} ခု ရရှိပါပြီ။ စျေးနှုန်းနဲ့ ကိုက်ညီတာကို ရွေးပါ။`;
    } catch (err) {
      modelStatus.textContent = 'Model စာရင်းမရပါ: ' + (err instanceof Error ? err.message : 'Network error') + '။ အင်တာနက်နဲ့ API Key ကို စစ်ပါ။';
    } finally { button.disabled = false; }
  });
  view.querySelector<HTMLButtonElement>('#saveSettings')!.addEventListener('click', () => {
    const apiKey = view.querySelector<HTMLInputElement>('#apiKey')!.value.trim();
    const selectedModel = modelSelect.value.trim();
    if (apiKey && !apiKey.startsWith('sk-or-') && !confirm('OpenRouter Key ပုံစံက sk-or- နဲ့ မစပါ။ ဒီအတိုင်း သိမ်းမလား?')) return;
    if (apiKey) localStorage.setItem(KEY_NAME, apiKey); else localStorage.removeItem(KEY_NAME);
    localStorage.setItem(MODEL_NAME, selectedModel || DEFAULT_MODEL);
    // Remove legacy Gemini/provider settings so the app has one clear API configuration.
    localStorage.removeItem('myk.ai.provider');
    localStorage.removeItem('myk.gemini.key');
    localStorage.removeItem('myk.gemini.model');
    alert('OpenRouter Settings သိမ်းပြီးပါပြီ။ Model: ' + (selectedModel || DEFAULT_MODEL)); render();
  });
  view.querySelector<HTMLButtonElement>('#showKey')!.addEventListener('click', () => {
    const input = view.querySelector<HTMLInputElement>('#apiKey')!;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  view.querySelector<HTMLButtonElement>('#deleteKeys')!.addEventListener('click', () => {
    if (!confirm('ဒီဖုန်းထဲက OpenRouter API Key ကို ဖျက်မှာ သေချာပါသလား?')) return;
    localStorage.removeItem(KEY_NAME);
    view.querySelector<HTMLInputElement>('#apiKey')!.value = '';
    alert('OpenRouter API Key ကို ဖျက်လိုက်ပါပြီ။');
  });
  const wakeStatus = view.querySelector<HTMLElement>('#vedariWakeStatus')!;
  const wakeState = view.querySelector<HTMLElement>('#vedariWakeState')!;
  const refreshWakeStatus = async () => {
    try {
      const status = await MykNative.getPendingWakeCommand();
      wakeState.textContent = status.listening ? 'LISTENING' : 'STOPPED';
      wakeState.classList.toggle('enabled', status.listening);
      wakeStatus.textContent = status.listening ? 'Foreground service အလုပ်လုပ်နေသည်။ Notification ကိုလည်း စစ်ပါ။' : 'နားထောင်မှု ပိတ်ထားသည်။';
    } catch (err) {
      wakeState.textContent = 'UNAVAILABLE';
      wakeState.classList.remove('enabled');
      wakeStatus.textContent = 'Native service မရပါ: ' + (err instanceof Error ? err.message : 'unknown error');
    }
  };
  view.querySelector<HTMLButtonElement>('#startVedariWake')!.addEventListener('click', async () => {
    try {
      const result = await MykNative.startVedariWakeListening();
      wakeStatus.textContent = result.message || 'Wake Word နားထောင်မှု စတင်လိုက်ပါပြီ။';
    } catch (err) {
      wakeStatus.textContent = 'မစတင်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'Microphone permission ကို စစ်ပါ။');
    }
    await refreshWakeStatus();
  });
  view.querySelector<HTMLButtonElement>('#stopVedariWake')!.addEventListener('click', async () => {
    try {
      const result = await MykNative.stopVedariWakeListening();
      wakeStatus.textContent = result.message || 'နားထောင်မှု ရပ်လိုက်ပါပြီ။';
    } catch (err) {
      wakeStatus.textContent = 'မရပ်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error');
    }
    await refreshWakeStatus();
  });
  void refreshWakeStatus();
  const voiceResult = view.querySelector<HTMLElement>('#voiceLearningResult')!;
  const refreshVoiceProfile = () => {
    const phraseMap = getPhraseMap();
    const list = view.querySelector<HTMLElement>('#phraseList')!;
    const entries = Object.entries(phraseMap);
    list.innerHTML = entries.length ? '<b>မှတ်ထားတဲ့ စကားများ</b>' + entries.map(([heard, intended]) =>
      '<div style="padding:7px 0;border-bottom:1px solid var(--line)"><div>ကြားမိ: ' + esc(heard) + '</div><div>ပြောင်းရန်: ' + esc(intended) + '</div><button type="button" class="secondary" data-remove-phrase="' + esc(heard) + '">ဖျက်ရန်</button></div>'
    ).join('') : 'စကားပြင်ဆင်မှု မမှတ်ထားရသေးပါ။';
    list.querySelectorAll<HTMLButtonElement>('[data-remove-phrase]').forEach(button => button.addEventListener('click', () => {
      removePhraseCorrection(button.dataset.removePhrase || '');
      refreshVoiceProfile();
      voiceResult.textContent = 'မှတ်ထားတဲ့ စကားပြင်ဆင်မှုကို ဖျက်လိုက်ပါပြီ။';
    }));
  };
  refreshVoiceProfile();
  view.querySelector<HTMLButtonElement>('#savePhrase')!.addEventListener('click', () => {
    const heard = view.querySelector<HTMLInputElement>('#heardPhrase')!.value;
    const intended = view.querySelector<HTMLInputElement>('#correctPhrase')!.value;
    try {
      savePhraseCorrection(heard, intended);
      view.querySelector<HTMLInputElement>('#heardPhrase')!.value = '';
      view.querySelector<HTMLInputElement>('#correctPhrase')!.value = '';
      voiceResult.textContent = 'စကားပြင်ဆင်မှုကို ဖုန်းထဲမှာ မှတ်သားပြီးပါပြီ။';
      refreshVoiceProfile();
    } catch (err) { voiceResult.textContent = err instanceof Error ? err.message : 'စကားကို မသိမ်းနိုင်ပါ။'; }
  });
}

let consumingWakeCommand = false;
async function consumeVedariWakeCommand() {
  if (consumingWakeCommand) return;
  consumingWakeCommand = true;
  try {
    const pending = await MykNative.getPendingWakeCommand();
    const command = pending.command?.trim();
    if (command === '__VEDARI_WAKE_ONLY__') {
      navigateTab('chat');
      messages.push({ role: 'assistant', content: 'ဟုတ်ကဲ့၊ နားထောင်နေပါတယ်။ ဘာလုပ်ပေးရမလဲနော်?' });
      render();
    } else if (command) {
      navigateTab('chat');
      window.setTimeout(() => {
        const input = document.querySelector<HTMLTextAreaElement>('#prompt');
        const form = document.querySelector<HTMLFormElement>('#chatForm');
        if (input && form && !busy) {
          input.value = command;
          form.requestSubmit();
        }
      }, 180);
    }
  } catch { /* Web-only preview has no native wake service. */ }
  finally { consumingWakeCommand = false; }
}
window.addEventListener('focus', () => { void consumeVedariWakeCommand(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void consumeVedariWakeCommand(); });

render();
window.setTimeout(() => { void consumeVedariWakeCommand(); }, 500);
