# 06: Ask AI nupiešia Elementus ant Canvas

**What to build:** Canvas dokumente atidaroma ta pati Ask AI panelė (tie patys tiekėjai, modeliai, istorija). Vartotojas parašo, ką nupiešti; AI gauna tekstinę Scenos santrauką su pažymėtais Elementais ir grąžina trumpą aprašymą bei `excalidraw` kodo bloką (Excalidraw element skeleton JSON masyvas). Doko bloką patikrina, sukuria Elementus ir uždeda juos į pažymėtą frame, o be jo – į laisvą vietą dešinėje nuo turinio (tuščioje Scenoje – vaizdo centre). Nauji Elementai pažymimi ir parodomi ekrane; vienas Undo pašalina visą įterpimą. Esami Elementai nekeičiami. Netinkamas blokas rodo klaidą, Canvas nepakinta.

Kontraktas: imamas paskutinis `excalidraw` blokas; leidžiami tipai `rectangle`, `diamond`, `ellipse`, `arrow`, `line`, `text`, `frame`; rodyklių `start` / `end` gali nurodyti naujo arba esamo Elemento id; nuorodos (`link`) ir embeddable nepriimami; elementų skaičiui taikoma riba. Scenos santrauka: id, tipas, x/y/plotis/aukštis, užrašas, rodyklių galai, frame narystė, pažymėjimas; freedraw ir paveikslėliai – tik vieta ir dydis; dydžio riba su prioritetu pažymėtiems ir žyme „truncated“.

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] Ask AI mygtukas ir panelė veikia Canvas dokumente; main proceso validacija priima `canvas` dokumento tipą
- [ ] Canvas turi savo sistemos prompt (koordinatės, leidžiami tipai, skeleton schema, atsakymo formatas); AI tiekėjai nekeisti
- [ ] Unit testai (`node --test`) AI atsakymas → Elementai: blokas tarp teksto; keli blokai (imamas paskutinis); sugadintas JSON; nežinomas tipas; rodyklė į neegzistuojantį id; rodyklė į esamą Elementą; per daug Elementų; `link` atmetamas; išdėstymas tuščioje Scenoje, šalia turinio ir pažymėtame frame
- [ ] `smoke-canvas` su imituotu OpenRouter (kaip esamas OpenRouter smoke): AI blokas sukuria tikėtinus Elementus; jie pažymėti; esami nepakitę; imituotas serveris patvirtina, kad užklausoje yra Scenos santrauka su pažymėtu Elementu
- [ ] `smoke-canvas`: vienas Undo pašalina visus AI Elementus; sugadintas blokas rodo klaidą ir Scena nepakinta
- [ ] AI atsakymo tekstas be kodo bloko (trumpas aprašymas, ką nupiešė) rodomas pokalbyje; pats JSON blokas vartotojui nerodomas kaip žalias tekstas
- [ ] Atsakymas rodomas srautu; atšaukus užklausą Scena nepakinta; pokalbių istorija Canvas dokumente išsaugoma ir atkuriama kaip PDF dokumente (patikrinta `smoke-canvas`)
- [ ] Unit testas: Scenos santrauka viršija dydžio ribą → pažymėti Elementai lieka, pridedama žymė „truncated“, rezultatas neviršija ribos
- [ ] PDF Ask AI regresija: esamas OpenRouter smoke praeina
- [ ] `npx tsc --noEmit`, `npm run build`, `npm run smoke` praeina
