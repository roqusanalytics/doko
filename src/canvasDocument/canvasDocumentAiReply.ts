const SHAPES = ["rectangle", "diamond", "ellipse"] as const;
type Shape = typeof SHAPES[number];
type Point = [number, number];
type Base = { id?: string; x: number; y: number };
type Label = { label?: { text: string } };
type Sized = { width: number; height: number };
export type DrawingElement = Base & (
  | ({ type: Shape } & Sized & Label)
  | { type: "text"; text: string }
  | ({ type: "frame"; name?: string; children: string[] } & Sized)
  | ({ type: "line"; points: Point[] })
  | ({ type: "arrow"; points: Point[]; start?: { id: string }; end?: { id: string } } & Label)
);

export const MAX_DRAWING_REPLY = 100_000;
const MAX_ELEMENTS = 80;
const BINDABLE_TYPES = new Set<string>([...SHAPES, "text", "frame", "magicframe", "image"]);
const LIMIT = 100_000;
const invalid = (reason: string): never => { throw new Error(reason); };

export function splitDrawingReply(reply: string, streaming = false) {
  const description: string[] = [];
  let block: string | undefined;
  let complete = false;
  let fence = "";
  let drawing = false;
  const lines = reply.split(/\r?\n/);
  lines.forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = "";
        if (drawing) complete = true;
        else description.push(line);
        drawing = false;
      } else if (drawing) {
        block += line + "\n";
      } else description.push(line);
    } else if (marker) {
      fence = marker[1];
      drawing = fence[0] === "`" && marker[2].trim().toLowerCase() === "excalidraw";
      if (drawing) { block = ""; complete = false; }
      else if (!streaming || index < lines.length - 1) description.push(line);
    } else if (!streaming || index < lines.length - 1 || !/^ {0,3}`{1,2}$/.test(line)) description.push(line);
  });
  return { description: description.join("\n").trim(), block, complete };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("An Element must be a JSON object.");
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value)) {
    if (key === "link") invalid("Links are not allowed in a drawing.");
    if (!allowed.includes(key)) invalid("An Element has an unsupported field.");
  }
}

function coordinate(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= LIMIT) return value;
  return invalid("An Element has missing or invalid coordinates.");
}

function size(value: unknown): number {
  if (typeof value === "number" && value > 0 && value <= LIMIT) return value;
  return invalid("An Element needs a positive width and height.");
}

function textValue(value: unknown, max = 500): string {
  if (typeof value === "string" && value.trim() && value.length <= max) return value;
  return invalid("An Element has missing or invalid text.");
}

function idValue(value: unknown): string {
  return textValue(value, 128);
}

function labelValue(value: unknown): Label {
  if (value === undefined) return {};
  const label = record(value);
  fields(label, ["text"]);
  return { label: { text: textValue(label.text) } };
}

function endpoint(value: unknown): { id: string } {
  if (typeof value === "string") return { id: idValue(value) };
  const ref = record(value);
  fields(ref, ["id"]);
  return { id: idValue(ref.id) };
}

function linePoints(value: Record<string, unknown>): Point[] {
  if (value.points === undefined) {
    const point: Point = [coordinate(value.width), coordinate(value.height)];
    if (point[0] || point[1]) return [[0, 0], point];
  } else if (Array.isArray(value.points) && value.points.length >= 2 && value.points.length <= 24) {
    const points = value.points.map((point: unknown): Point => {
      if (!Array.isArray(point) || point.length !== 2) return invalid("A line point needs two coordinates.");
      return [coordinate(point[0]), coordinate(point[1])];
    });
    if (!points[0][0] && !points[0][1] && points.some(([x, y]) => x || y)) return points;
  }
  return invalid("A line or arrow needs valid points starting at [0,0].");
}

function readElement(input: unknown): DrawingElement {
  const value = record(input);
  const common = ["type", "id", "x", "y"];
  const base = { x: coordinate(value.x), y: coordinate(value.y), ...(value.id === undefined ? {} : { id: idValue(value.id) }) };
  const type = value.type;
  switch (type) {
    case "rectangle": case "diamond": case "ellipse":
      fields(value, [...common, "width", "height", "label"]);
      return { ...base, type, width: size(value.width), height: size(value.height), ...labelValue(value.label) };
    case "text":
      fields(value, [...common, "text"]);
      return { ...base, type, text: textValue(value.text) };
    case "frame":
      fields(value, [...common, "width", "height", "name", "children"]);
      if (!Array.isArray(value.children) || value.children.length > MAX_ELEMENTS) return invalid("A frame needs a list of its child ids.");
      return { ...base, type, width: size(value.width), height: size(value.height), children: value.children.map(idValue),
        ...(value.name === undefined ? {} : { name: textValue(value.name) }) };
    case "line":
      fields(value, [...common, "width", "height", "points"]);
      return { ...base, type, points: linePoints(value) };
    case "arrow":
      fields(value, [...common, "width", "height", "points", "label", "start", "end"]);
      return { ...base, type, points: linePoints(value), ...labelValue(value.label),
        ...(value.start === undefined ? {} : { start: endpoint(value.start) }),
        ...(value.end === undefined ? {} : { end: endpoint(value.end) }) };
    default: return invalid("The drawing contains an unsupported Element type.");
  }
}

export function parseDrawingReply(reply: string, existing: readonly { id: string; type: string }[]) {
  if (reply.length > MAX_DRAWING_REPLY) return invalid("The drawing reply is too large.");
  const { block, complete, description } = splitDrawingReply(reply);
  if (!complete || block === undefined) return invalid("The reply needs a complete excalidraw block.");
  let data: unknown;
  try { data = JSON.parse(block); } catch { return invalid("The drawing block contains invalid JSON."); }
  if (!Array.isArray(data) || !data.length) return invalid("The drawing block needs a non-empty JSON array.");
  if (data.length > MAX_ELEMENTS) return invalid("The drawing contains too many Elements (maximum 80).");
  const elements = data.map(readElement);
  const targets = new Map(existing.map(({ id, type }) => [id, type]));
  const created = new Map<string, DrawingElement>();
  for (const element of elements) {
    if (!element.id) continue;
    if (targets.has(element.id)) return invalid("The drawing repeats an existing or new Element id.");
    targets.set(element.id, element.type);
    created.set(element.id, element);
  }
  const children = new Set<string>();
  for (const element of elements) {
    if (element.type === "arrow") {
      for (const ref of [element.start, element.end]) {
        if (!ref) continue;
        const type = targets.get(ref.id);
        if (!type) return invalid("An arrow points to a missing Element.");
        if (!BINDABLE_TYPES.has(type)) return invalid("An arrow needs a shape, text, frame, or image as its target.");
      }
      if (element.start && element.start.id === element.end?.id) return invalid("An arrow needs different start and end Elements.");
    }
    if (element.type === "frame") {
      for (const id of element.children) {
        const child = created.get(id);
        if (!child || child.type === "frame" || children.has(id)) return invalid("A frame must contain only new Elements, each in one frame.");
        children.add(id);
      }
    }
  }
  return { description, elements };
}

type Bounds = readonly [number, number, number, number];
export function drawingLayout(drawing: Bounds, content: Bounds | null, center: Point, frame: Bounds | null) {
  const [left, top, right, bottom] = drawing;
  const width = right - left, height = bottom - top;
  let scale = 1;
  let x = center[0] - width / 2, y = center[1] - height / 2;
  if (frame) {
    const frameWidth = frame[2] - frame[0], frameHeight = frame[3] - frame[1];
    const padding = Math.min(24, frameWidth / 4, frameHeight / 4);
    scale = Math.min(1, (frameWidth - 2 * padding) / Math.max(1, width), (frameHeight - 2 * padding) / Math.max(1, height));
    x = frame[0] + padding;
    y = frame[1] + padding;
  } else if (content) {
    x = content[2] + 80;
    y = content[1];
  }
  return { scale, x: x - left * scale, y: y - top * scale };
}
