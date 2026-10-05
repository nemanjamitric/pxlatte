/* A procedural still life so the app has something to screen before you've
   uploaded anything. Smooth gradation, a hard edge, a tonal wedge and some
   fine detail — between them they expose whatever an effect gets wrong. */

export function makeSampleImage(w = 1500, h = 1050) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');

  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#f6f2e8');
  bg.addColorStop(0.55, '#cfd6dc');
  bg.addColorStop(1, '#5c6773');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  /* Red sphere: the smooth falloff is what dot screens live or die on. */
  const cx = w * 0.37, cy = h * 0.47, r = Math.min(w, h) * 0.3;
  const sphere = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
  sphere.addColorStop(0, '#fff3ee');
  sphere.addColorStop(0.18, '#ef4a2a');
  sphere.addColorStop(0.72, '#9e0f16');
  sphere.addColorStop(1, '#2a0508');
  g.fillStyle = sphere;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();

  /* Contact shadow under it. */
  const sh = g.createRadialGradient(cx, cy + r * 1.02, 0, cx, cy + r * 1.02, r * 0.95);
  sh.addColorStop(0, 'rgba(20,22,28,0.55)');
  sh.addColorStop(1, 'rgba(20,22,28,0)');
  g.fillStyle = sh;
  g.save();
  g.translate(cx, cy + r * 1.02);
  g.scale(1, 0.22);
  g.beginPath();
  g.arc(0, 0, r * 0.95, 0, Math.PI * 2);
  g.fill();
  g.restore();

  /* Hard-edged bar: tests how an effect handles a boundary. */
  g.fillStyle = '#14161c';
  g.fillRect(w * 0.66, 0, w * 0.085, h);
  const teal = g.createLinearGradient(0, 0, 0, h);
  teal.addColorStop(0, '#0f8f9e');
  teal.addColorStop(1, '#063a52');
  g.fillStyle = teal;
  g.fillRect(w * 0.755, 0, w * 0.035, h);

  /* Tonal step wedge, 11 patches black to white. */
  const steps = 11;
  const sw = w * 0.2 / steps;
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i / (steps - 1)) * 255);
    g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
    g.fillRect(w * 0.8 + i * sw, h * 0.08, sw, h * 0.16);
  }

  /* Saturated primaries, for the colour modes. */
  const hues = ['#f5c400', '#e30613', '#0a53c4', '#13a05c'];
  hues.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(w * 0.8 + i * (w * 0.05), h * 0.32, w * 0.05, h * 0.1);
  });

  /* Converging rules: fine detail that reveals aliasing and moiré. */
  g.strokeStyle = 'rgba(14,16,22,0.85)';
  for (let i = 0; i < 26; i++) {
    g.lineWidth = 0.6 + i * 0.22;
    g.beginPath();
    g.moveTo(w * 0.8, h * 0.52 + i * (h * 0.017));
    g.lineTo(w * 0.995, h * 0.52 + i * (h * 0.017));
    g.stroke();
  }

  /* A soft vertical sweep through the lower left, pure continuous tone. */
  const sweep = g.createLinearGradient(0, h * 0.72, w * 0.62, h);
  sweep.addColorStop(0, 'rgba(255,255,255,0)');
  sweep.addColorStop(0.5, 'rgba(255,250,235,0.75)');
  sweep.addColorStop(1, 'rgba(10,12,18,0.85)');
  g.fillStyle = sweep;
  g.fillRect(0, h * 0.72, w * 0.62, h * 0.28);

  return c;
}
