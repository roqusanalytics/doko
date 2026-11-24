import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export const SCENE_SUMMARY_LIMIT = 12_000;

export function summarizeScene(elements: readonly ExcalidrawElement[], selected: Readonly<Record<string, boolean>>) {
  const live = elements.filter(element => !element.isDeleted);

  const textByContainer = new Map(live.flatMap(element =>
    element.type === "text" && element.containerId ? [[element.containerId, element.text] as const] : []));

  const rows = live.map(element => {
    const { id, type, x, y, width, height } = element;
    const bounds = [x, y, width, height].map(value => Math.round(value));

    // JSON.stringify drops undefined fields, so non-arrows carry no start or end.
    const arrow = type === "arrow";

    const summary = { id, type, bounds, selected: selected[id] === true, frame: element.frameId || undefined,
      start: arrow ? element.startBinding?.elementId : undefined, end: arrow ? element.endBinding?.elementId : undefined };

    const label = type === "image" || type === "freedraw" ? undefined
      : type === "text" ? element.text : type === "frame" ? element.name : textByContainer.get(id);

    return { selected: summary.selected, base: JSON.stringify(summary),
      detailed: label ? JSON.stringify({ ...summary, text: label.slice(0, 160) }) : undefined, shortened: !!label && label.length > 160 };
  });

  const priority = rows.filter(row => row.selected);
  const others = rows.filter(row => !row.selected);
  const kept: string[] = [];
  const suffix = "\ntruncated";
  let left = SCENE_SUMMARY_LIMIT - suffix.length;
  let reserved = priority.reduce((length, row) => length + row.base.length + 1, 0);
  let truncated = false;

  for (const row of [...priority, ...others]) {
    if (row.selected) reserved -= row.base.length + 1;
    const full = row.detailed && row.detailed.length + 1 <= left - reserved;
    const value = full ? row.detailed! : row.base;

    if (row.shortened || (row.detailed && !full)) truncated = true;

    if (value.length + 1 > left) {
      truncated = true;
      continue;
    }

    kept.push(value);
    left -= value.length + 1;
  }

  return { text: kept.join("\n") + (truncated ? suffix : ""), truncated };
}
