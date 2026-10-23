import './style.css';
import { AMARA_SYSTEM_PROMPT } from './amara-persona';
import { registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { tryNativeCommand, executeAgentAction } from './native-actions';

type Message = { role: 'user' | 'assistant'; content: string };
type MykNativePlugin = { getStatus(): Promise<{ accessibilityEnabled: boolean; serviceConnected?: boolean; notificationEnabled: boolean; locationGranted?: boolean; microphoneGranted?: boolean }>; openAccessibilitySettings(): Promise<void>; openNotificationSettings(): Promise<void>; startVedariWakeListening(): Promise<{success:boolean;message?:string}>; stopVedariWakeListening(): Promise<{success:boolean;message?:string}>; getPendingWakeCommand(): Promise<{command:string;listening:boolean}>; getWakeListeningStatus(): Promise<{listening:boolean;lastStatus?:string;lastDetail?:string;lastHeard?:string;lastEventAt?:number}>; performAction(options: { action: string; text?: string; number?: string; exact?: boolean; hour?: number; minute?: number; label?: string }): Promise<{ success: boolean; message?: string }>; reverseGeocode(options: {latitude:number;longitude:number}): Promise<{address?:string}> };
const MykNative = registerPlugin<MykNativePlugin>('MykAccessibility');
const KEY_NAME = 'myk.openrouter.key';
const MODEL_NAME = 'myk.openrouter.model';
const PERM_NAME = 'myk.agent.permissions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const MODEL_CATALOG_NAME = 'amara.openrouter.modelCatalog';
const USAGE_NAME = 'amara.openrouter.usage';
type ModelPrice = { id:string; name?:string; pricing?:{prompt?:string;completion?:string;request?:string}; context_length?:number };
type ModelUsage = { promptTokens:number; completionTokens:number; requests:number; costUsd:number; costKnown:boolean };
const readUsage = (): Record<string, ModelUsage> => { try { return JSON.parse(localStorage.getItem(USAGE_NAME) || '{}'); } catch { return {}; } };
const readModelCatalog = (): ModelPrice[] => { try { const v=JSON.parse(localStorage.getItem(MODEL_CATALOG_NAME)||'[]'); return Array.isArray(v)?v:[]; } catch { return []; } };
const money = (v:number) => '$'+v.toFixed(v<0.01?6:4);
function recordOpenRouterUsage(model:string,data:any){const usage=data?.usage;if(!usage)return;const promptTokens=Number(usage.prompt_tokens||usage.input_tokens||0),completionTokens=Number(usage.completion_tokens||usage.output_tokens||0);const all=readUsage(),entry=all[model]||{promptTokens:0,completionTokens:0,requests:0,costUsd:0,costKnown:false};const price=readModelCatalog().find(m=>m.id===model)?.pricing;const pr=Number(price?.prompt),cr=Number(price?.completion),reported=Number(usage.cost);let cost=0,known=false;if(usage.cost!==undefined&&Number.isFinite(reported)){cost=reported;known=true;}else if(price?.prompt!==undefined&&price?.completion!==undefined&&Number.isFinite(pr)&&Number.isFinite(cr)){cost=promptTokens*pr+completionTokens*cr;known=true;}entry.promptTokens+=promptTokens;entry.completionTokens+=completionTokens;entry.requests+=1;if(known){entry.costUsd+=cost;entry.costKnown=true;}all[model]=entry;localStorage.setItem(USAGE_NAME,JSON.stringify(all));}
function modelPriceLabel(model:ModelPrice){const p=model.pricing;if(!p||p.prompt===undefined||p.completion===undefined)return 'ဈေးနှုန်း မရရှိ';const input=Number(p.prompt)*1000000,output=Number(p.completion)*1000000;return Number.isFinite(input)&&Number.isFinite(output)?'Input '+money(input)+'/1M · Output '+money(output)+'/1M tokens':'ဈေးနှုန်း မရရှိ';}
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

// Keep a durable, on-device episode for each conversation/task. Only relevant excerpts
// are later retrieved into the model prompt; the complete Brain file contents are not uploaded.
async function saveAutoMemory(userText:string,assistantText:string):Promise<void>{
 const user=String(userText||'').trim().slice(0,6000),assistant=String(assistantText||'').trim().slice(0,6000);
 if(!user&&!assistant)return;
 const stamp=Date.now(),date=new Date(stamp).toISOString();
 const id='auto-memory:'+stamp+':'+Math.random().toString(36).slice(2,8);
 const text='အချိန်: '+date+'\nအသုံးပြုသူ: '+user+'\nအမရာ/လုပ်ဆောင်ချက်ရလဒ်: '+assistant;
 const d=await brainDB();
 await new Promise<void>((resolve,reject)=>{const tx=d.transaction('chunks','readwrite');tx.objectStore('chunks').put({id,fileId:'auto-memory',fileName:'AMARA Auto Memory · '+date.slice(0,10),text,createdAt:stamp});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
 d.close();
}
async function clearAutoMemory():Promise<void>{
 const d=await brainDB();
 await new Promise<void>((resolve,reject)=>{const tx=d.transaction('chunks','readwrite'),store=tx.objectStore('chunks'),q=store.getAll();q.onsuccess=()=>{for(const item of q.result||[])if(String(item.fileId)==='auto-memory')store.delete(item.id);};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
 d.close();
}

async function updateProfileMemory(userText:string):Promise<void>{
 const raw=String(userText||'').trim();if(!raw)return;
 const rules:Array<{key:string;re:RegExp}>=[
  {key:'preferred_language',re:/(?:မြန်မာလို|မြန်မာဘာသာနဲ့)\s*(?:ပြော|ဖြေ|သုံး)(?:ချင်တယ်|စေချင်တယ်|ပေးပါ)/i},
  {key:'code_delivery_preference',re:/(?:ဖိုင်အပြည့်အစုံ|code အပြည့်အစုံ|codeအပြည့်အစုံ|whole file|complete file)/i},
  {key:'project_focus',re:/(?:AMARA AI|AMARA|Myk Guardian AI)/i}
 ];
 const facts=rules.filter(x=>x.re.test(raw)).map(x=>({key:x.key,value:x.key==='preferred_language'?'မြန်မာဘာသာဖြင့် ဆက်သွယ်ပြောဆိုခြင်းကို ဦးစားပေးသည်။':x.key==='code_delivery_preference'?'Code ပြင်ဆင်မှုတွင် ဖိုင်အပြည့်အစုံကို ဦးစားပေးသည်။':'AMARA AI ကိုယ်ပိုင် AI project ကို ဆက်လက်တည်ဆောက်နေသည်။'}));
 if(!facts.length)return;const d=await brainDB();
 await new Promise<void>((resolve,reject)=>{const tx=d.transaction('chunks','readwrite'),store=tx.objectStore('chunks');for(const fact of facts)store.put({id:'profile-memory:'+fact.key,fileId:'profile-memory',profileKey:fact.key,fileName:'AMARA Personal Profile',text:'အချက်အလက်အမျိုးအစား: '+fact.key+'\nမှတ်ဉာဏ်: '+fact.value+'\nနောက်ဆုံးအတည်ပြုသည့်အချိန်: '+new Date().toISOString()+'\nရင်းမြစ်: အသုံးပြုသူ၏ တိုက်ရိုက်စာသား\nမူရင်းစာသား: '+raw.slice(0,1200),createdAt:Date.now(),source:'explicit-user-text'});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});d.close();
}
async function exportMemoryBackup():Promise<void>{
 const d=await brainDB();const chunks=await new Promise<any[]>((resolve,reject)=>{const tx=d.transaction('chunks','readonly'),q=tx.objectStore('chunks').getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>reject(q.error);});d.close();
 const backup={format:'amara-memory-backup',version:1,exportedAt:new Date().toISOString(),includes:'memory text/chunks and profile records; original imported file binaries are not included',chunks};
 const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='amara-memory-backup-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
async function importMemoryBackup(file:File):Promise<number>{
 const parsed=JSON.parse(await file.text());if(!parsed||parsed.format!=='amara-memory-backup'||!Array.isArray(parsed.chunks))throw new Error('AMARA Memory Backup JSON မမှန်ပါ။');
 const d=await brainDB(),prefix='backup-import:'+Date.now()+':',items=parsed.chunks.filter((x:any)=>x&&typeof x.text==='string').map((x:any,i:number)=>({...x,id:prefix+i,fileId:prefix+(String(x.fileId||'memory')),fileName:'Backup · '+String(x.fileName||'Memory'),createdAt:Number(x.createdAt)||Date.now(),importedFromBackup:true}));
 await new Promise<void>((resolve,reject)=>{const tx=d.transaction('chunks','readwrite'),store=tx.objectStore('chunks');for(const item of items)store.put(item);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});d.close();return items.length;
}

async function exportMasterMemory():Promise<void>{
 const d=await brainDB();
 const data=await new Promise<{chunks:any[];files:any[]}>((resolve,reject)=>{const tx=d.transaction(['chunks','files'],'readonly'),cq=tx.objectStore('chunks').getAll(),fq=tx.objectStore('files').getAll();let chunks:any[]=[],files:any[]=[];cq.onsuccess=()=>{chunks=cq.result||[];};fq.onsuccess=()=>{files=fq.result||[];};tx.oncomplete=()=>resolve({chunks,files});tx.onerror=()=>reject(tx.error);});
 d.close();
 const fileNames=new Map(data.files.map((f:any)=>[String(f.id),String(f.name||'Brain file')]));
 const normalized=(v:string)=>v.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase();
 const unique=new Map<string,{text:string;sources:Set<string>;date:number;kind:string}>();
 for(const c of data.chunks){
  const body=String(c.text||'').trim();if(!body)continue;
  const key=normalized(body);if(!key)continue;
  const source=String(c.fileName||fileNames.get(String(c.fileId||''))||'AMARA Memory');
  const old=unique.get(key);
  if(old){old.sources.add(source);old.date=Math.max(old.date,Number(c.createdAt)||0);}
  else unique.set(key,{text:body,sources:new Set([source]),date:Number(c.createdAt)||0,kind:String(c.fileId||'').startsWith('profile-memory')?'Personal Profile':String(c.fileId||'')==='auto-memory'?'Conversation & Action Log':/analysis/i.test(source)?'AI File Analysis':'Imported / Other Memory'});
 }
 const groups=new Map<string,Array<{text:string;sources:Set<string>;date:number;kind:string}>>();
 for(const item of unique.values()){if(!groups.has(item.kind))groups.set(item.kind,[]);groups.get(item.kind)!.push(item);}
 const order=['Personal Profile','Conversation & Action Log','AI File Analysis','Imported / Other Memory'];
 let out='# AMARA MASTER MEMORY\n\n'+
 'Generated: '+new Date().toISOString()+'\n'+
 'Unique records: '+unique.size+'\n\n'+
 '> This file combines readable AMARA memory chunks and removes exact duplicate text after Unicode/whitespace normalization. Similar-but-not-identical facts are preserved to avoid deleting meaning. Review conflicting or outdated facts before relying on them. Original binary attachments are not embedded.\n\n'+
 '## How AMARA should use this file\n\n'+
 '- Use the most relevant records for the current question or task.\n'+
 '- Treat explicit user statements as stronger evidence than AI-generated summaries.\n'+
 '- Check dates and sources; newer facts may supersede older facts.\n'+
 '- Do not invent facts that are absent from this file. If records conflict, acknowledge uncertainty or ask the user.\n\n';
 for(const kind of order){const items=groups.get(kind);if(!items?.length)continue;out+='## '+kind+'\n\n';
  items.sort((a,b)=>a.date-b.date);
  for(const item of items){out+='### Record'+(item.date?' · '+new Date(item.date).toISOString():'')+'\n\n';out+=item.text+'\n\n';out+='Source: '+Array.from(item.sources).join(' | ')+'\n\n---\n\n';}
 }
 const blob=new Blob([out],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='AMARA_MASTER_MEMORY_'+new Date().toISOString().slice(0,10)+'.md';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
async function saveBrainFile(file:File,progress:(p:number)=>void):Promise<string>{
 const d=await brainDB(),id=crypto.randomUUID?crypto.randomUUID():'f-'+Date.now()+'-'+Math.random().toString(36).slice(2);
 const isText=/\.(txt|md|json|csv|html?|xml|log|ya?ml|ini|js|ts|py|kt|java|css)$/i.test(file.name)||file.type.startsWith('text/')||file.type==='application/json';
 const rec:BrainRecord={id,name:file.name,size:file.size,type:file.type||'application/octet-stream',addedAt:Date.now(),extracted:isText};
 await new Promise<void>((ok,no)=>{const t=d.transaction('files','readwrite');t.objectStore('files').put({...rec,blob:file});t.oncomplete=()=>ok();t.onerror=()=>no(t.error);});
 if(isText&&file.size){const reader=file.stream().getReader(),decoder=new TextDecoder();let buf='',idx=0,read=0;try{while(true){const x=await reader.read();if(x.done)break;buf+=decoder.decode(x.value,{stream:true});read+=x.value.byteLength;while(buf.length>=65536){const chunk=buf.slice(0,65536);buf=buf.slice(65536);await new Promise<void>((ok,no)=>{const t=d.transaction('chunks','readwrite');t.objectStore('chunks').put({id:id+':'+idx++,fileId:id,fileName:file.name,text:chunk});t.oncomplete=()=>ok();t.onerror=()=>no(t.error);});}progress(Math.min(.98,read/Math.max(file.size,1)));}buf+=decoder.decode();if(buf)await new Promise<void>((ok,no)=>{const t=d.transaction('chunks','readwrite');t.objectStore('chunks').put({id:id+':'+idx,fileId:id,fileName:file.name,text:buf});t.oncomplete=()=>ok();t.onerror=()=>no(t.error);});}finally{reader.releaseLock();}}
 d.close();progress(1);return id;
}
async function analyzeBrainFile(fileId:string):Promise<{chunks:number;summary:string}>{
 const key=localStorage.getItem(KEY_NAME)?.trim();
 if(!key)throw new Error('Brain ဖိုင်ကို သိမ်းထားပြီးပါပြီ။ AI ခွဲခြမ်းစိတ်ဖြာရန် Settings ထဲမှာ OpenRouter API Key ထည့်ပါ။');
 const d=await brainDB();
 const data=await new Promise<{file:any;chunks:any[]}>( (resolve,reject)=>{
  const tx=d.transaction(['files','chunks'],'readonly');
  const fq=tx.objectStore('files').get(fileId),cq=tx.objectStore('chunks').getAll();
  let file:any,all:any[]=[];
  fq.onsuccess=()=>{file=fq.result;};
  cq.onsuccess=()=>{all=(cq.result||[]).filter((x:any)=>String(x.fileId)===fileId).sort((a:any,b:any)=>String(a.id).localeCompare(String(b.id)));};
  tx.oncomplete=()=>{d.close();resolve({file,chunks:all});};
  tx.onerror=()=>{d.close();reject(tx.error);};
 });
 if(!data.file)throw new Error('Brain ဖိုင်ကို မတွေ့ပါ။');
 if(!data.chunks.length)throw new Error('ဒီဖိုင်မှ စာသားမထုတ်ယူနိုင်သေးပါ။ TXT, JSON, MD ကဲ့သို့ စာသားဖိုင်ကို အသုံးပြုပါ။');
 const model=localStorage.getItem(MODEL_NAME)||DEFAULT_MODEL;
 const combined=data.chunks.map((x:any)=>String(x.text||'')).join('');
 // Create bounded overlapping analysis batches. Original chunks remain available for later retrieval.
 const batchChars=12000, summaries:string[]=[];
 // A large file is first split into deterministic batches. Analyse in bounded groups;
 // persist progress and stop on API failure rather than claiming the whole file was read.
 const batches=Math.ceil(combined.length/batchChars);
 for(let pos=0;pos<combined.length;pos+=batchChars){
  const part=combined.slice(pos,pos+batchChars), batchNo=Math.floor(pos/batchChars)+1;
  const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json','X-Title':'AMARA AI'},body:JSON.stringify({model,messages:[
   {role:'system',content:'မင်းက အမရာ (AMARA) ဖြစ်တယ်။ နွေးထွေးပြီး သဘာဝကျတဲ့ မြန်မာစကားပြောပုံစံနဲ့ အချက်အလက်ကို တိတိကျကျ ကောက်နုတ်ပါ။ ဤစာသားအပိုင်းထဲက လူအမည်၊ အသုံးပြုသူအကြောင်း၊ လုပ်ခဲ့သောအလုပ်၊ project၊ ဆုံးဖြတ်ချက်၊ စိတ်ကြိုက်နှင့် ရက်စွဲတွေကို အချက်အလက်အဖြစ်သာ ထုတ်ယူပါ။ မပါသောအချက် မတီထွင်ပါနှင့်။ JSON ရဲ့ key/value နှစ်ခုလုံးကို အဓိပ္ပာယ်ဖော်ပါ။ နောက်ပိုင်း Chat က တိုက်ရိုက်ပြန်ဖြေနိုင်အောင် အရေးကြီးသော အချက်တစ်ချက်စီကို သီးခြား bullet အဖြစ် ထုတ်ပါ။'},
   {role:'user',content:'ဖိုင်: '+data.file.name+'\nအပိုင်း '+batchNo+'/'+batches+'\n'+part}
  ],temperature:0.1,max_tokens:1200})});
  const json=await response.json();
  if(!response.ok)throw new Error('အပိုင်း '+batchNo+'/'+batches+' တွင် API အမှား: '+String(json?.error?.message||'HTTP '+response.status));
  const summary=String(json?.choices?.[0]?.message?.content||'').trim();
  if(summary){
   summaries.push(summary);
   const db=await brainDB();
   await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('chunks','readwrite');
    tx.objectStore('chunks').put({id:fileId+':analysis:'+String(batchNo).padStart(8,'0'),fileId,fileName:String(data.file.name)+' · AI ခွဲခြမ်းစိတ်ဖြာချက်',text:'ဖိုင်အမည်: '+data.file.name+'\nအပိုင်း: '+batchNo+'/'+batches+'\n'+summary});
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
   });
   db.close();
  }
 }
 return {chunks:data.chunks.length,summary:summaries.join('\n\n')};
}
async function brainContext(query:string):Promise<string>{
 const q=query.toLocaleLowerCase().normalize('NFC');
 const asksAboutSelf=/(ငါ့ကို|ငါ့အကြောင်း|ငါဘယ်သူ|ငါ့နာမည်|ငါ့အမည်|ငါ့ရဲ့|ငါ့အချက်အလက်|မသိသေးဘူး|မသိဘူး|မင်းငါ့ကို|ငါ့ကိုသိ|မှတ်မိ|သိလား|ဘယ်သူလဲ|ကိုယ့်အကြောင်း|ကိုယ့်အကြောင်း|မှတ်ဉာဏ်|မှတ်ညဏ်|မှတ်ဉာဏ်ကို|မှတ်ညဏ်ကို|မှတ်ဉာဏ်ထဲ|မှတ်ညဏ်ထဲ|brain|memory|about me|who am i|my name|remember me|do you know me)/i.test(q);
 const raw=(q.match(/[a-z0-9_]{3,}|[\u1000-\u109F]+/g)||[]);
 const terms:string[]=[];
 for(const part of raw){if(/[\u1000-\u109F]/.test(part)){for(let n=2;n<=Math.min(5,part.length);n++)for(let i=0;i+n<=part.length;i++)terms.push(part.slice(i,i+n));}else terms.push(part);}
 const unique=terms.filter((x,i,a)=>a.indexOf(x)===i).slice(0,140);
 if(!unique.length&&!asksAboutSelf)return'';
 const d=await brainDB();
 return new Promise((resolve,reject)=>{
  const tx=d.transaction(['chunks','files'],'readonly'),cr=tx.objectStore('chunks').getAll(),fr=tx.objectStore('files').getAll();
  let chunks:any[]=[],files:any[]=[],failed=false;
  const fail=(e:any)=>{if(failed)return;failed=true;d.close();reject(e);};
  cr.onsuccess=()=>{chunks=Array.isArray(cr.result)?cr.result:[];};
  fr.onsuccess=()=>{files=Array.isArray(fr.result)?fr.result:[];};
  cr.onerror=()=>fail(cr.error);fr.onerror=()=>fail(fr.error);
  tx.oncomplete=async()=>{
   if(failed)return;
   try{
    const fileById=new Map<string,any>(files.map(f=>[String(f.id),f]));
    const profileName=/(auto.?memory|conversation.?memory|myk.?personal.?memory|myk.?ai.?memory|memory.?merged|merged.?memory|personal.?memory|profile|ကိုယ်ရေး|personal.?data|user.?memory|gemini.?export|memory|မှတ်ဉာဏ်|မှတ်ညဏ်)/i;
    const windows:Array<{score:number;text:string;name:string;fileId:string;pos:number}>=[];
    const profileTerms=['နာမည်','အမည်','ကျွန်တော်','ကျွန်မ','ငါ့','အလုပ်','လုပ်ခဲ့','project','စီမံကိန်း','ကိုယ်ရေး','မွေး','နေထိုင်','စိတ်ဝင်စား','ပညာရေး','name','user','profile','work','built','created','developer','owner','project','personal','memories','conversation'];
    const addWindows=(body:string,name:string,fileId:string)=>{
     const width=3400,step=2800;
     for(let pos=0;pos<body.length;pos+=step){
      const part=body.slice(pos,pos+width);if(!part.trim())continue;
      const lower=part.toLocaleLowerCase().normalize('NFC');let score=0;
      for(const term of unique)if(term.length>=2&&lower.includes(term))score+=term.length>=4?3:1;
      if(asksAboutSelf)for(const term of profileTerms)if(lower.includes(term))score+=2;
      if(profileName.test(name))score+=asksAboutSelf?35:3;
      if(score>0)windows.push({score,text:part,name,fileId,pos});
     }
    };
    // Backward compatibility: earlier successful builds used the separate
    // "myk-guardian-brain" IndexedDB database with a "memories" store.
    // Read it too, otherwise old Brain imports silently look empty in AMARA's new DB.
    try {
     const legacyItems:any[]=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('myk-guardian-brain');
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
       const legacyDb=request.result;
       if(!legacyDb.objectStoreNames.contains('memories')){legacyDb.close();resolve([]);return;}
       const read=legacyDb.transaction('memories','readonly').objectStore('memories').getAll();
       read.onsuccess=()=>{legacyDb.close();resolve(Array.isArray(read.result)?read.result:[]);};
       read.onerror=()=>{legacyDb.close();reject(read.error);};
      };
     });
     for(const item of legacyItems){
      const title=String(item.title||item.name||'Brain memory');
      const body=String(item.content||item.text||item.summary||'');
      if(body.trim())addWindows(title+'\\n'+body,'Legacy Brain · '+title,String(item.id||title));
     }
    } catch(e){console.warn('Legacy Brain memory read skipped',e);}

    // Search indexed chunks from every readable text file, not only files with a particular name.
    for(const chunk of chunks){
     const fileId=String(chunk.fileId||''),file=fileById.get(fileId);
     const name=String(chunk.fileName||file?.name||chunk.name||'မှတ်ဉာဏ်ဖိုင်');
     addWindows(String(chunk.text||''),name,fileId);
    }
    // Old records might have a blob but no index. Only scan text-like files; binary files are not falsely claimed as read.
    const chunkedIds=new Set(chunks.map(c=>String(c.fileId||'')));
    for(const file of files){
     const name=String(file.name||'မှတ်ဉာဏ်ဖိုင်'),type=String(file.type||'');
     const textLike=/\.(txt|md|json|csv|html?|xml|log|ya?ml|ini|text)$/i.test(name)||type.startsWith('text/')||type==='application/json';
     if(!textLike||chunkedIds.has(String(file.id))||!file.blob||typeof file.blob.text!=='function')continue;
     const body=String(await file.blob.text());
     addWindows(body,name,String(file.id));
    }
    windows.sort((a,b)=>b.score-a.score);
    const picked:typeof windows=[];
    const seen=new Set<string>();
    for(const w of windows){const k=w.fileId+':'+w.pos;if(seen.has(k))continue;seen.add(k);picked.push(w);if(picked.length>=(asksAboutSelf?6:5))break;}
    const status='[AMARA BRAIN DIAGNOSTICS: files='+files.length+', indexed_chunks='+chunks.length+', candidate_passages='+windows.length+', selected_passages='+picked.length+']';
    if(!picked.length){
     const names=files.map(f=>String(f.name||'')).filter(Boolean).slice(0,25);
     d.close();resolve('\n\n'+status+'\n[Brain ထဲတွင် ဖတ်ရှုနိုင်သော TXT/JSON/MD စာသားအပိုင်း မတွေ့ပါ။ ဖိုင်အမည်များ: '+(names.join(', ')||'ဖိုင်မရှိသေးပါ')+'. မိမိအကြောင်းကို မသိသလိုသာ ရိုးသားစွာပြောပါ။]');return;
    }
    const body=picked.map(w=>'[ဖိုင်: '+w.name+' | အပိုင်းနေရာ: '+w.pos+']\n'+w.text).join('\n\n').slice(0,18000);
    d.close();
    resolve('\n\n'+status+'\n[AMARA BRAIN MEMORY: အောက်ပါအချက်အလက်များသည် Brain ဖိုင်များမှ ရှာဖွေထားသော စာသားဖြစ်သည်။ ကိုယ်ရေးအချက်အလက်မေးလျှင် ဒီစာသားထဲက အမည်၊ အလုပ်၊ project၊ ကိုယ်ရေးမှတ်တမ်းကို တိတိကျကျ အရင်ဖြေပါ။ မတွေ့သောအချက်ကို မခန့်မှန်းပါနှင့်။]\n'+body);
   }catch(e){d.close();reject(e);}
  };
 });
}
function renderBrain(view: HTMLElement) {
 view.innerHTML=`<div class="section-head"><div><span class="eyebrow">AMARA BRAIN · MEMORY CORE</span><h2>ကိုယ်ပိုင်မှတ်ဉာဏ်</h2></div><span class="pill" id="brainCount">READY</span></div>
 <section class="brain-stage"><button class="holo-brain" id="brainImport" type="button" aria-label="မှတ်ဉာဏ်ဖိုင်ထည့်ရန်"><span class="brain-orbit"></span><span class="brain-orbit orbit-b"></span><span class="holo-brain-art" aria-hidden="true"><svg class="brain-svg" viewBox="0 0 300 260" role="img" aria-label="Holographic brain"><defs><linearGradient id="brainFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9ffff"/><stop offset=".34" stop-color="#37bfff"/><stop offset=".68" stop-color="#4778ff"/><stop offset="1" stop-color="#ed7bff"/></linearGradient><filter id="brainGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#brainGlow)" stroke="url(#brainFill)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="#1b68e733"><path d="M148 47C132 22 103 27 94 48 68 39 48 59 54 82 30 98 42 124 56 135 43 159 62 179 82 179 88 202 112 209 132 191L148 174Z"/><path d="M152 47C168 22 197 27 206 48 232 39 252 59 246 82 270 98 258 124 244 135 257 159 238 179 218 179 212 202 188 209 168 191L152 174Z"/><path d="M148 48V176M152 48V176" fill="none" stroke="#d9ffff" stroke-width="2"/><path d="M95 49C82 63 103 73 88 87S67 108 82 124 93 149 82 166M119 42C110 58 128 70 113 83S101 106 119 119 119 147 134 158M205 49C218 63 197 73 212 87S233 108 218 124 207 149 218 166M181 42C190 58 172 70 187 83S199 106 181 119 181 147 166 158" fill="none" stroke="#93faff" stroke-width="2.4"/><path d="M128 190L137 208 150 218 163 208 172 190" fill="none" stroke="#7bdfff" stroke-width="3"/><path d="M60 100L76 103 83 93M89 145L110 139 119 150M124 66L136 76 130 91M240 100L224 103 217 93M211 145L190 139 181 150M176 66L164 76 170 91" fill="none" stroke="#e3ffff" stroke-width="2"/></g><g fill="#eaffff"><circle cx="95" cy="49" r="3"/><circle cx="119" cy="42" r="2.5"/><circle cx="205" cy="49" r="3"/><circle cx="181" cy="42" r="2.5"/><circle cx="82" cy="166" r="3"/><circle cx="218" cy="166" r="3"/></g></svg></span><span class="brain-file-orbs" id="brainFileOrbs" aria-hidden="true"></span><span class="brain-tap">＋ Brain ကိုနှိပ်ပြီး ဖိုင်ထည့်ပါ</span></button>
 <div class="brain-status" id="brainStatus">✦ Brain အဆင်သင့်ဖြစ်နေပါပြီ</div><div class="brain-progress-wrap" id="brainProgressWrap" hidden><div class="brain-progress-label"><span id="brainProgressText">အချက်အလက်ထည့်သွင်းနေသည်…</span><b id="brainPercent">0%</b></div><div class="brain-progress"><span id="brainProgress"></span></div></div></section>
 <input id="brainPicker" type="file" multiple hidden />
 <section class="card brain-library"><h3>အမရာ၏ ဆက်လက်လေ့လာမှတ်ဉာဏ်</h3><p class="muted">Chat စကားပြောမှုနှင့် ဖုန်းလုပ်ဆောင်ချက်ရလဒ်များကို ဒီဖုန်းထဲမှာ သိမ်းပြီး နောက်ပိုင်းမေးခွန်း/အလုပ်များတွင် သက်ဆိုင်ရာအပိုင်းကို ပြန်ရှာသုံးမည်။ မှတ်တမ်းများကို API သို့ အလိုအလျောက် အပြည့်အစုံ မပို့ပါ။</p><div class="button-row"><button class="secondary" id="exportMasterMemory" type="button">Master Memory တစ်ဖိုင်ထုတ်ရန်</button><button class="secondary" id="exportMemoryBackup" type="button">Raw Backup JSON ထုတ်ရန်</button><button class="secondary" id="importMemoryBackup" type="button">Backup ပြန်ထည့်ရန်</button><button class="secondary" id="clearAutoMemory" type="button">စကားပြောမှတ်ဉာဏ် ရှင်းလင်းရန်</button></div><input id="memoryBackupPicker" type="file" accept=".json,application/json" hidden /></section><section class="card brain-library"><h3>သိမ်းဆည်းထားသော ဖိုင်များ</h3><p class="muted">App က ဖိုင်အရွယ်အစားကို သီးခြားကန့်သတ်မထားပါ။ ဖုန်း၏ လွတ်နေသော storage နှင့် Android ကန့်သတ်ချက်များတော့ သက်ရောက်နိုင်သည်။</p><div id="brainFiles"><p class="muted">ဖိုင်စာရင်း ဖတ်နေသည်…</p></div></section>
 <div class="card"><b>ဖတ်ရှုမှုအခြေအနေ</b><p class="muted">TXT, MD, JSON, CSV နှင့် text အမျိုးအစားများကို ဖတ်ပြီး AI ရှာဖွေရန် index လုပ်ပေးသည်။ PDF၊ ZIP၊ ပုံ၊ အသံ၊ ဗီဒီယိုတို့ကို လက်ရှိ build တွင် သိမ်းထားနိုင်သော်လည်း အတွင်းစာသားကို အလိုအလျောက် မထုတ်ယူနိုင်သေးပါ။ အဲဒီဖိုင်များကို ဖတ်ပြီးပြီဟု မယူဆပါနှင့်။</p></div>
 <button class="secondary wide" id="brainBackToChat">Chat ကို ပြန်သွားမယ်</button>`;
 const picker=view.querySelector<HTMLInputElement>('#brainPicker')!,brain=view.querySelector<HTMLButtonElement>('#brainImport')!,status=view.querySelector<HTMLElement>('#brainStatus')!,wrap=view.querySelector<HTMLElement>('#brainProgressWrap')!,bar=view.querySelector<HTMLElement>('#brainProgress')!,percent=view.querySelector<HTMLElement>('#brainPercent')!,progressText=view.querySelector<HTMLElement>('#brainProgressText')!;
 const refresh=async()=>{const files=await brainFiles();view.querySelector<HTMLElement>('#brainCount')!.textContent=files.length+' FILES';view.querySelector<HTMLElement>('#brainFiles')!.innerHTML=files.length?files.map(f=>'<div class="brain-file-row"><span class="brain-file-icon">'+(f.extracted?'▤':'◈')+'</span><span class="brain-file-copy"><b>'+esc(f.name)+'</b><small>'+brainSize(f.size)+' · '+(f.extracted?'စာသားဖတ်ပြီး AI ရှာဖွေနိုင်':'ဖိုင်သိမ်းထားသည် · စာသားမဖတ်ရသေး')+'</small></span><span class="brain-check">'+(f.extracted?'✓':'!')+'</span></div>').join(''):'<p class="muted">ဖိုင်မရှိသေးပါ။ ဦးနှောက်ကိုနှိပ်ပြီး ဖိုင်ရွေးပါ။</p>';const orbs=view.querySelector<HTMLElement>('#brainFileOrbs');if(orbs)orbs.innerHTML=files.slice(0,8).map((f,i)=>'<span class="brain-file-orb orb-'+i+'">'+(f.name.toLowerCase().endsWith('.pdf')?'PDF':f.name.toLowerCase().endsWith('.json')?'{}':f.name.toLowerCase().endsWith('.zip')?'ZIP':f.name.toLowerCase().match(/\\.(png|jpe?g|webp)$/)?'IMG':'TXT')+'</span>').join('');};
  view.querySelector<HTMLButtonElement>('#exportMasterMemory')?.addEventListener('click',async()=>{try{await exportMasterMemory();status.textContent='✓ ထပ်နေသောစာသားများ ဖယ်ရှားထားသည့် Master Memory ဖိုင် ထုတ်ပြီးပါပြီ';}catch(e){status.textContent='Master Memory ထုတ်မရပါ: '+(e instanceof Error?e.message:'Storage error');}});
  view.querySelector<HTMLButtonElement>('#exportMemoryBackup')?.addEventListener('click',async()=>{try{await exportMemoryBackup();status.textContent='✓ Memory Backup JSON ထုတ်ပြီးပါပြီ';}catch(e){status.textContent='Backup ထုတ်မရပါ: '+(e instanceof Error?e.message:'Storage error');}});
  const backupPicker=view.querySelector<HTMLInputElement>('#memoryBackupPicker')!;
  view.querySelector<HTMLButtonElement>('#importMemoryBackup')?.addEventListener('click',()=>backupPicker.click());
  backupPicker.addEventListener('change',async()=>{const file=backupPicker.files?.[0];if(!file)return;try{const count=await importMemoryBackup(file);status.textContent='✓ Backup မှ '+count+' ခုသော memory records ပြန်ထည့်ပြီးပါပြီ';}catch(e){status.textContent='Backup ပြန်ထည့်မရပါ: '+(e instanceof Error?e.message:'Invalid backup');}finally{backupPicker.value='';}});
 view.querySelector<HTMLButtonElement>('#clearAutoMemory')?.addEventListener('click',async()=>{if(!confirm('AMARA ၏ အလိုအလျောက် စကားပြော/လုပ်ဆောင်ချက်မှတ်ဉာဏ်ကို ဒီဖုန်းမှ ရှင်းလင်းမလား? မူရင်း Chat history နှင့် တင်သွင်းထားသောဖိုင်များကို မဖျက်ပါ။'))return;try{await clearAutoMemory();status.textContent='✓ အလိုအလျောက်မှတ်ဉာဏ်ကို ရှင်းလင်းပြီးပါပြီ';}catch(e){status.textContent='မှတ်ဉာဏ်ရှင်းမရပါ: '+(e instanceof Error?e.message:'Storage error');}});
 brain.addEventListener('click',()=>picker.click());
 picker.addEventListener('change',async()=>{const files=Array.from(picker.files||[]);if(!files.length)return;brain.disabled=true;brain.classList.add('processing');wrap.hidden=false;let done=0,failed=0;
 for(const f of files){status.textContent='⚡ '+f.name+' ကို Brain ထဲ ထည့်သွင်းနေသည်…';progressText.textContent=f.name;bar.style.width='0%';percent.textContent='0%';try{const id=await saveBrainFile(f,p=>{bar.style.width=Math.round(p*100)+'%';percent.textContent=Math.round(p*100)+'%';});done++;await refresh();if(/\\.(txt|md|json|csv|html?|xml|log|ya?ml|ini)$/i.test(f.name)||f.type.startsWith('text/')||f.type==='application/json'){status.textContent='🧠 '+f.name+' ကို AI က ခွဲခြမ်းစိတ်ဖြာနေသည်…';progressText.textContent='AI ခွဲခြမ်းစိတ်ဖြာမှု';try{await analyzeBrainFile(id);status.textContent='✓ '+f.name+' သိမ်းပြီး AI ခွဲခြမ်းစိတ်ဖြာပြီးပါပြီ';}catch(e){status.textContent='ဖိုင်သိမ်းပြီးပါပြီ၊ AI ခွဲခြမ်းစိတ်ဖြာမှု မပြီးပါ: '+(e instanceof Error?e.message:'API error');}}else{status.textContent='ဖိုင်ကို သိမ်းထားပြီးပါပြီ။ ဒီဖိုင်အမျိုးအစားအတွက် စာသားထုတ်ယူမှု မပံ့ပိုးသေးပါ။';}}catch(e){failed++;status.textContent='ဖိုင်သိမ်း/ဖတ်ရှုမှု မအောင်မြင်ပါ: '+(e instanceof Error?e.message:'Storage error');}await refresh();}
 brain.disabled=false;brain.classList.remove('processing');wrap.hidden=true;picker.value='';status.textContent=failed?'ပြီးစီး '+done+' ဖိုင် · မအောင်မြင် '+failed+' ဖိုင်':'✓ '+done+' ဖိုင်၏ အချက်အလက်များ Brain ထဲ ဝင်သွားပါပြီ';view.querySelector('.brain-stage')?.classList.add('brain-complete');});
 view.querySelector('#brainBackToChat')?.addEventListener('click',()=>{activeTab='chat';render();});
 void refresh().catch(()=>{status.textContent='Local storage ကို ဖွင့်မရပါ။ ဖုန်း storage ကို စစ်ပါ။';});
}
let wakeCommandPollBusy = false;
async function consumePendingWakeCommand() {
  // focus, visibilitychange, renderChat and the polling fallback can all fire together.
  // Serialize reads so the native one-shot command is not consumed by competing callers.
  if (wakeCommandPollBusy) return;
  wakeCommandPollBusy = true;
  try {
    const pending = await MykNative.getPendingWakeCommand();
    if (!pending.command) return;
    if (pending.command === '__VEDARI_WAKE_ONLY__') {
      if (activeTab !== 'chat') { activeTab = 'chat'; render(); }
      messages.push({ role: 'assistant', content: 'ဟုတ်ကဲ့၊ အမရာဒီမှာရှိပါတယ်။ 😊 မင်းခိုင်းချင်တာကို ဆက်ပြောလိုက်နော်။' });
      persistCurrentChat();
      if (activeTab === 'chat') render();
      return;
    }
    // Make sure a wake command goes through the same form pipeline as a typed command,
    // so native actions run first instead of merely displaying the recognized words.
    if (activeTab !== 'chat') { activeTab = 'chat'; render(); }
    const prompt = document.querySelector<HTMLTextAreaElement>('#prompt');
    const form = document.querySelector<HTMLFormElement>('#chatForm');
    if (prompt && form) {
      prompt.value = pending.command;
      form.requestSubmit();
    } else {
      messages.push({ role: 'user', content: pending.command });
      activeTab = 'chat';
      render();
    }
  } catch { /* Native wake listener may be unavailable in web preview; normal chat remains usable. */ }
  finally { wakeCommandPollBusy = false; }
}
window.addEventListener('focus', () => { void consumePendingWakeCommand(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void consumePendingWakeCommand(); });
// SpeechRecognizer can deliver a command while AMARA is already foregrounded; in that case
// Android may reuse the existing Activity and emit no new focus event. Poll only while visible.
window.setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  void consumePendingWakeCommand();
  const diagnostic = document.querySelector<HTMLElement>('#wakeToggleFeedback');
  if (diagnostic) {
    void MykNative.getWakeListeningStatus().then(state => {
      const details = [state.lastStatus, state.lastDetail ? 'အသေးစိတ်: ' + state.lastDetail : '', state.lastHeard ? 'ကြားခဲ့သောအသံ: ' + state.lastHeard : ''].filter(Boolean);
      if (details.length) diagnostic.textContent = details.join(' · ');
    }).catch(() => {});
  }
}, 1500);

function renderChat(view: HTMLElement) {
  view.innerHTML = '<section class="chat-screen"><div class="chat-title-row"><div><span class="eyebrow">AMARA · PERSONAL CHAT</span><h2>အမရာနဲ့ စကားပြောမယ်</h2></div><span class="pill"><i></i> '+(busy?'THINKING':'READY')+'</span></div><div class="usage-strip" id="usageSummary"></div><div class="chat-transcript" id="chatTranscript"><div class="messages" id="messageList"></div></div><div class="composer-wrap"><div id="pendingFiles" class="pending-files"></div><form id="chatForm" class="composer chatgpt-composer"><button class="composer-icon plus-button" id="attachToggle" type="button" aria-label="Attach image or file">＋</button><textarea id="prompt" rows="1" placeholder="အမရာကို မေးပါ…" aria-label="Message AMARA" '+(busy?'disabled':'')+'></textarea><input id="imagePicker" type="file" accept="image/*" multiple hidden><input id="filePicker" type="file" accept=".txt,.md,.json,.csv,.html,.xml,.pdf,.log,text/*,application/json,application/pdf" multiple hidden><button class="composer-icon mic-button" id="voiceInput" type="button" aria-label="Voice input"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"></path></svg></button><button class="composer-icon send" type="submit" aria-label="Send message" '+(busy?'disabled':'')+'>↑</button></form><div class="composer-hint">အမရာ၏ အဖြေတွင် အမှားပါနိုင်သည်။ အရေးကြီးသောအချက်အလက်များကို စစ်ဆေးပါ။</div></div></section><div class="attach-popover" id="attachPopover" hidden><button type="button" id="chooseImages"><span>▧</span> ပုံရွေးရန်</button><button type="button" id="chooseFiles"><span>↥</span> ဖိုင်ရွေးရန်</button></div>';
  const list=view.querySelector<HTMLElement>('#messageList')!;
  const renderMessageContent=(content:string)=>{const marker=/\[\[AMARA_MAP:(current|route)\|([^|]+)\|([^\]]*)\]\]/.exec(content);if(!marker)return esc(content).replace(/\n/g,'<br>');const kind=marker[1],origin=marker[2],destination=marker[3];const embed=kind==='current'?'https://maps.google.com/maps?q='+encodeURIComponent(origin)+'&z=15&output=embed':'https://maps.google.com/maps?q='+encodeURIComponent(destination)+'&z=12&output=embed';const open=kind==='current'?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(origin):'https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(origin)+'&destination='+encodeURIComponent(destination);const before=content.slice(0,marker.index),after=content.slice(marker.index+marker[0].length);return esc(before).replace(/\n/g,'<br>')+'<div class="location-map-card"><iframe title="Google Maps '+(kind==='current'?'လက်ရှိတည်နေရာ':'လမ်းကြောင်း')+'" src="'+esc(embed)+'" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe><a class="location-map-link" href="'+esc(open)+'" target="_blank" rel="noopener noreferrer">📍 Google Maps မှာ '+(kind==='current'?'တည်နေရာကြည့်ရန်':'လမ်းကြောင်းနှင့် အကွာအဝေးကြည့်ရန်')+' ↗</a></div>'+esc(after).replace(/\n/g,'<br>');};const renderMessages=()=>{list.innerHTML=messages.map(m=>'<article class="message '+m.role+'"><div class="msg-label">'+(m.role==='user'?'မင်း · YOU':'အမရာ · AMARA')+'</div><div class="message-text">'+renderMessageContent(m.content)+'</div></article>').join('')+(busy?'<article class="message assistant"><div class="msg-label">အမရာ · AMARA</div><div class="typing">စဉ်းစားနေသည် <i></i><i></i><i></i></div></article>':'');};
  const usageEl=view.querySelector<HTMLElement>('#usageSummary');
  const selectedModel=localStorage.getItem(MODEL_NAME)||DEFAULT_MODEL;
  if(usageEl){
    const all=Object.entries(readUsage());
    const u=readUsage()[selectedModel]||{promptTokens:0,completionTokens:0,requests:0,costUsd:0,costKnown:false};
    const cat=readModelCatalog().find(m=>m.id===selectedModel);
    const known=all.some(([,x])=>x.costKnown);
    const total=all.reduce((n,[,x])=>n+(x.costKnown?x.costUsd:0),0);
    const tokens=all.reduce((n,[,x])=>n+x.promptTokens+x.completionTokens,0);
    usageEl.innerHTML='<div><b>ရွေးထားသော Model · '+esc(selectedModel)+'</b></div><div>Input '+u.promptTokens.toLocaleString()+' · Output '+u.completionTokens.toLocaleString()+' tokens · '+u.requests+' requests · '+(u.costKnown?money(u.costUsd):'ကုန်ကျစရိတ် မတွက်နိုင်သေး')+'</div><div><b>OpenRouter စုစုပေါင်း:</b> '+(known?money(total):'ကုန်ကျစရိတ် မသိရသေး')+' · '+tokens.toLocaleString()+' tokens</div>'+(cat?'<div>'+esc(modelPriceLabel(cat))+'</div>':'<div>Settings မှာ Model စာရင်းတင်ပြီး ဈေးနှုန်းကြည့်နိုင်ပါတယ်။</div>');
  }
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
      if(actionResult){messages.push({role:'assistant',content:actionResult});try{await saveAutoMemory(userText,actionResult);await updateProfileMemory(userText);}catch(e){console.warn('AMARA auto-memory save skipped',e);}busy=false;persistCurrentChat();render();return;}
    } catch(err) {
      const failure='လုပ်ဆောင်ချက် မအောင်မြင်ပါ။ '+(err instanceof Error?err.message:'အမှားတစ်ခု ဖြစ်နေပါတယ်။');messages.push({role:'assistant',content:failure});try{await saveAutoMemory(userText,failure);await updateProfileMemory(userText);}catch(e){console.warn('AMARA auto-memory save skipped',e);}
      busy=false;persistCurrentChat();render();return;
    }
    await askAI();
  });
  void consumePendingWakeCommand();
}
const PROVIDER_NAME = 'myk.ai.provider';
const GEMINI_KEY_NAME = 'myk.gemini.key';
const GEMINI_MODEL_NAME = 'myk.gemini.model';
const OPENROUTER_TOOLS = [{ type: 'function', function: { name: 'phone_action', description: 'Run Android actions. Use get_location for the device current GPS location; search_places to open a named place in Maps; set_alarm to request a real Android Clock alarm; open_app with app=Notes to open Notes; write_note only when the user asks to create/write note content; open_phone opens the dialer; call_phone only prefills a number and never calls automatically; search_youtube opens song results.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['get_weather','get_location','open_app','back','home','media_next','media_previous','media_play_pause','volume_up','volume_down','open_settings','click_text','search_youtube','open_phone','call_phone','write_note','set_text','search_places','set_alarm'] }, app: { type: 'string', description: 'App name, required only for open_app.' }, text: { type: 'string', description: 'Visible text to click; note content for write_note; text to insert for set_text.' }, query: { type: 'string', description: 'Song title/artist for search_youtube, destination/place query for search_places, or optional city name for get_weather (omit query for current GPS location).' }, number: { type: 'string', description: 'Phone number for call_phone; opens dialer with the number filled in and waits for the user to tap Call.' }, hour: { type: 'integer', description: 'Alarm hour in 24-hour format 0-23 for set_alarm.' }, minute: { type: 'integer', description: 'Alarm minute 0-59 for set_alarm.' }, label: { type: 'string', description: 'Alarm label for set_alarm.' }, exact: { type: 'boolean', description: 'Match visible text exactly when true.' } }, required: ['action'], additionalProperties: false } } }];
const GEMINI_TOOLS = [{ functionDeclarations: [{ name: 'phone_action', description: 'Run one allowed Android phone action. Use get_location for GPS location, search_places for Maps destinations, and set_alarm for Android Clock.', parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', enum: ['get_weather','get_location','open_app','back','home','media_next','media_previous','media_play_pause','volume_up','volume_down','open_settings','click_text','search_youtube','open_phone','call_phone','write_note','set_text','search_places','set_alarm'] }, app: { type: 'STRING' }, text: { type: 'STRING' }, query: { type: 'STRING' }, number: { type: 'STRING' }, hour: { type: 'INTEGER' }, minute: { type: 'INTEGER' }, label: { type: 'STRING' }, exact: { type: 'BOOLEAN' } }, required: ['action'] } }] }];

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
      const headers = { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'AMARA AI' };
      const chatMessages = [{ role: 'system', content: systemPrompt }, ...history.map(m => ({ role: m.role, content: m.content }))];
      let response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model, messages: chatMessages, tools: OPENROUTER_TOOLS, tool_choice: 'auto', temperature: 0.4, max_tokens: 900 }) });
      let data = await response.json();
      if(response.ok) recordOpenRouterUsage(model,data);
      // Some OpenRouter models do not support function/tool calling. Retry plain chat for those models.
      const firstError = String(data?.error?.message || '');
      if (!response.ok && response.status === 400 && /tool|function|unsupported|not support/i.test(firstError)) {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model, messages: chatMessages, temperature: 0.4, max_tokens: 900 }) });
        data = await response.json();
      }
      if (!response.ok) throw new Error(data?.error?.message || 'OpenRouter HTTP ' + response.status);
      const message = data?.choices?.[0]?.message;
      const call = message?.tool_calls?.find((t: any) => t.function?.name === 'phone_action');
      if (call) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { throw new Error('AI action argument မမှန်ပါ။'); }
        const result = await executeAgentAction(String(args.action || ''), args);
        const follow = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'AMARA AI' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...history.map(m => ({ role: m.role, content: m.content })), { role: 'assistant', content: null, tool_calls: [call] }, { role: 'tool', tool_call_id: call.id, content: result }], temperature: 0.4, max_tokens: 500 }) });
        const followData = await follow.json();
        if(follow.ok) recordOpenRouterUsage(model,followData);
        if (!follow.ok) throw new Error(followData?.error?.message || 'AI action result error');
        answer = followData?.choices?.[0]?.message?.content?.trim() || result;
      } else answer = typeof message?.content === 'string' ? message.content.trim() : '';
    }
    const finalAnswer=answer || 'AI က စာသားအဖြေမပြန်ပေးခဲ့ပါ။ Model သို့မဟုတ် API Key ကို စစ်ဆေးပါ။';messages.push({ role: 'assistant', content: finalAnswer });
    try{const lastUser=history[history.length-1]?.content||'';await saveAutoMemory(lastUser,finalAnswer);await updateProfileMemory(lastUser);}catch(e){console.warn('AMARA auto-memory save skipped',e);}
    persistCurrentChat();
  } catch (err) {
    const failure='AI/ဖုန်းလုပ်ဆောင်ချက် မအောင်မြင်ပါ။ ' + (err instanceof Error ? err.message : 'Unknown error') + '\nSettings ထဲက Provider, API Key, Model နဲ့ အင်တာနက်ကို စစ်ပါ။';messages.push({ role: 'assistant', content: failure });try{const lastUser=history[history.length-1]?.content||'';await saveAutoMemory(lastUser,failure);await updateProfileMemory(lastUser);}catch(e){console.warn('AMARA auto-memory save skipped',e);}
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
      <div class="status-row"><div><b>✨ “အမရာရေ” အမြဲနားထောင်မှု</b><small id="wakeStatus">အခြေအနေ စစ်ဆေးနေသည်… foreground notification ဖြင့် ထိန်းချုပ်မည်</small></div><div class="inline-actions"><button class="secondary" id="startWake">စတင်</button><button class="secondary" id="stopWake">ရပ်ရန်</button></div></div>
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
  const wakeStatus = view.querySelector<HTMLElement>('#wakeStatus')!;
  const refreshWakeStatus = async () => {
    try {
      const state = await MykNative.getWakeListeningStatus();
      wakeStatus.textContent = state.listening
        ? '✓ အမရာရေကို နားထောင်နေသည်။ အခြား app သုံးနေချိန်လည်း ဆက်လက်နားထောင်ရန် ကြိုးစားမည်။'
        : 'ပိတ်ထားသည်။ စတင်နှိပ်ပြီး Microphone permission ကို ခွင့်ပြုပါ။';
    } catch { wakeStatus.textContent = 'Wake listener အခြေအနေ မရပါ။ APK native integration ကို စစ်ပါ။'; }
  };
  void refreshWakeStatus();
  view.querySelector<HTMLButtonElement>('#startWake')!.addEventListener('click', async () => {
    const button = view.querySelector<HTMLButtonElement>('#startWake')!;
    button.disabled = true;
    wakeStatus.textContent = 'အမရာရေ နားထောင်မှု စတင်နေသည်…';
    try {
      const result = await MykNative.startVedariWakeListening();
      wakeStatus.textContent = result.message || 'နားထောင်မှု စတင်ရန် Android service ကို ခိုင်းပြီးပါပြီ။';
      await refreshWakeStatus();
    } catch (err) {
      wakeStatus.textContent = 'မစတင်နိုင်ပါ: ' + (err instanceof Error ? err.message : 'Microphone permission ကို စစ်ပါ။');
    } finally { button.disabled = false; }
  });
  view.querySelector<HTMLButtonElement>('#stopWake')!.addEventListener('click', async () => {
    const button = view.querySelector<HTMLButtonElement>('#stopWake')!;
    button.disabled = true;
    try {
      const result = await MykNative.stopVedariWakeListening();
      wakeStatus.textContent = result.message || 'နားထောင်မှု ရပ်လိုက်ပါပြီ။';
      await refreshWakeStatus();
    } catch (err) {
      wakeStatus.textContent = 'ရပ်မရပါ: ' + (err instanceof Error ? err.message : 'native service error');
    } finally { button.disabled = false; }
  });
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
      <label for="modelId">OpenRouter Model ID</label><input id="modelId" list="openRouterModelList" value="${esc(model)}" placeholder="openai/gpt-4o-mini"><datalist id="openRouterModelList"></datalist><small>OpenRouter က လက်ရှိပံ့ပိုးထားတဲ့ Model ID မည်သည့်တစ်ခုကိုမဆို ရွေးနိုင်/ကိုယ်တိုင်ရိုက်နိုင်ပါတယ်။</small>
      <button class="secondary wide" id="loadOpenRouterModels" type="button">OpenRouter မှ ရရှိနိုင်သော Model အားလုံးကို တင်မယ်</button>
      <label for="availableOpenRouterModels">ရရှိနိုင်သော Model များ</label><select id="availableOpenRouterModels"><option value="">Model စာရင်းမတင်ရသေးပါ</option></select><small id="modelLoadStatus" class="muted">Model စာရင်းရယူရန် API Key ထည့်ပြီး ခလုတ်နှိပ်ပါ။</small>
      <hr>
      <label for="geminiKey">Gemini API Key</label><input id="geminiKey" type="password" autocomplete="off" placeholder="Gemini API Key" value="${esc(geminiKey)}">
      <label for="geminiModel">Gemini Model ID</label><input id="geminiModel" value="${esc(geminiModel)}" placeholder="gemini-2.5-flash">
      <button class="primary wide" id="saveSettings">Settings သိမ်းမယ်</button>
      <button class="secondary wide" id="showKey">OpenRouter Key ပြ/ဖျောက်</button>
      <button class="secondary wide" id="showGeminiKey">Gemini Key ပြ/ဖျောက်</button>
      <button class="danger wide" id="deleteKeys">API Key နှစ်ခုလုံး ဖျက်မယ်</button>
    </div>
     <div class="card wake-settings-card">
       <div class="card-title">🎙 အမရာရေ — နောက်ခံအသံနားထောင်မှု</div>
       <p class="muted">ဖွင့်ထားလျှင် AMARA app အပြင်သို့ထွက်ပြီး အခြား app သုံးနေချိန်တွင်လည်း “အမရာရေ” ဟုခေါ်နိုင်ရန် Android foreground microphone service ကို စတင်မည်။ Android က ခွင့်ပြုထားသည့်အတိုင်းသာ အလုပ်လုပ်သည်။</p>
       <div class="wake-toggle-row"><div><b id="wakeToggleLabel">အခြေအနေ စစ်ဆေးနေသည်…</b><small id="wakeToggleHint">Microphone permission လိုအပ်သည်။</small></div><button class="primary" id="wakeToggle" type="button" aria-pressed="false">စစ်ဆေးနေသည်…</button></div>
       <p class="muted" id="wakeToggleFeedback" role="status">ဖွင့်ပြီးနောက် app ကို background ထား၍ စမ်းသပ်နိုင်သည်။</p>
     </div>
    <div class="card"><div class="card-title">ဖုန်း Action များ</div><p class="muted">AI tool calling ဖြင့် App ဖွင့်ခြင်း၊ Back/Home၊ သီချင်း Next/Previous/Play-Pause၊ Volume တိုး/လျှော့၊ Settings ဖွင့်ခြင်းတို့ကို ခွင့်ပြုထားပါတယ်။ Android permission နဲ့ လက်ရှိ Media App ပံ့ပိုးမှုအပေါ် မူတည်ပါတယ်။</p></div>
    <div class="card"><div class="card-title">About AMARA AI</div><p class="muted">Capacitor · TypeScript · Gemini API / OpenRouter · Android native actions</p></div>`;
  const wakeToggle = view.querySelector<HTMLButtonElement>('#wakeToggle')!;
  const wakeLabel = view.querySelector<HTMLElement>('#wakeToggleLabel')!;
  const wakeHint = view.querySelector<HTMLElement>('#wakeToggleHint')!;
  const wakeFeedback = view.querySelector<HTMLElement>('#wakeToggleFeedback')!;
  let wakeEnabled = false;
  const refreshWakeToggle = async () => {
    try {
      const state = await MykNative.getWakeListeningStatus();
      wakeEnabled = !!state.listening;
      wakeLabel.textContent = wakeEnabled ? 'နောက်ခံနားထောင်မှု ဖွင့်ထားသည်' : 'နောက်ခံနားထောင်မှု ပိတ်ထားသည်';
      wakeHint.textContent = wakeEnabled ? '“အမရာရေ” ဟုခေါ်ပြီး အမိန့်ဆက်ပြောပါ။' : 'ဖွင့်လိုက်လျှင် app အပြင်မှာလည်း နားထောင်ရန် ကြိုးစားမည်။';
      wakeToggle.textContent = wakeEnabled ? 'ပိတ်မယ်' : 'ဖွင့်မယ်';
      wakeToggle.classList.toggle('danger', wakeEnabled);
      wakeToggle.setAttribute('aria-pressed', String(wakeEnabled));
      const details = [state.lastStatus, state.lastDetail ? 'အသေးစိတ်: ' + state.lastDetail : '', state.lastHeard ? 'ကြားခဲ့သောအသံ: ' + state.lastHeard : ''].filter(Boolean);
      if (details.length) wakeFeedback.textContent = details.join(' · ');
    } catch {
      wakeLabel.textContent = 'Wake Word service မရနိုင်ပါ';
      wakeHint.textContent = 'Native Android integration နှင့် Microphone permission ကို စစ်ပါ။';
      wakeToggle.textContent = 'ထပ်စမ်းမယ်';
      wakeToggle.setAttribute('aria-pressed', 'false');
    }
  };
  void refreshWakeToggle();
  wakeToggle.addEventListener('click', async () => {
    wakeToggle.disabled = true;
    wakeFeedback.textContent = wakeEnabled ? 'နားထောင်မှု ရပ်နေသည်…' : 'Microphone service စတင်နေသည်…';
    try {
      if (wakeEnabled) {
        const result = await MykNative.stopVedariWakeListening();
        wakeFeedback.textContent = result.message || 'နောက်ခံနားထောင်မှုကို ရပ်လိုက်ပါပြီ။';
      } else {
        const result = await MykNative.startVedariWakeListening();
        wakeFeedback.textContent = result.message || 'နားထောင်မှု စတင်ရန် Android ကို တောင်းဆိုပြီးပါပြီ။';
      }
      await refreshWakeToggle();
    } catch (err) {
      wakeFeedback.textContent = 'မအောင်မြင်ပါ: ' + (err instanceof Error ? err.message : 'Microphone permission ကို စစ်ပါ။') + ' ဖုန်း Settings > Apps > AMARA AI > Permissions > Microphone ကို Allow လုပ်ထားပါ။';
    } finally { wakeToggle.disabled = false; }
  });
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
  view.querySelector<HTMLButtonElement>('#loadOpenRouterModels')!.addEventListener('click', async () => {
    const k = view.querySelector<HTMLInputElement>('#apiKey')!.value.trim();
    const status = view.querySelector<HTMLElement>('#modelLoadStatus')!;
    const select = view.querySelector<HTMLSelectElement>('#availableOpenRouterModels')!;
    const list = view.querySelector<HTMLDataListElement>('#openRouterModelList')!;
    if (!k) { status.textContent = 'Model စာရင်းရယူရန် OpenRouter API Key ကို အရင်ထည့်ပါ။'; return; }
    status.textContent = 'OpenRouter Model စာရင်းကို ရယူနေသည်…';
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', { headers: { 'Authorization': 'Bearer ' + k, 'X-Title': 'AMARA AI' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'HTTP ' + response.status);
      const models = (Array.isArray(data?.data) ? data.data : []).filter((m:any)=>typeof m.id==='string' && m.id).sort((a:any,b:any)=>a.id.localeCompare(b.id));
      localStorage.setItem(MODEL_CATALOG_NAME,JSON.stringify(models.map((m:any)=>({id:m.id,name:m.name,pricing:m.pricing,context_length:m.context_length}))));
      if (!models.length) throw new Error('Model စာရင်းအလွတ်ဖြစ်နေသည်။ API Key နှင့် အင်တာနက်ကို စစ်ပါ။');
      list.innerHTML = models.map((m:any)=>'<option value="'+esc(m.id)+'"></option>').join('');
      select.innerHTML = '<option value="">Model ရွေးပါ ('+models.length+' ခု)</option>' + models.map((m:any)=>'<option value="'+esc(m.id)+'">'+esc(m.name || m.id)+' · '+esc(m.id)+' · '+esc(modelPriceLabel(m))+'</option>').join('');
      const current = view.querySelector<HTMLInputElement>('#modelId')!.value.trim();
      const preferred = models.find((m:any)=>m.id===current) || models.find((m:any)=>m.id==='google/gemini-2.5-flash') || models.find((m:any)=>m.id==='google/gemini-2.0-flash-001');
      if (preferred) { select.value = preferred.id; view.querySelector<HTMLInputElement>('#modelId')!.value = preferred.id; }
      status.textContent = models.length+' ခု ရရှိနိုင်သော OpenRouter Model များကို တင်ပြီးပါပြီ။ Gemini ကို OpenRouter မှ သုံးလိုလျှင် google/gemini-2.5-flash ကဲ့သို့ OpenRouter ID ကိုရွေးပါ။';
    } catch (e) { status.textContent = 'Model စာရင်း မရပါ: '+(e instanceof Error?e.message:'Unknown error'); }
  });
  view.querySelector<HTMLSelectElement>('#availableOpenRouterModels')!.addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (id) view.querySelector<HTMLInputElement>('#modelId')!.value = id;
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
