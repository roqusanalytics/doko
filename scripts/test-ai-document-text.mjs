// Offline checks for AI document text extraction; no PDF or network access is needed.
import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const server = await createServer({ root, server: { middlewareMode: true }, appType: "custom" });
let passed = 0;

try {
  const { readAiDocumentText } = await server.ssrLoadModule("/src/aiDocumentText.ts");
  const check = async (name, test) => {
    await test();
    passed++;
    console.log(`ok  ${name}`);
  };
  const page = (...items) => ({ items: items.map(([str, hasEOL = false]) => ({ str, hasEOL })) });
  const signal = () => new AbortController().signal;

  await check("preserves page order, text, and explicit line endings", async () => {
    const reads = [];
    const { text: result } = await readAiDocumentText(3, async (number) => {
      reads.push(number);
      return [
        page(["embedded heading", true], ["embedded body"]),
        page(["OCR line one", true], ["OCR line two"]),
        page(["last page"]),
      ][number - 1];
    }, signal());
    assert.deepEqual(reads, [1, 2, 3]);
    assert.equal(result, "[Page 1]\nembedded heading\nembedded body\n\n[Page 2]\nOCR line one\nOCR line two\n\n[Page 3]\nlast page\n\n");
  });

  await check("skips blank and non-text items while retaining page labels", async () => {
    const { text: result } = await readAiDocumentText(3, async (number) => [
      page(["", true], ["   "]),
      { items: [{ str: "visible", hasEOL: false }, { transform: [1, 0, 0, 1] }, { str: " text", hasEOL: false }] },
      { items: [] },
    ][number - 1], signal());
    assert.equal(result, "[Page 1]\n\n\n[Page 2]\nvisible  text\n\n[Page 3]\n\n\n");
  });

  await check("a rejected read can be retried with a fresh invocation", async () => {
    let attempts = 0;
    const getPageText = async () => {
      attempts++;
      if (attempts === 1) throw new Error("temporary read failure");
      return page(["recovered"]);
    };
    await assert.rejects(readAiDocumentText(1, getPageText, signal()), /temporary read failure/);
    assert.deepEqual(await readAiDocumentText(1, getPageText, signal()), { text: "[Page 1]\nrecovered\n\n", truncated: false });
    assert.equal(attempts, 2);
  });

  await check("an already aborted signal prevents page reads", async () => {
    const controller = new AbortController();
    controller.abort();
    let reads = 0;
    await assert.rejects(readAiDocumentText(2, async () => { reads++; return page(["unused"]); }, controller.signal));
    assert.equal(reads, 0);
  });

  await check("aborting during a page read stops later reads", async () => {
    const controller = new AbortController();
    const reads = [];
    await assert.rejects(readAiDocumentText(3, async (number) => {
      reads.push(number);
      if (number === 1) controller.abort();
      return page(["page"]);
    }, controller.signal));
    assert.deepEqual(reads, [1]);
  });

  await check("accepts exactly 400000 page characters and stops before reading another page", async () => {
    let reads = 0;
    const payload = "x".repeat(399989);
    const { text: result, truncated } = await readAiDocumentText(2, async () => {
      reads++;
      return page([payload]);
    }, signal());
    assert.equal(reads, 1);
    assert.equal(result, `[Page 1]\n${payload}\n\n`);
    assert.equal(result.length, 400000);
    assert.equal(truncated, true);
    assert.equal(result.includes("[Page 2]"), false);
  });

  await check("truncates only at the whole-page boundary under the 400000 character limit", async () => {
    let reads = 0;
    const { text: result, truncated } = await readAiDocumentText(3, async (number) => {
      reads++;
      return page([number === 1 ? "a".repeat(250000) : "b".repeat(250000)]);
    }, signal());
    assert.equal(reads, 2);
    assert.equal(result, `[Page 1]\n${"a".repeat(250000)}\n\n`);
    assert.ok(result.length <= 400000);
    assert.equal(truncated, true);
  });

  console.log(`Passed ${passed} AI document text checks.`);
} finally {
  await server.close();
}
