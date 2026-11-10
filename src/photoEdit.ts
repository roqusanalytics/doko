import { loadPdf } from "./pdf";
import { photoPdf } from "./documentExport";

// Keep the source and working canvases together within a practical desktop memory budget.
export const MAX_PHOTO_PIXELS = 40_000_000;
export type PhotoOperation = { kind: "crop"; x: number; y: number; width: number; height: number }
  | { kind: "rotate"; turns: 1 | 3 } | { kind: "flip"; axis: "horizontal" | "vertical" }
  | { kind: "resize"; width: number; height: number };
export interface PhotoEditState { operations: PhotoOperation[]; brightness: number; contrast: number; saturation: number }
export const initialPhotoEdit = (): PhotoEditState => ({ operations: [], brightness: 0, contrast: 0, saturation: 0 });

export function validatePhotoSize(width: number, height: number) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 32767)) throw new Error("Enter whole pixel dimensions between 1 and 32767.");
  if (width * height > MAX_PHOTO_PIXELS) throw new Error("Photo editing is limited to 40 million pixels. Choose smaller dimensions.");
}

export function photoEditSize(width: number, height: number, operations: PhotoOperation[]) {
  validatePhotoSize(width, height);
  for (const operation of operations) {
    if (operation.kind === "crop") {
      validatePhotoSize(operation.width, operation.height);
      if (![operation.x, operation.y].every(n => Number.isSafeInteger(n) && n >= 0) || operation.x + operation.width > width || operation.y + operation.height > height) throw new Error("The crop must stay inside the photo.");
      width = operation.width; height = operation.height;
    } else if (operation.kind === "resize") {
      validatePhotoSize(operation.width, operation.height);
      width = operation.width; height = operation.height;
    } else if (operation.kind === "rotate") {
      if (![1, 3].includes(operation.turns)) throw new Error("Choose a quarter-turn rotation.");
      [width, height] = [height, width];
    } else if (operation.kind === "flip") {
      if (!["horizontal", "vertical"].includes(operation.axis)) throw new Error("Choose a horizontal or vertical flip.");
    } else throw new Error("Unknown photo edit.");
  }
  return { width, height };
}

export function adjustPhotoPixels(data: Uint8ClampedArray, state: Pick<PhotoEditState, "brightness" | "contrast" | "saturation">) {
  for (const value of [state.brightness, state.contrast, state.saturation]) if (!Number.isFinite(value) || value < -100 || value > 100) throw new Error("Color adjustments must be between -100 and 100.");
  const brightness = state.brightness * 2.55;
  const contrast = (100 + state.contrast) / 100;
  const saturation = (100 + state.saturation) / 100;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    data[i] = ((gray + (r - gray) * saturation) - 127.5) * contrast + 127.5 + brightness;
    data[i + 1] = ((gray + (g - gray) * saturation) - 127.5) * contrast + 127.5 + brightness;
    data[i + 2] = ((gray + (b - gray) * saturation) - 127.5) * contrast + 127.5 + brightness;
  }
}

function canvas(width: number, height: number) {
  const result = Object.assign(document.createElement("canvas"), { width, height });
  if (!result.getContext("2d")) throw new Error("Couldn't allocate the photo. Try a smaller image.");
  return result;
}

export async function loadPhotoCanvas(bytes: Uint8Array, signal: AbortSignal): Promise<HTMLCanvasElement> {
  if (!bytes.length) throw new Error("This photo is empty.");
  const pdf = await loadPdf(bytes, signal);
  const stop = () => { void pdf.loadingTask.destroy().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });
  let result: HTMLCanvasElement | undefined;
  try {
    signal.throwIfAborted();
    if (pdf.numPages !== 1) throw new Error("Photo editing requires a single photo.");
    const page = await pdf.getPage(1);
    signal.throwIfAborted();
    const viewport = page.getViewport({ scale: 1 });
    const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
    validatePhotoSize(width, height);
    result = canvas(width, height);
    const task = page.render({ canvas: null, canvasContext: result.getContext("2d")!, viewport, intent: "print", background: "rgba(0, 0, 0, 0)" });
    const cancel = () => task.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try { await task.promise; signal.throwIfAborted(); }
    finally { signal.removeEventListener("abort", cancel); }
    return result;
  } catch (error) {
    if (result) result.width = result.height = 0;
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
    await pdf.loadingTask.destroy();
  }
}

/** Replays edits from the immutable source; previews can use fewer pixels without changing output geometry. */
export function renderPhotoEdit(source: HTMLCanvasElement, state: PhotoEditState, maxEdge = 0, signal?: AbortSignal): HTMLCanvasElement {
  signal?.throwIfAborted();
  photoEditSize(source.width, source.height, state.operations);
  if (!Number.isFinite(maxEdge) || maxEdge < 0) throw new Error("Choose a valid preview size.");
  // Validate colors before allocating any working image.
  adjustPhotoPixels(new Uint8ClampedArray(), state);
  let logicalWidth = source.width, logicalHeight = source.height;
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(source.width, source.height, ...state.operations.flatMap(op => op.kind === "resize" ? [op.width, op.height] : []))) : 1;
  let current = canvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
  try {
    current.getContext("2d")!.drawImage(source, 0, 0, current.width, current.height);
    for (const op of state.operations) {
      signal?.throwIfAborted();
      const size = photoEditSize(logicalWidth, logicalHeight, [op]);
      const next = canvas(Math.max(1, Math.round(size.width * scale)), Math.max(1, Math.round(size.height * scale)));
      try {
        const context = next.getContext("2d")!;
        if (op.kind === "crop") context.drawImage(current, op.x / logicalWidth * current.width, op.y / logicalHeight * current.height, op.width / logicalWidth * current.width, op.height / logicalHeight * current.height, 0, 0, next.width, next.height);
        else if (op.kind === "rotate") {
          context.translate(next.width / 2, next.height / 2); context.rotate(op.turns * Math.PI / 2);
          context.drawImage(current, -current.width / 2, -current.height / 2);
        } else if (op.kind === "flip") {
          context.translate(op.axis === "horizontal" ? next.width : 0, op.axis === "vertical" ? next.height : 0);
          context.scale(op.axis === "horizontal" ? -1 : 1, op.axis === "vertical" ? -1 : 1);
          context.drawImage(current, 0, 0);
        } else context.drawImage(current, 0, 0, next.width, next.height);
      } catch (error) { next.width = next.height = 0; throw error; }
      current.width = current.height = 0; current = next;
      logicalWidth = size.width; logicalHeight = size.height;
    }
    if (state.brightness || state.contrast || state.saturation) {
      const context = current.getContext("2d")!;
      const pixels = context.getImageData(0, 0, current.width, current.height);
      adjustPhotoPixels(pixels.data, state); context.putImageData(pixels, 0, 0);
    }
    signal?.throwIfAborted();
    return current;
  } catch (error) { current.width = current.height = 0; throw error; }
}

export async function createPhotoEditPdf(source: HTMLCanvasElement, state: PhotoEditState, signal: AbortSignal) {
  const output = renderPhotoEdit(source, state, 0, signal);
  try {
    const png = await new Promise<Blob>((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error("Couldn't encode this photo. Try smaller dimensions.")), "image/png"));
    signal.throwIfAborted();
    return await photoPdf(png, signal);
  } finally { output.width = output.height = 0; }
}
