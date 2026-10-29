// Offline feature tables: metadata stays separate to avoid accidental label leakage.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { summarizeTrial } from './experiment.mjs';
import { pathToFileURL } from 'node:url';
export function featureRows(records) {
  const metadata = [], baseline = [], context = [], graphs = [];
  for (const [i, r] of records.entries()) {
    if (r.schema_version !== '2.0') continue;
    if (!Array.isArray(r.events) || r.events.length < 2 || !Array.isArray(r.stimuli)) throw Error(`Invalid v2 record at index ${i}`);
    const a = summarizeTrial(r), id = r.trial_id || `row_${i + 1}`;
    metadata.push({ row_id: id, participant_id: r.participant_id, session_id: r.session_id,
      trial_index: r.trial_index, label: r.label, label_source: r.label_source || 'unknown',
      task_type: r.task_type, condition: r.experiment?.condition, input_device: r.input_device,
      stimulus_observed: a.stimulus_observed, end_reason: r.end_reason,
      completed: r.completed, upload_status: r.upload_status || 'exported_from_server' });
    const base = { row_id: id, duration_ms: a.overall.duration_ms, path_length: a.overall.path_length,
      mean_speed: a.overall.mean_speed, low_motion_ms: a.overall.low_motion_ms,
      endpoint_error: a.endpoint_error };
    baseline.push(base);
    context.push({ ...base, pre_mean_speed: a.pre.mean_speed, post_mean_speed: a.post.mean_speed,
      pre_path_length: a.pre.path_length, post_path_length: a.post.path_length,
      post_low_motion_ms: a.post.low_motion_ms,
      post_direction_changes: a.segments.filter(s => s.stage === 'post_stimulus' && s.kind === 'direction_change').length,
      adjustment_latency_proxy_ms: a.adjustment_latency_proxy_ms });
    graphs.push({ row_id: id, ...a.graph });
  }
  if (!baseline.length) throw Error('No v2 records found; legacy records need a separate baseline analysis');
  return { metadata, baseline, context, graphs };
}
export function csv(rows) {
  const keys = Object.keys(rows[0]);
  // Spreadsheet formula prefixes in metadata are escaped; feature cells are numbers.
  const cell = value => {
    let s = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[=+@\-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [keys.map(cell).join(','), ...rows.map(r => keys.map(k => cell(r[k])).join(','))].join('\n') + '\n';
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [, , input, out = 'analysis-output'] = process.argv;
    if (!input) throw Error('Usage: node analyze-records.mjs records.json output-directory');
    const data = JSON.parse(await readFile(input, 'utf8'));
    const rows = featureRows(Array.isArray(data) ? data : data.records);
    await mkdir(out, { recursive: true });
    for (const name of ['metadata', 'baseline', 'context']) await writeFile(join(out, name + '.csv'), csv(rows[name]));
    await writeFile(join(out, 'graphs.json'), JSON.stringify(rows.graphs, null, 2));
    console.log(`Exported ${rows.baseline.length} v2 trials to ${out}. No classifier was trained.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
