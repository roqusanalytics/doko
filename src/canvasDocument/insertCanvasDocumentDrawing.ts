import { CaptureUpdateAction, convertToExcalidrawElements, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawLinearElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { drawingLayout, parseDrawingReply } from "./canvasDocumentAiReply";

type Skeleton = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number];
type Point = [number, number];
type LocalPoint = ExcalidrawLinearElement["points"][number];
const toLocalPoint = (x: number, y: number) => [x, y] as LocalPoint;

function targetEdge(target: ExcalidrawElement, toward: Point, gap: number): Point {
  const { x, y, width, height, angle, type } = target;
  const centerX = x + width / 2, centerY = y + height / 2;
  const direction = Math.atan2(toward[1] - centerY, toward[0] - centerX);
  const dx = Math.cos(direction - angle) / Math.max(0.5, width / 2);
  const dy = Math.sin(direction - angle) / Math.max(0.5, height / 2);
  const radius = type === "ellipse" ? Math.hypot(dx, dy)
    : type === "diamond" ? Math.abs(dx) + Math.abs(dy) : Math.max(Math.abs(dx), Math.abs(dy));
  const distance = 1 / radius + gap;
  return [centerX + Math.cos(direction) * distance, centerY + Math.sin(direction) * distance];
}

function attachArrow(arrow: ExcalidrawLinearElement, start?: ExcalidrawElement, end?: ExcalidrawElement): ExcalidrawLinearElement {
  if (!start && !end) return arrow;
  const points = arrow.points.map(([x, y]): Point => [arrow.x + x, arrow.y + y]);
  const last = points.length - 1;
  const gap = 6;
  const center = (element: ExcalidrawElement): Point => [element.x + element.width / 2, element.y + element.height / 2];
  if (start) points[0] = targetEdge(start, end && last === 1 ? center(end) : points[1], gap);
  if (end) points[last] = targetEdge(end, start && last === 1 ? center(start) : points[last - 1], gap);
  const [x, y] = points[0];
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return { ...arrow, x, y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    points: points.map(([px, py]) => toLocalPoint(px - x, py - y)),
    startBinding: start ? { elementId: start.id, focus: 0, gap } : null,
    endBinding: end ? { elementId: end.id, focus: 0, gap } : null };
}

export function insertCanvasDocumentDrawing(editor: ExcalidrawImperativeAPI, reply: string) {
  const existing = editor.getSceneElements();
  const { elements, description } = parseDrawingReply(reply, existing);
  const state = editor.getAppState();
  const selectedFrames = existing.filter(element => element.type === "frame" && state.selectedElementIds[element.id]);
  const selectedFrame = selectedFrames.length === 1 ? selectedFrames[0] : null;
  const ids = elements.map(() => crypto.randomUUID());
  const remapped = new Map(elements.flatMap((element, i) => element.id ? [[element.id, ids[i]] as const] : []));
  const frameById = new Map<string, string>();
  const arrows = new Map<string, { start?: { id: string }; end?: { id: string } }>();
  const skeletons = elements.map((element, i): Skeleton => {
    const id = ids[i];
    if (element.type === "frame") {
      for (const child of element.children) frameById.set(remapped.get(child)!, id);
      // The converter computes frame boundaries for empty children when x or y is zero.
      return { ...element, id, x: element.x || Number.EPSILON, y: element.y || Number.EPSILON, children: [] };
    }
    if (element.type === "arrow" || element.type === "line") {
      const { points, ...base } = element;
      if (base.type === "arrow") {
        const { start, end, ...shape } = base;
        arrows.set(id, { start, end });
        return { ...shape, id, points: points.map(([x, y]) => toLocalPoint(x, y)) };
      }
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      return { ...base, id, points: points.map(([x, y]) => toLocalPoint(x, y)),
        width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    return { ...element, id };
  });
  const converted = convertToExcalidrawElements(skeletons, { regenerateIds: false });
  const center: Point = [state.width / (2 * state.zoom.value) - state.scrollX, state.height / (2 * state.zoom.value) - state.scrollY];
  const bounds = getCommonBounds(converted);
  const { scale, x, y } = drawingLayout(bounds, existing.length ? getCommonBounds(existing) : null,
    center, selectedFrame ? getCommonBounds([selectedFrame]) : null);
  const placed: ExcalidrawElement[] = converted.map(element => {
    const container = element.type === "text" ? element.containerId : null;
    const frameId = frameById.get(container || element.id) ?? selectedFrame?.id ?? null;
    const base = { x: element.x * scale + x, y: element.y * scale + y, width: element.width * scale,
      height: element.height * scale, frameId, index: null };
    if (element.type === "arrow" || element.type === "line") {
      return { ...element, ...base, points: element.points.map(([px, py]) => toLocalPoint(px * scale, py * scale)) };
    }
    if (element.type === "text") return { ...element, ...base, fontSize: element.fontSize * scale };
    return { ...element, ...base };
  });

  const byId = new Map([...existing, ...placed].map(element => [element.id, element]));
  const newIds = new Set(placed.map(element => element.id));
  const incoming = new Map<string, string[]>();
  const target = (ref: { id: string } | undefined, arrowId: string) => {
    if (!ref) return undefined;
    const targetId = remapped.get(ref.id) ?? ref.id;
    if (newIds.has(targetId)) incoming.set(targetId, [...(incoming.get(targetId) ?? []), arrowId]);
    return byId.get(targetId);
  };
  const attached = placed.map(element => {
    if (element.type !== "arrow") return element;
    const refs = arrows.get(element.id);
    return attachArrow(element, target(refs?.start, element.id), target(refs?.end, element.id));
  });
  const added = attached.map(element => {
    const connections = incoming.get(element.id);
    // Existing Elements deliberately receive no reciprocal binding updates.
    return connections ? { ...element,
      boundElements: [...(element.boundElements ?? []), ...connections.map(id => ({ id, type: "arrow" as const }))]
    } : element;
  });
  editor.updateScene({
    elements: [...editor.getSceneElementsIncludingDeleted(), ...added],
    appState: { selectedElementIds: Object.fromEntries(added.map(element => [element.id, true])) },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  editor.scrollToContent(added, { fitToViewport: true, viewportZoomFactor: 0.7, maxZoom: 1 });
  return description || "Drawing added.";
}
