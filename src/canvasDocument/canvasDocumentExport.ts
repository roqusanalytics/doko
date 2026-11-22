import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export const MAX_CANVAS_EXPORT_PADDING = 1000;
export type CanvasExportFormat = "png" | "svg" | "pdf";
export type CanvasExportSnapshot = ReturnType<typeof captureCanvasExport>;

export function captureCanvasExport(editor: ExcalidrawImperativeAPI, name: string) {
  const elements = structuredClone(editor.getSceneElements());
  const { selectedElementIds, viewBackgroundColor } = editor.getAppState();
  const selectedIds = new Set(elements.filter(element => selectedElementIds[element.id]).map(element => element.id));
  for (const element of elements) {
    if (element.frameId && selectedIds.has(element.frameId)) selectedIds.add(element.id);
  }
  const selection = elements.filter(element => selectedIds.has(element.id)
    || (element.type === "text" && element.containerId && selectedIds.has(element.containerId)));
  return { name, elements, selection, viewBackgroundColor, files: { ...editor.getFiles() } };
}

export async function prepareCanvasExport(snapshot: CanvasExportSnapshot, options: {
  format: CanvasExportFormat; selectedOnly: boolean; background: boolean; darkMode: boolean; padding: number;
}, signal: AbortSignal): Promise<{ name: string; blob: Blob }> {
  signal.throwIfAborted();
  const { format, selectedOnly, background, darkMode, padding } = options;
  const elements = selectedOnly ? snapshot.selection : snapshot.elements;
  if (!elements.length) throw new Error(selectedOnly ? "Select Elements to export." : "Add an Element to the Canvas before exporting.");
  if (!Number.isInteger(padding) || padding < 0 || padding > MAX_CANVAS_EXPORT_PADDING) throw new Error("Choose a valid padding.");
  const { exportToBlob, exportToSvg } = await import("@excalidraw/excalidraw");
  signal.throwIfAborted();
  const exportOptions = {
    elements, files: snapshot.files, exportPadding: padding,
    appState: {
      viewBackgroundColor: snapshot.viewBackgroundColor, exportBackground: background,
      exportWithDarkMode: darkMode, exportEmbedScene: false, exportScale: 1,
    },
  };
  const name = `${snapshot.name.replace(/\.excalidraw$/i, "") || "Canvas"}-export.${format}`;
  if (format === "svg") {
    const svg = await exportToSvg(exportOptions);
    signal.throwIfAborted();
    return { name, blob: new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }) };
  }

  let pageWidth = 0, pageHeight = 0;
  const scale = format === "pdf" ? 2 : 1;
  const png = await exportToBlob({
    ...exportOptions,
    getDimensions(width: number, height: number) {
      signal.throwIfAborted();
      // Use the renderer's bounds for both formats, including rotated Elements and frame labels.
      pageWidth = Math.max(1, width); pageHeight = Math.max(1, height);
      const pixelsWide = Math.ceil(pageWidth * scale), pixelsHigh = Math.ceil(pageHeight * scale);
      if (!Number.isFinite(pixelsWide * pixelsHigh) || pixelsWide * pixelsHigh > 80_000_000 || Math.max(pixelsWide, pixelsHigh) > 32767) {
        throw new Error("The drawing is too large for this format. Try SVG or export selected Elements.");
      }
      return { width: pixelsWide, height: pixelsHigh, scale };
    },
  });
  signal.throwIfAborted();
  if (format === "png") return { name, blob: png };

  const { PDFDocument } = await import("pdf-lib/es");
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(await png.arrayBuffer());
  pdf.addPage([pageWidth, pageHeight]).drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  const bytes = await pdf.save();
  signal.throwIfAborted();
  return { name, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }) };
}

export async function saveCanvasExport(blob: Blob, name: string) {
  const desktop = window.folioDesktop;
  if (!desktop) throw new Error("Canvas export is available in the Doko desktop app.");
  const format = name.split(".").at(-1) as CanvasExportFormat;
  const result = await desktop.saveFile({ name, format, data: new Uint8Array(await blob.arrayBuffer()), saveAs: true });
  if (result.cancelled) return false;
  if (!result.ok) throw new Error(result.error || (result.conflict ? "The file changed on disk. Choose another save location." : "Couldn't save this file."));
  return true;
}
