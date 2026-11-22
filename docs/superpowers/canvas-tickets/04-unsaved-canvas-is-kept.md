# 04: Neišsaugotas Canvas nedingsta

**What to build:** Naujas, dar neišsaugotas Canvas saugomas kaip juodraštis programoje, kad nedingtų nulūžus Doko ar užmigus skirtukui. Pirmas `Ctrl/Cmd+S` klausia, kur išsaugoti failą; po to juodraštis ištrinamas. Uždarant neišsaugotą Canvas, vartotojas gauna klausimą „Save?“.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Neišsaugoto Canvas Scena saugoma esamoje `folio` IndexedDB duomenų bazėje ir atkuriama po reader perkrovimo
- [ ] Pirmas Save atidaro Save dialogą; po sėkmingo išsaugojimo juodraštis pašalinamas
- [ ] Uždarant skirtuką su neišsaugotais pakeitimais rodomas „Save?“ klausimas (Save / Don't save / Cancel); Cancel palieka skirtuką atidarytą
- [ ] Skirtuko užmigdymas (suspend) ir pažadinimas neprarandą pakeitimų
- [ ] `smoke-canvas` papildytas: juodraštis išlieka po perkrovimo; uždarymas be Save rodo klausimą
- [ ] `npm run test:document-tools` praeina
- [ ] `npx tsc --noEmit`, `npm run build`, `npm run smoke` praeina
