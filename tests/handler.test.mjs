import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../record.mjs';
const req = (body, options = {}) => new Request('https://example.test/api/record', {
  method:'POST', headers:{'Content-Type':'application/json'}, body, ...options,
});
test('HTTP endpoint rejects wrong method, content type and cross-origin request', async () => {
  assert.equal((await handler(new Request('https://example.test/api/record'))).status,405);
  assert.equal((await handler(req('{}',{headers:{'Content-Type':'text/plain'}}))).status,415);
  assert.equal((await handler(req('{}',{headers:{'Content-Type':'application/json',Origin:'https://other.test'}}))).status,403);
});
test('HTTP endpoint returns 400 for malformed JSON, invalid schema and invalid start', async () => {
  assert.equal((await handler(req('{'))).status,400);
  assert.equal((await handler(req('{}'))).status,400);
  const res = await handler(req(JSON.stringify({consent:true,label:'human',participant_id:'P_TEST',
    task_type:'line',pointer_type:'mouse',events:[{type:'pointerdown',x:200,y:280,t:0},{type:'pointerup',x:730,y:110,t:100}]})));
  assert.equal(res.status,400); assert.match((await res.json()).error,/START/);
});
test('HTTP endpoint bounds payload bytes and omits cache storage', async () => {
  const res = await handler(req('x'.repeat(350001)));
  assert.equal(res.status,413); assert.equal(res.headers.get('cache-control'),'no-store');
});
