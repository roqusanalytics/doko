import { useEffect, useRef, useState } from "react";
import { ContextMenu } from "./ContextMenu";
import { Icon } from "./icons";
import "./photo-carousel.css";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 80_000_000;

function PhotoThumbnail({ doc, name, near }: { doc: GalleryDocument; name: string; near: boolean }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let objectUrl = "";
    setUrl(""); setError("");
    if (!near) return;
    void (async () => {
      const blob = doc.blobs?.[name] ?? (doc.id && window.folioDesktop
        ? await window.folioDesktop.content.image(doc.id, name).then(result => new Blob([new Uint8Array(result.data)], { type: result.mime }))
        : undefined);
      if (!blob) throw new Error("Image unavailable");
      if (blob.size > MAX_BYTES) throw new Error("Image too large");
      if (stopped) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })().catch(() => { if (!stopped) setError("Image unavailable"); });
    return () => { stopped = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc, name, near]);
  return url && !error
    ? <img src={url} alt="" onError={() => setError("Image unavailable")} onLoad={event => {
      const image = event.currentTarget;
      if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) setError("Image too large");
    }} />
    : <span className="photo-carousel-placeholder" role={error ? "img" : undefined} aria-label={error ? `${name}: ${error}` : undefined}>{name}</span>;
}

export function PhotoCarousel({ doc, selected, busy, onSelect, onRefresh, onAction, refreshing = false }: {
  doc: GalleryDocument;
  selected: string;
  busy: boolean;
  onSelect(name: string): void;
  onRefresh?: () => void;
  onAction?: (name: string, action: string) => void;
  refreshing?: boolean;
}) {
  const [menu, setMenu] = useState<{ name: string; element: HTMLElement } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [near, setNear] = useState<Set<string>>(() => new Set());
  const index = doc.files.indexOf(selected);
  const select = (next: number) => {
    const name = doc.files[next];
    if (name && !busy) onSelect(name);
  };

  useEffect(() => {
    if (!root.current || !("IntersectionObserver" in window)) { setNear(new Set(selected ? [selected] : [])); return; }
    const observer = new IntersectionObserver(entries => {
      setNear(previous => {
        const next = new Set(previous);
        for (const entry of entries) {
          const name = (entry.target as HTMLElement).dataset.file;
          if (!name) continue;
          if (entry.isIntersecting) next.add(name);
          else next.delete(name);
        }
        return next;
      });
    }, { root: root.current, rootMargin: "0px 400px", threshold: 0 });
    root.current.querySelectorAll<HTMLElement>("[data-file]").forEach(button => observer.observe(button));
    return () => observer.disconnect();
  }, [doc.files, selected]);

  useEffect(() => {
    if (selected) buttons.current.get(selected)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest", inline: "center" });
  }, [selected]);

  useEffect(() => {
    const strip = root.current;
    if (!strip) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      strip.scrollBy({ left: delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    };
    strip.addEventListener("wheel", wheel, { passive: false });
    return () => strip.removeEventListener("wheel", wheel);
  }, []);

  const moveFocus = (from: number, delta: number) => {
    const target = Math.max(0, Math.min(doc.files.length - 1, from + delta));
    if (target === from) return;
    select(target);
    buttons.current.get(doc.files[target])?.focus({ preventScroll: true });
  };

  return <section className="photo-carousel" aria-label="Photo gallery">
    <div className="photo-carousel-controls">
      <button className="btn ghost" type="button" aria-label="Previous image" disabled={busy || index <= 0} onClick={() => select(index - 1)}><Icon name="chevronLeft" /> <span>Previous</span></button>
      <output aria-label="Image position">{index >= 0 ? index + 1 : 0} / {doc.files.length}</output>
      <button className="btn ghost" type="button" aria-label="Next image" disabled={busy || index < 0 || index >= doc.files.length - 1} onClick={() => select(index + 1)}><span>Next</span> <Icon name="chevronRight" /></button>
      {onRefresh && <button className="btn ghost photo-carousel-refresh" type="button" disabled={busy || refreshing} aria-label="Refresh gallery" onClick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh"}</button>}
    </div>
    <div className="photo-carousel-thumbnails" ref={root} role="group" aria-label="Choose an image">
      {doc.files.map((name, fileIndex) => <button key={name} ref={button => {
        if (button) buttons.current.set(name, button); else buttons.current.delete(name);
      }} className="photo-carousel-thumbnail" type="button" data-file={name} aria-label={`View ${name}`} aria-current={name === selected ? "true" : undefined}
        disabled={busy} onContextMenu={event => {
          if (!onAction || busy) return;
          event.preventDefault(); setMenu({ name, element: event.currentTarget });
        }} onClick={() => onSelect(name)} onKeyDown={event => {
          if ((event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) && onAction && !busy) {
            event.preventDefault();
            setMenu({ name, element: event.currentTarget }); return;
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault(); moveFocus(fileIndex, event.key === "ArrowLeft" ? -1 : 1);
          }
        }}>
        <span className="photo-carousel-image">{near.has(name) ? <PhotoThumbnail doc={doc} name={name} near /> : <span className="photo-carousel-placeholder">{name}</span>}</span>
        <span className="photo-carousel-caption">{name}</span>
      </button>)}
    </div>
    {menu && onAction && <ContextMenu target={menu} label={`Actions for ${menu.name}`} onClose={() => setMenu(null)} items={[
      { kind: "action", icon: "download", label: "Save", disabled: busy, onSelect: () => onAction(menu.name, "save") },
      { kind: "action", icon: "download", label: "Save As…", disabled: busy, onSelect: () => onAction(menu.name, "save-as") },
      { kind: "action", icon: "download", label: "Export / Convert…", disabled: busy, onSelect: () => onAction(menu.name, "export") },
      { kind: "action", icon: "download", label: "Reduce file size…", disabled: busy, onSelect: () => onAction(menu.name, "compress") },
      { kind: "action", icon: "print", label: "Print…", disabled: busy, onSelect: () => onAction(menu.name, "print") },
      ...(doc.id && window.folioDesktop ? [
        { kind: "divider" as const },
        { kind: "action" as const, icon: "file" as const, label: "Show in folder", disabled: busy, onSelect: () => onAction(menu.name, "reveal") },
        { kind: "action" as const, icon: "trash" as const, label: "Move to Trash…", disabled: busy, onSelect: () => onAction(menu.name, "trash") },
      ] : []),
    ]} />}
  </section>;
}

export default PhotoCarousel;
