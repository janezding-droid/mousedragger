import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const response = (data, status = 200) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

export default async function handler(request) {
  if (request.method !== 'POST') return response({ ok: false, error: 'Only POST allowed' }, 405);
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return response({ ok: false, error: 'Expected JSON' }, 415);
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return response({ ok: false, error: 'Cross-origin submissions are not allowed' }, 403);
  }

  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 350_000) return response({ ok: false, error: 'Record too large' }, 413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid payload');
    if (body.consent !== true) throw Error('Consent is required');
    if (body.label !== 'human') throw Error('Online collection accepts self-reported human trials only');
    if (typeof body.participant_id !== 'string' || !/^[A-Za-z0-9_-]{2,40}$/.test(body.participant_id)) {
      throw Error('Use a 2-40 character pseudonymous participant code');
    }
    if (!['line', 'curve'].includes(body.task_type)) throw Error('Unknown task type');
    if (!Array.isArray(body.events) || body.events.length < 2 || body.events.length > 2500) throw Error('Invalid event count');
    if (!['mouse', 'pen', 'touch'].includes(body.pointer_type)) throw Error('Invalid pointer type');
    const events = body.events;
    let lastTime = -Infinity;
    const cleaned = [];
    for (const item of events) {
      if (!item || !finite(item.x) || !finite(item.y) || !finite(item.t) ||
          item.x < -1000 || item.x > 1800 || item.y < -1000 || item.y > 1400 ||
          item.t < lastTime || !['pointerdown', 'pointermove', 'pointerup'].includes(item.type)) {
        throw Error('Invalid event coordinates, timestamps or types');
      }
      lastTime = item.t;
      cleaned.push({
        type: item.type, t: item.t, x: item.x, y: item.y,
        button: Number.isInteger(item.button) ? item.button : 0,
        is_dragging: Boolean(item.is_dragging),
        pointer_type: ['mouse', 'pen', 'touch'].includes(item.pointer_type) ? item.pointer_type : body.pointer_type,
      });
    }
    if (events[0].type !== 'pointerdown' || events.at(-1).type !== 'pointerup') throw Error('Incomplete pointer sequence');
    if (events.at(-1).t - events[0].t > 180_000) throw Error('Trial duration exceeds the allowed limit');
    if (Math.hypot(events[0].x - 70, events[0].y - 280) > 40) throw Error('Trial did not start at START');
    const last = events.at(-1);
    const endpointError = Math.hypot(last.x - 730, last.y - 110);
    const id = `WEB_${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}_${randomUUID()}`;
    const record = {
      schema_version: '1.0', trial_id: id, recorded_at: new Date().toISOString(),
      source: 'netlify_web_collector', label_source: 'online_self_report_unverified',
      participant_id: body.participant_id, session_id: String(body.session_id || '').slice(0, 80),
      task_type: body.task_type, label: 'human', consent: true,
      completed: endpointError <= 45, endpoint_error_px: endpointError,
      viewport_width: 800, viewport_height: 400, pointer_type: body.pointer_type,
      target: { x: 730, y: 110 }, events: cleaned,
    };
    const store = getStore('mouse-captcha-records');
    await store.setJSON(id, record, { onlyIfNew: true });
    return response({ ok: true, trial_id: id, events: cleaned.length, completed: record.completed, storage: 'netlify_blobs' });
  } catch (error) {
    if (error instanceof SyntaxError) return response({ ok: false, error: 'Invalid JSON' }, 400);
    if (error instanceof Error && /Invalid|Consent|Only|Unknown|Use a|Incomplete|Trial duration|Online collection/.test(error.message)) {
      return response({ ok: false, error: error.message }, 400);
    }
    console.error('Record handler failed:', error);
    return response({ ok: false, error: 'Storage temporarily unavailable' }, 503);
  }
}
