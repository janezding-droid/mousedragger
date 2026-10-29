import test from 'node:test';
import assert from 'node:assert/strict';
import { featureRows, csv } from '../analyze-records.mjs';
test('feature tables exclude labels and condition; metadata remains joinable', () => {
  const rows = featureRows([{ schema_version: '1.0' }, { schema_version: '2.0', label: 'human',
    participant_id: 'P_TEST', experiment: { condition: 'jump' }, stimuli: [],
    events: [{type:'pointerdown',t:0,x:70,y:280},{type:'pointerup',t:200,x:730,y:110}] }]);
  assert.equal(rows.baseline.length, 1);
  assert.equal(rows.metadata[0].row_id, rows.context[0].row_id);
  assert.equal(rows.context[0].adjustment_latency_proxy_ms, null);
  for (const r of [rows.baseline[0], rows.context[0]]) {
    assert.equal(r.label, undefined); assert.equal(r.condition, undefined); assert.equal(r.participant_id, undefined);
  }
});
test('CSV preserves missing numeric values, quotes, and escapes formula metadata', () => {
  const s = csv([{ a: '=1+1', b: null, c: 'a"b', d: -3 }]);
  assert.ok(s.includes('"\'=1+1","","a""b","-3"'));
});
