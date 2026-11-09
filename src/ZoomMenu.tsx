import { useId, useRef } from "react";
import { Icon, type IconName } from "./icons";
import { useAnchoredPopover } from "./anchored-popover";

const PRESETS: { value: string; label: string; icon?: IconName }[] = [
  { value: "auto", label: "Automatic" },
  { value: "page-width", label: "Fit width", icon: "fitWidth" },
  { value: "page-fit", label: "Fit page", icon: "fitPage" },
];
const LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function ZoomMenu({
  scale,
  onPick,
  spread,
  onToggleSpread,
  photo = false,
}: {
  photo?: boolean;
  scale: number;
  onPick: (value: string) => void;
  spread: boolean;
  onToggleSpread: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = useAnchoredPopover(trigger, panel);
  const ratio = photo ? 0.75 : 1;
  const pick = (value: string) => {
    panel.current?.hidePopover();
    trigger.current?.focus();
    onPick(value);
  };
  const presets = photo ? [
    { value: "auto", label: "Automatic" },
    { value: "page-fit", label: "Fit image", icon: "fitPage" as IconName },
    { value: "0.75", label: "Actual size" },
  ] : PRESETS;

  return (
    <div className="zoom">
      <button ref={trigger} popoverTarget={id} aria-controls={id} className="zoom-value" aria-haspopup="menu" aria-expanded={open} title="Zoom">
        {Math.round(scale / ratio * 100)}%
      </button>
      <div ref={panel} id={id} popover="auto" className="menu anchored-popover" role="menu" aria-label="Zoom">
          {presets.map((p) => (
            <button key={p.value} role="menuitem" onClick={() => pick(p.value)}>
              {p.icon ? <Icon name={p.icon} size={15} /> : <span className="menu-spacer" />}
              {p.label}
            </button>
          ))}
          {!photo && <><hr />
          <button
            role="menuitemcheckbox"
            aria-checked={spread}
            className={spread ? "on" : ""}
            onClick={() => {
              onToggleSpread();
              panel.current?.hidePopover();
              trigger.current?.focus();
            }}
          >
            <Icon name="book" size={15} />
            Two-page view
            <kbd className="menu-kbd">2</kbd>
          </button></>}
          <hr />
          {LEVELS.map((l) => (
            <button key={l} role="menuitem" className={Math.abs(scale - l * ratio) < 0.005 ? "on" : ""} onClick={() => pick(String(l * ratio))}>
              <span className="menu-spacer" />
              {l * 100}%
            </button>
          ))}
        </div>
    </div>
  );
}
