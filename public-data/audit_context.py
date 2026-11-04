"""Streaming, bounded CDM20 context coverage audit. Indicator hits are NOT labels."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import time
from avro_probe import selected, identity, canonical

INDICATORS = ('35.106.122.76', '69.155.209.87', '128.55.12.118',
              '/lib/libselinux.so', 'libselinux.so', 'LD_PRELOAD')
ROLES = ('subject', 'predicateObject', 'predicateObject2')


def strings(value, path='$'):
    """Preserve exact property path; union type names are not payload strings."""
    if isinstance(value, str): yield path, value
    elif isinstance(value, dict):
        for k, v in sorted(value.items()): yield from strings(v, path+'.'+k)
    elif isinstance(value, tuple) and len(value)==2 and isinstance(value[0],str):
        yield from strings(value[1],path+'.union')
    elif isinstance(value, (list,tuple)):
        for i,v in enumerate(value): yield from strings(v,f'{path}[{i}]')


def audit(records, source, sha, limit):
    kinds=Counter(); hosts=Counter(); references=Counter(); definitions={}
    conflicts=[]; hits=[]; hit_counts=Counter(); times=[]; n=0; events=0
    field_names=Counter(); nonmonotonic=0; previous=None
    for ordinal, r in records:
        n=ordinal; kind,body=r['datum']; kinds[kind]+=1
        host=identity(r['hostId']); hosts[host]+=1
        for path,value in strings(body):
            field_names[path]+=1
            for token in INDICATORS:
                # Literal substring screening only. Not a path/address parser or truth mapping.
                if token in value:
                    hit_counts[token]+=1
                    if len(hits)<100:
                        hits.append({'source_record':ordinal,'kind':kind,'host':host,'field':path,
                                     'value':value,'indicator':token,
                                     'decoded_record_sha256':hashlib.sha256(json.dumps(canonical(r),sort_keys=True,separators=(',',':')).encode()).hexdigest()})
        if kind.endswith('.Event'):
            t=body['timestampNanos']
            if type(t) is not int or t<0: raise ValueError('Invalid timestamp')
            if previous is not None and t<previous: nonmonotonic+=1
            previous=t
            if not times: times=[t,t]
            times=[min(times[0],t),max(times[1],t)]; events+=1
            for role in ROLES:
                uid=identity(body.get(role))
                if uid: references[(host,role,uid)]+=1
        elif body.get('uuid') is not None:
            uid=identity(body['uuid']); key=(host,uid)
            if key in definitions and definitions[key]['kind']!=kind:
                conflicts.append({'host':host,'uuid':uid,'old':definitions[key],'new_kind':kind,'new_record':ordinal})
            definitions.setdefault(key,{'kind':kind,'source_record':ordinal})
    resolution=[]
    for role in ROLES:
        refs=[(h,u,c) for (h,r,u),c in references.items() if r==role]
        resolved=[(h,u,c) for h,u,c in refs if (h,u) in definitions]
        resolution.append({'role':role,'unique_host_entity_refs':len(refs),'resolved_unique':len(resolved),
                           'event_role_occurrences':sum(c for h,u,c in refs),
                           'resolved_occurrences':sum(c for h,u,c in resolved),
                           'unresolved_examples':[{'host':h,'uuid':u,'occurrences':c} for h,u,c in sorted(refs) if (h,u) not in definitions][:5]})
    return {'source':source,'source_sha256':sha,'record_limit':limit,'records_read':n,
            'bound_reached':n==limit,'scope':'bounded shard only; absent definitions may occur in other shards',
            'events':events,'kinds':dict(kinds),'hosts':dict(hosts),'event_time_range_ns':times,
            'adjacent_event_time_decreases':nonmonotonic,'definitions':len(definitions),
            'definition_kind_conflicts':conflicts,'resolution':resolution,
            'indicator_match_counts':{x:hit_counts[x] for x in INDICATORS},'indicator_examples':hits,
            'indicator_rule':'case-sensitive literal substring; at most100 examples; counts are matching fields, NOT attack events',
            'truth':'unknown; neither filename nor literal hit is host/time/attack ground truth',
            'string_field_counts':dict(field_names)}


def run(source,output,limit):
    if not 1<=limit<=1000000: raise ValueError('Limit must be1..1000000')
    if output.exists(): raise ValueError('Clean output required')
    start=time.perf_counter();sha=hashlib.sha256(source.read_bytes()).hexdigest()
    result=audit(selected(source,limit),source.name,sha,limit)
    # Independent re-read of compressed input. Every saved example hash and property path
    # is reconstructed, as are aggregate coverage and all misses. Does not establish truth.
    check=audit(selected(source,limit),source.name,sha,limit)
    if result!=check or hashlib.sha256(source.read_bytes()).hexdigest()!=sha:
        raise ValueError('Source reread differs')
    output.mkdir(parents=True);(output/'context.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    (output/'runtime.json').write_text(json.dumps({'seconds_two_reads':time.perf_counter()-start,'verified_second_read':True},indent=2),encoding='utf-8')
    print(json.dumps({k:result[k] for k in ('records_read','events','definitions','event_time_range_ns','indicator_match_counts')}))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('--limit',type=int,default=100000)
    a=p.parse_args();run(a.source,a.output,a.limit)
