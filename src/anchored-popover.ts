import { useEffect, useState, type RefObject } from "react";
import "./dropdown.css";

export function useAnchoredPopover(trigger: RefObject<HTMLButtonElement | null>, panel: RefObject<HTMLDivElement | null>) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const popup = panel.current;
    const button = trigger.current;
    if (!popup || !button) return;
    let frame = 0;
    const position = () => {
      if (!popup.matches(":popover-open")) return;
      const anchor = button.getBoundingClientRect();
      const gap = 6, edge = 8;
      const below = Math.max(0, window.innerHeight - anchor.bottom - gap - edge);
      const above = Math.max(0, anchor.top - gap - edge);
      popup.style.maxHeight = `min(${Math.min(Math.max(below, above), window.innerHeight - edge * 2)}px, var(--popover-limit, 100dvh))`;
      popup.style.minWidth = `min(max(${anchor.width}px, 168px), calc(100vw - 16px))`;
      const bounds = popup.getBoundingClientRect();
      const top = bounds.height <= below || below >= above ? anchor.bottom + gap : anchor.top - gap - bounds.height;
      popup.style.left = `${Math.max(edge, Math.min(anchor.left, window.innerWidth - bounds.width - edge))}px`;
      popup.style.top = `${Math.max(edge, Math.min(top, window.innerHeight - bounds.height - edge))}px`;
      popup.dataset.positioned = "true";
    };
    const trackAnchor = () => {
      position();
      if (popup.matches(":popover-open")) frame = requestAnimationFrame(trackAnchor);
    };
    const toggle = () => {
      const visible = popup.matches(":popover-open");
      cancelAnimationFrame(frame);
      setOpen(visible);
      if (visible) {
        // Toolbars animate on entry; follow the anchor until this popup closes.
        trackAnchor();
        if (popup.getAttribute("role") === "menu") {
          const items = popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
          (popup.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? items[0])?.focus();
        }
      } else delete popup.dataset.positioned;
    };
    const key = (event: KeyboardEvent) => {
      if (!popup.matches(":popover-open")) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        popup.hidePopover(); button.focus();
      } else if (event.key === "Tab" && popup.getAttribute("role") === "menu") popup.hidePopover();
      else if (popup.getAttribute("role") === "menu") {
        event.stopPropagation();
        const items = [...popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        let next: number;
        if (event.key === "ArrowDown") next = (index + 1) % items.length;
        else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = items.length - 1;
        else return;
        event.preventDefault(); event.stopPropagation(); items[next]?.focus();
      }
    };
    popup.addEventListener("toggle", toggle);
    // Capture Escape before document-reader shortcuts can leave the active tool or close Settings.
    window.addEventListener("keydown", key, true);
    return () => {
      cancelAnimationFrame(frame);
      popup.removeEventListener("toggle", toggle);
      window.removeEventListener("keydown", key, true);
    };
  }, [trigger, panel]);
  return open;
}
