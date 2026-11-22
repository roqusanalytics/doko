export { basicSetup } from "codemirror";
export { EditorState } from "@codemirror/state";
export { EditorView } from "@codemirror/view";
export { markdown } from "@codemirror/lang-markdown";
export { pythonLanguage } from "@codemirror/lang-python";
export { syntaxHighlighting } from "@codemirror/language";
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
export const highlighting = HighlightStyle.define([
  { tag: tags.heading, class: "md-token-heading" },
  { tag: tags.strong, class: "md-token-strong" },
  { tag: tags.emphasis, class: "md-token-emphasis" },
  { tag: tags.strikethrough, class: "md-token-strikethrough" },
  { tag: tags.link, class: "md-token-link" },
  { tag: tags.url, class: "md-token-url" },
  { tag: tags.quote, class: "md-token-quote" },
  { tag: tags.monospace, class: "md-token-code" },
  // `#`, `**`, `` ` ``, `>`, `-` and other Markdown marks share one tag in @lezer/markdown.
  { tag: [tags.processingInstruction, tags.contentSeparator, tags.labelName], class: "md-token-mark" },
  { tag: [tags.keyword, tags.operatorKeyword], class: "md-token-keyword" },
  { tag: tags.string, class: "md-token-string" },
  { tag: [tags.number, tags.bool], class: "md-token-literal" },
  { tag: [tags.comment, tags.meta], class: "md-token-comment" },
]);
// The CSV table edits this editor's text, so its undo history serves the table too.
export { undo, redo, isolateHistory } from "@codemirror/commands";
