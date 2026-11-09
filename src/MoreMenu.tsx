import { useId, useRef } from "react";
import { Icon, type IconName } from "./icons";
import { useAnchoredPopover } from "./anchored-popover";

export type MoreItem =
  | { kind: "action"; icon: IconName; label: string; shortcut?: string; disabled?: boolean; onSelect: () => void }
  | { kind: "toggle"; icon: IconName; label: string; checked: boolean; onSelect: () => void }
  | { kind: "divider" };

export function MoreMenu({ items, label }: { items: MoreItem[]; label?: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = useAnchoredPopover(trigger, panel);

  return (
    <div className="more">
      <button
        ref={trigger} popoverTarget={id} aria-controls={id}
        className={label ? "link small" : `icon-btn ${open ? "on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ?? "More"}
        title={label ?? "More"}
      >
        {label ? <>{label}<Icon name="chevronDown" size={13} /></> : <Icon name="more" />}
      </button>
      <div ref={panel} id={id} popover="auto" className="menu dropdown anchored-popover" role="menu" aria-label={label ?? "More"}>
          {items.map((item, i) =>
            item.kind === "divider" ? (
              <hr key={i} />
            ) : (
              <button
                key={item.label}
                role={item.kind === "toggle" ? "menuitemcheckbox" : "menuitem"}
                aria-checked={item.kind === "toggle" ? item.checked : undefined}
                disabled={item.kind === "action" && item.disabled}
                onClick={() => {
                  panel.current?.hidePopover();
                  trigger.current?.focus();
                  item.onSelect();
                }}
              >
                <Icon name={item.icon} size={15} />
                <span className="menu-label">{item.label}</span>
                {item.kind === "toggle" && item.checked && <Icon name="check" size={14} />}
                {item.kind === "action" && item.shortcut && <kbd className="menu-kbd">{item.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
    </div>
  );
}
