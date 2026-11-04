import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { convertSession } from './balabit.mjs';
const started=performance.now();
const [manifestPath, rawRoot, output] = process.argv.slice(2);
if (!output) throw new Error('Usage: node public-data/analyze.mjs selection.json raw-root output-dir');
fs.mkdirSync(output,{recursive:true});
const selection=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const summaries=[], manifest=[], fingerprints=new Map();
const out=fs.openSync(path.join(output,'fragments.jsonl'),'w');
const byUser={};
for(const entry of selection.files) (byUser[entry.path.split('/')[1]] ??= []).push(entry);
for(const [user,entries] of Object.entries(byUser)) {
  entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  for(let i=0;i<entries.length;i++) {
    const e=entries[i], buffer=fs.readFileSync(path.join(rawRoot,e.path));
    const blob=createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
    if(buffer.length!==e.size||blob!==e.sha) throw new Error(`Source mismatch: ${e.path}`);
    const split=i<2?'train':i===2?'validation':'reserved';
    const result=convertSession(buffer.toString('utf8'),e.path);
    const values=result.fragments.map(f=>f.metrics.mean_speed_px_s).sort((a,b)=>a-b);
    summaries.push({session:e.path,user,split,...result.quality,accepted_fragments:result.fragments.length,
      median_fragment_mean_speed_px_s:values.length?values[Math.floor(values.length/2)]:null,
      zero_dt_segments:result.fragments.reduce((s,f)=>s+f.quality.zero_dt_segments,0)});
    manifest.push({session:e.path,user,source_operator:user,source_operator_evidence:'official training sessions are legal owners',split,
      sha256:createHash('sha256').update(buffer).digest('hex'),fragments:result.fragments.length});
    for(const f of result.fragments) {
      fs.writeSync(out,JSON.stringify({...f,split})+'\n');
      const list=fingerprints.get(f.fingerprint)??[]; list.push({session:e.path,split,rows:[f.source_rows[0],f.source_rows.at(-1)]}); fingerprints.set(f.fingerprint,list);
    }
  }
}
fs.closeSync(out);
const duplicates=[...fingerprints].filter(([,a])=>new Set(a.map(v=>v.split)).size>1).map(([fingerprint,occurrences])=>({fingerprint,occurrences}));
const write=(name,v)=>fs.writeFileSync(path.join(output,name),JSON.stringify(v,null,2)+'\n');
write('quality-results.json',summaries);
write('split-manifest.json',{version:1,seed:20261104,classification_evaluated:false,public_test_labels_opened:false,
  policy:'whole sessions; no overlapping windows; provisional until duplicate quarantine and near-duplicate checks',sessions:manifest});
write('leakage-audit.json',{exact_cross_split_fingerprints:duplicates.length,duplicates,near_duplicate_checked:false,
  test_source_operator_checked:false,classification_ready:duplicates.length===0?'still_requires_near_duplicate_and_source_checks':false});
const cols=['session','user','split','rows','accepted_fragments','zero_dt_segments','time_reversals','median_fragment_mean_speed_px_s'];
fs.writeFileSync(path.join(output,'quality-results.csv'),cols.join(',')+'\n'+summaries.map(r=>cols.map(c=>r[c]??'').join(',')).join('\n')+'\n');
console.log(JSON.stringify({sessions:summaries.length,rows:summaries.reduce((s,r)=>s+r.rows,0),fragments:manifest.reduce((s,r)=>s+r.fragments,0),cross_split_duplicates:duplicates.length}));
write('performance.json',{processing_seconds:(performance.now()-started)/1000,peak_rss_kib:process.resourceUsage().maxRSS,node:process.version,platform:process.platform,arch:process.arch});
