import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import type { MoreItem } from "./MoreMenu";

export function ContextMenu({ target, label, items, onClose }: {
  target: { element: HTMLElement }; label: string; items: MoreItem[]; onClose(): void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    const menu = panel.current!;
    menu.showPopover();
    const anchor = target.element.getBoundingClientRect();
    const gap = 8, edge = 8;
    menu.style.maxHeight = `${Math.max(0, anchor.top - gap - edge)}px`;
    menu.style.left = `${Math.max(edge, Math.min(anchor.left, innerWidth - menu.offsetWidth - edge))}px`;
    menu.style.top = `${Math.max(edge, anchor.top - gap - menu.offsetHeight)}px`;
    menu.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const dismiss = () => close.current();
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || menu.contains(event.target)) return;
      const current = target.element.getBoundingClientRect();
      // Focus can queue a scroll event before opening; dismiss only if the anchor actually moved.
      if (Math.abs(current.top - anchor.top) > 1 || Math.abs(current.left - anchor.left) > 1) dismiss();
    };
    const toggle = () => { if (!menu.matches(":popover-open")) dismiss(); };
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    document.addEventListener("scroll", scroll, true);
    menu.addEventListener("toggle", toggle);
    return () => { window.removeEventListener("resize", dismiss); window.removeEventListener("blur", dismiss); document.removeEventListener("scroll", scroll, true); menu.removeEventListener("toggle", toggle); };
  }, [target]);
  const dismiss = () => { onClose(); target.element.focus({ preventScroll: true }); };
  return createPortal(<div ref={panel} popover="auto" role="menu" aria-label={label} className="menu file-context-menu" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); dismiss(); return; }
    const buttons = [...panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  }}>{items.map((item, index) => item.kind === "divider" ? <hr key={index} /> : <button key={item.label} role="menuitem"
    disabled={item.kind === "action" && item.disabled} onClick={() => { dismiss(); item.onSelect(); }}><Icon name={item.icon} size={16} /><span>{item.label}</span></button>)}</div>, document.body);
}
