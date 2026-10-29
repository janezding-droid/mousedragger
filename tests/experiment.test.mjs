import test from 'node:test';
import assert from 'node:assert/strict';
import { makePlan, summarizeTrial, targetAt, INITIAL_TARGET } from '../experiment.mjs';
import { cleanRecord, ValidationError } from '../validation.mjs';

const event = (type, t, x, y) => ({ type, t, x, y });
function fixture(condition = 'jump') {
  const experiment = makePlan(condition, () => .2);
  return { schema_version: '2.0', consent: true, label: 'human', participant_id: 'TEST_A', session_id: 'S_TEST',
    task_type: 'line', pointer_type: 'mouse', input_device: 'touchpad', trial_index: 1,
    rendered_stage: { width: 800, height: 400 }, end_reason: 'released', experiment,
    stimuli: [{ type: condition === 'jump' ? 'target_change' : 'control_marker', t: 600, target: experiment.next_target }],
    events: [event('pointerdown', 0, 70, 280), event('pointermove', 400, 300, 180),
      event('pointermove', 550, 420, 130), event('pointermove', 650, 440, 130),
      event('pointermove', 800, 520, 220), event('pointerup', 1100, 620, 300)] };
}
test('random assignment covers both conditions and bounded delays', () => {
  assert.equal(makePlan('mixed', () => 0).condition, 'static');
  const p = makePlan('mixed', () => .999999);
  assert.equal(p.condition, 'jump'); assert.equal(p.stimulus_delay_ms, 950);
  assert.throws(() => makePlan('other'));
});
test('target lookup and completion use actual observed timeline', () => {
  const r = fixture();
  assert.deepEqual(targetAt(599, r.stimuli), INITIAL_TARGET);
  assert.deepEqual(targetAt(600, r.stimuli), { x: 620, y: 300 });
  assert.equal(cleanRecord(r).completed, true);
  r.events.at(-1).x = 730; r.events.at(-1).y = 110;
  assert.equal(cleanRecord(r).completed, false);
});
test('server recomputes derived data and ignores supplied scores/labels', () => {
  const r = fixture(); r.analysis = { adjustment_latency_proxy_ms: -10 }; r.completed = false;
  const stored = cleanRecord(r);
  assert.equal(stored.analysis.adjustment_latency_proxy_ms, 200);
  assert.equal(stored.completed, true);
  assert.equal(stored.label_source, 'online_self_report_unverified');
  assert.equal(stored.input_device, 'touchpad');
});
test('short trials have no fabricated stimulus or reaction latency', () => {
  const r = fixture(); r.stimuli = []; r.events = [event('pointerdown', 0, 70, 280), event('pointerup', 200, 730, 110)];
  const s = cleanRecord(r);
  assert.equal(s.completed, true); assert.equal(s.analysis.stimulus_observed, false);
  assert.equal(s.analysis.adjustment_latency_proxy_ms, null); assert.equal(s.analysis.post.event_count, 0);
});
test('static markers do not generate a jump response', () => {
  const s = cleanRecord(fixture('static')).analysis;
  assert.equal(s.stimulus_observed, true); assert.equal(s.adjustment_latency_proxy_ms, null);
  assert.equal(s.pre.event_count, 3); assert.equal(s.post.event_count, 3);
});
test('cross-marker intervals are explicit and graph edges are temporal only', () => {
  const s = summarizeTrial(fixture());
  assert.ok(s.segments.some(x => x.stage === 'stimulus_boundary' && x.start_ms === 550 && x.end_ms === 650));
  assert.equal(s.graph.edges.length, s.graph.nodes.length - 1);
  assert.ok(s.graph.edges.every((e, i) => e.source === i && e.target === i + 1 && e.relation === 'next'));
  assert.equal(s.overall.path_length, s.segments.reduce((n, s) => n + s.path_length, 0));
});
test('cancellation at the goal is never a completed trial', () => {
  const r = fixture(); r.end_reason = 'pointercancel'; r.events.at(-1).type = 'pointercancel';
  assert.equal(cleanRecord(r).completed, false);
});
test('reject malformed sequences, missing consent, automation labels, nonfinite data and invalid start', () => {
  for (const change of [r => r.consent = false, r => r.label = 'bot', r => r.events[1].type = 'pointerdown',
    r => r.events[1].x = NaN, r => r.events[1].t = -1, r => r.events[0].x = 200,
    r => r.events[2].t = 399, r => r.events.at(-1).t = 180001,
    r => r.rendered_stage.width = Infinity, r => r.end_reason = 'reset']) {
    const r = fixture(); change(r); assert.throws(() => cleanRecord(r), ValidationError);
  }
});
test('reject forged experiment target and inconsistent/out-of-range stimuli', () => {
  for (const change of [r => r.stimuli[0].t = 100, r => r.stimuli[0].t = 2000,
    r => r.stimuli[0].target.x = 600, r => r.stimuli.push(r.stimuli[0]),
    r => r.experiment.condition = 'other', r => r.experiment.stimulus_delay_ms = 951]) {
    const r = fixture(); change(r); assert.throws(() => cleanRecord(r), ValidationError);
  }
});
test('preserves legacy v1 uploads', () => {
  const r = fixture(); delete r.schema_version; delete r.experiment; delete r.stimuli;
  r.events = [event('pointerdown', 1200, 70, 280), event('pointerup', 2000, 730, 110)];
  const s = cleanRecord(r); assert.equal(s.schema_version, '1.0'); assert.equal(s.completed, true);
  assert.equal(s.analysis, undefined);
});
test('bounded event count accepts limit and rejects overflow', () => {
  const r = fixture(); r.stimuli = [];
  r.events = [event('pointerdown', 0, 70, 280), ...Array.from({length:2498}, (_, i) => event('pointermove', i + 1, 100, 200)), event('pointerup', 2500, 730, 110)];
  assert.equal(cleanRecord(r).events.length, 2500);
  r.events.splice(1, 0, event('pointermove', 0, 70, 280)); assert.throws(() => cleanRecord(r), ValidationError);
});
