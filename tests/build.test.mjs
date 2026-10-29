import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
test('build packages two endpoints, includes dependencies and excludes private files', async () => {
  const root = await mkdtemp(join(tmpdir(),'mouse-build-'));
  try {
    for (const f of ['build.mjs','index.html','collector.mjs','experiment.mjs','validation.mjs','record.mjs','export.mjs']) {
      await copyFile(new URL('../'+f,import.meta.url),join(root,f));
    }
    await mkdir(join(root,'netlify','functions'),{recursive:true});
    await writeFile(join(root,'netlify','functions','stale.mjs'),'bad');
    await writeFile(join(root,'private.json'),'secret');
    execFileSync(process.execPath,['build.mjs'],{cwd:root});
    assert.deepEqual((await readdir(join(root,'dist'))).sort(),['collector.mjs','experiment.mjs','index.html']);
    assert.deepEqual((await readdir(join(root,'netlify','functions'))).sort(),['export','record']);
    const helpers = await readdir(join(root,'netlify','functions','record'));
    assert.ok(helpers.includes('validation.mjs')); assert.ok(helpers.includes('experiment.mjs'));
    assert.equal(await readFile(join(root,'netlify','functions','export','export.mjs'),'utf8'),
      await readFile(new URL('../export.mjs',import.meta.url),'utf8'));
  } finally { await rm(root,{recursive:true,force:true}); }
});
