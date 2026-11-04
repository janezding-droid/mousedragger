"""Bounded web derivative. Verify all summary occurrences against original Avro first."""
import json
from avro_probe import verify_avro
from darpa import verify

def bounded_group(summary,events):
    verify(summary,events)
    candidates=[s for s in summary if 2<=s['count']<=20]
    if not candidates: raise ValueError('No bounded multi-occurrence group')
    item=candidates[0] # source insertion order; no label or performance selection
    by_ref={e['ref']:e for e in events}
    members=[by_ref[r] for r in item['refs']]
    out=json.loads(json.dumps({'summary':item,'events':members}))
    for k in ('min_timestampNanos','max_timestampNanos'):out['summary'][k]=str(out['summary'][k])
    for e in out['events']:e['timestampNanos']=str(e['timestampNanos'])
    out['selection']='First 1-second argument group with 2..20 occurrences in source insertion order; truth unknown'
    out['edge_semantics']='event argument incidence only; no causal/information-flow direction'
    return out

def extract(probe,source):
    read=lambda n:json.loads((probe/n).read_text('utf-8'))
    result=read('result.json');events=read('normalized-events.json');summary=read('bucket_1s.json')
    verify_avro(events,source,result['record_limit'],result['source_sha256'])
    out=bounded_group(summary,events)
    out['verification']='Full prefix reread from SHA256-matched original gzip; all summary occurrences verified before bounded export'
    out['source_sha256']=result['source_sha256']
    return out
