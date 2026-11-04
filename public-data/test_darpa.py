"""Synthetic contract tests, NOT external DARPA experiment evidence."""
import copy
import json
import unittest
import tempfile
from pathlib import Path
from darpa import normalize, summarize, verify, verify_source


def event(row, time=1520000000000000001):
    body = {'datum': {'com.bbn.tc.schema.avro.cdm18.Event': {
        'uuid': 'event-'+str(row), 'hostId': 'host-test', 'subject': {'UUID':'subject-test'},
        'predicateObject': {'UUID':'object-test'}, 'predicateObject2': None,
        'type': 'EVENT_READ', 'timestampNanos': time}}}
    return normalize(body,'synthetic.jsonl',row,json.dumps(body))


class Contracts(unittest.TestCase):
    def test_raw_source_tampering_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'synthetic.jsonl'
            body={'datum':{'com.bbn.tc.schema.avro.cdm18.Event':{'uuid':'e','hostId':'h','type':'EVENT_READ','timestampNanos':123}}}
            raw=json.dumps(body)+'\r\n';source.write_bytes(raw.encode())
            normalized=normalize(body,source.name,1,raw)
            self.assertTrue(verify_source([normalized],source))
            source.write_bytes(raw.replace('EVENT_READ','EVENT_SEND').encode())
            with self.assertRaises(AssertionError): verify_source([normalized],source)

    def test_byte_dedup_preserves_raw_differences_and_all_occurrences(self):
        a=event(1); b=copy.deepcopy(a); b.update(ref='synthetic.jsonl:2',source_row=2)
        c=copy.deepcopy(a); c.update(ref='synthetic.jsonl:3',source_row=3,raw_sha256='different-raw-parameters')
        events=[a,b,c]
        self.assertEqual(len(summarize(events,mode='raw')),3)
        self.assertEqual(len(summarize(events,mode='byte_exact')),2)
        self.assertEqual(len(summarize(events)),1)
        self.assertTrue(verify(summarize(events,mode='byte_exact'),events))

    def test_nanosecond_integer_precision(self):
        self.assertEqual(event(1)['timestampNanos'],1520000000000000001)
        with self.assertRaises(ValueError): event(1,1.52e18)

    def test_lossless_argument_grouping(self):
        events=[event(1),event(2,1520000000000000002)]
        summary=summarize(events,10**9)
        self.assertEqual(len(summary),1)
        self.assertTrue(verify(summary,events))
        self.assertEqual(summary[0]['truth'],'unknown')

    def test_tampered_entity_time_id_or_reference_fails(self):
        events=[event(1),event(2)]; summary=summarize(events,10**9)
        for field,value in [('subject','fabricated'),('max_timestampNanos',0),('event_ids',['fake']),('refs',['fake'])]:
            changed=copy.deepcopy(summary); changed[0][field]=value
            with self.assertRaises((AssertionError,KeyError)): verify(changed,events)

    def test_missing_occurrence_fails(self):
        events=[event(1),event(2)]
        with self.assertRaises(AssertionError): verify(summarize(events[:1],10**9),events)

    def test_different_hosts_and_second_objects_never_merge(self):
        a,b=event(1),event(2); b['predicateObject2']='second-object'
        self.assertEqual(len(summarize([a,b],10**9)),2)
        b['predicateObject2']=None; b['hostId']='other-host'
        self.assertEqual(len(summarize([a,b],10**9)),2)

    def test_unknown_missing_endpoints_preserved(self):
        a=event(1); a['subject']=None; a['predicateObject']=None
        self.assertTrue(verify(summarize([a]),[a]))


if __name__=='__main__': unittest.main()
