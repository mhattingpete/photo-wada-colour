// Run: node colour.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hexToRgb, rgbToHex, srgbToLab, ciede2000, describeDeltaE, withLab } from './colour.js';

const D = JSON.parse(readFileSync(new URL('./wada.json', import.meta.url)));
const wada = withLab(D.colors);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// hex helpers
assert.deepEqual(hexToRgb('#f9c1ce'), [249, 193, 206]);
assert.deepEqual(hexToRgb('fff'), [255, 255, 255]);
assert.throws(() => hexToRgb('#12345'), /not a hex colour/);
assert.equal(rgbToHex([249.4, 193, 205.6]), '#f9c1ce');

// 1. Lab port matches wada.py (lab_srgb was computed by wada.py's srgb_to_lab)
for (const c of wada) c.lab.forEach((v, i) => near(v, c.lab_srgb[i], 0.01, `${c.slug} lab[${i}]`));

// 2. CIEDE2000 port reproduces every precomputed nearest[] distance
//    (wada.py computed those from the 2-decimal lab_srgb, so feed it the same inputs)
const byId = Object.fromEntries(wada.map(c => [c.id, c]));
for (const c of wada)
  for (const n of c.nearest)
    near(ciede2000(c.lab_srgb, byId[n.id].lab_srgb), n.delta_e_2000, 0.01, `${c.slug}→${n.id}`);

// 3. White is L* 100
near(srgbToLab([255, 255, 255])[0], 100, 0.01, 'white L*');
assert.equal(ciede2000([50, 10, 10], [50, 10, 10]), 0);

assert.equal(describeDeltaE(1.9), 'visually identical');
assert.equal(describeDeltaE(4.9), 'close cousin');
assert.equal(describeDeltaE(9.9), 'same idea, visibly different');
assert.equal(describeDeltaE(10), 'a different colour - do not claim a match');

console.log('ok');
