/* Shared plumbing for the halftone engine: preprocessing, sampling, grids, shapes, ink.
   Everything here is hand-rolled on top of Canvas 2D — no image libraries. */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;
export const rad = (deg) => (deg * Math.PI) / 180;

/* Rec. 709 luma, the one that matches how we actually see brightness. */
export const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbCss = (r, g, b) => 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

/* ---------------------------------------------------------------- preprocess */

/* One 256-entry lookup table folds brightness, contrast, gamma and invert into
   a single pass. Blur rides on ctx.filter when the browser has it. */
function toneLut({ brightness, contrast, gamma, invert }) {
  const lut = new Uint8Array(256);
  const c = contrast / 100;
  const b = brightness / 100;
  const g = Math.max(0.01, gamma);
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    v = (v - 0.5) * (1 + c) + 0.5 + b;
    v = Math.pow(clamp(v, 0, 1), 1 / g);
    if (invert) v = 1 - v;
    lut[i] = clamp(Math.round(v * 255), 0, 255);
  }
  return lut;
}

const CAN_FILTER = (() => {
  try {
    return 'filter' in makeCanvas(1, 1).getContext('2d');
  } catch {
    return false;
  }
})();

/* Returns a canvas holding the tone-mapped, optionally blurred, optionally
   desaturated source at working resolution. */
export function preprocess(img, opts) {
  const { maxSize, blur, saturation } = opts;
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const k = Math.min(1, maxSize / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * k));
  const h = Math.max(1, Math.round(srcH * k));

  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (blur > 0 && CAN_FILTER) ctx.filter = 'blur(' + blur + 'px)';
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = 'none';

  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const lut = toneLut(opts);
  const sat = saturation / 100;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i], g = px[i + 1], b = px[i + 2];
    if (sat !== 1) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = clamp(l + (r - l) * sat, 0, 255);
      g = clamp(l + (g - l) * sat, 0, 255);
      b = clamp(l + (b - l) * sat, 0, 255);
    }
    px[i] = lut[r | 0];
    px[i + 1] = lut[g | 0];
    px[i + 2] = lut[b | 0];
  }
  ctx.putImageData(data, 0, 0);
  return { canvas: c, ctx, data, width: w, height: h };
}

/* ------------------------------------------------------------------ sampling */

/* Repeated halving before the final draw — a single huge downscale step looks
   gritty, successive halves give a clean box average. */
function downscale(src, sw, sh) {
  let cur = src;
  let cw = src.width;
  let ch = src.height;
  while (cw > sw * 2 && ch > sh * 2) {
    const nw = Math.max(sw, cw >> 1);
    const nh = Math.max(sh, ch >> 1);
    const c = makeCanvas(nw, nh);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, nw, nh);
    cur = c;
    cw = nw;
    ch = nh;
  }
  const out = makeCanvas(sw, sh);
  const g = out.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, sw, sh);
  return g.getImageData(0, 0, sw, sh);
}

/* A bilinear sampler over a mip matched to the cell size: every dot reads the
   true average of the area it covers instead of one arbitrary pixel. */
export function makeSampler(srcCanvas, cell) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const sw = clamp(Math.round(w / Math.max(1, cell)), 1, w);
  const sh = clamp(Math.round(h / Math.max(1, cell)), 1, h);
  const img = downscale(srcCanvas, sw, sh);
  const d = img.data;
  const out = [0, 0, 0];

  return function sample(x, y) {
    const fx = clamp((x / w) * sw - 0.5, 0, sw - 1);
    const fy = clamp((y / h) * sh - 0.5, 0, sh - 1);
    const x0 = fx | 0, y0 = fy | 0;
    const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
    const tx = fx - x0, ty = fy - y0;
    const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
    const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
    for (let k = 0; k < 3; k++) {
      const top = lerp(d[i00 + k], d[i10 + k], tx);
      const bot = lerp(d[i01 + k], d[i11 + k], tx);
      out[k] = lerp(top, bot, ty);
    }
    return out;
  };
}

/* --------------------------------------------------------------------- grids */

/* Walks a square lattice rotated by angleDeg about the canvas centre, which is
   what gives a halftone screen its angle without rotating the image. */
export function squareGrid(w, h, step, angleDeg, cb) {
  const a = rad(angleDeg);
  const cos = Math.cos(a), sin = Math.sin(a);
  const cx = w / 2, cy = h / 2;
  const n = Math.ceil((Math.hypot(w, h) / 2 + step) / step);
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const u = i * step, v = j * step;
      const x = cx + u * cos - v * sin;
      const y = cy + u * sin + v * cos;
      if (x < -step || y < -step || x > w + step || y > h + step) continue;
      cb(x, y, i, j);
    }
  }
}

/* Hexagonal close packing: rows offset by half a step, rows 0.866 apart. */
export function hexGrid(w, h, step, angleDeg, cb) {
  const a = rad(angleDeg);
  const cos = Math.cos(a), sin = Math.sin(a);
  const cx = w / 2, cy = h / 2;
  const rowH = step * 0.8660254;
  const n = Math.ceil((Math.hypot(w, h) / 2 + step) / Math.min(step, rowH));
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const u = (i + (j & 1 ? 0.5 : 0)) * step;
      const v = j * rowH;
      const x = cx + u * cos - v * sin;
      const y = cy + u * sin + v * cos;
      if (x < -step || y < -step || x > w + step || y > h + step) continue;
      cb(x, y, i, j);
    }
  }
}

/* Polar lattice: rings `step` apart, each subdivided so arc length stays ~step. */
export function polarGrid(w, h, step, originX, originY, cb) {
  const maxR = Math.max(
    Math.hypot(originX, originY),
    Math.hypot(w - originX, originY),
    Math.hypot(originX, h - originY),
    Math.hypot(w - originX, h - originY)
  );
  cb(originX, originY, 0, 0);
  for (let r = step; r <= maxR + step; r += step) {
    const count = Math.max(6, Math.round((TAU * r) / step));
    for (let i = 0; i < count; i++) {
      const t = (i / count) * TAU;
      const x = originX + Math.cos(t) * r;
      const y = originY + Math.sin(t) * r;
      if (x < -step || y < -step || x > w + step || y > h + step) continue;
      cb(x, y, i, r);
    }
  }
}

/* Archimedean spiral walked at constant arc length so dots stay evenly spaced. */
export function spiralPath(w, h, step, tightness, originX, originY, cb) {
  const maxR = Math.max(
    Math.hypot(originX, originY),
    Math.hypot(w - originX, originY),
    Math.hypot(originX, h - originY),
    Math.hypot(w - originX, h - originY)
  );
  const b = (step * tightness) / TAU;
  let t = 0;
  let guard = 0;
  while (true) {
    const r = b * t;
    if (r > maxR + step) break;
    if (++guard > 400000) break;
    const x = originX + Math.cos(t) * r;
    const y = originY + Math.sin(t) * r;
    if (x > -step && y > -step && x < w + step && y < h + step) cb(x, y, r, t);
    t += step / Math.max(b * 0.5, Math.hypot(b, r));
  }
}

/* -------------------------------------------------------------------- shapes */

/* All dot shapes share one entry point so every grid effect can offer all of
   them instead of each effect hard-coding a single shape. */
export function tracePath(ctx, shape, x, y, r, rot) {
  if (r <= 0) return;
  switch (shape) {
    case 'circle':
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
      return;
    case 'square':
      return polygon(ctx, x, y, r * 1.1, 4, rot + Math.PI / 4);
    case 'diamond':
      return polygon(ctx, x, y, r * 1.25, 4, rot);
    case 'triangle':
      return polygon(ctx, x, y, r * 1.35, 3, rot - Math.PI / 2);
    case 'hexagon':
      return polygon(ctx, x, y, r * 1.1, 6, rot);
    case 'pentagon':
      return polygon(ctx, x, y, r * 1.15, 5, rot - Math.PI / 2);
    case 'cross': {
      const a = r * 1.25, b = r * 0.42;
      return rotRect(ctx, x, y, a, b, rot), rotRect(ctx, x, y, b, a, rot);
    }
    case 'star':
      return star(ctx, x, y, r * 1.45, r * 0.6, 5, rot - Math.PI / 2);
    case 'ellipse':
      ctx.moveTo(x + r * 1.4, y);
      ctx.ellipse(x, y, r * 1.4, r * 0.7, rot, 0, TAU);
      return;
    default:
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
  }
}

function polygon(ctx, x, y, r, sides, rot) {
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * TAU;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function star(ctx, x, y, outer, inner, points, rot) {
  for (let i = 0; i < points * 2; i++) {
    const r = i & 1 ? inner : outer;
    const a = rot + (i / (points * 2)) * TAU;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function rotRect(ctx, x, y, hw, hh, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  pts.forEach(([px, py], i) => {
    const rx = x + px * c - py * s;
    const ry = y + px * s + py * c;
    if (i === 0) ctx.moveTo(rx, ry);
    else ctx.lineTo(rx, ry);
  });
  ctx.closePath();
}

export const SHAPES = [
  'circle', 'square', 'diamond', 'triangle', 'hexagon',
  'pentagon', 'cross', 'star', 'ellipse',
];

/* ----------------------------------------------------------------------- ink */

/* A "channel" is one printing pass: how much ink a sample asks for, what colour
   it lays down, and how it composites. Separations fall out of this naturally —
   mono is one channel, CMYK is four at different screen angles.

   Each channel exposes `rgb()` as numbers for per-pixel effects and `color()`
   as a CSS string for canvas fills, so both families share one definition. */
export function channels(mode, colors) {
  const ink = hexToRgb(colors.ink);
  const shadow = hexToRgb(colors.shadow);
  const highlight = hexToRgb(colors.highlight);
  const flat = (c) => () => c;

  let spec;
  switch (mode) {
    case 'cmyk':
      spec = {
        paper: '#ffffff',
        composite: 'multiply',
        varies: false,
        list: [
          { angle: 15, rgb: flat([0, 174, 239]), cover: cmykAt(0) },
          { angle: 75, rgb: flat([236, 0, 140]), cover: cmykAt(1) },
          { angle: 0, rgb: flat([255, 241, 0]), cover: cmykAt(2) },
          { angle: 45, rgb: flat([35, 31, 32]), cover: cmykAt(3) },
        ],
      };
      break;

    case 'rgb':
      spec = {
        paper: '#000000',
        composite: 'lighter',
        varies: false,
        list: [
          { angle: 15, rgb: flat([255, 0, 0]), cover: (r) => r / 255 },
          { angle: 75, rgb: flat([0, 255, 0]), cover: (r, g) => g / 255 },
          { angle: 45, rgb: flat([0, 0, 255]), cover: (r, g, b) => b / 255 },
        ],
      };
      break;

    case 'original':
      spec = {
        paper: colors.paper,
        composite: 'source-over',
        varies: true,
        list: [{ angle: 0, rgb: (r, g, b) => [r, g, b], cover: coverFromLuma }],
      };
      break;

    case 'duotone':
      spec = {
        paper: colors.paper,
        composite: 'source-over',
        varies: true,
        list: [{
          angle: 0,
          rgb: (r, g, b) => {
            const t = luma(r, g, b);
            return [
              lerp(shadow[0], highlight[0], t),
              lerp(shadow[1], highlight[1], t),
              lerp(shadow[2], highlight[2], t),
            ];
          },
          cover: coverFromLuma,
        }],
      };
      break;

    case 'palette': {
      const pal = colors.palette.map(hexToRgb);
      spec = {
        paper: colors.paper,
        composite: 'source-over',
        varies: true,
        list: [{ angle: 0, rgb: (r, g, b) => nearest(pal, r, g, b), cover: coverFromLuma }],
      };
      break;
    }

    default: /* single ink on paper */
      spec = {
        paper: colors.paper,
        composite: 'source-over',
        varies: false,
        list: [{ angle: 0, rgb: flat(ink), cover: coverFromLuma }],
      };
  }

  spec.list.forEach((c) => {
    c.color = (r, g, b) => {
      const v = c.rgb(r, g, b);
      return rgbCss(v[0], v[1], v[2]);
    };
  });
  return spec;
}

const coverFromLuma = (r, g, b) => 1 - luma(r, g, b);

const cmykAt = (idx) => (r, g, b) => {
  const k = 1 - Math.max(r, g, b) / 255;
  if (idx === 3) return k;
  if (k >= 1) return 0;
  const v = [r, g, b][idx] / 255;
  return (1 - v - k) / (1 - k);
};

export function nearest(pal, r, g, b) {
  let best = pal[0];
  let bd = Infinity;
  for (const c of pal) {
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/* Only CMYK and RGB separations need their own screen angles; everything else
   is a single pass and must not be rotated per channel. */
export const isSeparation = (mode) => mode === 'cmyk' || mode === 'rgb';
