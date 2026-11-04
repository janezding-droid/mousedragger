"""Show definition coverage denominators; do not mistake them for accuracy."""
import json
from pathlib import Path
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def run(source,out):
    d=json.loads(source.read_text());out.mkdir(parents=True,exist_ok=True)
    rows=d['resolution'];fig,ax=plt.subplots(figsize=(10,5.5));fig.subplots_adjust(left=.19,right=.98,top=.78,bottom=.24)
    for offset,num,den,label,color in [(-.18,'resolved_unique','unique_host_entity_refs','Unique host+entity refs','#267790'),(.18,'resolved_occurrences','event_role_occurrences','Event-role occurrences','#bd663f')]:
        values=[100*r[num]/r[den] if r[den] else 0 for r in rows]
        bars=ax.barh([i+offset for i in range(3)],values,height=.32,label=label,color=color)
        for bar,r,v in zip(bars,rows,values):ax.text(bar.get_width()+1,bar.get_y()+bar.get_height()/2,f'{v:.2f}% ({r[num]:,}/{r[den]:,})',va='center',fontsize=8)
    ax.set_yticks(range(3),[r['role'] for r in rows]);ax.invert_yaxis();ax.set_xlim(0,143)
    ax.set_xticks([0,25,50,75,100]);ax.set_xlabel('Definition coverage within the bounded shard (%)');ax.legend(loc='upper center',bbox_to_anchor=(.5,-.22),ncol=2,fontsize=8)
    ax.set_title(f"E5 TRACE prefix: {d['records_read']:,} records / {d['events']:,} events\nMissing definitions may be in other shards; attack membership UNKNOWN",fontsize=12)
    fig.savefig(out/'definition-coverage.png',dpi=150)
    matplotlib.rcParams['svg.hashsalt']='watson-context-v1';fig.savefig(out/'definition-coverage.svg',metadata={'Date':None});plt.close(fig)


if __name__=='__main__':run(Path(sys.argv[1]),Path(sys.argv[2]))
