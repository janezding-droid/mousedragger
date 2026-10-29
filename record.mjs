import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { cleanRecord, ValidationError } from './validation.mjs';
const response = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store' },
});
export default async function handler(request) {
  if (request.method !== 'POST') return response({ ok: false, error: 'Only POST allowed' }, 405);
  if (!(request.headers.get('content-type') || '').includes('application/json')) return response({ ok: false, error: 'Expected JSON' }, 415);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return response({ ok: false, error: 'Cross-origin submissions are not allowed' }, 403);
  try {
    const reader = request.body?.getReader();
    if (!reader) return response({ ok: false, error: 'Missing body' }, 400);
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 350000) { await reader.cancel(); return response({ ok: false, error: 'Record too large' }, 413); }
      chunks.push(Buffer.from(value));
    }
    const record = cleanRecord(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const id = 'WEB_' + new Date().toISOString().replace(/[-:.]/g, '') + '_' + randomUUID();
    Object.assign(record, { trial_id: id, recorded_at: new Date().toISOString() });
    await getStore('mouse-captcha-records').setJSON(id, record, { onlyIfNew: true });
    return response({ ok: true, trial_id: id, events: record.events.length, completed: record.completed, storage: 'netlify_blobs' });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ValidationError) return response({ ok: false, error: error.message }, 400);
    console.error('Record handler failed:', error);
    return response({ ok: false, error: 'Storage temporarily unavailable' }, 503);
  }
}
