import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { readAiDocumentText } from "../src/aiDocumentText.ts";

const source = readFileSync(new URL("../src/OcrFindController.ts", import.meta.url), "utf8");
const body = stripTypeScriptTypes(source.slice(source.indexOf("export class OcrFindController")), { mode: "transform" }).replace("export class", "class");

class Bus {
  listeners = new Map();
  on(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }
  dispatch(name, data) { for (const callback of this.listeners.get(name) ?? []) callback(data); }
}

class Find { state = null; highlightMatches = false; setDocument(pdf) { this.pdf = pdf; } }

const Controller = new Function("EventBus", "PDFFindController", body + ";return OcrFindController;")(Bus, Find);
const bus = new Bus(), reader = new Controller({ eventBus: bus });
let calls = 0, fail = false;

const pdf = { numPages: 150, async getPage(number) { return { pageNumber: number, async getTextContent(options) {
  calls++; assert.equal(options.disableNormalization, true);

  if (fail) throw new Error("Synthetic page failure");

  return { items: [{ str: "oﬃce" }] };
} }; } };

reader.setDocument(pdf);

const nativePage = await reader.controller.pdf.getPage(1);
const values = await Promise.all([reader.getPageText(1), reader.getPageText(1), nativePage.getTextContent()]);

assert.equal(calls, 1, "search, snippet and AI share one actual page read");

assert.equal(values[0], values[2]);

bus.dispatch("findbarclose", {});

assert.equal(await reader.getPageText(1), values[0]);

assert.equal(calls, 1, "closing search retains source text");

fail = true;

 await assert.rejects(reader.getPageText(2), /Synthetic/);

fail = false;

 await reader.getPageText(2);

 assert.equal(calls, 3);

for (let page = 3; page <= 102; page++) await reader.getPageText(page);

await reader.getPageText(1);

 assert.equal(calls, 104, "100-page bound evicts old content");

let ocrCalls = 0;

reader.setTextReader(pdf, async () => { ocrCalls++;

 return { items: [{ str: "OCR language one" }] }; });

const read = n => reader.getPageText(n, pdf);
const ai = await Promise.all([readAiDocumentText(1, read, new AbortController().signal), readAiDocumentText(1, read, new AbortController().signal)]);

assert.equal(ocrCalls, 1);

 assert.equal(ai[0].text, ai[1].text);

 assert.match(ai[0].text, /OCR language one/);

reader.setTextReader(pdf, async () => ({ items: [{ str: "OCR language two" }] }));

assert.match((await readAiDocumentText(1, read, new AbortController().signal)).text, /OCR language two/);

let finish;

reader.setTextReader(pdf, () => new Promise(resolve => { finish = resolve; }));

const old = reader.getPageText(1);

 await Promise.resolve();

reader.setTextReader(pdf, async () => ({ items: [{ str: "new source" }] }));

const fresh = reader.getPageText(1);

finish({ items: [{ str: "old source" }] });

await assert.rejects(old, { name: "AbortError" });

assert.equal((await fresh).items[0].str, "new source");

assert.equal(await reader.getPageText(1), await fresh, "old rejection cannot evict new source cache");

const canceled = new AbortController();

 canceled.abort();

await assert.rejects(readAiDocumentText(1, read, canceled.signal), { name: "AbortError" });

const other = { ...pdf };

 reader.setDocument(other);

await assert.rejects(reader.getPageText(1, pdf), { name: "AbortError" });

assert.equal((await reader.getPageText(1)).items[0].str, "oﬃce");

console.log("PASS shared native search/snippet/AI page reads: 3 consumers -> 1 read; cache survives search close, retries failures, bounds 100 pages, preserves ligatures and OCR, invalidates language/document and protects new source from late results");
