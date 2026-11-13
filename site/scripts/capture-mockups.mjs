// Captures real Doko (Electron) screenshots for the landing page into site/public/mockups/.
// Run from the repo root after `npm run build`:  node site/scripts/capture-mockups.mjs
// Uses a throwaway profile and fictional sample documents in a temp dir; both are removed at the end.
import { _electron as electron, chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { electronPath } from "../../scripts/electron-path.mjs";
import { readerPage } from "../../scripts/reader-page.mjs";
import { closeHidden } from "../../scripts/hidden-window.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const photoSource = path.join(root, "site/public/photos");
const out = path.join(root, "site/public/mockups");
const temp = mkdtempSync(path.join(tmpdir(), "doko-mockups-"));
mkdirSync(out, { recursive: true });

// ---- Sample documents (all fictional) -------------------------------------------------------------------------
const docs = path.join(temp, "docs");
const photos = path.join(temp, "Coastal Photos");
mkdirSync(docs); mkdirSync(photos);
for (const name of readdirSync(photoSource)) if (name.endsWith(".jpg")) copyFileSync(path.join(photoSource, name), path.join(photos, name));
copyFileSync(path.join(photoSource, "lighthouse.jpg"), path.join(docs, "lighthouse.jpg"));
copyFileSync(path.join(photoSource, "coast-sunset.jpg"), path.join(docs, "coast-sunset.jpg"));

const pdfPath = path.join(docs, "Coastal Field Guide 2026.pdf");
const html = `<!doctype html><meta charset="utf-8"><style>
@page{size:A4;margin:0}
*{box-sizing:border-box}body{margin:0;font:11pt/1.55 Georgia,"Times New Roman",serif;color:#1b2b2a}
.page{width:210mm;height:297mm;padding:22mm 20mm;page-break-after:always;position:relative;overflow:hidden}
.page:last-child{page-break-after:auto}
.kicker{font:600 8.5pt/1 "Helvetica Neue",Arial,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#1f6f6b}
h1{font:300 40pt/1.02 "Helvetica Neue",Arial,sans-serif;letter-spacing:-.02em;margin:10pt 0 12pt}
h1 b{font-weight:800}
h2{font:700 17pt/1.2 "Helvetica Neue",Arial,sans-serif;margin:18pt 0 6pt;color:#12403f}
p{margin:0 0 9pt}.lead{font-size:13pt;line-height:1.5;color:#33504e}
.hero{width:100%;height:92mm;object-fit:cover;border-radius:4mm;margin:8pt 0 14pt}
.cols{display:flex;gap:9mm}.cols>div{flex:1}
.fig{width:100%;height:70mm;object-fit:cover;border-radius:3mm}
.cap{font:italic 8.5pt/1.4 Georgia,serif;color:#5a706e;margin-top:4pt}
table{width:100%;border-collapse:collapse;font:10pt/1.4 "Helvetica Neue",Arial,sans-serif;margin-top:6pt}
th{text-align:left;background:#e3efec;color:#12403f;padding:6pt 8pt}td{padding:6pt 8pt;border-bottom:1px solid #d5e3e0}
.foot{position:absolute;left:20mm;right:20mm;bottom:12mm;font:8pt "Helvetica Neue",Arial,sans-serif;color:#6b7f7d;display:flex;justify-content:space-between}
</style>
<section class="page">
<div class="kicker">Saltmere Outfitters · Season 2026</div>
<h1>Coastal<br><b>Field Guide</b></h1>
<p class="lead">A pocket companion for the cliffs, harbours and tidal paths of the northern shore, written for slow walks and early light.</p>
<img class="hero" src="coast-sunset.jpg">
<div class="cols"><div>
<h2>Why walk the shore</h2>
<p>The northern coast changes every hour. Tides uncover rock pools at dawn, seabirds crowd the ledges by midday, and the harbour lights come on before the sun is fully down.</p>
<p>This guide gathers the routes we return to each year, with notes on timing, footing and the quiet places worth a longer stop.</p>
</div><div>
<h2>Before you set out</h2>
<p>Check the tide table first. Most of our routes are safe on a falling tide and awkward on a rising one. Carry water, a light shell and a paper map.</p>
<p>Leave nesting ledges undisturbed and keep dogs on a lead between April and July.</p>
</div></div>
<div class="foot"><span>Saltmere Outfitters</span><span>1</span></div>
</section>
<section class="page">
<div class="kicker">Routes at a glance</div>
<h1 style="font-size:28pt">Five walks, <b>one shoreline</b></h1>
<table><tr><th>Route</th><th>Distance</th><th>Best time</th><th>Effort</th></tr>
<tr><td>Harbour to Lighthouse</td><td>4.2 km</td><td>Early morning</td><td>Easy</td></tr>
<tr><td>Cliff Ledge Loop</td><td>7.8 km</td><td>Late spring</td><td>Moderate</td></tr>
<tr><td>Thrift Meadow Path</td><td>3.1 km</td><td>May to June</td><td>Easy</td></tr>
<tr><td>Forest to Cove</td><td>9.5 km</td><td>Autumn</td><td>Moderate</td></tr>
<tr><td>Sunset Headland</td><td>5.6 km</td><td>Golden hour</td><td>Easy</td></tr></table>
<div class="cols" style="margin-top:16pt"><div>
<img class="fig" src="lighthouse.jpg"><div class="cap">The lighthouse at the end of the harbour wall.</div>
</div><div>
<h2>Packing list</h2>
<p>Waterproof shell, grippy boots, a thermos, binoculars for the kittiwake colony and a small notebook for what you see.</p>
<h2>Leave no trace</h2>
<p>Take every wrapper home, stay on marked paths across the thrift meadows, and give wildlife space. The shore will look the same next year because of it.</p>
</div></div>
<h2>Our promise</h2>
<p>Every route in this guide was walked twice by our team this season, once in good weather and once in bad, so the notes you read are the ones you can rely on.</p>
<div class="foot"><span>Saltmere Outfitters</span><span>2</span></div>
</section>`;
writeFileSync(path.join(docs, "guide.html"), html);
copyFileSync(path.join(photoSource, "coast-sunset.jpg"), path.join(docs, "coast-sunset.jpg"));

const mdPath = path.join(docs, "launch-checklist.md");
writeFileSync(mdPath, `# Launch checklist

A short list for the **Saltmere** spring release. Everything below is \`ready\` or on its way, and each item names its owner.

> Ship the small, careful version first. The rest can follow next week.

## Before launch

- **Done:** final copy approved
- **Done:** photos exported and compressed
- **Done:** tide-table widget tested on mobile
- **Tuesday 08:00:** newsletter goes out (Ona)
- **Monday:** press kit uploaded (Jonas)
- **Tuesday:** final QA pass (Rūta)

## Release command

Run \`npm run release -- --dry-run\` once more, then publish.

\`\`\`bash
npm run build
npm run release
\`\`\`
`);

// ---- Launch the real app ---------------------------------------------------------------------------------------
const env = { ...process.env, FOLIO_TEST_USER_DATA: path.join(temp, "profile"), FOLIO_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
let app;
// Writes <name>-2880.jpg (2x) and <name>-1440.jpg (1x), the sizes the landing page's srcset uses.
const jpg = (png, name) => {
  const base = name.replace(/\.jpg$/, "");
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "74", png, "--out", path.join(out, `${base}-2880.jpg`)], { stdio: "ignore" });
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", "--resampleWidth", "1440", png, "--out", path.join(out, `${base}-1440.jpg`)], { stdio: "ignore" });
  rmSync(png);
  console.log("wrote", path.join("site/public/mockups", `${base}-{1440,2880}.jpg`));
};
try {
  // Render the PDF from HTML with Chromium.
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    await p.goto("file://" + path.join(docs, "guide.html"));
    await p.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
  } finally { await browser.close(); }

  app = await electron.launch({ executablePath: electronPath(env), env, timeout: 60_000,
    args: [root, "--mute-audio", ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
  const window = await app.firstWindow();
  const page = readerPage(window);
  await page.getByRole("button", { name: /Try a sample/ }).waitFor({ timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1440, 900); });
  await window.waitForTimeout(500);
  const setTheme = async name => {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
    await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor();
    await page.getByRole("radio", { name, exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" });
    await window.waitForTimeout(500);
  };
  const open = file => app.evaluate(({ app }, file) => app.emit("open-file", { preventDefault() {} }, file), file);
  const shot = async name => {
    await window.mouse.move(1425, 450);
    await window.waitForTimeout(700);
    const png = path.join(temp, name.replace(/\.jpg$/, ".png"));
    await window.screenshot({ path: png });
    jpg(png, name);
  };

  // PDF with highlights + Notes sidebar.
  await open(pdfPath);
  await page.locator(".textLayer span:not(.markedContent)").first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll(".page .textLayer span").length > 20);
  await window.waitForTimeout(1500);
  const colors = ["Highlight yellow", "Highlight green", "Highlight pink"];
  const targets = ["pools", "Carry", "nesting"];
  for (const [i, target] of targets.entries()) {
    const line = page.locator(".page .textLayer span").filter({ hasText: target }).first();
    await line.scrollIntoViewIfNeeded();
    const box = await line.boundingBox();
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.getByRole("dialog", { name: "Selected text", exact: true }).waitFor();
    await page.getByRole("button", { name: colors[i], exact: true }).click();
    await page.getByRole("dialog", { name: "Selected text", exact: true }).waitFor({ state: "hidden" });
  }
  await page.getByRole("tab", { name: /Notes/ }).click().catch(async () => {
    await page.getByRole("button", { name: /Toggle sidebar/ }).click();
    await page.getByRole("tab", { name: /Notes/ }).click();
  });
  await setTheme("Light");
  const notes = ["Best at low tide", "Pack for the weather", "Seasonal rule: April to July"];
  const fields = page.locator('[placeholder="Add a note…"]');
  for (const [i, note] of notes.entries()) { await fields.nth(i).fill(note); await fields.nth(i).blur(); }
  await page.evaluate(() => {
    document.getSelection().removeAllRanges();
    const span = [...document.querySelectorAll(".page .textLayer span")].find(s => s.textContent.includes("pools"));
    span.scrollIntoView({ block: "start" });
    document.querySelector(".viewer-container").scrollBy(0, -330);
  });
  await shot("pdf-highlights.jpg");
  await setTheme("Dark");
  await shot("pdf-dark.jpg");
  await setTheme("Light");

  // Photo folder.
  await open(path.join(photos, "coast-sunset.jpg"));
  await page.getByRole("button", { name: "View coast-sunset.jpg", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".photo-status") && document.querySelector(".page canvas")?.width > 0);
  // The OCR status pill ("No readable text found") stays on photos; it is not a feature of the view, so hide it.
  await page.evaluate(() => { const style = document.createElement("style"); style.textContent = ".page-text-status{display:none!important}"; document.head.append(style); });
  await shot("photos.jpg");

  // Markdown.
  await open(mdPath);
  await page.getByLabel("Markdown preview", { exact: true }).waitFor();
  await shot("markdown.jpg");
} catch (error) {
  console.error(error);
  if (app) await window_debug(app).catch(() => {});
  process.exitCode = 1;
} finally {
  if (app) await closeHidden(app).catch(() => {});
  rmSync(temp, { recursive: true, force: true });
}
async function window_debug() {}
