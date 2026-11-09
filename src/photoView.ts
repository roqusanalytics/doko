import type { PDFViewer } from "./viewer";

/** Photo PDFs use one point per source pixel; PDF.js adds 96/72 CSS pixels per point. */
export function photoScale(width: number, height: number, availableWidth: number, availableHeight: number) {
  return Math.min(1, Math.max(1, availableWidth) / width, Math.max(1, availableHeight) / height) * 72 / 96;
}

export function fitPhoto(viewer: PDFViewer) {
  const page = viewer.getPageView(0)?.pdfPage;
  const container = viewer.container;
  if (!page || !container.offsetWidth || !container.offsetHeight || container.querySelector(".annotationEditorLayer.inkEditing.drawing")) return;
  const viewport = page.getViewport({ scale: 1, rotation: viewer.pagesRotation + page.rotate });
  // Ignore temporary scrollbars from the previous image; reserve the floating controls and cap at source size.
  const scale = photoScale(viewport.width, viewport.height, container.offsetWidth - 32, container.offsetHeight - 104);
  if (Math.abs(viewer.currentScale - scale) > 0.00001) viewer.currentScale = scale;
  container.scrollTop = 0;
  container.scrollLeft = 0;
}
