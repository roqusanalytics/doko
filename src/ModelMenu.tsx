import { useEffect, useId, useRef } from "react";
import { Icon } from "./icons";
import { useAnchoredPopover } from "./anchored-popover";
import { ProviderLogo } from "./ProviderLogo";
import type { AiProvider } from "./ai";

export interface ModelGroup {
  provider: AiProvider;
  label: string;
  models: { id: string; name: string }[];
  /** Set when the provider can't be used yet: tells how to connect it. */
  setup?: string;
  /** Shows a link to Settings after the models, for providers with a longer list. */
  more?: string;
}

/** One menu for every provider: models grouped by provider with its logo; picking another provider's model switches to it. */
export function ModelMenu({ groups, provider, model, label, disabled, onChange, onSettings, onOpen }: {
  groups: ModelGroup[];
  provider: AiProvider;
  model: string;
  /** Name shown on the button for the current model. */
  label: string;
  disabled?: boolean;
  onChange: (provider: AiProvider, model: string) => void;
  onSettings: () => void;
  /** Called each time the menu opens, so a provider can load its list on demand. */
  onOpen?: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = useAnchoredPopover(trigger, panel);
  useEffect(() => { if (open) onOpen?.(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { panel.current?.hidePopover(); trigger.current?.focus(); };
  return <>
    <button ref={trigger} type="button" className="model-trigger" aria-label={`Model: ${label}`} title="Choose model" disabled={disabled}
      aria-haspopup="menu" aria-expanded={open} aria-controls={id} popoverTarget={id}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); panel.current?.showPopover(); } }}>
      <ProviderLogo provider={provider} size={13} /><span>{label}</span><Icon name="chevronDown" size={12} />
    </button>
    <div ref={panel} id={id} popover="auto" role="menu" aria-label="Models" className="menu anchored-popover model-menu">
      {groups.map(group => <div key={group.provider} role="group" aria-label={group.label}>
        <div className="model-group"><ProviderLogo provider={group.provider} size={13} />{group.label}</div>
        {group.setup ? <button type="button" role="menuitem" className="model-setup" onClick={() => { close(); onSettings(); }}>{group.setup}</button> : <>
          {group.models.map(item => {
            const selected = group.provider === provider && item.id === model;
            return <button type="button" key={item.id} role="menuitemradio" aria-checked={selected} title={item.id || undefined}
              onClick={() => { close(); onChange(group.provider, item.id); }}>
              <span>{item.name}</span>{selected && <Icon name="check" size={14} />}
            </button>;
          })}
          {group.more && <button type="button" role="menuitem" className="model-setup" onClick={() => { close(); onSettings(); }}>{group.more}</button>}
        </>}
      </div>)}
    </div>
  </>;
}
