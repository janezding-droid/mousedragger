"""Exploratory E5 grouping sensitivity and full-pipeline fresh-process profiling.

No attack labels, coordinate transforms, or byte-exact Avro deduplication claim.
"""
import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import platform
import random
import subprocess
import sys
import time
from avro_probe import selected, normalize, verify_avro, run as pipeline
from darpa import summarize, verify
from profile_pipeline import peak_kib

SEED = 20261104
VARIANTS = ('original', 'every_second', 'missing_1pct', 'jitter_1ms', 'time_scale_2')


def derive(events, variant):
    if variant not in VARIANTS: raise ValueError('Unknown variant')
    rng = random.Random(SEED)
    anchor = min((e['timestampNanos'] for e in events), default=0)
    result = []
    for index, event in enumerate(events):
        keep = index % 2 == 0 if variant == 'every_second' else rng.random() >= .01 if variant == 'missing_1pct' else True
        if not keep: continue
        item = dict(event)
        if variant == 'jitter_1ms': item['timestampNanos'] = max(0, event['timestampNanos'] + rng.randint(-1000000, 1000000))
        if variant == 'time_scale_2': item['timestampNanos'] = anchor + 2 * (event['timestampNanos'] - anchor)
        result.append(item)
    return result


def pair_changes(original, derived):
    """Pair grouping changes conditional on surviving occurrences, not truth accuracy."""
    baseline = {r: i for i, g in enumerate(original) for r in g['refs']}
    changed = {r: i for i, g in enumerate(derived) for r in g['refs']}
    assert set(changed) <= set(baseline)
    choose = lambda values: sum(v*(v-1)//2 for v in values)
    base_pairs = choose(Counter(baseline[r] for r in changed).values())
    derived_pairs = choose(Counter(changed.values()).values())
    shared = choose(Counter((baseline[r], changed[r]) for r in changed).values())
    return {'baseline_surviving_pairs': base_pairs, 'derived_pairs': derived_pairs,
            'shared_pairs': shared, 'pair_retention': shared/base_pairs if base_pairs else None,
            'introduced_pairs': derived_pairs-shared}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')


def write_csv(path, rows):
    with path.open('w', newline='', encoding='utf-8') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)


def sensitivity(source, output, limit=10000):
    if output.exists(): raise ValueError('Clean output required')
    output.mkdir(parents=True)
    sha=hashlib.sha256(source.read_bytes()).hexdigest()
    events=[e for ordinal,r in selected(source,limit) if (e:=normalize(r,ordinal,source.name,sha)) is not None]
    verify_avro(events,source,limit,sha)
    rows=[]; checks=[]
    for bucket in (10**8, 10**9, 10**10):
        original=summarize(events,bucket)
        for variant in VARIANTS:
            derived=derive(events,variant);groups=summarize(derived,bucket);verify(groups,derived,mode='argument',bucket_ns=bucket)
            # Original timestamp/hash always stays in the source event table; derived
            # values are reproducible via manifest, never claimed as raw values.
            path=output/f'{variant}-{bucket}.json';write_json(path,groups)
            rows.append({'variant':variant,'bucket_ns':bucket,'events':len(derived),'items':len(groups),
                         'reduction':1-len(groups)/len(derived) if derived else None,
                         'summary_bytes':path.stat().st_size, **pair_changes(original,groups),
                         'attack_retention':None,'truth':'unknown'})
            checks.append({'variant':variant,'bucket_ns':bucket,'summary_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'provenance_verified':True})
    # Canonical decoded-record dedup includes UUID and every decoded field.
    # This is deliberately distinct from raw compressed/block bytes.
    dedup_events=[dict(e,raw_sha256=e['decoded_record_sha256']) for e in events]
    dedup=summarize(dedup_events,mode='byte_exact');verify(dedup,dedup_events,mode='byte_exact')
    write_json(output/'decoded-record-exact.json',dedup)
    write_json(output/'normalized-source-events.json',events)
    write_csv(output/'robustness.csv',rows)
    write_json(output/'checks.json',checks)
    write_json(output/'manifest.json',{'scope':'exploratory external E5 prefix, all truth unknown',
        'source':source.name,'source_sha256':sha,'record_limit':limit,'events':len(events),'seed':SEED,
        'variants':{'original':'unchanged','every_second':'retain zero-based even event indices',
            'missing_1pct':'Python Random(seed), independent p=.01 deletion in source order',
            'jitter_1ms':'integer uniform [-1000000,+1000000] ns, clamp at zero; source order unchanged',
            'time_scale_2':'min_timestamp+2*(timestamp-min_timestamp); system-time sensitivity, NOT mouse coordinates'},
        'buckets_ns':[10**8,10**9,10**10], 'decoded_exact_items':len(dedup),
        'decoded_exact_reduction':1-len(dedup)/len(events) if events else None,
        'decoded_exact_scope':'canonical complete decoded CDM20 record SHA256; NOT byte-exact Avro dedup',
        'source_reread':True,'limitations':'No labels, host/time holdout or attack retention. Dropped events remain traceable in source table. Jitter can change chronological order, as can the original log; no sorting or fabricated causality.'})


def profile(source, output, worker=None):
    if worker is not None:
        start=time.perf_counter();pipeline(source,output,worker)
        write_json(output/'profile.json',{'seconds':time.perf_counter()-start,'peak_kib':peak_kib()});return
    if output.exists(): raise ValueError('Clean output required')
    output.mkdir(parents=True);rows=[];checks=[]
    for scale in (1000,10000,30000):
        signatures=[]
        for repeat in (0,1):
            dest=output/f'{scale}-{repeat}';start=time.perf_counter()
            subprocess.run([sys.executable,__file__,'profile',str(source),str(dest),'--worker',str(scale)],check=True,stdout=subprocess.DEVNULL)
            result=json.loads((dest/'result.json').read_text());metrics=json.loads((dest/'profile.json').read_text())
            signatures.append({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dest.glob('*.json')) if p.name not in ('profile.json','result.json')})
            rows.append({'records':result['records_read'],'events':result['events'],'repeat':repeat,
                'end_to_end_seconds':time.perf_counter()-start,**metrics,'cache':'uncontrolled OS cache; fresh process',
                'scope':'compressed source hash+decode+independent reread+four summaries+verify+incidence graph+JSON serialization'})
        assert signatures[0]==signatures[1], 'Clean reproduction differs'
        checks.append({'records':scale,'core_files':len(signatures[0]),'byte_identical':True,'sha256':signatures[0]})
    write_csv(output/'performance.csv',rows);write_json(output/'reproduction.json',checks)
    write_json(output/'environment.json',{'python':sys.version,'platform':platform.platform(),'processor':platform.processor(),
        'source_bytes':source.stat().st_size,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'memory':'OS lifetime process peak working set, includes interpreter; worker has no subprocess. Coordinator excluded.',
        'limitations':'First and repeated passes use fresh processes; neither is guaranteed cold-cache. Bounded prefixes, no extrapolation.'})


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('mode',choices=('sensitivity','profile'));p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('--worker',type=int);a=p.parse_args()
    if a.mode=='sensitivity': sensitivity(a.source,a.output)
    else: profile(a.source,a.output,a.worker)
