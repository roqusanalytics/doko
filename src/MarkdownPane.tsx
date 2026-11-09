import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { basicSetup } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { pythonLanguage } from "@codemirror/lang-python";
import { tags } from "@lezer/highlight";
import { markdownSections } from "./markdownSections";
import "./markdown-pane.css";

export interface MarkdownEditorHandle { focus(): void }

const highlighting = HighlightStyle.define([
  { tag: tags.heading, class: "md-token-heading" },
  { tag: tags.strong, class: "md-token-strong" },
  { tag: tags.emphasis, class: "md-token-emphasis" },
  { tag: [tags.link, tags.url], class: "md-token-link" },
  { tag: [tags.keyword, tags.operatorKeyword], class: "md-token-keyword" },
  { tag: [tags.string, tags.number, tags.bool], class: "md-token-literal" },
  { tag: [tags.comment, tags.meta], class: "md-token-comment" },
  { tag: tags.monospace, class: "md-token-code" },
]);

export default function MarkdownPane({ text, onChange, renderPreview, editorRef }: {
  text: string;
  onChange: (text: string) => void;
  renderPreview: (headingIds: readonly string[]) => ReactNode;
  editorRef: Ref<MarkdownEditorHandle>;
}) {
  const [mode, setMode] = useState<"view" | "source">("view");
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
  const sections = useMemo(() => markdownSections(text), [text]);
  const latestSections = useRef(sections);
  latestSections.current = sections;
  const headingIds = useMemo(() => sections.map(section => section.id), [sections]);

  const sourceSection = (view: EditorView) => {
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
    if (!host.current) return;
    extensions.current = [
      basicSetup,
      markdown({ codeLanguages: info => /^(python|py)(?:\s|$)/i.test(info) ? pythonLanguage : null }),
      syntaxHighlighting(highlighting),
      EditorState.tabSize.of(2),
      EditorView.contentAttributes.of({ "aria-label": "Markdown source", spellcheck: "false" }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) change.current(update.state.doc.toString());
        if (update.viewportChanged || update.docChanged) sourceSection(update.view);
      }),
      EditorView.domEventHandlers({ scroll: (_event, current) => { sourceSection(current); } }),
    ];
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({ doc: text, extensions: extensions.current }),
    });
    editor.current = view;
    return () => { editor.current = null; view.destroy(); };
  }, []);

  useEffect(() => {
    const view = editor.current;
    // Reloading a document must discard undo entries from its previous contents.
    if (view && text !== view.state.doc.toString()) view.setState(EditorState.create({ doc: text, extensions: extensions.current }));
  }, [text]);

  useLayoutEffect(() => {
    setLabel(null);
    if (mode === "source" && editor.current) sourceSection(editor.current);
    else previewSection();
  }, [mode, sections]);

  useImperativeHandle(editorRef, () => ({
    focus() { if (mode === "source") editor.current?.focus(); else rendered.current?.focus(); },
  }), [mode]);

  const jump = (index: number) => {
    const section = sections[index];
    if (!section) return;
    setActive(index);
    if (mode === "source") {
      const view = editor.current;
      if (!view) return;
      const line = view.state.doc.line(Math.min(section.line, view.state.doc.lines));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }) });
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
    <div className="markdown-mode-bar" role="group" aria-label="Markdown mode">
      <button className="markdown-mode-button" aria-pressed={mode === "view"} onClick={() => setMode("view")}>View</button>
      <button className="markdown-mode-button" aria-pressed={mode === "source"} onClick={() => setMode("source")}>View source</button>
    </div>
    <div className="markdown-pane-body">
      {sections.length > 0 && <nav className="markdown-section-rail" aria-label="Document sections" onScroll={() => setLabel(null)} onKeyDown={event => {
        const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        const next = event.key === "ArrowDown" ? Math.min(index + 1, buttons.length - 1)
          : event.key === "ArrowUp" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
      }}>
        {sections.map((section, index) => <button key={section.id} className="markdown-section-button" aria-label={section.title}
          aria-current={active === index ? "location" : undefined} aria-describedby={label?.index === index ? "markdown-section-label" : undefined}
          onClick={() => jump(index)} onMouseEnter={event => showLabel(index, event.currentTarget)} onFocus={event => showLabel(index, event.currentTarget)}
          onMouseLeave={event => { if (document.activeElement !== event.currentTarget) setLabel(null); }} onBlur={() => setLabel(null)}>
          <span className="markdown-section-mark" style={{ width: `${28 - (section.depth - 1) * 3}px` }} />
        </button>)}
      </nav>}
      <div ref={rendered} className="markdown-rendered" hidden={mode !== "view"} tabIndex={0} aria-label="Markdown document" onScroll={previewSection}>
        {mode === "view" && renderPreview(headingIds)}
      </div>
      <div ref={host} className="markdown-source" hidden={mode !== "source"} />
    </div>
    {label && sections[label.index] && <span id="markdown-section-label" role="tooltip" className="markdown-section-label" style={{ top: label.top, left: label.left }}>{sections[label.index].title}</span>}
  </div>;
}
