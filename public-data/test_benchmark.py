import unittest, json, tempfile
from pathlib import Path
import numpy as np
from benchmark import metrics, read_sessions

class MetricsTests(unittest.TestCase):
    def test_perfect_and_reverse(self):
        self.assertEqual(metrics([0,0,1,1],[0,1,2,3],1)['roc_auc'],1)
        self.assertEqual(metrics([0,0,1,1],[3,2,1,0],1)['roc_auc'],0)
        self.assertEqual(metrics([0,1],[0,1],.5)['pr_ap'],1)
    def test_tied_chance(self):
        m=metrics([0,1,1],[0,0,0],0)
        self.assertEqual(m,dict(roc_auc=.5,pr_ap=2/3,fpr=0.,fnr=1.))
    def test_zero_weight_threshold(self):
        m=metrics([0,1,0,1],[9,8,0,1],.5,[0,0,1,1])
        self.assertEqual(m,dict(roc_auc=1.,pr_ap=1.,fpr=0.,fnr=0.))
    def test_tied_group_order_invariant(self):
        a=metrics([0,1,1,0],[1,1,0,0],0)
        b=metrics([1,0,0,1],[1,1,0,0],0)
        self.assertEqual(a,b)
    def test_missing_class(self):
        with self.assertRaises(ValueError):metrics([0],[1],0)
    def test_integer_weight_equals_replication(self):
        y=np.array([0,1,0,1]);s=np.array([0,1,2,3]);w=np.array([2,1,1,3])
        self.assertEqual(metrics(y,s,1,w),metrics(np.repeat(y,w),np.repeat(s,w),1))
    def test_wrong_split_or_operator_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'fragments.jsonl'
            p.write_text(json.dumps(dict(source='s',source_rows=[2,3],split='reserved'))+'\n')
            m=dict(sessions=[dict(session='s',user='u',source_operator='u',split='train')],quarantined=[])
            with self.assertRaisesRegex(ValueError,'identity/split'):read_sessions(p,m)
            m['sessions'][0]['split']='reserved';m['sessions'][0]['source_operator']='unknown'
            with self.assertRaisesRegex(ValueError,'identity/split'):read_sessions(p,m)
    def test_source_window_overlap_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'fragments.jsonl'; item=dict(source='s',source_rows=[2,3],split='train',metrics={})
            p.write_text((json.dumps(item)+'\n')*2)
            m=dict(sessions=[dict(session='s',user='u',source_operator='u',split='train')],quarantined=[])
            with self.assertRaisesRegex(ValueError,'Overlapping'):read_sessions(p,m)

if __name__=='__main__':unittest.main()
