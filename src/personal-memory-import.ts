export type MemoryNative = { saveTextFile(options: { fileName: string; content: string; mimeType: string }): Promise<{ success: boolean; fileName: string; uri: string; location: string }> };

type RecordItem = { title: string; messages: Array<{ role: string; text: string }> };
const dec = new TextDecoder();
function textOf(v: any): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('\n');
  if (!v || typeof v !== 'object') return '';
  for (const k of ['text','parts','content','message','prompt','response','body']) { const t = textOf(v[k]); if (t) return t; }
  return '';
}
function jsonRecords(raw: string, label: string): RecordItem[] {
  let root: any; try { root = JSON.parse(raw); } catch { return []; }
  const arr = Array.isArray(root) ? root : Array.isArray(root?.conversations) ? root.conversations : Array.isArray(root?.items) ? root.items : [];
  return arr.map((item: any) => {
    const mapping = item?.mapping && typeof item.mapping === 'object' ? Object.values(item.mapping).map((x:any)=>x?.message).filter(Boolean) : [];
    const msgs = Array.isArray(item?.messages) ? item.messages : mapping;
    const messages = msgs.map((m:any)=>({role:String(m?.author?.role || m?.role || m?.sender || 'unknown'),text:textOf(m?.content ?? m?.text ?? m?.parts ?? m?.message).trim()})).filter((m:any)=>m.text).slice(0,20000);
    if (!messages.length) { const t = textOf(item); if (t) messages.push({role:'record',text:t}); }
    return {title:String(item?.title || item?.name || item?.header || label).slice(0,250),messages};
  }).filter((x:RecordItem)=>x.messages.length);
}
async function zipTextFiles(file: File): Promise<Array<{name:string;text:string}>> {
  if (file.size > 600 * 1024 * 1024) throw new Error('ZIP 600 MB ထက်ကြီးနေပါတယ်။ အပိုင်းခွဲပါ။');
  const bytes = new Uint8Array(await file.arrayBuffer()); const v = new DataView(bytes.buffer); let end = -1;
  for (let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0) throw new Error('ZIP directory မတွေ့ပါ။');
  const count=v.getUint16(end+10,true); if(count>2500) throw new Error('ZIP ထဲက ဖိုင်အရေအတွက် အလွန်များနေပါတယ်။');
  let p=v.getUint32(end+16,true), total=0; const out:Array<{name:string;text:string}>=[];
  for(let i=0;i<count;i++){
    if(v.getUint32(p,true)!==0x02014b50) break;
    const method=v.getUint16(p+10,true), cs=v.getUint32(p+20,true), us=v.getUint32(p+24,true), nl=v.getUint16(p+28,true), el=v.getUint16(p+30,true), cl=v.getUint16(p+32,true), off=v.getUint32(p+42,true);
    const name=dec.decode(bytes.slice(p+46,p+46+nl)); p+=46+nl+el+cl;
    if(!/\.(json|html?|md|txt)$/i.test(name)||name.endsWith('/')) continue;
    total+=us; if(total>450*1024*1024) throw new Error('ဖတ်ရမည့်စာသားဖိုင်များ 450 MB ကျော်နေပါတယ်။');
    if(v.getUint32(off,true)!==0x04034b50) continue;
    const start=off+30+v.getUint16(off+26,true)+v.getUint16(off+28,true), data=bytes.slice(start,start+cs); let plain:Uint8Array;
    if(method===0) plain=data; else if(method===8){ const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat)); plain=new Uint8Array(await new Response(stream).arrayBuffer()); } else continue;
    out.push({name,text:dec.decode(plain)});
  }
  if(!out.length) throw new Error('ZIP ထဲတွင် ဖတ်နိုင်သော JSON/HTML/MD/TXT မတွေ့ပါ။'); return out;
}
function htmlRecords(raw:string, label:string):RecordItem[]{const doc=new DOMParser().parseFromString(raw,'text/html');doc.querySelectorAll('script,style,noscript').forEach(x=>x.remove());const text=(doc.body.textContent||'').replace(/\s+/g,' ').trim();return text?[{title:label,messages:[{role:'activity',text}]}]:[];}
export function initMemoryImport(view: HTMLElement, native: MemoryNative): void {
 const card=document.createElement('section'); card.className='card';
 card.innerHTML='<div class="card-title">🧠 Personal Memory Import · Gemini + Myk</div><p class="muted">Gemini ZIP/JSON/HTML နှင့် အရင် Myk MD/JSON ဖိုင်ကို ရွေးပါ။ ဖိုင်တွေကို ဖုန်းထဲမှာပဲ ဖတ်ပြီး API ဆီ အလိုအလျောက်မပို့ပါ။</p><label>Gemini Export (ZIP / JSON / HTML / TXT)</label><input id="gemImportFile" type="file" accept="application/zip,application/json,application/octet-stream,text/html,text/plain,text/markdown"><label>အရင် Myk Memory (MD / JSON)</label><input id="mykImportFile" type="file" accept="application/json,application/octet-stream,text/markdown,text/plain"><p id="mergeStatus" class="muted">Gemini ဖိုင်နဲ့ Myk ဖိုင်ကို ရွေးပါ။</p><button class="primary wide" id="mergeMemory">ပေါင်းပြီး Memory ဖန်တီးရန်</button><div id="mergePreview" class="muted"></div><button class="secondary wide" id="mergeSaveMd" disabled>myk_personal_memory.md သိမ်းရန်</button><button class="secondary wide" id="mergeSaveJson" disabled>myk_personal_memory.json သိမ်းရန်</button><p class="muted">အခြား App များ၏ private database ကို မဖတ်ပါ။ ဖိုင်ထဲက စကားဝိုင်းများကိုသာ import လုပ်ပါမည်။</p>';
 const anchor=view.querySelector('#personalMemoryCard'); if(anchor?.parentElement) anchor.parentElement.insertBefore(card,anchor.nextSibling); else view.appendChild(card);
 const status=card.querySelector<HTMLElement>('#mergeStatus')!, preview=card.querySelector<HTMLElement>('#mergePreview')!, b=card.querySelector<HTMLButtonElement>('#mergeMemory')!, md=card.querySelector<HTMLButtonElement>('#mergeSaveMd')!, js=card.querySelector<HTMLButtonElement>('#mergeSaveJson')!;
 let result:any=null, markdown='';
 b.addEventListener('click',async()=>{const gf=card.querySelector<HTMLInputElement>('#gemImportFile')!.files?.[0], mf=card.querySelector<HTMLInputElement>('#mykImportFile')!.files?.[0];if(!gf&&!mf){status.textContent='ဖိုင်အနည်းဆုံးတစ်ခု ရွေးပါ။';return;}b.disabled=true;md.disabled=true;js.disabled=true;status.textContent='ဖိုင်တွေကို ဖတ်ပြီး ပေါင်းစည်းနေပါတယ်…';
 try{const records: any[]=[], sourceInfo:any[]=[];let mykText='';if(mf){mykText=await mf.text();let r=mf.name.toLowerCase().endsWith('.json')?jsonRecords(mykText,'Myk profile'):[];if(!r.length&&mykText.trim())r=[{title:'Myk Personal Profile',messages:[{role:'profile',text:mykText}]}];records.push(...r.map(x=>({...x,source:'Myk'})));sourceInfo.push({source:'Myk',fileName:mf.name,records:r.length});}
 if(gf){const parts=gf.name.toLowerCase().endsWith('.zip')?await zipTextFiles(gf):[{name:gf.name,text:await gf.text()}];for(const part of parts){const n=part.name.toLowerCase();let r:RecordItem[]=[];if(n.endsWith('.json'))r=jsonRecords(part.text,'Gemini');else if(/\.html?$/.test(n))r=htmlRecords(part.text,part.name);else if(/\.(md|txt)$/.test(n)&&part.text.trim())r=[{title:part.name,messages:[{role:'activity',text:part.text.slice(0,100000)}]}];if(r.length){records.push(...r.map(x=>({...x,source:'Gemini',fileName:part.name})));sourceInfo.push({source:'Gemini',fileName:part.name,records:r.length});}}}
 const seen=new Set<string>();const unique=records.filter(x=>{const k=(x.source+'|'+x.title+'|'+(x.messages[0]?.text||'').slice(0,300)).toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});if(!unique.length)throw new Error('ဖတ်လို့ရတဲ့ မှတ်တမ်းမတွေ့ပါ။ Takeout ထဲက Gemini Apps/My Activity export ကို စစ်ပါ။');const count=unique.reduce((n,x)=>n+x.messages.length,0);result={schemaVersion:1,generatedAt:new Date().toISOString(),privacy:{processedLocally:true,uploadedAutomatically:false,apiKeyRequired:false,reviewBeforeApiUpload:true},sources:sourceInfo,mykExistingProfile:mykText||null,stats:{records:unique.length,messages:count},records:unique};markdown='# Myk Personal Memory (Draft)\n\nGenerated: '+result.generatedAt+'\n\nSources: '+sourceInfo.map(x=>x.source+' — '+x.fileName).join(', ')+'\n\nRecords: '+unique.length+'\nMessages/items: '+count+'\n\n'+unique.map(x=>'## ['+x.source+'] '+x.title+'\n\n'+x.messages.map((m:any)=>'**'+m.role+'**\n\n'+m.text).join('\n\n')).join('\n\n---\n\n')+'\n\n## Privacy\n- Imported locally; not automatically sent to OpenRouter.\n- Review this draft before using it as long-term memory.\n';preview.innerHTML='<b>ပေါင်းစည်းမှု ပြီးပါပြီ</b><div>Source files: '+sourceInfo.length+'</div><div>Records: '+unique.length+'</div><div>Messages/items: '+count+'</div><p>ဖုန်းထဲမှာပဲ စုစည်းထားပါတယ်။</p>';status.textContent='Memory draft အသင့်ဖြစ်ပါပြီ။';md.disabled=false;js.disabled=false;
 }catch(e){status.textContent='Import မအောင်မြင်ပါ: '+(e instanceof Error?e.message:'ဖိုင်ဖတ်မရပါ။');}finally{b.disabled=false;}});
 md.addEventListener('click',async()=>{if(!markdown)return;try{const r=await native.saveTextFile({fileName:'myk_personal_memory.md',content:markdown,mimeType:'text/markdown'});status.textContent='Markdown သိမ်းပြီးပါပြီ: '+r.location+' / '+r.fileName;}catch(e){status.textContent='သိမ်းမရပါ: '+(e instanceof Error?e.message:'Native save error');}});
 js.addEventListener('click',async()=>{if(!result)return;try{const r=await native.saveTextFile({fileName:'myk_personal_memory.json',content:JSON.stringify(result,null,2),mimeType:'application/json'});status.textContent='JSON သိမ်းပြီးပါပြီ: '+r.location+' / '+r.fileName;}catch(e){status.textContent='သိမ်းမရပါ: '+(e instanceof Error?e.message:'Native save error');}});
}
