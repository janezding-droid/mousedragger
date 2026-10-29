import { PROTOCOL, START, INITIAL_TARGET, TARGET_RADIUS, START_RADIUS,
  MAX_EVENTS, MAX_DURATION_MS, distance, targetAt, summarizeTrial } from './experiment.mjs';
export class ValidationError extends Error {}
const check = (value, message) => { if (!value) throw new ValidationError(message); };
const finite = n => typeof n === 'number' && Number.isFinite(n);
const point = p => p && finite(p.x) && finite(p.y);
const equal = (a, b) => point(a) && point(b) && a.x === b.x && a.y === b.y;
// V1 remains accepted; v2 analysis is derived server-side, never trusted from clients.
export function cleanRecord(body) {
  check(body && typeof body === 'object' && !Array.isArray(body), 'Invalid payload');
  check(body.consent === true, 'Consent is required');
  check(body.label === 'human', 'Online collection accepts self-reported human trials only');
  check(typeof body.participant_id === 'string' && /^[A-Za-z0-9_-]{2,40}$/.test(body.participant_id), 'Use a 2-40 character participant code');
  check(['line', 'curve'].includes(body.task_type), 'Unknown task type');
  check(['mouse', 'pen', 'touch'].includes(body.pointer_type), 'Invalid pointer type');
  const v2 = body.schema_version === '2.0';
  check(body.schema_version == null || v2 || body.schema_version === '1.0', 'Unknown schema version');
  check(Array.isArray(body.events) && body.events.length >= 2 && body.events.length <= MAX_EVENTS, 'Invalid event count');
  let lastTime = -Infinity;
  const events = body.events.map((e, i) => {
    check(e && finite(e.x) && finite(e.y) && finite(e.t) && e.x >= -1000 && e.x <= 1800 &&
      e.y >= -1000 && e.y <= 1400 && e.t >= 0 && e.t >= lastTime, 'Invalid event coordinates or time');
    const last = i === body.events.length - 1;
    check(i === 0 ? e.type === 'pointerdown' : last ?
      ['pointerup', ...(v2 ? ['pointercancel'] : [])].includes(e.type) : e.type === 'pointermove', 'Invalid pointer sequence');
    lastTime = e.t;
    return { type: e.type, t: e.t, x: e.x, y: e.y,
      button: Number.isInteger(e.button) ? e.button : 0, is_dragging: i < body.events.length - 1,
      pointer_type: body.pointer_type };
  });
  check(events.at(-1).t - events[0].t <= MAX_DURATION_MS, 'Trial duration exceeds limit');
  check(distance(events[0], START) <= (v2 ? START_RADIUS : 40), 'Trial did not start at START');
  let experiment, stimuli = [], rendered;
  if (v2) {
    check(events[0].t === 0, 'V2 timestamps must be trial relative');
    const p = body.experiment;
    check(p?.protocol === PROTOCOL && ['static', 'jump'].includes(p.condition), 'Invalid experiment');
    check(Number.isInteger(p.stimulus_delay_ms) && p.stimulus_delay_ms >= 450 && p.stimulus_delay_ms <= 950, 'Invalid stimulus delay');
    check(equal(p.initial_target, INITIAL_TARGET) && (p.condition === 'static' ? equal(p.next_target, INITIAL_TARGET) :
      [60, 300].some(y => equal(p.next_target, { x: 620, y }))), 'Invalid experiment target');
    experiment = { protocol: PROTOCOL, condition: p.condition, stimulus_delay_ms: p.stimulus_delay_ms,
      initial_target: { ...INITIAL_TARGET }, next_target: { x: p.next_target.x, y: p.next_target.y } };
    check(Array.isArray(body.stimuli) && body.stimuli.length <= 1, 'Invalid stimulus timeline');
    stimuli = body.stimuli.map(s => {
      check(s && finite(s.t) && s.t >= p.stimulus_delay_ms && s.t <= events.at(-1).t &&
        s.type === (p.condition === 'jump' ? 'target_change' : 'control_marker') && equal(s.target, p.next_target), 'Invalid stimulus');
      return { type: s.type, t: s.t, target: { ...experiment.next_target } };
    });
    check(['released', 'pointercancel', 'reset', 'resize', 'event_limit', 'timeout', 'visibility', 'lost_capture'].includes(body.end_reason), 'Invalid end reason');
    check((body.end_reason === 'released') === (events.at(-1).type === 'pointerup'), 'End reason does not match pointer sequence');
    check(Number.isInteger(body.trial_index) && body.trial_index >= 1, 'Invalid trial index');
    check(body.rendered_stage && finite(body.rendered_stage.width) && finite(body.rendered_stage.height) &&
      body.rendered_stage.width > 0 && body.rendered_stage.width <= 10000 &&
      body.rendered_stage.height > 0 && body.rendered_stage.height <= 10000, 'Invalid rendered stage');
    rendered = { width: body.rendered_stage.width, height: body.rendered_stage.height };
    check(['mouse', 'touchpad', 'pen', 'touch', 'unknown'].includes(body.input_device), 'Invalid input device');
  }
  const target = targetAt(events.at(-1).t, stimuli), error = distance(events.at(-1), target);
  const record = { schema_version: v2 ? '2.0' : '1.0', source: 'netlify_web_collector',
    label_source: 'online_self_report_unverified', label: 'human', consent: true,
    participant_id: body.participant_id, session_id: String(body.session_id || '').slice(0, 80),
    task_type: body.task_type, pointer_type: body.pointer_type,
    viewport_width: 800, viewport_height: 400, target, events,
    completed: events.at(-1).type === 'pointerup' && error <= (v2 ? TARGET_RADIUS : 45), endpoint_error_px: error };
  if (v2) Object.assign(record, { experiment, stimuli, rendered_stage: rendered, input_device: body.input_device,
    trial_index: body.trial_index, end_reason: body.end_reason, analysis: summarizeTrial({ events, stimuli }) });
  return record;
}
