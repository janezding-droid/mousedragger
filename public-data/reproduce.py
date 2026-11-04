"""Offline clean-output reproduction and independent raw-event validation."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import platform
import subprocess
import time


def verify_fragments(result, raw):
    cache = {}
    checked = 0
    with (result/'fragments.jsonl').open(encoding='utf-8') as stream:
        for line in stream:
            fragment = json.loads(line)
            source = fragment['source']
            if source not in cache:
                with (raw/source).open(encoding='utf-8',newline='') as f:
                    cache[source] = list(csv.DictReader(f))
            rows = [cache[source][number-2] for number in fragment['source_rows']]
            events = fragment['events']
            assert rows[0]['state']=='Pressed' and rows[-1]['state']=='Released'
            assert rows[0]['button']==rows[-1]['button']==fragment['button']
            origin=float(rows[0]['record timestamp'])
            for row,event in zip(rows,events,strict=True):
                assert float(row['x'])==event['x'] and float(row['y'])==event['y']
                assert math.isclose((float(row['record timestamp'])-origin)*1000,event['t'],abs_tol=1e-8)
            distance=sum(math.hypot(float(b['x'])-float(a['x']),float(b['y'])-float(a['y'])) for a,b in zip(rows,rows[1:]))
            assert math.isclose(distance,fragment['metrics']['path_length_px'],rel_tol=1e-12,abs_tol=1e-8)
            assert fragment['target'] is None and fragment['consent'] is None
            checked += 1
    return {'fragments_independently_checked':checked,'checks':'raw rows, endpoints, button, coordinates, seconds-to-ms, independently summed path, absent target/consent','numeric_relative_tolerance':1e-12,'numeric_absolute_tolerance':1e-8}


def run(manifest, raw, output, measure=False):
    if output.exists(): raise ValueError('Output must be a new clean directory')
    output.mkdir(parents=True)
    script=Path(__file__).with_name('analyze.mjs')
    start=time.perf_counter()
    subprocess.run(['node',str(script),str(manifest.resolve()),str(raw.resolve()),str((output/'analysis').resolve())],check=True)
    wall=time.perf_counter()-start
    validation=verify_fragments(output/'analysis',raw)
    validation.update(wall_seconds_including_process_start=wall,python=platform.python_version(),machine=platform.platform())
    (output/'independent-validation.json').write_text(json.dumps(validation,indent=2),encoding='utf-8')
    if measure:
        selection=json.loads(manifest.read_text(encoding='utf-8')); users=sorted(set(e['path'].split('/')[1] for e in selection['files']))
        measurements=[]
        for count in (1,2,4):
            subset=[e for u in users for e in sorted((e for e in selection['files'] if e['path'].split('/')[1]==u),key=lambda e:e['path'])[:count]]
            m=output/f'selection-{count}.json'; m.write_text(json.dumps({**selection,'files':subset}),encoding='utf-8')
            for repeat in range(2):
                dest=output/f'scale-{count}-repeat-{repeat}'; start=time.perf_counter()
                subprocess.run(['node',str(script),str(m.resolve()),str(raw.resolve()),str(dest.resolve())],check=True)
                metrics=json.loads((dest/'performance.json').read_text(encoding='utf-8'))
                measurements.append({'sessions':len(subset),'source_bytes':sum(e['size'] for e in subset),'repeat':repeat,'cache':'OS cache uncontrolled; new Node process each run',
                    'wall_seconds_including_startup':time.perf_counter()-start,**metrics})
        (output/'performance-results.json').write_text(json.dumps(measurements,indent=2),encoding='utf-8')
    print(json.dumps(validation))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('manifest',type=Path); parser.add_argument('raw',type=Path); parser.add_argument('output',type=Path)
    parser.add_argument('--measure',action='store_true'); args=parser.parse_args()
    run(args.manifest,args.raw,args.output,args.measure)
