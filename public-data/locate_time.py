"""Bounded source-order time index and Host definitions; never assigns truth."""
import argparse
import hashlib
import json
from pathlib import Path
from avro_probe import selected, canonical, identity


def scan(source, limit):
    bins=[];hosts=[];lo=hi=None;count=0;records=0
    for ordinal,record in selected(source,limit):
        records=ordinal;kind,body=record['datum']
        if kind.endswith('.Host'):
            hosts.append({'ordinal':ordinal,'hostId':identity(record['hostId']),
                          'decoded_record':canonical(record)})
        if kind.endswith('.Event'):
            t=body['timestampNanos'];assert type(t) is int and t>=0
            lo=t if lo is None else min(lo,t);hi=t if hi is None else max(hi,t);count+=1
        if ordinal%1000000==0:
            bins.append({'ending_ordinal':ordinal,'events':count,'min_ns':lo,'max_ns':hi});lo=hi=None;count=0
    if count:bins.append({'ending_ordinal':records,'events':count,'min_ns':lo,'max_ns':hi})
    return {'records_read':records,'record_limit':limit,'bound_reached':records==limit,
            'million_record_bins':bins,'host_definitions':hosts,'truth':'unknown',
            'scope':'bounded time index; no assumption of chronology across shards or narrative timezone'}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('--limit',type=int,default=5000000);a=p.parse_args()
    if not 1<=a.limit<=5000000:raise ValueError('Limit must be1..5000000')
    if a.output.exists():raise ValueError('Clean file required')
    sha=hashlib.sha256(a.source.read_bytes()).hexdigest();r=scan(a.source,a.limit)
    assert r==scan(a.source,a.limit),'Independent compressed reread differs'
    assert sha==hashlib.sha256(a.source.read_bytes()).hexdigest()
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps({'source':a.source.name,'source_sha256':sha,'independent_reread':True,**r},indent=2)+'\n',encoding='utf-8')
