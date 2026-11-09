import assert from "node:assert/strict";
import { test } from "node:test";
import { localSources } from "../src/content-source.ts";

test("extensionless PDFs with no inferred MIME still reach the PDF parser", async () => {
  globalThis.window = {};
  try {
    const file = new File(["%PDF-1.7\n"], "report", { type: "" });
    const [source] = await localSources([file]);
    assert.equal(source.kind, "blob");
    assert.equal(source.blob, file);
  } finally { delete globalThis.window; }
});
