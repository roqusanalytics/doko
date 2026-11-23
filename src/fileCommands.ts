import { useEffect, useRef } from "react";

export function useFileCommands(active: boolean, kind: Parameters<FolioDesktop["setFileMenu"]>[0]["kind"], busy: boolean, run: (command: FileCommand) => void) {
  const current = useRef({ active, busy, run });
  current.current = { active, busy, run };
  useEffect(() => {
    const stop = window.folioDesktop?.onFileCommand(command => {
      if (current.current.active && !current.current.busy) current.current.run(command);
    });

    if (!stop) return;
    // The parent preload outlives a reloaded reader iframe.
    window.addEventListener("pagehide", stop, { once: true });

    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, []);
  useEffect(() => {
    if (active) window.folioDesktop?.setFileMenu({ kind, busy });
  }, [active, kind, busy]);
}
