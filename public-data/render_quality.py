"""Render descriptive development plots/casebook; no raw coordinates redistributed."""
import json
from pathlib import Path
import statistics
import sys
import matplotlib
matplotlib.use('Agg')
matplotlib.rcParams['svg.hashsalt']='watson-public-data-20261104'
import matplotlib.pyplot as plt


def run(root):
    root=Path(root)
    result=json.loads((root/'robustness-results.json').read_text(encoding='utf-8'))
    variants=['downsample2','scale0.5','scale2','jitter5ms','missing5','pause10','duration60']
    fig,axes=plt.subplots(1,2,figsize=(12,5),layout='constrained')
    for ax,metric,unit in zip(axes,['path_length_px','pause_duration_s'],['px','seconds']):
        groups=[[r['median_absolute_delta'] for r in result['rows'] if r['variant']==v and r['metric']==metric and r['median_absolute_delta'] is not None] for v in variants]
        values=[statistics.median(a) if a else 0 for a in groups]
        ax.barh(variants,values,color='#36799c',label='Median of session medians')
        tails=[max((r['max_absolute_delta'] for r in result['rows'] if r['variant']==v and r['metric']==metric and r['max_absolute_delta'] is not None),default=0) for v in variants]
        ax.scatter(tails,variants,color='#c45832',marker='D',s=22,label='Largest paired absolute change')
        ax.set_xscale('symlog',linthresh=0.001); ax.set_xlabel('Absolute change ('+unit+'); symlog axis')
        ax.legend(fontsize=8,loc='lower right')
        ax.set_title(metric);ax.invert_yaxis();ax.spines[['top','right']].set_visible(False)
    fig.suptitle('External Balabit training only: absolute paired feature changes\nConservative quarantine; descriptive results, not detection scores',fontsize=12)
    fig.savefig(root/'robustness.png',dpi=150,metadata={'Software':'public-data/render_quality.py'})
    fig.savefig(root/'robustness.svg',metadata={'Date':None});plt.close(fig)
    cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))
    text=['# 外部資料穩定／失真案例簿','', '本表為開發集合探索性案例；成功指下採樣路長保持，失敗指路長改變，並非合法／冒用偵測成敗。完整座標及回放資料留工作目錄，來源授權未明不再散布。', '', '選例規則：'+cases['selection'], '']
    for group,title in [('success','穩定'),('failure','失真')]:
        for i,c in enumerate(cases[group],1):
            text += [f'## {title} {i}', '',f"來源 `{c['id']}`；{c['events']} 個原始事件；同時間段 {c['zero_dt_segments']}。",'',f"預期下採樣可能縮短折返路徑；實際原路長 {c['path_length_px']:.6f} px，差值 {c['path_delta_px']:.6f} px。",'', '可能原因：移除內部折點會略過折返或小幅移動；共線或重複位置則可能保持路長。需回查原始列核對，不能僅憑本表推斷動機。建議同報採樣密度及原始／衍生差異，避免比較不同採樣率的絕對速度。','']
    text += ['## 邊界','', '這六例只有來源ID與度量追溯，完整互動回放及獨立逐案稽核尚待整合；DARPA案例因原始事件與攻擊說明尚不可取得，未以此替代。']
    (root/'cases.md').write_text('\n'.join(text)+'\n',encoding='utf-8')


if __name__=='__main__': run(sys.argv[1])
