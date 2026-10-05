/* Line-screen effects. Each mark is a ribbon whose width tracks the tone under
   it, built as a filled polygon rather than a stroked path so a whole
   separation still collapses into one fill call. */

import {
  clamp, makeSampler, channels, isSeparation, rad, luma, lerp, hexToRgb, makeCanvas,
} from './core.js';
import { num, bool, CELL, ANGLE, DOT } from './params.js';

/* Walks the set of parallel rulings covering the canvas at a given angle. */
export function forEachLine(w, h, step, angleDeg, cb) {
  const a = rad(angleDeg);
  const dx = Math.cos(a), dy = Math.sin(a);
  const nx = -dy, ny = dx;
  const cx = w / 2, cy = h / 2;
  const R = Math.hypot(w, h) / 2 + step * 2;
  const n = Math.ceil(R / step);
  for (let i = -n; i <= n; i++) {
    cb(i, cx + nx * i * step, cy + ny * i * step, dx, dy, nx, ny, R);
  }
}

/* Runs are flat [x, y, nx, ny, halfWidth, ...] rather than arrays of points:
   a long ruling holds thousands of samples and a CMYK crosshatch walks sixteen
   sets of them, so one small array per sample is millions of allocations and
   turns a fast effect into a visible hang. */
const STRIDE = 5;

/* A run becomes a closed ribbon: down one side, back along the other. */
function ribbon(ctx, run) {
  const n = run.length / STRIDE;
  if (n < 2) return false;
  ctx.moveTo(run[0] + run[2] * run[4], run[1] + run[3] * run[4]);
  for (let i = 1; i < n; i++) {
    const o = i * STRIDE;
    ctx.lineTo(run[o] + run[o + 2] * run[o + 4], run[o + 1] + run[o + 3] * run[o + 4]);
  }
  for (let i = n - 1; i >= 0; i--) {
    const o = i * STRIDE;
    ctx.lineTo(run[o] - run[o + 2] * run[o + 4], run[o + 1] - run[o + 3] * run[o + 4]);
  }
  ctx.closePath();
  return true;
}

/* A full-page ruling holds millions of path segments, and one fill() over all
   of them pushes the rasteriser off a cliff — a crosshatch at print resolution
   took sixteen seconds. Filling in chunks is identical for an opaque
   source-over fill, since painting the same colour twice changes nothing. */
const CHUNK_POINTS = 8000;

/* Multiply and additive separations are the exception: there, overlapping
   ribbons within one separation would print twice and darken. Those render to
   a scratch layer with plain source-over first, then composite once. */
function fillRuns(ctx, ch, c, runs, w, h, scratch) {
  const masked = ch.composite !== 'source-over';
  let target = ctx;
  if (masked) {
    scratch.canvas.width = w;
    scratch.canvas.height = h;
    scratch.clearRect(0, 0, w, h);
    target = scratch;
  }
  target.fillStyle = c.color(0, 0, 0);
  target.beginPath();
  let pending = 0;
  for (const run of runs) {
    if (!ribbon(target, run)) continue;
    pending += run.length / STRIDE;
    if (pending >= CHUNK_POINTS) {
      target.fill();
      target.beginPath();
      pending = 0;
    }
  }
  if (pending) target.fill();
  if (masked) ctx.drawImage(scratch.canvas, 0, 0);
}

/* Shared body for every ruling-based effect. `walk` yields runs of samples;
   runs break wherever the ribbon tapers to nothing, which is what keeps
   highlights as clean paper instead of hairlines. */
function linePass(env, step, sampleStep, walk) {
  const { ctx, source, w, h, mode, colors, p } = env;
  const ch = channels(mode, colors);
  const varies = ch.varies;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = ch.paper;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = ch.composite;

  const sample = makeSampler(source.canvas, Math.max(2, sampleStep));
  const scratch = ch.composite === 'source-over'
    ? null
    : makeCanvas(1, 1).getContext('2d');

  for (const c of ch.list) {
    const angle = (p.angle || 0) + (isSeparation(mode) ? c.angle : 0);

    if (varies) {
      /* Each short ribbon carries its own colour, so these cannot be batched. */
      walk(angle, sample, c, (run, rgb) => {
        ctx.beginPath();
        if (ribbon(ctx, run)) {
          ctx.fillStyle = c.color(rgb[0], rgb[1], rgb[2]);
          ctx.fill();
        }
      }, true);
    } else {
      const runs = [];
      walk(angle, sample, c, (run) => runs.push(run), false);
      fillRuns(ctx, ch, c, runs, w, h, scratch);
    }
  }
  ctx.restore();
}

function tone(p, cov) {
  let c = clamp(cov, 0, 1);
  const steps = p.levels | 0;
  if (steps > 1) c = Math.round(c * steps) / steps;
  if (p.dotGamma !== 1) c = Math.pow(c, p.dotGamma);
  return c;
}

/* Walks one ruling, accumulating samples and splitting at taper-to-zero.
   `displace` offsets the ribbon sideways (waves), `widthAt` sets half-width. */
function walkRuling(sample, cparam, p, emit, geom, segLen, widthAt, displace, splitColour) {
  const [i, sx, sy, dx, dy, nx, ny, R] = geom;
  let run = [];
  const lastRgb = [0, 0, 0];
  for (let t = -R; t <= R; t += segLen) {
    const bx = sx + dx * t;
    const by = sy + dy * t;
    const off = displace ? displace(t, i) : 0;
    const x = bx + nx * off;
    const y = by + ny * off;
    const rgb = sample(x, y);
    const cov = tone(p, cparam.cover(rgb[0], rgb[1], rgb[2]));
    const hw = widthAt(cov, t, i);
    if (hw <= 0.02) {
      if (run.length > STRIDE) emit(run, lastRgb.slice());
      run = [];
      continue;
    }
    run.push(x, y, nx, ny, hw);
    if (!splitColour) continue;
    lastRgb[0] = rgb[0]; lastRgb[1] = rgb[1]; lastRgb[2] = rgb[2];
    /* When each mark carries its own colour, break the ribbon into short
       pieces so the line can follow the photo instead of taking one colour. */
    if (run.length >= STRIDE * 3) {
      emit(run, lastRgb.slice());
      run = run.slice(-STRIDE);
    }
  }
  if (run.length > STRIDE) emit(run, lastRgb.slice());
}

/* --------------------------------------------------------------- the effects */

export const lineScreen = {
  id: 'line-screen',
  name: 'Line Screen',
  group: 'Line screens',
  family: 'line',
  params: [
    CELL(8), ANGLE(45),
    num('maxWeight', 'Max line width', 0.1, 2, 0.01, 1, '×'),
    ...DOT.filter((d) => d.key !== 'dotScale' && d.key !== 'minDot'),
    num('minWeight', 'Min line width', 0, 4, 0.05, 0, 'px'),
  ],
  draw(env) {
    const { p, w, h } = env;
    const step = p.cell;
    const seg = Math.max(1, step / 3);
    linePass(env, step, step, (angle, sample, c, emit, varies) => {
      forEachLine(w, h, step, angle, (...geom) =>
        walkRuling(sample, c, p, emit, geom, seg, (cov) => {
          const hw = cov * step * 0.5 * p.maxWeight;
          return hw < p.minWeight / 2 ? (cov > 0.004 ? p.minWeight / 2 : 0) : hw;
        }, null, varies)
      );
    });
  },
};

export const crosshatch = {
  id: 'crosshatch',
  name: 'Crosshatch',
  group: 'Line screens',
  family: 'line',
  params: [
    CELL(9), ANGLE(45),
    num('passes', 'Hatch directions', 1, 6, 1, 4, ''),
    num('spread', 'Angle spread', 10, 180, 1, 120, '°'),
    num('maxWeight', 'Max line width', 0.05, 1.5, 0.01, 0.42, '×'),
    num('dotGamma', 'Dot gamma', 0.2, 4, 0.01, 1, ''),
    num('levels', 'Tone steps', 0, 16, 1, 0, ''),
  ],
  draw(env) {
    const { p, w, h } = env;
    const step = p.cell;
    const seg = Math.max(1, step / 3);
    const K = p.passes | 0;
    /* Pass k only bites where tone is already past k/K, so shadows pick up
       extra directions while highlights keep a single light hatch. */
    linePass(env, step, step, (angle, sample, c, emit, varies) => {
      for (let k = 0; k < K; k++) {
        const a = angle + (k * p.spread) / K;
        forEachLine(w, h, step, a, (...geom) =>
          walkRuling(sample, c, p, emit, geom, seg, (cov) => {
            const local = clamp(cov * K - k, 0, 1);
            return local * step * 0.5 * p.maxWeight;
          }, null, varies)
        );
      }
    });
  },
};

export const waveScreen = {
  id: 'wave',
  name: 'Wave Lines',
  group: 'Line screens',
  family: 'line',
  params: [
    CELL(10), ANGLE(0),
    num('wavelength', 'Wavelength', 4, 200, 1, 40, 'px'),
    num('amplitude', 'Amplitude', 0, 40, 0.5, 6, 'px'),
    num('phaseShift', 'Row phase shift', 0, 180, 1, 45, '°'),
    bool('ampByTone', 'Amplitude follows tone', false),
    num('maxWeight', 'Max line width', 0.1, 2, 0.01, 0.8, '×'),
    num('dotGamma', 'Dot gamma', 0.2, 4, 0.01, 1, ''),
    num('levels', 'Tone steps', 0, 16, 1, 0, ''),
  ],
  draw(env) {
    const { p, w, h } = env;
    const step = p.cell;
    const seg = Math.max(1, Math.min(step / 3, p.wavelength / 12));
    linePass(env, step, step, (angle, sample, c, emit, varies) => {
      forEachLine(w, h, step, angle, (...geom) => {
        const i = geom[0];
        const phase = rad(p.phaseShift) * i;
        let lastCov = 0;
        walkRuling(
          sample, c, p, emit, geom, seg,
          (cov) => { lastCov = cov; return cov * step * 0.5 * p.maxWeight; },
          (t) => {
            const a = p.ampByTone ? p.amplitude * lastCov : p.amplitude;
            return Math.sin((t / p.wavelength) * Math.PI * 2 + phase) * a;
          },
          varies
        );
      });
    });
  },
};

export const squiggle = {
  id: 'squiggle',
  name: 'Squiggle Screen',
  group: 'Line screens',
  family: 'line',
  params: [
    CELL(12), ANGLE(0),
    num('baseFreq', 'Base frequency', 0, 0.5, 0.005, 0.03, ''),
    num('toneFreq', 'Tone → frequency', 0, 1.2, 0.01, 0.35, ''),
    num('amplitude', 'Amplitude', 0, 1.5, 0.01, 0.55, '×cell'),
    num('weight', 'Line width', 0.2, 8, 0.1, 1.4, 'px'),
    num('dotGamma', 'Dot gamma', 0.2, 4, 0.01, 1, ''),
    num('levels', 'Tone steps', 0, 16, 1, 0, ''),
  ],
  draw(env) {
    const { p, w, h } = env;
    const step = p.cell;
    const seg = 1.1;
    /* Frequency rises with darkness, so shadows read as tight scribble and
       highlights as an almost straight line. Phase is integrated along the
       ruling — otherwise changing frequency tears the curve apart. */
    linePass(env, step, step, (angle, sample, c, emit, varies) => {
      forEachLine(w, h, step, angle, (...geom) => {
        let phase = 0;
        let cov = 0;
        walkRuling(
          sample, c, p, emit, geom, seg,
          (v) => { cov = v; return p.weight / 2; },
          (t) => {
            phase += (p.baseFreq + cov * p.toneFreq) * seg;
            return Math.sin(phase) * p.amplitude * step * (0.3 + cov * 0.7);
          },
          varies
        );
      });
    });
  },
};

export const flowHatch = {
  id: 'flow',
  name: 'Flow Hatch',
  group: 'Line screens',
  family: 'line',
  params: [
    CELL(10),
    num('length', 'Stroke length', 0.3, 6, 0.05, 1.1, '×cell'),
    num('weight', 'Stroke width', 0.2, 8, 0.1, 1.3, 'px'),
    num('align', 'Follow contours', 0, 1, 0.01, 1, '×'),
    num('baseAngle', 'Fallback angle', 0, 180, 1, 45, '°'),
    num('dotGamma', 'Dot gamma', 0.2, 4, 0.01, 1, ''),
    num('levels', 'Tone steps', 0, 16, 1, 0, ''),
    num('threshold', 'Ink threshold', 0, 1, 0.01, 0.06, ''),
  ],
  draw(env) {
    const { ctx, source, w, h, mode, colors, p } = env;
    const ch = channels(mode, colors);
    const step = p.cell;
    const varies = ch.varies;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = ch.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = ch.composite;
    ctx.lineCap = 'round';

    const sample = makeSampler(source.canvas, step);
    const d = Math.max(1.5, step * 0.7);
    /* Strokes run perpendicular to the luminance gradient, so they wrap around
       forms the way hand hatching does. Flat areas have no gradient worth
       following, hence the fallback angle. */
    for (const c of ch.list) {
      const base = rad(p.baseAngle + (isSeparation(mode) ? c.angle : 0));
      ctx.beginPath();
      let any = false;
      for (let y = step / 2; y < h + step; y += step) {
        for (let x = step / 2; x < w + step; x += step) {
          const px = sample(x, y);
          let cov = clamp(c.cover(px[0], px[1], px[2]), 0, 1);
          if (p.levels > 1) cov = Math.round(cov * p.levels) / p.levels;
          if (p.dotGamma !== 1) cov = Math.pow(cov, p.dotGamma);
          if (cov <= p.threshold) continue;

          const lx = luma(...sample(x - d, y)) - luma(...sample(x + d, y));
          const ly = luma(...sample(x, y - d)) - luma(...sample(x, y + d));
          const mag = Math.hypot(lx, ly);
          const grad = mag > 0.004 ? Math.atan2(ly, lx) + Math.PI / 2 : base;
          const a = lerp(base, grad, p.align);

          const len = step * p.length * (0.1 + cov * 0.9);
          const hx = (Math.cos(a) * len) / 2;
          const hy = (Math.sin(a) * len) / 2;
          if (varies) {
            ctx.beginPath();
            ctx.moveTo(x - hx, y - hy);
            ctx.lineTo(x + hx, y + hy);
            ctx.strokeStyle = c.color(px[0], px[1], px[2]);
            ctx.lineWidth = p.weight;
            ctx.stroke();
          } else {
            ctx.moveTo(x - hx, y - hy);
            ctx.lineTo(x + hx, y + hy);
            any = true;
          }
        }
      }
      if (any) {
        ctx.strokeStyle = c.color(0, 0, 0);
        ctx.lineWidth = p.weight;
        ctx.stroke();
      }
    }
    ctx.restore();
  },
};

export const contour = {
  id: 'contour',
  name: 'Contour Lines',
  group: 'Line screens',
  family: 'line',
  params: [
    num('bands', 'Tone bands', 2, 40, 1, 10, ''),
    num('weight', 'Line width', 1, 6, 1, 1, 'px'),
    num('smooth', 'Smoothing', 1, 24, 1, 3, 'px'),
    bool('fillBands', 'Fill bands', false),
  ],
  draw(env) {
    const { ctx, source, w, h, mode, colors, p } = env;
    /* Contours are a single outline, not a screen, so there is nothing for a
       CMYK or RGB separation to do — taking its first channel would just draw
       everything in cyan. Fall back to one ink on paper. */
    const ch = channels(isSeparation(mode) ? 'mono' : mode, colors);
    const c0 = ch.list[0];
    const paper = hexToRgb(ch.paper);
    const n = p.bands | 0;
    const lw = p.weight | 0;

    /* Band index per pixel; an iso-line is just a pixel whose band differs
       from a neighbour. Sampling through the mip gives the smoothing. */
    const sample = makeSampler(source.canvas, p.smooth);
    const band = new Uint8Array(w * h);
    const src = new Float32Array(w * h * 3);
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        const s = sample(x, y);
        src[i * 3] = s[0]; src[i * 3 + 1] = s[1]; src[i * 3 + 2] = s[2];
        band[i] = clamp(Math.floor(luma(s[0], s[1], s[2]) * n), 0, n - 1);
      }
    }

    const out = ctx.createImageData(w, h);
    const px = out.data;
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        const b = band[i];
        let edge = false;
        for (let k = 1; k <= lw && !edge; k++) {
          if ((x + k < w && band[i + k] !== b) || (y + k < h && band[i + k * w] !== b)) edge = true;
        }
        const o = i * 4;
        let col;
        if (edge) {
          col = c0.rgb(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
        } else if (p.fillBands) {
          /* Unlit bands are the ink colour let down towards paper by band index,
             which posterises the image instead of only outlining it. */
          const t = n > 1 ? b / (n - 1) : 1;
          const c = c0.rgb(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
          col = [lerp(c[0], paper[0], t), lerp(c[1], paper[1], t), lerp(c[2], paper[2], t)];
        } else {
          col = paper;
        }
        px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};

export const LINE_EFFECTS = [
  lineScreen, crosshatch, waveScreen, squiggle, flowHatch, contour,
];
