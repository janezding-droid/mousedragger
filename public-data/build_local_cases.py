"""Create a LOCAL-ONLY case player; never publish the derived coordinates."""
import argparse,csv,hashlib,json,math,shutil
from pathlib import Path

def build(evidence,raw,out):
    if out.exists(): raise ValueError('New output directory required')
    cases=json.loads((evidence/'balabit-run02/cases.json').read_text('utf-8'))
    audit=json.loads((evidence/'balabit-run04/case-audit.json').read_text('utf-8'))
    prior={c['id']:c for c in audit['cases']}; result=[]
    length=lambda es:sum(math.hypot(b['x']-a['x'],b['y']-a['y']) for a,b in zip(es,es[1:]))
    for category in ('success','failure'):
        for c in cases[category]:
            a=prior[c['id']]; src=(raw/c['source']).resolve()
            if not src.is_relative_to(raw.resolve()): raise ValueError('Source escapes raw root')
            digest=hashlib.sha256(src.read_bytes()).hexdigest()
            if digest!=a['source_sha256']: raise ValueError('Source hash changed')
            with src.open(encoding='utf-8',newline='') as f: rows=list(csv.DictReader(f))
            chosen=[rows[i-2] for i in a['source_rows']]; origin=float(chosen[0]['record timestamp'])
            events=[{'x':float(r['x']),'y':float(r['y']),'t':(float(r['record timestamp'])-origin)*1000,'row':i,'state':r['state']} for r,i in zip(chosen,a['source_rows'],strict=True)]
            assert chosen[0]['state']=='Pressed' and chosen[-1]['state']=='Released'
            assert len(events)==c['events'] and all(e['t']>=0 for e in events)
            assert all(b['t']>=a['t'] for a,b in zip(events,events[1:]))
            down=[e for i,e in enumerate(events) if i==0 or i==len(events)-1 or i%2==0]
            for value,expected in [(length(events),c['path_length_px']),(length(down)-length(events),c['path_delta_px'])]:
                assert math.isclose(value,expected,abs_tol=1e-8)
            result.append({**c,'category':category,'source_sha256':digest,'events':events,'original_path_px':length(events),'downsampled_path_px':length(down)})
    graph=json.loads((evidence/'site-candidate/data.json').read_text('utf-8'))['graph']
    out.mkdir(parents=True)
    shutil.copyfile(Path(__file__).parent/'site/local-cases.html',out/'index.html')
    (out/'cases.json').write_text(json.dumps({'version':1,'local_only':True,'cases':result,'graph':graph},ensure_ascii=False,indent=2),'utf-8')
    return {'cases':len(result),'points':sum(len(c['events']) for c in result),'contains_local_coordinates':True,'graph_events':len(graph['events']),'source_hashes':sorted({c['source_sha256'] for c in result})}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('evidence',type=Path);p.add_argument('raw',type=Path);p.add_argument('output',type=Path);a=p.parse_args();print(json.dumps(build(a.evidence,a.raw,a.output)))
