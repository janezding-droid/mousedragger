"""Build bounded local evidence candidate; never embeds Balabit coordinates."""
import argparse,csv,json,shutil,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('evidence',type=Path);p.add_argument('output',type=Path);p.add_argument('--probe-dir',type=Path);p.add_argument('--source',type=Path);a=p.parse_args()
if a.output.exists():raise SystemExit('Output must not exist')
o=a.evidence
bench=list(csv.DictReader((o/'balabit-run03/benchmark-results.csv').open(encoding='utf-8-sig')))
av=json.loads((o/'darpa-run04/result.json').read_text('utf-8'))
trace=json.loads((o/'darpa-run04/trace-example.json').read_text('utf-8'))
assert trace['event']['truth']=='unknown'
trace['event']['timestampNanos']=str(trace['event']['timestampNanos'])
trace['web_serialization']='timestampNanos is a decimal string to avoid JavaScript integer precision loss'
data={'views':{
'synthetic':{'description':'synthetic_demo等速3-4-5案例。手算與功能測試，不是觀察研究。','limits':'合成案例無真人／冒用／bot真值，不能混入外部評估。','caption':'設計值與算術預期','headers':['項目','值'],'rows':[['路長','10 px'],['時長','2 s'],['均速','5 px/s'],['效率','1']],'evidence':'第一輪10-特徵手算對照.json'},
'balabit':{'description':'40個training sessions，1,414,481 CSV列，46,950完整片段。保守隔離42,544，保留4,406。下表是7位已知來源49配對的建構身分不符代理。','limits':'非官方冒用或bot成績。7 genuine＋42 mismatch，AP機會水準6/7。閾值固定於validation。保留集已用過；來源重用與未見使用者未驗證。','caption':'已知來源代理　固定閾值漏報仍高','headers':['方法','ROC-AUC','PR-AP','FPR','FNR'],'rows':[[x['method']]+[f"{float(x[k]):.4f}" for k in ['roc_auc','pr_ap','fpr','fnr']] for x in bench],'evidence':'balabit-run03/benchmark-results.csv、uncertainty.csv；source-user bootstrap2000次，僅7clusters'},
'darpa':{'description':'官方TRACE3末端分片前10,000 Avro records含8,813 events。整數奈秒與16-byte UUID的hex保持來源值。','limits':'攻擊真值unknown。TRACE2攻擊敘事尚未映射本機TRACE3。摘要縮減率不能當攻擊保留率。','caption':'有界事件摘要比較　非原始byte去重','headers':['規則','項數','縮減率'],'rows':[[x['method'],str(x['items']),f"{x['reduction']:.2%}"] for x in av['comparisons']],'evidence':'darpa-run04/result.json；每occurrence的SHA256＋ordinal＋canonical decoded hash由原gzip重讀核對'}
},'trace':trace,'source_hashes':{n:hashlib.sha256((o/n).read_bytes()).hexdigest() for n in ['balabit-run03/benchmark-results.csv','darpa-run04/result.json','darpa-run04/trace-example.json']}}
if a.probe_dir:
    from site_evidence import extract
    if not a.source: raise ValueError('--source required for original Avro reread')
    data['graph']=extract(a.probe_dir,a.source)
a.output.mkdir(parents=True);shutil.copyfile(Path(__file__).parent/'site/index.html',a.output/'index.html');(a.output/'data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),'utf-8')
print(json.dumps({'files':2,'bytes':sum(x.stat().st_size for x in a.output.iterdir()),'contains_balabit_coordinates':False}))

