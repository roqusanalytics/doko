import type { OpenSource } from "./documentTabs";

export const CONTENT_ACCEPT = "application/pdf,.pdf,.doc,.docx,.md,.markdown,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif";
const MARKDOWN = /\.(md|markdown)$/i;
const IMAGE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

export async function localSources(files: File[]): Promise<OpenSource[]> {
  const browserImages = !window.folioDesktop ? files.filter(file => IMAGE.test(file.name)) : [];
  const sources = await Promise.all(files.map(async (file): Promise<OpenSource | null> => {
    try {
      if (MARKDOWN.test(file.name) || IMAGE.test(file.name)) {
        if (window.folioDesktop) {
          const document = await window.folioDesktop.content.open(file);
          return { kind: "content", name: document.name, document };
        }
        if (MARKDOWN.test(file.name)) {
          if (file.size > 5 * 1024 * 1024) throw new Error("Markdown files must be smaller than 5 MB.");
          const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
          return { kind: "content", name: file.name, document: { kind: "markdown", name: file.name, text } };
        }
        if (file !== browserImages[0]) return null;
        const blobs = Object.fromEntries(browserImages.map(image => [image.name, image]));
        return { kind: "content", name: file.name, document: { kind: "gallery", name: "Selected images",
          files: Object.keys(blobs).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }) || a.localeCompare(b)),
          selected: file.name, blobs } };
      }
      if (window.folioDesktop && /\.docx?$/i.test(file.name)) return { kind: "word", name: file.name, file };
      if (!file.type || /\.pdf$/i.test(file.name) || file.type === "application/pdf") return { kind: "blob", name: file.name, blob: file };
      throw new Error("This file type isn't supported. Choose a PDF, Markdown document, or image.");
    } catch (error) {
      return { kind: "error", name: file.name, message: `Couldn't open “${file.name}”. ${(error as Error).message}` };
    }
  }));
  return sources.filter((source): source is OpenSource => source !== null);
}
