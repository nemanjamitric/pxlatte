/* Self-check for the parts of the engine where an off-by-one would quietly
   degrade every effect built on top of them. Run: node test/engine.test.mjs */

import assert from 'node:assert/strict';
import { _internals, makeQuantizer, makeSpot, SPOTS, SPOT_NAMES } from '../src/lib/dither.js';
import { EFFECTS, EFFECT_GROUPS, defaultsFor, paramsForEffect } from '../src/lib/engine.js';

const { bayer, matrix, KERNELS, hilbertXY, CLUSTER_4, CLUSTER_8 } = _internals;

/* --- Bayer: every cell distinct, strictly inside (0,1) -------------------- */
for (const size of [2, 4, 8, 16]) {
  const b = bayer(size);
  const seen = new Set();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = b.get(x, y);
      assert.ok(v > 0 && v < 1, `bayer${size} value out of range: ${v}`);
      seen.add(v.toFixed(8));
    }
  }
  assert.equal(seen.size, size * size, `bayer${size} is not a permutation`);
  /* Tiles: reading past the edge must wrap, not run off the matrix. */
  assert.equal(b.get(0, 0), b.get(size, size));
}

/* --- Clustered matrices: complete 0..n-1 permutations --------------------- */
for (const [name, m] of [['cluster4', CLUSTER_4], ['cluster8', CLUSTER_8]]) {
  const flat = m.flat().sort((a, b) => a - b);
  assert.deepEqual(flat, flat.map((_, i) => i), `${name} is not a permutation`);
  const t = matrix(m);
  assert.ok(t.get(0, 0) > 0 && t.get(0, 0) < 1);
}

/* --- Diffusion kernels: weights match the stated divisor ------------------ */
const EXPECTED_SUM = { atkinson: 6 }; /* Atkinson drops 2/8 of the error on purpose */
for (const [name, k] of Object.entries(KERNELS)) {
  const sum = k.cells.reduce((a, c) => a + c[2], 0);
  assert.equal(sum, EXPECTED_SUM[name] ?? k.div, `${name}: weights ${sum} vs div ${k.div}`);
  for (const [dx, dy, wt] of k.cells) {
    assert.ok(wt > 0, `${name}: non-positive weight`);
    /* Error may only travel to pixels not yet visited. */
    assert.ok(dy > 0 || (dy === 0 && dx > 0), `${name}: kernel writes backwards at ${dx},${dy}`);
  }
}

/* --- Hilbert curve: visits every cell exactly once, single steps ---------- */
for (const order of [4, 8, 16]) {
  const seen = new Set();
  let prev = null;
  for (let d = 0; d < order * order; d++) {
    const [x, y] = hilbertXY(d, order);
    assert.ok(x >= 0 && x < order && y >= 0 && y < order, `hilbert ${order} out of bounds`);
    seen.add(x + ',' + y);
    if (prev) {
      const dist = Math.abs(x - prev[0]) + Math.abs(y - prev[1]);
      assert.equal(dist, 1, `hilbert ${order} jumped ${dist} at d=${d}`);
    }
    prev = [x, y];
  }
  assert.equal(seen.size, order * order, `hilbert ${order} missed cells`);
}

/* --- Spot functions: inside [0,1], ink starts at the cell centre ---------- */
for (const name of SPOT_NAMES) {
  const f = SPOTS[name];
  assert.ok(f(0, 0) < 0.02, `${name}: centre should take ink first, got ${f(0, 0)}`);
  for (let u = -1; u <= 1; u += 0.07) {
    for (let v = -1; v <= 1; v += 0.07) {
      const t = f(u, v);
      assert.ok(t >= -1e-9 && t <= 1 + 1e-9, `${name}(${u},${v}) = ${t} out of range`);
    }
  }
  /* A corner must take ink later than the centre, or there is no dot. */
  assert.ok(f(1, 1) > f(0, 0), `${name}: corner not later than centre`);
}

/* --- Equalised spots: threshold T must cover T of the cell ---------------- */
/* This is what makes a screen reproduce tone linearly. Without it, `round`
   inks ~40% of the cell at a threshold of 0.5 and midtones slam to solid. */
for (const name of SPOT_NAMES) {
  const f = makeSpot(name);
  const n = 220;
  for (const T of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    let inked = 0;
    for (let j = 0; j < n; j++) {
      const v = ((j + 0.5) / n) * 2 - 1;
      for (let i = 0; i < n; i++) {
        if (f(((i + 0.5) / n) * 2 - 1, v) < T) inked++;
      }
    }
    const frac = inked / (n * n);
    assert.ok(Math.abs(frac - T) < 0.03,
      `${name}: threshold ${T} inks ${frac.toFixed(3)} of the cell`);
  }
  /* Still the right shape: centre takes ink before the corner. */
  assert.ok(f(0, 0) < f(1, 1), `${name}: equalising broke the spot shape`);
}

/* --- Quantisers: the inverse of read is toRgb, within one step ------------ */
const colors = {
  ink: '#000000', paper: '#ffffff', shadow: '#111111', highlight: '#eeeeee',
  palette: ['#000000', '#ff0000', '#00ff00', '#0000ff', '#ffffff'],
};
for (const mode of ['mono', 'duotone', 'original', 'rgb', 'cmyk', 'palette']) {
  const q = makeQuantizer(mode, colors, 16);
  const c = new Float32Array(q.n);
  const qq = new Float32Array(q.n);
  const out = new Float32Array(3);
  for (const px of [[0, 0, 0], [255, 255, 255], [200, 40, 90], [12, 180, 240]]) {
    q.read(px[0], px[1], px[2], c);
    for (let k = 0; k < q.n; k++) {
      assert.ok(c[k] >= -1e-6 && c[k] <= 1 + 1e-6, `${mode}: component ${k} = ${c[k]}`);
    }
    q.quant(c, qq);
    q.toRgb(qq, out);
    for (let k = 0; k < 3; k++) {
      assert.ok(out[k] >= -1 && out[k] <= 256, `${mode}: channel ${k} = ${out[k]}`);
    }
  }
  /* A mid grey must not collapse to pure black or pure white at 16 steps. */
  q.read(128, 128, 128, c);
  q.quant(c, qq);
  q.toRgb(qq, out);
  if (mode === 'mono' || mode === 'original') {
    assert.ok(out[0] > 40 && out[0] < 215, `${mode}: mid grey crushed to ${out[0]}`);
  }
}

/* --- Catalogue: unique ids, every param has a default in range ------------ */
const ids = new Set();
for (const e of EFFECTS) {
  assert.ok(!ids.has(e.id), `duplicate effect id: ${e.id}`);
  ids.add(e.id);
  assert.ok(e.name && e.group && typeof e.draw === 'function', `${e.id} is incomplete`);
  assert.ok(e.params.length > 0, `${e.id} has no params`);
  const keys = new Set();
  for (const p of e.params) {
    assert.ok(!keys.has(p.key), `${e.id}: duplicate param ${p.key}`);
    keys.add(p.key);
    if (p.type === 'num') {
      assert.ok(p.def >= p.min && p.def <= p.max, `${e.id}.${p.key}: default ${p.def} outside ${p.min}..${p.max}`);
      assert.ok(p.step > 0, `${e.id}.${p.key}: bad step`);
    }
    if (p.type === 'sel') assert.ok(p.options.includes(p.def), `${e.id}.${p.key}: default not an option`);
  }
  assert.deepEqual(Object.keys(defaultsFor(e.params)).sort(), [...keys].sort());
}

/* Shared keys carry across an effect switch, unknown ones do not leak. */
const carried = paramsForEffect(EFFECTS[0], { cell: 33, nonsense: 1 });
assert.equal(carried.cell, 33);
assert.equal(carried.nonsense, undefined);

console.log(`ok — ${EFFECTS.length} effects in ${Object.keys(EFFECT_GROUPS).length} groups, all checks passed`);
