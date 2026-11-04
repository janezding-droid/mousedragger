"""Independently replay selected development case paths from original CSV rows."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def run(cases_file,fragments_file,raw,out):
    if out.exists(): raise ValueError('New output directory required')
    cases=json.loads(cases_file.read_text(encoding='utf-8'));cases=cases['success']+cases['failure']
    targets={c['id']:c for c in cases};found={}
    with fragments_file.open(encoding='utf-8') as stream:
        for line in stream:
            f=json.loads(line);key=f"{f['source']}:{f['source_rows'][0]}-{f['source_rows'][-1]}"
            if key in targets:found[key]=f
    assert set(found)==set(targets)
    out.mkdir(parents=True);fig,axes=plt.subplots(2,3,figsize=(12,7),layout='constrained');audits=[]
    length=lambda p:sum(math.hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(p,p[1:]))
    for ax,(key,c) in zip(axes.flat,targets.items(),strict=True):
        f=found[key];source=raw/f['source'];data=source.read_bytes()
        with source.open(encoding='utf-8',newline='') as stream:rows=list(csv.DictReader(stream))
        selected=[rows[i-2] for i in f['source_rows']];points=[(float(r['x']),float(r['y'])) for r in selected]
        assert len(points)==len(f['events'])==c['events'];origin=float(selected[0]['record timestamp'])
        assert selected[0]['state']=='Pressed' and selected[-1]['state']=='Released'
        for r,p,e in zip(selected,points,f['events'],strict=True):
            assert p==(e['x'],e['y'])
            assert math.isclose((float(r['record timestamp'])-origin)*1000,e['t'],abs_tol=1e-8)
        down=[p for i,p in enumerate(points) if i==0 or i==len(points)-1 or i%2==0]
        delta=length(down)-length(points)
        assert math.isclose(delta,c['path_delta_px'],abs_tol=1e-8)
        assert math.isclose(length(points),c['path_length_px'],rel_tol=1e-12,abs_tol=1e-8)
        ax.plot(*zip(*points),color='#386c9b',marker='.',markersize=3,label='Original raw rows')
        ax.plot(*zip(*down),color='#c35d31',linestyle='--',marker='x',markersize=3,label='Downsampled')
        ax.set_aspect('equal',adjustable='datalim');ax.invert_yaxis();ax.set_title(f"{'Stable' if abs(delta)<1e-8 else 'Distortion'}: {delta:.3f} px\n{f['source'].split('/')[1]}, rows {c['rows'][0]}-{c['rows'][1]}",fontsize=9)
        ax.set_xlabel('x (pixels)');ax.set_ylabel('y (pixels)')
        audits.append({'id':key,'source_sha256':hashlib.sha256(data).hexdigest(),'source_rows':f['source_rows'],'events':len(points),'original_path_px':length(points),'downsampled_path_px':length(down),'path_delta_px':delta,'raw_coordinate_time_verified':True,'classification_success':None})
    axes.flat[0].legend(fontsize=7);fig.suptitle('External development cases: stable path vs downsampling loss\nExploratory selection; no detection or attack labels',fontsize=12)
    fig.savefig(out/'case-replay.png',dpi=140);plt.close(fig)
    (out/'case-audit.json').write_text(json.dumps({'cases':audits,'scope':'six previously selected unquarantined training fragments; independently reread raw CSV; no reserved/test or proxy rescoring','limitation':'static trajectory replay; animated web integration pending; stable metric does not prove preserved intent'},indent=2),encoding='utf-8')


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cases',type=Path);p.add_argument('fragments',type=Path);p.add_argument('raw',type=Path);p.add_argument('output',type=Path);a=p.parse_args();run(a.cases,a.fragments,a.raw,a.output)
