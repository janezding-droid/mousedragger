// Netlify build entry for repositories that store every uploaded file at root.
// Source: index.html + record.mjs + export.mjs, all side by side.
import { mkdir, copyFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const required = ['index.html', 'collector.mjs', 'experiment.mjs', 'validation.mjs', 'record.mjs', 'export.mjs'];
for (const filename of required) {
  try {
    if (!(await stat(join(root, filename))).isFile()) throw Error('not a file');
  } catch {
    throw Error(`Missing required file at repository root: ${filename}`);
  }
}
// Both destinations are generated and ignored by git. Clear stale entry points.
await rm(join(root, 'dist'), { recursive: true, force: true });
await rm(join(root, 'netlify', 'functions'), { recursive: true, force: true });
await mkdir(join(root, 'dist'), { recursive: true });
await mkdir(join(root, 'netlify', 'functions', 'record'), { recursive: true });
await mkdir(join(root, 'netlify', 'functions', 'export'), { recursive: true });
for (const name of ['index.html', 'collector.mjs', 'experiment.mjs']) {
  await copyFile(join(root, name), join(root, 'dist', name));
}
// A dedicated folder makes helper modules part of record, not extra endpoints.
for (const name of ['record.mjs', 'experiment.mjs', 'validation.mjs']) {
  await copyFile(join(root, name), join(root, 'netlify', 'functions', 'record', name));
}
await copyFile(join(root, 'export.mjs'), join(root, 'netlify', 'functions', 'export', 'export.mjs'));
console.log('Generated dist/ and isolated record/export function folders.');
console.log('Only dist/ is publicly published. Backend source remains outside dist/.');
