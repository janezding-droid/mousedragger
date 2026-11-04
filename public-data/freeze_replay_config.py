"""Freeze explicit existing local inputs; never downloads or reads test labels."""
import argparse,hashlib,importlib.metadata,json,platform,subprocess
from pathlib import Path
def freeze(selection,raw,darpa,scores,output):
    if output.exists():raise ValueError('New config path required')
    source=Path(__file__).parent;inputs=[]
    def add(p,role):
        h=hashlib.sha256()
        with p.open('rb') as f:
            for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
        inputs.append({'path':str(p.resolve()),'size':p.stat().st_size,'sha256':h.hexdigest(),'role':role})
    for e in json.loads(selection.read_text('utf-8'))['files']:add(raw/e['path'],'data')
    for f in [darpa,scores]:add(f,'data')
    for f in sorted(source.iterdir()):
        if f.is_file() and f.suffix in ('.py','.mjs','.txt','.json'):add(f,'code_or_config')
    if selection.resolve()!= (source/'selection.json').resolve():add(selection,'code_or_config')
    add(source.parent/'features.mjs','code_or_config')
    packages={}
    for f in [source/'requirements-avro.txt',source/'requirements-quality.txt']:
        for line in f.read_text().splitlines():
            if '==' in line:
                name,version=line.split('==');actual=importlib.metadata.version(name)
                if actual!=version:raise ValueError('Install pinned dependency: '+line)
                packages[name]=actual
    c={'seed':20261104,'selection':str(selection.resolve()),'raw':str(raw.resolve()),'darpa':str(darpa.resolve()),'frozen_scores':str(scores.resolve()),'python':platform.python_version(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'packages':packages,'inputs':inputs,'mode':'offline only; no automatic install/download/refit'}
    output.write_text(json.dumps(c,indent=2),'utf-8')
if __name__=='__main__':
    p=argparse.ArgumentParser()
    for name in ('selection','raw','darpa','scores','output'):p.add_argument(name,type=Path)
    a=p.parse_args();freeze(a.selection,a.raw,a.darpa,a.scores,a.output)
