/* Per-pixel screening: ordered threshold matrices, analytic screen functions
   and error-diffusion kernels. All written out by hand — the kernels are the
   published weights, not a library call. */

import { clamp, luma, hexToRgb, nearest, rad, TAU } from './core.js';
import { num, bool, sel, CELL, ANGLE } from './params.js';

/* ------------------------------------------------------------- quantisation */

const qstep = (v, L) => {
  const n = L - 1;
  return clamp(Math.round(clamp(v, 0, 1) * n) / n, 0, 1);
};

/* One quantiser shape serves ordered dithering, error diffusion and Riemersma:
   read the pixel into N components, snap them, turn them back into RGB.
   Components are whatever the colour mode diffuses error in — luma for a
   single ink, RGB for photographic, the four process inks for CMYK. */
export function makeQuantizer(mode, colors, levels) {
  const ink = hexToRgb(colors.ink);
  const paper = hexToRgb(colors.paper);
  const shadow = hexToRgb(colors.shadow);
  const highlight = hexToRgb(colors.highlight);
  const L = Math.max(2, levels | 0);

  const lerp3 = (a, b, t, out) => {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
  };

  switch (mode) {
    case 'original':
    case 'rgb': {
      const LL = mode === 'rgb' ? 2 : L;
      return {
        n: 3,
        paper: mode === 'rgb' ? [0, 0, 0] : paper,
        read: (r, g, b, c) => { c[0] = r / 255; c[1] = g / 255; c[2] = b / 255; },
        quant: (c, q) => { q[0] = qstep(c[0], LL); q[1] = qstep(c[1], LL); q[2] = qstep(c[2], LL); },
        toRgb: (q, out) => { out[0] = q[0] * 255; out[1] = q[1] * 255; out[2] = q[2] * 255; },
      };
    }

    case 'palette': {
      const pal = colors.palette.map(hexToRgb);
      return {
        n: 3,
        paper,
        read: (r, g, b, c) => { c[0] = r / 255; c[1] = g / 255; c[2] = b / 255; },
        quant: (c, q) => {
          const m = nearest(pal, c[0] * 255, c[1] * 255, c[2] * 255);
          q[0] = m[0] / 255; q[1] = m[1] / 255; q[2] = m[2] / 255;
        },
        toRgb: (q, out) => { out[0] = q[0] * 255; out[1] = q[1] * 255; out[2] = q[2] * 255; },
      };
    }

    case 'cmyk': {
      /* Each ink is screened on its own, then the sheet is read back
         subtractively, so overlaps give real overprint colours. */
      const inks = [[0, 174, 239], [236, 0, 140], [255, 241, 0], [35, 31, 32]];
      return {
        n: 4,
        paper: [255, 255, 255],
        read: (r, g, b, c) => {
          const k = 1 - Math.max(r, g, b) / 255;
          c[3] = k;
          if (k >= 1) { c[0] = c[1] = c[2] = 0; return; }
          c[0] = (1 - r / 255 - k) / (1 - k);
          c[1] = (1 - g / 255 - k) / (1 - k);
          c[2] = (1 - b / 255 - k) / (1 - k);
        },
        quant: (c, q) => { for (let i = 0; i < 4; i++) q[i] = qstep(c[i], L); },
        toRgb: (q, out) => {
          out[0] = out[1] = out[2] = 255;
          for (let i = 0; i < 4; i++) {
            if (q[i] <= 0) continue;
            for (let k = 0; k < 3; k++) {
              const t = inks[i][k] / 255;
              out[k] *= 1 - q[i] * (1 - t);
            }
          }
        },
      };
    }

    case 'duotone':
      return {
        n: 1,
        paper,
        read: (r, g, b, c) => { c[0] = luma(r, g, b); },
        quant: (c, q) => { q[0] = qstep(c[0], L); },
        toRgb: (q, out) => lerp3(shadow, highlight, q[0], out),
      };

    default: /* single ink on paper */
      return {
        n: 1,
        paper,
        read: (r, g, b, c) => { c[0] = luma(r, g, b); },
        quant: (c, q) => { q[0] = qstep(c[0], L); },
        toRgb: (q, out) => lerp3(ink, paper, q[0], out),
      };
  }
}

/* --------------------------------------------------- threshold matrices */

/* Bayer by the standard recursion: M2n = [[4M, 4M+2], [4M+3, 4M+1]]. */
function bayer(size) {
  let m = [[0]];
  while (m.length < size) {
    const n = m.length;
    const out = Array.from({ length: n * 2 }, () => new Array(n * 2));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = m[y][x] * 4;
        out[y][x] = v;
        out[y][x + n] = v + 2;
        out[y + n][x] = v + 3;
        out[y + n][x + n] = v + 1;
      }
    }
    m = out;
  }
  const d = size * size;
  return { size, get: (x, y) => (m[y % size][x % size] + 0.5) / d };
}

const BAYER = { 2: bayer(2), 4: bayer(4), 8: bayer(8), 16: bayer(16) };

/* Classic clustered-dot screens: the ink grows outward from one spot per cell,
   which is what makes them survive on paper where Bayer falls apart. */
const CLUSTER_4 = [
  [12, 5, 6, 13],
  [4, 0, 1, 7],
  [11, 3, 2, 8],
  [15, 10, 9, 14],
];
const CLUSTER_8 = [
  [24, 10, 12, 26, 35, 47, 49, 37],
  [8, 0, 2, 14, 45, 59, 61, 51],
  [22, 6, 4, 16, 43, 57, 63, 53],
  [30, 20, 18, 28, 33, 41, 55, 39],
  [34, 46, 48, 36, 25, 11, 13, 27],
  [44, 58, 60, 50, 9, 1, 3, 15],
  [42, 56, 62, 52, 23, 7, 5, 17],
  [32, 40, 54, 38, 31, 21, 19, 29],
];
const matrix = (m) => {
  const s = m.length;
  const d = s * s;
  return { size: s, get: (x, y) => (m[y % s][x % s] + 0.5) / d };
};

/* -------------------------------------------------- analytic screen spots */

/* Spot functions take cell-local coordinates in [-1, 1] and return the order in
   which ink arrives: 0 is covered first, 1 last. Because they're evaluated per
   pixel rather than sampled on a grid, the dot edge stays razor sharp at any
   output size. */
export const SPOTS = {
  round: (u, v) => Math.hypot(u, v) / Math.SQRT2,
  classic: (u, v) => 0.5 - 0.25 * (Math.cos(Math.PI * u) + Math.cos(Math.PI * v)),
  euclidean: (u, v) => {
    const au = Math.abs(u), av = Math.abs(v);
    if (au + av < 1) return (u * u + v * v) * 0.5;
    const p = au - 1, q = av - 1;
    return 1 - (p * p + q * q) * 0.5;
  },
  diamond: (u, v) => (Math.abs(u) + Math.abs(v)) / 2,
  square: (u, v) => Math.max(Math.abs(u), Math.abs(v)),
  line: (u) => (1 - Math.cos(Math.PI * u)) / 2,
  cross: (u, v) => Math.min(
    (1 - Math.cos(Math.PI * u)) / 2,
    (1 - Math.cos(Math.PI * v)) / 2
  ),
  ellipse: (u, v) => Math.hypot(u * 0.75, v * 1.35) / Math.hypot(0.75, 1.35),
};

export const SPOT_NAMES = Object.keys(SPOTS);

/* A spot function describes a *shape*, not a tone curve: for `round`, the area
   inside radius r grows as r², so feeding its raw value in as a threshold
   crushes the midtones and slams to solid early. Flattening its histogram makes
   threshold T cover exactly T of the cell, for any spot shape — so every one of
   them reproduces tone linearly and still looks like itself. */
function equalize(f, n = 160, bins = 2048) {
  const vals = new Float32Array(n * n);
  let mn = Infinity, mx = -Infinity;
  for (let j = 0, k = 0; j < n; j++) {
    const v = ((j + 0.5) / n) * 2 - 1;
    for (let i = 0; i < n; i++, k++) {
      const u = ((i + 0.5) / n) * 2 - 1;
      const val = f(u, v);
      vals[k] = val;
      if (val < mn) mn = val;
      if (val > mx) mx = val;
    }
  }
  const span = mx - mn || 1;
  const hist = new Uint32Array(bins);
  const binOf = (val) => clamp(Math.round(((val - mn) / span) * (bins - 1)), 0, bins - 1);
  for (let k = 0; k < vals.length; k++) hist[binOf(vals[k])]++;

  /* Midpoint of each bin's span in the CDF, so the map is monotone and has no
     step at the ends. */
  const cdf = new Float32Array(bins);
  let cum = 0;
  for (let i = 0; i < bins; i++) {
    cdf[i] = (cum + hist[i] / 2) / vals.length;
    cum += hist[i];
  }
  return (u, v) => cdf[binOf(f(u, v))];
}

const spotCache = new Map();

/* Equalising costs one 160×160 pass, so it is done once per spot and reused. */
export function makeSpot(name) {
  if (!spotCache.has(name)) spotCache.set(name, equalize(SPOTS[name] || SPOTS.round));
  return spotCache.get(name);
}

function spotThreshold(spot, cell, angleDeg) {
  const f = makeSpot(spot);
  const a = rad(angleDeg);
  const cos = Math.cos(a), sin = Math.sin(a);
  const s = Math.max(1, cell);
  return (x, y) => {
    const ur = (x * cos + y * sin) / s;
    const vr = (-x * sin + y * cos) / s;
    const u = (ur - Math.floor(ur)) * 2 - 1;
    const v = (vr - Math.floor(vr)) * 2 - 1;
    return f(u, v);
  };
}

/* ------------------------------------------------------- ordered dithering */

function orderedPass(env, threshold, levels, spread) {
  const { ctx, source, w, h, mode, colors } = env;
  const q = makeQuantizer(mode, colors, levels);
  const src = source.data.data;
  const out = ctx.createImageData(w, h);
  const px = out.data;
  const c = new Float32Array(q.n);
  const qq = new Float32Array(q.n);
  const rgb = new Float32Array(3);
  /* One quantisation step is how far a threshold can legitimately push a
     value; beyond that the dither pattern starts showing as banding. */
  const amp = (spread / Math.max(1, (mode === 'palette' ? 2 : Math.max(2, levels)) - 1));

  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const o = i * 4;
      q.read(src[o], src[o + 1], src[o + 2], c);
      const t = (threshold(x, y) - 0.5) * amp;
      for (let k = 0; k < q.n; k++) c[k] = clamp(c[k] + (q.n === 4 ? -t : t), 0, 1);
      q.quant(c, qq);
      q.toRgb(qq, rgb);
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

/* ------------------------------------------------------- error diffusion */

/* Kernels carry their own divisor: Atkinson deliberately throws away a quarter
   of the error (weights sum to 6 over 8), which is where its airy look comes
   from, so normalising them all to 1 would be wrong. */
const KERNELS = {
  floyd: { div: 16, cells: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  atkinson: { div: 8, cells: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  jarvis: {
    div: 48,
    cells: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5],
      [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]],
  },
  stucki: {
    div: 42,
    cells: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4],
      [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]],
  },
  burkes: { div: 32, cells: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
  sierra3: {
    div: 32,
    cells: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4],
      [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]],
  },
  sierra2: { div: 16, cells: [[1, 0, 4], [2, 0, 3], [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]] },
  sierraLite: { div: 4, cells: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
  shiauFan: { div: 8, cells: [[1, 0, 4], [-2, 1, 1], [-1, 1, 1], [0, 1, 2]] },
  stevenson: {
    div: 200,
    cells: [[2, 0, 32], [-3, 1, 12], [-1, 1, 26], [1, 1, 30], [3, 1, 16],
      [-2, 2, 12], [0, 2, 26], [2, 2, 12], [-3, 3, 5], [-1, 3, 12], [1, 3, 12], [3, 3, 5]],
  },
};

function diffusePass(env, kernelName, levels, strength, serpentine) {
  const { ctx, source, w, h, mode, colors } = env;
  const q = makeQuantizer(mode, colors, levels);
  const { div, cells } = KERNELS[kernelName];
  const n = q.n;
  const src = source.data.data;
  const out = ctx.createImageData(w, h);
  const px = out.data;

  /* Error only ever reaches a few rows ahead, so a rolling window of rows is
     enough — a full-image float buffer would be hundreds of megabytes. */
  const maxDy = cells.reduce((m, c) => Math.max(m, c[1]), 0);
  const rows = maxDy + 1;
  const err = new Float32Array(rows * w * n);
  const c = new Float32Array(n);
  const qq = new Float32Array(n);
  const rgb = new Float32Array(3);

  for (let y = 0; y < h; y++) {
    const rowBase = (y % rows) * w * n;
    const rev = serpentine && (y & 1);
    for (let xi = 0; xi < w; xi++) {
      const x = rev ? w - 1 - xi : xi;
      const o = (y * w + x) * 4;
      q.read(src[o], src[o + 1], src[o + 2], c);
      for (let k = 0; k < n; k++) c[k] = clamp(c[k] + err[rowBase + x * n + k], 0, 1);
      q.quant(c, qq);
      q.toRgb(qq, rgb);
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;

      for (const [dx0, dy, wt] of cells) {
        const dx = rev ? -dx0 : dx0;
        const nx = x + dx;
        if (nx < 0 || nx >= w || y + dy >= h) continue;
        const base = ((y + dy) % rows) * w * n + nx * n;
        const f = ((wt / div) * strength);
        for (let k = 0; k < n; k++) err[base + k] += (c[k] - qq[k]) * f;
      }
    }
    /* Row y is finished; clear it so it can serve as row y + rows. */
    err.fill(0, rowBase, rowBase + w * n);
  }
  ctx.putImageData(out, 0, 0);
}

/* ------------------------------------------------------------- Riemersma */

/* Hilbert-curve dithering: walk a space-filling curve and carry a short,
   exponentially-weighted memory of recent error. One traversal order instead
   of a kernel, so the texture has no directional grain at all. */
function riemersmaPass(env, levels, queueLen, decay) {
  const { ctx, source, w, h, mode, colors } = env;
  const q = makeQuantizer(mode, colors, levels);
  const n = q.n;
  const src = source.data.data;
  const out = ctx.createImageData(w, h);
  const px = out.data;

  let order = 1;
  while (order < Math.max(w, h)) order <<= 1;

  const weights = new Float32Array(queueLen);
  let wsum = 0;
  for (let i = 0; i < queueLen; i++) {
    weights[i] = Math.pow(decay, i);
    wsum += weights[i];
  }
  const hist = new Float32Array(queueLen * n);
  let head = 0;

  const c = new Float32Array(n);
  const qq = new Float32Array(n);
  const rgb = new Float32Array(3);
  const acc = new Float32Array(n);

  const total = order * order;
  for (let d = 0; d < total; d++) {
    const [x, y] = hilbertXY(d, order);
    if (x >= w || y >= h) continue;
    const o = (y * w + x) * 4;
    q.read(src[o], src[o + 1], src[o + 2], c);

    acc.fill(0);
    for (let i = 0; i < queueLen; i++) {
      const slot = ((head - 1 - i + queueLen * 2) % queueLen) * n;
      for (let k = 0; k < n; k++) acc[k] += hist[slot + k] * weights[i];
    }
    for (let k = 0; k < n; k++) c[k] = clamp(c[k] + acc[k] / wsum, 0, 1);

    q.quant(c, qq);
    q.toRgb(qq, rgb);
    px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;

    for (let k = 0; k < n; k++) hist[head * n + k] = c[k] - qq[k];
    head = (head + 1) % queueLen;
  }
  ctx.putImageData(out, 0, 0);
}

/* Standard Hilbert d2xy. */
function hilbertXY(d, order) {
  let rx, ry, t = d, x = 0, y = 0;
  for (let s = 1; s < order; s *= 2) {
    rx = 1 & (t / 2);
    ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      const tmp = x; x = y; y = tmp;
    }
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return [x, y];
}

/* ------------------------------------------------------------- the effects */

const TONE = [num('levels', 'Tone steps', 2, 16, 1, 2, '')];
const SPREAD = [num('spread', 'Dither spread', 0, 3, 0.01, 1, '×')];

const orderedEffect = (id, name, make, extra = [], group = 'Ordered dither') => ({
  id, name, group, family: 'dither',
  params: [...extra, ...TONE, ...SPREAD],
  draw(env) {
    orderedPass(env, make(env.p), env.p.levels, env.p.spread);
  },
});

export const threshold = orderedEffect('threshold', 'Hard Threshold',
  (p) => () => p.point, [num('point', 'Threshold point', 0, 1, 0.01, 0.5, '')]);

export const bayer2 = orderedEffect('bayer2', 'Bayer 2×2', () => BAYER[2].get);
export const bayer4 = orderedEffect('bayer4', 'Bayer 4×4', () => BAYER[4].get);
export const bayer8 = orderedEffect('bayer8', 'Bayer 8×8', () => BAYER[8].get);
export const bayer16 = orderedEffect('bayer16', 'Bayer 16×16', () => BAYER[16].get);
export const cluster4 = orderedEffect('cluster4', 'Clustered Dot 4×4', () => matrix(CLUSTER_4).get);
export const cluster8 = orderedEffect('cluster8', 'Clustered Dot 8×8', () => matrix(CLUSTER_8).get);

export const noiseDither = orderedEffect('noise', 'White Noise',
  () => () => Math.random(), [], 'Noise dither');

/* Two one-line low-discrepancy sequences that land surprisingly close to real
   blue noise — no 64×64 tile to generate or ship. */
export const r2Dither = orderedEffect('r2', 'R2 Low-Discrepancy',
  () => (x, y) => {
    const v = x * 0.7548776662466927 + y * 0.5698402909980532;
    return v - Math.floor(v);
  }, [], 'Noise dither');

export const ignDither = orderedEffect('ign', 'Interleaved Gradient Noise',
  () => (x, y) => {
    const v = 52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1);
    return v - Math.floor(v);
  }, [], 'Noise dither');

/* Analytic screens: a real halftone evaluated per pixel. */
export const analyticScreen = {
  id: 'spot-screen',
  name: 'Analytic Spot Screen',
  group: 'Analytic screens',
  family: 'dither',
  params: [
    CELL(8), ANGLE(45),
    sel('spot', 'Spot function', SPOT_NAMES, 'euclidean'),
    ...TONE, ...SPREAD,
  ],
  draw(env) {
    const { p } = env;
    orderedPass(env, spotThreshold(p.spot, p.cell, p.angle), p.levels, p.spread);
  },
};

export const moireScreen = {
  id: 'moire',
  name: 'Moiré Screen',
  group: 'Analytic screens',
  family: 'dither',
  params: [
    CELL(9), ANGLE(15),
    num('cell2', 'Second cell size', 2, 80, 1, 11, 'px'),
    num('angle2', 'Second angle', 0, 180, 1, 75, '°'),
    sel('spot', 'Spot function', SPOT_NAMES, 'round'),
    ...TONE, ...SPREAD,
  ],
  draw(env) {
    const { p } = env;
    /* Two screens averaged together — deliberately mis-registered, which is
       exactly what printers spend their lives avoiding. */
    const a = spotThreshold(p.spot, p.cell, p.angle);
    const b = spotThreshold(p.spot, p.cell2, p.angle2);
    orderedPass(env, (x, y) => (a(x, y) + b(x, y)) / 2, p.levels, p.spread);
  },
};

export const radialScreen = {
  id: 'radial-screen',
  name: 'Radial Spot Screen',
  group: 'Analytic screens',
  family: 'dither',
  params: [
    CELL(8),
    num('twist', 'Angular cells', 4, 360, 1, 72, ''),
    num('originX', 'Origin X', 0, 100, 1, 50, '%'),
    num('originY', 'Origin Y', 0, 100, 1, 50, '%'),
    sel('spot', 'Spot function', SPOT_NAMES, 'round'),
    ...TONE, ...SPREAD,
  ],
  draw(env) {
    const { p, w, h } = env;
    const f = makeSpot(p.spot);
    const ox = (p.originX / 100) * w;
    const oy = (p.originY / 100) * h;
    /* Polar cell coordinates: rings by radius, wedges by angle. */
    orderedPass(env, (x, y) => {
      const dx = x - ox, dy = y - oy;
      const r = Math.hypot(dx, dy) / Math.max(1, p.cell);
      const t = ((Math.atan2(dy, dx) / TAU) + 0.5) * p.twist;
      const u = (r - Math.floor(r)) * 2 - 1;
      const v = (t - Math.floor(t)) * 2 - 1;
      return f(u, v);
    }, p.levels, p.spread);
  },
};

const diffuseEffect = (id, name, kernel) => ({
  id, name, group: 'Error diffusion', family: 'dither',
  params: [
    num('levels', 'Tone steps', 2, 16, 1, 2, ''),
    num('strength', 'Error strength', 0, 1.5, 0.01, 1, '×'),
    bool('serpentine', 'Serpentine scan', true),
  ],
  draw(env) {
    diffusePass(env, kernel, env.p.levels, env.p.strength, env.p.serpentine);
  },
});

export const DITHER_EFFECTS = [
  threshold, bayer2, bayer4, bayer8, bayer16, cluster4, cluster8,
  noiseDither, r2Dither, ignDither,
  analyticScreen, moireScreen, radialScreen,
  diffuseEffect('floyd', 'Floyd–Steinberg', 'floyd'),
  diffuseEffect('atkinson', 'Atkinson', 'atkinson'),
  diffuseEffect('jarvis', 'Jarvis–Judice–Ninke', 'jarvis'),
  diffuseEffect('stucki', 'Stucki', 'stucki'),
  diffuseEffect('burkes', 'Burkes', 'burkes'),
  diffuseEffect('sierra3', 'Sierra 3-Row', 'sierra3'),
  diffuseEffect('sierra2', 'Sierra 2-Row', 'sierra2'),
  diffuseEffect('sierra-lite', 'Sierra Lite', 'sierraLite'),
  diffuseEffect('shiau-fan', 'Shiau–Fan', 'shiauFan'),
  diffuseEffect('stevenson', 'Stevenson–Arce', 'stevenson'),
  {
    id: 'riemersma',
    name: 'Riemersma (Hilbert)',
    group: 'Error diffusion',
    family: 'dither',
    params: [
      num('levels', 'Tone steps', 2, 16, 1, 2, ''),
      num('queue', 'Memory length', 2, 32, 1, 16, ''),
      num('decay', 'Memory decay', 0.5, 0.99, 0.01, 0.85, ''),
    ],
    draw(env) {
      riemersmaPass(env, env.p.levels, env.p.queue | 0, env.p.decay);
    },
  },
];

/* Exposed for the self-check in test/engine.test.mjs — these are the pieces
   where an off-by-one would quietly degrade every effect that uses them. */
export const _internals = { bayer, matrix, KERNELS, hilbertXY, spotThreshold, equalize, CLUSTER_4, CLUSTER_8 };
