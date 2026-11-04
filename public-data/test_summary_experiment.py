"""Synthetic metric/transform contracts, not external experiment evidence."""
import unittest
from summary_experiment import derive, pair_changes


class Sensitivity(unittest.TestCase):
    def test_pair_changes_counts_split_merge_and_survivors(self):
        original=[{'refs':['a','b','c']},{'refs':['d']}]
        result=pair_changes(original,[{'refs':['a','b']},{'refs':['c','d']}])
        self.assertEqual(result,{'baseline_surviving_pairs':3,'derived_pairs':2,'shared_pairs':1,'pair_retention':1/3,'introduced_pairs':1})
        self.assertIsNone(pair_changes(original,[{'refs':['a']}])['pair_retention'])
        with self.assertRaises(AssertionError): pair_changes(original,[{'refs':['fabricated']}])

    def test_transforms_replay_preserve_source_and_integer_time(self):
        events=[{'ref':str(i),'timestampNanos':1558128501132000000+i,'truth':'unknown'} for i in range(300)]
        for name in ('original','every_second','missing_1pct','jitter_1ms','time_scale_2'):
            a=derive(events,name);self.assertEqual(a,derive(events,name))
            self.assertTrue(all(type(e['timestampNanos']) is int and e['timestampNanos']>=0 and e['truth']=='unknown' for e in a))
        self.assertEqual(len(derive(events,'every_second')),150)
        self.assertEqual(events[1]['timestampNanos'],1558128501132000001)
        self.assertEqual(derive(events,'time_scale_2')[1]['timestampNanos'],1558128501132000002)
        with self.assertRaises(ValueError):derive(events,'invented')


if __name__=='__main__':unittest.main()
