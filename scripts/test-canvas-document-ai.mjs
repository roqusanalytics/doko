import assert from "node:assert/strict";
import { test } from "node:test";
import { drawingLayout, parseDrawingReply, splitDrawingReply } from "../src/canvasDocument/canvasDocumentAiReply.ts";
import { SCENE_SUMMARY_LIMIT, summarizeScene } from "../src/canvasDocument/canvasDocumentSceneSummary.ts";

const block = content => "```excalidraw\n" + content + "\n```";
const reply = (...elements) => block(JSON.stringify(elements));
const rectangle = { type: "rectangle", x: 0, y: 0, width: 100, height: 60 };
const arrow = { type: "arrow", x: 80, y: 30, points: [[0, 0], [90, 0]] };

test("reads the last drawing block and returns only the surrounding text", () => {
  const first = reply(rectangle);
  const second = reply({ ...rectangle, type: "ellipse" });
  const result = parseDrawingReply(`Before\n${first}\nBetween\n${second}\nAfter`, []);
  assert.deepEqual(result, { description: "Before\nBetween\nAfter", elements: [{ ...rectangle, type: "ellipse" }] });
  assert.deepEqual(parseDrawingReply(`Middle follows\n${first}\nDone`, []),
    { description: "Middle follows\nDone", elements: [rectangle] });
});

test("hides drawing JSON during streaming, including a split fence", () => {
  const full = "I drew a box.\n" + reply(rectangle);
  for (let i = "I drew a box.".length; i <= full.length; i++) {
    assert.equal(splitDrawingReply(full.slice(0, i), true).description, "I drew a box.");
  }
  assert.throws(() => parseDrawingReply(full + "\n```excalidraw\n[", []), /complete excalidraw block/);
});

test("rejects malformed, oversized, unsupported, malformed-field, and linked drawings", () => {
  assert.throws(() => parseDrawingReply(block("["), []), /invalid JSON/);
  assert.throws(() => parseDrawingReply(reply({ ...rectangle, type: "embeddable" }), []), /unsupported Element type/);
  assert.throws(() => parseDrawingReply(reply({ ...rectangle, width: undefined }), []), /width and height/);
  assert.throws(() => parseDrawingReply(reply(...Array(81).fill(rectangle)), []), /too many Elements/);
  assert.throws(() => parseDrawingReply(reply({ ...rectangle, link: "https://example.test" }), []), /Links are not allowed/);
  assert.throws(() => parseDrawingReply(reply({ ...rectangle, label: { text: "Hi", link: "https://example.test" } }), []), /Links are not allowed/);
  assert.throws(() => parseDrawingReply(reply({ ...rectangle, isDeleted: true }), []), /unsupported field/);
});

test("checks arrow references and protects existing IDs", () => {
  const connecting = { ...arrow, start: { id: "existing" }, end: { id: "new" } };
  const newElement = { ...rectangle, id: "new" };
  const existing = [{ id: "existing", type: "rectangle" }];
  assert.throws(() => parseDrawingReply(reply(connecting, newElement), []), /missing Element/);
  assert.throws(() => parseDrawingReply(reply({ ...rectangle, id: "existing" }), existing), /repeats/);
  assert.deepEqual(parseDrawingReply(reply(connecting, newElement), existing).elements, [connecting, newElement]);
  const imageAndFrame = [{ id: "existing", type: "image" }];
  const frame = { ...newElement, type: "frame", children: [] };
  assert.deepEqual(parseDrawingReply(reply(connecting, frame), imageAndFrame).elements, [connecting, frame]);
});

test("allows frame children from the same drawing only", () => {
  const frame = { ...rectangle, type: "frame", children: ["node"] };
  assert.throws(() => parseDrawingReply(reply(frame), [{ id: "node", type: "rectangle" }]), /only new Elements/);
  assert.deepEqual(parseDrawingReply(reply(frame, { ...rectangle, id: "node" }), []).elements[0], frame);
});

test("places the drawing at the viewport center, to the right, or inside a frame", () => {
  const drawing = [10, 20, 210, 120];
  assert.deepEqual(drawingLayout(drawing, null, [400, 300], null), { x: 290, y: 230, scale: 1 });
  assert.deepEqual(drawingLayout(drawing, [-700, -200, 400, 100], [0, 0], null), { x: 470, y: -220, scale: 1 });
  const { scale, x, y } = drawingLayout(drawing, [0, 0, 500, 500], [0, 0], [50, 50, 150, 150]);
  assert.ok(scale < 1);
  assert.ok(x + 10 * scale > 50 && x + 210 * scale < 150);
  assert.ok(y + 20 * scale > 50 && y + 120 * scale < 150);
});

test("the Scene summary preserves selected Elements within its cap and omits private drawing data", () => {
  const selected = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`text-${i + 380}`, true]));
  const elements = Array.from({ length: 450 }, (_, i) => ({ ...rectangle, type: "text", id: `text-${i}`, text: "x".repeat(300) }));
  const { text, truncated } = summarizeScene(elements, selected);
  assert.ok(truncated);
  assert.ok(text.length <= SCENE_SUMMARY_LIMIT);
  const rows = text.split("\n");
  assert.equal(rows.pop(), "truncated");
  const ids = rows.map(row => JSON.parse(row)).filter(row => row.selected).map(row => row.id);
  assert.deepEqual(ids, Object.keys(selected));
  const details = summarizeScene([
    { ...rectangle, id: "image", type: "image", fileId: "sensitive-image-id", link: "https://example.test" },
    { ...rectangle, id: "stroke", type: "freedraw", points: [[437, 362]] },
    { ...rectangle, id: "shape", frameId: "frame" },
    { ...rectangle, id: "label", type: "text", text: "Label", containerId: "shape" },
    { ...arrow, id: "arrow", startBinding: { elementId: "shape" }, endBinding: { elementId: "label" } },
  ], {}).text;
  const [image, stroke, shape, , connection] = details.split("\n").map(row => JSON.parse(row));
  assert.deepEqual(image, { id: "image", type: "image", bounds: [0, 0, 100, 60], selected: false });
  assert.deepEqual(stroke, { ...image, id: "stroke", type: "freedraw" });
  assert.equal(shape.frame, "frame");
  assert.equal(shape.text, "Label");
  assert.equal(connection.start, "shape");
  assert.equal(connection.end, "label");
});
