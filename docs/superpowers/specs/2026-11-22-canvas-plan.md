# Canvas: įgyvendinimo planas

Pagal `2026-11-22-canvas-design.md`. Darbas atskiroje šakoje `feat/canvas` nuo `main`.

## Fazės

### 0. Prototipas (rizikos patikra, ~0,5 d.)
`@excalidraw/excalidraw` įkeliamas į reader iframe su lazy import.
Patikrinti: Vite build (`process.env.IS_PREACT` define), šriftai be interneto per esamą CSP,
kurie Q4 įrankiai realiai yra 0.18.x (lasso, laser), bundle dydis.
**Sustojimo sąlyga:** jei šriftai ar CSS neveikia be CSP susilpninimo – sustoti ir aptarti.

### 1. Failai ir dokumento tipas
- `electron/content-files.cjs`: formatas `excalidraw` (UTF-8 JSON, `.excalidraw`), JSON validacija skaitant, atomic save.
- `electron/main.cjs` atidarymo filtras, `src/content-source.ts` `CONTENT_ACCEPT`, `package.json` `fileAssociations` + `linux.mimeTypes`.
- `src/desktop.d.ts`: `CanvasDocument` į `ContentDocument` sąjungą; `electron/preload.cjs` jei reikia naujų kanalų.
- Patikra: `npm run test:content` papildomas `.excalidraw` atvejais (sugadintas JSON, didelis failas, BOM).

### 2. CanvasReader
- `src/canvasDocument/CanvasReader.tsx`: `Reader {open, flush, suspend, canClose}`, `markDirty`, autosave, tema, `UIOptions` ir `MainMenu` pagal Q20.
- `src/main.tsx` šaka `canvas`; ikona `src/icons.tsx` ir `DocumentTabBar`.
- Juodraštis IndexedDB (Q10), „Save?“ uždarant.
- Eksportas PNG / SVG (Excalidraw `exportToBlob` / `exportToSvg`), PDF per `pdf-lib` iš SVG / PNG (Q16) per esamą Export / Convert meniu.

### 3. Įėjimai
- `src/Welcome.tsx` mygtukas „New canvas“.
- `electron/file-menu.cjs` File → New Canvas (`CmdOrCtrl+Shift+N`) → `folio:tab-command`.
- `file-menu` būsenos `kind: 'canvas'` – Save / Save As / Export įjungti, Print ir Reduce File Size išjungti.

### 4. Ask AI Canvas dokumente
- `src/AiPanel.tsx` atsieti nuo `PDFDocumentProxy`: bendras „document context“ (tekstas + tipas).
- `electron/ai-prompt.cjs`: Canvas sistemos prompt (skeleton JSON schema, Mermaid taisyklės, koordinačių sistema, Scenos santrauka). `validRequest` priima Canvas kontekstą.
- `src/canvasDocument/sceneSummary.ts`: Scena → kompaktiškas tekstas (Q18), su dydžio riba.
- `src/canvasDocument/aiInsert.ts`: atsakymo blokas → validacija → `convertToExcalidrawElements` arba `parseMermaidToExcalidraw` → išdėstymas (Q14) → `updateScene` su `CaptureUpdateAction.IMMEDIATELY` → pažymėti ir `scrollToContent`. Klaida → aiški žinutė pokalbyje, Canvas nepakeistas.
- „Insert again“ mygtukas po AI atsakymu (Q17).
- Tiekėjų (ChatGPT, Claude CLI, OpenRouter) keisti nereikia: blokas atpažįstamas iš teksto atsakymo.

### 5. Patikra
- Unit: `aiInsert` ir `sceneSummary` (netinkamas JSON, nežinomas tipas, neegzistuojantis rodyklės id, Mermaid klaida, išdėstymas su frame ir be jo).
- `scripts/smoke-canvas.mjs` į `smoke-steps.json`: naujas Canvas → nupiešti → Save → uždaryti → atidaryti → Elementai tie patys; Undo po AI įterpimo.
- `npx tsc --noEmit`, `npm run build`, `npm run smoke`, `npm run test:content`, `npm run test:reader-security`, `npm run test:document-tools`.
- Vaizdinė patikra: šviesi / tamsi tema, siauras / platus langas.

### 6. Peržiūra
Vienas nepriklausomos peržiūros ratas (correctness + saugumas: AI išvesties validacija, CSP, failų keliai). Taisyti privalomus radinius.

## Užbaigimo kriterijus (`/goal`)

„Canvas atsidaro iš Welcome ir File meniu, `.excalidraw` saugomas ir atidaromas iš naujo be nuostolių,
Ask AI įterpia diagramą, kurią galima atšaukti vienu Undo, PNG / SVG / PDF eksportas veikia,
ir visos 5 fazės patikros komandos praeina.“

## Darbo pasiskirstymas

- Subagentas A (Sonnet, high): 1 fazė – electron failai, tipai, asociacijos, `test:content`.
- Subagentas B (Sonnet, high): 2–3 fazės – `CanvasReader`, eksportas, įėjimai.
- Pagrindinis agentas: 0 fazė, 4 fazė (AI integracija ir prompt), integracija, 5–6 fazės.
- A ir B dirba lygiagrečiai, kai 0 fazė patvirtina paketą. 4 fazė – po B.

Release, commit ir push – tik jums paprašius (`npm run release`).
