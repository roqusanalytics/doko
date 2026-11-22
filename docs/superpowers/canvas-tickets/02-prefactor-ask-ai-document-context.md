# 02: Prefactor – Ask AI panelė atsieta nuo PDF

**What to build:** Ask AI panelė nebepriklauso nuo PDF objekto: ji gauna bendrą dokumento kontekstą (dokumento tipas, pavadinimas, tekstas, pasirinkta dalis). Vartotojui niekas nesikeičia – PDF dokumentuose Ask AI veikia lygiai kaip anksčiau. Tai paruošia kelią Canvas (ir vėliau Markdown) dokumentams.

Šaltiniai: `docs/superpowers/specs/2026-11-22-canvas-spec.md` (Implementation Decisions: Ask AI atsiejimas).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Ask AI panelės sąsaja nebeturi PDF objekto parametro; PDF teksto ištraukimas vyksta PDF dokumento pusėje
- [ ] Dokumento kontekstas turi tipą, kurį main proceso užklausos validacija tikrina (kol kas tik PDF tipas)
- [ ] Esamas OpenRouter smoke testas (PDF Ask AI, citatos, atšaukimas) praeina be pakeitimų
- [ ] `test-ai-lifecycle` ir `test-openrouter` praeina
- [ ] `npm run test:document-tools` praeina
- [ ] `npx tsc --noEmit`, `npm run build`, `npm run smoke` praeina
