// Run: node colour.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hexToRgb, rgbToHex, srgbToLab, ciede2000, describeDeltaE, withLab,
  dominantColours, nearestWada, cropRect,
} from './colour.js';

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

// Builds an RGBA buffer from [[hex, count, alpha?], ...]
const buffer = parts => Uint8ClampedArray.from(
  parts.flatMap(([hex, count, alpha = 255]) => Array(count).fill([...hexToRgb(hex), alpha]).flat()),
);
const byName = name => wada.find(c => c.name === name);

// 4. 60/40 image of two exact Wada colours → both found at ΔE ≈ 0, deterministically
const indigo = byName('Deep Indigo'), pink = byName('Hermosa Pink');
const img = buffer([[pink.hex, 40], [indigo.hex, 60]]);
const dom = dominantColours(img, 2);
assert.deepEqual(dom.map(d => [d.hex, d.share]), [[indigo.hex, 0.6], [pink.hex, 0.4]]);
for (const [d, c] of [[dom[0], indigo], [dom[1], pink]]) {
  const best = nearestWada(d.lab, wada)[0];
  assert.equal(best.slug, c.slug);
  assert.ok(best.deltaE < 0.01);
  assert.equal(best.verdict, 'visually identical');
  assert.equal(best.tier, c.workwear.tier);
}
assert.deepEqual(dominantColours(img, 2), dom, 'deterministic');

// nearestWada shape and order
const m = nearestWada(srgbToLab([31, 49, 73]), wada);
assert.equal(m.length, 3);
assert.ok(m[0].deltaE <= m[1].deltaE && m[1].deltaE <= m[2].deltaE);
assert.deepEqual(Object.keys(m[0]).sort(), ['deltaE', 'hex', 'name', 'slug', 'tier', 'verdict']);

// 5. fully transparent → []
assert.deepEqual(dominantColours(buffer([['#123456', 10, 0]])), []);

// Review focus 1: uniform buffer → one colour, share 1
assert.deepEqual(dominantColours(buffer([['#1f3149', 500]])).map(d => [d.hex, d.share]), [['#1f3149', 1]]);

// Review focus 2: fewer pixels than k
const few = dominantColours(buffer([['#000000', 1], ['#ffffff', 1]]), 3);
assert.equal(few.length, 2);
near(few.reduce((s, d) => s + d.share, 0), 1, 1e-9, 'shares sum');

// Review focus 3: alpha threshold — 127 ignored, 128 counted
assert.deepEqual(
  dominantColours(buffer([['#ff0000', 3, 127], ['#00ff00', 1, 128]])).map(d => d.hex),
  ['#00ff00'],
);

// Review focus 5: a full 200×200 downsample with k = 3 stays fast
const noisy = Uint8ClampedArray.from({ length: 200 * 200 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 7919) % 256));
let t = performance.now();
const three = dominantColours(noisy);
t = performance.now() - t;
assert.equal(three.length, 3);
assert.ok(t < 1000, `40 000 px took ${t.toFixed(0)} ms`);

// Review focus 4: cropRect normalises, clamps, rejects tiny drags
assert.deepEqual(cropRect(10, 20, 110, 220, 300, 300), { x: 10, y: 20, w: 100, h: 200 });
assert.deepEqual(cropRect(110, 220, 10, 20, 300, 300), { x: 10, y: 20, w: 100, h: 200 });
assert.deepEqual(cropRect(-50, 280, 100, 400, 300, 300), { x: 0, y: 280, w: 100, h: 20 });
assert.equal(cropRect(10, 10, 14, 200, 300, 300), null);
assert.equal(cropRect(10, 10, 10, 10, 300, 300), null);

console.log('ok');
