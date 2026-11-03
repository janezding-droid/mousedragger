// 純幾何描述，不是 WATSON 重現，也不推斷 human/bot。
export const FEATURE_VERSION = '1.0.0';
const finite = n => typeof n === 'number' && Number.isFinite(n);

export function extractFeatures(events, { target = null, pauseThresholdPxS = 5 } = {}) {
  if (!finite(pauseThresholdPxS) || pauseThresholdPxS < 0) throw new TypeError('停頓閾值須為非負有限數');
  if (target !== null && (!finite(target?.x) || !finite(target?.y) || Math.abs(target.x) > 1e6 || Math.abs(target.y) > 1e6)) throw new TypeError('目標座標不合法');
  if (!Array.isArray(events) || events.length < 2 || events.length > 2500) throw new TypeError('事件數須為 2–2500');
  events.forEach((e, i) => {
    const expected = i === 0 ? 'pointerdown' : i === events.length - 1 ? 'pointerup' : 'pointermove';
    if (!e || !finite(e.x) || !finite(e.y) || Math.abs(e.x) > 1e6 || Math.abs(e.y) > 1e6 || !finite(e.t) || e.t < 0 || e.t > Number.MAX_SAFE_INTEGER || e.type !== expected || (i && e.t < events[i - 1].t)) throw new TypeError(`事件 ${i} 的座標、時間或狀態不合法`);
  });
  const duration = (events.at(-1).t - events[0].t) / 1000;
  if (duration <= 0 || duration > 180) throw new TypeError('時長須大於零且不超過 180 秒');
  let path = 0, repeated = 0, zeroDt = 0, pause = 0;
  const speeds = [], accelerations = [];
  let previous = null;
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1], b = events[i];
    const distance = Math.hypot(b.x - a.x, b.y - a.y), dt = (b.t - a.t) / 1000;
    if (b.t > a.t && dt === 0) throw new RangeError('數值範圍無法可靠計算');
    path += distance;
    if (distance === 0) repeated++;
    if (dt === 0) { zeroDt++; previous = null; continue; }
    const speed = distance / dt, midpoint = ((a.t - events[0].t) + (b.t - events[0].t)) / 2000;
    speeds.push(speed);
    if (speed < pauseThresholdPxS) pause += dt;
    // 不跨越被排除的零時間段做加速度估計。
    if (previous) accelerations.push((speed - previous.speed) / (midpoint - previous.midpoint));
    previous = { speed, midpoint };
  }
  const displacement = Math.hypot(events.at(-1).x - events[0].x, events.at(-1).y - events[0].y);
  const notes = [];
  if (zeroDt) notes.push('同時間段保留路長，排除速度；加速度不跨此段。');
  if (!path) notes.push('路長為零，路徑效率無法定義。');
  if (!accelerations.length) notes.push('沒有相鄰有效速度段，加速度無法定義。');
  if (target === null) notes.push('未提供 target，終點誤差無法定義。');
  const result = {
    feature_version: FEATURE_VERSION,
    parameters: { pause_threshold_px_s: pauseThresholdPxS, pause_rule: 'speed < threshold', acceleration_rule: 'adjacent_valid_segment_midpoints_no_gap' },
    metrics: { duration_s: duration, path_length_px: path, displacement_px: displacement, mean_speed_px_s: path / duration,
      max_segment_speed_px_s: Math.max(...speeds), segment_speeds_px_s: speeds,
      accelerations_px_s2: accelerations, mean_abs_acceleration_px_s2: accelerations.length ? accelerations.reduce((s, a) => s + Math.abs(a), 0) / accelerations.length : null,
      path_efficiency: path ? Math.min(1, displacement / path) : null, pause_duration_s: pause,
      repeated_position_ratio: repeated / (events.length - 1), endpoint_error_px: target === null ? null : Math.hypot(events.at(-1).x - target.x, events.at(-1).y - target.y) },
    quality: { zero_dt_segments: zeroDt, valid_speed_segments: speeds.length, valid_acceleration_pairs: accelerations.length, notes },
  };
  // JSON 不可把溢位默默轉成 null；極小正時間差也須明確拒絕。
  function check(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('數值範圍無法可靠計算');
    if (value && typeof value === 'object') Object.values(value).forEach(check);
  }
  check(result);
  return result;
}

export function describeFeatures(features) {
  const m = features.metrics;
  return `時長 ${m.duration_s.toFixed(3)} 秒；路長 ${m.path_length_px.toFixed(2)} px；均速 ${m.mean_speed_px_s.toFixed(2)} px/s；路徑效率 ${m.path_efficiency === null ? '無法定義' : m.path_efficiency.toFixed(3)}；低於 ${features.parameters.pause_threshold_px_s} px/s 的停頓 ${m.pause_duration_s.toFixed(3)} 秒。重複位置比例 ${(m.repeated_position_ratio * 100).toFixed(1)}%。僅為幾何描述，不判定真人、機器人或攻擊。`;
}

// 保留舊紀錄原貌；衍生結果另存 sidecar，不回寫 schema 1.0 或正式儲存。
export function analyzeRecord(record, options = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('紀錄須為物件');
  const features = extractFeatures(record.events, { target: record.target ?? null, ...options });
  return { feature_version: FEATURE_VERSION, trial_id: record.trial_id ?? null,
    data_source: record.source ?? 'unspecified', label: record.label ?? null,
    label_source: record.label_source ?? 'unspecified_unverified',
    completed_reported: typeof record.completed === 'boolean' ? record.completed : null,
    features, summary_zh: describeFeatures(features) };
}
