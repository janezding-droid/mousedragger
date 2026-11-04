import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { extractFeatures } from '../features.mjs';

const hash = s => createHash('sha256').update(s).digest('hex');
export const fragmentId = f => `${f.source}:${f.source_rows[0]}-${f.source_rows.at(-1)}`;
// Candidate equivalence, not proof of common operator: translation/scale/time normalized,
// 16 points at equally spaced event indices, each coordinate/time quantized to 1/50.
export function nearKey(events) {
  const a=events[0], duration=events.at(-1).t-a.t;
  const scale=Math.max(...events.flatMap(e=>[Math.abs(e.x-a.x),Math.abs(e.y-a.y)]));
  const samples=Array.from({length:16},(_,i)=>{
    const pos=i*(events.length-1)/15, j=Math.floor(pos), r=pos-j;
    const b=events[j],c=events[Math.min(j+1,events.length-1)];
    return ['x','y','t'].map(k=>Math.round(((b[k]-a[k])+r*(c[k]-b[k]))/(k==='t'?duration:scale||1)*50+1e-9));
  });
  return hash(JSON.stringify(samples));
}
function rng(seed) { let x=seed>>>0; return ()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;}; }
export function perturb(events, variant, seed=20261104) {
  const random=rng(seed); let result=events.map(e=>({...e}));
  if(variant==='downsample2') result=result.filter((e,i)=>i===0||i===result.length-1||i%2===0);
  if(variant==='missing5') result=result.filter((e,i)=>i===0||i===result.length-1||random()>=0.05);
  if(variant==='scale0.5'||variant==='scale2') {
    const k=variant==='scale2'?2:0.5; result.forEach(e=>{e.x*=k;e.y*=k;});
  }
  if(variant==='jitter5ms') {
    for(let i=1;i<result.length-1;i++) result[i].t=Math.min(events.at(-1).t,Math.max(result[i-1].t,events[i].t+(random()*2-1)*5));
  }
  return result;
}
const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return (s[Math.floor((s.length-1)/2)]+s[Math.ceil((s.length-1)/2)])/2;};
const metrics=['duration_s','path_length_px','mean_speed_px_s','path_efficiency','pause_duration_s','mean_abs_acceleration_px_s2'];
function csv(file,rows) {
  const keys=Object.keys(rows[0]??{});fs.writeFileSync(file,keys.join(',')+'\n'+rows.map(r=>keys.map(k=>JSON.stringify(r[k]??'')).join(',')).join('\n')+'\n');
}
export function run(input,output) {
  if(fs.existsSync(output)) throw new Error('Output must be a new clean directory');
  fs.mkdirSync(output,{recursive:true});
  const started=performance.now();
  const fragments=fs.readFileSync(path.join(input,'fragments.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const manifest=JSON.parse(fs.readFileSync(path.join(input,'split-manifest.json'),'utf8'));
  const sessions=new Map(manifest.sessions.map(s=>[s.session,s]));
  if(sessions.size!==manifest.sessions.length) throw new Error('Duplicate session in manifest');
  const previousEnd=new Map(),ids=new Set();
  for(const f of fragments) {
    if(sessions.get(f.source)?.split!==f.split) throw new Error('Fragment/session split mismatch');
    const start=f.source_rows[0],end=f.source_rows.at(-1),id=fragmentId(f);
    if(ids.has(id)||!Number.isInteger(start)||!Number.isInteger(end)||start>=end||start<=(previousEnd.get(f.source)??0)) throw new Error('Overlapping or invalid source windows');
    ids.add(id);previousEnd.set(f.source,end);
  }
  const maps=[new Map(),new Map()];
  for(const f of fragments) {
    f.id=fragmentId(f);f.near_key=nearKey(f.events);
    [f.fingerprint,f.near_key].forEach((k,i)=>{const a=maps[i].get(k)??[];a.push(f);maps[i].set(k,a);});
  }
  const cross=maps.map(m=>[...m].filter(([,fs])=>new Set(fs.map(f=>f.split)).size>1));
  const reasons=new Map();
  cross.forEach((groups,i)=>groups.forEach(([,fs])=>fs.forEach(f=>{const s=reasons.get(f.id)??new Set();s.add(i===0?'exact_cross_split':'normalized_candidate_cross_split');reasons.set(f.id,s);})));
  const kept=fragments.filter(f=>!reasons.has(f.id));
  const post=maps.map(m=>[...m.values()].filter(fs=>new Set(fs.filter(f=>!reasons.has(f.id)).map(f=>f.split)).size>1).length);
  if(post.some(Boolean)) throw new Error('Quarantine failed');
  const write=(name,v)=>fs.writeFileSync(path.join(output,name),JSON.stringify(v,null,2)+'\n');
  write('split-manifest.json',{...manifest,version:2,classification_evaluated:false,
    policy:'whole sessions; all occurrences of cross-split exact or normalized candidates quarantined; no overlapping windows',
    near_definition:'16 event-index-interpolated points; translation/scale/time normalized; quantization 1/50; hash equality only, boundary misses possible',
    source_operator_scope:'legal training owners only; public test operator unknown and not audited; within-user session split is not participant holdout',
    sessions:manifest.sessions.map(s=>({...s,retained_fragments:kept.filter(f=>f.source===s.session).length})),
    quarantined:[...reasons].map(([id,r])=>({id,reasons:[...r]}))});
  write('leakage-audit.json',{input_fragments:fragments.length,exact_cross_split_groups:cross[0].length,normalized_candidate_cross_split_groups:cross[1].length,
    quarantined_fragments:reasons.size,retained_fragments:kept.length,post_quarantine_cross_split_groups:post,
    whole_session_integrity:true,fragment_split_matches_source_session:true,source_row_intervals_disjoint:true,
    overlapping_windows:false,public_test_labels_opened:false,classification_ready:false,
    limitation:'Candidate quarantine is conservative and can merge unrelated clicks. No exhaustive fuzzy-neighbor guarantee; training-only operators. Participant holdout and public test source reuse still unverified.'});
  // Protocol fixed before evaluation: robustness uses development/train only; no reserved sessions.
  const rows=[], distributions=[], caseCandidates=[];
  for(const session of manifest.sessions.filter(s=>s.split==='train')) {
    const fs=kept.filter(f=>f.source===session.session);
    for(const metric of metrics) distributions.push({session:session.session,user:session.user,split:'train',metric,n:fs.filter(f=>f.metrics[metric]!==null).length,median:median(fs.map(f=>f.metrics[metric]).filter(v=>v!==null))});
    for(const variant of ['original','downsample2','scale0.5','scale2','jitter5ms','missing5','pause10','duration60']) {
      const values=Object.fromEntries(metrics.map(k=>[k,[]]));let rejected=0;
      for(const f of fs) {
        const seed=parseInt(hash(f.id).slice(0,8),16)^20261104;
        const events=perturb(f.events,variant,seed);
        try {
          if(variant==='duration60'&&f.metrics.duration_s>60){rejected++;continue;}
          const result=extractFeatures(events,{pauseThresholdPxS:variant==='pause10'?10:5});
          for(const k of metrics) if(result.metrics[k]!==null&&f.metrics[k]!==null) values[k].push(result.metrics[k]-f.metrics[k]);
          if(variant==='downsample2'&&f.events.length>2) caseCandidates.push({id:f.id,source:f.source,rows:[f.source_rows[0],f.source_rows.at(-1)],split:f.split,events:f.events.length,variant,path_delta_px:result.metrics.path_length_px-f.metrics.path_length_px,zero_dt_segments:f.quality.zero_dt_segments,path_length_px:f.metrics.path_length_px});
        } catch(e) {rejected++;}
      }
      for(const k of metrics) rows.push({session:session.session,user:session.user,variant,metric:k,eligible:fs.length,rejected,paired_defined:values[k].length,median_signed_delta:median(values[k]),median_absolute_delta:median(values[k].map(Math.abs)),max_absolute_delta:values[k].length?Math.max(...values[k].map(Math.abs)):null,changed_pairs:values[k].filter(v=>Math.abs(v)>1e-8).length});
    }
  }
  csv(path.join(output,'robustness-results.csv'),rows);csv(path.join(output,'feature-distributions.csv'),distributions);
  write('robustness-results.json',{unit:'per-session median paired feature deltas; no pooled independence or detection scores',scope:'unquarantined training sessions only',rows});
  const success=caseCandidates.filter(c=>c.path_length_px>0&&Math.abs(c.path_delta_px)<1e-8).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,3);
  const failure=caseCandidates.filter(c=>c.path_delta_px < -1e-8).sort((a,b)=>a.path_delta_px-b.path_delta_px||a.id.localeCompare(b.id)).slice(0,3);
  write('cases.json',{selection:'exploratory development cases; first 3 stable nonzero paths and 3 largest absolute path losses; not detection success/failure',success,failure});
  write('performance.json',{seconds:(performance.now()-started)/1000,peak_rss_kib:process.resourceUsage().maxRSS,node:process.version});
  console.log(JSON.stringify({input:fragments.length,quarantined:reasons.size,retained:kept.length,robustness_rows:rows.length,cases:success.length+failure.length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) run(...process.argv.slice(2));
