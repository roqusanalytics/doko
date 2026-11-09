import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";

const server = await createServer({ root: path.resolve(import.meta.dirname, ".."), server: { middlewareMode: true }, appType: "custom" });
try {
  const { markdownSections } = await server.ssrLoadModule("/src/markdownSections.ts");
  assert.deepEqual(markdownSections(""), []);
  assert.deepEqual(markdownSections("ordinary text\n\nno headings"), []);
  const sections = markdownSections([
    "# Overview", "", "## **Details** and [links](https://example.test) `code`", "",
    "Setext title", "---", "", "> ### Nested quote", "", "- #### Nested list", "",
    "```markdown", "# Not a heading", "```", "", "~~~", "## Also code", "~~~", "",
    "    # Indented code", "", "$$", "# Math content", "$$", "", "# Overview", "", "###", "",
    "## <em>HTML</em> ![Image label](local.png)",
  ].join("\n"));
  assert.deepEqual(sections.map(({ title, depth, line }) => ({ title, depth, line })), [
    { title: "Overview", depth: 1, line: 1 },
    { title: "Details and links code", depth: 2, line: 3 },
    { title: "Setext title", depth: 2, line: 5 },
    { title: "Nested quote", depth: 3, line: 8 },
    { title: "Nested list", depth: 4, line: 10 },
    { title: "Overview", depth: 1, line: 26 },
    { title: "Untitled section", depth: 3, line: 28 },
    { title: "HTML Image label", depth: 2, line: 30 },
  ]);
  assert.equal(new Set(sections.map(section => section.id)).size, sections.length);
  assert.deepEqual(markdownSections("# First\r\n\r\nSecond\r\n======").map(({ line, depth }) => ({ line, depth })), [
    { line: 1, depth: 1 }, { line: 3, depth: 1 },
  ]);
  assert.deepEqual(markdownSections("\\[\n# x+y\n\\]\n\n# Actual section\n").map(({ title, line }) => ({ title, line })), [
    { title: "Actual section", line: 5 },
  ]);
  assert.deepEqual(markdownSections("```tex\n\\[\n```\n\n# Outside code\n").map(({ title, line }) => ({ title, line })), [
    { title: "Outside code", line: 5 },
  ]);
  assert.deepEqual(markdownSections("# Before\n\n\\[\n# Pending math").map(({ title, line }) => ({ title, line })), [
    { title: "Before", line: 1 },
  ]);
  assert.deepEqual(markdownSections("\\[x\\]\n\n> ## Quote\n\n- ### List").map(({ title, line }) => ({ title, line })), [
    { title: "Quote", line: 3 }, { title: "List", line: 5 },
  ]);
  console.log("PASS Markdown section parser (nested, Setext, duplicates, code, math and source lines)");
} finally {
  await server.close();
}
