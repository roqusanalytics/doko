import type { AppState } from "@excalidraw/excalidraw/types";
import { Icon, type IconName } from "../icons";
import { MoreMenu } from "../MoreMenu";
import { OpenDocumentMenu } from "../OpenDocumentMenu";
import { keys } from "../platform";

type ToolType = Exclude<AppState["activeTool"]["type"], "custom">;

type Tool = {
  type: ToolType;
  label: string;
  icon: IconName;
  key: string;
  overflow?: boolean;
};

const tools: Tool[] = [
  { type: "selection", label: "Select", icon: "cursor", key: "1" },
  { type: "hand", label: "Hand", icon: "hand", key: "H" },
  { type: "rectangle", label: "Rectangle", icon: "rectangle", key: "2" },
  { type: "diamond", label: "Diamond", icon: "diamond", key: "3", overflow: true },
  { type: "ellipse", label: "Ellipse", icon: "ellipse", key: "4", overflow: true },
  { type: "arrow", label: "Arrow", icon: "arrow", key: "5" },
  { type: "line", label: "Line", icon: "line", key: "6", overflow: true },
  { type: "freedraw", label: "Draw", icon: "pen", key: "7" },
  { type: "text", label: "Text", icon: "text", key: "8" },
  { type: "image", label: "Image", icon: "photo", key: "9", overflow: true },
  { type: "eraser", label: "Eraser", icon: "eraser", key: "0", overflow: true },
];

export function CanvasToolGroup({ tool, ready, onTool, onLock, onMermaid, onNewCanvas, onPick, onOpenUrl }: {
  tool: Pick<AppState["activeTool"], "type" | "locked">;
  ready: boolean;
  onTool: (type: ToolType, focusEditor: boolean) => void;
  onLock: () => void;
  onMermaid: () => void;
} & React.ComponentProps<typeof OpenDocumentMenu>) {
  const overflow = tools.filter(item => item.overflow);
  return <div className="segmented canvas-document-tools" role="toolbar" aria-label="Tools">
    {tools.map(({ type, label, icon, key, overflow: collapses }) => (
      <button key={type} type="button" disabled={!ready}
        className={`${tool.type === type ? "on" : ""} ${collapses ? "canvas-tool-collapsible" : ""}`}
        aria-label={label} aria-pressed={tool.type === type} title={`${label} · ${keys(key)}`}
        onClick={event => onTool(type, event.detail !== 0)}>
        <Icon name={icon} size={16} />
        {(type === "selection" || type === "hand") && <span>{label}</span>}
      </button>
    ))}
    <MoreMenu label="More tools" compactIcon="grid" disabled={!ready}
      selected={tool.type === "frame" || tool.type === "laser" || tool.locked} items={[
        { kind: "action", icon: "frame", label: "Frame", current: tool.type === "frame", shortcut: keys("F"), onSelect: () => onTool("frame", true) },
        { kind: "action", icon: "laser", label: "Laser pointer", current: tool.type === "laser", shortcut: keys("K"), onSelect: () => onTool("laser", true) },
        { kind: "action", icon: "code", label: "Mermaid to Excalidraw", onSelect: onMermaid },
        { kind: "toggle", icon: "lock", label: "Lock tool", shortcut: keys("Q"), checked: tool.locked, onSelect: onLock },
        ...overflow.map(({ type, icon, label, key }) => ({
          kind: "action" as const, className: "canvas-tool-overflow", icon, label, current: tool.type === type, shortcut: keys(key),
          onSelect: () => onTool(type, true),
        })),
      ]} />
    <OpenDocumentMenu onNewCanvas={onNewCanvas} onPick={onPick} onOpenUrl={onOpenUrl} />
  </div>;
}
