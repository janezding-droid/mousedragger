import { timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export default async function handler(request) {
  if (request.method !== 'GET') return json({ error: 'Only GET allowed' }, 405);
  const token = process.env.EXPORT_TOKEN;
  if (!token || token.length < 24) return json({ error: 'Export endpoint is not configured' }, 503);
  const provided = request.headers.get('authorization') || '';
  const expected = `Bearer ${token}`;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return json({ error: 'Unauthorized' }, 401);

  try {
    const url = new URL(request.url);
    const after = url.searchParams.get('after') || '';
    if (after.length > 200 || (after && !/^WEB_[a-zA-Z0-9_-]+$/.test(after))) return json({ error: 'Invalid cursor' }, 400);
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '25', 10) || 25));
    const store = getStore('mouse-captcha-records');
    const { blobs } = await store.list();
    const keys = blobs.map(({ key }) => key).filter((key) => key.startsWith('WEB_') && key > after).sort();
    const slice = keys.slice(0, limit);
    const records = await Promise.all(slice.map((key) => store.get(key, { type: 'json', consistency: 'strong' })));
    return json({ records: records.filter(Boolean), next_after: keys.length > limit ? slice.at(-1) : null, total_remaining_before_page: keys.length });
  } catch (error) {
    console.error('Export handler failed:', error);
    return json({ error: 'Export failed' }, 503);
  }
}
