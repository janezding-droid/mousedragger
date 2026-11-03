import test from 'node:test';
import assert from 'node:assert/strict';
import { getStore } from '@netlify/blobs';
import { createRecordHandler } from './record.mjs';
import { createExportHandler } from './export.mjs';

const event = (type, t, x = 70, y = 280, pointer_type = 'mouse') => ({type, t, x, y, pointer_type, button: type === 'pointermove' ? -1 : 0, is_dragging: true});
const trial = () => ({consent: true, label:'human', participant_id:'P001', task_type:'line', pointer_type:'mouse', events:[event('pointerdown',100),event('pointermove',200,400,200),event('pointerup',300,730,110)]});
const request = (body, headers = {}) => new Request('https://test.invalid/api/record', {method:'POST', headers:{'Content-Type':'application/json',...headers}, body: typeof body === 'string' ? body : JSON.stringify(body)});
function setup() {
  const writes = [];
  const handler = createRecordHandler({storeFactory: name => {
    assert.equal(name, 'mouse-captcha-records');
    return {setJSON: async (...args) => writes.push(args)};
  }});
  return {handler, writes};
}
for (const pointer of ['mouse','pen','touch']) test(`合法 ${pointer}：保留 schema、自報標籤、終點與儲存選項`,async()=>{
  const {handler,writes}=setup(), b=trial(); b.pointer_type=pointer; b.events.forEach(e=>e.pointer_type=pointer);
  const res=await handler(request(b)); assert.equal(res.status,200); const result=await res.json();
  assert.equal(result.completed,true); assert.equal(result.events,3); assert.equal(writes.length,1);
  const [key,r,options]=writes[0]; assert.equal(key,result.trial_id); assert.equal(r.schema_version,'1.0');
  assert.equal(r.label_source,'online_self_report_unverified'); assert.equal(r.pointer_type,pointer); assert.deepEqual(options,{onlyIfNew:true});
});
test('舊用戶端可省略事件 pointer/button/dragging；僅 down/up 可收',async()=>{
 const {handler,writes}=setup(),b=trial(); b.events.splice(1,1); b.events.forEach(e=>{delete e.pointer_type;delete e.button;delete e.is_dragging;});
 assert.equal((await handler(request(b))).status,200); assert.equal(writes[0][1].events[0].pointer_type,'mouse');
});
test('同時間 move 與合法未到達終點的 trial 可保留',async()=>{
 const {handler,writes}=setup(),b=trial(); b.events[1].t=100; b.events[2].x=100;
 assert.equal((await handler(request(b))).status,200); assert.equal(writes[0][1].completed,false);
});
const invalid = [
 ['缺少同意',b=>b.consent=false],['非 human',b=>b.label='bot'],['參與者代碼',b=>b.participant_id='姓名'],['未知任務',b=>b.task_type='other'],
 ['事件太少',b=>b.events.pop() && b.events.pop()],['事件過多',b=>b.events=Array(2501).fill(b.events[0])],['非物件事件',b=>b.events[1]=null],
 ['負時間',b=>b.events[0].t=-1],['時間倒序',b=>b.events[1].t=99],['零時長',b=>b.events.forEach(e=>e.t=100)],['超過時長',b=>b.events[2].t=180101],
 ['內部 down',b=>b.events[1].type='pointerdown'],['內部 up',b=>b.events[1].type='pointerup'],['缺 down',b=>b.events[0].type='pointermove'],['缺 up',b=>b.events[2].type='pointermove'],
 ['座標超界',b=>b.events[1].x=1801],['非數值座標',b=>b.events[1].y='100'],['非有限時間',b=>b.events[1].t=null],['START 錯誤',b=>b.events[0].x=400],
 ['trial 指標錯誤',b=>b.pointer_type='other'],['事件指標矛盾',b=>b.events[1].pointer_type='pen'],['顯式空指標',b=>b.events[1].pointer_type=null],
 ['錯誤布林',b=>b.events[1].is_dragging='false'],['錯誤按鈕',b=>b.events[1].button=6]
];
for(const [name,mutate] of invalid) test(`拒收 ${name}，回 400 且零寫入`,async()=>{
 const {handler,writes}=setup(), b=trial(); mutate(b); const res=await handler(request(b)); assert.equal(res.status,400); assert.equal(writes.length,0); assert.equal((await res.json()).ok,false);
});
for(const raw of ['{','null','[]','']) test(`無效 JSON/payload ${JSON.stringify(raw)}`,async()=>{const {handler,writes}=setup();assert.equal((await handler(request(raw))).status,400);assert.equal(writes.length,0);});
test('方法、媒體類型、跨來源拒收',async()=>{
 const {handler,writes}=setup(); assert.equal((await handler(new Request('https://test.invalid'))).status,405);
 assert.equal((await handler(request(trial(),{'Content-Type':'text/plain'}))).status,415);
 assert.equal((await handler(request(trial(),{Origin:'https://other.invalid'}))).status,403);assert.equal(writes.length,0);
});
for(const mode of ['exact','overflow','multibyte','lying-length']) test(`有界串流 ${mode}`,async()=>{
 const {handler,writes}=setup(); const base=JSON.stringify(trial());
 let bytes = new TextEncoder().encode(base+' '.repeat(350000-base.length));
 if(mode==='overflow'||mode==='lying-length') bytes=new Uint8Array(350001).fill(32);
 if(mode==='multibyte') bytes=new TextEncoder().encode(JSON.stringify({...trial(),session_id:'中'.repeat(120000)}));
 let offset=0,cancelled=false;
 const stream=new ReadableStream({pull(c){if(offset>=bytes.length){c.close();return;}const end=Math.min(offset+31_111,bytes.length);c.enqueue(bytes.slice(offset,end));offset=end;},cancel(){cancelled=true;}},{highWaterMark:0});
 const res=await handler(new Request('https://test.invalid/api/record',{method:'POST',duplex:'half',body:stream,headers:{'Content-Type':'application/json',...(mode==='lying-length'?{'Content-Length':'1'}:{})}}));
 assert.equal(res.status,mode==='exact'?200:413);assert.equal(writes.length,mode==='exact'?1:0);if(mode!=='exact')assert.equal(cancelled,true);
});
test('UTF-8 字元可跨 chunk；壞 UTF-8 回 400',async()=>{
 const {handler}=setup(); const bytes=new TextEncoder().encode(JSON.stringify({...trial(),session_id:'中文'}));
 const stream=new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}});
 assert.equal((await handler(new Request('https://test.invalid/api/record',{method:'POST',duplex:'half',body:stream,headers:{'Content-Type':'application/json'}}))).status,200);
 assert.equal((await handler(new Request('https://test.invalid/api/record',{method:'POST',body:Uint8Array.of(255),headers:{'Content-Type':'application/json'}}))).status,400);
});
test('讀取失敗回 400，零寫入',async()=>{
 const {handler,writes}=setup(); const body=new ReadableStream({start(c){c.error(new Error('broken transport'));}});
 assert.equal((await handler(new Request('https://test.invalid/api/record',{method:'POST',duplex:'half',body,headers:{'Content-Type':'application/json'}}))).status,400);assert.equal(writes.length,0);
});
test('儲存 SyntaxError 或類似驗證的訊息仍回 503',async()=>{
 for(const err of [new SyntaxError('storage secret'),new Error('Invalid storage secret')]){
 const handler=createRecordHandler({storeFactory:()=>({setJSON:async()=>{throw err;}})});
 const res=await handler(request(trial()));assert.equal(res.status,503);assert.equal((await res.text()).includes('secret'),false);
 }
});
const token='test-only-not-a-secret-123456789';
const exportRequest=(query='',auth=`Bearer ${token}`)=>new Request('https://test.invalid/api/export'+query,{headers:{Authorization:auth}});
test('匯出授權及 cursor 邊界不觸及儲存',async()=>{
 const handler=createExportHandler({getToken:()=>token,storeFactory:()=>{throw Error('should not access');}});
 assert.equal((await handler(exportRequest('','bad'))).status,401);assert.equal((await handler(exportRequest('','x'.repeat(200)))).status,401);
 assert.equal((await handler(exportRequest('?after=bad'))).status,400);
 assert.equal((await handler(new Request('https://test.invalid',{method:'POST'}))).status,405);
 assert.equal((await createExportHandler({getToken:()=>''})(exportRequest())).status,503);
});
test('匯出排序與 limit/after 分頁完整；null 紀錄繼續前進',async()=>{
 const keys=Array.from({length:123},(_,i)=>`WEB_${String(i).padStart(4,'0')}`);
 const handler=createExportHandler({getToken:()=>token,storeFactory:()=>({list:async()=>({blobs:[...keys].reverse().concat('other').map(key=>({key}))}),get:async(key,opts)=>{assert.deepEqual(opts,{type:'json',consistency:'strong'});return key==='WEB_0050'?null:{trial_id:key};}})});
 let after='', all=[],pages=0;
 do{const res=await handler(exportRequest(`?limit=50&after=${after}`));assert.equal(res.status,200);const body=await res.json();all.push(...body.records.map(r=>r.trial_id));after=body.next_after;assert.ok(++pages<=3);}while(after);
 assert.equal(pages,3);assert.deepEqual(all,keys.filter(k=>k!=='WEB_0050'));assert.equal(new Set(all).size,122);
 const empty=await (await handler(exportRequest('?after=WEB_9999'))).json();assert.deepEqual(empty.records,[]);assert.equal(empty.next_after,null);
});
test('實際 SDK 11.1.6 以替身 HTTP 跨三頁（含空頁）讀取，不連線',async()=>{
 const seen=[];
 const store=getStore({name:'mouse-captcha-records',siteID:'test-site',token:'test-token',edgeURL:'https://storage.invalid',fetch:async(input)=>{
   const u=new URL(input); const cursor=u.searchParams.get('cursor');seen.push(cursor);
   if(cursor===null)return Response.json({blobs:[{key:'WEB_0002'}],directories:[],next_cursor:'page-2'});
   if(cursor==='page-2')return Response.json({blobs:[],directories:[],next_cursor:'page-3'});
   assert.equal(cursor,'page-3');return Response.json({blobs:[{key:'WEB_0001'}],directories:[]});
 }});
 const {blobs}=await store.list(); assert.deepEqual(seen,[null,'page-2','page-3']); assert.deepEqual(blobs.map(b=>b.key),['WEB_0002','WEB_0001']);
});
test('匯出儲存失敗回 503，不洩漏內部訊息',async()=>{
 const handler=createExportHandler({getToken:()=>token,storeFactory:()=>({list:async()=>{throw Error('storage secret');}})});
 const res=await handler(exportRequest());assert.equal(res.status,503);assert.equal((await res.text()).includes('secret'),false);
});

test('超限會提早終止多 MB 來源；cancel 失敗仍回 413',async()=>{
 for(const failCancel of [false,true]){
 const {handler,writes}=setup();let pulls=0,cancelled=false;
 const stream=new ReadableStream({pull(c){pulls++;c.enqueue(new Uint8Array(100000).fill(32));if(pulls===100)c.close();},cancel(){cancelled=true;if(failCancel)throw Error('cancel failed');}},{highWaterMark:0});
 const res=await handler(new Request('https://test.invalid/api/record',{method:'POST',duplex:'half',body:stream,headers:{'Content-Type':'application/json'}}));
 assert.equal(res.status,413);assert.equal(pulls,4);assert.equal(cancelled,true);assert.equal(writes.length,0);
 }
});
