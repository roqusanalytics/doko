import { useEffect, useRef } from "react";

export function useFileCommands(active: boolean, kind: "none" | "pdf" | "photo" | "markdown" | "workbook", busy: boolean, run: (command: FileCommand) => void) {
  const current = useRef({ active, busy, run });
  current.current = { active, busy, run };
  useEffect(() => window.folioDesktop?.onFileCommand(command => {
    if (current.current.active && !current.current.busy) current.current.run(command);
  }), []);
  useEffect(() => {
    if (active) window.folioDesktop?.setFileMenu({ kind, busy });
  }, [active, kind, busy]);
}
