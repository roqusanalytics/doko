# Įgyvendinimo planas

Apimtis patvirtinta 2026-11-09 pagal `2026-11-09-universal-reader-design.md`.

1. Native failai: `electron/content-files.cjs`, pagrindinio proceso ir preload integracija, tipai.
   Patikra: UTF-8 / BOM / EOL, failų dydis, konfliktas, atomic save, aplanko ribos, vaizdų raiška.
2. UI: `ContentReader.tsx` su esamu Markdown rendererio bibliotekų rinkiniu ir galerija;
   naudoti dabartines temas, skirtukus ir modalą. Failų / aplankų tapatybė atskira nuo PDF turinio.
3. Integracija: bendras failų pasirinkimas ir drop, macOS open-file, Windows / Linux argv,
   visų platformų asociacijos. PDF `App` ir jo saugojimo kelias išlieka.
4. Patikra: naujas `test:content`, `tsc`, build, smoke, saugumo ir susijusios regresijos.
   E2E per projekto nematomą Electron harness; siauras / platus langas ir šviesi / tamsi tema.
5. Vienas pradinis viso pakeitimo priešiškos peržiūros ratas: du kritikai, atskiras vertintojas.
   Taisyti privalomus radinius ir tiksliniu testu patikrinti pataisas.
6. Vietinė `Folio Local` kopija su atskiru profiliu ir išjungtu upstream updater.
   Supakuoti tik vietiniam diegimui, nieko nepublikuoti. Patikrinti įdiegtą paketą,
   palikti originalų `/Applications/Folio.app`. Windows / Linux runtime nepatvirtintas šiame Mac etape.

Failų savininkai įgyvendinimo metu: native subagentas — electron backend ir desktop tipai;
UI subagentas — naujas readeris ir CSS; testų subagentas — naujas E2E;
pagrindinis agentas — skirtukai, įėjimai, paketavimas, integracija, patikra ir diegimas.
