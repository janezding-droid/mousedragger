"""Synthetic contracts, not external attack evidence."""
import unittest
from audit_context import audit, strings
from test_avro_probe import record


class Context(unittest.TestCase):
    def test_late_definition_and_cross_host_stay_separate(self):
        e=record(); definition={'hostId':b'h'*16,'datum':('com.bbn.tc.schema.avro.cdm20.Subject',{'uuid':b's'*16})}
        wrong={'hostId':b'z'*16,'datum':definition['datum']}
        a=audit(enumerate([e,wrong],1),'s','sha',2)
        self.assertEqual(a['resolution'][0]['resolved_occurrences'],0)
        b=audit(enumerate([e,definition],1),'s','sha',2)
        self.assertEqual(b['resolution'][0]['resolved_occurrences'],1)

    def test_property_path_and_hash_change(self):
        e=record();e['datum'][1]['properties']={'commandLine':'env LD_PRELOAD=/lib/libselinux.so'}
        a=audit([(1,e)],'s','sha',1)
        self.assertEqual(a['indicator_match_counts']['LD_PRELOAD'],1)
        self.assertEqual(a['indicator_examples'][0]['field'],'$.properties.commandLine')
        self.assertEqual(a['truth'].split(';')[0],'unknown')
        before=a['indicator_examples'][0]['decoded_record_sha256']
        e['datum'][1]['other']=42
        self.assertNotEqual(before,audit([(1,e)],'s','sha',1)['indicator_examples'][0]['decoded_record_sha256'])

    def test_no_indicator_is_not_negative_label(self):
        a=audit([(1,record())],'s','sha',1)
        self.assertTrue(all(v==0 for v in a['indicator_match_counts'].values()))
        self.assertTrue(a['truth'].startswith('unknown'))
        self.assertEqual(list(strings(('name','value'))),[('$.union','value')])

    def test_nonmonotonic_is_reported_and_invalid_time_rejected(self):
        e=record();e['datum'][1]['timestampNanos']=0
        a=audit([(1,record()),(2,e)],'s','sha',2)
        self.assertEqual(a['adjacent_event_time_decreases'],1)
        e['datum'][1]['timestampNanos']=-1
        with self.assertRaises(ValueError):audit([(1,e)],'s','sha',1)
