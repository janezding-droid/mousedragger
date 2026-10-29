// Netlify build entry for repositories that store every uploaded file at root.
// Source: index.html + record.mjs + export.mjs, all side by side.
import { mkdir, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const required = ['index.html', 'record.mjs', 'export.mjs'];
for (const filename of required) {
  try {
    if (!(await stat(join(root, filename))).isFile()) throw Error('not a file');
  } catch {
    throw Error(`Missing required file at repository root: ${filename}`);
  }
}
await mkdir(join(root, 'dist'), { recursive: true });
await mkdir(join(root, 'netlify', 'functions'), { recursive: true });
await copyFile(join(root, 'index.html'), join(root, 'dist', 'index.html'));
for (const name of ['record.mjs', 'export.mjs']) {
  await copyFile(join(root, name), join(root, 'netlify', 'functions', name));
}
console.log('Generated dist/index.html and netlify/functions/*.mjs.');
console.log('Only dist/ is publicly published. Backend source remains outside dist/.');
