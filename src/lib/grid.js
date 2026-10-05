/* Dot-screen effects: every one of these lays ink on a lattice, sizing each
   mark by how dark the photo is underneath it. */

import {
  clamp, makeSampler, squareGrid, hexGrid, polarGrid, spiralPath,
  tracePath, channels, isSeparation, rad, TAU, SHAPES,
} from './core.js';
import { num, bool, sel, text, CELL, ANGLE, DOT, ORIGIN } from './params.js';

/* Coverage (0 = paper, 1 = solid) to mark radius. Area-proportional, so a
   coverage of 1 lands where neighbouring dots just touch — the point where a
   real screen goes solid. */
function radiusFn(step, p) {
  const max = step * 0.565 * p.dotScale;
  const g = p.dotGamma;
  const steps = p.levels | 0;
  return (cov) => {
    let c = clamp(cov, 0, 1);
    if (steps > 1) c = Math.round(c * steps) / steps;
    if (g !== 1) c = Math.pow(c, g);
    const r = max * Math.sqrt(c);
    return r < p.minDot ? (c > 0.004 ? p.minDot : 0) : r;
  };
}

/* The one routine every lattice effect runs through: paper down, then one pass
   per ink channel, each pass walking the lattice at its own screen angle. */
export function screenPass(env, step, iterate, mark, fillRule = 'nonzero') {
  const { ctx, source, w, h, mode, colors, p } = env;
  const ch = channels(mode, colors);
  const varies = ch.varies;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = ch.paper;
  ctx.fillRect(0, 0, w, h);

  const sample = makeSampler(source.canvas, step);
  ctx.globalCompositeOperation = ch.composite;

  for (const c of ch.list) {
    const angle = (p.angle || 0) + (isSeparation(mode) ? c.angle : 0);

    if (varies) {
      /* Colour changes dot to dot, so each mark is its own fill. */
      iterate(angle, (x, y, extra) => {
        const [r, g, b] = sample(x, y);
        const cov = c.cover(r, g, b);
        ctx.beginPath();
        if (mark(ctx, x, y, cov, angle, extra, sample)) {
          ctx.fillStyle = c.color(r, g, b);
          ctx.fill(fillRule);
        }
      });
    } else {
      /* One flat colour, so batch the whole separation into a single path —
         thousands of fill() calls is the difference between 30ms and 3s. */
      ctx.beginPath();
      let any = false;
      iterate(angle, (x, y, extra) => {
        const [r, g, b] = sample(x, y);
        any = mark(ctx, x, y, c.cover(r, g, b), angle, extra, sample) || any;
      });
      if (any) {
        ctx.fillStyle = c.color(0, 0, 0);
        ctx.fill(fillRule);
      }
    }
  }
  ctx.restore();
}

/* A plain dot screen on a square or hex lattice, any shape, any angle. */
function latticeEffect(id, name, lattice, extraParams = [], defaults = {}) {
  return {
    id,
    name,
    group: 'Dot screens',
    family: 'grid',
    params: [
      CELL(defaults.cell ?? 10),
      ANGLE(defaults.angle ?? 45),
      sel('shape', 'Dot shape', SHAPES, defaults.shape ?? 'circle'),
      num('shapeRot', 'Shape rotation', 0, 360, 1, defaults.shapeRot ?? 0, '°'),
      ...DOT,
      ...extraParams,
    ],
    draw(env) {
      const { p, w, h } = env;
      const step = p.cell;
      const r = radiusFn(step, p);
      const walk = lattice === 'hex' ? hexGrid : squareGrid;
      screenPass(
        env,
        step,
        (angle, cb) => walk(w, h, step, angle, cb),
        (ctx, x, y, cov, angle) => {
          const rr = r(cov);
          if (rr <= 0) return false;
          tracePath(ctx, p.shape, x, y, rr, rad(p.shapeRot) + rad(angle));
          return true;
        }
      );
    },
  };
}

/* --------------------------------------------------------------- the effects */

export const dotScreen = latticeEffect('dot-screen', 'Dot Screen', 'square');
export const hexScreen = latticeEffect('hex-screen', 'Hex Packed Screen', 'hex', [], {
  angle: 0,
});

export const ringScreen = {
  id: 'ring-screen',
  name: 'Ring Screen',
  group: 'Dot screens',
  family: 'grid',
  params: [
    CELL(12), ANGLE(45),
    sel('shape', 'Ring shape', SHAPES, 'circle'),
    num('thickness', 'Ring thickness', 0.05, 1, 0.01, 0.3, '×'),
    ...DOT,
  ],
  draw(env) {
    const { p, w, h } = env;
    const step = p.cell;
    const r = radiusFn(step, p);
    /* Drawn as a filled annulus (outer path + reversed inner path) so it still
       batches into one fill with the rest of the separation. */
    screenPass(
      env, step,
      (angle, cb) => squareGrid(w, h, step, angle, cb),
      (c, x, y, cov, angle) => {
        const ro = r(cov);
        if (ro <= 0.3) return false;
        const ri = ro * (1 - p.thickness);
        tracePath(c, p.shape, x, y, ro, rad(angle));
        if (ri > 0.3) {
          c.moveTo(x + ri, y);
          c.arc(x, y, ri, 0, TAU, true);
        }
        return true;
      },
      'evenodd'
    );
  },
};

export const concentric = {
  id: 'concentric',
  name: 'Concentric Rings',
  group: 'Dot screens',
  family: 'grid',
  params: [
    CELL(14),
    sel('shape', 'Dot shape', SHAPES, 'circle'),
    ...ORIGIN, ...DOT,
  ],
  draw(env) {
    const { p, w, h } = env;
    const step = p.cell;
    const r = radiusFn(step, p);
    const ox = (p.originX / 100) * w;
    const oy = (p.originY / 100) * h;
    screenPass(
      env, step,
      (angle, cb) => polarGrid(w, h, step, ox, oy, cb),
      (ctx, x, y, cov) => {
        const rr = r(cov);
        if (rr <= 0) return false;
        tracePath(ctx, p.shape, x, y, rr, Math.atan2(y - oy, x - ox));
        return true;
      }
    );
  },
};

export const spiralScreen = {
  id: 'spiral',
  name: 'Spiral Screen',
  group: 'Dot screens',
  family: 'grid',
  params: [
    CELL(8),
    num('tightness', 'Spiral pitch', 0.3, 4, 0.01, 1, '×'),
    sel('shape', 'Dot shape', SHAPES, 'circle'),
    ...ORIGIN, ...DOT,
  ],
  draw(env) {
    const { p, w, h } = env;
    const step = p.cell;
    const r = radiusFn(step, p);
    const ox = (p.originX / 100) * w;
    const oy = (p.originY / 100) * h;
    screenPass(
      env, step,
      (angle, cb) => spiralPath(w, h, step, p.tightness, ox, oy, cb),
      (ctx, x, y, cov) => {
        const rr = r(cov);
        if (rr <= 0) return false;
        tracePath(ctx, p.shape, x, y, rr, Math.atan2(y - oy, x - ox));
        return true;
      }
    );
  },
};

export const stipple = {
  id: 'stipple',
  name: 'Stochastic Stipple',
  group: 'Dot screens',
  family: 'grid',
  params: [
    num('density', 'Density', 500, 500000, 500, 90000, '/MP'),
    num('dotSize', 'Point size', 0.2, 12, 0.1, 1.4, 'px'),
    num('sizeVary', 'Size by tone', 0, 1, 0.01, 0.5, '×'),
    sel('shape', 'Point shape', SHAPES, 'circle'),
    num('seed', 'Seed', 1, 999, 1, 7, ''),
    num('levels', 'Tone steps', 0, 16, 1, 0, ''),
  ],
  draw(env) {
    const { p, w, h } = env;
    /* Rejection sampling: throw candidates at random and keep each with
       probability equal to the local darkness — the uneven organic look of real
       stippling without a relaxation pass. The rate is per megapixel so the
       result does not change when the resolution slider moves. */
    const rnd = mulberry(p.seed * 2654435761);
    const count = Math.round((p.density * w * h) / 1e6);
    const tries = count * 12;
    screenPass(
      env, Math.max(2, p.dotSize * 2),
      (angle, cb) => {
        let placed = 0;
        for (let i = 0; i < tries && placed < count; i++) {
          cb(rnd() * w, rnd() * h, rnd());
          placed++;
        }
      },
      (ctx, x, y, cov, angle, roll) => {
        let c = clamp(cov, 0, 1);
        if (p.levels > 1) c = Math.round(c * p.levels) / p.levels;
        if (roll > c) return false;
        const rr = p.dotSize * (1 - p.sizeVary + p.sizeVary * (0.4 + c));
        tracePath(ctx, p.shape, x, y, rr, 0);
        return true;
      }
    );
  },
};

export const mosaic = {
  id: 'mosaic',
  name: 'Pixel Mosaic',
  group: 'Dot screens',
  family: 'grid',
  params: [
    CELL(14), ANGLE(0),
    sel('shape', 'Cell shape', SHAPES, 'square'),
    num('fill', 'Cell fill', 0.1, 1.6, 0.01, 1, '×'),
    num('levels', 'Tone steps', 0, 16, 1, 0, ''),
    num('dotGamma', 'Tone gamma', 0.2, 4, 0.01, 1, ''),
  ],
  draw(env) {
    const { ctx, source, w, h, mode, colors, p } = env;
    const ch = channels(mode, colors);
    const step = p.cell;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = ch.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = ch.composite;

    const sample = makeSampler(source.canvas, step);
    const r = step * 0.5 * p.fill;
    /* Cells are all the same size, so tone has to come from somewhere else:
       the pixel's own colour where there is one, otherwise ink density. */
    for (const c of ch.list) {
      const angle = (p.angle || 0) + (isSeparation(mode) ? c.angle : 0);
      squareGrid(w, h, step, angle, (x, y) => {
        const px = sample(x, y);
        let cov = clamp(c.cover(px[0], px[1], px[2]), 0, 1);
        if (p.levels > 1) cov = Math.round(cov * p.levels) / p.levels;
        if (p.dotGamma !== 1) cov = Math.pow(cov, p.dotGamma);
        if (ch.varies) {
          ctx.globalAlpha = 1;
        } else {
          if (cov <= 0.002) return;
          ctx.globalAlpha = cov;
        }
        ctx.beginPath();
        tracePath(ctx, p.shape, x, y, r, rad(angle));
        ctx.fillStyle = c.color(px[0], px[1], px[2]);
        ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  },
};

export const asciiScreen = {
  id: 'ascii',
  name: 'ASCII Screen',
  group: 'Dot screens',
  family: 'grid',
  params: [
    CELL(12),
    text('ramp', 'Character ramp', ' .:-=+*#%@'),
    num('weight', 'Font weight', 100, 900, 100, 700, ''),
    num('sizeFit', 'Glyph size', 0.5, 2, 0.01, 1.45, '×'),
    bool('monospace', 'Monospace', true),
    num('levels', 'Tone steps', 0, 16, 1, 0, ''),
  ],
  draw(env) {
    const { ctx, source, w, h, mode, colors, p } = env;
    const ch = channels(mode, colors);
    const step = p.cell;
    const ramp = p.ramp.length ? p.ramp : ' .:-=+*#%@';

    ctx.save();
    ctx.fillStyle = ch.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = ch.composite;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font =
      p.weight + ' ' + (step * p.sizeFit).toFixed(2) + 'px ' +
      (p.monospace ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'Switzer, sans-serif');

    const sample = makeSampler(source.canvas, step);
    for (const c of ch.list) {
      squareGrid(w, h, step, 0, (x, y) => {
        const [r, g, b] = sample(x, y);
        let cov = clamp(c.cover(r, g, b), 0, 1);
        if (p.levels > 1) cov = Math.round(cov * p.levels) / p.levels;
        const idx = Math.min(ramp.length - 1, Math.floor(cov * ramp.length));
        const glyph = ramp[idx];
        if (glyph === ' ') return;
        ctx.fillStyle = c.color(r, g, b);
        ctx.fillText(glyph, x, y);
      });
    }
    ctx.restore();
  },
};

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GRID_EFFECTS = [
  dotScreen, hexScreen, ringScreen, concentric, spiralScreen,
  stipple, mosaic, asciiScreen,
];
