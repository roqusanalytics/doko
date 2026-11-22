import { MoreMenu, type MoreItem } from "./MoreMenu";
import { newCanvasAction, openDocumentTypes } from "./open-document-types";
import { IS_MAC, keys } from "./platform";

export function OpenDocumentMenu({ onNewCanvas, onPick, onOpenUrl }: {
  onNewCanvas: () => void;
  onPick: (type: OpenFileType) => void;
  onOpenUrl: () => void;
}) {
  const desktop = !!window.folioDesktop;
  return <MoreMenu label="Open" toolbarIcon="folderOpen" items={[
    ...(desktop ? [
      { kind: "action", icon: newCanvasAction.icon, label: newCanvasAction.label,
        shortcut: keys(IS_MAC ? "Shift+Ctrl+N" : "Ctrl+Shift+N"), onSelect: onNewCanvas },
      { kind: "divider" },
    ] satisfies MoreItem[] : []),
    ...openDocumentTypes(desktop).map(({ type, name, icon }): MoreItem => ({
      kind: "action", icon, label: name, onSelect: () => onPick(type),
    })),
    { kind: "divider" },
    { kind: "action", icon: "link", label: "From URL…", onSelect: onOpenUrl },
  ]} />;
}
