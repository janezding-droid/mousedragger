"""Exploratory known-owner verification proxy. Never reads official test labels."""
import argparse, csv, hashlib, json, platform
from pathlib import Path
import numpy as np

GROUPS = {'speed':['mean_speed_px_s','max_segment_speed_px_s','mean_abs_acceleration_px_s2'],
          'pause':['pause_duration_s','repeated_position_ratio'],
          'geometry':['path_length_px','displacement_px','path_efficiency']}
FEATURES = sum(GROUPS.values(), [])
HOLDOUT = {'user35','user7','user9'}

def metrics(y, score, threshold, weights=None):
    y=np.asarray(y); score=np.asarray(score); w=np.ones(len(y)) if weights is None else np.asarray(weights)
    pos=w[y==1].sum(); neg=w[y==0].sum()
    if pos==0 or neg==0: raise ValueError('Both weighted classes required')
    ps=score[y==1,None]; ns=score[y==0][None,:]
    auc=np.sum(w[y==1,None]*w[y==0][None,:]*((ps>ns)+.5*(ps==ns)))/(pos*neg)
    ap=0.; previous=0.
    for t in sorted(set(score),reverse=True):
        selected=score>=t; tp=w[selected & (y==1)].sum(); fp=w[selected & (y==0)].sum()
        if tp+fp==0: continue
        recall=tp/pos; ap+=(recall-previous)*tp/(tp+fp); previous=recall
    return dict(roc_auc=float(auc),pr_ap=float(ap),fpr=float(w[(y==0)&(score>threshold)].sum()/neg),fnr=float(w[(y==1)&(score<=threshold)].sum()/pos))

def read_sessions(fragments, manifest):
    sessions={s['session']:s for s in manifest['sessions']}
    if len(sessions)!=len(manifest['sessions']): raise ValueError('Duplicate sessions')
    excluded={q['id'] for q in manifest['quarantined']}; buckets={s:[] for s in sessions}; seen=set(); ends={}
    with fragments.open(encoding='utf-8') as f:
        for line in f:
            item=json.loads(line); source=item['source']; s=sessions[source]
            first,last=item['source_rows'][0],item['source_rows'][-1]; fid=f'{source}:{first}-{last}'
            if fid in seen or first<=ends.get(source,0) or last<=first: raise ValueError('Overlapping source intervals')
            if item['split']!=s['split'] or s['source_operator']!=s['user']: raise ValueError('Source identity/split mismatch')
            seen.add(fid); ends[source]=last
            if fid in excluded or s['user'] in HOLDOUT: continue
            buckets[source].append(item['metrics'])
    result=[]
    for source,s in sessions.items():
        if s['user'] in HOLDOUT: continue
        rows=buckets[source]
        if len(rows)!=s['retained_fragments'] or not rows: raise ValueError('Retention count mismatch/empty session')
        vals=[]; missing=[]
        for k in FEATURES:
            a=[r[k] for r in rows if r[k] is not None and np.isfinite(r[k])]
            vals.append(float(np.median(a)) if a else float('nan')); missing.append(len(rows)-len(a))
        result.append(dict(session=source,user=s['user'],split=s['split'],n=len(rows),values=vals,missing=missing))
    return result

def write_csv(path, rows):
    with path.open('w',encoding='utf-8',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)

def run(fragments, manifest_path, output):
    if output.exists(): raise ValueError('Output must be a clean new directory')
    manifest=json.loads(manifest_path.read_text(encoding='utf-8')); sessions=read_sessions(fragments,manifest)
    users=sorted({s['user'] for s in sessions}); train=[s for s in sessions if s['split']=='train']
    if any(sum(s['user']==u for s in train)!=2 for u in users): raise ValueError('Need two train sessions per user')
    if any(sum(s['user']==u and s['split']==split for s in sessions)!=1 for u in users for split in ('validation','reserved')): raise ValueError('Need one validation/reserved session per user')
    raw=np.array([s['values'] for s in train]); impute=np.nanmedian(raw,axis=0)
    if not np.isfinite(impute).all(): raise ValueError('Undefined training feature')
    raw=np.where(np.isfinite(raw),raw,impute); center=np.median(raw,axis=0); scale=np.subtract(*np.percentile(raw,[75,25],axis=0));scale[scale==0]=1
    def transform(s):
        a=np.array(s['values']);return (np.where(np.isfinite(a),a,impute)-center)/scale
    prototype={u:np.median([transform(s) for s in train if s['user']==u],axis=0) for u in users}
    def pairs(split):
        x=[];rows=[]
        for s in sessions:
            if s['split']!=split: continue
            for claimed in users:
                x.append(abs(transform(s)-prototype[claimed]));rows.append(dict(source_session=s['session'],source_user=s['user'],claimed_user=claimed,split=split,positive=int(s['user']!=claimed)))
        return np.array(x),rows,np.array([r['positive'] for r in rows])
    tx,tr,ty=pairs('train'); vx,vr,vy=pairs('validation')
    configs={'full':FEATURES,**{f'only_{k}':v for k,v in GROUPS.items()},**{f'without_{k}':[x for x in FEATURES if x not in v] for k,v in GROUPS.items()}}
    models=[]; fitted=[]; validation_predictions=[]
    for config,fields in configs.items():
        indices=[FEATURES.index(k) for k in fields]
        design=np.column_stack([np.ones(len(tx)),tx[:,indices]]); penalty=np.eye(design.shape[1]);penalty[0,0]=0
        beta=np.linalg.solve(design.T@design+penalty,design.T@ty)
        for method in ('distance','ridge'):
            def score(x,method=method,indices=indices,beta=beta):
                return np.mean(x[:,indices]**2,axis=1) if method=='distance' else np.column_stack([np.ones(len(x)),x[:,indices]])@beta
            threshold=float(max(score(vx)[vy==0]));models.append((config,method,score,threshold))
            fitted.append(dict(config=config,method=method,features=fields,threshold=threshold,ridge_beta=beta.tolist() if method=='ridge' else None))
            for r,v in zip(vr,score(vx)): validation_predictions.append(dict(**r,config=config,method=method,score=float(v),threshold=threshold))
    # Reserved feature values are first transformed/scored after every model and threshold is frozen.
    rx,rr,ry=pairs('reserved'); predictions=[]; results=[]; intervals=[]
    rng=np.random.default_rng(20261104); draws=rng.integers(0,len(users),size=(2000,len(users)))
    weights=[np.array([np.count_nonzero(draw==users.index(r['source_user'])) for r in rr]) for draw in draws]
    for config,method,score,threshold in models+[('full','chance',lambda x:np.zeros(len(x)),0.)]:
        values=score(rx); m=metrics(ry,values,threshold)
        results.append(dict(task='constructed_known_owner_proxy',config=config,method=method,n_source_sessions=len(users),n_pairs=len(rr),positive_prevalence=float(ry.mean()),threshold=threshold,**m))
        for r,v in zip(rr,values): predictions.append(dict(**r,config=config,method=method,score=float(v),threshold=threshold,predicted_positive=int(v>threshold)))
        samples=[metrics(ry,values,threshold,w) for w in weights]
        for k in m:
            lo,hi=np.percentile([s[k] for s in samples],[2.5,97.5]); intervals.append(dict(config=config,method=method,metric=k,estimate=m[k],lower95=float(lo),upper95=float(hi),unit='source_user_cluster',clusters=len(users),resamples=2000))
    output.mkdir(parents=True)
    write_csv(output/'benchmark-results.csv',[r for r in results if r['config']=='full']);write_csv(output/'ablation-results.csv',results)
    write_csv(output/'predictions.csv',predictions); write_csv(output/'uncertainty.csv',intervals)
    write_csv(output/'validation-predictions.csv',validation_predictions)
    (output/'fitted-models.json').write_text(json.dumps(dict(feature_order=FEATURES,imputation=impute.tolist(),center=center.tolist(),scale=scale.tolist(),prototypes={u:v.tolist() for u,v in prototype.items()},models=fitted),indent=2),encoding='utf-8')
    write_csv(output/'session-features.csv',[dict(session=s['session'],user=s['user'],split=s['split'],fragments=s['n'],**dict(zip(FEATURES,s['values'])),missing_feature_values=sum(s['missing'])) for s in sessions])
    meta=dict(task='constructed_known_owner_proxy_NOT_official_impersonation',users=users,excluded_holdout=sorted(HOLDOUT),source_sessions=len(sessions),features=FEATURES,seed=20261104,numpy=np.__version__,python=platform.python_version(),official_test_opened=False,
              source_hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (fragments,manifest_path,Path(__file__).with_name('benchmark-protocol-v3.md'),Path(__file__))},
              limitations=['7 genuine validation sessions cannot calibrate 5% FPR','only 7 source clusters; claimed account and training uncertainty not covered','training genuine prototypes include themselves','conservative quarantine changes population','not unseen-user generalization or official attack scores'])
    (output/'run-metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'sessions':len(sessions),'users':len(users),'models':len(models),'result_rows':len(results)}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('fragments',type=Path);p.add_argument('manifest',type=Path);p.add_argument('output',type=Path);a=p.parse_args();run(a.fragments,a.manifest,a.output)
