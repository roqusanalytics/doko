# Patikra · 2026-11-10

- PASS – vektorių kontūrų ploto sutapimas su patvirtintu originalu 99,254 % (1045 × 311); pasirinktas užrašas ir trys simbolio dalys išsaugoti.
- PASS – 16, 24, 32, 48, 64 ir 128 px rastriniuose favicon išlieka trys atskiros tamsios dalys (tikrinta su 4 kaimynų komponentų skaičiavimu).
- PASS – ICO sluoksniai 16/24/32/48/64/128/256; Chrome dekoduoja ICO (256 × 256).
- PASS – 7 A4 PDF puslapiai, nėra perpildymo ar nukirpto turinio; puslapiai vizualiai peržiūrėti. HTML: 20 vaizdų, 0 neveikiančių; 390 px ekrane horizontalios slinkties nėra.
- PASS – npm run build (įskaitant TypeScript).
- PASS – sukompiliuoto index.html SVG ir Apple Touch nuorodos išsprendžiamos, atvaizdai dekoduojami Chrome, perimant tinklo užklausas tiesiogiai iš dist/. ICO patikrintas atskirai kaip failas ir Chrome image decode; natūralus naršyklės skirtuko rodymas netikrintas.
- PASS – dvi nepriklausomos peržiūros ir atskiras vertintojas; apsauginės zonos schema, kontrasto apvalinimas ir favicon palyginimo išdėstymas sutvarkyti. Privalomų radinių neliko.
- PASS – nepriklausomas kritikas atkūrė generatoriaus išvestis laikinoje kopijoje ir patvirtino SVG/PNG/ICO baitų tapatumą.

Ribos: nebuvo diegta ar publikuota. Visas npm run smoke macOS aplinkoje praėjo (exit 0); Windows/Linux CI šiame etape nevykdyti. Prekių ženklų / teisių ir spaudos spalvų patikra neatlikta. Koncepcijos vektorizavimas nėra pikseliškai identiškas originaliam rastrui.

## Pritaikymo patikra

- PASS – bibliotekos, PDF ir Markdown antraštė, šviesi / tamsi temos; abi SVG kaukės dekoduojamos Electron.
- PASS – npm run build:local ir įdiegtos /Applications/Doko.app codesign patikra.
- PASS – įdiegtas icon.icns dekoduojamas į 1024 × 1024 PNG, kurio pikseliai identiški build/icon.png.
- PASS – įdiegta aplikacija paleista iš naujo, nauja antraštė vizualiai patvirtinta per native computer use.
- LIMIT – faktinio Dock vaizdo nuskaitymas nepavyko (native Dock API timeout); tikrintas įdiegtas piktogramos failas.
- PASS – papildomos dvi nepriklausomos integracijos peržiūros ir atskiras vertintojas: radinių nėra.

## Koralinė piktograma

PASS – #E5533D fonas ir baltas nepakeisto kontūro simbolis. Atnaujinti favicon ir desktop PNG ištekliai bei vietinė Doko.app; įdiegto ICNS pikseliai sutampa su build/icon.png. npm run build:local ir node scripts/smoke-updates.mjs – exit 0. Mac paleidimas tiesiogiai nustato Dock ikoną, paslėpti testai šį veiksmą praleidžia. Tikro Dock vaizdo užfiksuoti nepavyko (automatiškai slepiamas); Windows/Linux pakavimas nekartotas.

## Mint fonas (galutinis pasirinkimas)

PASS – piktogramos fonas #C5E1CB, simbolis baltas #FFFFFF; kontūrai nepakeisti. Desktop ir favicon eksportai atnaujinti. npm run build:local exit 0, įdiegto paketo codesign PASS; įdiegtas ICNS pikseliais sutampa su nauju PNG. Vietinė Doko.app paleista iš naujo. Ši spalvos pataisa atskirai Windows/Linux nebandyta.

## Mint akcentas produkto UI

PASS – bazinės ir pasirinktinės paletės naudoja Mint #C5E1CB, foreground #1A1A1A, kontrastingą #305D40 light tekstą ir Mint dark tekstą. PDF, Markdown, biblioteka bei galerijų nustatymai išlaikyti. Visas macOS npm run smoke exit0; po galutinių indikatorių pataisų npm run build ir smoke-appearance pakartoti, exit0. Testas dabar tikrina keturių realiai renderintų būsenų indikatorių kontrastą abiejose temose ir trijuose fonuose. Paper/Ocean light/dark aktyvių skirtukų vaizdai patikrinti atskirai. Du kritikai + vertintojas: vienintelis P2 kontrasto radinys ištaisytas ir apsaugotas regresine patikra.

Vietinis build:local exit0; /Applications/Doko.app įdiegta, codesign PASS, paleista, tikras Mint pasirinkimas ir puslapio indikatorius patikrinti native computer use. Windows/Linux CI nebuvo vykdyta.

## Juodas simbolis ant Mint (galutinis)

PASS – simbolis #1A1A1A ant #C5E1CB, kontrastas 12.44:1. Kontūras identiškas patvirtintam Ink simboliui. Desktop PNG ir visi favicon eksportai atnaujinti; baltų užpildo pikselių nebeliko. npm run build:local exit0; įdiegtos Doko.app codesign PASS, ICNS pikseliai tiksliai sutampa su nauju PNG. Vietinė aplikacija paleista iš naujo. Windows/Linux pakavimas nekartotas.
