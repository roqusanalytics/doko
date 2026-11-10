import { useEffect, useState } from "react";
import { parseWebUrl } from "./Dialogs";

export function useReaderDrop({ blocked, signing, openFiles, openUrl, onError }: {
  blocked: boolean; signing: boolean; openFiles(files: FileList): void; openUrl(url: string): void; onError(message: string): void;
}) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    let internal = false; // dragging text or images from inside Doko isn't an "open" gesture
    const hasFiles = (e: DragEvent) => {
      const types = e.dataTransfer?.types ?? [];
      return !internal && (types.includes("Files") || types.includes("text/uri-list") || types.includes("text/plain"));
    };
    const droppedUrl = (data: DataTransfer) => {
      const fromList = data.getData("text/uri-list").split(/\r?\n/).find((line) => line.trim() && !line.startsWith("#"));
      return parseWebUrl(fromList) ?? parseWebUrl(data.getData("text/plain"));
    };
    const start = () => (internal = true);
    const end = () => (internal = false);
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (--depth <= 0) { depth = 0; setDragging(false); }
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (blocked) { e.preventDefault(); return; }
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0; setDragging(false);
      const files = e.dataTransfer?.files;
      const url = !files?.length && e.dataTransfer ? droppedUrl(e.dataTransfer) : null;
      if (files?.length) openFiles(files);
      else if (url) openUrl(url);
      else onError("Drop a PDF file or a link to a PDF.");
    };
    // Pasting a link (outside text fields) fills in Open from URL too.
    const paste = (e: ClipboardEvent) => {
      if (blocked || signing || (e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable=true], .freeTextEditor")) return;
      const url = parseWebUrl(e.clipboardData?.getData("text/plain"));
      if (!url) return;
      e.preventDefault(); openUrl(url);
    };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("paste", paste);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("paste", paste);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [openFiles, signing, blocked, openUrl, onError]);
  return dragging;
}
