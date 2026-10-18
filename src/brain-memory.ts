export type BrainItem = {
  id: string;
  title: string;
  content: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

const DB_NAME = 'myk-guardian-brain';
const STORE_NAME = 'memories';
const FALLBACK_KEY = 'myk.brain.memory.fallback.v1';
const MAX_CONTEXT_CHARS = 8500;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB မရရှိပါ')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Brain database ဖွင့်မရပါ'));
  });
}
function fallbackRead(): BrainItem[] {
  try { const x = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]'); return Array.isArray(x) ? x : []; } catch { return []; }
}
function fallbackWrite(items: BrainItem[]): void {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(items));
}
export async function getBrainItems(): Promise<BrainItem[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      req.onsuccess = () => { db.close(); resolve((req.result || []) as BrainItem[]); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch { return fallbackRead(); }
}
export async function putBrainItem(item: BrainItem): Promise<void> {
  await putBrainItems([item]);
}
async function putBrainItems(items: BrainItem[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      items.forEach(item => store.put(item));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('သိမ်းဆည်းမှု ပယ်ဖျက်ခံရသည်')); };
    });
  } catch {
    const all = fallbackRead();
    const byId = new Map(all.map(item => [item.id, item]));
    items.forEach(item => byId.set(item.id, item));
    fallbackWrite([...byId.values()]);
  }
}
export async function removeBrainItem(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch { fallbackWrite(fallbackRead().filter(x => x.id !== id)); }
}
function cleanText(value: string): string { return value.replace(/\u0000/g, '').replace(/\r/g, '').trim(); }
function makeItem(title: string, content: string, source: string): BrainItem | null {
  const body = cleanText(content);
  if (!body) return null;
  const now = new Date().toISOString();
  return { id: crypto.randomUUID ? crypto.randomUUID() : 'brain-' + Date.now() + '-' + Math.random().toString(36).slice(2), title: cleanText(title).slice(0, 220) || 'မှတ်ဉာဏ်အသစ်', content: body, source, createdAt: now, updatedAt: now };
}
function jsonToItems(raw: string, filename: string): BrainItem[] {
  let root: any;
  try { root = JSON.parse(raw); } catch { return []; }
  const output: BrainItem[] = [];
  const add = (title: string, body: string) => {
    const text = cleanText(body);
    if (!text) return;
    // Split unusually large records into searchable, displayable chunks.
    for (let i = 0; i < text.length; i += 10000) {
      const item = makeItem(text.length > 10000 ? title + ' (' + (Math.floor(i / 10000) + 1) + ')' : title, text.slice(i, i + 10000), filename);
      if (item) output.push(item);
    }
  };
  const candidates = Array.isArray(root) ? root : Array.isArray(root?.records) ? root.records : Array.isArray(root?.conversations) ? root.conversations : Array.isArray(root?.items) ? root.items : null;
  if (candidates) {
    for (const entry of candidates) {
      const title = String(entry?.title || entry?.name || entry?.header || entry?.topic || filename);
      const messages = Array.isArray(entry?.messages) ? entry.messages : Array.isArray(entry?.parts) ? entry.parts : [];
      if (messages.length) {
        for (const m of messages) {
          const text = typeof m === 'string' ? m : typeof m?.text === 'string' ? m.text : typeof m?.content === 'string' ? m.content : Array.isArray(m?.content?.parts) ? m.content.parts.map((p: any) => p?.text || '').join('\n') : '';
          if (text) add(title + (m?.role || m?.author?.role ? ' · ' + (m.role || m.author.role) : ''), text);
        }
      } else {
        const text = typeof entry?.content === 'string' ? entry.content : typeof entry?.text === 'string' ? entry.text : typeof entry?.summary === 'string' ? entry.summary : '';
        if (text) add(title, text);
        else if (entry && typeof entry === 'object') {
          const values = Object.entries(entry).filter(([k,v]) => !['id','createdAt','updatedAt','source'].includes(k) && typeof v === 'string').map(([k,v]) => k + ': ' + v).join('\n');
          if (values) add(title, values);
        }
      }
    }
  } else if (root && typeof root === 'object') {
    const profile = typeof root.profile === 'string' ? root.profile : typeof root.summary === 'string' ? root.summary : '';
    if (profile) add('Profile', profile);
    const facts = Array.isArray(root.facts) ? root.facts : Array.isArray(root.memories) ? root.memories : [];
    for (const fact of facts) add(String(fact?.title || fact?.category || 'Memory'), typeof fact === 'string' ? fact : String(fact?.content || fact?.text || fact?.value || JSON.stringify(fact)));
    if (!output.length) add(filename, JSON.stringify(root, null, 2));
  } else if (typeof root === 'string') add(filename, root);
  return output;
}
function markdownToItems(raw: string, filename: string): BrainItem[] {
  const text = cleanText(raw);
  if (!text) return [];
  const sections = text.split(/(?=^#{1,4}\s+)/m).filter(Boolean);
  const output: BrainItem[] = [];
  for (let s = 0; s < sections.length; s++) {
    const part = sections[s].trim();
    const match = part.match(/^#{1,4}\s+(.+?)(?:\n|$)/);
    const title = match?.[1]?.trim() || filename;
    const body = match ? part.slice(match[0].length).trim() : part;
    for (let i = 0; i < body.length; i += 10000) {
      const item = makeItem(body.length > 10000 ? title + ' (' + (Math.floor(i / 10000) + 1) + ')' : title, body.slice(i, i + 10000), filename);
      if (item) output.push(item);
    }
  }
  if (!output.length) {
    for (let i = 0; i < text.length; i += 10000) {
      const item = makeItem(filename, text.slice(i, i + 10000), filename);
      if (item) output.push(item);
    }
  }
  return output;
}
export async function importBrainFile(file: File): Promise<{ added: number; skipped: number }> {
  if (file.size > 250 * 1024 * 1024) throw new Error('ဖိုင်အရွယ်အစား 250 MB ကျော်နေပါတယ်။ ဖိုင်ကို အပိုင်းခွဲပြီး ထည့်ပါ။');
  const raw = await file.text();
  const name = file.name.toLowerCase();
  let incoming: BrainItem[] = [];
  if (name.endsWith('.json')) incoming = jsonToItems(raw, file.name);
  else if (name.endsWith('.md') || name.endsWith('.txt')) incoming = markdownToItems(raw, file.name);
  else if (name.endsWith('.html') || name.endsWith('.htm')) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    doc.querySelectorAll('script,style,noscript').forEach(n => n.remove());
    incoming = markdownToItems(doc.body.textContent || '', file.name);
  } else throw new Error('Brain ထဲမှာ .md, .json, .txt, .html ဖိုင်တွေကို ရွေးပါ။ Gemini ZIP ကို Settings > Personal Memory Import မှာ အရင်ပေါင်းစည်းပါ။');
  if (!incoming.length) throw new Error('ဖိုင်ထဲက မှတ်ဉာဏ်စာသားကို ဖတ်မရပါ။');
  const existing = await getBrainItems();
  const signatures = new Set(existing.map(x => (x.title + '|' + x.content).toLocaleLowerCase().replace(/\s+/g, ' ').trim()));
  let added = 0, skipped = 0;
  const toAdd: BrainItem[] = [];
  for (const item of incoming) {
    const signature = (item.title + '|' + item.content).toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (signatures.has(signature)) { skipped++; continue; }
    signatures.add(signature);
    toAdd.push(item);
    added++;
  }
  // Batch the IndexedDB writes so large memory imports do not open a transaction per record.
  await putBrainItems(toAdd);
  return { added, skipped };
}
function queryTerms(query: string): string[] {
  const normalized = query.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const terms = new Set(normalized.split(/\s+/).filter(x => x.length >= 2));
  // Burmese is often written without spaces between words; include short character n-grams.
  const myanmar = (normalized.match(/[\u1000-\u109f\uAA60-\uAA7F\uA9E0-\uA9FF]+/g) || []).join('');
  for (let i = 0; i < myanmar.length - 1; i += 2) terms.add(myanmar.slice(i, i + 2));
  return [...terms].filter(x => x.length <= 50);
}
export async function getRelevantBrainContext(query: string): Promise<string> {
  const items = await getBrainItems();
  if (!items.length || !query.trim()) return '';
  const terms = queryTerms(query);
  if (!terms.length) return '';
  const scored = items.map(item => {
    const title = item.title.toLocaleLowerCase();
    const body = item.content.toLocaleLowerCase();
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 5;
      const index = body.indexOf(term);
      if (index >= 0) score += Math.min(4, 1 + body.split(term).length * 0.12);
    }
    return { item, score };
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score).slice(0, 8);
  let used = 0;
  const sections: string[] = [];
  for (const {item} of scored) {
    const body = item.content.slice(0, Math.min(item.content.length, 1800));
    const section = '- ' + item.title + ' [source: ' + item.source + ']\n' + body;
    if (used + section.length > MAX_CONTEXT_CHARS) continue;
    sections.push(section); used += section.length;
  }
  return sections.join('\n\n');
}
export function initBrainScreen(view: HTMLElement): void {
  view.innerHTML = `
    <div class="section-head"><div><span class="eyebrow">PERSONAL KNOWLEDGE CORE</span><h2>🧠 Brain · ကိုယ်ပိုင်မှတ်ဉာဏ်</h2></div><span class="pill" id="brainCount">LOADING</span></div>
    <div class="notice"><b>မင်းပေးထားတဲ့ မှတ်ဉာဏ်တွေ</b><p>ဒီနေရာမှာ ဖိုင်တွေကို ထည့်၊ အကြောင်းအရာတွေကို ကြည့်/ပြင်/ဖျက်နိုင်ပါတယ်။ Myk က မေးခွန်းနဲ့ သက်ဆိုင်တဲ့ မှတ်တမ်းတွေကို ဒေသတွင်းမှာ ရှာပြီး AI prompt ထဲကို ထည့်ပေးမယ်။ AI အဖြေထုတ်ဖို့ OpenRouter ကို ခေါ်တဲ့အခါ ရွေးထားတဲ့ သက်ဆိုင်ရာစာသားအပိုင်းတွေကို provider ဆီ ပို့နိုင်တာကို သတိပြုပါ။</p></div>
    <div class="card">
      <div class="card-title">📥 Memory ဖိုင် ထည့်ရန်</div>
      <p class="muted">myk_personal_memory.md / .json အပါအဝင် Markdown, JSON, TXT, HTML ကို ထည့်နိုင်ပါတယ်။ Gemini ZIP ကို Settings ထဲက Import လုပ်ဆောင်ချက်နဲ့ ပေါင်းစည်းပြီးနောက် ထုတ်ထားတဲ့ဖိုင်ကို ဒီမှာထည့်ပါ။</p>
      <input id="brainFile" type="file" accept=".md,.json,.txt,.html,.htm">
      <button class="primary wide" id="brainImport">Brain ထဲ ပေါင်းထည့်မယ်</button>
      <p class="muted" id="brainImportStatus" aria-live="polite">ဖိုင်မရွေးရသေးပါ။</p>
    </div>
    <div class="card">
      <div class="card-title">✍️ မှတ်ဉာဏ်အသစ် ထည့် / ပြင်ရန်</div>
      <label for="brainTitle">ခေါင်းစဉ်</label><input id="brainTitle" type="text" placeholder="ဥပမာ - Myk ပရောဂျက် ဦးစားပေးချက်">
      <label for="brainContent">အသေးစိတ်မှတ်ဉာဏ်</label><textarea id="brainContent" rows="5" placeholder="Myk မှတ်ထားစေချင်တဲ့အချက်တွေကို ဒီမှာရေးပါ"></textarea>
      <input id="brainEditId" type="hidden">
      <button class="primary wide" id="brainSave">မှတ်ဉာဏ် သိမ်းမယ်</button>
      <button class="secondary wide" id="brainCancelEdit" hidden>ပြင်ဆင်မှု ပယ်ဖျက်ရန်</button>
      <p class="muted" id="brainEditStatus"></p>
    </div>
    <div class="card">
      <div class="card-title">🔎 Brain ထဲက မှတ်ဉာဏ် ရှာရန်</div>
      <input id="brainSearch" type="search" placeholder="ဥပမာ - Myk voice command, API model">
      <div id="brainRecords" class="brain-records"></div>
    </div>`;
  const q = <HTMLInputElement>view.querySelector('#brainSearch')!;
  const file = <HTMLInputElement>view.querySelector('#brainFile')!;
  const status = <HTMLElement>view.querySelector('#brainImportStatus')!;
  const count = <HTMLElement>view.querySelector('#brainCount')!;
  const list = <HTMLElement>view.querySelector('#brainRecords')!;
  const title = <HTMLInputElement>view.querySelector('#brainTitle')!;
  const content = <HTMLTextAreaElement>view.querySelector('#brainContent')!;
  const editId = <HTMLInputElement>view.querySelector('#brainEditId')!;
  const editStatus = <HTMLElement>view.querySelector('#brainEditStatus')!;
  const save = view.querySelector<HTMLButtonElement>('#brainSave')!;
  const cancel = view.querySelector<HTMLButtonElement>('#brainCancelEdit')!;
  const resetEditor = () => { title.value=''; content.value=''; editId.value=''; cancel.hidden=true; save.textContent='မှတ်ဉာဏ် သိမ်းမယ်'; };
  const refresh = async () => {
    const all = await getBrainItems();
    count.textContent = all.length + ' ITEMS';
    const needle = q.value.trim().toLocaleLowerCase();
    const visible = needle ? all.filter(x => (x.title + ' ' + x.content + ' ' + x.source).toLocaleLowerCase().includes(needle)) : all;
    list.innerHTML = visible.length ? visible.map(item => `
      <article class="brain-record">
        <div class="brain-record-head"><b>${escHtml(item.title)}</b><span>${escHtml(item.source)}</span></div>
        <p>${escHtml(item.content.slice(0, 900))}${item.content.length > 900 ? '…' : ''}</p>
        <div class="brain-record-actions"><button class="secondary" data-brain-edit="${escHtml(item.id)}">ပြင်မယ်</button><button class="danger" data-brain-delete="${escHtml(item.id)}">ဖျက်မယ်</button></div>
      </article>`).join('') : '<p class="muted">ကိုက်ညီတဲ့မှတ်ဉာဏ် မတွေ့ပါ။ ဖိုင်ထည့်ပါ သို့မဟုတ် မှတ်ဉာဏ်အသစ်ရေးပါ။</p>';
    list.querySelectorAll<HTMLButtonElement>('[data-brain-edit]').forEach(button => button.addEventListener('click', () => {
      const item = all.find(x => x.id === button.dataset.brainEdit); if (!item) return;
      title.value=item.title; content.value=item.content; editId.value=item.id; cancel.hidden=false; save.textContent='ပြင်ဆင်မှု သိမ်းမယ်';
      editStatus.textContent='ပြင်ဆင်မယ့် မှတ်ဉာဏ်ကို အပေါ်က Form မှာ ပြင်ပြီး သိမ်းပါ။';
      title.scrollIntoView({behavior:'smooth',block:'center'});
    }));
    list.querySelectorAll<HTMLButtonElement>('[data-brain-delete]').forEach(button => button.addEventListener('click', async () => {
      const item = all.find(x => x.id === button.dataset.brainDelete); if (!item) return;
      if (!confirm('ဒီမှတ်ဉာဏ်ကို Brain မှ ဖျက်မှာ သေချာပါသလား?')) return;
      await removeBrainItem(item.id); await refresh(); editStatus.textContent='မှတ်ဉာဏ်ကို ဖျက်ပြီးပါပြီ။';
    }));
  };
  q.addEventListener('input', () => { void refresh(); });
  cancel.addEventListener('click', () => { resetEditor(); editStatus.textContent='ပြင်ဆင်မှုကို ပယ်ဖျက်လိုက်ပါပြီ။'; });
  save.addEventListener('click', async () => {
    const t = title.value.trim(), body = content.value.trim();
    if (!t || !body) { editStatus.textContent='ခေါင်းစဉ်နဲ့ မှတ်ဉာဏ်စာသား နှစ်ခုလုံး ထည့်ပါ။'; return; }
    const now = new Date().toISOString();
    const old = editId.value ? (await getBrainItems()).find(x => x.id === editId.value) : undefined;
    const item: BrainItem = { id: old?.id || (crypto.randomUUID ? crypto.randomUUID() : 'brain-' + Date.now()), title:t, content:body, source:old?.source || 'Owner added', createdAt:old?.createdAt || now, updatedAt:now };
    try { await putBrainItem(item); resetEditor(); editStatus.textContent='Brain မှတ်ဉာဏ် သိမ်းပြီးပါပြီ။ Chat မှာ ချက်ချင်းအသုံးပြုနိုင်ပါပြီ။'; await refresh(); }
    catch (err) { editStatus.textContent='သိမ်းမရပါ: ' + (err instanceof Error ? err.message : 'storage error'); }
  });
  view.querySelector<HTMLButtonElement>('#brainImport')!.addEventListener('click', async () => {
    const selected = file.files?.[0]; if (!selected) { status.textContent='အရင် Memory ဖိုင်ကို ရွေးပါ။'; return; }
    const button = view.querySelector<HTMLButtonElement>('#brainImport')!;
    button.disabled=true; status.textContent='ဖိုင်ကို ဖုန်းထဲမှာ ဖတ်ပြီး Brain ထဲ ပေါင်းထည့်နေပါတယ်…';
    try { const result = await importBrainFile(selected); status.textContent='ပြီးပါပြီ။ အသစ်ထည့်ထားသော မှတ်တမ်း ' + result.added + ' ခု · ထပ်နေ၍ ကျော်ထားသော မှတ်တမ်း ' + result.skipped + ' ခု။'; file.value=''; await refresh(); }
    catch (err) { status.textContent='Import မအောင်မြင်ပါ: ' + (err instanceof Error ? err.message : 'unknown error'); }
    finally { button.disabled=false; }
  });
  void refresh();
}
function escHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
