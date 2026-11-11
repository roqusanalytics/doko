import { useEffect, useState } from "react";
import "./svg-view.css";

export interface SvgImage {
  /** Blob URL of the current text; empty when the SVG is empty. */
  url: string;
  /** "failed" stays until a later render succeeds, so the notice does not flicker while the user types. */
  state: "empty" | "loading" | "ready" | "failed";
  onLoad(image: HTMLImageElement): void;
  onError(): void;
}

const DEBOUNCE_MS = 200;

// The SVG is only ever shown through an <img> whose source is a Blob URL: an image document runs no scripts and loads
// no external resources. Never put the text itself into the page.
export function useSvgImage(text: string, enabled: boolean): SvgImage {
  const [settled, setSettled] = useState(text);
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<{ url: string; failed: boolean } | null>(null);
  // The first render of a document is immediate; typing waits for a pause so a large file does not slow the editor.
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setSettled(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, enabled]);
  useEffect(() => {
    if (!enabled || !settled.trim()) { setUrl(""); setResult(null); return; }
    const next = URL.createObjectURL(new Blob([settled], { type: "image/svg+xml" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [settled, enabled]);
  // "empty" means the text is blank; until the first Blob URL exists a non-empty SVG shows nothing rather than the empty notice.
  const state = !settled.trim() ? "empty" : !result ? "loading" : result.failed ? "failed" : result.url === url ? "ready" : "loading";
  return {
    url, state,
    onLoad: image => setResult({ url: image.currentSrc, failed: false }),
    onError: () => setResult({ url, failed: true }),
  };
}

export default function SvgView({ image, name }: { image: SvgImage; name: string }) {
  return <>
    {image.state === "failed" && <div className="content-notice" role="alert"><span>This SVG can't be drawn. Check the source for errors.</span></div>}
    <div className="svg-stage">
      {image.state === "empty" ? <p className="content-empty" role="status">This SVG is empty. Switch to Source and add some markup.</p>
        : image.url && <img className="svg-image" src={image.url} alt={name} hidden={image.state === "failed"}
          onLoad={event => image.onLoad(event.currentTarget)} onError={image.onError} />}
    </div>
  </>;
}
