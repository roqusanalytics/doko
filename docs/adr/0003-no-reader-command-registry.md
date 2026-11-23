# 3. No reader command registry; one overlay rule instead

Date: 2026-11-23. Status: accepted.

## Context

Reader commands reach `src/App.tsx` two ways: keyboard shortcuts in one large `keydown` handler, and File menu
commands over IPC through `useFileCommands`. Each path decided on its own whether something covering the document
should block a command, using five differently written state lists. They had drifted: with the image viewer open, menu
Save, Print and Properties ran behind it while the same shortcuts were swallowed. An architecture review suggested a
command registry with a `canRun(id)` per command.

## Decision

No registry. A registry would mostly move the per-reader command `switch`es; the File menu's enabled rules live in the
main process (`electron/file-menu.cjs`) and would stay there; and `ContentReader` and `CanvasReader` already have their
own small paths (`CanvasReader` already shares one `blocked` value between keyboard and menu).

Instead, `App.tsx` has one `overlayOpen` value (dialog, work dialog, export dialog, pdf.js pending item, image viewer,
print copy, signing). The menu guard, the busy state sent to the File menu, and the keyboard gates that ask the same
question all use it. Key-specific conditions (typing, busy states, editor modes) stay where they are.

## Consequences

- A new overlay is added to one list and blocks both shortcuts and the menu.
- Revisit a registry if commands gain a third entry point (for example a command palette), or if the File menu's
  enabled rules need to move into the renderer.
