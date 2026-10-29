// Shared, dependency-free geometry and descriptive behavior abstraction.
export const PROTOCOL = 'context-drag-v1';
export const START = Object.freeze({ x: 70, y: 280 });
export const INITIAL_TARGET = Object.freeze({ x: 730, y: 110 });
export const TARGET_RADIUS = 30, START_RADIUS = 27;
export const MAX_EVENTS = 2500, MAX_DURATION_MS = 180000;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function makePlan(condition, random = Math.random) {
  const actual = condition === 'mixed' ? (random() < .5 ? 'static' : 'jump') : condition;
  if (!['static', 'jump'].includes(actual)) throw Error('Unknown condition');
  return { protocol: PROTOCOL, condition: actual,
    // Static trials have a sham marker for matched pre/post windows.
    stimulus_delay_ms: Math.floor(450 + random() * 501),
    initial_target: { ...INITIAL_TARGET },
    next_target: actual === 'jump' ? { x: 620, y: random() < .5 ? 300 : 60 } : { ...INITIAL_TARGET } };
}
export function targetAt(t, stimuli, initial = INITIAL_TARGET) {
  let target = initial;
  for (const event of stimuli) if (event.t <= t) target = event.target;
  return target;
}
function windowStats(events) {
  let length = 0, pause = 0;
  for (let i = 1; i < events.length; i++) {
    const dt = events[i].t - events[i - 1].t, d = distance(events[i], events[i - 1]);
    length += d;
    // Sparse sampling also affects this proxy; it is not an intentional-pause label.
    if (dt >= 100 && d / dt < .05) pause += dt;
  }
  const duration = events.length > 1 ? events.at(-1).t - events[0].t : 0;
  return { event_count: events.length, duration_ms: duration, path_length: length,
    mean_speed: duration > 0 ? length / duration : 0, low_motion_ms: pause };
}
export function summarizeTrial(record) {
  const { events, stimuli = [] } = record, marker = stimuli[0], segments = [];
  let lastDirection = null, previousStage = null;
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1], b = events[i], dt = b.t - a.t, d = distance(a, b);
    const remaining = distance(b, targetAt(b.t, stimuli));
    const crosses = marker && a.t < marker.t && b.t >= marker.t;
    const stage = crosses ? 'stimulus_boundary' : marker && b.t >= marker.t ? 'post_stimulus' : 'pre_stimulus';
    const direction = d >= 2 ? { x: (b.x - a.x) / d, y: (b.y - a.y) / d } : null;
    let kind = 'movement';
    if (crosses) kind = 'stimulus_boundary';
    else if (dt >= 100 && d / dt < .05) kind = 'low_motion';
    else if (remaining <= 90) kind = 'target_approach';
    else if (direction && lastDirection && stage === previousStage &&
      direction.x * lastDirection.x + direction.y * lastDirection.y < .5) kind = 'direction_change';
    if (direction) lastDirection = direction;
    previousStage = stage;
    const prev = segments.at(-1);
    if (prev && prev.kind === kind && prev.stage === stage) {
      prev.end_index = i; prev.end_ms = b.t; prev.path_length += d;
    } else segments.push({ kind, stage, start_index: i - 1, end_index: i,
      start_ms: a.t, end_ms: b.t, path_length: d });
  }
  // Observable proxy: >=80ms after change, direction turns >=~26deg from
  // the last pre-change movement and aligns with the new target.
  let adjustment = null;
  if (marker?.type === 'target_change') {
    let prior = null;
    for (let i = 1; i < events.length; i++) {
      const a = events[i - 1], b = events[i], d = distance(a, b);
      if (b.t <= marker.t && d >= 2) prior = { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
    }
    if (prior) for (let i = 1; i < events.length; i++) {
      const a = events[i - 1], b = events[i], d = distance(a, b), goal = distance(a, marker.target);
      if (a.t < marker.t || b.t - marker.t < 80 || d < 2 || goal === 0) continue;
      const dx = (b.x - a.x) / d, dy = (b.y - a.y) / d;
      if (dx * prior.x + dy * prior.y < .9 &&
        (dx * (marker.target.x - a.x) + dy * (marker.target.y - a.y)) / goal > .7) {
        adjustment = b.t - marker.t; break;
      }
    }
  }
  return { method: 'rule-based-context-v1', units: 'normalized_coordinate_units_and_ms',
    stimulus_observed: Boolean(marker), endpoint_error: distance(events.at(-1), targetAt(events.at(-1).t, stimuli)),
    adjustment_latency_proxy_ms: adjustment, overall: windowStats(events),
    pre: windowStats(events.filter(e => !marker || e.t < marker.t)),
    post: windowStats(events.filter(e => marker && e.t >= marker.t)), segments,
    graph: { nodes: segments.map((s, id) => ({ id, ...s })),
      edges: segments.slice(1).map((_, i) => ({ source: i, target: i + 1, relation: 'next' })) } };
}
