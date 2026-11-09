import { fromMarkdown } from "mdast-util-from-markdown";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import { normalizeMathDelimiters } from "./chatMath";

export interface MarkdownSection { id: string; title: string; depth: number; line: number }

interface MarkdownNode {
  type: string;
  depth?: number;
  value?: string;
  alt?: string | null;
  children?: MarkdownNode[];
  position?: { start: { line: number; offset?: number } };
}

export function markdownSections(text: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const sourceLines = new Map<number, number>();
  const renderedLines = new Map<number, number>();
  const collect = (node: MarkdownNode) => {
    if (node.type === "heading" && node.position?.start.offset !== undefined) sourceLines.set(node.position.start.offset, node.position.start.line);
    node.children?.forEach(collect);
  };
  collect(fromMarkdown(text));
  // Parse the same normalized Markdown as the preview, keeping original editor lines.
  const normalized = normalizeMathDelimiters(text, (sourceOffset, renderedOffset) => {
    const line = sourceLines.get(sourceOffset);
    if (line !== undefined) renderedLines.set(renderedOffset, line);
  });
  const label = (node: MarkdownNode): string => node.type === "html" ? "" : node.value ?? node.alt ?? node.children?.map(label).join("") ?? "";
  const visit = (node: MarkdownNode) => {
    if (node.type === "heading" && node.position) sections.push({
      id: `md-section-${sections.length}`,
      title: label(node).trim() || "Untitled section",
      depth: node.depth!,
      line: renderedLines.get(node.position.start.offset!) ?? node.position.start.line,
    });
    node.children?.forEach(visit);
  };
  visit(fromMarkdown(normalized, { extensions: [math({ singleDollarTextMath: false })], mdastExtensions: [mathFromMarkdown()] }));
  return sections;
}
