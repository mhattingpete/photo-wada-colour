# Photo-to-Wada Colour Lookup — Design

Date: 2026-11-13 · Status: approved design, awaiting spec review

## Goal and intended use

Quickly find out which Sanzo Wada colours a garment matches, to judge whether it fits the
heritage workwear palette — before buying secondhand, or when adding an item to the wardrobe.

You open one web page (desktop or phone), pick a garment photo or a Vinted screenshot,
optionally drag a box over the garment, and see its 3 dominant colours, each next to its 3
nearest named Wada colours with swatches.

"Working" means:
- the same image and crop always give the same result;
- Lab values and ΔE match the styling project's `wada.py` exactly;
- the photo never leaves the device (all processing in the browser);
- it is usable from a phone via a public https URL.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where processing runs | Browser JS, static files | Zero dependencies, photos stay local, hostable anywhere |
| Background / UI pixels | Optional crop box, else whole image; share % shown | No background removal (out of scope), but screenshots stay usable |
| Clusters | k = 3, fixed | Brief asks for 2–3; share % lets you skip a background cluster |
| Colour space / distance | CIELAB (D65); k-means with Euclidean Lab, matching with CIEDE2000 | Perceptual; CIEDE2000 is what the Wada JSON and `wada.py` use |
| Match info | Name, slug, hex, ΔE, verdict, workwear tier | Tier answers "does it fit the palette?" directly |
| Phone access | GitHub Pages, public repo `mhattingpete/photo-wada-colour`, deploy from `main` root | Works anywhere, Mac can be off, no build step |
| Randomiser handoff | Copy-slug button per match | Wardrobe colour = Wada slug; shared key with the Outfit Randomiser |

## Data

`wada.json` is a verbatim copy of `~/Downloads/sanzo-wada-heritage-workwear.v1.json`
(schema 1.0.0, from the styling project). The page uses only `colors[]`, and from each colour
only `slug`, `name`, `hex`, `workwear.tier`. Tiers present: `core` (39), `workable` (16),
`accent-only` (24), `off-period` (80).

Wada Lab values are computed in the browser from `hex` with the same `srgbToLab` used for
pixels, not read from `lab` (that one is from the book CMYK and differs by up to 7.7 ΔE).

`wada.py` is not copied: the browser cannot run it. Its colour functions are ported instead.

## Files

| File | Purpose |
|---|---|
| `README.md` | The project brief verbatim (goal, use case, scope, out of scope), how to run, the randomiser contract |
| `wada.json` | Wada data, verbatim copy |
| `colour.js` | ES module, all colour logic, no DOM |
| `index.html` | The page: inline CSS and script, imports `colour.js` |
| `colour.test.mjs` | `node colour.test.mjs` assert script |
| `main.py` | Local dev server: stdlib `http.server` on `localhost:8000` (ES modules and `fetch` fail over `file://`) |

## `colour.js`

Line-for-line ports from `wada.py` (same constants, same thresholds):
- `hexToRgb(hex) → [r, g, b]`
- `srgbToLab([r, g, b]) → [L, a, b]` (D65)
- `ciede2000(lab1, lab2) → number`
- `describeDeltaE(de) → string`: `< 2` visually identical, `< 5` close cousin,
  `< 10` same idea, visibly different, else "a different colour - do not claim a match".

New:
- `dominantColours(rgba, k = 3) → [{hex, lab, share}]`, sorted by share descending.
  - `rgba` is the `Uint8ClampedArray` from `getImageData`; pixels with alpha < 128 are skipped.
  - k-means in Lab, Euclidean distance, at most 20 iterations or until assignments stop changing.
  - Deterministic seeding: sort pixels by L*, seeds at the `(2i+1)/(2k)` quantiles
    (1/6, 3/6, 5/6 for k = 3). Empty clusters are dropped.
  - Each cluster's displayed colour is its mean RGB → hex, so the swatch is a real average.
  - Returns `[]` when no opaque pixels remain.
- `nearestWada(lab, colours, n = 3) → [{slug, name, hex, deltaE, verdict, tier}]`,
  sorted by ΔE ascending. `colours` is `wada.json`'s `colors[]` with a precomputed `lab`.

## `index.html`

1. On load, `fetch('wada.json')` once and precompute each colour's Lab.
2. `<input type="file" accept="image/*">` (on phones this offers camera and photo library;
   iOS hands HEIC over as JPEG). The image is drawn on a `<canvas>` scaled to the page width.
3. Crop: pointer events (mouse and touch), canvas has `touch-action: none` so dragging does
   not scroll. A rectangle is drawn over the image while dragging. A drag smaller than 5×5 px
   counts as a click and resets to the whole image. A "Clear crop" button does the same.
4. Extraction runs when an image loads and when a drag ends: the crop region (in source-image
   coordinates) is drawn onto an offscreen canvas scaled to at most 200 px on the longest side,
   then `getImageData` → `dominantColours`.
5. Results: one row per dominant colour.
   - Left: its swatch, hex, share %.
   - Right: 3 Wada cards, each with swatch, name, hex, ΔE (1 decimal), verdict, tier, slug and a
     "Copy" button (`navigator.clipboard.writeText(slug)`; the button briefly reads "Copied").
6. Layout: viewport meta tag; cards stack in one column below ~600 px; tap targets ≥ 44 px.
   Swatches are plain `div`s with inline background colour, hex shown as text beside them.

### Error handling

- Image fails to decode → inline message "Couldn't read that image".
- No opaque pixels in the selection → "No opaque pixels in selection".
- `wada.json` fetch fails → inline message, upload disabled.
- Clipboard write fails → button reads "Copy failed"; the slug stays visible to copy by hand.

## Hosting

- GitHub Pages, deploying from `main` at `/`. URL: `https://mhattingpete.github.io/photo-wada-colour/`.
- All asset paths are relative, so the same files work under `localhost:8000/` and the Pages subpath.
- The repo is public, so `wada.json` and the brief are public.
- Creating the repo and enabling Pages are outward-facing steps, confirmed with the user before
  they run.

## Randomiser contract

The Outfit Randomiser (later project) stores a wardrobe item's colour as a Wada `slug` from
`wada.json`. This page is how a slug is obtained from a photo. The randomiser reads the same
JSON (`combinations[]`, `workwear`, `garment_slots`, `outfit_templates`) and can reuse
`wada.py` (`combinations_for`, `check`). Slugs must stay visible and copyable on this page.

## Testing

`node colour.test.mjs` (Node ≥ 18, no dependencies) asserts:
1. `srgbToLab(hexToRgb(hex))` matches `lab_srgb` within 0.01 for all 159 colours — proves the
   port matches `wada.py`.
2. `ciede2000` reproduces every `colors[].nearest[].delta_e_2000` within 0.01.
3. White `#ffffff` gives L* within 0.01 of 100.
4. A synthetic RGBA buffer, 60 % one Wada hex and 40 % another, with `k = 2`: returns both hexes
   with shares 0.6 / 0.4, and `nearestWada` names both at ΔE < 0.01. A second run gives identical
   output.
5. A fully transparent buffer returns `[]`.

Manual checks:
- `uv run main.py`, upload a Vinted screenshot, crop to the garment, copy a slug; screenshot the result.
- On a phone, open the Pages URL, take a photo, crop with a finger, see results.

## Out of scope

Background removal, accounts, saved history, pairing suggestions (left to the Outfit
Randomiser), drag-and-drop or paste upload, configurable k, a build step or framework.
