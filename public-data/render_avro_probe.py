"""Bounded external shard summary plot; no inferred attack labels."""
import json
from pathlib import Path
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def run(root,out):
    out.mkdir(parents=True,exist_ok=True)
    r=json.loads((root/'result.json').read_text());events=json.loads((root/'normalized-events.json').read_text());comparisons=r['comparisons']
    fig,axes=plt.subplots(1,2,figsize=(11,4.6),layout='constrained')
    names=[x['method'] for x in comparisons];counts=[x['items'] for x in comparisons]
    axes[0].barh(names,counts,color=['#596f81','#397b9c','#397b9c','#397b9c']);axes[0].invert_yaxis();axes[0].set_xlabel('Summary items (all source occurrences traceable)')
    for i,c in enumerate(comparisons):axes[0].text(c['items']+80,i,f"{c['items']:,} ({c['reduction']:.1%} fewer)",va='center',fontsize=8)
    axes[0].set_xlim(0,max(counts)*1.38)
    data=[]
    for name in ('argument_exact','bucket_1s','bucket_10s'):
        items=json.loads((root/(name+'.json')).read_text());span=[(s['max_timestampNanos']-s['min_timestampNanos'])/1e9 for s in items];data.append(max(span,default=0))
    axes[1].bar(['Exact time','1s buckets','10s buckets'],data,color='#c15e38');axes[1].set_ylabel('Maximum within-summary time span (seconds)')
    axes[1].set_title('Coarser time grouping loses timing detail')
    for i,v in enumerate(data):axes[1].text(i,v+0.04,f'{v:.6f}',ha='center',fontsize=8)
    fig.suptitle('Official E5 TRACE terminal-shard prefix: 10,000 records / 8,813 events\nAttack membership UNKNOWN; completeness and attack retention unverified',fontsize=11)
    fig.savefig(out/'summary-comparison.png',dpi=150);plt.close(fig)
    (out/'trace-example.json').write_text(json.dumps({'scope':'first event, selected by ordinal; unknown truth','event':events[0],'original_shard_sha256':r['source_sha256'],'retrieval':'Decode original compressed Avro with embedded schema, enumerate records starting at1; verify canonical hash via avro_probe.py'},indent=2),encoding='utf-8')


if __name__=='__main__':run(Path(sys.argv[1]),Path(sys.argv[2]))
