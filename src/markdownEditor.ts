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
  { tag: [tags.link, tags.url], class: "md-token-link" },
  { tag: [tags.keyword, tags.operatorKeyword], class: "md-token-keyword" },
  { tag: [tags.string, tags.number, tags.bool], class: "md-token-literal" },
  { tag: [tags.comment, tags.meta], class: "md-token-comment" },
  { tag: tags.monospace, class: "md-token-code" },
]);
