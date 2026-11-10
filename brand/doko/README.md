# Doko brand kit · patvirtintas variantas 50

Pasirinkto dizaino perdavimas: simbolio forma, individualus užrašas ir tarpai išsaugoti iš didelės raiškos originalo. SVG yra kontūrai, ne teksto pakaitalas.

## Naudoti

- `brandbook.pdf` – 7 puslapių naudojimo vadovas; `brandbook.html` – savarankiška, redaguojama versija su įterptais vaizdais.
- `logos/doko-logo-ink.svg` – pagrindinis logotipas. `white` – tamsiam fonui.
- `logos/doko-mark-*.svg` – atskiras simbolis. `wordmark` – atskiras užrašas.
- PNG logotipų fonas skaidrus. Visas logotipas eksportuotas 2090 px pločio, atskiros dalys – 1024 px pločio.
- `favicon/favicon.svg` – juodas simbolis ant Mint #C5E1CB fono; `favicon.ico` – 16, 24, 32, 48, 64, 128, 256 px.
- `favicon/doko-icon-*.png` – 16–1024 px; `apple-touch-icon.png` – 180 px.
- `tokens.css` ir `brand.json` – spalvos ir metaduomenys. CSS į programą neįtrauktas.

## Integracija ir ribos

Į `public/` nukopijuoti favicon SVG, ICO ir Apple Touch PNG; `index.html` nurodo šiuos failus. Esamos programos temos ir išdėstymas išlaikyti. Antraštėje naudojamas patvirtintas simbolis ir kontūrinis užrašas, prisitaikantys prie šviesios / tamsios temos. `logos/doko-app-icon.svg` – darbalaukio piktograma; iš jos eksportuoti bendri `build/icon.png` ir `electron/icon.png` visoms platformoms. Vietinė `/Applications/Doko.app` atnaujinta.

Spalvos: Ink #1A1A1A, Paper #F7F5F3, Mint #C5E1CB. Pavadinimas tekste „Doko“, logotipe „doko“. Logo šriftas neperkamas ir neatkuriamas kitu šriftu: naudoti SVG kontūrus. Produkto tekstui palikti esamą Inter / OS sans-serif šeimą.

Apsauginė zona – bent ¼ simbolio aukščio. Minimalus visas logotipas 140 px / 30 mm; simbolis 24 px / 6 mm, favicon išimtis 16 px.

## Kilmė ir atkūrimas

`source/selected-concept-50.png` – originali generuota koncepcija; `source/user-selection.png` – vartotojo patvirtinta kryptis. Vektorizuoti tik pagrindinės kompozicijos kontūrai, be fono ir gradientų. Tai rasterinio originalo vektorizavimas, todėl matematiškai identiškas pikselių atkūrimas negarantuojamas: išmatuotas kontūrų ploto IoU **0.99254**. Žr. `validation.json` ir `previews/source-vector.png` (viršuje originalas, apačioje vektorius).

Turint `uv`, atkurti logotipus ir favicon: `uv run brand/doko/tools/build_assets.py` iš projekto šaknies. Scriptas naudoja prisegtas laikinas Python priklausomybes; projekto npm priklausomybių nekeičia. Eksportuodamas atnaujina ir tris `public/` favicon failus. PDF sukurtas iš HTML su Chrome spausdinimu A4.

Prekių ženklų, panašumo į trečiųjų šalių ženklus ir teisių patikra neatlikta. CMYK / Pantone specifikacija neparinkta: spaudai suderinti profilį su spaustuve.

Dock / favicon fonas: #C5E1CB, simbolis #1A1A1A. Pagrindinio logotipo forma ir brandbook Ink / Paper / Mint paletė išsaugota. Mac paleidimas atnaujina Dock ikoną tiesiogiai iš electron/icon.png.

Programos UI akcentas: užpildai #C5E1CB, tekstas ant užpildų #1A1A1A; akcento tekstas ir būsenų indikatoriai šviesioje temoje #305D40, tamsioje #C5E1CB. Akcentas išlaikomas ir pasirinktuose fonuose.
