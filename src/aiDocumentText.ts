import type { PageText } from "./OcrFindController";

const MAX_DOC_CHARS = 400_000;

export async function readAiDocumentText(numPages: number, getPageText: (n: number) => Promise<PageText>, signal: AbortSignal) {
  let text = "";
  for (let n = 1; n <= numPages; n++) {
    signal.throwIfAborted();
    if (text.length >= MAX_DOC_CHARS) return { text, truncated: true };
    const content = await getPageText(n);
    signal.throwIfAborted();
    const page = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("")
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const block = `[Page ${n}]\n${page}\n\n`;
    if (text.length + block.length > MAX_DOC_CHARS) return { text, truncated: true };
    text += block;
  }
  return { text, truncated: false };
}
