# 05: Canvas eksportas į PNG, SVG ir PDF

**What to build:** Per Doko Export / Convert vartotojas eksportuoja visą Canvas arba tik pažymėtus Elementus į PNG, SVG arba PDF, pasirinkdamas foną, tamsų režimą ir paraštę. PDF yra vienas puslapis pagal turinio dydį (sukuriamas esamu `pdf-lib`).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Export / Convert dialogas Canvas dokumentui siūlo PNG, SVG, PDF ir parinktis: tik pažymėti Elementai, fonas, tamsus režimas, paraštė
- [ ] PNG prasideda PNG parašu, SVG turi `<svg`, PDF turi vieną puslapį, kurio dydis atitinka turinio ribas su paraštėmis
- [ ] Tamsus režimas eksporte nekeičia spalvų Scenoje
- [ ] `smoke-canvas` papildytas: visų trijų formatų eksportas į laikiną aplanką ir parašų patikra
- [ ] `npm run test:document-tools` praeina
- [ ] `npx tsc --noEmit`, `npm run build`, `npm run smoke` praeina
