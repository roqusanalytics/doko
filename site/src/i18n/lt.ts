// Lithuanian copy. Same shape as en.ts; the check at the bottom fails `astro build` if a key or list item is missing.
import { en, type Copy } from "./en";

export const lt: Copy = {
  lang: "lt",
  url: "https://doko.lt/lt/",
  meta: {
    title: "Doko: nemokama PDF skaityklė, Markdown ir nuotraukų peržiūra",
    description: "Nemokama vietinė PDF skaityklė Mac, Windows ir Linux be reklamų. Žymėkite ir pasirašykite PDF, klauskite DI, rašykite Markdown, žiūrėkite nuotraukas.",
    ogTitle: "Doko: nemokama PDF skaityklė, Markdown ir nuotraukų peržiūra",
    ogDescription: "Viena nemokama programa PDF, Markdown ir nuotraukoms Mac, Windows ir Linux. Be paskyros. Failai lieka jūsų kompiuteryje.",
    ogImageAlt: "Doko langas su atidarytu PDF ir antrašte „PDFs, photos and Markdown. One reader.“",
    ogLocale: "lt_LT",
  },
  nav: { home: "Doko pradžia", features: "Funkcijos", compare: "Palyginimas", faq: "DUK", download: "Atsisiųsti", language: "Kalba" },
  hero: {
    lines: ["Dokumentai, nuotraukos", "ir lentelės"],
    bold: "Viena skaityklė",
    lede: "Nemokama vietinė PDF skaityklė, Markdown redaktorius ir nuotraukų peržiūra Mac, Windows ir Linux. Be reklamų, be mokamų priedų, be paskyros.",
    get: "Atsisiųsti Doko",
    getMac: "Atsisiųsti Mac versiją",
    getWin: "Atsisiųsti Windows versiją",
    source: "Vieši leidimai",
    formats: "Doko atidaro PDF, Word dokumentus, tinklalapius, Markdown, teksto ir CSV failus bei JPG, PNG, WebP, GIF ir AVIF nuotraukas.",
    photos: "Nuotraukos",
    filesLabel: "Atidaryti failai",
    shots: {
      pdf: "Doko su atidarytu PDF gidu, trimis pažymėjimais ir jų pastabomis šoninėje juostoje",
      photo: "Doko naršo pakrantės nuotraukų aplanką su miniatiūrų juosta",
      md: "Doko rodo Markdown paleidimo kontrolinį sąrašą peržiūros režimu",
    },
  },
  ai: {
    h2: ["Klauskite DI", "su savo planu"],
    p: "Doko veikia su ChatGPT per jūsų ChatGPT planą, su Claude per jūsų Claude Code arba su bet kuriuo OpenRouter modeliu. Atsakymai nurodo puslapį, iš kurio paimta informacija, ir niekas neišsiunčiama, kol nepaklausiate.",
    flowLabel: "Jūsų PDF, pažymėta ištrauka ir klausimas per Doko keliauja į ChatGPT, Claude arba OpenRouter, o atsakymas grįžta su nuorodomis į puslapius.",
    inputs: ["Ataskaita.pdf", "Pažymėta dalis", "Jūsų klausimas"],
    inputsShort: ["PDF", "Tekstas", "Klausti"],
    q: "Kas pasikeitė nuo praėjusio pavasario?",
    a: "Lizdų padaugėjo 18 %, daugiausia ant šiaurinių uolų.",
    cite: "3 psl.",
  },
  bento: {
    h2: ["Skaitykite, žymėkite,", "užbaikite"],
    p: "Viskas, ko reikia dokumentui perskaityti, pažymėti ir pasirašyti, viename ramiame lange.",
    sheet: {
      title: "Pavasario stebėjimas",
      p1: ["Lizdų padaugėjo 18 %", ", palyginti su praėjusiais metais, daugiausia ant šiaurinių uolų."],
      p2: ["Kolonija ant rytinės atbrailos nepakito. ", "Naujos poros atskrido dviem savaitėmis anksčiau", " nei įprastai."],
      p3: "Uosto stoties orų duomenys pridėti 4 puslapyje.",
    },
    pin: ["Pastaba", "Palyginti su 2023 m. duomenimis."],
    hl: ["Žymėkite ir rašykite pastabas", "Penkios spalvos, pastabos prie bet kurios ištraukos, rašiklis ir teksto laukai. Viskas išsaugoma automatiškai."],
    ask: "Ask AI",
    ai: ["Klauskite DI", "ChatGPT, Claude arba OpenRouter. Atsakymai nurodo puslapį, iš kurio paimta informacija."],
    mdMini: { title: "Išvyka", items: ["Valtis", "Kamera", "Potvyniai"] },
    md: ["Rašykite Markdown", "Redaguokite ir peržiūrėkite. Išsaugoma tiesiai į originalų failą."],
    sign: ["Pasirašykite dokumentus", "Nufotografuokite savo parašą ir padėkite jį puslapyje."],
    pages: ["Tvarkykite puslapius", "Keiskite tvarką, sukite, trinkite. Uždenkite turinį ar apsaugokite kopiją slaptažodžiu."],
    photoAlts: ["Jūros uolos saulėlydžio metu", "Žvejų uostas auštant", "Švyturys žaliame kyšulyje", "Tripirščiai kirai, perintys ant uolos atbrailos", "Rūke paskendęs miško takas prie jūros", "Pajūrinės armerijos žiedai virš kranto"],
    photo: ["Naršykite nuotraukų aplankus", "Atidarykite vieną nuotrauką ir slinkite per visą aplanką. Apkirpkite, keiskite dydį, koreguokite."],
    local: {
      say: ["Be paskyros,", "dokumentai ir pastabos lieka jūsų kompiuteryje"],
      label: "Jūsų failai atsidaro Doko, o pastabos išsaugomos tame pačiame kompiuteryje.",
      computer: "Šis kompiuteris",
      files: "Jūsų failai",
      notes: "Pastabos",
    },
  },
  kinetic: {
    label: "Kodėl Doko",
    statement: [
      "Doko", "atidaro", "jūsų", { icon: "pdf" }, "ataskaitas,", { photo: "kittiwakes" }, "nuotraukas", "ir", { icon: "md" }, "užrašus",
      "be", "reklamų,", "be", "bandomųjų", "versijų", "ir", "be", "mokamų", "planų.", "Tik", "darbas.",
    ],
  },
  compare: {
    h2: ["Tik įrankiai,", "nieko nepiršame"],
    p: "Be reklamų, bandomųjų versijų, raginimų pirkti ir paskyros. Visos funkcijos jau įtrauktos: atidarote dokumentą ir dirbate.",
    promises: ["Be reklamų", "Be raginimų pirkti", "Be paskyros", "Be telemetrijos"],
    caption: "Doko kaip Adobe Acrobat alternatyva: palyginimas",
    head: ["Funkcija", "Doko", "Adobe Acrobat"],
    rows: [
      ["Kaina", "Nemokama, MIT licencija", "Reader nemokama; Acrobat Pro kainuoja US$19.99/mėn."],
      ["PDF teksto ir vaizdų redagavimas", "Įtraukta", "Acrobat Pro"],
      ["Puslapių tvarkymas", "Įtraukta", "Acrobat Pro"],
      ["Turinio uždengimas", "Įtraukta", "Acrobat Pro"],
      ["PDF apsauga slaptažodžiu", "Įtraukta", "Acrobat Pro"],
      ["DI atsakymai su nuorodomis į puslapius", "Įtraukta, su jūsų ChatGPT ar Claude planu", "AI Assistant priedas, US$4.99/mėn."],
    ],
    source: ["Adobe kainos ir planų funkcijos iš ", "adobe.com", " (JAV, mokant kas mėnesį), tikrinta 2026 m. lapkritį. Adobe ir Acrobat yra Adobe Inc. prekių ženklai."],
  },
  details: {
    h2: ["Pilnavertė PDF skaityklė", "ir dar daugiau"],
    p: "Doko vienoje nemokamoje programoje sujungia PDF skaityklę, Markdown redaktorių ir nuotraukų peržiūrą.",
    items: [
      ["PDF skaityklė ir žymėjimas", "Ištisinis slinkimas, paieška rašant, turinys, miniatiūros, dviejų puslapių rodinys ir susitelkimo režimas. Žymėkite penkiomis spalvomis, rašykite pastabas, pieškite ir kurkite teksto laukus. Žymos išsaugomos automatiškai ir eksportuojamos per „Save a copy“."],
      ["Kalbėkitės su savo PDF", "Ask AI atsako į klausimus apie visą dokumentą ar pažymėtą ištrauką ir pateikia spustelimas nuorodas į puslapius. Naudokite savo ChatGPT planą, Claude per Claude Code arba OpenRouter raktą."],
      ["PDF pasirašymas ir redagavimas", "Pridėkite ranka rašytą parašą iš nuotraukos, redaguokite esamą tekstą ir vaizdus, tvarkykite puslapius, uždenkite turinį ir išsaugokite AES-256 šifravimu apsaugotą kopiją. Žymėkite tekstą skenuotuose PDF su integruotu OCR, palaikančiu daug kalbų."],
      ["Markdown ir teksto redaktorius", "Atidarykite .md failus, rašykite ir peržiūrėkite arba redaguokite paprastus .txt failus: koduotė ir eilučių pabaigos išlieka. Išsaugant rašoma į originalų failą, o jei Markdown failas pakeistas kitur, Doko parodo konfliktą ir nieko neperrašo."],
      ["Nuotraukų peržiūra", "Atidarykite vieną JPG, PNG, WebP, GIF, BMP ar AVIF failą ir naršykite visas to aplanko nuotraukas. Apkirpkite, keiskite dydį, sukite, reguliuokite ryškumą, kontrastą ir sodrumą. SVG failai atidaromi kaip paveikslėlis, o jų XML kodą galima redaguoti."],
      ["Lentelės, Word failai ir tinklalapiai", "Redaguokite CSV failus kaip lentelę arba kaip tekstą: išsaugant keičiama tik tai, ką redagavote. Skaitykite Excel knygas po lapą ir peržiūrėkite HTML failus. Atidarykite Word dokumentus kaip PDF arba paverskite tinklalapį PDF failu, kurį galima žymėti."],
    ],
  },
  faq: {
    h2: ["Klausimai ir", "atsakymai"],
    items: [
      { q: "Ar Doko nemokama?", a: "Taip. Doko yra nemokamai platinama PDF skaitymo programa pagal MIT licenciją. Nėra mokamos versijos, prenumeratos ar paskyros." },
      { q: "Ar Doko rodo reklamas ar raginimus pirkti?", a: "Ne. Doko neturi reklamų, bandomųjų versijų, mokamos versijos ir raginimų pirkti. Visos funkcijos prieinamos visiems." },
      { q: "Ar Doko veikia be interneto?", a: "Taip. Skaitymas, žymėjimas, pasirašymas, Markdown redagavimas ir nuotraukų peržiūra veikia be interneto ryšio. Doko jungiasi prie interneto tik tikrindama atnaujinimus, atsisiųsdama jūsų pasirinktas skenavimo kalbas, atidarydama jūsų pateiktą nuorodą arba atsakydama į Ask AI klausimą." },
      { q: "Ar Doko įkelia mano dokumentus į internetą?", a: "Ne. Doko neturi analitikos ar telemetrijos ir niekada savaime neįkelia dokumentų. Tik kai užduodate klausimą DI, dokumento tekstas, pažymėta ištrauka ir pokalbis siunčiami jūsų pasirinktam teikėjui." },
      { q: "Kokius failus atidaro Doko?", a: "PDF failus, Word dokumentus (.docx ir .doc), Markdown failus (.md ir .markdown), teksto failus (.txt), CSV lenteles ir paveikslėlius (JPG, PNG, WebP, GIF, BMP, AVIF ir SVG). Excel knygos (.xlsx) ir HTML failai atidaromi tik skaitymui. Tinklalapiai pagal nuorodą atidaromi kaip PDF." },
      { q: "Kokiose sistemose veikia Doko?", a: "Windows 10 ir 11 (64 bitų), macOS 12 ar naujesnėje su Apple silicon ir Intel procesoriais bei 64 bitų Linux kaip .deb paketas arba AppImage." },
      { q: "Ar Doko yra Adobe Acrobat alternatyva?", a: "Taip, daugumai darbų su dokumentais, ir ji gali pakeisti Acrobat Reader ar macOS Preview. Acrobat Reader nemokamai leidžia peržiūrėti, spausdinti, bendrinti ir komentuoti, o teksto redagavimui, puslapių tvarkymui, turinio uždengimui ir apsaugai slaptažodžiu reikia Acrobat Pro (US$19.99/mėn. adobe.com). Doko visa tai daro nemokamai, be reklamų ir raginimų pirkti, be to, atidaro Markdown failus ir nuotraukų aplankus." },
      { q: "Kaip paklausti DI apie PDF?", a: "Atidarykite Ask AI skydelį, pasirinkite ChatGPT, Claude arba OpenRouter ir klauskite apie visą dokumentą ar pažymėtą ištrauką. Atsakymas rodomas iškart, kai tik generuojamas, su nuorodomis į puslapius, kurios nuveda prie šaltinio." },
    ],
  },
  download: {
    h2: ["Atsisiųskite", "Doko"],
    mac: ["Atsisiųsti .dmg", "12 ar naujesnė, Apple silicon ir Intel"],
    win: ["Atsisiųsti .exe", "10 ir 11, 64 bitų"],
    linux: ["Visi failai", ".deb ir AppImage"],
    firstRun: "Pirmą kartą paleidžiant: Mac kompiuteryje atidarykite <b>System Settings → Privacy &amp; Security</b> ir pasirinkite <b>Open Anyway</b>. Windows sistemoje pasirinkite <b>More info → Run anyway</b>.",
  },
  footer: {
    about: "Nemokama vietinė PDF skaityklė, Markdown redaktorius ir nuotraukų peržiūra Windows, macOS ir Linux sistemoms.",
    trademarks: "Apple, macOS, Windows, Word, Adobe, Acrobat, ChatGPT, OpenAI, Claude, OpenRouter ir Linux yra atitinkamų savininkų prekių ženklai, nurodyti tik suderinamumui parodyti. Doko nėra su jais susijusi ir jų neremiama.",
    privacy: "Privatumas",
    changelog: "Pakeitimų žurnalas",
    license: "Licencija",
  },
  software: {
    description: "Doko yra nemokama vietinė PDF skaityklė, Markdown redaktorius ir nuotraukų peržiūra Windows, macOS ir Linux sistemoms. Ji leidžia žymėti, komentuoti ir pasirašyti PDF, su DI atsako į klausimus apie dokumentus, o failai lieka jūsų kompiuteryje.",
    featureList: [
      "PDF skaityklė su paieška, turiniu ir miniatiūromis",
      "Žymėjimas, pastabos, piešimas ir teksto laukai",
      "DI atsakymai apie PDF su nuorodomis į puslapius",
      "Ranka rašyti parašai",
      "PDF teksto, vaizdų ir puslapių redagavimas",
      "PDF kopijų turinio uždengimas ir apsauga slaptažodžiu",
      "OCR skenuotiems PDF",
      "Markdown redaktorius su peržiūra",
      "Nuotraukų aplankų peržiūra su apkirpimu, dydžio keitimu ir koregavimu",
      "Word dokumentų ir tinklalapių atidarymas kaip PDF",
      "TXT, CSV ir SVG failų redagavimas; Excel knygų ir HTML failų peržiūra",
    ],
  },
};

// shortcut: a runtime shape check because the site has no TypeScript compiler in its build; swap for `astro check` if one is added.
// Lists must match in length, except the kinetic statement, whose word count differs by language.
(function same(a: unknown, b: unknown, path: string): void {
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || (path !== "kinetic.statement" && a.length !== b.length)) throw new Error(`lt.ts: ${path} must be a list of ${a.length}`);
    if (path !== "kinetic.statement") a.forEach((x, i) => same(x, b[i], `${path}[${i}]`));
  } else if (a && typeof a === "object") {
    if (!b || typeof b !== "object") throw new Error(`lt.ts: ${path} is missing`);
    for (const k of Object.keys(a)) same((a as any)[k], (b as any)[k], path ? `${path}.${k}` : k);
  } else if (typeof a !== typeof b) throw new Error(`lt.ts: ${path} is missing`);
})(en, lt, "");
