import { useId, useRef } from "react";
import { Icon, type IconName } from "./icons";
import { useAnchoredPopover } from "./anchored-popover";

export type MoreItem =
  | { kind: "action"; icon: IconName; label: string; shortcut?: string; disabled?: boolean; className?: string; current?: boolean; onSelect: () => void }
  | { kind: "toggle"; icon: IconName; label: string; checked: boolean; shortcut?: string; onSelect: () => void }
  | { kind: "divider" };

export function MoreMenu({ items, label, toolbarIcon, compactIcon, selected, disabled }: {
  items: MoreItem[]; label?: string; toolbarIcon?: IconName; compactIcon?: IconName; selected?: boolean; disabled?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = useAnchoredPopover(trigger, panel);

  return (
    <div className={compactIcon ? "tool-menu compact-tool-menu" : toolbarIcon ? "tool-menu" : "more"}>
      <button
        ref={trigger} popoverTarget={id} aria-controls={id}
        className={toolbarIcon || compactIcon ? (open || selected ? "on" : undefined) : label ? "link small" : `icon-btn ${open ? "on" : ""}`}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ?? "More"}
        title={label ?? "More"}
      >
        {toolbarIcon
          ? <><Icon name={toolbarIcon} size={16} /><span>{label}</span><Icon name="chevronDown" size={12} /></>
          : compactIcon ? <Icon name={compactIcon} size={16} /> : label ? <>{label}<Icon name="chevronDown" size={13} /></> : <Icon name="more" />}
      </button>
      <div ref={panel} id={id} popover="auto" className="menu dropdown anchored-popover" role="menu" aria-label={label ?? "More"}>
          {items.map((item, i) =>
            item.kind === "divider" ? (
              <hr key={i} />
            ) : (
              <button
                key={item.label}
                className={item.kind === "action" ? item.className : undefined}
                role={item.kind === "toggle" ? "menuitemcheckbox" : "menuitem"}
                aria-checked={item.kind === "toggle" ? item.checked : undefined}
                aria-current={item.kind === "action" && item.current ? true : undefined}
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
                {item.shortcut && <kbd className="menu-kbd" aria-hidden={toolbarIcon || compactIcon ? true : undefined}>{item.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
    </div>
  );
}
