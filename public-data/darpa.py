"""CDM18 event incidence graph and lossless provenance grouping.

Schema-based implementation; no DARPA external event validation claimed yet.
Edges mean event arguments, NOT inferred information-flow direction.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path


def unwrap(value):
    if isinstance(value, dict) and len(value) == 1:
        return next(iter(value.values()))
    return value


def normalize(record, source, row, raw_line):
    datum = record.get('datum')
    if not isinstance(datum, dict) or len(datum) != 1:
        raise ValueError('Invalid CDM union')
    kind, event = next(iter(datum.items()))
    if kind != 'com.bbn.tc.schema.avro.cdm18.Event':
        return None
    timestamp = unwrap(event.get('timestampNanos'))
    if type(timestamp) is not int or timestamp < 0:
        raise ValueError('timestampNanos must be a nonnegative integer; no float rounding')
    result = {k: unwrap(event.get(k)) for k in ('uuid', 'hostId', 'subject', 'predicateObject', 'predicateObject2', 'type')}
    for key in ('uuid', 'hostId', 'type'):
        if not isinstance(result[key], str) or not result[key]:
            raise ValueError('Missing or unsupported ' + key)
    for key in ('subject', 'predicateObject', 'predicateObject2'):
        if result[key] is not None and not isinstance(result[key], str):
            raise ValueError('Unsupported entity encoding')
    result.update(timestampNanos=timestamp, source=source, source_row=row,
                  raw_sha256=hashlib.sha256(raw_line.encode()).hexdigest(), truth='unknown')
    # source + row identifies the occurrence even if an event UUID is repeated.
    result['ref'] = f'{source}:{row}'
    return result


def signature(event, bucket_ns=None):
    fields = ('hostId', 'subject', 'predicateObject', 'predicateObject2', 'type')
    key = tuple(event[k] for k in fields)
    return key + ((event['timestampNanos'] // bucket_ns) if bucket_ns else event['timestampNanos'],)


def summarize(events, bucket_ns=None):
    if bucket_ns is not None and (type(bucket_ns) is not int or bucket_ns <= 0):
        raise ValueError('bucket_ns must be a positive integer')
    grouped = defaultdict(list)
    for event in events:
        grouped[signature(event, bucket_ns)].append(event)
    result = []
    for group in grouped.values():
        item = {k: group[0][k] for k in ('hostId', 'subject', 'predicateObject', 'predicateObject2', 'type')}
        item.update(refs=[e['ref'] for e in group], event_ids=[e['uuid'] for e in group],
                    min_timestampNanos=min(e['timestampNanos'] for e in group),
                    max_timestampNanos=max(e['timestampNanos'] for e in group), count=len(group), truth='unknown')
        result.append(item)
    return result


def verify(summary, events):
    by_ref = {e['ref']: e for e in events}
    assert len(by_ref) == len(events), 'Ambiguous source reference'
    used = []
    for item in summary:
        members = [by_ref[ref] for ref in item['refs']]  # unknown refs fail
        assert members and len(members) == item['count']
        assert item['event_ids'] == [e['uuid'] for e in members]
        for key in ('hostId', 'subject', 'predicateObject', 'predicateObject2', 'type'):
            assert all(e[key] == item[key] for e in members), 'Mixed entities or event type'
        assert item['min_timestampNanos'] == min(e['timestampNanos'] for e in members)
        assert item['max_timestampNanos'] == max(e['timestampNanos'] for e in members)
        used.extend(item['refs'])
    assert Counter(used) == Counter(by_ref.keys()), 'Lost or duplicated event occurrence'
    return True


def run(input_file, output):
    events, errors, skipped = [], [], 0
    with Path(input_file).open(encoding='utf-8') as stream:
        for row, line in enumerate(stream, 1):
            try:
                event = normalize(json.loads(line), Path(input_file).name, row, line)
                if event: events.append(event)
                else: skipped += 1
            except (ValueError, TypeError, AttributeError) as error:
                errors.append({'source_row': row, 'reason': str(error)})
    root = Path(output); root.mkdir(parents=True, exist_ok=True)
    result = {'scope': 'CDM18 supplied file only; no attack truth inferred', 'events': len(events), 'non_event_records': skipped, 'errors': errors, 'comparisons': []}
    for name, bucket in [('exact_argument_time', None), ('bucket_1s', 10**9), ('bucket_10s', 10**10)]:
        summary = summarize(events, bucket); verify(summary, events)
        (root / (name + '.json')).write_text(json.dumps(summary, indent=2), encoding='utf-8')
        result['comparisons'].append({'method': name, 'items': len(summary), 'reduction': 1-len(summary)/len(events) if events else None, 'provenance_verified': True, 'attack_retention': None})
    edges = [{'event_ref': e['ref'], 'role': role, 'entity_uuid': e[role], 'hostId': e['hostId']}
             for e in events for role in ('subject','predicateObject','predicateObject2') if e[role] is not None]
    (root/'incidence-edges.json').write_text(json.dumps(edges,indent=2),encoding='utf-8')
    (root/'normalized-events.json').write_text(json.dumps(events,indent=2),encoding='utf-8')
    (root/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('input_jsonl'); parser.add_argument('output')
    args = parser.parse_args(); run(args.input_jsonl, args.output)
