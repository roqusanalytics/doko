import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdownSections } from "./markdownSections";
import { deleteColumn, deleteRow, insertColumn, insertRow, parseCsv, setCell } from "./csv";
import type { CsvChange, CsvTable } from "./csv";
import { Icon } from "./icons";
import TableView from "./TableView";
import type { TableEdit, TableViewHandle } from "./TableView";
import "./markdown-pane.css";

export interface MarkdownEditorHandle {
  focus(): void;
  /** Commits a table cell edit in progress, so the text passed to a save is complete. */
  flush(): void;
}

const NO_SECTIONS: ReturnType<typeof markdownSections> = [];

// Plain text (`format` "text") is only the editor: no preview, mode bar, Markdown highlighting or section rail.
// A CSV file (`format` "csv") is the same editor plus an editable table of its text: "view" mode is the table. The editor
// exists from the start, hidden in table mode, because every table edit is a transaction on it (and so is undo/redo).
// An SVG file (`format` "svg") is the editor (plain text, no Markdown language) plus its rendered image from `renderPreview`:
// "view" mode is the image, and the editor exists from the start, hidden, as for CSV.
export default function MarkdownPane({ text, onChange, renderPreview, editorRef, format, csv, onTableVisible }: {
  text: string;
  onChange: (text: string) => void;
  renderPreview?: (headingIds: readonly string[]) => ReactNode;
  editorRef: Ref<MarkdownEditorHandle>;
  format?: "text" | "csv" | "svg";
  /** `text` parsed with the pinned delimiter; required for CSV. */
  csv?: CsvTable | null;
  /** Tells the parent whether the CSV table is on screen, so it can skip parsing while only the source is shown. */
  onTableVisible?: (visible: boolean) => void;
}) {
  const plain = format === "text";
  const sheet = format === "csv";
  const svg = format === "svg";
  const [mode, setMode] = useState<"view" | "source">(plain ? "source" : "view");
  const [requested, setRequested] = useState(plain || sheet || svg);
  const tableHandle = useRef<TableViewHandle>(null);
  useLayoutEffect(() => { if (sheet) onTableVisible?.(mode === "view"); }, [sheet, mode]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const modules = useRef<typeof import("./markdownEditor") | null>(null);
  const latestText = useRef(text);
  latestText.current = text;
  const [active, setActive] = useState(0);
  const [label, setLabel] = useState<{ index: number; top: number; left: number } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const rendered = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const extensions = useRef<Extension[]>([]);
  const currentMode = useRef(mode);
  currentMode.current = mode;
  const change = useRef(onChange);
  change.current = onChange;
  const sections = useMemo(() => plain || sheet || svg ? NO_SECTIONS : markdownSections(text), [text, plain, sheet, svg]);
  const latestSections = useRef(sections);
  latestSections.current = sections;
  const headingIds = useMemo(() => sections.map(section => section.id), [sections]);

  const sourceSection = (view: EditorView) => {
    if (plain || sheet || svg) return;
    view.requestMeasure({
      key: "markdown-section",
      read(current) {
        const line = current.state.doc.lineAt(current.lineBlockAtHeight(Math.max(0, current.scrollDOM.scrollTop + 36)).from).number;
        let index = 0;
        latestSections.current.forEach((section, next) => { if (section.line <= line) index = next; });
        if (current.scrollDOM.scrollTop > 0 && current.scrollDOM.scrollTop + current.scrollDOM.clientHeight >= current.scrollDOM.scrollHeight - 2) index = Math.max(0, latestSections.current.length - 1);
        return index;
      },
      write(index) { if (currentMode.current === "source") setActive(index); },
    });
  };
  const previewSection = () => {
    const root = rendered.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + 36;
    let index = 0;
    sections.forEach((section, next) => {
      const heading = root.querySelector<HTMLElement>(`#${section.id}`);
      if (heading && heading.getBoundingClientRect().top <= top) index = next;
    });
    if (root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) index = Math.max(0, sections.length - 1);
    setActive(index);
  };

  useEffect(() => {
    if (!requested) return;
    let disposed = false;
    let view: EditorView | undefined;
    setLoadError(false);
    void import("./markdownEditor").then(loaded => {
      if (disposed || !host.current) return;
      modules.current = loaded;
      const { basicSetup, markdown, pythonLanguage, syntaxHighlighting, highlighting, EditorState, EditorView } = loaded;
      extensions.current = [
      basicSetup,
      ...(sheet ? [] : plain || svg ? [EditorView.lineWrapping] : [
        markdown({ codeLanguages: info => /^(python|py)(?:\s|$)/i.test(info) ? pythonLanguage : null }),
        syntaxHighlighting(highlighting),
      ]),
      EditorState.tabSize.of(2),
      EditorView.contentAttributes.of({ "aria-label": plain ? "Text document" : sheet ? "CSV source" : svg ? "SVG source" : "Markdown source", spellcheck: "false" }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) change.current(update.state.doc.toString());
        if (update.viewportChanged || update.docChanged) sourceSection(update.view);
      }),
      EditorView.domEventHandlers({ scroll: (_event, current) => { sourceSection(current); } }),
    ];
    view = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: latestText.current, extensions: extensions.current }),
    });
    editor.current = view;
    setReady(true);
    if (currentMode.current === "source") sourceSection(view);
    }).catch(() => { if (!disposed) setLoadError(true); });
    return () => { disposed = true; editor.current = null; view?.destroy(); };
  }, [requested, attempt]);

  useEffect(() => {
    const view = editor.current;
    // Reloading a document must discard undo entries from its previous contents.
    if (view && text !== view.state.doc.toString()) view.setState(modules.current!.EditorState.create({ doc: text, extensions: extensions.current }));
  }, [text]);

  useLayoutEffect(() => {
    setLabel(null);
    if (mode === "source" && editor.current) sourceSection(editor.current);
    else previewSection();
  }, [mode, sections]);

  useImperativeHandle(editorRef, () => ({
    focus() { if (mode === "source") editor.current?.focus(); else if (sheet) tableHandle.current?.focus(); else rendered.current?.focus(); },
    flush() { tableHandle.current?.commit(); },
  }), [mode, sheet]);

  const csvRows = useMemo(() => csv?.rows.map(row => row.cells.map(cell => cell.value)) ?? [], [csv]);
  // Rows shorter than the widest row; a blank line is not a short row.
  const ragged = useMemo(() => !!csv && csv.rows.some(row => row.cells.length < csv.columns && !(row.cells.length === 1 && row.to === row.from)), [csv]);
  const applyEdit = (edit: TableEdit) => {
    const view = editor.current;
    if (!view || !csv) return;
    // Offsets must match the editor's text exactly, so a table that is one update behind is parsed again.
    const current = view.state.doc.toString();
    const table = current === text ? csv : parseCsv(current, csv.delimiter);
    const last = table.rows.length;
    let changes: CsvChange[];
    if (edit.type === "cell") changes = edit.row < last ? setCell(table, edit.row, edit.col, edit.value) : [];
    else if (edit.type === "insertRow") changes = edit.index <= last ? insertRow(table, current, edit.index) : [];
    else if (edit.type === "deleteRow") changes = edit.index < last ? deleteRow(table, edit.index) : [];
    else if (edit.type === "insertColumn") changes = insertColumn(table, edit.index);
    else changes = deleteColumn(table, edit.index);
    // One transaction per table operation, and its own undo step.
    if (changes.length) view.dispatch({ changes, userEvent: "input.table", annotations: modules.current!.isolateHistory.of("full") });
  };
  // Ctrl/Cmd+Z and redo in the table run the editor's history; inside a cell the field has its own native undo.
  const tableKeys = (event: React.KeyboardEvent) => {
    const view = editor.current;
    if (!view || !(event.metaKey || event.ctrlKey) || event.altKey || (event.target as HTMLElement).closest("textarea")) return;
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y") {
      event.preventDefault();
      (key === "y" || event.shiftKey ? modules.current!.redo : modules.current!.undo)(view);
    }
  };

  const jump = (index: number) => {
    const section = sections[index];
    if (!section) return;
    setActive(index);
    if (mode === "source") {
      const view = editor.current;
      if (!view) return;
      const line = view.state.doc.line(Math.min(section.line, view.state.doc.lines));
      view.dispatch({ selection: { anchor: line.from }, effects: modules.current!.EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }) });
      view.focus();
    } else {
      const root = rendered.current;
      const heading = root?.querySelector<HTMLElement>(`#${section.id}`);
      if (root && heading) root.scrollTo({ top: root.scrollTop + heading.getBoundingClientRect().top - root.getBoundingClientRect().top - 24, behavior: "instant" });
    }
  };
  const showLabel = (index: number, target: HTMLButtonElement) => {
    const bounds = target.getBoundingClientRect();
    setLabel({ index, top: Math.max(8, Math.min(bounds.top, window.innerHeight - 40)), left: bounds.right + 4 });
  };

  return <div className="markdown-pane" data-mode={mode} data-sections={sections.length > 0}>
    {!plain && <div className="markdown-mode-bar" role="group" aria-label={sheet ? "CSV mode" : svg ? "SVG mode" : "Markdown mode"}>
      {sheet || svg ? <>
        <button className="markdown-mode-button" aria-pressed={mode === "view"} onClick={() => setMode("view")}>{sheet ? "Table" : "Image"}</button>
        <button className="markdown-mode-button" aria-pressed={mode === "source"} onClick={() => { setRequested(true); setMode("source"); }}>Source</button>
      </> : <button className="markdown-mode-button" onClick={() => { setRequested(true); setMode(mode === "view" ? "source" : "view"); }}>
        {/* One toggle: it names the mode a click switches to. */}
        <Icon name={mode === "view" ? "code" : "eye"} size={16} />{mode === "view" ? "View source" : "View"}
      </button>}
    </div>}
    <div className="markdown-pane-body">
      {sections.length > 0 && <nav className="markdown-section-rail" aria-label="Document sections" onScroll={() => setLabel(null)}
        onPointerMove={event => {
          // Fractional tick index under the pointer drives the CSS lens, so moving never re-renders.
          const first = event.currentTarget.querySelector("button")?.getBoundingClientRect();
          if (first) event.currentTarget.style.setProperty("--pointer", String((event.clientY - first.top) / first.height - .5));
        }} onKeyDown={event => {
        const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? Math.min(index + 1, buttons.length - 1)
          : event.key === "ArrowUp" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
      }}>
        {sections.map((section, index) => <button key={section.id} className="markdown-section-button" aria-label={section.title}
          aria-current={active === index ? "location" : undefined} aria-describedby={label?.index === index ? "markdown-section-label" : undefined}
          onClick={() => jump(index)} onMouseEnter={event => showLabel(index, event.currentTarget)}
          onFocus={event => { event.currentTarget.parentElement?.style.setProperty("--pointer", String(index)); showLabel(index, event.currentTarget); }}
          onMouseLeave={event => { if (document.activeElement !== event.currentTarget) setLabel(null); }} onBlur={() => setLabel(null)}>
          <span className="markdown-section-mark" style={{ "--i": index } as React.CSSProperties} />
        </button>)}
      </nav>}
      {sheet && <div className="markdown-table" hidden={mode !== "view"} onKeyDown={tableKeys}>
        {ragged && <div className="table-notice" role="status">Some rows have fewer columns than the widest row. They show empty cells and stay as they are until you edit them.</div>}
        {loadError && <div className="table-notice" role="alert">Couldn't load the editor, so the table can't be edited. <button className="content-inline-button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}
        <TableView rows={csvRows} columns={csv?.columns ?? 0} readOnly={!ready} label="CSV table" empty="This file is empty. Add a row to start." onEdit={applyEdit} handle={tableHandle} />
      </div>}
      {svg && <div ref={rendered} className="svg-view" role="region" hidden={mode !== "view"} tabIndex={0} aria-label="SVG image">{renderPreview?.([])}</div>}
      {!plain && !sheet && !svg && <div ref={rendered} className="markdown-rendered" hidden={mode !== "view"} tabIndex={0} aria-label="Markdown document" onScroll={previewSection}>
        {mode === "view" && renderPreview?.(headingIds)}
      </div>}
      <div className="markdown-source" hidden={mode !== "source"}>
        {loadError && <div role="alert">Couldn't load the editor. <button onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}
        {!ready && !loadError && <div role="status">Loading editor…</div>}
        <div ref={host} style={{ height: "100%" }} />
      </div>
    </div>
    {label && sections[label.index] && <span id="markdown-section-label" role="tooltip" className="markdown-section-label" style={{ top: label.top, left: label.left }}>{sections[label.index].title}</span>}
  </div>;
}
