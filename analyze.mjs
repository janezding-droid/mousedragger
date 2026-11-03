import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeRecord } from './features.mjs';

// 離線處理本機備份陣列或 /api/export 的 {records}；不存取網路。
try {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw Error('用法：node analyze.mjs input.json output.json（輸出須為新檔案）');
  if (resolve(input) === resolve(output)) throw Error('輸入與輸出不可相同');
  if ((await stat(input)).size > 10_000_000) throw Error('本機輸入上限為 10 MB');
  const payload = JSON.parse(await readFile(input, 'utf8'));
  const records = Array.isArray(payload) ? payload : payload?.records;
  if (!Array.isArray(records) || records.length > 1000) throw Error('須提供紀錄陣列，單次上限 1000 筆');
  const results = records.map((record, index) => {
    try { return { index, ok: true, ...analyzeRecord(record) }; }
    catch (error) { return { index, ok: false, error: error.message }; }
  });
  const report = { feature_version: '1.0.0', total: results.length, failed: results.filter(r => !r.ok).length, results };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  console.log(`已分析 ${report.total} 筆，失敗 ${report.failed} 筆；來源資料未修改。`);
  if (report.failed) process.exitCode = 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }
