"""Render fixed proxy comparison; does not choose models or thresholds."""
import csv, json, sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams.update({'svg.hashsalt':'watson-proxy-v3','font.family':'DejaVu Sans'})
p=Path(sys.argv[1]);rows=list(csv.DictReader((p/'ablation-results.csv').open(encoding='utf-8')))
cis=list(csv.DictReader((p/'uncertainty.csv').open(encoding='utf-8')))
fig,axes=plt.subplots(1,2,figsize=(12,5),layout='constrained')
for ax,metric,title in zip(axes,['roc_auc','pr_ap'],['ROC-AUC','Average precision (PR)']):
    configs=list(dict.fromkeys(r['config'] for r in rows))
    for method,offset,color in [('distance',-.12,'#176b87'),('ridge',.12,'#bd612b')]:
        vals=[next(r for r in rows if r['method']==method and r['config']==c) for c in configs]
        y=[float(r[metric]) for r in vals]
        ci=[next(c for c in cis if c['config']==r['config'] and c['method']==method and c['metric']==metric) for r in vals]
        ax.errorbar(y,[i+offset for i in range(len(configs))],xerr=[[max(0,v-float(c['lower95'])) for v,c in zip(y,ci)],[max(0,float(c['upper95'])-v) for v,c in zip(y,ci)]],fmt='o',capsize=3,label=method,color=color)
    ax.axvline(.5 if metric=='roc_auc' else 6/7,color='#555',linestyle='--',label='constant chance')
    ax.set(yticks=range(len(configs)),yticklabels=configs,xlim=(0,1.03),title=title,xlabel='Reserved sessions; source-user bootstrap 95% interval')
    ax.invert_yaxis();ax.grid(axis='x',alpha=.2)
axes[0].legend(loc='lower left',fontsize=8)
fig.suptitle('Constructed known-owner proxy | 7 sources, 49 pairs, positive prevalence 6/7\nNot official impersonation, bot detection, or unseen-user generalization',fontsize=12)
fig.savefig(p/'benchmark.png',dpi=170);fig.savefig(p/'benchmark.svg',metadata={'Date':None});plt.close(fig)
pred=list(csv.DictReader((p/'predictions.csv').open(encoding='utf-8')))
cases=[]
for good in (True,False):
    candidates=[r for r in pred if r['config']=='full' and r['method']=='distance' and (r['positive']==r['predicted_positive'])==good]
    # deterministic session diversity; explanatory selection after final evaluation
    selected=[];seen=set()
    for r in candidates:
        if r['source_session'] in seen:continue
        selected.append(r);seen.add(r['source_session'])
        if len(selected)==3:break
    cases.extend([dict(category='correct_proxy_pair' if good else 'incorrect_proxy_pair',**r) for r in selected])
(p/'proxy-cases.json').write_text(json.dumps(cases,indent=2),encoding='utf-8')
text='# 代理配對成功與失敗案例\n\n探索性案例選擇：full distance 的正確／錯誤配對各取來源session不同的前三例。非真實攻擊。每個session的全部保留片段可由 v2 split manifest 的 source rows 與 fragments.jsonl 重建；此任務單位為session，不能用單一漂亮軌跡解釋分類。\n\n'
for i,r in enumerate(cases,1):
    text+=f"## {i}. {r['category']}\n\n來源 `{r['source_session']}`；真實來源 {r['source_user']}、宣稱 {r['claimed_user']}。預期不符={r['positive']}，實際警報={r['predicted_positive']}；分數 {float(r['score']):.6f}，固定閾值 {float(r['threshold']):.6f}。\n\n"
    text+=('配對正確僅顯示此閾值下的個例，不能當實際攻擊成功偵測。' if r['positive']==r['predicted_positive'] else '固定閾值、session特徵重疊及隔離偏差都可能造成錯誤；目前無法歸因。應擴增獨立session、核驗工作任務／解析度影響後另註冊協議，不能用這些保留集錯誤回調本輪閾值。')+'\n\n'
(p/'proxy-cases.md').write_text(text,encoding='utf-8')
