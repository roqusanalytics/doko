import { useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, Ref } from "react";
import { ContextMenu } from "./ContextMenu";
import type { MoreItem } from "./MoreMenu";
import { IS_MAC } from "./platform";
import "./table-view.css";

export type TableEdit =
  | { type: "cell"; row: number; col: number; value: string }
  | { type: "insertRow" | "deleteRow" | "insertColumn" | "deleteColumn"; index: number };

export interface TableViewHandle {
  /** Commits a cell edit in progress, so a save or close sees it. */
  commit(): void;
  focus(): void;
}

export interface TableViewProps {
  /** Plain cell text, row by row. Rows may be shorter than `columns`; missing cells show as empty. */
  rows: readonly (readonly string[])[];
  /** Number of columns to show (the longest row). */
  columns: number;
  /** Shows the grid without editing, row/column menus or the Add row button. Enter, F2 or a double click still opens the full cell text, read-only. */
  readOnly?: boolean;
  /** Accessible name of the grid. */
  label: string;
  /** Shown instead of the grid while there are no rows. */
  empty?: string;
  /** Called once per user operation; the parent applies it and passes new `rows`. */
  onEdit?: (edit: TableEdit) => void;
  handle?: Ref<TableViewHandle>;
}

const ROW_H = 30;
const COL_W = 140;
const OVERSCAN_ROWS = 6;
const OVERSCAN_COLS = 2;
const TITLE_MAX = 4000;
const TEXT_MAX = 500;

export function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}

type Pos = { row: number; col: number };
type Menu = { element: HTMLElement; kind: "cell" | "row" | "column"; row: number; col: number };

function CellEditor({ initial, readOnly, textarea, onCommit, onCancel }: {
  initial: string;
  readOnly: boolean;
  textarea: Ref<HTMLTextAreaElement>;
  onCommit: (value: string, move?: Pos) => void;
  onCancel: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(textarea, () => field.current!, []);
  const resize = () => {
    const el = field.current!;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, ROW_H), 220)}px`;
  };
  useLayoutEffect(() => {
    const el = field.current!;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    resize();
  }, []);
  return <textarea ref={field} className="tv-editor" rows={1} defaultValue={initial} readOnly={readOnly} aria-readonly={readOnly || undefined} spellCheck={false} aria-label="Cell value"
    onInput={resize}
    onBlur={event => onCommit(event.currentTarget.value)}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      const el = event.currentTarget;
      if (readOnly) {
        // Nothing to commit: these keys just close the viewer and return to the cell. Copy and select all stay native.
        if (event.key === "Enter" || event.key === "Tab" || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (event.altKey) { el.setRangeText("\n", el.selectionStart, el.selectionEnd, "end"); resize(); }
        else onCommit(el.value, { row: event.shiftKey ? -1 : 1, col: 0 });
      } else if (event.key === "Tab") {
        event.preventDefault();
        onCommit(el.value, { row: 0, col: event.shiftKey ? -1 : 1 });
      } else if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); onCancel();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        // Save sees the edit: the commit reaches the document before the window's own Ctrl/Cmd+S handler runs.
        onCommit(el.value);
      }
    }} />;
}

export default function TableView({ rows, columns, readOnly = false, label, empty = "No rows.", onEdit, handle }: TableViewProps) {
  const rowCount = rows.length;
  const colCount = rowCount ? Math.max(columns, 1) : 0;
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const [active, setActive] = useState<Pos>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<(Pos & { original: string; initial: string }) | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const pendingFocus = useRef(false);
  const reveal = useRef(false);
  const finished = useRef(false);

  const ar = Math.min(active.row, Math.max(rowCount - 1, 0));
  const ac = Math.min(active.col, Math.max(colCount - 1, 0));
  const rnW = 20 + String(Math.max(rowCount, 1)).length * 9;
  const totalW = rnW + colCount * COL_W;
  const totalH = (rowCount + 1) * ROW_H;
  const r0 = Math.max(0, Math.floor(view.top / ROW_H) - 1 - OVERSCAN_ROWS);
  const r1 = Math.min(rowCount - 1, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN_ROWS);
  const c0 = Math.max(0, Math.floor(view.left / COL_W) - OVERSCAN_COLS);
  const c1 = Math.min(colCount - 1, Math.ceil((view.left + view.width) / COL_W) + OVERSCAN_COLS);
  // The active cell is always rendered, even after wheel scrolling moved it away, so Tab can still reach the grid.
  const visibleRows: number[] = [];
  for (let r = r0; r <= r1; r++) visibleRows.push(r);
  if (rowCount && (ar < r0 || ar > r1)) visibleRows.push(ar);
  const visibleCols: number[] = [];
  for (let c = c0; c <= c1; c++) visibleCols.push(c);
  if (colCount && (ac < c0 || ac > c1)) visibleCols.push(ac);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rowCount > 0]);

  // Runs after every render: keyboard moves and edits ask for the new cell to be scrolled into view and focused.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (reveal.current && el && rowCount) {
      reveal.current = false;
      const top = ar * ROW_H, bottom = top + ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (bottom > el.scrollTop + el.clientHeight - ROW_H) el.scrollTop = Math.max(0, bottom - el.clientHeight + ROW_H);
      const left = ac * COL_W, right = left + COL_W;
      if (left < el.scrollLeft) el.scrollLeft = left;
      else if (right > el.scrollLeft + el.clientWidth - rnW) el.scrollLeft = Math.max(0, right - el.clientWidth + rnW);
    }
    if (pendingFocus.current && !editing) {
      pendingFocus.current = false;
      el?.querySelector<HTMLElement>(`[data-r="${ar}"][data-c="${ac}"]`)?.focus({ preventScroll: true });
    }
  });

  // After an insert the new row or column is not in `rows` yet, so only keyboard moves clamp to the current size.
  const go = (row: number, col: number, clamp = true) => {
    pendingFocus.current = true; reveal.current = true;
    setActive({ row: Math.max(0, clamp ? Math.min(row, rowCount - 1) : row), col: Math.max(0, clamp ? Math.min(col, colCount - 1) : col) });
  };

  // Read-only, this opens the same field to show the whole text (the grid cuts long cells); it never reports an edit.
  const startEdit = (row: number, col: number, initial?: string) => {
    const original = rows[row]?.[col] ?? "";
    finished.current = false;
    setEditing({ row, col, original, initial: initial ?? original });
  };
  const finish = (value: string | null, move?: Pos) => {
    const current = editing;
    if (!current || finished.current) return;
    finished.current = true;
    setEditing(null);
    if (!readOnly && value !== null && value !== current.original && current.row < rowCount) onEdit?.({ type: "cell", row: current.row, col: current.col, value });
    // A blur (a click elsewhere) must not pull focus back; every other way of finishing returns it to the grid.
    if (move || document.activeElement === textarea.current) go(current.row + (move?.row ?? 0), current.col + (move?.col ?? 0));
  };
  useImperativeHandle(handle, () => ({
    commit() { if (textarea.current) finish(textarea.current.value); },
    focus() { pendingFocus.current = true; setActive(a => ({ ...a })); },
  }));

  const edit = (next: TableEdit, focus: Pos) => {
    onEdit?.(next);
    go(focus.row, focus.col, false);
  };
  const openMenu = (element: HTMLElement, kind: Menu["kind"], row: number, col: number) => {
    if (!readOnly) setMenu({ element, kind, row, col });
  };
  const menuItems = (m: Menu): MoreItem[] => {
    const rowItems: MoreItem[] = [
      { kind: "action", icon: "plus", label: "Insert row above", onSelect: () => edit({ type: "insertRow", index: m.row }, { row: m.row, col: ac }) },
      { kind: "action", icon: "plus", label: "Insert row below", onSelect: () => edit({ type: "insertRow", index: m.row + 1 }, { row: m.row + 1, col: ac }) },
      { kind: "action", icon: "trash", label: "Delete row", onSelect: () => edit({ type: "deleteRow", index: m.row }, { row: m.row, col: ac }) },
    ];
    const colItems: MoreItem[] = [
      { kind: "action", icon: "plus", label: "Insert column left", onSelect: () => edit({ type: "insertColumn", index: m.col }, { row: ar, col: m.col }) },
      { kind: "action", icon: "plus", label: "Insert column right", onSelect: () => edit({ type: "insertColumn", index: m.col + 1 }, { row: ar, col: m.col + 1 }) },
      { kind: "action", icon: "trash", label: "Delete column", onSelect: () => edit({ type: "deleteColumn", index: m.col }, { row: ar, col: m.col }) },
    ];
    return m.kind === "row" ? rowItems : m.kind === "column" ? colItems : [...rowItems, { kind: "divider" }, ...colItems];
  };

  // A character the key press really produces. AltGr reports Ctrl+Alt on Windows and Option types characters on macOS, so
  // those are text; Ctrl/Cmd and (off macOS) Alt-only combinations are shortcuts or menu accelerators.
  const isTyped = (event: KeyboardEvent) => {
    const native = event.nativeEvent, altGraph = native.getModifierState("AltGraph");
    if (native.isComposing || native.keyCode === 229 || [...event.key].length !== 1) return false;
    return !(event.metaKey || (event.ctrlKey && !altGraph) || (event.altKey && !altGraph && !IS_MAC));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("textarea") || !target.matches(".tv-cell")) return;
    const jump = event.metaKey || event.ctrlKey;
    const page = Math.max(1, Math.floor((view.height - ROW_H) / ROW_H) - 1);
    const key = event.key;
    let handled = true;
    if (key === "ArrowDown") go(jump ? rowCount - 1 : ar + 1, ac);
    else if (key === "ArrowUp") go(jump ? 0 : ar - 1, ac);
    else if (key === "ArrowRight") go(ar, jump ? colCount - 1 : ac + 1);
    else if (key === "ArrowLeft") go(ar, jump ? 0 : ac - 1);
    else if (key === "Home") go(jump ? 0 : ar, 0);
    else if (key === "End") go(jump ? rowCount - 1 : ar, colCount - 1);
    else if (key === "PageDown") go(ar + page, ac);
    else if (key === "PageUp") go(ar - page, ac);
    else if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) openMenu(target, "cell", ar, ac);
    else if (key === "Enter" || key === "F2") startEdit(ar, ac);
    else if (readOnly) handled = false;
    else if (key === "Delete" || key === "Backspace") { if ((rows[ar]?.[ac] ?? "") !== "") onEdit?.({ type: "cell", row: ar, col: ac, value: "" }); }
    else if (isTyped(event)) startEdit(ar, ac, key);
    else handled = false;
    if (handled) event.preventDefault();
  };

  const header = (kind: "row" | "column", index: number) => (event: { currentTarget: HTMLElement }) => openMenu(event.currentTarget, kind, kind === "row" ? index : ar, kind === "column" ? index : ac);
  const cellProps = (row: number, col: number) => ({ "data-r": row, "data-c": col });

  return <div className="table-view">
    {rowCount === 0 ? <div className="tv-empty" role="status">{empty}</div> : <div ref={scroller} className="tv-scroll" onScroll={event => {
      const el = event.currentTarget;
      setView(v => v.top === el.scrollTop && v.left === el.scrollLeft ? v : { ...v, top: el.scrollTop, left: el.scrollLeft });
    }}>
      <div role="grid" aria-label={label} aria-rowcount={rowCount + 1} aria-colcount={colCount + 1} aria-readonly={readOnly || undefined}
        className="tv-grid" style={{ width: totalW, height: totalH }} onKeyDown={onKeyDown}>
        <div role="row" aria-rowindex={1} className="tv-row tv-head" style={{ width: totalW, height: ROW_H }}>
          <div role="presentation" className="tv-corner" style={{ width: rnW }} />
          {visibleCols.map(c => <div key={c} role="columnheader" aria-colindex={c + 2} tabIndex={-1} className="tv-colhead" data-active={c === ac || undefined}
            style={{ left: rnW + c * COL_W, width: COL_W }} onClick={readOnly ? undefined : header("column", c)}
            onContextMenu={readOnly ? undefined : event => { event.preventDefault(); header("column", c)(event); }}>{columnName(c)}</div>)}
        </div>
        {visibleRows.map(r => <div key={r} role="row" aria-rowindex={r + 2} className="tv-row" style={{ top: (r + 1) * ROW_H, height: ROW_H, width: totalW }}>
          <div role="rowheader" tabIndex={-1} className="tv-rowhead" data-active={r === ar || undefined} style={{ width: rnW }}
            onClick={readOnly ? undefined : header("row", r)}
            onContextMenu={readOnly ? undefined : event => { event.preventDefault(); header("row", r)(event); }}>{r + 1}</div>
          {visibleCols.map(c => {
            const value = rows[r]?.[c] ?? "";
            const isActive = r === ar && c === ac;
            const isEditing = editing?.row === r && editing.col === c;
            return <div key={c} role="gridcell" aria-colindex={c + 2} aria-selected={isActive} aria-readonly={readOnly || undefined}
              tabIndex={isActive ? 0 : -1} className="tv-cell" data-active={isActive || undefined} data-editing={isEditing || undefined}
              style={{ left: rnW + c * COL_W, width: COL_W }} title={isEditing || !value ? undefined : value.length > TITLE_MAX ? value.slice(0, TITLE_MAX) + "…" : value}
              {...cellProps(r, c)}
              onFocus={event => { if (event.target === event.currentTarget) setActive({ row: r, col: c }); }}
              onDoubleClick={() => startEdit(r, c)}
              onContextMenu={readOnly ? undefined : event => { event.preventDefault(); setActive({ row: r, col: c }); openMenu(event.currentTarget, "cell", r, c); }}>
              {isEditing ? <CellEditor initial={editing.initial} readOnly={readOnly} textarea={textarea} onCommit={finish} onCancel={() => finish(null)} />
                : <span className="tv-text">{value.length > TEXT_MAX ? value.slice(0, TEXT_MAX) + "…" : value}</span>}
            </div>;
          })}
        </div>)}
      </div>
    </div>}
    <div className="tv-footer">
      <span role="status">{rowCount.toLocaleString()} {rowCount === 1 ? "row" : "rows"} × {colCount.toLocaleString()} {colCount === 1 ? "column" : "columns"}</span>
      {!readOnly && <span className="tv-actions">
        {/* Mac keyboards have no ContextMenu key, so this is the keyboard route to the row and column actions. */}
        <button className="btn ghost" aria-haspopup="menu" ref={menuButton} aria-expanded={!!menu && menu.element === menuButton.current}
          onClick={event => openMenu(event.currentTarget, "cell", ar, ac)}>Rows &amp; columns</button>
        <button className="btn ghost" onClick={() => edit({ type: "insertRow", index: rowCount }, { row: rowCount, col: 0 })}>Add row</button>
      </span>}
    </div>
    {menu && <ContextMenu target={menu} label={menu.kind === "row" ? `Actions for row ${menu.row + 1}` : menu.kind === "column" ? `Actions for column ${columnName(menu.col)}` : `Actions for cell ${columnName(menu.col)}${menu.row + 1}`}
      items={menuItems(menu)} onClose={() => {
        setMenu(null);
        // Focus goes back to the active cell, unless a click outside the menu already put it on another control.
        const focus = document.activeElement;
        if (!focus || focus === document.body || focus === menu.element || focus.closest("[role=menu]")) pendingFocus.current = true;
      }} />}
  </div>;
}
