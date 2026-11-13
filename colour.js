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
  const summary = members => {
    const hex = rgbToHex(mean(members.map(p => p.rgb)));
    return { members, hex, lab: srgbToLab(hexToRgb(hex)) };
  };
  let groups = centres.map((_, j) => px.filter((_, n) => assign[n] === j)).filter(m => m.length).map(summary);
  // Shading on plain cloth splits one colour across clusters; merge any pair closer than MERGE_DELTA_E.
  for (let merged = true; merged; ) {
    merged = false;
    for (let a = 0; a < groups.length && !merged; a++)
      for (let b = a + 1; b < groups.length && !merged; b++)
        if (ciede2000(groups[a].lab, groups[b].lab) < MERGE_DELTA_E) {
          groups = [...groups.filter((_, i) => i !== a && i !== b), summary([...groups[a].members, ...groups[b].members])];
          merged = true;
        }
  }
  return groups
    .map(g => ({ hex: g.hex, lab: g.lab, share: g.members.length / px.length }))
    .sort((a, b) => b.share - a.share);
}

// describeDeltaE's "close cousin" boundary: closer clusters read as one colour.
const MERGE_DELTA_E = 5;

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
