# Canvas: spec

Būsena: `ready-for-agent`. Šaltiniai: `2026-11-22-canvas-design.md` (sprendimai Q1–Q20), `2026-11-22-canvas-plan.md` (fazės), `GLOSSARY.md` (Canvas, Element, Scene).

## Problem Statement

Doko moka skaityti ir redaguoti PDF, Markdown, nuotraukas ir lenteles, bet neturi vietos laisvai mąstyti vizualiai.
Kai vartotojui reikia nusipiešti schemą, procesą, architektūrą ar idėjų žemėlapį, jis turi išeiti iš Doko
į kitą įrankį (pvz. excalidraw.com), o ten nėra jo Ask AI nustatymų, modelių ir darbo konteksto.
Be to, diagramą sukurti ranka užtrunka: vartotojas žino, ką nori pavaizduoti, bet sugaišta laiką dėliodamas
figūras ir rodykles.

## Solution

Doko gauna naują dokumento tipą **Canvas**: begalinę piešimo erdvę su Excalidraw įrankiais ir ranka piešto
stiliaus išvaizda. Canvas atsidaro savo skirtuke iš Welcome ekrano arba File → New Canvas (`Ctrl/Cmd+Shift+N`),
saugomas kaip standartinis `.excalidraw` failas diske ir eksportuojamas į PNG, SVG ir PDF.

Ta pati Ask AI panelė, kurią vartotojas jau naudoja su PDF, veikia ir Canvas dokumente. Vartotojas aprašo,
ką nori nupiešti, o AI sukuria Elementus (figūras su užrašais, rodykles, tekstą, frame arba Mermaid diagramą)
tiesiai ant Canvas. AI mato esamą Sceną ir pažymėtus Elementus, prideda naujus į laisvą vietą arba pažymėtą
frame, juos pažymi ir parodo ekrane. Visą AI pakeitimą galima atšaukti vienu Undo.

## User Stories

### Canvas kūrimas ir atidarymas
1. Kaip vartotojas, noriu Welcome ekrane matyti mygtuką „New canvas“, kad galėčiau pradėti piešti vienu paspaudimu.
2. Kaip vartotojas, noriu File meniu punkto „New Canvas“, kad galėčiau sukurti Canvas, kai jau dirbu su kitu dokumentu.
3. Kaip klaviatūros vartotojas, noriu kombinacijos `Ctrl/Cmd+Shift+N`, kad Canvas sukurčiau neliesdamas pelės.
4. Kaip vartotojas, noriu, kad naujas Canvas atsidarytų naujame skirtuke, kad mano atidaryti dokumentai liktų vietoje.
5. Kaip vartotojas, noriu skirtuke matyti Canvas ikoną ir pavadinimą, kad atskirčiau jį nuo PDF ir Markdown.
6. Kaip vartotojas, noriu atidaryti esamą `.excalidraw` failą per „Open a file“, kad tęsčiau darbą, pradėtą excalidraw.com ar kitur.
7. Kaip vartotojas, noriu nutempti `.excalidraw` failą į Doko langą, kad jis atsidarytų kaip Canvas.
8. Kaip Windows, macOS ar Linux vartotojas, noriu dukart spustelėti `.excalidraw` failą sistemoje, kad jis atsidarytų Doko.
9. Kaip vartotojas, noriu aiškios klaidos žinutės, kai `.excalidraw` failas sugadintas, kad žinočiau, kodėl jis neatsidaro, ir Doko nenulūžtų.
10. Kaip vartotojas, noriu, kad Canvas veiktų be interneto ryšio, įskaitant šriftus, kad galėčiau piešti bet kur.

### Piešimas
11. Kaip vartotojas, noriu piešti stačiakampius, rombus ir elipses, kad galėčiau kurti schemas.
12. Kaip vartotojas, noriu piešti rodykles ir linijas, kurios prisikabina prie figūrų ir seka jas jas perkeliant, kad diagrama neiširtų.
13. Kaip vartotojas, noriu rašyti tekstą laisvai ir figūrų viduje, kad galėčiau pažymėti dalis.
14. Kaip vartotojas, noriu piešti laisva ranka (pen), kad galėčiau greitai pasižymėti ar parašyti ranka.
15. Kaip vartotojas, noriu trintuko, kad ištrinčiau Elementus braukdamas per juos.
16. Kaip vartotojas, noriu įdėti paveikslėlį į Canvas, kad galėčiau komentuoti ekrano kopijas ir nuotraukas.
17. Kaip vartotojas, noriu frame įrankio, kad galėčiau grupuoti Elementus į pavadintas sritis.
18. Kaip vartotojas, noriu hand įrankio, slinkties ir priartinimo, kad judėčiau po didelę Sceną.
19. Kaip vartotojas, noriu pasirinkimo ir lasso, kad galėčiau pažymėti vieną ar kelis Elementus.
20. Kaip vartotojas, noriu užrakinti įrankį (lock), kad nupieščiau kelias vienodas figūras iš eilės.
21. Kaip pristatantis vartotojas, noriu laser pointer, kad rodyčiau į Canvas dalis neištepdamas jų.
22. Kaip vartotojas, noriu keisti Elemento spalvą, užpildą, linijos storį, stilių ir ranka piešimo laipsnį, kad piešinys atrodytų taip, kaip noriu.
23. Kaip vartotojas, noriu, kad pagal nutylėjimą Elementai būtų ranka piešto stiliaus, kad schemos atrodytų kaip eskizai.
24. Kaip vartotojas, noriu įklijuoti Mermaid tekstą ir gauti diagramą, kad paversčiau esamą Mermaid aprašą piešiniu.
25. Kaip vartotojas, noriu Undo ir Redo, kad atšaukčiau klaidas.
26. Kaip vartotojas, noriu Find on canvas, kad rasčiau tekstą didelėje Scenoje.
27. Kaip vartotojas, noriu Help / shortcuts lango, kad išmokčiau klavišų kombinacijas.
28. Kaip vartotojas, noriu Library skydelio, kad pakartotinai naudočiau savo figūrų rinkinius.
29. Kaip vartotojas, noriu keisti Canvas fono spalvą, kad piešinys tiktų pristatymui.
30. Kaip vartotojas, noriu Reset canvas, kad išvalyčiau Sceną ir pradėčiau iš naujo (su Undo galimybe).

### Tema ir išvaizda
31. Kaip tamsios temos vartotojas, noriu, kad Canvas sektų Doko temą, kad ekranas nebūtų akinantis.
32. Kaip vartotojas, noriu, kad temos pakeitimas Doko nustatymuose iškart pakeistų ir atidarytą Canvas.
33. Kaip vartotojas, noriu, kad tamsi tema nekeistų spalvų faile, kad eksportas ir kiti įrankiai matytų tikras spalvas.
34. Kaip vartotojas, nenoriu matyti Excalidraw „Sign up“, „Live collaboration“ ir socialinių nuorodų, kad sąsaja nebūtų perkrauta nereikalingais dalykais.

### Saugojimas
35. Kaip vartotojas, noriu, kad naujas Canvas būtų saugomas kaip juodraštis programoje, kad nieko neprarasčiau, net jei Doko nulūžta prieš pirmą išsaugojimą.
36. Kaip vartotojas, noriu per pirmą `Ctrl/Cmd+S` pasirinkti, kur išsaugoti `.excalidraw` failą, kad failą turėčiau ten, kur noriu.
37. Kaip vartotojas, noriu, kad išsaugotas Canvas būtų automatiškai saugomas po pakeitimų, kaip Markdown, kad nereikėtų nuolat spausti Save.
38. Kaip vartotojas, noriu Save As, kad padaryčiau Canvas kopiją kitu pavadinimu.
39. Kaip vartotojas, uždarydamas neišsaugotą Canvas, noriu klausimo „Save?“, kad netyčia neprarasčiau darbo.
40. Kaip vartotojas, noriu, kad paveikslėliai būtų saugomi tame pačiame `.excalidraw` faile, kad failą galėčiau perkelti vieną.
41. Kaip vartotojas, noriu, kad Doko išsaugotą failą atidarytų excalidraw.com, kad nebūčiau užrakintas Doko.
42. Kaip vartotojas, noriu, kad uždarius ir vėl atidarius Canvas, visi Elementai, jų vietos, stiliai ir rodyklių ryšiai būtų tokie patys.
43. Kaip vartotojas, noriu, kad Canvas skirtukas, kurį Doko laikinai užmigdo, neprarastų neišsaugotų pakeitimų.

### Eksportas
44. Kaip vartotojas, noriu eksportuoti Canvas į PNG, kad įdėčiau jį į žinutę ar dokumentą.
45. Kaip vartotojas, noriu eksportuoti į SVG, kad piešinys liktų ryškus bet kokiu dydžiu.
46. Kaip vartotojas, noriu eksportuoti į PDF vieną puslapį pagal turinio dydį, kad galėčiau jį atspausdinti ar persiųsti.
47. Kaip vartotojas, noriu eksportuoti tik pažymėtus Elementus, kad išsaugočiau tik dalį Scenos.
48. Kaip vartotojas, noriu rinktis foną, tamsų režimą ir paraštę eksportuojant, kad rezultatas tiktų paskirčiai.
49. Kaip vartotojas, noriu eksportuoti per Doko Export / Convert meniu, kaip ir kitus dokumentus, kad nereikėtų ieškoti kito mygtuko.

### Ask AI
50. Kaip vartotojas, noriu Canvas dokumente atidaryti tą pačią Ask AI panelę kaip PDF dokumente, kad nereikėtų mokytis naujos sąsajos.
51. Kaip vartotojas, noriu naudoti tuos pačius AI tiekėjus ir modelius (ChatGPT, Claude, OpenRouter), kad nereikėtų nieko konfigūruoti iš naujo.
52. Kaip vartotojas, noriu parašyti „nupiešk prisijungimo proceso diagramą“ ir gauti diagramą ant Canvas, kad sutaupyčiau laiko.
53. Kaip vartotojas, noriu, kad AI sukurtų figūras su užrašais ir prikabintomis rodyklėmis, kad diagramą galėčiau toliau redaguoti ranka.
54. Kaip vartotojas, noriu, kad AI flowchart, sequence ar class diagramai galėtų naudoti Mermaid, kad sudėtingas išdėstymas būtų tvarkingas.
55. Kaip vartotojas, noriu, kad AI matytų, kas jau yra ant Canvas, kad galėčiau prašyti „pridėk žingsnį po Patvirtinimo“.
56. Kaip vartotojas, noriu, kad AI matytų mano pažymėtus Elementus, kad galėčiau prašyti „išplėsk šitą dalį“.
57. Kaip vartotojas, noriu, kad AI elementai atsirastų pažymėtame frame, jei toks yra, kad kontroliuočiau, kur jie atsiras.
58. Kaip vartotojas, noriu, kad be frame AI elementai atsirastų laisvoje vietoje dešinėje nuo turinio, kad neuždengtų mano piešinio.
59. Kaip vartotojas, noriu, kad po įterpimo nauji Elementai būtų pažymėti ir parodyti ekrane, kad iškart matyčiau rezultatą.
60. Kaip vartotojas, noriu vienu Undo pašalinti visą AI įterpimą, kad nereikėtų trinti po vieną Elementą.
61. Kaip vartotojas, noriu pokalbyje matyti trumpą AI aprašymą, ką jis nupiešė, kad suprasčiau rezultatą.
62. Kaip vartotojas, noriu mygtuko „Insert again“ po AI atsakymu, kad galėčiau įterpti tą patį piešinį dar kartą.
63. Kaip vartotojas, noriu aiškios žinutės, kai AI atsakymas netinkamas (sugadintas JSON ar Mermaid), ir kad Canvas liktų nepakeistas.
64. Kaip vartotojas, noriu matyti srautinį AI atsakymą ir galėti jį atšaukti, kaip PDF dokumente.
65. Kaip vartotojas, noriu, kad AI pokalbių istorija Canvas dokumente veiktų taip pat, kaip PDF dokumente.
66. Kaip privatumu besirūpinantis vartotojas, noriu, kad AI gautų tik tekstinę Scenos santrauką, o ne paveikslėlius, kad nesiųsčiau daugiau duomenų nei reikia.
67. Kaip vartotojas, noriu, kad AI nekeistų ir netrintų mano esamų Elementų, kad mano darbas būtų saugus.
68. Kaip vartotojas su didele Scena, noriu, kad AI užklausa neviršytų ribų ir neužstrigtų, kad Ask AI veiktų ir su dideliais piešiniais.

### Patikimumas ir platformos
69. Kaip vartotojas, noriu, kad Doko paleidimas nesulėtėtų dėl Canvas, kad programa atsidarytų taip pat greitai.
70. Kaip Windows, macOS ir Linux vartotojas, noriu, kad Canvas veiktų vienodai visose platformose.
71. Kaip vartotojas, noriu, kad Canvas nesusilpnintų Doko saugumo apribojimų, kad atidaryti failai negalėtų vykdyti svetimo kodo.

## Implementation Decisions

- **Variklis.** Naudojamas `@excalidraw/excalidraw` (MIT, 0.18.x) React komponentas. Savo piešimo variklio nerašome. tldraw atmestas dėl licencijos (draudžia produkcinį naudojimą be rakto).
- **Lazy load.** Excalidraw ir Mermaid konverteris kraunami tik atidarius Canvas, ne paleidžiant programą.
- **Resursai be interneto.** Excalidraw šriftai įdedami į build ir pasiekiami per programos protokolą. Asset kelias nurodomas prieš pirmą atvaizdavimą. CSP nesilpninamas; jei tai neįmanoma, darbas sustoja ir sprendžiama atskirai (0 fazė).
- **Dokumento tipas.** `ContentDocument` sąjunga gauna naują narį `CanvasDocument` su `kind: "canvas"`. Kode naudojama pilna forma (`CanvasDocument`, `CanvasReader`); vienas žodis `canvas` naujiems identifikatoriams nenaudojamas dėl konflikto su HTML `<canvas>`.
- **Reader.** Naujas `CanvasReader` modulis atsidaro reader iframe ir įgyvendina esamą `Reader` sąsają (`open`, `flush`, `suspend`, `canClose`) bei `markDirty`, kaip Markdown reader. Reader pasirinkimas pagal `kind` papildomas `canvas` šaka.
- **Failo formatas.** Standartinis `.excalidraw` JSON: `{type: "excalidraw", version: 2, source, elements, appState, files}`. Paveikslėliai – `files` žemėlapyje (base64 dataURL). Saugomi tik reikalingi `appState` laukai (fono spalva, tinklelis), ne laikina būsena (zoom, pažymėjimas, aktyvus įrankis).
- **Native failai.** Main proceso turinio failų modulis gauna formatą `excalidraw`: UTF-8 tekstas, JSON ir `type === "excalidraw"` patikra skaitant, ta pati dydžio riba ir atomic save kaip kitiems tekstiniams formatams. `.excalidraw` pridedamas prie atidarymo dialogo filtro, renderer'io priimamų plėtinių sąrašo, failų asociacijų (Win / macOS / Linux) ir Linux MIME tipų. Desktop API keičiamas visais keturiais sluoksniais (main → preload → tipai → renderer).
- **Juodraštis.** Neišsaugotas Canvas saugomas IndexedDB (esama `folio` duomenų bazė), kol vartotojas pasirenka failo vietą. Po pirmo Save juodraštis ištrinamas, toliau veikia autosave į failą.
- **Įėjimai.** Welcome ekrane mygtukas „New canvas“ šalia „Open from URL“. File meniu: „New Canvas“ su `CmdOrCtrl+Shift+N` (patikrinta: laisvas). Failų meniu būsena gauna `kind: 'canvas'`: Save, Save As, Export / Convert, Properties įjungti; Print ir Reduce File Size išjungti.
- **Excalidraw UI.** Pagrindiniame meniu lieka: Find on canvas, Help, Reset canvas, fono spalva. Išimama: Open, Save to, Export, Live collaboration, Sign up, socialinės nuorodos, temos jungiklis. Library lieka be libraries.excalidraw.com naršymo. Tema perduodama iš Doko ir keičiasi kartu su ja.
- **Eksportas.** PNG ir SVG per Excalidraw eksporto funkcijas. PDF: vienas puslapis pagal turinio (ar pažymėtų Elementų) dydį, sukuriamas esamu `pdf-lib`. Eksportas eina per esamą Doko eksporto dialogą.
- **Ask AI atsiejimas.** Ask AI panelė nebepriklauso nuo PDF objekto. Ji gauna bendrą dokumento kontekstą: dokumento tipą, pavadinimą, tekstą ir pasirinktą dalį. PDF kelias lieka toks pat.
- **AI užklausa.** AI užklausos validacija priima naują dokumento tipą `canvas`. Canvas turi savo sistemos prompt: koordinačių sistema, leidžiami Element tipai, skeleton JSON schema, Mermaid taisyklės, atsakymo formatas (trumpas aprašymas + vienas kodo blokas). Tiekėjų (ChatGPT, Claude Code CLI, OpenRouter) keisti nereikia: tool calling nenaudojamas.
- **Scenos santrauka (AI įvestis).** Scena paverčiama kompaktišku tekstu: Element id, tipas, x/y/plotis/aukštis, užrašas ar tekstas, rodyklių pradžia ir pabaiga (id), frame narystė, pažymėjimo žymė. Freedraw – tik vieta ir dydis. Paveikslėliai – tik vieta ir dydis. Santrauka turi dydžio ribą; viršijus ją, prioritetas pažymėtiems Elementams ir žymė „truncated“.
- **AI atsakymo kontraktas.** Atsakyme ieškomas paskutinis kodo blokas su žyme `excalidraw` (JSON masyvas Excalidraw element skeleton objektų) arba `mermaid`. Leidžiami skeleton tipai: `rectangle`, `diamond`, `ellipse`, `arrow`, `line`, `text`, `frame`. Rodyklės `start` / `end` gali nurodyti naujo arba esamo Elemento id. Nežinomi tipai, trūkstami privalomi laukai, nuorodos į neegzistuojančius id ir per didelis elementų skaičius atmetami su aiškia klaida; Canvas tada nekeičiamas.
- **Įterpimas.** Validuotas blokas → Excalidraw skeleton konverteris (arba Mermaid konverteris, tada skeleton konverteris) → išdėstymas → vienas Scenos atnaujinimas su „capture immediately“, kad tai būtų vienas Undo žingsnis → nauji Elementai pažymimi → ekranas priartinamas prie jų. Esami Elementai nekeičiami ir netrinami.
- **Išdėstymas.** Jei pažymėtas vienas frame – Elementai sutalpinami jame (pastumiami į jo vidų ir priskiriami jam). Kitaip visa grupė pastumiama į laisvą vietą dešinėje nuo esamo turinio ribų su paraštėmis. Tuščioje Scenoje – dabartinio vaizdo centre.
- **„Insert again“.** AI atsakymo žinutė saugo validuotą bloką; mygtukas kartoja įterpimo žingsnį su nauju išdėstymu ir naujais id.
- **Recent.** Canvas nerodomas „Recent“ sąraše (kaip Markdown).

## Testing Decisions

- **Geras testas** tikrina išorinį elgesį: ką mato vartotojas, kas įrašoma į failą, kas atsiranda Scenoje. Netikrina vidinių funkcijų pavadinimų, React būsenos ar Excalidraw vidinių laukų, kurių vartotojas nemato.
- **1 seam (pagrindinis): nematomas Electron smoke testas Canvas dokumentui.** Prior art: OpenRouter smoke testas (imituotas `net.fetch` grąžina sintetinį srautinį atsakymą, tikras IPC veikia), turinio smoke testai, nematomo lango harness ir `closeHidden` uždarymas. Scenarijus:
  1. New Canvas iš File meniu atidaro Canvas skirtuką.
  2. Elementai pridedami, Save į laikiną aplanką, skirtukas uždaromas, failas atidaromas iš naujo – Elementų skaičius, tipai, užrašai ir rodyklių ryšiai sutampa.
  3. Uždarymas be Save rodo klausimą; juodraštis išlieka po reader perkrovimo.
  4. Ask AI su imituotu OpenRouter grąžina `excalidraw` bloką – Scenoje atsiranda tikėtini Elementai, jie pažymėti, esami Elementai nepakitę; imituotas serveris patvirtina, kad užklausoje yra Scenos santrauka su pažymėtu Elementu.
  5. Vienas Undo pašalina visus AI Elementus.
  6. Sugadintas AI blokas rodo klaidą, Scena nepakinta.
  7. Mermaid blokas sukuria diagramą.
  8. PNG, SVG ir PDF eksportas sukuria netuščius failus (PNG / PDF parašai, SVG su `<svg`).
  9. Tamsi tema pritaikoma Canvas.
  Testas įtraukiamas į smoke žingsnių sąrašą.
- **2 seam: grynos funkcijos AI atsakymas → Elementai** (`node --test`). Prior art: Markdown sekcijų ir CSV testai. Atvejai: blokas randamas tarp teksto; keli blokai – imamas paskutinis; sugadintas JSON; nežinomas tipas; rodyklė į neegzistuojantį id; rodyklė į esamą Elementą; per daug Elementų; Mermaid klaida; išdėstymas tuščioje Scenoje, šalia turinio ir pažymėtame frame; „Insert again“ duoda naujus id.
- **3 seam: esamas turinio failų testas** papildomas `.excalidraw`: teisingas failas skaitomas; ne JSON ir JSON be `type: "excalidraw"` atmetami; BOM; dydžio riba; atomic save išsaugo turinį.
- **Regresija:** `tsc --noEmit`, build, visas smoke, turinio testai, reader saugumo testas (CSP nepakitęs), dokumentų įrankių testai, esamas OpenRouter smoke (PDF Ask AI veikia po atsiejimo).
- Scenos santrauka atskirai netestuojama – ją dengia 1 seam per imituoto serverio užklausos patikrą.

## Out of Scope

- Lasso įrankis (nėra Excalidraw 0.18.1; laukiame stabilaus leidimo).
- AI keičia ar trina esamus Elementus (v2).
- Ekrano vaizdo siuntimas AI modeliui (v2).
- PNG / SVG su įdėta scena atidarymas kaip Canvas (v2); v1 jie atsidaro kaip paveikslėliai.
- PDF eksportas A4 puslapiais (v2).
- Canvas „Recent“ sąraše ir „Recent“ išplėtimas kitiems tipams.
- Ask AI Markdown dokumentuose (atsiejimas tai paruošia, bet neįjungia).
- Live collaboration, Share nuorodos, Sign in, Excalidraw+.
- Web Embed, Wireframe to code, Draw to shape, excalidraw.com Text to diagram serveris.
- Piešimas ant PDF puslapių.
- UI vertimai (Doko UI tik angliškas).
- Tool calling ar struktūrinės išvesties palaikymas AI tiekėjuose.

## Further Notes

- **Rizika 1 – šriftai ir CSP.** Excalidraw pagal nutylėjimą krauna šriftus iš CDN. 0 fazės prototipas turi patvirtinti, kad lokalūs šriftai veikia per esamą `font-src` be CSP susilpninimo.
- **Rizika 2 – įrankių prieinamumas.** Lasso ir laser yra Excalidraw master šakoje; jų buvimas 0.18.x leidime nepatikrintas. Jei jų nėra – svarstyti `@next` versiją arba atidėti šiuos du įrankius (sprendžia vartotojas).
- **Rizika 3 – bundle dydis.** Pagrindinė Excalidraw dalis ~353 KB gzip, didžiausia lazy dalis ~735 KB gzip; Mermaid sunkus. Visa tai lazy. Faktinį build padidėjimą išmatuoti 0 fazėje.
- **Vite.** Reikia `process.env.IS_PREACT` define, kitaip „process is not defined“.
- **Saugumas.** AI atsakymas ir atidarytas `.excalidraw` failas – nepatikimi duomenys. Validacija prieš įterpimą privaloma; nuorodų (`link`) ir embeddable Elementų iš AI nepriimame.
- **Darbo vieta.** Atskira šaka `feat/canvas` nuo `main` (dabartinė šaka turi daug neišsaugotų pakeitimų), geriausia atskirame worktree.
- **Release** tik per `npm run release`, kai vartotojas paprašo.
