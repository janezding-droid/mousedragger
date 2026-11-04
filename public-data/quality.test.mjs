import test from 'node:test';
import assert from 'node:assert/strict';
import { nearKey,perturb } from './quality.mjs';
import { run } from './quality.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractFeatures } from '../features.mjs';
const events=[{x:0,y:0,t:0,type:'pointerdown'},{x:3,y:4,t:10,type:'pointermove'},{x:0,y:0,t:20,type:'pointermove'},{x:6,y:8,t:30,type:'pointerup'}];
test('quarantine removes every cross-split occurrence and preserves source session split',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mouse-quality-'));
  try {
    const input=path.join(root,'input'),output=path.join(root,'output');fs.mkdirSync(input);
    const fragments=['train','validation'].map((split,i)=>({source:`session${i}`,source_rows:[2,3,4,5],events,split,fingerprint:'same',metrics:extractFeatures(events).metrics,quality:extractFeatures(events).quality}));
    fs.writeFileSync(path.join(input,'fragments.jsonl'),fragments.map(JSON.stringify).join('\n'));
    fs.writeFileSync(path.join(input,'split-manifest.json'),JSON.stringify({sessions:fragments.map(f=>({session:f.source,split:f.split,user:'owner'}))}));
    run(input,output);
    const result=JSON.parse(fs.readFileSync(path.join(output,'leakage-audit.json')));
    assert.equal(result.quarantined_fragments,2);assert.equal(result.retained_fragments,0);
    assert.deepEqual(result.post_quarantine_cross_split_groups,[0,0]);
    assert.throws(()=>run(input,output));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('near-candidate key is invariant to translation, positive scale and duration, sensitive to bends',()=>{
  assert.equal(nearKey(events),nearKey(events.map(e=>({...e,x:e.x*2+100,y:e.y*2-50,t:e.t*3}))));
  assert.notEqual(nearKey(events),nearKey(events.map((e,i)=>({...e,x:i===1?20:e.x}))));
});
test('perturbations keep original endpoints, order, identity, deterministic seed and valid canonical inputs',()=>{
  for(const v of ['original','downsample2','missing5','jitter5ms','scale0.5','scale2']) {
    const result=perturb(events,v);assert.deepEqual(result,perturb(events,v));assert.equal(result[0].t,0);assert.equal(result.at(-1).t,30);extractFeatures(result);
  }
  assert.equal(events[1].t,10);
});
test('scaling laws and foldback downsampling expose feature sensitivity',()=>{
  const base=extractFeatures(events).metrics, scaled=extractFeatures(perturb(events,'scale2')).metrics;
  assert.equal(scaled.path_length_px,base.path_length_px*2);assert.equal(scaled.path_efficiency,base.path_efficiency);
  assert.ok(extractFeatures(perturb(events,'downsample2')).metrics.path_length_px<base.path_length_px);
  assert.throws(()=>extractFeatures(events.map((e,i)=>({...e,t:i===1?-1:e.t}))));
});
