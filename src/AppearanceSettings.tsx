import { useState, type CSSProperties } from "react";
import { APPEARANCE_KEY, APPEARANCE_PRESETS, SURFACE_COLORS, appearanceColor, appearancePalette, normalizeColor, saveAppearance, saveSurfaceColor } from "./appearance";
import { readSetting } from "./preferences";
import { Icon } from "./icons";

export function AppearanceSettings({ dark }: { dark: boolean }) {
  // A saved preset that no longer exists falls back to the default, matching how it renders.
  const [selected, setSelected] = useState(() => { const saved = readSetting(APPEARANCE_KEY); return saved && appearanceColor(saved) ? saved : "default"; });
  const [custom, setCustom] = useState(() => normalizeColor(selected) || "#e4eaf2");
  const [error, setError] = useState("");
  const choose = (value: string) => {
    setSelected(value);
    setError(saveAppearance(value) ? "" : "Preview applied. Couldn't save this appearance on this device. Try again.");
  };
  const customSelected = !!normalizeColor(selected);
  const updateCustom = (value: string) => {
    setCustom(value);
    const valid = normalizeColor(value);
    if (valid) choose(valid);
    else setError("Enter a color like #A1B2C3 or #ABC.");
  };
  return <div className="appearance-settings">
    <div className="appearance-heading"><div><strong>Background</strong><p>Choose a palette. Changes apply instantly to every tab.</p></div>
      <button type="button" className="btn ghost" onClick={() => { setCustom("#e4eaf2"); choose("default"); }}>Reset</button>
    </div>
    <div className="appearance-grid" aria-label="Background palettes">
      {APPEARANCE_PRESETS.map(preset => <button type="button" key={preset.id} className="appearance-card"
        aria-label={`${preset.name} background`} aria-pressed={selected === preset.id} onClick={() => choose(preset.id)}
        style={appearancePalette(preset.color, dark) as CSSProperties}>
        <span className="appearance-window" aria-hidden="true"><span className="appearance-window-bar"><i /><i /><i /></span><span className="appearance-window-body"><i /><span><i /><i /><i /></span></span></span>
        <span className="appearance-caption">{preset.name}{selected === preset.id && <Icon name="check" size={14} />}</span>
      </button>)}
      <button type="button" className="appearance-card appearance-custom" aria-label="Custom background" aria-pressed={customSelected}
        onClick={() => { const color = normalizeColor(custom) || appearanceColor(selected) || "#e4eaf2"; setCustom(color); choose(color); }}
        style={appearancePalette(normalizeColor(custom) || "#e4eaf2", false) as CSSProperties}>
        <span className="appearance-custom-swatch" aria-hidden="true">+</span><span className="appearance-caption">Custom{customSelected && <Icon name="check" size={14} />}</span>
      </button>
    </div>
    {customSelected && <div className="appearance-color">
      <label htmlFor="appearance-hex">Custom color</label>
      <input aria-label="Choose custom background color" type="color" value={normalizeColor(custom) || "#e4eaf2"} onChange={event => updateCustom(event.target.value)} />
      <input id="appearance-hex" type="text" value={custom} aria-invalid={!!error && !normalizeColor(custom)} aria-describedby="appearance-color-hint" spellCheck={false} autoComplete="off" onChange={event => updateCustom(event.target.value)} />
      <small id="appearance-color-hint">Your exact color is used in Light and Dark themes.</small>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="appearance-heading appearance-surfaces"><div><strong>Frame and work area</strong><p>Pick separate colors for the frame around the app and the panels inside it. Auto follows the background above.</p></div></div>
    {SURFACE_COLORS.map(surface => <SurfaceColor key={surface.key} surface={surface} />)}
  </div>;
}

function SurfaceColor({ surface: { key: storageKey, property, label } }: { surface: (typeof SURFACE_COLORS)[number] }) {
  const [value, setValue] = useState(() => readSetting(storageKey) || "");
  const [error, setError] = useState("");
  const current = () => getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  const id = `surface-${property.slice(2)}`;
  const color = normalizeColor(value);
  const save = (next: string | null) => {
    setValue(next ?? "");
    const valid = next === null ? null : normalizeColor(next);
    if (next !== null && !valid) return setError("Enter a color like #A1B2C3 or #ABC.");
    setError(saveSurfaceColor(storageKey, valid) ? "" : "Preview applied. Couldn't save this color on this device. Try again.");
  };
  return <div className="appearance-color">
    <label htmlFor={id}>{label}</label>
    <input aria-label={`Choose ${label.toLowerCase()} color`} type="color" value={color || normalizeColor(current()) || "#808080"} onChange={event => save(event.target.value)} />
    <input id={id} type="text" value={value} placeholder="Auto" aria-invalid={!!error && !color} aria-describedby={`${id}-hint`} spellCheck={false} autoComplete="off" onChange={event => event.target.value.trim() ? save(event.target.value) : save(null)} />
    <button type="button" className="btn ghost" disabled={!value} onClick={() => save(null)}>Auto</button>
    <small id={`${id}-hint`} role={error ? "alert" : undefined}>{error || "Used in Light and Dark themes. Text on it adapts for contrast."}</small>
  </div>;
}
