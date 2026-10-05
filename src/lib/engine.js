/* Public face of the engine: the effect catalogue and one render call. */

import { preprocess } from './core.js';
import { num, bool } from './params.js';
import { GRID_EFFECTS } from './grid.js';
import { LINE_EFFECTS } from './lines.js';
import { DITHER_EFFECTS } from './dither.js';

export const EFFECTS = [...GRID_EFFECTS, ...LINE_EFFECTS, ...DITHER_EFFECTS];

export const EFFECTS_BY_ID = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));

export const EFFECT_GROUPS = EFFECTS.reduce((acc, e) => {
  (acc[e.group] ||= []).push(e);
  return acc;
}, {});

/* Tone controls applied before any screening, shared by every effect. */
export const PRE_PARAMS = [
  num('maxSize', 'Resolution', 320, 3000, 20, 1400, 'px'),
  num('brightness', 'Brightness', -100, 100, 1, 0, ''),
  num('contrast', 'Contrast', -100, 100, 1, 0, ''),
  num('gamma', 'Gamma', 0.2, 3, 0.01, 1, ''),
  num('saturation', 'Saturation', 0, 200, 1, 100, '%'),
  num('blur', 'Pre-blur', 0, 20, 0.5, 0, 'px'),
  bool('invert', 'Invert tones', false),
];

export const COLOR_MODES = [
  { id: 'original', name: 'Photo colours', hint: 'Ink takes the colour of the pixel beneath it' },
  { id: 'mono', name: 'One ink', hint: 'Single ink on a paper colour' },
  { id: 'duotone', name: 'Duotone', hint: 'Shadow colour blended to highlight colour' },
  { id: 'cmyk', name: 'CMYK process', hint: 'Four separations at true screen angles' },
  { id: 'rgb', name: 'RGB light', hint: 'Three additive separations on black' },
  { id: 'palette', name: 'Custom palette', hint: 'Snapped to colours you choose' },
];

export const defaultsFor = (params) =>
  Object.fromEntries(params.map((p) => [p.key, p.def]));

/* Params carry over between effects where the keys match, so switching from a
   dot screen to a line screen keeps your cell size and angle. */
export function paramsForEffect(effect, previous = {}) {
  const next = defaultsFor(effect.params);
  for (const k of Object.keys(next)) {
    if (previous[k] !== undefined) next[k] = previous[k];
  }
  return next;
}

export function render(canvas, img, state) {
  const effect = EFFECTS_BY_ID[state.effect];
  if (!effect) throw new Error('Unknown effect: ' + state.effect);

  const source = preprocess(img, state.pre);
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.clearRect(0, 0, source.width, source.height);
  ctx.restore();

  effect.draw({
    ctx,
    source,
    w: source.width,
    h: source.height,
    p: { ...state.params },
    mode: state.colorMode,
    colors: state.colors,
  });
  return { width: source.width, height: source.height };
}
