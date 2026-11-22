# Canvas: specifikacija

Patvirtinta 2026-11-22 (grilling sesija, Q1–Q20). Terminai: `GLOSSARY.md` (Canvas, Element, Scene).

## Tikslas

Naujas Doko dokumento tipas **Canvas**: begalinė piešimo erdvė pagal Excalidraw principus.
Vartotojas piešia, rašo, deda figūras, rodykles ir paveikslėlius. Ask AI pagal užduotį
nupiešia figūras, diagramas ar schemas tiesiai ant Canvas.

## Sprendimai

| # | Sprendimas |
|---|---|
| Q1, Q8 | UI ir glossary terminas: **Canvas**. Kode visada pilna forma: `kind: "canvas"`, `CanvasDocument`, `CanvasReader`, `src/canvasDocument/…`; nauji kintamieji nevadinami vien `canvas` (konfliktas su HTML `<canvas>`). |
| Q2 | Pagrindas: `@excalidraw/excalidraw` (MIT, 0.18.x). Savo variklio nerašome. tldraw atmestas dėl licencijos. |
| Q3 | Canvas – naujas dokumento tipas savo skirtuke (iframe reader), kaip Markdown. Piešimo ant PDF nedarome. |
| Q4 | v1 įrankiai: lock, hand, select, rectangle, diamond, ellipse, arrow, line, pen, text, eraser, image, frame, laser, Mermaid → diagrama (lasso atidėtas: nėra Excalidraw 0.18.1). Eksportas: PNG, SVG, PDF. Nedarome: Sign in, Share / collaboration, Web Embed, Wireframe to code, Draw to shape. |
| Q5 | AI grąžina arba elementų skeleton JSON (pagrindinis kelias), arba Mermaid (flowchart, sequence, class). AI pasirenka pats. |
| Q6 | v1 AI skaito Sceną ir **tik prideda** Elementus. Keitimas ir trynimas – v2. Kiekvienas AI pakeitimas = vienas Undo žingsnis. |
| Q7 | Numatytasis stilius – Excalidraw ranka pieštas (roughness, Virgil šriftas). |
| Q9 | Saugojimas: tikras `.excalidraw` failas diske (JSON, paveikslėliai įdėti base64), per `content-files`, su autosave kaip Markdown. |
| Q10 | Naujas Canvas – juodraštis IndexedDB, kol vartotojas paspaudžia Ctrl+S. Vietos klausiama per pirmą išsaugojimą. Uždarant neišsaugotą – klausimas „Save?“. |
| Q11 | `.excalidraw` atidaromas per Open, drag & drop ir OS file association (Win / macOS / Linux). PNG / SVG su įdėta scena kaip Canvas – v2. |
| Q12 | „New canvas“: Welcome ekrane šalia „Open a file“ ir File → New Canvas (`CmdOrCtrl+Shift+N`). |
| Q13 | Ta pati Ask AI panelė, atsieta nuo PDF (tie patys tiekėjai, modeliai, istorija). |
| Q14 | AI Elementų vieta: į pažymėtą frame; kitaip į laisvą vietą dešinėje nuo turinio. Po to – pažymėti ir parodyti (scroll + zoom). AI pokalbyje trumpai aprašo, ką nupiešė. |
| Q15 | Tema seka Doko temą. Atskiro jungiklio Canvas viduje nėra. |
| Q16 | PDF eksportas: vienas puslapis pagal turinio dydį (arba pažymėtų Elementų). Nustatymai tie patys kaip PNG / SVG. A4 skaidymas – v2. |
| Q17 | AI Elementai uždedami iškart ir pažymimi. Pokalbyje lieka „Insert again“. |
| Q18 | AI gauna tekstinę Scenos santrauką (tipai, užrašai, pozicijos, rodyklių ryšiai, pažymėti Elementai). Ekrano vaizdas – v2. |
| Q19 | „Recent“ sąraše Canvas nerodomas (kaip Markdown). „Recent“ išplėtimas – atskiras darbas. |
| Q20 | Excalidraw meniu: išimti Open, Save to, Export, Live collaboration, Sign up, socialines nuorodas, temos jungiklį. Palikti Find on canvas, Help, Reset canvas, fono spalvą, Library (be libraries.excalidraw.com naršymo). |

## Apribojimai

- Veikia Windows, macOS ir Linux (`AGENTS.md`).
- Veikia be interneto: Excalidraw šriftai ir resursai įdedami į build, `EXCALIDRAW_ASSET_PATH` rodo į juos.
- CSP (`electron/csp.cjs`) nesilpninamas be atskiro pagrindimo. `test:reader-security` turi praeiti.
- Excalidraw kraunamas tik atidarius Canvas (lazy import), programos paleidimas nelėtėja.
- AI kredencialai lieka main procese. AI išvestis yra nepatikimi duomenys: JSON / Mermaid validuojami prieš dedant ant Canvas.

## v2 (ne šio darbo apimtis)

Lasso įrankis (kai bus stabiliame Excalidraw leidime); AI keičia ir trina Elementus; ekrano vaizdas AI modeliui; PNG / SVG su scena atidaromi kaip Canvas;
PDF eksportas A4 puslapiais; Canvas „Recent“ sąraše; Ask AI Markdown dokumentuose.
