import { extractFeatures } from '../features.mjs';
import { createHash } from 'node:crypto';

const hash = s => createHash('sha256').update(s).digest('hex');
const HEADER = 'record timestamp,client timestamp,button,state,x,y';
export function convertSession(text, source) {
  const lines = text.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  if (lines.shift() !== HEADER) throw new Error('Unexpected CSV header');
  const quality = { rows: lines.length, states: {}, rejections: {}, ignored_scroll: 0, orphan_moves: 0, time_reversals: 0 };
  const reject = key => { quality.rejections[key] = (quality.rejections[key] ?? 0) + 1; };
  let active = null, lastTime = null;
  const fragments = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const [record, client, button, state, x, y] = cells;
    const row = i + 2;
    const t = Number(record), ct = Number(client), px = Number(x), py = Number(y);
    quality.states[`${button}/${state}`] = (quality.states[`${button}/${state}`] ?? 0) + 1;
    if (cells.length !== 6 || [record, client, x, y].some(s => s?.trim() === '') || ![t, ct, px, py].every(Number.isFinite) || t < 0 || ct < 0) {
      reject('invalid_row'); active = null; continue;
    }
    if (lastTime !== null && t < lastTime) { quality.time_reversals++; if (active) { reject('time_reversal'); active = null; } }
    lastTime = t;
    const event = { x: px, y: py, source_row: row, record_timestamp_s: t, client_timestamp_s: ct };
    if (state === 'Pressed' && ['Left', 'Right'].includes(button)) {
      if (active) reject('interrupted_press');
      active = { button, points: [event] }; continue;
    }
    if (state === 'Released' && ['Left', 'Right'].includes(button)) {
      if (!active) { reject('orphan_release'); continue; }
      if (button !== active.button) { reject('button_mismatch'); active = null; continue; }
      active.points.push(event);
      const points = active.points, start = points[0].record_timestamp_s;
      const events = points.map((p, index) => ({ x: p.x, y: p.y, t: (p.record_timestamp_s - start) * 1000,
        type: index === 0 ? 'pointerdown' : index === points.length - 1 ? 'pointerup' : 'pointermove' }));
      try {
        if (events.at(-1).t === 0) { reject('zero_duration'); active = null; continue; }
        if (events.at(-1).t > 180000) { reject('overlong_duration'); active = null; continue; }
        const features = extractFeatures(events);
        const { segment_speeds_px_s, accelerations_px_s2, ...metrics } = features.metrics;
        fragments.push({ source, source_rows: points.map(p => p.source_row), source_start_s: start,
          source_end_s: t, button, action: points.length > 2 ? 'held_motion' : 'press_release',
          fingerprint: hash(JSON.stringify(events)), events, metrics, quality: features.quality,
          time_mapping: '1000 * (record_timestamp_s - source_start_s)',
          target: null, consent: null, completed: null, label: 'legal', label_source: 'official_training_files_statement' });
      } catch (e) { reject(`feature_rejected:${e.message}`); }
      active = null; continue;
    }
    if (button === 'Scroll' && ['Up', 'Down'].includes(state)) { quality.ignored_scroll++; continue; }
    if (button === 'NoButton' && ['Move', 'Drag'].includes(state)) {
      if (active) active.points.push(event); else quality.orphan_moves++;
      continue;
    }
    reject('unknown_button_state'); active = null;
  }
  if (active) reject('unterminated_press');
  return { source, quality, fragments };
}
