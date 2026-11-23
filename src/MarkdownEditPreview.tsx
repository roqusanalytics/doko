import { useMemo, useState } from "react";
import { parseMarkdownReply, type MarkdownEdit } from "./markdownAiEdits";

function DiffLines({ value, type }: { value: string; type: "removed" | "added" }) {
  if (!value) return null;

  return <span className={type} aria-label={type === "added" ? "Added lines" : "Removed lines"}>
    {value.split("\n").map((line, i) => <span className="markdown-diff-line" key={i}>
      <span aria-hidden="true">{type === "added" ? "+" : "−"}</span>{line}
    </span>)}
  </span>;
}

export function MarkdownEditPreview({ reply, status, readOnly, onApply, onStatus }: {
  reply: string;
  status?: "applied" | "discarded";
  readOnly: boolean;
  onApply: (edits: readonly MarkdownEdit[]) => void;
  onStatus: (status: "applied" | "discarded") => void;
}) {
  const [error, setError] = useState("");

  const edits = useMemo(() => {
    try { return parseMarkdownReply(reply).edits; }
    catch { return null; }
  }, [reply]);

  if (status) return <p className="markdown-edit-status" role="status">{status === "applied" ? "Edits applied" : "Edits discarded"}</p>;

  if (!edits?.length) return <p className="msg-error" role="alert">Couldn’t read the suggested edits.</p>;

  return <div className="markdown-edit-preview">
    {edits.map(({ find, replace }, i) => <pre className="markdown-diff" key={i} aria-label={`Suggested edit ${i + 1}`}><code>
      <DiffLines value={find} type="removed" /><DiffLines value={replace} type="added" />
    </code></pre>)}
    {error && <p className="msg-error" role="alert">{error}</p>}
    {readOnly && <p className="markdown-edit-status">This document is read-only.</p>}
    <div className="markdown-edit-actions">
      <button className="btn primary" disabled={readOnly || !!error} onClick={() => {
        try {
          onApply(edits);
          onStatus("applied");
        } catch (error) {
          setError(error instanceof Error ? error.message : "Couldn’t apply the suggested edits.");
        }
      }}>Apply</button>
      <button className="btn ghost" onClick={() => onStatus("discarded")}>Discard</button>
    </div>
  </div>;
}
