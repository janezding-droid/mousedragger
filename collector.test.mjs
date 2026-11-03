import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRecordHandler} from './record.mjs';
import {analyzeRecord} from './features.mjs';

// 執行真正的內嵌收集器；DOM/capture/網路為隔離替身，不存取正式服務。
function setup({fail=false}={}) {
  const nodes=new Map(), requests=[], captures=new Set(); let time=100;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:({pid:'P001',label:'human',task:'line'})[id]??'',checked:id==='consent',textContent:'',attrs:{},handlers:{},addEventListener(k,fn){this.handlers[k]=fn},setAttribute(k,v){this.attrs[k]=v},getBoundingClientRect(){return {left:0,top:0,width:800,height:400}},setPointerCapture(id){captures.add(id)},hasPointerCapture(id){return captures.has(id)},releasePointerCapture(id){captures.delete(id)}});return nodes.get(id)};
  vm.runInNewContext(readFileSync(new URL('./index.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1],{
    document:{getElementById:node},location:{hostname:'localhost'},performance:{now:()=>time+=100},
    fetch:async(url,opts)=>{requests.push(JSON.parse(opts.body));if(fail)throw Error('offline');return {ok:true,json:async()=>({ok:true,events:3,trial_id:'isolated'})}},
    URL,Blob,console
  });
  const fire=async(type,changes={})=>node('stage').handlers[type]?.({pointerId:1,pointerType:'mouse',button:type==='pointermove'?-1:0,clientX:type==='pointerdown'?70:730,clientY:type==='pointerdown'?280:110,...changes});
  return {node,fire,requests,captures};
}
test('第二指標 move/up 不污染或提前結束第一筆',async()=>{
 const s=setup();await s.fire('pointerdown');await s.fire('pointermove',{pointerId:2,pointerType:'touch'});await s.fire('pointerup',{pointerId:2,pointerType:'touch'});assert.equal(s.requests.length,0);
 await s.fire('pointermove');await s.fire('pointerup');assert.equal(s.requests.length,1);assert.deepEqual(s.requests[0].events.map(e=>e.type),['pointerdown','pointermove','pointerup']);
});
test('其他指標 cancel 不取消目前拖曳',async()=>{const s=setup();await s.fire('pointerdown');await s.fire('pointercancel',{pointerId:2});await s.fire('pointerup');assert.equal(s.requests.length,1)});
for(const action of ['pointercancel','lostpointercapture','reset','task'])test(`${action} 清理目前軌跡且可重新開始`,async()=>{
 const s=setup();await s.fire('pointerdown');await s.fire('pointermove');
 if(action==='reset')s.node('reset').handlers.click();else if(action==='task')s.node('task').handlers.change();else await s.fire(action);
 await s.fire('pointerup');assert.equal(s.requests.length,0);assert.equal(s.captures.size,0);
 await s.fire('pointerdown');await s.fire('pointerup');assert.equal(s.requests.length,1);assert.equal(s.requests[0].events.length,2);
});
test('拒絕次要按鈕開始拖曳',async()=>{const s=setup();await s.fire('pointerdown',{button:2});await s.fire('pointerup',{button:2});assert.equal(s.requests.length,0)});
test('放開次要按鈕不結束主按鈕拖曳',async()=>{const s=setup();await s.fire('pointerdown');await s.fire('pointerup',{button:2});assert.equal(s.requests.length,0);await s.fire('pointerup');assert.equal(s.requests.length,1)});
for(const pointerType of ['mouse','pen','touch'])test(`${pointerType} 收集器 → 隔離 API → 特徵分析`,async()=>{
 const s=setup();await s.fire('pointerdown',{pointerType});await s.fire('pointermove',{pointerType,clientX:400,clientY:200});await s.fire('pointerup',{pointerType});
 assert.equal(s.captures.size,0);let stored;
 const handler=createRecordHandler({storeFactory:()=>({setJSON:async(k,v)=>stored=v})});
 const res=await handler(new Request('https://test.invalid/api/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s.requests[0])}));
 assert.equal(res.status,200);const a=analyzeRecord(stored);assert.equal(a.label_source,'online_self_report_unverified');assert.equal(a.features.metrics.duration_s,0.2);assert.ok(a.features.metrics.path_length_px>0);
});
test('未同意或非法代碼不發出 API 請求',async()=>{for(const field of ['consent','pid']){const s=setup();if(field==='consent')s.node(field).checked=false;else s.node(field).value='姓名';await s.fire('pointerdown');await s.fire('pointerup');assert.equal(s.requests.length,0)}});
test('API 失敗明示未確認寫入並提醒備份',async()=>{const s=setup({fail:true});await s.fire('pointerdown');await s.fire('pointerup');assert.match(s.node('status').textContent,/尚未確認寫入/)});
