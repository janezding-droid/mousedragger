import unittest
from site_evidence import bounded_group
from darpa import summarize

class Evidence(unittest.TestCase):
    def events(self):
        return [dict(hostId='h',subject='s',predicateObject='o',predicateObject2=None,type='EVENT_READ',timestampNanos=1558128501132000000+i,ref=str(i),uuid='e'+str(i),truth='unknown') for i in range(2)]
    def test_exact_nanoseconds_and_members(self):
        e=self.events();s=summarize(e,10**9);g=bounded_group(s,e)
        self.assertEqual(g['events'][1]['timestampNanos'],'1558128501132000001')
        self.assertEqual(g['summary']['refs'],['0','1'])
    def test_tampered_graph_rejected(self):
        e=self.events();s=summarize(e,10**9);s[0]['subject']='invented'
        with self.assertRaises(AssertionError):bounded_group(s,e)
    def test_unbounded_group_rejected(self):
        e=self.events()[:1]
        with self.assertRaises(ValueError):bounded_group(summarize(e,10**9),e)
    def test_missing_occurrence_rejected(self):
        e=self.events();s=summarize(e,10**9);s[0]['refs'].pop()
        with self.assertRaises(AssertionError):bounded_group(s,e)

if __name__=='__main__':unittest.main()
