import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const response = (data, status = 200) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

class ValidationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Limit bytes while streaming, independent of Content-Length. Cancel on overflow.
async function readBoundedBody(request) {
  const limit = 350_000;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      let part;
      try { part = await reader.read(); }
      catch { throw new ValidationError('Invalid request body'); }
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        // Cancellation failure must not hide the 413 response.
        await reader.cancel().catch(() => {});
        throw new ValidationError('Record too large', 413);
      }
      chunks.push(part.value);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)); }
    catch { throw new ValidationError('Invalid UTF-8'); }
  } finally { reader.releaseLock(); }
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

export function createRecordHandler({ storeFactory = getStore } = {}) {
  return async function handler(request) {
    if (request.method !== 'POST') return response({ ok: false, error: 'Only POST allowed' }, 405);
    if (!(request.headers.get('content-type') || '').includes('application/json')) {
      return response({ ok: false, error: 'Expected JSON' }, 415);
    }
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) {
      return response({ ok: false, error: 'Cross-origin submissions are not allowed' }, 403);
    }

    try {
      const raw = await readBoundedBody(request);
      let body;
      try { body = JSON.parse(raw); } catch { throw new ValidationError('Invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Invalid payload');
      if (body.consent !== true) throw new ValidationError('Consent is required');
      if (body.label !== 'human') throw new ValidationError('Online collection accepts self-reported human trials only');
      if (typeof body.participant_id !== 'string' || !/^[A-Za-z0-9_-]{2,40}$/.test(body.participant_id)) {
        throw new ValidationError('Use a 2-40 character pseudonymous participant code');
      }
      if (!['line', 'curve'].includes(body.task_type)) throw new ValidationError('Unknown task type');
      if (!Array.isArray(body.events) || body.events.length < 2 || body.events.length > 2500) throw new ValidationError('Invalid event count');
      if (!['mouse', 'pen', 'touch'].includes(body.pointer_type)) throw new ValidationError('Invalid pointer type');
      const events = body.events;
      let lastTime = -Infinity;
      const cleaned = [];
      for (const item of events) {
        if (!item || !finite(item.x) || !finite(item.y) || !finite(item.t) ||
            item.x < -1000 || item.x > 1800 || item.y < -1000 || item.y > 1400 ||
            item.t < 0 || item.t < lastTime || !['pointerdown', 'pointermove', 'pointerup'].includes(item.type)) {
          throw new ValidationError('Invalid event coordinates, timestamps or types');
        }
        if (item.pointer_type !== undefined && item.pointer_type !== body.pointer_type) {
          throw new ValidationError('Invalid event pointer type');
        }
        if (item.button !== undefined && (!Number.isInteger(item.button) || item.button < -1 || item.button > 5)) {
          throw new ValidationError('Invalid event button');
        }
        if (item.is_dragging !== undefined && typeof item.is_dragging !== 'boolean') {
          throw new ValidationError('Invalid dragging flag');
        }
        lastTime = item.t;
        cleaned.push({
          type: item.type, t: item.t, x: item.x, y: item.y,
          button: Number.isInteger(item.button) ? item.button : 0,
          is_dragging: Boolean(item.is_dragging),
          pointer_type: ['mouse', 'pen', 'touch'].includes(item.pointer_type) ? item.pointer_type : body.pointer_type,
        });
      }
      if (events[0].type !== 'pointerdown' || events.at(-1).type !== 'pointerup') throw new ValidationError('Incomplete pointer sequence');
      if (events.slice(1, -1).some(item => item.type !== 'pointermove')) throw new ValidationError('Invalid pointer sequence');
      if (events.at(-1).t <= events[0].t) throw new ValidationError('Invalid trial duration');
      if (events.at(-1).t - events[0].t > 180_000) throw new ValidationError('Trial duration exceeds the allowed limit');
      if (Math.hypot(events[0].x - 70, events[0].y - 280) > 40) throw new ValidationError('Trial did not start at START');
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
      const store = storeFactory('mouse-captcha-records');
      await store.setJSON(id, record, { onlyIfNew: true });
      return response({ ok: true, trial_id: id, events: cleaned.length, completed: record.completed, storage: 'netlify_blobs' });
    } catch (error) {
      if (error instanceof ValidationError) return response({ ok: false, error: error.message }, error.status);
      console.error('Record handler failed:', error);
      return response({ ok: false, error: 'Storage temporarily unavailable' }, 503);
    }
  };

}

export default createRecordHandler();
