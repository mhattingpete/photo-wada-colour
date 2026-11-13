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
