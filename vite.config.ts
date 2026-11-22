import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { csp } from "./electron/csp.cjs";

// The browser edition gets the policy as a meta tag, since dist/ may be hosted statically (the desktop app
// sends it as a header; see electron/main.cjs). connect-src also allows http(s) here so "Open a link" can
// fetch PDFs from any origin.
const CSP = csp({ connect: "'self' https: http: data: blob:" });

// Build only: the dev server needs its HMR websocket and inline preamble, which a CSP would block.
const cspMeta: Plugin = {
  name: "folio-csp-meta",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace("<title>", `<meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <title>`),
};

// Excalidraw appends its CDN even when EXCALIDRAW_ASSET_PATH is set, which triggers
// Chromium's CSP checks when it registers the font faces. Keep both sources local.
const offlineExcalidraw: Plugin = {
  name: "doko-offline-excalidraw",
  enforce: "pre",
  transform(code, id) {
    if (id.endsWith("/@excalidraw/mermaid-to-excalidraw/dist/parser/class.js")) {
      // Recent Mermaid versions prefix class group IDs with the SVG ID. The renderer
      // also reparses the input, so the numeric suffix can differ from the parser's.
      return code.replace(/const regex = new RegExp\([^\n]+\);\s*const all = [^\n]+;/, [
        'const prefix = `classId-${id}-`;',
        'const svgPrefix = `${containerEl.querySelector("svg")?.id}-${prefix}`;',
        'const all = Array.from(containerEl.querySelectorAll("[id]")).filter(({ id }) =>',
        '    [prefix, svgPrefix].some(start => id.startsWith(start) && /^\\d+$/.test(id.slice(start.length))));',
      ].join("\n"));
    }
    if (!id.includes("/@excalidraw/excalidraw/dist/") || !id.endsWith(".js")) return;
    const rewritten = code.replace(/"ASSETS_FALLBACK_URL",\s*`https:\/\/esm\.sh\/[^\r\n]+?\/dist\/prod\/`/,
      '"ASSETS_FALLBACK_URL", window.EXCALIDRAW_ASSET_PATH');
    if (rewritten !== code) return rewritten;
  },
};

export default defineConfig({
  plugins: [react(), cspMeta, offlineExcalidraw],
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  optimizeDeps: { rolldownOptions: { plugins: [offlineExcalidraw] } },
  build: {
    target: "es2022",
    license: true,
    // pdf.js alone is ~800 KB minified; it is one library and can't usefully be split further.
    chunkSizeWarningLimit: 1200,
  },
});
