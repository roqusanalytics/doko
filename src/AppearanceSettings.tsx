import { useState, type CSSProperties } from "react";
import { APPEARANCE_KEY, APPEARANCE_PRESETS, appearanceColor, appearancePalette, normalizeColor, saveAppearance } from "./appearance";
import { readSetting } from "./preferences";
import { Icon } from "./icons";

export function AppearanceSettings({ dark }: { dark: boolean }) {
  const [selected, setSelected] = useState(() => readSetting(APPEARANCE_KEY) || "default");
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
  </div>;
}
