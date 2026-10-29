import { START, INITIAL_TARGET, START_RADIUS, TARGET_RADIUS, MAX_EVENTS,
  distance, makePlan, summarizeTrial } from './experiment.mjs';

const $ = id => document.getElementById(id);
const stage = $('stage'), trace = $('trace'), status = $('status');
const controls = ['pid', 'task', 'condition', 'device', 'consent'].map($);
const session = 'S_' + crypto.randomUUID();
const records = [];
let active = null, trialIndex = 0, busy = false;
const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
function lock(value) { controls.forEach(el => { el.disabled = value; }); }
function drawTarget(target, task = $('task').value) {
  $('target-circle').setAttribute('cx', target.x); $('target-circle').setAttribute('cy', target.y);
  $('target-label').setAttribute('x', target.x); $('target-label').setAttribute('y', target.y + 50);
  $('guide').setAttribute('d', task === 'curve' ? `M 70 280 Q 400 10 ${target.x} ${target.y}` : `M 70 280 L ${target.x} ${target.y}`);
}
function clearStage() { trace.setAttribute('points', ''); drawTarget(INITIAL_TARGET); }
function point(event) {
  const r = stage.getBoundingClientRect();
  return { x: (event.clientX - r.left) * 800 / r.width, y: (event.clientY - r.top) * 400 / r.height };
}
function elapsed(trial) { return performance.now() - trial.started; }
function addEvent(trial, type, p, t = elapsed(trial)) {
  trial.events.push({ type, t, x: p.x, y: p.y, button: 0,
    is_dragging: type === 'pointerdown' || type === 'pointermove', pointer_type: trial.pointer_type });
  trace.setAttribute('points', trial.events.map(e => `${e.x},${e.y}`).join(' '));
}
function showSummary(record) {
  const a = record.analysis, latency = a.adjustment_latency_proxy_ms;
  $('summary').textContent = [
    `第 ${record.trial_index} 次｜${record.experiment.condition === 'jump' ? '動態目標' : '固定目標'}｜${record.completed ? '到達目標' : '未完成'}`,
    `耗時 ${Math.round(a.overall.duration_ms)} ms；路徑長 ${Math.round(a.overall.path_length)}；終點誤差 ${Math.round(a.endpoint_error)}（標準座標單位）。`,
    a.stimulus_observed ? `標記前／後事件：${a.pre.event_count}／${a.post.event_count}；方向調整延遲：${latency === null ? '未觀測到或不適用' : Math.round(latency) + ' ms（代理指標）'}。` : '本次在刺激標記前結束，無法分析標記後反應。',
    '規則式摘要；不提供真人／AI 判定。',
  ].join('\n');
  $('summary').style.whiteSpace = 'pre-wrap';
  $('segments').replaceChildren();
  const names = { movement: '移動', low_motion: '低移動量', target_approach: '接近目標', direction_change: '方向改變', stimulus_boundary: '跨越刺激標記' };
  for (const s of a.segments) {
    const span = document.createElement('span');
    span.textContent = `${s.stage === 'pre_stimulus' ? '前' : s.stage === 'post_stimulus' ? '後' : '邊界'}：${names[s.kind]} ${Math.round(s.start_ms)}–${Math.round(s.end_ms)} ms`;
    span.style.cssText = 'display:inline-block;padding:5px 8px;margin:3px;border-radius:6px;background:#eef3f8';
    $('segments').append(span);
  }
}
async function submit(record) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    // Do not send derived graphs: the backend recomputes them from bounded raw data.
    const { analysis, upload_status, ...payload } = record;
    const res = await fetch('/api/record', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal });
    const result = await res.json();
    if (!res.ok || !result.ok) throw Error(result.error || '伺服器拒絕資料');
    record.upload_status = 'confirmed'; record.trial_id = result.trial_id;
    status.textContent = `資料已儲存至線上資料庫。trial_id=${result.trial_id}\n第 ${record.trial_index} 次；事件 ${record.events.length} 筆。可從 START 直接開始下一次。`;
  } catch (error) {
    record.upload_status = 'unconfirmed';
    status.textContent = `此次資料尚未確認寫入：${error.name === 'AbortError' ? '連線逾時' : error.message}\n請下載 JSON 備份；備份仍包含本次資料。可繼續下一次。`;
  } finally { clearTimeout(timer); busy = false; lock(false); }
}
function finish(reason, event = null) {
  const trial = active; if (!trial) return;
  active = null; busy = true;
  clearTimeout(trial.stimulusTimer); clearTimeout(trial.timeoutTimer);
  const last = trial.events.at(-1);
  addEvent(trial, reason === 'released' ? 'pointerup' : 'pointercancel', event ? point(event) : last);
  if (stage.hasPointerCapture(trial.pointerId)) stage.releasePointerCapture(trial.pointerId);
  const analysis = summarizeTrial(trial);
  const record = { schema_version: '2.0', consent: true, label: 'human',
    label_source: 'online_self_report_unverified', participant_id: trial.participant_id,
    session_id: session, trial_index: trial.index, task_type: trial.task_type,
    input_device: trial.input_device, pointer_type: trial.pointer_type,
    viewport_width: 800, viewport_height: 400, rendered_stage: trial.rendered_stage,
    experiment: trial.experiment, stimuli: trial.stimuli, events: trial.events,
    end_reason: reason, completed: reason === 'released' && analysis.endpoint_error <= TARGET_RADIUS,
    analysis, upload_status: 'pending' };
  records.push(record); showSummary(record);
  status.textContent = `第 ${record.trial_index} 次已記錄，正在儲存…`;
  void submit(record);
}
stage.addEventListener('pointerdown', event => {
  if (active || busy || !event.isPrimary || event.button !== 0) return;
  if (!/^[A-Za-z0-9_-]{2,40}$/.test($('pid').value.trim())) {
    status.textContent = '請先填入 2～40 字元的英數字、底線或連字號代碼。'; return;
  }
  if (!$('consent').checked) { status.textContent = '請先閱讀並勾選資料蒐集同意。'; return; }
  const p = point(event);
  if (distance(p, START) > START_RADIUS) { status.textContent = '請從 START 藍圈內開始。'; return; }
  event.preventDefault(); clearStage(); lock(true);
  const r = stage.getBoundingClientRect();
  const trial = { index: ++trialIndex, pointerId: event.pointerId, pointer_type: event.pointerType || 'mouse',
    participant_id: $('pid').value.trim(), task_type: $('task').value, input_device: $('device').value,
    rendered_stage: { width: r.width, height: r.height }, started: performance.now(),
    experiment: makePlan($('condition').value, random), events: [], stimuli: [] };
  active = trial; addEvent(trial, 'pointerdown', p, 0); stage.setPointerCapture(event.pointerId);
  status.textContent = '正在記錄；目標可能移動，請拖到綠圈後放開。';
  trial.stimulusTimer = setTimeout(() => {
    if (active !== trial) return;
    // rAF ties the marker to the frame requesting the target redraw. It is not
    // a hardware-verified display-onset measurement.
    requestAnimationFrame(() => {
      if (active !== trial) return;
      const plan = trial.experiment;
      trial.stimuli.push({ type: plan.condition === 'jump' ? 'target_change' : 'control_marker',
        t: elapsed(trial), target: { ...plan.next_target } });
      drawTarget(plan.next_target, trial.task_type);
    });
  }, trial.experiment.stimulus_delay_ms);
  trial.timeoutTimer = setTimeout(() => finish('timeout'), 175000);
});
stage.addEventListener('pointermove', event => {
  if (!active || event.pointerId !== active.pointerId) return;
  // Reserve a slot for the terminating event; never silently truncate a trial.
  if (active.events.length >= MAX_EVENTS - 1) { finish('event_limit', event); return; }
  addEvent(active, 'pointermove', point(event));
});
stage.addEventListener('pointerup', e => { if (active && e.pointerId === active.pointerId) finish('released', e); });
stage.addEventListener('pointercancel', e => { if (active && e.pointerId === active.pointerId) finish('pointercancel', e); });
stage.addEventListener('lostpointercapture', e => { if (active && e.pointerId === active.pointerId) finish('lost_capture'); });
$('reset').addEventListener('click', () => {
  if (active) finish('reset');
  else if (!busy) { clearStage(); status.textContent = '準備就緒，請從 START 開始。'; }
});
$('task').addEventListener('change', clearStage);
window.addEventListener('resize', () => { if (active) finish('resize'); });
document.addEventListener('visibilitychange', () => { if (document.hidden && active) finish('visibility'); });
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `mouse_context_${Date.now()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
clearStage();
