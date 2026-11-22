import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMarkdownChanges, locateMarkdownEdits, markdownReplyDescription, MAX_MARKDOWN_REPLY, parseMarkdownReply } from "../src/markdownAiEdits.ts";

const block = (find, replace, fence = "```") => `${fence}doko-edit\n<<<<<<< FIND\n${find}\n=======\n${replace}\n>>>>>>> REPLACE\n${fence}`;
const changes = (text, reply) => locateMarkdownEdits(text, parseMarkdownReply(reply).edits);

test("parse one edit, preserving whitespace and the surrounding response", () => {
  const reply = "Updated the note.\n\n" + block("  Old\n\n", " New\n");
  const { description, edits } = parseMarkdownReply(reply);
  assert.equal(description, "Updated the note.");
  assert.deepEqual(edits, [{ find: "  Old\n\n", replace: " New\n" }]);
  const text = "# Note\n\n  Old\n\nEnd";
  assert.equal(applyMarkdownChanges(text, changes(text, reply)), "# Note\n\n New\nEnd");
});

test("apply multiple edits together in document order", () => {
  const text = "first\nsecond\nthird";
  const reply = [block("third", ""), block("first", "opening")].join("\n");
  assert.equal(applyMarkdownChanges(text, changes(text, reply)), "opening\nsecond\n");
});

test("reject missing, duplicate, and overlapping occurrences of FIND", () => {
  assert.throws(() => changes("abc", block("missing", "new")), /not found/);
  assert.throws(() => changes("abc abc", block("abc", "new")), /more than once/);
  assert.throws(() => changes("aaa", block("aa", "new")), /more than once/);
  assert.throws(() => changes("abcd", [block("abc", "new"), block("cd", "")].join("\n")), /overlap/);
});

test("append at the end, allow adjoining edits, and reject multiple appends", () => {
  const text = "First";
  const reply = block("", "\nSecond") + "\n" + block("First", "Opening");
  assert.equal(applyMarkdownChanges(text, changes(text, reply)), "Opening\nSecond");
  assert.equal(applyMarkdownChanges("", changes("", block("", "Start"))), "Start");
  assert.throws(() => changes(text, block("", "a") + "\n" + block("", "b")), /overlap/);
});

test("malformed blocks invalidate the entire reply", () => {
  const valid = block("old", "new");
  for (const malformed of [valid.slice(0, -2), valid.replace("=======", "=="), valid.replace("doko-edit", "doko-edit extra"), valid.replace("new", "a\0b"),
    valid.replace("new", "=======\nb"), block("old", "old")]) {
    assert.throws(() => parseMarkdownReply(valid + "\n" + malformed), /incomplete|invalid format|no change/);
  }
});

test("streaming hides partial and complete edit blocks and retains ordinary examples", () => {
  const edit = block("old", "new");
  for (let i = 1; i <= edit.length; i++) {
    assert.equal(markdownReplyDescription("Updating.\n" + edit.slice(0, i)), "Updating.");
  }
  const example = "````markdown\n" + edit + "\n````";
  assert.deepEqual(parseMarkdownReply(example), { description: example, edits: [] });
  const replacement = "```js\nconst n = 2;\n```";
  assert.equal(parseMarkdownReply(block("old", replacement, "````")).edits[0].replace, replacement);
});

test("bound the size of a reply and blocks and cap the number of edits", () => {
  assert.throws(() => parseMarkdownReply("x".repeat(MAX_MARKDOWN_REPLY + 1)), /reply is too large/);
  assert.throws(() => parseMarkdownReply(block("old", "x".repeat(16_001))), /too large/);
  assert.throws(() => parseMarkdownReply(block("old", "line\n".repeat(250))), /too many lines/);
  assert.throws(() => parseMarkdownReply(Array(13).fill(block("old", "new")).join("\n")), /too numerous/);
});
