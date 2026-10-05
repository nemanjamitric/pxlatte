# pxlatte

A halftone and dither generator that runs entirely in the browser. Load an
image, pick from 38 screening methods, push every parameter around on a slider,
export a PNG. Nothing is uploaded anywhere.

## Effects

Every effect is written out by hand — no image-processing library is involved.

**Dot screens** — square lattice, hex close packing, rings, concentric, spiral,
stochastic stipple, pixel mosaic, ASCII. Nine dot shapes, any screen angle.

**Line screens** — ruled lines, crosshatch (up to six directions), wave lines,
frequency-modulated squiggle, gradient-following flow hatch, contour lines.
Marks are drawn as variable-width ribbons, so they taper properly.

**Ordered dither** — Bayer 2×2 through 16×16, clustered-dot 4×4 and 8×8, hard
threshold.

**Noise dither** — white noise, R2 low-discrepancy, interleaved gradient noise.

**Analytic screens** — a real halftone evaluated per pixel rather than sampled
on a grid, so the dot edge stays sharp at any output size. Eight spot functions
(round, classic, euclidean, diamond, square, line, cross, ellipse), plus a
deliberately mis-registered moiré screen and a polar screen.

**Error diffusion** — Floyd–Steinberg, Atkinson, Jarvis–Judice–Ninke, Stucki,
Burkes, Sierra (3-row, 2-row, Lite), Shiau–Fan, Stevenson–Arce, and Riemersma
along a Hilbert curve.

## Colour

Six modes, all available to every effect:

| Mode | What it does |
| --- | --- |
| Photo colours | Each mark takes the colour of the pixel under it |
| One ink | A single ink colour on a paper colour |
| Duotone | Shadow colour blended to highlight colour by tone |
| CMYK process | Four separations screened at true process angles and overprinted |
| RGB light | Three additive separations on black |
| Custom palette | Snapped to colours you pick, with the error diffused |

## Two things worth knowing

**Spot functions are histogram-equalised.** A spot function describes a shape,
not a tone curve. For a round dot the area inside radius *r* grows as *r²*, so
using its raw value as a threshold crushes the midtones and slams to solid
early. Flattening the histogram makes threshold *T* cover exactly *T* of the
cell for any spot shape, so tone reproduces linearly and the dot still looks
like itself.

**Error diffusion kernels keep their own divisor.** Atkinson throws away a
quarter of its error on purpose (weights sum to 6 over 8) — that is where its
airy, blown-highlight look comes from. Normalising every kernel to 1 would
quietly erase the difference between them.

## Running it

```bash
npm install
npm run dev
```

`node test/engine.test.mjs` checks the engine's maths: Bayer matrices are
complete permutations, diffusion kernels match their divisors and never write
backwards, the Hilbert curve visits every cell exactly once in single steps,
every equalised spot inks the area it promises, and every effect's params
declare defaults inside their own range.

`test/contact-sheet.html` renders all 38 effects side by side at a given colour
mode — `npm run dev` then open `/test/contact-sheet.html?mode=cmyk`.

## Deploying

Push to `main`; the workflow in `.github/workflows` builds and publishes to
GitHub Pages. Set Pages to "GitHub Actions" in the repository settings once.
The Vite base is `./`, so the build works at any path without configuration.

## Credits

Typeface is [Switzer](https://fontshare.com/fonts/switzer) by Jeremy Dupuis,
free from Fontshare under the ITF Free Font License (included in `src/fonts`).
