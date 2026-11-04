import test from 'node:test';
import assert from 'node:assert/strict';
import { convertSession } from './balabit.mjs';
const header = 'record timestamp,client timestamp,button,state,x,y\n';
const convert = rows => convertSession(header + rows.join('\n'), 'training_files/userX/session_X');
test('seconds map exactly to relative ms; real endpoint rows survive; no consent or target invented', () => {
  const result = convert(['10,9,Left,Pressed,0,0', '11,10,NoButton,Drag,3,4', '12,11,Left,Released,6,8']);
  assert.deepEqual(result.fragments[0].events.map(e => e.t), [0,1000,2000]);
  assert.deepEqual(result.fragments[0].source_rows, [2,3,4]);
  assert.equal(result.fragments[0].metrics.path_length_px, 10);
  assert.equal(result.fragments[0].metrics.mean_speed_px_s, 5);
  for (const k of ['target','consent','completed']) assert.equal(result.fragments[0][k], null);
});
test('zero time segments retained but zero duration rejected', () => {
  const r = convert(['0,0,Left,Pressed,0,0','0,0,NoButton,Drag,3,4','1,1,Left,Released,6,8']);
  assert.equal(r.fragments[0].quality.zero_dt_segments, 1);
  assert.equal(convert(['0,0,Left,Pressed,0,0','0,0,Left,Released,1,1']).fragments.length,0);
});
test('orphan release, mismatch, interrupted and unclosed press cannot fabricate complete fragments', () => {
  const r=convert(['0,0,Left,Released,0,0','1,1,Left,Pressed,0,0','2,2,Right,Released,1,1','3,3,Left,Pressed,1,1','4,4,Right,Pressed,1,1']);
  assert.equal(r.fragments.length,0);
  for (const k of ['orphan_release','button_mismatch','interrupted_press','unterminated_press']) assert.equal(r.quality.rejections[k],1);
});
test('invalid, negative, reversed and unknown rows break active segment', () => {
  for (const row of ['-1,0,NoButton,Drag,1,1','0.5,0.5,NoButton,Drag,NaN,1','0.5,0.5,Other,Move,1,1','0.5,0.5,NoButton,Drag,,1']) {
    assert.equal(convert(['1,1,Left,Pressed,0,0',row,'2,2,Left,Released,1,1']).fragments.length,0);
  }
  assert.equal(convert(['1,1,Left,Pressed,0,0','0,0,NoButton,Drag,1,1','2,2,Left,Released,1,1']).fragments.length,0);
});
test('source row identity persists when scroll is excluded', () => {
  const r=convert(['0,0,Right,Pressed,0,0','0.5,0.5,Scroll,Down,0,0','1,1,Right,Released,1,1']);
  assert.deepEqual(r.fragments[0].source_rows,[2,4]); assert.equal(r.quality.ignored_scroll,1);
});
test('bad header rejected; no arbitrary free motion wrapped into pointer events', () => {
  assert.throws(()=>convertSession('x,y\n0,1','x'));
  assert.equal(convert(['0,0,NoButton,Move,0,0','1,1,NoButton,Move,1,1']).fragments.length,0);
});

test('duration rejection categories distinguish zero and overlong source fragments',()=>{
  assert.equal(convert(['0,0,Left,Pressed,0,0','0,0,Left,Released,1,1']).quality.rejections.zero_duration,1);
  assert.equal(convert(['0,0,Left,Pressed,0,0','181,181,Left,Released,1,1']).quality.rejections.overlong_duration,1);
});
