import assert from "node:assert/strict";
import { test } from "node:test";
import { copyMermaidElements, drawingLayout, parseDrawingReply, readMermaidDrawing, splitDrawingReply } from "../src/canvasDocument/canvasDocumentAiReply.ts";
import { SCENE_SUMMARY_LIMIT, summarizeScene } from "../src/canvasDocument/canvasDocumentSceneSummary.ts";

const block = content => "```excalidraw\n" + content + "\n```";
const reply = (...elements) => block(JSON.stringify(elements));
const rectangle = { type: "rectangle", x: 0, y: 0, width: 100, height: 60 };
const arrow = { type: "arrow", x: 80, y: 30, points: [[0, 0], [90, 0]] };
const mermaid = (source = "flowchart LR\nA --> B") => "```mermaid\n" + source + "\n```";

test("the last drawing fence wins across formats and Mermaid stays hidden in the chat", () => {
  const lastMermaid = splitDrawingReply(reply(rectangle) + "\n" + mermaid() + "\nDiagram added.");
  assert.equal(lastMermaid.format, "mermaid");
  assert.equal(lastMermaid.block.trim(), "flowchart LR\nA --> B");
  assert.equal(lastMermaid.description, "Diagram added.");
  assert.equal(splitDrawingReply(mermaid() + "\n" + reply(rectangle)).format, "excalidraw");
  assert.equal(splitDrawingReply("Drawing…\n" + mermaid().slice(0, -2), true).description, "Drawing…");
});

test("accepts editable Elements from Mermaid and rejects invalid syntax or results", async () => {
  const node = { ...rectangle, id: "step", frameId: null, boundElements: null };
  const definition = splitDrawingReply(mermaid()).block;
  assert.deepEqual(await readMermaidDrawing(definition, async (source, limits) => {
    assert.equal(source, "flowchart LR\nA --> B");
    assert.equal(limits.maxEdges, 80);

    return [node];
  }), [node]);
  await assert.rejects(readMermaidDrawing("flowchart LR\nA -->", async () => {
    throw new Error("Invalid Mermaid syntax");
  }), /Invalid Mermaid syntax/);
  await assert.rejects(readMermaidDrawing("", async () => []), /flowchart, sequence diagram, or class diagram/);
  await assert.rejects(readMermaidDrawing("flowchart LR\n" + " ".repeat(100_000), async () => []), /too large/);
  await assert.rejects(readMermaidDrawing(definition, async () => Array(81).fill(node)), /too many Elements/);
  await assert.rejects(readMermaidDrawing(definition, async () => [{ ...node, link: "https://example.test" }]), /Links are not allowed/);
  await assert.rejects(readMermaidDrawing("---\nconfig: {}\n---\n" + definition, async () => []), /configuration is not allowed/);
});

test("Insert again gives a fresh set of IDs and lays out the copy in free space", () => {
  const node = { ...rectangle, id: "step", frameId: null, groupIds: ["group"], boundElements: [{ id: "connector", type: "arrow" }] };

  const connector = { ...arrow, id: "connector", frameId: null, groupIds: ["group"], boundElements: null,
    startBinding: { elementId: "step" }, endBinding: null };

  const first = copyMermaidElements([node, connector]);
  const second = copyMermaidElements([node, connector]);
  assert.equal(new Set([...first, ...second].map(element => element.id)).size, 4);
  assert.notEqual(first[0].groupIds[0], second[0].groupIds[0]);
  assert.equal(second[0].groupIds[0], second[1].groupIds[0]);
  assert.equal(second[0].boundElements[0].id, second[1].id);
  assert.equal(second[1].startBinding.elementId, second[0].id);
  const bounds = [0, 0, 170, 60];
  const position = drawingLayout(bounds, bounds, [85, 30], null);
  assert.ok(position.x > bounds[2]);
});

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

test("keeps safe style fields and rejects unsafe style values", () => {
  const style = { strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeStyle: "dashed", strokeWidth: 2 };
  const [element] = parseDrawingReply(reply({ ...rectangle, ...style }), []).elements;
  assert.deepEqual({ ...element }, { ...rectangle, ...style });
  assert.equal(parseDrawingReply(reply({ ...arrow, strokeColor: "#e03131" }), []).elements[0].strokeColor, "#e03131");

  for (const bad of [{ strokeColor: "red" }, { backgroundColor: "url(x)" }, { fillStyle: "image" }, { strokeStyle: "wavy" }, { strokeWidth: 0 }, { strokeWidth: 5 }]) {
    assert.throws(() => parseDrawingReply(reply({ ...rectangle, ...bad }), []), /invalid style/);
  }
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
