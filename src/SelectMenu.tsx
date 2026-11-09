import { useId, useRef } from "react";
import { Icon } from "./icons";
import { useAnchoredPopover } from "./anchored-popover";

export function SelectMenu({ label, value, options, onChange, className = "", disabled, title }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = useAnchoredPopover(trigger, panel);
  return <>
    <button ref={trigger} type="button" className={`select-trigger ${className}`} aria-label={label} title={title}
      aria-haspopup="menu" aria-expanded={open} aria-controls={id} popoverTarget={id} disabled={disabled}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); panel.current?.showPopover(); }
      }}>
      <span>{options.find(option => option.value === value)?.label ?? value}</span><Icon name="chevronDown" size={13} />
    </button>
    <div ref={panel} id={id} popover="auto" role="menu" aria-label={`${label} options`} className="menu anchored-popover select-menu">
      {options.map(option => <button type="button" key={option.value} role="menuitemradio" aria-checked={option.value === value}
        onClick={() => { panel.current?.hidePopover(); trigger.current?.focus(); onChange(option.value); }}>
        <span>{option.label}</span>{option.value === value && <Icon name="check" size={14} />}
      </button>)}
    </div>
  </>;
}
