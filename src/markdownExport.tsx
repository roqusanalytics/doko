import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMathDelimiters } from "./chatMath";

export async function markdownHtml(name: string, text: string, id?: string) {
  const content = renderToStaticMarkup(<ReactMarkdown skipHtml remarkPlugins={[[remarkMath, { singleDollarTextMath: false }]]}
    rehypePlugins={[[rehypeKatex, { output: "mathml", trust: false, strict: "ignore", maxExpand: 1000, maxSize: 20 }]]} components={{
    a: ({ href, children }) => href && /^(https?:|#)/i.test(href) ? <a href={href} rel="noreferrer">{children}</a> : <span>{children}</span>,
  }}>{normalizeMathDelimiters(text)}</ReactMarkdown>);
  const parsed = new DOMParser().parseFromString(content, "text/html");
  let bytes = 0;
  for (const image of parsed.querySelectorAll("img")) {
    const src = image.getAttribute("src") || "";
    if (!id || !window.folioDesktop || /^[a-z][a-z\d+.-]*:|^[\\/#]/i.test(src)) {
      image.replaceWith(parsed.createTextNode(image.alt || "Image unavailable")); continue;
    }
    const asset = await window.folioDesktop.content.asset(id, src);
    bytes += asset.data.byteLength;
    if (bytes > 32 * 1024 * 1024) throw new Error("Embedded images exceed 32 MB. Export the Markdown source instead.");
    image.src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Couldn't embed an image."));
      reader.readAsDataURL(new Blob([new Uint8Array(asset.data)], { type: asset.mime }));
    });
  }
  const title = parsed.createElement("title"); title.textContent = name;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">${title.outerHTML}<style>body{font:16px/1.65 system-ui,sans-serif;color:#202020;max-width:850px;margin:40px auto;padding:0 24px}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f3f3;padding:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px}blockquote{border-left:3px solid #ccc;padding-left:16px;margin-left:0}@media print{body{margin:0;max-width:none}@page{margin:20mm}a{color:inherit}}</style></head><body>${parsed.body.innerHTML}</body></html>`;
}
