# 01: New Canvas atidaro piešiamą Canvas skirtuką

**What to build:** Vartotojas paspaudžia File → New Canvas (`Ctrl/Cmd+Shift+N`) arba Welcome mygtuką „New canvas“, ir naujame skirtuke atsidaro tuščias Canvas su Excalidraw įrankiais (lock, hand, select, rectangle, diamond, ellipse, arrow, line, pen, text, eraser, image, frame, laser, lasso). Canvas seka Doko temą, veikia be interneto, o Excalidraw meniu rodo tik Find on canvas, Help, Reset canvas, fono spalvą ir Library (be naršymo internete). Tai rizikingiausias ticket: jei šriftai ar CSS neveikia be CSP susilpninimo, sustoti ir aptarti su vartotoju.

Šaltiniai: `docs/superpowers/specs/2026-11-22-canvas-spec.md`, `GLOSSARY.md`.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] File meniu turi „New Canvas“ su `CmdOrCtrl+Shift+N`; Welcome ekranas turi „New canvas“ mygtuką; abu atidaro naują Canvas skirtuką
- [ ] Skirtukas rodo Canvas ikoną; kitų atidarytų dokumentų skirtukai nepakinta
- [ ] Excalidraw kraunamas tik atidarius Canvas (programos paleidimo bundle jo neįtraukia – patikrinta build išvestimi)
- [ ] Šriftai kraunami iš programos resursų, be tinklo užklausų; CSP nepakeistas; `npm run test:reader-security` praeina
- [ ] Doko tema (šviesi / tamsi) pritaikoma Canvas ir keičiasi kartu su nustatymu
- [ ] Excalidraw meniu neturi Open, Save to, Export, Live collaboration, Sign up, socialinių nuorodų, temos jungiklio
- [ ] Ataskaitoje nurodyta, kurie Q4 įrankiai realiai yra įdiegtoje Excalidraw versijoje (ypač lasso, laser) ir kiek padidėjo build
- [ ] Naujas `smoke-canvas` (įtrauktas į smoke žingsnius) atidaro Canvas iš File meniu, prideda elementą ir patikrina temą
- [ ] Nauji Elementai pagal nutylėjimą ranka piešto stiliaus (Excalidraw numatytasis roughness ir ranka rašytas šriftas)
- [ ] `npm run test:document-tools` praeina
- [ ] `npx tsc --noEmit`, `npm run build`, `npm run smoke` praeina
