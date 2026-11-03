import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractFeatures, analyzeRecord } from './features.mjs';
const events = points => points.map(([x,y,t],i) => ({x,y,t,type: i === 0 ? 'pointerdown' : i === points.length-1 ? 'pointerup' : 'pointermove'}));
const line = () => events([[0,0,0],[3,4,1000],[6,8,2000]]);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
test('手算 3-4-5 等速直線、單位與零加速度',()=>{
 const f=extractFeatures(line(),{target:{x:9,y:12}}),m=f.metrics;
 assert.equal(m.duration_s,2);assert.equal(m.path_length_px,10);assert.equal(m.displacement_px,10);assert.equal(m.mean_speed_px_s,5);
 assert.equal(m.path_efficiency,1);assert.equal(m.endpoint_error_px,5);assert.deepEqual(m.segment_speeds_px_s,[5,5]);assert.deepEqual(m.accelerations_px_s2,[0]);assert.equal(m.pause_duration_s,0);
});
test('折返路長 10、位移及效率為零',()=>{const m=extractFeatures(events([[0,0,0],[3,4,1000],[0,0,2000]])).metrics;assert.equal(m.path_length_px,10);assert.equal(m.displacement_px,0);assert.equal(m.path_efficiency,0);});
test('靜止段、停頓閾值嚴格小於及重複比例',()=>{const m=extractFeatures(events([[0,0,0],[0,0,1000],[3,4,2000]])).metrics;assert.equal(m.pause_duration_s,1);assert.equal(m.repeated_position_ratio,.5);assert.equal(m.mean_abs_acceleration_px_s2,5);});
test('全靜止：效率 null、有效零速度與停頓一秒',()=>{const f=extractFeatures(events([[0,0,0],[0,0,1000]]));assert.equal(f.metrics.path_efficiency,null);assert.equal(f.metrics.pause_duration_s,1);assert.equal(f.metrics.mean_abs_acceleration_px_s2,null);assert.equal(f.metrics.repeated_position_ratio,1);assert.ok(f.quality.notes.length>=3);});
test('同時間移動保留路長，不將速度設成 Infinity',()=>{const f=extractFeatures(events([[0,0,0],[1,0,0],[2,0,1000]]));assert.equal(f.metrics.path_length_px,2);assert.equal(f.metrics.mean_speed_px_s,2);assert.deepEqual(f.metrics.segment_speeds_px_s,[1]);assert.equal(f.quality.zero_dt_segments,1);});
test('加速度不能跨越零時間段',()=>{const f=extractFeatures(events([[0,0,0],[1,0,1000],[2,0,1000],[4,0,2000]]));assert.equal(f.metrics.mean_abs_acceleration_px_s2,null);assert.equal(f.quality.valid_acceleration_pairs,0);});
test('不等時長：加速度依中點差，均速不是分段平均',()=>{const m=extractFeatures(events([[0,0,0],[1,0,1000],[7,0,3000]])).metrics;close(m.mean_speed_px_s,7/3);close(m.accelerations_px_s2[0],4/3);});
test('改變停頓閾值有輸出參數，不改原始資料',()=>{const e=line(),before=structuredClone(e);const f=extractFeatures(e,{pauseThresholdPxS:6});assert.equal(f.metrics.pause_duration_s,2);assert.equal(f.parameters.pause_threshold_px_s,6);assert.deepEqual(e,before);});
test('平移與時間偏移不改速度、效率；縮放依比例',()=>{const a=extractFeatures(line()).metrics;const b=extractFeatures(line().map(e=>({...e,x:2*e.x+70,y:2*e.y+280,t:e.t+5000}))).metrics;assert.equal(b.path_length_px,a.path_length_px*2);assert.equal(b.mean_speed_px_s,a.mean_speed_px_s*2);assert.equal(b.path_efficiency,a.path_efficiency);});
const invalid = [
 ['空陣列',()=>[]], ['太多事件',()=>Array(2501).fill(line()[0])], ['負時間',()=>line().map(e=>({...e,t:e.t-1}))],
 ['倒序',()=>events([[0,0,0],[1,0,2000],[2,0,1000]])], ['零時長',()=>events([[0,0,1],[1,0,1]])],
 ['超時',()=>events([[0,0,0],[1,0,180001]])], ['非有限座標',()=>line().map(e=>({...e,x:Infinity}))],
 ['字串時間',()=>line().map(e=>({...e,t:String(e.t)}))], ['內部 down',()=>line().map(e=>({...e,type:'pointerdown'}))],
 ['超大座標',()=>line().map(e=>({...e,x:1e308}))], ['空事件',()=>[null,null]],
 ];
for (const [name, make] of invalid) test(`特徵拒收 ${name}`,()=>assert.throws(()=>extractFeatures(make())));
test('非法參數及 target 拒收',()=>{for(const pauseThresholdPxS of [-1,NaN,Infinity,'5'])assert.throws(()=>extractFeatures(line(),{pauseThresholdPxS}));assert.throws(()=>extractFeatures(line(),{target:{x:NaN,y:0}}));});
test('極小時間數值溢位明確拒收',()=>assert.throws(()=>extractFeatures(events([[0,0,0],[1,0,Number.MIN_VALUE],[2,0,1000]])),/數值範圍/));
test('舊資料 sidecar 保留自報、不推斷來源、不回寫 completed',()=>{
 const r={events:line(),label:'human',completed:false},before=structuredClone(r),a=analyzeRecord(r);
 assert.equal(a.label_source,'unspecified_unverified');assert.equal(a.completed_reported,false);assert.equal(a.data_source,'unspecified');assert.equal(a.features.metrics.endpoint_error_px,null);assert.deepEqual(r,before);assert.match(a.summary_zh,/不判定真人/);
});
test('合成來源與已知自報來源均原樣保留',()=>{for(const source of ['synthetic_demo','online_self_report_unverified']){const a=analyzeRecord({events:line(),source,label_source:source,label:'human'});assert.equal(a.data_source,source);assert.equal(a.label_source,source);}});
test('CLI：備份及匯出格式、逐筆失敗、保護輸入及禁止覆寫',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mousedragger-features-'));
 try{
  const input=join(dir,'input.json'),out=join(dir,'out.json'),out2=join(dir,'out2.json');
  const original=JSON.stringify([{events:line(),source:'synthetic_demo'},{events:[]}]);await writeFile(input,original);
  const run=(...args)=>spawnSync(process.execPath,['analyze.mjs',...args],{cwd:import.meta.dirname,encoding:'utf8'});
  assert.equal(run(input,out).status,2);const report=JSON.parse(await readFile(out));assert.equal(report.total,2);assert.equal(report.failed,1);assert.equal(report.results[0].data_source,'synthetic_demo');assert.equal(await readFile(input,'utf8'),original);
  assert.equal(run(input,out).status,1);assert.equal(run(input,input).status,1);
  await writeFile(input,JSON.stringify({records:[{events:line()}]}));assert.equal(run(input,out2).status,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
