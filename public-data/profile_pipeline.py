"""Three actual scales, new-process repeated full offline feature/QA/plot pipeline.
Peak memory reported per process, not falsely summed as simultaneous tree RSS.
"""
import argparse
import csv
import ctypes
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
from reproduce import run


def peak_kib():
    if sys.platform=='win32':
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_=[('cb',wintypes.DWORD),('PageFaultCount',wintypes.DWORD)]+[(k,ctypes.c_size_t) for k in ('PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage','QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage')]
        c=Counters();c.cb=ctypes.sizeof(c)
        kernel=ctypes.WinDLL('kernel32',use_last_error=True);kernel.GetCurrentProcess.restype=wintypes.HANDLE
        psapi=ctypes.WinDLL('psapi',use_last_error=True);psapi.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(Counters),wintypes.DWORD]
        if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(),ctypes.byref(c),c.cb): raise ctypes.WinError()
        return c.PeakWorkingSetSize/1024
    import resource
    value=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return value/1024 if sys.platform=='darwin' else value


def worker(manifest,raw,out):
    start=time.perf_counter();run(manifest,raw,out,quality=True)
    # Render runs in another Python process in reproduce.py. It is deliberately
    # excluded from the memory envelope; total wall time DOES include rendering.
    nodes={stage:json.loads((out/stage/'performance.json').read_text())['peak_rss_kib'] for stage in ('analysis','quality')}
    result={'pipeline_seconds':time.perf_counter()-start,'validator_python_peak_kib':peak_kib(),
            'analysis_node_peak_kib':nodes['analysis'],'quality_node_peak_kib':nodes['quality']}
    (out/'profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')


def profile(manifest,raw,out):
    if out.exists(): raise ValueError('New output directory required')
    out.mkdir(parents=True);selection=json.loads(manifest.read_text(encoding='utf-8'))
    users=sorted({e['path'].split('/')[1] for e in selection['files']});rows=[]
    for count in (1,2,4):
        files=[e for u in users for e in sorted((e for e in selection['files'] if e['path'].split('/')[1]==u),key=lambda e:e['path'])[:count]]
        m=out/f'selection-{count}.json';m.write_text(json.dumps({**selection,'files':files}),encoding='utf-8')
        for repeat in range(2):
            dest=out/f'scale-{count}-repeat-{repeat}';start=time.perf_counter()
            subprocess.run([sys.executable,__file__,str(m),str(raw),str(dest),'--worker'],check=True)
            validation=json.loads((dest/'independent-validation.json').read_text())
            metrics=json.loads((dest/'profile.json').read_text());result=json.loads((dest/'quality/leakage-audit.json').read_text())
            rows.append({'sessions':len(files),'source_bytes':sum(e['size'] for e in files),'repeat':repeat,'startup':'fresh processes; first pass' if repeat==0 else 'fresh processes; repeated pass','cache':'OS disk cache uncontrolled; not cold-cache measurement','end_to_end_seconds':time.perf_counter()-start,**metrics,'fragments_checked':validation['fragments_independently_checked'],'retained':result['retained_fragments']})
    with (out/'performance-results.csv').open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    (out/'environment.json').write_text(json.dumps({'platform':platform.platform(),'processor':platform.processor(),'python':sys.version,'node':subprocess.check_output(['node','--version'],text=True).strip(),'scope':'CSV import+canonical features+raw CSV independent verification+quarantine+robustness+plots+casebook; excludes proxy benchmark and DARPA','memory_limits':'Separate OS process lifetime peak working sets for validator Python and two Node stages. Plot subprocess and coordinator excluded. These are NOT full simultaneous process-tree peak; no sum or scaling claim.','split_warning':'1/2-session scales have different split/quarantine workloads; timing only, no comparable detection scores','measurements':rows},indent=2),encoding='utf-8')


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('manifest',type=Path);p.add_argument('raw',type=Path);p.add_argument('output',type=Path);p.add_argument('--worker',action='store_true');a=p.parse_args()
    (worker if a.worker else profile)(a.manifest.resolve(),a.raw.resolve(),a.output.resolve())
