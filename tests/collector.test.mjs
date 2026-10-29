import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRecord } from '../validation.mjs';

// Exercise the real collector module with a minimal DOM and deterministic clock.
// This verifies state/payload behavior, not browser rendering or hardware timing.
test('collector isolates consecutive trials, records jumps/cancellations, and backs up failed uploads', async () => {
  const originals = Object.fromEntries(['document','window','performance','fetch','setTimeout','clearTimeout','requestAnimationFrame'].map(k => [k, globalThis[k]]));
  let now = 10000, timerId = 0, networkFailure = false;
  const timers = new Map(), uploaded = [], links = [];
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.checked = false; this.disabled = false; this.style = {}; this.attrs = {}; this.children = []; this.captures = new Set(); }
    setAttribute(k,v) { this.attrs[k] = String(v); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 400 }; }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    replaceChildren() { this.children = []; }
    append(c) { this.children.push(c); }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const els = Object.fromEntries(['stage','trace','status','pid','task','condition','device','consent',
    'target-circle','target-label','guide','summary','segments','reset','export'].map(k => [k,new Element()]));
  const doc = new EventTarget(); doc.hidden = false;
  doc.getElementById = id => els[id];
  doc.createElement = tag => { const el = new Element(); if (tag === 'a') links.push(el); return el; };
  const emit = (type, x, y, pointerId = 1) => {
    const e = new Event(type, { cancelable:true });
    Object.assign(e, { clientX:x,clientY:y,pointerId,pointerType:'mouse',button:0,isPrimary:true });
    els.stage.dispatchEvent(e);
  };
  const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
  try {
    globalThis.document = doc; globalThis.window = new EventTarget(); globalThis.performance = {now:()=>now};
    globalThis.setTimeout = (fn,ms) => { const id=++timerId; timers.set(id,{fn,ms}); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    globalThis.requestAnimationFrame = fn => fn(now);
    globalThis.fetch = async (_, options) => {
      const r = JSON.parse(options.body); uploaded.push(r);
      if (networkFailure) throw Error('offline');
      const stored = cleanRecord(r);
      return { ok:true, json:async()=>({ok:true,trial_id:'TEST_'+uploaded.length,completed:stored.completed}) };
    };
    await import('../collector.mjs');
    els.task.value = 'line'; els.condition.value = 'static'; els.device.value = 'mouse';
    emit('pointerdown',70,280); assert.equal(uploaded.length,0);
    assert.match(els.status.textContent,/代碼/);
    els.pid.value='P_TEST'; emit('pointerdown',70,280); assert.match(els.status.textContent,/同意/);
    els.consent.checked=true;
    emit('pointerdown',70,280); assert.equal(els.pid.disabled,true);
    now+=100; emit('pointermove',300,200,2); // unrelated pointer ignored
    emit('pointermove',300,200); now+=100; emit('pointerup',730,110); await flush();
    assert.equal(uploaded.length,1); assert.equal(uploaded[0].events.length,3);
    assert.equal(uploaded[0].events[0].t,0); assert.equal(uploaded[0].stimuli.length,0);
    assert.equal(els.pid.disabled,false);
    // Begin directly, without pressing reset. Event history must be fresh.
    now+=1000; emit('pointerdown',70,280); now+=100; emit('pointerup',730,110); await flush();
    assert.equal(uploaded[1].events.length,2); assert.equal(uploaded[1].events[0].t,0);
    assert.equal(uploaded[1].trial_index,2);
    // Target changes at the marker frame; server and client agree on final target.
    els.condition.value='jump'; now+=1000; emit('pointerdown',70,280);
    now+=300; emit('pointermove',300,200);
    const stimulus = [...timers.values()].find(t => t.ms>=450 && t.ms<=950);
    assert.ok(stimulus); now+=1000; stimulus.fn();
    const target={x:Number(els['target-circle'].attrs.cx),y:Number(els['target-circle'].attrs.cy)};
    now+=200; emit('pointerup',target.x,target.y); await flush();
    assert.equal(uploaded[2].stimuli[0].type,'target_change');
    assert.equal(uploaded[2].completed,true);
    // Cancel at any point; never upload as successful.
    now+=1000; emit('pointerdown',70,280); now+=100; els.reset.click(); await flush();
    assert.equal(uploaded[3].end_reason,'reset'); assert.equal(uploaded[3].events.at(-1).type,'pointercancel');
    // Resize/visibility/pointercancel each terminate just once.
    for (const [reason, trigger] of [
      ['resize',()=>window.dispatchEvent(new Event('resize'))],
      ['visibility',()=>{doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));doc.hidden=false;}],
      ['pointercancel',()=>emit('pointercancel',100,200)],
    ]) {
      now+=1000; emit('pointerdown',70,280); now+=100; trigger(); await flush();
      assert.equal(uploaded.at(-1).end_reason,reason); assert.equal(els.pid.disabled,false);
    }
    networkFailure=true; now+=1000; emit('pointerdown',70,280); now+=100; emit('pointerup',730,110); await flush();
    assert.match(els.status.textContent,/尚未確認寫入/); assert.equal(els.pid.disabled,false);
    els.export.click();
    const saved = await (await originals.fetch(links.at(-1).href)).json();
    assert.equal(saved.length,8); assert.equal(saved.at(-1).upload_status,'unconfirmed');
    assert.equal(saved[0].analysis.method,'rule-based-context-v1');
  } finally { for (const [k,v] of Object.entries(originals)) { if(v===undefined) delete globalThis[k]; else globalThis[k]=v; } }
});
