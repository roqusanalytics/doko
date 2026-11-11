// The Excel viewer's reader (xlsx-parts.cjs does the work): turns an .xlsx into tables, written as a JSON file.
// It runs in a utility process of its own, like docx-worker.cjs, so a workbook built to exhaust memory or stall the
// parser (a small file can unpack into gigabytes) takes down only this process, not Doko.
const fs = require("node:fs");
const { parseWorkbook } = require("./xlsx-parts.cjs");
const { MAX_HTML_BYTES, readRegular, tooLarge } = require("./document-files.cjs");

// Listening keeps the process alive until the caller has the answer and stops it.
process.parentPort.on("message", async ({ data: { source, output } }) => {
  try {
    const json = JSON.stringify(await parseWorkbook(await readRegular(source)));
    if (Buffer.byteLength(json) > MAX_HTML_BYTES) throw tooLarge(MAX_HTML_BYTES);
    await fs.promises.writeFile(output, json, { flag: "wx", mode: 0o600 });
    process.parentPort.postMessage({});
  } catch (error) {
    process.parentPort.postMessage({ error: String(error?.message || error).slice(0, 2048), userMessage: error?.userMessage });
  }
});
