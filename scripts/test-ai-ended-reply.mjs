// The one rule for what is left of an Ask AI answer once it ends: an answer with no words and no error is dropped,
// so the panel never shows "Thinking" when nothing is running; Markdown edits and drawings also drop partial answers.
import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";

const server = await createServer({ root: path.resolve(import.meta.dirname, ".."), server: { middlewareMode: true }, appType: "custom" });

try {
  globalThis.window ??= globalThis; // AiPanel's imports touch window when they load.
  const { endedReply } = await server.ssrLoadModule("/src/AiPanel.tsx");
  const question = { role: "user", content: "Which city?" };
  const empty = { role: "assistant", content: "" };
  const partial = { role: "assistant", content: "Kau" };
  const failed = { role: "assistant", content: "", error: { message: "Signed out" } };
  const edits = { role: "assistant", content: "", markdownReply: "<edit/>" };

  assert.deepEqual(endedReply([question, empty], false), [question], "an answer with no words is dropped");
  assert.deepEqual(endedReply([question, partial], false), [question, partial], "a plain answer keeps its words so far");
  assert.deepEqual(endedReply([question, failed], false), [question, failed], "an error stays visible");
  assert.deepEqual(endedReply([question, edits], false), [question, edits], "a finished Markdown edit stays");
  assert.deepEqual(endedReply([question, partial], true), [question], "Markdown edits and drawings drop partial answers");
  assert.deepEqual(endedReply([question], true), [question], "a question is never dropped");
  assert.deepEqual(endedReply([], false), []);
  const list = [question, partial];
  assert.equal(endedReply(list, false), list, "an unchanged conversation keeps its identity, so React doesn't re-render");
  console.log("PASS Ask AI ended reply: empty answers dropped, partial kept unless edits or drawings, errors and questions kept");
} finally {
  await server.close();
}
