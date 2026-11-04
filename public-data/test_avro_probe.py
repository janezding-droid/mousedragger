"""Synthetic adapter contracts; external evidence is recorded separately."""
import copy
import unittest
from avro_probe import identity, normalize
from darpa import summarize, verify


def record():
    return {'datum':('com.bbn.tc.schema.avro.cdm20.Event',{'uuid':b'e'*16,'subject':('com.bbn.tc.schema.avro.cdm20.UUID',b's'*16),'predicateObject':None,'predicateObject2':None,'type':'EVENT_READ','timestampNanos':1558128501132000001}), 'hostId':b'h'*16}


class Adapter(unittest.TestCase):
    def test_fixed_uuid_union_and_host_scope(self):
        e=normalize(record(),1,'synthetic.gz','test-sha')
        self.assertEqual(e['subject'],'cdm20-fixed16:'+ (b's'*16).hex())
        self.assertEqual(e['hostId'],'cdm20-fixed16:'+ (b'h'*16).hex())
        self.assertEqual(e['timestampNanos'],1558128501132000001)
        self.assertEqual(e['truth'],'unknown')

    def test_unsupported_uuid_and_time_fail(self):
        for value in ('guessed-uuid', b'x', ('wrong-union', b'x'*16)):
            with self.assertRaises(ValueError): identity(value)
        r=record();r['datum'][1]['timestampNanos']=1.5
        with self.assertRaises(ValueError):normalize(r,1,'synthetic','sha')

    def test_ordinal_refs_and_summary_tampering(self):
        events=[normalize(record(),i,'synthetic','sha') for i in (1,2)]
        self.assertNotEqual(events[0]['ref'],events[1]['ref'])
        s=summarize(events,10**9);self.assertTrue(verify(s,events))
        s[0]['hostId']='invented'
        with self.assertRaises(AssertionError):verify(s,events)

    def test_decoded_hash_covers_non_key_properties(self):
        a=record();b=copy.deepcopy(a);b['datum'][1]['size']=42
        self.assertNotEqual(normalize(a,1,'s','h')['decoded_record_sha256'],normalize(b,1,'s','h')['decoded_record_sha256'])
