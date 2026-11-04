"""Offline cross-component clean replay. Never fits models or downloads data."""
import argparse, csv, hashlib, importlib.metadata, json, platform, subprocess, sys, time
from pathlib import Path
from reproduce import run as mouse_run
from avro_probe import run as darpa_run
from profile_pipeline import peak_kib
from site_evidence import extract

SEED=20261104
SCALES={1:(1,1000),2:(2,10000),4:(4,30000)}
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
def read(p):return json.loads(p.read_text('utf-8'))
def save(p,v):p.write_text(json.dumps(v,indent=2,ensure_ascii=False)+'\n','utf-8')
def preflight(config):
    c=read(config)
    if c['seed']!=SEED: raise ValueError('Unexpected protocol seed')
    for entry in c['inputs']:
        p=Path(entry['path'])
        if p.stat().st_size!=entry['size'] or sha(p)!=entry['sha256']: raise ValueError('Input changed: '+str(p))
    for name,version in c['packages'].items():
        if importlib.metadata.version(name)!=version: raise ValueError('Dependency changed: '+name)
    node=subprocess.check_output(['node','--version'],text=True).strip()
    if node!=c['node'] or platform.python_version()!=c['python']: raise ValueError('Runtime changed')
    return c
def signatures(out):
    # Runtime metrics and full result timing are excluded explicitly.
    paths=[p for folder in ('mouse/analysis','mouse/quality','darpa') for p in (out/folder).glob('*') if p.is_file() and p.name not in ('performance.json','result.json')]
    paths+=[out/'website-data.json']
    return {str(p.relative_to(out)).replace('\\','/'):sha(p) for p in sorted(paths)}
def execute(config,out,scale):
    start=time.perf_counter();c=preflight(config)
    if out.exists():raise ValueError('Output must be a new clean path')
    out.mkdir(parents=True)
    count,limit=SCALES[scale]
    selection=read(Path(c['selection']))
    users=sorted({e['path'].split('/')[1] for e in selection['files']})
    files=[e for u in users for e in sorted((e for e in selection['files'] if e['path'].split('/')[1]==u),key=lambda e:e['path'])[:count]]
    save(out/'selection.json',{**selection,'files':files})
    stage=time.perf_counter()
    mouse_run(out/'selection.json',Path(c['raw']),out/'mouse',quality=True)
    mouse_seconds=time.perf_counter()-stage;stage=time.perf_counter()
    darpa_run(Path(c['darpa']),out/'darpa',limit)
    darpa_seconds=time.perf_counter()-stage;stage=time.perf_counter()
    d=read(out/'darpa/result.json');m=read(out/'mouse/analysis/summary.json') if (out/'mouse/analysis/summary.json').exists() else None
    # Re-read original Avro and verify all occurrences before bounded graph export.
    graph=extract(out/'darpa',Path(c['darpa']))
    data={'scope':'Fresh offline mouse/Avro outputs; unknown attack truth; no bot claim',
          'seed':SEED,'sessions':len(files),'record_limit':limit,
          'mouse_sessions':read(out/'mouse/analysis/session-manifest.json') if (out/'mouse/analysis/session-manifest.json').exists() else read(out/'mouse/analysis/split-manifest.json'),
          'mouse_validation':{k:v for k,v in read(out/'mouse/independent-validation.json').items() if not k.startswith('wall_') and k not in ('python','machine')},
          'mouse_leakage':read(out/'mouse/quality/leakage-audit.json'),
          'darpa_comparisons':d['comparisons'],'darpa_events':d['events'],'graph':graph,
          'frozen_prior_scores':{'scope':'Previously consumed night03 query; copied without refit/recalibration; not fresh evidence',
             'rows':list(csv.DictReader(Path(c['frozen_scores']).open(encoding='utf-8-sig')))},
          'source_hashes':{Path(e['path']).name:e['sha256'] for e in c['inputs'] if e['role']=='data'}}
    save(out/'website-data.json',data)
    metrics={'sessions':len(files),'source_mouse_bytes':sum(e['size'] for e in files),'darpa_records':d['records_read'],
       'darpa_events':d['events'],'mouse_fragments_checked':data['mouse_validation']['fragments_independently_checked'],
       'mouse_seconds':mouse_seconds,'darpa_seconds':darpa_seconds,'website_data_seconds':time.perf_counter()-stage,
       'complete_seconds':time.perf_counter()-start,'coordinator_peak_kib':peak_kib(),
       'analysis_node_peak_kib':read(out/'mouse/analysis/performance.json')['peak_rss_kib'],
       'quality_node_peak_kib':read(out/'mouse/quality/performance.json')['peak_rss_kib'],
       'memory_scope':'Coordinator includes Avro+CSV validator lifetime peak; Node stages separate. Plot child peak unmeasured; NOT simultaneous process-tree peak.',
       'cache':'OS cache uncontrolled; fresh processes, not cold-cache',
       'scope':'Input hashing+CSV/features+independent raw replay+quality+plots+Avro decode/summary/verification+source-verified website data; frozen scores copied, report render/UI excluded'}
    save(out/'profile.json',metrics);save(out/'core-hashes.json',signatures(out))
    return metrics
def profile(config,out):
    preflight(config)
    if out.exists():raise ValueError('Output must be a new clean path')
    out.mkdir(parents=True);rows=[];checks=[]
    for scale in SCALES:
        hashes=[]
        for repeat in (0,1):
            dest=out/f'scale-{scale}-repeat-{repeat}';started=time.perf_counter()
            with (out/f'worker-{scale}-{repeat}.log').open('w',encoding='utf-8') as log:
                subprocess.run([sys.executable,__file__,str(config),str(dest),'--scale',str(scale)],stdout=log,stderr=subprocess.STDOUT,check=True)
            rows.append({**read(dest/'profile.json'),'repeat':repeat,'end_to_end_seconds':time.perf_counter()-started})
            hashes.append(read(dest/'core-hashes.json'))
        if hashes[0]!=hashes[1]:raise ValueError('Clean replay differs at scale '+str(scale))
        checks.append({'scale':scale,'byte_identical_files':len(hashes[0]),'hashes':hashes[0]})
    with (out/'performance.csv').open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    save(out/'validation.json',{'scales':checks,'seed':SEED,'independent_raw_verification':'All emitted mouse fragments and Avro occurrences checked in every execution','comparison':'Byte exact deterministic files; excludes runtime metrics and result.json timing; no numerical relaxation','limitations':rows[0]['memory_scope']})
    save(out/'environment.json',{'platform':platform.platform(),'processor':platform.processor(),'config_sha256':sha(config),'configuration':read(config),'scope':rows[0]['scope']})
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('config',type=Path);p.add_argument('output',type=Path);p.add_argument('--scale',type=int,choices=SCALES,default=4);p.add_argument('--profile',action='store_true');a=p.parse_args()
    (profile if a.profile else lambda c,o:execute(c,o,a.scale))(a.config.resolve(),a.output.resolve())
