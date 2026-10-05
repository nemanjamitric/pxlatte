import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EFFECTS, EFFECTS_BY_ID, EFFECT_GROUPS, PRE_PARAMS, COLOR_MODES,
  defaultsFor, paramsForEffect, render,
} from './lib/engine.js';
import { makeSampleImage } from './sample.js';
import { Section, Control, Dropdown, SwatchRow, Swatch } from './ui.jsx';

const PALETTES = {
  'Risograph': ['#1a1a1a', '#f4f3f0', '#ff4d3d', '#2b5fd9', '#ffd21e'],
  'Blueprint': ['#07132b', '#1d4fa8', '#7fa8e8', '#eef3fb'],
  'Newsprint': ['#171513', '#55514a', '#a39c90', '#e8e3d7'],
  'Gameboy': ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  'Hot': ['#14080e', '#8c1c3f', '#e8453c', '#ffb100', '#fff2cc'],
  'CMY': ['#000000', '#00aeef', '#ec008c', '#fff100', '#ffffff'],
};

const DEFAULT_COLORS = {
  ink: '#14161c',
  paper: '#f4f3f0',
  shadow: '#0d1b3e',
  highlight: '#f2e4c9',
  palette: PALETTES.Risograph,
};

/* Sensible ranges for a dice roll — the full slider range includes plenty of
   settings that are legitimate but look like mush. */
const RANDOM_RANGE = {
  cell: [4, 26],
  levels: [2, 6],
  bands: [4, 16],
  density: [1500, 9000],
  maxSize: null,
  resolution: null,
};

function randomiseParams(effect) {
  const out = {};
  for (const p of effect.params) {
    if (p.type === 'num') {
      const band = RANDOM_RANGE[p.key];
      if (band === null) { out[p.key] = p.def; continue; }
      const lo = band ? Math.max(p.min, band[0]) : p.min;
      const hi = band ? Math.min(p.max, band[1]) : p.max;
      const v = lo + Math.random() * (hi - lo);
      out[p.key] = Math.round(v / p.step) * p.step;
      out[p.key] = parseFloat(out[p.key].toFixed(4));
    } else if (p.type === 'bool') {
      out[p.key] = Math.random() < 0.5;
    } else if (p.type === 'sel') {
      out[p.key] = p.options[(Math.random() * p.options.length) | 0];
    } else {
      out[p.key] = p.def;
    }
  }
  return out;
}

const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const randHex = () =>
  '#' + Array.from({ length: 3 }, () => ((Math.random() * 256) | 0).toString(16).padStart(2, '0')).join('');

export default function App() {
  const canvasRef = useRef(null);
  const fileRef = useRef(null);

  const [image, setImage] = useState(null);
  const [imageName, setImageName] = useState('sample');
  const [effectId, setEffectId] = useState('dot-screen');
  const [params, setParams] = useState(() => defaultsFor(EFFECTS_BY_ID['dot-screen'].params));
  const [pre, setPre] = useState(() => defaultsFor(PRE_PARAMS));
  const [colorMode, setColorMode] = useState('cmyk');
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  const effect = EFFECTS_BY_ID[effectId];
  const effectIndex = useMemo(() => EFFECTS.findIndex((e) => e.id === effectId), [effectId]);

  /* Sample image on first paint, so there is always something on the stage. */
  useEffect(() => { setImage(makeSampleImage()); }, []);

  const setParam = useCallback((key, value) => {
    setParams((p) => ({ ...p, [key]: value }));
  }, []);

  const chooseEffect = useCallback((id) => {
    setEffectId(id);
    setParams((prev) => paramsForEffect(EFFECTS_BY_ID[id], prev));
  }, []);

  const stepEffect = useCallback((delta) => {
    const i = EFFECTS.findIndex((e) => e.id === effectId);
    chooseEffect(EFFECTS[(i + delta + EFFECTS.length) % EFFECTS.length].id);
  }, [effectId, chooseEffect]);

  /* --- render ------------------------------------------------------------ */

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    let cancelled = false;
    setBusy(true);
    /* Debounce the slider, then give the browser a frame to paint the busy
       flag before the synchronous render blocks the thread. */
    const timer = setTimeout(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        try {
          setOut(render(canvasRef.current, image, { effect: effectId, params, pre, colorMode, colors }));
          setError(null);
        } catch (e) {
          setError(e && e.message ? e.message : String(e));
        }
        setBusy(false);
      });
    }, 60);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [image, effectId, params, pre, colorMode, colors]);

  /* --- image input ------------------------------------------------------- */

  const loadFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) {
      setError('That file is not an image.');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setImageName(file.name.replace(/\.[^.]+$/, '') || 'image');
      setError(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError('Could not decode that image.');
    };
    img.src = url;
  }, []);

  useEffect(() => {
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) loadFile(item.getAsFile());
    };
    const onOver = (e) => { e.preventDefault(); setDragging(true); };
    const onLeave = (e) => { if (e.relatedTarget === null) setDragging(false); };
    const onDrop = (e) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer?.files?.[0]) loadFile(e.dataTransfer.files[0]);
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [loadFile]);

  /* --- actions ----------------------------------------------------------- */

  const exportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pxlatte-${imageName}-${effectId}-${out?.width || 0}px.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }, [imageName, effectId, out]);

  const randomEffect = useCallback(() => {
    const next = pick(EFFECTS);
    setEffectId(next.id);
    setParams(randomiseParams(next));
  }, []);

  const randomColours = useCallback(() => {
    const mode = pick(COLOR_MODES).id;
    setColorMode(mode);
    setColors((c) => ({
      ...c,
      ink: randHex(),
      paper: Math.random() < 0.5 ? '#f4f3f0' : randHex(),
      shadow: randHex(),
      highlight: randHex(),
      palette: PALETTES[pick(Object.keys(PALETTES))],
    }));
  }, []);

  const resetAll = useCallback(() => {
    setParams(defaultsFor(effect.params));
    setPre(defaultsFor(PRE_PARAMS));
    setColors(DEFAULT_COLORS);
    setError(null);
  }, [effect]);

  const usesPalette = colorMode === 'palette';
  const usesInk = colorMode === 'mono';
  const usesDuo = colorMode === 'duotone';
  const usesPaper = usesInk || usesDuo || usesPalette || colorMode === 'original';

  return (
    <div className="app">
      {dragging && <div className="dropveil">Drop to load</div>}

      <header className="masthead">
        <div className="wordmark">
          <b>pxlatte</b>
          <i aria-hidden="true" />
        </div>
        <div className="masthead-meta micro">
          <span className="hide-xs">Halftone&nbsp;Generator</span>
          <span className="spacer" />
          <span className="num">{EFFECTS.length}&nbsp;effects</span>
          <span className="strong hide-xs">In-browser</span>
        </div>
      </header>

      <main className="stage">
        {busy && <div className="busy">Screening</div>}
        <div className="stage-inner">
          <canvas ref={canvasRef} className="stage-canvas" />
        </div>
        <div className="stage-foot">
          <span className="strong num">{String(effectIndex + 1).padStart(2, '0')}</span>
          <span className="strong">{effect.name}</span>
          <span className="spacer" />
          {error ? (
            <span style={{ color: 'var(--accent)' }}>{error}</span>
          ) : (
            <>
              <span className="num">{out ? `${out.width}×${out.height}` : '—'}</span>
              <span>{colorMode}</span>
            </>
          )}
        </div>
      </main>

      <div className="panel">
        <Section index="01" title="Source" collapsible={false}>
          <button
            className={'drop' + (dragging ? ' over' : '')}
            onClick={() => fileRef.current?.click()}
          >
            <strong>Choose an image</strong>
            <span>or drop it anywhere · or paste</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => { setImage(makeSampleImage()); setImageName('sample'); }}>
              Sample
            </button>
            <button className="btn" onClick={resetAll}>Reset</button>
          </div>
        </Section>

        <Section index="02" title="Effect" collapsible={false}>
          <div className="effect-head">
            <span className="n num">{String(effectIndex + 1).padStart(2, '0')}</span>
            <span className="of num">/ {EFFECTS.length}</span>
            <span className="g">{effect.group}</span>
          </div>
          <div className="select-wrap">
            <select
              value={effectId}
              onChange={(e) => chooseEffect(e.target.value)}
              aria-label="Halftone effect"
            >
              {Object.entries(EFFECT_GROUPS).map(([group, list]) => (
                <optgroup key={group} label={group}>
                  {list.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn fixed" onClick={() => stepEffect(-1)} aria-label="Previous effect">←</button>
            <button className="btn solid" onClick={randomEffect}>Surprise me</button>
            <button className="btn fixed" onClick={() => stepEffect(1)} aria-label="Next effect">→</button>
          </div>
        </Section>

        <Section index="03" title="Parameters" collapsible={false}>
          {effect.params.map((p) => (
            <Control key={p.key} param={p} value={params[p.key]} onChange={(v) => setParam(p.key, v)} />
          ))}
        </Section>

        <Section index="04" title="Colour">
          <div className="seg" role="group" aria-label="Colour mode">
            {COLOR_MODES.map((m) => (
              <button
                key={m.id}
                aria-pressed={colorMode === m.id}
                onClick={() => setColorMode(m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>
          <p className="hint">{COLOR_MODES.find((m) => m.id === colorMode)?.hint}</p>

          <div style={{ marginTop: 6 }}>
            {usesInk && (
              <SwatchRow label="Ink" value={colors.ink} onChange={(v) => setColors((c) => ({ ...c, ink: v }))} />
            )}
            {usesDuo && (
              <>
                <SwatchRow label="Shadow" value={colors.shadow} onChange={(v) => setColors((c) => ({ ...c, shadow: v }))} />
                <SwatchRow label="Highlight" value={colors.highlight} onChange={(v) => setColors((c) => ({ ...c, highlight: v }))} />
              </>
            )}
            {usesPaper && (
              <SwatchRow label="Paper" value={colors.paper} onChange={(v) => setColors((c) => ({ ...c, paper: v }))} />
            )}
          </div>

          {usesPalette && (
            <div style={{ marginTop: 12 }}>
              <div className="field-top">
                <span className="field-label">Palette · {colors.palette.length}</span>
              </div>
              <div className="swatches">
                {colors.palette.map((hex, i) => (
                  <Swatch
                    key={i}
                    value={hex}
                    title={'Colour ' + (i + 1)}
                    onChange={(v) => setColors((c) => ({
                      ...c,
                      palette: c.palette.map((p, j) => (j === i ? v : p)),
                    }))}
                    onRemove={colors.palette.length > 2
                      ? () => setColors((c) => ({ ...c, palette: c.palette.filter((_, j) => j !== i) }))
                      : null}
                  />
                ))}
                {colors.palette.length < 12 && (
                  <button
                    className="swatch"
                    style={{ background: 'var(--white)', fontWeight: 700, textAlign: 'center' }}
                    onClick={() => setColors((c) => ({ ...c, palette: [...c.palette, randHex()] }))}
                    aria-label="Add palette colour"
                  >+</button>
                )}
              </div>
              <div className="preset-row">
                {Object.entries(PALETTES).map(([name, pal]) => (
                  <button
                    key={name}
                    className="preset"
                    title={name}
                    aria-label={name + ' palette'}
                    onClick={() => setColors((c) => ({ ...c, palette: pal }))}
                  >
                    {pal.map((hex) => <span key={hex} style={{ background: hex }} />)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={randomColours}>Random colours</button>
          </div>
        </Section>

        <Section index="05" title="Image">
          {PRE_PARAMS.map((p) => (
            <Control
              key={p.key}
              param={p}
              value={pre[p.key]}
              onChange={(v) => setPre((s) => ({ ...s, [p.key]: v }))}
            />
          ))}
        </Section>

        <Section index="06" title="Export" collapsible={false}>
          <p className="section-note">
            PNG at {out ? `${out.width}×${out.height}` : '—'}. Raise the resolution slider
            in <em>Image</em> for print-size output.
          </p>
          <button className="btn accent" onClick={exportPng} disabled={!out || busy}>
            Download PNG
          </button>
        </Section>

        <div className="foot">
          Switzer · Fontshare<br />
          Effects written by hand, no image libraries<br />
          Nothing is uploaded — it all runs here
        </div>
      </div>
    </div>
  );
}
