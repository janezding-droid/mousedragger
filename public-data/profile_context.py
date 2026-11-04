"""Three bounded external Avro context scales, two fresh processes each."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
from audit_context import run
from profile_pipeline import peak_kib


def profile(source, output, worker=None):
    if worker is not None:
        start=time.perf_counter();run(source,output,worker)
        result={'wall_seconds':time.perf_counter()-start,'process_peak_kib':peak_kib()}
        (output/'profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8');return
    if output.exists(): raise ValueError('Clean profile directory required')
    output.mkdir(parents=True);rows=[];checks=[]
    for scale in (1000,10000,100000):
        hashes=[]
        for repeat in (0,1):
            out=output/f'{scale}-{repeat}';start=time.perf_counter()
            subprocess.run([sys.executable,__file__,str(source),str(out),'--worker',str(scale)],check=True)
            result=json.loads((out/'context.json').read_text());metrics=json.loads((out/'profile.json').read_text())
            hashes.append(hashlib.sha256((out/'context.json').read_bytes()).hexdigest())
            rows.append({'record_limit':scale,'records_read':result['records_read'],'events':result['events'],
                         'repeat':repeat,'end_to_end_seconds':time.perf_counter()-start,**metrics,
                         'cache':'OS cache uncontrolled; fresh process, not cold-cache',
                         'scope':'streaming context+source hash+second reread; NOT summary construction'})
        checks.append({'scale':scale,'context_sha256':hashes,'byte_identical':hashes[0]==hashes[1]})
    if not all(c['byte_identical'] for c in checks):raise ValueError('Reproduction differs')
    with (output/'performance.csv').open('w',newline='',encoding='utf-8') as f:
        writer=csv.DictWriter(f,fieldnames=rows[0]);writer.writeheader();writer.writerows(rows)
    (output/'reproduction.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
    (output/'environment.json').write_text(json.dumps({'python':sys.version,'platform':platform.platform(),
         'source_bytes':source.stat().st_size,'measurement':'OS process peak working set; includes interpreter/imports. No child processes in worker.'},indent=2),encoding='utf-8')


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('--worker',type=int)
    a=p.parse_args();profile(a.source,a.output,a.worker)
