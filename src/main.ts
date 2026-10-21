import './style.css';
import { AMARA_SYSTEM_PROMPT } from './amara-persona';
import { registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { tryNativeCommand, executeAgentAction } from './native-actions';

type Message = { role: 'user' | 'assistant'; content: string };
type MykNativePlugin = { getStatus(): Promise<{ accessibilityEnabled: boolean; serviceConnected?: boolean; notificationEnabled: boolean; locationGranted?: boolean; microphoneGranted?: boolean }>; openAccessibilitySettings(): Promise<void>; openNotificationSettings(): Promise<void>; performAction(options: { action: string; text?: string; number?: string; exact?: boolean; hour?: number; minute?: number; label?: string }): Promise<{ success: boolean; message?: string }>; reverseGeocode(options: {latitude:number;longitude:number}): Promise<{address?:string}> };
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
  { role: 'assistant', content: 'မင်္ဂလာပါ။ အမရာပါ။ 😊 မင်းဘာလိုအပ်လဲ ပြောလိုက်နော်။ Gemini သို့မဟုတ် OpenRouter API Key ထည့်ပြီး ဖုန်းလုပ်ဆောင်ချက်တွေကို မြန်မာလို ခိုင်းနိုင်ပါတယ်။' }
];
let activeTab = 'chat';
const tabHistory: string[] = [];
window.addEventListener('amara-native-back', () => {
  const drawer = document.querySelector<HTMLElement>('#appDrawer');
  if (drawer?.classList.contains('open')) {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    const scrim = document.querySelector<HTMLElement>('#drawerScrim');
    if (scrim) scrim.hidden = true;
    document.body.classList.remove('drawer-open');
    return;
  }
  if (activeTab !== 'chat') {
    activeTab = tabHistory.pop() || 'chat';
    render();
  }
});
let busy = false;
type SavedChat = { id: string; title: string; updatedAt: number; messages: Message[] };
const CHAT_STORE = 'amara.chat.history.v1';
let activeChatId = 'chat-' + Date.now();
let savedChats: SavedChat[] = (() => { try { const x = JSON.parse(localStorage.getItem(CHAT_STORE) || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } })();
function persistCurrentChat() {
  const existing = savedChats.findIndex(c => c.id === activeChatId);
  const firstUser = messages.find(m => m.role === 'user')?.content || '';
  const chat: SavedChat = { id: activeChatId, title: firstUser.slice(0, 36) || 'New chat', updatedAt: Date.now(), messages: messages.map(m => ({...m})) };
  if (existing >= 0) savedChats[existing] = chat; else savedChats.unshift(chat);
  savedChats = savedChats.slice(0, 40);
  try { localStorage.setItem(CHAT_STORE, JSON.stringify(savedChats)); } catch {}
}
function startNewChat() {
  persistCurrentChat();
  activeChatId = 'chat-' + Date.now();
  messages = [{ role: 'assistant', content: 'မင်္ဂလာပါ။ အမရာပါ။ 😊 ဘာကူညီပေးရမလဲ။' }];
  activeTab = 'chat';
  render();
}

function render() {
  const perms = readPerms();
  const menuItems = [
    {id:'chat',icon:'✳',title:'Chat',sub:'မြန်မာလို စကားပြော',tone:'mint'},
    {id:'brain',icon:'🧠',title:'Brain',sub:'ကိုယ်ပိုင်မှတ်ဉာဏ်',tone:'violet'},
    {id:'agent',icon:'✣',title:'Agent',sub:'ဖုန်းလုပ်ဆောင်ချက်များ',tone:'blue'},
    {id:'permissions',icon:'⛨',title:'Permissions',sub:'ခွင့်ပြုချက်များ',tone:'amber'},
    {id:'settings',icon:'⚙',title:'Settings',sub:'API နှင့် Model',tone:'rose'}
  ];
  app.innerHTML = `
    <div class="ambient ambient-a"></div><div class="ambient ambient-b"></div>
    <header class="topbar">
      <button class="menu-toggle" id="menuToggle" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>
      <div class="brandmark">A<span>✦</span></div>
      <div class="brand"><b>AMARA <span>AI</span></b><small>YOUR PERSONAL AI</small></div>
      <button class="iconbtn" id="headerAction" aria-label="${activeTab==='chat'?'New chat':'Go to chat'}">${activeTab==='chat'?'＋':'⌂'}</button>
    </header>
    <div class="drawer-scrim" id="drawerScrim" hidden></div>
    <aside class="app-drawer" id="appDrawer" aria-label="Main menu" aria-hidden="true">
      <div class="drawer-heading"><div class="brandmark">A<span>✦</span></div><div><b>AMARA AI</b><small>ကိုယ်ပိုင် AI လက်ထောက်</small></div><button class="drawer-close" id="drawerClose" aria-label="Close menu">×</button></div>
      <p class="drawer-label">လုပ်ဆောင်ချက်များ</p>
      <div class="drawer-grid">${menuItems.map(item=>`<button class="drawer-item ${item.tone} ${activeTab===item.id?'selected':''}" data-tab="${item.id}"><span class="drawer-icon">${item.icon}</span><b>${item.title}</b><small>${item.sub}</small></button>`).join('')}</div>
      <button class="drawer-new-chat" id="newChatButton"><span>＋</span> စကားဝိုင်းအသစ် (New chat)</button>
      <div class="history-heading">Chat history</div><div class="chat-history-list" id="chatHistoryList"></div>
      <div class="drawer-note"><span>●</span> မင်းရဲ့ AI · မင်းထိန်းချုပ်မှု</div>
    </aside>
    <main><section id="view"></section></main>
    <footer><span>AMARA AI</span><span>YOUR SPACE · YOUR CONTROL</span></footer>`;
  const drawer = app.querySelector<HTMLElement>('#appDrawer')!;
  const scrim = app.querySelector<HTMLElement>('#drawerScrim')!;
  const toggle = app.querySelector<HTMLButtonElement>('#menuToggle')!;
  const setDrawer = (open:boolean) => {
    drawer.classList.toggle('open',open); scrim.hidden=!open;
    drawer.setAttribute('aria-hidden',String(!open)); toggle.setAttribute('aria-expanded',String(open));
    document.body.classList.toggle('drawer-open',open);
  };
  toggle.addEventListener('click',()=>setDrawer(!drawer.classList.contains('open')));
  app.querySelector('#drawerClose')!.addEventListener('click',()=>setDrawer(false));
  scrim.addEventListener('click',()=>setDrawer(false));
  app.querySelector<HTMLButtonElement>('#newChatButton')!.addEventListener('click',()=>{setDrawer(false);startNewChat();});
  const historyList=app.querySelector<HTMLElement>('#chatHistoryList')!;
  historyList.innerHTML=savedChats.slice().sort((a,b)=>b.updatedAt-a.updatedAt).map(c=>'<div class="history-row"><button class="history-item '+(c.id===activeChatId?'current':'')+'" data-chat-id="'+esc(c.id)+'"><span>◷</span><span class="history-title">'+esc(c.title||'New chat')+'</span></button><button class="history-delete" data-delete-chat="'+esc(c.id)+'" aria-label="Delete chat">×</button></div>').join('')||'<div class="history-empty">စကားဝိုင်းဟောင်း မရှိသေးပါ</div>';
  historyList.querySelectorAll<HTMLButtonElement>('[data-chat-id]').forEach(b=>b.addEventListener('click',()=>{const c=savedChats.find(x=>x.id===b.dataset.chatId);if(c){activeChatId=c.id;messages=c.messages.map(m=>({...m}));activeTab='chat';setDrawer(false);render();}}));
  historyList.querySelectorAll<HTMLButtonElement>('[data-delete-chat]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();const id=(e.currentTarget as HTMLButtonElement).dataset.deleteChat!;savedChats=savedChats.filter(c=>c.id!==id);try{localStorage.setItem(CHAT_STORE,JSON.stringify(savedChats));}catch{}if(id===activeChatId){activeChatId='chat-'+Date.now();messages=[{role:'assistant',content:'မင်္ဂလာပါ။ အမရာပါ။ 😊 ဘာကူညီပေးရမလဲ။'}];}render();}));
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.addEventListener('click',()=>{setDrawer(false);const next=b.dataset.tab!;if(next!==activeTab){tabHistory.push(activeTab);if(tabHistory.length>30)tabHistory.shift();activeTab=next;}render();}));
  app.querySelector<HTMLButtonElement>('#headerAction')!.addEventListener('click',()=>{if(activeTab==='chat')startNewChat();else{activeTab='chat';render();}});
  const view=app.querySelector<HTMLElement>('#view')!;
  if(activeTab==='chat') renderChat(view);
  else if(activeTab==='brain') renderBrain(view);
  else if(activeTab==='agent') renderAgent(view,perms);
  else if(activeTab==='permissions') renderPermissions(view,perms);
  else if(activeTab==='settings') renderSettings(view);
}

type BrainRecord = {id:string;name:string;size:number;type:string;addedAt:number;extracted:boolean};
const BRAIN_DB='amara-brain-v1';
function brainDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const q=indexedDB.open(BRAIN_DB,1);q.onupgradeneeded=()=>{const d=q.result;if(!d.objectStoreNames.contains('files'))d.createObjectStore('files',{keyPath:'id'});if(!d.objectStoreNames.contains('chunks'))d.createObjectStore('chunks',{keyPath:'id'});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function brainFiles():Promise<BrainRecord[]>{const d=await brainDB();return new Promise((resolve,reject)=>{const q=d.transaction('files','readonly').objectStore('files').getAll();q.onsuccess=()=>{d.close();resolve((q.result as BrainRecord[]).sort((a,b)=>b.addedAt-a.addedAt));};q.onerror=()=>{d.close();reject(q.error);};});}
function brainSize(n:number):string{if(!n)return'0 B';const u=['B','KB','MB','GB','TB'];const i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),4);return(n/Math.pow(1024,i)).toFixed(i?1:0)+' '+u[i];}
async function saveBrainFile(file:File,progress:(p:number)=>void):Promise<void>{
 const d=await brainDB(),id=crypto.randomUUID?crypto.randomUUID():'f-'+Date.now()+'-'+Math.random().toString(36).slice(2);
 const isText=/\.(txt|md|json|csv|html?|xml|log|ya?ml|ini|js|ts|py|kt|java|css)$/i.test(file.name)||file.type.startsWith('text/')||file.type==='application/json';
 const rec:BrainRecord={id,name:file.name,size:file.size,type:file.type||'application/octet-stream',addedAt:Date.now(),extracted:isText};
 await new Promise<void>((ok,no)=>{const t=d.transaction('files','readwrite');t.objectStore('files').put({...rec,blob:file});t.oncomplete=()=>ok();t.onerror=()=>no(t.error);});
 if(isText&&file.size){const reader=file.stream().getReader(),decoder=new TextDecoder();let buf='',idx=0,read=0;try{while(true){const x=await reader.read();if(x.done)break;buf+=decoder.decode(x.value,{stream:true});read+=x.value.byteLength;while(buf.length>=65536){const chunk=buf.slice(0,65536);buf=buf.slice(65536);await new Promise<void>((ok,no)=>{const t=d.transaction('chunks','readwrite');t.objectStore('chunks').put({id:id+':'+idx++,fileId:id,fileName:file.name,text:chunk});t.oncomplete=()=>ok();t.onerror=()=>no(t.error);});}progress(Math.min(.98,read/Math.max(file.size,1)));}buf+=decoder.decode();if(buf)await new Promise<void>((ok,no)=>{const t=d.transaction('chunks','readwrite');t.objectStore('chunks').put({id:id+':'+idx,fileId:id,fileName:file.name,text:buf});t.oncomplete=()=>ok();t.onerror=()=>no(t.error);});}finally{reader.releaseLock();}}
 d.close();progress(1);
}
async function brainContext(query:string):Promise<string>{
 const q=query.toLocaleLowerCase().normalize('NFC');
 // Keep real Myanmar Unicode ranges here: doubled backslashes make the regex match literal text instead.
 const raw=(q.match(/[a-z0-9_]{3,}|[\u1000-\u109F]+/g)||[]);
 const terms:string[]=[];
 for(const part of raw){
  if(/[\u1000-\u109F]/.test(part)){
   // Myanmar has no whitespace between many words, so use short n-grams for retrieval.
   for(let n=2;n<=Math.min(5,part.length);n++)for(let i=0;i+n<=part.length;i++)terms.push(part.slice(i,i+n));
  }else terms.push(part);
 }
 const unique=terms.filter((x,i,a)=>a.indexOf(x)===i).slice(0,140);
 const asksAboutSelf=/(ငါ့ကို|ငါ့အကြောင်း|ငါဘယ်သူ|ငါ့နာမည်|ငါ့ရဲ့|မှတ်မိ|သိလား|ဘယ်သူလဲ|about me|who am i|my name|remember me)/i.test(q);
 const d=await brainDB();
 return new Promise((resolve,reject)=>{
  const tx=d.transaction(['chunks','files'],'readonly'),req=tx.objectStore('chunks').openCursor();
  const scores:Array<{score:number;text:string;name:string;id:string}>=[];let chunksScanned=0;
  req.onsuccess=()=>{
   const cur=req.result;if(!cur)return;
   const row=cur.value as {id:string;fileId:string;text:string;fileName:string};
   const lower=String(row.text||'').toLocaleLowerCase().normalize('NFC');let score=0;
   for(const term of unique)if(lower.includes(term))score+=term.length>=4?2:1;
   const name=String(row.fileName||'မှတ်ဉာဏ်ဖိုင်');
   // On personal-profile questions, prioritize files explicitly intended to store the user's identity/history.
   if(asksAboutSelf && /(myk_personal_profile|myk_personal_memory|မှတ်စု|profile|personal.?memory)/i.test(name))score+=8;
   if(score>0){scores.push({score,text:row.text,name,id:row.id});scores.sort((a,b)=>b.score-a.score);if(scores.length>30)scores.pop();}
   chunksScanned++;cur.continue();
  };
  req.onerror=()=>{d.close();reject(req.error);};
  tx.oncomplete=()=>{
   d.close();
   const picked=scores.slice(0,asksAboutSelf?10:7);
   const content=picked.map(x=>'[Brain ဖိုင်: '+x.name+' | ဆက်စပ်မှု '+x.score+']\n'+x.text).join('\n\n').slice(0,14000);
   if(content){
    resolve('\n\n[AMARA BRAIN MEMORY — အောက်ပါစာသားသည် အသုံးပြုသူတင်ထားသောဖိုင်များမှ ရှာတွေ့ထားခြင်းဖြစ်သည်။ ၎င်းကို ဆက်စပ်မှုအလိုက် အခြေခံပြီး တိုက်ရိုက်ဖြေပါ။ အသုံးပြုသူ၏အချက်အလက်နှင့်ဆိုင်သော မေးခွန်းဖြစ်ပါက ဖိုင်ထဲက အချက်အလက်ကို ဦးစားပေးပါ။ မတွေ့သောအချက်ကို မခန့်မှန်းပါနှင့်။]\n'+content);
   }else{
    resolve(unique.length?'\n\n[AMARA BRAIN MEMORY: လက်ရှိမေးခွန်းနှင့် ကိုက်ညီသောဖိုင်စာသားကို မတွေ့ပါ။ မှတ်ဉာဏ်ထဲရှိသည်ဟု မခန့်မှန်းပါနှင့်။]':'');
   }
  };
  tx.onerror=()=>{d.close();reject(tx.error);};
 });
}

async function askAI() {
  const provider = localStorage.getItem(PROVIDER_NAME) || 'openrouter';
  const history = messages.slice(-20);
  let systemPrompt = AMARA_SYSTEM_PROMPT;
  try {
    try { systemPrompt += await brainContext(history[history.length - 1]?.content || ''); } catch { /* Memory retrieval must not block normal chat. */ }
    let answer = '';
    if (provider === 'gemini') {
      const key = localStorage.getItem(GEMINI_KEY_NAME)?.trim();
      if (!key) throw new Error('Gemini API Key မထည့်ရသေးပါ။ Settings မှာ Gemini ကိုရွေးပြီး Key ထည့်ပါ။');
      const model = localStorage.getItem(GEMINI_MODEL_NAME) || 'gemini-2.5-flash';
      const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
      const contents = history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents, tools: GEMINI_TOOLS, generationConfig: { temperature: 0.4, maxOutputTokens: 900 } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Gemini HTTP ' + response.status);
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const call = parts.find((p: any) => p.functionCall?.name === 'phone_action')?.functionCall;
      if (call) {
        const result = await executeAgentAction(String(call.args?.action || ''), call.args || {});
        const follow = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents: [...contents, { role: 'model', parts: [{ functionCall: { name: 'phone_action', args: call.args } }] }, { role: 'user', parts: [{ functionResponse: { name: 'phone_action', response: { result } } }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 500 } }) });
        const followData = await follow.json();
        if (!follow.ok) throw new Error(followData?.error?.message || 'Gemini action result error');
        answer = followData?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('').trim() || result;
      } else answer = parts.map((p: any) => p.text || '').join('').trim();
    } else {
      const key = localStorage.getItem(KEY_NAME)?.trim();
      if (!key) throw new Error('OpenRouter API Key မထည့်ရသေးပါ။ Settings မှာ OpenRouter ကိုရွေးပြီး Key ထည့်ပါ။');
      const model = localStorage.getItem(MODEL_NAME) || DEFAULT_MODEL;
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'AMARA AI' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...history.map(m => ({ role: m.role, content: m.content }))], tools: OPENROUTER_TOOLS, tool_choice: 'auto', temperature: 0.4, max_tokens: 900 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'OpenRouter HTTP ' + response.status);
      const message = data?.choices?.[0]?.message;
      const call = message?.tool_calls?.find((t: any) => t.function?.name === 'phone_action');
      if (call) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { throw new Error('AI action argument မမှန်ပါ။'); }
        const result = await executeAgentAction(String(args.action || ''), args);
        const follow = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'AMARA AI' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...history.map(m => ({ role: m.role, content: m.content })), { role: 'assistant', content: null, tool_calls: [call] }, { role: 'tool', tool_call_id: call.id, content: result }], temperature: 0.4, max_tokens: 500 }) });
        const followData = await follow.json();
        if (!follow.ok) throw new Error(followData?.error?.message || 'AI action result error');
        answer = followData?.choices?.[0]?.message?.content?.trim() || result;
      } else answer = typeof message?.content === 'string' ? message.content.trim() : '';
    }
    messages.push({ role: 'assistant', content: answer || 'AI က စာသားအဖြေမပြန်ပေးခဲ့ပါ။ Model သို့မဟုတ် API Key ကို စစ်ဆေးပါ။' });
    persistCurrentChat();
  } catch (err) {
    messages.push({ role: 'assistant', content: 'AI/ဖုန်းလုပ်ဆောင်ချက် မအောင်မြင်ပါ။ ' + (err instanceof Error ? err.message : 'Unknown error') + '\nSettings ထဲက Provider, API Key, Model နဲ့ အင်တာနက်ကို စစ်ပါ။' });
  }
  busy = false; persistCurrentChat(); render();
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
    if (!confirm('Android Accessibility Settings ကို ဖွင့်မလား? AMARA AI ကို ကိုယ်တိုင်ရွေးပြီး Enable လုပ်နိုင်ပါတယ်။')) return;
    try { await MykNative.openAccessibilitySettings(); }
    catch (err) { alert('Android Settings မဖွင့်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error')); }
  });
  view.querySelector('#testConfirm')?.addEventListener('click', () => {
    if (confirm('ဒီအရာက အတည်ပြုချက် dialog စမ်းသပ်မှုသာဖြစ်ပါတယ်။ ဆက်လုပ်မလား?')) alert('အတည်ပြုချက်ကို လက်ခံရရှိပါတယ်။ စမ်းသပ်မှုသာဖြစ်ပြီး ဖုန်းမှာ ဘာမှမပြောင်းလဲခဲ့ပါ။');
  });
}
function renderPermissions(view: HTMLElement, perms: Record<string, boolean>) {
  view.innerHTML = `<div class="section-head"><div><span class="eyebrow">OWNER AUTHORITY</span><h2>Permission Center</h2></div><span class="pill">REAL PERMISSION TESTS</span></div>
    <div class="notice"><b>ဖုန်းခွင့်ပြုချက်များ</b><p>ခွင့်ပြုချက်တိုင်းကို Android Settings မှာ ကိုယ်တိုင်ဖွင့်/ပိတ်နိုင်ပါတယ်။ အမရာက ခွင့်ပြုချက်မရထားတဲ့ action ကို အောင်မြင်တယ်လို့ မပြပါ။ Notification အကြောင်းအရာများကို ဒီ build က သိမ်းဆည်း/အင်တာနက်သို့ မပို့ပါ။</p></div>
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
      if (!permission.value) throw new Error('Android က microphone permission ကို ခွင့်မပြုပါ။ ဖုန်း Settings > Apps > AMARA AI > Permissions > Microphone ကို Allow လုပ်ပြီး ထပ်စမ်းပါ။');
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
      accessibilityStatus.textContent = status.accessibilityEnabled
        ? (status.serviceConnected ? '✓ Android Settings မှ ဖွင့်ထားပြီး Service ချိတ်ဆက်ထားသည်' : '⚠ Android Settings မှ On ဖြစ်သည်၊ Service မချိတ်ဆက်သေးပါ')
        : '✕ Android Settings မှ ပိတ်ထားသည်';
      notificationStatus.textContent = status.notificationEnabled
        ? '✓ Notification Access ကို Android က ဖွင့်ထားကြောင်း အတည်ပြုသည်'
        : '✕ Notification Access ကို Android Settings မှ ပိတ်ထားသည်';
      const mic = view.querySelector<HTMLElement>('#micStatus');
      if (mic) mic.textContent = status.microphoneGranted ? '✓ Android OS: Microphone ခွင့်ပြုထားသည်' : '✕ Android OS: Microphone ခွင့်မပြုထားပါ';
      const loc = view.querySelector<HTMLElement>('#locationStatus');
      if (loc) loc.textContent = status.locationGranted ? '✓ Android OS: Location permission ရှိသည်' : '✕ Android OS: Location permission မရှိပါ';
    } catch (err) {
      accessibilityStatus.textContent = 'Native status မရပါ — plugin/APK integration ကို စစ်ပါ';
      notificationStatus.textContent = 'Native status မရပါ — plugin/APK integration ကို စစ်ပါ';
      const mic = view.querySelector<HTMLElement>('#micStatus');
      if (mic) mic.textContent = 'Native status မရပါ';
      const loc = view.querySelector<HTMLElement>('#locationStatus');
      if (loc) loc.textContent = 'Native status မရပါ';
    }
  };
  void refreshNativeStatus();
  // Android Settings ပြီး app ကို ပြန်ဖွင့်လာချိန် OS permission များကို ထပ်စစ်ပါ။
  const onPermissionReturn = () => { if (document.visibilityState === 'visible') void refreshNativeStatus(); };
  document.addEventListener('visibilitychange', onPermissionReturn);
  window.addEventListener('focus', onPermissionReturn);
  view.querySelector<HTMLButtonElement>('#enableAccessibility')!.addEventListener('click', async () => {
    try { await MykNative.openAccessibilitySettings(); alert('Android Accessibility Settings ပွင့်လာပါမယ်။ AMARA AI ကို ရွေးပြီး Enable လုပ်ပါ။'); }
    catch (err) { alert('Accessibility Settings မဖွင့်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error')); }
  });
  view.querySelector<HTMLButtonElement>('#enableNotifications')!.addEventListener('click', async () => {
    try { await MykNative.openNotificationSettings(); alert('Notification Access စာမျက်နှာမှာ AMARA AI ကို ဖွင့်ပေးပါ။'); }
    catch (err) { alert('Notification Settings မဖွင့်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error')); }
  });
  view.querySelector<HTMLButtonElement>('#testBack')!.addEventListener('click', async () => {
    if (!confirm('Back action ကို အခုလုပ်မလား? လက်ရှိစာမျက်နှာကနေ ထွက်သွားနိုင်ပါတယ်။')) return;
    try {
      const status = await MykNative.getStatus();
      if (!status.accessibilityEnabled) {
        alert('စစ်ဆေးချက်: Accessibility Service ပိတ်ထားသည်။\\n\\nAndroid Settings > Accessibility > AMARA AI ကို On လုပ်ပါ။');
        return;
      }
      const result = await MykNative.performAction({ action: 'back' });
      // Successful Back is silent; only show a message if native code reports failure.
      if (!result.success) {
        alert('Back Action မအောင်မြင်ပါ။\\n' + (result.message || 'Android က Back ကို လက်မခံပါ။'));
      }
  
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
  const geminiKey = localStorage.getItem(GEMINI_KEY_NAME) || '';
  const geminiModel = localStorage.getItem(GEMINI_MODEL_NAME) || 'gemini-2.5-flash';
  const provider = localStorage.getItem(PROVIDER_NAME) || 'openrouter';
  view.innerHTML = `<div class="section-head"><div><span class="eyebrow">SYSTEM CONFIGURATION</span><h2>ဆက်တင်</h2></div><span class="pill">AI + PHONE ACTIONS</span></div>
    <div class="card settings-card">
      <label for="provider">AI Provider</label><select id="provider"><option value="openrouter" ${provider==='openrouter'?'selected':''}>OpenRouter (GPT နှင့် အခြား Models)</option><option value="gemini" ${provider==='gemini'?'selected':''}>Google Gemini API</option></select>
      <p class="muted">Provider တစ်ခုရွေးပြီး သက်ဆိုင်ရာ API Key ထည့်ပါ။ API Key ကို ဒီဖုန်းရဲ့ localStorage ထဲမှာ သိမ်းပါတယ်။</p>
      <label for="apiKey">OpenRouter API Key</label><input id="apiKey" type="password" autocomplete="off" placeholder="sk-or-v1-…" value="${esc(key)}">
      <label for="modelId">OpenRouter Model ID</label><input id="modelId" value="${esc(model)}" placeholder="openai/gpt-4o-mini"><small>ဥပမာ openai/gpt-4o-mini — OpenRouter မှာ ရရှိနိုင်မှုနဲ့ ကုန်ကျစရိတ်ကို စစ်ပါ။</small>
      <hr>
      <label for="geminiKey">Gemini API Key</label><input id="geminiKey" type="password" autocomplete="off" placeholder="Gemini API Key" value="${esc(geminiKey)}">
      <label for="geminiModel">Gemini Model ID</label><input id="geminiModel" value="${esc(geminiModel)}" placeholder="gemini-2.5-flash">
      <button class="primary wide" id="saveSettings">Settings သိမ်းမယ်</button>
      <button class="secondary wide" id="showKey">OpenRouter Key ပြ/ဖျောက်</button>
      <button class="secondary wide" id="showGeminiKey">Gemini Key ပြ/ဖျောက်</button>
      <button class="danger wide" id="deleteKeys">API Key နှစ်ခုလုံး ဖျက်မယ်</button>
    </div>
    <div class="card"><div class="card-title">ဖုန်း Action များ</div><p class="muted">AI tool calling ဖြင့် App ဖွင့်ခြင်း၊ Back/Home၊ သီချင်း Next/Previous/Play-Pause၊ Volume တိုး/လျှော့၊ Settings ဖွင့်ခြင်းတို့ကို ခွင့်ပြုထားပါတယ်။ Android permission နဲ့ လက်ရှိ Media App ပံ့ပိုးမှုအပေါ် မူတည်ပါတယ်။</p></div>
    <div class="card"><div class="card-title">About AMARA AI</div><p class="muted">Capacitor · TypeScript · Gemini API / OpenRouter · Android native actions</p></div>`;
  view.querySelector<HTMLButtonElement>('#saveSettings')!.addEventListener('click', () => {
    const k = view.querySelector<HTMLInputElement>('#apiKey')!.value.trim();
    const m = view.querySelector<HTMLInputElement>('#modelId')!.value.trim();
    const gk = view.querySelector<HTMLInputElement>('#geminiKey')!.value.trim();
    const gm = view.querySelector<HTMLInputElement>('#geminiModel')!.value.trim();
    const p = view.querySelector<HTMLSelectElement>('#provider')!.value;
    if (k && !k.startsWith('sk-or-') && !confirm('OpenRouter Key ပုံစံက sk-or- နဲ့ မစပါ။ ဒီအတိုင်း သိမ်းမလား?')) return;
    if (k) localStorage.setItem(KEY_NAME, k); else localStorage.removeItem(KEY_NAME);
    if (m) localStorage.setItem(MODEL_NAME, m); else localStorage.setItem(MODEL_NAME, DEFAULT_MODEL);
    if (gk) localStorage.setItem(GEMINI_KEY_NAME, gk); else localStorage.removeItem(GEMINI_KEY_NAME);
    if (gm) localStorage.setItem(GEMINI_MODEL_NAME, gm); else localStorage.setItem(GEMINI_MODEL_NAME, 'gemini-2.5-flash');
    localStorage.setItem(PROVIDER_NAME, p);
    alert('Settings သိမ်းပြီးပါပြီ။ လက်ရှိ Provider: ' + (p === 'gemini' ? 'Gemini' : 'OpenRouter')); render();
  });
  view.querySelector<HTMLButtonElement>('#showKey')!.addEventListener('click', () => { const i = view.querySelector<HTMLInputElement>('#apiKey')!; i.type = i.type === 'password' ? 'text' : 'password'; });
  view.querySelector<HTMLButtonElement>('#showGeminiKey')!.addEventListener('click', () => { const i = view.querySelector<HTMLInputElement>('#geminiKey')!; i.type = i.type === 'password' ? 'text' : 'password'; });
  view.querySelector<HTMLButtonElement>('#deleteKeys')!.addEventListener('click', () => {
    if (!confirm('ဒီဖုန်းထဲက API Key နှစ်ခုလုံးကို ဖျက်မှာ သေချာပါသလား?')) return;
    localStorage.removeItem(KEY_NAME); localStorage.removeItem(GEMINI_KEY_NAME);
    view.querySelector<HTMLInputElement>('#apiKey')!.value = ''; view.querySelector<HTMLInputElement>('#geminiKey')!.value = '';
    alert('API Key နှစ်ခုလုံး ဖျက်ပြီးပါပြီ။');
  });
}

render();
