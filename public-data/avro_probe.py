"""Bounded, ordinal-traceable CDM20 Avro shard baseline; no attack labels."""
import argparse
from collections import Counter
import gzip
import hashlib
import itertools
import json
from pathlib import Path
import time
import fastavro
from darpa import summarize, verify


def canonical(value):
    if isinstance(value, bytes): return {'fixed_bytes_hex': value.hex()}
    if isinstance(value, dict): return {k: canonical(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [canonical(v) for v in value]
    return value


def identity(value):
    if value is None: return None
    if isinstance(value, tuple) and len(value)==2 and value[0]=='com.bbn.tc.schema.avro.cdm20.UUID':
        value=value[1]
    if not isinstance(value, bytes) or len(value) != 16:
        raise ValueError('Expected schema fixed UUID of exactly16 bytes')
    return 'cdm20-fixed16:' + value.hex()


def normalize(record, ordinal, source, source_sha):
    kind, body = record['datum']
    if kind != 'com.bbn.tc.schema.avro.cdm20.Event': return None
    timestamp = body['timestampNanos']
    if type(timestamp) is not int or timestamp < 0: raise ValueError('Invalid nanosecond integer')
    event = {k: identity(body.get(k)) for k in ('uuid', 'subject', 'predicateObject', 'predicateObject2')}
    # CDM20 host is on the enclosing datum, unlike the CDM18 JSON adapter.
    event.update(hostId=identity(record['hostId']), type=body['type'], timestampNanos=timestamp,
                 source=source, source_row=ordinal, ref=f'{source}:avro-record:{ordinal}',
                 source_sha256=source_sha, truth='unknown')
    if not event['uuid'] or not event['hostId']: raise ValueError('Missing UUID or host')
    event['decoded_record_sha256'] = hashlib.sha256(json.dumps(canonical(record), sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    # summarize byte_exact is deliberately NOT used: canonical decoded bytes != raw Avro bytes.
    return event


def selected(source, limit):
    with gzip.open(source, 'rb') as stream:
        reader = fastavro.reader(stream, return_record_name=True)
        if reader.writer_schema.get('name') != 'com.bbn.tc.schema.avro.cdm20.TCCDMDatum':
            raise ValueError('Only verified embedded CDM20 schema supported')
        yield from enumerate(itertools.islice(reader, limit), 1)


def verify_avro(events, source, limit, source_sha):
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_sha, 'Source shard changed'
    expected = {e['source_row']: e for e in events}
    assert len(expected) == len(events)
    checked = set()
    for ordinal, record in selected(source, limit):
        actual=normalize(record, ordinal, source.name, source_sha)
        if actual is not None:
            assert ordinal in expected, 'Source event omitted'
            assert actual == expected[ordinal], 'Decoded source mismatch'
            checked.add(ordinal)
    assert checked == set(expected), 'Missing occurrence'
    return True


def run(source, output, limit=10000):
    if not 1 <= limit <= 100000: raise ValueError('Record bound must be1..100000')
    if output.exists(): raise ValueError('New clean output required')
    output.mkdir(parents=True)
    started=time.perf_counter(); source_sha=hashlib.sha256(source.read_bytes()).hexdigest()
    events=[]; kinds=Counter(); records=0
    for ordinal, record in selected(source, limit):
        records=ordinal; kinds[record['datum'][0]]+=1
        event=normalize(record,ordinal,source.name,source_sha)
        if event: events.append(event)
    verify_avro(events,source,limit,source_sha)
    write=lambda name,data:(output/name).write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
    comparisons=[]
    for name,bucket,mode in [('raw',None,'raw'),('argument_exact',None,'argument'),('bucket_1s',10**9,'argument'),('bucket_10s',10**10,'argument')]:
        summary=summarize(events,bucket,mode);verify(summary,events,mode=mode,bucket_ns=bucket);write(name+'.json',summary)
        comparisons.append({'method':name,'items':len(summary),'reduction':1-len(summary)/len(events) if events else None,'source_ordinal_verified':True,'attack_retention':None})
    write('normalized-events.json',events)
    write('incidence-edges.json',[{'event_ref':e['ref'],'role':k,'entity_uuid':e[k],'hostId':e['hostId']} for e in events for k in ('subject','predicateObject','predicateObject2') if e[k] is not None])
    result={'scope':'first bounded records of one official E5 terminal shard, acquisition feasibility; NOT selected attack or complete host/time background',
            'source':source.name,'source_sha256':source_sha,'source_bytes':source.stat().st_size,'record_limit':limit,'records_read':records,'kinds':dict(kinds),
            'events':len(events),'comparisons':comparisons,'attack_truth':'unknown; no truth report mapping yet',
            'time_unit':'integer nanoseconds as embedded CDM20 schema; no wall-clock timezone inference',
            'entity_encoding':'cdm20-fixed16:hex, byte identity preserved, no assumed UUID endianness',
            'source_verification':'reread compressed shard, SHA256 and Avro ordinal/canonical decoded record comparison; not a byte offset',
            'seconds_including_verification':time.perf_counter()-started,'fastavro':fastavro.__version__}
    write('result.json',result);print(json.dumps(result))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('--limit',type=int,default=10000);a=p.parse_args();run(a.source,a.output,a.limit)
