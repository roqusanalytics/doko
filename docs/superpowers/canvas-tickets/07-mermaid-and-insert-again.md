# 07: AI Mermaid diagramos ir „Insert again“

**What to build:** AI gali grąžinti `mermaid` bloką (flowchart, sequence, class), ir Doko paverčia jį Excalidraw diagrama su tuo pačiu išdėstymu, pažymėjimu ir vieno Undo taisykle kaip 06. Vartotojas Mermaid tekstą gali įklijuoti ir pats (Excalidraw Mermaid dialogas). Po kiekvieno sėkmingo AI įterpimo pokalbyje yra mygtukas „Insert again“, kuris įterpia tą patį piešinį iš naujo, su naujais id ir nauju išdėstymu.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] `mermaid` blokas tampa Elementais; Mermaid sintaksės klaida rodo aiškią žinutę ir Scena nepakinta
- [ ] Mermaid konverteris kraunamas tik prireikus (lazy)
- [ ] Vartotojo Mermaid dialogas veikia be interneto
- [ ] „Insert again“ įterpia kopiją su naujais id, kitoje laisvoje vietoje; vienas Undo ją pašalina
- [ ] Unit testai papildyti: Mermaid blokas; Mermaid klaida; „Insert again“ duoda naujus id
- [ ] `smoke-canvas` papildytas: AI Mermaid blokas sukuria diagramą
- [ ] `npm run test:document-tools` praeina
- [ ] `npx tsc --noEmit`, `npm run build`, `npm run smoke` praeina
