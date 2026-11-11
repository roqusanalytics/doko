import { useEffect, useState } from "react";
import { htmlPreview } from "./htmlPreview";

export default function HtmlView({ text, name }: { text: string; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    // A blob gives fragment links this document's URL, rather than the application's URL inherited by srcdoc.
    const next = URL.createObjectURL(new Blob([htmlPreview(text)], { type: "text/html;charset=utf-8" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [text]);
  if (!text.trim()) return <p className="content-empty" role="status">This HTML document is empty.</p>;
  return url ? <iframe className="html-preview" title={`HTML preview: ${name}`} sandbox="" referrerPolicy="no-referrer" src={url} />
    : <p className="content-empty" role="status">Loading HTML…</p>;
}
