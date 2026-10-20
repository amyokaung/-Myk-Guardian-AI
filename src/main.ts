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
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.addEventListener('click',()=>{setDrawer(false);activeTab=b.dataset.tab!;render();}));
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
 const isText=/\\.(txt|md|json|csv|html?|xml|log|ya?ml|ini|js|ts|py|kt|java|css)$/i.test(file.name)||file.type.startsWith('text/')||file.type==='application/json';
 const rec:BrainRecord={id,name:file.name,size:file.size,type:file.type||'application/octet-stream',addedAt:Date.now(),extracted:isText};
 await new Promise<void>((ok,no)=>{const t=d.transaction('files','readwrite');t.objectStore('files').put({...rec,blob:file});t.oncomplete=()=>ok();t.onerror=()=>no(t.error);});
 if(isText&&file.size){const reader=file.stream().getReader(),decoder=new TextDecoder();let buf='',idx=0,read=0;try{while(true){const x=await reader.read();if(x.done)break;buf+=decoder.decode(x.value,{stream:true});read+=x.value.byteLength;while(buf.length>=65536){const chunk=buf.slice(0,65536);buf=buf.slice(65536);await new Promise<void>((ok,no)=>{const t=d.transaction('chunks','readwrite');t.objectStore('chunks').put({id:id+':'+idx++,fileId:id,fileName:file.name,text:chunk});t.oncomplete=()=>ok();t.onerror=()=>no(t.error);});}progress(Math.min(.98,read/Math.max(file.size,1)));}buf+=decoder.decode();if(buf)await new Promise<void>((ok,no)=>{const t=d.transaction('chunks','readwrite');t.objectStore('chunks').put({id:id+':'+idx,fileId:id,fileName:file.name,text:buf});t.oncomplete=()=>ok();t.onerror=()=>no(t.error);});}finally{reader.releaseLock();}}
 d.close();progress(1);
}
function renderBrain(view: HTMLElement) {
 view.innerHTML=`<div class="section-head"><div><span class="eyebrow">AMARA BRAIN · MEMORY CORE</span><h2>ကိုယ်ပိုင်မှတ်ဉာဏ်</h2></div><span class="pill" id="brainCount">READY</span></div>
 <section class="brain-stage"><button class="holo-brain" id="brainImport" type="button" aria-label="မှတ်ဉာဏ်ဖိုင်ထည့်ရန်"><span class="brain-orbit"></span><span class="brain-orbit orbit-b"></span><span class="holo-brain-art">🧠</span><span class="brain-tap">＋ Brain ကိုနှိပ်ပြီး ဖိုင်ထည့်ပါ</span></button>
 <div class="brain-status" id="brainStatus">✦ Brain အဆင်သင့်ဖြစ်နေပါပြီ</div><div class="brain-progress-wrap" id="brainProgressWrap" hidden><div class="brain-progress-label"><span id="brainProgressText">အချက်အလက်ထည့်သွင်းနေသည်…</span><b id="brainPercent">0%</b></div><div class="brain-progress"><span id="brainProgress"></span></div></div></section>
 <input id="brainPicker" type="file" multiple hidden />
 <section class="card brain-library"><h3>သိမ်းဆည်းထားသော ဖိုင်များ</h3><p class="muted">App က ဖိုင်အရွယ်အစားကို သီးခြားကန့်သတ်မထားပါ။ ဖုန်း၏ လွတ်နေသော storage နှင့် Android ကန့်သတ်ချက်များတော့ သက်ရောက်နိုင်သည်။</p><div id="brainFiles"><p class="muted">ဖိုင်စာရင်း ဖတ်နေသည်…</p></div></section>
 <div class="card"><b>မှတ်ချက်</b><p class="muted">Text ဖိုင်များကို အပိုင်းလိုက်ဖတ်ပြီး local index သိမ်းမည်။ PDF၊ ပုံ၊ အသံ၊ ဗီဒီယိုနှင့် အခြားဖိုင်များကို မူရင်းဖိုင်အဖြစ် သိမ်းမည်။ ၎င်းတို့၏ အတွင်းစာသားကို AI က ဖတ်ရှုနိုင်ရန် နောက်ထပ် extraction စနစ်လိုအပ်သည်။</p></div>
 <button class="secondary wide" id="brainBackToChat">Chat ကို ပြန်သွားမယ်</button>`;
 const picker=view.querySelector<HTMLInputElement>('#brainPicker')!,brain=view.querySelector<HTMLButtonElement>('#brainImport')!,status=view.querySelector<HTMLElement>('#brainStatus')!,wrap=view.querySelector<HTMLElement>('#brainProgressWrap')!,bar=view.querySelector<HTMLElement>('#brainProgress')!,percent=view.querySelector<HTMLElement>('#brainPercent')!,progressText=view.querySelector<HTMLElement>('#brainProgressText')!;
 const refresh=async()=>{const files=await brainFiles();view.querySelector<HTMLElement>('#brainCount')!.textContent=files.length+' FILES';view.querySelector<HTMLElement>('#brainFiles')!.innerHTML=files.length?files.map(f=>'<div class="brain-file-row"><span class="brain-file-icon">'+(f.extracted?'▤':'◈')+'</span><span class="brain-file-copy"><b>'+esc(f.name)+'</b><small>'+brainSize(f.size)+' · '+(f.extracted?'စာသား index သိမ်းပြီး':'မူရင်းဖိုင် သိမ်းပြီး')+'</small></span><span class="brain-check">✓</span></div>').join(''):'<p class="muted">ဖိုင်မရှိသေးပါ။ Brain ကိုနှိပ်ပြီး ဖိုင်ရွေးပါ။</p>';};
 brain.addEventListener('click',()=>picker.click());
 picker.addEventListener('change',async()=>{const files=Array.from(picker.files||[]);if(!files.length)return;brain.disabled=true;brain.classList.add('processing');wrap.hidden=false;let done=0,failed=0;
 for(const f of files){status.textContent='⚡ '+f.name+' ကို Brain ထဲ ထည့်သွင်းနေသည်…';progressText.textContent=f.name;bar.style.width='0%';percent.textContent='0%';try{await saveBrainFile(f,p=>{bar.style.width=Math.round(p*100)+'%';percent.textContent=Math.round(p*100)+'%';});done++;}catch(e){failed++;status.textContent='ဖိုင်သိမ်းမရပါ။ Storage ပြည့်နေခြင်း သို့မဟုတ် စနစ်ကန့်သတ်ချက် ဖြစ်နိုင်သည်။';}await refresh();}
 brain.disabled=false;brain.classList.remove('processing');wrap.hidden=true;picker.value='';status.textContent=failed?'ပြီးစီး '+done+' ဖိုင် · မအောင်မြင် '+failed+' ဖိုင်':'✓ '+done+' ဖိုင်၏ အချက်အလက်များ Brain ထဲ ဝင်သွားပါပြီ';view.querySelector('.brain-stage')?.classList.add('brain-complete');});
 view.querySelector('#brainBackToChat')?.addEventListener('click',()=>{activeTab='chat';render();});
 void refresh().catch(()=>{status.textContent='Local storage ကို ဖွင့်မရပါ။ ဖုန်း storage ကို စစ်ပါ။';});
}
function renderChat(view: HTMLElement) {
  view.innerHTML = '<section class="chat-screen"><div class="chat-title-row"><div><span class="eyebrow">AMARA · PERSONAL CHAT</span><h2>အမရာနဲ့ စကားပြောမယ်</h2></div><span class="pill"><i></i> '+(busy?'THINKING':'READY')+'</span></div><div class="chat-transcript" id="chatTranscript"><div class="messages" id="messageList"></div></div><div class="composer-wrap"><div id="pendingFiles" class="pending-files"></div><form id="chatForm" class="composer chatgpt-composer"><button class="composer-icon plus-button" id="attachToggle" type="button" aria-label="Attach image or file">＋</button><textarea id="prompt" rows="1" placeholder="အမရာကို မေးပါ…" aria-label="Message AMARA" '+(busy?'disabled':'')+'></textarea><input id="imagePicker" type="file" accept="image/*" multiple hidden><input id="filePicker" type="file" accept=".txt,.md,.json,.csv,.html,.xml,.pdf,.log,text/*,application/json,application/pdf" multiple hidden><button class="composer-icon mic-button" id="voiceInput" type="button" aria-label="Voice input"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"></path></svg></button><button class="composer-icon send" type="submit" aria-label="Send message" '+(busy?'disabled':'')+'>↑</button></form><div class="composer-hint">အမရာ၏ အဖြေတွင် အမှားပါနိုင်သည်။ အရေးကြီးသောအချက်အလက်များကို စစ်ဆေးပါ။</div></div></section><div class="attach-popover" id="attachPopover" hidden><button type="button" id="chooseImages"><span>▧</span> ပုံရွေးရန်</button><button type="button" id="chooseFiles"><span>↥</span> ဖိုင်ရွေးရန်</button></div>';
  const list=view.querySelector<HTMLElement>('#messageList')!;
  const renderMessages=()=>{list.innerHTML=messages.map(m=>'<article class="message '+m.role+'"><div class="msg-label">'+(m.role==='user'?'YOU':'AMARA')+'</div><div class="message-text">'+esc(m.content).replace(/\n/g,'<br>')+'</div></article>').join('')+(busy?'<article class="message assistant"><div class="msg-label">AMARA</div><div class="typing">စဉ်းစားနေသည် <i></i><i></i><i></i></div></article>':'');};
  renderMessages();
  const input=view.querySelector<HTMLTextAreaElement>('#prompt')!;
  const resize=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,180)+'px';};
  input.addEventListener('input',resize);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();view.querySelector<HTMLFormElement>('#chatForm')!.requestSubmit();}});
  const pop=view.querySelector<HTMLElement>('#attachPopover')!;
  view.querySelector('#attachToggle')!.addEventListener('click',()=>{pop.hidden=!pop.hidden;});
  view.querySelector('#chooseImages')!.addEventListener('click',()=>{pop.hidden=true;view.querySelector<HTMLInputElement>('#imagePicker')!.click();});
  view.querySelector('#chooseFiles')!.addEventListener('click',()=>{pop.hidden=true;view.querySelector<HTMLInputElement>('#filePicker')!.click();});
  let attachedText='';
  const addFiles=async(files:FileList|null)=>{if(!files)return;const pending=view.querySelector<HTMLElement>('#pendingFiles')!;const names:string[]=[];for(const file of Array.from(files)){if(file.size>15*1024*1024){alert('ဖိုင်တစ်ဖိုင်လျှင် 15MB အောက်သာ ရွေးနိုင်ပါတယ်။');continue;}names.push(file.name);if(/\.(txt|md|json|csv|html|xml|log)$/i.test(file.name)||file.type.startsWith('text/')||file.type==='application/json'){try{attachedText+='\n\n[ပူးတွဲဖိုင် '+file.name+']\n'+(await file.text()).slice(0,20000);}catch{}}}pending.innerHTML=names.map(n=>'<span class="attachment-chip">📎 '+esc(n)+'</span>').join('');};
  view.querySelector<HTMLInputElement>('#imagePicker')!.addEventListener('change',e=>{void addFiles((e.currentTarget as HTMLInputElement).files);});
  view.querySelector<HTMLInputElement>('#filePicker')!.addEventListener('change',e=>{void addFiles((e.currentTarget as HTMLInputElement).files);});
  view.querySelector<HTMLButtonElement>('#voiceInput')!.addEventListener('click', async () => {
    const button=view.querySelector<HTMLButtonElement>('#voiceInput')!;
    const prompt=view.querySelector<HTMLTextAreaElement>('#prompt')!;
    button.disabled=true;button.classList.add('listening');
    try {
      const available=await SpeechRecognition.available();
      if(!available.available)throw new Error('ဒီဖုန်းမှာ Speech Recognition မရပါ။ Google Speech Services ကို စစ်ပါ။');
      const permission=await SpeechRecognition.requestPermissions();
      if(permission.speechRecognition!=='granted')throw new Error('Microphone permission ကို Allow လုပ်ပါ။');
      const result=await SpeechRecognition.start({language:'my-MM',maxResults:1,prompt:'မြန်မာလို ပြောပါ',partialResults:false,popup:true});
      const transcript=result.matches?.[0]?.trim();
      if(transcript){prompt.value=transcript;resize();view.querySelector<HTMLFormElement>('#chatForm')!.requestSubmit();}
      else alert('အသံကို စာသားအဖြစ် မရရှိပါ။ ဖုန်းတွင် မြန်မာ Speech Recognition ပံ့ပိုးမှုကို စစ်ပါ။');
    } catch(err){alert('အသံဖြင့် ခိုင်းမရပါ။ '+(err instanceof Error?err.message:'Speech recognition error'));}
    finally {button.disabled=false;button.classList.remove('listening');}
  });
  view.querySelector<HTMLFormElement>('#chatForm')!.addEventListener('submit',async e=>{
    e.preventDefault();
    const text=input.value.trim();
    if((!text&&!attachedText)||busy)return;
    const userText=(text||'ဒီဖိုင်ကို စစ်ဆေးပေးပါ။')+(attachedText?'\n\n'+attachedText:'');
    attachedText='';
    messages.push({role:'user',content:userText});persistCurrentChat();busy=true;render();
    try {
      const actionResult=await tryNativeCommand(text);
      if(actionResult){messages.push({role:'assistant',content:actionResult});busy=false;persistCurrentChat();render();return;}
    } catch(err) {
      messages.push({role:'assistant',content:'လုပ်ဆောင်ချက် မအောင်မြင်ပါ။ '+(err instanceof Error?err.message:'အမှားတစ်ခု ဖြစ်နေပါတယ်။')});
      busy=false;persistCurrentChat();render();return;
    }
    await askAI();
  });
}
const PROVIDER_NAME = 'myk.ai.provider';
const GEMINI_KEY_NAME = 'myk.gemini.key';
const GEMINI_MODEL_NAME = 'myk.gemini.model';
const OPENROUTER_TOOLS = [{ type: 'function', function: { name: 'phone_action', description: 'Run Android actions. Use get_location for the device current GPS location; search_places to open a named place in Maps; set_alarm to request a real Android Clock alarm; open_app with app=Notes to open Notes; write_note only when the user asks to create/write note content; open_phone opens the dialer; call_phone only prefills a number and never calls automatically; search_youtube opens song results.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['get_weather','get_location','open_app','back','home','media_next','media_previous','media_play_pause','volume_up','volume_down','open_settings','click_text','search_youtube','open_phone','call_phone','write_note','set_text','search_places','set_alarm'] }, app: { type: 'string', description: 'App name, required only for open_app.' }, text: { type: 'string', description: 'Visible text to click; note content for write_note; text to insert for set_text.' }, query: { type: 'string', description: 'Song title/artist for search_youtube, destination/place query for search_places, or optional city name for get_weather (omit query for current GPS location).' }, number: { type: 'string', description: 'Phone number for call_phone; opens dialer with the number filled in and waits for the user to tap Call.' }, hour: { type: 'integer', description: 'Alarm hour in 24-hour format 0-23 for set_alarm.' }, minute: { type: 'integer', description: 'Alarm minute 0-59 for set_alarm.' }, label: { type: 'string', description: 'Alarm label for set_alarm.' }, exact: { type: 'boolean', description: 'Match visible text exactly when true.' } }, required: ['action'], additionalProperties: false } } }];
const GEMINI_TOOLS = [{ functionDeclarations: [{ name: 'phone_action', description: 'Run one allowed Android phone action. Use get_location for GPS location, search_places for Maps destinations, and set_alarm for Android Clock.', parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', enum: ['get_weather','get_location','open_app','back','home','media_next','media_previous','media_play_pause','volume_up','volume_down','open_settings','click_text','search_youtube','open_phone','call_phone','write_note','set_text','search_places','set_alarm'] }, app: { type: 'STRING' }, text: { type: 'STRING' }, query: { type: 'STRING' }, number: { type: 'STRING' }, hour: { type: 'INTEGER' }, minute: { type: 'INTEGER' }, label: { type: 'STRING' }, exact: { type: 'BOOLEAN' } }, required: ['action'] } }] }];

async function askAI() {
  const provider = localStorage.getItem(PROVIDER_NAME) || 'openrouter';
  const history = messages.slice(-20);
  const systemPrompt = AMARA_SYSTEM_PROMPT;
  try {
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
      accessibilityStatus.textContent = status.accessibilityEnabled ? (status.serviceConnected ? 'ဖွင့်ထားပြီး Service ချိတ်ဆက်ထားသည်' : 'Settings မှ On ဖြစ်သော်လည်း Service မချိတ်ဆက်သေးပါ — Off/On ပြန်လုပ်ပါ') : 'မဖွင့်ရသေးပါ — Android Settings မှ ဖွင့်ပါ';
      notificationStatus.textContent = status.notificationEnabled ? 'ဖွင့်ထားသည် — Notification Access Enabled' : 'မဖွင့်ရသေးပါ — Android Settings မှ ဖွင့်ပါ';
    } catch (err) {
      accessibilityStatus.textContent = 'Native plugin မရပါ။ နောက်ဆုံး APK ကို install လုပ်ထားကြောင်း စစ်ပါ။';
      notificationStatus.textContent = 'Native plugin မရပါ။ နောက်ဆုံး APK ကို install လုပ်ထားကြောင်း စစ်ပါ။';
    }
  };
  void refreshNativeStatus();
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
      // Do not open a blocking alert immediately: it can block the native
      // delayed fallback on Android's main thread.
      window.setTimeout(() => {
        alert(
          'Back Action စစ်ဆေးချက်\\n\\n' +
          'Accessibility Enabled: ' + status.accessibilityEnabled + '\\n' +
          'Notification Access: ' + status.notificationEnabled + '\\n' +
          'Native Back Result: ' + result.success + '\\n' +
          'အသေးစိတ်: ' + (result.message || 'Android က အသေးစိတ်မပြန်ပေးပါ။') + '\\n\\n' +
          'ဖုန်းမျက်နှာပြင် မပြောင်းပါက ဒီစာကို screenshot ရိုက်ပို့ပါ။'
        );
      }, 800);
  
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
