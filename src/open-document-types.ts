import type { IconName } from "./icons";

export const newCanvasAction = {
  name: "Canvas", label: "New canvas", hint: "Draw, ask AI", icon: "canvasDocument",
} as const;

const fileTypes: { type: OpenFileType; name: string; hint: string; icon: IconName }[] = [
  { type: "pdf", name: "PDF", hint: "Read, annotate", icon: "file" },
  { type: "markdown", name: "Markdown", hint: "Read and edit", icon: "markdown" },
  { type: "photos", name: "Photos", hint: "Gallery & edit", icon: "photo" },
  { type: "excel", name: "Excel", hint: "Read tables", icon: "spreadsheet" },
  { type: "word", name: "Word", hint: "Open as PDF", icon: "wordDocument" },
];

export function openDocumentTypes(desktop: boolean) {
  if (desktop) return fileTypes;

  return fileTypes.flatMap(format => format.type === "word" ? []
    : [format.type === "excel" ? { ...format, name: "CSV" } : format]);
}
