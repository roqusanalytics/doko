# 03: Canvas išsaugomas ir vėl atidaromas kaip `.excalidraw`

**What to build:** Vartotojas išsaugo Canvas kaip `.excalidraw` failą (Save, Save As), o po to pakeitimai saugomi automatiškai kaip Markdown. Esamą `.excalidraw` failą galima atidaryti per Open dialogą, nutempus į langą arba dukart spustelėjus sistemoje (Windows, macOS, Linux). Atidarius iš naujo, visi Elementai, stiliai, paveikslėliai ir rodyklių ryšiai yra tokie patys. Sugadintas failas rodo aiškią klaidą.

Failas: standartinis Excalidraw JSON (`type: "excalidraw"`, `version: 2`, `source`, `elements`, `appState`, `files`); saugomi tik ilgalaikiai `appState` laukai (fono spalva, tinklelis).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Main proceso turinio failų modulis skaito ir rašo `excalidraw` formatą: UTF-8, JSON ir `type === "excalidraw"` patikra, ta pati dydžio riba ir atomic save
- [ ] `.excalidraw` yra Open dialogo filtre, renderer'io priimamų plėtinių sąraše, failų asociacijose ir Linux MIME tipuose
- [ ] File meniu būsena `canvas`: Save, Save As, Export / Convert, Properties įjungti; Print ir Reduce File Size išjungti
- [ ] Autosave veikia po Save; failas atsidaro excalidraw.com formatu (rankiniu būdu patikrinta arba patikrinta JSON struktūra)
- [ ] `test-content-files` papildytas: teisingas failas; ne JSON; JSON be `type: "excalidraw"`; BOM; per didelis failas; atomic save
- [ ] `smoke-canvas`: elementai + paveikslėlis → Save į laikiną aplanką → uždaryti → atidaryti → elementų skaičius, tipai, užrašai ir rodyklių ryšiai sutampa; sugadintas failas rodo klaidą
- [ ] Išsaugotas tamsioje temoje failas turi tas pačias Elementų spalvas kaip šviesioje (tema nekeičia failo turinio)
- [ ] Atidarytas ar išsaugotas Canvas neatsiranda „Recent“ sąraše
- [ ] `npm run test:content`, `npm run test:document-tools`, `npx tsc --noEmit`, `npm run build`, `npm run smoke` praeina
