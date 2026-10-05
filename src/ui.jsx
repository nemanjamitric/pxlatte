import React, { useId, useState } from 'react';

const decimals = (step) => {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

export function Section({ index, title, note, children, defaultOpen = true, collapsible = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const shown = collapsible ? open : true;
  return (
    <section className="section">
      {collapsible ? (
        <button
          className="section-head"
          aria-expanded={shown}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="idx num">{index}</span>
          <span className="title micro">{title}</span>
          <span className="chev" aria-hidden="true">{shown ? '—' : '+'}</span>
        </button>
      ) : (
        <div className="section-head">
          <span className="idx num">{index}</span>
          <span className="title micro">{title}</span>
        </div>
      )}
      {shown && (
        <div className="section-body" id={id}>
          {note && <p className="section-note">{note}</p>}
          {children}
        </div>
      )}
    </section>
  );
}

export function Slider({ label, value, min, max, step, unit, onChange }) {
  const d = decimals(step);
  return (
    <div className="field">
      <div className="field-top">
        <label className="field-label" htmlFor={label}>{label}</label>
        <span className="field-value">
          {Number(value).toFixed(d)}
          {unit && <span className="unit">{unit}</span>}
        </span>
      </div>
      <input
        id={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function Toggle({ label, value, onChange }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      <span className="box" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

export function Dropdown({ label, value, options, onChange, format }) {
  return (
    <div className="field">
      {label && (
        <div className="field-top">
          <span className="field-label">{label}</span>
        </div>
      )}
      <div className="select-wrap">
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
          {options.map((o) => (
            <option key={o} value={o}>{format ? format(o) : o}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function TextField({ label, value, onChange }) {
  return (
    <div className="field">
      <div className="field-top">
        <span className="field-label">{label}</span>
      </div>
      <input
        className="text-input"
        type="text"
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
    </div>
  );
}

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* One switch over the param descriptor, so every effect's controls come for
   free the moment its params array exists. */
export function Control({ param, value, onChange }) {
  switch (param.type) {
    case 'num':
      return (
        <Slider
          label={param.label}
          value={value}
          min={param.min}
          max={param.max}
          step={param.step}
          unit={param.unit}
          onChange={onChange}
        />
      );
    case 'bool':
      return <Toggle label={param.label} value={value} onChange={onChange} />;
    case 'sel':
      return (
        <Dropdown
          label={param.label}
          value={value}
          options={param.options}
          onChange={onChange}
          format={titleCase}
        />
      );
    case 'text':
      return <TextField label={param.label} value={value} onChange={onChange} />;
    default:
      return null;
  }
}

export function Swatch({ value, onChange, title, onRemove }) {
  return (
    <span className="swatch" title={title}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={title} />
      {onRemove && (
        <button className="pal-remove" onClick={onRemove} aria-label={'Remove ' + value}>×</button>
      )}
    </span>
  );
}

export function SwatchRow({ label, value, onChange }) {
  return (
    <div className="swatch-row">
      <Swatch value={value} onChange={onChange} title={label} />
      <span className="label">{label}</span>
      <span className="hex num">{value}</span>
    </div>
  );
}
