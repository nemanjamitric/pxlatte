/* Param descriptors. Effects declare their controls here and the UI builds
   itself from them — adding an effect never means touching the panel code. */

export const num = (key, label, min, max, step, def, unit = '') => ({
  type: 'num', key, label, min, max, step, def, unit,
});
export const bool = (key, label, def) => ({ type: 'bool', key, label, def });
export const sel = (key, label, options, def) => ({ type: 'sel', key, label, options, def });
export const text = (key, label, def) => ({ type: 'text', key, label, def });

/* Shared groups, spread into each effect's list. */
export const CELL = (def = 10) => num('cell', 'Cell size', 2, 80, 1, def, 'px');
export const ANGLE = (def = 45) => num('angle', 'Screen angle', 0, 180, 1, def, '°');
export const DOT = [
  num('dotScale', 'Dot scale', 0.1, 2.5, 0.01, 1.15, '×'),
  num('minDot', 'Min dot', 0, 10, 0.1, 0, 'px'),
  num('dotGamma', 'Dot gamma', 0.2, 4, 0.01, 1, ''),
  num('levels', 'Tone steps', 0, 16, 1, 0, ''),
];
export const STROKE = (def = 1) => num('weight', 'Stroke weight', 0.1, 10, 0.1, def, 'px');
export const ORIGIN = [
  num('originX', 'Origin X', 0, 100, 1, 50, '%'),
  num('originY', 'Origin Y', 0, 100, 1, 50, '%'),
];
export const DIFFUSE = [
  num('levels', 'Tone steps', 2, 16, 1, 2, ''),
  num('strength', 'Error strength', 0, 1.5, 0.01, 1, '×'),
  bool('serpentine', 'Serpentine scan', true),
];
