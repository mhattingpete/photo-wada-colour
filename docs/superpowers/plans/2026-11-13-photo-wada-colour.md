# Photo-to-Wada Colour Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single static web page that turns a garment photo or Vinted screenshot (optionally cropped) into its 3 dominant colours and the 3 nearest Sanzo Wada colours for each, usable from a phone via GitHub Pages.

**Architecture:** All logic runs in the browser. `colour.js` is a DOM-free ES module (colour maths ported from `wada.py`, k-means, matching, crop geometry) tested with a plain `node` assert script. `index.html` wires a file input, a canvas with a drag-to-crop box and a results list to that module. `main.py` is a stdlib static server for local dev only.

**Tech Stack:** Vanilla JS (ES modules), HTML/CSS, Node ≥ 22.7 for tests (`node:assert`), Python 3.13 stdlib `http.server`, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-11-13-photo-wada-colour-design.md`

## Global Constraints

- No dependencies: no npm packages, no Python packages, no build step, no framework.
- `wada.json` is a verbatim copy of `/Users/map/Downloads/sanzo-wada-heritage-workwear.v1.json`; never edit it.
- Colour maths must match `wada.py` exactly: D65 sRGB → Lab constants and CIEDE2000 as in `/Users/map/Downloads/wada.py` lines 20–95.
- Wada Lab is computed from `hex` with `srgbToLab`, never read from the JSON's `lab` field.
- k = 3 dominant colours, 3 Wada matches per colour, alpha < 128 skipped, downsample to ≤ 200 px longest side, ≤ 20 k-means iterations, seeds at the `(2i+1)/(2k)` quantiles of pixels sorted by L*.
- Crop drags smaller than 5 × 5 display px reset to the whole image.
- All asset paths relative (`./colour.js`, `wada.json`) so the page works at `localhost:8000/` and `mhattingpete.github.io/photo-wada-colour/`.
- Mobile: viewport meta, single column below 600 px, tap targets ≥ 44 px, `touch-action: none` on the canvas.
- Error copy, verbatim: "Couldn't read that image", "No opaque pixels in selection", "Copy failed".
- Spec deviation (verified 2026-11-13): tests need Node ≥ 22.7 (ES-module syntax detection), not ≥ 18. On this machine Node prints a harmless `MODULE_TYPELESS_PACKAGE_JSON` warning caused by the unrelated `/Users/map/Documents/Repos/package.json`; ignore it, do not add a `package.json` to this repo.

## Review Focus

1. **A uniform-colour crop** (e.g. cropped to plain navy cloth): all k seeds coincide. Expected: one result row with share 100 %, no duplicate rows. Pinned in Task 2 ("uniform buffer").
2. **A selection with fewer opaque pixels than k** (tiny crop, mostly transparent PNG). Expected: at most that many rows, shares summing to 1, no crash. Pinned in Task 2 ("fewer pixels than k").
3. **Semi-transparent PNG edges**: alpha exactly 127 vs 128. Expected: 127 ignored, 128 counted. Pinned in Task 2 ("alpha threshold").
4. **Crop dragged up-and-left, or past the canvas edge**. Expected: the same rectangle as dragging down-and-right, clamped to the image. Pinned in Task 2 (`cropRect` tests).
5. **A 12 MP phone photo**. Expected: results in well under a second, because extraction only ever sees ≤ 200 × 200 px. Pinned in Task 2 ("40 000 px performance") plus the manual phone check in Task 5.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `wada.json` | Wada data (verbatim copy) | 1 |
| `colour.js` | All colour logic + crop geometry, no DOM | 1, 2 |
| `colour.test.mjs` | `node colour.test.mjs` assert script | 1, 2 |
| `main.py` | Local static server on `localhost:8000` | 3 |
| `index.html` | Page: upload, results, copy, crop, layout | 3, 4 |
| `README.md` | Project brief verbatim, how to run, randomiser contract | 3 |

---

### Task 1: Colour maths ported from `wada.py`

**Files:**
- Create: `wada.json` (copy)
- Create: `colour.js`
- Create: `colour.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (exports of `colour.js`):
  - `hexToRgb(hex: string) → [r, g, b]` (0–255 ints; accepts `#abc`, `abc`, `#aabbcc`; throws `Error('not a hex colour: …')`)
  - `rgbToHex([r, g, b]) → '#rrggbb'` (rounds each channel)
  - `srgbToLab([r, g, b]) → [L, a, b]`
  - `ciede2000(lab1, lab2) → number`
  - `describeDeltaE(de: number) → string`
  - `withLab(colors) → colors[]` (each item shallow-copied with `lab: srgbToLab(hexToRgb(c.hex))`)

- [ ] **Step 1: Copy the data**

```bash
cp /Users/map/Downloads/sanzo-wada-heritage-workwear.v1.json wada.json
cmp wada.json /Users/map/Downloads/sanzo-wada-heritage-workwear.v1.json && echo identical
```
Expected: `identical`

- [ ] **Step 2: Write the failing test** — `colour.test.mjs`

```js
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
const byId = Object.fromEntries(wada.map(c => [c.id, c]));
for (const c of wada)
  for (const n of c.nearest) near(ciede2000(c.lab, byId[n.id].lab), n.delta_e_2000, 0.01, `${c.slug}→${n.id}`);

// 3. White is L* 100
near(srgbToLab([255, 255, 255])[0], 100, 0.01, 'white L*');
assert.equal(ciede2000([50, 10, 10], [50, 10, 10]), 0);

assert.equal(describeDeltaE(1.9), 'visually identical');
assert.equal(describeDeltaE(4.9), 'close cousin');
assert.equal(describeDeltaE(9.9), 'same idea, visibly different');
assert.equal(describeDeltaE(10), 'a different colour - do not claim a match');

console.log('ok');
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node colour.test.mjs`
Expected: FAIL — `Cannot find module '…/colour.js'`

- [ ] **Step 4: Write the implementation** — `colour.js`

```js
// Colour maths ported line-for-line from the styling project's wada.py,
// so Lab values and ΔE here match wada.json's lab_srgb and nearest[] exactly.

export function hexToRgb(hex) {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

export function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// sRGB 0-255 -> CIE L*a*b* (D65)
export function srgbToLab(rgb) {
  const lin = u => {
    u /= 255;
    return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb.map(lin);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = d => (d * Math.PI) / 180;
const hue = (b, a) => (a || b ? (((Math.atan2(b, a) * 180) / Math.PI) % 360 + 360) % 360 : 0);

export function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = Cb > 0 ? 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7))) : 0.5;
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
  else hbp = (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30))
    + 0.24 * Math.cos(rad(2 * hbp))
    + 0.32 * Math.cos(rad(3 * hbp + 6))
    - 0.20 * Math.cos(rad(4 * hbp - 63));
  const dTh = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = Cbp > 0 ? 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) : 0;
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTh)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

export function describeDeltaE(de) {
  if (de < 2) return 'visually identical';
  if (de < 5) return 'close cousin';
  if (de < 10) return 'same idea, visibly different';
  return 'a different colour - do not claim a match';
}

// wada.json colors[] with Lab computed from hex (not the book-CMYK `lab` field).
export const withLab = colors => colors.map(c => ({ ...c, lab: srgbToLab(hexToRgb(c.hex)) }));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node colour.test.mjs`
Expected: `ok` (plus the harmless `MODULE_TYPELESS_PACKAGE_JSON` warning on this machine)

- [ ] **Step 6: Commit**

```bash
git add wada.json colour.js colour.test.mjs
git commit -m "Port wada.py colour maths to a browser module" -m "Lab and CIEDE2000 must match the styling project exactly so a slug picked here means the same colour in the randomiser; the test checks all 159 colours and every precomputed nearest[] distance."
```

---

### Task 2: Dominant colours, Wada matching, crop geometry

**Files:**
- Modify: `colour.js` (append)
- Modify: `colour.test.mjs` (insert before `console.log('ok')`, extend import)

**Interfaces:**
- Consumes: `srgbToLab`, `rgbToHex`, `ciede2000`, `describeDeltaE`, `withLab` from Task 1.
- Produces:
  - `dominantColours(rgba: Uint8ClampedArray | number[], k = 3) → [{hex: string, lab: [L,a,b], share: number}]`, sorted by `share` descending; `[]` if no pixel has alpha ≥ 128.
  - `nearestWada(lab, colours, n = 3) → [{slug, name, hex, tier, deltaE, verdict}]`, sorted by `deltaE` ascending; `colours` is the output of `withLab`.
  - `cropRect(x0, y0, x1, y1, w, h) → {x, y, w, h} | null`: start and end points in display px, clamped to `[0,w]×[0,h]`, normalised; `null` if either side < 5.

- [ ] **Step 1: Write the failing tests** — change the import line of `colour.test.mjs` to:

```js
import {
  hexToRgb, rgbToHex, srgbToLab, ciede2000, describeDeltaE, withLab,
  dominantColours, nearestWada, cropRect,
} from './colour.js';
```

and insert before `console.log('ok');`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node colour.test.mjs`
Expected: FAIL — `SyntaxError: The requested module './colour.js' does not provide an export named 'cropRect'`

- [ ] **Step 3: Write the implementation** — append to `colour.js`

```js
const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
const mean = vs => [0, 1, 2].map(i => vs.reduce((s, v) => s + v[i], 0) / vs.length);

// k-means in Lab over the opaque pixels of an RGBA buffer (as from getImageData).
// Seeds are quantiles of the pixels sorted by L*, so the same image always gives the same result.
export function dominantColours(rgba, k = 3) {
  const px = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const rgb = [rgba[i], rgba[i + 1], rgba[i + 2]];
    px.push({ rgb, lab: srgbToLab(rgb) });
  }
  if (!px.length) return [];
  px.sort((p, q) => p.lab[0] - q.lab[0]);
  let centres = Array.from({ length: k }, (_, i) => px[Math.floor(((2 * i + 1) / (2 * k)) * px.length)].lab);
  const assign = new Int32Array(px.length).fill(-1);
  for (let iter = 0; iter < 20; iter++) {
    let changed = false;
    px.forEach((p, n) => {
      let best = 0;
      for (let j = 1; j < k; j++) if (dist2(p.lab, centres[j]) < dist2(p.lab, centres[best])) best = j;
      if (assign[n] !== best) [assign[n], changed] = [best, true];
    });
    if (!changed) break;
    centres = centres.map((c, j) => {
      const members = px.filter((_, n) => assign[n] === j);
      return members.length ? mean(members.map(p => p.lab)) : c;
    });
  }
  return centres
    .map((_, j) => px.filter((_, n) => assign[n] === j))
    .filter(members => members.length)
    .map(members => {
      const hex = rgbToHex(mean(members.map(p => p.rgb)));
      return { hex, lab: srgbToLab(hexToRgb(hex)), share: members.length / px.length };
    })
    .sort((a, b) => b.share - a.share);
}

export function nearestWada(lab, colours, n = 3) {
  return colours
    .map(c => ({ slug: c.slug, name: c.name, hex: c.hex, tier: c.workwear.tier, deltaE: ciede2000(lab, c.lab) }))
    .sort((a, b) => a.deltaE - b.deltaE)
    .slice(0, n)
    .map(m => ({ ...m, verdict: describeDeltaE(m.deltaE) }));
}

// Drag start/end in display px → rectangle clamped to the w×h box; null for a tap-sized drag.
export function cropRect(x0, y0, x1, y1, w, h) {
  const clamp = (v, max) => Math.min(Math.max(v, 0), max);
  const [left, right] = [clamp(x0, w), clamp(x1, w)].sort((a, b) => a - b);
  const [top, bottom] = [clamp(y0, h), clamp(y1, h)].sort((a, b) => a - b);
  if (right - left < 5 || bottom - top < 5) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}
```

Note on the seed quantile: `(2i+1)/(2k) < 1` for every `i < k`, so the index is always in range, even with a single pixel. Ties in assignment go to the lowest cluster index (strict `<`), which is what collapses a uniform image to one cluster.

- [ ] **Step 4: Run test to verify it passes**

Run: `node colour.test.mjs`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add colour.js colour.test.mjs
git commit -m "Extract dominant colours and match them to Wada" -m "Deterministic k-means seeding keeps re-uploads stable; the tests pin uniform crops, tiny selections, the alpha cut-off and crop clamping, which are what phone photos and Vinted screenshots actually produce."
```

---

### Task 3: Local server, page with upload/results/copy, README

**Files:**
- Modify: `main.py` (replace the hello-world)
- Create: `index.html`
- Modify: `README.md` (currently empty)

**Interfaces:**
- Consumes: `dominantColours`, `nearestWada`, `withLab` from `colour.js` (Tasks 1–2). `cropRect` is imported here but used only in Task 4.
- Produces (inside `index.html`'s module script, used by Task 4):
  - `img: HTMLImageElement | undefined`: current image
  - `show(rect)`: redraws `#view`; `rect` is `{x, y, w, h}` in **source-image px** or `null`; draws a yellow outline when given
  - `analyse(rect)`: same `rect` convention; runs extraction and renders `#results`
  - DOM ids: `file`, `clear`, `msg`, `view`, `results`

- [ ] **Step 1: Replace `main.py`**

```python
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    # ES modules and fetch() don't work over file://, so serve the folder.
    handler = partial(SimpleHTTPRequestHandler, directory=Path(__file__).parent)
    print("Serving on http://localhost:8000")
    ThreadingHTTPServer(("localhost", 8000), handler).serve_forever()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wada Colour Lookup</title>
<style>
  body { font: 16px/1.4 system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 16px; background: #f6f3ee; color: #222; }
  h1 { font-size: 1.4rem; }
  button, input[type=file] { min-height: 44px; font: inherit; }
  canvas { display: block; width: 100%; height: auto; margin: 12px 0; touch-action: none; }
  #msg { color: #a00; min-height: 1.4em; }
  .row { display: grid; grid-template-columns: 160px 1fr; gap: 12px; padding: 12px 0; border-top: 1px solid #ddd; }
  .matches { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .swatch { height: 64px; border-radius: 6px; border: 1px solid #0002; margin-bottom: 4px; }
  .card small { display: block; color: #555; }
  @media (max-width: 600px) { .row, .matches { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>Wada colour lookup</h1>
<input type="file" id="file" accept="image/*" disabled>
<button id="clear" hidden>Clear crop</button>
<p id="msg"></p>
<canvas id="view" hidden></canvas>
<div id="results"></div>
<script type="module">
import { dominantColours, nearestWada, withLab, cropRect } from './colour.js';

const $ = id => document.getElementById(id);
const view = $('view'), ctx = view.getContext('2d');
let wada, img;

try {
  const res = await fetch('wada.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  wada = withLab((await res.json()).colors);
  $('file').disabled = false;
} catch (e) {
  $('msg').textContent = `Couldn't load wada.json (${e.message})`;
}

$('file').onchange = () => {
  const file = $('file').files[0];
  if (!file) return;
  const next = new Image();
  next.onload = () => {
    if (img) URL.revokeObjectURL(img.src);
    img = next;
    $('clear').hidden = true;
    show(null);
    analyse(null);
  };
  next.onerror = () => { $('msg').textContent = "Couldn't read that image"; };
  next.src = URL.createObjectURL(file);
};

// rect: {x, y, w, h} in source-image px, or null for the whole image.
function show(rect) {
  view.hidden = false;
  view.width = Math.min(img.naturalWidth, 1200);
  view.height = Math.round((img.naturalHeight * view.width) / img.naturalWidth);
  ctx.drawImage(img, 0, 0, view.width, view.height);
  if (!rect) return;
  const k = view.width / img.naturalWidth;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ff0';
  ctx.strokeRect(rect.x * k, rect.y * k, rect.w * k, rect.h * k);
}

function analyse(rect) {
  const { x, y, w, h } = rect ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  const s = Math.min(1, 200 / Math.max(w, h));
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(w * s));
  off.height = Math.max(1, Math.round(h * s));
  const octx = off.getContext('2d');
  octx.drawImage(img, x, y, w, h, 0, 0, off.width, off.height);
  const colours = dominantColours(octx.getImageData(0, 0, off.width, off.height).data);
  $('msg').textContent = colours.length ? '' : 'No opaque pixels in selection';
  $('results').innerHTML = colours.map(row).join('');
}

const card = m => `<div class="card">
  <div class="swatch" style="background:${m.hex}"></div>
  <b>${m.name}</b> ${m.hex}
  <small>ΔE ${m.deltaE.toFixed(1)} · ${m.verdict}</small>
  <small>tier: ${m.tier}</small>
  <small><code>${m.slug}</code> <button data-slug="${m.slug}">Copy</button></small>
</div>`;

const row = c => `<div class="row">
  <div><div class="swatch" style="background:${c.hex}"></div>${c.hex} · ${Math.round(c.share * 100)}%</div>
  <div class="matches">${nearestWada(c.lab, wada).map(card).join('')}</div>
</div>`;

$('results').onclick = async e => {
  const b = e.target.closest('button[data-slug]');
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.slug);
    b.textContent = 'Copied';
  } catch {
    b.textContent = 'Copy failed';
  }
  setTimeout(() => { b.textContent = 'Copy'; }, 1500);
};
</script>
</body>
</html>
```

- [ ] **Step 3: Write `README.md`** — the brief verbatim, then run and contract notes

```markdown
# Photo-to-Wada Colour Lookup

## Goal
Quickly find out which Sanzo Wada colours a garment matches, so it is easy to judge whether it fits the heritage workwear palette.

## Intended use case
Upload a photo of a garment or a screenshot of a Vinted listing on a single web page. The page extracts the 2–3 dominant colours and shows the nearest named colours from the Sanzo Wada JSON file, with swatches side by side. Useful before buying something secondhand, or when adding an item to the wardrobe.

## Scope
- One page: upload image, show dominant colours and nearest Wada matches
- Colour distance calculated in a perceptual colour space (e.g. CIELAB)
- Reuses the existing Wada JSON from the styling project

## Out of scope
No background removal, no accounts, no saving history. Pairing suggestions are left to the outfit randomiser.

## Run

- Phone or anywhere: https://mhattingpete.github.io/photo-wada-colour/
- Locally: `uv run main.py`, then open http://localhost:8000
- Tests: `node colour.test.mjs` (Node ≥ 22.7)

Drag a box over the garment to ignore background and listing UI. Everything runs in the browser; photos are never uploaded.

## Data

`wada.json` is a verbatim copy of `sanzo-wada-heritage-workwear.v1.json` from the styling project. `colour.js` ports its colour maths from that project's `wada.py`, and the tests check both agree.

## Outfit Randomiser contract

A wardrobe item's colour is a Wada `slug` from `wada.json` (e.g. `dark-tyrian-blue`). Use the Copy button next to a match to get it. The randomiser reads the same JSON for combinations, tiers and garment slots.

Design: `docs/superpowers/specs/2026-11-13-photo-wada-colour-design.md`
```

- [ ] **Step 4: Verify in a real browser**

Run: `uv run main.py` (if the sandbox refuses to bind the port with EPERM, the user enables `sandbox.network.allowLocalBinding: true` or runs `! uv run main.py` themselves)

Then, with the chrome-devtools MCP tools (`new_page` → `http://localhost:8000`):
1. Before uploading, `list_console_messages`: no errors, and the file input is enabled.
2. Feed the input a generated 60/40 test image with `evaluate_script`:

```js
async () => {
  const c = Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
  const g = c.getContext('2d');
  g.fillStyle = '#051230'; g.fillRect(0, 0, 180, 200);
  g.fillStyle = '#f9c1ce'; g.fillRect(180, 0, 120, 200);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'test.png', { type: 'image/png' }));
  const input = document.getElementById('file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
}
```
   Expected: 2 result rows, `#051230 · 60%` → first card **Deep Indigo**, ΔE 0.0, "visually identical"; `#f9c1ce · 40%` → **Hermosa Pink**.
3. Click a Copy button. Expected: it reads "Copied" (or "Copy failed" if the automation browser denies clipboard; either proves the handler ran).
4. `resize_page` to 375×800, `take_screenshot`. Expected: one column, no horizontal scroll.
5. Same `evaluate_script` pattern with `new File(['not an image'], 'x.jpg', { type: 'image/jpeg' })`. Expected: "Couldn't read that image".

Then stop the server.

- [ ] **Step 5: Run unit tests, commit**

```bash
node colour.test.mjs
git add main.py index.html README.md
git commit -m "Add the lookup page, dev server and project brief" -m "One static page so the same files work locally and on GitHub Pages; the README keeps the original brief and the slug contract the Outfit Randomiser depends on."
```

---

### Task 4: Drag-to-crop

**Files:**
- Modify: `index.html` (append inside the module script, after the copy handler)

**Interfaces:**
- Consumes: `cropRect` (Task 2); `img`, `show(rect)`, `analyse(rect)`, `view`, `$` (Task 3). `show`/`analyse` take source-image px; `cropRect` works in display px.
- Produces: nothing further.

- [ ] **Step 1: Append the crop handlers**

```js
// Crop: drag on the canvas. Pointer events cover mouse and touch; touch-action: none stops scrolling.
let start;
const toBox = e => {
  const r = view.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
const toSource = box => {
  if (!box) return null;
  const k = img.naturalWidth / view.clientWidth;
  return { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k };
};
const dragRect = e => toSource(cropRect(...start, ...toBox(e), view.clientWidth, view.clientHeight));

view.onpointerdown = e => {
  if (!img) return;
  start = toBox(e);
  view.setPointerCapture(e.pointerId);
};
view.onpointermove = e => { if (start) show(dragRect(e)); };
view.onpointerup = e => {
  if (!start) return;
  const rect = dragRect(e);
  start = null;
  show(rect);
  analyse(rect);
  $('clear').hidden = !rect;
};
view.onpointercancel = () => { start = null; };
$('clear').onclick = () => {
  show(null);
  analyse(null);
  $('clear').hidden = true;
};
```

- [ ] **Step 2: Verify in a real browser**

Run `uv run main.py`, open `http://localhost:8000` with chrome-devtools, load the 60/40 test image with the `evaluate_script` snippet from Task 3 Step 4.
1. Drag (`drag`, or `evaluate_script` dispatching `pointerdown`/`pointermove`/`pointerup`) a box entirely inside the left 60 %.
   Expected: one result row, `#051230 · 100%`, Deep Indigo first; yellow outline visible; "Clear crop" shown.
2. Drag the same box from bottom-right to top-left. Expected: identical result.
3. Tap without moving. Expected: back to two rows, no outline, "Clear crop" hidden.
4. Drag again, then click "Clear crop". Expected: two rows, outline gone.
5. `emulate` a touch device at 375 px width and repeat step 1. Expected: page doesn't scroll during the drag.

- [ ] **Step 3: Run unit tests, commit**

```bash
node colour.test.mjs
git add index.html
git commit -m "Let the user crop to the garment" -m "Without background removal, a Vinted screenshot's white UI would take a dominant-colour slot; a drag box keeps the result about the garment."
```

---

### Task 5: Publish to GitHub Pages

**Outward-facing: ask the user before Step 1, and before every push.** This task publishes `wada.json` and the brief publicly.

**Files:** none changed.

**Interfaces:**
- Consumes: the finished branch `photo-wada-colour` (Tasks 1–4).
- Produces: `https://mhattingpete.github.io/photo-wada-colour/`

- [ ] **Step 1: Create the public repo and push the branch** (after user confirmation; the `repo-setup` skill may be used for protection settings)

```bash
gh repo create mhattingpete/photo-wada-colour --public --source . --remote origin
git push -u origin photo-wada-colour
```

- [ ] **Step 2: Make it `main`.** The remote has no `main` yet. Ask the user to choose: they run `! git push origin photo-wada-colour:main` themselves, or they explicitly authorise that one push. (Session rules forbid pushing to `main` unasked.)

- [ ] **Step 3: Enable Pages from `main` root**

```bash
gh api -X POST repos/mhattingpete/photo-wada-colour/pages -f 'source[branch]=main' -f 'source[path]=/'
gh api repos/mhattingpete/photo-wada-colour/pages --jq '.html_url, .status'
```
Expected: `https://mhattingpete.github.io/photo-wada-colour/` and, within a few minutes, `built`.

- [ ] **Step 4: Verify the live site**

```bash
curl -sI https://mhattingpete.github.io/photo-wada-colour/colour.js | grep -i content-type
curl -s https://mhattingpete.github.io/photo-wada-colour/wada.json | head -c 80
```
Expected: `content-type: application/javascript` (or `text/javascript`) and the JSON's opening `{ "schema_version"…`.
Then open the URL in chrome-devtools, load the 60/40 test image with the Task 3 Step 4 snippet, and expect the same result as Task 3.

- [ ] **Step 5: User's phone check** (manual, the user does this): open the URL on the phone, take a photo of a garment, crop with a finger, see results, tap Copy, paste somewhere.
