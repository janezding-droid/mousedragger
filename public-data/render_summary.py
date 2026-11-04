"""Plot measured summary sensitivity and full pipeline profile."""
import csv
from pathlib import Path
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def run(source, profile, output):
    rows=list(csv.DictReader(source.open(encoding='utf-8')))
    perf=list(csv.DictReader(profile.open(encoding='utf-8')))
    fig,axes=plt.subplots(1,3,figsize=(14,4.7));fig.subplots_adjust(left=.06,right=.98,bottom=.27,top=.77,wspace=.40)
    for variant,label in [('jitter_1ms','Timestamp jitter +/-1ms'),('time_scale_2','Time scale x2')]:
        data=[r for r in rows if r['variant']==variant]
        axes[0].plot([float(r['bucket_ns'])/1e9 for r in data],[100*float(r['pair_retention']) for r in data],marker='o',label=label)
    axes[0].set_xscale('log');axes[0].set_xticks([.1,1,10],['0.1','1','10']);axes[0].set_ylim(0,105)
    axes[0].set_xlabel('Aggregation bucket (s)');axes[0].set_ylabel('Surviving co-grouped pairs retained (%)');axes[0].legend(loc='upper left',bbox_to_anchor=(0,-.25),fontsize=8)
    for repeat,mark in [('0','o'),('1','x')]:
        data=[r for r in perf if r['repeat']==repeat];x=[int(r['events']) for r in data]
        axes[1].plot(x,[float(r['end_to_end_seconds']) for r in data],marker=mark,label='Pass '+str(int(repeat)+1))
        axes[2].plot(x,[float(r['peak_kib'])/1024 for r in data],marker=mark)
    axes[1].set_ylabel('End-to-end wall time (s)');axes[2].set_ylabel('Worker process peak working set (MiB)')
    for ax in axes[1:]:ax.set_xlabel('External events (bounded prefix)');ax.ticklabel_format(axis='x',style='sci',scilimits=(0,0));ax.grid(alpha=.2)
    axes[1].legend(fontsize=8)
    fig.suptitle('E5 external prefix: grouping stability and measured full-summary cost\nTruth UNKNOWN; pair stability is not attack retention',fontsize=13)
    fig.text(.51,.04,'Fresh processes; OS cache uncontrolled. Includes source reread, graph and JSON output. No scaling extrapolation.',ha='center',fontsize=9)
    output.mkdir(parents=True,exist_ok=True);fig.savefig(output/'summary-experiment.png',dpi=150)
    matplotlib.rcParams['svg.hashsalt']='watson-summary-v1';fig.savefig(output/'summary-experiment.svg',metadata={'Date':None});plt.close(fig)


if __name__=='__main__':run(Path(sys.argv[1]),Path(sys.argv[2]),Path(sys.argv[3]))
