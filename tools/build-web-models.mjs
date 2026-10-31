// Builds the lighter models the website loads, wrapped as scripts so the page also works
// when opened straight from disk. Writes assets/models/web/<name>.js.
//   node tools/build-web-models.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODELS = [['corn-kernel', 'build-kernel.mjs', 2048], ['eggplant', 'build-eggplant.mjs', 1024], ['carrot', 'build-carrot.mjs', 1024]];
mkdirSync('assets/models/web', { recursive: true });
for (const [name, builder, tex] of MODELS) {
  const temp = join(tmpdir(), `${name}-web.glb`);
  const run = spawnSync(process.execPath, [join('tools', builder), temp], { env: { ...process.env, QUALITY: 'web', TEX: String(tex) }, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr);
  const glb = readFileSync(temp);
  writeFileSync(join('assets/models/web', `${name}.js`), `(window.GLB_DATA=window.GLB_DATA||{})[${JSON.stringify(name)}]="${glb.toString('base64')}";\n`);
  rmSync(temp);
  console.log(name, (glb.length / 1048576).toFixed(2) + ' MB', JSON.parse(run.stdout).triangles ?? JSON.parse(run.stdout).rootTris + JSON.parse(run.stdout).greenTris, 'triangles');
}
