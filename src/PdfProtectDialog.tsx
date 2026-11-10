import { useEffect, useRef, useState } from "react";
import { Modal } from "./Dialogs";
import type { PdfSecurityDialogProps } from "./pdfSecurity";
import "./pdfSecurity.css";

export default function PdfProtectDialog({ bytes, name, onApply, onClose }: PdfSecurityDialogProps) {
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const job = useRef<AbortController | null>(null), root = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector("input")?.focus();
    return () => { job.current?.abort(); previous?.focus(); };
  }, []);
  const apply = async () => {
    if (busy) return;
    const controller = new AbortController(); job.current = controller;
    setBusy(true); setError("");
    try {
      const { protectPdf, validatePdfPassword } = await import("./pdfSecurity");
      validatePdfPassword(password, confirmation);
      const protectedBytes = await protectPdf(bytes, password, controller.signal);
      controller.signal.throwIfAborted(); setSaving(true);
      await onApply(protectedBytes, password);
      setPassword(""); setConfirmation(""); onClose();
    } catch (error) { if (!controller.signal.aborted) setError((error as Error).message || "Couldn't save the protected copy. Try again."); }
    finally { setBusy(false); setSaving(false); job.current = null; }
  };
  return <Modal title="Protect a copy" onClose={saving ? () => {} : onClose}>
    <form className="pdf-security" ref={root} onSubmit={event => { event.preventDefault(); void apply(); }}>
      <p className="pdf-security-name">{name}</p>
      <p>The copy requires this password to open. Your original stays unchanged. Processing stays on this device.</p>
      <fieldset disabled={busy}>
        <label>New password<input type="password" autoComplete="new-password" value={password} onChange={event => { setPassword(event.target.value); setError(""); }} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" value={confirmation} onChange={event => { setConfirmation(event.target.value); setError(""); }} /></label>
      </fieldset>
      <p>Keep your password somewhere safe: Doko cannot recover it. Use an unsigned, unencrypted PDF. AES-256 encryption preserves the document’s content.</p>
      {busy && <p role="status">{saving ? "Saving protected copy…" : "Encrypting copy…"}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="btn ghost" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>Save protected copy…</button></div>
    </form>
  </Modal>;
}
