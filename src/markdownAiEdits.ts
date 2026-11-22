export const MAX_MARKDOWN_REPLY = 128_000;
const MAX_EDITS = 12;
const MAX_EDIT_CHARS = 16_000;
const MAX_EDIT_LINES = 250;
export const STALE_MARKDOWN_EDIT = "The document changed since this suggestion. Ask again.";

export interface MarkdownEdit {
  find: string;
  replace: string;
}
export interface MarkdownChange {
  from: number;
  to: number;
  insert: string;
}

/** Scan fences once so examples inside other code fences cannot become edits. */
function scanReply(reply: string, streaming: boolean, onBlock?: (body: string) => void) {
  const description: string[] = [];
  let fence: { marker: string; edit: boolean } | undefined;
  let body: string[] = [];
  const lines = reply.replace(/\r\n?/g, "\n").split("\n");
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const closes = marker && marker[1][0] === fence.marker[0] && marker[1].length >= fence.marker.length && !marker[2].trim();
      if (closes && fence.edit) onBlock?.(body.join("\n"));
      else if (fence.edit && onBlock) body.push(line);
      else if (!fence.edit) description.push(line);
      if (closes) fence = undefined;
    } else if (marker) {
      const info = marker[2].trim();
      const edit = marker[1][0] === "`" && /^doko-edit(?:\s|$)/.test(info);
      if (edit && !streaming && info !== "doko-edit") throw new Error("An edit block has an invalid format. Ask again.");
      fence = { marker: marker[1], edit };
      body = [];
      const partialTag = marker[1][0] === "`" && "doko-edit".startsWith(info);
      if (!edit && !(streaming && partialTag && index === lines.length - 1)) description.push(line);
    } else {
      description.push(line);
    }
  }
  if (fence?.edit && !streaming) throw new Error("An edit block is incomplete. Ask again.");
  if (streaming && /^ {0,3}`{1,2}$/.test(description.at(-1) ?? "")) description.pop();
  return description.join("\n").trim();
}

export function markdownReplyDescription(reply: string) {
  return scanReply(reply, true);
}

export function parseMarkdownReply(reply: string) {
  if (reply.length > MAX_MARKDOWN_REPLY) throw new Error("This reply is too large. Ask for fewer changes.");
  const edits: MarkdownEdit[] = [];
  const description = scanReply(reply, false, body => {
    if (edits.length >= MAX_EDITS || body.length > MAX_EDIT_CHARS) {
      throw new Error("The suggested edits are too large or too numerous. Ask for fewer changes.");
    }
    const lines = body.split("\n");
    if (lines.length > MAX_EDIT_LINES) throw new Error("A suggested edit has too many lines. Ask for fewer changes.");
    const separator = lines.indexOf("=======");
    if (lines[0] !== "<<<<<<< FIND" || separator < 1 || lines.at(-1) !== ">>>>>>> REPLACE"
      || lines.slice(1, -1).some((line, index) => index + 1 !== separator && ["<<<<<<< FIND", "=======", ">>>>>>> REPLACE"].includes(line))
      || body.includes("\0")) {
      throw new Error("An edit block has an invalid format. Ask again.");
    }
    const find = lines.slice(1, separator).join("\n");
    const replace = lines.slice(separator + 1, -1).join("\n");
    if (find === replace) throw new Error("An edit block makes no change. Ask again.");
    edits.push({ find, replace });
  });
  return { description, edits };
}

export function locateMarkdownEdits(text: string, edits: readonly MarkdownEdit[]): MarkdownChange[] {
  const changes = edits.map(({ find, replace }) => {
    const from = find === "" ? text.length : text.indexOf(find);
    if (from < 0) throw new Error("The suggested text was not found in this document.");
    if (find !== "" && text.indexOf(find, from + 1) !== -1) throw new Error("The suggested text occurs more than once in this document.");
    return { from, to: from + find.length, insert: replace };
  }).sort((a, b) => a.from - b.from);
  if (changes.some((change, i) => i > 0 && (changes[i - 1].to > change.from || changes[i - 1].from === change.from))) {
    throw new Error("The suggested edits overlap.");
  }
  return changes;
}

export function applyMarkdownChanges(text: string, changes: readonly MarkdownChange[]) {
  let offset = 0;
  const parts = changes.map(({ from, to, insert }) => {
    const part = text.slice(offset, from) + insert;
    offset = to;
    return part;
  });
  return parts.join("") + text.slice(offset);
}
